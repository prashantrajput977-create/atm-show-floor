/* ============================================================
   Vervotech Showdown — bootstrap, routing, scan flow, export
   ============================================================ */

/* $, $$, esc, toast, openSheet, closeSheet come from ui.js;
   render, renderDayRail from views.js. Both are already global. */

/* ---------------- boot ---------------- */
let pendingScanMeeting = null;
let pendingWalkin = false;

async function boot() {
  /* the real Vervotech wordmark, inherited black from currentColor */
  $('#authMark').innerHTML = BRAND.word;
  $('#authMarkSm').innerHTML = BRAND.word;
  $('#bmLogo').innerHTML = BRAND.word;
  $('#railLogo').innerHTML = BRAND.word;
  $('.as-wm').innerHTML = BRAND.mark;
  $('.ac-endorse').innerHTML = BRAND.endorse;
  $('#railFoot').innerHTML = BRAND.endorse;
  $('.acf-lock').innerHTML = I.lock;
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
  /* If the first load came back empty on a bad link, retry rather than sit there
     looking like the schedule is gone. */
  let tries = 0;
  const watchdog = setInterval(() => {
    if (++tries > 4 || S.meetings.length || !navigator.onLine) return clearInterval(watchdog);
    Store.loadAll({ fromCache: false });
  }, 5000);
}

function paintMe() {
  const btn = $('#meBtn');
  const hue = UI.hueOf(S.me);
  btn.textContent = UI.initials(S.me?.full_name || S.me?.short_name || '?');
  btn.style.background = `linear-gradient(150deg,hsl(${hue} 64% 52%),hsl(${(hue + 26) % 360} 58% 38%))`;
}
function paintEvent() {
  const e = UI.activeEvent();
  const line = e
    ? [e.short_name || e.name, e.city, e.stand ? 'Stand ' + e.stand : ''].filter(Boolean).join(' · ')
    : 'no event';
  $('#bmSub').textContent = line;
  $('#railEv').textContent = line;
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
  Store.resume();   /* a tap is a good moment to check the data is still current */
  if (V.tab === 'leads') V.q = V.q || '';
  /* All days parks V.day on 'all', so coming back to Today must restore the date */
  if (V.tab === 'today' && V.day === 'all') V.day = Views.defaultDay();
  render(); renderDayRail();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  UI.buzz(8);
});
$('#meBtn').onclick = () => { V.tab = 'me'; render(); renderDayRail(); };
$('#evBtn').innerHTML = I.chev;
$('#evBtn').onclick = () => Views.openSwitchEvent();
/* the wordmark behaves like a logo: always returns to today */
const goHome = () => {
  V.tab = 'today'; V.day = Views.defaultDay(); V.q = '';
  renderDayRail(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); UI.buzz(8);
};
$('#homeBtn').onclick = goHome;
$('#railHome').onclick = goHome;
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
    outList: () => Views.openOutcomeList(id),
    hardReload: async () => {
      try {
        if ('serviceWorker' in navigator) {
          const rs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(rs.map(r => r.update()));
        }
        if (window.caches) {
          const ks = await caches.keys();
          await Promise.all(ks.filter(k => k.indexOf('shell-') === 0).map(k => caches.delete(k)));
        }
      } catch (e) { /* a stale cache should never block the reload */ }
      location.reload();
    },
    lead: () => Views.openLead(id),
    voice: () => openVoice(el.dataset.tb || 'ev_meetings', id),
    selfie: () => openSelfie(el.dataset.tb || 'ev_meetings', id),
    wa: () => openWhatsApp(el.dataset.tb || 'ev_meetings', id),
    playVoice: async () => {
      const tb = el.dataset.tb || 'ev_meetings';
      const row = (tb === 'ev_leads' ? S.leads : S.meetings).find(r => r.id === id);
      const url = await Store.thumb(row?.voice_note_path);
      if (!url) return toast('Audio is still uploading', { kind: 'bad' });
      const a = el.closest('.vnote')?.querySelector('audio');
      if (a) { a.src = url; a.hidden = false; a.play().catch(() => {}); el.remove(); }
    },
    retranscribe: async () => {
      const tb = el.dataset.tb || 'ev_leads';
      const row = (tb === 'ev_leads' ? S.leads : S.meetings).find(r => r.id === id);
      const url = await Store.thumb(row?.voice_note_path);
      if (!url) return toast('Audio has not finished uploading', { kind: 'bad' });
      toast('Writing up the note');
      try {
        const blob = await (await fetch(url)).blob();
        let r;
        try { r = await Store.transcribe(blob); }
        catch (e1) { await new Promise(z => setTimeout(z, 900)); r = await Store.transcribe(blob); }
        const patch = { voice_transcript: r.transcript || null, updated_at: new Date().toISOString() };
        if (r.next_step && !row.next_step) patch.next_step = r.next_step;
        if (tb === 'ev_leads') await Store.updateLead(id, patch); else await Store.updateMeeting(id, patch);
        toast('Note written up', { kind: 'ok' }); render();
        if (tb === 'ev_leads') Views.openLead(id); else Views.openMeeting(id);
      } catch (e) { toast(String(e.message || e).slice(0, 90), { kind: 'bad' }); }
    },
    delVoice: async () => {
      const tb = el.dataset.tb || 'ev_meetings';
      const ok = await UI.confirmSheet({ title: 'Delete this voice note?', danger: true, ok: 'Delete',
        body: `<p class="hint" style="margin:0">The recording and the write-up both go. This cannot be undone.</p>` });
      if (!ok) return;
      await Store.clearMedia('voice', tb, id);
      toast('Voice note deleted'); render();
      if (tb === 'ev_leads') Views.openLead(id); else Views.openMeeting(id);
    },
    delSelfie: async () => {
      const tb = el.dataset.tb || 'ev_meetings';
      const ok = await UI.confirmSheet({ title: 'Delete this photo?', danger: true, ok: 'Delete',
        body: `<p class="hint" style="margin:0">This cannot be undone.</p>` });
      if (!ok) return;
      await Store.clearMedia('selfie', tb, id);
      toast('Photo deleted'); render();
      if (tb === 'ev_leads') Views.openLead(id); else Views.openMeeting(id);
    },
    zoom: async () => {
      const url = await Store.thumb(el.dataset.p) || el.dataset.p;
      if (!url) return;
      openSheet({ title: 'Photo', sub: el.dataset.who || '',
        body: `<img class="zoomimg" src="${url}" alt="Photo">`,
        foot: `<button class="btn ghost" data-x>Close</button><a class="btn" href="${url}" download>${I.download}Download</a>`,
        onMount(b, f) { f.querySelector('[data-x]').onclick = () => UI.closeSheet(); } });
    },
    resetMeeting: async () => {
      const m = S.meetings.find(x => x.id === id);
      if (!m) return;
      const prev = { outcome: m.outcome, status: m.status, deal_value_usd: m.deal_value_usd, next_step: m.next_step, next_step_due: m.next_step_due, outcome_notes: m.outcome_notes, met_at: m.met_at };
      closeSheet();
      await Store.updateMeeting(id, { ...Store.CLEAR, updated_at: new Date().toISOString() },
        { activity: { kind: 'reset', summary: `reset the record for ${m.company_name}` } });
      toast(`${m.company_name} is back to unlogged`, {
        action: 'Undo',
        onAction: () => Store.updateMeeting(id, { ...prev, updated_at: new Date().toISOString() })
          .then(() => { toast('Restored'); render(); })
      });
      render();
    },
    delMeeting: async () => {
      const m = S.meetings.find(x => x.id === id);
      if (!m) return;
      const ok = await UI.confirmSheet({
        title: 'Delete this record?', sub: m.company_name, danger: true, ok: 'Delete',
        body: `<p class="hint" style="margin:0">This removes the meeting and unlinks any card captured against it. The cards themselves stay in Leads. This cannot be undone.</p>`
      });
      if (!ok) return;
      await Store.deleteMeeting(id);
      closeSheet(); toast('Record deleted', { kind: 'ok' }); render(); Views.renderDayRail();
    },
    resetEvent: async () => {
      const added = S.meetings.filter(m => (m.source || 'sheet') !== 'sheet').length;
      const logged = S.meetings.filter(m => m.outcome || m.status !== 'scheduled').length;
      const ok = await UI.confirmSheet({
        title: 'Reset the event records?', sub: UI.activeEvent()?.name || '', danger: true, ok: 'Reset everything',
        body: `<p class="hint" style="margin:0 0 12px">Use this after a practice run. It clears what the team logged and leaves the booked sheet in place.</p>
          <div class="card" style="padding:4px 13px">
            <div class="drow"><span class="di">${I.undo}</span><span class="dv"><span class="k">Outcomes cleared</span><span class="v">${logged} meeting${logged === 1 ? '' : 's'} back to unlogged</span></span></div>
            <div class="drow"><span class="di">${I.trash}</span><span class="dv"><span class="k">Records deleted</span><span class="v">${added} walk-in${added === 1 ? '' : 's'} and added meeting${added === 1 ? '' : 's'}</span></span></div>
            <div class="drow"><span class="di">${I.card}</span><span class="dv"><span class="k">Contacts deleted</span><span class="v">${S.leads.length} card${S.leads.length === 1 ? '' : 's'}</span></span></div>
            <div class="drow"><span class="di">${I.calendar}</span><span class="dv"><span class="k">Kept</span><span class="v">All ${S.meetings.length - added} booked meetings and everyone's login</span></span></div>
          </div>
          <p class="hint" style="margin:12px 0 0;color:var(--dead)">This cannot be undone.</p>`
      });
      if (!ok) return;
      toast('Resetting the event');
      const r = await Store.resetEvent();
      V.tab = 'board'; render(); Views.renderDayRail(); refreshCounters();
      toast(`Reset done. ${r.cleared} outcome${r.cleared === 1 ? '' : 's'} cleared, ${r.added + r.leads} record${r.added + r.leads === 1 ? '' : 's'} removed.`, { kind: 'ok' });
    },
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
    camera: () => { pendingScanMeeting = null; pendingWalkin = false; openCamera(); },
    upload: () => { pendingScanMeeting = null; pendingWalkin = false; $('#filePick').click(); },
    manual: () => openReview({ fields: OCR.normalize({}), engine: 'manual' }, null),
    /* scanning from the Walk-ins tab logs the meeting too, not just the contact */
    scanWalkin: () => { pendingScanMeeting = null; pendingWalkin = true; openCamera(); },
    uploadWalkin: () => { pendingScanMeeting = null; pendingWalkin = true; $('#filePick').click(); },
    manualWalkinCard: () => { pendingWalkin = true; openReview({ fields: OCR.normalize({}), engine: 'manual' }, null); },
    scanFor: () => { pendingScanMeeting = id; closeSheet(); openCamera(); },
    clearQ: () => { V.q = ''; render(); },
    copy: () => UI.copy(el.dataset.v, 'Copied'),
    install: doInstall,
    refresh: () => { toast('Refreshing'); Store.loadAll({ fromCache: false }).then(() => { renderDayRail(); render(); }); },
    export: doExport,
    signout: doSignout,
    attend: async () => {
      const m = S.meetings.find(x => x.id === id);
      if (!m) return;
      const v = el.dataset.v;
      const prev = { status: m.status, outcome: m.outcome, met_at: m.met_at };
      const label = { met: 'Turned up', no_show: 'No show', rescheduled: 'Rescheduled', cancelled: 'Cancelled' }[v] || v;
      await Store.updateMeeting(id, {
        status: v,
        /* attendance and outcome must not contradict each other */
        outcome: v === 'no_show' ? 'no_show' : (v === 'met' ? m.outcome : null),
        met_at: v === 'met' ? (m.met_at || new Date().toISOString()) : null,
        updated_at: new Date().toISOString()
      }, { activity: { kind: 'status_' + v, summary: `marked ${m.company_name} ${label.toLowerCase()}` } });
      UI.buzz(14);
      /* they turned up, so the only question left is how it went */
      if (v === 'met') { Views.openOutcome(id, 2); render(); return; }
      closeSheet();
      toast(`${label} on ${m.company_name}`, {
        kind: 'ok', action: 'Undo',
        onAction: () => Store.updateMeeting(id, { ...prev, updated_at: new Date().toISOString() })
          .then(() => { toast('Reverted'); render(); })
      });
      render();
    },
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
      const l = S.leads.find(x => x.id === id);
      /* tapping the one already chosen clears it, so a misclick is one tap to fix */
      const v = l && l.interest === el.dataset.v ? null : el.dataset.v;
      await Store.updateLead(id, { interest: v, updated_at: new Date().toISOString() });
      if (!v) {
        el.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false'));
        toast('Outcome cleared'); render(); return;
      }
      el.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === el)));
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

/* ---------------- pull to refresh ---------------- */
/* Reaching for a browser reload is a tell that the app looked stale. Give the
   thumb the gesture it expects and refresh the data in place instead. */
(function pullToRefresh() {
  const el = document.createElement('div');
  el.className = 'ptr'; el.innerHTML = `<span class="ptr-s"></span>`;
  document.body.appendChild(el);
  let y0 = null, dy = 0, armed = false, busy = false;
  const TRIG = 72;
  const at_top = () => (window.scrollY || document.documentElement.scrollTop) <= 1;

  window.addEventListener('touchstart', e => {
    if (busy || !at_top() || e.touches.length !== 1 || !$('#sheet').hidden) return;
    y0 = e.touches[0].clientY; dy = 0; armed = true;
  }, { passive: true });

  window.addEventListener('touchmove', e => {
    if (!armed || y0 === null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0) { el.style.transform = ''; el.classList.remove('on', 'ready'); return; }
    const d = Math.min(dy * .5, 86);
    el.style.transform = `translate(-50%, ${d}px)`;
    el.classList.add('on');
    el.classList.toggle('ready', dy > TRIG);
  }, { passive: true });

  window.addEventListener('touchend', async () => {
    if (!armed) return;
    armed = false;
    const go = dy > TRIG;
    dy = 0;
    if (!go) { el.style.transform = ''; el.classList.remove('on', 'ready'); return; }
    busy = true;
    el.classList.add('spin');
    el.style.transform = 'translate(-50%, 54px)';
    UI.buzz(10);
    try { await Store.resume(true); } catch (_) {}
    await new Promise(r => setTimeout(r, 260));
    el.classList.remove('on', 'ready', 'spin');
    el.style.transform = '';
    busy = false;
  }, { passive: true });
})();

/* ---------------- voice notes ----------------
   A rep has thirty seconds between meetings. Record, stop, and the note writes
   itself. Everything is saved even when the transcript cannot be fetched. */
let recorder = null, recChunks = [], recTimer = null, recStart = 0, recStream = null;

function recMime() {
  const want = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/mpeg'];
  for (const t of want) if (window.MediaRecorder?.isTypeSupported?.(t)) return t;
  return '';
}

function stopRec() {
  if (recTimer) { clearInterval(recTimer); recTimer = null; }
  try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (e) {}
  if (recStream) recStream.getTracks().forEach(t => t.stop());
  recStream = null; recorder = null;
}

function clock(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function openVoice(table, id) {
  const isLead = table === 'ev_leads';
  const row = (isLead ? S.leads : S.meetings).find(r => r.id === id);
  if (!row) return;
  const who = isLead ? (row.company || row.full_name || 'this contact') : row.company_name;

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    return toast('This browser cannot record audio. Use Chrome or Safari.', { kind: 'bad' });
  }

  let blob = null, result = null, phase = 'idle', failed = false;

  openSheet({
    title: 'Record what happened', sub: who,
    body: `<div id="vcBody"></div>`,
    foot: `<button class="btn ghost" data-x>Cancel</button><button class="btn primary" id="vcSave" disabled>${I.check}Save to record</button>`,
    onMount(b, f) {
      const body = b.querySelector('#vcBody'), save = f.querySelector('#vcSave');
      f.querySelector('[data-x]').onclick = () => UI.closeSheet();

      const paint = () => {
        if (phase === 'idle') {
          body.innerHTML = `<button class="recbtn" id="vcGo">
              <span class="rb-dot"></span>
              <span class="rb-tx"><b>Start recording</b><i>Say what happened while it is fresh</i></span>
            </button>
            <p class="hint" style="margin:12px 2px 0">Up to ${Math.round(CFG.voiceMaxMs / 1000)} seconds. It gets written up for you and saved against ${UI.esc(who)}.</p>`;
          body.querySelector('#vcGo').onclick = go;
          save.disabled = true;
        } else if (phase === 'rec') {
          body.innerHTML = `<div class="reclive">
              <div class="rl-top"><span class="rl-live"><i></i>Recording</span><span class="rl-t" id="vcT">0:00</span></div>
              <div class="rl-bars" id="vcBars">${Array.from({ length: 28 }, () => '<i></i>').join('')}</div>
            </div>
            <button class="btn primary block" id="vcStop" style="margin-top:12px">${I.check}Stop and write it up</button>`;
          body.querySelector('#vcStop').onclick = () => stop();
          save.disabled = true;
        } else if (phase === 'work') {
          body.innerHTML = `<div class="ocrbar"><span class="sp"></span><span>Writing up your note</span></div>
            <div class="vcskel"><div class="skel" style="height:13px;width:92%"></div><div class="skel" style="height:13px;width:80%;margin-top:8px"></div><div class="skel" style="height:13px;width:86%;margin-top:8px"></div></div>`;
          save.disabled = true;
        } else {
          const t = result?.transcript || '';
          const warn = result ? ''
            : failed
              ? `<div class="ocrbar" data-s="warn">${I.alert}<span>Could not write it up. Save it, then tap Write it up on the record to try again.</span></div>`
              : `<div class="ocrbar" data-s="warn">${I.wifiOff}<span>Saved the audio. The write-up will run when you are back online.</span></div>`;
          body.innerHTML = `${warn}
            <audio class="vcaudio" controls src="${URL.createObjectURL(blob)}"></audio>
            ${result?.summary ? `<div class="vcsum">${I.sparkle}<span>${UI.esc(result.summary)}</span></div>` : ''}
            <div class="field">
              <label for="vcTx">What happened</label>
              <textarea class="input" id="vcTx" rows="7" placeholder="Type it yourself if you prefer">${UI.esc(t)}</textarea>
            </div>
            ${result?.next_step ? `<label class="chk"><input type="checkbox" id="vcNs" checked><span><b>Set the next step</b><i>${UI.esc(result.next_step)}</i></span></label>` : ''}
            <button class="btn ghost block" id="vcRedo" style="margin-top:4px">${I.refresh}Record again</button>`;
  body.querySelector('#vcRedo').onclick = () => { blob = null; result = null; failed = false; phase = 'idle'; paint(); };
          save.disabled = false;
        }
      };

      async function go() {
        try {
          recStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        } catch (e) {
          return toast(/NotAllowed|Permission/i.test(e.name + e.message)
            ? 'Your browser blocked the microphone. Allow it and try again.'
            : 'No microphone found.', { kind: 'bad' });
        }
        const mime = recMime();
        recChunks = [];
        recorder = new MediaRecorder(recStream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
        recorder.ondataavailable = e => { if (e.data && e.data.size) recChunks.push(e.data); };
        recorder.onstop = () => finish(recorder?.mimeType || mime);
        recorder.start(500);
        recStart = Date.now();
        phase = 'rec'; paint();
        UI.buzz(12);

        /* a cheap level meter, so it is obvious the mic is actually live */
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        if (ac.state === 'suspended') { try { await ac.resume(); } catch (e) {} }
        const an = ac.createAnalyser(); an.fftSize = 64;
        ac.createMediaStreamSource(recStream).connect(an);
        const buf = new Uint8Array(an.frequencyBinCount);
        /* On iOS the analyser often reports flat zeros while the recording is
           perfectly fine, so the meter is only trusted once it has actually
           heard something. Until then no warning, and the bars move on a timer
           so the sheet does not look broken. */
        let quiet = 0, warned = false, heard = false;
        recTimer = setInterval(() => {
          const ms = Date.now() - recStart;
          const t = $('#vcT'); if (t) t.textContent = clock(ms);
          an.getByteFrequencyData(buf);
          const peak = Math.max(...buf);
          if (peak >= 4) {
            heard = true; quiet = 0;
            if (warned) { const w = $('#vcQ'); if (w) w.remove(); warned = false; }
          } else if (heard) quiet++;
          /* it went quiet after we know the meter works, so the mic is covered */
          if (heard && quiet > 55 && !warned) {
            warned = true;
            const live = document.querySelector('.reclive');
            if (live) live.insertAdjacentHTML('afterend',
              `<p class="hint" id="vcQ" style="margin:10px 2px 0;color:var(--hot)">We stopped picking up sound. Check the microphone is not covered.</p>`);
          }
          const bars = $('#vcBars');
          if (bars) {
            const n = bars.children.length;
            for (let i = 0; i < n; i++) {
              const v = heard
                ? buf[Math.floor(i / n * buf.length)] / 255
                : 0.18 + 0.14 * Math.sin(ms / 260 + i * 0.5);
              bars.children[i].style.transform = `scaleY(${Math.max(0.08, Math.min(1, v * (heard ? 1.7 : 1)))})`;
            }
          }
          if (ms >= CFG.voiceMaxMs) { toast('Reached the time limit'); stop(); ac.close(); }
        }, 90);
      }

      function stop() {
        if (recTimer) { clearInterval(recTimer); recTimer = null; }
        phase = 'work'; paint();
        try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (e) { phase = 'idle'; paint(); }
      }

      async function finish(mime) {
        const ms = Date.now() - recStart;
        if (recStream) recStream.getTracks().forEach(t => t.stop());
        recStream = null;
        blob = new Blob(recChunks, { type: mime || 'audio/webm' });
        blob.__ms = ms;
        if (blob.size < 1200) { toast('That was too short', { kind: 'bad' }); phase = 'idle'; return paint(); }
        failed = false;
        if (!navigator.onLine) { result = null; phase = 'done'; return paint(); }
        /* one quiet retry: a cold function or a dropped packet should not cost the rep their note */
        try { result = await Store.transcribe(blob); }
        catch (e1) {
          await new Promise(r => setTimeout(r, 900));
          try { result = await Store.transcribe(blob); }
          catch (e2) { result = null; failed = true; toast(String(e2.message || e2).slice(0, 90), { kind: 'bad' }); }
        }
        phase = 'done'; paint();
      }

      save.onclick = async () => {
        if (!blob) return;
        const tx = ($('#vcTx')?.value || '').trim();
        const ns = $('#vcNs')?.checked && result?.next_step ? result.next_step : null;
        const extra = { voice_transcript: tx || null, voice_ms: Math.round(blob.__ms || 0), updated_at: new Date().toISOString() };
        if (ns && !row.next_step) extra.next_step = ns;
        UI.closeSheet();
        await Store.saveMedia('voice', table, id, blob, extra);
        Store.log('voice_note', `recorded a voice note on ${who}`, isLead ? { lead_id: id } : { meeting_id: id });
        toast('Voice note saved', { kind: 'ok', icon: 'note' });
        render();
      };

      paint();
    },
    onClose: stopRec
  });
}

/* ---------------- selfie ---------------- */
async function saveSelfie(table, id, blob) {
  const isLead = table === 'ev_leads';
  const row = (isLead ? S.leads : S.meetings).find(r => r.id === id);
  const who = isLead ? (row?.company || row?.full_name || 'this contact') : row?.company_name;
  closeSheet();
  toast('Saving the photo');
  await Store.saveMedia('selfie', table, id, blob, { updated_at: new Date().toISOString() });
  Store.log('selfie', `added a photo with ${who}`, isLead ? { lead_id: id } : { meeting_id: id });
  toast('Photo saved', { kind: 'ok', icon: 'image' });
  render();
}

let selfieTarget = null;

function openSelfie(table, id) {
  selfieTarget = { table, id };
  openCamera({
    title: 'Photo together', sub: 'Front camera, switch if you need the back',
    hint: 'Get both of you in frame. Switch to the back camera for a booth shot.',
    guide: false, facing: 'user', shot: 'Take photo', pickTo: '#selfiePick',
    onShot: blob => saveSelfie(table, id, blob)
  });
}

/* ---------------- whatsapp ----------------
   The number on a card is often local, and wa.me silently fails without a
   country code, so anything that does not look dialable gets fixed first. */
function waDigits(n) { return String(n || '').replace(/[^\d]/g, '').replace(/^0+/, ''); }
function waOk(n) {
  const d = waDigits(n);
  return d.length >= 10 && d.length <= 15 ? d : null;
}

function waOpen(n, who) {
  const d = waOk(n);
  if (!d) return false;
  window.open(`https://wa.me/${d}`, '_blank', 'noopener');
  if (who) toast(`Opening WhatsApp with ${who}`, { icon: 'phone' });
  return true;
}

function openWhatsApp(table, id) {
  const isLead = table === 'ev_leads';
  const row = (isLead ? S.leads : S.meetings).find(r => r.id === id);
  if (!row) return;
  const who = isLead ? (row.full_name || row.company || 'them') : (row.prospect_name || row.company_name);
  const field = isLead ? 'phone' : 'mobile';
  const have = row[field] || (isLead ? row.phone_2 : row.mobile_2) || '';

  if (waOpen(have, who)) return;

  /* no number, or one we cannot dial: ask for it, save it, then go */
  openSheet({
    title: have ? 'Check the number' : 'No number on file',
    sub: who,
    body: `<p class="hint" style="margin:0 0 14px">${have
      ? `We have <b>${UI.esc(have)}</b> for ${UI.esc(who)}, which is missing a country code. Fix it and WhatsApp opens straight away.`
      : `There is no phone number saved for ${UI.esc(who)}. Add it and WhatsApp opens straight away. It is saved to the record too.`}</p>
      <div class="field">
        <label for="waN">WhatsApp number</label>
        <input class="input" id="waN" type="tel" inputmode="tel" autocomplete="off" placeholder="+971 50 123 4567" value="${UI.esc(have)}">
      </div>
      <div class="ccrow">${['+971', '+91', '+44', '+1', '+966', '+65'].map(c => `<button class="ccbtn" data-cc="${c}">${c}</button>`).join('')}</div>
      <p class="hint" style="margin:12px 2px 0">Include the country code. Without it WhatsApp cannot find them.</p>`,
    foot: `<button class="btn ghost" data-x>Cancel</button><button class="btn primary" id="waGo" disabled>${I.phone}Save and open</button>`,
    onMount(b, f) {
      const inp = b.querySelector('#waN'), go = f.querySelector('#waGo');
      f.querySelector('[data-x]').onclick = () => UI.closeSheet();
      const check = () => { go.disabled = !waOk(inp.value); };
      inp.oninput = check; check();
      b.querySelectorAll('[data-cc]').forEach(btn => {
        btn.onclick = () => {
          const rest = waDigits(inp.value);
          const cc = waDigits(btn.dataset.cc);
          inp.value = btn.dataset.cc + ' ' + (rest.startsWith(cc) ? rest.slice(cc.length) : rest);
          check(); inp.focus();
        };
      });
      inp.onkeydown = e => { if (e.key === 'Enter' && !go.disabled) go.click(); };
      setTimeout(() => inp.focus(), 120);

      go.onclick = async () => {
        const v = inp.value.trim();
        UI.closeSheet();
        const patch = { [field]: v, updated_at: new Date().toISOString() };
        if (isLead) await Store.updateLead(id, patch); else await Store.updateMeeting(id, patch);
        render();
        waOpen(v, who);
      };
    }
  });
}

/* ---------------- live camera ----------------
   The native file input with capture=environment does nothing on a laptop, so
   every camera entry point now opens a real viewfinder via getUserMedia and only
   falls back to the file picker when there is no camera or no permission. */
let camStream = null, camDevs = [], camIdx = 0, camFacing = 'environment';

function stopCam() {
  if (camStream) camStream.getTracks().forEach(t => t.stop());
  camStream = null;
}

async function attachCam(deviceId) {
  stopCam();
  const want = deviceId
    ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1440 } }
    : { facingMode: { ideal: camFacing }, width: { ideal: 1920 }, height: { ideal: 1440 } };
  camStream = await navigator.mediaDevices.getUserMedia({ video: want, audio: false });
  const v = $('#camV');
  if (!v) { stopCam(); return; }
  v.srcObject = camStream;
  await v.play().catch(() => {});
  const track = camStream.getVideoTracks()[0];
  const facing = track.getSettings ? track.getSettings().facingMode : null;
  /* the front camera shows a mirrored preview, which is what people expect of a
     mirror but confusing when you are lining up text, so only flip the preview */
  v.classList.toggle('mir', facing === 'user' || (!facing && camFacing === 'user'));
  const label = $('#camLbl');
  if (!label) return;
  /* some devices report a raw hardware id instead of a name, which reads like
     noise, so only trust a label that looks like something a person wrote */
  const raw = (track.label || '').replace(/\s*\(.*\)$/, '').trim();
  const human = raw && raw.length < 34 && /\s/.test(raw) && !/^[A-Za-z0-9+/=_-]{20,}$/.test(raw);
  label.textContent = human ? raw
    : (facing === 'user' || (!facing && camFacing === 'user')) ? 'Front camera' : 'Back camera';
}

async function openCamera(opt = {}) {
  const o = {
    title: 'Scan a card', sub: 'Fill the frame, then shoot',
    hint: 'Landscape works best. Keep the whole card inside the frame.',
    guide: true, facing: 'environment', shot: 'Capture',
    onShot: blob => runScan(new File([blob], 'card.jpg', { type: 'image/jpeg' })),
    ...opt
  };
  camFacing = o.facing;
  if (!navigator.mediaDevices?.getUserMedia) return $(o.pickTo || '#camPick').click();

  openSheet({
    title: o.title, sub: o.sub,
    body: `<div class="camwrap${o.guide ? '' : ' plain'}">
        <video id="camV" playsinline autoplay muted></video>
        ${o.guide ? '<div class="camguide"><span></span></div>' : ''}
        <div class="camtop"><span class="campill" id="camLbl">Starting the camera</span></div>
      </div>
      <p class="hint" id="camHint" style="margin:10px 2px 0">${o.hint}</p>`,
    foot: `<button class="btn ghost" id="camSwap" title="Switch camera">${I.refresh}Switch</button>
           <button class="btn primary" id="camShot" disabled>${I.camera}${o.shot}</button>`,
    onMount(b, f) {
      const shot = f.querySelector('#camShot'), swap = f.querySelector('#camSwap');

      navigator.mediaDevices.enumerateDevices()
        .then(ds => {
          camDevs = ds.filter(d => d.kind === 'videoinput');
          if (camDevs.length < 2) swap.style.display = 'none';
        })
        .catch(() => { swap.style.display = 'none'; });

      attachCam().then(() => { shot.disabled = false; }).catch(err => {
        stopCam();
        const denied = err && /NotAllowed|Permission/i.test(err.name + err.message);
        b.querySelector('.camwrap').innerHTML =
          `<div class="camfail">${I.alert}<span>${denied
            ? 'Your browser blocked the camera. Allow it in the address bar, or pick a photo instead.'
            : 'No camera found on this device.'}</span></div>`;
        const h = b.querySelector('#camHint');
        if (h) h.remove();
        swap.style.display = 'none';
        shot.disabled = false;
        shot.innerHTML = `${I.image}Pick a photo`;
        shot.onclick = () => { closeSheet(); $(o.pickTo || '#filePick').click(); };
      });

      swap.onclick = async () => {
        shot.disabled = true;
        camFacing = camFacing === 'environment' ? 'user' : 'environment';
        try {
          if (camDevs.length > 1) { camIdx = (camIdx + 1) % camDevs.length; await attachCam(camDevs[camIdx].deviceId); }
          else await attachCam();
        } catch (e) { toast('Could not switch camera', { kind: 'bad' }); }
        shot.disabled = false;
      };

      shot.onclick = () => {
        const v = $('#camV');
        if (!v || !v.videoWidth) return toast('Camera is still starting', { kind: 'bad' });
        const c = document.createElement('canvas');
        c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext('2d').drawImage(v, 0, 0);
        UI.buzz(16);
        c.toBlob(blob => {
          if (!blob) return toast('Capture failed. Try again.', { kind: 'bad' });
          stopCam();
          o.onShot(blob);
        }, 'image/jpeg', 0.92);
      };
    },
    onClose: stopCam
  });
}

/* ---------------- scan flow ---------------- */
$('#selfiePick').addEventListener('change', async ev => {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file || !selfieTarget) return;
  await saveSelfie(selfieTarget.table, selfieTarget.id, file);
});

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
  const asWalkin = pendingWalkin && !mtgId;
  let interest = null;
  let linkTo = mtgId || null;

  const fake = { company: f.company, email: f.email, website: f.website, full_name: f.full_name };
  const cands = Views.matchMeetings(fake).slice(0, 3);
  /* a walk-in is by definition not on the sheet, so we never auto-link one */
  if (!asWalkin && !linkTo && cands.length && cands[0].score >= 50) linkTo = cands[0].m.id;

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
        <span class="mi">${I.handshake}</span>
        <span class="mb"><span class="m1">${asWalkin ? 'Log it as a walk-in' : 'Keep it standalone'}</span><span class="m2">Not on the sheet, picked up on the floor</span></span>
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
      ${OUTCOMES.filter(o => o.v !== 'no_show').map(o => `<button class="outbtn" data-v="${o.v}" aria-pressed="false">
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
    title: asWalkin ? 'Log a walk-in' : 'Check the details',
    sub: f.full_name || f.company || 'New contact', body,
    foot: `<button class="btn ghost" data-x>Discard</button><button class="btn primary" data-save>${asWalkin ? 'Log walk-in' : 'Save contact'}</button>`,
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
      if (re) re.onclick = ev => {
        ev.preventDefault(); ev.stopPropagation();
        closeSheet();
        /* closing resets the flags, so carry the walk-in intent through a retake */
        pendingWalkin = asWalkin;
        openCamera();
      };

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

        /* scanned from the Walk-ins tab and not matched to a booked slot:
           create the meeting too, so it lands on the walk-in list with an outcome */
        let madeWalkin = null;
        if (asWalkin && !linkTo) {
          const now = UI.nowInTz();
          const days = Views.eventDays ? Views.eventDays() : [];
          madeWalkin = await Store.addMeeting({
            company_name: co || name || 'Walk-in',
            meeting_date: days.length && !days.includes(now.date) ? days[0] : now.date,
            meeting_time: String(Math.floor(now.min / 60)).padStart(2, '0') + ':' + String(now.min % 60).padStart(2, '0'),
            prospect_name: name, designation: g('#r_title'),
            email: em ? em.toLowerCase() : null, mobile: g('#r_phone'),
            geo_region: g('#r_region'), category: 'New Business',
            owner_id: S.me?.user_id || null, owner_name: S.me?.short_name || null,
            location: 'Our stand', comments: g('#r_notes'),
            source: 'walkin', status: 'met', duration_min: 15,
            outcome: interest || null,
            met_at: new Date().toISOString()
          });
          linkTo = madeWalkin.id;
        }

        const lead = await Store.saveLead({
          full_name: name, designation: g('#r_title'), company: co,
          email: em ? em.toLowerCase() : null, phone: g('#r_phone'), phone_2: g('#r_phone2'),
          website: g('#r_web'), linkedin: f.linkedin || null, address: f.address || null,
          geo_region: g('#r_region'), notes: g('#r_notes'),
          interest, next_step: g('#r_next'), next_step_due: g('#r_due'),
          meeting_id: linkTo || null,
          ocr_text: f.raw_text || null, ocr_provider: res.engine || null
        }, blobs);

        if (linkTo && interest && !madeWalkin) {
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
        if (madeWalkin) {
          toast(`${co || name || 'Walk-in'} logged`, {
            kind: 'ok', action: interest ? 'Open' : 'Outcome',
            onAction: () => interest ? Views.openLead(lead.id) : Views.openOutcome(madeWalkin.id)
          });
          renderDayRail();
        } else {
          toast(`${name || co || 'Contact'} saved`, { kind: 'ok', action: 'Open', onAction: () => Views.openLead(lead.id) });
        }
        pendingScanMeeting = null;
        pendingWalkin = false;
        render();
      };
    },
    onClose() { pendingScanMeeting = null; pendingWalkin = false; }
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
