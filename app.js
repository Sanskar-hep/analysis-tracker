/* Analysis-Tracker front end. Data lives in a GitHub repository (see backend.js); this file renders it and calls api(). */
'use strict';

/* ============================ helpers ============================ */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = t => new Date(t).toLocaleDateString(undefined, {day:'numeric', month:'short', year:'numeric'});
const fmtDay = d => d ? new Date(d + 'T00:00').toLocaleDateString(undefined, {day:'numeric', month:'short', year:'numeric'}) : '';
const today = () => new Date().toISOString().slice(0, 10);
const slug = (s, n = 28) => String(s || '').toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n).replace(/-+$/, '');
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

/* ============================ API (backend.js stores everything in a GitHub repository) ============================ */
const aurl = p => `/analyses/${S.an.id}${p}`;
const upload = async file => (await api('POST', aurl('/upload'), undefined, {raw: file}));

/* ============================ state ============================ */
let U = null;          // connected GitHub user {id (login), name}
let S = null;          // currently open analysis (normalised)
let AL = [];           // list of the user's analyses
const ui = {sel: {}, cmp: {}, mode: 'side', A: null, B: null, pf: 'all', ctx: {}};

function norm(st) {
  return {
    an: st.analysis, anv: st.an_versions, cats: st.categories,
    plots: st.plots.map(p => ({...p, catId: p.category_id})),
    versions: st.plot_versions.map(v => ({...v, plotId: v.plot_id, parentId: v.parent_id, anvId: v.an_version_id, fileName: v.file_name})),
    usages: st.usages.map(u => ({...u, versionId: u.plot_version_id, anvId: u.an_version_id, anVer: u.an_ver,
      reviews: u.reviews.map(r => ({...r, none: !!r.none, resolvedVersionId: r.resolved_version_id, resolvedAt: r.resolved_at}))})),
    docs: st.documents.map(d => ({...d, anvId: d.an_version_id})),
  };
}
async function loadAnalysis(id) { S = norm(await api('GET', `/analyses/${id}`)); }
async function reload() { await loadAnalysis(S.an.id); render(); }
async function loadList() { AL = (await api('GET', '/analyses')).analyses; }

const CTX = {
  note:     {label: 'Analysis Note',        short: 'AN',  roles: ['Reviewer 1', 'Reviewer 2', 'Reviewer 3', 'ARC member', 'Convener', 'Supervisor', 'Other']},
  tmp:      {label: 'TMP meeting',          short: 'TMP', roles: ['Convener', 'TMP member', 'Supervisor', 'Other']},
  group:    {label: 'Group meeting',        short: 'GM',  roles: ['Supervisor', 'Group member', 'Other']},
  internal: {label: 'Internal review meeting', short: 'IM', roles: ['Supervisor', 'Collaborator', 'Other']},
  collab:   {label: 'Collaboration meeting', short: 'CM', roles: ['Convener', 'Collaboration member', 'Supervisor', 'Other']},
};
const MEET_PAGES = {
  tmp: {title: 'TMP meeting comments', types: ['tmp']},
  internal: {title: 'Internal review & group meeting comments', types: ['internal', 'group']},
  collab: {title: 'Collaboration meeting comments', types: ['collab']},
};

/* ---- analysis stage helpers ---- */
const isAN = () => S.an.stage === 'an_stage';
const isPub = () => isAN() && S.an.an_status === 'published';
const anv = id => S.anv.find(x => x.id === id);
const anvLabel = v => `AN v${v.number}`;
const latestAnv = () => S.anv[S.anv.length - 1];

/* ---- context: the "working draft" or one published AN version ---- */
function ctx() {
  const DRAFT = {draft: true, id: null, num: Infinity, label: isPub() ? 'Working draft' : 'Working draft'};
  if (!isPub()) return DRAFT;
  const sel = ui.ctx[S.an.id] ?? lsGet('at_ctx_' + S.an.id);
  if (sel === 'draft') return DRAFT;
  const v = (sel && anv(sel)) || latestAnv();
  return {draft: false, id: v.id, num: v.number, label: anvLabel(v), v};
}
function setCtx(v) { ui.ctx[S.an.id] = v; lsSet('at_ctx_' + S.an.id, v); }
const ctxChip = id => id ? `<span class="badge stage">${anvLabel(anv(id))}</span>` : `<span class="badge">Draft</span>`;

/* ---- visibility within the context ---- */
const plot = id => S.plots.find(p => p.id === id);
const ver = id => S.versions.find(v => v.id === id);
const cat = id => S.cats.find(c => c.id === id);
const verLabel = v => v.rev ? `v${v.num}.${v.rev}` : `v${v.num}`;
const byVer = (a, b) => a.num - b.num || a.rev - b.rev;
const visV = v => { const c = ctx(); return c.draft || (v.anvId && anv(v.anvId).number <= c.num); };
const verOf = pid => S.versions.filter(v => v.plotId === pid && visV(v)).sort(byVer);
const latest = pid => verOf(pid).slice(-1)[0];
const visPlots = () => S.plots.filter(p => verOf(p.id).length);
const cUsages = () => S.usages.filter(u => (u.anvId || null) === ctx().id);
const usesOf = vid => cUsages().filter(u => u.versionId === vid);
const plotUses = pid => cUsages().filter(u => ver(u.versionId)?.plotId === pid);
const pendingOf = us => us.flatMap(u => u.reviews.filter(r => !r.none && r.status === 'pending').map(r => ({u, r})));
const allPending = () => pendingOf(S.usages);                    // global: across every version and the draft
const pendingByTypes = types => pendingOf(S.usages.filter(u => types.includes(u.type)));
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const img = (v, cls = '') => v ? `<img class="${cls}" data-fid="${v.file_id}" data-ext="${v.ext}" src="${BLANK}" alt="${esc(plot(v.plotId)?.name)} ${verLabel(v)}">` : '';
/* images are fetched from the repository on demand, then cached as blob URLs */
function hydrateImages() {
  document.querySelectorAll('img[data-fid]:not([data-ok])').forEach(el => {
    const fid = el.dataset.fid, url = imgCached(fid);
    if (url) { el.src = url; el.dataset.ok = 1; return; }
    if (!S) return;
    fetchImage(S.an.id, fid, el.dataset.ext).then(u => document.querySelectorAll(`img[data-fid="${fid}"]`).forEach(x => { x.src = u; x.dataset.ok = 1; }))
      .catch(() => { el.alt = 'Image could not be loaded'; });
  });
}
const imageUrl = v => fetchImage(S.an.id, v.file_id, v.ext);
const whoStr = r => `${r.role}${r.name ? ' · ' + r.name : ''}`;
const useTitle = u => u.type === 'note' ? `Analysis Note · Fig ${u.fig}` : `${CTX[u.type].label}${u.slide ? ' · slide ' + u.slide : ''}`;
const findReview = id => { for (const u of S.usages) { const r = u.reviews.find(x => x.id === id); if (r) return {u, r}; } return null; };
const L = p => `#/a/${S.an.id}${p}`;

/* ============================ ui primitives ============================ */
function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), kind === 'err' ? 4500 : 2800);
}
function openModal({title, sub = '', body, submit = 'Save', wide = false, onSubmit, setup}) {
  const m = document.createElement('div'); m.className = 'overlay';
  m.innerHTML = `<form class="modal ${wide ? 'wide' : ''}"><header><h3>${title}</h3><button type="button" class="x" data-close aria-label="Close">×</button></header>${sub ? `<p class="sub">${sub}</p>` : ''}<div class="mbody">${body}</div><footer><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${submit}</button></footer></form>`;
  document.body.appendChild(m);
  const f = $('form', m); const close = () => m.remove();
  m.addEventListener('mousedown', e => { if (e.target === m) close(); });
  m.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  f.addEventListener('submit', async e => {
    e.preventDefault(); const btn = $('.primary', f); btn.disabled = true; const label = btn.textContent; btn.textContent = 'Saving…';
    try { const r = await onSubmit(new FormData(f), f); if (r !== false) close(); } catch (err) { toast(err.message, 'err'); }
    btn.disabled = false; btn.textContent = label;
  });
  bindFiles(f); if (setup) setup(f);
  const first = f.querySelector('input:not([type=file]):not([type=radio]):not([type=hidden]),select,textarea'); if (first) first.focus();
  return {m, f, close};
}
const field = (label, input, hint = '', opt = false) => `<div class="f"><label class="l">${label}${opt ? ' <span class="opt">(optional)</span>' : ''}</label>${input}${hint ? `<div class="h">${hint}</div>` : ''}</div>`;
const fileField = (req = true) => `<label class="drop"><input class="vh" type="file" name="file" accept="image/*" ${req ? 'required' : ''}><span class="dropmsg"><b style="color:var(--acc)">Choose an image</b> or drag &amp; drop / paste (PNG, JPG, SVG, WebP)</span><img class="dpreview" hidden alt=""></label>`;
function bindFiles(root) {
  root.querySelectorAll('.drop').forEach(d => {
    const inp = $('input', d), prev = $('.dpreview', d);
    const show = () => { const f = inp.files[0]; if (f) { prev.src = URL.createObjectURL(f); prev.hidden = false; $('.dropmsg', d).textContent = f.name; } };
    inp.addEventListener('change', show);
    d.addEventListener('dragover', e => { e.preventDefault(); d.classList.add('over'); });
    d.addEventListener('dragleave', () => d.classList.remove('over'));
    d.addEventListener('drop', e => { e.preventDefault(); d.classList.remove('over'); if (e.dataTransfer.files[0]) { inp.files = e.dataTransfer.files; show(); } });
  });
}
document.addEventListener('paste', e => {
  const d = $('.overlay .drop'); if (!d) return;
  const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/')); if (!item) return;
  const blob = item.getAsFile(); const file = new File([blob], 'pasted-plot.png', {type: blob.type});
  const dt = new DataTransfer(); dt.items.add(file); const inp = $('input', d); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
});
function lightbox(src) { const l = document.createElement('div'); l.className = 'lightbox'; l.innerHTML = `<img src="${esc(src)}" alt="">`; l.onclick = () => l.remove(); document.body.appendChild(l); }
const confirmBox = (title, msg, ok, fn) => openModal({title, body: `<p style="margin:0">${msg}</p>`, submit: ok, onSubmit: async () => { await fn(); }});
const radios = (name, opts, cur) => `<div class="radios">${opts.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" ${v === cur ? 'checked' : ''}> ${l}</label>`).join('')}</div>`;

/* ============================ connect to GitHub ============================ */
function showConnect(msg = '') {
  document.title = 'Analysis-Tracker';
  const cfgRepo = (window.AT_CONFIG && window.AT_CONFIG.repo) || savedRepo();
  $('#root').innerHTML = `<div class="authwrap"><div class="card authcard" style="width:min(480px,100%)">
    <div class="brand"><div class="logo">${logoSvg}</div>Analysis-Tracker</div>
    <h1>Connect to your data</h1>
    <div class="hint">Your analyses are stored in a private GitHub repository. Sign in with a personal access token; GitHub decides who can read and write.</div>
    ${savedRepos().length ? `<div style="margin-top:16px"><div class="l" style="font-weight:600;font-size:13px;margin-bottom:6px">Saved repositories</div><div class="chips">${savedRepos().map(r => `<span class="chip" data-saved="${esc(r)}">${esc(r)}</span>`).join('')}</div></div>` : ''}
    <form id="authform" novalidate>
      ${field('Data repository', `<input type="text" name="repo" required value="${esc(cfgRepo)}" placeholder="owner/analysis-tracker-data" autocomplete="off" spellcheck="false">`, 'The private repository that holds the data.')}
      ${field('GitHub access token', '<input type="password" name="token" required autocomplete="off" placeholder="github_pat_…">', 'Fine-grained token with <b>Contents: Read and write</b> on that repository only.')}
      <label style="display:flex;gap:8px;align-items:center;font-size:13.5px"><input type="checkbox" name="remember" checked> Keep me connected on this device</label>
      <div class="autherr" id="autherr">${esc(msg)}</div>
      <button class="btn primary">Connect</button>
    </form>
    <details class="authswitch" style="text-align:left"><summary style="cursor:pointer;text-align:center">How do I get a token?</summary>
      <ol style="padding-left:18px;margin:10px 0 0;line-height:1.7">
        <li>GitHub → <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token</b>.</li>
        <li>Choose an expiry, set <b>Resource owner</b> to your group's organisation (or you).</li>
        <li><b>Only select repositories</b> → the data repository.</li>
        <li>Permissions → Repository → <b>Contents: Read and write</b>. Generate and paste it above.</li>
      </ol></details>
  </div></div>`;
  const f = $('#authform');
  document.querySelectorAll('[data-saved]').forEach(c => c.onclick = async () => {
    $('#autherr').textContent = 'Connecting…';
    try { U = await ghSwitch(c.dataset.saved); await start(); } catch (ex) { showConnect(ex.message); }
  });
  f.addEventListener('submit', async e => {
    e.preventDefault(); const fd = new FormData(f), err = $('#autherr'), btn = $('button.primary', f); err.textContent = ''; btn.disabled = true; btn.textContent = 'Connecting…';
    try { U = await ghConnect(fd.get('repo'), fd.get('token'), !!fd.get('remember')); await start(); }
    catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Connect'; }
  });
  $('input', f).focus();
}
window.onAuthLost = async () => { const msg = 'Your GitHub token is invalid or has expired. Please reconnect.'; U = null; S = null; AL = []; showConnect(msg); };

/* after connecting to / switching / removing a repository: reset the view and reload */
async function afterRepoChange(connected) {
  S = null; AL = []; ui.sel = {}; ui.cmp = {}; ui.ctx = {};
  if (!GHS.token) {                                    // nothing connected: try another saved repository
    try { U = await ghRestore(); } catch { U = null; }
  } else U = GHS.user;
  if (!U) { showConnect(); return; }
  location.hash = '#/'; mountShell(); await nav(); render();
}
function addRepoModal() {
  openModal({title: 'Add another repository', submit: 'Connect', sub: 'Connect to a different data repository, for example your personal one. The current one stays saved; switch any time from the top bar.',
    body: field('Data repository', '<input type="text" name="repo" required placeholder="owner/another-data-repo" autocomplete="off" spellcheck="false">')
      + field('GitHub access token', '<input type="password" name="token" autocomplete="off" placeholder="github_pat_…">', 'Leave empty to reuse the current token (it must also have access to the new repository).')
      + '<label style="display:flex;gap:8px;align-items:center;font-size:13.5px"><input type="checkbox" name="remember" checked> Keep me connected on this device</label>',
    onSubmit: async fd => {
      const old = {repo: GHS.repo, token: GHS.token, remember: isRemembered(GHS.repo)};
      try { await ghConnect(fd.get('repo'), fd.get('token') || old.token, !!fd.get('remember')); }
      catch (e) { if (old.token) { try { await ghConnect(old.repo, old.token, old.remember); } catch {} } throw e; }   // stay on the current repository
      await afterRepoChange(); toast('Connected to ' + GHS.repo);
    }});
}

/* ============================ shell ============================ */
function mountShell() {
  document.title = 'Analysis-Tracker';
  $('#root').innerHTML = `<div class="app"><nav class="side" id="side"></nav><div class="main"><div class="top" id="top"></div><main class="content" id="main"></main></div></div>`;
  $('#top').addEventListener('input', onSearch);
}
const logoSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18M6 16v-5M11 16V6M16 16v-8M21 16v-3"/></svg>';
const brand = `<a href="#/" class="brand" style="color:var(--ink)"><div class="logo">${logoSvg}</div>Analysis-Tracker</a>`;

function stageBadges(a) {
  if (a.stage === 'just_started') return '<span class="badge stage">Just started</span>';
  const n = a.latest_version ?? (S && S.anv.length ? latestAnv().number : null);
  return `<span class="badge stage">AN stage</span>${a.an_status === 'published' ? `<span class="badge ok">AN v${n} published</span>` : '<span class="badge">AN being written</span>'}`;
}

function renderSide() {
  if (!S) {
    $('#side').innerHTML = `${brand}<div class="nav"><a href="#/" class="on">Analyses</a></div>`;
    return;
  }
  const sub = route().slice(2), pg = sub[0] || '', k = sub[1];
  const pend = allPending().length, c = ctx();
  const cats = S.cats.map(x => {
    const n = visPlots().filter(p => p.catId === x.id).length;
    return `<a href="${L('/cat/' + x.id)}" class="${pg === 'cat' && k === x.id ? 'on' : ''}"><span>${esc(x.name)}</span><span class="count">${n}</span></a>`;
  }).join('');
  const nav = (href, label, on, count) => `<a href="${href}" class="${on ? 'on' : ''}"><span>${label}</span>${count ? `<span class="count warn">${count}</span>` : ''}</a>`;
  const pm = t => pendingByTypes(MEET_PAGES[t].types).length;
  $('#side').innerHTML = `${brand}
    <a class="backlink" href="#/">← All analyses</a>
    <div class="aname">${esc(S.an.title)}</div>
    <div class="asub">${stageBadges(S.an)}</div>
    <div class="nav">
      ${nav(L(''), 'Dashboard', !pg)}
      <div class="sec"><span>Plots</span><button class="iconbtn" data-act="new-cat" title="New category">+</button></div>
      <div class="sub">${cats || '<div class="meta" style="padding:6px 24px">No categories yet</div>'}</div>
      <div class="sec"><span>Meeting comments</span></div>
      ${nav(L('/meetings/tmp'), 'TMP meetings', pg === 'meetings' && k === 'tmp', pm('tmp'))}
      ${nav(L('/meetings/internal'), 'Internal review &amp; group', pg === 'meetings' && k === 'internal', pm('internal'))}
      ${nav(L('/meetings/collab'), 'Collaboration meetings', pg === 'meetings' && k === 'collab', pm('collab'))}
      ${isPub() ? `<div class="sec"><span>Review</span></div>${nav(L('/reviewer'), 'Reviewer comments', pg === 'reviewer', pendingByTypes(['note']).length)}` : ''}
      <div class="sec"><span>Analysis</span></div>
      ${isAN() ? nav(L('/versions'), 'AN versions', pg === 'versions') : ''}
      ${nav(L('/pending'), 'All pending comments', pg === 'pending', pend)}
      ${nav(L('/docs'), 'Documents', pg === 'docs')}
      ${nav(L('/settings'), 'Settings', pg === 'settings')}
    </div>`;
}

function renderTop() {
  const repos = savedRepos(), repoSel = `<div class="ctxsel" title="Data repository"><span>📁</span><select data-act="setrepo" aria-label="Data repository">
      ${repos.map(r => `<option value="${esc(r)}" ${r === GHS.repo ? 'selected' : ''}>${esc(r)}</option>`).join('')}
      <option value="__add">＋ Add another repository…</option></select></div>`;
  const user = `${repoSel}<div class="who"><span title="Signed in to GitHub as ${esc(U.id)}">👤 ${esc(U.name)}</span><button class="btn sm" data-act="refresh" title="Load the latest changes from GitHub">↻</button><button class="btn sm" data-act="logout" title="Remove this repository from this device">Disconnect</button></div>`;
  let mid = '';
  if (S) {
    const c = ctx();
    const ctxSel = isPub() ? `<div class="ctxsel"><span>Viewing</span><select data-act="setctx" aria-label="AN version">
      ${[...S.anv].reverse().map((v, i) => `<option value="${v.id}" ${c.id === v.id ? 'selected' : ''}>${anvLabel(v)}${i === 0 ? ' (latest)' : ''} · ${fmtDay(v.published_on)}</option>`).join('')}
      <option value="draft" ${c.draft ? 'selected' : ''}>Working draft (unpublished)</option></select></div>` : '';
    mid = `<div class="search"><input id="q" type="search" placeholder="Search plots in this analysis…" autocomplete="off"><div class="results" id="results"></div></div>${ctxSel}`;
  }
  $('#top').innerHTML = `<button class="iconbtn menu" data-act="menu" aria-label="Menu">☰</button>${mid}<div class="spacer"></div>${user}<button class="iconbtn" data-act="theme" title="Toggle theme" aria-label="Toggle theme">◐</button>`;
}

function banner() {
  if (!isPub()) return '';
  const c = ctx();
  if (c.draft) {
    const next = (latestAnv().number) + 1, n = S.versions.filter(v => !v.anvId).length + S.usages.filter(u => !u.anvId).length;
    return `<div class="banner draft"><span><b>Working draft</b> — unpublished changes toward AN v${next}${n ? ` (${n} new record${n === 1 ? '' : 's'})` : ''}. New plots and versions are added here and become part of the next AN version when you publish it.</span><a href="${L('/versions')}" class="btn sm">AN versions</a></div>`;
  }
  const isLatest = c.id === latestAnv().id;
  return `<div class="banner"><span><b>${c.label}</b> · published ${fmtDay(c.v.published_on)}${isLatest ? ' (latest)' : ''} — showing only what existed in this version: its plots, figure records, meeting comments and reviewer comments.</span>
    <span class="actions"><button class="btn sm" data-act="to-draft">Go to working draft</button>${isLatest ? '' : '<button class="btn sm" data-act="to-latest">Latest version</button>'}</span></div>`;
}

/* ============================ routing ============================ */
const route = () => location.hash.slice(1).split('/').filter(Boolean);
const go = h => { location.hash = h; };
let navSeq = 0;
async function nav() {
  if (!U) return;
  const seq = ++navSeq, r = route();
  try {
    if (r[0] === 'a' && r[1]) {
      if (!S || S.an.id !== r[1]) await loadAnalysis(r[1]);
    } else { S = null; await loadList(); }
  } catch (e) { if (U) { toast(e.message, 'err'); S = null; if (location.hash !== '#/') return go('#/'); await loadList().catch(() => {}); } }
  if (seq !== navSeq) return;
  render(); window.scrollTo(0, 0); $('#side')?.classList.remove('open');
}
window.addEventListener('hashchange', nav);

/* ============================ views: analyses home ============================ */
function viewHome() {
  const cards = AL.map(a => `<div class="card acard" data-open="${a.id}"><div><h3>${esc(a.title)}</h3>
      <div class="meta" style="margin-top:2px">${a.stage === 'an_stage' ? esc(a.an_name) + ' · ' + esc(a.collaboration) : 'No AN yet'}</div>
      <div class="meta">${a.owner === U.id ? 'Yours' : 'Owner: ' + esc(a.owner_name || a.owner)}</div></div>
      <div class="badges" style="margin:0">${stageBadges(a)}</div>
      <div class="stats"><span><b>${a.plots}</b>plots</span><span><b>${a.versions}</b>AN versions</span><span><b style="${a.pending ? 'color:var(--pending)' : ''}">${a.pending}</b>pending</span></div></div>`).join('');
  return `<div class="pagehead"><div><h1>Analyses</h1><p>Your group's analyses. Each has its own workspace; pick one to continue or start a new one.</p></div>
    <div class="actions"><button class="btn" data-act="demo">Create demo analysis</button><button class="btn primary" data-act="new-an">+ New analysis</button></div></div>
    ${AL.length ? `<div class="acards">${cards}</div>` : `<div class="card empty"><p style="margin:0 0 12px">You don't have any analyses yet.</p><button class="btn primary" data-act="new-an">+ Create your first analysis</button></div>`}`;
}

function anFields(cur = {}, forceWritten = false) {
  return field('AN name', `<input type="text" name="an_name" value="${esc(cur.an_name || '')}" placeholder="e.g. AN-24-123" maxlength="100">`, 'Official name or identifier of the Analysis Note.')
    + field('Collaboration', `<input type="text" name="collaboration" value="${esc(cur.collaboration || '')}" placeholder="e.g. CMS, ATLAS" maxlength="100">`)
    + (forceWritten ? '' : field('AN status', radios('an_status', [['being_written', 'AN being written'], ['published', 'Version published']], cur.an_status || 'being_written')));
}
function newAnalysisModal() {
  openModal({title: 'New analysis', sub: 'Everything you add — plots, comments, documents — will belong to this analysis.', submit: 'Create analysis', wide: true,
    body: field('Analysis title', '<input type="text" name="title" required maxlength="150" placeholder="e.g. Top-Quark Charge Asymmetry">')
      + field('Analysis stage', radios('stage', [['just_started', 'Just started'], ['an_stage', 'AN stage']], 'just_started'), 'You can move to the AN stage later from the analysis settings.')
      + `<div id="anbox" hidden style="display:grid;gap:14px">${anFields()}<div id="firstv" hidden style="display:grid;gap:14px"><div class="cols">${field('Published version number', '<input type="text" name="vnum" value="1" inputmode="numeric">')}${field('Publication date', `<input type="date" name="vdate" value="${today()}">`)}</div></div></div>`,
    setup: f => {
      const upd = () => {
        const an = f.stage.value === 'an_stage', pub = f.an_status.value === 'published';
        $('#anbox', f).hidden = !an; $('#anbox', f).style.display = an ? 'grid' : 'none';
        $('#firstv', f).hidden = !pub; $('#firstv', f).style.display = pub ? 'grid' : 'none';
        f.an_name.required = f.collaboration.required = an;
      };
      f.querySelectorAll('[name=stage],[name=an_status]').forEach(x => x.addEventListener('change', upd)); upd();
    },
    onSubmit: async fd => {
      const body = {title: fd.get('title').trim(), stage: fd.get('stage')};
      if (body.stage === 'an_stage') {
        Object.assign(body, {an_name: fd.get('an_name').trim(), collaboration: fd.get('collaboration').trim(), an_status: fd.get('an_status')});
        if (body.an_status === 'published') { const n = parseInt(fd.get('vnum'), 10); if (!(n >= 1)) throw new Error('Version number must be a positive whole number'); body.first_version = {number: n, published_on: fd.get('vdate') || today()}; }
      }
      const r = await api('POST', '/analyses', body); go('#/a/' + r.id);
    }});
}

/* ============================ views: analysis workspace ============================ */
function ctxBadge(t, extra = '') { return `<span class="badge ${t}">${CTX[t].short}${extra}</span>`; }
function plotBadges(pid) {
  const us = plotUses(pid), types = Object.keys(CTX).filter(t => us.some(u => u.type === t)), pend = pendingOf(us).length;
  return types.map(t => ctxBadge(t)).join('') + (pend ? `<span class="badge pending">${pend} pending</span>` : '');
}
function pendRow(u, r) {
  const v = ver(u.versionId), p = plot(v.plotId);
  return `<div class="row" data-go="${L('/plot/' + p.id)}" data-sel="${v.id}" data-ctx="${u.anvId || 'draft'}">${img(v)}<div class="t"><b>${esc(p.name)} <span class="badge">${verLabel(v)}</span> ${ctxBadge(u.type, u.type === 'note' ? ' · Fig ' + esc(u.fig) : '')}${isPub() ? ' ' + ctxChip(u.anvId) : ''}</b><span>${esc(whoStr(r))}: ${esc(r.text)}</span></div></div>`;
}

function viewDash() {
  const pend = allPending(), vp = visPlots(), vv = S.versions.filter(visV), cu = cUsages();
  const resolved = S.usages.flatMap(u => u.reviews).filter(r => !r.none && r.status === 'resolved').length;
  const cats = S.cats.map(c => {
    const ps = vp.filter(p => p.catId === c.id).sort((a, b) => b.created - a.created), lv = ps.length ? latest(ps[0].id) : null;
    const nv = ps.reduce((n, p) => n + verOf(p.id).length, 0);
    return `<div class="card pc" data-go="${L('/cat/' + c.id)}"><div class="th ${lv ? '' : 'empty'}">${lv ? img(lv) : 'No plots yet'}</div><div class="bd"><h3>${esc(c.name)}</h3><div class="meta">${ps.length} plot${ps.length === 1 ? '' : 's'} · ${nv} version${nv === 1 ? '' : 's'}</div></div></div>`;
  }).join('');
  const counts = Object.keys(CTX).filter(t => t !== 'note' || isAN()).map(t => ({t, n: cu.filter(u => u.type === t).length}));
  const tot = counts.reduce((a, b) => a + b.n, 0) || 1;
  const recent = [...vv].sort((a, b) => b.created - a.created).slice(0, 6).map(v => {
    const p = plot(v.plotId);
    return `<div class="row" data-go="${L('/plot/' + p.id)}" data-sel="${v.id}">${img(v)}<div class="t"><b>${esc(p.name)} <span class="badge">${verLabel(v)}</span></b><span>${esc(v.summary)}</span></div><span class="meta">${fmtDate(v.created)}</span></div>`;
  }).join('');
  const anTile = isAN() ? `<div class="card tile"><b style="font-size:18px;line-height:1.4">${esc(S.an.an_name)}</b><span>${esc(S.an.collaboration)} · ${isPub() ? `AN v${latestAnv().number} published` : 'AN being written'}</span></div>` : '';
  return `${banner()}<div class="pagehead"><div><h1>${esc(S.an.title)}</h1><p>${ctx().draft ? 'Working draft' : ctx().label} · plots, versions and what was said about them.</p></div>
    <div class="actions"><button class="btn primary" data-act="new-plot">+ New plot</button></div></div>
  <div class="tiles">${anTile}
    <div class="card tile"><b>${vp.length}</b><span>Plots</span></div>
    <div class="card tile"><b>${vv.length}</b><span>Plot versions</span></div>
    <div class="card tile ${pend.length ? 'warn' : ''}"><b>${pend.length}</b><span>Pending comments (all versions)</span></div>
    <div class="card tile"><b>${resolved}</b><span>Comments resolved</span></div></div>
  <div class="sechead"><h2>Plot categories</h2><button class="btn sm" data-act="new-cat">+ New category</button></div>
  ${S.cats.length ? `<div class="grid">${cats}</div>` : '<div class="card empty">No categories yet. Create a category (e.g. “Electron pT”) or click <b>New plot</b> to start.</div>'}
  <div class="two">
    <div><h2>Needs attention</h2><div class="card" style="margin-top:10px">${pend.slice(0, 6).map(({u, r}) => pendRow(u, r)).join('') || '<div class="empty">🎉 No pending comments</div>'}</div>
      ${pend.length > 6 ? `<p><a href="${L('/pending')}">See all ${pend.length} pending →</a></p>` : ''}</div>
    <div><h2>Where plots are used${ctx().draft ? '' : ' in ' + ctx().label}</h2>
      <div class="card pad" style="margin-top:10px"><div class="splitbar">${counts.map(c => c.n ? `<div style="width:${c.n / tot * 100}%;background:var(--${c.t})"></div>` : '').join('')}</div>
        <div class="legend">${counts.map(c => `<span><i class="dot" style="background:var(--${c.t})"></i>${CTX[c.t].label} <b>${c.n}</b></span>`).join('')}</div></div>
      <h2 style="margin-top:22px">Recent plot versions</h2><div class="card" style="margin-top:10px">${recent || '<div class="empty">Nothing yet</div>'}</div></div>
  </div>`;
}

function viewPending() {
  const f = ui.pf || 'all';
  const list = allPending().filter(({u}) => f === 'all' || u.type === f);
  return `<div class="pagehead"><div><h1>Pending comments</h1><p>Everything that still needs a response or an updated plot, across all AN versions and the working draft.</p></div>
    <div class="chips">${['all', ...Object.keys(CTX).filter(t => t !== 'note' || isAN())].map(t => `<span class="chip ${f === t ? 'on' : ''}" data-act="pfilter" data-id="${t}">${t === 'all' ? 'All' : CTX[t].label}</span>`).join('')}</div></div>
    <div class="card">${list.map(({u, r}) => pendRow(u, r)).join('') || '<div class="empty">🎉 Nothing pending</div>'}</div>`;
}

function usageList(us, emptyMsg) {
  if (!us.length) return `<div class="card empty">${emptyMsg}</div>`;
  return us.map(u => { const v = ver(u.versionId), p = plot(v.plotId);
    return `<div class="uhead" data-go="${L('/plot/' + p.id)}" data-sel="${v.id}">${img(v)}<div><b>${esc(p.name)}</b> <span class="badge">${verLabel(v)}</span><div class="meta">${esc(cat(p.catId)?.name || '')}</div></div></div>${usageCard(u)}`; }).join('');
}
function viewMeetings(key) {
  const pg = MEET_PAGES[key]; if (!pg) return notFound();
  const us = cUsages().filter(u => pg.types.includes(u.type)).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created - a.created);
  return `${banner()}<div class="pagehead"><div><h1>${pg.title}</h1><p>${us.length} record${us.length === 1 ? '' : 's'} in ${ctx().draft ? 'the working draft' : ctx().label}. To add one, open a plot and choose <b>+ ${CTX[pg.types[0]].label}</b>.</p></div></div>
    ${usageList(us, 'No plots recorded for this meeting type yet.')}`;
}
function viewReviewer() {
  if (!isPub()) return notFound();
  if (ctx().draft) return `${banner()}<div class="card empty">Reviewer comments belong to a published AN version. Select an AN version in the “Viewing” menu above to see its reviewer comments.</div>`;
  const f = ui.rf || 'all';
  const us = cUsages().filter(u => u.type === 'note').filter(u => f === 'all' || u.reviews.some(r => !r.none && r.status === f)).sort((a, b) => a.fig.localeCompare(b.fig, undefined, {numeric: true}));
  const all = cUsages().filter(u => u.type === 'note').flatMap(u => u.reviews).filter(r => !r.none);
  return `${banner()}<div class="pagehead"><div><h1>Reviewer comments · ${ctx().label}</h1><p>${all.filter(r => r.status === 'pending').length} pending · ${all.filter(r => r.status === 'resolved').length} resolved. These stay with ${ctx().label} even after newer versions are published.</p></div>
    <div class="chips">${[['all', 'All'], ['pending', 'Pending'], ['resolved', 'Resolved']].map(([k, l]) => `<span class="chip ${f === k ? 'on' : ''}" data-act="rfilter" data-id="${k}">${l}</span>`).join('')}</div></div>
    ${usageList(us, 'No Analysis Note figures recorded for this version yet. Open a plot and choose <b>+ Analysis Note</b>.')}`;
}

function viewCat(id) {
  const c = cat(id); if (!c) return notFound();
  const ps = visPlots().filter(p => p.catId === id).sort((a, b) => b.created - a.created);
  const cards = ps.map(p => { const vs = verOf(p.id), lv = vs.slice(-1)[0];
    return `<div class="card pc" data-go="${L('/plot/' + p.id)}"><div class="th">${img(lv)}</div><div class="bd"><h3>${esc(p.name)}</h3>
      <div class="meta">${vs.length} version${vs.length === 1 ? '' : 's'} · latest ${verLabel(lv)}</div><div class="badges">${plotBadges(p.id)}</div></div></div>`; }).join('');
  const empty = !S.plots.some(p => p.catId === id);
  return `${banner()}<div class="crumbs"><a href="${L('')}">Dashboard</a> / ${esc(c.name)}</div>
    <div class="pagehead"><div><h1>${esc(c.name)}</h1><p>${ps.length} plot${ps.length === 1 ? '' : 's'}</p></div>
    <div class="actions">${empty ? `<button class="btn danger" data-act="del-cat" data-id="${id}">Delete category</button>` : ''}<button class="btn primary" data-act="new-plot" data-id="${id}">+ New plot</button></div></div>
    ${ps.length ? `<div class="grid">${cards}</div>` : '<div class="card empty">No plots in this category' + (ctx().draft ? '' : ' at this AN version') + '.</div>'}`;
}

function viewPlot(id) {
  const p = plot(id); if (!p) return notFound();
  const vs = verOf(id); if (!vs.length) return `${banner()}<div class="card empty">This plot did not exist yet at ${ctx().label}. <a href="${L('/plot/' + id)}" data-act="to-draft">Open in the working draft</a></div>`;
  const c = cat(p.catId), cx = ctx();
  const sel = ver(ui.sel[id]) && visV(ver(ui.sel[id])) && ver(ui.sel[id]).plotId === id ? ver(ui.sel[id]) : vs[vs.length - 1];
  ui.sel[id] = sel.id;
  const cmp = (ui.cmp[id] = (ui.cmp[id] || []).filter(i => ver(i) && visV(ver(i))));
  const list = [...vs].reverse().map(v => {
    const us = usesOf(v.id), types = Object.keys(CTX).filter(t => us.some(u => u.type === t)), pend = pendingOf(us).length;
    return `<div class="vitem ${v.rev ? 'rev' : ''} ${v.id === sel.id ? 'on' : ''}" data-act="selver" data-id="${v.id}">
      <input type="checkbox" data-act="cmp" data-id="${v.id}" ${cmp.includes(v.id) ? 'checked' : ''} title="Select to compare (max 5)">
      ${img(v)}<div><b>${verLabel(v)}</b> <span class="meta">· ${fmtDate(v.created)}</span>${isPub() ? ' ' + ctxChip(v.anvId) : ''}<div class="s">${esc(v.summary)}</div>
      <div class="badges">${types.map(t => ctxBadge(t)).join('')}${pend ? `<span class="badge pending">${pend}</span>` : ''}</div></div></div>`;
  }).join('');
  const parent = sel.parentId ? ver(sel.parentId) : null;
  let respTo = '';
  const fr = sel.review_id && findReview(sel.review_id);
  if (fr) respTo = `<div class="resp"><b>Revision of ${parent ? verLabel(parent) : 'an earlier version'}</b> in response to <b>${esc(whoStr(fr.r))}</b> (${esc(useTitle(fr.u))}${fr.u.anvId ? ' · ' + anvLabel(anv(fr.u.anvId)) : ''}):<br><i>“${esc(fr.r.text)}”</i></div>`;
  const uses = usesOf(sel.id);
  const types = Object.keys(CTX).filter(t => t !== 'note' || isAN());
  return `${banner()}<div class="crumbs"><a href="${L('')}">Dashboard</a> / <a href="${L('/cat/' + c.id)}">${esc(c.name)}</a> / ${esc(p.name)}</div>
  <div class="pagehead"><div><h1>${esc(p.name)}</h1><p>${vs.length} version${vs.length === 1 ? '' : 's'}${cx.draft ? '' : ' as of ' + cx.label}</p></div>
    <div class="actions"><button class="btn" data-act="go-cmp" data-id="${id}" ${cmp.length < 2 ? 'disabled' : ''}>Compare ${cmp.length ? '(' + cmp.length + ')' : ''}</button>
    <button class="btn primary" data-act="new-ver" data-id="${id}">+ Save new version</button>
    ${S.versions.some(v => v.plotId === id && v.anvId) ? '' : `<button class="btn danger" data-act="del-plot" data-id="${id}">Delete</button>`}</div></div>
  <div class="split">
    <aside class="card vlist"><header><h3>Versions</h3><div class="meta">Tick 2–5 versions to compare them</div></header>${list}</aside>
    <section>
      <div class="card">
        <div class="bigimg" data-act="zoom" data-id="${sel.id}">${img(sel)}</div>
        <div style="padding:16px 18px 0;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <h2>${verLabel(sel)} ${sel.rev ? '<span class="badge">revision</span>' : ''} ${isPub() ? ctxChip(sel.anvId) : ''}</h2>
          <div class="actions"><button class="btn sm" data-act="download" data-id="${sel.id}">Download</button>${sel.anvId ? '' : `<button class="btn sm danger" data-act="del-ver" data-id="${sel.id}">Delete version</button>`}</div></div>
        ${respTo}
        <dl class="kv">
          <dt>What this version shows</dt><dd>${esc(sel.summary)}</dd>
          <dt>Changes vs. previous</dt><dd>${esc(sel.changes)}</dd>
          ${sel.motivation ? `<dt>Why</dt><dd>${esc(sel.motivation)}</dd>` : ''}
          ${sel.dataset ? `<dt>Dataset / selection</dt><dd>${esc(sel.dataset)}</dd>` : ''}
          ${sel.code ? `<dt>Code reference</dt><dd class="mono">${/^https?:/.test(sel.code) ? `<a href="${esc(sel.code)}" target="_blank" rel="noopener noreferrer">${esc(sel.code)}</a>` : esc(sel.code)}</dd>` : ''}
          <dt>File name</dt><dd class="mono">${esc(sel.fileName)}</dd>
          <dt>Saved</dt><dd>${fmtDate(sel.created)} by ${esc(sel.author)}</dd>
        </dl>
      </div>
      <div class="usehead"><h2>Where is ${verLabel(sel)} used${cx.draft ? '' : ' in ' + cx.label}?</h2>
        <div class="usebtns">${types.map(t => `<button class="btn sm" data-act="add-use" data-id="${sel.id}" data-type="${t}">+ ${CTX[t].label}</button>`).join('')}</div></div>
      ${uses.map(usageCard).join('') || '<div class="card empty">Not recorded anywhere yet' + (cx.draft ? '' : ' for ' + cx.label) + '. Use the buttons above.</div>'}
    </section>
  </div>`;
}

function usageCard(u) {
  const rs = u.reviews, pend = rs.filter(r => !r.none && r.status === 'pending').length, res = rs.filter(r => !r.none && r.status === 'resolved').length;
  const locked = u.type === 'note' && !u.anvId;          // reviewer comments need a published AN version
  const detail = u.type === 'note'
    ? `<span class="meta">${u.anVer ? esc(u.anVer) : ''}</span>`
    : `<span class="meta">${u.date ? fmtDay(u.date) + ' · ' : ''}${u.title ? esc(u.title) + ' · ' : ''}${u.link ? `<a href="${esc(u.link)}" target="_blank" rel="noopener noreferrer">Open slides ↗</a>` : ''}</span>`;
  const status = locked ? '' : !rs.length ? '<span class="badge">No feedback recorded yet</span>'
    : `${pend ? `<span class="badge pending">${pend} pending</span>` : ''}${res ? `<span class="badge resolved">${res} resolved</span>` : ''}${!pend && !res ? '<span class="badge">No comments so far</span>' : ''}`;
  const reviews = rs.map(r => {
    const rv = r.resolvedVersionId ? ver(r.resolvedVersionId) : null;
    const act = r.none ? `<button class="btn sm" data-act="edit-rv" data-id="${r.id}">Add comment</button>`
      : r.status === 'pending' ? `<button class="btn sm primary" data-act="resolve" data-id="${r.id}">Mark resolved</button><button class="btn sm" data-act="edit-rv" data-id="${r.id}">Edit</button>`
      : `<button class="btn sm" data-act="reopen" data-id="${r.id}">Reopen</button>`;
    return `<div class="rv"><div><div class="who">${esc(whoStr(r))} <span class="meta">· ${fmtDate(r.created)}</span></div>
      ${r.none ? '<div class="txt none">No comments so far</div>' : `<div class="txt">${esc(r.text)}</div>`}</div>
      <div class="ra">${r.none ? '' : `<span class="badge ${r.status}">${r.status === 'resolved' ? '✓ Resolved' : 'Pending'}</span>`}${act}<button class="iconbtn" data-act="del-rv" data-id="${r.id}" title="Delete">🗑</button></div>
      ${r.status === 'resolved' && !r.none ? `<div class="res">${rv ? `Updated plot saved as <a href="${L('/plot/' + rv.plotId)}" data-act="selver" data-id="${rv.id}"><b>${verLabel(rv)}</b></a> ${ctxChip(rv.anvId)} <span class="mono">${esc(rv.fileName)}</span><br>` : ''}${esc(r.resolution || '')}</div>` : ''}</div>`;
  }).join('');
  return `<div class="card ucard ${u.type}"><div class="uh"><div><div class="ti">${esc(useTitle(u))}</div>${detail}</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${status}${locked ? '' : `<button class="btn sm" data-act="add-rv" data-id="${u.id}">+ ${u.type === 'note' ? 'Reviewer' : 'Meeting'} feedback</button>`}
    <button class="iconbtn" data-act="edit-use" data-id="${u.id}" title="Edit">✎</button>${u.anvId ? '' : `<button class="iconbtn" data-act="del-use" data-id="${u.id}" title="Remove">🗑</button>`}</div></div>
    ${locked ? '<div class="rv"><div class="hint">Reviewer comments can be recorded once this figure is part of a published AN version. Publish a version from <b>AN versions</b>.</div></div>' : ''}${reviews}</div>`;
}

function viewCompare(id) {
  const p = plot(id); if (!p) return notFound();
  const vs = verOf(id), c = cat(p.catId);
  const picked = (ui.cmp[id] = (ui.cmp[id] || []).filter(i => ver(i) && visV(ver(i))));
  const sel = vs.filter(v => picked.includes(v.id));
  const chips = vs.map(v => `<span class="chip ${picked.includes(v.id) ? 'on' : ''}" data-act="cmp-chip" data-id="${v.id}">${verLabel(v)}</span>`).join('');
  let mode = ui.mode; if (sel.length !== 2 && mode !== 'side') mode = 'side';
  if (!sel.find(v => v.id === ui.A)) ui.A = sel[0]?.id; if (!sel.find(v => v.id === ui.B)) ui.B = sel[1]?.id;
  const A_ = ver(ui.A), B_ = ver(ui.B);
  const opts = cur => sel.map(v => `<option value="${v.id}" ${v.id === cur ? 'selected' : ''}>${verLabel(v)}</option>`).join('');
  let stage = '';
  if (sel.length < 2) stage = '<div class="card empty" style="margin-top:18px">Pick at least two versions above (up to five).</div>';
  else if (mode === 'side') stage = `<div class="cmpgrid" style="grid-template-columns:repeat(auto-fit,minmax(${sel.length > 3 ? 300 : 380}px,1fr))">${sel.map(v =>
    `<div class="card cmpcard"><div class="h"><b>${verLabel(v)}</b><span class="meta">${fmtDate(v.created)}</span></div><div class="im" data-act="zoom" data-id="${v.id}">${img(v)}</div><div class="tx"><b style="color:var(--ink)">Changes:</b> ${esc(v.changes)}</div></div>`).join('')}</div>`;
  else stage = `<div class="ctrl"><span>Compare</span><select data-act="pickA">${opts(ui.A)}</select><span>with</span><select data-act="pickB">${opts(ui.B)}</select>
      ${mode === 'swipe' ? '<span class="meta">Drag the slider to reveal</span><input type="range" min="0" max="100" value="50" data-swipe>' : '<span class="meta">Opacity of top plot</span><input type="range" min="0" max="100" value="50" data-opac>'}</div>
      <div class="stage ${mode}">${img(B_)}${img(A_, 'top2')}${mode === 'swipe' ? '<div class="bar"></div>' : ''}
      <span class="tag" style="left:10px">${verLabel(A_)}</span><span class="tag" style="right:10px">${verLabel(B_)}</span></div>`;
  const table = sel.length ? `<h2 style="margin:28px 0 10px">What changed between versions</h2><div class="card" style="overflow:auto"><table>
    <tr><th>Version</th><th>Saved</th><th>What changed</th><th>Why</th><th>Dataset / selection</th><th>Used in</th></tr>
    ${sel.map(v => `<tr><td><b>${verLabel(v)}</b></td><td>${fmtDate(v.created)}</td><td class="pre">${esc(v.changes)}</td><td class="pre">${esc(v.motivation) || '—'}</td><td class="pre">${esc(v.dataset) || '—'}</td>
    <td>${S.usages.filter(u => u.versionId === v.id).map(u => `<span class="badge ${u.type}">${esc(useTitle(u))}${u.anvId ? ' · v' + anv(u.anvId).number : ''}</span>`).join(' ') || '—'}</td></tr>`).join('')}</table></div>` : '';
  return `${banner()}<div class="crumbs"><a href="${L('')}">Dashboard</a> / <a href="${L('/cat/' + c.id)}">${esc(c.name)}</a> / <a href="${L('/plot/' + id)}">${esc(p.name)}</a> / Compare</div>
  <div class="pagehead"><div><h1>Compare versions</h1><p>${esc(p.name)} — ${sel.length} of max 5 selected</p></div>
    <div class="modes"><button class="${mode === 'side' ? 'on' : ''}" data-act="mode" data-id="side">Side by side</button>
    <button class="${mode === 'swipe' ? 'on' : ''}" data-act="mode" data-id="swipe" ${sel.length !== 2 ? 'disabled title="Select exactly 2 versions"' : ''}>Swipe</button>
    <button class="${mode === 'overlay' ? 'on' : ''}" data-act="mode" data-id="overlay" ${sel.length !== 2 ? 'disabled title="Select exactly 2 versions"' : ''}>Overlay</button></div></div>
  <div class="chips">${chips}</div>${stage}${table}`;
}

/* ---- AN versions ---- */
function viewVersions() {
  if (!isAN()) return notFound();
  const rows = [...S.anv].reverse().map((v, i) => {
    const us = S.usages.filter(u => u.anvId === v.id), figs = us.filter(u => u.type === 'note'), rv = us.filter(u => u.type === 'note').flatMap(u => u.reviews).filter(r => !r.none);
    const pv = S.versions.filter(x => x.anvId === v.id).length, docs = S.docs.filter(d => d.anvId === v.id).length;
    return `<tr><td><b>AN v${v.number}</b> ${i === 0 ? '<span class="badge ok">latest</span>' : ''}</td><td>${fmtDay(v.published_on)}</td><td>${figs.length}</td><td>${pv}</td>
      <td>${rv.filter(r => r.status === 'pending').length ? `<span class="badge pending">${rv.filter(r => r.status === 'pending').length} pending</span>` : ''}<span class="badge resolved">${rv.filter(r => r.status === 'resolved').length} resolved</span></td><td>${docs}</td>
      <td class="pre">${esc(v.notes) || '<span class="meta">—</span>'}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-act="open-anv" data-id="${v.id}">Open</button> <button class="btn sm" data-act="edit-anv" data-id="${v.id}">Edit</button></td></tr>`;
  }).join('');
  const draftN = S.versions.filter(v => !v.anvId).length, draftU = S.usages.filter(u => !u.anvId).length, next = (S.anv.length ? latestAnv().number : 0) + 1;
  return `<div class="pagehead"><div><h1>AN versions</h1><p>${esc(S.an.an_name)} · ${esc(S.an.collaboration)}. Each published version keeps its own plots, comments and documents.</p></div>
    <div class="actions"><button class="btn primary" data-act="publish">${S.anv.length ? `Publish AN v${next}` : 'Publish first version'}</button></div></div>
  <div class="card pad" style="margin-bottom:20px"><b>Working draft:</b> ${draftN} new plot version${draftN === 1 ? '' : 's'} and ${draftU} record${draftU === 1 ? '' : 's'} not yet in a published version. ${S.anv.length ? '' : 'Publishing creates AN v1 and unlocks reviewer comments.'}
    <button class="link" data-act="to-draft-dash">View working draft</button></div>
  ${S.anv.length ? `<div class="card" style="overflow:auto"><table class="vtable"><tr><th>Version</th><th>Published</th><th>Figures</th><th>Plot versions</th><th>Reviewer comments</th><th>Documents</th><th>Notes</th><th></th></tr>${rows}</table></div>`
    : '<div class="card empty">No AN version has been published yet. While the AN is being written, work happens in the working draft.</div>'}`;
}
function publishModal(editV) {
  const prev = latestAnv(), next = (prev ? prev.number : 0) + 1, dn = S.versions.filter(v => !v.anvId).length, du = S.usages.filter(u => !u.anvId).length;
  openModal({title: `Publish AN v${next}`, submit: `Publish v${next}`, wide: true,
    sub: `This creates a new AN version record. The ${dn} plot version${dn === 1 ? '' : 's'} and ${du} record${du === 1 ? '' : 's'} in your working draft become part of it. Earlier versions are not changed.`,
    body: `<div class="cols">${field('Version number', `<input type="text" name="number" value="${next}" inputmode="numeric">`)}${field('Publication date', `<input type="date" name="published_on" value="${today()}">`)}</div>`
      + field('Notes', '<textarea name="notes" placeholder="e.g. Addressed ARC comments; new systematics table."></textarea>', '', true)
      + (prev ? `<label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" name="carry" checked style="margin-top:4px"><span>Carry over Analysis Note figures from AN v${prev.number} that I haven't re-assigned <span class="meta">(each uses its plot's latest version; reviewer comments are not copied)</span></span></label>` : ''),
    onSubmit: async fd => {
      const n = parseInt(fd.get('number'), 10); if (!(n >= 1)) throw new Error('Version number must be a positive whole number');
      const r = await api('POST', aurl('/versions'), {number: n, published_on: fd.get('published_on') || today(), notes: fd.get('notes').trim(), carry_figures: !!fd.get('carry')});
      await loadAnalysis(S.an.id); setCtx(r.id); toast(`AN v${r.number} published${r.carried ? ` — ${r.carried} figure(s) carried over` : ''}`); go(L('')); render();
    }});
}
function editAnvModal(v) {
  openModal({title: `Edit AN v${v.number}`, body: field('Publication date', `<input type="date" name="published_on" value="${esc(v.published_on)}">`) + field('Notes', `<textarea name="notes">${esc(v.notes)}</textarea>`, '', true),
    onSubmit: async fd => { await api('PATCH', aurl('/versions/' + v.id), {published_on: fd.get('published_on'), notes: fd.get('notes')}); await reload(); }});
}

/* ---- documents ---- */
const DOC_KINDS = ['AN draft', 'Reviewer response', 'Presentation', 'Meeting notes', 'Paper / reference', 'Other'];
function viewDocs() {
  const groups = [{key: null, label: 'Whole analysis'}, ...S.anv.map(v => ({key: v.id, label: anvLabel(v)}))].reverse().sort((a, b) => (a.key === null ? -1 : b.key === null ? 1 : 0));
  const sec = g => { const ds = S.docs.filter(d => (d.anvId || null) === g.key);
    if (!ds.length && g.key !== null) return '';
    return `<h2 style="margin:22px 0 10px">${g.label}</h2><div class="card">${ds.map(d => `<div class="row" style="cursor:default"><div class="t"><b>${esc(d.title)} <span class="badge">${esc(d.kind)}</span></b><span style="white-space:normal">${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${esc(d.url)}</a> ` : ''}${esc(d.notes)}</span></div>
      <span class="meta">${fmtDate(d.created)}</span><button class="btn sm" data-act="edit-doc" data-id="${d.id}">Edit</button><button class="iconbtn" data-act="del-doc" data-id="${d.id}">🗑</button></div>`).join('') || '<div class="empty">No documents yet</div>'}</div>`; };
  return `<div class="pagehead"><div><h1>Documents</h1><p>Supporting documents for the whole analysis or for a specific AN version.</p></div><div class="actions"><button class="btn primary" data-act="new-doc">+ Add document</button></div></div>${groups.map(sec).join('')}`;
}
function docModal(d) {
  const scope = `<option value="">Whole analysis</option>${S.anv.map(v => `<option value="${v.id}" ${d?.anvId === v.id ? 'selected' : ''}>${anvLabel(v)}</option>`).join('')}`;
  openModal({title: d ? 'Edit document' : 'Add document', submit: 'Save',
    body: field('Title', `<input type="text" name="title" required maxlength="200" value="${esc(d?.title || '')}">`)
      + `<div class="cols">${field('Type', `<select name="kind">${DOC_KINDS.map(k => `<option ${d?.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select>`)}${isAN() ? field('Applies to', `<select name="anv">${scope}</select>`) : ''}</div>`
      + field('Link', `<input type="url" name="url" value="${esc(d?.url || '')}" placeholder="https://…">`, 'Google Drive, CDS, arXiv, …', true) + field('Notes', `<textarea name="notes">${esc(d?.notes || '')}</textarea>`, '', true),
    onSubmit: async fd => {
      const b = {title: fd.get('title').trim(), kind: fd.get('kind'), url: fd.get('url').trim(), notes: fd.get('notes').trim(), an_version_id: fd.get('anv') || null};
      await (d ? api('PATCH', aurl('/documents/' + d.id), b) : api('POST', aurl('/documents'), b)); await reload();
    }});
}

/* ---- settings ---- */
function viewSettings() {
  const a = S.an;
  return `<div class="pagehead"><div><h1>Analysis settings</h1></div></div>
  <div class="card pad" style="max-width:760px;display:grid;gap:18px">
    <dl class="kv tight"><dt>Title</dt><dd>${esc(a.title)}</dd><dt>Stage</dt><dd>${a.stage === 'an_stage' ? 'AN stage' : 'Just started'}</dd>
      ${isAN() ? `<dt>AN name</dt><dd>${esc(a.an_name)}</dd><dt>Collaboration</dt><dd>${esc(a.collaboration)}</dd><dt>AN status</dt><dd>${isPub() ? `Published (latest: AN v${latestAnv().number})` : 'AN being written'}</dd>` : ''}
      <dt>Owner</dt><dd>${esc(a.owner_name || a.owner)}</dd><dt>Data repository</dt><dd class="mono">${esc(GHS.repo)}</dd><dt>Created</dt><dd>${fmtDate(a.created)}</dd></dl>
    <div class="actions">${a.owner === U.id ? '<button class="btn" data-act="edit-an">Edit details</button>' : ''}
      ${a.stage === 'just_started' && a.owner === U.id ? '<button class="btn primary" data-act="to-an">Move to AN stage</button>' : ''}
      <button class="btn" data-act="export">Export backup (JSON)</button></div>
    ${a.stage === 'just_started' ? '<div class="note-box">At the AN stage you add the AN name and collaboration, and can publish AN versions. Reviewer comments appear once the first version is published.</div>' : ''}
    ${a.owner === U.id ? '<div class="danger-zone"><h3>Delete this analysis</h3><p class="meta">Removes all of its plots, comments, versions and documents from the repository (they remain in git history).</p><button class="btn danger" data-act="del-an">Delete analysis…</button></div>' : '<div class="note-box">Only the owner can edit the analysis settings or delete it. Everyone in the group can add plots and comments.</div>'}
  </div>`;
}
function editAnModal(upgrade) {
  const a = S.an;
  openModal({title: upgrade ? 'Move to AN stage' : 'Edit analysis', submit: 'Save', sub: upgrade ? 'Provide the Analysis Note details. The AN starts as “being written”; publish versions from the AN versions page.' : '',
    body: field('Analysis title', `<input type="text" name="title" required maxlength="150" value="${esc(a.title)}">`) + (isAN() || upgrade ? anFields(a, true) : ''),
    setup: f => { if (upgrade) { f.an_name.required = f.collaboration.required = true; } },
    onSubmit: async fd => {
      const b = {title: fd.get('title').trim(), stage: upgrade ? 'an_stage' : a.stage};
      if (b.stage === 'an_stage') Object.assign(b, {an_name: fd.get('an_name').trim(), collaboration: fd.get('collaboration').trim(), an_status: a.an_status || 'being_written'});
      await api('PATCH', aurl(''), b); await reload(); if (upgrade) toast('Moved to the AN stage');
    }});
}

const notFound = () => '<div class="card empty">Not found. <a href="#/">Back to analyses</a></div>';

function render() {
  if (!U) return;
  if (!$('#main')) mountShell();
  renderSide(); renderTop();
  const r = route(); let h;
  if (r[0] !== 'a' || !S) h = viewHome();
  else {
    const s = r.slice(2);
    if (!s[0]) h = viewDash();
    else if (s[0] === 'cat') h = viewCat(s[1]);
    else if (s[0] === 'plot') h = s[2] === 'compare' ? viewCompare(s[1]) : viewPlot(s[1]);
    else if (s[0] === 'meetings') h = viewMeetings(s[1]);
    else if (s[0] === 'reviewer') h = viewReviewer();
    else if (s[0] === 'pending') h = viewPending();
    else if (s[0] === 'versions') h = viewVersions();
    else if (s[0] === 'docs') h = viewDocs();
    else if (s[0] === 'settings') h = viewSettings();
    else h = notFound();
  }
  $('#main').innerHTML = h;
  hydrateImages();
}

/* ============================ forms ============================ */
function versionFields(prev, first) {
  return field('What does this version show?', '<input type="text" name="summary" required maxlength="140" placeholder="e.g. Electron pT, tight ID, data vs. MC, 30 bins">', 'One line that you can recognise in a list.')
    + field('What changed compared to the previous version?', `<textarea name="changes" required placeholder="e.g. Rebinned 15 → 30 bins; added data/MC ratio panel; axis labels with units.">${first ? 'Initial version.' : ''}</textarea>`, first ? '' : 'Be specific: binning, cuts, axis range, style, corrections…')
    + field('Why this change?', '<textarea name="motivation" placeholder="e.g. Supervisor asked for finer binning at high pT."></textarea>', '', true)
    + `<div class="cols">${field('Dataset / selection', `<input type="text" name="dataset" maxlength="500" value="${esc(prev?.dataset || '')}" placeholder="e.g. 2024 data, pT>25, |η|<2.4">`, '', true)}
       ${field('Code reference', `<input type="text" name="code" maxlength="500" value="${esc(prev?.code || '')}" placeholder="commit hash or URL">`, '', true)}</div>`;
}
const vFromForm = fd => ({summary: fd.get('summary').trim(), changes: fd.get('changes').trim(), motivation: fd.get('motivation').trim(), dataset: fd.get('dataset').trim(), code: fd.get('code').trim()});
function needDraft() {   // new plots/versions are always unreleased work -> working draft
  if (!isPub() || ctx().draft) return;
  setCtx('draft'); render(); toast('Switched to the working draft: new plots are added here and join the next AN version when you publish it.');
}

function newPlotModal(catId) {
  if (!S.cats.length) return newCatModal(() => newPlotModal());
  needDraft();
  const opts = S.cats.map(c => `<option value="${c.id}" ${c.id === catId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  openModal({title: 'New plot', wide: true, sub: 'Creates the plot and saves its first version.', submit: 'Create plot',
    body: `<div class="cols">${field('Category', `<select name="cat">${opts}</select>`)}${field('Plot name', '<input type="text" name="name" required maxlength="150" placeholder="e.g. Electron pT, leading">')}</div>` + field('Plot image', fileField()) + versionFields(null, true),
    onSubmit: async fd => {
      const up = await upload(fd.get('file'));
      const r = await api('POST', aurl('/plots'), {category_id: fd.get('cat'), name: fd.get('name').trim(), version: {file_id: up.file_id, ...vFromForm(fd)}});
      ui.sel[r.id] = r.version_id; await loadAnalysis(S.an.id); go(L('/plot/' + r.id)); toast('Plot created'); render();
    }});
}
function newCatModal(then) {
  openModal({title: 'New category', sub: 'Group plots by what they show, e.g. “Electron pT”, “Muon η”, “MET”.', submit: 'Create',
    body: field('Category name', '<input type="text" name="name" required maxlength="100">'),
    onSubmit: async fd => { await api('POST', aurl('/categories'), {name: fd.get('name').trim()}); await loadAnalysis(S.an.id); render(); if (then) then(); }});
}
function newVersionModal(pid) {
  needDraft();
  const p = plot(pid), prev = latest(pid);
  openModal({title: `Save new version of “${esc(p.name)}”`, wide: true, submit: `Save as v${prev.num + 1}`,
    sub: `Describe this version before saving — it becomes the permanent record. Previous version: ${verLabel(prev)}.`,
    body: field('Plot image', fileField()) + versionFields(prev, false),
    onSubmit: async fd => {
      const up = await upload(fd.get('file')); const r = await api('POST', aurl(`/plots/${pid}/versions`), {file_id: up.file_id, ...vFromForm(fd)});
      ui.sel[pid] = r.id; await loadAnalysis(S.an.id); toast('New version saved'); render();
    }});
}

function useFields(type, u = {}) {
  if (type === 'note') {
    const figs = [...new Set(S.usages.filter(x => x.type === 'note').map(x => x.fig))];
    return `<datalist id="figs">${figs.map(f => `<option value="${esc(f)}">`).join('')}</datalist>`
      + field('Figure number in the Analysis Note', `<input type="text" name="fig" list="figs" required maxlength="40" value="${esc(u.fig || '')}" placeholder="e.g. 4.2">`, 'Type a number or pick one used before.')
      + field('Analysis Note draft / version', `<input type="text" name="an_ver" maxlength="40" value="${esc(u.anVer || '')}" placeholder="e.g. v3">`, '', true);
  }
  return field('Google Slides link', `<input type="url" name="link" required maxlength="500" value="${esc(u.link || '')}" placeholder="https://docs.google.com/presentation/…">`)
    + `<div class="cols">${field('Slide number', `<input type="text" name="slide" required maxlength="40" value="${esc(u.slide || '')}" placeholder="e.g. 12">`)}${field('Meeting date', `<input type="date" name="date" required value="${esc(u.date || today())}">`)}</div>`
    + field('Meeting title', `<input type="text" name="title" maxlength="150" value="${esc(u.title || '')}" placeholder="e.g. TMP weekly #42">`, '', true);
}
function useModal(vid, type, u) {
  const v = ver(vid) || ver(u.versionId), p = plot(v.plotId), t = type || u.type, cx = ctx();
  openModal({title: `${u ? 'Edit' : 'Add'} · ${CTX[t].label}`, sub: `${esc(p.name)} ${verLabel(v)} · recorded in ${u ? (u.anvId ? anvLabel(anv(u.anvId)) : 'the working draft') : (cx.draft ? 'the working draft' : cx.label)}`, body: useFields(t, u || {}),
    onSubmit: async fd => {
      const d = t === 'note' ? {fig: fd.get('fig').trim(), an_ver: fd.get('an_ver').trim()} : {link: fd.get('link').trim(), slide: fd.get('slide').trim(), date: fd.get('date'), title: fd.get('title').trim()};
      await (u ? api('PATCH', aurl('/usages/' + u.id), d) : api('POST', aurl('/usages'), {plot_version_id: vid, type: t, an_version_id: cx.id, ...d})); await reload();
    }});
}
function reviewModal(u, r) {
  const t = u.type, has = r && !r.none;
  openModal({title: r ? 'Edit feedback' : 'Add feedback', sub: esc(useTitle(u)), submit: 'Save',
    body: `<div class="cols">${field(t === 'note' ? 'Kind of reviewer' : 'Who commented', `<select name="role">${CTX[t].roles.map(x => `<option ${r?.role === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}
      ${field('Name', `<input type="text" name="name" maxlength="100" value="${esc(r?.name || '')}" placeholder="${t === 'note' ? 'Reviewer' : 'Meeting member'} name">`, '', true)}</div>
      ${field('Feedback', radios('kind', [['none', 'No comments so far'], ['comment', 'There is a comment']], has ? 'comment' : 'none'))}
      <div class="f" id="cwrap" ${has ? '' : 'hidden'}><label class="l">What was the comment?</label><textarea name="text" maxlength="5000" placeholder="Paste or summarise the comment">${esc(has ? r.text : '')}</textarea></div>
      <div class="f" id="swrap" ${has ? '' : 'hidden'}><label class="l">Status</label>${radios('status', [['pending', 'Pending'], ['resolved', 'Resolved']], r?.status === 'resolved' ? 'resolved' : 'pending')}<div class="h">Resolving will ask you for the updated plot.</div></div>`,
    setup: f => {
      const upd = () => { const c = f.kind.value === 'comment'; $('#cwrap', f).hidden = $('#swrap', f).hidden = !c; f.text.required = c; };
      f.querySelectorAll('[name=kind]').forEach(x => x.addEventListener('change', upd)); upd();
    },
    onSubmit: async fd => {
      const none = fd.get('kind') === 'none', wantResolved = !none && fd.get('status') === 'resolved' && r?.status !== 'resolved';
      const body = {role: fd.get('role'), name: fd.get('name').trim(), none, text: none ? '' : fd.get('text').trim(), status: r?.status === 'resolved' && !none && !wantResolved ? (fd.get('status') === 'pending' ? 'pending' : 'resolved') : 'pending'};
      let id = r?.id; if (r) await api('PATCH', aurl('/reviews/' + r.id), body); else id = (await api('POST', aurl(`/usages/${u.id}/reviews`), body)).id;
      await reload(); if (wantResolved) setTimeout(() => resolveModal(S.usages.find(x => x.id === u.id), findReview(id).r), 50);
    }});
}
function whoCode(r) { return r.name ? slug(r.name.replace(/\./g, ''), 10) : r.role.split(/\s+/).map(w => /\d/.test(w) ? w : w[0].toUpperCase()).join(''); }
function resolveModal(u, r) {
  const v = ver(u.versionId), p = plot(v.plotId), idx = u.reviews.filter(x => !x.none).indexOf(r) + 1;
  const ctxPart = u.type === 'note' ? 'AN-Fig' + slug(u.fig, 8) : CTX[u.type].short + (u.slide ? '-s' + slug(u.slide, 6) : '');
  const base = `${slug(p.name, 24)}_v${v.num}_${ctxPart}_${whoCode(r)}-c${idx}`;
  const nextRev = Math.max(0, ...S.versions.filter(x => x.plotId === p.id && x.num === v.num).map(x => x.rev)) + 1;
  openModal({title: 'Mark as resolved', wide: true, submit: 'Resolve', sub: `<b>${esc(whoStr(r))}</b>: “${esc(r.text)}”`,
    body: `${radios('mode', [['plot', 'Upload the updated plot'], ['noplot', 'Resolved without changing the plot']], 'plot')}
      <div id="rp" style="display:grid;gap:14px">${field('Updated plot', fileField(false))}
        ${field('What did you change to address it?', '<textarea name="changes" maxlength="3000" placeholder="e.g. Switched y-axis to log scale and extended range to 10⁶."></textarea>')}
        ${field('Saved as', `<input type="text" name="fname" maxlength="140" value="${esc(base)}_" class="mono">`, `Stored as <b>${verLabel({num: v.num, rev: nextRev})}</b>, linked to ${verLabel(v)}, in the working draft. Finish the name with a few words describing the change, e.g. <span class="mono">${esc(base)}_log-y-axis</span>.`)}</div>
      <div id="rn" hidden>${field('How was it resolved?', '<textarea name="note" maxlength="3000" placeholder="e.g. Explained in reply; reviewer accepted the current binning."></textarea>')}</div>`,
    setup: f => {
      const upd = () => { const pl = f.mode.value === 'plot'; $('#rp', f).hidden = !pl; $('#rn', f).hidden = pl; f.file.required = pl; f.changes.required = pl; f.note.required = !pl; };
      f.querySelectorAll('[name=mode]').forEach(x => x.addEventListener('change', upd)); upd();
    },
    onSubmit: async fd => {
      if (fd.get('mode') === 'plot') {
        const file = fd.get('file'); if (!file || !file.size) throw new Error('Please choose the updated plot');
        const up = await upload(file);
        await api('POST', aurl(`/reviews/${r.id}/resolve`), {mode: 'plot', file_id: up.file_id, changes: fd.get('changes').trim(), file_name: fd.get('fname').trim().replace(/[-_.]+$/, '')});
        toast('Resolved — updated plot saved in the working draft');
      } else { await api('POST', aurl(`/reviews/${r.id}/resolve`), {mode: 'noplot', note: fd.get('note').trim()}); toast('Marked as resolved'); }
      await reload();
    }});
}

/* ============================ actions ============================ */
const A = {
  menu: () => $('#side').classList.toggle('open'),
  theme: () => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); const n = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = n; lsSet('at_theme', n); },
  logout: () => confirmBox('Disconnect', `Remove <b>${esc(GHS.repo)}</b> from this device? Your data stays safe in GitHub; you can reconnect any time with a token.`, 'Disconnect', async () => {
    ghForget(); await afterRepoChange(); }),
  setrepo: async el => {
    if (el.value === '__add') { el.value = GHS.repo; return addRepoModal(); }
    if (el.value === GHS.repo) return;
    const target = el.value;
    try { await ghSwitch(target); await afterRepoChange(target); toast('Switched to ' + target); }
    catch (e) { toast(e.message + (e.status === 401 ? ' This repository was removed - add it again with a new token.' : ''), 'err'); el.value = GHS.repo || ''; if (!GHS.repo) await afterRepoChange(); }
  },
  refresh: async () => { await softRefresh(); toast('Up to date'); },
  'new-an': () => newAnalysisModal(),
  demo: () => createDemo(),
  setctx: el => { setCtx(el.value); render(); },
  'to-draft': () => { setCtx('draft'); render(); }, 'to-latest': () => { setCtx(latestAnv().id); render(); },
  'to-draft-dash': () => { setCtx('draft'); go(L('')); render(); },
  'open-anv': el => { setCtx(el.dataset.id); go(L('')); render(); },
  'edit-anv': el => editAnvModal(anv(el.dataset.id)),
  publish: () => publishModal(),
  'new-cat': () => newCatModal(),
  'new-plot': el => newPlotModal(el.dataset.id),
  'del-cat': el => confirmBox('Delete category', 'Delete this empty category?', 'Delete', async () => { await api('DELETE', aurl('/categories/' + el.dataset.id)); await loadAnalysis(S.an.id); go(L('')); render(); }),
  'new-ver': el => newVersionModal(el.dataset.id),
  selver: el => {
    const v = ver(el.dataset.id); if (!v) return;
    if (!visV(v)) setCtx('draft');
    ui.sel[v.plotId] = v.id; const r = route();
    if (r[3] !== v.plotId || r[4]) go(L('/plot/' + v.plotId)); else render();
  },
  cmp: (el, e) => {
    const v = ver(el.dataset.id), list = ui.cmp[v.plotId] = ui.cmp[v.plotId] || [];
    if (list.includes(v.id)) ui.cmp[v.plotId] = list.filter(i => i !== v.id);
    else if (list.length >= 5) { e.preventDefault(); toast('You can compare at most 5 versions', 'err'); return; }
    else list.push(v.id);
    const y = window.scrollY; render(); window.scrollTo(0, y);
  },
  'cmp-chip': (el) => A.cmp(el, {preventDefault() {}}),
  'go-cmp': el => go(L(`/plot/${el.dataset.id}/compare`)),
  mode: el => { ui.mode = el.dataset.id; render(); },
  pickA: el => { ui.A = el.value; render(); }, pickB: el => { ui.B = el.value; render(); },
  pfilter: el => { ui.pf = el.dataset.id; render(); }, rfilter: el => { ui.rf = el.dataset.id; render(); },
  zoom: async el => lightbox(await imageUrl(ver(el.dataset.id))),
  download: async el => { const v = ver(el.dataset.id); const a = document.createElement('a'); a.href = await imageUrl(v); a.download = v.fileName; a.click(); },
  'del-ver': el => { const v = ver(el.dataset.id), kids = S.versions.filter(x => x.parentId === v.id).length;
    confirmBox('Delete version', `Delete ${verLabel(v)}${kids ? ` and its ${kids} revision(s)` : ''}, including its meeting/AN records?`, 'Delete', async () => { await api('DELETE', aurl('/plot-versions/' + v.id)); ui.sel[v.plotId] = null; await reload(); }); },
  'del-plot': el => { const p = plot(el.dataset.id); confirmBox('Delete plot', `Delete “${esc(p.name)}” with all its versions? This cannot be undone.`, 'Delete plot', async () => { await api('DELETE', aurl('/plots/' + p.id)); await loadAnalysis(S.an.id); go(L('/cat/' + p.catId)); render(); }); },
  'add-use': el => useModal(el.dataset.id, el.dataset.type),
  'edit-use': el => useModal(null, null, S.usages.find(u => u.id === el.dataset.id)),
  'del-use': el => confirmBox('Remove', 'Remove this record and its feedback?', 'Remove', async () => { await api('DELETE', aurl('/usages/' + el.dataset.id)); await reload(); }),
  'add-rv': el => reviewModal(S.usages.find(u => u.id === el.dataset.id)),
  'edit-rv': el => { const f = findReview(el.dataset.id); reviewModal(f.u, f.r); },
  'del-rv': el => confirmBox('Delete feedback', 'Delete this feedback entry?', 'Delete', async () => { await api('DELETE', aurl('/reviews/' + el.dataset.id)); await reload(); }),
  resolve: el => { const f = findReview(el.dataset.id); resolveModal(f.u, f.r); },
  reopen: async el => { const f = findReview(el.dataset.id); try { await api('PATCH', aurl('/reviews/' + f.r.id), {role: f.r.role, name: f.r.name, none: false, text: f.r.text, status: 'pending'}); await reload(); } catch (e) { toast(e.message, 'err'); } },
  'new-doc': () => docModal(), 'edit-doc': el => docModal(S.docs.find(d => d.id === el.dataset.id)),
  'del-doc': el => confirmBox('Delete document', 'Delete this document record?', 'Delete', async () => { await api('DELETE', aurl('/documents/' + el.dataset.id)); await reload(); }),
  'edit-an': () => editAnModal(false), 'to-an': () => editAnModal(true),
  'del-an': () => openModal({title: 'Delete analysis', submit: 'Delete forever', sub: `This permanently deletes <b>${esc(S.an.title)}</b> and everything in it.`,
    body: field('Type the analysis title to confirm', '<input type="text" name="t" autocomplete="off">'),
    onSubmit: async fd => { if (fd.get('t').trim() !== S.an.title) throw new Error('The title does not match'); await api('DELETE', aurl('')); S = null; go('#/'); toast('Analysis deleted'); }}),
  export: async () => {
    const d = await api('GET', aurl('/export')); const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(d)], {type: 'application/json'})); a.download = `${slug(S.an.title, 40)}-backup-${today()}.json`; a.click();
  },
};

document.addEventListener('click', e => {
  const o = e.target.closest('[data-open]'); if (o) return go('#/a/' + o.dataset.open);
  const el = e.target.closest('[data-act]');
  if (el && A[el.dataset.act] && el.tagName !== 'SELECT') { if (el.tagName === 'A') e.preventDefault(); return Promise.resolve(A[el.dataset.act](el, e)).catch(err => toast(err.message, 'err')); }
  const g = e.target.closest('[data-go]');
  if (g) { if (g.dataset.ctx) setCtx(g.dataset.ctx); if (g.dataset.sel) { const v = ver(g.dataset.sel); if (v) ui.sel[v.plotId] = v.id; } go(g.dataset.go); }
});
document.addEventListener('change', e => { const el = e.target; if (el.tagName === 'SELECT' && el.dataset.act && A[el.dataset.act]) A[el.dataset.act](el, e); });
document.addEventListener('input', e => {
  const t = e.target, st = $('#main .stage');
  if (t.matches('[data-swipe]') && st) st.style.setProperty('--p', t.value + '%');
  if (t.matches('[data-opac]') && st) st.style.setProperty('--o', t.value);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('.lightbox')?.remove(); $('.overlay')?.remove(); $('#results')?.classList.remove('show'); } });

function onSearch(e) {
  if (e.target.id !== 'q' || !S) return;
  const q = e.target.value.trim().toLowerCase(), box = $('#results');
  if (!q) return box.classList.remove('show');
  const hits = visPlots().map(p => ({p, v: verOf(p.id).filter(v => (v.summary + ' ' + v.changes + ' ' + v.dataset).toLowerCase().includes(q)), n: p.name.toLowerCase().includes(q) || cat(p.catId)?.name.toLowerCase().includes(q)})).filter(h => h.n || h.v.length).slice(0, 8);
  box.innerHTML = hits.map(h => { const v = h.v[0] || latest(h.p.id); return `<a href="${L('/plot/' + h.p.id)}" data-sel="${v.id}">${img(v)}<span><b>${esc(h.p.name)}</b><br><span class="meta">${esc(cat(h.p.catId)?.name)}${h.v.length ? ' · ' + h.v.length + ' matching version(s)' : ''}</span></span></a>`; }).join('') || '<div class="empty" style="padding:14px">No matches</div>';
  box.classList.add('show'); hydrateImages();
}
document.addEventListener('click', e => { const a = e.target.closest('#results a'); if (a) { const v = ver(a.dataset.sel); if (v) ui.sel[v.plotId] = v.id; $('#results').classList.remove('show'); $('#q').value = ''; } });

/* ============================ demo analysis ============================ */
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function drawPlot({title, xl, xr, nb, shape, N = 2e5, logy, ratio, labels, legend, prelim, color = '#3b6fd8', seed = 1}) {
  const W = 900, H = 640, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), R = rng(seed);
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const Lm = 100, Rr = 40, T = 60, yb = ratio ? 430 : 530, rt = 450, rb = 530, bw = (xr[1] - xr[0]) / nb;
  const mc = [], dt = []; let tot = 0; for (let i = 0; i < nb; i++) { mc[i] = shape(xr[0] + (i + .5) * bw); tot += mc[i]; }
  for (let i = 0; i < nb; i++) { mc[i] = mc[i] / tot * N; const g1 = Math.sqrt(-2 * Math.log(R() || 1e-9)) * Math.cos(2 * Math.PI * R()); dt[i] = Math.max(1, mc[i] * (1 + .04 * Math.sin(i / nb * 6)) + g1 * Math.sqrt(mc[i])); }
  const ymax = Math.max(...mc, ...dt), ytop = logy ? ymax * 60 : ymax * 1.3;
  const X = x => Lm + (x - xr[0]) / (xr[1] - xr[0]) * (W - Lm - Rr);
  const Y = y => logy ? yb - Math.log10(Math.max(y, 1)) / Math.log10(ytop) * (yb - T) : yb - y / ytop * (yb - T);
  g.font = '15px sans-serif'; g.lineWidth = 2;
  for (let i = 0; i < nb; i++) { const x0 = X(xr[0] + i * bw), x1 = X(xr[0] + (i + 1) * bw); g.fillStyle = color + 'aa'; g.fillRect(x0, Y(mc[i]), x1 - x0, yb - Y(mc[i])); g.strokeStyle = color; g.strokeRect(x0, Y(mc[i]), x1 - x0, yb - Y(mc[i])); }
  g.fillStyle = '#111'; g.strokeStyle = '#111';
  for (let i = 0; i < nb; i++) { const x = X(xr[0] + (i + .5) * bw), e = Math.sqrt(dt[i]); g.beginPath(); g.arc(x, Y(dt[i]), 3.5, 0, 7); g.fill(); g.beginPath(); g.moveTo(x, Y(dt[i] + e)); g.lineTo(x, Y(Math.max(dt[i] - e, logy ? 1 : 0))); g.stroke(); }
  g.lineWidth = 1.5; g.strokeStyle = '#222'; g.beginPath(); g.moveTo(Lm, T); g.lineTo(Lm, yb); g.lineTo(W - Rr, yb); g.stroke(); g.fillStyle = '#222'; g.textAlign = 'right';
  if (logy) for (let k = 0; Math.pow(10, k) < ytop; k++) g.fillText('10^' + k, Lm - 8, Y(Math.pow(10, k)) + 5);
  else for (let k = 0; k <= 5; k++) { const y = ytop * k / 5; g.fillText(y >= 1000 ? Math.round(y / 100) / 10 + 'k' : Math.round(y), Lm - 8, Y(y) + 5); }
  g.textAlign = 'center'; const base = ratio ? rb : yb;
  for (let k = 0; k <= 5; k++) { const x = xr[0] + (xr[1] - xr[0]) * k / 5; g.fillText(+x.toFixed(1), X(x), base + 20); }
  if (ratio) {
    g.beginPath(); g.moveTo(Lm, rt); g.lineTo(Lm, rb); g.lineTo(W - Rr, rb); g.stroke();
    const RY = r => rb - (r - .8) / .4 * (rb - rt); g.setLineDash([5, 4]); g.beginPath(); g.moveTo(Lm, RY(1)); g.lineTo(W - Rr, RY(1)); g.stroke(); g.setLineDash([]);
    g.textAlign = 'right'; [.8, 1, 1.2].forEach(r => g.fillText(r, Lm - 8, RY(r) + 5));
    for (let i = 0; i < nb; i++) { const r = Math.min(1.2, Math.max(.8, dt[i] / mc[i])); g.beginPath(); g.arc(X(xr[0] + (i + .5) * bw), RY(r), 3, 0, 7); g.fillStyle = '#111'; g.fill(); }
    if (labels) { g.save(); g.translate(30, (rt + rb) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText('Data / MC', 0, 0); g.restore(); }
  }
  g.fillStyle = '#222'; g.font = '17px sans-serif'; g.textAlign = 'center';
  if (labels) { g.fillText(xl, (Lm + W - Rr) / 2, base + 50); g.save(); g.translate(30, (T + yb) / 2); g.rotate(-Math.PI / 2); g.fillText('Events / bin', 0, 0); g.restore(); }
  if (title) { g.font = 'bold 19px sans-serif'; g.textAlign = 'left'; g.fillText(title, Lm, 34); }
  if (prelim) { g.font = 'italic 16px sans-serif'; g.textAlign = 'right'; g.fillText('Preliminary', W - Rr, 34); }
  if (legend) { g.font = '15px sans-serif'; g.textAlign = 'left'; g.fillStyle = '#111'; g.beginPath(); g.arc(W - 220, T + 20, 4, 0, 7); g.fill(); g.fillText('Data', W - 205, T + 25); g.fillStyle = color + 'aa'; g.fillRect(W - 230, T + 38, 20, 12); g.fillStyle = '#111'; g.fillText('Simulation', W - 205, T + 49); }
  return new Promise(r => c.toBlob(b => r(new File([b], 'plot.png', {type: 'image/png'}))));
}
async function createDemo() {
  toast('Creating demo analysis… (saved as a single commit)');
  let newId = null;
  await batch(async () => {
  const n = AL.filter(a => a.title.startsWith('Demo · Top-Quark')).length, title = 'Demo · Top-Quark Charge Asymmetry' + (n ? ` (${n + 1})` : '');
  const aid = newId = (await api('POST', '/analyses', {title, stage: 'an_stage', an_name: 'AN-24-123', collaboration: 'CMS', an_status: 'being_written'})).id;
  const ap = p => `/analyses/${aid}${p}`, up = async o => (await api('POST', ap('/upload'), undefined, {raw: await drawPlot(o)})).file_id;
  const cat = async name => (await api('POST', ap('/categories'), {name})).id;
  const [c1, c2, c3] = [await cat('Electron pT'), await cat('Electron η'), await cat('Muon pT')];
  const ept = x => x * Math.exp(-x / 28), eta = x => Math.exp(-x * x / 4.5) + .25 * Math.exp(-Math.pow(Math.abs(x) - 1.6, 2)), mpt = x => x * Math.exp(-x / 34);
  const P1 = {title: 'Leading electron pT', xl: 'pT [GeV]', xr: [0, 150], shape: ept}, P2 = {title: 'Leading electron η', xl: 'η', xr: [-2.5, 2.5], shape: eta, color: '#c2410c'};
  const ds = '2024 data, tight ID, pT > 25 GeV';
  const v1 = async (pid, o, d) => (await api('POST', ap(`/plots/${pid}/versions`), {file_id: await up(o), ...d})).id;
  const p1 = await api('POST', ap('/plots'), {category_id: c1, name: 'Leading electron pT', version: {file_id: await up({...P1, nb: 12, seed: 1}), summary: 'First look, coarse binning, no labels', changes: 'Initial version.', dataset: ds}});
  await v1(p1.id, {...P1, nb: 30, labels: true, seed: 2}, {summary: 'Finer binning with axis labels', changes: 'Rebinned 12 → 30 bins; added axis titles with units.', motivation: 'Supervisor: “can’t see the turn-on”.', dataset: ds});
  const p1v3 = await v1(p1.id, {...P1, nb: 30, labels: true, ratio: true, legend: true, seed: 3}, {summary: 'Data/MC ratio panel and legend', changes: 'Added Data/MC ratio panel and a legend.', motivation: 'Required for the Analysis Note.', dataset: ds, code: 'https://github.com/example/analysis/commit/a1b2c3d'});
  const p2 = await api('POST', ap('/plots'), {category_id: c2, name: 'Leading electron η', version: {file_id: await up({...P2, nb: 20, seed: 4}), summary: 'η distribution, tight ID', changes: 'Initial version.', dataset: '2024 data, tight ID'}});
  const p2v2 = await v1(p2.id, {...P2, nb: 40, labels: true, ratio: true, legend: true, seed: 5}, {summary: 'Finer binning with ratio', changes: '20 → 40 bins; added ratio and legend.', dataset: '2024 data, tight ID'});
  const p3 = await api('POST', ap('/plots'), {category_id: c3, name: 'Leading muon pT', version: {file_id: await up({title: 'Leading muon pT', xl: 'pT [GeV]', xr: [0, 200], shape: mpt, nb: 25, labels: true, seed: 6, color: '#7c3aed'}), summary: 'Muon pT, loose isolation', changes: 'Initial version.', dataset: '2024 data, loose isolation'}});
  const use = async (pv, type, d) => (await api('POST', ap('/usages'), {plot_version_id: pv, type, ...d})).id;
  const slides = (slide, days, title) => ({link: 'https://docs.google.com/presentation/d/example', slide, date: new Date(Date.now() - days * 864e5).toISOString().slice(0, 10), title});
  const rv = (uid, b) => api('POST', ap(`/usages/${uid}/reviews`), b);
  const uTmp = await use(p1v3, 'tmp', slides('12', 20, 'TMP weekly #31'));
  await rv(uTmp, {role: 'Convener', name: 'L. Rossi', text: 'Bins are too fine above 100 GeV — statistical fluctuations dominate.'});
  const uGm = await use(p1v3, 'group', slides('5', 14, 'Group meeting'));
  await rv(uGm, {role: 'Supervisor', none: true});
  const uIm = await use(p2v2, 'internal', slides('3', 9, 'Internal review'));
  await rv(uIm, {role: 'Collaborator', name: 'S. Park', text: 'Which ID working point is this?'});
  await use(p3.version_id, 'collab', slides('8', 5, 'Collaboration meeting'));
  await use(p1v3, 'note', {fig: '4.2', an_ver: 'draft 2'}); await use(p2v2, 'note', {fig: '4.3', an_ver: 'draft 2'});
  await api('POST', ap('/versions'), {number: 1, published_on: new Date(Date.now() - 12 * 864e5).toISOString().slice(0, 10), notes: 'First public version of the AN.'});
  let st = await api('GET', ap(''));
  const u42 = st.usages.find(u => u.type === 'note' && u.fig === '4.2' && u.an_version_id).id, u43 = st.usages.find(u => u.type === 'note' && u.fig === '4.3' && u.an_version_id).id;
  const r1 = (await rv(u42, {role: 'Reviewer 1', name: 'A. Meyer', text: 'Please use a logarithmic y-axis so the high-pT tail can be judged.'})).id;
  await rv(u42, {role: 'Reviewer 2', none: true});
  await rv(u43, {role: 'ARC member', name: 'K. Tanaka', text: 'Add the systematic uncertainty band to the ratio panel.'});
  await api('POST', ap(`/reviews/${r1}/resolve`), {mode: 'plot', file_id: await up({...P1, nb: 30, labels: true, ratio: true, legend: true, logy: true, seed: 3, color: '#1f7a4d'}), changes: 'Switched the y-axis to log scale so the high-pT tail is visible.', file_name: 'leading-electron-pt_v3_AN-Fig4.2_R1-c1_log-y-axis'});
  await v1(p1.id, {...P1, nb: 30, labels: true, ratio: true, legend: true, logy: true, prelim: true, seed: 3, color: '#1f7a4d'}, {summary: 'Final style: log-y, ratio, “Preliminary” label', changes: 'Added “Preliminary” label; unified colours with the other figures.', motivation: 'Prepare AN v2.', dataset: ds});
  await api('POST', ap('/versions'), {number: 2, published_on: today(), notes: 'Addressed Reviewer 1 and ARC comments.', carry_figures: true});
  st = await api('GET', ap(''));
  const v2fig = st.usages.find(u => u.type === 'note' && u.fig === '4.2' && u.an_version_id === st.an_versions[1].id).id;
  await rv(v2fig, {role: 'Reviewer 1', name: 'A. Meyer', text: 'Thanks — please also state the integrated luminosity in the label.'});
  await api('POST', ap('/documents'), {title: 'AN-24-123 v2 (PDF)', kind: 'AN draft', url: 'https://example.org/an-24-123-v2.pdf', an_version_id: st.an_versions[1].id, notes: 'Public version 2.'});
  await api('POST', ap('/documents'), {title: 'Analysis strategy', kind: 'Meeting notes', notes: 'Overall strategy agreed with the supervisor.'});
  });
  toast('Demo analysis created'); go('#/a/' + newId);
}

/* ============================ boot ============================ */
async function start() { mountShell(); await nav(); }
async function softRefresh() {
  if (!U || $('.overlay')) return;
  try { if (S) await loadAnalysis(S.an.id); else await loadList(); render(); } catch (e) { toast(e.message, 'err'); }
}
let hiddenAt = Date.now();
document.addEventListener('visibilitychange', () => {   // pick up teammates' changes when you come back to the tab
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else if (Date.now() - hiddenAt > 60000) softRefresh();
});
(async function boot() {
  const th = lsGet('at_theme'); if (th) document.documentElement.dataset.theme = th;
  try { U = await ghRestore(); } catch (e) { U = null; showConnect(e.message); return; }
  if (U) await start(); else showConnect();
})();
