/*! Analysis-Tracker - Copyright (c) 2026 Sanskar Nanda - MIT License (see LICENSE). https://github.com/Sanskar-hep */
/* Scan the figures of an AN PDF and propose which uploaded plot is which figure.
 *   1. captions ("Figure 4.2: ...") give the figure number, page and section;
 *   2. the pictures embedded in the PDF are compared (image fingerprint) with the uploaded plots;
 *   3. plot names and eras mentioned in the caption are a second clue.
 * Everything runs in the browser; nothing is uploaded. The analyst confirms every match before anything is saved.
 * Uses the app's globals (S, api, aurl, openModal, ...) and the PDF.js document opened in the PDF viewer. */
(function () {
  'use strict';
  const CAP = /^(?:Figure|Fig\.?)\s*((?:[A-Z]\.)?\d+(?:\.\d+)*[a-z]?)\s*[:.–—-]\s*(\S.*)$/;
  const SEC = /^((?:\d+|[A-Z])(?:\.\d+){0,3})\s+[A-Z][^]{2,80}$/, APP = /^Appendix\s+[A-Z]\b.{0,70}$/;
  const sleep = () => new Promise(r => setTimeout(r, 0));

  /* ---------- text of a page as lines, top to bottom ---------- */
  async function pageLines(page) {
    const tc = await page.getTextContent(), rows = [];
    tc.items.forEach(it => { if (!it.str || !it.str.trim()) return; const y = it.transform[5], x = it.transform[4], fs = Math.abs(it.transform[3]) || it.height || 10;
      let r = rows.find(q => Math.abs(q.y - y) < Math.max(1.5, fs * 0.25)); if (!r) rows.push(r = {y, fs, parts: []}); r.parts.push({x, w: it.width, s: it.str}); r.fs = Math.max(r.fs, fs); });
    rows.sort((a, b) => b.y - a.y);
    return rows.map(r => { r.parts.sort((a, b) => a.x - b.x); let t = '', end = null;
      r.parts.forEach(p => { if (end !== null && p.x - end > r.fs * 0.15 && !t.endsWith(' ') && !p.s.startsWith(' ')) t += ' '; t += p.s; end = p.x + p.w; });
      return {y: r.y, fs: r.fs, x: r.parts[0].x, text: t.replace(/\s+/g, ' ').trim()}; });
  }
  /* captions (with their continuation lines) and the current section heading, in reading order */
  function findCaptions(lines, pageNo, state) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i], t = ln.text;
      if (ln.fs >= state.body * 1.08 && t.length < 90 && (SEC.test(t) || APP.test(t)) && !CAP.test(t)) { state.section = t; continue; }
      const m = CAP.exec(t); if (!m) continue;
      let text = m[2], last = ln, n = 0;
      while (i + 1 < lines.length && n < 8 && last.y - lines[i + 1].y < last.fs * 1.9 && Math.abs(lines[i + 1].fs - ln.fs) < 1.6 && !CAP.test(lines[i + 1].text) && !/^(?:Table|Tab\.)\s*\d/.test(lines[i + 1].text) && text.length < 700) { text += ' ' + lines[i + 1].text; last = lines[++i]; n++; }
      out.push({fig: m[1], page: pageNo, y: ln.y, yEnd: last.y, x: ln.x, caption: text.trim(), section: state.section || ''});
    }
    return out;
  }

  /* ---------- images embedded in a page, with their position ---------- */
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  async function pageImages(page) {
    const ops = await page.getOperatorList(), O = pdfjsLib.OPS, out = []; let ctm = [1, 0, 0, 1, 0, 0], depth = 0; const stack = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], a = ops.argsArray[i];
      if (fn === O.save) stack.push(ctm.slice()); else if (fn === O.restore) ctm = stack.pop() || ctm; else if (fn === O.transform) ctm = mul(ctm, a);
      else if (fn === O.paintFormXObjectBegin) {                       // an included PDF figure (vector graphics): its box on the page
        stack.push(ctm.slice()); if (a && a[0]) ctm = mul(ctm, a[0]);
        if (depth === 0 && a && a[1]) { const b = a[1], xs = [], ys = []; [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].forEach(([x, y]) => { xs.push(ctm[0] * x + ctm[2] * y + ctm[4]); ys.push(ctm[1] * x + ctm[3] * y + ctm[5]); });
          const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys); if (x1 - x0 >= 60 && y1 - y0 >= 60) out.push({x: x0, y: y0, w: x1 - x0, h: y1 - y0, vector: true}); }
        depth++;
      } else if (fn === O.paintFormXObjectEnd) { ctm = stack.pop() || ctm; depth = Math.max(0, depth - 1); }
      else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject || fn === O.paintImageXObjectRepeat) {
        const w = Math.hypot(ctm[0], ctm[1]), h = Math.hypot(ctm[2], ctm[3]); if (w < 40 || h < 40) continue;
        const x0 = Math.min(ctm[4], ctm[4] + ctm[0] + ctm[2]), y0 = Math.min(ctm[5], ctm[5] + ctm[1] + ctm[3]);
        let obj = null; try { obj = fn === O.paintInlineImageXObject ? a[0] : await new Promise((res, rej) => { const pool = String(a[0]).startsWith('g_') ? page.commonObjs : page.objs; if (pool.has(a[0])) res(pool.get(a[0])); else pool.get(a[0], res); setTimeout(() => rej(new Error('timeout')), 4000); }); } catch { obj = null; }
        if (obj) out.push({x: x0, y: y0, w, h, obj});
      }
    }
    return out;
  }
  /* render the page once and cut out each included PDF figure, so vector plots can be compared like pictures */
  async function cropVectors(page, imgs) {
    const vp = page.getViewport({scale: 2}), c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({canvasContext: g, viewport: vp}).promise;
    imgs.filter(im => im.vector).forEach(im => { const r = vp.convertToViewportRectangle([im.x, im.y, im.x + im.w, im.y + im.h]), x = Math.max(0, Math.min(r[0], r[2])), y = Math.max(0, Math.min(r[1], r[3])), w = Math.min(c.width - x, Math.abs(r[2] - r[0])), h = Math.min(c.height - y, Math.abs(r[3] - r[1]));
      if (w > 20 && h > 20) { const cc = document.createElement('canvas'); cc.width = Math.round(w); cc.height = Math.round(h); cc.getContext('2d').drawImage(c, x, y, w, h, 0, 0, cc.width, cc.height); im.canvas = cc; } });
  }
  function toCanvas(obj, maxW) {
    const c = document.createElement('canvas'); let w = obj.width, h = obj.height; if (!w || !h) return null;
    const ctx = c.getContext('2d'); c.width = w; c.height = h;
    if (obj.bitmap) { ctx.drawImage(obj.bitmap, 0, 0); }
    else if (obj.data) {
      const img = ctx.createImageData(w, h), d = obj.data, px = w * h;
      if (d.length === px * 4) img.data.set(d);
      else if (d.length === px * 3) for (let i = 0, j = 0; i < px; i++) { img.data[j++] = d[i * 3]; img.data[j++] = d[i * 3 + 1]; img.data[j++] = d[i * 3 + 2]; img.data[j++] = 255; }
      else if (d.length === px) for (let i = 0, j = 0; i < px; i++) { img.data[j++] = d[i]; img.data[j++] = d[i]; img.data[j++] = d[i]; img.data[j++] = 255; }
      else return null;
      ctx.putImageData(img, 0, 0);
    } else return null;
    return c;
  }
  /* A fingerprint that survives rescaling and different white margins: the picture is trimmed to its content, squeezed to 32 x 32
   * grey levels, and two pictures are compared by correlation (1 = identical shape, 0 = unrelated). */
  function fingerprint(src) {
    const w0 = src.naturalWidth || src.width, h0 = src.naturalHeight || src.height, k = Math.min(1, 256 / Math.max(w0, h0)), w = Math.max(8, Math.round(w0 * k)), h = Math.max(8, Math.round(h0 * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', {willReadFrequently: true}); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data; let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    if (x1 < x0 || y1 < y0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
    const pad = 0.02, cw = x1 - x0 + 1, ch = y1 - y0 + 1, px = Math.max(0, x0 - cw * pad), py = Math.max(0, y0 - ch * pad), pw = Math.min(w - px, cw * (1 + 2 * pad)), ph = Math.min(h - py, ch * (1 + 2 * pad));
    const s = document.createElement('canvas'); s.width = 32; s.height = 32; const sg = s.getContext('2d', {willReadFrequently: true}); sg.fillStyle = '#fff'; sg.fillRect(0, 0, 32, 32); sg.imageSmoothingQuality = 'high'; sg.drawImage(c, px, py, pw, ph, 0, 0, 32, 32);
    const sd = sg.getImageData(0, 0, 32, 32).data, v = new Float32Array(1024); for (let i = 0; i < 1024; i++) v[i] = 0.299 * sd[i * 4] + 0.587 * sd[i * 4 + 1] + 0.114 * sd[i * 4 + 2];
    return {v, ar: pw / ph};
  }
  const dist = (p, q) => { let ma = 0, mb = 0; for (let i = 0; i < 1024; i++) { ma += p.v[i]; mb += q.v[i]; } ma /= 1024; mb /= 1024; let sa = 0, sb = 0, sab = 0;
    for (let i = 0; i < 1024; i++) { const a = p.v[i] - ma, b = q.v[i] - mb; sa += a * a; sb += b * b; sab += a * b; } return 1 - sab / Math.sqrt(sa * sb + 1e-9); };   // 0 = same picture, larger = more different
  const thumb = (c, w = 140) => { const t = document.createElement('canvas'), r = w / c.width; t.width = w; t.height = Math.max(1, Math.round(c.height * r)); const g = t.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, t.width, t.height); g.drawImage(c, 0, 0, t.width, t.height); return t.toDataURL('image/jpeg', 0.6); };
  const loadImg = url => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });

  /* match one picture of the AN: as a whole, or - when several plots were merged into one picture - as 2, 3 or 4 panels */
  const crop = (cv, x, y, w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); c.getContext('2d').drawImage(cv, x, y, w, h, 0, 0, c.width, c.height); return c; };
  function bestRefs(cv, refs, used, maxD) {
    const fp = fingerprint(cv);
    return refs.filter(r => !used.has(r.p.id) && Math.abs(Math.log(fp.ar / r.fp.ar)) < 0.4).map(r => ({r, d: dist(fp, r.fp)})).sort((a, b) => a.d - b.d).map((x, i, a) => ({...x, margin: i + 1 < a.length ? a[i + 1].d - x.d : 1})).filter(x => x.d <= maxD && (x.d <= 0.06 || x.margin >= 0.04));
  }
  function matchImage(cv, refs, used) {
    const W = cv.width, H = cv.height, whole = bestRefs(cv, refs, used, 0.16)[0];
    if (whole && whole.d <= 0.10) return [{...whole, thumb: thumb(cv), cv}];
    const layouts = [[[0, 0, .5, 1], [.5, 0, .5, 1]], [[0, 0, 1, .5], [0, .5, 1, .5]], [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]], [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]]];
    let best = null;
    for (const lay of layouts) {
      const taken = new Set(used), got = [];
      for (const [fx, fy, fw, fh] of lay) {
        const c = crop(cv, fx * W, fy * H, fw * W, fh * H), m = bestRefs(c, refs, taken, 0.14)[0];
        if (!m) { got.length = 0; break; }
        taken.add(m.r.p.id); got.push({...m, thumb: thumb(c), cv: c});
      }
      if (got.length === lay.length) { const avg = got.reduce((a, g) => a + g.d, 0) / got.length; if (!best || avg < best.avg) best = {avg, got}; }
    }
    if (best && (!whole || best.avg < whole.d)) return best.got;
    return whole ? [{...whole, thumb: thumb(cv), cv}] : [];
  }

  /* the version of a plot that belonged to a published AN version */
  const versionAt = (pid, num) => S.versions.filter(v => v.plotId === pid && v.anvId && anv(v.anvId).number <= num).sort(byVer).pop() || null;

  /* ---------- the scan ---------- */
  async function scan(doc, vid) {
    const av = anv(vid), done = busy('Reading the AN…');
    try {
      done.set('Fingerprinting your plots…');
      const refs = [];
      for (const p of S.plots) { const v = versionAt(p.id, av.number); if (!v) continue;
        try { const im = await loadImg(await imageUrl(v)); refs.push({p, v, fp: fingerprint(im), era: GAL.plotEra(p)}); } catch { /* unreadable image: skipped */ } }
      const labels = (await doc.getPageLabels().catch(() => null)) || null, state = {body: 10, section: ''}, caps = [], pageImgs = new Map();
      // body text size = most common font size over the first pages
      const sizes = new Map(); for (let n = 1; n <= Math.min(doc.numPages, 6); n++) (await pageLines(await doc.getPage(n))).forEach(l => sizes.set(Math.round(l.fs), (sizes.get(Math.round(l.fs)) || 0) + l.text.length));
      state.body = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
      for (let n = 1; n <= doc.numPages; n++) {
        done.set(`Scanning page ${n} of ${doc.numPages}…`); const page = await doc.getPage(n);
        const cs = findCaptions(await pageLines(page), n, state);
        if (cs.filter(c => /\.{3,}\s*\d+$|\s\d{1,3}$/.test(c.caption)).length >= 4) continue;             // a list of figures, not real captions
        const imgs = cs.length ? await pageImages(page).catch(() => []) : [];
        if (imgs.some(im => im.vector)) await cropVectors(page, imgs).catch(() => {});
        cs.forEach(c => { c.label = labels && labels[n - 1] ? labels[n - 1] : String(n); });
        caps.push(...cs); pageImgs.set(n, imgs); await sleep();
      }
      // images -> captions (the nearest caption below the picture, else the nearest on the page)
      const figs = new Map();
      caps.forEach(c => { if (!figs.has(c.fig) || c.caption.length > figs.get(c.fig).caption.length) figs.set(c.fig, {...c, images: []}); });
      for (const [n, imgs] of pageImgs) {
        const here = [...figs.values()].filter(f => f.page === n); if (!here.length) continue;
        for (const im of imgs) {
          const below = here.filter(f => f.y <= im.y + im.h * 0.15).sort((a, b) => (im.y - a.y) - (im.y - b.y))[0], pick = below || here.sort((a, b) => Math.abs(a.y - im.y) - Math.abs(b.y - im.y))[0];
          if (pick && (pick.images.length < 12)) pick.images.push(im);
        }
      }
      done.set('Matching to your plots…');
      const out = [];
      for (const f of [...figs.values()].sort((a, b) => a.page - b.page || b.y - a.y)) {
        const rows = [], used = new Set();
        for (const im of f.images.sort((a, b) => b.y - a.y || a.x - b.x)) {
          const cv = im.canvas || (im.obj ? toCanvas(im.obj) : null); if (!cv) continue;
          const found = matchImage(cv, refs, used);
          if (found.length) found.forEach(x => { used.add(x.r.p.id); rows.push({thumb: x.thumb, cv: x.cv, plotId: x.r.p.id, d: x.d, conf: x.d <= 0.07 ? 'high' : 'medium', via: 'image'}); });
          else rows.push({thumb: thumb(cv), cv, plotId: null, conf: '', d: null});
        }
        // name clue: plots whose name words all appear in the caption (used when there is no picture, or to fill gaps)
        const words = new Set(f.caption.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)), ce = new Set([...eraKeys(f.caption)]);
        const nameHits = refs.filter(r => !used.has(r.p.id)).map(r => { const toks = GAL.plotBase(r.p).toLowerCase().split(/[_\-\s]+/).filter(t => t.length > 1); if (!toks.length) return null;
          const hit = toks.filter(t => words.has(t)).length / toks.length, ek = eraKeys(r.era), eraOk = !ce.size || !ek.size || [...ek].some(k => ce.has(k)); return hit >= 0.99 && eraOk ? r : null; }).filter(Boolean);
        if (!rows.some(r => r.plotId) && nameHits.length && nameHits.length <= 8) nameHits.forEach(r => rows.push({thumb: '', plotId: r.p.id, conf: 'low', via: 'name', d: null}));
        out.push({fig: f.fig, page: f.page, label: f.label, section: f.section, caption: f.caption, rows, nImg: f.images.length});
      }
      return {figures: out, refs: refs.length};
    } finally { done(); }
  }

  /* ---------- review and apply ---------- */
  async function start() {
    const doc = PDF.state.doc, vid = PDF.state.vid; if (!doc || !vid) { toast('Open the AN PDF first.', 'err'); return; }
    let res; try { res = await scan(doc, vid); } catch (e) { toast('The scan failed: ' + e.message, 'err', 8000); return; }
    if (!res.figures.length) { toast('No figure captions were found. Captions need to look like “Figure 4.2: …”.', 'err', 9000); return; }
    review(res, vid);
  }
  function review(res, vid) {
    const av = anv(vid), plots = S.plots.filter(p => versionAt(p.id, av.number)).sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
    const popts = cur => `<option value="">— no plot —</option>${plots.map(p => `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${esc(catPath(p.catId) ? catPath(p.catId) + ' / ' : '')}${esc(p.name)}</option>`).join('')}`;
    const has = S.usages.filter(u => u.type === 'note' && u.anvId === vid);
    const matched = res.figures.filter(f => f.rows.some(r => r.plotId)).length;
    const mineHtml = pid => { const v = pid && versionAt(pid, av.number); return v ? `${img(v)}<span class="meta">your plot</span>` : '<span class="meta">no plot chosen</span>'; };
    const card = (f, i) => { const exists = has.some(u => u.fig === f.fig), conf = f.rows.some(r => r.conf === 'high') ? 'high' : f.rows.some(r => r.plotId) ? 'check' : 'none';
      return `<div class="card pad scanfig" data-i="${i}"><div style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" name="use${i}" ${conf !== 'none' && !exists ? 'checked' : ''} style="margin-top:4px">
        <div style="flex:1;min-width:0"><b>Figure ${esc(f.fig)}</b> <span class="meta">page ${esc(f.label)}${f.section ? ' · ' + esc(f.section) : ''}</span>
        ${exists ? ' <span class="badge">already recorded</span>' : ''} <span class="badge ${conf === 'high' ? 'resolved' : conf === 'check' ? 'pending' : ''}">${conf === 'high' ? 'image match' : conf === 'check' ? 'please check' : 'no match found'}</span>
        <div class="meta" style="margin:4px 0 8px">${esc(f.caption.length > 260 ? f.caption.slice(0, 260) + '…' : f.caption)}</div>
        ${f.rows.length ? f.rows.map((r, j) => `<div class="scanrow" data-i="${i}" data-j="${j}"><div class="sth" title="${r.thumb ? 'Picture found in the AN: click to enlarge' : ''}">${r.thumb ? `<img src="${r.thumb}" alt="In the AN" data-zoom="an"><span class="meta">in the AN</span>` : '<span class="meta">name match</span>'}</div>
          <div class="sth mine" title="Your uploaded plot: click to enlarge">${mineHtml(r.plotId)}</div>
          <div><select name="p${i}_${j}">${popts(r.plotId)}</select><a class="link opn" target="_blank" rel="noopener" ${r.plotId ? `href="${L('/plot/' + r.plotId)}"` : 'hidden'}>Open the plot page ↗</a></div><div><input type="text" name="l${i}_${j}" maxlength="60" value="${esc(r.plotId ? (GAL.plotEra(plot(r.plotId)) || (f.rows.length > 1 ? plot(r.plotId).name : '')) : '')}" placeholder="panel / era"></div><span class="badge ${r.conf === 'high' ? 'resolved' : r.conf === 'medium' ? '' : 'pending'}">${r.via === 'image' ? 'image ' + (r.conf) : r.conf ? 'name only' : 'unmatched picture'}</span></div>`).join('')
          : `<div class="scanrow"><span class="meta">${f.nImg ? '' : 'No picture found (a vector figure?). '}Pick a plot if you want to link one:</span><select name="p${i}_0">${popts('')}</select><input type="text" name="l${i}_0" maxlength="60" placeholder="panel / era"></div>`}
        </div></div></div>`; };
    openModal({title: `Figures found in ${anvLabel(av)}`, xl: true, submit: 'Record the checked figures',
      sub: `${res.figures.length} figure${res.figures.length === 1 ? '' : 's'} found; ${matched} matched to your plots (${res.refs} plots were compared). Nothing is saved until you confirm. Untick a figure to skip it, and fix any wrong plot in the lists.`,
      body: `<div class="scanlist">${res.figures.map(card).join('')}</div>`,
      setup: f => {
        hydrateImages();
        f.addEventListener('click', e => { const t = e.target; if (t.matches('img[data-zoom=an]')) { const row = t.closest('.scanrow'), r = res.figures[+row.dataset.i].rows[+row.dataset.j]; if (r && r.cv) lightbox(r.cv.toDataURL('image/png')); }
          else if (t.matches('.sth.mine img') && t.dataset.ok) lightbox(t.src); });
        f.addEventListener('change', e => { const sel = e.target; if (!sel.matches('select[name^=p]')) return; const row = sel.closest('.scanrow'), box = row.querySelector('.mine'), a = row.querySelector('.opn');
          box.innerHTML = mineHtml(sel.value); hydrateImages(); if (sel.value) { a.href = L('/plot/' + sel.value); a.hidden = false; } else a.hidden = true; });
      },
      onSubmit: async (fd, f) => {
        const jobs = []; res.figures.forEach((fg, i) => { if (!fd.get('use' + i)) return; const sel = [];
          for (let j = 0; fd.has(`p${i}_${j}`); j++) { const pid = fd.get(`p${i}_${j}`); if (pid) sel.push({pid, label: (fd.get(`l${i}_${j}`) || '').trim()}); }
          if (sel.length > 1 && sel.some(s => !s.label)) throw new Error(`Figure ${fg.fig}: give each plot a panel label (its era).`);
          if (sel.length) jobs.push({fg, sel}); });
        if (!jobs.length) throw new Error('Nothing to record: tick a figure that has a plot.');
        let nU = 0, nL = 0, skipped = 0;
        await batch(async () => {
          for (const {fg, sel} of jobs) for (const s of sel) {
            const v = versionAt(s.pid, av.number); if (!v) { skipped++; continue; }
            if (S.usages.some(u => u.type === 'note' && u.anvId === vid && u.fig === fg.fig && u.versionId && ver(u.versionId).plotId === s.pid)) { skipped++; continue; }
            await api('POST', aurl('/usages'), {plot_version_id: v.id, type: 'note', an_version_id: vid, fig: fg.fig, panel: s.label, an_ver: ''}); nU++;
            const p = plot(s.pid); if (!p.location) { await api('PATCH', aurl('/plots/' + s.pid), {location: `Fig ${fg.fig} · p. ${fg.label}${fg.section ? ' · ' + fg.section.slice(0, 60) : ''}`}); nL++; }
          }
        });
        setCtx(vid); await reload(); toast(`${nU} plot${nU === 1 ? '' : 's'} linked to figures, ${nL} AN location${nL === 1 ? '' : 's'} filled in${skipped ? `, ${skipped} skipped (already recorded)` : ''}.`, '', 7000);
      }});
  }
  window.SCAN = {start, scan, findCaptions, CAP, _dbg: {pageImages, cropVectors, fingerprint, dist, toCanvas}};
})();
