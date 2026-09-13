/* ============================================================
   Vervotech Showdown — bootstrap, routing, scan flow, export
   ============================================================ */

/* $, $$, esc, toast, openSheet, closeSheet come from ui.js;
   render, renderDayRail from views.js. Both are already global. */

/* ---------------- boot ---------------- */
let pendingScanMeeting = null;

async function boot() {
  $('#authMark').innerHTML = I.logo;
  $('#bmLogo').innerHTML = I.logo;
  $('#li_toggle').innerHTML = I.eye;
  $('#sheetX').innerHTML = I.x;
  $('.tab[data-t="today"] .ic').innerHTML = I.calendar;
  $('.tab[data-t="leads"] .ic').innerHTML = I.users;
  $('.tab[data-t="walkins"] .ic').innerHTML = I.handshake;
  $('.tab[data-t="scan"] .ring').innerHTML = I.scan;
  $('.tab[data-t="agenda"] .ic').innerHTML = I.days;
  $('.tab[data-t="board"] .ic').innerHTML = I.grid;
  $('.tab[data-t="me"] .ic').innerHTML = I.user;

  const s = await Store.getSession();
  if (!s) return showAuth();
  await enterApp();
}

function showAuth() {
  $('#boot').hidden = true;
  $('#app').hidden = true;
  $('#authView').hidden = false;
  $('#li_email').focus();
  const t = $('#authEv');
  const saved = localStorage.getItem('sf_evtag') || CFG.eventTag;
  if (saved) { t.innerHTML = `${I.pin}<span>${esc(saved)}</span>`; t.hidden = false; }
}

async function enterApp() {
  $('#authView').hidden = true;
  $('#boot').hidden = false;
  try {
    await Store.loadMe();
  } catch (e) { /* offline, snapshot may still carry us */ }
  if (!S.me && navigator.onLine) {
    toast('Your account is not on the floor team list yet. Ask Prashant to add you.', { kind: 'bad', ms: 9000 });
    await Store.signOut();
    return;
  }
  $('#boot').hidden = true;
  $('#app').hidden = false;
  $('#main').innerHTML = `<div class="page">${UI.skeletons(5)}</div>`;
  paintMe(); paintSync();

  try { await Store.loadAll(); } catch (e) {
    toast('Could not reach the server. Working from what is on this phone.', { kind: 'warn' });
  }
  /* nothing on your name: open on the whole team rather than an empty list.
     Reps are matched on the meetings they booked, never as an attendee. */
  const meIsRep = S.me?.role === 'rep';
  const key = meIsRep ? 'rep_id' : 'owner_id';
  if (!S.meetings.some(m => m[key] === S.me?.user_id)) V.scope = 'team';
  renderDayRail(); render(); paintEvent();
  Store.ocrCheck().then(() => { if (V.tab === 'scan' || V.tab === 'me') render(); });
  Store.flush();
  refreshCounters();
}

function paintMe() {
  const btn = $('#meBtn');
  const hue = UI.hueOf(S.me);
  btn.textContent = UI.initials(S.me?.full_name || S.me?.short_name || '?');
  btn.style.background = `linear-gradient(150deg,hsl(${hue} 64% 52%),hsl(${(hue + 26) % 360} 58% 38%))`;
}
function paintEvent() {
  const e = UI.activeEvent();
  $('#bmName').textContent = APP_NAME;
  $('#bmSub').textContent = e
    ? [e.short_name || e.name, e.city, e.stand ? 'Stand ' + e.stand : ''].filter(Boolean).join(' · ')
    : 'no event';
  if (e) { try { localStorage.setItem('sf_evtag', [e.name, e.city].filter(Boolean).join(' · ')); } catch (_) {} }
}
function paintSync() {
  const p = $('#syncPill');
  p.dataset.state = S.net;
  $('#syncTx').textContent = S.net === 'offline' ? 'Offline'
    : S.net === 'syncing' ? (S.pending ? `Syncing ${S.pending}` : 'Syncing')
    : 'Live';
}

/* re-render clock-driven bits (live meeting, next up) every 45s */
function refreshCounters() {
  setInterval(() => {
    if ($('#app').hidden) return;
    if (V.tab === 'today' && $('#sheet').hidden) render();
  }, 45000);
}

Store.bus.on('net', paintSync);
Store.bus.on('data', UI.debounce(() => {
  if ($('#app').hidden) return;
  renderDayRail(); render(); paintEvent();
}, 260));
Store.bus.on('remote', a => {
  if (a.actor_id === S.me?.user_id) return;
  if (String(a.kind || '').startsWith('outcome_') || a.kind === 'lead_scanned') {
    toast(`${a.actor_name || 'Someone'} ${a.summary}`, { icon: a.kind === 'lead_scanned' ? 'card' : 'bolt', ms: 3400 });
  }
});

/* ---------------- auth form ---------------- */
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const em = $('#li_email').value.trim(), pw = $('#li_pass').value;
  const err = $('#li_err'), btn = $('#li_btn');
  err.hidden = true;
  if (!em || !pw) { err.textContent = 'Email and password, please.'; err.hidden = false; return; }
  btn.disabled = true; btn.textContent = 'Signing in';
  try {
    await Store.signIn(em, pw);
    await enterApp();
  } catch (ex) {
    err.textContent = /invalid/i.test(ex.message || '') ? 'That email and password do not match.' : (ex.message || 'Could not sign in.');
    err.hidden = false;
    $('#li_pass').classList.add('err');
    btn.disabled = false; btn.textContent = 'Sign in';
  }
});
$('#li_toggle').onclick = () => {
  const i = $('#li_pass');
  const show = i.type === 'password';
  i.type = show ? 'text' : 'password';
  $('#li_toggle').innerHTML = show ? I.eyeOff : I.eye;
  $('#li_toggle').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
};
$('#li_pass').addEventListener('input', () => $('#li_pass').classList.remove('err'));

/* ---------------- shell chrome ---------------- */
$$('.tab').forEach(t => t.onclick = () => {
  V.tab = t.dataset.t;
  if (V.tab === 'leads') V.q = V.q || '';
  /* All days parks V.day on 'all', so coming back to Today must restore the date */
  if (V.tab === 'today' && V.day === 'all') V.day = UI.nowInTz().date;
  render(); renderDayRail();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  UI.buzz(8);
});
$('#meBtn').onclick = () => { V.tab = 'me'; render(); renderDayRail(); };
$('#evBtn').innerHTML = I.chev;
$('#evBtn').onclick = () => Views.openSwitchEvent();
/* the wordmark behaves like a logo: always returns to today */
$('#homeBtn').onclick = () => {
  V.tab = 'today'; V.day = UI.nowInTz().date; V.q = '';
  renderDayRail(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); UI.buzz(8);
};
$('#syncPill').onclick = () => {
  if (!navigator.onLine) return toast('Still offline. Everything you do is saved and will sync.', { kind: 'warn' });
  toast(S.pending ? `Pushing ${S.pending} change${S.pending === 1 ? '' : 's'}` : 'Refreshing');
  Store.flush(); Store.loadAll({ fromCache: false }).then(() => { renderDayRail(); render(); });
};
$('#dayrail').addEventListener('click', e => {
  const c = e.target.closest('[data-day]');
  if (!c) return;
  V.day = c.dataset.day;
  renderDayRail(); render();
});
/* segmented controls live inside #main, which is re-rendered, so delegate */
$('#main').addEventListener('click', e => {
  const s = e.target.closest('[data-scope]');
  if (s) { V.scope = s.dataset.scope; renderDayRail(); render(); UI.buzz(6); return; }
  const lf = e.target.closest('[data-lf]');
  if (lf) { V.leadFilter = lf.dataset.lf; render(); UI.buzz(6); return; }
  const wk = e.target.closest('[data-wk]');
  if (wk) { V.wkScope = wk.dataset.wk; render(); UI.buzz(6); return; }
  const bd = e.target.closest('[data-bd]');
  if (bd) { V.boardDay = bd.dataset.bd; render(); UI.buzz(6); return; }
});

const runQ = UI.debounce(v => {
  V.q = v;
  render();
  const i = $('#leadQ');
  if (i) { i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch (_) {} }
}, 240);
$('#main').addEventListener('input', e => { if (e.target.id === 'leadQ') runQ(e.target.value); });

$('#scrim').onclick = () => closeSheet();
$('#sheetX').onclick = () => closeSheet();
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

/* ---------------- delegated actions ---------------- */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;

  const acts = {
    meeting: () => Views.openMeeting(id),
    outcome: () => Views.openOutcome(id),
    lead: () => Views.openLead(id),
    editLead: () => Views.openEditLead(id),
    editMeeting: () => Views.openEditMeeting(id),
    addMeeting: () => Views.openAddMeeting(),
    retryLoad: () => {
      toast('Reloading the schedule');
      Store.loadAll({ fromCache: false }).then(() => { renderDayRail(); render(); });
    },
    addEvent: () => Views.openAddEvent(),
    switchEvent: () => Views.openSwitchEvent(),
    pickEvent: () => Views.doSwitchEvent(id),
    team: () => Views.openTeam(),
    linkMeeting: () => Views.openLinkMeeting(id),
    goScan: () => { V.tab = 'scan'; render(); renderDayRail(); },
    camera: () => { pendingScanMeeting = null; $('#camPick').click(); },
    upload: () => { pendingScanMeeting = null; $('#filePick').click(); },
    manual: () => openReview({ fields: OCR.normalize({}), engine: 'manual' }, null),
    scanFor: () => { pendingScanMeeting = id; closeSheet(); $('#camPick').click(); },
    clearQ: () => { V.q = ''; render(); },
    copy: () => UI.copy(el.dataset.v, 'Copied'),
    install: doInstall,
    refresh: () => { toast('Refreshing'); Store.loadAll({ fromCache: false }).then(() => { renderDayRail(); render(); }); },
    export: doExport,
    signout: doSignout,
    status: async () => {
      const m = S.meetings.find(x => x.id === id);
      if (!m) return;
      const v = el.dataset.v;
      await Store.updateMeeting(id, { status: v, updated_at: new Date().toISOString() },
        { activity: { kind: 'status', summary: `marked ${m.company_name} ${v.replace('_', ' ')}` } });
      toast(`Marked ${v.replace('_', ' ')}`, { kind: 'ok' });
      closeSheet(); render();
    },
    rate: async () => {
      await Store.updateLead(id, { interest: el.dataset.v, updated_at: new Date().toISOString() });
      el.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b === el)));
      toast(`Rated ${OUT_MAP[el.dataset.v].label.toLowerCase()}`, { kind: 'ok' });
      render();
    },
    doLink: async () => {
      await Store.updateLead(id, { meeting_id: el.dataset.m, updated_at: new Date().toISOString() });
      closeSheet(); toast('Attached to the meeting', { kind: 'ok' }); render();
    },
    delLead: async () => {
      const l = S.leads.find(x => x.id === id);
      closeSheet();
      const ok = await UI.confirmSheet({
        title: 'Delete this contact?', sub: l?.full_name || l?.company || '',
        body: `<div class="hint">The card image and everything read from it goes too. This cannot be undone.</div>`,
        ok: 'Delete', danger: true
      });
      if (!ok) return;
      await Store.deleteLead(id);
      toast('Contact deleted');
      render();
    }
  };
  if (acts[act]) { e.preventDefault(); acts[act](); }
});

/* search input */
document.addEventListener('input', UI.debounce(e => {
  if (e.target.id === 'leadQ') {
    V.q = e.target.value;
    const sel = e.target.selectionStart;
    render();
    const n = $('#leadQ');
    if (n) { n.focus(); try { n.setSelectionRange(sel, sel); } catch (x) {} }
  }
}, 260));

/* ---------------- scan flow ---------------- */
['#camPick', '#filePick'].forEach(sel => {
  $(sel).addEventListener('change', async ev => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    await runScan(file);
  });
});

async function runScan(file) {
  const mtgId = pendingScanMeeting;
  let bar;
  openSheet({
    title: 'Reading the card', sub: 'A few seconds',
    body: `<div class="ocrbar" id="scanBar"><span class="sp"></span><span id="scanTx">Preparing the image</span></div>
           <div class="cardprev" id="scanPrev" style="min-height:150px;display:grid;place-items:center;color:var(--tx-3)">${I.image}</div>
           <div class="hint">You can edit anything the reader gets wrong on the next screen.</div>`
  });
  bar = $('#scanTx');

  let res;
  try {
    res = await OCR.readCard(file, {
      onStage: (s, p) => {
        if (!bar) return;
        bar.textContent = s === 'prep' ? 'Preparing the image'
          : s === 'ai' ? 'Reading with AI vision'
          : s === 'local' ? `Reading on device ${Math.round(p * 100)}%`
          : s === 'queued' ? 'No signal, saving the card'
          : 'Almost there';
      }
    });
  } catch (err) {
    closeSheet();
    return toast('Could not open that image. Try again.', { kind: 'bad' });
  }

  const prev = $('#scanPrev');
  if (prev) prev.innerHTML = `<img src="${esc(res.dataUrl)}" alt="Card">`;
  UI.buzz(14);
  openReview(res, mtgId);
}

function openReview(res, mtgId) {
  const f = res.fields || {};
  const blobs = res.blob ? { front: res.blob } : null;
  let interest = null;
  let linkTo = mtgId || null;

  const fake = { company: f.company, email: f.email, website: f.website, full_name: f.full_name };
  const cands = Views.matchMeetings(fake).slice(0, 3);
  if (!linkTo && cands.length && cands[0].score >= 50) linkTo = cands[0].m.id;

  const engineBar = res.engine === 'manual' ? ''
    : `<div class="ocrbar" data-s="${res.engine === 'queued' ? 'warn' : res.engine === 'device' ? 'warn' : 'ok'}">
        ${res.engine === 'queued' ? I.wifiOff : res.engine === 'device' ? I.alert : I.sparkle}
        <span>${esc(res.note || 'Read with AI vision. Check the details below.')}</span>
      </div>`;

  const F = (id, label, value = '', attrs = '') => `<div class="field">
    <label for="${id}">${esc(label)}</label>
    <input class="input" id="${id}" value="${esc(value || '')}" ${attrs}></div>`;

  const body = `
    ${res.dataUrl ? `<div class="cardprev"><img src="${esc(res.dataUrl)}" alt="Business card">
      <button class="re" data-act="rescan">${I.camera}Retake</button></div>` : ''}
    ${engineBar}

    ${cands.length ? `<div class="matchbox">
      <div class="mh">Looks like a booked meeting</div>
      ${cands.map(({ m }) => `<button class="matchopt" data-pick="${m.id}" aria-pressed="${linkTo === m.id}">
        <span class="mi">${I.calendar}</span>
        <span class="mb"><span class="m1">${esc(m.company_name)}</span>
        <span class="m2">${esc(UI.fmtDate(m.meeting_date))} · ${esc(UI.fmtTimeStr(m.meeting_time))}${m.prospect_name ? ' · ' + esc(m.prospect_name) : ''}</span></span>
      </button>`).join('')}
      <button class="matchopt" data-pick="" aria-pressed="${!linkTo}">
        <span class="mi">${I.plus}</span>
        <span class="mb"><span class="m1">Keep it standalone</span><span class="m2">A walk-in, not on the sheet</span></span>
      </button>
    </div>` : ''}

    ${F('r_name', 'Full name', f.full_name, 'autocapitalize="words" placeholder="Who you met"')}
    ${F('r_title', 'Job title', f.designation)}
    ${F('r_co', 'Company', f.company, 'autocapitalize="words"')}
    ${F('r_email', 'Email', f.email, 'type="email" inputmode="email" autocapitalize="none" spellcheck="false"')}
    <div class="grid2">
      ${F('r_phone', 'Phone', f.phone, 'type="tel" inputmode="tel"')}
      ${F('r_phone2', 'Second number', f.phone_2, 'type="tel" inputmode="tel"')}
    </div>
    ${F('r_web', 'Website', f.website, 'autocapitalize="none" spellcheck="false"')}
    <div class="field">
      <label for="r_region">Region</label>
      <select class="sel" id="r_region"><option value="">—</option>
        ${REGIONS.map(r => `<option value="${r}" ${guessRegion(f) === r ? 'selected' : ''}>${r}</option>`).join('')}
      </select>
    </div>

    <div class="sec-h" style="margin-top:4px"><h2>How interested are they?</h2></div>
    <div class="outs" id="rOut">
      ${OUTCOMES.map(o => `<button class="outbtn" data-v="${o.v}" aria-pressed="false">
        <span class="oi">${I[o.icon] || I.bolt}</span>
        <span class="ot">${o.label}</span><span class="od">${o.desc}</span></button>`).join('')}
    </div>

    <div class="field" style="margin-top:14px">
      <label for="r_notes">What they need</label>
      <textarea class="input" id="r_notes" placeholder="Which suppliers they use, mapping pain, volumes, who signs."></textarea>
    </div>
    <div class="grid2">
      ${F('r_next', 'Next step', '')}
      ${F('r_due', 'Follow up by', '', 'type="date" class="input mono"')}
    </div>
    ${f.raw_text ? `<details style="margin-top:6px"><summary class="hint" style="cursor:pointer">What the reader saw</summary>
      <pre class="hint mono" style="white-space:pre-wrap;margin-top:8px">${esc(f.raw_text)}</pre></details>` : ''}`;

  openSheet({
    title: 'Check the details', sub: f.full_name || f.company || 'New contact', body,
    foot: `<button class="btn ghost" data-x>Discard</button><button class="btn primary" data-save>Save contact</button>`,
    onMount(b, ft) {
      b.querySelectorAll('#rOut .outbtn').forEach(btn => btn.onclick = () => {
        interest = btn.dataset.v;
        b.querySelectorAll('#rOut .outbtn').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === interest)));
        UI.buzz();
      });
      b.querySelectorAll('[data-pick]').forEach(btn => btn.onclick = () => {
        linkTo = btn.dataset.pick || null;
        b.querySelectorAll('[data-pick]').forEach(x => x.setAttribute('aria-pressed', String((x.dataset.pick || null) === linkTo)));
      });
      const re = b.querySelector('[data-act="rescan"]');
      if (re) re.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); closeSheet(); $('#camPick').click(); };

      ft.querySelector('[data-x]').onclick = async () => {
        closeSheet();
        toast('Card discarded');
      };
      ft.querySelector('[data-save]').onclick = async () => {
        const g = s => (b.querySelector(s)?.value || '').trim() || null;
        const name = g('#r_name'), co = g('#r_co'), em = g('#r_email');
        if (!name && !co && !em) {
          b.querySelector('#r_name').classList.add('err');
          return toast('Give it at least a name, company or email.', { kind: 'warn' });
        }
        closeSheet();
        const lead = await Store.saveLead({
          full_name: name, designation: g('#r_title'), company: co,
          email: em ? em.toLowerCase() : null, phone: g('#r_phone'), phone_2: g('#r_phone2'),
          website: g('#r_web'), linkedin: f.linkedin || null, address: f.address || null,
          geo_region: g('#r_region'), notes: g('#r_notes'),
          interest, next_step: g('#r_next'), next_step_due: g('#r_due'),
          meeting_id: linkTo || null,
          ocr_text: f.raw_text || null, ocr_provider: res.engine || null
        }, blobs);

        if (linkTo && interest) {
          const m = S.meetings.find(x => x.id === linkTo);
          if (m && !m.outcome) {
            await Store.updateMeeting(linkTo, {
              outcome: interest, status: 'met', met_at: m.met_at || new Date().toISOString(),
              prospect_name: m.prospect_name || name, email: m.email || (em ? em.toLowerCase() : null),
              mobile: m.mobile || g('#r_phone'), updated_at: new Date().toISOString()
            }, { activity: { kind: 'outcome_' + interest, summary: `called ${OUT_MAP[interest].label.toLowerCase()} on ${m.company_name}` } });
          }
        }
        UI.buzz(18);
        toast(`${name || co || 'Contact'} saved`, { kind: 'ok', action: 'Open', onAction: () => Views.openLead(lead.id) });
        pendingScanMeeting = null;
        render();
      };
    },
    onClose() { pendingScanMeeting = null; }
  });
}

function guessRegion(f) {
  const s = [f.address, f.website, f.email, f.phone].filter(Boolean).join(' ').toLowerCase();
  if (/\b(uae|dubai|abu dhabi|sharjah|saudi|riyadh|jeddah|qatar|doha|kuwait|oman|muscat|bahrain|manama|egypt|cairo|jordan|amman|lebanon|\.ae|\.sa|\.qa|\.om|\.bh|\.kw|\.eg|\+971|\+966|\+974|\+965|\+968|\+973|\+20)\b/.test(s)) return 'MENA';
  if (/\b(singapore|malaysia|thailand|bangkok|indonesia|jakarta|vietnam|philippines|manila|\.sg|\.my|\.th|\.id|\.vn|\.ph|\+65|\+60|\+66|\+62|\+84|\+63)\b/.test(s)) return 'SEA';
  if (/\b(india|mumbai|delhi|bangalore|pune|china|hong kong|japan|tokyo|korea|seoul|\.in|\.cn|\.hk|\.jp|\.kr|\+91|\+86|\+852|\+81|\+82)\b/.test(s)) return 'Asia';
  if (/\b(united kingdom|london|\.uk|\+44)\b/.test(s)) return 'UK';
  if (/\b(germany|france|spain|italy|netherlands|sweden|switzerland|\.de|\.fr|\.es|\.it|\.nl|\.se|\.ch|\.eu|\+49|\+33|\+34|\+39|\+31)\b/.test(s)) return 'Europe';
  if (/\b(usa|united states|canada|brazil|mexico|\.us|\.ca|\.br|\.mx|\+1\b)\b/.test(s)) return 'Americas';
  if (/\b(south africa|kenya|nigeria|\.za|\.ke|\.ng|\+27|\+254|\+234)\b/.test(s)) return 'Africa';
  return '';
}

/* ---------------- export ---------------- */
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function doExport() {
  const ev = UI.activeEvent();
  const mh = ['Sr No', 'Date', 'Time', 'Company', 'Geo', 'Prospect', 'Designation', 'Email', 'Mobile',
    'Meeting with', 'IS Rep', 'Category', 'Status', 'Outcome', 'Deal value USD', 'Next step',
    'Follow up by', 'Outcome notes', 'Sheet comments', 'Cards captured'];
  const mrows = [...S.meetings].sort((a, b) =>
    String(a.meeting_date).localeCompare(String(b.meeting_date)) ||
    String(a.meeting_time || '').localeCompare(String(b.meeting_time || ''))
  ).map((m, i) => [
    m.seq || i + 1, m.meeting_date, (m.meeting_time || '').slice(0, 5), m.company_name, m.geo_region,
    m.prospect_name, m.designation, m.email, m.mobile,
    UI.memberById(m.owner_id)?.short_name || m.owner_name,
    UI.memberById(m.rep_id)?.short_name || m.rep_name,
    m.category, m.status, m.outcome ? OUT_MAP[m.outcome]?.label : '', m.deal_value_usd,
    m.next_step, m.next_step_due, m.outcome_notes, m.comments, S.leads.filter(l => l.meeting_id === m.id).length
  ]);

  const lh = ['Captured', 'By', 'Name', 'Title', 'Company', 'Email', 'Phone', 'Second number',
    'Website', 'LinkedIn', 'Region', 'Interest', 'Next step', 'Follow up by', 'Notes', 'Linked meeting'];
  const lrows = S.leads.map(l => [
    l.created_at, UI.memberById(l.captured_by)?.short_name || l.captured_by_name,
    l.full_name, l.designation, l.company, l.email, l.phone, l.phone_2,
    l.website, l.linkedin, l.geo_region, l.interest ? OUT_MAP[l.interest]?.label : '',
    l.next_step, l.next_step_due, l.notes,
    l.meeting_id ? (S.meetings.find(m => m.id === l.meeting_id)?.company_name || '') : ''
  ]);

  const csv = [
    ['MEETINGS'], mh, ...mrows, [], ['CARDS CAPTURED'], lh, ...lrows
  ].map(r => r.map(csvCell).join(',')).join('\r\n');

  const name = `${(ev?.short_name || 'event').replace(/\s+/g, '-')}-showfloor-${new Date().toISOString().slice(0, 10)}.csv`;
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  toast(`${pl(mrows.length, 'meeting')} and ${pl(lrows.length, 'card')} exported`, { kind: 'ok' });
}

/* ---------------- sign out ---------------- */
async function doSignout() {
  if (S.pending) {
    const ok = await UI.confirmSheet({
      title: 'You have unsynced work', sub: `${S.pending} change${S.pending === 1 ? '' : 's'} still on this phone`,
      body: `<div class="hint bad">Signing out clears it. Get on wifi first so it reaches the team.</div>`,
      ok: 'Sign out anyway', danger: true
    });
    if (!ok) return;
  } else {
    const ok = await UI.confirmSheet({ title: 'Sign out?', sub: S.me?.email || '', ok: 'Sign out', danger: true });
    if (!ok) return;
  }
  await Store.signOut();
}

/* ---------------- install ---------------- */
window.__installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__installPrompt = e; });
async function doInstall() {
  const p = window.__installPrompt;
  if (!p) return toast('Use your browser menu, then Add to Home Screen.', { ms: 5000 });
  p.prompt();
  const { outcome } = await p.userChoice;
  if (outcome === 'accepted') { window.__installPrompt = null; toast('Installed', { kind: 'ok' }); render(); }
}

/* ---------------- service worker ---------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

boot();
