/* ============================================================
   Vervotech Showdown — data layer
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
  voiceConfigured: null,
  thumbs: {}             // storage path -> signed url
};
window.S = S;

const MEET_COLS = '*';
const LEAD_COLS = '*';

function setNet(v) { if (S.net !== v) { S.net = v; bus.emit('net'); } }

/* ---------------- auth ---------------- */
/* Hall wifi drops requests, and on a cold first load the service worker is still
   precaching while the rep is already typing. A single "Failed to fetch" must not
   look like a wrong password, so transport errors get three tries with backoff.
   Real credential rejections (any error carrying an HTTP status) fail straight away. */
async function signIn(email, password) {
  const creds = { email: email.trim().toLowerCase(), password };
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, attempt * 900));
    let res;
    try {
      res = await SB.auth.signInWithPassword(creds);
    } catch (e) {
      last = e;                                   // thrown transport failure
      continue;
    }
    if (!res.error) {
      S.session = res.data.session;
      return res.data;
    }
    last = res.error;
    const transport = !res.error.status && /fetch|network|load failed/i.test(res.error.message || '');
    if (!transport) break;                        // genuine auth rejection
  }
  if (last && !last.status && /fetch|network|load failed/i.test(last.message || '')) {
    const e = new Error('No connection. Check signal and try again.');
    e.cause = last;
    throw e;
  }
  throw last;
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
    /* mark it so the UI says "could not load" instead of "nothing scheduled" */
    S.loadFailed = !S.meetings.length;
    setNet(navigator.onLine ? 'live' : 'offline');
    bus.emit('data');
    if (!S.ready) { S.ready = true; bus.emit('data'); }
  }
}

/* Conference wifi drops requests. A single failed fetch used to leave the day
   looking genuinely empty, which is worse than showing nothing, so retry with
   backoff and never overwrite good rows with an empty result. */
async function attempt(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fn();
      if (!r.error) return r;
      last = r.error;
    } catch (e) { last = e; }
    if (i < tries - 1) await new Promise(r => setTimeout(r, 400 * (i + 1)));
  }
  throw last;
}

async function loadEventData() {
  const id = S.eventId;
  const [m, l, a] = await Promise.all([
    attempt(() => SB.from('ev_meetings').select(MEET_COLS).eq('event_id', id).order('meeting_date').order('meeting_time', { nullsFirst: false })),
    attempt(() => SB.from('ev_leads').select(LEAD_COLS).eq('event_id', id).order('created_at', { ascending: false })),
    SB.from('ev_activity').select('*').eq('event_id', id).order('created_at', { ascending: false }).limit(120)
      .then(r => r, () => ({ error: true }))
  ]);
  S.meetings = m.data || [];
  S.leads = l.data || [];
  S.activity = a.error ? [] : (a.data || []);
  S.loadFailed = false;
  S.syncedAt = Date.now();
}

/* A phone that sleeps kills the realtime socket without firing 'offline', so the
   app came back showing whatever it held when the screen went dark. Every return
   to the foreground re-checks the socket and refetches if the data is stale. */
let resuming = false;
async function resume(force = false) {
  if (resuming || document.hidden || !S.eventId) return;
  if (!navigator.onLine) { setNet('offline'); return; }
  const stale = !S.syncedAt || Date.now() - S.syncedAt > 20000;
  if (!force && !stale && chanState === 'SUBSCRIBED') return;
  resuming = true;
  setNet('syncing');
  try {
    if (chanState !== 'SUBSCRIBED') subscribe();
    await loadEventData();
    setNet('live');
    bus.emit('data');
    saveSnapshot();
  } catch (e) {
    console.error('resume', e);
    setNet(navigator.onLine ? 'live' : 'offline');
  } finally { resuming = false; }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) resume(); });
window.addEventListener('pageshow', e => { if (e.persisted) resume(true); });
window.addEventListener('focus', () => resume());
/* silent socket death shows up as nothing at all, so poll the state while visible */
setInterval(() => { if (!document.hidden && S.eventId) resume(); }, 60000);

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
let chan = null, chanState = '';
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
    .subscribe(st => { chanState = st; });
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
  } else if (j.kind === 'media_upload') {
    /* one job shape for a selfie or a voice note, on a meeting or a contact,
       so an upload survives a dead connection and finishes on the next flush */
    const blob = await IDB.bGet(j.blobKey);
    if (!blob) return;
    const up = await SB.storage.from(CFG.bucket).upload(j.path, blob, { contentType: j.mime || blob.type || 'application/octet-stream', upsert: true });
    if (up.error) throw up.error;
    const patch = { [j.field]: j.path, ...(j.values || {}) };
    const { error } = await SB.from(j.table).update(patch).eq('id', j.id2);
    if (error) throw error;
    await IDB.bDel(j.blobKey);
  } else if (j.kind === 'meeting_delete') {
    const { error } = await SB.from('ev_meetings').delete().eq('id', j.id2);
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

async function deleteMeeting(id) {
  S.meetings = S.meetings.filter(m => m.id !== id);
  S.leads.forEach(l => { if (l.meeting_id === id) l.meeting_id = null; });
  bus.emit('data'); saveSnapshot();
  await enqueue({ kind: 'meeting_delete', id2: id });
  flush();
}

/* Wipes everything the team logged at this event and leaves the booked sheet
   standing. Used after a practice run, so it has to be exact about scope. */
const CLEAR = {
  outcome: null, status: 'scheduled', deal_value_usd: null, met_at: null,
  next_step: null, next_step_due: null, outcome_notes: null
};

async function resetEvent() {
  const added = S.meetings.filter(m => (m.source || 'sheet') !== 'sheet').map(m => m.id);
  const booked = S.meetings.filter(m => (m.source || 'sheet') === 'sheet');
  const leadIds = S.leads.map(l => l.id);

  for (const l of leadIds) await deleteLead(l);
  for (const id of added) await deleteMeeting(id);
  let cleared = 0;
  for (const m of booked) {
    if (!m.outcome && m.status === 'scheduled' && !m.outcome_notes) continue;
    await updateMeeting(m.id, { ...CLEAR, updated_at: new Date().toISOString() });
    cleared++;
  }
  S.activity = [];
  bus.emit('data'); saveSnapshot();
  log('event_reset', `reset the event records, removed ${added.length + leadIds.length} added record${added.length + leadIds.length === 1 ? '' : 's'}`);
  flush();
  return { added: added.length, leads: leadIds.length, cleared };
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

/* Stores a blob against a record: local state first so the UI is instant, then
   a queued upload that patches the row once the bytes are up. */
async function saveMedia(kind, table, id, blob, extra = {}) {
  const isLead = table === 'ev_leads';
  const rowList = isLead ? S.leads : S.meetings;
  const row = rowList.find(r => r.id === id);
  if (!row) return null;

  const ext = kind === 'voice'
    ? (blob.type.includes('mp4') ? 'm4a' : blob.type.includes('mpeg') ? 'mp3' : 'webm')
    : 'jpg';
  const path = `${S.eventId}/${kind}/${id}-${Date.now()}.${ext}`;
  const field = kind === 'voice' ? 'voice_note_path' : 'selfie_path';
  const blobKey = `${kind}-${id}-${uuid()}`;
  await IDB.bSet(blobKey, blob);

  Object.assign(row, { [field]: path, ...extra });
  row._dirty = true;
  /* show it straight away from the local blob, no round trip */
  S.thumbs[path] = URL.createObjectURL(blob);
  bus.emit('data'); saveSnapshot();

  await enqueue({ kind: 'media_upload', table, id2: id, path, field, mime: blob.type, blobKey, values: extra });
  flush();
  return path;
}

async function clearMedia(kind, table, id) {
  const isLead = table === 'ev_leads';
  const row = (isLead ? S.leads : S.meetings).find(r => r.id === id);
  if (!row) return;
  const field = kind === 'voice' ? 'voice_note_path' : 'selfie_path';
  const old = row[field];
  const patch = kind === 'voice'
    ? { voice_note_path: null, voice_transcript: null, voice_ms: null }
    : { selfie_path: null };
  if (isLead) await updateLead(id, patch); else await updateMeeting(id, patch);
  if (old) { try { await SB.storage.from(CFG.bucket).remove([old]); } catch (e) {} delete S.thumbs[old]; }
}

/* ---------------- voice bridge ---------------- */
async function voiceCheck() {
  if (S.voiceConfigured !== null) return S.voiceConfigured;
  try {
    const { data, error } = await SB.functions.invoke(CFG.voiceFn, { method: 'GET' });
    if (error) throw error;
    S.voiceConfigured = !!data?.configured;
  } catch (e) { S.voiceConfigured = false; }
  return S.voiceConfigured;
}

async function transcribe(blob) {
  const b64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
  const { data, error } = await SB.functions.invoke(CFG.voiceFn, { body: { audio: b64, mime: blob.type || 'audio/webm' } });
  if (error) {
    let msg = error.message || 'transcription failed';
    try { const j = await error.context?.json?.(); if (j?.message || j?.error) msg = j.message || j.error; } catch (e) {}
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.message || data.error);
  return data;
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
  signIn, signOut, getSession, loadMe, loadAll, loadEventData, resume, switchEvent,
  updateMeeting, addMeeting, saveLead, updateLead, deleteLead, addEvent, log,
  flush, thumb, ocrCheck, ocrRemote, deleteMeeting, resetEvent, CLEAR,
  saveMedia, clearMedia, voiceCheck, transcribe
};
