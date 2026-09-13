/* ============================================================
   Vervotech Showdown — screens
   ============================================================ */

const V = {
  tab: 'today',
  day: null,          // 'YYYY-MM-DD' | 'all'
  scope: 'mine',      // mine | team
  leadFilter: 'all',
  wkScope: 'mine',    // mine | team, walk-ins tab
  q: '',
  boardDay: 'event',  // event | day
  boardPane: 'board'  // board | team, admins only
};
window.V = V;

/* ---------------- selectors ---------------- */
const meId = () => S.me?.user_id || null;

/* Two distinct relationships to a meeting:
   owner_id = the person in the room (sheet column "Meeting with")
   rep_id   = the inside-sales rep who booked it (sheet column "IS Rep")
   Reps do not attend, so they must never be counted as attendees. */
const attendsIt = m => m.owner_id === meId();
const bookedIt = m => m.rep_id === meId();
const amRep = () => S.me?.role === 'rep';
/* "my" means attending for leadership, booked for reps */
const isMine = m => (amRep() ? bookedIt(m) : attendsIt(m));
const myLabel = () => (amRep() ? 'Booked by me' : 'My meetings');

function eventDays() {
  const e = UI.activeEvent();
  const out = [];
  if (e) {
    const [y1, m1, d1] = e.starts_on.split('-').map(Number);
    const [y2, m2, d2] = e.ends_on.split('-').map(Number);
    let c = Date.UTC(y1, m1 - 1, d1);
    const end = Date.UTC(y2, m2 - 1, d2);
    let guard = 0;
    while (c <= end && guard++ < 40) {
      out.push(new Date(c).toISOString().slice(0, 10));
      c += 86400000;
    }
  }
  S.meetings.forEach(m => { if (m.meeting_date && !out.includes(m.meeting_date)) out.push(m.meeting_date); });
  return out.sort();
}

/* The real calendar date is only the right landing day while the show is on.
   Before and after it, Today must fall back to a day the event actually has,
   or every screen reads as empty with the data sitting right there. */
function defaultDay() {
  const days = eventDays();
  const today = UI.nowInTz().date;
  return days.includes(today) ? today : (days[0] || 'all');
}

function scoped(list) { return V.scope === 'mine' ? list.filter(isMine) : list; }
function dayFilter(list, day) { return day && day !== 'all' ? list.filter(m => m.meeting_date === day) : list; }

function liveInfo(m) {
  const now = UI.nowInTz();
  if (m.meeting_date !== now.date) return 0;
  const st = UI.toMin(m.meeting_time);
  if (st == null) return 0;
  const en = st + (m.duration_min || 30);
  if (now.min >= st && now.min < en) return 1;
  return 0;
}
/* Two steps on purpose: did they turn up, then how did it go. Asking for a
   commercial call on a meeting that never happened was the old mistake. */
const ATTEND = [
  { v: 'met',         label: 'They turned up',  short: 'Turned up',   desc: 'Sat down and had the conversation', icon: 'handshake' },
  { v: 'no_show',     label: 'No show',         short: 'No show',     desc: 'Booked but never arrived',          icon: 'ban' },
  { v: 'rescheduled', label: 'Rescheduled',     short: 'Rescheduled', desc: 'Moving to another slot',            icon: 'clock' },
  { v: 'cancelled',   label: 'Cancelled',       short: 'Cancelled',   desc: 'Called off before the show',        icon: 'x' }
];
const CALLS = OUTCOMES.filter(o => o.v !== 'no_show');

function isDone(m) { return !!m.outcome || ['no_show', 'rescheduled', 'cancelled'].includes(m.status); }

function leadsFor(meetingId) { return S.leads.filter(l => l.meeting_id === meetingId); }

/* ---------------- day rail ---------------- */
function renderDayRail() {
  const rail = UI.$('#dayrail');
  const days = eventDays();
  const today = UI.nowInTz().date;
  if (!V.day || !(days.includes(V.day) || V.day === 'all')) V.day = defaultDay();

  const counts = {};
  scoped(S.meetings).forEach(m => { counts[m.meeting_date] = (counts[m.meeting_date] || 0) + 1; });
  const total = scoped(S.meetings).length;

  rail.innerHTML =
    days.map(d => {
      const p = UI.dParts(d);
      const n = counts[d] || 0;
      return `<button class="daychip${d === today ? ' today' : ''}" data-day="${d}" aria-selected="${d === V.day}">
        <span class="dc-1">${p.dow}</span>
        <span class="dc-2 mono">${String(p.day).padStart(2, '0')}</span>
        <span class="dc-3">${n} mtg${n === 1 ? '' : 's'}</span>
      </button>`;
    }).join('') +
    `<button class="daychip all" data-day="all" aria-selected="${V.day === 'all'}">
       <span class="dc-1">All</span>
       <span class="dc-2 mono">${total}</span>
       <span class="dc-3">mtg${total === 1 ? '' : 's'}</span>
     </button>`;

  const sel = rail.querySelector('[aria-selected="true"]');
  if (sel) sel.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  rail.hidden = !(V.tab === 'today' || V.tab === 'board');
}

/* ============================================================
   TODAY
   ============================================================ */
function viewToday() {
  const all = dayFilter(scoped(S.meetings), V.day);
  /* Scope counts are event-wide on purpose: the segmented control picks WHO,
     the day rail above it picks WHEN. Day-scoping both made "Whole team"
     read as one day's load instead of the full book of business. */
  const mineN = S.meetings.filter(isMine).length;
  const teamN = S.meetings.length;

  const allDays = V.day === 'all';
  const sorted = [...all].sort((a, b) => {
    /* across the whole event, day is the primary key or the days interleave */
    if (allDays && a.meeting_date !== b.meeting_date)
      return String(a.meeting_date).localeCompare(String(b.meeting_date));
    const ta = UI.toMin(a.meeting_time), tb = UI.toMin(b.meeting_time);
    if (ta == null && tb == null) return (a.company_name || '').localeCompare(b.company_name || '');
    if (ta == null) return 1;
    if (tb == null) return -1;
    return ta - tb || (a.seq || 0) - (b.seq || 0);
  });

  const live = sorted.find(m => liveInfo(m));
  const now = UI.nowInTz();
  const next = sorted.find(m => m.meeting_date === now.date && UI.toMin(m.meeting_time) > now.min && !isDone(m));

  const logged = sorted.filter(isDone).length;
  const c = { deal: 0, hot: 0, nurture: 0, bad: 0 };
  sorted.forEach(m => {
    if (m.outcome === 'deal') c.deal++;
    else if (m.outcome === 'future_opportunity') c.hot++;
    else if (m.outcome === 'nurture') c.nurture++;
    else if (m.outcome) c.bad++;
  });
  const T = Math.max(1, sorted.length);

  let html = `
  <div class="segs" style="margin-bottom:14px" role="tablist">
    <button role="tab" data-scope="mine" aria-selected="${V.scope === 'mine'}">${myLabel()} · ${mineN}</button>
    <button role="tab" data-scope="team" aria-selected="${V.scope === 'team'}">Whole team · ${teamN}</button>
  </div>`;

  if (live) html += nowCard(live, 'On now');
  else if (next) html += nowCard(next, 'Up next');

  if (sorted.length) {
    html += `<div class="daysum">
      <div class="prog">
        <i class="d" style="width:${c.deal / T * 100}%"></i>
        <i class="h" style="width:${c.hot / T * 100}%"></i>
        <i class="n" style="width:${c.nurture / T * 100}%"></i>
        <i class="x" style="width:${c.bad / T * 100}%"></i>
      </div>
      <div class="ln">
        <span class="n">${logged}<i>/${sorted.length}</i></span>
        <span class="lb">logged${V.day === 'all' ? '' : ' · ' + UI.fmtDate(V.day)}</span>
        <span class="sp"></span>
        ${c.deal ? `<span class="k deal">${c.deal} deal${c.deal === 1 ? '' : 's'}</span>` : ''}
        ${c.hot ? `<span class="k hot">${c.hot} future</span>` : ''}
        ${c.nurture ? `<span class="k nur">${c.nurture} nurture</span>` : ''}
        ${c.bad ? `<span class="k bad">${c.bad} closed</span>` : ''}
      </div>
    </div>`;
  }

  if (!sorted.length && S.loadFailed) {
    /* never let a failed fetch masquerade as a clear day */
    html += UI.emptyState('alert', 'Could not load the schedule',
      'The connection dropped while fetching meetings. Nothing is lost. Pull the sync pill to try again.',
      { act: 'retryLoad', label: 'Try again', icon: 'refresh' });
  } else if (!sorted.length) {
    html += UI.emptyState('calendar',
      V.scope === 'mine' ? (amRep() ? 'Nothing you booked on this day' : 'Nothing on your name') : 'No meetings this day',
      V.scope === 'mine'
        ? (amRep()
            ? 'Switch to the whole team to follow the floor, or pick another day from the rail.'
            : 'Switch to the whole team, pick another day, or add a walk-in you just picked up.')
        : 'Pick another day from the rail above, or add a walk-in.',
      { act: 'addMeeting', label: 'Add a walk-in', icon: 'plus' });
  } else {
    /* one day per group across the whole event, one time slot per group
       within a single day */
    let lastKey = null;
    html += '<div class="agenda">';
    sorted.forEach(m => {
      const key = allDays ? m.meeting_date : UI.slotOf(m.meeting_time);
      if (key !== lastKey) {
        if (lastKey !== null) html += '</div>';
        lastKey = key;
        const isNowGrp = allDays
          ? m.meeting_date === now.date
          : !!(live && UI.slotOf(live.meeting_time) === key);
        const label = allDays ? UI.fmtDate(m.meeting_date) : key;
        const n = sorted.filter(x => (allDays ? x.meeting_date : UI.slotOf(x.meeting_time)) === key).length;
        html += `<div class="slot-h${isNowGrp ? ' now' : ''}">
          <span class="t">${UI.esc(label)}</span><span class="ln"></span>
          ${allDays ? `<span class="ct">${n}</span>` : (isNowGrp ? '<span class="live">LIVE</span>' : '')}
        </div><div class="slotsheet">`;
      }
      html += meetingCard(m);
    });
    if (lastKey !== null) html += '</div>';
    html += '</div>';
    html += `<button class="btn ghost block" data-act="addMeeting" style="margin-top:6px">${I.plus}Add a walk-in meeting</button>`;
  }
  return html;
}

/* The whole event in one list. Same rows, no day filter, so a rep can see the
   full book without stepping through the rail. */
function viewAgenda() {
  V.day = 'all';
  return viewToday();
}

function nowCard(m, label) {
  const t = UI.fmtTimeStr(m.meeting_time);
  const own = UI.memberById(m.owner_id), rep = UI.memberById(m.rep_id);
  return `<div class="nowcard">
    <div class="lbl"><span class="bl"></span>${UI.esc(label)}</div>
    <h3>${UI.esc(m.company_name)}</h3>
    <div class="sub">${UI.esc([t, m.prospect_name, m.geo_region].filter(Boolean).join(' · '))}</div>
    <div style="display:flex;gap:5px;margin-top:9px;flex-wrap:wrap;align-items:center">
      ${own ? UI.avatar(own, 'xs') : ''}${rep && rep.user_id !== own?.user_id ? UI.avatar(rep, 'xs') : ''}
      ${m.category ? `<span class="tag">${UI.esc(m.category)}</span>` : ''}
      ${m.outcome ? UI.tagFor(m.outcome) : ''}
    </div>
    <div class="acts">
      <button class="btn primary" data-act="outcome" data-id="${m.id}">${I.check}${m.outcome ? 'Update call' : 'Log outcome'}</button>
      <button class="btn" data-act="voice" data-id="${m.id}" data-tb="ev_meetings">${I.mic}${m.voice_note_path ? 'Re-record' : 'Record'}</button>
    </div>
  </div>`;
}

function meetingCard(m) {
  const f = UI.fmtTime(m.meeting_time);
  const own = UI.memberById(m.owner_id) || UI.memberByName(m.owner_name);
  const rep = UI.memberById(m.rep_id) || UI.memberByName(m.rep_name);
  const lc = leadsFor(m.id).length;
  const mine = isMine(m);
  /* One quiet descriptor line instead of four competing pills. Anything
     categorical becomes small-caps text; only an outcome earns colour. */
  const facts = [
    m.geo_region,
    m.category ? shortCat(m.category) : '',
    m.duration_min && m.duration_min !== 30 ? m.duration_min + ' min' : ''
  ].filter(Boolean);

  return `<button class="mtg" data-act="meeting" data-id="${m.id}"
      data-outcome="${m.outcome || ''}" data-live="${liveInfo(m)}" data-done="${isDone(m) ? 1 : 0}"
      data-mine="${mine ? 1 : 0}">
    <span class="tcol">
      <span class="hm">${f.hm}</span>
      <span class="ap">${f.ap || (m.meeting_time ? '' : 'TBD')}</span>
    </span>
    <span class="body">
      <span class="top">
        <span class="co">
          ${m.priority ? '<span class="pri" aria-label="Priority"></span>' : ''}
          <span class="nm">${UI.esc(m.company_name)}</span>
        </span>
        <span class="tail">
          ${m.outcome ? UI.tagFor(m.outcome)
            : (m.status !== 'scheduled'
              ? `<span class="tag"><span class="statedot ${m.status}"></span>${UI.esc(m.status.replace('_', ' '))}</span>`
              : '')}
          ${lc ? `<span class="tag brand">${I.card}${lc}</span>` : ''}
          ${own && (V.scope === 'team' || amRep()) ? UI.avatar(own, 'xs') : ''}
        </span>
      </span>
      ${(m.prospect_name || m.designation || facts.length) ? `<span class="sub">
        ${m.prospect_name || m.designation ? `<span class="who">${UI.esc([m.prospect_name, m.designation].filter(Boolean).join(' · '))}</span>` : ''}
        ${facts.length ? `<span class="fx">${facts.map(UI.esc).join('<i>·</i>')}</span>` : ''}
      </span>` : ''}
    </span>
  </button>`;
}
function shortCat(c) {
  return String(c).replace('Existing Business', 'Existing').replace('New Business', 'New').replace('Existing + New', 'Exist + New').replace('Existing Deal', 'Open deal');
}

/* ============================================================
   LEADS
   ============================================================ */
function viewLeads() {
  const q = V.q.trim().toLowerCase();
  let list = [...S.leads];
  if (V.leadFilter === 'mine') list = list.filter(l => l.captured_by === meId());
  else if (V.leadFilter !== 'all') list = list.filter(l => l.interest === V.leadFilter);
  if (q) {
    list = list.filter(l => [l.full_name, l.company, l.email, l.designation, l.phone, l.notes, l.geo_region]
      .some(v => v && String(v).toLowerCase().includes(q)));
  }

  const counts = {
    all: S.leads.length,
    mine: S.leads.filter(l => l.captured_by === meId()).length,
    deal: S.leads.filter(l => l.interest === 'deal').length,
    hot: S.leads.filter(l => l.interest === 'future_opportunity').length
  };

  let html = `
  <div class="leadtop">
    <div class="searchwrap">${I.search}
      <input class="input" id="leadQ" type="search" placeholder="Search prospects" value="${UI.esc(V.q)}"
        autocomplete="off" autocapitalize="none" spellcheck="false">
      ${V.q ? `<button class="clr" data-act="clearQ" aria-label="Clear">${I.x}</button>` : ''}
    </div>
    <button class="addlead" data-act="manual" aria-label="Add a prospect by hand">${I.plus}<span>Add</span></button>
  </div>
  <div class="segs" style="margin-bottom:14px">
    <button data-lf="all" aria-selected="${V.leadFilter === 'all'}">All · ${counts.all}</button>
    <button data-lf="mine" aria-selected="${V.leadFilter === 'mine'}">Mine · ${counts.mine}</button>
    <button data-lf="deal" aria-selected="${V.leadFilter === 'deal'}">Deal · ${counts.deal}</button>
    <button data-lf="future_opportunity" aria-selected="${V.leadFilter === 'future_opportunity'}">Future · ${counts.hot}</button>
    <button data-lf="nurture" aria-selected="${V.leadFilter === 'nurture'}">Nurture · ${S.leads.filter(l => l.interest === 'nurture').length}</button>
  </div>`;

  if (!list.length) {
    html += S.leads.length
      ? UI.emptyState('search', 'Nothing matches', 'Try a shorter search, or clear the filter.')
      : UI.emptyState('card', 'No prospects yet', 'Scan a business card, or add one by hand if the card is missing.',
        { act: 'goScan', label: 'Scan a card', icon: 'scan' },
        { act: 'manual', label: 'Add by hand', icon: 'edit' });
    return html;
  }

  html += list.map(leadCard).join('');
  if (list.length > 6) html += `<div class="hint" style="text-align:center;margin-top:10px">${list.length} contacts</div>`;
  return html;
}

function leadCard(l) {
  const who = UI.memberById(l.captured_by);
  const mtg = l.meeting_id ? S.meetings.find(m => m.id === l.meeting_id) : null;
  const img = l._local_front || (l.card_front_path ? (S.thumbs[l.card_front_path] || '') : '');
  return `<button class="lead" data-act="lead" data-id="${l.id}" data-i="${l.interest || ''}">
    ${img
      ? `<img class="thumb" src="${UI.esc(img)}" alt="" loading="lazy">`
      : `<span class="thumb ph" data-thumb="${UI.esc(l.card_front_path || '')}">${I.card}</span>`}
    <span class="body">
      <span class="nm">${UI.esc(l.full_name || 'Unnamed contact')}</span>
      <span class="co2">${UI.esc([l.designation, l.company].filter(Boolean).join(' · ') || l.email || '')}</span>
      <span class="meta">
        ${l.interest ? UI.tagFor(l.interest) : '<span class="tag">Unrated</span>'}
        ${mtg ? `<span class="tag brand">${I.link}Meeting</span>` : ''}
        ${l.geo_region ? `<span class="tag">${UI.esc(l.geo_region)}</span>` : ''}
        ${l._dirty || l.synced === false ? `<span class="tag hot">${I.refresh}Queued</span>` : ''}
        ${who && l.captured_by !== meId() ? UI.avatar(who, 'xs') : ''}
        <span class="tag" style="background:none;border:0;color:var(--tx-3);padding:0">${UI.esc(UI.ago(l.created_at))}</span>
      </span>
    </span>
    <span class="chev" style="align-self:center;color:var(--tx-3)">${I.chev}</span>
  </button>`;
}

/* ============================================================
   WALK-INS — floor pickups that were never on the sheet
   ============================================================ */
function viewWalkins() {
  const all = S.meetings.filter(m => m.source === 'walkin');
  const list = (V.wkScope === 'team' ? all : all.filter(isMine))
    .slice()
    .sort((a, b) => (b.meeting_date + (b.start_time || '')).localeCompare(a.meeting_date + (a.start_time || '')));

  const open = list.filter(m => !isDone(m)).length;
  const logged = list.length - open;

  let html = `
  <div class="wkcap">
    <button class="wkscan" data-act="scanWalkin">
      <span class="ws-i">${I.scan}</span>
      <span class="ws-t"><b>Scan their card</b><i>We read it and log the walk-in for you</i></span>
      ${I.chev}
    </button>
    <div class="wkalt">
      <button data-act="uploadWalkin">${I.image}Use a photo</button>
      <button data-act="addMeeting">${I.edit}Type it in</button>
    </div>
  </div>

  <div class="segs" style="margin:0 0 12px">
    <button data-wk="mine" aria-selected="${V.wkScope !== 'team'}">${amRep() ? 'Booked by me' : 'Mine'} · ${all.filter(isMine).length}</button>
    <button data-wk="team" aria-selected="${V.wkScope === 'team'}">Whole team · ${all.length}</button>
  </div>`;

  if (!list.length) {
    html += UI.emptyState('handshake', 'No walk-ins yet',
      'Someone stops at the stand who is not on the sheet? Scan their card above and the meeting logs itself.');
    return html;
  }

  html += `<div class="wkstat">
    <span><b>${open}</b> to log</span><span class="sep"></span><span><b>${logged}</b> logged</span>
  </div>`;

  html += list.map(m => `<div class="wkrow ${isDone(m) ? 'done' : ''}">
    ${meetingCard(m)}
    <button class="wkout" data-act="outcome" data-id="${m.id}">
      ${I.check}${m.outcome ? 'Update outcome' : 'Mark outcome'}
    </button>
  </div>`).join('');
  return html;
}

/* ============================================================
   SCAN
   ============================================================ */
function viewScan() {
  const recent = S.leads.filter(l => l.captured_by === meId()).slice(0, 4);
  const ocr = S.ocrConfigured;
  return `
  <div class="scanhero">
    <div class="ill">${I.card}</div>
    <h2>Scan a business card</h2>
    <p>Point the camera at the card. Name, title, company, email and phone come back filled in, ready for you to check. Works on your laptop webcam too.</p>
    <div class="acts">
      <button class="btn primary block" data-act="camera">${I.camera}Open camera</button>
      <button class="btn ghost block" data-act="upload">${I.image}Pick from photos</button>
      <button class="btn ghost block" data-act="manual">${I.edit}Type it in instead</button>
    </div>
  </div>
  <div class="ocrbar" data-s="${ocr === false ? 'warn' : 'ok'}">
    ${ocr === false ? I.alert : I.sparkle}
    <span>${ocr === false
      ? 'AI reading is not switched on yet. Cards are still read on your device.'
      : 'AI card reading is live. Works offline too, cards queue and sync.'}</span>
  </div>
  ${recent.length ? `<div class="sec">
    <div class="sec-h"><h2>Your recent captures</h2><span class="count">${recent.length}</span></div>
    ${recent.map(leadCard).join('')}
  </div>` : ''}`;
}

/* ============================================================
   BOARD
   ============================================================ */
function boardTabs() {
  if (!Store.isAdmin()) return '';
  return `<div class="segs" style="margin-bottom:12px" role="tablist">
    <button role="tab" data-bp="board" aria-selected="${V.boardPane !== 'team'}">Numbers</button>
    <button role="tab" data-bp="team" aria-selected="${V.boardPane === 'team'}">Team</button>
  </div>`;
}

function viewBoard() {
  if (Store.isAdmin() && V.boardPane === 'team') return boardTabs() + teamPane();
  const inDay = V.boardDay === 'day' && V.day !== 'all';
  const mtgs = inDay ? S.meetings.filter(m => m.meeting_date === V.day) : S.meetings;
  const leads = inDay ? S.leads.filter(l => {
    const m = l.meeting_id && S.meetings.find(x => x.id === l.meeting_id);
    return m ? m.meeting_date === V.day : String(l.created_at || '').slice(0, 10) === V.day;
  }) : S.leads;

  const logged = mtgs.filter(m => m.outcome);
  /* a contact attached to a meeting is already counted through that meeting,
     so only standalone captures are added to the event totals */
  const solo = leads.filter(l => !l.meeting_id && l.interest);
  const grpOf = v => OUT_MAP[v]?.grp;
  const byGrp = g => [...mtgs.filter(m => grpOf(m.outcome) === g), ...solo.filter(l => grpOf(l.interest) === g)];
  const deals = byGrp('created');
  const open = byGrp('open');
  const dropped = byGrp('dropped');
  const missed = byGrp('missed');
  const dealVal = deals.reduce((s, m) => s + (Number(m.deal_value_usd) || 0), 0);
  const openVal = open.reduce((s, m) => s + (Number(m.deal_value_usd) || 0), 0);
  const handled = logged.length + solo.length;
  const totalRecs = mtgs.length + leads.filter(l => !l.meeting_id).length;

  /* leaderboard */
  const rows = S.members.map(mem => {
    const isRep = mem.role === 'rep';
    const mine = mtgs.filter(m => (isRep ? m.rep_id : m.owner_id) === mem.user_id);
    const cnt = g => mine.filter(m => m.outcome && OUT_MAP[m.outcome]?.grp === g).length;
    return {
      mem, isRep, total: mine.length,
      logged: mine.filter(isDone).length,
      deal: cnt('created'), open: cnt('open'), missed: cnt('missed'), bad: cnt('dropped'),
      cards: leads.filter(l => l.captured_by === mem.user_id).length,
      value: mine.filter(m => m.outcome === 'deal').reduce((s, m) => s + (Number(m.deal_value_usd) || 0), 0)
    };
  }).filter(r => r.total || r.cards)
    .sort((a, b) => (b.deal - a.deal) || (b.logged - a.logged) || (b.cards - a.cards) || (b.total - a.total));

  const floor = rows.filter(r => !r.isRep);
  const booked = rows.filter(r => r.isRep);
  const regions = tally(mtgs, m => m.geo_region || 'Unspecified');
  const cats = tally(mtgs, m => m.category ? shortCat(m.category) : 'Unspecified');

  return boardTabs() + `
  <div class="segs" style="margin-bottom:14px">
    <button data-bd="event" aria-selected="${V.boardDay === 'event'}">Whole event</button>
    <button data-bd="day" aria-selected="${V.day === 'all' ? 'false' : String(V.boardDay === 'day')}">${V.day === 'all' ? 'Single day' : UI.fmtDate(V.day)}</button>
  </div>

  <div class="kpis">
    <div class="kpi brand"><div class="k">Everything logged</div><div class="v tnum">${handled}</div><div class="d">of ${totalRecs} record${totalRecs === 1 ? '' : 's'} · ${mtgs.length} meeting${mtgs.length === 1 ? '' : 's'}, ${leads.length} card${leads.length === 1 ? '' : 's'}</div></div>
    <div class="kpi deal"><div class="k">Deals created</div><div class="v tnum">${deals.length}</div><div class="d">${deals.length ? UI.money(dealVal) + ' in play' : 'none recorded yet'}</div></div>
    <div class="kpi hot"><div class="k">Still in play</div><div class="v tnum">${open.length}</div><div class="d">${openVal ? UI.money(openVal) + ' behind them' : 'future and nurture'}</div></div>
    <div class="kpi bad"><div class="k">Closed out</div><div class="v tnum">${dropped.length + missed.length}</div><div class="d">${dropped.length} dropped, ${missed.length} no show</div></div>
  </div>

  ${ledgerBlock(mtgs, solo)}
  ${routeBlock(mtgs, leads)}
  ${dealsBlock(deals)}

  ${lbBlock('On the floor', 'Who took the meeting and logged the call', floor, false)}
  ${lbBlock('IS reps', 'Meetings they set up, and what those turned into', booked, true)}

  ${barBlock('Where the demand sits', regions)}
  ${barBlock('Business mix', cats)}

  <div class="sec">
    <div class="sec-h"><h2>Live activity</h2></div>
    <div class="card feed">
      ${S.activity.length ? S.activity.slice(0, 26).map(feedRow).join('')
        : `<div class="hint" style="padding:16px;text-align:center">Nothing logged yet. Outcomes appear here the second anyone records one.</div>`}
    </div>
  </div>`;
}

/* The floor capture strip: one row of three, on a meeting and on a contact.
   `tb` is the table so the same markup drives both. */
function capRow(tb, r) {
  const num = tb === 'ev_leads' ? (r.phone || r.phone_2) : (r.mobile || r.mobile_2);
  return `<div class="caprow">
    <button data-act="voice" data-id="${r.id}" data-tb="${tb}" class="${r.voice_note_path ? 'on' : ''}">
      ${I.mic}<span>${r.voice_note_path ? 'Re-record' : 'Record'}</span></button>
    <button data-act="selfie" data-id="${r.id}" data-tb="${tb}" class="${r.selfie_path ? 'on' : ''}">
      ${I.camera}<span>${r.selfie_path ? 'Retake' : 'Photo'}</span></button>
    <button data-act="wa" data-id="${r.id}" data-tb="${tb}" class="wa">
      ${I.whatsapp}<span>WhatsApp</span>${num ? '' : `<i class="cap-x">Add number</i>`}</button>
  </div>`;
}

/* Voice note and photo, once captured. */
function capMedia(tb, r, who) {
  if (!r.voice_note_path && !r.selfie_path) return '';
  const secs = r.voice_ms ? Math.round(r.voice_ms / 1000) : 0;
  const dur = secs ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '';
  return `<div class="sec-h"><h2>Captured on the floor</h2></div>
    ${r.voice_note_path ? `<div class="vnote">
      <div class="vn-top">
        <span class="vn-ic">${I.waves}</span>
        <div class="vn-m"><b>Voice note</b>${dur ? `<span class="mono">${dur}</span>` : ''}</div>
        <button class="iconbtn" data-act="delVoice" data-id="${r.id}" data-tb="${tb}" aria-label="Delete voice note">${I.trash}</button>
      </div>
      <div class="vn-act">
        <button class="vn-play" data-act="playVoice" data-id="${r.id}" data-tb="${tb}">${I.play}Play</button>
        <button class="vn-play" data-act="retranscribe" data-id="${r.id}" data-tb="${tb}" data-lbl="${r.voice_transcript ? 'Write it up again' : 'Write it up'}">${I.sparkle}${r.voice_transcript ? 'Write it up again' : 'Write it up'}</button>
      </div>
      <audio controls hidden preload="none"></audio>
      ${r.voice_transcript
        ? `<p class="vn-tx">${UI.esc(r.voice_transcript)}</p>`
        : `<div class="vn-none"><span>No write-up yet. The audio is saved, so you can run it any time.</span></div>`}
    </div>` : ''}
    ${r.selfie_path ? `<button class="selfie" data-act="zoom" data-p="${UI.esc(r.selfie_path)}" data-who="${UI.esc(who || '')}">
      <img data-selfie="${UI.esc(r.selfie_path)}" alt="Photo with ${UI.esc(who || 'them')}">
      <span class="sf-tag">${I.image}Photo together</span>
      <span class="sf-del iconbtn" data-act="delSelfie" data-id="${r.id}" data-tb="${tb}" role="button" aria-label="Delete photo">${I.trash}</span>
    </button>` : ''}`;
}

/* ---------- leaderboards ----------
   Leaders take meetings, reps book them. Ranking one against the other made
   both numbers meaningless, so they get their own tables and own metrics. */
function lbBlock(title, sub, rows, isRepTable) {
  if (!rows.length) return '';
  return `<div class="sec">
    <div class="sec-h"><h2>${UI.esc(title)}</h2><span class="count">${rows.length}</span></div>
    <p class="hint" style="margin:0 0 8px 2px">${UI.esc(sub)}</p>
    <div class="card lb">
      ${rows.map((r, i) => {
        const T = Math.max(1, r.total);
        const bits = isRepTable
          ? [r.total + ' booked', r.logged + ' logged']
          : [r.logged + ' of ' + r.total + ' logged'];
        if (r.cards) bits.push(r.cards + ' card' + (r.cards === 1 ? '' : 's'));
        if (r.value) bits.push(UI.money(r.value));
        return `<div class="lbrow${r.mem.user_id === meId() ? ' me' : ''}">
          <span class="rk">${i + 1}</span>
          ${UI.avatar(r.mem, 'sm')}
          <span class="who">
            <span class="n">${UI.esc(r.mem.full_name)}${r.mem.user_id === meId() ? ' · you' : ''}</span>
            <span class="s">${bits.join(' · ')}</span>
            <span class="prog">
              <i class="d" style="width:${r.deal / T * 100}%"></i>
              <i class="h" style="width:${r.open / T * 100}%"></i>
              <i class="x" style="width:${r.bad / T * 100}%"></i>
              <i class="m" style="width:${r.missed / T * 100}%"></i>
            </span>
          </span>
          <span class="nums"><span class="big" style="color:${r.deal ? 'var(--deal)' : 'var(--tx-3)'}">${r.deal}</span><span class="sm">DEAL${r.deal === 1 ? '' : 'S'}</span></span>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

/* ---------- outcome ledger ----------
   Every call the team made, in pipeline order, each row a door into the
   records behind the number. This is the answer to "what happened and why". */
function ledgerBlock(mtgs, solo) {
  const rowsFor = OUTCOMES.map(o => {
    const list = mtgs.filter(m => m.outcome === o.v);
    const cards = solo.filter(l => l.interest === o.v);
    return {
      o, n: list.length + cards.length, mtg: list.length, card: cards.length,
      value: OUT_VALUED.includes(o.v) ? list.reduce((s, m) => s + (Number(m.deal_value_usd) || 0), 0) : 0
    };
  });
  const done = rowsFor.reduce((a, r) => a + r.n, 0);
  const all = mtgs.length + solo.length + 0;
  const T = Math.max(1, done);

  return `<div class="sec">
    <div class="sec-h">
      <h2>Outcome ledger</h2>
      <span class="count">${done} logged</span>
    </div>
    <p class="hint" style="margin:0 0 8px 2px">Every meeting and every standalone card, in pipeline order. Tap a row for the records behind it.</p>
    ${done ? `<div class="stackbar" aria-hidden="true">
      ${rowsFor.filter(r => r.n).map(r => `<i class="t-${r.o.tone}" style="width:${r.n / T * 100}%" title="${r.o.label}"></i>`).join('')}
    </div>` : ''}
    <div class="card ledger">
      ${rowsFor.map(r => `<button class="ldg${r.n ? '' : ' zero'}" ${r.n ? `data-act="outList" data-id="${r.o.v}"` : 'disabled'}>
        <span class="lg-i t-${r.o.tone}">${I[r.o.icon] || I.bolt}</span>
        <span class="lg-t">
          <span class="lg-1">${r.o.label}</span>
          <span class="lg-2">${r.n
            ? [r.mtg ? r.mtg + ' meeting' + (r.mtg === 1 ? '' : 's') : '', r.card ? r.card + ' card' + (r.card === 1 ? '' : 's') : '', r.value ? UI.money(r.value) : ''].filter(Boolean).join(' · ')
            : r.o.desc}</span>
          <span class="lg-tr"><i class="t-${r.o.tone}" style="width:${r.n / T * 100}%"></i></span>
        </span>
        <span class="lg-n tnum">${r.n}</span>
        ${r.n ? I.chev : ''}
      </button>`).join('')}
    </div>
    ${mtgs.filter(m => !isDone(m)).length ? `<p class="hint" style="margin:8px 2px 0">${mtgs.filter(m => !isDone(m)).length} meeting${mtgs.filter(m => !isDone(m)).length === 1 ? '' : 's'} still without an outcome. Each one stays invisible to the pipeline until someone records it.</p>` : ''}
  </div>`;
}

/* ---------- deals created ----------
   Named, not counted. Each deal shows how it reached us. */
function dealsBlock(deals) {
  if (!deals.length) {
    return `<div class="sec">
      <div class="sec-h"><h2>Deals created</h2></div>
      <div class="card"><div class="hint" style="padding:16px;text-align:center">No deal logged yet. The moment someone logs one it lands here with the company, the owner and where it came from.</div></div>
    </div>`;
  }
  const sorted = [...deals].sort((a, b) => (Number(b.deal_value_usd) || 0) - (Number(a.deal_value_usd) || 0));
  return `<div class="sec">
    <div class="sec-h"><h2>Deals created</h2><span class="count">${deals.length}</span></div>
    <div class="card dlist">
      ${sorted.map(m => {
        /* a deal can be a meeting or a standalone card, and they read differently */
        const isCard = !m.company_name && !m.meeting_date;
        const who = isCard
          ? (UI.memberById(m.captured_by)?.short_name || 'Someone')
          : (m.owner_name || 'Unassigned');
        const route = isCard ? 'Card only' : (SOURCES[m.source]?.label || 'Booked meeting');
        return `<button class="dealrow" data-act="${isCard ? 'lead' : 'meeting'}" data-id="${m.id}">
        <span class="dl-t">
          <span class="dl-1">${UI.esc(m.company || m.company_name || m.full_name || 'Unnamed')}</span>
          <span class="dl-2">${UI.esc(who)} · ${UI.esc(route)}${m.geo_region ? ' · ' + UI.esc(m.geo_region) : ''}</span>
          ${m.next_step ? `<span class="dl-3">${I.target}${UI.esc(m.next_step)}</span>` : ''}
        </span>
        <span class="dl-v tnum">${m.deal_value_usd ? UI.money(m.deal_value_usd) : '—'}</span>
        ${I.chev}
      </button>`;
      }).join('')}
    </div>
  </div>`;
}

/* ---------- what happened, by route ----------
   Prebooked, walked up, typed in, or just a card. Same outcome language on
   every route so "deals from walk-ins" and "deals from prebooked" sit side
   by side instead of living in different reports. */
function routeBlock(mtgs, leads) {
  const src = k => mtgs.filter(m => (m.source || 'sheet') === k);
  const routes = [
    { k: 'sheet',  label: 'Prebooked meetings', desc: 'Off the meeting sheet',          list: src('sheet'),  out: m => m.outcome, icon: 'calendar' },
    { k: 'walkin', label: 'Walk-ins',           desc: 'Picked up on the floor',         list: src('walkin'), out: m => m.outcome, icon: 'handshake' },
    { k: 'manual', label: 'Added on site',      desc: 'Typed in by the team',           list: src('manual'), out: m => m.outcome, icon: 'edit' },
    { k: 'cards',  label: 'Cards only',         desc: 'Captured, not tied to a meeting', list: leads.filter(l => !l.meeting_id), out: l => l.interest, icon: 'card' }
  ].filter(r => r.list.length);

  if (!routes.length) return '';

  const rows = routes.map(r => {
    const logged = r.list.filter(x => r.out(x));
    const cnt = g => r.list.filter(x => OUT_MAP[r.out(x)]?.grp === g).length;
    const deal = r.list.filter(x => r.out(x) === 'deal');
    return {
      ...r, n: r.list.length, logged: logged.length,
      deal: deal.length, open: cnt('open'), bad: cnt('dropped'), missed: cnt('missed'),
      value: deal.reduce((a, x) => a + (Number(x.deal_value_usd) || 0), 0),
      chips: CALLS.concat(OUT_MAP.no_show).filter(o => r.list.some(x => r.out(x) === o.v))
        .map(o => ({ o, n: r.list.filter(x => r.out(x) === o.v).length }))
    };
  });

  return `<div class="sec">
    <div class="sec-h"><h2>What happened, by route</h2></div>
    <p class="hint" style="margin:0 0 9px 2px">Same outcomes, split by how the prospect reached us.</p>
    <div class="routes">
      ${rows.map(r => {
        const T = Math.max(1, r.n);
        return `<div class="route">
          <div class="rt-h">
            <span class="rt-i">${I[r.icon] || I.info}</span>
            <span class="rt-t"><span class="rt-1">${r.label}</span><span class="rt-2">${r.desc}</span></span>
            <span class="rt-n tnum">${r.n}</span>
          </div>
          <div class="rt-bar" aria-hidden="true">
            <i class="t-deal" style="width:${r.deal / T * 100}%"></i>
            <i class="t-hot" style="width:${r.open / T * 100}%"></i>
            <i class="t-dead" style="width:${r.bad / T * 100}%"></i>
            <i class="t-mute" style="width:${r.missed / T * 100}%"></i>
          </div>
          <div class="rt-chips">
            ${r.chips.length
              ? r.chips.map(c => `<span class="rchip t-${c.o.tone}"><i></i>${c.o.short} <b class="tnum">${c.n}</b></span>`).join('')
              : '<span class="rchip zero">Nothing logged yet</span>'}
            ${r.n - r.logged ? `<span class="rchip zero">${r.n - r.logged} open</span>` : ''}
            ${r.value ? `<span class="rchip val tnum">${UI.money(r.value)}</span>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

/* ---------- the records behind one number ---------- */
function openOutcomeList(val) {
  const o = OUT_MAP[val];
  if (!o) return;
  const inDay = V.boardDay === 'day' && V.day !== 'all';
  const list = S.meetings
    .filter(m => m.outcome === val && (!inDay || m.meeting_date === V.day))
    .sort((a, b) => (Number(b.deal_value_usd) || 0) - (Number(a.deal_value_usd) || 0)
      || String(a.company_name).localeCompare(String(b.company_name)));
  const cards = S.leads.filter(l => !l.meeting_id && l.interest === val);
  const value = OUT_VALUED.includes(val) ? list.reduce((s, m) => s + (Number(m.deal_value_usd) || 0), 0) : 0;
  const total = list.length + cards.length;

  UI.openSheet({
    title: o.label,
    sub: `${total} ${total === 1 ? 'record' : 'records'}${value ? ' · ' + UI.money(value) : ''}${inDay ? ' · ' + UI.fmtDate(V.day) : ''}`,
    body: `
      <p class="hint" style="margin:0 0 12px">${o.desc}.</p>
      <div class="card dlist">
        ${list.map(m => `<button class="dealrow" data-act="meeting" data-id="${m.id}">
          <span class="dl-t">
            <span class="dl-1">${UI.esc(m.company_name || 'Unnamed')}</span>
            <span class="dl-2">${UI.esc(m.owner_name || 'Unassigned')} · ${UI.esc(SOURCES[m.source]?.label || 'Booked meeting')}${m.meeting_date ? ' · ' + UI.fmtDate(m.meeting_date) : ''}</span>
            ${m.outcome_notes ? `<span class="dl-3">${I.note}${UI.esc(m.outcome_notes.slice(0, 120))}</span>` : ''}
            ${m.next_step ? `<span class="dl-3">${I.target}${UI.esc(m.next_step)}</span>` : ''}
          </span>
          ${OUT_VALUED.includes(val) ? `<span class="dl-v tnum">${m.deal_value_usd ? UI.money(m.deal_value_usd) : '—'}</span>` : ''}
          ${I.chev}
        </button>`).join('')}
      </div>
      ${cards.length ? `<div class="sec-h" style="margin-top:16px"><h2>Cards only</h2><span class="count">${cards.length}</span></div>
        ${cards.map(leadCard).join('')}` : ''}`,
    foot: `<button class="btn ghost" data-x>Close</button>`,
    onMount(b, f) { f.querySelector('[data-x]').onclick = () => UI.closeSheet(); }
  });
}

function tally(arr, fn) {
  const m = new Map();
  arr.forEach(x => { const k = fn(x); m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function barBlock(title, pairs) {
  if (!pairs.length) return '';
  const max = Math.max(...pairs.map(p => p[1]));
  return `<div class="sec">
    <div class="sec-h"><h2>${UI.esc(title)}</h2></div>
    <div class="card bars">
      ${pairs.slice(0, 8).map(([k, v]) => `<div class="bar">
        <span class="bl" title="${UI.esc(k)}">${UI.esc(k)}</span>
        <span class="bt"><i style="width:${Math.max(4, v / max * 100)}%"></i></span>
        <span class="bv tnum">${v}</span>
      </div>`).join('')}
    </div>
  </div>`;
}

async function hydrateThumbs() {
  const holders = UI.$$('[data-thumb]').filter(e => e.dataset.thumb);
  const bigs = UI.$$('[data-bigthumb]').filter(e => e.dataset.bigthumb);
  for (const el of holders) {
    const url = await Store.thumb(el.dataset.thumb);
    if (!url) continue;
    const img = document.createElement('img');
    img.className = 'thumb'; img.src = url; img.alt = ''; img.loading = 'lazy';
    el.replaceWith(img);
  }
  for (const el of UI.$$('[data-selfie]').filter(e => e.dataset.selfie)) {
    const url = await Store.thumb(el.dataset.selfie);
    if (!url) continue;
    el.src = url; el.removeAttribute('data-selfie');
  }
  for (const el of bigs) {
    const url = await Store.thumb(el.dataset.bigthumb);
    if (!url) continue;
    el.innerHTML = `<img src="${UI.esc(url)}" alt="Business card">`;
    el.removeAttribute('data-bigthumb'); el.style.minHeight = '';
  }
}

function feedRow(a) {
  const map = Object.fromEntries(OUTCOMES.map(o => ['outcome_' + o.v, o.v]).concat([['lead_scanned', 'scan']]));
  const cls = map[a.kind] || '';
  const ic = a.kind === 'lead_scanned' ? 'card'
    : a.kind === 'meeting_added' ? 'plus'
    : a.kind === 'status' ? 'clock'
    : a.kind === 'reset' || a.kind === 'event_reset' ? 'undo'
    : (OUT_MAP[a.kind?.replace('outcome_', '')]?.icon) || 'bolt';
  return `<div class="fr">
    <span class="ic ${cls}">${I[ic] || I.bolt}</span>
    <span class="tx">
      <span class="l1"><b>${UI.esc(a.actor_name || 'Someone')}</b> ${UI.esc(a.summary || a.kind)}</span>
      <span class="l2">${UI.esc(UI.ago(a.created_at))}</span>
    </span>
  </div>`;
}

/* ============================================================
   ME
   ============================================================ */
function notifState() {
  if (!('Notification' in window)) return 'none';
  return Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'none' : 'ask';
}

function viewMe() {
  const me = S.me || {};
  const mine = S.meetings.filter(isMine);
  const logged = mine.filter(isDone);
  const myLeads = S.leads.filter(l => l.captured_by === meId());
  const ev = UI.activeEvent();
  const byDay = eventDays().map(d => ({ d, n: mine.filter(m => m.meeting_date === d).length, l: mine.filter(m => m.meeting_date === d && isDone(m)).length }));
  const canInstall = !!window.__installPrompt;

  return `
  <div class="card" style="padding:16px;display:flex;gap:13px;align-items:center;margin-bottom:16px">
    ${UI.avatar(me, 'lg')}
    <div style="min-width:0">
      <div style="font-size:18px;font-weight:750;letter-spacing:-.025em">${UI.esc(me.full_name || 'You')}</div>
      <div style="font-size:12.5px;color:var(--tx-2);margin-top:1px">${UI.esc(me.title || (me.role === 'leader' ? 'Leadership' : 'Inside sales'))}</div>
      <div style="font-size:11.5px;color:var(--tx-3);margin-top:3px;overflow:hidden;text-overflow:ellipsis">${UI.esc(me.email || '')}</div>
    </div>
  </div>

  <div class="kpis">
    <div class="kpi brand"><div class="k">${me.role === 'rep' ? 'Booked by me' : 'My meetings'}</div><div class="v tnum">${mine.length}</div><div class="d">${logged.length} logged</div></div>
    <div class="kpi deal"><div class="k">${me.role === 'rep' ? 'Deals booked' : 'My deals'}</div><div class="v tnum">${mine.filter(m => m.outcome === 'deal').length}</div><div class="d">${mine.filter(m => m.outcome === 'future_opportunity').length} future</div></div>
    <div class="kpi"><div class="k">My cards</div><div class="v tnum">${myLeads.length}</div><div class="d">captured by me</div></div>
    <div class="kpi hot"><div class="k">To log</div><div class="v tnum">${mine.length - logged.length}</div><div class="d">outcomes open</div></div>
  </div>

  ${byDay.length ? `<div class="sec">
    <div class="sec-h"><h2>My day by day</h2></div>
    <div class="card bars">
      ${byDay.map(x => `<div class="bar">
        <span class="bl">${UI.esc(UI.fmtDate(x.d))}</span>
        <span class="bt"><i style="width:${x.n ? Math.max(4, x.l / Math.max(1, x.n) * 100) : 0}%"></i></span>
        <span class="bv tnum">${x.l}/${x.n}</span>
      </div>`).join('')}
    </div>
  </div>` : ''}

  <div class="sec">
    <div class="sec-h"><h2>Event</h2></div>
    <div class="card" style="padding:4px 13px">
      <div class="drow"><span class="di">${I.calendar}</span><span class="dv"><span class="k">Now showing</span><span class="v">${UI.esc(ev?.name || '—')}</span></span>
        <span class="da"><button class="iconbtn" data-act="switchEvent" aria-label="Switch event">${I.refresh}</button></span></div>
      <div class="drow"><span class="di">${I.pin}</span><span class="dv"><span class="k">Venue</span><span class="v">${UI.esc([ev?.venue, ev?.city].filter(Boolean).join(', ') || '—')}${ev?.stand ? ' · Stand ' + UI.esc(ev.stand) : ''}</span></span></div>
      <div class="drow"><span class="di">${I.users}</span><span class="dv"><span class="k">Team on the floor</span><span class="v">${S.members.length} people</span></span>
        <span class="da"><button class="iconbtn" data-act="team" aria-label="See team">${I.chev}</button></span></div>
    </div>
  </div>

  <div class="sec">
    <div class="sec-h"><h2>End of day</h2></div>
    <div style="display:flex;flex-direction:column;gap:9px">
      <button class="btn primary block" data-act="wrap" data-id="${V.day && V.day !== 'all' ? V.day : UI.nowInTz().date}">${I.days}Wrap up the day</button>
      ${notifState() === 'granted'
        ? `<div class="card" style="padding:12px 13px;display:flex;gap:9px;align-items:center">
             <span class="di">${I.bell}</span>
             <span class="dv"><span class="k">Reminders</span><span class="v">On. We will tap you when a meeting finishes.</span></span>
           </div>`
        : notifState() === 'none'
          ? ''
          : `<button class="btn block" data-act="remindMe">${I.bell}Remind me when a meeting finishes</button>`}
    </div>
  </div>

  <div class="sec">
    <div class="sec-h"><h2>Actions</h2></div>
    <div style="display:flex;flex-direction:column;gap:9px">
      ${Store.isAdmin() ? `<button class="btn block" data-act="console">${I.grid}Open the floor console</button>` : ''}
      <button class="btn block" data-act="addMeeting">${I.plus}Add a walk-in meeting</button>
      <button class="btn block" data-act="addEvent">${I.calendar}Create a new event</button>
      <button class="btn block" data-act="export">${I.download}Export to CSV</button>
      ${canInstall ? `<button class="btn primary block" data-act="install">${I.upload}Install on this phone</button>` : ''}
      <button class="btn ghost block" data-act="refresh">${I.refresh}Refresh from server</button>      ${me.role !== 'rep' ? `<button class="btn danger block" data-act="resetEvent">${I.undo}Reset the event records</button>` : ''}
    </div>
  </div>

  <div class="sec">
    <div class="sec-h"><h2>Sync</h2></div>
    <div class="card" style="padding:4px 13px">
      <div class="drow"><span class="di">${S.net === 'offline' ? I.wifiOff : I.bolt}</span>
        <span class="dv"><span class="k">Connection</span><span class="v">${S.net === 'offline' ? 'Offline, work is saved on device' : S.pending ? S.pending + ' change' + (S.pending === 1 ? '' : 's') + ' syncing' : 'Live and in sync'}</span></span></div>
      <div class="drow"><span class="di">${I.sparkle}</span>
        <span class="dv"><span class="k">AI card reading</span><span class="v ${S.ocrConfigured === false ? 'mut' : ''}">${S.ocrConfigured === false ? 'Not switched on, using on-device' : 'Active'}</span></span></div>
      <div class="drow"><span class="di">${I.clock}</span>
        <span class="dv"><span class="k">Last refreshed</span><span class="v">${S.syncedAt ? UI.ago(S.syncedAt) : 'not yet'}</span></span></div>
      <div class="drow"><span class="di">${I.info}</span>
        <span class="dv"><span class="k">Build</span><span class="v mono">${window.BUILD || '?'}</span></span></div>
    </div>
  </div>

  <button class="btn danger block" data-act="signout" style="margin-bottom:10px">${I.logout}Sign out</button>
  <div class="hint" style="text-align:center">Vervotech Showdown · built for the field team</div>`;
}

/* ============================================================
   SHEETS
   ============================================================ */
function openMeeting(id) {
  const m = S.meetings.find(x => x.id === id);
  if (!m) return;
  const own = UI.memberById(m.owner_id) || UI.memberByName(m.owner_name);
  const rep = UI.memberById(m.rep_id) || UI.memberByName(m.rep_name);
  const ls = leadsFor(m.id);

  const row = (icon, k, v, actions = '') => v ? `<div class="drow">
    <span class="di">${I[icon] || I.info}</span>
    <span class="dv"><span class="k">${UI.esc(k)}</span><span class="v">${v}</span></span>
    ${actions ? `<span class="da">${actions}</span>` : ''}
  </div>` : '';

  const body = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
      ${m.outcome ? UI.tagFor(m.outcome) : `<span class="tag">${UI.esc(m.status.replace('_', ' '))}</span>`}
      ${m.category ? `<span class="tag">${UI.esc(m.category)}</span>` : ''}
      ${m.geo_region ? `<span class="tag">${UI.esc(m.geo_region)}</span>` : ''}
      ${m.source !== 'sheet' ? `<span class="tag brand">${UI.esc(m.source === 'walkin' ? 'Walk-in' : m.source)}</span>` : ''}
      ${liveInfo(m) ? '<span class="tag hot">Live now</span>' : ''}
    </div>

    <div class="sec-h" style="margin-top:0"><h2>Did they turn up?</h2></div>
    <div class="attrow">
      ${ATTEND.map(a => `<button data-act="attend" data-id="${m.id}" data-v="${a.v}"
          aria-pressed="${m.status === a.v}">${I[a.icon] || I.info}<span>${a.short}</span></button>`).join('')}
    </div>

    <div style="display:flex;flex-direction:column;gap:9px;margin:14px 0 16px">
      <button class="btn primary block" data-act="outcome" data-id="${m.id}"
        ${m.status === 'rescheduled' || m.status === 'cancelled' ? 'disabled' : ''}>${I.check}${m.outcome ? 'Update the outcome' : 'Log the outcome'}</button>
      <button class="btn block" data-act="editMeeting" data-id="${m.id}">${I.edit}Edit this meeting</button>
      ${isDone(m) || m.outcome_notes ? `<button class="btn ghost block" data-act="resetMeeting" data-id="${m.id}">${I.undo}Reset this record</button>` : ''}
    </div>

    ${capRow('ev_meetings', m)}

    <div class="card" style="padding:4px 13px;margin-bottom:16px">
      ${row('clock', 'When', `${UI.esc(UI.fmtDate(m.meeting_date))} · <span class="mono">${UI.esc(UI.fmtTimeStr(m.meeting_time))}</span>${m.duration_min ? ' · ' + m.duration_min + ' min' : ''}`)}
      ${row('user', 'Prospect', UI.esc([m.prospect_name, m.designation].filter(Boolean).join(' · ')))}
      ${row('mail', 'Email', m.email ? UI.esc(m.email) : '',
        m.email ? `<a class="iconbtn" href="mailto:${UI.esc(m.email)}" aria-label="Email">${I.mail}</a>
                   <button class="iconbtn" data-act="copy" data-v="${UI.esc(m.email)}" aria-label="Copy">${I.copy}</button>` : '')}
      ${row('phone', 'Mobile', m.mobile ? UI.esc(m.mobile) : '',
        m.mobile ? `<a class="iconbtn" href="tel:${UI.esc(String(m.mobile).replace(/\s/g, ''))}" aria-label="Call">${I.phone}</a>
                    <button class="iconbtn" data-act="copy" data-v="${UI.esc(m.mobile)}" aria-label="Copy">${I.copy}</button>` : '')}
      ${row('globe', 'Domain', m.domain ? UI.esc(m.domain) : '')}
      ${row('pin', 'Where', m.location ? UI.esc(m.location) : '')}
      ${row('users', 'On our side', `${own ? UI.esc(own.short_name) : UI.esc(m.owner_name || '—')}${rep && rep.user_id !== own?.user_id ? ' with ' + UI.esc(rep.short_name) : (m.rep_name && m.rep_name !== m.owner_name ? ' with ' + UI.esc(m.rep_name) : '')}`)}
      ${row('note', 'Sheet comments', m.comments ? UI.esc(m.comments) : '')}
      ${row('note', 'Outcome notes', m.outcome_notes ? UI.esc(m.outcome_notes) : '')}
      ${row('arrowRight', 'Next step', m.next_step ? UI.esc(m.next_step) + (m.next_step_due ? ` <span class="mono" style="color:var(--tx-3)">${UI.esc(m.next_step_due)}</span>` : '') : '')}
      ${row('dollar', 'Deal value', m.deal_value_usd ? UI.esc(UI.money(m.deal_value_usd)) : '')}
    </div>

    ${capMedia('ev_meetings', m, m.company_name)}

    <div class="sec-h"><h2>Cards from this meeting</h2><span class="count">${ls.length}</span></div>
    ${ls.length ? ls.map(leadCard).join('') : `<div class="hint" style="padding:4px 2px 12px">No card captured yet.</div>`}
    ${(m.source || 'sheet') !== 'sheet' ? `<button class="btn danger block" style="margin-top:10px" data-act="delMeeting" data-id="${m.id}">${I.trash}Delete this ${m.source === 'walkin' ? 'walk-in' : 'meeting'}</button>` : ''}`;

  UI.openSheet({ title: m.company_name, sub: [m.prospect_name, m.geo_region].filter(Boolean).join(' · ') || UI.fmtDate(m.meeting_date), body });
  hydrateThumbs();
}


function openOutcome(id, jump) {
  const m = S.meetings.find(x => x.id === id);
  if (!m) return;

  /* an already-logged meeting reopens on whichever step it belongs to */
  let att = m.outcome === 'no_show' ? 'no_show'
    : (m.outcome ? 'met' : (['no_show', 'rescheduled', 'cancelled', 'met'].includes(m.status) ? m.status : null));
  let pick = m.outcome && m.outcome !== 'no_show' ? m.outcome : null;
  let step = (jump === 2 && att === 'met') || (att === 'met' && m.outcome) ? 2 : 1;
  const draft = {
    val: m.deal_value_usd != null ? String(m.deal_value_usd) : '',
    next: m.next_step || '', due: m.next_step_due || '', notes: m.outcome_notes || ''
  };

  const stepOne = () => `
    <div class="stepline"><span class="on">1 Attendance</span><span>2 Outcome</span></div>
    <div class="outs">
      ${ATTEND.map(a => `<button class="outbtn att" data-a="${a.v}" aria-pressed="${att === a.v}">
        <span class="oi">${I[a.icon] || I.info}</span>
        <span class="ot">${a.label}</span>
        <span class="od">${a.desc}</span>
      </button>`).join('')}
    </div>
    ${att && att !== 'met' ? `<div class="field" style="margin-top:16px">
      <label for="o_notes">Anything worth noting</label>
      <textarea class="input" id="o_notes" placeholder="Who told you, whether it is worth rebooking.">${UI.esc(draft.notes)}</textarea>
    </div>` : ''}`;

  const stepTwo = () => `
    <div class="stepline"><span class="done" data-back>1 Attendance</span><span class="on">2 Outcome</span></div>
    <div class="outs">
      ${CALLS.map(o => `<button class="outbtn" data-v="${o.v}" aria-pressed="${pick === o.v}">
        <span class="oi">${I[o.icon] || I.bolt}</span>
        <span class="ot">${o.label}</span>
        <span class="od">${o.desc}</span>
      </button>`).join('')}
    </div>
    <div style="margin-top:16px">
      <div class="field" id="valWrap" ${OUT_VALUED.includes(pick) ? '' : 'hidden'}>
        <label for="o_val">Deal value if it lands (USD)</label>
        <input class="input mono" id="o_val" type="number" inputmode="numeric" min="0" step="1000"
               placeholder="50000" value="${UI.esc(draft.val)}">
      </div>
      <div class="field">
        <label for="o_next">Next step</label>
        <input class="input" id="o_next" placeholder="Send mapping sample, follow up Monday" value="${UI.esc(draft.next)}">
      </div>
      <div class="field">
        <label for="o_due">Follow up by</label>
        <input class="input mono" id="o_due" type="date" value="${UI.esc(draft.due)}">
      </div>
      <div class="field">
        <label for="o_notes">What actually happened</label>
        <textarea class="input" id="o_notes" placeholder="Who was in the room, what they run today, what they pushed back on.">${UI.esc(draft.notes)}</textarea>
      </div>
    </div>`;

  UI.openSheet({
    title: 'Did they turn up?',
    sub: m.company_name,
    body: stepOne(),
    foot: `${m.outcome || m.status !== 'scheduled' ? '<button class="btn danger" data-clear>Reset</button>' : '<button class="btn ghost" data-x>Cancel</button>'}<button class="btn primary" data-go disabled>Continue</button>`,
    onMount(b, f) {
      const keep = () => {
        const g = k => b.querySelector(k);
        if (g('#o_val')) draft.val = g('#o_val').value;
        if (g('#o_next')) draft.next = g('#o_next').value;
        if (g('#o_due')) draft.due = g('#o_due').value;
        if (g('#o_notes')) draft.notes = g('#o_notes').value;
      };

      const paint = () => {
        b.innerHTML = step === 1 ? stepOne() : stepTwo();
        const t = UI.$('#sheetTitle'); if (t) t.textContent = step === 1 ? 'Did they turn up?' : 'How did it go?';
        b.scrollTop = 0;
        bind();
      };

      const bind = () => {
        const go = f.querySelector('[data-go]');
        if (step === 1) {
          go.textContent = att === 'met' ? 'Continue' : 'Save';
          go.disabled = !att;
          b.querySelectorAll('.outbtn.att').forEach(btn => {
            btn.onclick = () => { keep(); att = btn.dataset.a; UI.buzz(); paint(); };
          });
        } else {
          go.textContent = 'Save outcome';
          go.disabled = !pick;
          const back = b.querySelector('[data-back]');
          if (back) back.onclick = () => { keep(); step = 1; paint(); };
          b.querySelectorAll('.outbtn[data-v]').forEach(btn => {
            btn.onclick = () => {
              pick = btn.dataset.v;
              b.querySelectorAll('.outbtn[data-v]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === pick)));
              b.querySelector('#valWrap').hidden = !OUT_VALUED.includes(pick);
              go.disabled = false;
              UI.buzz();
            };
          });
        }
        go.onclick = () => {
          keep();
          if (step === 1 && att === 'met') { step = 2; paint(); return; }
          commit();
        };
      };

      const commit = async () => {
        const prev = { outcome: m.outcome, status: m.status, deal_value_usd: m.deal_value_usd, next_step: m.next_step, next_step_due: m.next_step_due, outcome_notes: m.outcome_notes, met_at: m.met_at };
        const met = att === 'met';
        const out = met ? pick : (att === 'no_show' ? 'no_show' : null);
        const values = {
          status: att,
          outcome: out,
          deal_value_usd: met && OUT_VALUED.includes(pick) && draft.val !== '' ? Number(draft.val) : null,
          next_step: met ? (draft.next.trim() || null) : null,
          next_step_due: met ? (draft.due || null) : null,
          outcome_notes: draft.notes.trim() || null,
          met_at: met ? (m.met_at || new Date().toISOString()) : null,
          updated_at: new Date().toISOString()
        };
        const label = met ? OUT_MAP[pick].label : (ATTEND.find(a => a.v === att) || {}).label;
        UI.closeSheet();
        await Store.updateMeeting(m.id, values, {
          activity: {
            kind: met ? 'outcome_' + pick : 'status_' + att,
            summary: `${met ? 'logged ' + OUT_MAP[pick].label.toLowerCase() : label.toLowerCase()} on ${m.company_name}`,
            payload: { outcome: out, status: att, value: values.deal_value_usd }
          }
        });
        UI.buzz(18);
        UI.toast(`${label} logged on ${m.company_name}`, {
          kind: pick === 'deal' && met ? 'ok' : '', action: 'Undo',
          onAction: () => Store.updateMeeting(m.id, { ...prev, updated_at: new Date().toISOString() })
            .then(() => { UI.toast('Reverted'); render(); })
        });
        render();
      };

      const xb = f.querySelector('[data-x]');
      if (xb) xb.onclick = () => UI.closeSheet();
      const cb = f.querySelector('[data-clear]');
      if (cb) cb.onclick = async () => {
        const prev = { outcome: m.outcome, status: m.status, deal_value_usd: m.deal_value_usd, next_step: m.next_step, next_step_due: m.next_step_due, outcome_notes: m.outcome_notes, met_at: m.met_at };
        UI.closeSheet();
        await Store.updateMeeting(m.id, { ...Store.CLEAR, updated_at: new Date().toISOString() },
          { activity: { kind: 'reset', summary: `reset the record for ${m.company_name}` } });
        UI.toast(`${m.company_name} is back to unlogged`, {
          action: 'Undo',
          onAction: () => Store.updateMeeting(m.id, { ...prev, updated_at: new Date().toISOString() })
            .then(() => { UI.toast('Restored'); render(); })
        });
        render();
      };
      if (step === 2) paint(); else bind();
    }
  });
}

/* ---- lead detail ---- */
function openLead(id) {
  const l = S.leads.find(x => x.id === id);
  if (!l) return;
  const mtg = l.meeting_id ? S.meetings.find(m => m.id === l.meeting_id) : null;
  const who = UI.memberById(l.captured_by);
  const img = l._local_front || (l.card_front_path ? S.thumbs[l.card_front_path] : '');

  const row = (icon, k, v, actions = '') => v ? `<div class="drow">
    <span class="di">${I[icon] || I.info}</span>
    <span class="dv"><span class="k">${UI.esc(k)}</span><span class="v">${v}</span></span>
    ${actions ? `<span class="da">${actions}</span>` : ''}</div>` : '';

  const body = `
    ${img ? `<div class="cardprev"><img src="${UI.esc(img)}" alt="Business card"></div>`
          : (l.card_front_path ? `<div class="cardprev" data-bigthumb="${UI.esc(l.card_front_path)}" style="min-height:90px;display:grid;place-items:center;color:var(--tx-3)">${I.image}</div>` : '')}

    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
      ${l.interest ? UI.tagFor(l.interest) : '<span class="tag">Unrated</span>'}
      ${l.geo_region ? `<span class="tag">${UI.esc(l.geo_region)}</span>` : ''}
      ${l.ocr_provider ? `<span class="tag brand">${UI.esc(l.ocr_provider.startsWith('ai') ? 'AI read' : 'Device read')}</span>` : ''}
      ${l._dirty || l.synced === false ? '<span class="tag hot">Queued</span>' : ''}
    </div>

    <div class="sec-h" style="margin-top:0"><h2>Outcome</h2></div>
    <div class="attrow six" style="margin-bottom:16px">
      ${CALLS.map(o => `<button data-act="rate" data-id="${l.id}" data-v="${o.v}"
        aria-pressed="${l.interest === o.v}">${I[o.icon] || I.bolt}<span>${o.short}</span></button>`).join('')}
    </div>

    <div style="display:flex;gap:9px;margin-bottom:16px">
      ${l.email ? `<a class="btn primary" style="flex:1" href="mailto:${UI.esc(l.email)}">${I.mail}Email</a>` : ''}
      ${l.phone ? `<a class="btn" style="flex:1" href="tel:${UI.esc(String(l.phone).replace(/\s/g, ''))}">${I.phone}Call</a>` : ''}
      <button class="btn ghost" data-act="editLead" data-id="${l.id}" style="flex:none">${I.edit}</button>
    </div>

    ${capRow('ev_leads', l)}

    <div class="card" style="padding:4px 13px;margin-bottom:16px">
      ${row('briefcase', 'Title', UI.esc(l.designation || ''))}
      ${row('building', 'Company', UI.esc(l.company || ''))}
      ${row('mail', 'Email', l.email ? UI.esc(l.email) : '', l.email ? `<button class="iconbtn" data-act="copy" data-v="${UI.esc(l.email)}" aria-label="Copy">${I.copy}</button>` : '')}
      ${row('phone', 'Phone', l.phone ? UI.esc(l.phone) : '', l.phone ? `<button class="iconbtn" data-act="copy" data-v="${UI.esc(l.phone)}" aria-label="Copy">${I.copy}</button>` : '')}
      ${row('phone', 'Second number', UI.esc(l.phone_2 || ''))}
      ${row('globe', 'Website', l.website ? `<a href="https://${UI.esc(l.website.replace(/^https?:\/\//, ''))}" target="_blank" rel="noopener">${UI.esc(l.website)}</a>` : '')}
      ${row('link', 'LinkedIn', l.linkedin ? `<a href="${UI.esc(l.linkedin)}" target="_blank" rel="noopener">Profile</a>` : '')}
      ${row('pin', 'Address', UI.esc(l.address || ''))}
      ${row('note', 'Notes', l.notes ? UI.esc(l.notes) : '')}
      ${row('arrowRight', 'Next step', l.next_step ? UI.esc(l.next_step) + (l.next_step_due ? ` <span class="mono" style="color:var(--tx-3)">${UI.esc(l.next_step_due)}</span>` : '') : '')}
      ${row('calendar', 'Meeting', mtg ? UI.esc(mtg.company_name) + ' · ' + UI.esc(UI.fmtDate(mtg.meeting_date)) : '',
        mtg ? `<button class="iconbtn" data-act="meeting" data-id="${mtg.id}" aria-label="Open meeting">${I.chev}</button>` : '')}
      ${row('user', 'Captured by', `${UI.esc(who?.short_name || l.captured_by_name || '—')} · ${UI.esc(UI.ago(l.created_at))}`)}
    </div>

    ${capMedia('ev_leads', l, l.full_name || l.company)}


    ${!l.meeting_id ? `<button class="btn ghost block" data-act="linkMeeting" data-id="${l.id}" style="margin-bottom:10px">${I.link}Attach to a meeting</button>` : ''}
    <button class="btn danger block" data-act="delLead" data-id="${l.id}">${I.trash}Delete this contact</button>`;

  UI.openSheet({ title: l.full_name || 'Contact', sub: [l.designation, l.company].filter(Boolean).join(' · '), body });
  hydrateThumbs();
}

/* ---- editors ---- */
const F = (id, label, value = '', attrs = '', hint = '') => `<div class="field">
  <label for="${id}">${UI.esc(label)}</label>
  <input class="input" id="${id}" value="${UI.esc(value)}" ${attrs}>
  ${hint ? `<div class="hint">${UI.esc(hint)}</div>` : ''}</div>`;
const TA = (id, label, value = '', ph = '') => `<div class="field">
  <label for="${id}">${UI.esc(label)}</label>
  <textarea class="input" id="${id}" placeholder="${UI.esc(ph)}">${UI.esc(value)}</textarea></div>`;
/* one outcome picker, used by the walk-in form and the contact form */
const OUTPICK = (id, label, selected, list = CALLS) => `<div class="field">
  <label>${UI.esc(label)}</label>
  <div class="outs" id="${id}">
    ${list.map(o => `<button type="button" class="outbtn" data-v="${o.v}" aria-pressed="${selected === o.v}">
      <span class="oi">${I[o.icon] || I.bolt}</span>
      <span class="ot">${o.label}</span><span class="od">${o.desc}</span></button>`).join('')}
  </div></div>`;

/* wires an OUTPICK and reports the current value */
const bindPick = (b, id, init = null) => {
  let v = init;
  const g = b.querySelector('#' + id);
  g.querySelectorAll('.outbtn').forEach(btn => {
    btn.onclick = () => {
      v = v === btn.dataset.v ? null : btn.dataset.v;
      g.querySelectorAll('.outbtn').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === v)));
      UI.buzz();
    };
  });
  return () => v;
};

const SEL = (id, label, value, opts, blank = '—') => `<div class="field">
  <label for="${id}">${UI.esc(label)}</label>
  <select class="sel" id="${id}">
    <option value="">${UI.esc(blank)}</option>
    ${opts.map(o => {
      const v = typeof o === 'string' ? o : o.v, t = typeof o === 'string' ? o : o.label;
      return `<option value="${UI.esc(v)}" ${String(value || '') === String(v) ? 'selected' : ''}>${UI.esc(t)}</option>`;
    }).join('')}
  </select></div>`;

function openEditLead(id) {
  const l = S.leads.find(x => x.id === id);
  if (!l) return;
  const body = `
    ${F('e_name', 'Full name', l.full_name, 'autocapitalize="words"')}
    ${F('e_title', 'Job title', l.designation)}
    ${F('e_co', 'Company', l.company, 'autocapitalize="words"')}
    ${F('e_email', 'Email', l.email, 'type="email" inputmode="email" autocapitalize="none" spellcheck="false"')}
    <div class="grid2">${F('e_phone', 'Phone', l.phone, 'type="tel" inputmode="tel"')}${F('e_phone2', 'Second number', l.phone_2, 'type="tel" inputmode="tel"')}</div>
    ${F('e_web', 'Website', l.website, 'autocapitalize="none" spellcheck="false"')}
    ${F('e_li', 'LinkedIn', l.linkedin, 'autocapitalize="none" spellcheck="false"')}
    ${SEL('e_region', 'Region', l.geo_region, REGIONS)}
    ${F('e_addr', 'Address', l.address)}
    ${OUTPICK('e_out', 'Outcome', l.interest)}
    ${TA('e_notes', 'Notes', l.notes, 'What they run today, what they need, who decides.')}
    <div class="grid2">${F('e_next', 'Next step', l.next_step)}${F('e_due', 'Follow up by', l.next_step_due, 'type="date" class="input mono"')}</div>`;

  UI.openSheet({
    title: 'Edit contact', sub: l.full_name || l.company || '', body,
    foot: `<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-save>Save</button>`,
    onMount(b, f) {
      const getOut = bindPick(b, 'e_out', l.interest);
      f.querySelector('[data-x]').onclick = () => UI.closeSheet();
      f.querySelector('[data-save]').onclick = async () => {
        const g = s => b.querySelector(s).value.trim() || null;
        const out = getOut();
        UI.closeSheet();
        await Store.updateLead(l.id, {
          interest: out,
          full_name: g('#e_name'), designation: g('#e_title'), company: g('#e_co'),
          email: (g('#e_email') || '').toLowerCase() || null, phone: g('#e_phone'), phone_2: g('#e_phone2'),
          website: g('#e_web'), linkedin: g('#e_li'), geo_region: g('#e_region'),
          address: g('#e_addr'), notes: g('#e_notes'),
          next_step: g('#e_next'), next_step_due: g('#e_due'),
          updated_at: new Date().toISOString()
        });
        UI.toast('Contact updated', { kind: 'ok' });
        render();
      };
    }
  });
}

function openAddMeeting(prefill = {}) {
  const days = eventDays();
  const now = UI.nowInTz();
  const body = `
    ${F('m_co', 'Company', prefill.company_name || '', 'required autocapitalize="words" placeholder="Who did you meet"')}
    <div class="grid2">
      ${SEL('m_day', 'Day', prefill.meeting_date || (days.includes(now.date) ? now.date : days[0]), days.map(d => ({ v: d, label: UI.fmtDate(d) })), 'Pick a day')}
      ${F('m_time', 'Time', prefill.meeting_time || String(Math.floor(now.min / 60)).padStart(2, '0') + ':' + String(now.min % 60).padStart(2, '0'), 'type="time" class="input mono"')}
    </div>
    ${F('m_person', 'Who you met', prefill.prospect_name || '', 'autocapitalize="words"')}
    ${F('m_title', 'Their title', prefill.designation || '')}
    <div class="grid2">
      ${F('m_email', 'Email', prefill.email || '', 'type="email" inputmode="email" autocapitalize="none" spellcheck="false"')}
      ${F('m_mobile', 'Mobile', prefill.mobile || '', 'type="tel" inputmode="tel"')}
    </div>
    <div class="grid2">
      ${SEL('m_region', 'Region', prefill.geo_region || '', REGIONS)}
      ${SEL('m_cat', 'Business type', prefill.category || 'New Business', CATEGORIES)}
    </div>
    ${SEL('m_owner', 'Owner on our side', S.me?.user_id, S.members.map(x => ({ v: x.user_id, label: x.short_name })), 'Unassigned')}
    ${SEL('m_rep', 'Inside sales support', prefill.rep_id || '', S.members.filter(x => x.role === 'rep').map(x => ({ v: x.user_id, label: x.short_name })), 'None')}
    ${F('m_loc', 'Where', prefill.location || '', 'placeholder="Our stand, their stand, lounge"')}
    ${OUTPICK('m_out', 'How did it go?', null)}
    ${TA('m_notes', 'Notes', '', 'Context you want to remember.')}`;

  UI.openSheet({
    title: 'Add a walk-in', sub: 'Anyone you picked up on the floor', body,
    foot: `<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-save>Add meeting</button>`,
    onMount(b, f) {
      const getOut = bindPick(b, 'm_out');
      f.querySelector('[data-x]').onclick = () => UI.closeSheet();
      f.querySelector('[data-save]').onclick = async () => {
        const g = s => b.querySelector(s).value.trim() || null;
        const co = g('#m_co');
        if (!co) { b.querySelector('#m_co').classList.add('err'); b.querySelector('#m_co').focus(); return; }
        const ownerId = g('#m_owner'), repId = g('#m_rep');
        UI.closeSheet();
        const row = await Store.addMeeting({
          company_name: co, meeting_date: g('#m_day'), meeting_time: g('#m_time'),
          prospect_name: g('#m_person'), designation: g('#m_title'),
          email: (g('#m_email') || '').toLowerCase() || null, mobile: g('#m_mobile'),
          geo_region: g('#m_region'), category: g('#m_cat'),
          owner_id: ownerId, owner_name: UI.memberById(ownerId)?.short_name || null,
          rep_id: repId, rep_name: UI.memberById(repId)?.short_name || null,
          location: g('#m_loc'), comments: g('#m_notes'),
          source: 'walkin', status: 'met', duration_min: 30,
          outcome: getOut(), met_at: new Date().toISOString()
        });
        UI.toast(`${co} added`, getOut()
          ? { kind: 'ok', action: 'Open', onAction: () => openMeeting(row.id) }
          : { kind: 'ok', action: 'Log outcome', onAction: () => openOutcome(row.id, 2) });
        render(); renderDayRail();
      };
    }
  });
}

function openEditMeeting(id) {
  const m = S.meetings.find(x => x.id === id);
  if (!m) return;
  const days = eventDays();
  const body = `
    ${F('x_co', 'Company', m.company_name, 'autocapitalize="words"')}
    <div class="grid2">
      ${SEL('x_day', 'Day', m.meeting_date, days.map(d => ({ v: d, label: UI.fmtDate(d) })), 'Unscheduled')}
      ${F('x_time', 'Time', (m.meeting_time || '').slice(0, 5), 'type="time" class="input mono"')}
    </div>
    <div class="grid2">
      ${F('x_person', 'Who you met', m.prospect_name || '', 'autocapitalize="words"')}
      ${F('x_title', 'Their title', m.designation || '')}
    </div>
    <div class="grid2">
      ${F('x_email', 'Email', m.email || '', 'type="email" inputmode="email" autocapitalize="none" spellcheck="false"')}
      ${F('x_mobile', 'Mobile', m.mobile || '', 'type="tel" inputmode="tel"')}
    </div>
    <div class="grid2">
      ${SEL('x_region', 'Region', m.geo_region || '', REGIONS)}
      ${SEL('x_cat', 'Business type', m.category || '', CATEGORIES)}
    </div>
    ${SEL('x_owner', 'Owner', m.owner_id || '', S.members.map(x => ({ v: x.user_id, label: x.short_name })), 'Unassigned')}
    ${SEL('x_rep', 'Inside sales', m.rep_id || '', S.members.map(x => ({ v: x.user_id, label: x.short_name })), 'None')}
    ${F('x_loc', 'Where', m.location || '')}
    ${TA('x_notes', 'Comments', m.comments || '')}`;

  UI.openSheet({
    title: 'Edit meeting', sub: m.company_name, body,
    foot: `<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-save>Save</button>`,
    onMount(b, f) {
      f.querySelector('[data-x]').onclick = () => UI.closeSheet();
      f.querySelector('[data-save]').onclick = async () => {
        const g = s => b.querySelector(s).value.trim() || null;
        const ownerId = g('#x_owner'), repId = g('#x_rep');
        UI.closeSheet();
        await Store.updateMeeting(m.id, {
          company_name: g('#x_co') || m.company_name,
          meeting_date: g('#x_day'), meeting_time: g('#x_time'),
          prospect_name: g('#x_person'), designation: g('#x_title'),
          email: (g('#x_email') || '').toLowerCase() || null, mobile: g('#x_mobile'),
          geo_region: g('#x_region'), category: g('#x_cat'),
          owner_id: ownerId, owner_name: UI.memberById(ownerId)?.short_name || null,
          rep_id: repId, rep_name: UI.memberById(repId)?.short_name || null,
          location: g('#x_loc'), comments: g('#x_notes'),
          updated_at: new Date().toISOString()
        });
        UI.toast('Meeting updated', { kind: 'ok' });
        render(); renderDayRail();
      };
    }
  });
}

function openAddEvent() {
  const body = `
    ${F('v_name', 'Event name', '', 'required autocapitalize="words" placeholder="World Travel Market 2026"')}
    <div class="grid2">${F('v_short', 'Short name', '', 'placeholder="WTM 26"')}${F('v_city', 'City', '', 'autocapitalize="words"')}</div>
    ${F('v_venue', 'Venue', '', 'autocapitalize="words"')}
    ${F('v_stand', 'Our stand', '', 'placeholder="ME1234"')}
    <div class="grid2">${F('v_from', 'Starts', '', 'type="date" class="input mono"')}${F('v_to', 'Ends', '', 'type="date" class="input mono"')}</div>
    ${SEL('v_tz', 'Timezone', 'Asia/Dubai', ['Asia/Dubai', 'Asia/Calcutta', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'Asia/Singapore', 'Asia/Riyadh'], 'Pick one')}
    <div class="hint">New events start empty. Add meetings as you book them, or send me the sheet and I will import it.</div>`;

  UI.openSheet({
    title: 'Create an event', sub: 'A separate floor, its own meetings and cards', body,
    foot: `<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-save>Create</button>`,
    onMount(b, f) {
      f.querySelector('[data-x]').onclick = () => UI.closeSheet();
      f.querySelector('[data-save]').onclick = async () => {
        const g = s => b.querySelector(s).value.trim() || null;
        const name = g('#v_name'), from = g('#v_from'), to = g('#v_to');
        let bad = false;
        [['#v_name', name], ['#v_from', from], ['#v_to', to]].forEach(([sel, v]) => {
          b.querySelector(sel).classList.toggle('err', !v); if (!v) bad = true;
        });
        if (bad) return;
        UI.closeSheet();
        const ev = await Store.addEvent({
          name, short_name: g('#v_short') || name, city: g('#v_city'), venue: g('#v_venue'),
          stand: g('#v_stand'), starts_on: from, ends_on: to, timezone: g('#v_tz') || 'Asia/Dubai'
        });
        UI.toast(`${name} created`, { kind: 'ok', action: 'Open', onAction: () => doSwitchEvent(ev.id) });
        render();
      };
    }
  });
}

function openSwitchEvent() {
  const body = S.events.map(e => `<button class="matchopt" data-act="pickEvent" data-id="${e.id}" aria-pressed="${e.id === S.eventId}">
      <span class="mi">${I.calendar}</span>
      <span class="mb"><span class="m1">${UI.esc(e.name)}</span>
      <span class="m2">${UI.esc([e.city, `${UI.fmtDate(e.starts_on)} to ${UI.fmtDate(e.ends_on)}`].filter(Boolean).join(' · '))}</span></span>
      ${e.id === S.eventId ? `<span style="color:var(--brand-2);display:flex">${I.check}</span>` : ''}
    </button>`).join('') +
    `<button class="btn ghost block" data-act="addEvent" style="margin-top:12px">${I.plus}Create a new event</button>`;
  UI.openSheet({ title: 'Events', sub: 'Pick the floor you are on', body });
}

async function doSwitchEvent(id) {
  UI.closeSheet();
  await Store.switchEvent(id);
  V.day = null;
  renderDayRail(); render();
  UI.toast(`Now on ${UI.activeEvent()?.name || 'event'}`);
}

function openTeam() {
  const body = `<div class="card lb">${S.members.map(m => {
    const isRep = m.role === 'rep';
    const mine = S.meetings.filter(x => (isRep ? x.rep_id === m.user_id : x.owner_id === m.user_id));
    return `<div class="lbrow${m.user_id === meId() ? ' me' : ''}">
      ${UI.avatar(m, 'sm')}
      <span class="who"><span class="n">${UI.esc(m.full_name)}${m.user_id === meId() ? ' · you' : ''}</span>
      <span class="s">${UI.esc(m.title || (isRep ? 'Inside sales' : 'Leadership'))} · ${mine.length} ${isRep ? 'booked' : 'meetings'}</span></span>
      <span class="nums"><span class="big">${mine.filter(x => x.outcome === 'deal').length}</span><span class="sm">DEALS</span></span>
    </div>`;
  }).join('')}</div>`;
  UI.openSheet({ title: 'On the floor', sub: `${S.members.length} people`, body });
}

/* ---- attach lead to meeting ---- */
function openLinkMeeting(leadId) {
  const l = S.leads.find(x => x.id === leadId);
  if (!l) return;
  const cands = matchMeetings(l).slice(0, 12);
  const list = cands.length ? cands : scoped(S.meetings).slice(0, 20).map(m => ({ m, score: 0 }));
  const body = `<div class="matchbox"><div class="mh">Best guesses first</div>
    ${list.map(({ m }) => `<button class="matchopt" data-act="doLink" data-id="${l.id}" data-m="${m.id}">
      <span class="mi">${I.calendar}</span>
      <span class="mb"><span class="m1">${UI.esc(m.company_name)}</span>
      <span class="m2">${UI.esc(UI.fmtDate(m.meeting_date))} · ${UI.esc(UI.fmtTimeStr(m.meeting_time))}${m.prospect_name ? ' · ' + UI.esc(m.prospect_name) : ''}</span></span>
    </button>`).join('')}</div>`;
  UI.openSheet({ title: 'Attach to a meeting', sub: l.full_name || l.company || '', body });
}

function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/\b(llc|ltd|limited|inc|corp|corporation|co|company|gmbh|plc|pvt|private|group|holdings?|international|global|the|and|&|dmc|travel|tours?|tourism|hotels?|technologies|technology|solutions?|services?|systems?)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function matchMeetings(l) {
  const co = norm(l.company);
  const dom = (l.email || '').split('@')[1] || (l.website || '').replace(/^www\./, '');
  const toks = co.split(' ').filter(t => t.length > 2);
  const out = [];
  S.meetings.forEach(m => {
    let sc = 0;
    const mco = norm(m.company_name);
    if (co && mco) {
      if (mco === co) sc += 60;
      else if (mco.includes(co) || co.includes(mco)) sc += 40;
      else {
        const mt = mco.split(' ');
        const hit = toks.filter(t => mt.includes(t)).length;
        if (hit) sc += hit * 16;
      }
    }
    if (dom) {
      const md = (m.domain || (m.email || '').split('@')[1] || '').replace(/^www\./, '').toLowerCase();
      if (md && (md === dom.toLowerCase() || md.includes(dom.toLowerCase()))) sc += 50;
    }
    if (l.email && m.email && l.email.toLowerCase() === m.email.toLowerCase()) sc += 70;
    if (l.full_name && m.prospect_name && norm(l.full_name) === norm(m.prospect_name)) sc += 45;
    if (isMine(m)) sc += 6;
    if (m.meeting_date === UI.nowInTz().date) sc += 5;
    if (sc >= 20) out.push({ m, score: sc });
  });
  return out.sort((a, b) => b.score - a.score);
}


/* ============================================================
   RENDER
   ============================================================ */
function render() {
  const main = UI.$('#main');
  const map = { today: viewToday, agenda: viewAgenda, leads: viewLeads, walkins: viewWalkins, scan: viewScan, board: viewBoard, me: viewMe };
  const fn = map[V.tab] || viewToday;
  /* Mid-sync with nothing in hand, an empty state reads as lost data. Skeletons
     say "still coming" instead. */
  if (!S.ready || (S.net === 'syncing' && !S.meetings.length && !S.leads.length)) {
    main.innerHTML = `<div class="page">${UI.skeletons(5)}</div>`;
    UI.$$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.t === V.tab)));
    return;
  }
  /* A throw inside one view used to leave the last screen on display, so the
     tab looked broken with no clue why. Now it says so, on screen. */
  try {
    main.innerHTML = `<div class="page">${fn()}</div>`;
  } catch (err) {
    console.error('view failed', V.tab, err);
    main.innerHTML = `<div class="page">${UI.emptyState('alert', 'This screen hit an error',
      'Nothing is lost and your data is safe. Reload and it will come back. If it keeps happening, send this line: ' +
      (err && err.message ? err.message : 'unknown'),
      { act: 'hardReload', label: 'Reload the app', icon: 'refresh' })}</div>`;
  }
  hydrateThumbs();
  paintNudge();
  UI.$$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.t === V.tab)));
  const titles = { today: 'Today', agenda: 'All days', leads: 'Leads', walkins: 'Walk-ins', scan: 'Scan a card', board: 'Analytics', me: 'You' };
  const vt = UI.$('#viewTitle');
  if (vt) vt.textContent = titles[V.tab] || 'Today';
  UI.$('#dayrail').hidden = !(V.tab === 'today' || V.tab === 'board');

  const badge = S.meetings.filter(m => isMine(m) && !m.outcome && m.meeting_date === UI.nowInTz().date).length;
  const tt = UI.$('.tab[data-t="today"]');
  tt.querySelector('.bdg')?.remove();
  if (badge && V.tab !== 'today') tt.insertAdjacentHTML('afterbegin', `<span class="bdg">${badge > 99 ? '99+' : badge}</span>`);
}

/* ============================================================
   THE NUDGE — the floor moves faster than memory
   ============================================================ */
const NKEY = 'sf_nudge_v1';
function nRead() { try { return JSON.parse(localStorage.getItem(NKEY) || '{}'); } catch (e) { return {}; } }
function nWrite(o) { try { localStorage.setItem(NKEY, JSON.stringify(o)); } catch (e) {} }
function slotEnd(m) { const st = UI.toMin(m.meeting_time); return st == null ? null : st + (m.duration_min || 30); }

/* Backing off further each time so a busy person is asked less, not more. */
const SNOOZE = [25, 25, 45, 240];
function nudgeLater(id) {
  const o = nRead();
  const e = o[id] || { n: 0 };
  const mins = SNOOZE[Math.min(e.n, SNOOZE.length - 1)];
  e.n = (e.n || 0) + 1;
  e.until = Date.now() + mins * 60000;
  o[id] = e; nWrite(o);
  return mins;
}
function nudgeClear(id) { const o = nRead(); delete o[id]; nWrite(o); }
/* Answering step one and then backing out of step two should not bounce the
   same card straight back at you. */
function nudgeHold(id, mins = 20) {
  const o = nRead();
  const e = o[id] || { n: 0 };
  e.until = Date.now() + mins * 60000;
  o[id] = e; nWrite(o);
}

/* Only the person who was actually in the room gets asked. Reps book the
   meeting, they do not sit in it, so nudging them would be pure noise. */
function nudgeQueue() {
  if (!S.ready) return [];
  const now = UI.nowInTz();
  const o = nRead();
  const after = CFG.nudgeAfterMin || 2;
  return S.meetings
    .filter(m => m.owner_id === meId() && m.meeting_date === now.date && !isDone(m))
    .filter(m => { const e = slotEnd(m); return e != null && now.min >= e + after; })
    .filter(m => !((o[m.id] || {}).until > Date.now()))
    .sort((a, b) => slotEnd(b) - slotEnd(a));   /* freshest conversation first */
}

function paintNudge() {
  const el = UI.$('#nudge');
  if (!el) return;
  const hidden = UI.$('#app').hidden || !UI.$('#sheet').hidden || document.body.classList.contains('nonudge');
  const q = hidden ? [] : nudgeQueue();
  if (!q.length) {
    if (el.dataset.nid) {
      el.dataset.nid = '';
      el.classList.remove('on');
      setTimeout(() => { if (!el.dataset.nid) { el.hidden = true; el.innerHTML = ''; } }, 240);
    }
    return;
  }
  const m = q[0];
  const more = q.length - 1;
  if (el.dataset.nid === m.id && el.querySelector('.nudge')) {
    const c = el.querySelector('.nd-more');
    if (c) { c.textContent = more ? `${more} more waiting` : ''; c.hidden = !more; }
    el.hidden = false;
    el.classList.add('on');
    return;
  }
  const fresh = el.dataset.nid !== m.id;
  el.dataset.nid = m.id;
  /* Attendance already answered: the only thing missing is the outcome, so ask
     for that instead of asking whether they showed up twice. */
  const seen = m.status === 'met';
  el.innerHTML = `<div class="nudge">
    <div class="nd-h"><span class="nd-dot"></span>${seen ? 'Outcome missing' : 'Just wrapped'} · ${UI.esc(UI.fmtTimeStr(m.meeting_time))}
      <button class="nd-x" data-act="nudgeLater" data-id="${m.id}">Later</button></div>
    <h4>${UI.esc(m.company_name || 'This meeting')}</h4>
    <div class="nd-s">${UI.esc([m.prospect_name, m.designation, m.geo_region].filter(Boolean).join(' · ') || 'Log it while it is fresh')}</div>
    <div class="nd-b">
      ${seen
        ? `<button class="btn primary" data-act="nudgeMet" data-id="${m.id}">${I.bolt}Log the outcome</button>
           <button class="btn" data-act="nudgeLater" data-id="${m.id}">Not now</button>`
        : `<button class="btn primary" data-act="nudgeMet" data-id="${m.id}">${I.handshake}They turned up</button>
           <button class="btn" data-act="nudgeNo" data-id="${m.id}">${I.ban}No show</button>`}
    </div>
    <div class="nd-more"${more ? '' : ' hidden'}>${more ? more + ' more waiting' : ''}</div>
  </div>`;
  el.hidden = false;
  void el.offsetHeight;                    /* commit the start state, then animate */
  requestAnimationFrame(() => { el.classList.add('on'); });
  setTimeout(() => el.classList.add('on'), 60);   /* belt and braces: never stick at zero */
  if (fresh) UI.buzz(12);
}

/* ============================================================
   THE DAY WRAP — one honest look back before the stand closes
   ============================================================ */
function dayStats(date, list) {
  const src = (list || S.meetings).filter(m => !date || date === 'all' || m.meeting_date === date);
  const cards = S.leads.filter(l => {
    if (!date || date === 'all') return true;
    const m = l.meeting_id && S.meetings.find(x => x.id === l.meeting_id);
    return m ? m.meeting_date === date : String(l.created_at || '').slice(0, 10) === date;
  });
  const open = src.filter(m => !isDone(m));
  return {
    total: src.length,
    logged: src.filter(isDone).length,
    open,
    deal: src.filter(m => m.outcome === 'deal'),
    hot: src.filter(m => m.outcome === 'future_opportunity'),
    nurture: src.filter(m => m.outcome === 'nurture'),
    missed: src.filter(m => m.outcome === 'no_show' || m.status === 'no_show'),
    dropped: src.filter(m => m.outcome === 'no_deal' || m.outcome === 'unqualified'),
    cards,
    value: src.filter(m => m.outcome === 'deal').reduce((s, m) => s + (Number(m.deal_value_usd) || 0), 0),
    pipe: src.filter(m => m.outcome === 'future_opportunity').reduce((s, m) => s + (Number(m.deal_value_usd) || 0), 0),
    steps: src.filter(m => m.next_step).map(m => `${m.company_name}: ${m.next_step}`)
  };
}

/* Plain text on purpose. It gets pasted into WhatsApp, not rendered. */
function digestText(date, teamWide) {
  const ev = UI.activeEvent();
  const who = teamWide ? S.meetings : S.meetings.filter(isMine);
  const s = dayStats(date, who);
  const L = [];
  L.push(`${ev?.short_name || ev?.name || 'Event'} · ${UI.fmtDate(date)}`);
  L.push(teamWide ? 'Whole team' : (S.me?.short_name || 'My day'));
  L.push('');
  L.push(`Meetings ${s.total} · logged ${s.logged} · open ${s.open.length}`);
  L.push(`Deals ${s.deal.length}${s.value ? ' (' + UI.money(s.value) + ')' : ''} · Future ${s.hot.length}${s.pipe ? ' (' + UI.money(s.pipe) + ')' : ''} · Nurture ${s.nurture.length}`);
  L.push(`No show ${s.missed.length} · Closed out ${s.dropped.length} · Cards ${s.cards.length}`);
  if (teamWide) {
    const rows = S.members.filter(x => x.role !== 'rep')
      .map(x => { const mine = S.meetings.filter(m => m.owner_id === x.user_id && m.meeting_date === date); return { x, t: mine.length, l: mine.filter(isDone).length, d: mine.filter(m => m.outcome === 'deal').length }; })
      .filter(r => r.t).sort((a, b) => b.d - a.d || b.l - a.l);
    if (rows.length) { L.push(''); rows.forEach(r => L.push(`${r.x.short_name}: ${r.l}/${r.t} logged, ${r.d} deal${r.d === 1 ? '' : 's'}`)); }
  }
  if (s.deal.length) { L.push(''); L.push('Deals'); s.deal.slice(0, 8).forEach(m => L.push(`- ${m.company_name}${m.deal_value_usd ? ' · ' + UI.money(m.deal_value_usd) : ''}`)); }
  if (s.steps.length) { L.push(''); L.push('Next steps'); s.steps.slice(0, 8).forEach(t => L.push(`- ${t}`)); }
  if (s.open.length) { L.push(''); L.push(`Still to log: ${s.open.slice(0, 10).map(m => m.company_name).join(', ')}`); }
  return L.join('\n');
}

function openWrap(date, auto) {
  const d = date && date !== 'all' ? date : (UI.nowInTz().date);
  /* Your wrap is your day. Only the admin gets the whole floor, so the numbers
     on screen and the numbers in the message are always the same numbers. */
  const teamWide = Store.isAdmin();
  const s = dayStats(d, S.meetings.filter(isMine));
  const txt = digestText(d, teamWide);

  UI.openSheet({
    title: `${UI.fmtDate(d)} wrap`,
    sub: auto ? 'Before the stand closes' : `${s.logged} of ${s.total} logged`,
    body: `
      <div class="kpis" style="margin-bottom:14px">
        <div class="kpi brand"><div class="k">Logged</div><div class="v tnum">${s.logged}<i style="font-size:14px;color:var(--tx-3)">/${s.total}</i></div><div class="d">${s.open.length} still open</div></div>
        <div class="kpi deal"><div class="k">Deals</div><div class="v tnum">${s.deal.length}</div><div class="d">${s.value ? UI.money(s.value) : 'none yet'}</div></div>
        <div class="kpi hot"><div class="k">Future</div><div class="v tnum">${s.hot.length}</div><div class="d">${s.nurture.length} nurture</div></div>
        <div class="kpi"><div class="k">Cards</div><div class="v tnum">${s.cards.length}</div><div class="d">captured today</div></div>
      </div>

      ${s.open.length ? `<div class="sec-h"><h2>Clear these while you remember them</h2><span class="count">${s.open.length}</span></div>
        <div class="card dlist">
          ${s.open.slice(0, 14).map(m => `<button class="dealrow" data-act="outcome" data-id="${m.id}">
            <span class="dl-t">
              <span class="dl-1">${UI.esc(m.company_name || 'Unnamed')}</span>
              <span class="dl-2">${UI.esc([UI.fmtTimeStr(m.meeting_time), m.prospect_name].filter(Boolean).join(' · '))}</span>
            </span>${I.chev}
          </button>`).join('')}
        </div>` : `<div class="card" style="padding:16px;text-align:center">
          <div style="font-weight:650;font-size:14.5px">Every meeting on your name is logged.</div>
          <div class="hint" style="margin-top:4px">That is the whole job done for today.</div>
        </div>`}

      <div class="sec-h" style="margin-top:16px"><h2>Send the day on</h2></div>
      <pre class="digest">${UI.esc(txt)}</pre>`,
    foot: `<button class="btn wa" data-act="shareWrap" data-id="${d}">${I.whatsapp}WhatsApp</button>
      <button class="btn ghost" data-act="copyWrap" data-id="${d}">${I.copy}Copy</button>
      <button class="btn ghost" data-x>Close</button>`,
    onMount(b, f) { f.querySelector('[data-x]').onclick = () => UI.closeSheet(); }
  });
}

/* ============================================================
   THE CONSOLE — who is on, who is not, who is doing what
   ============================================================ */
function presence(mem) {
  const t = mem.last_seen_at ? new Date(mem.last_seen_at).getTime() : 0;
  if (!t) return { k: 'never', label: 'Never signed in' };
  const mins = (Date.now() - t) / 60000;
  if (mins < 4) return { k: 'live', label: 'On the app now' };
  if (mins < 45) return { k: 'recent', label: 'Active ' + UI.ago(t) };
  return { k: 'away', label: 'Last seen ' + UI.ago(t) };
}

function teamPane() {
  const day = V.boardDay === 'day' && V.day !== 'all' ? V.day : null;
  const mtgs = day ? S.meetings.filter(m => m.meeting_date === day) : S.meetings;
  const rows = S.members.map(mem => {
    const isRep = mem.role === 'rep';
    const mine = mtgs.filter(m => (isRep ? m.rep_id : m.owner_id) === mem.user_id);
    const acts = S.activity.filter(a => a.actor_id === mem.user_id);
    return {
      mem, isRep, p: presence(mem),
      total: mine.length,
      logged: mine.filter(isDone).length,
      deal: mine.filter(m => m.outcome === 'deal').length,
      cards: S.leads.filter(l => l.captured_by === mem.user_id).length,
      voice: mine.filter(m => m.voice_note_path).length,
      last: acts[0] || null
    };
  });
  const order = { live: 0, recent: 1, away: 2, never: 3 };
  rows.sort((a, b) => order[a.p.k] - order[b.p.k] || b.logged - a.logged || String(a.mem.short_name).localeCompare(b.mem.short_name));
  const on = rows.filter(r => r.p.k === 'live').length;
  const never = rows.filter(r => r.p.k === 'never');
  const behind = rows.filter(r => r.total && r.logged < r.total);

  return `
  <div class="kpis" style="margin-bottom:14px">
    <div class="kpi brand"><div class="k">On the app now</div><div class="v tnum">${on}</div><div class="d">of ${rows.length} on the roster</div></div>
    <div class="kpi ${never.length ? 'bad' : 'deal'}"><div class="k">Never signed in</div><div class="v tnum">${never.length}</div><div class="d">${never.length ? never.map(r => UI.esc(r.mem.short_name)).join(', ') : 'everyone is in'}</div></div>
    <div class="kpi hot"><div class="k">Behind on logging</div><div class="v tnum">${behind.length}</div><div class="d">${behind.reduce((s, r) => s + (r.total - r.logged), 0)} outcomes open</div></div>
    <div class="kpi"><div class="k">Cards today</div><div class="v tnum">${S.leads.length}</div><div class="d">${mtgs.filter(m => m.voice_note_path).length} voice notes</div></div>
  </div>

  <div class="sec">
    <div class="sec-h"><h2>The floor right now</h2><span class="count">${rows.length}</span></div>
    <div class="card tlist">
      ${rows.map(r => `<div class="trow">
        <span class="tav">${UI.avatar(r.mem, 'sm')}<i class="pdot ${r.p.k}"></i></span>
        <span class="tmid">
          <span class="t1">${UI.esc(r.mem.short_name || r.mem.full_name)}<em>${r.isRep ? 'IS rep' : UI.esc(r.mem.title || 'Leadership')}</em></span>
          <span class="t2 ${r.p.k}">${UI.esc(r.p.label)}${r.mem.device ? ' · ' + UI.esc(r.mem.device) : ''}${r.mem.app_build ? ' · b' + UI.esc(r.mem.app_build) : ''}</span>
          ${r.last ? `<span class="t3">${I.bolt}${UI.esc(r.last.summary || '')} · ${UI.ago(r.last.created_at)}</span>` : `<span class="t3 mut">${I.info}Nothing logged yet</span>`}
        </span>
        <span class="tnums">
          <b class="tnum">${r.logged}<i>/${r.total}</i></b>
          <em>${r.deal} deal${r.deal === 1 ? '' : 's'} · ${r.cards} card${r.cards === 1 ? '' : 's'}</em>
        </span>
      </div>`).join('')}
    </div>
  </div>

  <div class="sec">
    <div class="sec-h"><h2>Everything happening</h2><span class="count">${S.activity.length}</span></div>
    <div class="card feed">
      ${S.activity.length ? S.activity.slice(0, 40).map(feedRow).join('')
        : `<div class="hint" style="padding:16px;text-align:center">Nothing yet. Every outcome, card and voice note lands here the second it is recorded.</div>`}
    </div>
  </div>

  <div style="display:flex;flex-direction:column;gap:9px;margin-top:4px">
    <button class="btn primary block" data-act="wrap" data-id="${day || UI.nowInTz().date}">${I.days}Open the day wrap</button>
    <button class="btn ghost block" data-act="refresh">${I.refresh}Refresh the floor</button>
  </div>`;
}

window.Views = {
  V, render, renderDayRail, eventDays, isMine, meId, liveInfo,
  openMeeting, openOutcome, openOutcomeList, openLead, openEditLead, openAddMeeting, openEditMeeting,
  openAddEvent, openSwitchEvent, doSwitchEvent, openTeam, openLinkMeeting,
  matchMeetings, leadCard, hydrateThumbs, scoped, dayFilter, defaultDay,
  paintNudge, nudgeQueue, nudgeLater, nudgeClear, nudgeHold, openWrap, digestText, dayStats
};
