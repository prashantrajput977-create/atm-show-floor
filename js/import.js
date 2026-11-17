/* ============================================================
   Sheet upload: anyone on the team drops in the meeting workbook,
   sees what will change, and syncs it. Matching and the write itself
   happen in Postgres (ev_import_sheet), so a meeting that already has
   an outcome, notes or cards is updated in place and never lost.
   ============================================================ */
(function () {
  const { S, SB } = Store;
  const esc = s => UI.esc(s == null ? '' : String(s));

  let xlsxP = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxP) return xlsxP;
    xlsxP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/xlsx.full.min.js?b=' + (window.BUILD || '');
      s.onload = () => res(window.XLSX);
      s.onerror = () => { xlsxP = null; rej(new Error('Could not load the spreadsheet reader. Check signal and try again.')); };
      document.head.appendChild(s);
    });
    return xlsxP;
  }

  /* ---------- cell cleaning ---------- */
  const clean = v => {
    if (v == null) return null;
    const s = String(v).replace(/\s+/g, ' ').trim();
    return !s || /^(x|-|na|n\/a|tbc|tbd)$/i.test(s) ? null : s;
  };
  const isEmail = s => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s);
  const isPhone = s => s.replace(/\D/g, '').length >= 7 && !/[a-z]{3,}/i.test(s);
  const pad = n => String(n).padStart(2, '0');

  function toDate(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);           // day first, as the team writes it
    if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}`;
    const d = new Date(s + (/\d{4}/.test(s) ? '' : ' ' + new Date().getFullYear()));
    return isNaN(d) ? null : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function toTime(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') {
      const mins = Math.round((v - Math.floor(v)) * 1440) % 1440;
      return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
    }
    const m = String(v).trim().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i);
    if (!m) return null;
    let h = +m[1]; const mi = +(m[2] || 0), ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return h < 24 && mi < 60 ? `${pad(h)}:${pad(mi)}` : null;
  }
  function category(v) {
    const s = clean(v);
    if (!s) return null;
    if (/existing/i.test(s) && /new/i.test(s)) return 'Existing + New';
    const hit = (window.CATEGORIES || []).find(c => c.toLowerCase() === s.toLowerCase());
    return hit || s;
  }

  /* header aliases -> field */
  const COLS = {
    company: /^company( name)?$/i, geo: /^(geo|geo region|region)$/i, domain: /^(domain|website)$/i,
    prospect: /^(prospect|prospect name|contact|name)$/i, desig: /^(designation|title|job title)$/i,
    email: /^e-?mail$/i, mobile: /^(mobile|phone)$/i, mobile2: /^(mobile_?2|mobile 2|phone 2)$/i,
    date: /^(meeting )?date$/i, time: /^(meeting )?time$/i, owner: /^(meeting with|attendees?|owners?)$/i,
    rep: /^(is rep|rep|inside sales|booked by)$/i, cat: /^(category|business type)$/i,
    comments: /^(any comments|comments|notes)$/i, stage: /^stage$/i
  };

  function parseSheet(ws) {
    const XLSX = window.XLSX;
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    const startRow = XLSX.utils.decode_range(ws['!ref'] || 'A1').s.r;
    const hi = grid.findIndex(r => (r || []).some(c => COLS.company.test(String(c || '').trim())));
    if (hi < 0) throw new Error('This tab has no "Company Name" column.');
    const head = grid[hi].map(c => String(c || '').trim());
    const col = {};
    Object.entries(COLS).forEach(([k, re]) => { const i = head.findIndex(h => re.test(h)); if (i >= 0) col[k] = i; });
    const get = (r, k) => (col[k] == null ? null : r[col[k]]);

    const rows = [], skipped = [];
    for (let i = hi + 1; i < grid.length; i++) {
      const r = grid[i] || [];
      const company = clean(get(r, 'company'));
      if (!company) continue;
      const seq = startRow + i - hi;                   // row number under the header, same as earlier imports
      const cells = [get(r, 'email'), get(r, 'mobile'), get(r, 'mobile2')].map(clean).filter(Boolean);
      const emails = cells.filter(isEmail), phones = cells.filter(c => !isEmail(c) && isPhone(c));
      const extra = cells.filter(c => !emails.includes(c) && !phones.includes(c));
      const owners = (clean(get(r, 'owner')) || '').split(/\s*(?:\/|&|,|\band\b)\s*/i).map(s => s.trim()).filter(Boolean);
      const comments = [clean(get(r, 'comments')), clean(get(r, 'stage')), extra.length ? 'Also: ' + extra.join(', ') : '']
        .filter(Boolean).join(' · ') || null;
      const d = toDate(get(r, 'date')), t = toTime(get(r, 'time'));
      if (get(r, 'date') != null && !d) skipped.push(`${company}: date "${get(r, 'date')}" not understood`);
      rows.push({
        seq, company_name: company, geo_region: clean(get(r, 'geo')),
        domain: clean(get(r, 'domain')), prospect_name: clean(get(r, 'prospect')), designation: clean(get(r, 'desig')),
        email: emails[0] || null, mobile: phones[0] || null,
        meeting_date: d, meeting_time: t,
        owner_name: owners[0] || null, co_owner_names: owners.slice(1),
        rep_name: clean(get(r, 'rep')), category: category(get(r, 'cat')), comments
      });
    }
    return { rows, skipped };
  }

  function guessSheet(names, ev) {
    if (!ev) return names[0];
    if (ev.sheet_name && names.includes(ev.sheet_name)) return ev.sheet_name;
    const words = [ev.short_name, ev.name].filter(Boolean).join(' ').toLowerCase();
    const initials = (ev.name || '').split(/\s+/).filter(w => /^[A-Za-z]/.test(w) && !/^the$/i.test(w)).map(w => w[0]).join('').toLowerCase();
    const yr = (ev.starts_on || '').slice(0, 4);
    const score = n => {
      const t = n.toLowerCase().split(/[\s_-]+/);
      let s = 0;
      if (yr && n.includes(yr)) s += 1;
      if (t[0] && words.includes(t[0])) s += 3;
      if (t[0] && initials.startsWith(t[0])) s += 2;
      if (/phocus/.test(words) && t[0] === 'pw') s += 3;
      return s;
    };
    return [...names].sort((a, b) => score(b) - score(a))[0];
  }

  /* ---------- the sheet ---------- */
  let wb = null, fileName = '';

  function open() {
    const ev = UI.activeEvent();
    UI.openSheet({
      title: 'Upload meeting sheet',
      sub: ev ? `Into ${ev.short_name || ev.name}` : '',
      body: `
        <div class="field">
          <label for="im_ev">Event</label>
          <select class="sel" id="im_ev">
            ${[...S.events].sort((a, b) => String(b.starts_on).localeCompare(String(a.starts_on)))
              .map(e => `<option value="${e.id}" ${e.id === S.eventId ? 'selected' : ''}>${esc(e.short_name || e.name)}</option>`).join('')}
          </select>
        </div>
        <label class="btn block" for="im_file" style="margin:4px 0 12px">${I.upload}Choose the Excel file</label>
        <input id="im_file" type="file" accept=".xlsx,.xls,.xlsm,.csv" hidden>
        <div id="im_tab"></div>
        <div id="im_out" class="hint">Pick the same workbook the team keeps. You will see every change before anything is saved. Meetings that already have an outcome, notes or cards keep them.</div>`,
      foot: `<button class="btn ghost" data-x>Cancel</button><button class="btn primary" id="im_go" disabled>Sync meetings</button>`,
      onMount(b, f) {
        f.querySelector('[data-x]').onclick = () => UI.closeSheet();
        b.querySelector('#im_file').onchange = e => onFile(e.target.files[0], b, f);
        b.querySelector('#im_ev').onchange = () => wb && renderTabs(b, f);
      }
    });
  }

  async function onFile(file, b, f) {
    if (!file) return;
    const out = b.querySelector('#im_out');
    out.className = 'hint'; out.textContent = 'Reading ' + file.name + '…';
    try {
      const XLSX = await loadXlsx();
      const buf = await file.arrayBuffer();
      wb = XLSX.read(buf, { type: 'array' });
      fileName = file.name;
      renderTabs(b, f);
    } catch (e) {
      out.className = 'hint bad'; out.textContent = e.message || 'Could not read that file.';
    }
  }

  function renderTabs(b, f) {
    const ev = S.events.find(e => e.id === b.querySelector('#im_ev').value);
    const pick = guessSheet(wb.SheetNames, ev);
    b.querySelector('#im_tab').innerHTML = `<div class="field">
        <label for="im_sheet">Tab in ${esc(fileName)}</label>
        <select class="sel" id="im_sheet">${wb.SheetNames.map(n => `<option ${n === pick ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      </div>`;
    b.querySelector('#im_sheet').onchange = () => preview(b, f);
    preview(b, f);
  }

  let current = null;
  async function preview(b, f) {
    const out = b.querySelector('#im_out'), go = f.querySelector('#im_go');
    go.disabled = true;
    const evId = b.querySelector('#im_ev').value, tab = b.querySelector('#im_sheet').value;
    let parsed;
    try { parsed = parseSheet(wb.Sheets[tab]); }
    catch (e) { out.className = 'hint bad'; out.textContent = e.message; return; }
    if (!parsed.rows.length) { out.className = 'hint bad'; out.textContent = 'No meetings found on this tab.'; return; }
    out.className = 'hint'; out.textContent = `Checking ${parsed.rows.length} meetings…`;
    const { data, error } = await SB.rpc('ev_import_sheet', { p_event: evId, p_rows: parsed.rows, p_apply: false });
    if (error) { out.className = 'hint bad'; out.textContent = /team members/.test(error.message) ? 'Your account cannot import meetings.' : 'Could not check the sheet: ' + error.message; return; }
    current = { evId, tab, rows: parsed.rows };
    out.className = '';
    out.innerHTML = summary(data, parsed.skipped);
    const nothing = !data.added.length && !data.changed.length && !data.missing.some(x => !x.logged);
    go.disabled = nothing;
    go.textContent = nothing ? 'Already in sync' : 'Sync meetings';
    go.onclick = () => apply(b, f);
  }

  const FIELD = {
    company_name: 'company', geo_region: 'region', domain: 'domain', prospect_name: 'prospect', designation: 'title',
    email: 'email', mobile: 'mobile', meeting_date: 'date', meeting_time: 'time', owner_name: 'meeting with',
    co_owner_names: 'also attending', rep_name: 'IS rep', category: 'category', comments: 'comments'
  };
  function summary(d, skipped) {
    const li = (t, s) => `<div class="im-row"><b>${esc(t)}</b>${s ? `<span>${esc(s)}</span>` : ''}</div>`;
    const removable = d.missing.filter(x => !x.logged), kept = d.missing.filter(x => x.logged);
    return `
      <div class="im-stats">
        <span><b>${d.added.length}</b>new</span><span><b>${d.changed.length}</b>changed</span>
        <span><b>${d.unchanged}</b>same</span>${d.missing.length ? `<span><b>${d.missing.length}</b>not in sheet</span>` : ''}
      </div>
      ${d.unknown_people.length ? `<div class="hint bad" style="margin:0 0 10px">Not on the team list: ${esc(d.unknown_people.join(', '))}. Their meetings import but will not show under their name until Prashant adds them.</div>` : ''}
      ${d.added.length ? `<div class="sec-h"><h2>New</h2></div><div class="card im-list">${d.added.map(a => li(a.company, [UI.fmtDate(a.date), a.time ? UI.fmtTimeStr(a.time) : 'no time', a.owner].filter(Boolean).join(' · '))).join('')}</div>` : ''}
      ${d.changed.length ? `<div class="sec-h"><h2>Changed</h2></div><div class="card im-list">${d.changed.map(c => li(c.company, c.fields.map(x => FIELD[x] || x).join(', '))).join('')}</div>` : ''}
      ${removable.length ? `<div class="sec-h"><h2>No longer in the sheet</h2></div><div class="card im-list">${removable.map(m => li(m.company, 'nothing logged')).join('')}</div>
        <label class="im-chk"><input type="checkbox" id="im_rm"> Remove these ${removable.length} from the app</label>` : ''}
      ${kept.length ? `<div class="hint" style="margin-top:8px">${kept.length} meeting${kept.length > 1 ? 's' : ''} missing from the sheet already ${kept.length > 1 ? 'have' : 'has'} notes or an outcome, so ${kept.length > 1 ? 'they stay' : 'it stays'}: ${esc(kept.map(k => k.company).join(', '))}.</div>` : ''}
      ${skipped.length ? `<div class="hint bad" style="margin-top:8px">${skipped.map(esc).join('<br>')}</div>` : ''}`;
  }

  async function apply(b, f) {
    if (!current) return;
    const go = f.querySelector('#im_go');
    go.disabled = true; go.textContent = 'Syncing…';
    const rm = !!b.querySelector('#im_rm')?.checked;
    const { data, error } = await SB.rpc('ev_import_sheet', {
      p_event: current.evId, p_rows: current.rows, p_apply: true, p_remove: rm, p_sheet: current.tab
    });
    if (error) { go.disabled = false; go.textContent = 'Sync meetings'; UI.toast('Sync failed: ' + error.message, { kind: 'bad', ms: 6000 }); return; }
    UI.closeSheet();
    const bits = [data.added.length && `${data.added.length} added`, data.changed.length && `${data.changed.length} updated`, data.removed && `${data.removed} removed`].filter(Boolean);
    UI.toast(bits.length ? 'Meetings synced: ' + bits.join(', ') : 'Already in sync', { kind: 'ok', ms: 4000 });
    try { Store.log('sheet_import', `synced the meeting sheet (${bits.join(', ') || 'no changes'})`); } catch (e) {}
    if (current.evId !== S.eventId) await Store.switchEvent(current.evId);
    else await Store.loadAll({ fromCache: false });
  }

  window.Importer = { open, parseSheet, guessSheet, toDate, toTime };
})();
