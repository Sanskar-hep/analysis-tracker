/*! Analysis-Tracker - Copyright (c) 2026 Sanskar Nanda - MIT License (see LICENSE). https://github.com/Sanskar-hep */
/* Two helpers for the end of a review round (Release & Export page):
 *   1. "Update figures in the LaTeX source": read the AN's LaTeX source (a zip, e.g. Overleaf > Download > Source), find every
 *      \includegraphics, recognise which tracked plot each one is (remembered names, file names, then the picture itself), say
 *      which are outdated, and give back either the changed figures under the exact paths the .tex expects, or the whole source
 *      with those figures replaced (ready to upload to Overleaf).
 *   2. "Add figure references to the replies": scan the new AN PDF, find where each revised plot ended up, and add
 *      "(→ AN_v5: Fig. 4.2, p. 13)" to the replies; also refresh each plot's "location in the AN".
 * Everything runs in the browser; the source and the PDF are never uploaded anywhere.
 * Uses the app's globals (S, api, aurl, batch, openModal, toast, busy, fetchImage, imageUrl, img, hydrateImages, lightbox, ...) at call time. */
(function () {
  'use strict';
  const SAME = 0.08, WINDOW = 0.02;                                // picture distance: below SAME = the same picture
  const EXTS = ['.pdf', '.png', '.jpg', '.jpeg', '.mps', '.eps'], IMG_EXT = /\.(png|jpe?g|gif|webp|svg|pdf|eps|mps)$/i;
  const nk = s => String(s || '').toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '').replace(/[^a-z0-9]+/g, '');
  const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
  const baseOf = p => p.slice(p.lastIndexOf('/') + 1);
  const extOf = p => { const m = /\.[A-Za-z0-9]+$/.exec(baseOf(p)); return m ? m[0].toLowerCase() : ''; };
  const norm = p => { const out = []; String(p).split('/').forEach(s => { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); }); return out.join('/'); };
  const sleep = () => new Promise(r => setTimeout(r, 0));
  const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); };

  /* ================= zip reading (stored or deflate) ================= */
  async function inflate(u8) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); }
  async function readZip(file) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack zip files. Use a recent Chrome, Edge, Firefox or Safari.');
    const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer);
    let e = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('This does not look like a zip file.');
    const n = dv.getUint16(e + 10, true), off = dv.getUint32(e + 16, true);
    if (n === 0xFFFF || off === 0xFFFFFFFF) throw new Error('This zip uses the ZIP64 format (very large), which is not supported. Remove large files from the source or zip it again.');
    const dec = new TextDecoder(), entries = []; let p = off;
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('The zip file is damaged.');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
      if (name.endsWith('/') || /(^|\/)(__MACOSX|\.git)\//.test(name) || /(^|\/)\.DS_Store$/.test(name)) continue;
      const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      entries.push({name, size, async data() { if (this._d) return this._d; const raw = buf.subarray(start, start + csize); this._d = method === 0 ? raw.slice() : method === 8 ? await inflate(raw) : (() => { throw new Error('Unsupported compression in ' + name); })(); return this._d; }});
    }
    return entries;
  }

  /* ================= reading the LaTeX ================= */
  const stripComments = t => t.split('\n').map(l => { for (let k = 0; k < l.length; k++) { if (l[k] === '\\') { k++; continue; } if (l[k] === '%') return l.slice(0, k); } return l; }).join('\n');
  function balanced(t, i) {                                         // t[i] is "{": the text up to the matching "}"
    let d = 0; for (let k = i; k < t.length; k++) { if (t[k] === '\\') { k++; continue; } if (t[k] === '{') d++; else if (t[k] === '}' && --d === 0) return t.slice(i + 1, k); } return t.slice(i + 1);
  }
  const plain = s => s.replace(/\\label\s*\{[^}]*\}/g, '').replace(/\\(?:textit|textbf|emph|text|mathrm|ensuremath|texttt)\s*\{/g, '').replace(/\\[a-zA-Z]+\*?/g, '').replace(/[${}~]/g, ' ').replace(/\s+/g, ' ').trim();
  function captionOf(body) { const m = /\\caption\s*(?:\[[^\]]*\])?\s*\{/.exec(body); return m ? plain(balanced(body, m.index + m[0].length - 1)).slice(0, 220) : ''; }
  function parseTex(texFiles, main) {                               // texFiles: Map(path -> text)
    const lower = new Map([...texFiles.keys()].map(k => [k.toLowerCase(), k])), seen = new Set(), graphics = [], gp = [''], base = dirOf(main), unresolved = [];
    let figNo = 0;
    const findTex = (name, from) => { for (const d of [base, dirOf(from), '']) for (const x of [name, name + '.tex']) { const k = lower.get(norm(d + x).toLowerCase()); if (k) return k; } return null; };
    const re = /\\(?:(input|include|subfile)\s*\{([^}]*)\}|(graphicspath)\s*\{((?:\s*\{[^}]*\}\s*)+)\}|(begin|end)\s*\{(figure\*?|wrapfigure|sidewaysfigure|SCfigure)\}|(includegraphics)\*?\s*(?:\[[^\]]*\])?\s*\{([^}]*)\})/g;
    function walk(path) {
      if (seen.has(path)) return; seen.add(path);
      const txt = stripComments(texFiles.get(path)); let cur = null, m; re.lastIndex = 0;
      while ((m = re.exec(txt))) {
        if (m[1]) { const f = findTex(m[2].trim(), path); if (f) walk(f); }
        else if (m[3]) { [...m[4].matchAll(/\{([^}]*)\}/g)].forEach(x => { const d = x[1].trim().replace(/^\.\//, ''); if (d && !gp.includes(d)) gp.push(d.endsWith('/') ? d : d + '/'); }); }
        else if (m[5] === 'begin') { cur = {no: ++figNo, start: m.index, items: []}; }
        else if (m[5] === 'end') { if (cur) { const body = txt.slice(cur.start, m.index), cap = captionOf(body), lab = (/\\label\s*\{([^}]*)\}/.exec(body) || [])[1] || ''; cur.items.forEach(g => { g.caption = cap; g.label = lab; }); cur = null; } }
        else if (m[7]) { const token = m[8].trim(); if (!token) continue; if (/[#\\]/.test(token)) { unresolved.push(token); continue; } const g = {token, file: path, figNo: cur ? cur.no : null, caption: '', label: ''}; graphics.push(g); if (cur) cur.items.push(g); }
      }
    }
    walk(main);
    return {graphics, gp, unresolved, files: [...seen]};
  }
  function findMain(texFiles) {
    const list = [...texFiles.entries()].filter(([, t]) => /\\documentclass/.test(stripComments(t)));
    if (!list.length) return null;
    return list.map(([k, t]) => ({k, s: (/\\begin\s*\{document\}/.test(t) ? 10 : 0) + (/(^|\/)main\.tex$/i.test(k) ? 5 : 0) - k.split('/').length})).sort((a, b) => b.s - a.s)[0].k;
  }
  function resolveFile(g, parsed, byLower) {                         // where the file named in \includegraphics lives in the zip
    const dirs = [...new Set(['', dirOf(g.file), ...parsed.gp].map(d => norm(d)))], tok = g.token.replace(/^\.\//, '');
    const exts = IMG_EXT.test(tok) ? [''] : EXTS;
    for (const d of dirs.map(d => (d ? d + '/' : '')).concat([''])) for (const e of exts) { const k = byLower.get(norm(d + tok + e).toLowerCase()); if (k) return k; }
    return null;
  }

  /* ================= pictures: fingerprints of the source files and of the tracked plots ================= */
  const FPC = new Map();                                             // plot version id -> fingerprint
  const loadImg = url => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('decode')); i.src = url; });
  async function versionFp(v) {
    if (FPC.has(v.id)) return FPC.get(v.id);
    let fp = null; try { fp = SCAN.fingerprint(await loadImg(await imageUrl(v))); } catch { fp = null; }
    FPC.set(v.id, fp); return fp;
  }
  const versionsOf = pid => S.versions.filter(v => v.plotId === pid).sort(byVer);
  const ensureFps = async pid => { for (const v of versionsOf(pid)) await versionFp(v); };
  async function sourceFp(entry) {                                   // fingerprint + thumbnail of a figure file in the zip
    const ext = extOf(entry.name), bytes = await entry.data();
    try {
      let cv;
      if (ext === '.pdf') {
        await PDF.ensure(); const doc = await pdfjsLib.getDocument({data: bytes.slice()}).promise, page = await doc.getPage(1), vp0 = page.getViewport({scale: 1}), k = Math.min(3, 700 / Math.max(vp0.width, vp0.height)), vp = page.getViewport({scale: k});
        cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height); const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); await page.render({canvasContext: g, viewport: vp}).promise;
      } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) {
        const mime = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml'}[ext], url = URL.createObjectURL(new Blob([bytes], {type: mime})), im = await loadImg(url);
        cv = document.createElement('canvas'); cv.width = im.naturalWidth || 600; cv.height = im.naturalHeight || 400; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      } else return null;
      return {fp: SCAN.fingerprint(cv), thumb: SCAN.thumb(cv, 120), big: SCAN.thumb(cv, 800)};
    } catch { return null; }
  }

  /* ================= matching a source figure to a tracked plot ================= */
  function statusOf(row) {                                           // what the source has, compared with the tracked plot
    if (!row.zipPath) return {key: 'missing', text: 'File not found in the zip', cls: ''};
    if (!row.plotId) return {key: 'none', text: 'Not a tracked plot', cls: ''};
    const vs = versionsOf(row.plotId); if (!vs.length) return {key: 'none', text: 'Not a tracked plot', cls: ''};
    const latest = vs[vs.length - 1];
    if (!row.fp) return {key: 'unknown', text: `Cannot compare the picture (${extOf(row.zipPath) || 'file'}); tracker has ${verLabel(latest)}`, cls: ''};
    const ds = vs.map(v => ({v, fp: FPC.get(v.id)})).filter(x => x.fp).map(x => ({v: x.v, d: SCAN.dist(row.fp, x.fp)})).sort((a, b) => a.d - b.d);
    if (!ds.length) return {key: 'unknown', text: 'Cannot compare the picture', cls: ''};
    const best = ds[0].d, near = ds.filter(x => x.d <= SAME && x.d <= best + WINDOW);
    if (near.some(x => x.v.id === latest.id)) return {key: 'current', text: `Up to date (${verLabel(latest)})`, cls: 'resolved'};
    if (near.length) { const at = near[0].v; return {key: 'outdated', text: `Newer version available: the source has ${verLabel(at)}, tracker has ${verLabel(latest)}`, cls: 'pending', at}; }
    return {key: 'differs', text: `Different from every tracked version (best match ${Math.round((1 - best) * 100)}% similar). Tracker has ${verLabel(latest)}`, cls: 'pending'};
  }
  async function poolMatch(fp, pool) {                               // plots whose picture looks like the source figure
    const per = new Map();
    for (const r of pool) { if (Math.abs(Math.log(fp.ar / r.fp.ar)) > 0.4) continue; const d = SCAN.dist(fp, r.fp); if (!per.has(r.pid) || per.get(r.pid) > d) per.set(r.pid, d); }
    const l = [...per.entries()].sort((a, b) => a[1] - b[1]);
    if (!l.length) return null; const [pid, d] = l[0], second = l[1] ? l[1][1] : 1;
    return d <= 0.10 && (d <= 0.05 || second - d >= 0.03) ? pid : null;
  }

  /* ================= part 1: the LaTeX source ================= */
  function chooseSource() {
    openModal({title: 'Update figures in the LaTeX source', submit: 'Read the source',
      sub: 'Upload the zip of the AN’s LaTeX source (Overleaf: <b>Menu → Download → Source</b>). It is read in your browser and not uploaded anywhere.',
      body: `<div class="f"><label class="l">AN source (.zip)</label><input type="file" name="zip" accept=".zip,application/zip"></div>
        <p class="meta">You will see every figure of the AN, which tracked plot it is, and which ones are outdated. Then you can download the changed figures under the exact paths the .tex uses, or the whole source with those figures already replaced.</p>`,
      onSubmit: async fd => { const f = fd.get('zip'); if (!f || !f.size) throw new Error('Choose the source .zip file.'); setTimeout(() => analyse(f), 0); }});
  }
  async function analyse(file) {
    const done = busy('Reading the source…');
    let entries, parsed, main, rows;
    try {
      entries = await readZip(file);
      const byLower = new Map(entries.map(e => [e.name.toLowerCase(), e.name])), byName = new Map(entries.map(e => [e.name, e]));
      const texFiles = new Map(); for (const e of entries) if (/\.tex$/i.test(e.name)) texFiles.set(e.name, new TextDecoder().decode(await e.data()));
      main = findMain(texFiles); if (!main) throw new Error('No LaTeX main file (a .tex file with \\documentclass) was found in the zip.');
      parsed = parseTex(texFiles, main);
      if (!parsed.graphics.length) throw new Error('No \\includegraphics lines were found. If your figures are inserted through your own macro, tell me how they are written.');
      // one row per figure file
      const rowMap = new Map();
      for (const g of parsed.graphics) { const zp = resolveFile(g, parsed, byLower), key = zp || ('?' + g.token); if (!rowMap.has(key)) rowMap.set(key, {zipPath: zp, token: g.token, uses: [], caption: g.caption, label: g.label, figNo: g.figNo}); rowMap.get(key).uses.push(g); }
      rows = [...rowMap.values()];
      // tracked plots: names
      const keyPlots = new Map(); const addKey = (k, pid) => { if (!k) return; if (!keyPlots.has(k)) keyPlots.set(k, new Set()); keyPlots.get(k).add(pid); };
      S.plots.forEach(p => { addKey(nk(p.name), p.id); S.versions.filter(v => v.plotId === p.id).forEach(v => addKey(nk(v.fileName), p.id)); });
      let pool = null;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]; done.set(`Looking at figure ${i + 1} of ${rows.length}…`);
        const e = r.zipPath && byName.get(r.zipPath); r.entry = e || null;
        const sf = e ? await sourceFp(e) : null; r.fp = sf ? sf.fp : null; r.thumb = sf ? sf.thumb : ''; r.big = sf ? sf.big : '';
        const remembered = r.zipPath && S.srcMap[r.zipPath], cand = keyPlots.get(nk(r.zipPath ? baseOf(r.zipPath) : r.token));
        if (remembered && plot(remembered)) { r.plotId = remembered; r.how = 'remembered'; }
        else if (cand && cand.size) {
          let pid = [...cand][0];
          if (cand.size > 1 && r.fp) { let bd = 9; for (const q of cand) { await ensureFps(q); const d = Math.min(...versionsOf(q).map(v => FPC.get(v.id) ? SCAN.dist(r.fp, FPC.get(v.id)) : 9)); if (d < bd) { bd = d; pid = q; } } }
          r.plotId = pid; r.how = 'name';
        } else if (r.fp) {
          if (!pool) {
            pool = []; const vs = S.versions.length <= 400 ? S.versions : S.plots.map(p => SCAN.latestOf(p.id)).filter(Boolean), q = [...vs]; let k = 0;
            await Promise.all(Array.from({length: 4}, async () => { while (q.length) { const v = q.shift(); const fp = await versionFp(v); if (fp) pool.push({pid: v.plotId, fp}); done.set(`Fingerprinting your plots… ${++k} of ${vs.length}`); } }));
          }
          const pid = await poolMatch(r.fp, pool); if (pid) { r.plotId = pid; r.how = 'picture'; }
        }
        if (r.plotId) await ensureFps(r.plotId);
        r.status = statusOf(r); r.use = r.status.key === 'outdated'; await sleep();
      }
    } catch (e) { done(); toast(e.message, 'err', 9000); return; }
    done();
    resultModal({file, entries, parsed, main, rows});
  }

  /* ---------- what to change, and how ---------- */
  async function plan(ctx, rows) {
    const chosen = rows.filter(r => r.use && r.plotId && r.zipPath), put = new Map(), del = new Set(), edits = [], notes = [], seenPlot = new Map();
    for (const r of chosen) {
      const vs = versionsOf(r.plotId), v = vs[vs.length - 1], newExt = (v.ext || '.png').toLowerCase(), oldExt = extOf(r.zipPath);
      if (seenPlot.has(r.zipPath)) continue; seenPlot.set(r.zipPath, 1);
      const target = newExt === oldExt ? r.zipPath : r.zipPath.slice(0, r.zipPath.length - oldExt.length) + newExt;
      if (put.has(target)) { notes.push(`${r.zipPath}: skipped, another figure already writes to ${target}.`); continue; }
      put.set(target, {v, row: r});
      if (target !== r.zipPath) {
        del.add(r.zipPath);
        r.uses.forEach(g => { if (IMG_EXT.test(g.token)) edits.push({file: g.file, from: g.token, to: g.token.slice(0, g.token.length - extOf(g.token).length) + newExt}); });
        notes.push(`${r.zipPath}: the tracked plot is a ${newExt} file, so the figure is now ${target} and the old ${oldExt} file is removed${r.uses.some(g => IMG_EXT.test(g.token)) ? ' (and the extension is changed in the .tex)' : ''}.`);
      }
    }
    return {put, del, edits, notes, chosen};
  }
  async function bytesOf(v) { return new Uint8Array(await (await fetch(await imageUrl(v))).arrayBuffer()); }
  const csvLine = a => a.map(x => { const s = String(x == null ? '' : x); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',');
  function notesTxt(ctx, pl, whole) {
    const L = [`Figure update for ${S.an.an_name || S.an.title} — made ${today()} by the Analysis-Tracker`, '', whole ? 'This zip is your AN source with the figures below already replaced. Upload it to Overleaf (New Project → Upload Project), or copy the changed files over your own copy.' : 'Copy these files over the same paths in your AN source (Overleaf: upload them into the same folders, replacing the old ones).', ''];
    L.push(`Figures replaced (${pl.put.size}):`); pl.put.forEach((x, path) => L.push(`  - ${path}   ←   ${plot(x.v.plotId).name} ${verLabel(x.v)} (${x.v.fileName})`));
    if (pl.del.size) { L.push('', whole ? 'Old files removed from the source:' : 'Delete these old files from the source (a leftover copy can be used instead of the new one):'); pl.del.forEach(p => L.push('  - ' + p)); }
    if (pl.edits.length) { L.push('', whole ? 'Changed in the .tex files:' : 'Edit these lines in the .tex files:'); pl.edits.forEach(e => L.push(`  - ${e.file}: ${e.from}  →  ${e.to}`)); }
    if (pl.notes.length) { L.push('', 'Notes:'); pl.notes.forEach(n => L.push('  - ' + n)); }
    L.push('', 'Figures not in this list were left untouched.');
    return L.join('\n');
  }
  async function rememberMap(rows) {
    const map = {}; rows.forEach(r => { if (!r.zipPath) return; if (r.plotId) { if (S.srcMap[r.zipPath] !== r.plotId) map[r.zipPath] = r.plotId; } else if (S.srcMap[r.zipPath]) map[r.zipPath] = null; });
    if (Object.keys(map).length) { try { await api('POST', aurl('/source-map'), {map}); Object.entries(map).forEach(([k, v]) => { if (v) S.srcMap[k] = v; else delete S.srcMap[k]; }); } catch { /* not essential */ } }
  }
  async function download(ctx, rows, whole) {
    const pl = await plan(ctx, rows); if (!pl.put.size) throw new Error('Tick at least one figure that has a newer plot to put in.');
    const done = busy('Preparing the files…'), enc = new TextEncoder(), files = [];
    try {
      let i = 0; const put = [...pl.put.entries()];
      for (const [path, x] of put) { done.set(`Collecting figures… ${++i} of ${put.length}`); files.push({name: path, data: await bytesOf(x.v)}); }
      if (whole) {
        const edited = new Map(); pl.edits.forEach(e => { const f = edited.get(e.file) || {}; f[e.from] = e.to; edited.set(e.file, f); });
        const rest = []; let k = 0;
        for (const e of ctx.entries) {
          if (pl.del.has(e.name) || pl.put.has(e.name)) continue; done.set(`Copying the source… ${++k} of ${ctx.entries.length}`);
          let data = await e.data(); if (edited.has(e.name)) { let t = new TextDecoder().decode(data); Object.entries(edited.get(e.name)).forEach(([a, b]) => { t = t.split('{' + a + '}').join('{' + b + '}'); }); data = enc.encode(t); }
          rest.push({name: e.name, data});
        }
        files.unshift(...rest);
      }
      files.push({name: whole ? '_figure_update_notes.txt' : 'README_UPDATE.txt', data: enc.encode(notesTxt(ctx, pl, whole))});
      if (!whole) files.push({name: 'Figure_map.csv', data: enc.encode([csvLine(['path in the source', 'tracked plot', 'version put in', 'source had']), ...[...pl.put.entries()].map(([p, x]) => csvLine([p, plot(x.v.plotId).name, verLabel(x.v), x.row.status.at ? verLabel(x.row.status.at) : x.row.status.key]))].join('\n'))});
      const name = whole ? ctx.file.name.replace(/\.zip$/i, '') + '_figures_updated.zip' : 'Updated_figures_' + today() + '.zip';
      dl(REL.zipBlob(files), name); await rememberMap(rows);
      toast(`${name}: ${pl.put.size} figure${pl.put.size === 1 ? '' : 's'} ${whole ? 'replaced in the source' : 'ready to copy in'}${pl.del.size ? `, ${pl.del.size} old file${pl.del.size === 1 ? '' : 's'} to remove` : ''}. The notes are inside.`, '', 9000);
    } finally { done(); }
  }

  function resultModal(ctx) {
    const rows = ctx.rows, cnt = k => rows.filter(r => r.status.key === k).length;
    const opts = pid => `<option value="">— not a tracked plot —</option>` + (pid ? `<option value="${pid}" selected>${esc(plot(pid).name)}</option>` : '');
    const row = (r, i) => { const vs = r.plotId ? versionsOf(r.plotId) : [], latest = vs[vs.length - 1];
      return `<div class="card pad anfrow" data-i="${i}"><input type="checkbox" class="anfuse" ${r.use ? 'checked' : ''} ${r.plotId && r.zipPath ? '' : 'disabled'} title="Put the newest tracked plot into the source">
        <div class="sth" title="${r.thumb ? 'The figure in the source: click to enlarge' : ''}">${r.thumb ? `<img src="${r.thumb}" alt="In the source" data-zoom="src"><span class="meta">in the source</span>` : '<span class="meta">no preview</span>'}</div>
        <div class="sth mine">${latest ? `${img(latest)}<span class="meta">tracker ${verLabel(latest)}</span>` : '<span class="meta">—</span>'}</div>
        <div style="min-width:0"><code class="anfpath">${esc(r.zipPath || r.token)}</code> ${r.uses.length > 1 ? `<span class="meta">(used ${r.uses.length}×)</span>` : ''}
          <div class="meta">${r.figNo ? 'Figure #' + r.figNo + ' in the source' : 'not inside a figure'}${r.caption ? ' · ' + esc(r.caption.slice(0, 110)) : ''}</div>
          <div style="margin-top:4px"><select class="anfsel" data-i="${i}">${opts(r.plotId)}</select> <span class="badge ${r.status.cls}">${esc(r.status.text)}</span>${r.how ? ` <span class="meta">matched by ${r.how === 'remembered' ? 'an earlier confirmation' : r.how === 'name' ? 'file name' : 'the picture'}</span>` : ''}</div></div></div>`; };
    const order = [...rows.keys()].sort((a, b) => ({outdated: 0, differs: 1, unknown: 2, none: 3, missing: 4, current: 5}[rows[a].status.key] - {outdated: 0, differs: 1, unknown: 2, none: 3, missing: 4, current: 5}[rows[b].status.key]) || a - b);
    const m = openModal({title: 'Figures in the AN source', xl: true, submit: 'Download the source with figures replaced',
      sub: `<b>${rows.length}</b> figure files in <b>${esc(ctx.main)}</b>: <b>${cnt('outdated')}</b> outdated, <b>${cnt('current')}</b> up to date, <b>${cnt('differs') + cnt('unknown')}</b> to check, <b>${cnt('none')}</b> not tracked${cnt('missing') ? `, <b>${cnt('missing')}</b> missing from the zip` : ''}.${ctx.parsed.unresolved.length ? ` ${ctx.parsed.unresolved.length} figure line${ctx.parsed.unresolved.length === 1 ? '' : 's'} use a macro and could not be read.` : ''} Outdated ones are ticked. Nothing is changed in your tracker, and your source is not modified.`,
      body: `<div class="scanlist anflist">${order.map(i => row(rows[i], i)).join('')}</div>
        <div class="actions" style="margin-top:10px"><button type="button" class="btn" id="anf-only">Download only the changed figures</button><span class="meta">(under the exact paths the .tex uses, with notes)</span></div>`,
      setup: f => {
        hydrateImages();
        f.addEventListener('click', e => { const t = e.target; if (t.matches('img[data-zoom=src]')) { const r = rows[+t.closest('.anfrow').dataset.i]; if (r.big) lightbox(r.big); } else if (t.matches('.sth.mine img') && t.dataset.ok) lightbox(t.src); });
        f.addEventListener('mousedown', e => { const s = e.target; if (!s.matches('.anfsel') || s.dataset.full) return; s.dataset.full = 1; const cur = s.value;
          s.innerHTML = opts('') + [...S.plots].sort((a, b) => (catPath(a.catId) + a.name).localeCompare(catPath(b.catId) + b.name, undefined, {numeric: true})).map(p => `<option value="${p.id}">${esc(catPath(p.catId) ? catPath(p.catId) + ' / ' : '')}${esc(p.name)}</option>`).join(''); s.value = cur; });
        f.addEventListener('change', async e => {
          const s = e.target, card = s.closest('.anfrow'); if (!card) return;
          if (s.matches('.anfuse')) { rows[+card.dataset.i].use = s.checked; return; }
          if (!s.matches('.anfsel')) return; const r = rows[+card.dataset.i]; r.plotId = s.value || null; r.how = ''; if (r.plotId) await ensureFps(r.plotId); r.status = statusOf(r); r.use = r.status.key === 'outdated';
          const vs = r.plotId ? versionsOf(r.plotId) : [], latest = vs[vs.length - 1];
          card.querySelector('.mine').innerHTML = latest ? `${img(latest)}<span class="meta">tracker ${verLabel(latest)}</span>` : '<span class="meta">—</span>'; hydrateImages();
          const b = card.querySelector('.badge'); b.className = 'badge ' + r.status.cls; b.textContent = r.status.text; const cb = card.querySelector('.anfuse'); cb.checked = r.use; cb.disabled = !(r.plotId && r.zipPath);
        });
        f.querySelector('#anf-only').onclick = async e => { const b = e.target; b.disabled = true; try { await download(ctx, rows, false); } catch (err) { toast(err.message, 'err', 8000); } b.disabled = false; };
      },
      onSubmit: async () => { await download(ctx, rows, true); return false; }});
  }

  /* ================= part 2: references in the replies ================= */
  const refRe = name => new RegExp('\\s*\\(→ ' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^)]*\\)', 'g');
  const nfig = s => String(s).toLowerCase().replace(/[a-z]$/, '');
  async function pickPdf() {
    const w = S.work && S.work.pdf && S.work.pdf.file_id ? S.work.pdf : null;
    if (w) { const done = busy('Opening the new AN PDF…'); try { await PDF.ensure(); const bytes = new Uint8Array(await (await fetch(await fetchImage(S.an.id, w.file_id, w.ext || '.pdf'))).arrayBuffer()); return {doc: await pdfjsLib.getDocument({data: bytes}).promise, name: w.name}; } finally { done(); } }
    return new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'application/pdf,.pdf'; i.onchange = async () => { const f = i.files[0]; if (!f) return res(null); await PDF.ensure(); res({doc: await pdfjsLib.getDocument({data: new Uint8Array(await f.arrayBuffer())}).promise, name: f.name}); }; i.click(); });
  }
  async function refs() {
    const wname = REL.workingName(), last = S.anv.length ? S.anv.slice().sort((a, b) => b.number - a.number)[0] : null;
    toast(S.work && S.work.pdf ? 'Reading the new AN PDF…' : 'Choose the new AN PDF.', '', 3000);
    let src; try { src = await pickPdf(); } catch (e) { toast('Could not open the PDF: ' + e.message, 'err', 8000); return; }
    if (!src) return;
    let res; try { res = await SCAN.scan(src.doc, null, {latest: true}); } catch (e) { toast('The scan failed: ' + e.message, 'err', 8000); return; }
    if (!res.figures.length) { toast('No figure captions were found in this PDF. Captions need to look like “Figure 4.2: …”.', 'err', 9000); return; }
    const where = new Map();                                         // plot id -> where it is in the new AN
    res.figures.forEach(f => f.rows.filter(r => r.plotId).sort((a, b) => (a.conf === 'high' ? 0 : 1) - (b.conf === 'high' ? 0 : 1)).forEach(r => { if (!where.has(r.plotId)) where.set(r.plotId, f); }));
    const fmt = f => `Fig. ${f.fig}, p. ${f.label}`, strip = t => (t || '').replace(refRe(wname), '').trim(), items = [], skipped = [];
    S.usages.filter(u => u.type === 'note').forEach(u => u.reviews.filter(r => !r.none).forEach(r => {
      const revised = [r.resolvedVersionId, ...(r.resolvedMore || [])].map(id => id && ver(id)).filter(Boolean), pend = revised.filter(v => !v.anvId);
      const touched = [...new Set(pend.map(v => v.plotId))], base = ver(u.versionId); let parts = [], missing = [];
      if (touched.length) touched.forEach(pid => { const f = where.get(pid); if (f) parts.push(fmt(f)); else missing.push(plot(pid).name); });
      else if (last && u.anvId === last.id && base) { const f = where.get(base.plotId); if (f && nfig(f.fig) !== nfig(u.fig)) parts.push('now ' + fmt(f)); else return; }
      else return;
      const label = `${u.fig ? 'Figure ' + u.fig : plot(base.plotId).name}${u.panel && r.scope !== 'figure' ? ' (' + u.panel + ')' : ''}`;
      if (!parts.length) { skipped.push({label, r, why: `${missing.join(', ')} was not found in this PDF`}); return; }
      if (!(r.answer || '').trim()) { skipped.push({label, r, why: 'no written reply yet (write the reply first)'}); return; }
      const add = `(→ ${wname}: ${[...new Set(parts)].join('; ')})`, next = strip(r.answer) + ' ' + add;
      items.push({r, label, add, next, same: next === (r.answer || '').trim()});
    }));
    const locs = S.plots.map(p => ({p, f: where.get(p.id)})).filter(x => x.f).map(x => ({p: x.p, text: `Fig ${x.f.fig} · p. ${x.f.label}${x.f.section ? ' · ' + x.f.section.slice(0, 60) : ''}`})).filter(x => x.p.location !== x.text);
    if (!items.length && !skipped.length && !locs.length) { toast(`Nothing to add: no reply needs a reference, and the locations are already right (${res.figures.length} figures found in ${src.name}).`, '', 9000); return; }
    const one = (t, n) => esc(t.length > n ? t.slice(0, n) + '…' : t);
    openModal({title: `Figure references from ${esc(src.name)}`, xl: true, submit: 'Add the checked references',
      sub: `${res.figures.length} figures found; ${where.size} of your plots located. Each reply below gets the reference added at its end. Nothing is saved until you confirm.`,
      body: `<div class="scanlist">${items.map((x, i) => `<div class="card pad"><label style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" name="r${i}" ${x.same ? '' : 'checked'}><span style="min-width:0"><b>${esc(x.label)}</b> <span class="meta">${esc(whoStr(x.r))}</span> “${one(x.r.text, 140)}”<br><span class="meta">Reply: ${one(strip(x.r.answer), 200)}</span><br><b>+ ${esc(x.add)}</b> ${x.same ? '<span class="badge resolved">already there</span>' : ''}</span></label></div>`).join('')}
        ${skipped.map(x => `<div class="card pad"><b>${esc(x.label)}</b> <span class="meta">${esc(whoStr(x.r))}</span> “${one(x.r.text, 120)}” <span class="badge">skipped</span> <span class="meta">${esc(x.why)}</span></div>`).join('')}
        ${locs.length ? `<div class="card pad"><label style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" name="loc" checked><span><b>Update “location in the AN” for ${locs.length} plot${locs.length === 1 ? '' : 's'}</b><br><span class="meta">${locs.slice(0, 8).map(x => esc(x.p.name) + ' → ' + esc(x.text)).join('<br>')}${locs.length > 8 ? '<br>…' : ''}</span></span></label></div>` : ''}</div>`,
      onSubmit: async fd => {
        const todo = items.filter((x, i) => fd.get('r' + i)), upLoc = fd.get('loc') && locs.length;
        if (!todo.length && !upLoc) throw new Error('Nothing is ticked.');
        await batch(async () => { for (const x of todo) await api('POST', aurl(`/reviews/${x.r.id}/answer`), {answer: x.next}); if (upLoc) for (const x of locs) await api('PATCH', aurl('/plots/' + x.p.id), {location: x.text}); });
        await reload(); toast(`${todo.length} repl${todo.length === 1 ? 'y' : 'ies'} updated${upLoc ? `, ${locs.length} AN location${locs.length === 1 ? '' : 's'} refreshed` : ''}.`, '', 7000);
      }});
  }

  /* ================= the card on the Release page ================= */
  const card = () => `<div class="sechead"><h2>Finishing the review round</h2></div>
    <div class="card pad"><p style="margin-top:0" class="meta">Two helpers that save the copying between the tracker and your LaTeX. They only read your files here; nothing is uploaded.</p>
      <div class="two"><div><b>1 · Before you compile</b><p class="meta" style="margin:4px 0 8px">Upload the AN’s LaTeX source (zip). You get the updated plots under the exact file names the .tex uses, or the whole source with the figures already replaced.</p><button class="btn" data-act="anf" data-op="source">Update figures in the LaTeX source</button></div>
      <div><b>2 · After the new AN PDF is ready</b><p class="meta" style="margin:4px 0 8px">Finds where each revised plot ended up and adds “(→ ${esc(REL.workingName())}: Fig. 4.2, p. 13)” to your replies. Also refreshes each plot’s location in the AN.</p><button class="btn" data-act="anf" data-op="refs">Add figure references to the replies</button></div></div></div>`;
  window.ANF = {card, act: el => { if (el.dataset.op === 'source') chooseSource(); else if (el.dataset.op === 'refs') refs(); }, readZip, parseTex, findMain, statusOf};
})();
