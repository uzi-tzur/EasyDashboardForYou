/* EasyDashboardForYou — PowerPoint (.pptx) → standalone "wow" HTML dashboard.
 *
 * Everything runs in the browser: the .pptx is unzipped with JSZip, slides are read
 * (titles, bullets, tables, pictures, native charts), sorted into dashboard sections,
 * and written out as ONE self-contained HTML file with every visual embedded.
 *
 * Output sections
 *   hero · KPI summary cards · purpose · employee value · community content themes ·
 *   engagement & impact visualization · manager next steps · visuals from the deck
 *   Any number that does not come from the deck is badged "Illustrative".
 *
 * Public API: window.PptDashboard = { parse(file), build(deck, opts) }
 */
(() => {
  'use strict';

  /* ---------- tiny helpers ---------- */

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const tags = (node, name) => node ? Array.from(node.getElementsByTagNameNS('*', name)) : [];
  const tag = (node, name) => tags(node, name)[0] || null;
  const child = (node, name) => node ? Array.from(node.children).find(c => c.localName === name) || null : null;
  // relationship attributes (r:id, r:embed); <p:sldId> also has a plain "id", so the namespace matters
  const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const attrNS = (node, name) => node ? node.getAttributeNS(REL_NS, name) : null;
  const xml = text => new DOMParser().parseFromString(text, 'application/xml');
  const clean = s => s.replace(/\s+/g, ' ').trim();

  function resolvePath(base, target) {
    if (target.startsWith('/')) return target.slice(1);
    const parts = base.split('/').slice(0, -1);
    for (const seg of target.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '.') parts.push(seg);
    }
    return parts.join('/');
  }

  async function readRels(zip, partPath) {
    const i = partPath.lastIndexOf('/');
    const relPath = `${partPath.slice(0, i)}/_rels/${partPath.slice(i + 1)}.rels`;
    const f = zip.file(relPath);
    const map = {};
    if (!f) return map;
    for (const r of tags(xml(await f.async('string')), 'Relationship')) {
      if (r.getAttribute('TargetMode') === 'External') continue;
      map[r.getAttribute('Id')] = resolvePath(partPath, r.getAttribute('Target'));
    }
    return map;
  }

  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp' };
  const MAX_SIDE = 1600;

  // Large raster images are re-encoded so the dashboard file stays light.
  async function imageDataUrl(zip, path) {
    const ext = path.split('.').pop().toLowerCase();
    const mime = MIME[ext];
    const f = zip.file(path);
    if (!mime || !f) return null; // EMF/WMF etc. can't be shown in a browser
    const blob = new Blob([await f.async('uint8array')], { type: mime });
    if (ext === 'svg' || ext === 'gif' || blob.size < 350_000) return blobToDataUrl(blob);
    try {
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const type = ext === 'png' && hasAlpha(c) ? 'image/png' : 'image/jpeg';
      return c.toDataURL(type, 0.84);
    } catch {
      return blobToDataUrl(blob);
    }
  }

  function hasAlpha(canvas) {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4 * 97) if (data[i] < 250) return true;
    return false;
  }

  const blobToDataUrl = blob => new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = fail;
    r.readAsDataURL(blob);
  });

  /* ---------- parsing ---------- */

  async function parse(file) {
    if (!window.JSZip) throw new Error('PowerPoint support could not load (offline?). Check your connection and try again.');
    if (/\.ppt$/i.test(file.name)) throw new Error('Old .ppt files are not supported. Open it in PowerPoint and “Save as” .pptx first.');
    let zip;
    try { zip = await JSZip.loadAsync(await file.arrayBuffer()); }
    catch { throw new Error('This does not look like a .pptx file.'); }

    const presPath = 'ppt/presentation.xml';
    if (!zip.file(presPath)) throw new Error('This does not look like a PowerPoint (.pptx) file.');
    const pres = xml(await zip.file(presPath).async('string'));
    const presRels = await readRels(zip, presPath);
    const slidePaths = tags(pres, 'sldId').map(s => presRels[attrNS(s, 'id')]).filter(Boolean);

    const sz = tag(pres, 'sldSz');
    const slideArea = sz ? Number(sz.getAttribute('cx')) * Number(sz.getAttribute('cy')) : 12192000 * 6858000;

    let docTitle = '';
    const core = zip.file('docProps/core.xml');
    if (core) docTitle = clean(tag(xml(await core.async('string')), 'title')?.textContent || '');

    const images = new Map(); // media path → { src, area, slide }
    const slides = [];
    for (const [i, path] of slidePaths.entries()) {
      const f = zip.file(path);
      if (!f) continue;
      const doc = xml(await f.async('string'));
      if (doc.documentElement.getAttribute('show') === '0') continue; // hidden slide
      const rels = await readRels(zip, path);
      slides.push(await parseSlide(zip, doc, rels, i + 1, slideArea, images));
    }
    if (!slides.length) throw new Error('No slides found in this presentation.');
    return { fileName: file.name, docTitle, slides };
  }

  async function parseSlide(zip, doc, rels, number, slideArea, images) {
    const slide = { number, title: '', subtitle: '', paras: [], tables: [], images: [], charts: [] };
    const tree = tag(doc, 'spTree');

    for (const sp of tags(tree, 'sp')) {
      const ph = tag(child(sp, 'nvSpPr'), 'ph');
      const type = ph ? ph.getAttribute('type') || 'body' : null;
      const paras = tags(child(sp, 'txBody'), 'p')
        .map(p => ({ text: clean(tags(p, 't').map(t => t.textContent).join('')), lvl: Number(tag(p, 'pPr')?.getAttribute('lvl') || 0) }))
        .filter(p => p.text);
      if (!paras.length) continue;
      if ((type === 'title' || type === 'ctrTitle') && !slide.title) slide.title = paras.map(p => p.text).join(' ');
      else if (type === 'subTitle' && !slide.subtitle) slide.subtitle = paras.map(p => p.text).join(' ');
      else if (type === 'sldNum' || type === 'ftr' || type === 'dt') continue;
      else slide.paras.push(...paras);
    }

    for (const tbl of tags(tree, 'tbl')) {
      const rows = tags(tbl, 'tr').map(tr => tags(tr, 'tc').map(tc => clean(tags(tc, 't').map(t => t.textContent).join(' '))));
      if (rows.length) slide.tables.push(rows);
    }

    for (const pic of tags(tree, 'pic')) {
      const id = attrNS(tag(pic, 'blip'), 'embed');
      const path = id && rels[id];
      if (!path) continue;
      const ext = tag(child(pic, 'spPr'), 'ext');
      const area = ext ? Number(ext.getAttribute('cx')) * Number(ext.getAttribute('cy')) / slideArea : 0.1;
      if (area < 0.012) continue; // icons, logos, bullets
      if (!images.has(path)) {
        const src = await imageDataUrl(zip, path);
        if (!src) continue;
        images.set(path, { src, area, slide: number });
        slide.images.push({ src, area });
      }
    }

    for (const gf of tags(tree, 'graphicFrame')) {
      const c = tag(gf, 'chart');
      const path = c && rels[attrNS(c, 'id')];
      if (path && zip.file(path)) {
        const chart = parseChart(xml(await zip.file(path).async('string')));
        if (chart) slide.charts.push(chart);
      }
    }

    if (!slide.title && slide.paras.length) slide.title = slide.paras.shift().text;
    return slide;
  }

  function parseChart(doc) {
    const plot = tag(doc, 'plotArea');
    if (!plot) return null;
    const kindEl = Array.from(plot.children).find(c => /Chart$/.test(c.localName));
    if (!kindEl) return null;
    const kind = /pie|doughnut/i.test(kindEl.localName) ? 'donut' : /line|area|scatter/i.test(kindEl.localName) ? 'line' : 'bar';
    const pts = node => tags(node, 'pt')
      .sort((a, b) => Number(a.getAttribute('idx')) - Number(b.getAttribute('idx')))
      .map(p => tag(p, 'v')?.textContent ?? '');
    const series = tags(kindEl, 'ser').map(ser => ({
      name: clean(tags(child(ser, 'tx'), 'v').map(v => v.textContent).join(' ') || tags(child(ser, 'tx'), 't').map(t => t.textContent).join(' ')),
      cats: pts(child(ser, 'cat')),
      vals: pts(child(ser, 'val') || child(ser, 'yVal')).map(Number)
    })).filter(s => s.vals.length && s.vals.every(Number.isFinite));
    if (!series.length) return null;
    const title = clean(tags(child(tag(doc, 'chart'), 'title'), 't').map(t => t.textContent).join(''));
    return { kind, title, cats: series[0].cats.length ? series[0].cats : series[0].vals.map((_, i) => String(i + 1)), series };
  }

  /* ---------- understanding the deck ---------- */

  const SECTION_WORDS = {
    purpose: /\b(purpose|why|mission|vision|goals?|objectives?|overview|about|introduc\w*|background|context|story)\b|מטר|למה|חזון|ייעוד|רקע|סקירה/i,
    value: /\b(values?|benefits?|employees?|for you|what'?s in it|wiifm|people|culture|growth|career|wellbeing|well-being)\b|ערך|ערכים|תועל|עובד|רווחה/i,
    themes: /\b(themes?|content|topics?|pillars?|community|communities|programs?|initiatives?|focus areas?|series|channels?)\b|נושא|תוכן|קהיל|תכנית|ערוצ/i,
    impact: /\b(impact|engag\w*|results?|metrics?|kpis?|data|success|measur\w*|reach|participation|adoption|survey|numbers)\b|השפעה|מעורבות|תוצא|מדד|נתונ|השתתפות/i,
    next: /\b(next steps?|actions?|managers?|leaders?|asks?|recommend\w*|plan|roadmap|how to|call to action|get involved|timeline|what you can do)\b|צעדים|המלצ|מנהל|תוכנית עבודה|הצעד/i
  };

  const CLOSING = /^\s*(thank(s| you)|questions\??|q\s?&\s?a|תודה|שאלות)/i;

  const NUM_RE = /(?:[$€£₪]\s?)?\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?(?:\/\d+|\s?(?:%|[kKmMbB]\b|x\b|\+))?/g;

  function extractMetrics(deck) {
    const out = [];
    const seen = new Set();
    const consider = (text, slide) => {
      for (const m of text.matchAll(NUM_RE)) {
        const raw = m[0].trim();
        const n = Number(raw.replace(/\/\d+$/, '').replace(/[^\d.]/g, ''));
        const hasUnit = /[%kKmMbBx+$€£₪/]/.test(raw);
        if (!Number.isFinite(n)) continue;
        if (!hasUnit && (n < 10 || (n >= 1900 && n <= 2100 && !raw.includes(',')))) continue; // ordinals, years
        let label = clean(text.replace(m[0], ' ').replace(/^[\s:–—\-•,.]+|[\s:–—\-•,.]+$/g, ''));
        if (label.length < 3) label = slide.title;
        if (label.length > 70) label = label.slice(0, 67).replace(/\s+\S*$/, '') + '…';
        const key = raw + label;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ value: raw, num: n, pct: raw.includes('%'), label, slide: slide.number, score: (hasUnit ? 2 : 0) + (text.length < 90 ? 1 : 0) });
      }
    };
    for (const s of deck.slides) {
      if (s.subtitle) consider(s.subtitle, s);
      for (const p of s.paras) consider(p.text, s);
      for (const t of s.tables) for (const r of t.slice(1)) if (r.length >= 2) consider(`${r.slice(1).join(' ')} ${r[0]}`, s);
    }
    return out.sort((a, b) => b.score - a.score || a.slide - b.slide);
  }

  function classify(deck) {
    const buckets = { purpose: [], value: [], themes: [], impact: [], next: [] };
    // slide 1 is the hero; closing "Thank you / Questions?" slides carry no content
    const content = deck.slides.slice(1).filter(s => !(CLOSING.test(s.title) && s.paras.length <= 2));
    const rest = [];
    for (const s of content) {
      let best = null, bestScore = 0;
      for (const [k, re] of Object.entries(SECTION_WORDS)) {
        const score = (re.test(s.title) ? 3 : 0) + (re.test(s.subtitle) ? 1 : 0) + (s.paras.some(p => re.test(p.text)) ? 0.5 : 0);
        if (score > bestScore) { best = k; bestScore = score; }
      }
      if (best && bestScore >= 1) buckets[best].push(s); else rest.push(s);
    }
    // Every section should say something: borrow unassigned slides in reading order.
    if (!buckets.purpose.length && rest.length) buckets.purpose.push(rest.shift());
    if (!buckets.value.length && rest.length) buckets.value.push(rest.shift());
    buckets.themes.push(...rest);
    if (!buckets.themes.length) {
      // use the richest slides as themes rather than leave the section empty
      const pool = [...buckets.value, ...buckets.purpose].filter(s => s.paras.length >= 3);
      if (pool.length) buckets.themes.push(...pool.slice(0, 1));
    }
    return buckets;
  }

  const textOf = slides => slides.flatMap(s => s.paras.map(p => p.text));
  const isHebrew = deck => {
    const all = deck.slides.flatMap(s => [s.title, ...s.paras.map(p => p.text)]).join(' ');
    const he = (all.match(/[֐-׿]/g) || []).length;
    const lat = (all.match(/[A-Za-z]/g) || []).length;
    return he > lat;
  };

  /* ---------- rendering ---------- */

  const THEMES = {
    aurora:  { name: 'Aurora',  a: '#6d5dfc', b: '#22d3ee', c: '#f472b6', ink: '#0b1020' },
    ocean:   { name: 'Ocean',   a: '#2563eb', b: '#06b6d4', c: '#34d399', ink: '#071426' },
    sunset:  { name: 'Sunset',  a: '#f97316', b: '#ec4899', c: '#facc15', ink: '#1c0f14' },
    emerald: { name: 'Emerald', a: '#10b981', b: '#84cc16', c: '#06b6d4', ink: '#04160f' }
  };

  const ICONS = [
    '<path d="M12 2l3 6 6 .9-4.5 4.3 1 6.3L12 16.8 6.5 19.5l1-6.3L3 8.9 9 8z"/>',
    '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
    '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
    '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20"/>',
    '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'
  ];
  const icon = i => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[i % ICONS.length]}</svg>`;
  const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

  const L = {
    en: {
      kpis: 'At a glance', purpose: 'Our purpose', purposeKicker: 'Why it matters',
      value: 'What’s in it for employees', valueKicker: 'Employee value',
      themes: 'Community content themes', themesKicker: 'What we talk about',
      impact: 'Engagement & impact', impactKicker: 'Results',
      next: 'Next steps for managers', nextKicker: 'Your move',
      gallery: 'From the deck', galleryKicker: 'Visuals',
      illustrative: 'Illustrative', fromDeck: 'From the deck',
      illustrativeNote: 'Metrics marked “Illustrative” are sample values that show how this dashboard will look. Replace them with real data before sharing results.',
      slides: 'Slides', themesCount: 'Content themes', visuals: 'Visuals', actions: 'Manager actions',
      engagement: 'Monthly engagement', participation: 'Participation mix', months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
      mix: ['Active contributors', 'Regular readers', 'Not yet engaged'],
      suggested: ['Share the purpose with your team in your next meeting', 'Invite one person to contribute content this month', 'Recognise engagement publicly', 'Review the impact numbers together every quarter'],
      generated: 'Generated from', explore: 'Explore'
    },
    he: {
      kpis: 'במבט אחד', purpose: 'המטרה שלנו', purposeKicker: 'למה זה חשוב',
      value: 'מה העובדים מרוויחים', valueKicker: 'ערך לעובד',
      themes: 'נושאי התוכן בקהילה', themesKicker: 'על מה מדברים',
      impact: 'מעורבות והשפעה', impactKicker: 'תוצאות',
      next: 'הצעדים הבאים למנהלים', nextKicker: 'מה עושים עכשיו',
      gallery: 'מתוך המצגת', galleryKicker: 'תמונות',
      illustrative: 'להמחשה', fromDeck: 'מתוך המצגת',
      illustrativeNote: 'נתונים שמסומנים “להמחשה” הם ערכים לדוגמה שמראים איך הדשבורד ייראה. יש להחליף אותם בנתונים אמיתיים לפני שיתוף.',
      slides: 'שקפים', themesCount: 'נושאי תוכן', visuals: 'תמונות', actions: 'צעדים למנהלים',
      engagement: 'מעורבות חודשית', participation: 'פילוח השתתפות', months: ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ'],
      mix: ['תורמים פעילים', 'קוראים קבועים', 'טרם הצטרפו'],
      suggested: ['שתפו את המטרה עם הצוות בפגישה הבאה', 'הזמינו עובד אחד לתרום תוכן החודש', 'הוקירו מעורבות בפומבי', 'עברו יחד על נתוני ההשפעה בכל רבעון'],
      generated: 'נוצר מתוך', explore: 'לגלות'
    }
  };

  const badge = (t, illustrative) => `<span class="badge${illustrative ? ' illus' : ''}">${esc(t)}</span>`;
  const head = (kicker, title, extra = '') => `<header class="sec-head reveal"><span class="kicker">${esc(kicker)}</span><h2>${esc(title)}</h2>${extra}</header>`;

  function bulletsHtml(paras, max = 6) {
    const top = paras.filter(p => p.lvl === 0).length ? paras.filter(p => p.lvl <= 1) : paras;
    return top.slice(0, max).map(p => `<li class="${p.lvl ? 'sub' : ''}">${esc(p.text)}</li>`).join('');
  }

  // number + suffix for count-up animation, e.g. "$1,200+" → { pre:'$', n:1200, dec:0, suf:'+' }
  function countParts(value) {
    const m = String(value).match(/^([^\d]*)(\d[\d,]*(?:\.\d+)?)(.*)$/);
    if (!m) return null;
    const n = Number(m[2].replace(/,/g, ''));
    return { pre: m[1], n, dec: (m[2].split('.')[1] || '').length, suf: m[3], sep: m[2].includes(',') };
  }
  const counter = value => {
    const p = countParts(value);
    return p ? `<span class="count" data-n="${p.n}" data-dec="${p.dec}" data-sep="${p.sep ? 1 : 0}" data-pre="${esc(p.pre)}" data-suf="${esc(p.suf)}">${esc(value)}</span>` : esc(value);
  };

  /* --- charts as inline SVG (no libraries) --- */

  const PALETTE = t => [t.a, t.b, t.c, '#a3a3a3', '#fb923c', '#a78bfa'];

  function barChart(cats, series, t) {
    const W = 560, H = 260, padL = 36, padB = 42, padT = 12;
    const max = Math.max(...series.flatMap(s => s.vals), 1);
    const n = cats.length, groupW = (W - padL - 8) / n, bw = Math.min(38, groupW * 0.72 / series.length);
    const col = PALETTE(t);
    let bars = '';
    series.forEach((s, si) => s.vals.forEach((v, i) => {
      const h = (v / max) * (H - padB - padT);
      const x = padL + i * groupW + (groupW - bw * series.length) / 2 + si * bw;
      bars += `<rect class="bar" x="${x.toFixed(1)}" y="${(H - padB - h).toFixed(1)}" width="${(bw - 3).toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${col[si % col.length]}" style="--d:${i * 60}ms"><title>${esc(cats[i])}${s.name ? ` · ${esc(s.name)}` : ''}: ${v}</title></rect>`;
    }));
    const grid = [0, 0.5, 1].map(f => {
      const y = H - padB - f * (H - padB - padT);
      return `<line x1="${padL}" x2="${W}" y1="${y}" y2="${y}" class="gl"/><text x="${padL - 6}" y="${y + 4}" class="ax" text-anchor="end">${fmt(max * f)}</text>`;
    }).join('');
    const labels = cats.map((c, i) => `<text x="${padL + i * groupW + groupW / 2}" y="${H - padB + 18}" class="ax" text-anchor="middle">${esc(trunc(c, 12))}</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${grid}${bars}${labels}</svg>` + legend(series, col);
  }

  function lineChart(cats, series, t) {
    const W = 560, H = 260, padL = 36, padB = 42, padT = 14;
    const max = Math.max(...series.flatMap(s => s.vals), 1);
    const n = cats.length, step = (W - padL - 20) / Math.max(1, n - 1);
    const col = PALETTE(t);
    const xy = (v, i) => [padL + 10 + i * step, H - padB - (v / max) * (H - padB - padT)];
    let paths = '';
    series.forEach((s, si) => {
      const pts = s.vals.map(xy);
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
      const c = col[si % col.length];
      if (si === 0) paths += `<path d="${d}L${pts.at(-1)[0]},${H - padB}L${pts[0][0]},${H - padB}Z" fill="url(#lg${si})" opacity=".35"/>`;
      paths += `<path class="line" d="${d}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/>`;
      paths += pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${c}"><title>${esc(cats[i])}: ${s.vals[i]}</title></circle>`).join('');
    });
    const grid = [0, 0.5, 1].map(f => {
      const y = H - padB - f * (H - padB - padT);
      return `<line x1="${padL}" x2="${W}" y1="${y}" y2="${y}" class="gl"/><text x="${padL - 6}" y="${y + 4}" class="ax" text-anchor="end">${fmt(max * f)}</text>`;
    }).join('');
    const labels = cats.map((c, i) => `<text x="${xy(0, i)[0]}" y="${H - padB + 18}" class="ax" text-anchor="middle">${esc(trunc(c, 10))}</text>`).join('');
    const defs = `<defs><linearGradient id="lg0" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col[0]}"/><stop offset="1" stop-color="${col[0]}" stop-opacity="0"/></linearGradient></defs>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${defs}${grid}${paths}${labels}</svg>` + legend(series, col);
  }

  function donutChart(cats, vals, t) {
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const col = PALETTE(t);
    const R = 70, C = 2 * Math.PI * R;
    let off = 0;
    const arcs = vals.map((v, i) => {
      const len = (v / total) * C;
      const a = `<circle class="arc" r="${R}" cx="100" cy="100" fill="none" stroke="${col[i % col.length]}" stroke-width="26" stroke-dasharray="${len.toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"><title>${esc(cats[i])}: ${vals[i]}</title></circle>`;
      off += len;
      return a;
    }).join('');
    const top = Math.round((vals[0] / total) * 100);
    const leg = `<ul class="legend">${cats.map((c, i) => `<li><i style="background:${col[i % col.length]}"></i>${esc(c)} <b>${Math.round(vals[i] / total * 100)}%</b></li>`).join('')}</ul>`;
    return `<div class="donut-wrap"><svg viewBox="0 0 200 200" class="donut" role="img"><g transform="rotate(-90 100 100)">${arcs}</g><text x="100" y="100" class="donut-n" text-anchor="middle" dominant-baseline="central">${top}%</text></svg>${leg}</div>`;
  }

  function hbars(metrics, t) {
    const max = Math.max(...metrics.map(m => m.pct ? 100 : m.num), 1);
    return `<div class="hbars">${metrics.map((m, i) => `
      <div class="hbar"><div class="hbar-top"><span>${esc(m.label)}</span><b>${esc(m.value)}</b></div>
      <div class="track"><div class="fill" style="--w:${Math.max(4, (m.num / max) * 100).toFixed(1)}%;--d:${i * 90}ms;background:linear-gradient(90deg,${t.a},${t.b})"></div></div></div>`).join('')}</div>`;
  }

  const legend = (series, col) => series.length > 1 || series[0].name
    ? `<ul class="legend">${series.map((s, i) => `<li><i style="background:${col[i % col.length]}"></i>${esc(s.name || `Series ${i + 1}`)}</li>`).join('')}</ul>` : '';
  const fmt = n => n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : `${+n.toFixed(n < 10 ? 1 : 0)}`;
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function renderChart(ch, t) {
    if (ch.kind === 'donut') return donutChart(ch.cats, ch.series[0].vals, t);
    if (ch.kind === 'line') return lineChart(ch.cats, ch.series, t);
    return barChart(ch.cats, ch.series, t);
  }

  /* --- page --- */

  function build(deck, opts = {}) {
    const t = THEMES[opts.theme] || THEMES.aurora;
    const he = isHebrew(deck);
    const tx = L[he ? 'he' : 'en'];
    const b = classify(deck);
    const metrics = extractMetrics(deck);
    const first = deck.slides[0];
    const allImages = deck.slides.flatMap(s => s.images.map(im => ({ ...im, slide: s })));
    const heroImg = [...allImages].sort((x, y) => y.area - x.area)[0];
    const charts = deck.slides.flatMap(s => s.charts.map(c => ({ ...c, slide: s })));

    const title = opts.title?.trim() || first.title || deck.docTitle || deck.fileName.replace(/\.pptx$/i, '');
    const subtitle = first.subtitle || first.paras[0]?.text || textOf(b.purpose)[0] || '';
    const nextSlides = b.next.length ? b.next : [];
    const nextItems = textOf(nextSlides).filter(x => x.length > 3);
    const nextIllustrative = !nextItems.length;
    const steps = (nextItems.length ? nextItems : tx.suggested).slice(0, 6);

    // KPI cards: real numbers from the deck first, then counts derived from the deck itself.
    const kpis = metrics.slice(0, 4).map(m => ({ value: m.value, label: m.label, tag: tx.fromDeck, illus: false }));
    const derived = [
      [deck.slides.length, tx.slides],
      [b.themes.length, tx.themesCount],
      [nextIllustrative ? 0 : steps.length, tx.actions],
      [allImages.length + charts.length, tx.visuals]
    ].filter(([n]) => n > 0);
    while (kpis.length < 4 && derived.length) {
      const [n, label] = derived.shift();
      kpis.push({ value: String(n), label, tag: tx.fromDeck, illus: false });
    }

    // Engagement & impact: native charts > numbers in the text > clearly-marked illustrative data
    let impactBody = '', impactIllus = false;
    const impactText = textOf(b.impact);
    if (charts.length) {
      impactBody = `<div class="viz-grid">${charts.slice(0, 4).map(ch => `
        <figure class="card viz reveal"><figcaption><h3>${esc(ch.title || ch.slide.title)}</h3>${badge(tx.fromDeck)}</figcaption>${renderChart(ch, t)}</figure>`).join('')}</div>`;
    } else if (metrics.length >= 2) {
      const pool = metrics.slice(0, 6);
      impactBody = `<div class="viz-grid"><figure class="card viz reveal wide-viz"><figcaption><h3>${esc(b.impact[0]?.title || tx.impact)}</h3>${badge(tx.fromDeck)}</figcaption>${hbars(pool, t)}</figure></div>`;
    } else {
      impactIllus = true;
      impactBody = `<div class="viz-grid">
        <figure class="card viz reveal"><figcaption><h3>${esc(tx.engagement)}</h3>${badge(tx.illustrative, true)}</figcaption>${lineChart(tx.months, [{ name: '', vals: [38, 45, 52, 58, 66, 74] }], t)}</figure>
        <figure class="card viz reveal"><figcaption><h3>${esc(tx.participation)}</h3>${badge(tx.illustrative, true)}</figcaption>${donutChart(tx.mix, [42, 35, 23], t)}</figure>
      </div>`;
    }
    if (impactText.length) impactBody += `<ul class="impact-notes reveal">${impactText.slice(0, 6).map(x => `<li>${CHECK}<span>${esc(x)}</span></li>`).join('')}</ul>`;
    for (const s of b.impact) for (const tb of s.tables) impactBody += tableHtml(tb);

    // Purpose
    const purposeTexts = b.purpose.flatMap(s => s.paras);
    const statement = (b.purpose[0]?.subtitle) || purposeTexts[0]?.text || subtitle;
    const purposeImg = b.purpose.flatMap(s => s.images)[0];
    const purposeHtml = `
      <section class="sec" id="purpose">${head(tx.purposeKicker, b.purpose[0]?.title || tx.purpose)}
        <div class="purpose ${purposeImg ? 'has-img' : ''}">
          <div class="card purpose-main reveal">
            <blockquote>${esc(statement)}</blockquote>
            <ul class="ticks">${purposeTexts.filter(p => p.text !== statement && p.lvl <= 1).slice(0, 5).map(p => `<li>${CHECK}<span>${esc(p.text)}</span></li>`).join('')}</ul>
          </div>
          ${purposeImg ? `<figure class="purpose-img reveal"><img src="${purposeImg.src}" alt=""></figure>` : ''}
        </div>
        ${b.purpose.slice(1).map(s => slideCard(s, 0)).join('')}
      </section>`;

    // Employee value
    const valueItems = b.value.flatMap(s => s.paras.filter(p => p.lvl === 0).map(p => p.text));
    const valueSubs = b.value.flatMap(s => s.paras.filter(p => p.lvl > 0).map(p => p.text));
    const valueHtml = valueItems.length || b.value.length ? `
      <section class="sec" id="value">${head(tx.valueKicker, b.value[0]?.title || tx.value)}
        <div class="value-grid">${(valueItems.length ? valueItems : b.value.map(s => s.title)).slice(0, 8).map((v, i) => {
          const [h, ...rest] = v.split(/\s[–—:-]\s|:\s/);
          return `<article class="card value reveal" style="--d:${i * 70}ms"><div class="ico">${icon(i + 1)}</div><h3>${esc(rest.length ? h : v)}</h3>${rest.length ? `<p>${esc(rest.join(' – '))}</p>` : (valueSubs[i] ? `<p>${esc(valueSubs[i])}</p>` : '')}</article>`;
        }).join('')}</div>
        ${b.value.flatMap(s => s.tables).map(tableHtml).join('')}
      </section>` : '';

    // Community themes
    const themesHtml = b.themes.length ? `
      <section class="sec" id="themes">${head(tx.themesKicker, tx.themes)}
        <div class="theme-grid">${b.themes.map((s, i) => slideCard(s, i)).join('')}</div>
      </section>` : '';

    // Next steps
    const nextHtml = `
      <section class="sec" id="next">${head(tx.nextKicker, nextSlides[0]?.title || tx.next, nextIllustrative ? badge(tx.illustrative, true) : '')}
        <ol class="steps">${steps.map((s, i) => `<li class="step reveal" style="--d:${i * 80}ms"><span class="step-n">${String(i + 1).padStart(2, '0')}</span><p>${esc(s)}</p></li>`).join('')}</ol>
      </section>`;

    // Gallery of the remaining visuals
    const used = new Set([heroImg?.src, purposeImg?.src, ...b.themes.map(s => s.images[0]?.src)]);
    const gallery = allImages.filter(im => !used.has(im.src));
    const galleryHtml = gallery.length ? `
      <section class="sec" id="gallery">${head(tx.galleryKicker, tx.gallery)}
        <div class="gallery">${gallery.map(im => `<figure class="reveal"><img src="${im.src}" alt="" loading="lazy"><figcaption>${esc(im.slide.title)}</figcaption></figure>`).join('')}</div>
      </section>` : '';

    const anyIllus = impactIllus || nextIllustrative;
    const nav = [['purpose', tx.purpose], ['value', valueHtml && tx.valueKicker], ['themes', themesHtml && tx.themesKicker], ['impact', tx.impactKicker], ['next', tx.nextKicker]]
      .filter(x => x[1]).map(([id, l]) => `<a href="#${id}">${esc(l)}</a>`).join('');

    const body = `
<header class="hero">
  <div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div><div class="grain"></div>
  <nav class="topnav"><span class="dot"></span>${nav}</nav>
  <div class="hero-in ${heroImg ? 'has-img' : ''}">
    <div class="hero-copy">
      <span class="eyebrow">${esc(deck.docTitle && deck.docTitle !== title ? deck.docTitle : `${deck.slides.length} ${tx.slides.toLowerCase()} · ${tx.fromDeck}`)}</span>
      <h1>${esc(title)}</h1>
      ${subtitle ? `<p class="lead">${esc(subtitle)}</p>` : ''}
      <a class="cta" href="#kpis">${esc(tx.explore)} <span aria-hidden="true">↓</span></a>
    </div>
    ${heroImg ? `<figure class="hero-img"><img src="${heroImg.src}" alt=""></figure>` : ''}
  </div>
</header>
<main>
  <section class="kpis" id="kpis" aria-label="${esc(tx.kpis)}">
    ${kpis.map((k, i) => `<article class="kpi reveal" style="--d:${i * 80}ms"><div class="kpi-top"><div class="ico">${icon(i)}</div>${badge(k.tag, k.illus)}</div><div class="kpi-v">${counter(k.value)}</div><p>${esc(k.label)}</p></article>`).join('')}
  </section>
  ${purposeHtml}
  ${valueHtml}
  ${themesHtml}
  <section class="sec" id="impact">${head(tx.impactKicker, b.impact[0]?.title || tx.impact)}${impactBody}</section>
  ${nextHtml}
  ${galleryHtml}
  ${anyIllus ? `<p class="illus-note reveal">${badge(tx.illustrative, true)} ${esc(tx.illustrativeNote)}</p>` : ''}
</main>
<footer class="foot">${esc(tx.generated)} <b>${esc(deck.fileName)}</b> · ${new Date().toLocaleDateString(he ? 'he-IL' : undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</footer>`;

    return `<!doctype html>
<html lang="${he ? 'he' : 'en'}" dir="${he ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${css(t, he)}</style>
</head>
<body>${body}
<script>${RUNTIME}</script>
</body>
</html>`;
  }

  function slideCard(s, i) {
    const img = s.images[0];
    return `<article class="card theme reveal" style="--d:${(i % 6) * 70}ms">
      ${img ? `<div class="theme-img"><img src="${img.src}" alt="" loading="lazy"></div>` : `<div class="theme-band"><div class="ico">${icon(i + 2)}</div></div>`}
      <div class="theme-body">
        <h3>${esc(s.title)}</h3>
        ${s.subtitle ? `<p class="theme-sub">${esc(s.subtitle)}</p>` : ''}
        ${s.paras.length ? `<ul>${bulletsHtml(s.paras, 5)}</ul>` : ''}
        ${s.tables.map(tableHtml).join('')}
      </div>
    </article>`;
  }

  function tableHtml(rows) {
    const [h, ...r] = rows;
    return `<div class="tbl reveal"><table><thead><tr>${h.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${r.map(row => `<tr>${row.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  /* ---------- output styles & runtime ---------- */

  function css(t, rtl) {
    return `
:root{--a:${t.a};--b:${t.b};--c:${t.c};--ink:${t.ink};
  --bg:#f6f7fb;--surface:#fff;--text:#0f1222;--text-2:#4a4f66;--muted:#7a7f96;--line:rgba(15,18,34,.09);
  --shadow:0 1px 2px rgba(15,18,34,.04),0 12px 32px -12px rgba(15,18,34,.16);--r:20px;
  --font:"Segoe UI Variable","Segoe UI",system-ui,-apple-system,Roboto,${rtl ? '"Heebo","Arial Hebrew",' : ''}sans-serif;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0a0c14;--surface:#141826;--text:#f2f3f8;--text-2:#b6bad0;--muted:#8a8fa8;--line:rgba(255,255,255,.08);--shadow:0 1px 2px rgba(0,0,0,.4),0 16px 40px -16px rgba(0,0,0,.7);color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0a0c14;--surface:#141826;--text:#f2f3f8;--text-2:#b6bad0;--muted:#8a8fa8;--line:rgba(255,255,255,.08);color-scheme:dark}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 var(--font);-webkit-font-smoothing:antialiased}
img{max-width:100%;display:block}
.hero{position:relative;overflow:hidden;background:var(--ink);color:#fff;padding:22px clamp(16px,5vw,64px) clamp(110px,14vw,170px);isolation:isolate}
.blob{position:absolute;border-radius:50%;filter:blur(70px);opacity:.75;z-index:-1;animation:float 16s ease-in-out infinite alternate}
.b1{width:46vw;height:46vw;background:var(--a);top:-18vw;${rtl ? 'right' : 'left'}:-10vw}
.b2{width:38vw;height:38vw;background:var(--b);bottom:-22vw;${rtl ? 'left' : 'right'}:-6vw;animation-delay:-5s}
.b3{width:24vw;height:24vw;background:var(--c);top:20%;left:42%;opacity:.45;animation-delay:-9s}
@keyframes float{to{transform:translate(4vw,3vw) scale(1.12)}}
.grain{position:absolute;inset:0;z-index:-1;opacity:.12;background-image:radial-gradient(rgba(255,255,255,.6) 1px,transparent 1px);background-size:3px 3px;mask-image:linear-gradient(#000,transparent)}
.topnav{display:flex;flex-wrap:wrap;gap:4px 18px;align-items:center;font-size:14px;max-width:1180px;margin:0 auto}
.topnav a{color:rgba(255,255,255,.78);text-decoration:none;padding:4px 0}.topnav a:hover{color:#fff}
.topnav .dot{width:12px;height:12px;border-radius:4px;background:linear-gradient(135deg,var(--a),var(--b));margin-inline-end:8px}
.hero-in{max-width:1180px;margin:clamp(40px,7vw,90px) auto 0;display:grid;gap:48px;align-items:center}
.hero-in.has-img{grid-template-columns:1.15fr .85fr}
.eyebrow{display:inline-block;font-size:12.5px;letter-spacing:.14em;text-transform:uppercase;padding:6px 12px;border-radius:99px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(8px)}
h1{font-size:clamp(36px,6.2vw,74px);line-height:1.02;letter-spacing:-.035em;margin:22px 0 18px;font-weight:800;
  background:linear-gradient(100deg,#fff 30%,color-mix(in srgb,var(--b) 60%,#fff));-webkit-background-clip:text;background-clip:text;color:transparent}
.lead{font-size:clamp(17px,1.8vw,21px);color:rgba(255,255,255,.82);max-width:46ch;margin:0}
.cta{display:inline-flex;gap:8px;margin-top:30px;padding:12px 22px;border-radius:99px;color:var(--ink);background:#fff;font-weight:700;text-decoration:none;box-shadow:0 10px 30px -10px var(--b);transition:transform .2s}
.cta:hover{transform:translateY(-2px)}
.hero-img{margin:0;border-radius:28px;overflow:hidden;transform:rotate(${rtl ? '' : '-'}2deg);box-shadow:0 30px 80px -20px rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.18)}
.hero-img img{width:100%;aspect-ratio:4/3;object-fit:cover}
main{max-width:1180px;margin:0 auto;padding:0 clamp(16px,4vw,40px) 40px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px;margin-top:clamp(-120px,-10vw,-80px);position:relative}
.kpi{background:color-mix(in srgb,var(--surface) 86%,transparent);backdrop-filter:blur(18px);border:1px solid var(--line);border-radius:var(--r);padding:20px 22px;box-shadow:var(--shadow);position:relative;overflow:hidden}
.kpi::after{content:"";position:absolute;inset:auto 0 0;height:4px;background:linear-gradient(90deg,var(--a),var(--b))}
.kpi-top{display:flex;justify-content:space-between;align-items:center}
.kpi-v{font-size:clamp(32px,3.6vw,44px);font-weight:800;letter-spacing:-.03em;margin:12px 0 2px;font-variant-numeric:tabular-nums}
.kpi p{margin:0;color:var(--text-2);font-size:14px;line-height:1.4}
.ico{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(135deg,color-mix(in srgb,var(--a) 18%,transparent),color-mix(in srgb,var(--b) 18%,transparent));color:var(--a)}
.ico svg,.ticks svg,.impact-notes svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.badge{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:4px 9px;border-radius:99px;background:color-mix(in srgb,var(--a) 12%,transparent);color:var(--a);white-space:nowrap}
.badge.illus{background:repeating-linear-gradient(-45deg,rgba(245,158,11,.16) 0 6px,rgba(245,158,11,.08) 6px 12px);color:#b45309;border:1px dashed #f59e0b}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .badge.illus{color:#fbbf24}}
.sec{margin-top:clamp(64px,9vw,110px);scroll-margin-top:20px}
.sec-head{margin-bottom:26px;display:flex;flex-wrap:wrap;align-items:end;gap:8px 16px}
.sec-head .kicker{flex-basis:100%;font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;background:linear-gradient(90deg,var(--a),var(--b));-webkit-background-clip:text;background-clip:text;color:transparent}
.sec-head h2{margin:0;font-size:clamp(26px,3.4vw,40px);letter-spacing:-.025em;line-height:1.1}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow)}
.purpose{display:grid;gap:22px}.purpose.has-img{grid-template-columns:1.3fr 1fr}
.purpose-main{padding:clamp(24px,4vw,44px);position:relative;overflow:hidden}
.purpose-main::before{content:"";position:absolute;inset:0 auto 0 0;width:6px;background:linear-gradient(var(--a),var(--b))}
[dir=rtl] .purpose-main::before{inset:0 0 0 auto}
blockquote{margin:0 0 22px;font-size:clamp(21px,2.4vw,28px);line-height:1.35;font-weight:650;letter-spacing:-.015em}
.ticks,.impact-notes{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.ticks li,.impact-notes li{display:flex;gap:12px;align-items:flex-start;color:var(--text-2)}
.ticks svg,.impact-notes svg{flex:none;margin-top:3px;color:var(--b);background:color-mix(in srgb,var(--b) 14%,transparent);border-radius:7px;padding:3px;width:22px;height:22px}
.purpose-img{margin:0;border-radius:var(--r);overflow:hidden;box-shadow:var(--shadow)}.purpose-img img{width:100%;height:100%;object-fit:cover;min-height:260px}
.value-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:18px}
.value{padding:24px;transition:transform .25s,box-shadow .25s}.value:hover{transform:translateY(-4px)}
.value h3{font-size:18px;margin:16px 0 6px;letter-spacing:-.01em;line-height:1.3}.value p{margin:0;color:var(--text-2);font-size:15px}
.theme-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px}
.theme{overflow:hidden;display:flex;flex-direction:column;transition:transform .25s}.theme:hover{transform:translateY(-4px)}
.theme-img{aspect-ratio:16/9;overflow:hidden;background:var(--line)}.theme-img img{width:100%;height:100%;object-fit:cover;transition:transform .6s}.theme:hover .theme-img img{transform:scale(1.05)}
.theme-band{height:92px;background:linear-gradient(120deg,var(--a),var(--b));display:flex;align-items:flex-end;padding:0 22px;position:relative}
.theme-band .ico{background:var(--surface);color:var(--a);transform:translateY(50%);box-shadow:var(--shadow)}
.theme-body{padding:30px 22px 22px}.theme-img+.theme-body{padding-top:20px}
.theme h3{margin:0 0 6px;font-size:19px;letter-spacing:-.01em;line-height:1.3}
.theme-sub{margin:0 0 8px;color:var(--muted);font-size:14px}
.theme ul{margin:8px 0 0;padding-inline-start:18px;color:var(--text-2);font-size:15px}.theme li{margin:4px 0}.theme li::marker{color:var(--b)}.theme li.sub{margin-inline-start:16px;font-size:14px}
.viz-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));gap:20px}
.viz{margin:0;padding:22px}.viz figcaption{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px}.viz h3{margin:0;font-size:17px}
.wide-viz{grid-column:1/-1}
.chart{width:100%;height:auto;max-height:320px;overflow:visible}.gl{stroke:var(--line)}.ax{fill:var(--muted);font-size:11px}
.bar{transform-box:fill-box;transform-origin:bottom;transform:scaleY(0);transition:transform .9s cubic-bezier(.2,.8,.2,1) var(--d)}.in .bar{transform:none}
.line{stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset 1.6s ease}.in .line{stroke-dashoffset:0}
.donut-wrap{display:flex;gap:22px;align-items:center;flex-wrap:wrap}.donut{width:190px;flex:none}
.arc{transition:stroke-dasharray 1.2s}.donut-n{font-size:30px;font-weight:800;fill:var(--text)}
.legend{list-style:none;padding:0;margin:10px 0 0;display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13.5px;color:var(--text-2)}
.donut-wrap .legend{flex-direction:column}.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-inline-end:7px}
.hbars{display:grid;gap:18px}.hbar-top{display:flex;justify-content:space-between;gap:16px;font-size:14.5px;color:var(--text-2);margin-bottom:7px}.hbar-top b{color:var(--text);font-size:16px}
.track{height:12px;border-radius:99px;background:color-mix(in srgb,var(--a) 10%,transparent);overflow:hidden}
.fill{height:100%;width:0;border-radius:99px;transition:width 1.2s cubic-bezier(.2,.8,.2,1) var(--d)}.in .fill{width:var(--w)}
.impact-notes{margin-top:24px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px;counter-reset:s}
.step{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:22px;box-shadow:var(--shadow);position:relative;overflow:hidden}
.step::before{content:"";position:absolute;inset:0;background:linear-gradient(135deg,color-mix(in srgb,var(--a) 8%,transparent),transparent 60%)}
.step-n{position:relative;font-size:34px;font-weight:800;letter-spacing:-.04em;background:linear-gradient(135deg,var(--a),var(--b));-webkit-background-clip:text;background-clip:text;color:transparent}
.step p{position:relative;margin:6px 0 0;font-weight:550}
.gallery{columns:3 260px;column-gap:18px}.gallery figure{margin:0 0 18px;break-inside:avoid;border-radius:16px;overflow:hidden;background:var(--surface);border:1px solid var(--line)}
.gallery figcaption{font-size:13px;color:var(--muted);padding:10px 14px}
.tbl{overflow-x:auto;margin-top:16px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:10px 14px;text-align:start;border-bottom:1px solid var(--line)}th{background:color-mix(in srgb,var(--a) 8%,transparent);font-weight:700}tr:last-child td{border-bottom:0}
.illus-note{margin-top:48px;padding:16px 18px;border-radius:14px;border:1px dashed #f59e0b;background:rgba(245,158,11,.06);color:var(--text-2);font-size:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.foot{text-align:center;color:var(--muted);font-size:13px;padding:30px 16px 46px}
.reveal{opacity:0;transform:translateY(22px);transition:opacity .7s ease var(--d,0ms),transform .7s cubic-bezier(.2,.8,.2,1) var(--d,0ms)}.reveal.in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.reveal{opacity:1;transform:none}.bar{transform:none}.line{stroke-dashoffset:0}.fill{width:var(--w)}}
@media (max-width:900px){.hero-in.has-img,.purpose.has-img{grid-template-columns:1fr}.hero-img{transform:none}}
@media (max-width:520px){.kpis{grid-template-columns:1fr 1fr;gap:12px}.kpi{padding:16px}.kpi-v{font-size:28px}.kpi .badge{display:none}.theme-grid{grid-template-columns:1fr}}
@media print{.blob,.grain,.cta,.topnav{display:none}.reveal{opacity:1;transform:none}.bar{transform:none}.line{stroke-dashoffset:0}.fill{width:var(--w)}.hero{padding-bottom:60px}.kpis{margin-top:20px}.card,.step,.kpi{break-inside:avoid}}`;
  }

  // Small runtime shipped inside the generated file: scroll reveal + KPI count-up.
  const RUNTIME = `(()=>{const io='IntersectionObserver'in window?new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;const t=e.target;t.classList.add('in');io.unobserve(t);t.querySelectorAll('.count').forEach(run)}),{threshold:.15}):null;
const run=el=>{if(el.dataset.done)return;el.dataset.done=1;const n=+el.dataset.n,dec=+el.dataset.dec,sep=el.dataset.sep==='1',t0=performance.now(),D=1400;
const f=v=>el.dataset.pre+(sep?v.toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec}):v.toFixed(dec))+el.dataset.suf;
const step=now=>{const p=Math.min(1,(now-t0)/D),e=1-Math.pow(1-p,3);el.textContent=f(n*e);if(p<1)requestAnimationFrame(step)};requestAnimationFrame(step)};
document.querySelectorAll('.reveal,.viz,.kpi').forEach(el=>io?io.observe(el):el.classList.add('in'));if(!io)document.querySelectorAll('.count').forEach(run);
window.addEventListener('beforeprint',()=>document.querySelectorAll('.reveal,.viz').forEach(el=>el.classList.add('in')));})();`;

  window.PptDashboard = { parse, build, THEMES };
})();
