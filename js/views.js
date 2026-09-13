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
  boardDay: 'event'   // event | day
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
function isDone(m) { return !!m.outcome || ['no_show', 'cancelled'].includes(m.status); }

function leadsFor(meetingId) { return S.leads.filter(l => l.meeting_id === meetingId); }

/* ---------------- day rail ---------------- */
function renderDayRail() {
  const rail = UI.$('#dayrail');
  const days = eventDays();
  const today = UI.nowInTz().date;
  if (!V.day) V.day = days.includes(today) ? today : (days[0] || 'all');

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

  const logged = sorted.filter(m => m.outcome).length;
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

  if (live) html += nowCard(live, 'In progress now');
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
      <button class="btn" data-act="scanFor" data-id="${m.id}">${I.card}Scan card</button>
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
    <p>Point the camera at the card. Name, title, company, email and phone come back filled in, ready for you to check.</p>
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
function viewBoard() {
  const inDay = V.boardDay === 'day' && V.day !== 'all';
  const mtgs = inDay ? S.meetings.filter(m => m.meeting_date === V.day) : S.meetings;
  const leads = inDay ? S.leads.filter(l => {
    const m = l.meeting_id && S.meetings.find(x => x.id === l.meeting_id);
    return m ? m.meeting_date === V.day : String(l.created_at || '').slice(0, 10) === V.day;
  }) : S.leads;

  const logged = mtgs.filter(m => m.outcome);
  const byGrp = g => mtgs.filter(m => m.outcome && OUT_MAP[m.outcome]?.grp === g);
  const deals = byGrp('created');
  const open = byGrp('open');
  const dropped = byGrp('dropped');
  const missed = byGrp('missed');
  const dealVal = deals.reduce((s, m) => s + (Number(m.deal_value_usd) || 0), 0);
  const openVal = open.reduce((s, m) => s + (Number(m.deal_value_usd) || 0), 0);

  /* leaderboard */
  const rows = S.members.map(mem => {
    const isRep = mem.role === 'rep';
    const mine = mtgs.filter(m => (isRep ? m.rep_id : m.owner_id) === mem.user_id);
    const cnt = g => mine.filter(m => m.outcome && OUT_MAP[m.outcome]?.grp === g).length;
    return {
      mem, isRep, total: mine.length,
      logged: mine.filter(m => m.outcome).length,
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

  return `
  <div class="segs" style="margin-bottom:14px">
    <button data-bd="event" aria-selected="${V.boardDay === 'event'}">Whole event</button>
    <button data-bd="day" aria-selected="${V.day === 'all' ? 'false' : String(V.boardDay === 'day')}">${V.day === 'all' ? 'Single day' : UI.fmtDate(V.day)}</button>
  </div>

  <div class="kpis">
    <div class="kpi brand"><div class="k">Meetings</div><div class="v tnum">${mtgs.length}</div><div class="d">${logged.length} logged, ${mtgs.length - logged.length} open</div></div>
    <div class="kpi deal"><div class="k">Deals created</div><div class="v tnum">${deals.length}</div><div class="d">${deals.length ? UI.money(dealVal) + ' in play' : 'none recorded yet'}</div></div>
    <div class="kpi hot"><div class="k">Still in play</div><div class="v tnum">${open.length}</div><div class="d">${openVal ? UI.money(openVal) + ' behind them' : 'future and nurture'}</div></div>
    <div class="kpi bad"><div class="k">Closed out</div><div class="v tnum">${dropped.length + missed.length}</div><div class="d">${dropped.length} dropped, ${missed.length} no show</div></div>
  </div>

  ${ledgerBlock(mtgs, logged)}
  ${dealsBlock(deals)}
  ${sourceBlock(mtgs, leads)}

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
function ledgerBlock(mtgs, logged) {
  const T = Math.max(1, logged.length);
  const rowsFor = OUTCOMES.map(o => {
    const list = mtgs.filter(m => m.outcome === o.v);
    return {
      o, n: list.length,
      value: OUT_VALUED.includes(o.v) ? list.reduce((s, m) => s + (Number(m.deal_value_usd) || 0), 0) : 0
    };
  });

  return `<div class="sec">
    <div class="sec-h">
      <h2>Outcome ledger</h2>
      <span class="count">${logged.length}/${mtgs.length} logged</span>
    </div>
    ${logged.length ? `<div class="stackbar" aria-hidden="true">
      ${rowsFor.filter(r => r.n).map(r => `<i class="t-${r.o.tone}" style="width:${r.n / T * 100}%" title="${r.o.label}"></i>`).join('')}
    </div>` : ''}
    <div class="card ledger">
      ${rowsFor.map(r => `<button class="ldg${r.n ? '' : ' zero'}" ${r.n ? `data-act="outList" data-id="${r.o.v}"` : 'disabled'}>
        <span class="lg-i t-${r.o.tone}">${I[r.o.icon] || I.bolt}</span>
        <span class="lg-t">
          <span class="lg-1">${r.o.label}</span>
          <span class="lg-2">${r.n ? (OUT_GRP[r.o.grp].label + (r.value ? ' · ' + UI.money(r.value) : '')) : r.o.desc}</span>
          <span class="lg-tr"><i class="t-${r.o.tone}" style="width:${r.n / T * 100}%"></i></span>
        </span>
        <span class="lg-n tnum">${r.n}</span>
        ${r.n ? I.chev : ''}
      </button>`).join('')}
    </div>
    ${logged.length < mtgs.length ? `<p class="hint" style="margin:8px 2px 0">${mtgs.length - logged.length} meeting${mtgs.length - logged.length === 1 ? '' : 's'} still without an outcome. Each one stays invisible to the pipeline until someone records it.</p>` : ''}
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
      ${sorted.map(m => `<button class="dealrow" data-act="meeting" data-id="${m.id}">
        <span class="dl-t">
          <span class="dl-1">${UI.esc(m.company_name || 'Unnamed')}</span>
          <span class="dl-2">${UI.esc(m.owner_name || 'Unassigned')} · ${UI.esc(SOURCES[m.source]?.label || 'Booked meeting')}${m.geo_region ? ' · ' + UI.esc(m.geo_region) : ''}</span>
          ${m.next_step ? `<span class="dl-3">${I.target}${UI.esc(m.next_step)}</span>` : ''}
        </span>
        <span class="dl-v tnum">${m.deal_value_usd ? UI.money(m.deal_value_usd) : '—'}</span>
        ${I.chev}
      </button>`).join('')}
    </div>
  </div>`;
}

/* ---------- how it came in ----------
   Booked ahead, walked up, or typed in on the floor. One line per route with
   the numbers that matter, so nobody has to guess where a deal originated. */
function sourceBlock(mtgs, leads) {
  const keys = ['sheet', 'walkin', 'manual'].filter(k => mtgs.some(m => (m.source || 'sheet') === k));
  const scanned = leads.filter(l => l.card_front_path || l.ocr_text).length;
  const rows = keys.map(k => {
    const list = mtgs.filter(m => (m.source || 'sheet') === k);
    return {
      k, n: list.length,
      called: list.filter(m => m.outcome).length,
      deal: list.filter(m => m.outcome === 'deal').length,
      open: list.filter(m => m.outcome && OUT_MAP[m.outcome]?.grp === 'open').length
    };
  });

  return `<div class="sec">
    <div class="sec-h"><h2>How it came in</h2></div>
    <div class="card srcs">
      <div class="srow head">
        <span class="s-1">Route</span>
        <span class="s-n">Total</span><span class="s-n">Logged</span>
        <span class="s-n">Deals</span><span class="s-n">Open</span>
      </div>
      ${rows.map(r => `<div class="srow">
        <span class="s-1">${SOURCES[r.k].label}<i>${SOURCES[r.k].desc}</i></span>
        <span class="s-n tnum">${r.n}</span>
        <span class="s-n tnum">${r.called}</span>
        <span class="s-n tnum${r.deal ? ' hi' : ''}">${r.deal}</span>
        <span class="s-n tnum">${r.open}</span>
      </div>`).join('')}
      <div class="srow foot">
        <span class="s-1">Cards captured<i>${scanned} read by the scanner, ${Math.max(0, leads.length - scanned)} typed by hand</i></span>
        <span class="s-n tnum">${leads.length}</span>
        <span class="s-n"></span><span class="s-n"></span><span class="s-n"></span>
      </div>
    </div>
    ${keys.length === 1 && keys[0] === 'sheet'
      ? `<p class="hint" style="margin:8px 2px 0">Everything so far came off the booked sheet. Walk-ins and hand-added prospects show up here as their own rows the moment someone logs one.</p>`
      : ''}
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
  const value = OUT_VALUED.includes(val) ? list.reduce((s, m) => s + (Number(m.deal_value_usd) || 0), 0) : 0;

  UI.openSheet({
    title: o.label,
    sub: `${list.length} ${list.length === 1 ? 'record' : 'records'}${value ? ' · ' + UI.money(value) : ''}${inDay ? ' · ' + UI.fmtDate(V.day) : ''}`,
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
      </div>`,
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
function viewMe() {
  const me = S.me || {};
  const mine = S.meetings.filter(isMine);
  const logged = mine.filter(m => m.outcome);
  const myLeads = S.leads.filter(l => l.captured_by === meId());
  const ev = UI.activeEvent();
  const byDay = eventDays().map(d => ({ d, n: mine.filter(m => m.meeting_date === d).length, l: mine.filter(m => m.meeting_date === d && m.outcome).length }));
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
    <div class="sec-h"><h2>Actions</h2></div>
    <div style="display:flex;flex-direction:column;gap:9px">
      <button class="btn block" data-act="addMeeting">${I.plus}Add a walk-in meeting</button>
      <button class="btn block" data-act="addEvent">${I.calendar}Create a new event</button>
      <button class="btn block" data-act="export">${I.download}Export to CSV</button>
      ${canInstall ? `<button class="btn primary block" data-act="install">${I.upload}Install on this phone</button>` : ''}
      <button class="btn ghost block" data-act="refresh">${I.refresh}Refresh from server</button>
    </div>
  </div>

  <div class="sec">
    <div class="sec-h"><h2>Sync</h2></div>
    <div class="card" style="padding:4px 13px">
      <div class="drow"><span class="di">${S.net === 'offline' ? I.wifiOff : I.bolt}</span>
        <span class="dv"><span class="k">Connection</span><span class="v">${S.net === 'offline' ? 'Offline, work is saved on device' : S.pending ? S.pending + ' change' + (S.pending === 1 ? '' : 's') + ' syncing' : 'Live and in sync'}</span></span></div>
      <div class="drow"><span class="di">${I.sparkle}</span>
        <span class="dv"><span class="k">AI card reading</span><span class="v ${S.ocrConfigured === false ? 'mut' : ''}">${S.ocrConfigured === false ? 'Not switched on, using on-device' : 'Active'}</span></span></div>
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

    <div style="display:flex;flex-direction:column;gap:9px;margin-bottom:16px">
      <button class="btn primary block" data-act="outcome" data-id="${m.id}">${I.check}${m.outcome ? 'Update the call' : 'Log the outcome'}</button>
      <div style="display:flex;gap:9px">
        <button class="btn" style="flex:1" data-act="scanFor" data-id="${m.id}">${I.card}Scan card</button>
        <button class="btn" style="flex:1" data-act="editMeeting" data-id="${m.id}">${I.edit}Edit</button>
      </div>
    </div>

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

    <div class="sec-h"><h2>Cards from this meeting</h2><span class="count">${ls.length}</span></div>
    ${ls.length ? ls.map(leadCard).join('') : `<div class="hint" style="padding:4px 2px 12px">No card captured yet.</div>`}

    <div class="sec-h" style="margin-top:6px"><h2>Change status</h2></div>
    <div class="segs">
      ${STATUSES.map(s => `<button data-act="status" data-id="${m.id}" data-v="${s.v}" aria-selected="${m.status === s.v}">${s.label}</button>`).join('')}
    </div>`;

  UI.openSheet({ title: m.company_name, sub: [m.prospect_name, m.geo_region].filter(Boolean).join(' · ') || UI.fmtDate(m.meeting_date), body });
  hydrateThumbs();
}

function openOutcome(id) {
  const m = S.meetings.find(x => x.id === id);
  if (!m) return;
  let pick = m.outcome || null;

  const body = `
    <div class="outs" id="outGrid">
      ${OUTCOMES.map(o => `<button class="outbtn" data-v="${o.v}" aria-pressed="${pick === o.v}">
        <span class="oi">${I[o.icon] || I.bolt}</span>
        <span class="ot">${o.label}</span>
        <span class="od">${o.desc}</span>
      </button>`).join('')}
    </div>
    <div id="outExtra" style="margin-top:16px">
      <div class="field" id="valWrap" ${OUT_VALUED.includes(pick) ? '' : 'hidden'}>
        <label for="o_val">Deal value if it lands (USD)</label>
        <input class="input mono" id="o_val" type="number" inputmode="numeric" min="0" step="1000"
               placeholder="50000" value="${m.deal_value_usd != null ? UI.esc(m.deal_value_usd) : ''}">
      </div>
      <div class="field">
        <label for="o_next">Next step</label>
        <input class="input" id="o_next" placeholder="Send mapping sample, follow up Monday" value="${UI.esc(m.next_step || '')}">
      </div>
      <div class="field">
        <label for="o_due">Follow up by</label>
        <input class="input mono" id="o_due" type="date" value="${UI.esc(m.next_step_due || '')}">
      </div>
      <div class="field">
        <label for="o_notes">What actually happened</label>
        <textarea class="input" id="o_notes" placeholder="Who was in the room, what they run today, what they pushed back on.">${UI.esc(m.outcome_notes || '')}</textarea>
      </div>
    </div>`;

  UI.openSheet({
    title: m.outcome ? 'Update the call' : 'How did it go?',
    sub: m.company_name,
    body,
    foot: `<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-save disabled>Save outcome</button>`,
    onMount(b, f) {
      const save = f.querySelector('[data-save]');
      save.disabled = !pick;
      b.querySelectorAll('.outbtn').forEach(btn => {
        btn.onclick = () => {
          pick = btn.dataset.v;
          b.querySelectorAll('.outbtn').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === pick)));
          b.querySelector('#valWrap').hidden = !OUT_VALUED.includes(pick);
          save.disabled = false;
          UI.buzz();
        };
      });
      f.querySelector('[data-x]').onclick = () => UI.closeSheet();
      save.onclick = async () => {
        const prev = { outcome: m.outcome, status: m.status, deal_value_usd: m.deal_value_usd, next_step: m.next_step, next_step_due: m.next_step_due, outcome_notes: m.outcome_notes, met_at: m.met_at };
        const val = b.querySelector('#o_val').value;
        const values = {
          outcome: pick,
          status: pick === 'no_show' ? 'no_show' : 'met',
          deal_value_usd: OUT_VALUED.includes(pick) && val !== '' ? Number(val) : null,
          next_step: b.querySelector('#o_next').value.trim() || null,
          next_step_due: b.querySelector('#o_due').value || null,
          outcome_notes: b.querySelector('#o_notes').value.trim() || null,
          met_at: pick === 'no_show' ? null : (m.met_at || new Date().toISOString()),
          updated_at: new Date().toISOString()
        };
        UI.closeSheet();
        await Store.updateMeeting(m.id, values, {
          activity: {
            kind: 'outcome_' + pick,
            summary: `called ${OUT_MAP[pick].label.toLowerCase()} on ${m.company_name}`,
            payload: { outcome: pick, value: values.deal_value_usd }
          }
        });
        UI.buzz(18);
        UI.toast(`${OUT_MAP[pick].label} logged on ${m.company_name}`, {
          kind: pick === 'deal' ? 'ok' : '', action: 'Undo',
          onAction: () => Store.updateMeeting(m.id, { ...prev, updated_at: new Date().toISOString() })
            .then(() => UI.toast('Reverted'))
        });
        render();
      };
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

    <div style="display:flex;gap:9px;margin-bottom:16px">
      ${l.email ? `<a class="btn primary" style="flex:1" href="mailto:${UI.esc(l.email)}">${I.mail}Email</a>` : ''}
      ${l.phone ? `<a class="btn" style="flex:1" href="tel:${UI.esc(String(l.phone).replace(/\s/g, ''))}">${I.phone}Call</a>` : ''}
      <button class="btn ghost" data-act="editLead" data-id="${l.id}" style="flex:none">${I.edit}</button>
    </div>

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

    <div class="sec-h"><h2>Rate the interest</h2></div>
    <div class="segs" style="margin-bottom:16px">
      ${OUTCOMES.map(o => `<button data-act="rate" data-id="${l.id}" data-v="${o.v}" aria-selected="${l.interest === o.v}">${o.label}</button>`).join('')}
    </div>

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
    ${TA('e_notes', 'Notes', l.notes, 'What they run today, what they need, who decides.')}
    <div class="grid2">${F('e_next', 'Next step', l.next_step)}${F('e_due', 'Follow up by', l.next_step_due, 'type="date" class="input mono"')}</div>`;

  UI.openSheet({
    title: 'Edit contact', sub: l.full_name || l.company || '', body,
    foot: `<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-save>Save</button>`,
    onMount(b, f) {
      f.querySelector('[data-x]').onclick = () => UI.closeSheet();
      f.querySelector('[data-save]').onclick = async () => {
        const g = s => b.querySelector(s).value.trim() || null;
        UI.closeSheet();
        await Store.updateLead(l.id, {
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
    ${TA('m_notes', 'Notes', '', 'Context you want to remember.')}`;

  UI.openSheet({
    title: 'Add a walk-in', sub: 'Anyone you picked up on the floor', body,
    foot: `<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-save>Add meeting</button>`,
    onMount(b, f) {
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
          source: 'walkin', status: 'met', duration_min: 30
        });
        UI.toast(`${co} added`, { kind: 'ok', action: 'Log outcome', onAction: () => openOutcome(row.id) });
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

/* ---- thumbs ---- */
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
  for (const el of bigs) {
    const url = await Store.thumb(el.dataset.bigthumb);
    if (!url) continue;
    el.innerHTML = `<img src="${UI.esc(url)}" alt="Business card">`;
    el.removeAttribute('data-bigthumb'); el.style.minHeight = '';
  }
}

/* ============================================================
   RENDER
   ============================================================ */
function render() {
  const main = UI.$('#main');
  const map = { today: viewToday, agenda: viewAgenda, leads: viewLeads, walkins: viewWalkins, scan: viewScan, board: viewBoard, me: viewMe };
  const fn = map[V.tab] || viewToday;
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
  UI.$$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.t === V.tab)));
  const titles = { today: 'Today', agenda: 'All days', leads: 'Leads', walkins: 'Walk-ins', scan: 'Scan a card', board: 'Team board', me: 'You' };
  const vt = UI.$('#viewTitle');
  if (vt) vt.textContent = titles[V.tab] || 'Today';
  UI.$('#dayrail').hidden = !(V.tab === 'today' || V.tab === 'board');

  const badge = S.meetings.filter(m => isMine(m) && !m.outcome && m.meeting_date === UI.nowInTz().date).length;
  const tt = UI.$('.tab[data-t="today"]');
  tt.querySelector('.bdg')?.remove();
  if (badge && V.tab !== 'today') tt.insertAdjacentHTML('afterbegin', `<span class="bdg">${badge > 99 ? '99+' : badge}</span>`);
}

window.Views = {
  V, render, renderDayRail, eventDays, isMine, meId, liveInfo,
  openMeeting, openOutcome, openOutcomeList, openLead, openEditLead, openAddMeeting, openEditMeeting,
  openAddEvent, openSwitchEvent, doSwitchEvent, openTeam, openLinkMeeting,
  matchMeetings, leadCard, hydrateThumbs, scoped, dayFilter
};
