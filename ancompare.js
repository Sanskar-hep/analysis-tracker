/*! Analysis-Tracker - Copyright (c) 2026 Sanskar Nanda - MIT License (see LICENSE). https://github.com/Sanskar-hep */
/* Compare two versions of the Analysis Note (their PDFs): what changed in the text, section by section, and in the figures,
 * with the result documented as "changes between successive versions". Runs in the browser; the PDFs are never sent anywhere.
 * Uses the app's globals (S, ui, api, aurl, busy, ...), SCAN (figure reading) and PDF (opening the stored PDFs). */
(function () {
  'use strict';
  const cache = new Map();                                       // extracted PDFs, kept for this session
  const A = () => (ui.anc = ui.anc || {a: '', b: '', res: null, notes: '', files: {}});
  const same = 0.03;                                              // pictures closer than this are "the same figure"
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const words = t => String(t || '').split(/\s+/).filter(Boolean);
  const plain = s => String(s || '').replace(/\s+/g, ' ').trim();

  /* ---------------- which PDFs are there ---------------- */
  const choices = () => [...S.anv].sort((x, y) => x.number - y.number).map(v => ({id: v.id, label: anvLabel(v), has: !!v.pdf}))
    .concat(S.work && S.work.pdf && S.work.pdf.file_id ? [{id: 'work', label: REL.workingName() + ' (working version, new PDF)', has: true}] : []);
  const labelOf = id => (choices().find(c => c.id === id) || {label: '?'}).label;
  async function fileFor(id) {
    const U = A(); if (U.files[id]) return U.files[id];
    if (id === 'work') { const w = S.work.pdf; if (!w || !w.file_id) return null; const u = await fetchImage(S.an.id, w.file_id, w.ext || '.pdf'); return new File([await (await fetch(u)).blob()], w.name, {type: 'application/pdf'}); }
    return PDF.fileFor(id);
  }

  /* many notes (e.g. CMS drafts) print a line number in the margin: remove it, or every reflowed line would look changed */
  function stripLineNumbers(lines) {
    const lead = lines.filter(l => /^\d{1,4}(\s|$)/.test(l.text)); if (lead.length < 8) return;
    const xs = lead.map(l => Math.round(l.x)), mode = [...xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0];
    const other = lines.filter(l => !/^\d{1,4}(\s|$)/.test(l.text)).map(l => l.x).sort((a, b) => a - b), med = other.length ? other[Math.floor(other.length / 2)] : mode[0] + 100;
    if (mode[1] < 8 || mode[0] > med - 12) return;
    lines.forEach(l => { if (Math.abs(l.x - mode[0]) <= 2 && /^\d{1,4}(\s|$)/.test(l.text)) l.text = l.text.replace(/^\d{1,4}\s*/, ''); });
  }

  /* ---------------- reading a PDF: sections of text, and figures ---------------- */
  async function extract(file, say) {
    await PDF.ensure();
    const fp = await pdfFingerprint(file), key = fp.sha256; if (cache.has(key)) return cache.get(key);
    const doc = await pdfjsLib.getDocument({data: new Uint8Array(await file.arrayBuffer())}).promise, pages = [];
    for (let n = 1; n <= doc.numPages; n++) { say(`Reading page ${n} of ${doc.numPages}…`); const page = await doc.getPage(n); const lines = await SCAN.pageLines(page); stripLineNumbers(lines); pages.push({n, page, lines: lines.filter(l => l.text), y0: page.view[1], h: page.view[3] - page.view[1]}); }
    const sizes = new Map(); pages.slice(0, 8).forEach(p => p.lines.forEach(l => sizes.set(Math.round(l.fs), (sizes.get(Math.round(l.fs)) || 0) + l.text.length)));
    const body = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
    const freq = new Map(); pages.forEach(p => { const seen = new Set(); p.lines.forEach(l => { if (l.y > p.y0 + p.h * 0.92 || l.y < p.y0 + p.h * 0.08) { const k = norm(l.text.replace(/\d+/g, '#')); if (!seen.has(k)) { seen.add(k); freq.set(k, (freq.get(k) || 0) + 1); } } }); });
    const common = new Set([...freq].filter(([, c]) => c >= Math.max(3, pages.length * 0.3)).map(([k]) => k));
    const sections = [{title: '(before the first section)', num: '', parts: []}], figures = [];
    for (const p of pages) {
      const caps = SCAN.findCaptions(p.lines, p.n, {body, section: ''}), toc = caps.filter(c => /\.{3,}\s*\d+$|\s\d{1,3}$/.test(c.caption)).length >= 4;
      const imgs = await SCAN.pageImages(p.page).catch(() => []);       // the text inside a plot (axis labels) is not part of the AN text
      p.lines.forEach(l => {
        if (caps.some(c => l.y <= c.y + 0.5 && l.y >= c.yEnd - 0.5)) return;
        if (imgs.some(im => l.y >= im.y - 2 && l.y <= im.y + im.h + 2 && l.x >= im.x - 2 && l.x <= im.x + im.w + 2)) return;
        if ((l.y > p.y0 + p.h * 0.92 || l.y < p.y0 + p.h * 0.08) && (common.has(norm(l.text.replace(/\d+/g, '#'))) || /^\d{1,3}$/.test(l.text))) return;
        if (SCAN.isHeading(l, body)) { const m = /^((?:\d+|[A-Z])(?:\.\d+){0,3})\s+(.*)$/.exec(l.text); sections.push({title: m ? m[2] : l.text, num: m ? m[1] : '', parts: []}); return; }
        sections[sections.length - 1].parts.push(l.text);
      });
      if (!caps.length || toc) continue;
      say(`Reading the figures on page ${p.n}…`);
      if (imgs.some(i => i.vector)) await SCAN.cropVectors(p.page, imgs).catch(() => {});
      const here = caps.map(c => ({fig: c.fig, page: p.n, caption: c.caption, y: c.y, section: c.section, shots: []}));
      for (const im of imgs) { const cv = im.canvas || (im.obj ? SCAN.toCanvas(im.obj) : null); if (!cv) continue;
        const below = here.filter(f => f.y <= im.y + im.h * 0.15).sort((a, b) => (im.y - a.y) - (im.y - b.y))[0], pick = below || [...here].sort((a, b) => Math.abs(a.y - im.y) - Math.abs(b.y - im.y))[0];
        if (pick && pick.shots.length < 12) pick.shots.push({fp: SCAN.fingerprint(cv), thumb: SCAN.thumb(cv, 200), cv, x: im.x, y: im.y}); }
      here.forEach(f => { f.shots.sort((a, b) => b.y - a.y || a.x - b.x); if (!figures.some(g => g.fig === f.fig)) figures.push(f); });
    }
    sections.forEach(s => { let t = ''; s.parts.forEach(l => { t = /[a-z]-$/.test(t) && /^[a-z]/.test(l) ? t.slice(0, -1) + l : (t ? t + ' ' : '') + l; }); s.text = t.trim(); delete s.parts; });
    const out = {sections: sections.filter(s => (s.text || s.num) && !/^(table of )?contents$/i.test(s.title) && !/(\. ){6,}/.test(s.text)), figures, pages: doc.numPages}; cache.set(key, out); return out;
  }

  /* ---------------- diff ---------------- */
  function lcs(a, b, key) {                                        // list of {t: 'eq'|'del'|'ins', x}
    const n = a.length, m = b.length; if (n * m > 6e6) return null;
    const w = m + 1, dp = new Uint16Array((n + 1) * w), ka = a.map(key), kb = b.map(key);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * w + j] = ka[i] === kb[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) { if (ka[i] === kb[j]) { out.push({t: 'eq', x: b[j]}); i++; j++; } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) out.push({t: 'del', x: a[i++]}); else out.push({t: 'ins', x: b[j++]}); }
    while (i < n) out.push({t: 'del', x: a[i++]}); while (j < m) out.push({t: 'ins', x: b[j++]});
    return out;
  }
  const sentences = t => String(t || '').split(/(?<=[.!?])\s+(?=[A-Z(\\[0-9])/).map(s => s.trim()).filter(Boolean);
  const mark = (ops, md) => { let add = 0, del = 0; const html = [], txt = [];
    ops.forEach(o => { const w = esc(o.x);
      if (o.t === 'eq') { html.push(w); txt.push(o.x); } else if (o.t === 'del') { del++; html.push(`<del>${w}</del>`); txt.push(`~~${o.x}~~`); } else { add++; html.push(`<ins>${w}</ins>`); txt.push(`**${o.x}**`); } });
    return {html: html.join(' '), md: txt.join(' '), add, del}; };
  function inline(a, b) {                                          // word-level diff of two passages
    const ops = (words(a).length + words(b).length < 1600 ? lcs(words(a), words(b), x => x.toLowerCase()) : null) || [...words(a).map(x => ({t: 'del', x})), ...words(b).map(x => ({t: 'ins', x}))];
    return mark(ops);
  }
  function textDiff(a, b) {                                        // sentence by sentence, changed ones diffed by word
    const sa = sentences(a), sb = sentences(b), ops = lcs(sa, sb, norm) || [...sa.map(x => ({t: 'del', x})), ...sb.map(x => ({t: 'ins', x}))], hunks = [];
    let add = 0, del = 0; for (let k = 0; k < ops.length;) {
      if (ops[k].t === 'eq') { k++; continue; }
      const d = [], n = []; let ctxBefore = k > 0 ? ops[k - 1].x : ''; while (k < ops.length && ops[k].t !== 'eq') { (ops[k].t === 'del' ? d : n).push(ops[k].x); k++; }
      const r = inline(d.join(' '), n.join(' ')); add += r.add; del += r.del; hunks.push({html: r.html, md: r.md, before: ctxBefore, add: r.add, del: r.del});
    }
    return {hunks, add, del};
  }
  const titleKey = s => norm(String(s.title).replace(/^\d+(\.\d+)*\s*/, ''));
  function diffSections(A_, B_) {
    const out = [], used = new Set(), byTitle = new Map(); B_.forEach((s, i) => { const k = titleKey(s); if (k && !byTitle.has(k)) byTitle.set(k, i); });
    A_.forEach(sa => { let j = byTitle.get(titleKey(sa)); if (j === undefined || used.has(j)) j = B_.findIndex((sb, i) => !used.has(i) && sb.num && sb.num === sa.num && sa.num);
      if (j === undefined || j < 0) { out.push({title: sa.title, num: sa.num, status: 'removed', words: words(sa.text).length}); return; }
      used.add(j); const sb = B_[j], d = textDiff(sa.text, sb.text); out.push({title: sb.title, num: sb.num, oldNum: sa.num, status: d.hunks.length ? 'changed' : 'same', ...d}); });
    B_.forEach((sb, j) => { if (!used.has(j)) out.push({title: sb.title, num: sb.num, status: 'added', words: words(sb.text).length}); });
    return out.sort((x, y) => String(x.num).localeCompare(String(y.num), undefined, {numeric: true}));
  }
  function diffFigures(FA, FB) {
    const out = [], used = new Set(), jac = (p, q) => { const a = new Set(norm(p).split(' ')), b = new Set(norm(q).split(' ')); let i = 0; a.forEach(x => { if (b.has(x)) i++; }); return i / Math.max(1, a.size + b.size - i); };
    FA.forEach(fa => { let best = -1, bs = 0; FB.forEach((fb, j) => { if (used.has(j)) return; let sc = jac(fa.caption, fb.caption); if (fa.fig === fb.fig) sc += 0.25; if (sc > bs) { bs = sc; best = j; } });
      if (best < 0 || bs < 0.45) { out.push({status: 'removed', a: fa}); return; }
      used.add(best); const fb = FB[best], n = Math.max(fa.shots.length, fb.shots.length), panels = [];
      for (let k = 0; k < n; k++) { const x = fa.shots[k], y = fb.shots[k]; panels.push({a: x, b: y, d: x && y ? SCAN.dist(x.fp, y.fp) : null}); }
      const imgChanged = fa.shots.length !== fb.shots.length || panels.some(p => p.d === null || p.d > same), capChanged = norm(fa.caption) !== norm(fb.caption), cap = capChanged ? inline(fa.caption, fb.caption) : null;
      out.push({status: imgChanged ? 'changed' : capChanged ? 'caption' : 'same', a: fa, b: fb, panels, imgChanged, cap, renumbered: fa.fig !== fb.fig}); });
    FB.forEach((fb, j) => { if (!used.has(j)) out.push({status: 'added', b: fb}); });
    return out.sort((x, y) => String((x.b || x.a).fig).localeCompare(String((y.b || y.a).fig), undefined, {numeric: true}));
  }

  /* ---------------- the comparison ---------------- */
  async function run() {
    const U = A(), done = busy('Opening the two PDFs…');
    try {
      const [fa, fb] = [await fileFor(U.a), await fileFor(U.b)]; if (!fa || !fb) { U.res = null; toast('One of the PDFs is not available here. Choose its file below.', 'err', 8000); return; }
      const ea = await extract(fa, m => done.set(labelOf(U.a) + ': ' + m)), eb = await extract(fb, m => done.set(labelOf(U.b) + ': ' + m));
      done.set('Comparing…');
      const sections = diffSections(ea.sections, eb.sections), figures = diffFigures(ea.figures, eb.figures);
      const tot = {add: sections.reduce((n, s) => n + (s.add || (s.status === 'added' ? s.words : 0)), 0), del: sections.reduce((n, s) => n + (s.del || (s.status === 'removed' ? s.words : 0)), 0)};
      U.res = {a: U.a, b: U.b, la: labelOf(U.a), lb: labelOf(U.b), pa: ea.pages, pb: eb.pages, sections, figures, tot};
      render();
    } catch (e) { toast('The comparison failed: ' + (e.message || e), 'err', 9000); } finally { done(); }
  }

  /* ---------------- the written record ---------------- */
  function reportMd(r, notes) {
    const f = r.figures, st = s => f.filter(x => x.status === s), L = ['# Changes between ' + r.la + ' and ' + r.lb, '', `_Compared ${today()} from the two PDFs (${r.pa} and ${r.pb} pages). Text changes are word-level: **added**, ~~removed~~._`, ''];
    if (notes && notes.trim()) L.push('## Summary by the analyst', '', notes.trim(), '');
    L.push('## Figures', '', `${st('added').length} added · ${st('removed').length} removed · ${st('changed').length} changed · ${st('caption').length} with a new caption only · ${st('same').length} unchanged`, '');
    const fl = (title, arr, fn) => { if (arr.length) { L.push(`### ${title}`, ''); arr.forEach(x => L.push('- ' + fn(x))); L.push(''); } };
    fl('Added', st('added'), x => `Figure ${x.b.fig} (page ${x.b.page}): ${plain(x.b.caption).slice(0, 160)}`);
    fl('Removed', st('removed'), x => `Figure ${x.a.fig} (page ${x.a.page}): ${plain(x.a.caption).slice(0, 160)}`);
    fl('Changed', st('changed'), x => `Figure ${x.b.fig}${x.renumbered ? ` (was ${x.a.fig})` : ''}: the plot changed${x.a.shots.length !== x.b.shots.length ? ` (${x.a.shots.length} → ${x.b.shots.length} panels)` : ''}. ${plain(x.b.caption).slice(0, 140)}`);
    fl('Caption changed only', st('caption'), x => `Figure ${x.b.fig}: ${x.cap.md.slice(0, 300)}`);
    L.push('## Text', '', `${r.tot.add} words added · ${r.tot.del} words removed`, '');
    const sec = r.sections.filter(s => s.status !== 'same');
    sec.forEach(s => { L.push(`### ${s.num ? s.num + ' ' : ''}${s.title} — ${s.status}${s.status === 'changed' ? ` (+${s.add} / −${s.del} words)` : ''}`, '');
      if (s.status === 'changed') s.hunks.slice(0, 25).forEach(h => L.push('- ' + h.md.slice(0, 700))); L.push(''); });
    if (!sec.length) L.push('_No changes in the text._', '');
    return L.join('\n');
  }

  /* ---------------- the page ---------------- */
  const badge = {added: ['resolved', 'Added'], removed: ['pending', 'Removed'], changed: ['s-updated', 'Changed'], caption: ['stage', 'Caption changed'], same: ['', 'Unchanged']};
  function view() {
    const U = A(), ch = choices(), r = U.res;
    if (!isAN()) return notFound();
    if (!U.a || !U.b) { const last = ch.slice(-2); if (last.length === 2) { U.a = last[0].id; U.b = last[1].id; } }
    const sel = (k, cur) => `<select data-anc="${k}">${ch.map(c => `<option value="${c.id}" ${c.id === cur ? 'selected' : ''}>${esc(c.label)}${c.has ? '' : ' — no PDF recorded'}</option>`).join('')}</select>`;
    const need = id => `<span class="meta" id="ancneed-${id}"></span>`;
    const head = `<div class="crumbs"><a href="${L('/versions')}">Version History</a> / Compare AN versions</div><div class="pagehead"><div><h1>Compare AN versions</h1><p>See what changed in the text and in the figures between two versions of the AN, and keep it as the record of the changes between them.</p></div></div>`;
    if (ch.length < 2) return head + '<div class="card empty">You need two AN versions with a PDF to compare. Record the PDF of each published version (Version History → Open), and upload the new PDF of the working version in Release &amp; Export.</div>';
    const picker = `<div class="card pad"><div class="cols">${field('Older version', sel('a', U.a))}${field('Newer version', sel('b', U.b))}</div>
      <div class="cols" style="margin-top:8px">${[['a', U.a], ['b', U.b]].map(([k, id]) => `<div class="f" data-ancfile="${k}"><label class="l">${esc(labelOf(id))} PDF</label><div class="meta" id="anchave-${k}">checking…</div><label class="btn sm" style="cursor:pointer;margin-top:4px">Choose the file…<input type="file" accept="application/pdf,.pdf" data-ancf="${id}" hidden></label></div>`).join('')}</div>
      <div class="actions" style="margin-top:12px"><button class="btn primary" data-act="anc" data-op="run" ${U.a === U.b ? 'disabled' : ''}>Compare</button>${U.a === U.b ? '<span class="meta">Choose two different versions.</span>' : '<span class="meta">Takes a little while for a long AN; nothing is uploaded.</span>'}</div></div>`;
    if (!r || r.a !== U.a || r.b !== U.b) return head + picker + (r ? '<div class="meta" style="margin:10px 2px">You changed the selection: click Compare.</div>' : '');
    const f = r.figures, cnt = s => f.filter(x => x.status === s).length, sec = r.sections, chg = sec.filter(s => s.status === 'changed').length;
    const tiles = `<div class="tiles"><div class="card tile"><b>${cnt('changed') + cnt('caption')}</b><span>Figures changed</span></div><div class="card tile"><b>${cnt('added')}</b><span>Figures added</span></div><div class="card tile"><b>${cnt('removed')}</b><span>Figures removed</span></div><div class="card tile"><b>${chg + sec.filter(s => s.status !== 'changed' && s.status !== 'same').length}</b><span>Sections changed</span></div><div class="card tile"><b>+${r.tot.add} / −${r.tot.del}</b><span>Words</span></div></div>`;
    const figCard = x => { const [c, l] = badge[x.status], fg = x.b || x.a, cell = (s, lab) => s ? `<div><div class="meta">${lab}</div><img class="ancimg" src="${s.thumb}" alt="" data-anczoom="${lab}" data-i="${f.indexOf(x)}"></div>` : `<div><div class="meta">${lab}</div><div class="ancnone">no picture</div></div>`;
      return `<div class="card pad ancfig ${x.status}"><div><b>Figure ${esc(fg.fig)}${x.renumbered ? ` <span class="meta">(was ${esc(x.a.fig)})</span>` : ''}</b> <span class="badge ${c}">${l}</span> <span class="meta">page ${fg.page}</span></div><div class="meta" style="margin:3px 0 8px">${x.cap ? x.cap.html : esc(plain(fg.caption).slice(0, 220))}</div>
        ${x.panels && (x.status === 'changed') ? `<div class="ancpanels">${x.panels.map((p, k) => `<div class="ancpair">${cell(p.a, r.la)}${cell(p.b, r.lb)}${p.d !== null ? `<div class="meta">${p.d > same ? 'differs' : 'same'}</div>` : ''}</div>`).join('')}</div>` : x.status === 'added' ? `<div class="ancpanels">${x.b.shots.map(s => `<div class="ancpair">${cell(s, r.lb)}</div>`).join('')}</div>` : x.status === 'removed' ? `<div class="ancpanels">${x.a.shots.map(s => `<div class="ancpair">${cell(s, r.la)}</div>`).join('')}</div>` : ''}</div>`; };
    const order = ['changed', 'caption', 'added', 'removed'], shown = f.filter(x => x.status !== 'same').sort((x, y) => order.indexOf(x.status) - order.indexOf(y.status)), nSame = cnt('same');
    const secHtml = sec.filter(s => s.status !== 'same').map(s => { const [c, l] = badge[s.status]; return `<details class="card ancsec" ${s.status === 'changed' && chg <= 6 ? 'open' : ''}><summary><b>${esc(s.num ? s.num + ' ' : '')}${esc(s.title)}</b> <span class="badge ${c}">${l}</span> <span class="meta">${s.status === 'changed' ? `+${s.add} / −${s.del} words` : s.words + ' words'}</span></summary>
      ${s.status === 'changed' ? s.hunks.slice(0, 60).map(h => `<p class="anchunk">${h.html}</p>`).join('') + (s.hunks.length > 60 ? `<div class="meta">…and ${s.hunks.length - 60} more changes (all are in the downloaded record).</div>` : '') : `<div class="meta" style="padding:6px 0">This whole section was ${s.status}.</div>`}</details>`; }).join('');
    const saved = (r.b === 'work' ? S.work.change_report : (anv(r.b) || {}).change_report) || '';
    return head + picker + tiles
      + `<div class="card pad" style="margin-top:14px"><label class="l" style="font-weight:600">Summary in your own words <span class="opt">(optional, added to the record)</span></label><textarea data-anc="notes" rows="3" style="width:100%;margin-top:6px" placeholder="e.g. Added the unfolding closure test and revised the systematics section after the ARC comments.">${esc(U.notes)}</textarea>
        <div class="actions" style="margin-top:10px"><button class="btn primary" data-act="anc" data-op="save">Save as the record of the changes ${esc(r.la)} → ${esc(r.lb)}</button><button class="btn" data-act="anc" data-op="download">Download (.md)</button>${saved ? '<span class="badge resolved">a record is already saved for ' + esc(r.lb) + '</span>' : ''}</div></div>`
      + `<div class="sechead"><h2>Figures</h2><span class="meta">${nSame} unchanged</span></div>${shown.map(figCard).join('') || '<div class="card empty">No figure changed.</div>'}`
      + `<div class="sechead"><h2>Text</h2><span class="meta">${sec.filter(s => s.status === 'same').length} sections unchanged</span></div>${secHtml || '<div class="card empty">No changes in the text.</div>'}`;
  }

  async function act(el) {
    const U = A(), op = el.dataset.op;
    if (op === 'open') { U.a = el.dataset.a; U.b = el.dataset.b; U.res = null; return go(L('/compare-an')); }
    if (op === 'run') return run();
    if (op === 'download') { const r = U.res; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([reportMd(r, U.notes)], {type: 'text/markdown'})); a.download = `Changes_${r.la.replace(/\W+/g, '_')}_to_${r.lb.replace(/\W+/g, '_')}.md`; document.body.appendChild(a); a.click(); a.remove(); return; }
    if (op === 'save') {
      const r = U.res, md = reportMd(r, U.notes);
      if (r.b === 'work') await api('POST', aurl('/working'), {change_report: md}); else await api('POST', aurl(`/versions/${r.b}/changes`), {report: md});
      await reload(); toast(`Saved as the record of the changes ${r.la} → ${r.lb}. It is shown under “Changes” in Version History${r.b === 'work' ? ' and goes into the release package' : ''}.`, '', 8000);
    }
  }
  /* who has which PDF on this device, and chosen files */
  async function refreshHave() {
    const U = A();
    for (const k of ['a', 'b']) { const el = $('#anchave-' + k); if (!el) continue; const id = U[k]; const f = await fileFor(id).catch(() => null); el.textContent = f ? `✓ available (${f.name})` : 'Not stored in the repository and not on this device: choose the file below.'; }
  }
  document.addEventListener('change', e => {
    const t = e.target, U = A();
    if (t.matches && t.matches('[data-anc]')) { const k = t.dataset.anc; if (k === 'notes') { U.notes = t.value; return; } U[k] = t.value; U.res = null; render(); }
    if (t.matches && t.matches('input[data-ancf]') && t.files[0]) { U.files[t.dataset.ancf] = t.files[0]; U.res = null; refreshHave(); toast('File chosen: ' + t.files[0].name); }
  });
  document.addEventListener('input', e => { if (e.target.matches && e.target.matches('[data-anc=notes]')) A().notes = e.target.value; });
  document.addEventListener('click', e => { const z = e.target.closest && e.target.closest('[data-anczoom]'); if (!z) return; const U = A(), x = U.res && U.res.figures[+z.dataset.i]; if (!x) return;
    const side = z.dataset.anczoom === U.res.la ? 'a' : 'b', fg = x[side], cell = z.closest('.ancpair'), idx = [...cell.parentElement.children].indexOf(cell), s = (x.panels && x.panels[idx] ? x.panels[idx][side] : (fg && fg.shots[idx])) || (fg && fg.shots[0]); if (s && s.cv) lightbox(s.cv.toDataURL('image/png')); });
  window.ANC = {view, act, refreshHave, extract};
})();
