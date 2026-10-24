/*! Analysis-Tracker - Copyright (c) 2026 Sanskar Nanda - MIT License (see LICENSE). https://github.com/Sanskar-hep */
/* Make a slide deck (.pptx) from chosen plots: one plot per slide with the facts that belong to it (what changed, why, dataset,
 * code link, where it is used), optionally a before / after slide and a slide with the comments and replies on it.
 *
 * Like the Google Docs export this is a file, not a push to Google: writing into Google Slides from a web page needs a Google
 * sign-in and public picture addresses, and the plots live in a private repository. A .pptx carries the pictures inside and
 * Google Drive opens it as a normal presentation (right-click > Open with > Google Slides). Nothing is sent anywhere here.
 * Uses the app's globals (S, ver, plot, verOf, latest, visPlots, catPath, verLabel, fetchImage, busy, toast, openModal, ...) at call time. */
(function () {
  'use strict';
  const W = 12192000, H = 6858000, IN = 914400, MAXW = 2000;                  // 16:9 slide, in EMU
  const clean = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
  const x = s => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cut = (s, n) => { s = clean(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
  const emu = v => Math.round(v * IN);
  const stLabel = {pending: 'Open', in_progress: 'In progress', resolved: 'Resolved'};

  /* ---------- pictures (same approach as the Google Docs export) ---------- */
  const loadImg = url => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('decode')); im.src = url; });
  async function prepImage(v, media) {
    if (media.has(v.file_id)) return media.get(v.file_id);
    let rec = null;
    try {
      const url = await fetchImage(S.an.id, v.file_id, v.ext || '.png'), src = await (await fetch(url)).blob(), im = await loadImg(url);
      let w = im.naturalWidth || 800, h = im.naturalHeight || 600; const ext = (v.ext || '.png').toLowerCase(), jpg = ext === '.jpg' || ext === '.jpeg';
      let data;
      if ((jpg || ext === '.png') && w <= MAXW) data = new Uint8Array(await src.arrayBuffer());
      else {
        const k = Math.min(1, MAXW / w), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k)), cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        const g = cv.getContext('2d'); if (jpg) { g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch); }
        g.drawImage(im, 0, 0, cw, ch); data = new Uint8Array(await (await new Promise(r => cv.toBlob(r, jpg ? 'image/jpeg' : 'image/png', 0.92))).arrayBuffer()); w = cw; h = ch;
      }
      rec = {data, kind: jpg ? 'jpeg' : 'png', w, h, n: 0};
    } catch (e) { rec = null; }
    media.set(v.file_id, rec); return rec;
  }

  /* ---------- DrawingML pieces ---------- */
  const run = (t, o = {}) => `<a:r><a:rPr lang="en-GB" sz="${Math.round((o.sz || 14) * 100)}"${o.b ? ' b="1"' : ''}${o.i ? ' i="1"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${o.color || '1F2937'}"/></a:solidFill></a:rPr><a:t>${x(t)}</a:t></a:r>`;
  const para = (runs, o = {}) => `<a:p><a:pPr algn="${o.algn || 'l'}"><a:spcBef><a:spcPts val="${Math.round((o.before || 0) * 100)}"/></a:spcBef></a:pPr>${runs}</a:p>`;
  let ID = 1;
  const box = (name, xi, yi, wi, hi, paras, o = {}) => `<p:sp><p:nvSpPr><p:cNvPr id="${++ID}" name="${x(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(xi)}" y="${emu(yi)}"/><a:ext cx="${emu(wi)}" cy="${emu(hi)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${o.fill ? `<a:solidFill><a:srgbClr val="${o.fill}"/></a:solidFill>` : '<a:noFill/>'}</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="${emu(o.pad ?? 0.05)}" tIns="${emu(o.pad ?? 0.03)}" rIns="${emu(o.pad ?? 0.05)}" bIns="${emu(o.pad ?? 0.03)}" anchor="${o.anchor || 't'}"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paras || '<a:p><a:endParaRPr lang="en-GB"/></a:p>'}</p:txBody></p:sp>`;
  const rect = (name, xi, yi, wi, hi, fill) => `<p:sp><p:nvSpPr><p:cNvPr id="${++ID}" name="${x(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(xi)}" y="${emu(yi)}"/><a:ext cx="${emu(wi)}" cy="${emu(hi)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
  function pic(rec, rid, name, bx, by, bw, bh) {                  // picture scaled to fit inside the box, centred, aspect kept
    const k = Math.min(bw / (rec.w / 96), bh / (rec.h / 96)), w = rec.w / 96 * k, h = rec.h / 96 * k, id = ++ID;
    return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${x(name)}" descr="${x(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${emu(bx + (bw - w) / 2)}" y="${emu(by + (bh - h) / 2)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln w="9525"><a:solidFill><a:srgbClr val="D1D5DB"/></a:solidFill></a:ln></p:spPr></p:pic>`;
  }

  /* ---------- what goes on each slide ---------- */
  const usedIn = v => {
    const out = []; S.usages.filter(u => u.versionId === v.id).forEach(u => {
      if (u.type === 'note') { const av = u.anvId && S.anv.find(a => a.id === u.anvId); out.push(`AN Fig. ${u.fig || '?'}${av ? ' (' + anvLabel(av) + ')' : u.anVer ? ' (' + u.anVer + ')' : ''}`); }
      else out.push(`${meetingName(u)}${u.slide ? ', slide ' + u.slide : ''}`);
    });
    return [...new Set(out)];
  };
  const facts = (p, v) => [['What changed', v.changes || v.summary], ['Why', v.motivation], ['Dataset', v.dataset], ['Code', v.code], ['Used in', usedIn(v).join(' · ')], ['Location in the AN', p.location]].filter(f => (f[1] || '').trim());
  const factParas = (list, sz, max) => list.map(([k, t], i) => para(run(k, {b: true, sz: sz - 1, color: '2563EB'}), {before: i ? 9 : 0}) + para(run(cut(t, max), {sz, color: '1F2937'}), {before: 1})).join('');
  const commentsOf = v => S.usages.filter(u => u.versionId === v.id).flatMap(u => u.reviews.filter(r => !r.none).map(r => ({r, where: u.type === 'note' ? 'AN Fig. ' + (u.fig || '?') : meetingName(u)})));

  function frame(o, n, total) {                                  // common furniture: title, subtitle, accent bar, footer
    return rect('Accent', 0, 0, 13.333, 0.12, '2563EB')
      + box('Title', 0.45, 0.28, 12.4, 0.62, para(run(o.title, {sz: 26, b: true, color: '0F172A'})), {anchor: 'ctr'})
      + (o.sub ? box('Subtitle', 0.45, 0.88, 12.4, 0.34, para(run(o.sub, {sz: 13, color: '6B7280'})), {anchor: 'ctr'}) : '')
      + box('Footer', 0.45, 7.08, 10.5, 0.3, para(run(o.footer, {sz: 10, color: '9CA3AF'})), {anchor: 'ctr'})
      + box('Number', 11.9, 7.08, 1.0, 0.3, para(run(String(n), {sz: 10, color: '9CA3AF'}), {algn: 'r'}), {anchor: 'ctr'});
  }
  function plotSlide(sel, opt, media, footer, n) {
    const {p, v} = sel, rec = media.get(v.file_id); ID = 1;
    const sub = [catPath(p.catId), v.summary && v.summary !== v.changes ? v.summary : ''].filter(Boolean).join('  ·  ');
    let body = frame({title: `${p.name} · ${verLabel(v)}`, sub: cut(sub, 150), footer}, n), rels = [];
    if (rec) { rels.push(v.file_id); body += pic(rec, 'rIdP' + rels.length, `${p.name} ${verLabel(v)}`, 0.45, 1.4, 7.9, 5.5); }
    else body += box('Missing picture', 0.45, 1.4, 7.9, 5.5, para(run('(picture could not be loaded)', {i: true, sz: 14, color: '9CA3AF'})), {fill: 'F3F4F6', anchor: 'ctr'});
    body += box('Details', 8.6, 1.4, 4.3, 5.5, factParas(facts(p, v), 13, 420) || para(run('No description was recorded for this version.', {i: true, sz: 13, color: '9CA3AF'})), {fill: 'F8FAFC', pad: 0.14});
    return {body, rels};
  }
  function compareSlide(sel, opt, media, footer, n) {            // previous version beside the chosen one
    const {p, v, prev} = sel; ID = 1; const rels = [], a = media.get(prev.file_id), b = media.get(v.file_id);
    let body = frame({title: `${p.name} · ${verLabel(prev)} → ${verLabel(v)}`, sub: cut(catPath(p.catId), 150), footer}, n);
    const half = (rec, vv, xi, cap) => {
      let s = box('Caption', xi, 1.35, 6.1, 0.32, para(run(cap, {sz: 12, b: true, color: '374151'})), {anchor: 'ctr'});
      if (rec) { rels.push(vv.file_id); s += pic(rec, 'rIdP' + rels.length, cap, xi, 1.7, 6.1, 3.4); }
      else s += box('Missing picture', xi, 1.7, 6.1, 3.4, para(run('(picture could not be loaded)', {i: true, sz: 12, color: '9CA3AF'})), {fill: 'F3F4F6', anchor: 'ctr'});
      return s;
    };
    body += half(a, prev, 0.45, `Before: ${verLabel(prev)}`) + half(b, v, 6.8, `After: ${verLabel(v)}`);
    const fs = facts(p, v).filter(f => f[0] !== 'Location in the AN').slice(0, 2);
    fs.forEach((f, i) => { body += box(f[0], i ? 6.8 : 0.45, 5.3, fs.length > 1 ? 6.1 : 12.45, 1.65, factParas([f], 12, 260), {fill: 'F8FAFC', pad: 0.12}); });
    return {body, rels};
  }
  function commentSlide(sel, opt, footer, n, list, part, parts) {
    const {p, v} = sel; ID = 1; let paras = '';
    list.forEach((c, i) => {
      const r = c.r, who = `${r.role || 'Comment'}${r.name ? ' · ' + r.name : ''}`, rep = (r.answer || '').trim();
      paras += para(run(who, {b: true, sz: 12, color: '1D4ED8'}) + run(`  ${c.where} · ${stLabel[r.status || 'pending'] || r.status}`, {sz: 11, color: '6B7280'}), {before: i ? 12 : 0});
      paras += para(run(cut(r.text, 340), {sz: 13}), {before: 2});
      paras += para(run('Reply: ', {b: true, sz: 12, color: '15803D'}) + run(rep ? cut(rep, 300) : 'no reply written yet', {sz: 12, i: !rep, color: rep ? '1F2937' : '9CA3AF'}), {before: 3});
    });
    return {body: frame({title: `Comments on ${p.name} · ${verLabel(v)}${parts > 1 ? ` (${part}/${parts})` : ''}`, sub: cut(catPath(p.catId), 150), footer}, n) + box('Comments', 0.45, 1.4, 12.45, 5.55, paras, {fill: 'F8FAFC', pad: 0.18}), rels: []};
  }
  function titleSlide(opt, count) {
    ID = 1; const meta = [S.an.an_name, S.an.collaboration].filter(Boolean).join(' · ');
    return {dark: true, rels: [], body: rect('Accent', 0.7, 2.55, 0.12, 1.9, '3B82F6')
      + box('Deck title', 1.0, 2.45, 11.3, 1.4, para(run(opt.title, {sz: 38, b: true, color: 'FFFFFF'})), {anchor: 'b'})
      + box('Deck subtitle', 1.0, 3.9, 11.3, 0.9, para(run(S.an.title, {sz: 18, color: 'CBD5E1'})) + (meta ? para(run(meta, {sz: 14, color: '94A3B8'}), {before: 4}) : ''))
      + box('Deck footer', 1.0, 6.55, 11.3, 0.5, para(run(`${count} plot${count === 1 ? '' : 's'} · ${today()} · made with Analysis-Tracker`, {sz: 12, color: '64748B'})))};
  }

  /* ---------- the package ---------- */
  const NSA = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
  const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rels = list => `${HDR}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, t, target]) => `<Relationship Id="${id}" Type="${REL_NS}/${t}" Target="${target}"/>`).join('')}</Relationships>`;
  const fills = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const THEME = `${HDR}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Analysis-Tracker"><a:themeElements><a:clrScheme name="AT"><a:dk1><a:srgbClr val="1F2937"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="0F172A"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="15803D"/></a:accent2><a:accent3><a:srgbClr val="C2410C"/></a:accent3><a:accent4><a:srgbClr val="7C3AED"/></a:accent4><a:accent5><a:srgbClr val="0E7490"/></a:accent5><a:accent6><a:srgbClr val="6B7280"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="AT"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="AT"><a:fillStyleLst>${fills}${fills}${fills}</a:fillStyleLst><a:lnStyleLst>${'<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${fills}${fills}${fills}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
  const MASTER = `${HDR}<p:sldMaster ${NSA}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GRP}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="2600"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1400"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1400"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
  const LAYOUT = `${HDR}<p:sldLayout ${NSA} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GRP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  const slideXml = s => `${HDR}<p:sld ${NSA}><p:cSld>${s.bg || s.dark ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${s.bg || '0F172A'}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` : ''}<p:spTree>${GRP}${s.body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

  /* the package: slides = [{body, rels: [media keys], bg?: hex, dark?: bool}], media = Map(key -> {data, kind, w, h, n}) */
  function pack(slides, media) {
    const enc = new TextEncoder(), files = [], add = (name, str) => files.push({name, data: enc.encode(str)});
    const kinds = new Set([...media.values()].filter(Boolean).map(r => r.kind));
    add('[Content_Types].xml', `${HDR}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${kinds.has('png') ? '<Default Extension="png" ContentType="image/png"/>' : ''}${kinds.has('jpeg') ? '<Default Extension="jpeg" ContentType="image/jpeg"/>' : ''}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`);
    add('_rels/.rels', rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]));
    add('ppt/presentation.xml', `${HDR}<p:presentation ${NSA}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
    add('ppt/_rels/presentation.xml.rels', rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml'], ...slides.map((_, i) => ['rId' + (i + 3), 'slide', `slides/slide${i + 1}.xml`])]));
    add('ppt/slideMasters/slideMaster1.xml', MASTER); add('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]));
    add('ppt/slideLayouts/slideLayout1.xml', LAYOUT); add('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]));
    add('ppt/theme/theme1.xml', THEME);
    slides.forEach((s, i) => {
      add(`ppt/slides/slide${i + 1}.xml`, slideXml(s));
      add(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ...s.rels.map((fid, j) => { const r = media.get(fid); return ['rIdP' + (j + 1), 'image', `../media/img${r.n}.${r.kind}`]; })]));
    });
    media.forEach(r => { if (r) files.push({name: `ppt/media/img${r.n}.${r.kind}`, data: r.data}); });
    return new Blob([REL.zipBlob(files)], {type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'});
  }

  /* selection: [{p, v, prev}] -> slides */
  async function build(selection, opt, progress) {
    if (!selection.length) return null;
    const media = new Map(), need = []; selection.forEach(s => [s.v, opt.layout === 'compare' ? s.prev : null].forEach(v => { if (v && !need.some(n => n.file_id === v.file_id)) need.push(v); }));
    let done = 0; const q = [...need];
    await Promise.all(Array.from({length: Math.min(4, need.length)}, async () => { while (q.length) { await prepImage(q.shift(), media); progress && progress(++done, need.length); } }));
    let k = 0; media.forEach(r => { if (r) r.n = ++k; });
    const footer = [S.an.title, S.an.an_name].filter(Boolean).join(' · '), slides = [titleSlide(opt, selection.length)]; let n = 1;
    selection.forEach(sel => {
      n++; slides.push(opt.layout === 'compare' && sel.prev ? compareSlide(sel, opt, media, footer, n) : plotSlide(sel, opt, media, footer, n));
      if (opt.comments) {
        const cs = commentsOf(sel.v); if (!cs.length) return;
        const per = 3, parts = Math.ceil(cs.length / per);
        for (let i = 0; i < parts; i++) { n++; slides.push(commentSlide(sel, opt, footer, n, cs.slice(i * per, i * per + per), i + 1, parts)); }
      }
    });
    return {blob: pack(slides, media), slides: slides.length, plots: selection.length};
  }

  /* ---------- the dialog ---------- */
  const fileName = t => String(t || 'Plots').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) + '_' + today() + '.pptx';
  function candidates() {
    return visPlots().map(p => ({p, vs: verOf(p.id)})).sort((a, b) => catPath(a.p.catId).localeCompare(catPath(b.p.catId), undefined, {numeric: true}) || a.p.name.localeCompare(b.p.name, undefined, {numeric: true}));
  }
  function open_(opts = {}) {
    const rows = candidates(); if (!rows.length) { toast('There are no plots to put on slides yet.'); return; }
    const cats = [...new Set(rows.map(r => r.p.catId))], pre = new Set(opts.catId ? rows.filter(r => catWithKids(opts.catId).includes(r.p.catId)).map(r => r.p.id) : []);
    let last = null;
    const list = rows.map(({p, vs}) => {
      if (p.catId !== last) { last = p.catId; var head = `<div class="slhead" data-cat="${p.catId}">${esc(catPath(p.catId) || 'No category')}</div>`; } else head = '';
      return `${head}<div class="slrow" data-cat="${p.catId}"><label><input type="checkbox" name="p" value="${p.id}" ${pre.has(p.id) ? 'checked' : ''}> <span>${esc(p.name)}</span></label>
        <select name="v-${p.id}" aria-label="Version of ${esc(p.name)}">${[...vs].reverse().map((v, i) => `<option value="${v.id}">${verLabel(v)}${i === 0 ? ' (latest)' : ''}</option>`).join('')}</select></div>`;
    }).join('');
    openModal({title: 'Make slides from plots', submit: 'Make slides', xl: true, allowDemo: true,
      sub: 'Choose plots and versions. Each becomes a slide with its picture and the facts recorded for it. You get a PowerPoint file that Google Slides opens.',
      body: `${field('Deck title', `<input type="text" name="title" maxlength="120" value="${esc((S.an.title || 'Analysis') + ' — plots')}">`)}
        <div class="slbar"><button type="button" class="btn sm" data-sl="all">Select all</button><button type="button" class="btn sm" data-sl="none">Select none</button>
          ${cats.length > 1 ? `<select data-sl="cat" aria-label="Select a category"><option value="">Select a category…</option>${[...new Set(rows.map(r => r.p.catId))].map(c => `<option value="${c}">${esc(catPath(c) || 'No category')}</option>`).join('')}</select>` : ''}<span class="meta" id="slcount"></span></div>
        <div class="sllist">${list}</div>
        <div class="slopts">${radios('layout', [['one', 'One plot per slide'], ['compare', 'Before / after: previous version beside the chosen one']], 'one')}
          <label style="display:flex;gap:8px;align-items:center;font-size:13.5px"><input type="checkbox" name="comments" checked> Add a slide with the comments and replies after each plot</label></div>`,
      setup: f => {
        const upd = () => { const n = f.querySelectorAll('[name=p]:checked').length; $('#slcount', f).textContent = `${n} plot${n === 1 ? '' : 's'} selected`; };
        f.addEventListener('change', e => { if (e.target.name === 'p') upd(); if (e.target.dataset.sl === 'cat' && e.target.value) { f.querySelectorAll(`.slrow[data-cat="${e.target.value}"] [name=p]`).forEach(c => { c.checked = true; }); e.target.value = ''; upd(); } });
        f.addEventListener('click', e => { const b = e.target.closest('button[data-sl]'); if (!b) return; f.querySelectorAll('[name=p]').forEach(c => { c.checked = b.dataset.sl === 'all'; }); upd(); });
        upd();
      },
      onSubmit: async fd => {
        const ids = fd.getAll('p'); if (!ids.length) throw new Error('Tick at least one plot.');
        const opt = {title: (fd.get('title') || '').trim() || 'Plots', layout: fd.get('layout'), comments: !!fd.get('comments')};
        const sel = ids.map(id => { const p = plot(id), v = ver(fd.get('v-' + id)), vs = verOf(id), i = vs.findIndex(a => a.id === v.id); return {p, v, prev: i > 0 ? vs[i - 1] : null}; });
        const done = busy('Making the slides…');
        try {
          const r = await build(sel, opt, (i, n) => done.set(`Collecting plots… ${i} of ${n}`)), name = fileName(opt.title);
          const a = document.createElement('a'); a.href = URL.createObjectURL(r.blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => finished(name, r), 300);
        } finally { done(); }
      }});
  }
  function finished(name, r) {
    openModal({title: 'Your slides are ready', submit: 'Open Google Drive', allowDemo: true, sub: `<b>${esc(name)}</b> was saved to your downloads folder: ${r.slides} slides (${r.plots} plot${r.plots === 1 ? '' : 's'}).`,
      body: '<p style="margin-top:0"><b>To open it in Google Slides:</b></p><ol style="margin:0 0 8px 18px;line-height:1.7"><li>Click <b>Open Google Drive</b> below.</li><li>Drag the downloaded file into Drive (or <b>New → File upload</b>).</li><li>Right-click the file → <b>Open with → Google Slides</b>.</li></ol><p class="meta" style="margin:0">Nothing was sent anywhere by this page. The pictures are inside the file, so it also works in PowerPoint and LibreOffice.</p>',
      onSubmit: async () => { window.open('https://drive.google.com/drive/my-drive', '_blank', 'noopener'); }});
  }
  window.SLIDES = {run: open_, build, candidates, pack, prepImage};
})();
