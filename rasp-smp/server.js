'use strict';
/**
 * RASP SMP - Web sitesi + Yönetim paneli
 * Hiçbir harici paket gerektirmez (sadece Node.js 18+).
 * Veriler data/db.json dosyasında tutulur.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

// Yetki listesi: panelden istediğin kişiye bunlardan istediğini verebilirsin.
const PERMISSIONS = {
  users: 'Kullanıcıları ve yetkileri yönet',
  products: 'Mağaza ürünlerini yönet',
  orders: 'Siparişleri yönet',
  tickets: 'Destek taleplerine bak ve yanıtla',
  forms: 'Başvuru formu oluştur / düzenle',
  applications: 'Başvuruları değerlendir',
  announcements: 'Duyuru yönet',
  settings: 'Site ayarlarını değiştir',
};

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ------------------------------ Veritabanı ------------------------------ */
const uid = () => crypto.randomBytes(8).toString('hex');
const now = () => new Date().toISOString();

function defaults() {
  return {
    users: [],
    sessions: {},
    products: [
      { id: uid(), name: 'VIP Rütbe', category: 'Rütbeler', price: 99, description: 'Özel prefix, /fly ve ek home hakkı.', active: true },
      { id: uid(), name: 'MVP Rütbe', category: 'Rütbeler', price: 199, description: 'VIP avantajları + özel kit ve ek claim bloğu.', active: true },
      { id: uid(), name: '5000 Oyun Parası', category: 'Para', price: 49, description: 'Sunucu içi ekonomi için 5000 para.', active: true },
    ],
    orders: [],
    secrets: { paytr: { merchantId: '', merchantKey: '', merchantSalt: '', testMode: false, lastError: null } },
    tickets: [],
    forms: [
      {
        id: uid(), title: 'Yetkili Başvurusu', open: true, createdBy: 'sistem', createdAt: now(),
        description: 'Ekibimize katılmak istiyorsan formu eksiksiz doldur.',
        questions: [
          { text: 'Yaşın kaç?', type: 'short' },
          { text: 'Daha önce hangi sunucularda yetkili oldun?', type: 'long' },
          { text: 'Neden seni seçmeliyiz?', type: 'long' },
        ],
      },
    ],
    applications: [],
    announcements: [
      { id: uid(), title: 'RASP SMP açıldı!', text: 'Sunucumuza hoş geldin. Kayıt ol, mağazaya göz at ve ekibimize başvur.', createdAt: now() },
    ],
    settings: {
      name: 'RASP SMP',
      tagline: 'Arkadaşlarınla birlikte yaşa, inşa et, hayatta kal.',
      ip: 'play.raspsmp.com',
      version: '1.21+',
      discord: '',
      about: 'RASP SMP; adil kurallar, aktif yetkili ekibi ve topluluk odaklı bir survival sunucusudur.',
      rules: 'Hile ve bug kullanımı yasaktır.\nDiğer oyunculara küfür ve hakaret yasaktır.\nGrief ve çalmak yasaktır.\nYetkililerin kararlarına saygı göster.',
      paymentNote: 'Sipariş verdikten sonra kartla veya havale/EFT ile ödeyebilirsin. Ödeme onaylanınca ürün hesabına tanımlanır.',
      iban: 'TR19 0001 0090 1078 2727 1050 01',
      ibanName: '', // alıcı adı soyadı (panelden / Site Ayarları'ndan gir)
      texts: {}, // sitedeki yazıların sahip tarafından değiştirilmiş halleri
    },
  };
}

let db;
function load() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const d = defaults();
    for (const k of Object.keys(d)) if (db[k] === undefined) db[k] = d[k];
    db.settings = { ...d.settings, ...db.settings };
  } catch {
    db = defaults();
    save(true);
  }
  const t = Date.now();
  for (const [k, s] of Object.entries(db.sessions)) if (s.expires < t) delete db.sessions[k];
}
let saveTimer = null;
function save(sync) {
  const write = () => {
    saveTimer = null;
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  };
  if (sync) { if (saveTimer) clearTimeout(saveTimer); write(); return; }
  if (!saveTimer) saveTimer = setTimeout(write, 150);
}
function flushAndExit() { try { save(true); } finally { process.exit(0); } }
process.on('SIGINT', flushAndExit);
process.on('SIGTERM', flushAndExit);
load();

/* ------------------------------ Yardımcılar ------------------------------ */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);

const str = (v, max, name = 'Alan', { min = 0, required = false } = {}) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw bad(`${name} boş bırakılamaz.`);
  if (s.length < min) throw bad(`${name} en az ${min} karakter olmalı.`);
  if (s.length > max) throw bad(`${name} en fazla ${max} karakter olabilir.`);
  return s;
};

async function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt, 64);
  return salt.toString('hex') + ':' + h.toString('hex');
}
async function checkPw(pw, stored) {
  const [s, h] = String(stored).split(':');
  const hh = await scrypt(pw, Buffer.from(s, 'hex'), 64);
  const hb = Buffer.from(h, 'hex');
  return hb.length === hh.length && crypto.timingSafeEqual(hh, hb);
}

const hits = new Map();
function limit(key, max, windowMs) {
  const t = Date.now();
  const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
  arr.push(t);
  hits.set(key, arr);
  if (arr.length > max) throw new HttpError(429, 'Çok fazla deneme yaptın. Biraz sonra tekrar dene.');
}
setInterval(() => { const t = Date.now(); for (const [k, a] of hits) if (!a.some((x) => t - x < 3600e3)) hits.delete(k); }, 600e3).unref();

// IBAN doğrulama (ISO 13616 mod-97). Boş değer geçerlidir (ödeme bilgisi gizlenir).
function cleanIban(v) {
  const s = (typeof v === 'string' ? v : '').replace(/\s+/g, '').toUpperCase();
  if (!s) return '';
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) throw bad('IBAN biçimi geçersiz.');
  const digits = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55);
  let m = 0;
  for (const ch of digits) m = (m * 10 + Number(ch)) % 97;
  if (m !== 1) throw bad('IBAN doğrulanamadı, tekrar kontrol et.');
  return s.replace(/(.{4})/g, '$1 ').trim();
}

const can = (u, perm) => !!u && (u.role === 'owner' || u.permissions.includes(perm));
const isStaff = (u) => !!u && (u.role === 'owner' || u.permissions.length > 0);
const pub = (u) => ({
  id: u.id, username: u.username, mcname: u.mcname, role: u.role, title: u.title || '',
  permissions: u.role === 'owner' ? Object.keys(PERMISSIONS) : u.permissions,
  banned: !!u.banned, createdAt: u.createdAt,
});
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function canManage(actor, target) {
  if (target.role === 'owner' || target.id === actor.id) return false;
  return actor.role === 'owner' || target.permissions.every((p) => actor.permissions.includes(p));
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function sessionUser(req) {
  const tok = parseCookies(req).rasp_session;
  if (!tok) return null;
  const s = db.sessions[sha(tok)];
  if (!s || s.expires < Date.now()) return null;
  const u = db.users.find((x) => x.id === s.userId);
  if (!u || u.banned) return null;
  return u;
}
function setSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[sha(token)] = { userId, expires: Date.now() + SESSION_MS };
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `rasp_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
}
function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

/* -------------------------------- Rotalar -------------------------------- */
const routes = [];
function route(method, pattern, opts, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, opts: opts || {}, handler });
}

/* ---- Genel ---- */
route('GET', '/api/public', {}, () => ({
  settings: { ...db.settings, cardEnabled: !!paytrCfg() },
  announcements: [...db.announcements].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
  openForms: db.forms.filter((f) => f.open).length,
}));

route('GET', '/api/me', {}, (c) => ({ user: c.user ? pub(c.user) : null, allPermissions: PERMISSIONS }));

route('POST', '/api/register', {}, async (c) => {
  limit('reg:' + clientIp(c.req), 8, 3600e3);
  const username = str(c.body.username, 20, 'Kullanıcı adı', { required: true });
  const mcname = str(c.body.mcname, 16, 'Minecraft adı', { required: true });
  const password = typeof c.body.password === 'string' ? c.body.password : '';
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw bad('Kullanıcı adı 3-20 karakter olmalı; harf, rakam ve _ kullanılabilir.');
  if (!/^[A-Za-z0-9_]{3,16}$/.test(mcname)) throw bad('Minecraft adı 3-16 karakter olmalı; harf, rakam ve _ kullanılabilir.');
  if (password.length < 8 || password.length > 100) throw bad('Şifre en az 8 karakter olmalı.');
  if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw bad('Bu kullanıcı adı zaten alınmış.');
  const first = db.users.length === 0;
  const user = {
    id: uid(), username, mcname, passwordHash: await hashPw(password),
    role: first ? 'owner' : 'member', permissions: [], title: first ? 'Kurucu' : '',
    banned: false, createdAt: now(),
  };
  db.users.push(user);
  setSession(c.req, c.res, user.id);
  save();
  return { user: pub(user), firstUser: first };
});

route('POST', '/api/login', {}, async (c) => {
  limit('login:' + clientIp(c.req), 12, 10 * 60e3);
  const username = str(c.body.username, 20);
  const password = typeof c.body.password === 'string' ? c.body.password : '';
  const user = db.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  const ok = user ? await checkPw(password, user.passwordHash) : (await hashPw('x'), false);
  if (!user || !ok) throw new HttpError(401, 'Kullanıcı adı veya şifre hatalı.');
  if (user.banned) throw new HttpError(403, 'Hesabın engellenmiş.');
  setSession(c.req, c.res, user.id);
  save();
  return { user: pub(user) };
});

route('POST', '/api/logout', {}, (c) => {
  const tok = parseCookies(c.req).rasp_session;
  if (tok) delete db.sessions[sha(tok)];
  c.res.setHeader('Set-Cookie', 'rasp_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  save();
  return { ok: true };
});

route('POST', '/api/me/password', { auth: true }, async (c) => {
  const cur = typeof c.body.current === 'string' ? c.body.current : '';
  const next = typeof c.body.next === 'string' ? c.body.next : '';
  if (!(await checkPw(cur, c.user.passwordHash))) throw bad('Mevcut şifre hatalı.');
  if (next.length < 8 || next.length > 100) throw bad('Yeni şifre en az 8 karakter olmalı.');
  c.user.passwordHash = await hashPw(next);
  save();
  return { ok: true };
});

/* ---- Mağaza ---- */
route('GET', '/api/products', {}, (c) => {
  const all = c.query.get('all') === '1' && can(c.user, 'products');
  return db.products.filter((p) => all || p.active);
});

route('POST', '/api/orders', { auth: true }, (c) => {
  const p = db.products.find((x) => x.id === c.body.productId && x.active);
  if (!p) throw new HttpError(404, 'Ürün bulunamadı.');
  const mcname = str(c.body.mcname || c.user.mcname, 16, 'Minecraft adı', { required: true });
  if (!/^[A-Za-z0-9_]{3,16}$/.test(mcname)) throw bad('Geçersiz Minecraft adı.');
  if (db.orders.filter((o) => o.userId === c.user.id && o.status === 'pending').length >= 10) throw bad('Bekleyen çok fazla siparişin var.');
  const id = uid();
  const o = {
    id, code: 'RASP-' + id.slice(0, 6).toUpperCase(), userId: c.user.id, username: c.user.username, mcname,
    productId: p.id, productName: p.name, price: p.price, status: 'pending', createdAt: now(),
  };
  db.orders.push(o);
  save();
  return o;
});

route('GET', '/api/orders', { auth: true }, (c) => {
  const all = c.query.get('all') === '1' && can(c.user, 'orders');
  return db.orders.filter((o) => all || o.userId === c.user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
});

route('POST', '/api/orders/:id/status', { perm: 'orders' }, (c) => {
  const o = db.orders.find((x) => x.id === c.params.id);
  if (!o) throw new HttpError(404, 'Sipariş bulunamadı.');
  if (!['pending', 'paid', 'delivered', 'cancelled'].includes(c.body.status)) throw bad('Geçersiz durum.');
  o.status = c.body.status;
  o.handledBy = c.user.username;
  save();
  return o;
});

/* ---- Kartla ödeme (PayTR iFrame API) ----
   Kart bilgisi bu sitede ASLA girilmez; PayTR'ın güvenli sayfası iframe içinde açılır.
   Ödeme sonucu PayTR'dan imzalı bildirim (callback) ile gelir ve sipariş otomatik "Ödendi" olur. */
function paytrCfg() {
  const s = (db.secrets && db.secrets.paytr) || {};
  const id = process.env.PAYTR_MERCHANT_ID || s.merchantId;
  const key = process.env.PAYTR_MERCHANT_KEY || s.merchantKey;
  const salt = process.env.PAYTR_MERCHANT_SALT || s.merchantSalt;
  if (!id || !key || !salt) return null;
  const test = process.env.PAYTR_TEST_MODE !== undefined ? process.env.PAYTR_TEST_MODE === '1' : !!s.testMode;
  return { id: String(id), key: String(key), salt: String(salt), test };
}
const hmac64 = (data, key) => crypto.createHmac('sha256', key).update(data).digest('base64');
function baseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${proto}://${req.headers.host}`;
}
function paytrState(req) {
  const s = db.secrets.paytr;
  return {
    configured: !!paytrCfg(), fromEnv: !!process.env.PAYTR_MERCHANT_ID, merchantId: s.merchantId || '',
    hasKey: !!s.merchantKey, hasSalt: !!s.merchantSalt, testMode: !!s.testMode, lastError: s.lastError || null,
    callbackUrl: baseUrl(req) + '/api/paytr/callback',
  };
}
const ownerOnly = (c) => { if (c.user.role !== 'owner') throw new HttpError(403, 'Bu ayarı sadece sahip değiştirebilir.'); };

route('POST', '/api/orders/:id/pay', { auth: true }, async (c) => {
  limit('pay:' + c.user.id, 10, 10 * 60e3);
  const cfg = paytrCfg();
  if (!cfg) throw bad('Kartla ödeme şu an kapalı.');
  const o = db.orders.find((x) => x.id === c.params.id && x.userId === c.user.id);
  if (!o) throw new HttpError(404, 'Sipariş bulunamadı.');
  if (o.status !== 'pending') throw bad('Bu sipariş için ödeme beklenmiyor.');
  const amount = Math.round(o.price * 100);
  if (amount <= 0) throw bad('Bu siparişin tutarı 0, ödeme gerekmiyor.');
  const email = str(c.body.email, 100, 'E-posta', { required: true });
  if (!/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(email)) throw bad('Geçerli bir e-posta yaz (Türkçe karakter olmadan).');
  const phone = String(c.body.phone || '').replace(/[^\d+]/g, '');
  if (phone.length < 10 || phone.length > 15) throw bad('Telefon numarası geçersiz.');

  const attempt = (o.payAttempts || 0) + 1;
  const oid = 'RASP' + o.id + 'N' + attempt; // yalnızca harf-rakam, her deneme için benzersiz
  const ip = clientIp(c.req).replace(/^::ffff:/, '');
  const basket = Buffer.from(JSON.stringify([[o.productName, o.price.toFixed(2), 1]])).toString('base64');
  const testMode = cfg.test ? '1' : '0';
  const paytr_token = hmac64([cfg.id, ip, oid, email, amount, basket, '0', '0', 'TL', testMode].join('') + cfg.salt, cfg.key);
  const base = baseUrl(c.req);
  const form = new URLSearchParams({
    merchant_id: cfg.id, user_ip: ip, merchant_oid: oid, email, payment_amount: String(amount), paytr_token,
    user_basket: basket, debug_on: '0', no_installment: '0', max_installment: '0', user_name: c.user.username,
    user_address: 'Dijital urun - teslimat yok', user_phone: phone, merchant_ok_url: base + '/#/store',
    merchant_fail_url: base + '/#/store', timeout_limit: '30', currency: 'TL', test_mode: testMode, lang: 'tr',
  });
  let data;
  try {
    const r = await fetch('https://www.paytr.com/odeme/api/get-token', { method: 'POST', body: form, signal: AbortSignal.timeout(15000) });
    data = await r.json();
  } catch (e) {
    console.error('PayTR bağlantı hatası:', e.message);
    db.secrets.paytr.lastError = { at: now(), reason: 'PayTR\'a ulaşılamadı: ' + e.message };
    save();
    throw new HttpError(502, 'Ödeme sağlayıcıya ulaşılamadı. Biraz sonra tekrar dene.');
  }
  if (!data || data.status !== 'success' || !data.token) {
    const reason = String((data && data.reason) || 'bilinmeyen hata').slice(0, 300);
    console.error('PayTR token hatası:', reason);
    db.secrets.paytr.lastError = { at: now(), reason };
    save();
    throw new HttpError(502, 'Ödeme başlatılamadı. Biraz sonra tekrar dene.');
  }
  o.payAttempts = attempt;
  o.merchantOids = [...(o.merchantOids || []), oid];
  save();
  return { token: data.token };
});

// PayTR sunucusu buraya imzalı bildirim yollar. Oturum gerektirmez, cevap düz "OK" olmalıdır.
route('POST', '/api/paytr/callback', {}, (c) => {
  const cfg = paytrCfg();
  if (!cfg) throw new HttpError(503, 'kapalı');
  const b = c.body;
  const expected = Buffer.from(hmac64(String(b.merchant_oid) + cfg.salt + String(b.status) + String(b.total_amount), cfg.key));
  const got = Buffer.from(String(b.hash || ''));
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) throw new HttpError(400, 'Geçersiz imza.');
  const o = db.orders.find((x) => (x.merchantOids || []).includes(String(b.merchant_oid)));
  if (!o) return 'OK';
  if (b.status === 'success') {
    if (o.paidAt) return 'OK'; // tekrar bildirim: sadece OK dön
    if (Number(b.payment_amount) !== Math.round(o.price * 100)) {
      o.amountMismatch = true; // tutar uyuşmuyorsa otomatik onaylama
      console.error(`PayTR tutar uyuşmazlığı: sipariş ${o.code}, beklenen ${Math.round(o.price * 100)}, gelen ${b.payment_amount}`);
    } else {
      o.paidAt = now();
      o.paymentType = b.payment_type === 'eft' ? 'eft' : 'card';
      o.testPayment = String(b.test_mode) === '1';
      if (o.status === 'pending') o.status = 'paid';
      else if (o.status === 'cancelled') o.paidAfterCancel = true;
    }
  } else {
    o.lastPayError = String(b.failed_reason_msg || 'Ödeme başarısız').slice(0, 200);
  }
  save();
  return 'OK';
});

route('GET', '/api/admin/paytr', { perm: 'settings' }, (c) => { ownerOnly(c); return paytrState(c.req); });
route('PUT', '/api/admin/paytr', { perm: 'settings' }, (c) => {
  ownerOnly(c);
  const s = db.secrets.paytr;
  if (c.body.clear) {
    Object.assign(s, { merchantId: '', merchantKey: '', merchantSalt: '', testMode: false, lastError: null });
  } else {
    const field = (v, name) => {
      const x = typeof v === 'string' ? v.trim() : '';
      if (x && !/^[\x21-\x7E]{1,100}$/.test(x)) throw bad(`${name} geçersiz karakter içeriyor.`);
      return x;
    };
    const id = field(c.body.merchantId, 'Mağaza no'), key = field(c.body.merchantKey, 'Mağaza anahtarı'), salt = field(c.body.merchantSalt, 'Mağaza gizli anahtarı (salt)');
    if (id) s.merchantId = id;
    if (key) s.merchantKey = key;
    if (salt) s.merchantSalt = salt;
    s.testMode = !!c.body.testMode;
  }
  save();
  return paytrState(c.req);
});

function productFields(b) {
  const price = Number(b.price);
  if (!Number.isFinite(price) || price < 0 || price > 1e6) throw bad('Fiyat geçersiz.');
  return {
    name: str(b.name, 60, 'Ürün adı', { required: true }),
    category: str(b.category, 30, 'Kategori') || 'Diğer',
    description: str(b.description, 400, 'Açıklama'),
    price: Math.round(price * 100) / 100,
    active: b.active !== false,
  };
}
route('POST', '/api/products', { perm: 'products' }, (c) => {
  const p = { id: uid(), ...productFields(c.body) };
  db.products.push(p); save(); return p;
});
route('PUT', '/api/products/:id', { perm: 'products' }, (c) => {
  const p = db.products.find((x) => x.id === c.params.id);
  if (!p) throw new HttpError(404, 'Ürün bulunamadı.');
  Object.assign(p, productFields(c.body)); save(); return p;
});
route('DELETE', '/api/products/:id', { perm: 'products' }, (c) => {
  const i = db.products.findIndex((x) => x.id === c.params.id);
  if (i < 0) throw new HttpError(404, 'Ürün bulunamadı.');
  db.products.splice(i, 1); save(); return { ok: true };
});

/* ---- Destek ---- */
const ticketView = (t) => ({ ...t, messages: undefined, messageCount: t.messages.length });
function getTicket(c) {
  const t = db.tickets.find((x) => x.id === c.params.id);
  if (!t || (t.userId !== c.user.id && !can(c.user, 'tickets'))) throw new HttpError(404, 'Talep bulunamadı.');
  return t;
}
route('GET', '/api/tickets', { auth: true }, (c) => {
  const all = c.query.get('all') === '1' && can(c.user, 'tickets');
  return db.tickets.filter((t) => all || t.userId === c.user.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(ticketView);
});
route('POST', '/api/tickets', { auth: true }, (c) => {
  if (db.tickets.filter((t) => t.userId === c.user.id && t.status !== 'closed').length >= 5) throw bad('En fazla 5 açık talebin olabilir.');
  const category = ['Genel', 'Mağaza / Ödeme', 'Şikayet', 'Hata bildirimi', 'Ban itirazı'].includes(c.body.category) ? c.body.category : 'Genel';
  const t = {
    id: uid(), userId: c.user.id, username: c.user.username, mcname: c.user.mcname,
    subject: str(c.body.subject, 100, 'Konu', { required: true }), category,
    status: 'open', createdAt: now(), updatedAt: now(),
    messages: [{ userId: c.user.id, username: c.user.username, staff: false, text: str(c.body.message, 3000, 'Mesaj', { required: true }), at: now() }],
  };
  db.tickets.push(t); save(); return { id: t.id };
});
route('GET', '/api/tickets/:id', { auth: true }, (c) => getTicket(c));
route('POST', '/api/tickets/:id/reply', { auth: true }, (c) => {
  const t = getTicket(c);
  if (t.status === 'closed') throw bad('Bu talep kapatılmış.');
  const staff = can(c.user, 'tickets') && t.userId !== c.user.id;
  t.messages.push({ userId: c.user.id, username: c.user.username, staff, text: str(c.body.message, 3000, 'Mesaj', { required: true }), at: now() });
  t.status = staff ? 'answered' : 'open';
  t.updatedAt = now();
  save(); return t;
});
route('POST', '/api/tickets/:id/close', { auth: true }, (c) => {
  const t = getTicket(c);
  t.status = 'closed'; t.updatedAt = now(); save(); return t;
});

/* ---- Başvurular ---- */
function formFields(b) {
  if (!Array.isArray(b.questions) || b.questions.length === 0) throw bad('En az bir soru eklemelisin.');
  if (b.questions.length > 25) throw bad('En fazla 25 soru eklenebilir.');
  return {
    title: str(b.title, 80, 'Başlık', { required: true }),
    description: str(b.description, 600, 'Açıklama'),
    open: b.open !== false,
    questions: b.questions.map((q) => ({
      text: str(q && q.text, 200, 'Soru', { required: true }),
      type: q && q.type === 'long' ? 'long' : 'short',
    })),
  };
}
route('GET', '/api/forms', {}, (c) => {
  const all = c.query.get('all') === '1' && can(c.user, 'forms');
  return db.forms.filter((f) => all || f.open);
});
route('POST', '/api/forms', { perm: 'forms' }, (c) => {
  const f = { id: uid(), ...formFields(c.body), createdBy: c.user.username, createdAt: now() };
  db.forms.push(f); save(); return f;
});
route('PUT', '/api/forms/:id', { perm: 'forms' }, (c) => {
  const f = db.forms.find((x) => x.id === c.params.id);
  if (!f) throw new HttpError(404, 'Form bulunamadı.');
  Object.assign(f, formFields(c.body)); save(); return f;
});
route('DELETE', '/api/forms/:id', { perm: 'forms' }, (c) => {
  const i = db.forms.findIndex((x) => x.id === c.params.id);
  if (i < 0) throw new HttpError(404, 'Form bulunamadı.');
  db.forms.splice(i, 1); save(); return { ok: true };
});

route('POST', '/api/applications', { auth: true }, (c) => {
  const f = db.forms.find((x) => x.id === c.body.formId && x.open);
  if (!f) throw new HttpError(404, 'Bu başvuru şu an açık değil.');
  if (db.applications.some((a) => a.userId === c.user.id && a.formId === f.id && a.status === 'pending')) {
    throw bad('Bu form için zaten bekleyen bir başvurun var.');
  }
  const answers = Array.isArray(c.body.answers) ? c.body.answers : [];
  const a = {
    id: uid(), formId: f.id, formTitle: f.title, userId: c.user.id, username: c.user.username, mcname: c.user.mcname,
    answers: f.questions.map((q, i) => ({ q: q.text, a: str(answers[i], q.type === 'long' ? 2000 : 300, 'Cevap', { required: true }) })),
    status: 'pending', note: '', createdAt: now(),
  };
  db.applications.push(a); save(); return a;
});
route('GET', '/api/applications', { auth: true }, (c) => {
  const all = c.query.get('all') === '1' && can(c.user, 'applications');
  return db.applications.filter((a) => all || a.userId === c.user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
});
route('POST', '/api/applications/:id/review', { perm: 'applications' }, (c) => {
  const a = db.applications.find((x) => x.id === c.params.id);
  if (!a) throw new HttpError(404, 'Başvuru bulunamadı.');
  if (!['accepted', 'rejected', 'pending'].includes(c.body.status)) throw bad('Geçersiz durum.');
  a.status = c.body.status; a.note = str(c.body.note, 500, 'Not'); a.reviewedBy = c.user.username; a.reviewedAt = now();
  save(); return a;
});

/* ---- Yönetim ---- */
route('GET', '/api/admin/stats', { staff: true }, () => ({
  users: db.users.length,
  staff: db.users.filter(isStaff).length,
  openTickets: db.tickets.filter((t) => t.status !== 'closed').length,
  pendingApps: db.applications.filter((a) => a.status === 'pending').length,
  pendingOrders: db.orders.filter((o) => o.status === 'pending' || o.status === 'paid').length,
  revenue: db.orders.filter((o) => o.status === 'delivered').reduce((s, o) => s + o.price, 0),
}));

route('GET', '/api/admin/users', { perm: 'users' }, (c) =>
  db.users.map((u) => ({ ...pub(u), manageable: canManage(c.user, u) })));

route('POST', '/api/admin/users/:id/access', { perm: 'users' }, (c) => {
  const t = db.users.find((u) => u.id === c.params.id);
  if (!t) throw new HttpError(404, 'Kullanıcı bulunamadı.');
  if (!canManage(c.user, t)) throw new HttpError(403, 'Bu kullanıcının yetkilerini değiştiremezsin.');
  const perms = [...new Set((Array.isArray(c.body.permissions) ? c.body.permissions : []).filter((p) => PERMISSIONS[p]))];
  if (c.user.role !== 'owner') {
    const mine = new Set(c.user.permissions);
    const changed = [...perms.filter((p) => !t.permissions.includes(p)), ...t.permissions.filter((p) => !perms.includes(p))];
    if (changed.some((p) => !mine.has(p))) throw new HttpError(403, 'Sahip olmadığın bir yetkiyi veremez veya alamazsın.');
  }
  t.permissions = perms;
  t.title = str(c.body.title, 24, 'Rütbe');
  save();
  return pub(t);
});

route('POST', '/api/admin/users/:id/ban', { perm: 'users' }, (c) => {
  const t = db.users.find((u) => u.id === c.params.id);
  if (!t) throw new HttpError(404, 'Kullanıcı bulunamadı.');
  if (!canManage(c.user, t)) throw new HttpError(403, 'Bu kullanıcıyı engelleyemezsin.');
  t.banned = !!c.body.banned;
  if (t.banned) for (const [k, s] of Object.entries(db.sessions)) if (s.userId === t.id) delete db.sessions[k];
  save();
  return pub(t);
});

route('POST', '/api/admin/users/:id/password', { perm: 'users' }, async (c) => {
  const t = db.users.find((u) => u.id === c.params.id);
  if (!t) throw new HttpError(404, 'Kullanıcı bulunamadı.');
  if (!canManage(c.user, t)) throw new HttpError(403, 'Bu kullanıcının şifresini değiştiremezsin.');
  const pw = typeof c.body.password === 'string' ? c.body.password : '';
  if (pw.length < 8 || pw.length > 100) throw bad('Şifre en az 8 karakter olmalı.');
  t.passwordHash = await hashPw(pw);
  for (const [k, s] of Object.entries(db.sessions)) if (s.userId === t.id) delete db.sessions[k];
  save();
  return { ok: true };
});

route('POST', '/api/announcements', { perm: 'announcements' }, (c) => {
  const a = { id: uid(), title: str(c.body.title, 100, 'Başlık', { required: true }), text: str(c.body.text, 1000, 'Metin', { required: true }), createdAt: now() };
  db.announcements.push(a); save(); return a;
});
route('DELETE', '/api/announcements/:id', { perm: 'announcements' }, (c) => {
  const i = db.announcements.findIndex((x) => x.id === c.params.id);
  if (i < 0) throw new HttpError(404, 'Duyuru bulunamadı.');
  db.announcements.splice(i, 1); save(); return { ok: true };
});

// Sitedeki herhangi bir yazıyı değiştir (basılı tutup "Ayarla" ile). Boş değer = varsayılana dön.
route('PUT', '/api/texts', { perm: 'settings' }, (c) => {
  const key = typeof c.body.key === 'string' ? c.body.key : '';
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) throw bad('Geçersiz yazı anahtarı.');
  const value = str(c.body.value, 1000, 'Yazı');
  if (!db.settings.texts || typeof db.settings.texts !== 'object') db.settings.texts = {};
  if (value) db.settings.texts[key] = value; else delete db.settings.texts[key];
  save();
  return db.settings;
});

route('PUT', '/api/announcements/:id', { perm: 'announcements' }, (c) => {
  const a = db.announcements.find((x) => x.id === c.params.id);
  if (!a) throw new HttpError(404, 'Duyuru bulunamadı.');
  a.title = str(c.body.title, 100, 'Başlık', { required: true });
  a.text = str(c.body.text, 1000, 'Metin', { required: true });
  save();
  return a;
});

route('PUT', '/api/settings', { perm: 'settings' }, (c) => {
  const b = c.body;
  const s = db.settings;
  s.name = str(b.name, 40, 'Sunucu adı', { required: true });
  s.tagline = str(b.tagline, 140, 'Slogan');
  s.ip = str(b.ip, 80, 'IP adresi');
  s.version = str(b.version, 30, 'Sürüm');
  s.discord = str(b.discord, 200, 'Discord linki');
  if (s.discord && !/^https?:\/\//i.test(s.discord)) throw bad('Discord linki http:// veya https:// ile başlamalı.');
  s.about = str(b.about, 800, 'Hakkında');
  s.rules = str(b.rules, 3000, 'Kurallar');
  s.paymentNote = str(b.paymentNote, 600, 'Ödeme notu');
  s.iban = cleanIban(b.iban);
  s.ibanName = str(b.ibanName, 80, 'Alıcı adı');
  save();
  return s;
});

/* ------------------------------ HTTP sunucusu ------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', ...headers,
  });
  res.end(body);
}
const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (ch) => {
      size += ch.length;
      if (size > 200 * 1024) { reject(new HttpError(413, 'İstek çok büyük.')); req.destroy(); return; }
      chunks.push(ch);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      if (String(req.headers['content-type'] || '').includes('application/x-www-form-urlencoded')) {
        return resolve(Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
      }
      try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' ? v : {}); }
      catch { reject(bad('Geçersiz JSON.')); }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  try {
    const route_ = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!route_) throw new HttpError(404, 'Bulunamadı.');
    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (origin) { let h; try { h = new URL(origin).host; } catch { h = ''; } if (h !== req.headers.host) throw new HttpError(403, 'Geçersiz istek kaynağı.'); }
    }
    const user = sessionUser(req);
    const o = route_.opts;
    if ((o.auth || o.perm || o.staff) && !user) throw new HttpError(401, 'Giriş yapmalısın.');
    if (o.perm && !can(user, o.perm)) throw new HttpError(403, 'Bu işlem için yetkin yok.');
    if (o.staff && !isStaff(user)) throw new HttpError(403, 'Bu işlem için yetkin yok.');
    const m = url.pathname.match(route_.re);
    const params = {};
    route_.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
    const out = await route_.handler({ req, res, user, params, body, query: url.searchParams });
    if (typeof out === 'string') return send(res, 200, out, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    sendJson(res, 200, out);
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
    console.error(e);
    sendJson(res, 500, { error: 'Sunucu hatası.' });
  }
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'Bad Request'); }
  if (p === '/') p = '/index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Sayfa bulunamadı', { 'Content-Type': 'text/plain; charset=utf-8' });
    send(res, 200, req.method === 'HEAD' ? '' : data, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache',
    });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return void handleApi(req, res, url);
  serveStatic(req, res, url);
});
server.listen(PORT, HOST, () => {
  console.log(`RASP SMP sitesi çalışıyor: http://localhost:${PORT}`);
  if (db.users.length === 0) console.log('İlk kayıt olan hesap otomatik olarak SAHİP (tüm yetkiler) olur.');
});
