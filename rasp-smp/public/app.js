'use strict';
/* RASP SMP - ön yüz (tek sayfa uygulaması, hash yönlendirme) */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (s) => new Date(s).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
const money = (n) => Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ₺';

const state = { user: null, perms: {}, pub: { settings: {}, announcements: [] } };
const hasPerm = (p) => !!state.user && state.user.permissions.includes(p);
const isStaff = () => !!state.user && state.user.permissions.length > 0;

async function api(url, method = 'GET', body) {
  const r = await fetch('/api' + url, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let d = {};
  try { d = await r.json(); } catch { /* boş */ }
  if (!r.ok) throw new Error(d.error || 'Bir hata oluştu.');
  return d;
}

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200);
}
const guard = async (fn) => { try { await fn(); } catch (e) { toast(e.message, true); } };

const STATUS = {
  pending: ['Beklemede', 'yellow'], delivered: ['Teslim edildi', 'green'], cancelled: ['İptal', 'red'],
  accepted: ['Kabul edildi', 'green'], rejected: ['Reddedildi', 'red'],
  open: ['Açık', 'yellow'], answered: ['Yanıtlandı', 'blue'], closed: ['Kapalı', 'red'],
};
const badge = (s) => `<span class="badge ${STATUS[s][1]}">${STATUS[s][0]}</span>`;

/* Sahip, sitedeki yazıları basılı tutarak "Ayarla" ile değiştirebilir.
   t:<anahtar> = serbest yazı, s:<alan> = site ayarı, p:<id> = ürün, a:<id> = duyuru */
const tx = (k, d) => { const v = state.pub.settings.texts && state.pub.settings.texts[k]; return esc(v !== undefined ? v : d); };
const ed = (k, d, tag = 'span', cls = '') => `<${tag} data-edit="t:${k}" data-def="${esc(d)}"${cls ? ` class="${cls}"` : ''}>${tx(k, d)}</${tag}>`;
const oc = (o) => o.code || 'RASP-' + String(o.id).slice(0, 6).toUpperCase();
const ibanRaw = (v) => String(v || '').replace(/\s+/g, '');
function payRows(S, o) {
  const row = (label, val, copy, edit) => `<div class="payrow"><div><div class="muted small">${label}</div><div class="payval"${edit ? ` data-edit="${edit}"` : ''}>${val}</div></div>${copy ? `<button type="button" class="btn sm ghost" data-act="copy" data-v="${esc(copy)}">Kopyala</button>` : ''}</div>`;
  let h = row('IBAN', esc(S.iban), ibanRaw(S.iban), 's:iban');
  if (S.ibanName) h += row('Alıcı', esc(S.ibanName), S.ibanName, 's:ibanName');
  else if (!o && hasPerm('settings')) h += row('Alıcı', '<span class="muted">Alıcı adı girilmemiş. Basılı tutup ekle.</span>', '', 's:ibanName');
  if (o) h += row('Tutar', money(o.price), String(o.price)) + row('Açıklama (zorunlu)', esc(oc(o)), oc(o));
  return h;
}
function showPayment(o) {
  const S = state.pub.settings;
  closeModal();
  const m = document.createElement('div');
  m.id = 'modal'; m.className = 'modal-back';
  m.innerHTML = `<div class="modal card" role="dialog" aria-modal="true" aria-label="Ödeme bilgileri"><h3>Sipariş alındı</h3>
    <p class="muted">${esc(o.productName)} · ${money(o.price)} · ${esc(o.mcname)}</p>
    ${S.iban ? `<p>Ödemeyi havale / EFT ile yap. <b>Açıklama kısmına sipariş kodunu yazmayı unutma</b>, yoksa ödemeni eşleştiremeyiz.</p>${payRows(S, o)}
    <p class="muted small">Ödeme kontrol edilince ürün hesabına tanımlanır. Siparişini Mağaza sayfasındaki "Siparişlerim" bölümünden takip edebilirsin.</p>`
    : `<p>${esc(S.paymentNote)}</p>`}
    <div class="row"><button type="button" class="btn" data-m="cancel">Tamam</button></div></div>`;
  document.body.appendChild(m);
  m.addEventListener('mousedown', (e) => { if (e.target === m) closeModal(); });
  m.addEventListener('click', (e) => { if (e.target.closest('[data-m="cancel"]')) closeModal(); });
}
const es = (f, tag = 'span', cls = '') => `<${tag} data-edit="s:${f}"${cls ? ` class="${cls}"` : ''}>${esc(state.pub.settings[f])}</${tag}>`;

/* ------------------------------- Gezinme ------------------------------- */
function renderNav(route) {
  const s = state.pub.settings;
  $('#logoText').textContent = s.name || 'RASP SMP';
  $('#footName').textContent = s.name || 'RASP SMP';
  document.title = s.name || 'RASP SMP';
  document.body.classList.toggle('owner', state.user?.role === 'owner');
  const link = (href, label) => `<a href="#/${href}" class="${route === href.split('/')[0] ? 'on' : ''}">${label}</a>`;
  let h = link('', ed('nav_home', 'Ana Sayfa')) + link('store', ed('nav_store', 'Mağaza')) + link('support', ed('nav_support', 'Destek')) + link('apply', ed('nav_apply', 'Başvuru'));
  if (isStaff()) h += link('admin', 'Yönetim Paneli');
  h += '<span class="sep"></span>';
  if (state.user) h += `<a href="#/account" class="${route === 'account' ? 'on' : ''}">${esc(state.user.username)}</a><button data-act="logout">Çıkış</button>`;
  else h += link('login', 'Giriş') + `<a href="#/register" class="btn sm">Kayıt Ol</a>`;
  $('#nav').innerHTML = h;
  $('#nav').classList.remove('open');
}

async function render(keepScroll = false) {
  const keepY = keepScroll === true ? window.scrollY : 0;
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const page = parts[0] || '';
  renderNav(page);
  const app = $('#app');
  const views = { '': home, store, support, apply, login, register, account, admin };
  const view = views[page];
  if (!keepScroll) window.scrollTo(0, 0);
  if (!view) { app.innerHTML = '<div class="empty"><h2>Sayfa bulunamadı</h2><a href="#/">Ana sayfaya dön</a></div>'; return; }
  try { if (!keepScroll) app.innerHTML = '<div class="empty">Yükleniyor…</div>'; await view(app, parts.slice(1)); }
  catch (e) { app.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
  if (keepScroll) window.scrollTo(0, keepY);
}
window.addEventListener('hashchange', () => render());

function needLogin(app, msg = 'Bu sayfayı görmek için giriş yapmalısın.') {
  app.innerHTML = `<div class="card empty"><h2>Giriş gerekli</h2><p>${esc(msg)}</p>
    <a class="btn" href="#/login">Giriş Yap</a> <a class="btn ghost" href="#/register">Kayıt Ol</a></div>`;
}

/* ------------------------------- Ana sayfa ------------------------------- */
async function home(app) {
  const { settings: s, announcements: ann } = state.pub;
  const rules = String(s.rules || '').split('\n').filter(Boolean);
  app.innerHTML = `
  <section class="hero">
    ${es('name', 'h1')}
    ${es('tagline', 'p', 'lead')}
    <div class="ipbox"><span>IP</span>${es('ip', 'b')}<button class="btn sm" data-act="copyip">Kopyala</button></div>
    <div><span class="status"><span class="dot" id="dot"></span><span id="statusText">Sunucu durumu kontrol ediliyor…</span></span></div>
    <div class="row" style="justify-content:center;margin-top:24px">
      <a class="btn" href="#/store">${ed('btn_store', 'Mağazaya Git')}</a>
      ${s.discord ? `<a class="btn ghost" href="${esc(s.discord)}" target="_blank" rel="noopener noreferrer">${ed('btn_discord', "Discord'a Katıl")}</a>` : ''}
    </div>
  </section>
  <section class="grid g3">
    <div class="card feature"><div class="ico">⛏</div>${ed('f1_title', 'Survival', 'h3')}<p class="muted" data-edit="t:f1_text" data-def="Arkadaşlarınla birlikte inşa et, keşfet, hayatta kal.">${tx('f1_text', 'Arkadaşlarınla birlikte inşa et, keşfet, hayatta kal.')}</p></div>
    <div class="card feature"><div class="ico">🛒</div>${ed('f2_title', 'Mağaza', 'h3')}<p class="muted" data-edit="t:f2_text" data-def="Rütbeler ve ürünler. Siparişlerini hesabından takip et.">${tx('f2_text', 'Rütbeler ve ürünler. Siparişlerini hesabından takip et.')}</p></div>
    <div class="card feature"><div class="ico">🎧</div>${ed('f3_title', 'Destek', 'h3')}<p class="muted" data-edit="t:f3_text" data-def="Sorunun mu var? Destek talebi aç, yetkililer yanıtlasın.">${tx('f3_text', 'Sorunun mu var? Destek talebi aç, yetkililer yanıtlasın.')}</p></div>
  </section>
  <section class="section">${ed('h_ann', 'Duyurular', 'h2')}
    ${hasPerm('announcements') ? '<p><button class="btn sm" data-act="addAnn">＋ Duyuru Ekle</button></p>' : ''}
    ${ann.length ? ann.map((a) => `<div class="card" data-edit="a:${esc(a.id)}" style="margin-bottom:12px"><div class="row between"><h3 style="margin:0">${esc(a.title)}</h3><span class="muted small">${fmtDate(a.createdAt)}</span></div><p class="pre muted" style="margin:8px 0 0">${esc(a.text)}</p></div>`).join('') : '<div class="empty">Henüz duyuru yok.</div>'}
  </section>
  <section class="section grid g2">
    <div>${ed('h_about', 'Hakkımızda', 'h2')}<div class="card" data-edit="s:about"><p class="pre" style="margin:0">${esc(s.about)}</p></div></div>
    <div>${ed('h_rules', 'Kurallar', 'h2')}<div class="card" data-edit="s:rules"><ol class="rules">${rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ol></div></div>
  </section>`;
  checkStatus(s.ip);
}

async function checkStatus(ip) {
  const dot = $('#dot'), txt = $('#statusText');
  if (!ip) { txt.textContent = ''; return; }
  try {
    const r = await fetch('https://api.mcsrvstat.us/3/' + encodeURIComponent(ip));
    const d = await r.json();
    if (!dot) return;
    if (d.online) { dot.className = 'dot on'; txt.textContent = `Çevrimiçi · ${d.players?.online ?? 0}/${d.players?.max ?? '?'} oyuncu`; }
    else { dot.className = 'dot off'; txt.textContent = 'Sunucu şu an kapalı'; }
  } catch { if (dot) { dot.className = 'dot'; txt.textContent = 'Sunucu durumu alınamadı'; } }
}

/* ------------------------------- Kayıt / giriş ------------------------------- */
function authForm(app, mode) {
  const reg = mode === 'register';
  app.innerHTML = `<div style="max-width:420px;margin:24px auto"><div class="card">
    <h2>${reg ? 'Kayıt Ol' : 'Giriş Yap'}</h2>
    <form data-form="${mode}" autocomplete="on">
      <div id="formMsg"></div>
      <div class="field"><label for="u">Kullanıcı adı</label><input id="u" name="username" required minlength="3" maxlength="20" autocomplete="username"></div>
      ${reg ? '<div class="field"><label for="m">Minecraft kullanıcı adın</label><input id="m" name="mcname" required minlength="3" maxlength="16" pattern="[A-Za-z0-9_]{3,16}"></div>' : ''}
      <div class="field"><label for="p">Şifre${reg ? ' (en az 8 karakter)' : ''}</label><input id="p" name="password" type="password" required minlength="${reg ? 8 : 1}" autocomplete="${reg ? 'new-password' : 'current-password'}"></div>
      <button class="btn" style="width:100%">${reg ? 'Hesap Oluştur' : 'Giriş Yap'}</button>
    </form>
    <p class="muted small" style="margin:16px 0 0">${reg ? 'Zaten hesabın var mı? <a href="#/login">Giriş yap</a>' : 'Hesabın yok mu? <a href="#/register">Kayıt ol</a>'}</p>
  </div></div>`;
}
const login = (app) => authForm(app, 'login');
const register = (app) => authForm(app, 'register');

async function account(app) {
  if (!state.user) return needLogin(app);
  const u = state.user;
  app.innerHTML = `<h1 style="font-size:2rem">Hesabım</h1>
  <div class="grid g2">
    <div class="card"><h3>Bilgiler</h3>
      <p class="muted" style="margin:0">Kullanıcı adı: <b style="color:var(--text)">${esc(u.username)}</b></p>
      <p class="muted" style="margin:0">Minecraft adı: <b style="color:var(--text)">${esc(u.mcname)}</b></p>
      <p class="muted" style="margin:0">Kayıt: ${fmtDate(u.createdAt)}</p>
      ${u.title ? `<p style="margin:8px 0 0"><span class="badge green">${esc(u.title)}</span></p>` : ''}
    </div>
    <div class="card"><h3>Şifre Değiştir</h3>
      <form data-form="password">
        <div class="field"><label>Mevcut şifre</label><input name="current" type="password" required autocomplete="current-password"></div>
        <div class="field"><label>Yeni şifre (en az 8 karakter)</label><input name="next" type="password" required minlength="8" autocomplete="new-password"></div>
        <button class="btn">Güncelle</button>
      </form>
    </div>
  </div>`;
}

/* ------------------------------- Mağaza ------------------------------- */
async function store(app, [cat]) {
  const products = await api(hasPerm('products') ? '/products?all=1' : '/products');
  const cats = [...new Set(products.map((p) => p.category))];
  const list = cat ? products.filter((p) => p.category === decodeURIComponent(cat)) : products;
  let mine = '';
  if (state.user) {
    const orders = await api('/orders');
    mine = `<section class="section">${ed('store_orders', 'Siparişlerim', 'h2')}${orders.length ? `<div class="tablewrap"><table>
      <tr><th>Ürün</th><th>Fiyat</th><th>Oyuncu</th><th>Kod</th><th>Tarih</th><th>Durum</th><th></th></tr>
      ${orders.map((o) => `<tr><td>${esc(o.productName)}</td><td>${money(o.price)}</td><td>${esc(o.mcname)}</td><td><code>${esc(oc(o))}</code></td><td>${fmtDate(o.createdAt)}</td><td>${badge(o.status)}</td><td>${o.status === 'pending' && state.pub.settings.iban ? `<button class="btn sm" data-act="payInfo" data-id="${esc(o.id)}">Ödeme bilgisi</button>` : ''}</td></tr>`).join('')}
      </table></div>` : '<div class="empty">Henüz siparişin yok.</div>'}</section>`;
  }
  app.innerHTML = `${ed('store_title', 'Mağaza', 'h1', 'h1s')}
  <div class="alert" data-edit="s:paymentNote">${esc(state.pub.settings.paymentNote)}</div>
  ${state.pub.settings.iban ? `<div class="card" style="margin-bottom:16px"><h3>Havale / EFT bilgileri</h3><div class="grid g2" style="gap:0 24px">${payRows(state.pub.settings, null)}</div><p class="muted small" style="margin:8px 0 0">Sipariş verdikten sonra tutarı ve açıklamaya yazacağın sipariş kodunu göstereceğiz.</p></div>` : ''}
  ${hasPerm('products') ? '<div class="row" style="margin-bottom:16px"><button class="btn" data-act="addProduct">＋ Ürün Ekle</button><span class="muted small">Gizli ürünleri sadece sen görürsün. Düzenlemek için karta basılı tut.</span></div>' : ''}
  <div class="tabs"><a class="tab ${cat ? '' : 'on'}" href="#/store">Tümü</a>
    ${cats.map((c) => `<a class="tab ${cat && decodeURIComponent(cat) === c ? 'on' : ''}" href="#/store/${encodeURIComponent(c)}">${esc(c)}</a>`).join('')}</div>
  ${list.length ? `<div class="grid g3">${list.map((p) => `
    <div class="card product" data-pid="${esc(p.id)}" data-edit="p:${esc(p.id)}">
      <div class="row between"><h3 style="margin:0">${esc(p.name)}</h3><span class="row" style="gap:6px">${p.active ? '' : '<span class="badge red">Gizli</span>'}<span class="badge">${esc(p.category)}</span></span></div>
      <p class="desc">${esc(p.description)}</p>
      <div class="price">${money(p.price)}</div>
      <button class="btn" data-act="buy">Satın Al</button>
      <form data-form="order"><input type="hidden" name="productId" value="${esc(p.id)}">
        <div class="field"><label>Ürünün teslim edileceği Minecraft adı</label><input name="mcname" value="${esc(state.user?.mcname || '')}" required pattern="[A-Za-z0-9_]{3,16}"></div>
        <button class="btn warn" style="width:100%">Siparişi Onayla</button></form>
    </div>`).join('')}</div>` : '<div class="empty">Bu kategoride ürün yok.</div>'}
  ${mine}`;
}

/* ------------------------------- Destek ------------------------------- */
async function support(app, [id]) {
  if (!state.user) return needLogin(app, 'Destek talebi oluşturmak için giriş yapmalısın.');
  if (id) return ticketView(app, id);
  const tickets = await api('/tickets');
  app.innerHTML = `${ed('support_title', 'Destek', 'h1', 'h1s')}
  <div class="grid g2" style="align-items:start">
    <div class="card"><h3>Yeni Talep</h3>
      <form data-form="ticket">
        <div class="field"><label>Kategori</label><select name="category">
          <option>Genel</option><option>Mağaza / Ödeme</option><option>Şikayet</option><option>Hata bildirimi</option><option>Ban itirazı</option></select></div>
        <div class="field"><label>Konu</label><input name="subject" required maxlength="100"></div>
        <div class="field"><label>Mesajın</label><textarea name="message" required maxlength="3000"></textarea></div>
        <button class="btn">Talebi Gönder</button>
      </form></div>
    <div><h3>Taleplerim</h3>${tickets.length ? tickets.map((t) => `
      <a href="#/support/${esc(t.id)}" class="card" style="display:block;text-decoration:none;color:inherit;margin-bottom:10px">
        <div class="row between"><b>${esc(t.subject)}</b>${badge(t.status)}</div>
        <div class="muted small">${esc(t.category)} · ${t.messageCount} mesaj · ${fmtDate(t.updatedAt)}</div></a>`).join('') : '<div class="card empty">Henüz talebin yok.</div>'}</div>
  </div>`;
}

async function ticketView(app, id) {
  const t = await api('/tickets/' + encodeURIComponent(id));
  app.innerHTML = `<p><a href="#/${isStaff() && t.userId !== state.user.id ? 'admin/tickets' : 'support'}">← Geri</a></p>
  <div class="row between"><h1 style="font-size:1.7rem;margin:0">${esc(t.subject)}</h1>${badge(t.status)}</div>
  <p class="muted">${esc(t.category)} · ${esc(t.username)} (${esc(t.mcname)}) · ${fmtDate(t.createdAt)}</p>
  <div class="msgs">${t.messages.map((m) => `<div class="msg ${m.staff ? 'staff' : ''}"><div class="who">${esc(m.username)}${m.staff ? ' · Yetkili' : ''} · ${fmtDate(m.at)}</div><div class="pre">${esc(m.text)}</div></div>`).join('')}</div>
  ${t.status === 'closed' ? '<div class="alert">Bu talep kapatıldı.</div>' : `
  <form data-form="reply" data-id="${esc(t.id)}"><div class="field"><textarea name="message" required maxlength="3000" placeholder="Yanıtını yaz…"></textarea></div>
    <div class="row"><button class="btn">Gönder</button><button type="button" class="btn danger" data-act="closeTicket" data-id="${esc(t.id)}">Talebi Kapat</button></div></form>`}`;
}

/* ------------------------------- Başvuru ------------------------------- */
async function apply(app, [id]) {
  const forms = await api('/forms');
  if (id) {
    const f = forms.find((x) => x.id === id);
    if (!f) { app.innerHTML = '<div class="empty">Bu başvuru bulunamadı veya kapalı.</div>'; return; }
    if (!state.user) return needLogin(app, 'Başvuru yapmak için giriş yapmalısın.');
    app.innerHTML = `<p><a href="#/apply">← Başvurular</a></p><div style="max-width:720px"><div class="card">
      <h2>${esc(f.title)}</h2><p class="muted pre">${esc(f.description)}</p>
      <form data-form="application" data-id="${esc(f.id)}">
        ${f.questions.map((q, i) => `<div class="field"><label>${i + 1}. ${esc(q.text)}</label>${q.type === 'long' ? `<textarea name="a${i}" required maxlength="2000"></textarea>` : `<input name="a${i}" required maxlength="300">`}</div>`).join('')}
        <button class="btn">Başvuruyu Gönder</button></form></div></div>`;
    return;
  }
  let mine = '';
  if (state.user) {
    const apps = await api('/applications');
    mine = `<section class="section"><h2>Başvurularım</h2>${apps.length ? apps.map((a) => `
      <div class="card" style="margin-bottom:12px"><div class="row between"><b>${esc(a.formTitle)}</b>${badge(a.status)}</div>
      <div class="muted small">${fmtDate(a.createdAt)}</div>
      ${a.note ? `<p class="pre" style="margin:10px 0 0"><b>Yetkili notu:</b> ${esc(a.note)}</p>` : ''}</div>`).join('') : '<div class="empty">Henüz başvurun yok.</div>'}</section>`;
  }
  app.innerHTML = `${ed('apply_title', 'Başvuru', 'h1', 'h1s')}
  ${forms.length ? `<div class="grid g2">${forms.map((f) => `<div class="card"><h3>${esc(f.title)}</h3><p class="muted pre">${esc(f.description)}</p>
    <a class="btn" href="#/apply/${esc(f.id)}">Başvur</a></div>`).join('')}</div>` : '<div class="card empty">Şu anda açık başvuru yok.</div>'}
  ${mine}`;
}

/* ------------------------------- Yönetim paneli ------------------------------- */
const TABS = [
  ['overview', 'Genel Bakış', () => true],
  ['users', 'Kullanıcılar & Yetki', () => hasPerm('users')],
  ['products', 'Mağaza', () => hasPerm('products')],
  ['orders', 'Siparişler', () => hasPerm('orders')],
  ['tickets', 'Destek Talepleri', () => hasPerm('tickets')],
  ['forms', 'Başvuru Formları', () => hasPerm('forms')],
  ['applications', 'Başvurular', () => hasPerm('applications')],
  ['announcements', 'Duyurular', () => hasPerm('announcements')],
  ['settings', 'Site Ayarları', () => hasPerm('settings')],
];

async function admin(app, [tab = 'overview']) {
  if (!state.user) return needLogin(app);
  if (!isStaff()) { app.innerHTML = '<div class="card empty"><h2>Yetkin yok</h2><p>Bu sayfa sadece yetkililere açık.</p></div>'; return; }
  const allowed = TABS.filter((t) => t[2]());
  if (!allowed.find((t) => t[0] === tab)) tab = 'overview';
  app.innerHTML = `<div class="panel"><aside class="side">${allowed.map((t) => `<a href="#/admin/${t[0]}" class="${t[0] === tab ? 'on' : ''}">${t[1]}</a>`).join('')}</aside><section id="tabBody"><div class="empty">Yükleniyor…</div></section></div>`;
  const body = $('#tabBody');
  await adminTabs[tab](body);
}

const adminTabs = {
  async overview(el) {
    const s = await api('/admin/stats');
    const tile = (n, l) => `<div class="card stat"><div class="n">${n}</div><div class="l">${l}</div></div>`;
    el.innerHTML = `<h2>Genel Bakış</h2><div class="grid g3">
      ${tile(s.users, 'Kayıtlı kullanıcı')}${tile(s.staff, 'Yetkili')}${tile(s.openTickets, 'Açık destek talebi')}
      ${tile(s.pendingApps, 'Bekleyen başvuru')}${tile(s.pendingOrders, 'Bekleyen sipariş')}${tile(money(s.revenue), 'Teslim edilen sipariş toplamı')}</div>
      ${state.user.role === 'owner' ? '<div class="alert" style="margin-top:20px"><b>Sahip modu:</b> sitedeki herhangi bir yazıya, ürün kartına veya duyuruya basılı tut (bilgisayarda sağ tık), <b>Ayarla</b> çıkar. Başlıklar, slogan, IP, kurallar, ödeme notu, ürünler ve duyurular böyle değişir.</div>' : ''}
      <p class="muted" style="margin-top:20px">Sol menüde sadece sahip olduğun yetkilere ait bölümler görünür. Yetkiyi <b>Kullanıcılar & Yetki</b> bölümünden verebilirsin.</p>`;
  },

  async users(el) {
    const users = await api('/admin/users');
    el.innerHTML = `<div class="row between"><h2>Kullanıcılar & Yetki</h2><input id="uSearch" placeholder="Kullanıcı ara…" style="max-width:240px"></div>
    <p class="muted small">Bir kullanıcıya yetki vermek için kutuları işaretleyip <b>Kaydet</b>'e bas. Kendi sahip olmadığın yetkiyi başkasına veremezsin. Sahip (Kurucu) hesabı değiştirilemez.</p>
    <div id="uList">${users.map((u) => `
      <div class="card" data-uid="${esc(u.id)}" data-name="${esc((u.username + ' ' + u.mcname).toLowerCase())}" style="margin-bottom:12px">
        <div class="row between"><div><b>${esc(u.username)}</b> <span class="muted small">(MC: ${esc(u.mcname)})</span>
          ${u.role === 'owner' ? '<span class="badge yellow">Sahip</span>' : ''}${u.title && u.role !== 'owner' ? `<span class="badge green">${esc(u.title)}</span>` : ''}${u.banned ? '<span class="badge red">Engelli</span>' : ''}</div>
          <span class="muted small">Kayıt: ${fmtDate(u.createdAt)}</span></div>
        ${u.manageable ? `
        <div class="perm-grid">${Object.entries(state.perms).map(([k, l]) => `<label class="check"><input type="checkbox" value="${k}" ${u.permissions.includes(k) ? 'checked' : ''} ${state.user.role !== 'owner' && !state.user.permissions.includes(k) ? 'disabled' : ''}> ${esc(l)}</label>`).join('')}</div>
        <div class="row"><input class="title" placeholder="Rütbe etiketi (örn. Moderatör)" maxlength="24" value="${esc(u.title)}" style="max-width:240px">
          <button class="btn sm" data-act="saveAccess">Kaydet</button>
          <button class="btn sm ghost" data-act="resetPw">Şifre Sıfırla</button>
          <button class="btn sm danger" data-act="ban" data-banned="${u.banned ? '0' : '1'}">${u.banned ? 'Engeli Kaldır' : 'Engelle'}</button></div>` : ''}
      </div>`).join('')}</div>`;
    $('#uSearch').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      $$('#uList [data-uid]').forEach((c) => { c.style.display = c.dataset.name.includes(q) ? '' : 'none'; });
    };
  },

  async products(el) {
    const ps = await api('/products?all=1');
    const row = (p) => `<div class="card" data-id="${esc(p?.id || '')}" style="margin-bottom:12px"><div class="grid g3">
      <div><label>Ürün adı</label><input class="f-name" value="${esc(p?.name)}" maxlength="60"></div>
      <div><label>Kategori</label><input class="f-category" value="${esc(p?.category)}" maxlength="30"></div>
      <div><label>Fiyat (₺)</label><input class="f-price" type="number" min="0" step="0.01" value="${esc(p?.price ?? '')}"></div></div>
      <div class="field" style="margin-top:12px"><label>Açıklama</label><input class="f-description" value="${esc(p?.description)}" maxlength="400"></div>
      <div class="row"><label class="check"><input class="f-active" type="checkbox" ${p?.active !== false ? 'checked' : ''}> Mağazada göster</label>
      <button class="btn sm" data-act="saveProduct">${p ? 'Kaydet' : 'Ürün Ekle'}</button>${p ? '<button class="btn sm danger" data-act="delProduct">Sil</button>' : ''}</div></div>`;
    el.innerHTML = `<h2>Mağaza Ürünleri</h2><h3>Yeni ürün</h3>${row(null)}<h3>Mevcut ürünler</h3>${ps.map(row).join('') || '<div class="empty">Ürün yok.</div>'}`;
  },

  async orders(el) {
    const os = await api('/orders?all=1');
    el.innerHTML = `<h2>Siparişler</h2>${os.length ? `<div class="tablewrap"><table>
      <tr><th>Tarih</th><th>Kod</th><th>Kullanıcı</th><th>MC adı</th><th>Ürün</th><th>Fiyat</th><th>Durum</th><th></th></tr>
      ${os.map((o) => `<tr data-id="${esc(o.id)}"><td>${fmtDate(o.createdAt)}</td><td><code>${esc(oc(o))}</code></td><td>${esc(o.username)}</td><td>${esc(o.mcname)}</td><td>${esc(o.productName)}</td><td>${money(o.price)}</td><td>${badge(o.status)}</td>
      <td><div class="row">${o.status !== 'delivered' ? '<button class="btn sm" data-act="orderStatus" data-s="delivered">Teslim Et</button>' : ''}${o.status !== 'cancelled' ? '<button class="btn sm danger" data-act="orderStatus" data-s="cancelled">İptal</button>' : ''}${o.status !== 'pending' ? '<button class="btn sm ghost" data-act="orderStatus" data-s="pending">Beklemeye Al</button>' : ''}</div></td></tr>`).join('')}
      </table></div>` : '<div class="empty">Sipariş yok.</div>'}`;
  },

  async tickets(el) {
    const ts = await api('/tickets?all=1');
    el.innerHTML = `<h2>Destek Talepleri</h2>${ts.length ? ts.map((t) => `
      <a href="#/support/${esc(t.id)}" class="card" style="display:block;text-decoration:none;color:inherit;margin-bottom:10px">
      <div class="row between"><b>${esc(t.subject)}</b>${badge(t.status)}</div>
      <div class="muted small">${esc(t.username)} (${esc(t.mcname)}) · ${esc(t.category)} · ${t.messageCount} mesaj · ${fmtDate(t.updatedAt)}</div></a>`).join('') : '<div class="empty">Talep yok.</div>'}`;
  },

  async forms(el) {
    const fs = await api('/forms?all=1');
    window.__forms = fs;
    const formCard = (f) => `<div class="card" data-id="${esc(f?.id || '')}" style="margin-bottom:12px">
      <div class="field"><label>Başlık</label><input class="f-title" value="${esc(f?.title)}" maxlength="80"></div>
      <div class="field"><label>Açıklama</label><textarea class="f-description" style="min-height:70px" maxlength="600">${esc(f?.description)}</textarea></div>
      <div class="field"><label>Sorular (her satıra bir soru; uzun cevap istiyorsan satırın başına <code>[uzun]</code> yaz)</label>
        <textarea class="f-questions" style="min-height:130px">${esc((f?.questions || []).map((q) => (q.type === 'long' ? '[uzun] ' : '') + q.text).join('\n'))}</textarea></div>
      <div class="row"><label class="check"><input class="f-open" type="checkbox" ${f?.open !== false ? 'checked' : ''}> Başvurulara açık</label>
        <button class="btn sm" data-act="saveForm">${f ? 'Kaydet' : 'Form Oluştur'}</button>${f ? '<button class="btn sm danger" data-act="delForm">Sil</button>' : ''}</div></div>`;
    el.innerHTML = `<h2>Başvuru Formları</h2><p class="muted small">Yetkili alımı, ekip başvurusu gibi istediğin başvuruyu buradan ekleyebilirsin. Form açık olduğu sürece oyuncular başvuru yapabilir.</p>
      <h3>Yeni başvuru formu</h3>${formCard(null)}<h3>Mevcut formlar</h3>${fs.map(formCard).join('') || '<div class="empty">Form yok.</div>'}`;
  },

  async applications(el) {
    const as = await api('/applications?all=1');
    el.innerHTML = `<h2>Başvurular</h2>${as.length ? as.map((a) => `
      <div class="card" data-id="${esc(a.id)}" style="margin-bottom:12px">
        <div class="row between"><div><b>${esc(a.formTitle)}</b> — ${esc(a.username)} <span class="muted small">(MC: ${esc(a.mcname)})</span></div>${badge(a.status)}</div>
        <div class="muted small">${fmtDate(a.createdAt)}${a.reviewedBy ? ` · Değerlendiren: ${esc(a.reviewedBy)}` : ''}</div>
        ${a.answers.map((x) => `<div class="qa"><div class="q">${esc(x.q)}</div><div class="pre">${esc(x.a)}</div></div>`).join('')}
        <div class="field"><label>Başvuru sahibine görünecek not</label><input class="f-note" value="${esc(a.note)}" maxlength="500"></div>
        <div class="row"><button class="btn sm" data-act="review" data-s="accepted">Kabul Et</button><button class="btn sm danger" data-act="review" data-s="rejected">Reddet</button>
        ${a.status !== 'pending' ? '<button class="btn sm ghost" data-act="review" data-s="pending">Beklemeye Al</button>' : ''}</div></div>`).join('') : '<div class="empty">Başvuru yok.</div>'}`;
  },

  async announcements(el) {
    const { announcements } = await api('/public');
    el.innerHTML = `<h2>Duyurular</h2><div class="card"><form data-form="announcement">
      <div class="field"><label>Başlık</label><input name="title" required maxlength="100"></div>
      <div class="field"><label>Metin</label><textarea name="text" required maxlength="1000"></textarea></div>
      <button class="btn">Duyuru Yayınla</button></form></div>
      <h3 style="margin-top:24px">Yayındakiler (son 5)</h3>${announcements.map((a) => `<div class="card row between" style="margin-bottom:10px" data-id="${esc(a.id)}"><div><b>${esc(a.title)}</b><div class="muted small">${fmtDate(a.createdAt)}</div></div><button class="btn sm danger" data-act="delAnn">Sil</button></div>`).join('') || '<div class="empty">Duyuru yok.</div>'}`;
  },

  async settings(el) {
    const s = state.pub.settings;
    const f = (n, l, v, extra = '') => `<div class="field"><label>${l}</label><input name="${n}" value="${esc(v)}" ${extra}></div>`;
    el.innerHTML = `<h2>Site Ayarları</h2><div class="card"><form data-form="settings">
      ${f('name', 'Sunucu adı', s.name, 'required maxlength="40"')}${f('tagline', 'Slogan', s.tagline, 'maxlength="140"')}
      <div class="grid g2">${f('ip', 'Sunucu IP adresi', s.ip, 'maxlength="80"')}${f('version', 'Sürüm', s.version, 'maxlength="30"')}</div>
      ${f('discord', 'Discord davet linki (https://…)', s.discord, 'maxlength="200"')}
      <div class="grid g2">${f('iban', 'Ödeme IBAN (boş bırakırsan gizlenir)', s.iban, 'maxlength="40"')}${f('ibanName', 'IBAN alıcı adı soyadı', s.ibanName, 'maxlength="80"')}</div>
      <div class="field"><label>Hakkımızda</label><textarea name="about" maxlength="800">${esc(s.about)}</textarea></div>
      <div class="field"><label>Kurallar (her satıra bir kural)</label><textarea name="rules" style="min-height:140px" maxlength="3000">${esc(s.rules)}</textarea></div>
      <div class="field"><label>Mağaza ödeme notu</label><textarea name="paymentNote" maxlength="600">${esc(s.paymentNote)}</textarea></div>
      <button class="btn">Kaydet</button></form></div>`;
  },
};

/* ------------------------------- Olaylar ------------------------------- */
const formData = (f) => Object.fromEntries(new FormData(f).entries());

const submits = {
  async login(f) {
    const d = await api('/login', 'POST', formData(f));
    state.user = d.user; toast('Hoş geldin, ' + d.user.username + '!'); location.hash = '#/';
  },
  async register(f) {
    const d = await api('/register', 'POST', formData(f));
    state.user = d.user;
    toast(d.firstUser ? 'İlk hesap olduğun için SAHİP yetkisi verildi!' : 'Hesabın oluşturuldu!');
    location.hash = d.firstUser ? '#/admin' : '#/';
  },
  async password(f) { await api('/me/password', 'POST', formData(f)); f.reset(); toast('Şifren güncellendi.'); },
  async order(f) {
    const o = await api('/orders', 'POST', formData(f));
    await render(true);
    showPayment(o);
  },
  async ticket(f) { const d = await api('/tickets', 'POST', formData(f)); location.hash = '#/support/' + d.id; },
  async reply(f) { await api(`/tickets/${f.dataset.id}/reply`, 'POST', formData(f)); render(); },
  async application(f) {
    const d = formData(f);
    const answers = Object.keys(d).filter((k) => /^a\d+$/.test(k)).sort((a, b) => a.slice(1) - b.slice(1)).map((k) => d[k]);
    await api('/applications', 'POST', { formId: f.dataset.id, answers });
    toast('Başvurun gönderildi!'); location.hash = '#/apply';
  },
  async announcement(f) { await api('/announcements', 'POST', formData(f)); toast('Duyuru yayınlandı.'); render(); },
  async settings(f) {
    const s = await api('/settings', 'PUT', formData(f));
    state.pub.settings = s; renderNav('admin'); toast('Ayarlar kaydedildi.');
  },
};
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const btn = $('button:not([type=button])', f);
  if (btn) btn.disabled = true;
  guard(() => submits[f.dataset.form](f)).finally(() => { if (btn) btn.disabled = false; });
});

const val = (root, sel) => $(sel, root).value;
const actions = {
  async logout() { await api('/logout', 'POST'); state.user = null; toast('Çıkış yapıldı.'); location.hash = '#/'; render(); },
  copy(b) {
    const v = b.dataset.v;
    const ok = () => toast('Kopyalandı: ' + (v.length > 34 ? v.slice(0, 34) + '…' : v));
    const fail = () => toast('Kopyalanamadı, elle seç.', true);
    if (navigator.clipboard) navigator.clipboard.writeText(v).then(ok, fail); else fail();
  },
  async payInfo(b) {
    const o = (await api('/orders')).find((x) => x.id === b.dataset.id);
    if (o) showPayment(o);
  },
  addProduct() { return openEditor('p:new'); },
  addAnn() { return openEditor('a:new'); },
  copyip() { navigator.clipboard?.writeText(state.pub.settings.ip).then(() => toast('IP kopyalandı!'), () => toast('Kopyalanamadı.', true)); },
  buy(b) {
    if (!state.user) { toast('Satın almak için giriş yapmalısın.', true); location.hash = '#/login'; return; }
    b.closest('.product').classList.add('buying'); b.style.display = 'none';
  },
  async closeTicket(b) { if (!confirm('Talep kapatılsın mı?')) return; await api(`/tickets/${b.dataset.id}/close`, 'POST'); render(); },

  async saveAccess(b) {
    const c = b.closest('[data-uid]');
    const permissions = $$('input[type=checkbox]:checked', c).map((x) => x.value);
    await api(`/admin/users/${c.dataset.uid}/access`, 'POST', { permissions, title: val(c, '.title') });
    toast('Yetkiler kaydedildi.'); adminTabs.users($('#tabBody'));
  },
  async ban(b) {
    const c = b.closest('[data-uid]'); const ban = b.dataset.banned === '1';
    if (ban && !confirm('Bu kullanıcı engellensin mi?')) return;
    await api(`/admin/users/${c.dataset.uid}/ban`, 'POST', { banned: ban });
    toast(ban ? 'Kullanıcı engellendi.' : 'Engel kaldırıldı.'); adminTabs.users($('#tabBody'));
  },
  async resetPw(b) {
    const c = b.closest('[data-uid]');
    const pw = prompt('Yeni şifre (en az 8 karakter):');
    if (!pw) return;
    await api(`/admin/users/${c.dataset.uid}/password`, 'POST', { password: pw });
    toast('Şifre değiştirildi. Kullanıcının oturumları kapatıldı.');
  },

  async saveProduct(b) {
    const c = b.closest('[data-id]'); const id = c.dataset.id;
    const body = { name: val(c, '.f-name'), category: val(c, '.f-category'), price: val(c, '.f-price'), description: val(c, '.f-description'), active: $('.f-active', c).checked };
    await api(id ? `/products/${id}` : '/products', id ? 'PUT' : 'POST', body);
    toast(id ? 'Ürün kaydedildi.' : 'Ürün eklendi.'); adminTabs.products($('#tabBody'));
  },
  async delProduct(b) {
    if (!confirm('Ürün silinsin mi?')) return;
    await api(`/products/${b.closest('[data-id]').dataset.id}`, 'DELETE'); adminTabs.products($('#tabBody'));
  },
  async orderStatus(b) {
    await api(`/orders/${b.closest('[data-id]').dataset.id}/status`, 'POST', { status: b.dataset.s }); adminTabs.orders($('#tabBody'));
  },

  async saveForm(b) {
    const c = b.closest('[data-id]'); const id = c.dataset.id;
    const questions = val(c, '.f-questions').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const long = /^\[uzun\]\s*/i.test(l);
      return { text: l.replace(/^\[uzun\]\s*/i, ''), type: long ? 'long' : 'short' };
    });
    await api(id ? `/forms/${id}` : '/forms', id ? 'PUT' : 'POST', { title: val(c, '.f-title'), description: val(c, '.f-description'), open: $('.f-open', c).checked, questions });
    toast(id ? 'Form kaydedildi.' : 'Başvuru formu oluşturuldu.'); adminTabs.forms($('#tabBody'));
  },
  async delForm(b) {
    if (!confirm('Form silinsin mi? (Gelen başvurular saklanır.)')) return;
    await api(`/forms/${b.closest('[data-id]').dataset.id}`, 'DELETE'); adminTabs.forms($('#tabBody'));
  },
  async review(b) {
    const c = b.closest('[data-id]');
    await api(`/applications/${c.dataset.id}/review`, 'POST', { status: b.dataset.s, note: val(c, '.f-note') });
    toast('Başvuru güncellendi.'); adminTabs.applications($('#tabBody'));
  },
  async delAnn(b) {
    await api(`/announcements/${b.closest('[data-id]').dataset.id}`, 'DELETE');
    state.pub = await api('/public'); adminTabs.announcements($('#tabBody'));
  },
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b && actions[b.dataset.act]) guard(() => actions[b.dataset.act](b));
});
$('#burger').addEventListener('click', () => $('#nav').classList.toggle('open'));

/* ------------------------- Sahip düzenleme modu -------------------------
   Sahip bir yazıya / karta basılı tutar (bilgisayarda sağ tık), "Ayarla" çıkar. */
const EDIT_FIELDS = {
  name: ['Sunucu adı', false], tagline: ['Slogan', false], ip: ['Sunucu IP adresi', false],
  iban: ['IBAN (TR ile başlar)', false], ibanName: ['Alıcı adı soyadı', false], about: ['Hakkımızda', true], rules: ['Kurallar (her satıra bir kural)', true], paymentNote: ['Mağaza ödeme notu', true],
};
const isOwner = () => state.user?.role === 'owner';
let pop = null, holdTimer = null, holdStart = null, suppressClick = false;

function closePop() { if (pop) { pop.remove(); pop = null; } }
function openAdjust(el, x, y) {
  closePop();
  pop = document.createElement('div');
  pop.className = 'adjust-pop';
  pop.innerHTML = '<button type="button">✎ Ayarla</button>';
  document.body.appendChild(pop);
  const w = pop.offsetWidth || 110;
  pop.style.left = Math.max(8, Math.min(x - w / 2, window.innerWidth - w - 8)) + 'px';
  pop.style.top = Math.max(8, y - 56) + 'px';
  $('button', pop).onclick = () => { closePop(); guard(() => openEditor(el.dataset.edit, el)); };
  setTimeout(() => {
    document.addEventListener('pointerdown', function off(e) {
      document.removeEventListener('pointerdown', off);
      if (pop && !pop.contains(e.target)) closePop();
    });
  }, 0);
}

document.addEventListener('pointerdown', (e) => {
  if (!isOwner() || e.button > 0 || e.target.closest('#modal, .adjust-pop')) return;
  const el = e.target.closest('[data-edit]');
  if (!el) return;
  holdStart = { x: e.clientX, y: e.clientY };
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => { holdTimer = null; suppressClick = true; openAdjust(el, holdStart.x, holdStart.y); }, 550);
});
['pointerup', 'pointercancel'].forEach((t) => document.addEventListener(t, () => {
  clearTimeout(holdTimer);
  if (suppressClick) setTimeout(() => { suppressClick = false; }, 120);
}));
document.addEventListener('pointermove', (e) => {
  if (holdTimer && holdStart && Math.hypot(e.clientX - holdStart.x, e.clientY - holdStart.y) > 10) clearTimeout(holdTimer);
});
document.addEventListener('scroll', () => clearTimeout(holdTimer), true);
document.addEventListener('click', (e) => { if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); } }, true);
document.addEventListener('contextmenu', (e) => {
  if (!isOwner()) return;
  const el = e.target.closest('[data-edit]');
  if (!el) return;
  e.preventDefault(); suppressClick = false;
  openAdjust(el, e.clientX, e.clientY);
});

function closeModal() { $('#modal')?.remove(); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closePop(); } });

async function openEditor(spec, el) {
  const type = spec.slice(0, 1), id = spec.slice(2);
  const S = state.pub.settings;
  let title, fields, onSave, onDelete, onReset;
  const input = (n, l, v, o = {}) => `<div class="field"><label for="e_${n}">${esc(l)}</label>${o.area
    ? `<textarea id="e_${n}" name="${n}" style="min-height:${o.h || 120}px" maxlength="${o.max || 1000}">${esc(v)}</textarea>`
    : `<input id="e_${n}" name="${n}" value="${esc(v)}" maxlength="${o.max || 200}" ${o.list ? `list="${o.list}"` : ''} ${o.type ? `type="${o.type}" step="0.01" min="0"` : ''}>`}</div>`;

  if (type === 't') {
    const cur = S.texts && S.texts[id] !== undefined ? S.texts[id] : (el.dataset.def || el.textContent);
    title = 'Yazıyı düzenle';
    fields = input('value', 'Yeni yazı', cur, { area: cur.length > 60, h: 100, max: 1000 });
    onSave = (d) => api('/texts', 'PUT', { key: id, value: d.value });
    onReset = () => api('/texts', 'PUT', { key: id, value: '' });
  } else if (type === 's') {
    const [label, area] = EDIT_FIELDS[id] || [id, false];
    title = label;
    fields = input('value', label, S[id] || '', { area, h: id === 'rules' ? 200 : 120, max: 3000 });
    onSave = (d) => { const { texts, ...rest } = S; return api('/settings', 'PUT', { ...rest, [id]: d.value }); };
  } else if (type === 'p') {
    const all = await api('/products?all=1');
    const isNew = id === 'new';
    const p = isNew ? { name: '', category: all[0]?.category || 'Rütbeler', price: '', description: '', active: true } : all.find((x) => x.id === id);
    if (!p) throw new Error('Ürün bulunamadı.');
    title = isNew ? 'Yeni ürün ekle' : 'Ürünü düzenle';
    const cats = [...new Set(all.map((x) => x.category))];
    fields = input('name', 'Ürün adı', p.name, { max: 60 }) + input('category', 'Kategori (yeni yazarak yeni kategori açarsın)', p.category, { max: 30, list: 'catlist' })
      + `<datalist id="catlist">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`
      + input('price', 'Fiyat (₺)', p.price, { type: 'number' }) + input('description', 'Açıklama', p.description, { area: true, h: 80, max: 400 })
      + `<label class="check" style="margin-bottom:14px"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Mağazada göster</label>`;
    const body = (d, f) => ({ name: d.name, category: d.category, price: d.price, description: d.description, active: f.active.checked });
    onSave = (d, f) => (isNew ? api('/products', 'POST', body(d, f)) : api('/products/' + id, 'PUT', body(d, f)));
    if (!isNew) onDelete = () => api('/products/' + id, 'DELETE');
  } else if (type === 'a') {
    const isNew = id === 'new';
    const a = isNew ? { title: '', text: '' } : state.pub.announcements.find((x) => x.id === id);
    if (!a) throw new Error('Duyuru bulunamadı.');
    title = isNew ? 'Yeni duyuru' : 'Duyuruyu düzenle';
    fields = input('title', 'Başlık', a.title, { max: 100 }) + input('text', 'Metin', a.text, { area: true, h: 120 });
    onSave = (d) => (isNew ? api('/announcements', 'POST', { title: d.title, text: d.text }) : api('/announcements/' + id, 'PUT', { title: d.title, text: d.text }));
    if (!isNew) onDelete = () => api('/announcements/' + id, 'DELETE');
  } else return;

  closeModal();
  const m = document.createElement('div');
  m.id = 'modal'; m.className = 'modal-back';
  m.innerHTML = `<form class="modal card" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${fields}
    <div class="row"><button class="btn">Kaydet</button>
      ${onReset ? '<button type="button" class="btn ghost" data-m="reset">Varsayılana dön</button>' : ''}
      ${onDelete ? '<button type="button" class="btn danger" data-m="del">Sil</button>' : ''}
      <button type="button" class="btn ghost" data-m="cancel">İptal</button></div></form>`;
  document.body.appendChild(m);
  const form = $('form', m);
  const first = $('input:not([type=checkbox]), textarea', form);
  if (first) { first.focus(); if (first.select) first.select(); }
  const done = async (fn, msg) => {
    await fn();
    state.pub = await api('/public');
    closeModal(); toast(msg); render(true);
  };
  m.addEventListener('mousedown', (e) => { if (e.target === m) closeModal(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); guard(() => done(() => onSave(formData(form), form), 'Kaydedildi.')); });
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    if (b.dataset.m === 'cancel') closeModal();
    if (b.dataset.m === 'reset') guard(() => done(onReset, 'Varsayılana döndü.'));
    if (b.dataset.m === 'del' && confirm('Silinsin mi?')) guard(() => done(onDelete, 'Silindi.'));
  });
}

/* ------------------------------- Başlat ------------------------------- */
(async function init() {
  $('#year').textContent = new Date().getFullYear();
  try {
    const [me, pub] = await Promise.all([api('/me'), api('/public')]);
    state.user = me.user; state.perms = me.allPermissions; state.pub = pub;
  } catch (e) { toast(e.message, true); }
  await render();
  if (isOwner()) {
    let seen = false;
    try { seen = sessionStorage.getItem('rasp-owner-hint') === '1'; sessionStorage.setItem('rasp-owner-hint', '1'); } catch { /* yoksay */ }
    if (!seen) toast('Sahip modu: bir yazıya veya karta basılı tut, "Ayarla" çıksın.');
  }
})();
