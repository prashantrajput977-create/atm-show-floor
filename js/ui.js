/* ============================================================
   Vervotech Showdown — UI primitives
   ============================================================ */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

/* ---------- identity colour ---------- */
function hueOf(m) {
  if (m && Number.isFinite(m.hue)) return m.hue;
  const s = (m?.short_name || m?.full_name || '?');
  let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 360;
  return x;
}
function initials(name) {
  const p = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}
function avatar(m, cls = '') {
  const hue = hueOf(m);
  const nm = m?.full_name || m?.short_name || '?';
  return `<span class="avatar ${cls}" style="background:linear-gradient(150deg,hsl(${hue} 64% 52%),hsl(${(hue + 26) % 360} 58% 38%))" title="${esc(nm)}">${esc(initials(nm))}</span>`;
}
function memberByName(n) {
  if (!n) return null;
  const k = String(n).trim().toLowerCase();
  return S.members.find(m => (m.short_name || '').toLowerCase() === k) ||
         S.members.find(m => (m.full_name || '').toLowerCase().startsWith(k)) || null;
}
function memberById(id) { return id ? S.members.find(m => m.user_id === id) : null; }

/* ---------- time ---------- */
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function evTz() { return activeEvent()?.timezone || 'Asia/Dubai'; }
function activeEvent() { return S.events.find(e => e.id === S.eventId) || null; }

/* current date + minutes in the event timezone */
function nowInTz() {
  const tz = evTz();
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date());
  } catch (e) {
    const d = new Date();
    return { date: d.toISOString().slice(0, 10), min: d.getHours() * 60 + d.getMinutes() };
  }
  const g = k => parts.find(p => p.type === k)?.value || '00';
  const hh = g('hour') === '24' ? '00' : g('hour');
  return { date: `${g('year')}-${g('month')}-${g('day')}`, min: (+hh) * 60 + (+g('minute')) };
}

function toMin(t) {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}
function fmtTime(t) {
  const mn = toMin(t);
  if (mn == null) return { hm: '--:--', ap: '' };
  let hh = Math.floor(mn / 60), mm = mn % 60;
  const ap = hh >= 12 ? 'PM' : 'AM';
  let h12 = hh % 12; if (h12 === 0) h12 = 12;
  return { hm: `${h12}:${String(mm).padStart(2, '0')}`, ap };
}
function fmtTimeStr(t) { const f = fmtTime(t); return f.ap ? `${f.hm} ${f.ap}` : f.hm; }
function slotOf(t) {
  const mn = toMin(t);
  if (mn == null) return 'Unscheduled';
  const hh = Math.floor(mn / 60);
  const ap = hh >= 12 ? 'PM' : 'AM';
  let h12 = hh % 12; if (h12 === 0) h12 = 12;
  return `${h12}:00 ${ap}`;
}
function dParts(ds) {
  const [y, m, d] = String(ds).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return { dow: DOW[dt.getUTCDay()], mon: MON[m - 1], day: d, y };
}
function fmtDate(ds) { const p = dParts(ds); return `${p.dow} ${p.day} ${p.mon}`; }
function ago(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

/* ---------- toasts ---------- */
let toastSeq = 0;
function toast(msg, opts = {}) {
  const { kind = '', icon, action, onAction, ms = 4200 } = opts;
  const id = 'ts' + (++toastSeq);
  const ic = icon || (kind === 'ok' ? 'checkCircle' : kind === 'bad' ? 'alert' : kind === 'warn' ? 'alert' : 'info');
  const node = h(`<div class="toast ${kind}" id="${id}">
      <span class="ti">${I[ic] || I.info}</span>
      <span class="tt">${esc(msg)}</span>
      ${action ? `<button class="tb">${esc(action)}</button>` : ''}
    </div>`);
  $('#toasts').appendChild(node);
  let t = setTimeout(kill, ms);
  function kill() {
    clearTimeout(t);
    node.classList.add('out');
    setTimeout(() => node.remove(), 220);
  }
  if (action) node.querySelector('.tb').onclick = () => { kill(); onAction && onAction(); };
  return kill;
}

/* ---------- sheet ---------- */
const sheetStack = [];
function openSheet({ title, sub, body, foot, onMount, onClose }) {
  const sh = $('#sheet'), sc = $('#scrim');
  sheetStack.push({ onClose });
  $('#sheetTitle').textContent = title || '';
  const sp = $('#sheetSub');
  sp.textContent = sub || ''; sp.hidden = !sub;
  $('#sheetBody').innerHTML = body || '';
  const f = $('#sheetFoot');
  if (foot) { f.innerHTML = foot; f.hidden = false; } else { f.innerHTML = ''; f.hidden = true; }
  sh.hidden = false;
  requestAnimationFrame(() => { sh.classList.add('on'); sc.classList.add('on'); });
  document.body.style.overflow = 'hidden';
  $('#sheetBody').scrollTop = 0;
  onMount && onMount($('#sheetBody'), $('#sheetFoot'));
}
function closeSheet() {
  const sh = $('#sheet'), sc = $('#scrim');
  if (sh.hidden) return;
  const top = sheetStack.pop();
  sh.classList.remove('on'); sc.classList.remove('on');
  document.body.style.overflow = '';
  setTimeout(() => {
    if (!sh.classList.contains('on')) { sh.hidden = true; $('#sheetBody').innerHTML = ''; }
  }, 300);
  top?.onClose && top.onClose();
}

/* confirm inside a sheet */
function confirmSheet({ title, sub, body, ok = 'Confirm', danger = false }) {
  return new Promise(res => {
    openSheet({
      title, sub,
      body: body || '',
      foot: `<button class="btn ghost" data-x>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(ok)}</button>`,
      onMount(b, f) {
        f.querySelector('[data-x]').onclick = () => { closeSheet(); res(false); };
        f.querySelector('[data-ok]').onclick = () => { closeSheet(); res(true); };
      }
    });
  });
}

/* ---------- misc ---------- */
function tagFor(outcome) {
  if (!outcome) return '';
  const o = OUT_MAP[outcome];
  return `<span class="tag t-${o ? o.tone : 'mute'}">${esc(o ? o.short : outcome)}</span>`;
}
function money(n) {
  if (n == null || n === '' || isNaN(n)) return '';
  const v = Number(n);
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
  return '$' + v;
}
function copy(text, label = 'Copied') {
  const done = () => toast(label, { kind: 'ok' });
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fb());
  else fb();
  function fb() {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Could not copy', { kind: 'bad' }); }
    ta.remove();
  }
}
function buzz(ms = 12) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }

function emptyState(icon, title, msg, ...btns) {
  const acts = btns.filter(Boolean);
  return `<div class="empty">${I[icon] || I.info}
    <h3>${esc(title)}</h3><p>${esc(msg)}</p>
    ${acts.length
      ? `<div class="empty-acts">${acts.map((b, i) =>
          `<button class="btn ${i ? 'ghost' : 'primary'}" data-act="${esc(b.act)}">${I[b.icon] || ''}${esc(b.label)}</button>`
        ).join('')}</div>`
      : ''}
  </div>`;
}

function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return s + ' seconds ago';
  const m = Math.round(s / 60);
  if (m < 60) return m + ' minute' + (m === 1 ? '' : 's') + ' ago';
  const h = Math.round(m / 60);
  return h + ' hour' + (h === 1 ? '' : 's') + ' ago';
}

function skeletons(n = 4) {
  return Array.from({ length: n }, () => `<div class="skel-card">
    <div class="skel" style="width:44px;height:34px"></div>
    <div style="flex:1">
      <div class="skel" style="width:58%;height:14px"></div>
      <div class="skel" style="width:38%;height:11px;margin-top:7px"></div>
    </div></div>`).join('');
}

function debounce(fn, ms = 220) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* keyboard offset so sheets do not hide inputs on iOS */
if (window.visualViewport) {
  const vv = window.visualViewport;
  const sync = () => {
    const off = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', (off > 90 ? off : 0) + 'px');
  };
  vv.addEventListener('resize', sync); vv.addEventListener('scroll', sync);
}

window.UI = {
  $, $$, esc, h, avatar, initials, hueOf, memberByName, memberById,
  activeEvent, evTz, nowInTz, toMin, fmtTime, fmtTimeStr, slotOf, dParts, fmtDate, ago,
  toast, openSheet, closeSheet, confirmSheet, tagFor, money, copy, buzz,
  emptyState, skeletons, debounce, ago
};
