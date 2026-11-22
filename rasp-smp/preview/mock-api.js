'use strict';
/* ÖNİZLEME MODU: Gerçek sunucu yerine API'yi tarayıcıda taklit eder.
   Veriler yalnızca bu tarayıcıda tutulur. Gerçek site için server.js kullanılır. */
(function () {
  const PERMS = {
    users: 'Kullanıcıları ve yetkileri yönet', products: 'Mağaza ürünlerini yönet', orders: 'Siparişleri yönet',
    tickets: 'Destek taleplerine bak ve yanıtla', forms: 'Başvuru formu oluştur / düzenle', applications: 'Başvuruları değerlendir',
    announcements: 'Duyuru yönet', settings: 'Site ayarlarını değiştir',
  };
  const KEY = 'rasp-preview-db';
  const uid = () => Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
  const now = () => new Date().toISOString();
  const defaults = () => ({
    session: null, users: [],
    products: [
      { id: uid(), name: 'VIP Rütbe', category: 'Rütbeler', price: 99, description: 'Özel prefix, /fly ve ek home hakkı.', active: true },
      { id: uid(), name: 'MVP Rütbe', category: 'Rütbeler', price: 199, description: 'VIP avantajları + özel kit ve ek claim bloğu.', active: true },
      { id: uid(), name: '5000 Oyun Parası', category: 'Para', price: 49, description: 'Sunucu içi ekonomi için 5000 para.', active: true },
    ],
    orders: [], tickets: [], applications: [],
    forms: [{
      id: uid(), title: 'Yetkili Başvurusu', open: true, createdBy: 'sistem', createdAt: now(),
      description: 'Ekibimize katılmak istiyorsan formu eksiksiz doldur.',
      questions: [{ text: 'Yaşın kaç?', type: 'short' }, { text: 'Daha önce hangi sunucularda yetkili oldun?', type: 'long' }, { text: 'Neden seni seçmeliyiz?', type: 'long' }],
    }],
    announcements: [{ id: uid(), title: 'RASP SMP açıldı!', text: 'Sunucumuza hoş geldin. Kayıt ol, mağazaya göz at ve ekibimize başvur.', createdAt: now() }],
    settings: {
      name: 'RASP SMP', tagline: 'Arkadaşlarınla birlikte yaşa, inşa et, hayatta kal.', ip: 'play.raspsmp.com', version: '1.21+', discord: '',
      about: 'RASP SMP; adil kurallar, aktif yetkili ekibi ve topluluk odaklı bir survival sunucusudur.',
      rules: 'Hile ve bug kullanımı yasaktır.\nDiğer oyunculara küfür ve hakaret yasaktır.\nGrief ve çalmak yasaktır.\nYetkililerin kararlarına saygı göster.',
      paymentNote: 'Sipariş verdikten sonra kartla veya havale/EFT ile ödeyebilirsin. Ödeme onaylanınca ürün hesabına tanımlanır.',
      iban: 'TR19 0001 0090 1078 2727 1050 01', ibanName: '',
    },
  });
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db || !db.users) db = defaults();
  db.settings = { ...defaults().settings, ...db.settings };
  if (!db.settings.texts) db.settings.texts = {};
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* bellekte kalır */ } };

  class E extends Error { constructor(s, m) { super(m); this.status = s; } }
  const bad = (m) => new E(400, m);
  const str = (v, max, name = 'Alan', o = {}) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (o.required && !s) throw bad(`${name} boş bırakılamaz.`);
    if (s.length > max) throw bad(`${name} en fazla ${max} karakter olabilir.`);
    return s;
  };
  const can = (u, p) => !!u && (u.role === 'owner' || u.permissions.includes(p));
  const isStaff = (u) => !!u && (u.role === 'owner' || u.permissions.length > 0);
  const pub = (u) => ({ id: u.id, username: u.username, mcname: u.mcname, role: u.role, title: u.title || '', permissions: u.role === 'owner' ? Object.keys(PERMS) : u.permissions, banned: !!u.banned, createdAt: u.createdAt });
  const canManage = (a, t) => t.role !== 'owner' && t.id !== a.id && (a.role === 'owner' || t.permissions.every((p) => a.permissions.includes(p)));
  const cleanIban = (v) => {
    const x = (typeof v === 'string' ? v : '').replace(/\s+/g, '').toUpperCase();
    if (!x) return '';
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(x)) throw bad('IBAN biçimi geçersiz.');
    const d = (x.slice(4) + x.slice(0, 4)).replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55);
    let m = 0; for (const ch of d) m = (m * 10 + Number(ch)) % 97;
    if (m !== 1) throw bad('IBAN doğrulanamadı, tekrar kontrol et.');
    return x.replace(/(.{4})/g, '$1 ').trim();
  };
  const enc = (p) => 'x' + btoa(unescape(encodeURIComponent(p)));

  const R = [];
  const route = (m, p, o, h) => { const k = []; const re = new RegExp('^' + p.replace(/:(\w+)/g, (_, n) => { k.push(n); return '([^/]+)'; }) + '$'); R.push({ m, re, k, o, h }); };

  route('GET', '/api/public', {}, () => ({ settings: { ...db.settings, cardEnabled: true }, announcements: [...db.announcements].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5), openForms: db.forms.filter((f) => f.open).length }));
  route('GET', '/api/me', {}, (c) => ({ user: c.user ? pub(c.user) : null, allPermissions: PERMS }));
  route('POST', '/api/register', {}, (c) => {
    const username = str(c.body.username, 20, 'Kullanıcı adı', { required: true });
    const mcname = str(c.body.mcname, 16, 'Minecraft adı', { required: true });
    const pw = c.body.password || '';
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw bad('Kullanıcı adı 3-20 karakter olmalı; harf, rakam ve _ kullanılabilir.');
    if (!/^[A-Za-z0-9_]{3,16}$/.test(mcname)) throw bad('Minecraft adı 3-16 karakter olmalı; harf, rakam ve _ kullanılabilir.');
    if (pw.length < 8) throw bad('Şifre en az 8 karakter olmalı.');
    if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw bad('Bu kullanıcı adı zaten alınmış.');
    const first = db.users.length === 0;
    const u = { id: uid(), username, mcname, pw: enc(pw), role: first ? 'owner' : 'member', permissions: [], title: first ? 'Kurucu' : '', banned: false, createdAt: now() };
    db.users.push(u); db.session = u.id; save();
    return { user: pub(u), firstUser: first };
  });
  route('POST', '/api/login', {}, (c) => {
    const u = db.users.find((x) => x.username.toLowerCase() === String(c.body.username || '').toLowerCase());
    if (!u || u.pw !== enc(c.body.password || '')) throw new E(401, 'Kullanıcı adı veya şifre hatalı.');
    if (u.banned) throw new E(403, 'Hesabın engellenmiş.');
    db.session = u.id; save(); return { user: pub(u) };
  });
  route('POST', '/api/logout', {}, () => { db.session = null; save(); return { ok: true }; });
  route('POST', '/api/me/password', { auth: true }, (c) => {
    if (enc(c.body.current || '') !== c.user.pw) throw bad('Mevcut şifre hatalı.');
    if ((c.body.next || '').length < 8) throw bad('Yeni şifre en az 8 karakter olmalı.');
    c.user.pw = enc(c.body.next); save(); return { ok: true };
  });

  route('GET', '/api/products', {}, (c) => db.products.filter((p) => (c.q.get('all') === '1' && can(c.user, 'products')) || p.active));
  const pf = (b) => {
    const price = Number(b.price);
    if (!Number.isFinite(price) || price < 0) throw bad('Fiyat geçersiz.');
    return { name: str(b.name, 60, 'Ürün adı', { required: true }), category: str(b.category, 30, 'Kategori') || 'Diğer', description: str(b.description, 400, 'Açıklama'), price, active: b.active !== false };
  };
  route('POST', '/api/products', { perm: 'products' }, (c) => { const p = { id: uid(), ...pf(c.body) }; db.products.push(p); save(); return p; });
  route('PUT', '/api/products/:id', { perm: 'products' }, (c) => { const p = db.products.find((x) => x.id === c.p.id); if (!p) throw new E(404, 'Ürün bulunamadı.'); Object.assign(p, pf(c.body)); save(); return p; });
  route('DELETE', '/api/products/:id', { perm: 'products' }, (c) => { db.products = db.products.filter((x) => x.id !== c.p.id); save(); return { ok: true }; });

  route('POST', '/api/orders', { auth: true }, (c) => {
    const p = db.products.find((x) => x.id === c.body.productId && x.active);
    if (!p) throw new E(404, 'Ürün bulunamadı.');
    const mcname = str(c.body.mcname || c.user.mcname, 16, 'Minecraft adı', { required: true });
    const oid = uid(); const o = { id: oid, code: 'RASP-' + oid.slice(0, 6).toUpperCase(), userId: c.user.id, username: c.user.username, mcname, productId: p.id, productName: p.name, price: p.price, status: 'pending', createdAt: now() };
    db.orders.push(o); save(); return o;
  });
  route('GET', '/api/orders', { auth: true }, (c) => db.orders.filter((o) => (c.q.get('all') === '1' && can(c.user, 'orders')) || o.userId === c.user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  route('POST', '/api/orders/:id/pay', { auth: true }, (c) => {
    const o = db.orders.find((x) => x.id === c.p.id && x.userId === c.user.id);
    if (!o) throw new E(404, 'Sipariş bulunamadı.');
    if (!/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(c.body.email || '')) throw bad('Geçerli bir e-posta yaz (Türkçe karakter olmadan).');
    if (String(c.body.phone || '').replace(/[^\d+]/g, '').length < 10) throw bad('Telefon numarası geçersiz.');
    return { demo: true };
  });
  route('POST', '/api/orders/:id/demo-pay', { auth: true }, (c) => {
    const o = db.orders.find((x) => x.id === c.p.id && x.userId === c.user.id);
    if (!o) throw new E(404, 'Sipariş bulunamadı.');
    if (o.status === 'pending') { o.status = 'paid'; o.paidAt = now(); o.paymentType = 'card'; o.testPayment = true; save(); }
    return { ok: true };
  });
  const paytrDemo = (req) => ({ configured: true, fromEnv: false, merchantId: 'DEMO', hasKey: true, hasSalt: true, testMode: true, lastError: null, callbackUrl: 'https://siteniz.com/api/paytr/callback' });
  route('GET', '/api/admin/paytr', { perm: 'settings' }, (c) => { if (c.user.role !== 'owner') throw new E(403, 'Bu ayarı sadece sahip değiştirebilir.'); return paytrDemo(); });
  route('PUT', '/api/admin/paytr', { perm: 'settings' }, (c) => { if (c.user.role !== 'owner') throw new E(403, 'Bu ayarı sadece sahip değiştirebilir.'); return paytrDemo(); });
  route('POST', '/api/orders/:id/status', { perm: 'orders' }, (c) => { const o = db.orders.find((x) => x.id === c.p.id); if (!o) throw new E(404, 'Sipariş bulunamadı.'); o.status = c.body.status; save(); return o; });

  const tv = (t) => ({ ...t, messages: undefined, messageCount: t.messages.length });
  const gt = (c) => { const t = db.tickets.find((x) => x.id === c.p.id); if (!t || (t.userId !== c.user.id && !can(c.user, 'tickets'))) throw new E(404, 'Talep bulunamadı.'); return t; };
  route('GET', '/api/tickets', { auth: true }, (c) => db.tickets.filter((t) => (c.q.get('all') === '1' && can(c.user, 'tickets')) || t.userId === c.user.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(tv));
  route('POST', '/api/tickets', { auth: true }, (c) => {
    const t = { id: uid(), userId: c.user.id, username: c.user.username, mcname: c.user.mcname, subject: str(c.body.subject, 100, 'Konu', { required: true }), category: c.body.category || 'Genel', status: 'open', createdAt: now(), updatedAt: now(), messages: [{ userId: c.user.id, username: c.user.username, staff: false, text: str(c.body.message, 3000, 'Mesaj', { required: true }), at: now() }] };
    db.tickets.push(t); save(); return { id: t.id };
  });
  route('GET', '/api/tickets/:id', { auth: true }, (c) => gt(c));
  route('POST', '/api/tickets/:id/reply', { auth: true }, (c) => {
    const t = gt(c); if (t.status === 'closed') throw bad('Bu talep kapatılmış.');
    const staff = can(c.user, 'tickets') && t.userId !== c.user.id;
    t.messages.push({ userId: c.user.id, username: c.user.username, staff, text: str(c.body.message, 3000, 'Mesaj', { required: true }), at: now() });
    t.status = staff ? 'answered' : 'open'; t.updatedAt = now(); save(); return t;
  });
  route('POST', '/api/tickets/:id/close', { auth: true }, (c) => { const t = gt(c); t.status = 'closed'; t.updatedAt = now(); save(); return t; });

  const ff = (b) => {
    if (!Array.isArray(b.questions) || !b.questions.length) throw bad('En az bir soru eklemelisin.');
    return { title: str(b.title, 80, 'Başlık', { required: true }), description: str(b.description, 600, 'Açıklama'), open: b.open !== false, questions: b.questions.map((q) => ({ text: str(q && q.text, 200, 'Soru', { required: true }), type: q.type === 'long' ? 'long' : 'short' })) };
  };
  route('GET', '/api/forms', {}, (c) => db.forms.filter((f) => (c.q.get('all') === '1' && can(c.user, 'forms')) || f.open));
  route('POST', '/api/forms', { perm: 'forms' }, (c) => { const f = { id: uid(), ...ff(c.body), createdBy: c.user.username, createdAt: now() }; db.forms.push(f); save(); return f; });
  route('PUT', '/api/forms/:id', { perm: 'forms' }, (c) => { const f = db.forms.find((x) => x.id === c.p.id); if (!f) throw new E(404, 'Form bulunamadı.'); Object.assign(f, ff(c.body)); save(); return f; });
  route('DELETE', '/api/forms/:id', { perm: 'forms' }, (c) => { db.forms = db.forms.filter((x) => x.id !== c.p.id); save(); return { ok: true }; });

  route('POST', '/api/applications', { auth: true }, (c) => {
    const f = db.forms.find((x) => x.id === c.body.formId && x.open);
    if (!f) throw new E(404, 'Bu başvuru şu an açık değil.');
    if (db.applications.some((a) => a.userId === c.user.id && a.formId === f.id && a.status === 'pending')) throw bad('Bu form için zaten bekleyen bir başvurun var.');
    const ans = c.body.answers || [];
    const a = { id: uid(), formId: f.id, formTitle: f.title, userId: c.user.id, username: c.user.username, mcname: c.user.mcname, answers: f.questions.map((q, i) => ({ q: q.text, a: str(ans[i], 2000, 'Cevap', { required: true }) })), status: 'pending', note: '', createdAt: now() };
    db.applications.push(a); save(); return a;
  });
  route('GET', '/api/applications', { auth: true }, (c) => db.applications.filter((a) => (c.q.get('all') === '1' && can(c.user, 'applications')) || a.userId === c.user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  route('POST', '/api/applications/:id/review', { perm: 'applications' }, (c) => {
    const a = db.applications.find((x) => x.id === c.p.id); if (!a) throw new E(404, 'Başvuru bulunamadı.');
    a.status = c.body.status; a.note = str(c.body.note, 500, 'Not'); a.reviewedBy = c.user.username; a.reviewedAt = now(); save(); return a;
  });

  route('GET', '/api/admin/stats', { staff: true }, () => ({
    users: db.users.length, staff: db.users.filter(isStaff).length, openTickets: db.tickets.filter((t) => t.status !== 'closed').length,
    pendingApps: db.applications.filter((a) => a.status === 'pending').length, pendingOrders: db.orders.filter((o) => o.status === 'pending' || o.status === 'paid').length,
    revenue: db.orders.filter((o) => o.status === 'delivered').reduce((s, o) => s + o.price, 0),
  }));
  route('GET', '/api/admin/users', { perm: 'users' }, (c) => db.users.map((u) => ({ ...pub(u), manageable: canManage(c.user, u) })));
  route('POST', '/api/admin/users/:id/access', { perm: 'users' }, (c) => {
    const t = db.users.find((u) => u.id === c.p.id); if (!t) throw new E(404, 'Kullanıcı bulunamadı.');
    if (!canManage(c.user, t)) throw new E(403, 'Bu kullanıcının yetkilerini değiştiremezsin.');
    const perms = [...new Set((c.body.permissions || []).filter((p) => PERMS[p]))];
    if (c.user.role !== 'owner') {
      const mine = new Set(c.user.permissions);
      const ch = [...perms.filter((p) => !t.permissions.includes(p)), ...t.permissions.filter((p) => !perms.includes(p))];
      if (ch.some((p) => !mine.has(p))) throw new E(403, 'Sahip olmadığın bir yetkiyi veremez veya alamazsın.');
    }
    t.permissions = perms; t.title = str(c.body.title, 24, 'Rütbe'); save(); return pub(t);
  });
  route('POST', '/api/admin/users/:id/ban', { perm: 'users' }, (c) => {
    const t = db.users.find((u) => u.id === c.p.id); if (!t) throw new E(404, 'Kullanıcı bulunamadı.');
    if (!canManage(c.user, t)) throw new E(403, 'Bu kullanıcıyı engelleyemezsin.');
    t.banned = !!c.body.banned; if (t.banned && db.session === t.id) db.session = null; save(); return pub(t);
  });
  route('POST', '/api/admin/users/:id/password', { perm: 'users' }, (c) => {
    const t = db.users.find((u) => u.id === c.p.id); if (!t) throw new E(404, 'Kullanıcı bulunamadı.');
    if (!canManage(c.user, t)) throw new E(403, 'Bu kullanıcının şifresini değiştiremezsin.');
    if ((c.body.password || '').length < 8) throw bad('Şifre en az 8 karakter olmalı.');
    t.pw = enc(c.body.password); save(); return { ok: true };
  });
  route('POST', '/api/announcements', { perm: 'announcements' }, (c) => { const a = { id: uid(), title: str(c.body.title, 100, 'Başlık', { required: true }), text: str(c.body.text, 1000, 'Metin', { required: true }), createdAt: now() }; db.announcements.push(a); save(); return a; });
  route('DELETE', '/api/announcements/:id', { perm: 'announcements' }, (c) => { db.announcements = db.announcements.filter((x) => x.id !== c.p.id); save(); return { ok: true }; });
  route('PUT', '/api/texts', { perm: 'settings' }, (c) => {
    const key = typeof c.body.key === 'string' ? c.body.key : '';
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) throw bad('Geçersiz yazı anahtarı.');
    const value = str(c.body.value, 1000, 'Yazı');
    db.settings = { ...defaults().settings, ...db.settings };
  if (!db.settings.texts) db.settings.texts = {};
    if (value) db.settings.texts[key] = value; else delete db.settings.texts[key];
    save(); return db.settings;
  });
  route('PUT', '/api/announcements/:id', { perm: 'announcements' }, (c) => {
    const a = db.announcements.find((x) => x.id === c.p.id); if (!a) throw new E(404, 'Duyuru bulunamadı.');
    a.title = str(c.body.title, 100, 'Başlık', { required: true }); a.text = str(c.body.text, 1000, 'Metin', { required: true }); save(); return a;
  });
  route('PUT', '/api/settings', { perm: 'settings' }, (c) => {
    const b = c.body, s = db.settings;
    s.name = str(b.name, 40, 'Sunucu adı', { required: true }); s.tagline = str(b.tagline, 140); s.ip = str(b.ip, 80); s.version = str(b.version, 30);
    s.discord = str(b.discord, 200); if (s.discord && !/^https?:\/\//i.test(s.discord)) throw bad('Discord linki http:// veya https:// ile başlamalı.');
    s.about = str(b.about, 800); s.rules = str(b.rules, 3000); s.paymentNote = str(b.paymentNote, 600); s.iban = cleanIban(b.iban); s.ibanName = str(b.ibanName, 80, 'Alıcı adı'); save(); return s;
  });

  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opts = {}) => {
    if (typeof url !== 'string' || !url.startsWith('/api/')) return realFetch(url, opts);
    const u = new URL(url, 'http://x');
    const method = (opts.method || 'GET').toUpperCase();
    const r = R.find((x) => x.m === method && x.re.test(u.pathname));
    const reply = (s, o) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
    try {
      if (!r) throw new E(404, 'Bulunamadı.');
      const user = db.users.find((x) => x.id === db.session && !x.banned) || null;
      if ((r.o.auth || r.o.perm || r.o.staff) && !user) throw new E(401, 'Giriş yapmalısın.');
      if (r.o.perm && !can(user, r.o.perm)) throw new E(403, 'Bu işlem için yetkin yok.');
      if (r.o.staff && !isStaff(user)) throw new E(403, 'Bu işlem için yetkin yok.');
      const m = u.pathname.match(r.re); const p = {}; r.k.forEach((k, i) => { p[k] = m[i + 1]; });
      const body = opts.body ? JSON.parse(opts.body) : {};
      return reply(200, await r.h({ user, p, body, q: u.searchParams }));
    } catch (e) {
      if (e instanceof E) return reply(e.status, { error: e.message });
      console.error(e); return reply(500, { error: 'Sunucu hatası.' });
    }
  };

  /* Önizleme çerçevesi confirm()/prompt() göstermez; panel işlemleri için yerine koyuyoruz. */
  window.confirm = () => true;
  window.prompt = () => 'yenisifre123';
})();
