/* EasyDashboardForYou — spreadsheet → mapped, editable dashboard.
 *
 * Data model
 *   template: { title, searchHint, accentField, fields: [Field], stats: [Stat] }
 *   Field:    { id, source, label, type, show, filter }
 *             type ∈ text | longtext | number | date | badge | tags | status
 *   Stat:     { label, field, value }  → counts visible rows whose field contains value
 *   rows:     [{ _id, [field.id]: string }]
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'easydashboardforyou.v1';
  const TYPES = [
    ['text', 'Text'],
    ['longtext', 'Long text (wraps)'],
    ['number', 'Number'],
    ['date', 'Date'],
    ['badge', 'Badge (coloured pill)'],
    ['tags', 'Tags (multiple pills)'],
    ['status', 'Status']
  ];
  const HUES = [212, 28, 145, 268, 330, 188, 48, 95, 240, 0, 170, 300];
  const TAG_SPLIT = /\s*[,;|\n]\s*/;

  let template = null;
  let rows = [];
  let nextId = 1;
  const ui = { filters: {}, search: '', sort: null };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k === 'style') node.style.cssText = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) node.append(c);
    return node;
  };

  /* ---------- helpers ---------- */

  const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const slug = s => String(s ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field';
  const splitTags = v => String(v ?? '').split(TAG_SPLIT).map(t => t.trim()).filter(Boolean);
  const valuesOf = (field, row) => field.type === 'tags' ? splitTags(row[field.id]) : [String(row[field.id] ?? '').trim()].filter(Boolean);
  const fieldById = id => template?.fields.find(f => f.id === id);

  function hueFor(value, type) {
    const v = String(value).toLowerCase();
    if (type === 'status') {
      if (/approv|done|complete[d]?$|closed|deployed|resolved|success|pass/.test(v)) return 145;
      if (/reject|fail|block|error|cancel|overdue/.test(v)) return 0;
      if (/progress|testing|review|pending/.test(v)) return 212;
    }
    let h = 0;
    for (const ch of v) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return HUES[h % HUES.length];
  }

  function pill(value, type, extraClass = '') {
    const span = el('span', { class: `pill ${extraClass}`.trim() }, value);
    const h = hueFor(value, type);
    span.style.setProperty('--h', h);
    applyPillColor(span, h);
    return span;
  }

  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  function applyPillColor(span, h) {
    if (darkQuery.matches) {
      span.style.background = `hsl(${h} 35% 26%)`;
      span.style.color = `hsl(${h} 80% 86%)`;
    } else {
      span.style.background = `hsl(${h} 75% 90%)`;
      span.style.color = `hsl(${h} 55% 28%)`;
    }
  }
  darkQuery.addEventListener?.('change', () => render());

  function toast(msg, ms = 3500) {
    const t = $('#toast');
    t.innerHTML = '';
    t.append(...(Array.isArray(msg) ? msg : [msg]));
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), ms);
  }

  function download(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const a = el('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const fileBase = () => slug(template?.title || 'dashboard').replace(/_/g, '-');

  /* ---------- persistence ---------- */

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ template, rows })); } catch { /* storage unavailable */ }
  }

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (data?.template?.fields) {
        template = data.template;
        rows = data.rows || [];
        nextId = rows.reduce((m, r) => Math.max(m, r._id || 0), 0) + 1;
        rows.forEach(r => { if (!r._id) r._id = nextId++; });
      }
    } catch { /* ignore corrupt storage */ }
  }

  /* ---------- parsing ---------- */

  function parseDelimited(text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const count = ch => firstLine.split(ch).length - 1;
    const delim = [['\t', count('\t')], [',', count(',')], [';', count(';')]].sort((a, b) => b[1] - a[1])[0][0];

    const out = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"' && cell === '') quoted = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); out.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); out.push(row); }
    return toTable(out);
  }

  // Array-of-arrays → { headers, rows } (first non-empty row is the header).
  function toTable(aoa) {
    const clean = aoa
      .map(r => r.map(c => (c == null ? '' : String(c).trim())))
      .filter(r => r.some(c => c !== ''));
    if (!clean.length) throw new Error('No data found.');
    // drop columns that are completely empty (header and every value)
    const width0 = Math.max(...clean.map(r => r.length));
    const keep = Array.from({ length: width0 }, (_, i) => i).filter(i => clean.some(r => (r[i] ?? '') !== ''));
    clean.forEach((r, j) => { clean[j] = keep.map(i => r[i] ?? ''); });
    const width = keep.length;
    const seen = {};
    const headers = Array.from({ length: width }, (_, i) => {
      let h = clean[0][i] || `Column ${i + 1}`;
      if (seen[h]) h = `${h} (${++seen[h]})`; else seen[h] = 1;
      return h;
    });
    return { headers, rows: clean.slice(1).map(r => headers.map((_, i) => r[i] ?? '')) };
  }

  function sheetToTable(wb, name) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false, blankrows: false });
    return toTable(aoa);
  }

  /* ---------- import sources ---------- */

  async function importFile(file) {
    try {
      if (/\.(csv|tsv|txt)$/i.test(file.name)) {
        openMapping({ table: parseDelimited(await file.text()), source: file.name });
        return;
      }
      if (!window.XLSX) throw new Error('Excel support could not load (offline?). Save the sheet as CSV and import that instead.');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const sheet = wb.SheetNames[0];
      openMapping({ table: sheetToTable(wb, sheet), source: file.name, workbook: wb, sheet });
    } catch (err) {
      toast(`Could not read ${file.name}: ${err.message}`, 6000);
    }
  }

  function googleCsvUrls(url) {
    const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1] || '0';
    const pub = url.match(/\/spreadsheets\/d\/e\/([\w-]+)/);
    if (pub) return [`https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub?output=csv&gid=${gid}`];
    const id = (url.match(/\/spreadsheets\/d\/([\w-]+)/) || [])[1];
    if (!id) return null;
    return [
      `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&headers=1&gid=${gid}`,
      `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`
    ];
  }

  async function importGoogleSheet(url) {
    const urls = googleCsvUrls(url);
    if (!urls) throw new Error('That does not look like a Google Sheets link.');
    let lastErr;
    for (const u of urls) {
      try {
        const res = await fetch(u);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('not public');
        return parseDelimited(text);
      } catch (err) { lastErr = err; }
    }
    throw new Error(`Could not read the sheet (${lastErr?.message}). Make sure it is shared as “Anyone with the link can view”.`);
  }

  /* ---------- field mapping ---------- */

  // Guess a display type for a column from its name and values.
  function guessField(header, values) {
    const name = header.toLowerCase();
    const filled = values.filter(v => v !== '');
    const uniq = new Set(filled);
    const avgLen = filled.reduce((s, v) => s + v.length, 0) / (filled.length || 1);
    let type = 'text';
    if (/status/.test(name) || /^(state|stage|phase)$/.test(name.trim())) type = 'status';
    else if (/env|tag|label|platform|categories/.test(name) && filled.some(v => TAG_SPLIT.test(v))) type = 'tags';
    else if (filled.length && filled.every(v => /^-?[\d,]*\.?\d+%?$/.test(v)) && !/id$|^id|number$|no\.?$|code/.test(name)) type = 'number';
    else if (filled.length && filled.every(v => /^\d{4}-\d{2}-\d{2}/.test(v) || /^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}$/.test(v))) type = 'date';
    else if (avgLen > 40) type = 'longtext';
    else if (avgLen < 30 && uniq.size < filled.length && uniq.size <= Math.min(20, Math.max(2, filled.length * 0.6))) type = 'badge';
    const filter = ['status', 'badge', 'tags'].includes(type) && uniq.size > 1;
    return { type, filter };
  }

  let mapCtx = null; // { items: [{field, colIndex, sample}], table, workbook, sheet, isNew }

  function buildMapItems(table, base) {
    const used = new Set();
    const items = table.headers.map((h, i) => {
      const col = table.rows.map(r => r[i]);
      const match = base?.fields.find(f => !used.has(f) && (norm(f.source) === norm(h) || norm(f.label) === norm(h)));
      let field;
      if (match) {
        used.add(match);
        field = { ...match, source: h };
      } else {
        field = { id: '', source: h, label: h, show: true, ...guessField(h, col) };
      }
      return { field, colIndex: i, sample: col.find(v => v !== '') || '' };
    });
    // keep the base template's column order for matched fields
    if (base) {
      const order = f => {
        const i = base.fields.findIndex(b => norm(b.source) === norm(f.source) || norm(b.label) === norm(f.source));
        return i < 0 ? 1e6 : i;
      };
      items.sort((a, b) => order(a.field) - order(b.field) || a.colIndex - b.colIndex);
    }
    // assign unique ids
    const ids = new Set();
    for (const it of items) {
      let id = it.field.id || slug(it.field.source);
      while (ids.has(id)) id += '_';
      ids.add(id);
      it.field.id = id;
    }
    return items;
  }

  function openMapping({ table, source, workbook, sheet, base } = {}) {
    if (table) {
      // reuse the current dashboard's mapping only when the new data looks like the same sheet
      if (!base && template) {
        const known = new Set(template.fields.flatMap(f => [norm(f.source), norm(f.label)]));
        const hits = table.headers.filter(h => known.has(norm(h))).length;
        if (hits >= Math.ceil(table.headers.length / 2)) base = template;
      }
      mapCtx = { table, workbook, sheet, isNew: true, base, items: buildMapItems(table, base) };
      $('#mapTitle').value = base?.title || (source ? source.replace(/\.[^.]+$/, '') + ' Dashboard' : 'My Dashboard');
    } else {
      if (!template) { toast('Import some data first.'); return; }
      mapCtx = {
        isNew: false,
        items: template.fields.map(f => ({ field: { ...f }, sample: rows.map(r => r[f.id]).find(v => v) || '' }))
      };
      $('#mapTitle').value = template.title;
    }
    const src = table ? base : template;
    $('#mapSearchHint').value = src?.searchHint || 'Search…';
    mapCtx.stats = (src?.stats || []).map(s => ({ ...s }));
    mapCtx.accentField = src?.accentField;
    renderSheetPicker();
    renderMapRows();
    renderMapStats();
    $('#mappingDialog').showModal();
  }

  function renderSheetPicker() {
    $('#sheetPicker')?.remove();
    if (!mapCtx.workbook || mapCtx.workbook.SheetNames.length < 2) return;
    const select = el('select', {
      onchange: e => {
        mapCtx.sheet = e.target.value;
        try {
          mapCtx.table = sheetToTable(mapCtx.workbook, mapCtx.sheet);
          mapCtx.items = buildMapItems(mapCtx.table, mapCtx.base);
          renderMapRows();
          renderMapStats();
        } catch (err) { toast(err.message); }
      }
    }, mapCtx.workbook.SheetNames.map(n => el('option', { value: n, selected: n === mapCtx.sheet }, n)));
    $('#mapTitle').closest('.field').after(el('label', { class: 'field', id: 'sheetPicker' }, 'Sheet (tab)', select));
  }

  function renderMapRows() {
    const tbody = $('#mapRows');
    tbody.innerHTML = '';
    mapCtx.items.forEach((it, idx) => {
      const f = it.field;
      const tr = el('tr', { class: f.show ? '' : 'off' },
        el('td', {}, el('input', { type: 'checkbox', checked: f.show, onchange: e => { f.show = e.target.checked; tr.className = f.show ? '' : 'off'; } })),
        el('td', {},
          el('button', { type: 'button', class: 'move', title: 'Move up', onclick: () => moveItem(idx, -1) }, '↑'),
          el('button', { type: 'button', class: 'move', title: 'Move down', onclick: () => moveItem(idx, 1) }, '↓')),
        el('td', {}, f.source),
        el('td', {}, el('input', { type: 'text', value: f.label, oninput: e => { f.label = e.target.value; refreshFieldSelects(); } })),
        el('td', {}, el('select', { onchange: e => { f.type = e.target.value; } },
          TYPES.map(([v, l]) => el('option', { value: v, selected: v === f.type }, l)))),
        el('td', {}, el('input', { type: 'checkbox', checked: f.filter, onchange: e => { f.filter = e.target.checked; } })),
        el('td', { class: 'sample', title: it.sample }, it.sample)
      );
      tbody.append(tr);
    });
    refreshFieldSelects();
  }

  function moveItem(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= mapCtx.items.length) return;
    [mapCtx.items[idx], mapCtx.items[j]] = [mapCtx.items[j], mapCtx.items[idx]];
    renderMapRows();
  }

  function fieldOptions(selected, { allowNone } = {}) {
    const opts = mapCtx.items.map(it => el('option', { value: it.field.id, selected: it.field.id === selected }, it.field.label || it.field.source));
    if (allowNone) opts.unshift(el('option', { value: '', selected: !selected }, '— none —'));
    return opts;
  }

  function refreshFieldSelects() {
    if (!mapCtx.accentField || !mapCtx.items.some(it => it.field.id === mapCtx.accentField)) {
      mapCtx.accentField = mapCtx.items.find(it => it.field.type === 'status')?.field.id || '';
    }
    const accent = $('#mapAccent');
    accent.innerHTML = '';
    accent.append(...fieldOptions(mapCtx.accentField, { allowNone: true }));
    accent.onchange = e => { mapCtx.accentField = e.target.value; };
    $$('#mapStats select').forEach((s, i) => {
      if (!mapCtx.stats[i]) return;
      s.innerHTML = '';
      s.append(...fieldOptions(mapCtx.stats[i].field));
    });
  }

  function renderMapStats() {
    const box = $('#mapStats');
    box.innerHTML = '';
    mapCtx.stats = mapCtx.stats.filter(s => mapCtx.items.some(it => it.field.id === s.field) || !s.field);
    mapCtx.stats.forEach((s, i) => {
      if (!s.field) s.field = mapCtx.items[0]?.field.id;
      box.append(el('div', { class: 'stat-row' },
        el('input', { type: 'text', placeholder: 'Card label', value: s.label, oninput: e => { s.label = e.target.value; } }),
        el('select', { onchange: e => { s.field = e.target.value; } }, fieldOptions(s.field)),
        el('span', { class: 'muted' }, 'contains'),
        el('input', { type: 'text', placeholder: 'Value', value: s.value, oninput: e => { s.value = e.target.value; } }),
        el('button', { type: 'button', class: 'btn small danger', onclick: () => { mapCtx.stats.splice(i, 1); renderMapStats(); } }, 'Remove')
      ));
    });
  }

  function applyMapping() {
    const fields = mapCtx.items.map(it => ({ ...it.field, label: it.field.label.trim() || it.field.source }));
    template = {
      title: $('#mapTitle').value.trim() || 'My Dashboard',
      searchHint: $('#mapSearchHint').value.trim() || 'Search…',
      accentField: mapCtx.accentField || '',
      fields,
      stats: mapCtx.stats.filter(s => s.label.trim() && s.value.trim())
    };
    if (mapCtx.isNew) {
      nextId = 1;
      rows = mapCtx.table.rows.map(r => {
        const row = { _id: nextId++ };
        mapCtx.items.forEach(it => { row[it.field.id] = r[it.colIndex] ?? ''; });
        return row;
      });
      ui.filters = {};
      ui.search = '';
      ui.sort = null;
      $('#search').value = '';
    }
    for (const id of Object.keys(ui.filters)) if (!fieldById(id)?.filter) delete ui.filters[id];
    save();
    render();
    toast(mapCtx.isNew ? `Dashboard built with ${rows.length} rows.` : 'Field mapping updated.');
  }

  /* ---------- filtering / sorting ---------- */

  function visibleRows() {
    const q = ui.search.trim().toLowerCase();
    const active = Object.entries(ui.filters).filter(([, set]) => set.size);
    let out = rows.filter(r => {
      for (const [fid, set] of active) {
        const f = fieldById(fid);
        if (!f || !valuesOf(f, r).some(v => set.has(v))) return false;
      }
      if (q && !template.fields.some(f => String(r[f.id] ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
    if (ui.sort) {
      const f = fieldById(ui.sort.field);
      const dir = ui.sort.dir;
      const key = r => {
        const v = String(r[f.id] ?? '');
        if (f.type === 'number') return parseFloat(v.replace(/[,%]/g, ''));
        if (f.type === 'date') return Date.parse(v);
        return v;
      };
      out = out.slice().sort((a, b) => {
        const x = key(a), y = key(b);
        if (typeof x === 'number' || typeof y === 'number') {
          const nx = isNaN(x) ? Infinity : x, ny = isNaN(y) ? Infinity : y;
          return (nx - ny) * dir;
        }
        if (!x && y) return 1;
        if (x && !y) return -1;
        return x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }) * dir;
      });
    }
    return out;
  }

  function uniqueValues(field) {
    const set = new Set();
    rows.forEach(r => valuesOf(field, r).forEach(v => set.add(v)));
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  /* ---------- rendering ---------- */

  function render() {
    const has = !!template;
    $('#emptyState').hidden = has;
    $('#dashboard').hidden = !has;
    $$('[data-action="edit-mapping"],[data-action="add-row"],[data-action="clear-filters"],[data-menu="exportMenu"]')
      .forEach(b => (b.disabled = !has));
    $('#dashTitle').textContent = has ? template.title : 'EasyDashboardForYou';
    document.title = has ? `${template.title} · EasyDashboardForYou` : 'EasyDashboardForYou';
    if (!has) return;
    $('#search').placeholder = template.searchHint || 'Search…';
    const vis = visibleRows();
    renderStats(vis);
    renderFilters();
    renderTable(vis);
  }

  function renderStats(vis) {
    const box = $('#stats');
    box.innerHTML = '';
    box.append(el('div', { class: 'stat' }, el('b', {}, vis.length), el('span', {}, 'Visible records')));
    for (const s of template.stats) {
      const f = fieldById(s.field);
      if (!f) continue;
      const needle = s.value.toLowerCase();
      const n = vis.filter(r => String(r[f.id] ?? '').toLowerCase().includes(needle)).length;
      box.append(el('div', { class: 'stat' }, el('b', {}, n), el('span', {}, s.label)));
    }
  }

  function renderFilters() {
    const box = $('#filters');
    box.innerHTML = '';
    for (const f of template.fields.filter(f => f.filter)) {
      const values = uniqueValues(f);
      if (!values.length) continue;
      const set = ui.filters[f.id] || (ui.filters[f.id] = new Set());
      const group = el('div', { class: 'filter-group' }, el('label', {}, `${f.label}:`));
      const chipType = f.type === 'status' ? 'status' : f.type;
      const toggle = v => { set.has(v) ? set.delete(v) : set.add(v); render(); };

      if (values.length <= 8) {
        // Like the template: when a value is selected, show just the selected chips (with ×).
        const shown = set.size ? values.filter(v => set.has(v)) : values;
        for (const v of shown) {
          const chip = pill(v, chipType, `chip ${set.has(v) ? 'active' : ''}`);
          if (set.has(v)) chip.append(el('span', { class: 'x' }, '×'));
          chip.title = set.has(v) ? 'Remove filter' : 'Filter by this value';
          chip.addEventListener('click', () => toggle(v));
          group.append(chip);
        }
      } else {
        for (const v of values.filter(v => set.has(v))) {
          const chip = pill(v, chipType, 'chip active');
          chip.append(el('span', { class: 'x' }, '×'));
          chip.addEventListener('click', () => toggle(v));
          group.append(chip);
        }
        group.append(el('select', { onchange: e => { if (e.target.value) toggle(e.target.value); } },
          el('option', { value: '' }, set.size ? '+ add' : 'All'),
          values.filter(v => !set.has(v)).map(v => el('option', { value: v }, v))));
      }
      box.append(group);
    }
  }

  function renderTable(vis) {
    const fields = template.fields.filter(f => f.show);
    const thead = $('#grid thead');
    const tbody = $('#grid tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';

    thead.append(el('tr', {},
      el('th', { class: 'bar' }),
      fields.map(f => {
        const s = ui.sort?.field === f.id ? ui.sort.dir : 0;
        return el('th', {
          title: 'Sort',
          onclick: () => {
            if (!s) ui.sort = { field: f.id, dir: 1 };
            else if (s === 1) ui.sort = { field: f.id, dir: -1 };
            else ui.sort = null;
            render();
          }
        }, f.label, el('span', { class: 'arrow' }, s === 1 ? '▲' : s === -1 ? '▼' : '↕'));
      }),
      el('th', { class: 'row-actions' })
    ));

    if (!vis.length) {
      tbody.append(el('tr', {}, el('td', { class: 'no-rows', colspan: fields.length + 2 }, rows.length ? 'No rows match the current filters.' : 'No rows yet — click “+ Add row”.')));
      return;
    }

    const accent = fieldById(template.accentField);
    for (const r of vis) {
      const bar = el('i');
      if (accent && r[accent.id]) bar.style.background = `hsl(${hueFor(valuesOf(accent, r)[0] || '', accent.type)} 60% 52%)`;
      const tr = el('tr', { 'data-id': r._id }, el('td', { class: 'bar' }, bar));
      for (const f of fields) {
        const td = el('td', { class: `cell ${f.type === 'longtext' ? 'wrap' : ''}`, 'data-field': f.id });
        fillCell(td, f, r[f.id]);
        tr.append(td);
      }
      tr.append(el('td', { class: 'row-actions' }, el('button', { title: 'Delete row', 'data-del': r._id }, '🗑')));
      tbody.append(tr);
    }
  }

  function fillCell(td, f, value) {
    td.innerHTML = '';
    const v = String(value ?? '').trim();
    if (!v) { td.append(el('span', { class: 'empty-cell' }, '-')); return; }
    if (f.type === 'badge' || f.type === 'status') td.append(pill(v, f.type));
    else if (f.type === 'tags') td.append(...splitTags(v).map(t => pill(t, 'tags')));
    else td.textContent = v;
  }

  /* ---------- inline editing ---------- */

  function startEdit(td) {
    if (!td.isConnected) {
      // the table re-rendered (e.g. a previous edit committed on blur) — find the fresh cell
      const id = td.closest('tr')?.dataset.id;
      td = $(`#grid tr[data-id="${id}"] td[data-field="${CSS.escape(td.dataset.field)}"]`);
      if (!td) return;
    }
    if (td.querySelector('input')) return;
    const tr = td.closest('tr');
    const row = rows.find(r => r._id === Number(tr.dataset.id));
    const f = fieldById(td.dataset.field);
    if (!row || !f) return;

    const original = String(row[f.id] ?? '');
    const input = el('input', { type: 'text', value: original });
    if (['badge', 'status', 'tags'].includes(f.type)) {
      const listId = `dl-${f.id}`;
      $(`#${CSS.escape(listId)}`)?.remove();
      document.body.append(el('datalist', { id: listId }, uniqueValues(f).map(v => el('option', { value: v }))));
      input.setAttribute('list', listId);
      if (f.type === 'tags') input.placeholder = 'Comma-separated';
    }
    td.innerHTML = '';
    td.append(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (commit, moveDir = 0) => {
      if (done) return;
      done = true;
      if (commit && input.value !== original) {
        row[f.id] = f.type === 'tags' ? splitTags(input.value).join(', ') : input.value.trim();
        save();
        render();
      } else {
        fillCell(td, f, row[f.id]);
      }
      if (moveDir) {
        const cells = $$('#grid td.cell');
        const at = cells.findIndex(c => c.closest('tr').dataset.id === tr.dataset.id && c.dataset.field === f.id);
        const next = cells[at + moveDir];
        if (next) startEdit(next);
      }
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'Tab') { e.preventDefault(); finish(true, e.shiftKey ? -1 : 1); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  function addRow() {
    const row = { _id: nextId++ };
    template.fields.forEach(f => {
      // pre-fill single active filter values so the new row stays visible
      const set = ui.filters[f.id];
      row[f.id] = set && set.size === 1 ? [...set][0] : '';
    });
    rows.push(row);
    ui.search = '';
    $('#search').value = '';
    save();
    render();
    const tr = $(`#grid tr[data-id="${row._id}"]`);
    if (tr) {
      tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const first = tr.querySelector('td.cell');
      if (first) startEdit(first);
    }
  }

  function deleteRow(id) {
    const i = rows.findIndex(r => r._id === id);
    if (i < 0) return;
    const removed = rows.splice(i, 1)[0];
    save();
    render();
    const undo = el('a', { href: '#', onclick: e => { e.preventDefault(); rows.splice(i, 0, removed); save(); render(); $('#toast').hidden = true; } }, 'Undo');
    toast(['Row deleted. ', undo], 6000);
  }

  /* ---------- export ---------- */

  function exportAoa() {
    const list = $('#exportVisibleOnly').checked ? visibleRows() : rows;
    return [template.fields.map(f => f.label), ...list.map(r => template.fields.map(f => r[f.id] ?? ''))];
  }

  function exportCsv() {
    const esc = v => (/[",\n\r]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
    const csv = exportAoa().map(r => r.map(esc).join(',')).join('\r\n');
    download(`${fileBase()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
  }

  function exportXlsx() {
    if (!window.XLSX) { toast('Excel support could not load (offline?). Use CSV export instead.'); return; }
    const aoa = exportAoa();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = aoa[0].map((_, c) => ({ wch: Math.min(60, Math.max(8, ...aoa.map(r => String(r[c] ?? '').length))) + 2 }));
    ws['!autofilter'] = { ref: ws['!ref'] };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (template.title || 'Dashboard').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
    XLSX.writeFile(wb, `${fileBase()}.xlsx`);
  }

  async function exportGoogleSheets() {
    const tsv = exportAoa().map(r => r.map(v => String(v).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
    } catch {
      const ta = el('textarea', { style: 'position:fixed;opacity:0' });
      ta.value = tsv;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const link = el('a', { href: 'https://sheets.new', target: '_blank', rel: 'noopener' }, 'Open a new Google Sheet');
    toast(['Copied! ', link, ', click cell A1 and press Ctrl+V.'], 9000);
  }

  function saveTemplate() {
    const out = { app: 'EasyDashboardForYou', version: 1, template };
    download(`${fileBase()}-template.json`, JSON.stringify(out, null, 2), 'application/json');
  }

  async function loadTemplate(file) {
    try {
      const data = JSON.parse(await file.text());
      const t = data.template || data;
      if (!Array.isArray(t.fields)) throw new Error('Not a dashboard template.');
      if (template && rows.length) {
        // re-map the current data through the loaded template
        const table = { headers: template.fields.map(f => f.label), rows: rows.map(r => template.fields.map(f => r[f.id] ?? '')) };
        openMapping({ table, base: t });
      } else {
        template = { searchHint: 'Search…', stats: [], accentField: '', ...t };
        rows = [];
        save();
        render();
        toast('Template loaded. Import data or add rows — matching columns map automatically.', 6000);
      }
    } catch (err) {
      toast(`Could not load template: ${err.message}`, 6000);
    }
  }

  /* ---------- wiring ---------- */

  function closeMenus() { $$('.menu-list.open').forEach(m => m.classList.remove('open')); }

  const actions = {
    'import-file': () => $('#fileInput').click(),
    'import-gsheet': () => { $('#gsheetError').hidden = true; $('#gsheetDialog').showModal(); },
    'import-paste': () => { $('#pasteText').value = ''; $('#pasteDialog').showModal(); },
    'load-template': () => $('#templateInput').click(),
    'load-sample': () => openMapping({
      table: { headers: SAMPLE.headers, rows: SAMPLE.rows.map(r => [...r]) },
      base: SAMPLE.template,
      source: 'Release Tracking'
    }),
    'edit-mapping': () => openMapping(),
    'add-row': addRow,
    'clear-filters': () => { ui.filters = {}; ui.search = ''; ui.sort = null; $('#search').value = ''; render(); },
    'export-csv': exportCsv,
    'export-xlsx': exportXlsx,
    'export-gsheet': exportGoogleSheets,
    'save-template': saveTemplate
  };

  document.addEventListener('click', e => {
    const menuBtn = e.target.closest('[data-menu]');
    if (menuBtn) {
      const list = $(`#${menuBtn.dataset.menu}`);
      const wasOpen = list.classList.contains('open');
      closeMenus();
      if (!wasOpen) list.classList.add('open');
      return;
    }
    if (!e.target.closest('.menu-check')) closeMenus();

    const act = e.target.closest('[data-action]');
    if (act && actions[act.dataset.action]) { actions[act.dataset.action](); return; }

    const del = e.target.closest('[data-del]');
    if (del) { deleteRow(Number(del.dataset.del)); return; }

    const cell = e.target.closest('#grid td.cell');
    if (cell) startEdit(cell);

    if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
  });

  $('#search').addEventListener('input', e => { ui.search = e.target.value; render(); });

  // Title: click to rename
  const title = $('#dashTitle');
  title.addEventListener('click', () => {
    if (!template) return;
    title.contentEditable = 'true';
    title.focus();
    document.getSelection().selectAllChildren(title);
  });
  title.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
    if (e.key === 'Escape') { title.textContent = template.title; title.blur(); }
  });
  title.addEventListener('blur', () => {
    title.contentEditable = 'false';
    if (!template) return;
    template.title = title.textContent.trim() || template.title;
    save();
    render();
  });

  // Mapping dialog
  $('#mappingForm').addEventListener('submit', applyMapping);
  $('#mapCancel').addEventListener('click', () => $('#mappingDialog').close());
  $('#addStat').addEventListener('click', () => {
    mapCtx.stats.push({ label: '', field: mapCtx.accentField || mapCtx.items[0]?.field.id, value: '' });
    renderMapStats();
  });

  // Google Sheets dialog
  $('#gsheetForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter || $('#gsheetForm .primary');
    const err = $('#gsheetError');
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Loading…';
    try {
      const table = await importGoogleSheet($('#gsheetUrl').value.trim());
      $('#gsheetDialog').close();
      openMapping({ table, source: 'Google Sheet' });
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Import';
    }
  });

  // Paste dialog
  $('#pasteForm').addEventListener('submit', e => {
    e.preventDefault();
    try {
      const table = parseDelimited($('#pasteText').value);
      $('#pasteDialog').close();
      openMapping({ table, source: 'Pasted data' });
    } catch (ex) { toast(ex.message); }
  });

  // File inputs
  $('#fileInput').addEventListener('change', e => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ''; });
  $('#templateInput').addEventListener('change', e => { const f = e.target.files[0]; if (f) loadTemplate(f); e.target.value = ''; });

  // Drag & drop
  let dragDepth = 0;
  document.addEventListener('dragenter', e => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
  document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    const f = e.dataTransfer?.files[0];
    if (!f) return;
    if (/\.json$/i.test(f.name)) loadTemplate(f); else importFile(f);
  });

  load();
  render();
})();
