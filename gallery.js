/*! Analysis-Tracker - Copyright (c) 2026 Sanskar Nanda - MIT License (see LICENSE). https://github.com/Sanskar-hep */
/* Plot Gallery: every plot of the analysis, grouped by variable and shown era by era in a fixed order
 * (2016preVFP, 2016postVFP, 2017, 2018), with search and filters. Uses the app's globals (S, ui, L, ...) at call time. */
(function () {
  'use strict';
  const ERAS = ['2016preVFP', '2016postVFP', '2017', '2018'];
  const KEY = {'2016pre': '2016preVFP', '2016post': '2016postVFP', '2017': '2017', '2018': '2018'};
  const eraSlot = s => { const k = [...eraKeys(s)]; return k.length === 1 ? (KEY[k[0]] || null) : null; };   // one of the four standard eras, or null
  const plotEra = p => p.era || splitEra(p.name).era || '';
  const plotBase = p => { const e = splitEra(p.name); return e.era ? e.base : p.name; };
  const numCmp = (a, b) => String(a).localeCompare(String(b), undefined, {numeric: true, sensitivity: 'base'});
  const PAGE = 24;
  const F = () => (ui.gf = ui.gf || {q: '', era: '', review: '', rev: '', fig: '', inc: false});

  /* ---- what is known about every plot ---- */
  function stats() {
    const invBy = new Map((isAN() ? REL.inventory() : []).map(x => [x.p.id, x]));
    const rv = new Map(), figs = new Map();
    S.usages.forEach(u => { const v = ver(u.versionId); if (!v) return; const a = rv.get(v.plotId) || []; a.push(...u.reviews.filter(r => !r.none)); rv.set(v.plotId, a);
      if (u.type === 'note') { if (!figs.has(u.fig)) figs.set(u.fig, new Set()); figs.get(u.fig).add(v.plotId); } });
    return {invBy, rv, figs};
  }
  function passes(p, f, st) {
    const lv = latest(p.id), era = plotEra(p), slot = eraSlot(era);
    if (f.q) { const q = f.q.toLowerCase(); if (!(p.name.toLowerCase().includes(q) || (lv && lv.fileName.toLowerCase().includes(q)) || (p.location || '').toLowerCase().includes(q))) return false; }
    if (f.era) { if (f.era === 'other' ? !(era && !slot) : f.era === 'none' ? !!era : slot !== f.era) return false; }
    const rs = st.rv.get(p.id) || [];
    if (f.review === 'open' && !rs.some(isOpen)) return false;
    if (f.review === 'resolved' && !(rs.length && !rs.some(isOpen))) return false;
    if (f.review === 'none' && rs.length) return false;
    const inv = st.invBy.get(p.id);
    if (f.rev === 'review') { if (!(inv && inv.status === 'updated' && !inv.latest.reviewed)) return false; }
    else if (f.rev && !(inv && inv.status === f.rev)) return false;
    if (f.fig && !(st.figs.get(f.fig) || new Set()).has(p.id)) return false;
    return true;
  }
  function buildGroups(plots) {
    const m = new Map();
    plots.forEach(p => { const era = plotEra(p), key = p.catId + '\u0000' + plotBase(p).toLowerCase() + (era ? '' : '\u0000' + p.id);
      if (!m.has(key)) m.set(key, {key, base: plotBase(p), catId: p.catId, members: []}); m.get(key).members.push({p, era, slot: eraSlot(era)}); });
    return [...m.values()].map(g => {
      const cells = ERAS.map(e => g.members.find(x => x.slot === e) || null), used = new Set(cells.filter(Boolean));
      return {...g, cells, extras: g.members.filter(x => !used.has(x)).sort((a, b) => numCmp(a.era, b.era)), filled: cells.filter(Boolean).length, hasEra: g.members.some(x => x.era)};
    }).sort((a, b) => numCmp(catPath(a.catId), catPath(b.catId)) || numCmp(a.base, b.base));
  }
  /* groups that have at least one standard era but not all four (advisory) */
  const incomplete = g => g.hasEra && g.filled > 0 && g.filled < ERAS.length;
  const inFolder = catId => visPlots().filter(p => !catId || catWithKids(catId).includes(p.catId));

  /* ---- drawing ---- */
  function cellHtml(label, m, st) {
    if (!m) return `<div class="ecell miss"><div class="el">${esc(label)}</div><div class="eimg">Plot unavailable</div></div>`;
    const v = latest(m.p.id), inv = st.invBy.get(m.p.id), rs = st.rv.get(m.p.id) || [], open = rs.filter(isOpen).length;
    const b = (inv && inv.status === 'updated' ? `<span class="badge s-updated">Updated</span>` : inv && inv.status === 'new' ? '<span class="badge s-new">New</span>' : '')
      + (inv && inv.status === 'updated' ? (inv.latest.reviewed ? '<span class="badge resolved" title="You marked this revision as checked">✓ reviewed</span>' : '<span class="badge pending" title="Check the revised plot, then mark it reviewed">needs review</span>') : '')
      + (open ? `<span class="badge pending">${open} open</span>` : '');
    return `<div class="ecell"><div class="el">${esc(label)} ${b}</div><div class="eimg" data-act="zoom" data-id="${v.id}" title="Click to enlarge">${img(v, 'lz')}</div>
      <div class="ef"><a href="${L('/plot/' + m.p.id)}" data-sel="${v.id}">${esc(m.p.name)}</a> <span class="meta">${verLabel(v)}${m.p.location ? ' · ' + esc(m.p.location) : ''}</span>${inv && inv.status === 'updated' ? ` <button class="link" data-act="gal" data-op="cmp" data-id="${m.p.id}">Compare with published</button>` : ''}</div></div>`;
  }
  function groupHtml(g, f, st, open) {
    const only = f.era && f.era !== 'other' && f.era !== 'none';
    const cells = g.hasEra ? (only ? g.cells.map((m, i) => ERAS[i] === f.era ? cellHtml(ERAS[i], m, st) : '').join('') : g.cells.map((m, i) => cellHtml(ERAS[i], m, st)).join('')) : '';
    const extras = g.extras.map(m => cellHtml(m.era || 'Plot', m, st)).join('');
    const inv = g.members.map(m => st.invBy.get(m.p.id)).filter(Boolean), upd = inv.filter(x => x.status === 'updated').length, nw = inv.filter(x => x.status === 'new').length;
    const op = g.members.reduce((n, m) => n + (st.rv.get(m.p.id) || []).filter(isOpen).length, 0), nr = inv.filter(x => x.status === 'updated' && !x.latest.reviewed).length;
    const badges = (g.hasEra ? `<span class="badge ${incomplete(g) ? 'pending' : ''}" title="${incomplete(g) ? 'Not every standard era has a plot. This is only a reminder.' : ''}">${g.filled} of ${ERAS.length} eras${g.extras.length ? ' + ' + g.extras.length + ' other' : ''}</span>` : '')
      + (upd ? `<span class="badge s-updated">${upd} updated</span>` : '') + (nw ? `<span class="badge s-new">${nw} new</span>` : '') + (nr ? `<span class="badge pending">${nr} to review</span>` : '') + (op ? `<span class="badge pending">${op} open comment${op === 1 ? '' : 's'}</span>` : '');
    return `<div class="egroup ${open ? 'open' : ''}"><div class="eh" data-act="gal" data-op="toggle" data-id="${esc(g.key)}"><span class="chev">${open ? '▾' : '▸'}</span><b>${esc(g.base)}</b><span class="meta">${esc(catPath(g.catId))}</span><span class="eb">${badges}</span></div>
      ${open ? `<div class="ebody ${g.hasEra ? '' : 'single'}">${cells}${extras}</div>` : ''}</div>`;
  }
  function results() {
    const f = F(), st = stats(), plots = inFolder(ui.galCat || null), keep = plots.filter(p => passes(p, f, st));
    let groups = buildGroups(plots).filter(g => g.members.some(m => keep.includes(m.p)));
    if (f.inc) groups = groups.filter(incomplete);
    if (!plots.length) return '<div class="card empty">No plots here yet. Use <b>Upload many plots</b> to add them in one go: files named like <span class="mono">electron_pt_2016postVFP.png</span> are grouped by variable and era automatically.</div>';
    if (!groups.length) return '<div class="card empty">No plots match these filters. <button class="link" data-act="gal" data-op="clear">Clear the filters</button></div>';
    ui.galState = ui.galState || {};
    const n = ui.galN || PAGE, shown = groups.slice(0, n);
    const isOpenG = (g, i) => ui.galState[g.key] !== undefined ? ui.galState[g.key] : (ui.galAll !== undefined ? ui.galAll : i < 6 || groups.length <= 12);
    const plotsShown = groups.reduce((a, g) => a + g.members.length, 0);
    return `<div class="meta" style="margin:0 2px 8px">${groups.length} group${groups.length === 1 ? '' : 's'} · ${plotsShown} plot${plotsShown === 1 ? '' : 's'}${f.era ? ' · era ' + esc(f.era) : ''}
      <button class="link" data-act="gal" data-op="expand">Expand all</button><button class="link" data-act="gal" data-op="collapse">Collapse all</button></div>`
      + shown.map((g, i) => groupHtml(g, f, st, isOpenG(g, i))).join('')
      + (groups.length > n ? `<div style="text-align:center;margin:14px"><button class="btn" data-act="gal" data-op="more">Show ${Math.min(PAGE, groups.length - n)} more groups (${groups.length - n} left)</button></div>` : '');
  }
  function refresh() { const el = $('#galres'); if (el) { el.innerHTML = results(); hydrateImages(); } }

  /* ---- the page ---- */
  function treeHtml(catId) {
    const all = visPlots(), walk = (pid, d) => catKids(pid).map(c => { const n = all.filter(p => catWithKids(c.id).includes(p.catId)).length;
      return `<a href="${L('/cat/' + c.id)}" class="${catId === c.id ? 'on' : ''}" style="padding-left:${10 + d * 14}px"><span>${d ? '↳ ' : ''}${esc(c.name)}</span><span class="count">${n}</span></a>` + walk(c.id, d + 1); }).join('');
    return `<div class="gt"><a href="${L('/gallery')}" class="${!catId ? 'on' : ''}"><span><b>All plots</b></span><span class="count">${all.length}</span></a>${walk(null, 0)}</div>
      <div style="padding:10px"><button class="btn sm" data-act="new-cat">+ New category</button></div>`;
  }
  function view(catId) {
    if (catId && !cat(catId)) return notFound();
    ui.galCat = catId || null;
    const f = F(), c = catId ? cat(catId) : null, st = stats();
    const figs = [...st.figs.keys()].sort(numCmp);
    const sel = (key, opts) => `<select data-gf="${key}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${f[key] === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const head = c
      ? `<div class="crumbs"><a href="${L('/gallery')}">Plot Gallery</a>${catChain(catId).map(x => ` / <a href="${L('/cat/' + x.id)}">${esc(x.name)}</a>`).join('')}</div><div class="pagehead"><div><h1>${esc(c.name)}</h1><p>${inFolder(catId).length} plot${inFolder(catId).length === 1 ? '' : 's'}${catKids(catId).length ? ' including its subcategories' : ''}.</p></div>
        <div class="actions"><button class="btn" data-act="new-sub" data-id="${catId}">+ Subcategory</button><button class="btn" data-act="edit-cat" data-id="${catId}">Rename / move</button><button class="btn danger" data-act="del-cat" data-id="${catId}">Delete</button><button class="btn" data-act="bulk-plots" data-id="${catId}">Upload many plots</button><button class="btn primary" data-act="new-plot" data-id="${catId}">+ New plot</button></div></div>`
      : `<div class="pagehead"><div><h1>Plot Gallery</h1><p>All your plots, grouped by variable and shown era by era. Pick a folder on the left, or search.</p></div>
        <div class="actions"><button class="btn" data-act="bulk-plots">Upload many plots</button><button class="btn primary" data-act="new-plot">+ New plot</button></div></div>`;
    const bar = `<div class="card pad gbar"><input type="search" data-gf="q" value="${esc(f.q)}" placeholder="Search by plot name, file name or AN location…" autocomplete="off">
      <div class="gfs">${sel('era', [['', 'Any era'], ...ERAS.map(e => [e, e]), ['other', 'Other eras'], ['none', 'No era in name']])}
      ${sel('review', [['', 'Any comment status'], ['open', 'Has open comments'], ['resolved', 'All comments resolved'], ['none', 'No comments']])}
      ${isAN() ? sel('rev', [['', 'Any revision status'], ['updated', 'Updated since release'], ['review', 'Revised, needs my review'], ['new', 'New'], ['unchanged', 'Unchanged']]) : ''}
      ${figs.length ? sel('fig', [['', 'Any figure'], ...figs.map(x => [x, 'Figure ' + x])]) : ''}
      <label class="chk"><input type="checkbox" data-gf="inc" ${f.inc ? 'checked' : ''}> Only groups missing an era</label>
      <button class="link" data-act="gal" data-op="clear">Clear</button></div></div>`;
    return `${banner()}${head}<div class="gal"><details class="card gtree" open><summary>Folders</summary>${treeHtml(catId)}</details><section>${bar}<div id="galres">${results()}</div></section></div>`;
  }

  async function act(el) {
    const op = el.dataset.op, f = F();
    if (op === 'toggle') { ui.galState = ui.galState || {}; const k = el.dataset.id, cur = el.closest('.egroup').classList.contains('open'); ui.galState[k] = !cur; return refresh(); }
    if (op === 'expand') { ui.galState = {}; ui.galAll = true; return refresh(); }
    if (op === 'collapse') { ui.galState = {}; ui.galAll = false; return refresh(); }
    if (op === 'more') { ui.galN = (ui.galN || PAGE) + PAGE; return refresh(); }
    if (op === 'clear') { ui.gf = {q: '', era: '', review: '', rev: '', fig: '', inc: false}; ui.galN = PAGE; return render(); }
    if (op === 'cmp') {                                          // published vs working, side by side
      const x = REL.inventory().find(i => i.p.id === el.dataset.id); if (!x || !x.rel) return;
      if (isPub() && !ctx().draft) { setCtx('draft'); }
      ui.cmp[x.p.id] = [x.rel.id, x.latest.id]; ui.mode = 'side'; return go(L('/plot/' + x.p.id + '/compare'));
    }
  }
  document.addEventListener('input', e => { const t = e.target; if (!t.matches || !t.matches('[data-gf=q]')) return; F().q = t.value.trim(); ui.galN = PAGE; refresh(); });
  document.addEventListener('change', e => {
    const t = e.target; if (!t.matches || !t.matches('[data-gf]') || t.dataset.gf === 'q') return;
    F()[t.dataset.gf] = t.type === 'checkbox' ? t.checked : t.value; ui.galN = PAGE; refresh();
  });
  window.GAL = {view, act, ERAS, eraSlot, plotEra, plotBase, buildGroups, incomplete, inFolder, refresh};
})();
