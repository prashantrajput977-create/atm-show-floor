/* ============================================================
   Show Floor — data layer
   Offline-first. Every write lands in local state immediately,
   goes to Postgres when there is signal, and replays from an
   IndexedDB queue when the hall wifi comes back.
   ============================================================ */

const SB = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage },
  realtime: { params: { eventsPerSecond: 4 } }
});

/* ---------------- tiny event bus ---------------- */
const bus = {
  m: {},
  on(k, fn) { (this.m[k] = this.m[k] || []).push(fn); return () => this.off(k, fn); },
  off(k, fn) { this.m[k] = (this.m[k] || []).filter(f => f !== fn); },
  emit(k, d) { (this.m[k] || []).forEach(f => { try { f(d); } catch (e) { console.error(e); } }); }
};

/* ---------------- IndexedDB ---------------- */
const IDB = (() => {
  let p = null;
  function open() {
    if (p) return p;
    p = new Promise((res, rej) => {
      const r = indexedDB.open('showfloor', 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache');
        if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }).catch(e => { console.warn('idb unavailable', e); return null; });
    return p;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    if (!db) return null;
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      try { out = fn(s); } catch (e) { return rej(e); }
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    }).catch(e => { console.warn('idb tx', e); return null; });
  }
  return {
    get: (k) => tx('cache', 'readonly', s => s.get(k)),
    set: (k, v) => tx('cache', 'readwrite', s => s.put(v, k)),
    del: (k) => tx('cache', 'readwrite', s => s.delete(k)),
    qAdd: (item) => tx('queue', 'readwrite', s => s.add(item)),
    qAll: () => tx('queue', 'readonly', s => s.getAll()),
    qDel: (id) => tx('queue', 'readwrite', s => s.delete(id)),
    qClear: () => tx('queue', 'readwrite', s => s.clear()),
    bSet: (k, blob) => tx('blobs', 'readwrite', s => s.put(blob, k)),
    bGet: (k) => tx('blobs', 'readonly', s => s.get(k)),
    bDel: (k) => tx('blobs', 'readwrite', s => s.delete(k))
  };
})();

/* ---------------- state ---------------- */
const S = {
  session: null,
  me: null,              // ev_members row for signed-in user
  members: [],
  events: [],
  eventId: null,
  meetings: [],
  leads: [],
  activity: [],
  pending: 0,            // queued writes
  net: navigator.onLine ? 'live' : 'offline',
  ready: false,
  ocrConfigured: null,
  thumbs: {}             // storage path -> signed url
};
window.S = S;

const MEET_COLS = '*';
const LEAD_COLS = '*';

function setNet(v) { if (S.net !== v) { S.net = v; bus.emit('net'); } }

/* ---------------- auth ---------------- */
async function signIn(email, password) {
  const { data, error } = await SB.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw error;
  S.session = data.session;
  return data;
}
async function signOut() {
  try { await SB.auth.signOut(); } catch (e) { /* ignore */ }
  S.session = null; S.me = null;
  try {
    await IDB.del('snapshot'); await IDB.qClear();
    Object.keys(localStorage).filter(k => k.startsWith('sf_')).forEach(k => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
  location.reload();
}
async function getSession() {
  const { data } = await SB.auth.getSession();
  S.session = data.session || null;
  return S.session;
}

/* ---------------- load ---------------- */
async function loadMe() {
  const uid = S.session?.user?.id;
  if (!uid) return null;
  const { data, error } = await SB.from('ev_members').select('*').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  S.me = data;
  return data;
}

async function loadAll({ fromCache = true } = {}) {
  if (fromCache) {
    const snap = await IDB.get('snapshot');
    if (snap && snap.eventId) {
      Object.assign(S, {
        members: snap.members || [], events: snap.events || [], eventId: snap.eventId,
        meetings: snap.meetings || [], leads: snap.leads || [], activity: snap.activity || []
      });
      S.ready = true;
      bus.emit('data');
    }
  }

  if (!navigator.onLine) { setNet('offline'); return; }
  setNet('syncing');
  try {
    const [mem, evs] = await Promise.all([
      SB.from('ev_members').select('*').eq('is_active', true).order('role').order('short_name'),
      SB.from('ev_events').select('*').order('starts_on', { ascending: false })
    ]);
    if (mem.error) throw mem.error;
    if (evs.error) throw evs.error;
    S.members = mem.data || [];
    S.events = evs.data || [];

    const saved = localStorage.getItem('sf_event');
    const active = S.events.find(e => e.id === saved) ||
      S.events.find(e => e.is_active) || S.events[0];
    S.eventId = active ? active.id : null;
    if (S.eventId) localStorage.setItem('sf_event', S.eventId);

    if (S.eventId) await loadEventData();
    S.ready = true;
    setNet('live');
    bus.emit('data');
    await saveSnapshot();
    subscribe();
  } catch (e) {
    console.error('loadAll', e);
    setNet(navigator.onLine ? 'live' : 'offline');
    if (!S.ready) throw e;
  }
}

async function loadEventData() {
  const id = S.eventId;
  const [m, l, a] = await Promise.all([
    SB.from('ev_meetings').select(MEET_COLS).eq('event_id', id).order('meeting_date').order('meeting_time', { nullsFirst: false }),
    SB.from('ev_leads').select(LEAD_COLS).eq('event_id', id).order('created_at', { ascending: false }),
    SB.from('ev_activity').select('*').eq('event_id', id).order('created_at', { ascending: false }).limit(120)
  ]);
  if (m.error) throw m.error;
  if (l.error) throw l.error;
  S.meetings = m.data || [];
  S.leads = l.data || [];
  S.activity = a.error ? [] : (a.data || []);
}

async function switchEvent(id) {
  S.eventId = id;
  localStorage.setItem('sf_event', id);
  S.meetings = []; S.leads = []; S.activity = [];
  bus.emit('data');
  if (navigator.onLine) {
    setNet('syncing');
    try { await loadEventData(); setNet('live'); } catch (e) { console.error(e); setNet('live'); }
    bus.emit('data'); saveSnapshot(); subscribe();
  }
}

async function saveSnapshot() {
  await IDB.set('snapshot', {
    at: Date.now(), eventId: S.eventId,
    members: S.members, events: S.events,
    meetings: S.meetings, leads: S.leads, activity: S.activity.slice(0, 80)
  });
}

/* ---------------- realtime ---------------- */
let chan = null;
function subscribe() {
  if (!S.eventId) return;
  if (chan) { try { SB.removeChannel(chan); } catch (e) {} chan = null; }
  const f = `event_id=eq.${S.eventId}`;
  chan = SB.channel('floor-' + S.eventId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ev_meetings', filter: f }, p => merge('meetings', p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ev_leads', filter: f }, p => merge('leads', p))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ev_activity', filter: f }, p => {
      if (!S.activity.some(x => x.id === p.new.id)) {
        S.activity.unshift(p.new); S.activity = S.activity.slice(0, 120);
        bus.emit('data'); bus.emit('remote', p.new);
      }
    })
    .subscribe();
}
function merge(key, p) {
  const arr = S[key];
  if (p.eventType === 'DELETE') {
    S[key] = arr.filter(r => r.id !== p.old.id);
  } else {
    const i = arr.findIndex(r => r.id === p.new.id);
    if (i >= 0) {
      // do not clobber a local row that is still waiting to sync
      if (arr[i]._dirty) return;
      arr[i] = p.new;
    } else arr.unshift(p.new);
  }
  bus.emit('data'); saveSnapshot();
}

/* ---------------- write path ---------------- */
let flushing = false;

async function enqueue(job) {
  await IDB.qAdd(job);
  S.pending++; bus.emit('net');
}

async function flush() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    const jobs = (await IDB.qAll()) || [];
    S.pending = jobs.length;
    if (!jobs.length) { setNet('live'); return; }
    setNet('syncing'); bus.emit('net');
    for (const j of jobs) {
      try {
        await runJob(j);
        await IDB.qDel(j.id);
        S.pending = Math.max(0, S.pending - 1);
        bus.emit('net');
      } catch (e) {
        console.warn('job failed, will retry', j, e);
        break;
      }
    }
    const left = (await IDB.qAll()) || [];
    S.pending = left.length;
    setNet(left.length ? 'syncing' : 'live');
    bus.emit('net');
    if (!left.length) {
      S.meetings.forEach(m => delete m._dirty);
      S.leads.forEach(l => delete l._dirty);
      if (navigator.onLine) { try { await loadEventData(); bus.emit('data'); saveSnapshot(); } catch (e) {} }
    }
  } finally { flushing = false; }
}

async function runJob(j) {
  if (j.kind === 'meeting_update') {
    const { error } = await SB.from('ev_meetings').update(j.values).eq('id', j.id2);
    if (error) throw error;
  } else if (j.kind === 'meeting_insert') {
    const { error } = await SB.from('ev_meetings').insert(j.values);
    if (error && error.code !== '23505') throw error;
  } else if (j.kind === 'lead_upsert') {
    const row = { ...j.values };
    for (const side of ['front', 'back']) {
      const bk = j.blobs?.[side];
      if (!bk) continue;
      const blob = await IDB.bGet(bk);
      if (!blob) continue;
      const path = `${row.event_id}/${row.id}-${side}.jpg`;
      const up = await SB.storage.from(CFG.bucket).upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true });
      if (up.error) throw up.error;
      row[side === 'front' ? 'card_front_path' : 'card_back_path'] = path;
      await IDB.bDel(bk);
    }
    row.synced = true;
    const { error } = await SB.from('ev_leads').upsert(row);
    if (error) throw error;
    const local = S.leads.find(l => l.id === row.id);
    if (local) Object.assign(local, row);
  } else if (j.kind === 'lead_update') {
    const { error } = await SB.from('ev_leads').update(j.values).eq('id', j.id2);
    if (error) throw error;
  } else if (j.kind === 'lead_delete') {
    const { error } = await SB.from('ev_leads').delete().eq('id', j.id2);
    if (error) throw error;
  } else if (j.kind === 'event_insert') {
    const { error } = await SB.from('ev_events').insert(j.values);
    if (error) throw error;
  } else if (j.kind === 'activity') {
    const { error } = await SB.from('ev_activity').insert(j.values);
    if (error) throw error;
  }
}

/* ---- public mutations (optimistic) ---- */
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function log(kind, summary, extra = {}) {
  const row = {
    event_id: S.eventId, actor_id: S.me?.user_id || null, actor_name: S.me?.short_name || null,
    kind, summary, payload: extra.payload || {},
    meeting_id: extra.meeting_id || null, lead_id: extra.lead_id || null
  };
  const localRow = { ...row, id: 'tmp-' + uuid(), created_at: new Date().toISOString() };
  S.activity.unshift(localRow);
  S.activity = S.activity.slice(0, 120);
  enqueue({ kind: 'activity', values: row }).then(flush);
}

async function updateMeeting(id, values, { activity } = {}) {
  const m = S.meetings.find(x => x.id === id);
  if (m) { Object.assign(m, values); m._dirty = true; }
  bus.emit('data'); saveSnapshot();
  await enqueue({ kind: 'meeting_update', id2: id, values });
  if (activity) log(activity.kind, activity.summary, { meeting_id: id, payload: activity.payload });
  flush();
  return m;
}

async function addMeeting(values) {
  const row = {
    id: uuid(), event_id: S.eventId, source: values.source || 'manual',
    created_by: S.me?.user_id || null, created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(), status: 'scheduled', duration_min: 30, priority: 0,
    ...values
  };
  S.meetings.push(row);
  bus.emit('data'); saveSnapshot();
  await enqueue({ kind: 'meeting_insert', values: stripLocal(row) });
  log('meeting_added', `added ${row.source === 'walkin' ? 'walk-in' : 'meeting'} with ${row.company_name}`, { meeting_id: row.id });
  flush();
  return row;
}

async function saveLead(values, blobs) {
  const existing = values.id ? S.leads.find(l => l.id === values.id) : null;
  const row = existing ? { ...existing, ...values } : {
    id: values.id || uuid(), event_id: S.eventId,
    captured_by: S.me?.user_id || null, captured_by_name: S.me?.short_name || null,
    created_at: new Date().toISOString(), tags: [], synced: false,
    ...values
  };
  row.updated_at = new Date().toISOString();

  const blobKeys = {};
  if (blobs) {
    for (const side of ['front', 'back']) {
      if (!blobs[side]) continue;
      const k = `${row.id}-${side}`;
      await IDB.bSet(k, blobs[side]);
      blobKeys[side] = k;
      row['_local_' + side] = URL.createObjectURL(blobs[side]);
    }
  }
  row._dirty = true;
  if (existing) Object.assign(existing, row); else S.leads.unshift(row);
  bus.emit('data'); saveSnapshot();

  await enqueue({ kind: 'lead_upsert', values: stripLocal(row), blobs: blobKeys });
  if (!existing) {
    log('lead_scanned', `captured ${row.full_name || 'a contact'}${row.company ? ' — ' + row.company : ''}`,
      { lead_id: row.id, meeting_id: row.meeting_id || null, payload: { interest: row.interest || null } });
  }
  flush();
  return row;
}

async function updateLead(id, values) {
  const l = S.leads.find(x => x.id === id);
  if (l) { Object.assign(l, values); l._dirty = true; }
  bus.emit('data'); saveSnapshot();
  await enqueue({ kind: 'lead_update', id2: id, values });
  flush();
  return l;
}

async function deleteLead(id) {
  S.leads = S.leads.filter(l => l.id !== id);
  bus.emit('data'); saveSnapshot();
  await enqueue({ kind: 'lead_delete', id2: id });
  flush();
}

async function addEvent(values) {
  const row = {
    id: uuid(), timezone: values.timezone || 'Asia/Dubai', is_active: true,
    created_by: S.me?.user_id || null, created_at: new Date().toISOString(), ...values
  };
  S.events.unshift(row);
  bus.emit('data');
  await enqueue({ kind: 'event_insert', values: stripLocal(row) });
  flush();
  return row;
}

function stripLocal(row) {
  const o = {};
  for (const k in row) if (!k.startsWith('_')) o[k] = row[k];
  return o;
}

/* ---------------- storage helpers ---------------- */
async function thumb(path) {
  if (!path) return null;
  if (S.thumbs[path]) return S.thumbs[path];
  try {
    const { data, error } = await SB.storage.from(CFG.bucket).createSignedUrl(path, 60 * 60 * 8);
    if (error) throw error;
    S.thumbs[path] = data.signedUrl;
    return data.signedUrl;
  } catch (e) { return null; }
}

/* ---------------- OCR bridge ---------------- */
async function ocrCheck() {
  if (S.ocrConfigured !== null) return S.ocrConfigured;
  try {
    const { data, error } = await SB.functions.invoke(CFG.ocrFn, { method: 'GET' });
    if (error) throw error;
    S.ocrConfigured = !!data?.configured;
  } catch (e) { S.ocrConfigured = false; }
  return S.ocrConfigured;
}
async function ocrRemote(dataUrl, mime) {
  const { data, error } = await SB.functions.invoke(CFG.ocrFn, { body: { image: dataUrl, mime } });
  if (error) {
    let msg = error.message || 'ocr failed';
    try { const j = await error.context?.json?.(); if (j?.message || j?.error) msg = j.message || j.error; } catch (e) {}
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.message || data.error);
  return data;
}

/* ---------------- lifecycle ---------------- */
window.addEventListener('online', () => { setNet('syncing'); flush(); loadAll({ fromCache: false }); });
window.addEventListener('offline', () => setNet('offline'));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && navigator.onLine) { flush(); }
});
setInterval(() => { if (navigator.onLine && S.pending) flush(); }, 20000);

window.Store = {
  SB, bus, S, IDB, uuid,
  signIn, signOut, getSession, loadMe, loadAll, loadEventData, switchEvent,
  updateMeeting, addMeeting, saveLead, updateLead, deleteLead, addEvent, log,
  flush, thumb, ocrCheck, ocrRemote
};
