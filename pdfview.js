/*! Analysis-Tracker - Copyright (c) 2026 Sanskar Nanda - MIT License (see LICENSE). https://github.com/Sanskar-hep */
/* AN PDF viewer with highlights.
 * The PDF is opened from the user's computer and never uploaded. What is saved is only where a comment points:
 * page number + rectangles as fractions of the page (so they line up at any zoom) + the highlighted text.
 * Uses the app's globals (S, api, aurl, openModal, field, ...) at call time. */
(function () {
  'use strict';
  const PDFV = {error: '', vid: null, doc: null, fp: null, match: null, tool: 'text', zoom: 1, placing: null, jump: null, scale: 1, io: null};

  /* A copy of the PDF is kept in this browser (IndexedDB) so it reopens by itself, even after the page is reloaded or the
     phone drops the tab. It is stored on this device only and never uploaded. */
  const key = vid => `${S.an.id}:${vid}`;
  const pdfDb = () => new Promise((res, rej) => { const r = indexedDB.open('analysis-tracker-pdfs', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const dbDo = async (mode, fn) => { const db = await pdfDb(); return new Promise((res, rej) => { const t = db.transaction('files', mode), q = fn(t.objectStore('files')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  async function saveCopy(vid, file) {
    try {
      await dbDo('readwrite', s => s.put({name: file.name, size: file.size, saved: Date.now(), blob: file}, key(vid)));
      const all = await dbDo('readonly', s => s.getAllKeys()); if (all.length > 6) {            // keep only the 6 most recent
        const rows = await Promise.all(all.map(async k => ({k, v: await dbDo('readonly', s => s.get(k))})));
        rows.sort((a, b) => (b.v?.saved || 0) - (a.v?.saved || 0)); for (const r of rows.slice(6)) await dbDo('readwrite', s => s.delete(r.k));
      }
      PDFV.saved = true; if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch { PDFV.saved = false; }
  }
  const loadCopy = async vid => { try { return await dbDo('readonly', s => s.get(key(vid))); } catch { return null; } };
  const dropCopy = vid => dbDo('readwrite', s => s.delete(key(vid))).catch(() => {});
  async function clearAll() { try { await dbDo('readwrite', s => s.clear()); } catch {} PDFV.saved = false; PDFV.doc = null; }

  const loadScript = src => new Promise((res, rej) => {
    if (window.pdfjsLib) return res();
    const s = document.createElement('script'); s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('Could not load the PDF viewer files (vendor/pdfjs).')); document.head.appendChild(s);
  });
  async function ensureLib() { await loadScript('vendor/pdfjs/pdf.min.js'); pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js'; }

  /* everything in this AN version that can point into the PDF */
  function items(vid) {
    const out = [];
    S.anc.filter(c => c.source === 'an' && c.anvId === vid).forEach(c => out.push({kind: 'anc', id: c.id, text: c.text, label: c.location || COMMENT_KINDS[c.kind] || 'Comment', who: whoStr(c), status: c.status, answer: c.answer, anchor: c.anchor}));
    S.usages.filter(u => u.type === 'note' && u.anvId === vid).forEach(u => u.reviews.filter(r => !r.none).forEach(r => out.push({kind: 'rev', id: r.id, text: r.text, label: 'Fig ' + u.fig + (u.panel && r.scope !== 'figure' ? ' · ' + u.panel : ''), who: whoStr(r), status: r.status, answer: r.answer, anchor: r.anchor})));
    return out;
  }
  const cls = it => it.status === 'resolved' ? 'resolved' : it.status === 'in_progress' ? 'inprogress' : (it.answer || '').trim() ? 'answered' : 'pending';

  async function openFile(file, fromStore) {
    await ensureLib();
    PDFV.file = file; const fp = await pdfFingerprint(file), v = anv(PDFV.vid);
    const doc = await pdfjsLib.getDocument({data: new Uint8Array(await file.arrayBuffer())}).promise;
    fp.pages = doc.numPages; PDFV.fp = fp; PDFV.doc = doc; PDFV.match = v.pdf ? v.pdf.sha256 === fp.sha256 : null;
    if (fromStore) PDFV.saved = true; else if (PDFV.match !== false) await saveCopy(PDFV.vid, file);   // a mismatching file is stored only if you choose to record it
  }

  /* ---------------- page ---------------- */
  function viewPdf(vid) {
    const v = anv(vid); if (!v) return notFound();
    if (PDFV.vid !== vid) Object.assign(PDFV, {vid, doc: null, fp: null, match: null, placing: null, scroll: 0, restoreTried: false, saved: false, file: null});
    const its = items(vid), todo = its.filter(i => !i.anchor), done = its.filter(i => i.anchor);
    const rec = v.pdf ? `${esc(v.pdf.name)} · ${(v.pdf.size / 1048576).toFixed(1)} MB` : '';
    const err = PDFV.error ? `<div class="banner"><span><b>The PDF could not be opened.</b> ${esc(PDFV.error)}</span></div>` : '';
    const head = `<div class="crumbs"><a href="${L('')}">Dashboard</a> / <a href="${L('/reviewer')}" data-act="to-review" data-id="${vid}">AN review</a> / PDF</div>
      <div class="pagehead"><div><h1>${anvLabel(v)} · PDF</h1><p>Open the PDF from your device. It is only shown here, never uploaded. Highlight what the convenors mentioned and attach the comment.</p></div>
      <div class="actions"><label class="btn primary" style="cursor:pointer">${PDFV.doc ? 'Choose another PDF' : 'Choose the PDF…'}<input id="pdffile" type="file" accept="application/pdf,.pdf" hidden></label>${PDFV.saved ? '<button class="btn" data-act="pdf" data-op="forget" title="Delete the copy kept in this browser">Remove saved copy</button>' : ''}</div></div>`;
    const stored = v.pdf && v.pdf.file_id;
    const saved = (stored ? `<div class="meta" style="margin:-10px 0 14px">✔ Stored in your private data repository: it opens on every device and for your group.${PDFV.saved ? ' A copy is also kept in this browser for speed.' : ''} <button class="link" data-act="pdf" data-op="unstore">Remove it from the repository</button></div>`
      : PDFV.saved ? `<div class="meta" style="margin:-10px 0 14px">A copy is kept in this browser so it reopens by itself (never uploaded). Use <b>Remove saved copy</b> to delete it.</div>` : '');
    if (!PDFV.doc) return head + err + `<div class="card empty pdfpick"><p style="margin:0 0 6px"><b>Choose the PDF of ${anvLabel(v)}</b></p><p class="meta" style="margin:0">${rec ? 'Expected file: <span class="mono">' + rec + '</span>. The tracker checks a fingerprint so you open the right one.' : 'No PDF has been recorded for this version yet. The first one you open can be recorded.'}</p></div>`
      + (its.length ? `<div class="sechead"><h2>Comments waiting to be placed <span class="count">${todo.length}</span></h2></div>${todo.map(i => sideItem(i, false)).join('') || '<div class="card empty">All comments are placed.</div>'}` : '');
    const warn = PDFV.match === false ? `<div class="banner"><span><b>This is not the recorded file.</b> It differs from ${rec}. Highlights may not line up with the pages.</span><span class="actions"><button class="btn sm" data-act="pdf" data-op="record">Record this file instead</button></span></div>`
      : PDFV.match !== false && !stored && PDFV.file ? `<div class="banner draft"><span><b>This PDF is only on this device.</b> Store it in your private data repository to open it on your other devices and share it with the group.</span><span class="actions"><button class="btn sm primary" data-act="pdf" data-op="store">Store in the repository</button>${PDFV.match === null ? '<button class="btn sm" data-act="pdf" data-op="record">Only record the fingerprint</button>' : ''}</span></div>`
      : PDFV.match === null ? `<div class="banner draft"><span>No PDF is recorded for ${anvLabel(v)} yet.</span><span class="actions"><button class="btn sm primary" data-act="pdf" data-op="record">Record this file (${esc(PDFV.fp.name)})</button></span></div>` : '';
    const placing = PDFV.placing ? (() => { const it = its.find(i => i.kind === PDFV.placing.kind && i.id === PDFV.placing.id); return it ? `<div class="banner draft"><span><b>Placing:</b> ${esc(it.label)} — “${esc(it.text.length > 90 ? it.text.slice(0, 90) + '…' : it.text)}”. Select the text, or switch to <b>Draw a box</b> for a figure or table.</span><span class="actions"><button class="btn sm" data-act="pdf" data-op="cancel">Cancel</button></span></div>` : ''; })() : '';
    return `${head}${saved}${warn}${placing}
      <div class="pdftools"><div class="modes"><button class="${PDFV.tool === 'text' ? 'on' : ''}" data-act="pdf" data-op="tool" data-id="text">Highlight text</button><button class="${PDFV.tool === 'box' ? 'on' : ''}" data-act="pdf" data-op="tool" data-id="box">Draw a box</button></div>
        <span class="meta">${PDFV.doc.numPages} pages</span><span class="spacer"></span><button class="btn sm" data-act="pdf" data-op="zoomout">−</button><span class="meta">${Math.round(PDFV.zoom * 100)}%</span><button class="btn sm" data-act="pdf" data-op="zoomin">+</button></div>
      <div class="pdfwrap"><div id="pdfpane" class="pdfpane ${PDFV.tool === 'box' ? 'tool-box' : ''}"></div>
        <aside class="pdfside"><div class="sechead" style="margin-top:0"><h2>To place <span class="count">${todo.length}</span></h2></div>${todo.map(i => sideItem(i, false)).join('') || '<div class="meta" style="margin-bottom:12px">All comments are placed.</div>'}
        <div class="sechead"><h2>Placed <span class="count">${done.length}</span></h2></div>${done.map(i => sideItem(i, true)).join('') || '<div class="meta">Nothing placed yet.</div>'}</aside></div>`;
  }
  function sideItem(i, placed) {
    return `<div class="pitem ${cls(i)}" id="pi-${i.id}"><div class="who"><span class="badge stage">${esc(i.label)}</span> <span class="meta">${esc(i.who)}</span></div>
      <div class="ptxt">${esc(i.text.length > 160 ? i.text.slice(0, 160) + '…' : i.text)}</div>
      <div class="pbtn">${placed ? `<button class="btn sm" data-act="pdf" data-op="goto" data-kind="${i.kind}" data-id="${i.id}">Go to page ${i.anchor.page}</button><button class="btn sm" data-act="pdf" data-op="place" data-kind="${i.kind}" data-id="${i.id}">Move</button><button class="iconbtn" title="Remove the highlight" data-act="pdf" data-op="unplace" data-kind="${i.kind}" data-id="${i.id}">✕</button>`
        : `<button class="btn sm primary" data-act="pdf" data-op="place" data-kind="${i.kind}" data-id="${i.id}" ${PDFV.doc ? '' : 'disabled title="Open the PDF first"'}>Place in PDF</button>`}</div></div>`;
  }

  /* ---------------- pages (rendered lazily while scrolling) ---------------- */
  function mountPdf() {
    const f = $('#pdffile'); if (f) f.onchange = async () => {
      if (!f.files[0]) return; const done = busy('Opening the PDF…');
      try { PDFV.error = ''; await openFile(f.files[0]); render(); } catch (e) { PDFV.error = (e && e.message) || String(e); render(); toast('Could not open this PDF: ' + PDFV.error, 'err', 10000); } finally { done(); }
    };
    if (PDFV.doc) { buildPages(); return; }
    if (!PDFV.restoreTried) {                                    // 1) the copy on this device, 2) the copy stored in the repository
      PDFV.restoreTried = true; const vid = PDFV.vid, v = anv(vid);
      (async () => {
        const stored = v && v.pdf && v.pdf.file_id;
        const c = await loadCopy(vid);
        if (c && c.blob) {
          const done = busy('Opening your saved copy of the PDF…');
          try { await openFile(new File([c.blob], c.name, {type: 'application/pdf'}), true); if (PDFV.match !== false || !stored) { render(); return; } PDFV.doc = null; } catch { await dropCopy(vid); PDFV.saved = false; } finally { done(); }
        }
        if (stored && PDFV.vid === vid && !PDFV.doc) {
          const done = busy('Downloading the PDF from the repository…');
          try { const url = await fetchImage(S.an.id, v.pdf.file_id, v.pdf.ext); const blob = await (await fetch(url)).blob(); await openFile(new File([blob], v.pdf.name, {type: 'application/pdf'})); render(); }
          catch (e) { PDFV.error = 'The stored PDF could not be downloaded: ' + (e.message || e); render(); } finally { done(); }
        }
      })();
    }
  }
  async function buildPages() {
    const pane = $('#pdfpane'); if (!pane) return;
    const doc = PDFV.doc, p1 = await doc.getPage(1), base = p1.getViewport({scale: 1});
    PDFV.scale = Math.max(0.3, (pane.clientWidth - 24) / base.width * PDFV.zoom);
    const vp = p1.getViewport({scale: PDFV.scale});
    if (PDFV.io) PDFV.io.disconnect();
    PDFV.io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) renderPage(e.target); }), {root: pane, rootMargin: '900px 0px'});
    for (let i = 1; i <= doc.numPages; i++) {
      const d = document.createElement('div'); d.className = 'pg'; d.dataset.p = i; d.style.width = vp.width + 'px'; d.style.height = vp.height + 'px';
      d.innerHTML = `<div class="pgnum">Page ${i}</div>`; pane.appendChild(d); PDFV.io.observe(d);
    }
    pane.addEventListener('scroll', () => { PDFV.scroll = pane.scrollTop; });
    if (PDFV.jump) { const j = PDFV.jump; PDFV.jump = null; setTimeout(() => jumpTo(j.kind, j.id), 150); } else pane.scrollTop = PDFV.scroll || 0;   // stay where you were after a save
  }
  async function renderPage(d) {
    if (d.dataset.done) return; d.dataset.done = 1;
    const i = +d.dataset.p, page = await PDFV.doc.getPage(i), vp = page.getViewport({scale: PDFV.scale});
    d.style.width = vp.width + 'px'; d.style.height = vp.height + 'px';
    const dpr = window.devicePixelRatio || 1, cv = document.createElement('canvas');
    cv.width = Math.floor(vp.width * dpr); cv.height = Math.floor(vp.height * dpr); cv.style.cssText = 'width:100%;height:100%;display:block';
    d.prepend(cv);
    await page.render({canvasContext: cv.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null}).promise;
    const hl = document.createElement('div'); hl.className = 'hllayer'; d.appendChild(hl);
    const tl = document.createElement('div'); tl.className = 'textLayer'; d.appendChild(tl);
    pdfjsLib.renderTextLayer({textContentSource: await page.getTextContent(), container: tl, viewport: vp, textDivs: []});
    const bx = document.createElement('div'); bx.className = 'boxlayer'; d.appendChild(bx);
    drawHighlights(d);
  }
  function drawHighlights(d) {
    const hl = d.querySelector('.hllayer'); if (!hl) return; hl.innerHTML = '';
    const p = +d.dataset.p;
    items(PDFV.vid).filter(it => it.anchor && it.anchor.page === p).forEach(it => it.anchor.rects.forEach(r => {
      const e = document.createElement('div'); e.className = `hl ${it.anchor.kind} ${cls(it)}`; e.dataset.ref = it.kind + ':' + it.id;
      e.style.cssText = `left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%`; hl.appendChild(e);
    }));
  }
  function jumpTo(kind, id) {
    const it = items(PDFV.vid).find(x => x.kind === kind && x.id === id); if (!it || !it.anchor) return;
    const pane = $('#pdfpane'), d = pane.querySelector(`.pg[data-p="${it.anchor.page}"]`); if (!d) return;
    pane.scrollTo({top: d.offsetTop + it.anchor.rects[0].y * d.offsetHeight - 90, behavior: 'smooth'});
    setTimeout(() => { const side = $('#pi-' + id); if (side) { side.classList.add('flash'); side.scrollIntoView({block: 'nearest'}); setTimeout(() => side.classList.remove('flash'), 1800); }
      d.querySelectorAll(`.hl[data-ref="${kind}:${id}"]`).forEach(e => { e.classList.add('flash'); setTimeout(() => e.classList.remove('flash'), 1800); }); }, 400);
  }

  /* ---------------- making an anchor ---------------- */
  const norm = (r, b) => ({x: (r.left - b.left) / b.width, y: (r.top - b.top) / b.height, w: r.width / b.width, h: r.height / b.height});
  function selectionAnchor() {
    const sel = getSelection(); if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0), start = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement), pg = start && start.closest && start.closest('.pg');
    if (!pg) return null;
    const b = pg.getBoundingClientRect(), rects = [...range.getClientRects()].filter(r => r.width > 2 && r.height > 2 && r.bottom > b.top && r.top < b.bottom && r.right > b.left && r.left < b.right).map(r => norm(r, b));
    if (!rects.length) return null;
    const quote = sel.toString().replace(/\s+/g, ' ').trim().slice(0, 300);
    return {page: +pg.dataset.p, kind: 'text', rects: rects.slice(0, 80), quote};
  }
  async function commitAnchor(an) {
    if (PDFV.placing) {
      const p = PDFV.placing; PDFV.placing = null;
      await api('POST', aurl(`/${p.kind === 'anc' ? 'an-comments' : 'reviews'}/${p.id}/anchor`), {anchor: an}); await reload(); toast('Placed in the PDF'); return;
    }
    newCommentModal(an);
  }
  document.addEventListener('mouseup', e => {
    const pane = $('#pdfpane'); if (!pane || !pane.contains(e.target) || PDFV.tool !== 'text') return;
    setTimeout(() => {
      const an = selectionAnchor(); const fab = $('#pdffab'); if (fab) fab.remove(); if (!an) return;
      if (PDFV.placing) { getSelection().removeAllRanges(); commitAnchor(an).catch(err => toast(err.message, 'err')); return; }
      const b = document.createElement('button'); b.id = 'pdffab'; b.className = 'btn primary sm'; b.textContent = '＋ Comment on this'; b.style.cssText = `position:fixed;left:${Math.min(e.clientX, innerWidth - 180)}px;top:${e.clientY + 12}px;z-index:50`;
      b.onmousedown = ev => ev.preventDefault(); b.onclick = () => { b.remove(); getSelection().removeAllRanges(); commitAnchor(an).catch(err => toast(err.message, 'err')); }; document.body.appendChild(b);
    }, 10);
  });
  document.addEventListener('mousedown', e => { if (!e.target.closest('#pdffab')) $('#pdffab')?.remove(); });
  /* draw a box (figures, tables) */
  let drag = null;
  document.addEventListener('pointerdown', e => {
    const bx = e.target.closest && e.target.closest('.boxlayer'); if (!bx || PDFV.tool !== 'box') return;
    const pg = bx.parentElement, b = pg.getBoundingClientRect(), el = document.createElement('div'); el.className = 'hl box draft'; bx.appendChild(el);
    drag = {pg, b, el, x0: e.clientX, y0: e.clientY}; e.preventDefault();
  });
  document.addEventListener('pointermove', e => {
    if (!drag) return; const x = Math.min(e.clientX, drag.x0), y = Math.min(e.clientY, drag.y0), w = Math.abs(e.clientX - drag.x0), h = Math.abs(e.clientY - drag.y0);
    const r = norm({left: x, top: y, width: w, height: h}, drag.b); drag.el.style.cssText = `left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%`;
  });
  document.addEventListener('pointerup', e => {
    if (!drag) return; const d = drag; drag = null; d.el.remove();
    const x = Math.max(d.b.left, Math.min(e.clientX, d.x0)), y = Math.max(d.b.top, Math.min(e.clientY, d.y0)), w = Math.min(d.b.right, Math.max(e.clientX, d.x0)) - x, h = Math.min(d.b.bottom, Math.max(e.clientY, d.y0)) - y;
    if (w < 8 || h < 8) return;
    commitAnchor({page: +d.pg.dataset.p, kind: 'box', rects: [norm({left: x, top: y, width: w, height: h}, d.b)], quote: ''}).catch(err => toast(err.message, 'err'));
  });
  /* click a highlight -> flash its comment in the list */
  document.addEventListener('click', e => {
    const pane = $('#pdfpane'); if (!pane || !pane.contains(e.target) || PDFV.tool !== 'text' || (getSelection() && !getSelection().isCollapsed)) return;
    const pg = e.target.closest('.pg'); if (!pg) return; const b = pg.getBoundingClientRect(), x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
    const hit = items(PDFV.vid).find(it => it.anchor && it.anchor.page === +pg.dataset.p && it.anchor.rects.some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h));
    if (hit) jumpTo(hit.kind, hit.id);
  });

  /* ---------------- a new comment from a highlight ---------------- */
  function newCommentModal(an) {
    const v = anv(PDFV.vid), figs = S.usages.filter(u => u.type === 'note' && u.anvId === PDFV.vid).sort((a, b) => a.fig.localeCompare(b.fig, undefined, {numeric: true}));
    const last = (() => { try { return JSON.parse(localStorage.getItem('at_last_reviewer') || '{}'); } catch { return {}; } })();
    const groups = figGroups(figs);
    const figOpts = groups.map(g => { const pv = ver(g[0].versionId); return `<option value="${esc(g[0].fig)}">Fig ${esc(g[0].fig)} — ${g.length > 1 ? g.length + ' plots' : esc(plot(pv.plotId).name) + ' ' + verLabel(pv)}</option>`; }).join('');
    openModal({title: 'Comment on the highlighted part', wide: true, submit: 'Save comment',
      sub: `${anvLabel(v)} · page ${an.page}${an.quote ? ' · “' + esc(an.quote.length > 140 ? an.quote.slice(0, 140) + '…' : an.quote) + '”' : ' · marked area'}`,
      body: field('What is it about?', radios('kind', [['figure', 'A figure'], ['table', 'A table'], ['text', 'Text'], ['general', 'General / other']], an.kind === 'box' ? 'figure' : 'text'))
        + `<div id="figbox">${field('Which figure?', `<select name="fig"><option value="">— figure not recorded in the tracker —</option>${figOpts}</select>`, 'Figures you recorded under “+ Analysis Note” on a plot are listed. Choosing one attaches the comment to that figure.')}<div id="panelbox" style="display:none">${field('Which panel?', '<select name="panel"></select>', 'The era or plot the convener means.')}</div>${field('Figure number', '<input type="text" name="fignum" maxlength="20" placeholder="e.g. 31 (only if not listed above)">', '', true)}</div>`
        + `<div class="cols">${field('Kind of reviewer', `<select name="role">${CTX.note.roles.map(x => `<option ${last.role === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}${field('Name', `<input type="text" name="name" maxlength="100" value="${esc(last.name || '')}">`, '', true)}</div>`
        + field('Where (optional label)', `<input type="text" name="location" maxlength="80" placeholder="e.g. Sec 3.1, Tab 10">`, '', true)
        + field('The comment', '<textarea name="text" required maxlength="5000" style="min-height:110px" placeholder="Paste or type what the convener said"></textarea>'),
      setup: f => {
        const upd = () => { $('#figbox', f).style.display = f.kind.value === 'figure' ? 'grid' : 'none'; };
        f.querySelectorAll('[name=kind]').forEach(x => x.addEventListener('change', upd)); upd();
        const pan = () => {                                         // a figure with several plots asks which panel
          const g = groups.find(x => x[0].fig === f.fig.value), box = $('#panelbox', f);
          if (!g || g.length < 2) { box.style.display = 'none'; f.panel.innerHTML = ''; return; }
          f.panel.innerHTML = `<option value="figure">The whole figure</option>${g.map(u => `<option value="${u.id}">${esc(panelName(u))}</option>`).join('')}`; box.style.display = 'block';
        };
        f.fig.addEventListener('change', pan);
      },
      onSubmit: async fd => {
        const kind = fd.get('kind'), body = {role: fd.get('role'), name: fd.get('name').trim(), text: fd.get('text').trim()};
        try { localStorage.setItem('at_last_reviewer', JSON.stringify({role: body.role, name: body.name})); } catch {}
        if (kind === 'figure' && fd.get('fig')) {                    // a recorded figure: the comment goes under that figure (and panel)
          const g = groups.find(x => x[0].fig === fd.get('fig')), pick = fd.get('panel');
          const use = g.length > 1 && pick && pick !== 'figure' ? g.find(x => x.id === pick) : g[0];
          const r = await api('POST', aurl(`/usages/${use.id}/reviews`), {...body, scope: g.length > 1 && (!pick || pick === 'figure') ? 'figure' : 'panel'}); await api('POST', aurl(`/reviews/${r.id}/anchor`), {anchor: an});
        } else {
          const num = fd.get('fignum').trim(), loc = fd.get('location').trim() || (kind === 'figure' && num ? 'Fig ' + num : '');
          const r = await api('POST', aurl('/an-comments'), {source: 'an', an_version_id: PDFV.vid, kind, location: loc, ...body}); await api('POST', aurl(`/an-comments/${r.id}/anchor`), {anchor: an});
        }
        await reload(); toast('Comment saved and placed');
      }});
  }

  /* ---------------- buttons ---------------- */
  async function act(el) {
    const op = el.dataset.op, kind = el.dataset.kind, id = el.dataset.id;
    if (op === 'tool') { PDFV.tool = id; render(); }
    else if (op === 'zoomin' || op === 'zoomout') { PDFV.zoom = Math.max(0.5, Math.min(3, PDFV.zoom + (op === 'zoomin' ? 0.25 : -0.25))); render(); }
    else if (op === 'place') { PDFV.placing = {kind, id}; render(); }
    else if (op === 'cancel') { PDFV.placing = null; render(); }
    else if (op === 'goto') jumpTo(kind, id);
    else if (op === 'unplace') { await api('POST', aurl(`/${kind === 'anc' ? 'an-comments' : 'reviews'}/${id}/anchor`), {anchor: null}); await reload(); }
    else if (op === 'store') {
      if (!PDFV.file) { toast('Choose the PDF first.', 'err'); return; }
      if (PDFV.file.size > 50 * 1048576) { toast('This PDF is larger than 50 MB, so it cannot be stored in the repository.', 'err', 8000); return; }
      const done = busy('Storing the PDF in the repository…');
      try { await storePdf(S.an.id, PDFV.vid, PDFV.file, PDFV.fp); await reload(); toast('Stored. It now opens on every device.'); } catch (e) { toast(e.message, 'err', 8000); } finally { done(); }
    }
    else if (op === 'unstore') { confirmBox('Remove the stored PDF', 'Delete the PDF from the data repository? Its name and fingerprint stay recorded, and a copy on this device (if any) is kept.', 'Remove', async () => { await api('DELETE', aurl(`/versions/${PDFV.vid}/pdf`)); await reload(); }); }
    else if (op === 'forget') { await dropCopy(PDFV.vid); PDFV.saved = false; PDFV.doc = null; PDFV.restoreTried = true; render(); toast('Removed the saved copy from this device'); }
    else if (op === 'record') { await api('PATCH', aurl('/versions/' + PDFV.vid), {pdf: PDFV.fp}); PDFV.match = true; if (PDFV.file) await saveCopy(PDFV.vid, PDFV.file); await reload(); toast('PDF recorded for ' + anvLabel(anv(PDFV.vid))); }
  }
  /* open the viewer for a version, or jump to where a comment is placed */
  function open(el) {
    let vid = el.dataset.v, jump = null;
    if (el.dataset.kind) {
      const k = el.dataset.kind, id = el.dataset.id;
      if (k === 'anc') vid = S.anc.find(c => c.id === id)?.anvId; else { const f = findReview(id); vid = f && f.u.anvId; }
      jump = {kind: k, id};
    }
    if (!vid) { toast('Select an AN version first.', 'err'); return; }
    PDFV.jump = jump; if (PDFV.vid !== vid) Object.assign(PDFV, {vid, doc: null, fp: null, match: null, scroll: 0, restoreTried: false, saved: false, file: null});
    go(L('/pdf/' + vid)); if (route()[3] === vid) render();
  }
  window.PDF = {viewPdf, mountPdf, act, open, openFile, clearAll, state: PDFV};
})();
