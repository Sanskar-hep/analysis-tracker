/*! Analysis-Tracker - Copyright (c) 2026 Sanskar Nanda - MIT License (see LICENSE). https://github.com/Sanskar-hep */
/* One-click export of every comment, its reply and the plots involved to a Word (.docx) file that opens as a Google Doc.
 *
 * Why a .docx and not a direct push to Google: writing into Google Docs from a web page needs a Google sign-in and public
 * picture addresses, and the plots live in a private repository. A .docx carries the pictures inside, keeps the layout, and
 * Google Drive opens it as a normal Google Doc (right-click > Open with > Google Docs). Nothing is sent anywhere by this page.
 * Uses the app's globals (S, ver, plot, anv, fetchImage, busy, toast, openModal, ...) at call time. */
(function () {
  'use strict';
      /* the state of a comment, as on the website: in progress / answered (a reply is written) / open / resolved */
  const PURPLE = '7030A0', GREEN = '2E7D32', RED = 'C00000';
  const ST = {
    inprogress: {label: 'In progress', ink: PURPLE, rank: 0},
    answered: {label: 'Answered', ink: GREEN, rank: 1},
    resolved: {label: 'Answered', ink: GREEN, rank: 2},
    pending: {label: 'Open', ink: RED, rank: 3}};
  const stOf = c => c.status === 'resolved' ? 'resolved' : c.status === 'in_progress' ? 'inprogress' : (c.answer || '').trim() ? 'answered' : 'pending';
  const MAXW = 2400;                                              // pictures wider than this are scaled down (keeps the file small)

  /* ---------- small XML helpers ---------- */
  const clean = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
  const x = s => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const run = (t, o = {}) => {
    const pr = (o.b ? '<w:b/>' : '') + (o.i ? '<w:i/>' : o.i === false ? '<w:i w:val="0"/>' : '') + (o.color ? `<w:color w:val="${o.color}"/>` : '') + (o.sz ? `<w:sz w:val="${o.sz}"/>` : '');
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
  const capP = t => para(run(t, {sz: 18}), 'Cap');
  function pictures(imgs, media) {                                // one picture alone, or a two-column table (as reviewed | revised)
    const ok = imgs.filter(i => i.rec);
    const cell = (i, w, maxIn) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>${para(drawing(i.rec, 'rIdM' + i.rec.n, maxIn), 'Pic')}${capP(i.cap)}</w:tc>`;
    if (!ok.length) return '';
    if (ok.length === 1) return para(drawing(ok[0].rec, 'rIdM' + ok[0].rec.n, 4.8), 'Pic') + capP(ok[0].cap);
    let rows = ''; for (let i = 0; i < ok.length; i += 2) { const pair = ok.slice(i, i + 2); while (pair.length < 2) pair.push({cap: '', rec: null}); rows += `<w:tr><w:trPr><w:cantSplit/></w:trPr>${pair.map(p => p.rec ? cell(p, 4819, 3.0) : `<w:tc><w:tcPr><w:tcW w:w="4819" w:type="dxa"/></w:tcPr>${para('', 'Cap')}</w:tc>`).join('')}</w:tr>`; }
    return `<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="4819"/><w:gridCol w:w="4819"/></w:tblGrid>${rows}</w:tbl>` + para('', 'Cap');
  }
  /* a plain table: thin grey rules, no fills */
  const RULE = c => `<w:top w:val="single" w:sz="4" w:space="0" w:color="${c}"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="${c}"/>`;
  const table = (cols, rows, o = {}) => `<w:tbl><w:tblPr><w:tblW w:w="${cols.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${RULE('808080')}<w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>${o.grid ? '<w:left w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:right w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>' : ''}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${cols.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.map((r, ri) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c, i) => `<w:tc><w:tcPr><w:tcW w:w="${cols[i]}" w:type="dxa"/>${i === 0 && (Array.isArray(o.fill) ? o.fill[ri] : o.fill) ? `<w:shd w:val="clear" w:color="auto" w:fill="${Array.isArray(o.fill) ? o.fill[ri] : o.fill}"/>` : ''}</w:tcPr>${c || para('')}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;

  /* ---------- what goes into the document ---------- */
  const numeric = (a, b) => String(a).localeCompare(String(b), undefined, {numeric: true});
  function collect() {
    const vers = [...S.anv].sort((a, b) => a.number - b.number), secs = [];
    const vsOf = c => [c.resolvedVersionId, ...(c.resolvedMore || [])].map(id => id && ver(id)).filter(Boolean);
    const item = (title, c, reviewed, where) => {
      const vs = vsOf(c), imgs = [];
      if (reviewed) imgs.push({v: reviewed, cap: `As commented on: ${plot(reviewed.plotId).name} ${verLabel(reviewed)}`});
      vs.forEach(v => { if (!imgs.some(i => i.v.id === v.id)) imgs.push({v, cap: `Revised plot: ${plot(v.plotId).name} ${verLabel(v)}`}); });
      return {title, c, vs, imgs, where: where || ''};
    };
    const section = (title, groups) => { groups = groups.filter(g => g.items.length); groups.forEach(g => g.items.sort((a, b) => ST[stOf(a.c)].rank - ST[stOf(b.c)].rank)); if (groups.length) secs.push({title, groups}); };
    // comments that belong to a plot / figure of the AN
    section('Comments on plots and figures', vers.map(v => ({label: anvLabel(v) + ' review', items: figGroups(S.usages.filter(u => u.type === 'note' && u.anvId === v.id).sort((a, b) => numeric(a.fig, b.fig))).flatMap(g => g.flatMap(u => u.reviews.filter(r => !r.none).map(r => {
      const pv = ver(u.versionId), p = plot(pv.plotId);
      return item(`Figure ${u.fig}${r.scope === 'figure' ? ' (whole figure)' : u.panel ? ' (' + u.panel + ')' : ''}: ${p.name} ${verLabel(pv)}, ${catPath(p.catId)}${p.location ? '; location in the AN: ' + p.location : ''}`, r, pv, `Figure ${u.fig}${r.scope === 'figure' ? '' : u.panel ? ' (' + u.panel + ')' : ''}`);
    })))})));
    const byKind = kinds => vers.map(v => ({label: anvLabel(v) + ' review', items: S.anc.filter(c => c.source === 'an' && c.anvId === v.id && kinds.includes(c.kind)).map(c => item(c.location || COMMENT_KINDS[c.kind], c, null, c.location || ''))}));
    section('Methodology comments', byKind(['methodology']));
    section('General analysis comments', byKind(['general']));
    section('Comments on the text, tables and equations', byKind(['text', 'table', 'equation', 'figure']));
    const meet = new Map(), mk = (nm, d) => { const k = nm + '|' + (d || ''); if (!meet.has(k)) meet.set(k, {label: `${nm}${d ? ', ' + fmtDay(d) : ''}`, items: []}); return meet.get(k); };
    S.usages.filter(u => u.type !== 'note').forEach(u => u.reviews.filter(r => !r.none).forEach(r => { const pv = ver(u.versionId), p = plot(pv.plotId); mk(meetingName(u), u.date).items.push(item(`${p.name} ${verLabel(pv)}${u.slide ? ', slide ' + u.slide : ''}`, r, pv, `${p.name} ${verLabel(pv)}`)); }));
    S.anc.filter(c => c.source === 'meeting').forEach(c => mk(c.meeting, c.meeting_date).items.push(item(`${COMMENT_KINDS[c.kind] || 'Comment'}${c.location ? ': ' + c.location : ''}`, c, null, c.location || '')));
    section('Meeting comments', [...meet.values()].sort((a, b) => a.label.localeCompare(b.label)));
    return secs;
  }
  const replyText = c => {                                        // the analyst's reply, plus the reason given for each revised plot
    const own = (c.answer || '').trim();
    const why = (c.resolvedVersionId !== undefined ? [c.resolvedVersionId, ...(c.resolvedMore || [])] : []).map(id => id && ver(id)).filter(v => v && v.motivation && !/^Response to /.test(v.motivation)).map(v => `Revised plot ${plot(v.plotId).name} ${verLabel(v)}: ${v.motivation}`);
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
    items.sort((p, q) => ST[stOf(p.c)].rank - ST[stOf(q.c)].rank);          // in progress, answered, then open
    const all = items.map(i => i.c), B = [], count = k => all.filter(c => ST[stOf(c)].label === k).length;
    DOCPR = 1;
    const when = new Date().toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric'});
    B.push(text(`${S.an.an_name || S.an.title}: comments and replies`, 'Title'));
    B.push(text(`${S.an.an_name ? S.an.title + '. ' : ''}Updated ${when}.`, 'Meta'));
    B.push(para('', 'Meta'));
    const key = [['In progress', PURPLE], ['Answered', GREEN], ['Open', RED]];
    B.push(table([2200, 2200, 2200], [key.map(([l, c]) => para(run(l, {b: true, color: c}), 'Mid')), key.map(([l]) => para(run(String(count(l))), 'Mid'))], {grid: true}));
    B.push(para(run('The colour of each comment shows where it stands. Those in progress or answered come first.', {sz: 19}), 'Meta', '<w:spacing w:before="120" w:after="60"/>'));
    items.forEach(it => {
      const c = it.c, st = stOf(c), ink = ST[st].ink, rp = replyText(c), act = (c.resolution || '').trim();
      const by = [whoStr(c), it.where ? '(' + it.where + ')' : '', fmtDate(c.created)].filter(Boolean).join(' ');
      B.push(para(run(by, {b: true, color: ink}), 'Cm'));
      String(c.text || '').split(/\n{2,}/).map(t => t.trim()).filter(Boolean).forEach(t => B.push(para(run(t, {color: ink}), 'Txt')));
      const ans = [rp, act && act !== (c.answer || '').trim() ? act : ''].filter(Boolean).join('\n\n').split(/\n{2,}/).map(t => t.trim()).filter(Boolean);
      if (ans.length) ans.forEach((t, i) => B.push(para((i ? '' : run('Answer: ', {b: true})) + run(t), 'Ans')));
      else B.push(para(run('Answer: ', {b: true}) + run('not answered yet.'), 'Ans'));
      B.push(pictures(it.imgs, media));
    });
    return {body: B.join(''), media, count: all.length, plots: n};
  }

  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const F = 'Arial';
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${F}" w:hAnsi="${F}" w:cs="${F}"/><w:sz w:val="21"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Meta"><w:name w:val="Meta"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Mid"><w:name w:val="Table text"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="40" w:after="40"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Cm"><w:name w:val="Comment by"/><w:basedOn w:val="Normal"/><w:next w:val="Txt"/><w:pPr><w:keepNext/><w:pBdr><w:top w:val="single" w:sz="4" w:space="10" w:color="BFBFBF"/></w:pBdr><w:spacing w:before="280" w:after="40"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Txt"><w:name w:val="Comment text"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:after="80"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Ans"><w:name w:val="Answer"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/><w:spacing w:after="80"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Cap"><w:name w:val="Picture caption"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="40" w:after="120"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Pic"><w:name w:val="Picture"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:jc w:val="center"/><w:spacing w:before="120" w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style>
</w:styles>`;
  const FOOTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;

  async function build(progress) {
    const d = await buildDoc(progress); if (!d) return null;
    const enc = new TextEncoder(), files = [];
    const add = (name, str) => files.push({name, data: enc.encode(str)});
    const kinds = new Set([...d.media.values()].filter(Boolean).map(r => r.kind));
    add('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${kinds.has('png') ? '<Default Extension="png" ContentType="image/png"/>' : ''}${kinds.has('jpeg') ? '<Default Extension="jpeg" ContentType="image/jpeg"/>' : ''}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`);
    add('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    const rels = [...d.media.values()].filter(Boolean).map(r => `<Relationship Id="rIdM${r.n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/img${r.n}.${r.kind}"/>`).join('');
    add('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${rels}</Relationships>`);
    add('word/styles.xml', STYLES);
    add('word/footer1.xml', FOOTER);
    add('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${d.body}<w:sectPr><w:footerReference w:type="default" r:id="rIdF"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`);
    d.media.forEach(r => { if (r) files.push({name: `word/media/img${r.n}.${r.kind}`, data: r.data}); });
    const blob = REL.zipBlob(files); return {blob: new Blob([blob], {type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}), count: d.count, plots: d.plots};
  }

  const fileName = () => 'Response_to_comments_' + String(REL.workingName()).replace(/[^\w.-]+/g, '_') + '_' + today() + '.docx';
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', GDOCM = 'application/vnd.google-apps.document';

  /* ---------- download the file ---------- */
  async function download() {
    const done = busy('Preparing the document…');
    try {
      const r = await build((i, n) => done.set(`Collecting plots… ${i} of ${n}`));
      if (!r) { toast('There are no comments to export yet.'); return; }
      const name = fileName(), a = document.createElement('a'); a.href = URL.createObjectURL(r.blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
      openModal({title: 'Your document is ready', allowDemo: true, submit: 'Open Google Drive', sub: `<b>${esc(name)}</b> was saved to your downloads folder: ${r.count} comment${r.count === 1 ? '' : 's'} with their replies and ${r.plots} plot${r.plots === 1 ? '' : 's'}.`,
        body: `<p style="margin-top:0"><b>To turn it into a Google Doc:</b></p><ol style="margin:0 0 8px 18px;line-height:1.7"><li>Click <b>Open Google Drive</b> below.</li><li>Drag the downloaded file into Drive (or <b>New → File upload</b>).</li><li>Right-click the file → <b>Open with → Google Docs</b>. Then use <b>File → Save as Google Docs</b> to keep an editable copy.</li><li>Use <b>Share</b> to send it to your colleagues.</li></ol><p class="meta">The pictures are inside the file; nothing was sent to Google by this website.</p>`,
        onSubmit: async () => { window.open('https://drive.google.com/drive/my-drive', '_blank', 'noopener'); }});
    } catch (e) { toast('Could not build the document: ' + e.message, 'err', 9000); } finally { done(); }
  }

  /* ---------- a Google Doc linked to this analysis ---------- */
  /* The link (file id) lives on this device. Updating needs the user's own Google sign-in (token flow, "files created by this app"
   * permission only), so it can run only while this page is open and the sign-in is still valid; otherwise "Update now" asks again. */
  let forceReal = false;                                           // test hook: treat the demo as a real repository
  const demoOn = () => !forceReal && typeof GHS !== 'undefined' && GHS.demo;
  let demoLink = null, working = false, timer = null;
  const lkKey = () => 'at_gdoc_' + (S && S.an ? S.an.id : '');
  const getLink = () => { if (demoOn()) return demoLink || (demoLink = {id: 'demo', url: '#', name: 'Response to comments', at: Date.now(), sig: null}); try { return JSON.parse(localStorage.getItem(lkKey()) || 'null'); } catch { return null; } };
  const setLink = v => { if (demoOn()) { demoLink = v; return; } try { v ? localStorage.setItem(lkKey(), JSON.stringify(v)) : localStorage.removeItem(lkKey()); } catch {} };
  const sig = () => {                                              // changes whenever something the document shows changes
    const j = JSON.stringify([S.usages.flatMap(u => u.reviews).filter(r => !r.none).map(r => [r.id, r.status, r.answer, r.resolution, r.text, r.resolvedVersionId, r.resolvedMore]), S.anc.map(c => [c.id, c.status, c.answer, c.resolution, c.text])]);
    let h = 5381; for (let i = 0; i < j.length; i++) h = ((h << 5) + h + j.charCodeAt(i)) | 0; return String(h);
  };
  const clock = t => new Date(t).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  function badgeInner() {
    const lk = getLink(); if (!lk) return '';
    if (working) return '<span class="dot"></span>Updating the Google Doc…';
    const stale = !demoOn() && lk.sig !== sig();
    const open = lk.url && lk.url !== '#' ? ` <a href="${esc(lk.url)}" target="_blank" rel="noopener noreferrer">Open</a>` : '';
    return stale ? `<span class="dot"></span>Google Doc is out of date${lk.err ? ' (' + esc(lk.err) + ')' : ''} <button type="button" class="btn sm" data-gd="sync">Update now</button>${open}`
      : `<span class="dot"></span>Google Doc ${demoOn() ? 'linked (demo)' : 'up to date, ' + clock(lk.at)}${open}`;
  }
  const badge = () => getLink() ? `<span class="gsync" data-gsync>${badgeInner()}</span>` : '';
  const paint = () => document.querySelectorAll('[data-gsync]').forEach(el => { el.innerHTML = badgeInner(); el.classList.toggle('stale', !!getLink() && !working && !demoOn() && getLink().sig !== sig()); });

  async function push(quiet) {
    const lk = getLink(); if (!lk || working) return false;
    if (demoOn()) { toast('Demo: in your own copy this updates your Google Doc (it cannot be done here).'); return false; }
    working = true; paint();
    try {
      const mine = sig(), token = await DECK.googleToken(quiet), r = await build();
      if (!r) throw Object.assign(new Error('There are no comments to export yet.'), {gcode: 'none'});
      await DECK.driveUpload({token, blob: r.blob, from: DOCX, to: GDOCM, fileId: lk.id, name: lk.name});
      setLink({...lk, at: Date.now(), sig: mine, err: ''}); if (!quiet) toast('The Google Doc was updated.'); return true;
    } catch (e) {
      const soft = ['denied', 'popup', 'auth'].includes(e.gcode) || /interaction_required|consent_required|login_required/.test(e.message || '');
      setLink({...lk, err: soft ? 'Google sign-in needed' : e.message}); if (!quiet || !soft) toast('Google Doc not updated: ' + e.message, 'err', 9000); return false;
    } finally { working = false; paint(); }
  }
  function changed() {                                             // called after every reload of the analysis data
    const lk = getLink(); paint(); if (!lk || demoOn() || lk.sig === sig() || lk.off) return;
    clearTimeout(timer); timer = setTimeout(() => push(true), 6000);
  }
  function setup(msg) {
    openModal({title: 'Connect Google', submit: 'Save and continue', allowDemo: true,
      sub: msg || 'A linked Google Doc needs a Google "OAuth client ID" for this website. It is a public identifier, not a secret. One-time setup (the same one Meeting Slides uses).',
      body: `<ol style="margin:0 0 10px 18px;line-height:1.7"><li>Open <b>console.cloud.google.com</b>, create a project, and enable the <b>Google Drive API</b>.</li><li>Under <b>APIs &amp; Services → OAuth consent screen</b> set up the app (External is fine; add yourself as a test user).</li><li><b>Credentials → Create credentials → OAuth client ID → Web application</b>. Add <code>${esc(location.origin)}</code> under <i>Authorised JavaScript origins</i>.</li><li>Paste the client ID (ends in <code>.apps.googleusercontent.com</code>) below. It is saved on this device only.</li></ol>
        ${field('OAuth client ID', `<input type="text" name="cid" value="${esc(DECK.clientId())}" placeholder="1234-abc.apps.googleusercontent.com" autocomplete="off" spellcheck="false">`, 'Only the Drive "files created by this app" permission is requested: the app cannot read your other Drive files.')}`,
      onSubmit: async fd => { const v = (fd.get('cid') || '').trim(); if (!/\.apps\.googleusercontent\.com$/.test(v)) throw new Error('That does not look like a client ID. It should end in .apps.googleusercontent.com'); DECK.setClientId(v); setTimeout(link, 100); }});
  }
  async function link() {
    if (demoOn()) { toast('In the demo the Google Doc is already shown as linked. Sign in with your own repository to link a real one.'); return; }
    if (!DECK.clientId()) return setup();
    const done = busy('Connecting to Google…');
    try {
      const token = await DECK.googleToken(false); done.set('Creating the Google Doc…');
      const r = await build((i, n) => done.set(`Collecting plots… ${i} of ${n}`)); if (!r) { toast('There are no comments to export yet.'); return; }
      const mine = sig(), name = `Response to comments - ${REL.workingName()}`;
      const f = await DECK.driveUpload({token, name, blob: r.blob, from: DOCX, to: GDOCM});
      setLink({id: f.id, url: f.webViewLink || `https://docs.google.com/document/d/${f.id}/edit`, name, at: Date.now(), sig: mine, err: ''}); paint();
      openModal({title: 'Google Doc linked', submit: 'Open the Google Doc', allowDemo: true, sub: `<b>${esc(name)}</b> was created in your Google Drive with ${r.count} comment${r.count === 1 ? '' : 's'}.`,
        body: `<p style="margin-top:0">From now on it is brought up to date a few seconds after you save an answer, resolve a comment or change its status, while this site is open in your browser.</p><p class="meta">Google sign-in lasts about an hour; after that a yellow <b>Update now</b> button appears and one click refreshes the document. Anything typed directly into the Google Doc is replaced at the next update, so make your changes on this site.</p>`,
        onSubmit: async () => { window.open(getLink().url, '_blank', 'noopener'); }});
    } catch (e) { if (e.gcode === 'noclient') setup(); else toast('Could not create the Google Doc: ' + e.message, 'err', 9000); } finally { done(); }
  }
  function hub() {
    const lk = getLink();
    const {m} = openModal({title: 'Export to Google Docs', submit: 'Close', allowDemo: true, sub: 'Every comment and your answer, with its plots. Comments in progress or answered are listed first.',
      body: `<div class="f"><label class="l">Keep a Google Doc up to date</label>${lk
        ? `<div class="gsync" data-gsync>${badgeInner()}</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button type="button" class="btn sm primary" data-gd="sync">Update now</button><button type="button" class="btn sm" data-gd="unlink">Stop linking</button></div><div class="h">Updates itself a few seconds after you answer or resolve a comment, while this site is open and your Google sign-in is active. Text typed straight into the Google Doc is replaced at the next update.</div>`
        : `<div class="h" style="margin:0 0 8px">Creates a Google Doc in your Drive and refreshes it whenever you answer or resolve a comment. Needs a one-time Google setup.</div><button type="button" class="btn primary" data-gd="link">Create a linked Google Doc</button>`}</div>
      <div class="f"><label class="l">Or download a file</label><button type="button" class="btn" data-gd="download">Download .docx</button><div class="h">Open it in Google Docs yourself. Not connected to the website afterwards.</div></div>`,
      onSubmit: async () => {}});
    return m;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-gd]'); if (!b) return; e.preventDefault();
    const k = b.dataset.gd, close = () => { const o = b.closest('.overlay'); if (o) o.remove(); };
    if (k === 'download') { close(); download(); }
    else if (k === 'link') { close(); link(); }
    else if (k === 'sync') push(false);
    else if (k === 'unlink') { setLink(null); close(); paint(); toast('Unlinked. The Google Doc stays in your Drive, but it will no longer be updated.'); }
  });

  window.GDOC = {_real: v => { forceReal = !!v; }, run: hub, download, build, collect, fileName, badge, changed, link, push, getLink, stOf};
})();
