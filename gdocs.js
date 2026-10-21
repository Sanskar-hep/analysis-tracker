/*! Analysis-Tracker - Copyright (c) 2026 Sanskar Nanda - MIT License (see LICENSE). https://github.com/Sanskar-hep */
/* One-click export of every comment, its reply and the plots involved to a Word (.docx) file that opens as a Google Doc.
 *
 * Why a .docx and not a direct push to Google: writing into Google Docs from a web page needs a Google sign-in and public
 * picture addresses, and the plots live in a private repository. A .docx carries the pictures inside, keeps the layout, and
 * Google Drive opens it as a normal Google Doc (right-click > Open with > Google Docs). Nothing is sent anywhere by this page.
 * Uses the app's globals (S, ver, plot, anv, fetchImage, busy, toast, openModal, ...) at call time. */
(function () {
  'use strict';
  const stLabel = {pending: 'Open', in_progress: 'In progress', resolved: 'Resolved'};
  const stColor = {pending: 'C2410C', in_progress: '1D4ED8', resolved: '15803D'};
  const MAXW = 2400;                                              // pictures wider than this are scaled down (keeps the file small)

  /* ---------- small XML helpers ---------- */
  const clean = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
  const x = s => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const run = (t, o = {}) => {
    const pr = (o.b ? '<w:b/>' : '') + (o.i ? '<w:i/>' : '') + (o.color ? `<w:color w:val="${o.color}"/>` : '') + (o.sz ? `<w:sz w:val="${o.sz}"/>` : '');
    const parts = clean(t).split('\n');
    return parts.map((p, i) => `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${x(p)}</w:t></w:r>`).join('');
  };
  const para = (runs, style, extra = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>${runs}</w:p>`;
  const text = (t, style, o) => para(run(t, o), style);
  const lines = (t, style) => String(t || '').split(/\n{2,}/).map(b => b.trim()).filter(Boolean).map(b => para(run(b), style)).join('');

  /* ---------- pictures ---------- */
  const loadImg = url => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('decode')); im.src = url; });
  const toBytes = async blob => new Uint8Array(await blob.arrayBuffer());
  async function prepImage(v, media) {
    const key = v.file_id; if (media.has(key)) return media.get(key);
    let rec = null;
    try {
      const url = await fetchImage(S.an.id, v.file_id, v.ext || '.png'), src = await (await fetch(url)).blob(), im = await loadImg(url);
      let w = im.naturalWidth || 800, h = im.naturalHeight || 600, ext = (v.ext || '.png').toLowerCase(), data, kind;
      const native = ext === '.png' || ext === '.jpg' || ext === '.jpeg';
      if (native && w <= MAXW) { data = await toBytes(src); kind = ext === '.png' ? 'png' : 'jpeg'; }
      else {
        const k = Math.min(1, MAXW / w), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k)), cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        const g = cv.getContext('2d'); if (ext === '.jpg' || ext === '.jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch); }
        g.drawImage(im, 0, 0, cw, ch); const jpg = ext === '.jpg' || ext === '.jpeg';
        data = await toBytes(await new Promise(r => cv.toBlob(r, jpg ? 'image/jpeg' : 'image/png', 0.92))); kind = jpg ? 'jpeg' : 'png'; w = cw; h = ch;
      }
      rec = {data, kind, w, h, n: media.size + 1};
    } catch (e) { rec = null; }
    media.set(key, rec); return rec;
  }
  let DOCPR = 1;
  function drawing(rec, rid, maxIn) {
    const maxE = Math.round(maxIn * 914400), k = Math.min(1, maxE / rec.w / 9525 * 1), cx = Math.round(rec.w * 9525 * k), cy = Math.round(rec.h * 9525 * k), id = DOCPR++;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Plot ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>`
      + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="plot${id}"/><pic:cNvPicPr/></pic:nvPicPr>`
      + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }
  function pictures(imgs, media) {                                // one picture alone, or a two-column table (as reviewed | revised)
    const ok = imgs.filter(i => i.rec);
    const cell = (i, w, maxIn) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>${para(run(i.cap, {b: true, sz: 18}), 'Cap')}${para(drawing(i.rec, 'rIdM' + i.rec.n, maxIn), 'Pic')}</w:tc>`;
    if (!ok.length) return '';
    if (ok.length === 1) return para(run(ok[0].cap, {b: true, sz: 18}), 'Cap') + para(drawing(ok[0].rec, 'rIdM' + ok[0].rec.n, 4.8), 'Pic');
    let rows = ''; for (let i = 0; i < ok.length; i += 2) { const pair = ok.slice(i, i + 2); while (pair.length < 2) pair.push({cap: '', rec: null}); rows += `<w:tr>${pair.map(p => p.rec ? cell(p, 4819, 3.2) : `<w:tc><w:tcPr><w:tcW w:w="4819" w:type="dxa"/></w:tcPr>${para('', 'Pic')}</w:tc>`).join('')}</w:tr>`; }
    return `<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="4819"/><w:gridCol w:w="4819"/></w:tblGrid>${rows}</w:tbl>` + para('', 'Pic');
  }

  /* ---------- what goes into the document ---------- */
  const numeric = (a, b) => String(a).localeCompare(String(b), undefined, {numeric: true});
  function collect() {
    const vers = [...S.anv].sort((a, b) => a.number - b.number), secs = [];
    const vsOf = c => [c.resolvedVersionId, ...(c.resolvedMore || [])].map(id => id && ver(id)).filter(Boolean);
    const item = (title, c, reviewed) => {
      const vs = vsOf(c), imgs = [];
      if (reviewed) imgs.push({v: reviewed, cap: `As commented on: ${plot(reviewed.plotId).name} ${verLabel(reviewed)}`});
      vs.forEach(v => { if (!imgs.some(i => i.v.id === v.id)) imgs.push({v, cap: `Revised plot: ${plot(v.plotId).name} ${verLabel(v)}`}); });
      return {title, c, vs, imgs};
    };
    const section = (title, groups) => { groups = groups.filter(g => g.items.length); if (groups.length) secs.push({title, groups}); };
    // comments that belong to a plot / figure of the AN
    section('Comments on plots and figures', vers.map(v => ({label: anvLabel(v) + ' review', items: figGroups(S.usages.filter(u => u.type === 'note' && u.anvId === v.id).sort((a, b) => numeric(a.fig, b.fig))).flatMap(g => g.flatMap(u => u.reviews.filter(r => !r.none).map(r => {
      const pv = ver(u.versionId), p = plot(pv.plotId);
      return item(`Figure ${u.fig}${r.scope === 'figure' ? ' (whole figure)' : u.panel ? ' — ' + u.panel : ''} · ${catPath(p.catId)} / ${p.name} (${verLabel(pv)})${p.location ? ' · location in the AN: ' + p.location : ''}`, r, pv);
    })))})));
    const byKind = kinds => vers.map(v => ({label: anvLabel(v) + ' review', items: S.anc.filter(c => c.source === 'an' && c.anvId === v.id && kinds.includes(c.kind)).map(c => item(c.location || COMMENT_KINDS[c.kind], c, null))}));
    section('Methodology comments', byKind(['methodology']));
    section('General analysis comments', byKind(['general']));
    section('Comments on the text, tables and equations', byKind(['text', 'table', 'equation', 'figure']));
    const meet = new Map(), mk = (nm, d) => { const k = nm + '|' + (d || ''); if (!meet.has(k)) meet.set(k, {label: `${nm}${d ? ' — ' + fmtDay(d) : ''}`, items: []}); return meet.get(k); };
    S.usages.filter(u => u.type !== 'note').forEach(u => u.reviews.filter(r => !r.none).forEach(r => { const pv = ver(u.versionId), p = plot(pv.plotId); mk(meetingName(u), u.date).items.push(item(`${p.name} ${verLabel(pv)}${u.slide ? ' · slide ' + u.slide : ''}`, r, pv)); }));
    S.anc.filter(c => c.source === 'meeting').forEach(c => mk(c.meeting, c.meeting_date).items.push(item(`${COMMENT_KINDS[c.kind] || 'Comment'}${c.location ? ' · ' + c.location : ''}`, c, null)));
    section('Meeting comments', [...meet.values()].sort((a, b) => a.label.localeCompare(b.label)));
    return secs;
  }
  const replyText = c => {                                        // the analyst's reply, plus the reason given for each revised plot
    const own = (c.answer || '').trim();
    const why = (c.resolvedVersionId !== undefined ? [c.resolvedVersionId, ...(c.resolvedMore || [])] : []).map(id => id && ver(id)).filter(v => v && v.motivation && !/^Response to /.test(v.motivation)).map(v => `Revised plot ${plot(v.plotId).name} (${verLabel(v)}): ${v.motivation}`);
    return [own, ...why].filter(Boolean).join('\n\n');
  };

  /* ---------- the document ---------- */
  async function buildDoc(progress) {
    const secs = collect(), items = secs.flatMap(s => s.groups.flatMap(g => g.items));
    if (!items.length) return null;
    const media = new Map(), need = []; items.forEach(it => it.imgs.forEach(i => { if (!need.some(n => n.file_id === i.v.file_id)) need.push(i.v); }));
    let done = 0, q = [...need]; await Promise.all(Array.from({length: Math.min(4, need.length)}, async () => { while (q.length) { const v = q.shift(); await prepImage(v, media); progress && progress(++done, need.length); } }));
    // numbers are assigned after loading so that every stored picture has one
    let n = 0; media.forEach(r => { if (r) r.n = ++n; });
    items.forEach(it => it.imgs.forEach(i => { i.rec = media.get(i.v.file_id) || null; }));
    const all = items.map(i => i.c), cnt = k => all.filter(c => (c.status || 'pending') === k).length, B = [];
    DOCPR = 1;
    B.push(text(`Comments and Responses — ${REL.workingName()}`, 'Title'));
    B.push(text(`${S.an.title}${S.an.an_name ? ' · ' + S.an.an_name : ''}${S.an.collaboration ? ' · ' + S.an.collaboration : ''}`, 'Meta'));
    B.push(text(`Exported ${today()} from the Analysis-Tracker. ${all.length} comment${all.length === 1 ? '' : 's'}: ${cnt('pending')} open · ${cnt('in_progress')} in progress · ${cnt('resolved')} resolved.`, 'Meta'));
    B.push(para(run('How to read this document: ', {b: true, sz: 20}) + run('each comment appears in a blue box, followed by the reply in a green box, the action taken, and the plots involved (as commented on, and the revised plot).', {sz: 20}), 'Meta'));
    secs.forEach(s => {
      B.push(text(s.title, 'Heading1'));
      s.groups.forEach(g => {
        B.push(text(g.label, 'Heading2'));
        g.items.forEach(it => {
          const c = it.c, st = c.status || 'pending';
          B.push(text(it.title, 'Heading3'));
          B.push(para(run('Comment', {b: true}) + run(` — ${whoStr(c)}, ${fmtDate(c.created)}  ·  `) + run(stLabel[st] || st, {b: true, color: stColor[st] || '444444'}), 'CBox'));
          B.push(lines(c.text, 'CBox') || para('', 'CBox'));
          const rp = replyText(c);
          B.push(para(run('Reply', {b: true}) + (rp ? '' : run(' — no reply written yet', {i: true, color: '777777'})), 'RBox'));
          if (rp) B.push(lines(rp, 'RBox'));
          const act = (c.resolution || '').trim(); if (act) B.push(para(run('Action taken: ', {b: true}) + run(act), 'RBox'));
          it.vs.forEach(v => { if ((v.changes || '').trim()) B.push(para(run(`${plot(v.plotId).name} ${verLabel(v)} — what changed: `, {b: true}) + run(v.changes.trim()), 'RBox')); });
          if (c.anchor && c.anchor.page) B.push(para(run('Where in the AN PDF: ', {b: true, color: '555555'}) + run('page ' + c.anchor.page, {color: '555555'}), 'RBox'));
          const miss = it.imgs.filter(i => !i.rec); if (miss.length) B.push(para(run('(picture not embedded: ' + miss.map(i => i.cap).join('; ') + ')', {i: true, color: '999999', sz: 18}), 'RBox'));
          B.push(pictures(it.imgs, media));
        });
      });
    });
    return {body: B.join(''), media, count: all.length, plots: n};
  }

  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const box = (color, fill, left) => `<w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="${color}"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="${fill}"/><w:ind w:left="${left}" w:right="120"/><w:spacing w:before="0" w:after="0" w:line="276" w:lineRule="auto"/>`;
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/><w:color w:val="111827"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="480" w:after="120"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="CBD5E1"/></w:pBdr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="34"/><w:color w:val="1E3A8A"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="1F2937"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="260" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/><w:color w:val="374151"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Meta"><w:name w:val="Meta"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="20"/><w:color w:val="4B5563"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="CBox"><w:name w:val="Comment box"/><w:basedOn w:val="Normal"/><w:pPr>${box('2F6FEB', 'EEF3FD', 120)}</w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="RBox"><w:name w:val="Reply box"/><w:basedOn w:val="Normal"/><w:pPr>${box('2E9E5B', 'EFF9F3', 720)}</w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Cap"><w:name w:val="Picture caption"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="40"/></w:pPr><w:rPr><w:color w:val="374151"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Pic"><w:name w:val="Picture"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="160"/></w:pPr></w:style>
</w:styles>`;

  async function build(progress) {
    const d = await buildDoc(progress); if (!d) return null;
    const enc = new TextEncoder(), files = [];
    const add = (name, str) => files.push({name, data: enc.encode(str)});
    const kinds = new Set([...d.media.values()].filter(Boolean).map(r => r.kind));
    add('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${kinds.has('png') ? '<Default Extension="png" ContentType="image/png"/>' : ''}${kinds.has('jpeg') ? '<Default Extension="jpeg" ContentType="image/jpeg"/>' : ''}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
    add('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    const rels = [...d.media.values()].filter(Boolean).map(r => `<Relationship Id="rIdM${r.n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/img${r.n}.${r.kind}"/>`).join('');
    add('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels}</Relationships>`);
    add('word/styles.xml', STYLES);
    add('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${d.body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`);
    d.media.forEach(r => { if (r) files.push({name: `word/media/img${r.n}.${r.kind}`, data: r.data}); });
    const blob = REL.zipBlob(files); return {blob: new Blob([blob], {type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}), count: d.count, plots: d.plots};
  }

  const fileName = () => 'Comments_and_Responses_' + String(REL.workingName()).replace(/[^\w.-]+/g, '_') + '_' + today() + '.docx';
  async function run_() {
    const done = busy('Preparing the document…');
    try {
      const r = await build((i, n) => done.set(`Collecting plots… ${i} of ${n}`));
      if (!r) { toast('There are no comments to export yet.'); return; }
      const name = fileName(), a = document.createElement('a'); a.href = URL.createObjectURL(r.blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
      openModal({title: 'Your document is ready', submit: 'Open Google Drive', sub: `<b>${esc(name)}</b> was saved to your downloads folder: ${r.count} comment${r.count === 1 ? '' : 's'} with their replies and ${r.plots} plot${r.plots === 1 ? '' : 's'}.`,
        body: `<p style="margin-top:0"><b>To turn it into a Google Doc:</b></p><ol style="margin:0 0 8px 18px;line-height:1.7"><li>Click <b>Open Google Drive</b> below.</li><li>Drag the downloaded file into Drive (or <b>New → File upload</b>).</li><li>Right-click the file → <b>Open with → Google Docs</b>. Then use <b>File → Save as Google Docs</b> to keep an editable copy.</li><li>Use <b>Share</b> to send it to your colleagues.</li></ol><p class="meta">The pictures are inside the file; nothing was sent to Google by this website.</p>`,
        onSubmit: async () => { window.open('https://drive.google.com/drive/my-drive', '_blank', 'noopener'); }});
    } catch (e) { toast('Could not build the document: ' + e.message, 'err', 9000); } finally { done(); }
  }
  window.GDOC = {run: run_, build, collect, fileName};
})();
