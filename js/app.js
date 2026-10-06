/* EasyDashboardForYou — spreadsheet → mapped, editable dashboard.
 *
 * Data model
 *   template: { title, searchHint, accentField, fields: [Field], stats: [Stat] }
 *   Field:    { id, source, label, type, show, filter, chart }
 *             type ∈ text | longtext | number | date | badge | tags | status
 *   Stat:     { label, field, value }  → counts visible rows whose field contains value
 *   colors:      { [field.id]: { value: '#hex' } }  custom value colours
 *   addedValues: { [field.id]: [value…] }           values defined before any row uses them
 *   valueOrder:  { [field.id]: [value…] }           custom order of values (filters, dropdowns, charts, sorting)
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
  const CATEGORICAL_SLOTS = 8;
  const COLOR_CHOICES = [
    ['Green', '#0ca30c'], ['Blue', '#2a78d6'], ['Amber', '#fab219'], ['Orange', '#eb6834'], ['Red', '#d03b3b'],
    ['Purple', '#7c5cd6'], ['Teal', '#1baf7a'], ['Pink', '#e87ba4'], ['Grey', '#898781']
  ];
  const CHART_MAX_BARS = 8;
  const TAG_SPLIT = /\s*[,;|\n]\s*/;

  const CLIENT_ID_KEY = 'easydashboardforyou.googleClientId';

  let template = null;
  let rows = [];
  let gsheetTarget = null; // last spreadsheet exported via sign-in: { spreadsheetId, sheetId, url, title }
  let nextId = 1;
  let updatedAt = null;
  const ui = { filters: {}, search: '', sort: null, statFilter: null, openFilter: null };

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

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'i');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }

  /* ---------- colour ---------- */

  // Status values map to a reserved role by meaning; always rendered next to their label.
  function statusRole(value) {
    const v = String(value).toLowerCase();
    if (/reject|fail|block|error|cancel|overdue|declin|critical|broken/.test(v)) return 'critical';
    if (/pending|waiting|on hold|hold|review|to ?do|needs|awaiting/.test(v)) return 'warning';
    if (/approv|done|complete|closed|deployed|resolved|success|pass|ready|certified|live|shipped|accepted/.test(v)) return 'good';
    if (/progress|testing|doing|active|started|ongoing|planned|scheduled|working/.test(v)) return 'info';
    return 'neutral';
  }

  // Categorical slot per value: fixed order by first appearance, so a value keeps its colour
  // regardless of filters. Values past the 8th slot fall back to neutral (never a generated hue).
  let slotCache = new Map();
  function slotFor(field, value) {
    let m = slotCache.get(field.id);
    if (!m) {
      m = new Map();
      for (const r of rows) for (const v of valuesOf(field, r)) if (!m.has(v)) m.set(v, m.size);
      for (const v of template?.addedValues?.[field.id] || []) if (!m.has(v)) m.set(v, m.size);
      slotCache.set(field.id, m);
    }
    const i = m.get(value);
    return i === undefined || i >= CATEGORICAL_SLOTS ? null : i + 1;
  }

  const colorOverride = (field, value) => (field && template?.colors?.[field.id]?.[value]) || null;

  function colorVar(field, value) {
    const custom = colorOverride(field, value);
    if (custom) return custom;
    if (field?.type === 'status') return `var(--s-${statusRole(value)})`;
    const slot = field ? slotFor(field, value) : null;
    return slot ? `var(--c${slot})` : 'var(--c-neutral)';
  }

  function pill(value, field) {
    const span = el('span', { class: field?.type === 'status' ? 'pill status' : 'pill' }, value);
    span.style.setProperty('--k', colorVar(field, value));
    return span;
  }

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
    updatedAt = Date.now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ template, rows, gsheetTarget, updatedAt })); } catch { /* storage unavailable */ }
  }

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (data?.template?.fields) {
        template = data.template;
        rows = data.rows || [];
        gsheetTarget = data.gsheetTarget || null;
        updatedAt = data.updatedAt || null;
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
    mapCtx.colors = JSON.parse(JSON.stringify(src?.colors || {}));
    mapCtx.renames = {}; // { fieldId: { oldValue: newValue } }, applied when the dialog is saved
    mapCtx.added = JSON.parse(JSON.stringify(src?.addedValues || {}));
    mapCtx.deletes = {}; // { fieldId: { value: replacement ('' = leave empty) } }, applied on save
    mapCtx.order = JSON.parse(JSON.stringify(src?.valueOrder || {})); // { fieldId: [value…] }
    mapCtx.accentField = src?.accentField;
    if (!mapCtx.items.some(it => typeof it.field.chart === 'boolean')) {
      const accent = mapCtx.accentField || mapCtx.items.find(it => it.field.type === 'status')?.field.id;
      const ids = defaultChartIds(mapCtx.items.map(it => it.field), accent);
      mapCtx.items.forEach(it => { it.field.chart = ids.includes(it.field.id); });
    }
    renderSheetPicker();
    renderMapRows();
    renderMapColors();
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
          renderMapColors();
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
        el('td', {}, el('select', { onchange: e => { f.type = e.target.value; renderMapColors(); } },
          TYPES.map(([v, l]) => el('option', { value: v, selected: v === f.type }, l)))),
        el('td', {}, el('input', { type: 'checkbox', checked: f.filter, onchange: e => { f.filter = e.target.checked; } })),
        el('td', {}, el('input', { type: 'checkbox', checked: !!f.chart, title: 'Show a breakdown chart for this field', onchange: e => { f.chart = e.target.checked; } })),
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

  // Distinct values of a mapping item, from the imported table or the current rows.
  // value → number of rows using it
  function itemValueCounts(it) {
    const f = it.field;
    const raw = mapCtx.isNew ? mapCtx.table.rows.map(r => r[it.colIndex]) : rows.map(r => r[f.id]);
    const counts = new Map();
    raw.forEach(v => (f.type === 'tags' ? splitTags(v) : [String(v ?? '').trim()]).forEach(x => x && counts.set(x, (counts.get(x) || 0) + 1)));
    return counts;
  }

  const itemDataValues = it => new Set(itemValueCounts(it).keys());

  function itemValues(it) {
    const set = itemDataValues(it);
    (mapCtx.added[it.field.id] || []).forEach(v => set.add(v));
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  function resolveCssColor(value) {
    const probe = el('span', { style: `color:${value}; display:none` });
    document.body.append(probe);
    const rgb = getComputedStyle(probe).color.match(/\d+/g) || [0, 0, 0];
    probe.remove();
    return '#' + rgb.slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('');
  }

  function renderMapColors() {
    const box = $('#mapColors');
    box.innerHTML = '';
    const items = mapCtx.items.filter(it => it.field.type === 'status' || it.field.type === 'badge')
      .sort((a, b) => (b.field.type === 'status') - (a.field.type === 'status'));
    if (!items.length) {
      box.append(el('p', { class: 'muted' }, 'No Status or Badge fields yet. Set a field’s “Display as” to Status or Badge to colour its values.'));
      return;
    }
    for (const it of items) {
      const f = it.field;
      const values = itemValues(it);
      const custom = mapCtx.colors[f.id] || (mapCtx.colors[f.id] = {});
      const list = el('div', { class: 'color-list' });
      const auto = v => {
        // preview what Auto would give without the override
        if (f.type === 'status') return `var(--s-${statusRole(v)})`;
        const i = values.indexOf(v);
        return i < CATEGORICAL_SLOTS ? `var(--c${i + 1})` : 'var(--c-neutral)';
      };
      const renames = mapCtx.renames[f.id] || (mapCtx.renames[f.id] = {});
      const added = mapCtx.added[f.id] || (mapCtx.added[f.id] = []);
      // current order: the custom order (if any), then remaining values alphabetically
      const custom_order = mapCtx.order[f.id];
      const ordered = custom_order?.length
        ? [...custom_order.filter(v => values.includes(v)), ...values.filter(v => !custom_order.includes(v))]
        : values;
      const move = (v, dir) => {
        const arr = [...ordered];
        const i = arr.indexOf(v), j = i + dir;
        if (i < 0 || j < 0 || j >= arr.length) return;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        mapCtx.order[f.id] = arr;
        renderMapColors();
        // keep keyboard focus on the moved value (on the other arrow once it reaches the top/bottom)
        const moved = $(`#mapColors .color-field[data-field="${CSS.escape(f.id)}"] .color-row[data-value="${CSS.escape(v)}"]`);
        const same = moved?.querySelector(`.move-${dir < 0 ? 'up' : 'down'}`);
        (same && !same.disabled ? same : moved?.querySelector(`.move-${dir < 0 ? 'down' : 'up'}`))?.focus();
      };
      const reorder = v => {
        const i = ordered.indexOf(v);
        return el('span', { class: 'reorder' },
          el('span', { class: 'drag-handle', title: 'Drag to reorder', 'aria-hidden': 'true' }, '⋮⋮'),
          el('button', { type: 'button', class: 'move move-up', title: 'Move up', 'aria-label': `Move ${v} up`, disabled: i <= 0, onclick: () => move(v, -1) }, '↑'),
          el('button', { type: 'button', class: 'move move-down', title: 'Move down', 'aria-label': `Move ${v} down`, disabled: i >= ordered.length - 1, onclick: () => move(v, 1) }, '↓'));
      };
      const deletes = mapCtx.deletes[f.id] || (mapCtx.deletes[f.id] = {});
      const counts = itemValueCounts(it);
      const used = new Set(counts.keys());
      const shownName = x => renames[x] ?? x;

      // A value marked for deletion: struck through, choose what its rows become, or undo.
      const deletedRow = v => {
        const n = counts.get(v) || 0;
        const others = values.filter(x => x !== v && !(x in deletes));
        const r = el('div', { class: 'color-row deleted', 'data-value': v },
          el('div', { class: 'color-value' },
            el('span', { class: 'deleted-name' }, shownName(v)),
            el('span', { class: 'muted small-text' }, `Will be deleted · ${n} row${n === 1 ? '' : 's'} use it`)),
          el('div', { class: 'swatches' },
            el('label', { class: 'replace-label' }, 'Change those rows to',
              el('select', { onchange: e => { deletes[v] = e.target.value; } },
                el('option', { value: '', selected: !deletes[v] }, '(leave empty)'),
                others.map(x => el('option', { value: x, selected: deletes[v] === x }, shownName(x))))),
            el('button', { type: 'button', class: 'btn small', onclick: () => { delete deletes[v]; list.replaceChild(row(v), r); } }, 'Undo'))
        );
        return r;
      };

      const row = v => {
        if (v in deletes) return deletedRow(v);
        const current = custom[v];
        const name = renames[v] ?? v;
        const preview = el('span', { class: f.type === 'status' ? 'pill status' : 'pill' }, name);
        preview.style.setProperty('--k', current || auto(v));
        const rename = el('input', {
          type: 'text', class: `rename${renames[v] ? ' changed' : ''}`, value: name,
          'aria-label': `Rename “${v}”`, title: renames[v] ? `Was: ${v}` : 'Type to rename this value in every row',
          oninput: e => {
            const nv = e.target.value.trim();
            if (nv && nv !== v) renames[v] = nv; else delete renames[v];
            preview.textContent = nv || v;
            e.target.classList.toggle('changed', !!renames[v]);
            e.target.title = renames[v] ? `Was: ${v}` : 'Type to rename this value in every row';
          }
        });
        const set = color => {
          if (color) custom[v] = color; else delete custom[v];
          list.replaceChild(row(v), r);
        };
        const r = el('div', { class: 'color-row', 'data-value': v },
          el('div', { class: 'color-value' }, reorder(v), rename, preview),
          el('div', { class: 'swatches' },
            el('button', { type: 'button', class: `swatch auto${current ? '' : ' on'}`, title: 'Auto', onclick: () => set(null) }, 'Auto'),
            COLOR_CHOICES.map(([name, hex]) => el('button', {
              type: 'button', class: `swatch${current?.toLowerCase() === hex ? ' on' : ''}`, title: name,
              'aria-label': name, style: `--sw:${hex}`, onclick: () => set(hex)
            })),
            el('label', { class: `swatch custom${current && !COLOR_CHOICES.some(([, h]) => h === current.toLowerCase()) ? ' on' : ''}`, title: 'Custom colour' },
              el('input', { type: 'color', value: current || resolveCssColor(auto(v)), onchange: e => set(e.target.value) })),
            el('button', {
              type: 'button', class: 'value-remove', 'aria-label': `Delete ${v}`,
              title: used.has(v) ? 'Delete this value (you choose what its rows become)' : 'Delete this value (not used by any row)',
              onclick: () => {
                if (used.has(v)) {
                  // mark for deletion; rows are only changed when the dialog is saved
                  deletes[v] = '';
                  list.replaceChild(deletedRow(v), r);
                  return;
                }
                mapCtx.added[f.id] = added.filter(x => x !== v);
                delete custom[v];
                delete renames[v];
                renderMapColors();
              }
            }, icon('trash')))
        );
        return r;
      };
      ordered.slice(0, 40).forEach(v => list.append(row(v)));
      enableDragSort(list, f.id);
      const more = values.length > 40 ? el('p', { class: 'muted small-text' }, `Showing the first 40 of ${values.length} values.`) : null;

      const newInput = el('input', { type: 'text', class: 'rename', placeholder: `New ${(f.label || f.source).toLowerCase()} value…`, 'data-add-for': f.id });
      const addValue = () => {
        const nv = newInput.value.trim();
        if (!nv) return;
        const exists = values.find(x => x.toLowerCase() === nv.toLowerCase()) ||
          Object.values(renames).find(x => x.toLowerCase() === nv.toLowerCase());
        if (exists) { addMsg.textContent = `“${exists}” already exists.`; addMsg.hidden = false; return; }
        added.push(nv);
        if (mapCtx.order[f.id]?.length) mapCtx.order[f.id].push(nv);
        renderMapColors();
        $(`#mapColors input[data-add-for="${CSS.escape(f.id)}"]`)?.focus();
      };
      const addMsg = el('span', { class: 'error small-text', hidden: true });
      newInput.addEventListener('input', () => { addMsg.hidden = true; });
      newInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addValue(); } });
      const addRowEl = el('div', { class: 'color-row add-value' },
        el('div', { class: 'color-value' }, newInput,
          el('button', { type: 'button', class: 'btn small', onclick: addValue }, icon('plus'), 'Add value'), addMsg));

      box.append(el('div', { class: 'color-field', 'data-field': f.id },
        el('div', { class: 'color-field-head' }, el('b', {}, f.label || f.source), el('span', { class: 'muted' }, f.type === 'status' ? 'Status' : 'Badge'),
          el('span', { class: 'spacer' }),
          custom_order?.length
            ? el('button', { type: 'button', class: 'link', title: 'Reset to alphabetical order', onclick: () => { delete mapCtx.order[f.id]; renderMapColors(); } }, 'Reset order (A–Z)')
            : el('span', { class: 'muted small-text' }, 'A–Z · use ↑↓ or drag to reorder'),
          el('span', { class: 'muted' }, `${values.length} value${values.length === 1 ? '' : 's'}`)),
        values.length ? list : el('p', { class: 'muted small-text pad' }, 'No values yet. Add one below.'), more, addRowEl));
    }
  }

  // Drag rows by their handle to reorder values within one field.
  function enableDragSort(list, fieldId) {
    let dragging = null;
    list.addEventListener('pointerdown', e => {
      const row = e.target.closest('.drag-handle')?.closest('.color-row');
      if (row) row.draggable = true;
    });
    list.addEventListener('pointerup', () => {
      if (!dragging) list.querySelectorAll('.color-row[draggable="true"]').forEach(r => { r.draggable = false; });
    });
    list.addEventListener('dragstart', e => {
      dragging = e.target.closest('.color-row');
      if (!dragging) return;
      dragging.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragging.dataset.value);
    });
    list.addEventListener('dragover', e => {
      if (!dragging) return;
      e.preventDefault();
      const over = e.target.closest('.color-row');
      if (!over || over === dragging || over.parentNode !== list) return;
      const before = e.clientY < over.getBoundingClientRect().top + over.offsetHeight / 2;
      list.insertBefore(dragging, before ? over : over.nextSibling);
    });
    list.addEventListener('dragend', () => {
      if (!dragging) return;
      dragging.classList.remove('dragging');
      dragging.draggable = false;
      dragging = null;
      const shown = [...list.querySelectorAll('.color-row[data-value]')].map(r => r.dataset.value);
      const prev = mapCtx.order[fieldId] || [];
      // values beyond the first 40 shown keep their relative order after the visible ones
      mapCtx.order[fieldId] = [...shown, ...prev.filter(v => !shown.includes(v))];
      renderMapColors();
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

  // Deleting a value = renaming it to its replacement (after that replacement's own rename) or to ''.
  function combineRenamesAndDeletes(renames, deletes) {
    const out = {};
    const fids = new Set([...Object.keys(renames || {}), ...Object.keys(deletes || {})]);
    for (const fid of fids) {
      const ren = { ...(renames?.[fid] || {}) };
      for (const [v, rep] of Object.entries(deletes?.[fid] || {})) ren[v] = rep ? (renames?.[fid]?.[rep] ?? rep) : '';
      out[fid] = ren;
    }
    return out;
  }

  // Rename values everywhere they are used: rows, colours, active filters and exact-match summary cards.
  // A value renamed to '' is deleted.
  function applyRenames(renames) {
    for (const [fid, map] of Object.entries(renames || {})) {
      if (!Object.keys(map).length) continue;
      const f = fieldById(fid);
      if (!f) continue;
      const to = v => map[v] ?? v;
      for (const r of rows) {
        const raw = String(r[fid] ?? '');
        r[fid] = f.type === 'tags' ? [...new Set(splitTags(raw).map(to).filter(Boolean))].join(', ') : (map[raw.trim()] ?? raw);
      }
      const colors = template.colors?.[fid];
      if (colors) {
        template.colors[fid] = {};
        for (const [v, c] of Object.entries(colors)) {
          if (!to(v)) continue; // deleted
          // a renamed value's colour wins over an existing value it was merged into
          if (!(to(v) in template.colors[fid]) || map[v]) template.colors[fid][to(v)] = c;
        }
      }
      if (ui.filters[fid]) ui.filters[fid] = new Set([...ui.filters[fid]].map(to).filter(Boolean));
      if (template.addedValues?.[fid]) template.addedValues[fid] = [...new Set(template.addedValues[fid].map(to).filter(Boolean))];
      if (template.valueOrder?.[fid]) template.valueOrder[fid] = [...new Set(template.valueOrder[fid].map(to).filter(Boolean))];
      for (const s of template.stats) {
        if (s.field !== fid) continue;
        const old = Object.keys(map).find(v => v.toLowerCase() === s.value.trim().toLowerCase());
        if (old && map[old]) s.value = map[old];
      }
    }
  }

  function applyMapping() {
    const fields = mapCtx.items.map(it => ({ ...it.field, label: it.field.label.trim() || it.field.source }));
    const previous = template;
    template = {
      title: $('#mapTitle').value.trim() || 'My Dashboard',
      searchHint: $('#mapSearchHint').value.trim() || 'Search…',
      accentField: mapCtx.accentField || '',
      fields,
      stats: mapCtx.stats.filter(s => s.label.trim() && s.value.trim()),
      colors: Object.fromEntries(Object.entries(mapCtx.colors)
        .filter(([id, map]) => fields.some(f => f.id === id) && Object.keys(map).length)),
      addedValues: Object.fromEntries(Object.entries(mapCtx.added)
        .filter(([id, list]) => fields.some(f => f.id === id) && list.length)),
      valueOrder: Object.fromEntries(Object.entries(mapCtx.order)
        .filter(([id, list]) => fields.some(f => f.id === id) && list?.length))
    };
    if (mapCtx.isNew) {
      // a different data set gets its own spreadsheet on the next Google Sheets export
      if (mapCtx.base !== previous) gsheetTarget = null;
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
    // a deleted value's own colour must not carry over to its replacement
    for (const [fid, d] of Object.entries(mapCtx.deletes)) for (const v of Object.keys(d)) delete template.colors?.[fid]?.[v];
    applyRenames(combineRenamesAndDeletes(mapCtx.renames, mapCtx.deletes));
    for (const id of Object.keys(ui.filters)) if (!fieldById(id)?.filter) delete ui.filters[id];
    save();
    render();
    toast(mapCtx.isNew ? `Dashboard built with ${rows.length} rows.` : 'Field mapping updated.');
  }

  /* ---------- filtering / sorting ---------- */

  function statMatches(stat, row) {
    const f = fieldById(stat.field);
    return !!f && String(row[f.id] ?? '').toLowerCase().includes(stat.value.toLowerCase());
  }

  // Rows passing all filters. `exceptField` ignores that field's own filter (used by its breakdown chart).
  function visibleRows(exceptField = null) {
    const q = ui.search.trim().toLowerCase();
    const active = Object.entries(ui.filters).filter(([fid, set]) => set.size && fid !== exceptField);
    const stat = ui.statFilter != null ? template.stats[ui.statFilter] : null;
    let out = rows.filter(r => {
      for (const [fid, set] of active) {
        const f = fieldById(fid);
        if (!f || !valuesOf(f, r).some(v => set.has(v))) return false;
      }
      if (stat && !statMatches(stat, r)) return false;
      if (q && !template.fields.some(f => String(r[f.id] ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
    if (ui.sort && !exceptField) {
      const f = fieldById(ui.sort.field);
      const dir = ui.sort.dir;
      const key = r => {
        const v = String(r[f.id] ?? '');
        if (f.type === 'number') return parseFloat(v.replace(/[,%]/g, ''));
        if (f.type === 'date') return Date.parse(v);
        if (hasCustomOrder(f) && (f.type === 'status' || f.type === 'badge')) {
          const i = template.valueOrder[f.id].indexOf(v.trim());
          return v.trim() ? (i < 0 ? template.valueOrder[f.id].length : i) : NaN; // empty sorts last
        }
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

  const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true });

  // Sort values by the field's custom order (if set); values not in it follow alphabetically.
  function orderValues(field, values) {
    const order = template?.valueOrder?.[field.id];
    if (!order?.length) return [...values].sort(byName);
    const rank = new Map(order.map((v, i) => [v, i]));
    return [...values].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || byName(a, b));
  }

  const hasCustomOrder = field => !!template?.valueOrder?.[field.id]?.length;

  function uniqueValues(field) {
    const set = new Set();
    rows.forEach(r => valuesOf(field, r).forEach(v => set.add(v)));
    (template?.addedValues?.[field.id] || []).forEach(v => set.add(v));
    return orderValues(field, set);
  }

  /* ---------- rendering ---------- */

  function render() {
    slotCache = new Map();
    const has = !!template;
    $('#emptyState').hidden = has;
    $('#dashboard').hidden = !has;
    $$('[data-action="edit-mapping"],[data-action="add-row"],[data-menu="exportMenu"]')
      .forEach(b => (b.disabled = !has));
    if (!has) return;
    if ($('#dashTitle').contentEditable !== 'true') $('#dashTitle').textContent = template.title;
    $('#search').placeholder = template.searchHint || 'Search…';
    if (ui.statFilter != null && !template.stats[ui.statFilter]) ui.statFilter = null;
    const vis = visibleRows();
    renderMeta();
    renderStats(vis);
    renderCharts();
    renderFilters();
    renderActiveFilters();
    renderTable(vis);
    $('#rowCount').innerHTML = '';
    $('#rowCount').append('Showing ', el('b', {}, vis.length), ' of ', el('b', {}, rows.length), ` record${rows.length === 1 ? '' : 's'}`);
  }

  function renderMeta() {
    const parts = [
      [el('b', {}, rows.length), ` record${rows.length === 1 ? '' : 's'}`],
      [el('b', {}, template.fields.filter(f => f.show).length), ' fields']
    ];
    if (updatedAt) {
      const d = new Date(updatedAt);
      parts.push([`Last edited ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`]);
    }
    const meta = $('#dashMeta');
    meta.innerHTML = '';
    parts.forEach((p, i) => { if (i) meta.append('  ·  '); meta.append(...p); });
  }

  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

  function renderStats(vis) {
    const box = $('#stats');
    box.innerHTML = '';
    const filtered = vis.length !== rows.length;
    box.append(el('div', { class: 'card kpi static' },
      el('div', { class: 'kpi-label' }, filtered ? 'Visible records' : 'Total records'),
      el('div', { class: 'kpi-value' }, vis.length, filtered ? el('small', {}, `of ${rows.length}`) : null),
      el('div', { class: 'meter', style: '--k: var(--c1)' }, el('i', { style: `width:${pct(vis.length, rows.length)}%` })),
      el('div', { class: 'kpi-foot' }, filtered ? `${pct(vis.length, rows.length)}% of all records` : 'All records shown')
    ));
    template.stats.forEach((s, i) => {
      const f = fieldById(s.field);
      if (!f) return;
      const n = vis.filter(r => statMatches(s, r)).length;
      const exact = Object.keys(template.colors?.[f.id] || {}).find(v => v.toLowerCase() === s.value.trim().toLowerCase());
      const k = exact ? colorOverride(f, exact) : f.type === 'status' ? `var(--s-${statusRole(s.value)})` : 'var(--c1)';
      const active = ui.statFilter === i;
      box.append(el('button', {
        type: 'button',
        class: `card kpi${active ? ' active' : ''}`,
        style: `--k: ${k}`,
        'aria-pressed': active ? 'true' : 'false',
        'data-tip': active ? 'Click to remove this filter' : `Click to show only rows where <b>${escapeHtml(f.label)}</b> contains “${escapeHtml(s.value)}”`,
        onclick: () => { ui.statFilter = active ? null : i; render(); }
      },
        el('div', { class: 'kpi-label' }, el('span', { class: 'dot' }), s.label),
        el('div', { class: 'kpi-value' }, n),
        el('div', { class: 'meter' }, el('i', { style: `width:${pct(n, vis.length)}%` })),
        el('div', { class: 'kpi-foot' }, `${pct(n, vis.length)}% of visible records`)
      ));
    });
  }

  // Default breakdown charts: the colour-bar field plus up to two other filterable category fields.
  function defaultChartIds(fields, accentField) {
    const ok = f => ['status', 'badge', 'tags'].includes(f.type);
    const ids = [];
    const accent = fields.find(f => f.id === accentField && ok(f));
    if (accent) ids.push(accent.id);
    for (const f of fields) {
      if (ids.length >= 3) break;
      if (!ids.includes(f.id) && ok(f) && f.filter) ids.push(f.id);
    }
    return ids;
  }

  function chartFields() {
    if (template.fields.some(f => typeof f.chart === 'boolean')) {
      // the row-colour field (usually Status) leads
      return template.fields.filter(f => f.chart).sort((a, b) => (b.id === template.accentField) - (a.id === template.accentField));
    }
    const ids = defaultChartIds(template.fields, template.accentField);
    return ids.map(fieldById);
  }

  function toggleFilter(fieldId, value) {
    const set = ui.filters[fieldId] || (ui.filters[fieldId] = new Set());
    set.has(value) ? set.delete(value) : set.add(value);
    render();
  }

  function renderCharts() {
    const box = $('#charts');
    box.innerHTML = '';
    for (const f of chartFields()) {
      const base = visibleRows(f.id);
      const counts = new Map();
      base.forEach(r => valuesOf(f, r).forEach(v => counts.set(v, (counts.get(v) || 0) + 1)));
      if (!counts.size) continue;
      const entries = hasCustomOrder(f)
        ? orderValues(f, counts.keys()).map(v => [v, counts.get(v)])
        : [...counts].sort((a, b) => b[1] - a[1] || byName(a[0], b[0]));
      const top = entries.slice(0, CHART_MAX_BARS);
      const rest = entries.slice(CHART_MAX_BARS);
      const max = top[0][1];
      const selected = ui.filters[f.id];
      const isStatus = f.type === 'status';

      const bar = (label, n, { k, other, dim, sel, tip } = {}) => el(other ? 'div' : 'button', {
        type: other ? undefined : 'button',
        class: `bar-row${other ? ' other' : ''}${dim ? ' dim' : ''}${sel ? ' selected' : ''}`,
        style: `--k: ${k}`,
        'data-tip': tip,
        onclick: other ? undefined : () => toggleFilter(f.id, label)
      },
        el('span', { class: 'bar-label' }, isStatus && !other ? el('i', { class: 'dot' }) : null, el('span', {}, label)),
        el('span', { class: 'bar-track' }, el('i', { style: `width:${Math.max(1.5, (n / max) * 100)}%` })),
        el('span', { class: 'bar-value' }, n, el('small', {}, `${pct(n, base.length)}%`))
      );

      const body = el('div', { class: 'chart-body' });
      for (const [v, n] of top) {
        const sel = selected?.has(v);
        body.append(bar(v, n, {
          k: isStatus ? colorVar(f, v) : 'var(--c1)',
          sel,
          dim: selected?.size && !sel,
          tip: `<b>${escapeHtml(v)}</b><br>${n} record${n === 1 ? '' : 's'} · ${pct(n, base.length)}%<br>${sel ? 'Click to remove filter' : 'Click to filter'}`
        }));
      }
      if (rest.length) {
        const n = rest.reduce((s, [, c]) => s + c, 0);
        body.append(bar(`Other (${rest.length} values)`, n, { k: 'var(--c-neutral)', other: true, tip: `${rest.length} smaller values combined. Use the ${f.label} filter to pick one.` }));
      }
      const unit = f.type === 'tags' ? 'tag uses' : 'records';
      box.append(el('section', { class: 'card' },
        el('div', { class: 'card-head' },
          el('h2', { class: 'card-title' }, `By ${f.label}`),
          el('span', { class: 'card-sub' }, `${base.length} records · ${counts.size} value${counts.size === 1 ? '' : 's'}${f.type === 'tags' ? ` · counts are ${unit}` : ''}`)),
        body));
    }
    box.hidden = !box.children.length;
  }

  function renderFilters() {
    const box = $('#filters');
    box.innerHTML = '';
    const fields = template.fields.filter(f => f.filter && uniqueValues(f).length);
    if (!fields.length) return;
    box.append(el('span', { class: 'filters-label' }, icon('filter'), 'Filter'));
    for (const f of fields) {
      const set = ui.filters[f.id] || (ui.filters[f.id] = new Set());
      const pop = el('div', { class: 'menu-list filter-pop', onclick: e => e.stopPropagation() });
      const label = !set.size ? [f.label] : [`${f.label}: `, el('b', {}, set.size === 1 ? [...set][0] : `${set.size} selected`)];
      const btn = el('button', {
        type: 'button',
        class: `filter-btn${set.size ? ' on' : ''}`,
        'aria-haspopup': 'true',
        onclick: e => {
          e.stopPropagation();
          const wasOpen = pop.classList.contains('open');
          closeMenus();
          if (!wasOpen) openFilterPop(f, pop);
        }
      }, set.size ? null : icon('plus'), ...label, icon('chevron'));
      box.append(el('div', { class: 'menu' }, btn, pop));
      if (ui.openFilter === f.id) openFilterPop(f, pop, { keepFocus: true });
    }
  }

  function openFilterPop(f, pop) {
    ui.openFilter = f.id;
    const set = ui.filters[f.id];
    const counts = new Map();
    visibleRows(f.id).forEach(r => valuesOf(f, r).forEach(v => counts.set(v, (counts.get(v) || 0) + 1)));
    const values = uniqueValues(f);
    const list = el('div', { class: 'filter-options' });
    const fill = q => {
      list.innerHTML = '';
      const shown = values.filter(v => !q || v.toLowerCase().includes(q));
      for (const v of shown) {
        list.append(el('label', { class: 'filter-option' },
          el('input', { type: 'checkbox', checked: set.has(v), onchange: () => toggleFilter(f.id, v) }),
          ['badge', 'status', 'tags'].includes(f.type) ? pill(v, f) : el('span', { class: 'name' }, v),
          el('span', { class: 'spacer' }),
          el('span', { class: 'count' }, counts.get(v) || 0)));
      }
      if (!shown.length) list.append(el('div', { class: 'filter-option muted' }, 'No matches'));
    };
    fill('');
    pop.innerHTML = '';
    if (values.length > 8) {
      pop.append(el('input', { type: 'search', placeholder: `Search ${f.label.toLowerCase()}…`, oninput: e => fill(e.target.value.trim().toLowerCase()) }));
    }
    pop.append(list, el('div', { class: 'pop-foot' },
      el('button', { type: 'button', onclick: () => { set.clear(); render(); } }, 'Clear'),
      el('button', { type: 'button', onclick: () => closeMenus() }, 'Done')));
    pop.classList.add('open');
  }

  function renderActiveFilters() {
    const box = $('#activeFilters');
    box.innerHTML = '';
    const chip = (k, v, onRemove) => el('button', { type: 'button', class: 'af-chip', title: 'Remove filter', onclick: onRemove },
      el('span', { class: 'k' }, `${k}:`), v, icon('x'));
    for (const [fid, set] of Object.entries(ui.filters)) {
      const f = fieldById(fid);
      if (!f) continue;
      for (const v of set) box.append(chip(f.label, v, () => toggleFilter(fid, v)));
    }
    const stat = ui.statFilter != null ? template.stats[ui.statFilter] : null;
    if (stat) box.append(chip('Card', stat.label, () => { ui.statFilter = null; render(); }));
    if (ui.search.trim()) box.append(chip('Search', `“${ui.search.trim()}”`, () => { ui.search = ''; $('#search').value = ''; render(); }));
    if (box.children.length) box.append(el('button', { type: 'button', class: 'link', 'data-action': 'clear-filters' }, 'Clear all'));
    box.hidden = !box.children.length;
  }

  function renderTable(vis) {
    const fields = template.fields.filter(f => f.show);
    const thead = $('#grid thead');
    const tbody = $('#grid tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';

    thead.append(el('tr', {},
      el('th', { class: 'row-actions', 'aria-label': 'Row actions' }),
      el('th', { class: 'bar' }),
      fields.map(f => {
        const s = ui.sort?.field === f.id ? ui.sort.dir : 0;
        return el('th', {
          class: `${s ? 'sorted' : ''} ${f.type === 'number' ? 'num' : ''}`.trim() || undefined,
          'aria-sort': s === 1 ? 'ascending' : s === -1 ? 'descending' : undefined,
          title: 'Click to sort',
          onclick: () => {
            if (!s) ui.sort = { field: f.id, dir: 1 };
            else if (s === 1) ui.sort = { field: f.id, dir: -1 };
            else ui.sort = null;
            render();
          }
        }, f.label, el('span', { class: 'arrow' }, s === 1 ? '▲' : s === -1 ? '▼' : '▲'));
      })
    ));

    if (!vis.length) {
      tbody.append(el('tr', {}, el('td', { class: 'no-rows', colspan: fields.length + 2 },
        rows.length ? 'No records match the current filters.' : 'No records yet. Click “Add row” to create one.')));
      return;
    }

    const accent = fieldById(template.accentField);
    const keyField = fields[0];
    for (const r of vis) {
      const bar = el('i');
      const accentValue = accent ? valuesOf(accent, r)[0] : null;
      if (accentValue) {
        bar.style.setProperty('--k', colorVar(accent, accentValue));
        bar.title = `${accent.label}: ${accentValue}`;
      }
      const tr = el('tr', { 'data-id': r._id },
        el('td', { class: 'row-actions' }, el('button', { title: 'Delete row', 'aria-label': 'Delete row', 'data-del': r._id }, icon('trash'))),
        el('td', { class: 'bar' }, bar));
      for (const f of fields) {
        const cls = ['cell', f.type === 'longtext' && 'wrap', f.type === 'number' && 'num', f === keyField && 'key'].filter(Boolean).join(' ');
        const td = el('td', { class: cls, 'data-field': f.id });
        fillCell(td, f, r[f.id]);
        tr.append(td);
      }
      tbody.append(tr);
    }
  }

  function fillCell(td, f, value) {
    td.innerHTML = '';
    const v = String(value ?? '').trim();
    if (!v) { td.append(el('span', { class: 'empty-cell' }, '—')); return; }
    if (f.type === 'badge' || f.type === 'status') td.append(pill(v, f));
    else if (f.type === 'tags') td.append(...splitTags(v).map(t => pill(t, f)));
    else td.textContent = v;
  }

  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- inline editing ---------- */

  function startEdit(td) {
    if (!td.isConnected) {
      // the table re-rendered (e.g. a previous edit committed on blur) — find the fresh cell
      const id = td.closest('tr')?.dataset.id;
      td = $(`#grid tr[data-id="${id}"] td[data-field="${CSS.escape(td.dataset.field)}"]`);
      if (!td) return;
    }
    if (td.querySelector('input, select')) return;
    const tr = td.closest('tr');
    const row = rows.find(r => r._id === Number(tr.dataset.id));
    const f = fieldById(td.dataset.field);
    if (!row || !f) return;

    const original = String(row[f.id] ?? '');
    const NEW = '__new_value__';
    const makeInput = value => {
      const input = el('input', { type: 'text', value });
      if (f.type === 'tags') {
        const listId = `dl-${f.id}`;
        $(`#${CSS.escape(listId)}`)?.remove();
        document.body.append(el('datalist', { id: listId }, uniqueValues(f).map(v => el('option', { value: v }))));
        input.setAttribute('list', listId);
        input.placeholder = 'Comma-separated';
      }
      return input;
    };
    let editor;
    if (f.type === 'status' || f.type === 'badge') {
      // pick from every known value (including ones added in Field mapping), or type a new one
      const values = uniqueValues(f);
      if (original.trim() && !values.includes(original.trim())) values.unshift(original.trim());
      editor = el('select', { 'aria-label': f.label },
        el('option', { value: '' }, '— empty —'),
        values.map(v => el('option', { value: v, selected: v === original.trim() }, v)),
        el('option', { value: NEW }, '+ New value…'));
    } else {
      editor = makeInput(original);
    }
    td.innerHTML = '';
    td.append(editor);
    editor.focus();
    editor.select?.();

    let done = false;
    const finish = (commit, moveDir = 0) => {
      if (done) return;
      done = true;
      const value = editor.value === NEW ? original : editor.value;
      if (commit && value !== original) {
        row[f.id] = f.type === 'tags' ? splitTags(value).join(', ') : value.trim();
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
    const wire = node => {
      node.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        else if (e.key === 'Tab') { e.preventDefault(); finish(true, e.shiftKey ? -1 : 1); }
      });
      node.addEventListener('blur', () => { if (node === editor) finish(true); });
    };
    wire(editor);
    if (editor.tagName === 'SELECT') {
      editor.addEventListener('change', () => {
        if (editor.value !== NEW) { finish(true); return; }
        // switch to a text box for a brand-new value
        const input = makeInput('');
        input.placeholder = `New ${f.label.toLowerCase()}…`;
        editor = input;
        wire(input);
        td.replaceChildren(input);
        input.focus();
      });
    }
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

  /* ---------- direct Google Sheets export (sign-in) ---------- */

  const isClientId = v => /^[\w-]+\.apps\.googleusercontent\.com$/.test(v);

  function getClientId() {
    try { const v = localStorage.getItem(CLIENT_ID_KEY); if (v) return v; } catch { /* storage unavailable */ }
    return window.EASYDASH_CONFIG?.googleClientId || '';
  }

  function setGexportStatus(msg, isError = false) {
    const s = $('#gexportStatus');
    s.innerHTML = '';
    if (!msg) { s.hidden = true; return; }
    s.append(...(Array.isArray(msg) ? msg : [msg]));
    s.className = `status-msg${isError ? ' error' : ''}`;
    s.hidden = false;
  }

  function openGoogleExport({ showSetup } = {}) {
    GoogleSheets.preload();
    const needSetup = showSetup || !getClientId();
    $('#gexportSetup').hidden = !needSetup;
    $('#gexportOrigin').textContent = location.origin;
    $('#gexportClientId').value = getClientId();
    $('#gexportChangeId').hidden = needSetup;
    $('#gexportSignOut').hidden = !GoogleSheets.isSignedIn();
    $('#gexportTitle').value = gsheetTarget?.title || template.title;
    const hasTarget = !!gsheetTarget;
    $('#gexportUpdateOpt').hidden = !hasTarget;
    if (hasTarget) {
      $('#gexportTargetLink').href = gsheetTarget.url;
      $('#gexportTargetLink').textContent = gsheetTarget.title;
    }
    $$('input[name="gexportMode"]').forEach(r => { r.checked = r.value === (hasTarget ? 'update' : 'new'); });
    const n = exportAoa().length - 1;
    $('#gexportCount').textContent = `${n} row${n === 1 ? '' : 's'} will be exported.`;
    $('#gexportGo').disabled = false;
    $('#gexportGo').textContent = GoogleSheets.isSignedIn() ? 'Export' : 'Sign in & export';
    setGexportStatus('');
    if (!$('#gexportDialog').open) $('#gexportDialog').showModal();
  }

  async function runGoogleExport() {
    if (!$('#gexportSetup').hidden) {
      const id = $('#gexportClientId').value.trim();
      if (!isClientId(id)) {
        setGexportStatus('That doesn’t look like a Client ID. It should end in “.apps.googleusercontent.com”.', true);
        return;
      }
      try { localStorage.setItem(CLIENT_ID_KEY, id); } catch { /* storage unavailable */ }
    }
    const update = $('input[name="gexportMode"]:checked')?.value === 'update' && gsheetTarget;
    const title = $('#gexportTitle').value.trim() || template.title;
    const btn = $('#gexportGo');
    btn.disabled = true;
    btn.textContent = 'Exporting…';
    setGexportStatus('Waiting for Google sign-in…');
    try {
      const result = await GoogleSheets.exportTable({
        clientId: getClientId(),
        title,
        aoa: exportAoa(),
        numeric: template.fields.map(f => f.type === 'number'),
        target: update ? gsheetTarget : null
      });
      gsheetTarget = { spreadsheetId: result.spreadsheetId, sheetId: result.sheetId, url: result.url, title: result.title };
      save();
      const link = el('a', { href: result.url, target: '_blank', rel: 'noopener' }, 'Open the spreadsheet');
      const note = result.recreated ? 'The previous spreadsheet couldn’t be accessed, so a new one was created. ' : '';
      setGexportStatus([`✓ Exported to “${result.title}”. ${note}`, link]);
      $('#gexportSetup').hidden = true;
      $('#gexportChangeId').hidden = false;
      $('#gexportSignOut').hidden = false;
      btn.textContent = 'Export again';
    } catch (err) {
      let msg = err.message;
      if (/idpiframe|origin|invalid_client|unregistered/i.test(msg)) {
        msg += ` Check that ${location.origin} is listed as an Authorized JavaScript origin for this Client ID.`;
      }
      if (/has not been used|is disabled|SERVICE_DISABLED/i.test(msg)) msg = 'The Google Sheets API isn’t enabled in your Google Cloud project yet. Enable it and try again.';
      setGexportStatus(`Export failed: ${msg}`, true);
      btn.textContent = GoogleSheets.isSignedIn() ? 'Export' : 'Sign in & export';
    } finally {
      btn.disabled = false;
    }
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

  function closeMenus() {
    ui.openFilter = null;
    $$('.menu-list.open').forEach(m => m.classList.remove('open'));
  }

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
    'clear-filters': () => { ui.filters = {}; ui.search = ''; ui.statFilter = null; $('#search').value = ''; render(); },
    'print': () => window.print(),
    'export-csv': exportCsv,
    'export-xlsx': exportXlsx,
    'export-gsheet': exportGoogleSheets,
    'export-gsheet-api': () => openGoogleExport(),
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

  // Hover tooltips for anything with data-tip
  const tip = $('#tip');
  document.addEventListener('mousemove', e => {
    const t = e.target.closest?.('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    if (tip.dataset.src !== t.dataset.tip) { tip.innerHTML = t.dataset.tip; tip.dataset.src = t.dataset.tip; }
    tip.hidden = false;
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.min(e.clientX + pad, innerWidth - w - 8)}px`;
    tip.style.top = `${e.clientY + pad + h > innerHeight ? e.clientY - h - pad : e.clientY + pad}px`;
  });
  document.addEventListener('scroll', () => { tip.hidden = true; }, true);

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

  // Google Sheets export dialog
  $('#gexportForm').addEventListener('submit', e => { e.preventDefault(); runGoogleExport(); });
  $('#gexportChangeId').addEventListener('click', () => openGoogleExport({ showSetup: true }));
  $('#gexportSignOut').addEventListener('click', () => {
    GoogleSheets.signOut();
    $('#gexportSignOut').hidden = true;
    $('#gexportGo').textContent = 'Sign in & export';
    setGexportStatus('Signed out of Google.');
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
