/*! Analysis-Tracker - Copyright (c) 2026 Sanskar Nanda - MIT License (see LICENSE). https://github.com/Sanskar-hep */
/* Meeting Slides engine: themes, slide layouts, the layout composer and the exporters.
 *
 * A presentation ("deck") is plain data: {title, meetingType, theme, style, slides:[{layout, title, lead, head, head2, body, body2, images:[{src, caption}]}]}.
 * compose(slide, deck) turns one slide into drawing primitives (rectangles, text boxes, pictures) in inches on a 13.333 x 7.5 slide.
 * The editor draws those primitives as HTML and toPptx() writes the same primitives as a real PowerPoint file, so what you see is
 * what you export: real text boxes, real bullets and real pictures, nothing flattened into an image.
 * Nothing here invents content: text comes from the user or from records already stored in the tracker. */
window.DECK = (() => {
  'use strict';
  const SW = 13.333, SH = 7.5;
  const uid = () => Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-5);

  /* ============================ themes ============================ */
  const THEMES = {
    cms:        {name: 'CMS-Inspired', note: 'Restrained institutional blue on white', bg: '#FFFFFF', fg: '#1F2937', muted: '#64748B', accent: '#1E4E8C', panel: '#EEF2F7', titleFg: '#173A66', frame: '#CBD5E1', head: 'band', font: 'Calibri'},
    minimal:    {name: 'Minimal Scientific', note: 'White, quiet, maximum room for plots', bg: '#FFFFFF', fg: '#111827', muted: '#6B7280', accent: '#374151', panel: '#F3F4F6', titleFg: '#111827', frame: '#D1D5DB', head: 'rule', font: 'Calibri'},
    dark:       {name: 'Dark Scientific', note: 'Dark background; plots sit on white cards', bg: '#0F172A', fg: '#E2E8F0', muted: '#94A3B8', accent: '#60A5FA', panel: '#1E293B', titleFg: '#FFFFFF', frame: '#334155', head: 'rule', font: 'Calibri', plotCard: '#FFFFFF'},
    conference: {name: 'Conference Style', note: 'Bold title bar for talks and formal sessions', bg: '#FFFFFF', fg: '#1F2937', muted: '#6B7280', accent: '#0F766E', panel: '#ECFDF5', titleFg: '#0B3B37', frame: '#BFD8D4', head: 'side', font: 'Calibri'},
  };
  const FONTS = ['Calibri', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Verdana'];
  const themeOf = deck => {
    const st = deck.style || {}, t = {...THEMES[deck.theme] || THEMES.cms};
    if (st.accent) { t.accent = st.accent; t.titleFg = deck.theme === 'dark' ? t.titleFg : st.accent; }
    if (st.bg) { t.bg = st.bg; const dk = lum(st.bg) < .4; t.fg = dk ? '#E2E8F0' : '#1F2937'; t.muted = dk ? '#94A3B8' : '#64748B'; t.panel = dk ? '#1E293B' : '#F1F5F9'; t.titleFg = st.accent && !dk ? st.accent : (dk ? '#FFFFFF' : t.titleFg); if (dk) t.plotCard = '#FFFFFF'; else delete t.plotCard; }
    if (st.font) t.font = st.font;
    t.scale = Math.min(1.5, Math.max(.7, +st.scale || 1)); t.gap = Math.min(.5, Math.max(.08, st.gap == null ? .2 : +st.gap));
    return t;
  };
  function lum(hex) { const n = parseInt(String(hex).replace('#', ''), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255; return (.299 * r + .587 * g + .114 * b) / 255; }

  /* ============================ layouts ============================ */
  /* Each layout says which slide fields it uses and where the picture slots are. Slots are {x, y, w, h} inside the content area. */
  const C = {x: .5, y: 1.4, w: 12.333, h: 5.5};
  const cols = (n, g, y = C.y, h = C.h) => { const w = (C.w - g * (n - 1)) / n; return Array.from({length: n}, (_, i) => ({x: C.x + i * (w + g), y, w, h})); };
  const grid22 = (x, w, g) => { const cw = (w - g) / 2, ch = (C.h - g) / 2; return [0, 1, 2, 3].map(i => ({x: x + (i % 2) * (cw + g), y: C.y + (i >> 1) * (ch + g), w: cw, h: ch})); };
  const LAYOUTS = [
    /* ---- text + plots ---- */
    {id: 'tp-left', type: 'tp', name: 'Plot left, text right', desc: 'One large plot with explanatory bullets', n: 1, fields: ['body'], slots: g => [{x: C.x, y: C.y, w: 7.9, h: C.h}], body: g => ({x: C.x + 7.9 + g, y: C.y, w: C.w - 7.9 - g, h: C.h})},
    {id: 'tp-right', type: 'tp', name: 'Text left, plot right', desc: 'Bullets first, plot on the right', n: 1, fields: ['body'], slots: g => [{x: C.x + C.w - 7.9, y: C.y, w: 7.9, h: C.h}], body: g => ({x: C.x, y: C.y, w: C.w - 7.9 - g, h: C.h})},
    {id: 'tp-two', type: 'tp', name: 'Two plots, shared text below', desc: 'Two plots side by side with one interpretation', n: 2, fields: ['body'], slots: g => cols(2, g, C.y, 3.6), body: g => ({x: C.x, y: C.y + 3.6 + g, w: C.w, h: C.h - 3.6 - g})},
    {id: 'tp-cmp', type: 'tp', name: 'Plot, comparison and conclusion', desc: 'Main plot, a comparison figure and a short conclusion', n: 2, fields: ['body'], slots: g => [{x: C.x, y: C.y, w: 7.7, h: C.h}, {x: C.x + 7.7 + g, y: C.y, w: C.w - 7.7 - g, h: 2.75}], body: g => ({x: C.x + 7.7 + g, y: C.y + 2.75 + g, w: C.w - 7.7 - g, h: C.h - 2.75 - g})},
    {id: 'tp-quad', type: 'tp', name: 'Four plots with text', desc: 'Multi-panel figure with a short text column', n: 4, fields: ['body'], slots: g => grid22(C.x, 8.4, g), body: g => ({x: C.x + 8.4 + g, y: C.y, w: C.w - 8.4 - g, h: C.h})},
    {id: 'tp-key', type: 'tp', name: 'Key finding, figure, next steps', desc: 'A one-line finding on top, figure and next steps below', n: 1, fields: ['lead', 'body'], lead: g => ({x: C.x, y: C.y, w: C.w, h: 1}), slots: g => [{x: C.x, y: C.y + 1 + g, w: 7.6, h: C.h - 1 - g}], body: g => ({x: C.x + 7.6 + g, y: C.y + 1 + g, w: C.w - 7.6 - g, h: C.h - 1 - g})},
    /* ---- plots only ---- */
    {id: 'p-1', type: 'p', name: 'One large plot', desc: 'A single plot using almost the whole slide', n: 1, fields: [], slots: g => [{...C}]},
    {id: 'p-2', type: 'p', name: 'Two plots side by side', desc: 'Two equal plots', n: 2, fields: [], slots: g => cols(2, g)},
    {id: 'p-3', type: 'p', name: 'Three plots in a row', desc: 'Three equal plots, for panels of a similar kind', n: 3, fields: [], slots: g => cols(3, g, C.y + .6, 4.3)},
    {id: 'p-4', type: 'p', name: 'Four plots in a grid', desc: '2 × 2 grid', n: 4, fields: [], slots: g => grid22(C.x, C.w, g)},
    {id: 'p-main2', type: 'p', name: 'Main plot and two supporting', desc: 'One main plot, two smaller ones stacked beside it', n: 3, fields: [], slots: g => [{x: C.x, y: C.y, w: 7.6, h: C.h}, {x: C.x + 7.6 + g, y: C.y, w: C.w - 7.6 - g, h: (C.h - g) / 2}, {x: C.x + 7.6 + g, y: C.y + (C.h - g) / 2 + g, w: C.w - 7.6 - g, h: (C.h - g) / 2}]},
    {id: 'p-cmp', type: 'p', name: 'Nominal vs variation', desc: 'Two plots with labels for a nominal and a varied case', n: 2, fields: [], capStyle: 'chip', slots: g => cols(2, g + .2)},
    {id: 'p-eras', type: 'p', name: 'Panels by era or region', desc: 'Four labelled panels, for data-taking eras or control regions', n: 4, fields: [], capStyle: 'chip', slots: g => grid22(C.x, C.w, g)},
    /* ---- text only ---- */
    {id: 't-title', type: 't', name: 'Title slide', desc: 'Presentation title, subtitle, presenter and date', n: 0, fields: ['lead'], special: 'title'},
    {id: 't-agenda', type: 't', name: 'Agenda', desc: 'Numbered list of what the talk covers', n: 0, fields: ['body'], numbered: true, body: g => ({x: C.x + .3, y: C.y + .1, w: 9.5, h: C.h - .1})},
    {id: 't-bullets', type: 't', name: 'Title and bullets', desc: 'Objectives, methodology or progress updates', n: 0, fields: ['body'], body: g => ({x: C.x, y: C.y, w: C.w, h: C.h}), bar: true},
    {id: 't-two', type: 't', name: 'Two columns', desc: 'For example findings and open points side by side', n: 0, fields: ['head', 'body', 'head2', 'body2'], twoCol: true},
    {id: 't-key', type: 't', name: 'Key findings', desc: 'One highlighted statement with supporting points', n: 0, fields: ['lead', 'body'], lead: g => ({x: C.x, y: C.y, w: C.w, h: 1.5}), body: g => ({x: C.x, y: C.y + 1.5 + g + .1, w: C.w, h: C.h - 1.5 - g - .1})},
    {id: 't-decision', type: 't', name: 'Decision required', desc: 'The question to be decided and the options or evidence', n: 0, fields: ['lead', 'body'], tag: 'DECISION REQUIRED', lead: g => ({x: C.x, y: C.y + .45, w: C.w, h: 1.4}), body: g => ({x: C.x, y: C.y + .45 + 1.4 + g + .1, w: C.w, h: C.h - .45 - 1.4 - g - .1})},
    {id: 't-actions', type: 't', name: 'Next steps and action items', desc: 'Checklist of what happens next', n: 0, fields: ['body'], check: true, body: g => ({x: C.x, y: C.y, w: C.w, h: C.h})},
    {id: 't-closing', type: 't', name: 'Conclusions', desc: 'Summary slide, also usable for backup notes', n: 0, fields: ['lead', 'body'], tag: 'CONCLUSIONS', lead: g => ({x: C.x, y: C.y + .45, w: C.w, h: 1.1}), body: g => ({x: C.x, y: C.y + .45 + 1.1 + g + .1, w: C.w, h: C.h - .45 - 1.1 - g - .1})},
  ];
  const LAYOUT = Object.fromEntries(LAYOUTS.map(l => [l.id, l]));
  const TYPES = {tp: 'Text + Plots', p: 'Plots only', t: 'Text only'};
  const FIELD_LABEL = {lead: 'Key line', head: 'Left heading', head2: 'Right heading', body: 'Text', body2: 'Right text'};

  function recommend(nImg, hasText) {
    if (!nImg) return 't-bullets';
    if (nImg === 1) return hasText ? 'tp-left' : 'p-1';
    if (nImg === 2) return hasText ? 'tp-two' : 'p-2';
    if (nImg === 3) return 'p-3';
    return hasText ? 'tp-quad' : 'p-4';
  }

  /* ============================ text fitting ============================ */
  const lines = t => String(t || '').split('\n').map(s => s.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '').trim()).filter(Boolean);
  function fitSize(ls, w, h, base, min, bulletPad) {              // largest font size at which the text fits in the box (estimate)
    for (let sz = base; sz >= min; sz -= 1) {
      const cpl = Math.max(6, Math.floor((w - .22 - bulletPad) * 72 / (sz * .5)));
      const n = ls.reduce((a, l) => a + Math.max(1, Math.ceil(l.length / cpl)), 0);
      if ((n * sz * 1.2 + Math.max(0, ls.length - 1) * sz * .45) / 72 + .12 <= h) return {sz, ok: true};
    }
    return {sz: min, ok: false};
  }

  /* ============================ composer ============================ */
  const norm = s => ({...s, images: s.images || []});
  function compose(slide, deck, ctx = {}) {
    slide = norm(slide); const L = LAYOUT[slide.layout] || LAYOUT['t-bullets'], th = themeOf(deck), g = th.gap, sc = th.scale, els = [], warn = [];
    const font = th.font, num = ctx.number || 1, sample = !!ctx.sample;
    const rect = (x, y, w, h, fill, line) => els.push({k: 'rect', x, y, w, h, fill, line});
    const T = (key, r, paras, o = {}) => els.push({k: 'text', key, x: r.x, y: r.y, w: r.w, h: r.h, paras, fill: o.fill, anchor: o.anchor || 't', pad: o.pad == null ? .08 : o.pad, ph: o.ph, line: o.line, edit: o.edit !== false});
    const run = (t, o = {}) => ({t, sz: o.sz, b: !!o.b, i: !!o.i, color: o.color || th.fg, font});
    const para = (runs, o = {}) => ({runs: [].concat(runs), bullet: o.bullet || null, algn: o.algn || 'l', before: o.before || 0, num: !!o.num});
    const bullets = (key, text, r, o = {}) => {
      const ls = lines(text), base = (o.base || 17) * sc, f = fitSize(ls, r.w, r.h - .1, base, 10, .32);
      if (!f.ok && ls.length) warn.push('The text in the ' + (FIELD_LABEL[key] || 'box').toLowerCase() + ' box is too long for this layout.');
      const bullet = o.num ? 'num' : o.check ? '☐' : '•';
      T(key, r, ls.map((l, i) => para(run(l, {sz: f.sz, color: th.fg}), {bullet, before: i ? f.sz * .45 : 0, num: !!o.num})), {fill: o.fill, pad: o.pad == null ? .12 : o.pad, ph: 'Click to add text'});
      return f.sz;
    };
    /* ---- common furniture ---- */
    const title = () => {
      const tr = {x: .5, y: .3, w: 12.333, h: .85};
      if (th.head === 'band') rect(0, 0, SW, .12, th.accent);
      if (th.head === 'side') rect(0, .32, .24, .8, th.accent);
      if (th.head === 'rule' || th.head === 'band') rect(.5, 1.17, 12.333, .025, th.head === 'rule' ? th.frame : th.frame);
      const f = fitSize([slide.title || ''], tr.w, tr.h, 30 * sc, 18, 0);
      T('title', tr, [para(run(slide.title || '', {sz: f.sz, b: true, color: th.titleFg}))], {anchor: 'ctr', ph: 'Click to add a title'});
    };
    const footer = () => {
      const foot = (deck.style && deck.style.footer) || [deck.title, deck.analysisName].filter(Boolean).join(' · ');
      T('footer', {x: .5, y: 7.07, w: 8.4, h: .3}, [para(run(foot, {sz: 10, color: th.muted}))], {anchor: 'ctr', edit: false});
      const br = deck.style && deck.style.branding; if (br) T('branding', {x: 8.9, y: 7.07, w: 2.9, h: .3}, [para(run(br, {sz: 10, color: th.muted}), {algn: 'r'})], {anchor: 'ctr', edit: false});
      T('number', {x: 11.8, y: 7.07, w: 1.033, h: .3}, [para(run(String(num), {sz: 10, color: th.muted}), {algn: 'r'})], {anchor: 'ctr', edit: false});
    };
    const lead = (r, o = {}) => {
      const onAcc = lum(th.accent) < .55 ? '#FFFFFF' : '#0F172A', ls = [slide.lead || ''], f = fitSize(ls, r.w - .3, r.h - .1, (o.base || 24) * sc, 14, 0);
      T('lead', r, [para(run(slide.lead || '', {sz: f.sz, b: true, color: onAcc}))], {fill: th.accent, anchor: 'ctr', pad: .2, ph: 'Click to add the key statement'});
      rect(r.x, r.y, .1, r.h, th.panel);
    };
    const tagChip = txt => { rect(C.x, C.y, 2.4, .32, th.accent); T('tag', {x: C.x, y: C.y, w: 2.4, h: .32}, [para(run(txt, {sz: 11, b: true, color: lum(th.accent) < .55 ? '#FFFFFF' : '#0F172A'}), {algn: 'ctr'})], {anchor: 'ctr', pad: 0, edit: false}); };

    /* ---- title slide ---- */
    if (L.special === 'title') {
      const tl = ctx.label || '';
      rect(0, 0, .55, SH, th.accent);
      T('kicker', {x: 1.2, y: 1.55, w: 11, h: .4}, [para(run((deck.meetingType === 'collab' ? 'COLLABORATION MEETING' : 'GROUP MEETING'), {sz: 13, b: true, color: th.accent}))], {anchor: 'ctr', edit: false});
      const f = fitSize([slide.title || ''], 11, 1.9, 42 * sc, 24, 0);
      T('title', {x: 1.2, y: 2.0, w: 11.2, h: 1.9}, [para(run(slide.title || '', {sz: f.sz, b: true, color: th.titleFg}))], {anchor: 'b', ph: 'Click to add the title'});
      T('lead', {x: 1.2, y: 4.0, w: 11.2, h: .9}, [para(run(slide.lead || '', {sz: 22 * sc, color: th.muted}))], {ph: 'Click to add a subtitle'});
      const meta = [deck.presenter, deck.date && fmtDate(deck.date), deck.analysisName].filter(Boolean).join('   ·   ');
      if (meta) T('meta', {x: 1.2, y: 5.5, w: 11.2, h: .5}, [para(run(meta, {sz: 15, color: th.fg}))], {edit: false});
      return {bg: th.bg, els, warn};
    }
    title();
    /* ---- body regions ---- */
    if (L.tag) tagChip(L.tag);
    if (L.lead && L.type !== 't') lead(L.lead(g), {base: 22});
    if (L.lead && L.type === 't') lead(L.lead(g));
    if (L.bar) rect(C.x - .02, C.y, .06, C.h, th.accent);
    if (L.twoCol) {
      const w = (C.w - g * 2) / 2;
      [['head', 'body', C.x], ['head2', 'body2', C.x + w + g * 2]].forEach(([hk, bk, x]) => {
        T(hk, {x, y: C.y, w, h: .55}, [para(run(slide[hk] || '', {sz: 20 * sc, b: true, color: th.accent}))], {anchor: 'ctr', ph: 'Heading'});
        rect(x, C.y + .58, w, .02, th.frame);
        bullets(bk, slide[bk], {x, y: C.y + .7, w, h: C.h - .7}, {base: 20});
      });
    } else if (L.body) {
      const r = L.body(g), tp = L.type === 'tp';
      bullets('body', slide.body, r, {fill: tp ? th.panel : null, num: !!L.numbered, check: !!L.check, base: tp ? 16 : 24});
    }
    /* ---- picture slots ---- */
    if (L.slots) {
      const slots = L.slots(g), chipCap = L.capStyle === 'chip';
      slots.forEach((s, i) => {
        const im = slide.images[i], cap = im ? (im.caption != null ? im.caption : (im.src && im.src.label) || '') : '', showCap = !!cap && (deck.style ? deck.style.captions !== false : true);
        const capH = showCap ? (chipCap ? .38 : .34) : 0, box = {x: s.x, y: s.y + (chipCap ? capH : 0), w: s.w, h: s.h - capH - (showCap ? .04 : 0)};
        if (!im && !sample) { els.push({k: 'slot', i, x: s.x, y: s.y, w: s.w, h: s.h}); return; }
        if (sample) { els.push({k: 'sample', x: s.x, y: s.y, w: s.w, h: s.h}); return; }
        if (box.w < 3.1 || box.h < 2.1) warn.push(`Plot ${i + 1} is small (${box.w.toFixed(1)} × ${box.h.toFixed(1)} in): axis labels may be hard to read. Use fewer plots on this slide.`);
        els.push({k: 'img', i, key: skey(im.src), x: box.x, y: box.y, w: box.w, h: box.h, card: th.plotCard || null, frame: th.frame, label: (im.src && im.src.label) || 'Plot'});
        if (showCap) {
          const cy = chipCap ? s.y : s.y + s.h - capH;
          if (chipCap) { T('cap:' + i, {x: s.x, y: cy, w: s.w, h: capH}, [para(run(cap, {sz: 14 * sc, b: true, color: lum(th.accent) < .55 ? '#FFFFFF' : '#0F172A'}))], {fill: th.accent, anchor: 'ctr', pad: .1, ph: 'Label'}); }
          else T('cap:' + i, {x: s.x, y: cy, w: s.w, h: capH}, [para(run(cap, {sz: 11.5 * sc, color: th.muted}), {algn: 'ctr'})], {anchor: 'ctr', pad: .02, ph: 'Caption'});
        }
      });
      if (slide.images.length > slots.length) warn.push(`${slide.images.length - slots.length} plot${slide.images.length - slots.length === 1 ? ' is' : 's are'} not shown by this layout.`);
    }
    footer();
    return {bg: th.bg, els, warn};
  }
  const skey = src => src ? (src.kind || 'x') + ':' + (src.fileId || src.name || '') : '';
  const fmtDate = d => { try { return new Date(d + 'T00:00').toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric'}); } catch { return d; } };

  /* ============================ deck helpers ============================ */
  const newSlide = (layout, o = {}) => ({id: uid(), layout, title: '', lead: '', head: '', head2: '', body: '', body2: '', images: [], origin: 'manual', ...o});
  const newDeck = o => ({
    id: uid(), title: o.title || 'Untitled presentation', meetingType: o.meetingType || 'group', subtitle: o.subtitle || '', date: o.date || '', presenter: o.presenter || '',
    analysisName: o.analysisName || '', sourceAid: o.sourceAid || null, duration: o.duration || 0, targetSlides: o.targetSlides || 0, theme: o.theme || 'cms',
    style: {footer: '', branding: '', scale: 1, gap: .2, captions: true, accent: '', bg: '', font: ''}, blocks: [], uploads: [], slides: [], history: [], created: Date.now(), updated: 0,
  });
  const clone = x => JSON.parse(JSON.stringify(x));
  const slideWarnings = (slide, deck) => compose(slide, deck).warn;
  const emptyText = (slide, deck) => { const L = LAYOUT[slide.layout]; return !!L && L.type === 't' && !L.special && L.fields.every(f => !(slide[f] || '').trim()); };

  /* ============================ pictures ============================ */
  let resolver = async () => { throw new Error('No picture source'); };
  const loadImg = url => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('decode')); im.src = url; });
  async function prepImage(src, media) {
    const key = skey(src); if (media.has(key)) return media.get(key);
    let rec = null;
    try {
      const url = await resolver(src), blob = await (await fetch(url)).blob(), im = await loadImg(url);
      let w = im.naturalWidth || 800, h = im.naturalHeight || 600; const type = blob.type || '', jpg = /jpe?g/.test(type), png = /png/.test(type), MAX = 2000;
      let data;
      if ((jpg || png) && w <= MAX) data = new Uint8Array(await blob.arrayBuffer());
      else { const k = Math.min(1, MAX / w), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k)), cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch); g.drawImage(im, 0, 0, cw, ch); data = new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/png'))).arrayBuffer()); w = cw; h = ch; }
      rec = {data, kind: jpg ? 'jpeg' : 'png', w, h, n: 0};
    } catch (e) { rec = null; }
    media.set(key, rec); return rec;
  }

  /* ============================ PowerPoint ============================ */
  const clean = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
  const x = s => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const IN = 914400, emu = v => Math.round(v * IN), hex = c => String(c || '#000000').replace('#', '').toUpperCase();
  function xmlRun(r) { return `<a:r><a:rPr lang="en-GB" sz="${Math.round((r.sz || 14) * 100)}"${r.b ? ' b="1"' : ''}${r.i ? ' i="1"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${hex(r.color)}"/></a:solidFill><a:latin typeface="${x(r.font || 'Calibri')}"/></a:rPr><a:t>${x(r.t)}</a:t></a:r>`; }
  function xmlPara(p) {
    const sz = (p.runs[0] && p.runs[0].sz) || 14, ind = emu(.28);
    const bu = p.bullet === 'num' ? `<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>` : p.bullet ? `<a:buFont typeface="Arial"/><a:buChar char="${x(p.bullet)}"/>` : '<a:buNone/>';
    return `<a:p><a:pPr${p.bullet ? ` marL="${ind}" indent="-${ind}"` : ''} algn="${p.algn || 'l'}"><a:spcBef><a:spcPts val="${Math.round((p.before || 0) * 100)}"/></a:spcBef>${bu}</a:pPr>${p.runs.map(xmlRun).join('')}<a:endParaRPr lang="en-GB" sz="${Math.round(sz * 100)}"/></a:p>`;
  }
  async function toPptx(deck, progress) {
    const media = new Map(), srcs = []; deck.slides.forEach(s => (s.images || []).forEach(im => { if (im.src && !srcs.some(a => skey(a) === skey(im.src))) srcs.push(im.src); }));
    let done = 0; const q = [...srcs];
    await Promise.all(Array.from({length: Math.min(4, srcs.length)}, async () => { while (q.length) { await prepImage(q.shift(), media); progress && progress(++done, srcs.length); } }));
    let n = 0; media.forEach(r => { if (r) r.n = ++n; });
    const missing = []; let id;
    const out = deck.slides.map((slide, i) => {
      const c = compose(slide, deck, {number: i + 1}); id = 1; const rels = []; let body = '';
      const xf = (e, tag) => `<a:xfrm><a:off x="${emu(e.x)}" y="${emu(e.y)}"/><a:ext cx="${emu(e.w)}" cy="${emu(e.h)}"/></a:xfrm>`;
      c.els.forEach(e => {
        if (e.k === 'rect') body += `<p:sp><p:nvSpPr><p:cNvPr id="${++id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xf(e)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${e.fill ? `<a:solidFill><a:srgbClr val="${hex(e.fill)}"/></a:solidFill>` : '<a:noFill/>'}<a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
        else if (e.k === 'text') {
          if (!e.paras.some(p => p.runs.some(r => r.t))) { if (!e.fill) return; }
          body += `<p:sp><p:nvSpPr><p:cNvPr id="${++id}" name="${x(e.key)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xf(e)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${e.fill ? `<a:solidFill><a:srgbClr val="${hex(e.fill)}"/></a:solidFill>` : '<a:noFill/>'}</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="${emu(e.pad)}" tIns="${emu(e.pad * .6)}" rIns="${emu(e.pad)}" bIns="${emu(e.pad * .6)}" anchor="${e.anchor}"><a:noAutofit/></a:bodyPr><a:lstStyle/>${e.paras.length ? e.paras.map(xmlPara).join('') : '<a:p><a:endParaRPr lang="en-GB"/></a:p>'}</p:txBody></p:sp>`;
        } else if (e.k === 'img') {
          const rec = media.get(e.key);
          if (e.card) body += `<p:sp><p:nvSpPr><p:cNvPr id="${++id}" name="Plot card"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xf(e)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${hex(e.card)}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
          if (!rec) { missing.push(`slide ${i + 1}: ${e.label}`); return; }
          const pad = .04, bw = e.w - pad * 2, bh = e.h - pad * 2, k = Math.min(bw / rec.w, bh / rec.h), w = rec.w * k, h = rec.h * k; rels.push(e.key);
          body += `<p:pic><p:nvPicPr><p:cNvPr id="${++id}" name="${x(e.label)}" descr="${x(e.label)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdP${rels.length}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${emu(e.x + (e.w - w) / 2)}" y="${emu(e.y + (e.h - h) / 2)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln w="9525"><a:solidFill><a:srgbClr val="${hex(e.frame)}"/></a:solidFill></a:ln></p:spPr></p:pic>`;
        }
      });
      return {body, rels, bg: hex(c.bg)};
    });
    return {blob: SLIDES.pack(out, media), slides: out.length, missing};
  }

  /* ============================ Google Slides (through Google Drive) ============================ */
  /* A browser page cannot call the Slides API without the user's Google sign-in. It uses Google Identity Services (token only, no
   * secret in the page) and asks Drive to convert the uploaded .pptx into a native Google Slides file, which keeps text, bullets,
   * layout and pictures editable. The OAuth client id is public by design; it is set in config.js or saved on this device. */
  const GCFG = () => Object.assign({googleUploadBase: 'https://www.googleapis.com/upload/drive/v3/files', googleOpenBase: 'https://docs.google.com/presentation/d/'}, window.AT_CONFIG || {});
  const gClient = () => { try { return localStorage.getItem('at_gclient') || ''; } catch { return ''; } } ;
  const clientId = () => ((window.AT_CONFIG && window.AT_CONFIG.googleClientId) || gClient() || '').trim();
  let gTok = null;
  const GERR = (code, msg) => Object.assign(new Error(msg), {gcode: code});
  function loadGsi() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => res(); s.onerror = () => rej(GERR('network', 'Google sign-in could not be loaded. Check your internet connection or ad blocker.'));
      document.head.appendChild(s);
    });
  }
  async function googleToken() {
    if (gTok && gTok.exp > Date.now() + 60000) return gTok.token;
    const cid = clientId(); if (!cid) throw GERR('noclient', 'Google is not set up yet.');
    await loadGsi();
    return new Promise((res, rej) => {
      let tc; try {
        tc = google.accounts.oauth2.initTokenClient({client_id: cid, scope: 'https://www.googleapis.com/auth/drive.file',
          callback: r => { if (r.error) rej(GERR(r.error === 'access_denied' ? 'denied' : 'auth', r.error === 'access_denied' ? 'Google access was not granted.' : 'Google sign-in failed: ' + (r.error_description || r.error))); else { gTok = {token: r.access_token, exp: Date.now() + (+r.expires_in || 3000) * 1000}; res(gTok.token); } },
          error_callback: e => rej(GERR(e && e.type === 'popup_closed' ? 'denied' : 'popup', e && e.type === 'popup_failed_to_open' ? 'The Google sign-in window was blocked. Allow pop-ups for this site and try again.' : 'Google sign-in was closed before it finished.'))});
      } catch (e) { return rej(GERR('auth', 'Google sign-in could not start: ' + e.message)); }
      tc.requestAccessToken({prompt: ''});
    });
  }
  async function exportGoogle(deck, progress) {
    const token = await googleToken();
    progress && progress('Building the presentation…');
    const built = await toPptx(deck, (i, n) => progress && progress(`Collecting plots… ${i} of ${n}`));
    progress && progress('Creating the Google Slides file in your Drive…');
    const meta = {name: deck.title || 'Presentation', mimeType: 'application/vnd.google-apps.presentation'};
    const b = '----at' + uid(), pptx = built.blob;
    const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation\r\n\r\n`, pptx, `\r\n--${b}--`]);
    let r;
    try { r = await fetch(GCFG().googleUploadBase + '?uploadType=multipart&fields=id,name,webViewLink', {method: 'POST', headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=' + b}, body}); }
    catch { throw GERR('network', 'Google Drive could not be reached. Check your internet connection.'); }
    if (!r.ok) {
      let msg = ''; try { msg = ((await r.json()).error || {}).message || ''; } catch {}
      if (r.status === 401) { gTok = null; throw GERR('auth', 'Your Google sign-in expired. Please try again.'); }
      if (r.status === 403) throw GERR('perm', 'Google refused the upload. Check that the Google Drive API is enabled for your OAuth project and that you allowed access to Drive. ' + msg);
      throw GERR('http', `Google Drive returned an error (${r.status}). ${msg}`);
    }
    const f = await r.json(); if (!f.id) throw GERR('http', 'Google Drive did not return a file.');
    return {id: f.id, url: f.webViewLink || GCFG().googleOpenBase + f.id + '/edit', slides: built.slides, missing: built.missing};
  }
  const forgetGoogle = () => { gTok = null; };

  return {THEMES, FONTS, LAYOUTS, LAYOUT, TYPES, FIELD_LABEL, SW, SH, uid, themeOf, compose, recommend, lines, skey, newSlide, newDeck, clone, slideWarnings, emptyText, fmtDate,
    setResolver: f => { resolver = f; }, toPptx, exportGoogle, clientId, setClientId: v => { try { localStorage.setItem('at_gclient', (v || '').trim()); } catch {} }, forgetGoogle};
})();
