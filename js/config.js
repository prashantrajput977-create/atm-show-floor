/* Vervotech Showdown — configuration + icon set */

window.APP_NAME = 'Vervotech Showdown';
window.BUILD = '35';
window.CFG = {
  supabaseUrl: 'https://fofmpvgbeoxslpiegxql.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvZm1wdmdiZW94c2xwaWVneHFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4OTE4MTksImV4cCI6MjA5MzQ2NzgxOX0.2z6pMAf4kY5sufnSiXlPjvKNnbmVqG4hiHkS-jjnwpo',
  bucket: 'event-cards',
  ocrFn: 'card-ocr',
  /* shown on the sign-in screen before we have a session */
  eventTag: 'Arabian Travel Market 2026 · Dubai'
};

/* Outcome vocabulary — one shared source of truth for colour + copy */
/* Six calls, in pipeline order. `grp` drives the dashboard ledger and the
   leaderboard bars: created, open, missed, dropped. */
window.OUTCOMES = [
  { v: 'deal',               label: 'Deal',               short: 'Deal',    desc: 'Commercial intent, moving to contract',  icon: 'handshake', grp: 'created', tone: 'deal' },
  { v: 'future_opportunity', label: 'Future opportunity', short: 'Future',  desc: 'Right fit, wrong quarter. Budget later',  icon: 'flame',     grp: 'open',    tone: 'hot' },
  { v: 'nurture',            label: 'Nurture',            short: 'Nurture', desc: 'Real but no trigger yet, keep warm',      icon: 'seed',      grp: 'open',    tone: 'nurture' },
  { v: 'no_show',            label: 'No show',            short: 'No show', desc: 'Booked but never turned up',              icon: 'ban',       grp: 'missed',  tone: 'mute' },
  { v: 'no_deal',            label: 'No deal',            short: 'No deal', desc: 'Heard us out, not interested',            icon: 'x',         grp: 'dropped', tone: 'dead' },
  { v: 'unqualified',        label: 'Unqualified',        short: 'Unqual',  desc: 'Wrong fit, wrong size, no budget',        icon: 'flag',      grp: 'dropped', tone: 'dead' }
];
window.OUT_MAP = Object.fromEntries(window.OUTCOMES.map(o => [o.v, o]));
/* outcomes that carry a number worth reporting */
window.OUT_VALUED = ['deal', 'future_opportunity'];
window.OUT_GRP = {
  created: { label: 'Created',  desc: 'Deals called on the floor' },
  open:    { label: 'Still in play', desc: 'Worth a follow-up' },
  missed:  { label: 'Missed',   desc: 'Booked and never met' },
  dropped: { label: 'Dropped',  desc: 'Closed out at the stand' }
};
window.SOURCES = {
  sheet:  { label: 'Booked meeting', desc: 'From the meeting sheet' },
  walkin: { label: 'Walk-in',        desc: 'Stopped at the stand' },
  manual: { label: 'Added on site',  desc: 'Typed in by the team' }
};

window.STATUSES = [
  { v: 'scheduled',   label: 'Scheduled' },
  { v: 'met',         label: 'Met' },
  { v: 'no_show',     label: 'No show' },
  { v: 'rescheduled', label: 'Rescheduled' },
  { v: 'cancelled',   label: 'Cancelled' }
];

window.REGIONS = ['MENA', 'Asia', 'SEA', 'Europe', 'UK', 'Americas', 'Africa', 'Other'];
window.CATEGORIES = ['New Business', 'Existing Business', 'Existing + New', 'Existing Deal', 'Partner', 'Supplier'];

/* ---- Icons: 1.8px stroke, 24 grid, currentColor ---- */
const _i = (p, extra = '') =>
  `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${p}</svg>`;

window.I = {
  /* Two strokes converging on a single node: a V for Vervotech, and the act of
     two records meeting as one. Monochrome first, one accent node. */
  logo: `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><g stroke="currentColor" stroke-width="3.5" stroke-linecap="round"><path d="M5.6 6.4 13.9 22"/><path d="M26.4 6.4 18.1 22" opacity=".4"/></g><circle cx="16" cy="25.6" r="2.7" fill="currentColor"/></svg>`,

  calendar: _i('<rect x="3.2" y="4.8" width="17.6" height="16" rx="2.6"/><path d="M8 3v3.6M16 3v3.6M3.2 10h17.6"/>'),
  clock: _i('<circle cx="12" cy="12" r="8.8"/><path d="M12 7.4V12l3.2 2"/>'),
  users: _i('<path d="M15.6 20v-1.7a3.6 3.6 0 0 0-3.6-3.6H6.6A3.6 3.6 0 0 0 3 18.3V20"/><circle cx="9.3" cy="7.6" r="3.4"/><path d="M21 20v-1.7a3.6 3.6 0 0 0-2.7-3.5M16.2 4.4a3.6 3.6 0 0 1 0 6.6"/>'),
  scan: _i('<path d="M3.4 8.2V6a2.6 2.6 0 0 1 2.6-2.6h2.2M15.8 3.4H18A2.6 2.6 0 0 1 20.6 6v2.2M20.6 15.8V18A2.6 2.6 0 0 1 18 20.6h-2.2M8.2 20.6H6A2.6 2.6 0 0 1 3.4 18v-2.2"/><path d="M7 12h10" stroke-width="2"/>'),
  card: _i('<rect x="2.6" y="5.6" width="18.8" height="12.8" rx="2.4"/><path d="M6.2 10.4h5M6.2 13.6h3"/><circle cx="16.4" cy="11.4" r="1.9"/><path d="M13.6 15.9c.5-1.2 1.6-1.9 2.8-1.9s2.3.7 2.8 1.9"/>'),
  grid: _i('<rect x="3.4" y="3.4" width="7.2" height="7.2" rx="1.8"/><rect x="13.4" y="3.4" width="7.2" height="7.2" rx="1.8"/><rect x="3.4" y="13.4" width="7.2" height="7.2" rx="1.8"/><rect x="13.4" y="13.4" width="7.2" height="7.2" rx="1.8"/>'),
  user: _i('<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20.4a7.2 7.2 0 0 1 14.4 0"/>'),
  search: _i('<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.4 4.4"/>'),
  x: _i('<path d="M6 6l12 12M18 6 6 18"/>'),
  chev: _i('<path d="m9 5 7 7-7 7"/>'),
  chevDown: _i('<path d="m5 9 7 7 7-7"/>'),
  plus: _i('<path d="M12 5v14M5 12h14"/>'),
  check: _i('<path d="m4.8 12.6 4.6 4.6L19.2 7.4"/>'),
  checkCircle: _i('<circle cx="12" cy="12" r="8.8"/><path d="m8.4 12.2 2.6 2.6 4.6-5"/>'),
  mail: _i('<rect x="2.8" y="5" width="18.4" height="14" rx="2.4"/><path d="m3.6 7 8.4 6 8.4-6"/>'),
  phone: _i('<path d="M15.6 3.8h2.1a2.3 2.3 0 0 1 2.3 2.5c-.3 2.4-.9 4.6-1.9 6.6a17 17 0 0 1-7.5 7.5c-2 1-4.2 1.6-6.6 1.9a2.3 2.3 0 0 1-2.5-2.3v-2.1a2.3 2.3 0 0 1 2-2.3c.8-.1 1.6-.3 2.3-.6a2.3 2.3 0 0 1 2.4.5l1 1a14 14 0 0 0 3.4-3.4l-1-1a2.3 2.3 0 0 1-.5-2.4c.3-.7.5-1.5.6-2.3a2.3 2.3 0 0 1 1.9-1.6Z" transform="translate(1.2 -1.3)"/>'),
  globe: _i('<circle cx="12" cy="12" r="8.8"/><path d="M3.4 12h17.2M12 3.2c2.2 2.4 3.4 5.5 3.4 8.8s-1.2 6.4-3.4 8.8c-2.2-2.4-3.4-5.5-3.4-8.8S9.8 5.6 12 3.2Z"/>'),
  pin: _i('<path d="M19 10.4c0 5.4-7 11-7 11s-7-5.6-7-11a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10.2" r="2.6"/>'),
  building: _i('<path d="M4.6 20.6V5.4a1.8 1.8 0 0 1 1.8-1.8h7.2a1.8 1.8 0 0 1 1.8 1.8v15.2M15.4 9.4h2.2a1.8 1.8 0 0 1 1.8 1.8v9.4M2.8 20.6h18.4"/><path d="M8.2 7.6h3.6M8.2 11.2h3.6M8.2 14.8h3.6"/>'),
  briefcase: _i('<rect x="2.8" y="7.4" width="18.4" height="12.4" rx="2.2"/><path d="M8.6 7.4V5.6a1.8 1.8 0 0 1 1.8-1.8h3.2a1.8 1.8 0 0 1 1.8 1.8v1.8M2.8 12.4h18.4"/>'),
  handshake: _i('<path d="m7.4 11.2 2.4-2.4a1.7 1.7 0 0 1 2.4 0l.6.6.6-.6a1.7 1.7 0 0 1 2.4 0l2.4 2.4"/><path d="M12.8 9.4 9.4 6a2.6 2.6 0 0 0-3.6 0L2.6 9.2l4.8 4.8M16.6 14 21.4 9.2 18.2 6a2.6 2.6 0 0 0-3.6 0"/><path d="m7.4 14 2.8 2.8a1.8 1.8 0 0 0 2.6 0l4-4"/>'),
  flame: _i('<path d="M12 21.4c3.6 0 6.2-2.5 6.2-5.8 0-4.4-3.8-6.4-3.8-10.2 0 0-2.2 1-2.8 4-1-1-1.4-2.6-1.4-2.6-2 1.8-4.4 4.6-4.4 8.8 0 3.3 2.6 5.8 6.2 5.8Z"/><path d="M12 21.4c1.6 0 2.7-1.1 2.7-2.6 0-2-1.7-2.8-1.7-4.6 0 0-1 .6-1.4 2-.5-.5-.7-1.2-.7-1.2-.9.9-1.6 2.1-1.6 3.8 0 1.5 1.1 2.6 2.7 2.6Z"/>'),
  seed: _i('<path d="M12 21v-6.6"/><path d="M12 14.4c0-4 3-7.2 7-7.2 0 4-3 7.2-7 7.2ZM12 14.4c0-3.2-2.4-5.8-5.6-5.8 0 3.2 2.4 5.8 5.6 5.8Z"/>'),
  ban: _i('<circle cx="12" cy="12" r="8.8"/><path d="m5.8 5.8 12.4 12.4"/>'),
  bolt: _i('<path d="M13.4 2.6 4.6 13.4h6L9.8 21.4l9-11.2h-6.2l.8-7.6Z"/>'),
  target: _i('<circle cx="12" cy="12" r="8.8"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>'),
  trend: _i('<path d="M3.6 16.8 9 11.4l3.4 3.4 7.6-7.6"/><path d="M15.4 7.2h4.6v4.6"/>'),
  camera: _i('<path d="M21.2 17.4a2.2 2.2 0 0 1-2.2 2.2H5a2.2 2.2 0 0 1-2.2-2.2V9.6A2.2 2.2 0 0 1 5 7.4h2.4l1.4-2.2h6.4l1.4 2.2H19a2.2 2.2 0 0 1 2.2 2.2Z"/><circle cx="12" cy="13" r="3.4"/>'),
  image: _i('<rect x="3" y="3.6" width="18" height="16.8" rx="2.4"/><circle cx="8.6" cy="9.4" r="1.8"/><path d="m3.4 17.6 4.8-4.8 3.4 3.4 3.2-3.2 5.2 5.2"/>'),
  upload: _i('<path d="M20.4 15.4v3.2a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2v-3.2M8 8.4 12 4.4l4 4M12 4.4v11"/>'),
  download: _i('<path d="M20.4 15.4v3.2a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2v-3.2M8 11.4l4 4 4-4M12 15.4v-11"/>'),
  refresh: _i('<path d="M20.4 11.4a8.4 8.4 0 0 0-14.6-4.6L3.6 9"/><path d="M3.6 4.4V9h4.6M3.6 12.6a8.4 8.4 0 0 0 14.6 4.6l2.2-2.2"/><path d="M20.4 19.6V15h-4.6"/>'),
  logout: _i('<path d="M9.4 20.4H5.6a2 2 0 0 1-2-2V5.6a2 2 0 0 1 2-2h3.8M16 16.4l4.4-4.4L16 7.6M20.4 12H9.4"/>'),
  lock: _i('<rect x="4.6" y="10.4" width="14.8" height="10" rx="2.2"/><path d="M8.2 10.4V7.6a3.8 3.8 0 0 1 7.6 0v2.8"/>'),
  eye: _i('<path d="M2.4 12S6 5.6 12 5.6 21.6 12 21.6 12 18 18.4 12 18.4 2.4 12 2.4 12Z"/><circle cx="12" cy="12" r="3.2"/>'),
  eyeOff: _i('<path d="M10.4 6a8.6 8.6 0 0 1 1.6-.2c6 0 9.6 6.2 9.6 6.2a17 17 0 0 1-2.4 3.2M6.6 7.4A17 17 0 0 0 2.4 12s3.6 6.2 9.6 6.2c1.6 0 3-.4 4.2-1M3.6 3.6l16.8 16.8M10 10a2.8 2.8 0 0 0 4 4"/>'),
  /* agenda list: a time column beside its rows, for the whole-event view */
  days: _i('<path d="M4.2 6.6h2.6M4.2 12h2.6M4.2 17.4h2.6M10.4 6.6h9.4M10.4 12h9.4M10.4 17.4h9.4"/>'),
  note: _i('<path d="M13.4 3.6H6.6a2 2 0 0 0-2 2v12.8a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2V9.6Z"/><path d="M13.4 3.6v6h6M8.4 13.4h7.2M8.4 16.6h4.6"/>'),
  edit: _i('<path d="M16.4 3.8a2.2 2.2 0 0 1 3.1 3.1L8.2 18.2l-4.4 1.3 1.3-4.4Z"/>'),
  trash: _i('<path d="M3.8 6.6h16.4M8.4 6.6V4.8a1.4 1.4 0 0 1 1.4-1.4h4.4a1.4 1.4 0 0 1 1.4 1.4v1.8M6 6.6l1 12.6a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8l1-12.6"/>'),
  filter: _i('<path d="M3.6 5.4h16.8l-6.6 7.8v6.2l-3.6-1.8v-4.4Z"/>'),
  link: _i('<path d="M9.6 14.4a4 4 0 0 0 5.6 0l3.2-3.2a4 4 0 0 0-5.6-5.6l-1 1"/><path d="M14.4 9.6a4 4 0 0 0-5.6 0l-3.2 3.2a4 4 0 0 0 5.6 5.6l1-1"/>'),
  sparkle: _i('<path d="M12 3.4l1.8 4.8L18.6 10l-4.8 1.8L12 16.6l-1.8-4.8L5.4 10l4.8-1.8Z"/><path d="M18.6 16.4l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7Z"/>'),
  wifiOff: _i('<path d="M3 3.6l17.4 17.4M8.4 15.4a5 5 0 0 1 5.4-.8M5.2 12.2a9.4 9.4 0 0 1 4-2.2M2.4 9a13.8 13.8 0 0 1 4-2.6M11 6.4a13.8 13.8 0 0 1 10.6 2.6M16.4 11.4c.8.4 1.5.9 2.2 1.6"/><circle cx="12" cy="18.8" r="1" fill="currentColor" stroke="none"/>'),
  info: _i('<circle cx="12" cy="12" r="8.8"/><path d="M12 11v5.2M12 7.9h.01" stroke-width="2"/>'),
  alert: _i('<path d="M10.3 3.8a2 2 0 0 1 3.4 0l7.4 13a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3Z"/><path d="M12 9.4v4M12 16.6h.01" stroke-width="2"/>'),
  undo: _i('<path d="M3.6 9.4h9.8a5 5 0 0 1 0 10H8.4"/><path d="M7 5.4 3.4 9.4 7 13.4"/>'),
  sheetIcon: _i('<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="2.4"/><path d="M3.4 9.2h17.2M3.4 14.8h17.2M9.2 3.4v17.2M14.8 3.4v17.2"/>'),
  flag: _i('<path d="M5 21V4.4h9.4l-.8 3h5.8l-1.4 6.4H5"/>'),
  arrowRight: _i('<path d="M4.4 12h15.2M13.6 6l6 6-6 6"/>'),
  copy: _i('<rect x="8.4" y="8.4" width="12.2" height="12.2" rx="2.2"/><path d="M15.6 8.4V5.6a2.2 2.2 0 0 0-2.2-2.2H5.6a2.2 2.2 0 0 0-2.2 2.2v7.8a2.2 2.2 0 0 0 2.2 2.2h2.8"/>'),
  dollar: _i('<path d="M12 2.8v18.4M16.4 7.2c0-1.7-2-3-4.4-3s-4.4 1.3-4.4 3 2 3 4.4 3.4 4.4 1.7 4.4 3.4-2 3-4.4 3-4.4-1.3-4.4-3"/>')
};
