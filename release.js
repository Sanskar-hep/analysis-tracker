/*! Analysis-Tracker - Copyright (c) 2026 Sanskar Nanda - MIT License (see LICENSE). https://github.com/Sanskar-hep */
/* Release preparation: the working version of the AN, its change summary, and the downloadable ZIP package.
 *
 * The "working version" is simply what the tracker already holds: every plot at its NEWEST version (unreleased drafts included).
 * Released AN versions are never touched: their plots are the versions stamped with that release. So whenever a plot is
 * uploaded or updated, the working version follows automatically, and older plot versions stay in the plot's history.
 * Uses the app's globals (S, api, aurl, openModal, ...) at call time. */
(function () {
  'use strict';
  const cmpV = (a, b) => a.num - b.num || a.rev - b.rev;
  const lastNum = () => S.anv.length ? Math.max(...S.anv.map(v => v.number)) : 0;
  const lastRelease = () => S.anv.find(v => v.number === lastNum()) || null;
  const nextNum = () => lastNum() + 1;
  const workingName = () => ((S.work && S.work.name) || '').trim() || 'AN_v' + nextNum();
  const suggestedNumber = () => { const m = /(\d+)\s*$/.exec(workingName()); return m ? parseInt(m[1], 10) : nextNum(); };
  const one = (s, n = 140) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const safe = s => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^[_.]+|[_.]+$/g, '') || 'untitled';
  /* the response as the analyst wrote it; the reasons given for revised plots are linked in from the plot versions (never typed twice) */
  const fullRsp = c => { const own = (c.answer || '').trim(), n = c.resolvedVersionId !== undefined ? [c.resolvedVersionId, ...(c.resolvedMore || [])].map(id => id && ver(id)).filter(v => v && v.motivation && !/^Response to /.test(v.motivation)).map(v => `Revised plot ${plot(v.plotId).name} (${verLabel(v)}): ${v.motivation}`) : []; return [own, ...n].filter(Boolean).join(' ').trim(); };
  const nodot = s => String(s || '').replace(/[.\s]+$/, '');
  const stLabel = {pending: 'Open', in_progress: 'In progress', resolved: 'Resolved'};

  /* ---------------- what is in the working version, compared with the last release ---------------- */
  function inventory() {
    const L = lastNum(), out = [];
    S.plots.forEach(p => {
      const all = S.versions.filter(v => v.plotId === p.id).sort(cmpV); if (!all.length) return;
      const latest = all[all.length - 1];
      const rel = L ? [...all].filter(v => v.anvId && anv(v.anvId).number <= L).pop() || null : null;
      const status = !rel ? 'new' : latest.id === rel.id ? 'unchanged' : 'updated';
      const newer = rel ? all.filter(v => cmpV(v, rel) > 0) : all;
      const ids = new Set(all.map(v => v.id));
      const rs = S.usages.filter(u => u.type === 'note' && ids.has(u.versionId)).flatMap(u => u.reviews.filter(r => !r.none));
      out.push({p, latest, rel, status, newer, path: catPath(p.catId), open: rs.filter(isOpen).length, done: rs.filter(r => r.status === 'resolved').length});
    });
    return out.sort((a, b) => a.path.localeCompare(b.path, undefined, {numeric: true, sensitivity: 'base'}) || a.p.name.localeCompare(b.p.name, undefined, {numeric: true, sensitivity: 'base'}));
  }
  const counts = inv => ({total: inv.length, updated: inv.filter(x => x.status === 'updated').length, added: inv.filter(x => x.status === 'new').length, unchanged: inv.filter(x => x.status === 'unchanged').length});

  /* ---------------- the change summary, generated from what is recorded ---------------- */
  function summary() {
    const inv = inventory(), last = lastRelease(), since = last ? last.created : 0, name = workingName();
    const S_ = {plots: [], newp: [], addressed: [], method: [], other: [], unchanged: [], open: []};
    inv.filter(x => x.status === 'updated').forEach(x => {
      const parts = x.newer.map(v => {
        let t = `${verLabel(v)} — what changed: ${nodot(one(v.changes, 200))}`;
        if (v.motivation && !/^Response to /.test(v.motivation)) t += `. Why it changed: ${nodot(one(v.motivation, 200))}`;
        const f = v.review_id && findReview(v.review_id);
        if (f) t += `. Associated comment: ${whoStr(f.r)} “${one(f.r.text, 90)}”${(f.r.answer || '').trim() ? ' — response: ' + nodot(one(f.r.answer, 220)) : ''} — status: ${stLabel[f.r.status] || f.r.status}`;
        return t;
      });
      S_.plots.push({auto: true, text: `Updated ${x.path ? x.path + ' / ' : ''}${x.p.name}: ${verLabel(x.rel)} → ${verLabel(x.latest)}. ${parts.join(' · ')}`});
    });
    inv.filter(x => x.status === 'new').forEach(x => S_.newp.push({auto: true, text: `Added ${x.path ? x.path + ' / ' : ''}${x.p.name} (${verLabel(x.latest)})${x.p.location ? ' — location in the AN: ' + x.p.location : ''}${x.latest.summary ? '. ' + one(x.latest.summary, 120) : ''}`}));
    const resolvedNow = r => r.status === 'resolved' && (r.resolvedAt || r.resolved_at || 0) >= since;
    const act = c => one(c.answer || c.resolution || 'Resolved', 200);
    S.usages.forEach(u => u.reviews.filter(r => !r.none).forEach(r => {
      const lbl = u.type === 'note' ? `Figure ${u.fig}${u.panel && r.scope !== 'figure' ? ' (' + u.panel + ')' : ''}` : `${meetingName(u)}${u.slide ? ', slide ' + u.slide : ''}`;
      const vs = [r.resolvedVersionId, ...(r.resolvedMore || [])].map(id => id && ver(id)).filter(Boolean);
      if (resolvedNow(r)) S_.addressed.push({auto: true, text: `${lbl}: “${one(r.text, 110)}” — ${act(r)}${vs.length ? ` [updated plot: ${vs.map(v => plot(v.plotId).name + ' ' + verLabel(v)).join(', ')}]` : ''}`});
      else if (isOpen(r)) S_.open.push({auto: true, text: `${lbl}: “${one(r.text, 110)}” — ${stLabel[r.status] || r.status}`});
    }));
    S.anc.forEach(c => {
      const lbl = c.source === 'meeting' ? `${c.meeting}${c.location ? ', ' + c.location : ''}` : (c.location || COMMENT_KINDS[c.kind] || 'Comment');
      if (resolvedNow(c)) (c.kind === 'methodology' ? S_.method : S_.addressed).push({auto: true, text: `${lbl}: “${one(c.text, 110)}” — ${act(c)}${c.resolution && c.answer ? ' [action: ' + one(c.resolution, 140) + ']' : ''}`});
      else if (isOpen(c)) S_.open.push({auto: true, text: `${lbl}: “${one(c.text, 110)}” — ${stLabel[c.status] || c.status}`});
    });
    ((S.work && S.work.entries) || []).forEach(e => (e.section === 'plots' ? S_.plots : e.section === 'methodology' ? S_.method : S_.other).push({auto: false, id: e.id, text: e.text}));
    const un = inv.filter(x => x.status === 'unchanged');
    if (un.length) S_.unchanged.push({auto: true, text: `${un.length} plot${un.length === 1 ? ' was' : 's were'} retained without modification: ${un.map(x => (x.path ? x.path + ' / ' : '') + x.p.name).join('; ')}`});
    const sections = [
      {key: 'plots', title: 'Plot Updates', items: S_.plots}, {key: 'newp', title: 'New Plots', items: S_.newp},
      {key: 'addressed', title: 'Reviewer Comments Addressed', items: S_.addressed}, {key: 'method', title: 'Methodology and Analysis Changes', items: S_.method},
      {key: 'other', title: 'Other Changes', items: S_.other}, {key: 'unchanged', title: 'Unchanged Content', items: S_.unchanged}, {key: 'open', title: 'Still Open (not yet resolved)', items: S_.open}];
    const md = [`# Change Summary — ${name}`, '', `_Compared with ${last ? anvLabel(last) : 'no earlier release (this is the first release)'}. Generated ${today()} from the changes recorded in the tracker._`, '']
      .concat(sections.flatMap((s, i) => [`## ${i + 1}. ${s.title}`, ...(s.items.length ? s.items.map(it => `- ${it.text}`) : ['- None.']), ''])).join('\n');
    return {sections, md, counts: counts(inv)};
  }
  const effectiveSummary = () => (S.work && S.work.summary_md) || summary().md;

  /* ---------------- the review history, readable without the website ---------------- */
  function commentsMd() {
    const L = [`# Comments and Responses — ${workingName()}`, '', `${S.an.title}${S.an.an_name ? ' · ' + S.an.an_name : ''}${S.an.collaboration ? ' · ' + S.an.collaboration : ''}. Generated ${today()} from the tracker.`, ''];
    const q = t => String(t || '').split('\n').map(l => '  > ' + l).join('\n');
    const block = (title, c) => {
      const lines = [`#### ${title}`, '', `- **Comment** — ${whoStr(c)}, ${fmtDate(c.created)}`, q(c.text), `- **Response:** ${fullRsp(c) || '_no response written yet_'}`];
      const act = (c.resolution || '').trim(); if (act) lines.push(`- **Action taken:** ${act}`);
      const vs = [c.resolvedVersionId, ...(c.resolvedMore || [])].map(id => id && ver(id)).filter(Boolean);
      if (vs.length) lines.push(`- **Updated plot${vs.length > 1 ? 's' : ''}:** ${vs.map(v => `${plot(v.plotId).name} ${verLabel(v)} (${v.fileName})`).join('; ')}`);
      vs.forEach(v => { lines.push(`  - *${plot(v.plotId).name} ${verLabel(v)}* — what changed: ${one(v.changes, 600)}`); });
      if (c.anchor) lines.push(`- **Where in the AN PDF:** page ${c.anchor.page}`);
      lines.push(`- **Status:** ${stLabel[c.status] || c.status}`, '');
      return lines;
    };
    const all = [...S.usages.flatMap(u => u.reviews.filter(r => !r.none).map(r => ({c: r, u}))), ...S.anc.map(c => ({c}))];
    const n = k => all.filter(x => (x.c.status || 'pending') === k).length;
    L.push('## Overview', '', `- Open: ${n('pending')} · In progress: ${n('in_progress')} · Resolved: ${n('resolved')}`, '');
    const vers = [...S.anv].sort((a, b) => a.number - b.number);
    const section = (title, rows) => {
      L.push(`## ${title}`, '');
      if (!rows.some(r => r.items.length)) { L.push('_None recorded._', ''); return; }
      rows.forEach(r => { if (r.items.length) { L.push(`### ${r.label}`, ''); r.items.forEach(it => L.push(...it)); } });
    };
    // plot-related (comments linked to AN figures / their plots)
    section('Plot-related comments', vers.map(v => ({label: anvLabel(v) + ' review', items: figGroups(S.usages.filter(u => u.type === 'note' && u.anvId === v.id).sort((a, b) => a.fig.localeCompare(b.fig, undefined, {numeric: true}))).flatMap(g => g.flatMap(u => u.reviews.filter(r => !r.none).map(r => {
      const pv = ver(u.versionId), p = plot(pv.plotId);
      return block(`Figure ${u.fig}${r.scope === 'figure' ? ' (whole figure)' : u.panel ? ' — ' + u.panel : ''} · ${catPath(p.catId)} / ${p.name} (${verLabel(pv)})${p.location ? ' · location in the AN: ' + p.location : ''}`, r);
    })))})));
    const byKind = kinds => vers.map(v => ({label: anvLabel(v) + ' review', items: S.anc.filter(c => c.source === 'an' && c.anvId === v.id && kinds.includes(c.kind)).map(c => block(`${c.location || COMMENT_KINDS[c.kind]}`, c))}));
    section('Methodology-related comments', byKind(['methodology']));
    section('General analysis comments', byKind(['general']));
    section('Other comments on the text, tables and equations', byKind(['text', 'table', 'equation', 'figure']));
    // meetings
    const meet = new Map(), mk = (nm, d) => { const k = nm + '|' + (d || ''); if (!meet.has(k)) meet.set(k, {label: `${nm}${d ? ' — ' + fmtDay(d) : ''}`, items: []}); return meet.get(k); };
    S.usages.filter(u => u.type !== 'note').forEach(u => u.reviews.filter(r => !r.none).forEach(r => { const pv = ver(u.versionId), p = plot(pv.plotId); mk(meetingName(u), u.date).items.push(block(`${p.name} ${verLabel(pv)}${u.slide ? ' · slide ' + u.slide : ''}`, r)); }));
    S.anc.filter(c => c.source === 'meeting').forEach(c => mk(c.meeting, c.meeting_date).items.push(block(`${COMMENT_KINDS[c.kind] || 'Comment'}${c.location ? ' · ' + c.location : ''}`, c)));
    section('Meeting comments', [...meet.values()].sort((a, b) => a.label.localeCompare(b.label)));
    return L.join('\n');
  }

  /* ---------------- ZIP (uncompressed "store" format: plot images are already compressed) ---------------- */
  let CRC = null;
  function crc32(buf) {
    if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
    let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zipBlob(files) {
    const enc = new TextEncoder(), parts = [], central = [], d = new Date();
    const dt = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dd = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    let offset = 0;
    for (const f of files) {
      const nm = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, dt, true); h.setUint16(12, dd, true);
      h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, nm, f.data);
      const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, dt, true); c.setUint16(14, dd, true);
      c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true); c.setUint16(28, nm.length, true); c.setUint32(42, offset, true);
      central.push(c.buffer, nm); offset += 30 + nm.length + size;
    }
    const cdSize = central.reduce((n, p) => n + (p.byteLength !== undefined ? p.byteLength : p.length), 0);
    const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], {type: 'application/zip'});
  }
  const csv = rows => rows.map(r => r.map(x => { const s = String(x ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n');

  /* what goes into the package: every plot at its newest version, in the category / subcategory folders */
  function packagePlan() {
    const root = safe(workingName()), inv = inventory(), used = new Set(), rows = [];
    const files = inv.map(x => {
      const folder = catChain(x.p.catId).map(c => safe(c.name)).join('/'), ext = x.latest.ext || '.png';
      let base = safe(x.p.name), name = base + ext, n = 2; while (used.has((folder + '/' + name).toLowerCase())) name = `${base}_${n++}${ext}`;
      used.add((folder + '/' + name).toLowerCase());
      const path = `${root}/${folder ? folder + '/' : ''}${name}`;
      rows.push([x.p.name, x.path, x.p.location, path.slice(root.length + 1), verLabel(x.latest), x.status, x.latest.fileName, one(x.latest.changes, 200)]);
      return {x, path};
    });
    return {root, files, inv, rows};
  }
  async function build(progress) {
    const plan = packagePlan(), out = [], enc = new TextEncoder(); let done = 0;
    const queue = [...plan.files], worker = async () => {
      while (queue.length) {
        const f = queue.shift(), url = await fetchImage(S.an.id, f.x.latest.file_id, f.x.latest.ext), buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
        out.push({name: f.path, data: buf}); progress && progress(++done, plan.files.length);
      }
    };
    await Promise.all(Array.from({length: Math.min(4, plan.files.length)}, worker));
    out.sort((a, b) => a.name.localeCompare(b.name));
    out.push({name: `${plan.root}/Review_Comments/Comments_and_Responses.md`, data: enc.encode(commentsMd())});
    out.push({name: `${plan.root}/Review_Comments/Change_Summary.md`, data: enc.encode(effectiveSummary())});
    out.push({name: `${plan.root}/Plot_Inventory.csv`, data: enc.encode(csv([['Plot', 'Category path', 'Location in the AN', 'File in this package', 'Version used', 'Status vs previous release', 'Original file name', 'Latest recorded change'], ...plan.rows]))});
    const wp = wpdf(); if (wp) { const u = await fetchImage(S.an.id, wp.file_id, wp.ext || '.pdf'); out.push({name: `${plan.root}/${safe(wp.name.replace(/\.pdf$/i, ''))}.pdf`, data: new Uint8Array(await (await fetch(u)).arrayBuffer())}); }
    if (S.work && S.work.change_report) out.push({name: `${plan.root}/Review_Comments/Changes_between_AN_versions.md`, data: enc.encode(S.work.change_report)});
    out.push({name: `${plan.root}/manifest.json`, data: enc.encode(JSON.stringify(manifest(plan), null, 2))});
    return {blob: zipBlob(out), plan, count: out.length};
  }
  async function download() {
    const done = busy('Preparing the package…');
    try {
      const r = await build((i, n) => done.set(`Collecting plots… ${i} of ${n}`));
      const a = document.createElement('a'); a.href = URL.createObjectURL(r.blob); a.download = r.plan.root + '.zip'; document.body.appendChild(a); a.click(); a.remove();
      toast(`Downloaded ${r.plan.root}.zip (${r.plan.files.length} plots, comments and change summary).`, '', 7000);
    } catch (e) { toast('Could not build the package: ' + e.message, 'err', 9000); } finally { done(); }
  }

  /* ---------------- the new AN PDF of the working version (required once an earlier version exists) ---------------- */
  const needsPdf = () => !!lastRelease();
  const wpdf = () => (S.work && S.work.pdf && S.work.pdf.file_id) ? S.work.pdf : null;
  const pdfProblem = () => {                                     // why the release is still blocked, or ''
    if (!needsPdf()) return '';
    const w = wpdf(); if (!w) return `Upload the new AN PDF (the LaTeX document, saved as PDF after the plots were updated) to release ${workingName()}.`;
    if (S.anv.some(v => v.pdf && v.pdf.sha256 === w.sha256)) return 'This PDF is identical to the PDF of a published version. Upload the updated AN PDF.';
    return '';
  };
  const canRelease = () => !pdfProblem();
  const mb = n => (n / 1048576).toFixed(1) + ' MB';
  function pdfCard() {
    const w = wpdf(), prob = pdfProblem(), last = lastRelease();
    if (!needsPdf() && !w) return `<div class="card pad"><b>AN PDF</b> <span class="meta">(optional for the first version)</span><div class="meta" style="margin:4px 0 8px">You can attach the PDF of this first version when you publish it.</div></div>`;
    return `<div class="card pad ready" style="margin-bottom:14px"><div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center"><div style="flex:1;min-width:240px"><b>New AN PDF for ${esc(workingName())}</b> ${w ? (prob ? '<span class="badge pending">needs a different file</span>' : '<span class="badge resolved">uploaded</span>') : '<span class="badge pending">required</span>'}
      <div class="meta" style="margin-top:4px">${w ? `${esc(w.name)} · ${mb(w.size)} · uploaded ${w.uploaded ? fmtDate(w.uploaded) : ''}${w.by ? ' by ' + esc(w.by) : ''}` : `The LaTeX document, downloaded as PDF after you updated the plots and answered the comments. ${last ? `Publishing ${esc(workingName())} and downloading the package are locked until it is uploaded.` : ''}`}</div>
      ${prob ? `<div class="meta" style="color:var(--pending);margin-top:4px">${esc(prob)}</div>` : ''}</div>
      <div class="actions"><label class="btn ${w ? '' : 'primary'}" style="cursor:pointer">${w ? 'Replace the PDF' : 'Upload the new AN PDF…'}<input id="wpdf" type="file" accept="application/pdf,.pdf" hidden></label>
      ${w && last ? `<button class="btn" data-act="anc" data-op="open" data-a="${last.id}" data-b="work">Compare with ${anvLabel(last)}</button>` : ''}${w ? '<button class="btn" data-act="rel" data-op="pdf-remove">Remove</button>' : ''}</div></div></div>`;
  }
  document.addEventListener('change', async e => {
    const f = e.target; if (!f || f.id !== 'wpdf' || !f.files || !f.files[0]) return;
    const file = f.files[0]; f.value = '';
    if (file.size > 50 * 1048576) { toast('This PDF is larger than 50 MB, so it cannot be stored in the repository. Reduce its size and try again.', 'err', 9000); return; }
    const done = busy('Checking the PDF…');
    try {
      const fp = await pdfFingerprint(file), same = S.anv.find(v => v.pdf && v.pdf.sha256 === fp.sha256);
      if (same) { toast(`This file is identical to the PDF of ${anvLabel(same)}. Upload the updated AN PDF.`, 'err', 9000); return; }
      done.set('Storing the PDF in the repository…');
      const up = await api('POST', aurl('/upload'), undefined, {raw: file});
      await api('POST', aurl('/working/pdf'), {file_id: up.file_id, pdf: fp});
      await reload(); toast(`AN PDF uploaded: ${file.name}`, '', 6000);
    } catch (err) { toast(err.message, 'err', 9000); } finally { done(); }
  });

  /* ---------------- readiness: what still needs the analyst's attention (reminders, never an approval) ---------------- */
  function readiness() {
    const inv = inventory(), cs = counts(inv), items = [];
    const comments = [...S.usages.flatMap(u => u.reviews.filter(r => !r.none)), ...S.anc];
    const open = comments.filter(c => c.status === 'pending').length, prog = comments.filter(c => c.status === 'in_progress').length, done = comments.filter(c => c.status === 'resolved').length;
    const unanswered = comments.filter(c => isOpen(c) && !(c.answer || '').trim()).length;
    const needRev = inv.filter(x => x.status === 'updated' && !x.latest.reviewed), noWhy = inv.flatMap(x => x.newer).filter(v => v.review_id && (!(v.motivation || '').trim() || /^Response to /.test(v.motivation)));
    const inc = GAL.buildGroups(S.plots.filter(p => verOf(p.id).length || true)).filter(GAL.incomplete);
    if (needsPdf()) items.unshift({level: pdfProblem() ? 'warn' : 'ok', text: pdfProblem() ? 'The new AN PDF has not been uploaded (publishing and the package are locked)' : 'The new AN PDF is uploaded', href: '#wpdfcard', go: ''});
    items.push({level: open + prog ? 'warn' : 'ok', text: `Comments: <b>${open}</b> open · <b>${prog}</b> in progress · <b>${done}</b> resolved`, href: L('/pending'), go: 'Open comments'});
    if (unanswered) items.push({level: 'warn', text: `<b>${unanswered}</b> unresolved comment${unanswered === 1 ? ' has' : 's have'} no response yet`, href: L('/pending'), go: 'Write responses'});
    items.push({level: 'info', text: `Plots: <b>${cs.updated}</b> updated · <b>${cs.added}</b> new · ${cs.unchanged} unchanged`, op: 'gal-filter', fid: 'updated', go: 'Show updated plots'});
    items.push({level: needRev.length ? 'warn' : 'ok', text: needRev.length ? `<b>${needRev.length}</b> revised plot${needRev.length === 1 ? '' : 's'} not yet checked by you` : 'Every revised plot has been checked by you', op: 'gal-filter', fid: 'review', go: needRev.length ? 'Review them' : ''});
    items.push({level: noWhy.length ? 'warn' : 'ok', text: noWhy.length ? `<b>${noWhy.length}</b> revision${noWhy.length === 1 ? ' has' : 's have'} no explanation of why it changed` : 'Every revision made for a comment says why it changed', href: noWhy.length ? L('/plot/' + noWhy[0].plotId) : '', go: noWhy.length ? 'Open the first' : ''});
    items.push({level: inc.length ? 'info' : 'ok', text: inc.length ? `<b>${inc.length}</b> plot group${inc.length === 1 ? ' does' : 's do'} not have all four eras (only a reminder)` : 'No plot group is missing an era', op: 'gal-filter', fid: 'inc', go: inc.length ? 'Show them' : ''});
    const sr = !!(S.work && S.work.summary_reviewed);
    items.push({level: sr ? 'ok' : 'warn', text: sr ? 'You marked the change summary as reviewed' : 'The change summary is generated automatically; read it and tick the box below it', href: '#sumbox', go: ''});
    return {items, warn: items.filter(i => i.level === 'warn')};
  }
  const readyHtml = r => `<div class="card pad ready"><h3 style="margin:0 0 8px">Before you release</h3>${r.items.map(i => `<div class="rrow ${i.level}"><span class="ic">${i.level === 'ok' ? '✓' : i.level === 'warn' ? '!' : 'i'}</span><span>${i.text}</span>${i.go ? (i.op ? `<button class="link" data-act="rel" data-op="${i.op}" data-id="${i.fid}">${i.go}</button>` : `<a class="link" href="${i.href}">${i.go}</a>`) : ''}</div>`).join('')}
    <div class="meta" style="margin-top:8px">These are reminders to help you. Passing them does not mean the Analysis Note is scientifically approved: that judgement stays with you.</div></div>`;
  const warnHtml = () => { const w = readiness().warn; return w.length ? `<div class="banner draft" style="display:block"><b>Still open:</b><ul style="margin:6px 0 0 18px">${w.map(i => `<li>${i.text}</li>`).join('')}</ul><div class="meta">You can still publish. These are only reminders.</div></div>` : ''; };

  /* a machine-readable description of the package (documented in the README) */
  function manifest(plan) {
    const comments = [], plotIds = u => { const v = ver(u.versionId); return v ? [v.plotId] : []; };
    S.usages.forEach(u => u.reviews.filter(r => !r.none).forEach(r => comments.push({id: r.id, type: 'plot', source: whoStr(r), text: r.text, status: r.status, response: (r.answer || '').trim(), response_with_revision_reasons: fullRsp(r), action_taken: r.resolution || '', plot_ids: [...new Set([...plotIds(u), ...[r.resolvedVersionId, ...(r.resolvedMore || [])].filter(Boolean).map(id => ver(id) && ver(id).plotId).filter(Boolean)])], figure: u.type === 'note' ? u.fig : null, panel: u.panel || null, an_version: u.anvId ? anv(u.anvId).number : null, meeting: u.type === 'note' ? null : meetingName(u)})));
    S.anc.forEach(c => comments.push({id: c.id, type: c.kind, source: whoStr(c), text: c.text, status: c.status, response: (c.answer || '').trim(), response_with_revision_reasons: (c.answer || '').trim(), action_taken: c.resolution || '', plot_ids: [], location: c.location || '', an_version: c.anvId ? anv(c.anvId).number : null, meeting: c.source === 'meeting' ? c.meeting : null}));
    const last = lastRelease(), by = id => comments.filter(c => c.plot_ids.includes(id)).map(c => c.id);
    return {format: 'analysis-tracker-manifest', format_version: 1, generated: new Date().toISOString(), analysis: {id: S.an.id, title: S.an.title, an_name: S.an.an_name || '', collaboration: S.an.collaboration || ''},
      working_version: workingName(), an_pdf: wpdf() ? {name: wpdf().name, size: wpdf().size, sha256: wpdf().sha256} : null, previous_release: last ? {number: last.number, published_on: last.published_on} : null, change_summary_reviewed: !!(S.work && S.work.summary_reviewed),
      plots: plan.files.map(f => { const x = f.x, v = x.latest; return {plot_id: x.p.id, name: x.p.name, group: GAL.plotBase(x.p), era: GAL.plotEra(x.p) || null, file: f.path.slice(plan.root.length + 1), original_file_name: v.fileName,
        category_id: x.p.catId, category_path: catChain(x.p.catId).map(c => c.name), category_ids: catChain(x.p.catId).map(c => c.id), location_in_an: x.p.location || null, status_vs_previous_release: x.status,
        released_version_id: x.rel ? x.rel.id : null, released_label: x.rel ? verLabel(x.rel) : null,
        current_revision: {version_id: v.id, label: verLabel(v), previous_revision_id: v.parentId || null, created: v.created, author: v.author, what_changed: v.changes, why_changed: v.motivation || '', reviewed_by_analyst: !!v.reviewed},
        comment_ids: by(x.p.id)}; }),
      comments};
  }

  /* ---------------- the page ---------------- */
  const treePreview = plan => {
    const dirs = new Map(); plan.files.forEach(f => { const parts = f.path.split('/'), file = parts.pop(), dir = parts.join('/'); if (!dirs.has(dir)) dirs.set(dir, []); dirs.get(dir).push(file); });
    const lines = [plan.root + '/']; const keys = [...dirs.keys()].filter(k => k !== plan.root).sort();
    (dirs.get(plan.root) || []).forEach(f => lines.push('  ' + f));
    keys.forEach(k => { const depth = k.split('/').length - 1; lines.push('  '.repeat(depth) + k.split('/').pop() + '/'); dirs.get(k).forEach(f => lines.push('  '.repeat(depth + 1) + f)); });
    lines.push(...(wpdf() ? ['  ' + safe(wpdf().name.replace(/\.pdf$/i, '')) + '.pdf'] : []), '  Review_Comments/', '    Comments_and_Responses.md', '    Change_Summary.md', ...(S.work && S.work.change_report ? ['    Changes_between_AN_versions.md'] : []), '  Plot_Inventory.csv', '  manifest.json'); return lines.join('\n');
  };
  const chip = s => `<span class="badge s-${s}">${s === 'new' ? 'New' : s === 'updated' ? 'Updated' : 'Unchanged'}</span>`;
  function view() {
    if (!isAN()) return notFound();
    const inv = inventory(), cs = counts(inv), sm = summary(), name = workingName(), last = lastRelease(), f = ui.relf || 'all', plan = packagePlan();
    const open = allPending().length, edited = !!(S.work && S.work.summary_md), block = pdfProblem();
    const dlBtn = (t, c) => block ? `<button class="btn ${c}" disabled title="${esc(block)}">${esc(t)}</button>` : `<button class="btn ${c}" data-act="rel" data-op="download">${esc(t)}</button>`;
    const pubBtn = block ? `<button class="btn primary" disabled title="${esc(block)}">Publish ${esc('AN v' + suggestedNumber())}</button>` : `<button class="btn primary" data-act="publish">Publish ${esc('AN v' + suggestedNumber())}</button>`;
    const rows = inv.filter(x => f === 'all' || x.status === f);
    let curPath = null; const table = rows.map(x => {
      const head = x.path !== curPath ? `<tr class="grp"><td colspan="6">${esc(x.path || '(no category)')}</td></tr>` : ''; curPath = x.path;
      return head + `<tr><td><a href="${L('/plot/' + x.p.id)}"><b>${esc(x.p.name)}</b></a></td><td>${x.p.location ? esc(x.p.location) : '<span class="meta">—</span>'}</td>
        <td>${x.rel ? verLabel(x.rel) : '<span class="meta">—</span>'}</td><td><b>${verLabel(x.latest)}</b></td><td>${chip(x.status)}</td>
        <td>${x.open ? `<span class="badge pending">${x.open} open</span>` : ''}${x.done ? `<span class="badge resolved">${x.done} resolved</span>` : ''}</td></tr>`;
    }).join('');
    const secHtml = sm.sections.map((s, i) => `<div class="sumsec"><h3>${i + 1}. ${esc(s.title)} <span class="count">${s.items.length}</span></h3>${s.items.length ? `<ul>${s.items.map(it => `<li><span class="badge ${it.auto ? '' : 'stage'}">${it.auto ? 'auto' : 'analyst'}</span> ${esc(it.text)}${it.id ? ` <button class="iconbtn" data-act="rel" data-op="del-entry" data-id="${it.id}" title="Remove">🗑</button>` : ''}</li>`).join('')}</ul>` : '<div class="meta">None.</div>'}</div>`).join('');
    return `${banner()}<div class="crumbs"><a href="${L('')}">Overview</a> / Release &amp; Export</div>
      <div class="pagehead"><div><h1>Release &amp; Export · ${esc(name)}</h1><p>The working version always holds each plot at its newest version, compared with ${last ? anvLabel(last) : 'no earlier release'}. Released AN versions are never changed, and older plot versions stay in each plot's history.</p></div>
      <div class="actions"><button class="btn" data-act="rel" data-op="rename">Rename</button>${dlBtn('Download ZIP', '')}${pubBtn}</div></div>
      <div id="wpdfcard">${pdfCard()}</div>
      ${window.ANF ? ANF.card() : ''}
      ${readyHtml(readiness())}
      <div class="tiles"><div class="card tile"><b>${cs.total}</b><span>Plots in this version</span></div><div class="card tile ${cs.updated ? 'warn' : ''}"><b>${cs.updated}</b><span>Updated</span></div><div class="card tile"><b>${cs.added}</b><span>New</span></div><div class="card tile"><b>${cs.unchanged}</b><span>Unchanged</span></div><div class="card tile ${open ? 'warn' : ''}"><b>${open}</b><span>Comments still open</span></div></div>
      <div class="sechead"><h2>Plots in ${esc(name)}</h2><div class="chips">${[['all', 'All'], ['updated', 'Updated'], ['new', 'New'], ['unchanged', 'Unchanged']].map(([k, l]) => `<span class="chip ${f === k ? 'on' : ''}" data-act="rel" data-op="filter" data-id="${k}">${l}</span>`).join('')}</div></div>
      ${rows.length ? `<div class="card" style="overflow:auto"><table class="vtable"><tr><th>Plot</th><th>Location in the AN</th><th>${last ? anvLabel(last) : 'Released'}</th><th>In ${esc(name)}</th><th>Status</th><th>Comments</th></tr>${table}</table></div>` : '<div class="card empty">No plots here yet.</div>'}
      <div class="sechead"><h2>Change summary</h2><div class="actions"><button class="btn sm" data-act="rel" data-op="add-entry">+ Record a change</button><button class="btn sm" data-act="rel" data-op="edit-summary">Edit the text</button>${edited ? '<button class="btn sm" data-act="rel" data-op="reset-summary">Reset to generated</button>' : ''}</div></div>
      ${edited ? '<div class="banner draft"><span><b>Edited by hand.</b> The text below is what will be saved and downloaded. New changes are not added to it automatically; use <b>Reset to generated</b> to refresh it.</span></div>' : ''}
      <div class="meta" style="margin-bottom:10px"><span class="badge">auto</span> detected from what you recorded in the tracker &nbsp; <span class="badge stage">analyst</span> written by you (use <b>+ Record a change</b> to explain methodology changes and other decisions).</div>
      <div class="card pad">${edited ? `<pre class="mdpre">${esc(S.work.summary_md)}</pre>` : secHtml}</div>
      <label id="sumbox" class="chk" style="margin:10px 2px"><input type="checkbox" data-act="rel" data-op="sumrev" ${S.work && S.work.summary_reviewed ? 'checked' : ''}> I have read and reviewed this change summary</label>
      <div class="sechead"><h2>Download</h2></div>
      <div class="card pad"><p style="margin-top:0">One ZIP with <b>all ${cs.total} plots</b> (changed or not) in the category and subcategory folders, plus the review history and this summary. Extracting it recreates the folders on your computer.</p><pre class="mdpre">${esc(treePreview(plan))}</pre>
        ${dlBtn('Download ' + plan.root + '.zip', 'primary')} <button class="btn" data-act="gdoc" title="Every comment, its reply and the plots, as a file that opens in Google Docs">Export comments to Google Docs</button> <span class="meta">Comments still open: ${open}${open ? ' (they are listed under “Still Open”)' : ''}</span></div>`;
  }

  function entryModal() {
    openModal({title: 'Record a change', submit: 'Add',
      sub: 'Plot replacements are detected automatically. Use this for things the tracker cannot see: why a method or selection changed, a new systematic, a decision.',
      body: field('Section', `<select name="section"><option value="methodology">Methodology and analysis changes</option><option value="plots">Plot updates (extra explanation)</option><option value="other">Other changes</option></select>`)
        + field('What changed, and why?', '<textarea name="text" required maxlength="3000" style="min-height:110px" placeholder="e.g. Revised the explanation of the event selection; documented the updated treatment of the JES systematic."></textarea>'),
      onSubmit: async fd => { await api('POST', aurl('/working/entries'), {section: fd.get('section'), text: fd.get('text').trim()}); await reload(); }});
  }
  function summaryModal() {
    openModal({title: 'Edit the change summary', xl: true, submit: 'Save',
      sub: 'This text is saved with the version when you publish and is included in the download as Change_Summary.md. Changes you record later will not be added automatically.',
      body: `<textarea name="md" style="width:100%;min-height:420px;font:13.5px/1.5 ui-monospace,monospace;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg)">${esc(effectiveSummary())}</textarea>`,
      onSubmit: async fd => { await api('POST', aurl('/working'), {summary_md: fd.get('md')}); await reload(); }});
  }
  function renameModal() {
    openModal({title: 'Name of the working version', submit: 'Save', sub: 'Used for the folder and ZIP name, for example AN_v3.',
      body: field('Name', `<input type="text" name="name" maxlength="60" value="${esc(workingName())}" placeholder="AN_v${nextNum()}">`),
      onSubmit: async fd => { await api('POST', aurl('/working'), {name: fd.get('name').trim()}); await reload(); }});
  }
  /* the saved summary of a released version */
  function showVersionSummary(vid) {
    const v = anv(vid); if (!v) return;
    openModal({title: `Change summary · ${anvLabel(v)}`, xl: true, submit: 'Copy',
      body: `<pre class="mdpre" id="vsum">${esc((v.change_summary || 'No change summary was saved with this version.') + (v.change_report ? '\n\n---\n\n' + v.change_report : ''))}</pre>`,
      onSubmit: async () => { try { await navigator.clipboard.writeText(v.change_summary || ''); toast('Copied'); } catch { toast('Select the text and press Ctrl+C', '', 4000); return false; } }});
  }

  async function act(el) {
    const op = el.dataset.op;
    if (op === 'download') { if (pdfProblem()) return toast(pdfProblem(), 'err', 8000); return download(); }
    if (op === 'pdf-remove') { await api('DELETE', aurl('/working/pdf')); return reload(); }
    if (op === 'rename') return renameModal();
    if (op === 'add-entry') return entryModal();
    if (op === 'edit-summary') return summaryModal();
    if (op === 'reset-summary') { await api('POST', aurl('/working'), {summary_md: null}); return reload(); }
    if (op === 'del-entry') { await api('DELETE', aurl('/working/entries/' + el.dataset.id)); return reload(); }
    if (op === 'filter') { ui.relf = el.dataset.id; return render(); }
    if (op === 'sumrev') { await api('POST', aurl('/working'), {summary_reviewed: el.checked}); return reload(); }
    if (op === 'gal-filter') { const k = el.dataset.id; ui.gf = {q: '', era: '', review: '', rev: k === 'updated' || k === 'review' ? k : '', fig: '', inc: k === 'inc'}; return go(L('/gallery')); }
  }
  /* small card for the dashboard */
  function dashCard() {
    const cs = counts(inventory()), r = readiness();
    return `<div class="card pad guide"><div><b>Release · ${esc(workingName())}</b><div class="meta">${cs.total} plot${cs.total === 1 ? '' : 's'}: ${cs.updated} updated · ${cs.added} new · ${cs.unchanged} unchanged.${r.warn.length ? ` <b>${r.warn.length} thing${r.warn.length === 1 ? '' : 's'} still need${r.warn.length === 1 ? 's' : ''} your attention.</b>` : ' Nothing is waiting for you.'}</div></div><div class="actions"><a class="btn primary" href="${L('/release')}">Release &amp; Export</a></div></div>`;
  }
  window.REL = {pdfProblem, canRelease, view, act, dashCard, readiness, warnHtml, manifest, effectiveSummary, suggestedNumber, workingName, showVersionSummary, commentsMd, summary, inventory, build, zipBlob};
})();
