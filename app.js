/*! Analysis-Tracker - Copyright (c) 2026 Sanskar Nanda - MIT License (see LICENSE). https://github.com/Sanskar-hep */
/* Analysis-Tracker front end. Data lives in a GitHub repository (see backend.js); this file renders it and calls api(). */
'use strict';

/* ============================ helpers ============================ */
const CREDIT = {name: 'Sanskar Nanda', url: 'https://github.com/Sanskar-hep'};
const creditLine = () => `<div class="credit">Designed &amp; built by <a href="${CREDIT.url}" target="_blank" rel="noopener noreferrer"><b>${CREDIT.name}</b></a></div>`;
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
      reviews: u.reviews.map(r => ({...r, none: !!r.none, resolvedVersionId: r.resolved_version_id, resolvedMore: r.resolved_more || [], resolvedAt: r.resolved_at}))})),
    docs: st.documents.map(d => ({...d, anvId: d.an_version_id})),
    anc: (st.an_comments || []).map(c => ({...c, anvId: c.an_version_id, resolvedIn: c.resolved_in})),
  };
}
async function loadAnalysis(id) { S = norm(await api('GET', `/analyses/${id}`)); }
async function reload() { await loadAnalysis(S.an.id); render(); }
async function loadList() { AL = (await api('GET', '/analyses')).analyses; }

const CTX = {
  note:     {label: 'Analysis Note', short: 'AN',  roles: ['Convener', 'Reviewer 1', 'Reviewer 2', 'Reviewer 3', 'ARC member', 'Supervisor', 'Other']},
  meeting:  {label: 'Meeting',       short: 'MTG', roles: ['Convener', 'Meeting member', 'Supervisor', 'Other']},
  // older records only (the interface now uses the single "meeting" kind with a typed name)
  tmp:      {label: 'TMP meeting',   short: 'MTG', roles: ['Convener', 'Meeting member', 'Supervisor', 'Other']},
  group:    {label: 'Group meeting', short: 'MTG', roles: ['Convener', 'Meeting member', 'Supervisor', 'Other']},
  internal: {label: 'Internal review meeting', short: 'MTG', roles: ['Convener', 'Meeting member', 'Supervisor', 'Other']},
  collab:   {label: 'Collaboration meeting',   short: 'MTG', roles: ['Convener', 'Meeting member', 'Supervisor', 'Other']},
};
const kindOf = t => t === 'note' ? 'note' : 'meeting';                       // two review kinds: AN review and meetings
const LEGACY_NAME = {tmp: 'TMP', group: 'Group meeting', internal: 'Internal review meeting', collab: 'Collaboration meeting'};
const meetingName = u => u.title || LEGACY_NAME[u.type] || 'Meeting';
const COMMENT_KINDS = {text: 'Text', table: 'Table', equation: 'Equation', general: 'General', figure: 'Figure'};
const kindOfLoc = loc => /^tab/i.test(loc) ? 'table' : /^eq/i.test(loc) ? 'equation' : /^fig/i.test(loc) ? 'figure' : /^general/i.test(loc) ? 'general' : 'text';

/* ---- analysis stage helpers ---- */
const isAN = () => S.an.stage === 'an_stage';
const isPub = () => isAN() && S.an.an_status === 'published';
const meetingsOn = () => isAN() || !!S.an.presented || S.usages.some(u => u.type !== 'note') || S.anc.some(c => c.source === 'meeting');
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
const cNotes = () => S.usages.filter(u => u.type === 'note' && (u.anvId || null) === ctx().id);   // AN figure records of the version being viewed
const meetingUses = () => S.usages.filter(u => u.type !== 'note');                                   // meeting records are not tied to an AN version
const cUsages = () => [...cNotes(), ...meetingUses()];
const usesOf = vid => cUsages().filter(u => u.versionId === vid);
const plotUses = pid => cUsages().filter(u => ver(u.versionId)?.plotId === pid && visV(ver(u.versionId)));
const pendingOf = us => us.flatMap(u => u.reviews.filter(r => !r.none && r.status === 'pending').map(r => ({u, r})));
const pendingAn = () => S.anc.filter(c => c.status === 'pending').map(c => ({c, an: true}));   // comments that are not about a plot (AN text/tables, meeting methodology)
const allPending = () => [...pendingOf(S.usages), ...pendingAn()];      // global: across every version, the draft and all meetings
const entryKind = e => e.an ? (e.c.source === 'meeting' ? 'meeting' : 'note') : kindOf(e.u.type);
const pendingKind = k => allPending().filter(e => entryKind(e) === k);
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
const useTitle = u => u.type === 'note' ? `Analysis Note · Fig ${u.fig}` : `${meetingName(u)}${u.slide ? ' · slide ' + u.slide : ''}`;
const findReview = id => { for (const u of S.usages) { const r = u.reviews.find(x => x.id === id); if (r) return {u, r}; } return null; };
const L = p => `#/a/${S.an.id}${p}`;

/* ---- one AN figure can be made of several plots ("panels", e.g. one per era) ---- */
const sameFigUses = u => S.usages.filter(x => x.type === 'note' && x.fig === u.fig && (x.anvId || null) === (u.anvId || null)).sort((a, b) => a.created - b.created);
const panelName = u => u.panel || plot(ver(u.versionId).plotId).name;
const figGroups = us => { const m = new Map(); us.forEach(u => { if (!m.has(u.fig)) m.set(u.fig, []); m.get(u.fig).push(u); }); return [...m.values()].map(g => g.sort((a, b) => a.created - b.created)); };
/* eras written in different ways: "UL18", "UL2018", "2016post", "2016postVFP", "UL16 pre" -> comparable keys */
function eraKeys(s) {
  const out = new Set(), t = String(s || '');
  const add = (yy, pp) => { const yr = '20' + yy, p = (pp || '').toLowerCase(); if (p) out.add(yr + p); else if (yr === '2016') { out.add('2016pre'); out.add('2016post'); } else out.add(yr); };
  for (const m of t.matchAll(/UL\s*(?:20)?(16|17|18)(?!\d)\s*[-_ ]?\s*(pre|post)?/gi)) add(m[1], m[2]);
  for (const m of t.matchAll(/(?<!\d)20(16|17|18)(?!\d)\s*[-_ ]?\s*(pre|post)?/gi)) add(m[1], m[2]);
  for (const m of t.matchAll(/(?<!\d)(16|17|18)\s*[-_ ]?(pre|post)/gi)) add(m[1], m[2]);
  return out;
}
function panelMatches(label, text) {
  const l = eraKeys(label); if (l.size) { const t = eraKeys(text); return [...l].some(k => t.has(k)); }
  return String(label || '').trim().length >= 3 && String(text || '').toLowerCase().includes(String(label).trim().toLowerCase());
}
const eraLabelOf = name => (String(name || '').match(/UL\s?20\d\d(?:pre|post)?(?:VFP)?|20\d\d\s?(?:pre|post)?(?:VFP)?|UL\s?1[678](?:\s?(?:pre|post))?/i) || [''])[0].replace(/\s+/g, '');

/* ============================ ui primitives ============================ */
function toast(msg, kind = '', ms) {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), ms || (kind === 'err' ? 6000 : 2800));
}
/* persistent progress message for slow GitHub operations; returns a function that hides it */
function busy(msg) {
  const el = document.createElement('div'); el.className = 'busybar'; el.innerHTML = `<span class="spin"></span>${esc(msg)}`; document.body.appendChild(el);
  return () => el.remove();
}
function openModal({title, sub = '', body, submit = 'Save', wide = false, xl = false, onSubmit, setup}) {
  const m = document.createElement('div'); m.className = 'overlay';
  m.innerHTML = `<form class="modal ${xl ? 'xl' : wide ? 'wide' : ''}"><header><h3>${title}</h3><button type="button" class="x" data-close aria-label="Close">×</button></header>${sub ? `<p class="sub">${sub}</p>` : ''}<div class="mbody">${body}</div><footer><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${submit}</button></footer></form>`;
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
      ${field('Data repository', `<input type="text" name="repo" required value="${esc(cfgRepo)}" placeholder="owner/analysis-tracker-data" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">`, 'The private repository that holds the data.')}
      ${field('GitHub access token', '<input type="password" name="token" id="tokinput" required autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="github_pat_…">', 'Not your GitHub password: the long token starting with <b>github_pat_</b> (Contents: Read and write on that repository only).')}
      <label style="display:flex;gap:8px;align-items:center;font-size:13.5px"><input type="checkbox" id="showtok"> Show the token, to check what I typed or pasted</label>
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
  </div>${creditLine()}</div>`;
  const f = $('#authform');
  $('#showtok').onchange = e => { $('#tokinput').type = e.target.checked ? 'text' : 'password'; };
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
  $('#root').innerHTML = `<div class="app"><nav class="side" id="side"></nav><div class="main"><div class="top" id="top"></div><main class="content" id="main"></main>${creditLine()}</div></div>`;
  $('#top').addEventListener('input', onSearch);
}
const logoSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18M6 16v-5M11 16V6M16 16v-8M21 16v-3"/></svg>';
const brand = `<a href="#/" class="brand" style="color:var(--ink)"><div class="logo">${logoSvg}</div>Analysis-Tracker</a><div class="by">by <a href="${CREDIT.url}" target="_blank" rel="noopener noreferrer">${CREDIT.name}</a></div>`;

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
  const pend = allPending().length;
  const cats = S.cats.map(x => {
    const n = visPlots().filter(p => p.catId === x.id).length;
    return `<a href="${L('/cat/' + x.id)}" class="${pg === 'cat' && k === x.id ? 'on' : ''}"><span>${esc(x.name)}</span><span class="count">${n}</span></a>`;
  }).join('');
  const nav = (href, label, on, count) => `<a href="${href}" class="${on ? 'on' : ''}"><span>${label}</span>${count ? `<span class="count warn">${count}</span>` : ''}</a>`;
  const reviews = (meetingsOn() ? nav(L('/meetings'), 'Meetings', pg === 'meetings', pendingKind('meeting').length) : '')
    + (isPub() ? nav(L('/reviewer'), 'AN review (convenors)', pg === 'reviewer', pendingKind('note').length) : '');
  $('#side').innerHTML = `${brand}
    <a class="backlink" href="#/">← All analyses</a>
    <div class="aname">${esc(S.an.title)}</div>
    <div class="asub">${stageBadges(S.an)}</div>
    <div class="nav">
      ${nav(L(''), 'Dashboard', !pg)}
      <div class="sec"><span>Plots</span><button class="iconbtn" data-act="new-cat" title="New category">+</button></div>
      <div class="sub">${cats || '<div class="meta" style="padding:6px 24px">No categories yet</div>'}</div>
      ${reviews ? `<div class="sec"><span>Comments</span></div>${reviews}` : ''}
      ${isAN() ? `<div class="sec"><span>Analysis Note</span></div>${nav(L('/versions'), 'AN versions', pg === 'versions')}${nav(L('/docs'), 'Documents', pg === 'docs')}` : ''}
      <div class="sec"><span>Analysis</span></div>
      ${pend || isAN() ? nav(L('/pending'), 'All pending comments', pg === 'pending', pend) : ''}
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
/* AN PDFs stay on the user's computer: only name, size and a SHA-256 fingerprint are saved, to check later that the right file is opened */
const pdfField = hint => field('AN PDF', '<input type="file" name="pdf" accept="application/pdf,.pdf">', hint || 'Optional. Choose the PDF of this AN version.', true)
  + '<label class="storechk"><input type="checkbox" name="store" checked> <span>Store the PDF in your private data repository, so it opens on <b>every device</b> and for your group (up to 50 MB). If unticked, only its name and fingerprint are saved and the file stays on your computer.</span></label>';
async function pdfFingerprint(file) {
  if (!file || !file.size) return null;
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  return {name: file.name, size: file.size, sha256: [...h].map(x => x.toString(16).padStart(2, '0')).join(''), pages: null};
}
const anStageFields = cur => `<div id="anbox" style="display:grid;gap:14px">${anFields(cur)}<div id="firstv" hidden style="display:none;gap:14px"><div class="cols">${field('Published version number', '<input type="text" name="vnum" value="1" inputmode="numeric">')}${field('Publication date', `<input type="date" name="vdate" value="${today()}">`)}</div>${pdfField()}</div></div>`;
function bindAnStage(f, optional) {   // show the version fields only when "Version published" is chosen
  const upd = () => {
    const an = optional ? f.stage.value === 'an_stage' : true, pub = an && f.an_status.value === 'published';
    $('#anbox', f).style.display = an ? 'grid' : 'none'; $('#firstv', f).style.display = pub ? 'grid' : 'none'; $('#firstv', f).hidden = !pub;
    f.an_name.required = f.collaboration.required = an;
  };
  f.querySelectorAll('[name=stage],[name=an_status]').forEach(x => x.addEventListener('change', upd)); upd();
}
async function storePdf(aid, vid, file, fp) {          // put the PDF itself into the data repository
  const up = await api('POST', `/analyses/${aid}/upload`, undefined, {raw: file});
  await api('POST', `/analyses/${aid}/versions/${vid}/pdf`, {file_id: up.file_id, pdf: fp});
}
async function pdfAfter(fd, aid, vid) {
  const f = fd.get('pdf'); if (!f || !f.size) return;
  if (fd.get('store') && vid) {
    const done = busy('Storing the PDF in the repository…');
    try { await storePdf(aid, vid, f, await pdfFingerprint(f)); toast(`PDF stored: ${f.name}. Open it on any device from AN review → Open the AN PDF.`, '', 8000); }
    catch (e) { toast('The PDF could not be stored: ' + e.message + ' Its name and fingerprint were saved; you can store it later from the PDF viewer.', 'err', 12000); }
    finally { done(); }
  } else toast(`PDF recorded: ${f.name}. It stays on your computer; open it from AN review → Open the AN PDF.`, '', 8000);
}
async function anStageBody(fd) {
  const b = {an_name: fd.get('an_name').trim(), collaboration: fd.get('collaboration').trim(), an_status: fd.get('an_status')};
  if (b.an_status === 'published') {
    const n = parseInt(fd.get('vnum'), 10); if (!(n >= 1)) throw new Error('Version number must be a positive whole number');
    b.first_version = {number: n, published_on: fd.get('vdate') || today(), pdf: await pdfFingerprint(fd.get('pdf'))};
  }
  return b;
}
function newAnalysisModal() {
  openModal({title: 'New analysis', sub: 'Everything you add — plots, comments, documents — will belong to this analysis.', submit: 'Create analysis', wide: true,
    body: field('Analysis title', '<input type="text" name="title" required maxlength="150" placeholder="e.g. Top-Quark Charge Asymmetry">')
      + field('Analysis stage', radios('stage', [['just_started', 'Just started'], ['an_stage', 'AN stage']], 'just_started'), 'You can move to the AN stage later with the “Have you moved to the AN stage?” button on the dashboard.')
      + anStageFields(),
    setup: f => bindAnStage(f, true),
    onSubmit: async fd => {
      const body = {title: fd.get('title').trim(), stage: fd.get('stage')};
      if (body.stage === 'an_stage') Object.assign(body, await anStageBody(fd));
      const r = await api('POST', '/analyses', body);
      if (body.first_version) { const g = await api('GET', '/analyses/' + r.id); await pdfAfter(fd, r.id, g.an_versions[0]?.id); }
      go('#/a/' + r.id);
    }});
}

/* ============================ views: analysis workspace ============================ */
function ctxBadge(t, extra = '') { const k = kindOf(t); return `<span class="badge ${k}">${k === 'note' ? 'AN' : 'Meeting'}${extra}</span>`; }
function plotBadges(pid) {
  const us = plotUses(pid), pend = pendingOf(us).length;
  return ['note', 'meeting'].filter(k => us.some(u => kindOf(u.type) === k)).map(k => ctxBadge(k)).join('') + (pend ? `<span class="badge pending">${pend} pending</span>` : '');
}
function pendRow(e) {
  if (e.an) {
    const c = e.c, meet = c.source === 'meeting';
    return `<div class="row" data-go="${L(meet ? '/meetings' : '/reviewer')}" ${meet ? '' : `data-ctx="${c.anvId}"`}><div class="ancbox ${meet ? 'm' : ''}">${meet ? 'MTG' : 'AN'}</div><div class="t"><b>${c.location ? esc(c.location) : (meet ? esc(c.meeting) : 'Analysis Note')} ${meet ? `<span class="badge meeting">${esc(c.meeting)}</span>` : ctxBadge('note') + ' ' + ctxChip(c.anvId)}</b><span>${esc(whoStr(c))}: ${esc(c.text)}</span></div></div>`;
  }
  const {u, r} = e, v = ver(u.versionId), p = plot(v.plotId), note = u.type === 'note';
  return `<div class="row" data-go="${L('/plot/' + p.id)}" data-sel="${v.id}" data-ctx="${u.anvId || 'draft'}">${img(v)}<div class="t"><b>${esc(p.name)} <span class="badge">${verLabel(v)}</span> ${note ? ctxBadge('note', ' · Fig ' + esc(u.fig)) : `<span class="badge meeting">${esc(meetingName(u))}</span>`}${note && isPub() ? ' ' + ctxChip(u.anvId) : ''}</b><span>${esc(whoStr(r))}: ${esc(r.text)}</span></div></div>`;
}

/* "where are you?" prompts on the dashboard */
function guideCards() {
  const card = (title, text, btns) => `<div class="card pad guide"><div><b>${title}</b><div class="meta">${text}</div></div><div class="actions">${btns}</div></div>`;
  const out = [];
  if (!isAN()) {
    out.push(card('Have you moved to the AN stage?', 'For now this analysis is just plots. Once you start an Analysis Note, move it to the AN stage to record AN versions and the convenors’ comments.', '<button class="btn primary" data-act="to-an">Yes, move to the AN stage</button>'));
    out.push(meetingsOn()
      ? card('Meetings', `${meetingUses().length} plot record${meetingUses().length === 1 ? '' : 's'} · ${pendingKind('meeting').length} pending comment${pendingKind('meeting').length === 1 ? '' : 's'}.`, `<a class="btn" href="${L('/meetings')}">Open meetings</a>`)
      : card('Have you presented in a meeting?', 'If yes, you can record the comments people gave on your plots, and any methodology suggestions.', '<button class="btn" data-act="presented-yes">Yes, I’ve presented</button>'));
  } else if (!isPub()) {
    out.push(card('Your AN is being written', 'When a version of the AN is published, record it here: you can then add the convenors’ comments and link them to your plots.', `<a class="btn primary" href="${L('/versions')}">Publish an AN version</a>`));
  } else if (!(ui.hideAsk || {})[S.an.id]) {
    const v = latestAnv(), n = pendingKind('note').length;
    out.push(card(`Are there any comments on AN v${v.number}?`, n ? `${n} comment${n === 1 ? ' is' : 's are'} still pending.` : 'If the convenors or a meeting have commented, add their comments here.',
      '<button class="btn primary" data-act="comments-yes">Yes, add comments</button><button class="btn" data-act="comments-no">Not yet</button>'));
  }
  return out.join('');
}
function commentsChooser() {
  openModal({title: 'Where did the comments come from?', submit: 'Continue', sub: 'Choose the source. You can come back and add the other later.',
    body: radios('src', [['an', 'The convenors (review of the AN)'], ['meeting', 'A meeting']], 'an'),
    onSubmit: async fd => { if (fd.get('src') === 'an') { setCtx(latestAnv().id); go(L('/reviewer')); } else go(L('/meetings')); render(); }});
}

function viewDash() {
  const pend = allPending(), vp = visPlots(), vv = S.versions.filter(visV), cu = cUsages();
  const resolved = S.usages.flatMap(u => u.reviews).filter(r => !r.none && r.status === 'resolved').length + S.anc.filter(c => c.status === 'resolved').length;
  const cats = S.cats.map(c => {
    const ps = vp.filter(p => p.catId === c.id).sort((a, b) => b.created - a.created), lv = ps.length ? latest(ps[0].id) : null;
    const nv = ps.reduce((n, p) => n + verOf(p.id).length, 0);
    return `<div class="card pc" data-go="${L('/cat/' + c.id)}"><div class="th ${lv ? '' : 'empty'}">${lv ? img(lv) : 'No plots yet'}</div><div class="bd"><h3>${esc(c.name)}</h3><div class="meta">${ps.length} plot${ps.length === 1 ? '' : 's'} · ${nv} version${nv === 1 ? '' : 's'}</div></div></div>`;
  }).join('');
  const counts = [{k: 'note', c: 'note', label: 'Analysis Note'}, {k: 'meeting', c: 'tmp', label: 'Meetings'}].filter(x => x.k !== 'note' ? meetingsOn() : isAN())
    .map(x => ({...x, n: cu.filter(u => kindOf(u.type) === x.k).length}));
  const tot = counts.reduce((a, b) => a + b.n, 0) || 1;
  const recent = [...vv].sort((a, b) => b.created - a.created).slice(0, 6).map(v => {
    const p = plot(v.plotId);
    return `<div class="row" data-go="${L('/plot/' + p.id)}" data-sel="${v.id}">${img(v)}<div class="t"><b>${esc(p.name)} <span class="badge">${verLabel(v)}</span></b><span>${esc(v.summary)}</span></div><span class="meta">${fmtDate(v.created)}</span></div>`;
  }).join('');
  const anTile = isAN() ? `<div class="card tile"><b style="font-size:18px;line-height:1.4">${esc(S.an.an_name)}</b><span>${esc(S.an.collaboration)} · ${isPub() ? `AN v${latestAnv().number} published` : 'AN being written'}</span>${isPub() ? `<br><button class="link" data-act="open-pdf" data-v="${latestAnv().id}">Open the AN PDF${latestAnv().pdf ? '' : ' …'}</button>` : ''}</div>` : '';
  const showComments = meetingsOn() || isPub();
  return `${banner()}<div class="pagehead"><div><h1>${esc(S.an.title)}</h1><p>${ctx().draft ? 'Working draft' : ctx().label} · your plots${showComments ? ' and what was said about them' : ''}.</p></div>
    <div class="actions"><button class="btn primary" data-act="new-plot">+ New plot</button></div></div>
  <div class="guides">${guideCards()}</div>
  <div class="tiles">${anTile}
    <div class="card tile"><b>${vp.length}</b><span>Plots</span></div>
    <div class="card tile"><b>${vv.length}</b><span>Plot versions</span></div>
    ${showComments ? `<div class="card tile ${pend.length ? 'warn' : ''}"><b>${pend.length}</b><span>Pending comments</span></div><div class="card tile"><b>${resolved}</b><span>Comments resolved</span></div>` : ''}</div>
  <div class="sechead"><h2>Plot categories</h2><button class="btn sm" data-act="new-cat">+ New category</button></div>
  ${S.cats.length ? `<div class="grid">${cats}</div>` : '<div class="card empty">No categories yet. Create a category (e.g. “Electron pT”) or click <b>New plot</b> to start.</div>'}
  <div class="two">
    ${showComments ? `<div><h2>Needs attention</h2><div class="card" style="margin-top:10px">${pend.slice(0, 6).map(e => pendRow(e)).join('') || '<div class="empty">🎉 No pending comments</div>'}</div>
      ${pend.length > 6 ? `<p><a href="${L('/pending')}">See all ${pend.length} pending →</a></p>` : ''}</div>` : '<div></div>'}
    <div>${counts.length ? `<h2>Where plots are used${ctx().draft ? '' : ' in ' + ctx().label}</h2>
      <div class="card pad" style="margin-top:10px"><div class="splitbar">${counts.map(c => c.n ? `<div style="width:${c.n / tot * 100}%;background:var(--${c.c})"></div>` : '').join('')}</div>
        <div class="legend">${counts.map(c => `<span><i class="dot" style="background:var(--${c.c})"></i>${c.label} <b>${c.n}</b></span>`).join('')}</div></div>` : ''}
      <h2 style="margin-top:22px">Recent plot versions</h2><div class="card" style="margin-top:10px">${recent || '<div class="empty">Nothing yet</div>'}</div></div>
  </div>`;
}

function viewPending() {
  const f = ui.pf || 'all', list = allPending().filter(e => f === 'all' || entryKind(e) === f);
  const chips = [['all', 'All'], ...(isAN() ? [['note', 'AN review']] : []), ['meeting', 'Meetings']];
  return `<div class="pagehead"><div><h1>Pending comments</h1><p>Everything that still needs an answer or an updated plot, across all AN versions, the working draft and all meetings.</p></div>
    <div class="chips">${chips.map(([t, l]) => `<span class="chip ${f === t ? 'on' : ''}" data-act="pfilter" data-id="${t}">${l}</span>`).join('')}</div></div>
    <div class="card">${list.map(e => pendRow(e)).join('') || '<div class="empty">🎉 Nothing pending</div>'}</div>`;
}

function usageList(us, emptyMsg) {
  if (!us.length) return `<div class="card empty">${emptyMsg}</div>`;
  return us.map(u => { const v = ver(u.versionId), p = plot(v.plotId);
    return `<div class="uhead" data-go="${L('/plot/' + p.id)}" data-sel="${v.id}">${img(v)}<div><b>${esc(p.name)}</b> <span class="badge">${verLabel(v)}</span><div class="meta">${esc(cat(p.catId)?.name || '')}</div></div></div>${usageCard(u)}`; }).join('');
}

/* ---- answers: one text box under every comment, saved when you click away ---- */
const ansBox = (kind, id, val) => `<div class="ansbox"><label>Your answer</label><textarea class="ans" data-kind="${kind}" data-id="${id}" rows="2" maxlength="5000" placeholder="Write your reply to this comment…">${esc(val || '')}</textarea><span class="saved" aria-live="polite"></span></div>`;
const stateOf = (status, answer) => status === 'resolved' ? ['resolved', '✓ Resolved'] : (answer || '').trim() ? ['answered', 'Answered'] : ['pending', 'Pending'];
function anchorLine(item, kind) {
  const an = item.anchor;
  if (an) return `<div class="anchor"><button class="link" data-act="open-pdf" data-kind="${kind}" data-id="${item.id}">📍 page ${an.page}${an.quote ? ' · “' + esc(an.quote.length > 70 ? an.quote.slice(0, 70) + '…' : an.quote) + '”' : ' · marked area'}</button></div>`;
  return '';
}

/* a comment that is not about a plot: AN text/table/methodology (from the convenors), or a methodology suggestion from a meeting */
function ancCard(c) {
  const res = c.status === 'resolved', [cls, label] = stateOf(c.status, c.answer), meet = c.source === 'meeting';
  return `<div class="card ucard ${meet ? 'meeting' : 'note'}" id="c-${c.id}"><div class="rv" style="border-top:0"><div><div class="who">${c.kind && c.kind !== 'text' ? `<span class="badge">${COMMENT_KINDS[c.kind] || ''}</span> ` : ''}${c.location ? `<span class="badge stage">${esc(c.location)}</span> ` : ''}${esc(whoStr(c))} <span class="meta">· ${fmtDate(c.created)}</span></div>
      <div class="txt">${esc(c.text)}</div>${anchorLine(c, 'anc')}</div>
    <div class="ra"><span class="badge ${cls}">${label}</span>${res ? `<button class="btn sm" data-act="reopen-anc" data-id="${c.id}">Reopen</button>` : `<button class="btn sm primary" data-act="resolve-anc" data-id="${c.id}">Mark resolved</button><button class="btn sm" data-act="edit-anc" data-id="${c.id}">Edit</button>`}<button class="iconbtn" data-act="del-anc" data-id="${c.id}" title="Delete">🗑</button></div>
    <div style="grid-column:1/-1">${ansBox('anc', c.id, c.answer)}</div>
    ${res ? `<div class="res">${c.resolvedIn && anv(c.resolvedIn) ? `Addressed in <b>${anvLabel(anv(c.resolvedIn))}</b><br>` : ''}${esc(c.resolution)}</div>` : ''}</div></div>`;
}

/* ---- meetings: one page, grouped by the meeting names you typed ---- */
function viewMeetings() {
  if (!meetingsOn()) return `<div class="card empty"><p>The Meetings section is off for this analysis.</p><button class="btn primary" data-act="presented-yes">Yes, I’ve presented in a meeting</button></div>`;
  const f = ui.mf || 'all', groups = new Map(), key = (n, d) => n.toLowerCase().trim() + '|' + (d || '');
  const grp = (name, date) => { const k = key(name, date); if (!groups.has(k)) groups.set(k, {name, date: date || '', uses: [], cmts: []}); return groups.get(k); };
  meetingUses().forEach(u => grp(meetingName(u), u.date).uses.push(u));
  S.anc.filter(c => c.source === 'meeting').forEach(c => grp(c.meeting, c.meeting_date).cmts.push(c));
  const all = [...groups.values()], names = [...new Set(all.map(g => g.name))];
  const list = all.filter(g => f === 'all' || g.name === f).sort((x, y) => (y.date || '').localeCompare(x.date || ''));
  const nP = pendingKind('meeting').length;
  const sections = list.map(g => {
    const uses = [...g.uses].sort((x, y) => (parseFloat(x.slide) || 0) - (parseFloat(y.slide) || 0));
    return `<div class="sechead"><h2>${esc(g.name)} <span class="meta">${fmtDay(g.date)}</span></h2></div>
      ${g.cmts.length ? `<div class="meta" style="margin:-4px 0 8px">Methodology and general suggestions</div>${g.cmts.map(ancCard).join('')}` : ''}
      ${uses.length ? `<div class="meta" style="margin:6px 0 0">Comments on plots</div>${usageList(uses, '')}` : ''}`;
  }).join('');
  return `<div class="pagehead"><div><h1>Meetings</h1><p>${all.length} meeting${all.length === 1 ? '' : 's'} · ${nP} pending comment${nP === 1 ? '' : 's'}. Comments about a plot and general methodology suggestions.</p></div>
    <div class="actions"><button class="btn" data-act="import-email" data-type="meeting">Import comments from email</button><button class="btn" data-act="add-mplot">+ Plot shown in a meeting</button><button class="btn primary" data-act="add-mcomment">+ Methodology comment</button></div></div>
    ${names.length > 1 ? `<div class="chips" style="margin-bottom:6px">${['all', ...names].map(n => `<span class="chip ${f === n ? 'on' : ''}" data-act="mfilter" data-id="${esc(n)}">${n === 'all' ? 'All meetings' : esc(n)}</span>`).join('')}</div>` : ''}
    ${sections || '<div class="card empty">No meetings recorded yet. Use <b>+ Plot shown in a meeting</b> (a plot you presented), <b>+ Methodology comment</b> (a general suggestion), or open a plot and choose <b>+ Meeting</b>.</div>'}`;
}

/* ---- AN review: comments from the convenors on the published AN, in two groups ---- */
function viewReviewer() {
  if (!isPub()) return notFound();
  if (ctx().draft) return `${banner()}<div class="card empty">AN review comments belong to a published AN version. Select an AN version in the “Viewing” menu above.</div>`;
  const f = ui.rf || 'all', c = ctx(), kf = ui.rk || 'all';
  const figUs = cNotes().sort((a, b) => a.fig.localeCompare(b.fig, undefined, {numeric: true}));
  const figKeep = new Set(figGroups(figUs).filter(g => f === 'all' || g.some(u => u.reviews.some(r => !r.none && (f === 'resolved' ? r.status === 'resolved' : r.status === 'pending')))).map(g => g[0].fig));
  const figShown = figUs.filter(u => figKeep.has(u.fig));
  const ancAll = S.anc.filter(x => x.source === 'an' && x.anvId === c.id);
  const ancShown = ancAll.filter(x => (f === 'all' || x.status === f) && (kf === 'all' || x.kind === kf));
  const all = [...figUs.flatMap(u => u.reviews).filter(r => !r.none), ...ancAll], nP = all.filter(r => r.status === 'pending').length;
  const kinds = [...new Set(ancAll.map(x => x.kind))];
  const pdf = c.v.pdf;
  return `${banner()}<div class="pagehead"><div><h1>AN review · ${c.label}</h1><p>${nP} pending · ${all.length - nP} resolved. These comments stay with ${c.label} even after newer versions are published.<br><span class="meta">AN PDF: ${pdf ? esc(pdf.name) + (pdf.file_id ? ' (stored in the repository: opens on any device)' : ' (kept on your computer only)') : 'not recorded yet'} — use <b>Open the AN PDF</b>.</span></p></div>
    <div class="actions"><button class="btn" data-act="open-pdf" data-v="${c.id}">Open the AN PDF${pdf ? '' : ' …'}</button><button class="btn" data-act="import-email" data-type="note">Import comments from email</button><button class="btn" data-act="add-figure">+ Figure with several plots</button><button class="btn" data-act="reply-doc">Reply document</button><button class="btn primary" data-act="add-anc">+ Add comment</button></div></div>
    <div class="chips" style="margin-bottom:6px">${[['all', 'All'], ['pending', 'Pending'], ['resolved', 'Resolved']].map(([k, l]) => `<span class="chip ${f === k ? 'on' : ''}" data-act="rfilter" data-id="${k}">${l}</span>`).join('')}</div>
    <div class="sechead"><h2>Comments on figures <span class="count">${figShown.length}</span></h2></div>
    ${figShown.length ? figGroups(figShown).map(figureCard).join('') : '<div class="card empty">No comments on figures yet. Figures appear here when a plot is recorded as an AN figure (open a plot → <b>+ Analysis Note</b>, or use <b>+ Figure with several plots</b>) and a comment is added to it.</div>'}
    <div class="sechead"><h2>Comments on text, tables and methodology <span class="count">${ancShown.length}</span></h2></div>
    ${kinds.length > 1 ? `<div class="chips" style="margin-bottom:10px">${['all', ...kinds].map(k => `<span class="chip ${kf === k ? 'on' : ''}" data-act="kfilter" data-id="${k}">${k === 'all' ? 'All kinds' : COMMENT_KINDS[k]}</span>`).join('')}</div>` : ''}
    ${ancShown.length ? ancShown.map(ancCard).join('') : '<div class="card empty">No comments of this kind yet. Use <b>Import comments from email</b> or <b>+ Add comment</b>.</div>'}`;
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
    const us = usesOf(v.id), types = ['note', 'meeting'].filter(k => us.some(u => kindOf(u.type) === k)), pend = pendingOf(us).length;
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
  const types = ['note', 'meeting'].filter(t => t !== 'note' || isAN()).filter(t => t !== 'meeting' || meetingsOn() || true);
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

function reviewRow(u, r, opts = {}) {
  const [cls, label] = stateOf(r.status, r.answer), figure = u.type === 'note';
  const act = r.none ? `<button class="btn sm" data-act="edit-rv" data-id="${r.id}">Add comment</button>`
    : r.status === 'pending' ? `<button class="btn sm primary" data-act="resolve" data-id="${r.id}">Mark resolved</button><button class="btn sm" data-act="edit-rv" data-id="${r.id}">Edit</button>`
    : `<button class="btn sm" data-act="reopen" data-id="${r.id}">Reopen</button>`;
  const vers = [r.resolvedVersionId, ...(r.resolvedMore || [])].map(id => id && ver(id)).filter(Boolean);
  const target = opts.group ? `<span class="badge ${r.scope === 'figure' ? '' : 'stage'}">${r.scope === 'figure' ? 'Whole figure' : esc(panelName(u))}</span> ` : '';
  const addMore = figure && opts.group && r.status === 'resolved' && !r.none ? `<br><button class="link" data-act="more-plot" data-id="${r.id}">＋ Updated plot for another panel</button>` : '';
  return `<div class="rv"><div><div class="who">${target}${esc(whoStr(r))} <span class="meta">· ${fmtDate(r.created)}</span></div>
    ${r.none ? '<div class="txt none">No comments so far</div>' : `<div class="txt">${esc(r.text)}</div>`}${r.none ? '' : anchorLine(r, 'rev')}</div>
    <div class="ra">${r.none ? '' : `<span class="badge ${cls}">${label}</span>`}${act}<button class="iconbtn" data-act="del-rv" data-id="${r.id}" title="Delete">🗑</button></div>
    ${r.none ? '' : `<div style="grid-column:1/-1">${ansBox('rev', r.id, r.answer)}</div>`}
    ${r.status === 'resolved' && !r.none ? `<div class="res">${vers.length ? `Updated plot${vers.length > 1 ? 's' : ''} saved as ${vers.map(rv => `<a href="${L('/plot/' + rv.plotId)}" data-act="selver" data-id="${rv.id}"><b>${verLabel(rv)}</b></a> <span class="meta">${esc(plot(rv.plotId).name)}</span> ${ctxChip(rv.anvId)}`).join(', ')}<br><span class="mono">${vers.map(rv => esc(rv.fileName)).join(' · ')}</span><br>` : ''}${esc(r.resolution || '')}${addMore}</div>` : ''}</div>`;
}
/* a figure of the AN with all its plots (panels) and every comment about it */
function figureCard(uses) {
  const fig = uses[0].fig, rs = uses.flatMap(u => u.reviews.map(r => ({u, r}))), live = rs.filter(x => !x.r.none);
  const pend = live.filter(x => x.r.status === 'pending').length, res = live.filter(x => x.r.status === 'resolved').length;
  const panels = uses.map(u => { const v = ver(u.versionId), p = plot(v.plotId);
    return `<div class="panel" data-go="${L('/plot/' + p.id)}" data-sel="${v.id}" data-ctx="${u.anvId || 'draft'}"><div class="pimg">${img(v)}</div><div class="pl"><b>${esc(u.panel || p.name)}</b><span>${u.panel ? esc(p.name) + ' · ' : ''}${verLabel(v)}</span></div></div>`; }).join('');
  const status = !rs.length ? '<span class="badge">No comments yet</span>' : `${pend ? `<span class="badge pending">${pend} pending</span>` : ''}${res ? `<span class="badge resolved">${res} resolved</span>` : ''}`;
  return `<div class="card ucard note"><div class="uh"><div><div class="ti">Analysis Note · Figure ${esc(fig)}</div><span class="meta">${uses.length} plot${uses.length === 1 ? '' : 's'}${uses[0].anVer ? ' · ' + esc(uses[0].anVer) : ''}</span></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${status}<button class="btn sm" data-act="add-rv" data-id="${uses[0].id}">+ Convener comment</button></div></div>
    <div class="panels">${panels}</div>${rs.map(x => reviewRow(x.u, x.r, {group: uses.length > 1})).join('')}</div>`;
}
function usageCard(u) {
  const rs = u.reviews, pend = rs.filter(r => !r.none && r.status === 'pending').length, res = rs.filter(r => !r.none && r.status === 'resolved').length, note = u.type === 'note';
  const locked = note && !u.anvId;          // AN review comments need a published AN version
  const detail = note
    ? `<span class="meta">${u.anVer ? esc(u.anVer) : ''}</span>`
    : `<span class="meta">${u.date ? fmtDay(u.date) + ' · ' : ''}${u.link ? `<a href="${esc(u.link)}" target="_blank" rel="noopener noreferrer">Open slides ↗</a>` : ''}</span>`;
  const status = locked ? '' : !rs.length ? '<span class="badge">No feedback recorded yet</span>'
    : `${pend ? `<span class="badge pending">${pend} pending</span>` : ''}${res ? `<span class="badge resolved">${res} resolved</span>` : ''}${!pend && !res ? '<span class="badge">No comments so far</span>' : ''}`;
  const reviews = rs.map(r => reviewRow(u, r, {group: u.type === 'note' && sameFigUses(u).length > 1})).join('');
  return `<div class="card ucard ${kindOf(u.type)}"><div class="uh"><div><div class="ti">${esc(useTitle(u))}</div>${detail}</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${status}${locked ? '' : `<button class="btn sm" data-act="add-rv" data-id="${u.id}">+ ${note ? 'Convener' : 'Meeting'} comment</button>`}
    <button class="iconbtn" data-act="edit-use" data-id="${u.id}" title="Edit">✎</button>${u.anvId ? '' : `<button class="iconbtn" data-act="del-use" data-id="${u.id}" title="Remove">🗑</button>`}</div></div>
    ${locked ? '<div class="rv"><div class="hint">Comments from the convenors can be recorded once this figure is part of a published AN version. Publish a version from <b>AN versions</b>.</div></div>' : ''}${reviews}</div>`;
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
    <td>${S.usages.filter(u => u.versionId === v.id).map(u => `<span class="badge ${kindOf(u.type)}">${esc(useTitle(u))}${u.anvId ? ' · v' + anv(u.anvId).number : ''}</span>`).join(' ') || '—'}</td></tr>`).join('')}</table></div>` : '';
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
    const us = S.usages.filter(u => u.anvId === v.id), figs = us.filter(u => u.type === 'note'), rv = [...us.filter(u => u.type === 'note').flatMap(u => u.reviews).filter(r => !r.none), ...S.anc.filter(c => c.source === 'an' && c.anvId === v.id)];
    const pv = S.versions.filter(x => x.anvId === v.id).length, docs = S.docs.filter(d => d.anvId === v.id).length;
    return `<tr><td><b>AN v${v.number}</b> ${i === 0 ? '<span class="badge ok">latest</span>' : ''}</td><td>${fmtDay(v.published_on)}</td><td>${figs.length}</td><td>${pv}</td>
      <td>${rv.filter(r => r.status === 'pending').length ? `<span class="badge pending">${rv.filter(r => r.status === 'pending').length} pending</span>` : ''}<span class="badge resolved">${rv.filter(r => r.status === 'resolved').length} resolved</span></td><td>${docs}</td>
      <td>${v.pdf ? `<span class="meta" title="${esc(v.pdf.name)}">${esc(v.pdf.name.length > 24 ? v.pdf.name.slice(0, 22) + '…' : v.pdf.name)}</span><br><span class="badge ${v.pdf.file_id ? 'ok' : ''}">${v.pdf.file_id ? 'stored' : 'on your computer'}</span><br>` : ''}<button class="btn sm" data-act="open-pdf" data-v="${v.id}">${v.pdf ? 'Open' : 'Open / record'}</button></td>
      <td class="pre">${esc(v.notes) || '<span class="meta">—</span>'}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-act="open-anv" data-id="${v.id}">Open</button> <button class="btn sm" data-act="edit-anv" data-id="${v.id}">Edit</button></td></tr>`;
  }).join('');
  const draftN = S.versions.filter(v => !v.anvId).length, draftU = S.usages.filter(u => !u.anvId && u.type === 'note').length, next = (S.anv.length ? latestAnv().number : 0) + 1;
  return `<div class="pagehead"><div><h1>AN versions</h1><p>${esc(S.an.an_name)} · ${esc(S.an.collaboration)}. Each published version keeps its own plots, comments and documents.</p></div>
    <div class="actions"><button class="btn primary" data-act="publish">${S.anv.length ? `Publish AN v${next}` : 'Publish first version'}</button></div></div>
  <div class="card pad" style="margin-bottom:20px"><b>Working draft:</b> ${draftN} new plot version${draftN === 1 ? '' : 's'} and ${draftU} record${draftU === 1 ? '' : 's'} not yet in a published version. ${S.anv.length ? '' : 'Publishing creates AN v1 and unlocks reviewer comments.'}
    <button class="link" data-act="to-draft-dash">View working draft</button></div>
  ${S.anv.length ? `<div class="card" style="overflow:auto"><table class="vtable"><tr><th>Version</th><th>Published</th><th>Figures</th><th>Plot versions</th><th>Reviewer comments</th><th>Documents</th><th>AN PDF</th><th>Notes</th><th></th></tr>${rows}</table></div>`
    : '<div class="card empty">No AN version has been published yet. While the AN is being written, work happens in the working draft.</div>'}`;
}
function publishModal(editV) {
  const prev = latestAnv(), next = (prev ? prev.number : 0) + 1, dn = S.versions.filter(v => !v.anvId).length, du = S.usages.filter(u => !u.anvId).length;
  openModal({title: `Publish AN v${next}`, submit: `Publish v${next}`, wide: true,
    sub: `This creates a new AN version record. The ${dn} plot version${dn === 1 ? '' : 's'} and ${du} record${du === 1 ? '' : 's'} in your working draft become part of it. Earlier versions are not changed.`,
    body: `<div class="cols">${field('Version number', `<input type="text" name="number" value="${next}" inputmode="numeric">`)}${field('Publication date', `<input type="date" name="published_on" value="${today()}">`)}</div>`
      + field('Notes', '<textarea name="notes" placeholder="e.g. Addressed ARC comments; new systematics table."></textarea>', '', true) + pdfField()
      + (prev ? `<label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" name="carry" checked style="margin-top:4px"><span>Carry over Analysis Note figures from AN v${prev.number} that I haven't re-assigned <span class="meta">(each uses its plot's latest version; reviewer comments are not copied)</span></span></label>` : ''),
    onSubmit: async fd => {
      const n = parseInt(fd.get('number'), 10); if (!(n >= 1)) throw new Error('Version number must be a positive whole number');
      const r = await api('POST', aurl('/versions'), {number: n, published_on: fd.get('published_on') || today(), notes: fd.get('notes').trim(), carry_figures: !!fd.get('carry'), pdf: await pdfFingerprint(fd.get('pdf'))});
      await pdfAfter(fd, S.an.id, r.id); await loadAnalysis(S.an.id); setCtx(r.id); toast(`AN v${r.number} published${r.carried ? ` — ${r.carried} figure(s) carried over` : ''}`); go(L('')); render();
    }});
}
function editAnvModal(v) {
  openModal({title: `Edit AN v${v.number}`, body: field('Publication date', `<input type="date" name="published_on" value="${esc(v.published_on)}">`) + field('Notes', `<textarea name="notes">${esc(v.notes)}</textarea>`, '', true)
      + pdfField(v.pdf ? `Recorded: ${esc(v.pdf.name)} (${(v.pdf.size / 1048576).toFixed(1)} MB)${v.pdf.file_id ? ', stored in the repository' : ''}. Choose a file only to replace it.` : undefined),
    onSubmit: async fd => { const b = {published_on: fd.get('published_on'), notes: fd.get('notes')}; const p = await pdfFingerprint(fd.get('pdf')); if (p) b.pdf = p; await api('PATCH', aurl('/versions/' + v.id), b); await pdfAfter(fd, S.an.id, v.id); await reload(); }});
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
function editAnModal() {
  const a = S.an;
  openModal({title: 'Edit analysis', submit: 'Save',
    body: field('Analysis title', `<input type="text" name="title" required maxlength="150" value="${esc(a.title)}">`) + (isAN() ? anFields(a, true) : ''),
    onSubmit: async fd => {
      const b = {title: fd.get('title').trim(), stage: a.stage};
      if (b.stage === 'an_stage') Object.assign(b, {an_name: fd.get('an_name').trim(), collaboration: fd.get('collaboration').trim(), an_status: a.an_status || 'being_written'});
      await api('PATCH', aurl(''), b); await reload();
    }});
}
function moveToAnModal() {
  const a = S.an;
  openModal({title: 'Move to the AN stage', submit: 'Move to AN stage', wide: true,
    sub: 'Tell the tracker about your Analysis Note. If a version is already published, add it now; otherwise you can publish it later from “AN versions”.',
    body: anStageFields(), setup: f => bindAnStage(f, false),
    onSubmit: async fd => {
      await api('PATCH', aurl(''), {title: a.title, stage: 'an_stage', ...(await anStageBody(fd))});
      await loadAnalysis(S.an.id); if (isPub()) { setCtx(latestAnv().id); await pdfAfter(fd, S.an.id, latestAnv().id); await loadAnalysis(S.an.id); }
      toast('Moved to the AN stage'); go(L('')); render();
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
    else if (s[0] === 'meetings') h = viewMeetings();
    else if (s[0] === 'reviewer') h = viewReviewer();
    else if (s[0] === 'pending') h = viewPending();
    else if (s[0] === 'versions') h = viewVersions();
    else if (s[0] === 'docs') h = viewDocs();
    else if (s[0] === 'settings') h = viewSettings();
    else if (s[0] === 'pdf') h = PDF.viewPdf(s[1]);
    else h = notFound();
  }
  $('#main').innerHTML = h;
  hydrateImages();
  if (r[0] === 'a' && S && r[2] === 'pdf') PDF.mountPdf();
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

const meetingNames = () => [...new Set([...S.usages.filter(x => x.type !== 'note').map(meetingName), ...S.anc.filter(c => c.source === 'meeting').map(c => c.meeting)])];
function meetingFields(u = {}) {
  return `<datalist id="mnames">${meetingNames().map(n => `<option value="${esc(n)}">`).join('')}</datalist>`
    + field('Meeting name', `<input type="text" name="title" list="mnames" required maxlength="150" value="${esc(u.title || (u.type ? meetingName(u) : ''))}" placeholder="e.g. TMP, Top group meeting, Higgs weekly">`, 'Type the name of the meeting or group. Names you used before are suggested.')
    + `<div class="cols">${field('Date', `<input type="date" name="date" required value="${esc(u.date || today())}">`)}${field('Slide number', `<input type="text" name="slide" maxlength="40" value="${esc(u.slide || '')}" placeholder="e.g. 12">`, '', true)}</div>`
    + field('Link to the slides', `<input type="url" name="link" maxlength="500" value="${esc(u.link || '')}" placeholder="https://docs.google.com/presentation/…">`, '', true);
}
function useFields(type, u = {}) {
  if (type === 'note') {
    const figs = [...new Set(S.usages.filter(x => x.type === 'note').map(x => x.fig))];
    return `<datalist id="figs">${figs.map(f => `<option value="${esc(f)}">`).join('')}</datalist>`
      + field('Figure number in the Analysis Note', `<input type="text" name="fig" list="figs" required maxlength="40" value="${esc(u.fig || '')}" placeholder="e.g. 4.2">`, 'Type a number or pick one used before.')
      + field('Panel label', `<input type="text" name="panel" maxlength="60" value="${esc(u.panel || '')}" placeholder="e.g. UL2018">`, 'Only if this figure is made of several plots (for example one per era). Give each plot the same figure number and its own label.', true)
      + field('Analysis Note draft / version', `<input type="text" name="an_ver" maxlength="40" value="${esc(u.anVer || '')}" placeholder="e.g. v3">`, '', true);
  }
  return meetingFields(u);
}
function useModal(vid, type, u) {
  const v = ver(vid) || ver(u.versionId), p = plot(v.plotId), t = type || u.type, cx = ctx(), note = t === 'note';
  openModal({title: `${u ? 'Edit' : 'Add'} · ${note ? 'Analysis Note figure' : 'plot shown in a meeting'}`, wide: !note,
    sub: `${esc(p.name)} ${verLabel(v)}${note ? ` · recorded in ${u ? (u.anvId ? anvLabel(anv(u.anvId)) : 'the working draft') : (cx.draft ? 'the working draft' : cx.label)}` : ''}`, body: useFields(t, u || {}),
    onSubmit: async fd => {
      const d = note ? {fig: fd.get('fig').trim(), panel: fd.get('panel').trim(), an_ver: fd.get('an_ver').trim()} : {title: fd.get('title').trim(), link: fd.get('link').trim(), slide: fd.get('slide').trim(), date: fd.get('date')};
      await (u ? api('PATCH', aurl('/usages/' + u.id), d) : api('POST', aurl('/usages'), {plot_version_id: vid, type: t, an_version_id: note ? cx.id : null, ...d})); await reload();
    }});
}
/* a plot that was shown in a meeting, chosen from the plots list (instead of going through the plot page) */
function meetingPlotModal() {
  const plots = visPlots(); if (!plots.length) { toast('Add a plot first, then record that it was shown in a meeting.', 'err'); return; }
  openModal({title: 'Plot shown in a meeting', wide: true, submit: 'Add', sub: 'Choose the plot and version you showed, then describe the meeting. You can add the comments afterwards.',
    body: `<div class="cols">${field('Plot', `<select name="plot">${plots.map(p => `<option value="${p.id}">${esc(cat(p.catId)?.name || '')} — ${esc(p.name)}</option>`).join('')}</select>`)}${field('Version', '<select name="ver"></select>')}</div>` + meetingFields(),
    setup: f => {
      const fill = () => { f.ver.innerHTML = [...verOf(f.plot.value)].reverse().map(v => `<option value="${v.id}">${verLabel(v)} — ${esc(v.summary)}</option>`).join(''); };
      f.plot.addEventListener('change', fill); fill();
    },
    onSubmit: async fd => {
      const r = await api('POST', aurl('/usages'), {plot_version_id: fd.get('ver'), type: 'meeting', an_version_id: null, title: fd.get('title').trim(), link: fd.get('link').trim(), slide: fd.get('slide').trim(), date: fd.get('date')});
      await reload(); toast('Added. Use “+ Meeting comment” on the new card to record what was said.');
    }});
}

function reviewModal(u, r) {
  const t = u.type, has = r && !r.none, sibs = t === 'note' && !r ? sameFigUses(u) : [];
  openModal({title: r ? 'Edit feedback' : 'Add feedback', sub: esc(useTitle(u)), submit: 'Save',
    body: (sibs.length > 1 ? field('Which plot is it about?', `<select name="panel"><option value="figure">The whole figure (all panels)</option>${sibs.map(x => `<option value="${x.id}" ${x.id === u.id && false ? 'selected' : ''}>${esc(panelName(x))} — ${esc(plot(ver(x.versionId).plotId).name)} ${verLabel(ver(x.versionId))}</option>`).join('')}</select>`, 'Choose the era or panel the convener means. You can pick the plot to update when you resolve it.') : '')
      + `<div class="cols">${field(t === 'note' ? 'Kind of reviewer' : 'Who commented', `<select name="role">${CTX[t].roles.map(x => `<option ${r?.role === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}
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
      let target = u, id = r?.id;
      if (sibs.length > 1) { const pick = fd.get('panel'); if (pick === 'figure') { target = sibs[0]; body.scope = 'figure'; } else { target = sibs.find(x => x.id === pick); body.scope = 'panel'; } }
      if (r) await api('PATCH', aurl('/reviews/' + r.id), body); else id = (await api('POST', aurl(`/usages/${target.id}/reviews`), body)).id;
      await reload(); if (wantResolved) setTimeout(() => { const f = findReview(id); resolveModal(f.u, f.r); }, 50);
    }});
}
function whoCode(r) { return r.name ? slug(r.name.replace(/\./g, ''), 10) : r.role.split(/\s+/).map(w => /\d/.test(w) ? w : w[0].toUpperCase()).join(''); }
function resolveModal(u, r, add) {
  const figure = u.type === 'note', uses = figure ? sameFigUses(u) : [u], many = uses.length > 1, idx = u.reviews.filter(x => !x.none).indexOf(r) + 1;
  const ctxPart = figure ? 'AN-Fig' + slug(u.fig, 8) : slug(meetingName(u), 10) + (u.slide ? '-s' + slug(u.slide, 6) : '');
  const baseFor = use => { const v = ver(use.versionId), p = plot(v.plotId); return {v, p, base: `${slug(p.name, 24)}_v${v.num}_${ctxPart}_${whoCode(r)}-c${idx || 1}`, nextRev: Math.max(0, ...S.versions.filter(x => x.plotId === p.id && x.num === v.num).map(x => x.rev)) + 1}; };
  const first = r.scope === 'panel' || !many ? uses.find(x => x.id === r.usage_id) || uses[0] : null, b0 = baseFor(first || uses[0]);
  openModal({title: add ? 'Updated plot for another panel' : 'Mark as resolved', wide: true, submit: add ? 'Save updated plot' : 'Resolve', sub: `<b>${esc(whoStr(r))}</b>: “${esc(r.text)}”`,
    body: (add ? '' : radios('mode', [['plot', 'Upload the updated plot'], ['noplot', 'Resolved without changing the plot']], 'plot'))
      + `<div id="rp" style="display:grid;gap:14px">${many ? field('Which plot did you update?', `<select name="use" required><option value="">— choose the era / panel —</option>${uses.map(x => `<option value="${x.id}" ${first && x.id === first.id ? 'selected' : ''}>${esc(panelName(x))} — ${esc(plot(ver(x.versionId).plotId).name)} ${verLabel(ver(x.versionId))}</option>`).join('')}</select>`, r.scope === 'figure' ? 'This comment is about the whole figure, so pick the panel you are fixing. Use “Updated plot for another panel” afterwards to fix more.' : '') : ''}
        ${field('Updated plot', fileField(false))}
        ${field('What did you change to address it?', '<textarea name="changes" maxlength="3000" placeholder="e.g. Switched y-axis to log scale and extended range to 10⁶."></textarea>')}
        ${field('Saved as', `<input type="text" name="fname" maxlength="140" value="${esc(b0.base)}_" class="mono">`, `<span id="fhint">Stored as <b>${verLabel({num: b0.v.num, rev: b0.nextRev})}</b>, linked to ${verLabel(b0.v)}, in the working draft.</span> Finish the name with a few words describing the change, e.g. <span class="mono">log-y-axis</span>.`)}</div>
      <div id="rn" hidden>${field('How was it resolved?', '<textarea name="note" maxlength="3000" placeholder="e.g. Explained in reply; reviewer accepted the current binning."></textarea>')}</div>`,
    setup: f => {
      const upd = () => { const pl = add || f.mode.value === 'plot'; $('#rp', f).hidden = !pl; $('#rn', f).hidden = pl; f.file.required = pl; f.changes.required = pl; f.note.required = !pl; if (f.use) f.use.required = pl; };
      if (!add) f.querySelectorAll('[name=mode]').forEach(x => x.addEventListener('change', upd)); upd();
      if (f.use) f.use.addEventListener('change', () => { const use = uses.find(x => x.id === f.use.value); if (!use) return; const b = baseFor(use); f.fname.value = b.base + '_'; $('#fhint', f).innerHTML = `Stored as <b>${verLabel({num: b.v.num, rev: b.nextRev})}</b>, linked to ${verLabel(b.v)}, in the working draft.`; });
    },
    onSubmit: async fd => {
      if (add || fd.get('mode') === 'plot') {
        const file = fd.get('file'); if (!file || !file.size) throw new Error('Please choose the updated plot');
        const up = await upload(file);
        await api('POST', aurl(`/reviews/${r.id}/resolve`), {mode: 'plot', add: !!add, usage_id: fd.get('use') || undefined, file_id: up.file_id, changes: fd.get('changes').trim(), file_name: fd.get('fname').trim().replace(/[-_.]+$/, '')});
        toast('Updated plot saved in the working draft');
      } else { await api('POST', aurl(`/reviews/${r.id}/resolve`), {mode: 'noplot', note: fd.get('note').trim()}); toast('Marked as resolved'); }
      await reload();
    }});
}

/* ---- add an AN figure that is made of several plots (e.g. one per era) in one go ---- */
function figureBuilderModal() {
  const cx = ctx(), plots = visPlots(); if (!plots.length) { toast('Add the plots first (+ New plot).', 'err'); return; }
  const opts = `<option value="">— none —</option>${plots.map(p => `<option value="${p.id}">${esc(cat(p.catId)?.name || '')} — ${esc(p.name)} (${verLabel(latest(p.id))})</option>`).join('')}`;
  const row = i => `<div class="cols fbrow"><div class="f"><select name="p${i}" data-i="${i}">${opts}</select></div><div class="f"><input type="text" name="l${i}" maxlength="60" placeholder="Panel label, e.g. UL2018"></div></div>`;
  openModal({title: 'Add a figure made of several plots', wide: true, submit: 'Add figure',
    sub: 'For example Figure 3 with one plot per era. Pick each plot and label its panel. Comments can then point at one era, and the fix goes straight to that plot.',
    body: field('Figure number in the Analysis Note', '<input type="text" name="fig" required maxlength="40" placeholder="e.g. 3">') + `<div class="l" style="font-weight:600;font-size:13px">Plots in this figure <span class="meta">(leave unused rows as “none”)</span></div><div id="fbrows">${[0, 1, 2, 3].map(row).join('')}</div><button type="button" class="btn sm" id="fbadd">+ Another plot</button>`,
    setup: f => {
      let n = 4;
      f.addEventListener('change', e => { const s = e.target; if (s.matches('select[data-i]')) { const l = f['l' + s.dataset.i]; const p = plot(s.value); if (p && !l.value) l.value = eraLabelOf(p.name); } });
      $('#fbadd', f).onclick = () => { $('#fbrows', f).insertAdjacentHTML('beforeend', row(n++)); };
    },
    onSubmit: async (fd, f) => {
      const rows = []; for (let i = 0; fd.has('p' + i); i++) if (fd.get('p' + i)) rows.push({pid: fd.get('p' + i), label: fd.get('l' + i).trim()});
      if (!rows.length) throw new Error('Choose at least one plot.');
      if (rows.length > 1 && rows.some(r => !r.label)) throw new Error('Give every plot a panel label (for example its era).');
      const fig = fd.get('fig').trim();
      await batch(async () => { for (const r of rows) await api('POST', aurl('/usages'), {plot_version_id: latest(r.pid).id, type: 'note', an_version_id: cx.id, fig, panel: r.label, an_ver: ''}); });
      await reload(); toast(`Figure ${fig} added with ${rows.length} plot${rows.length === 1 ? '' : 's'}.`);
    }});
}

/* ---- comments on the AN text (not tied to a plot) ---- */
function ancModal(c, source) {
  const cx = ctx(), src = c ? c.source : (source || 'an'), meet = src === 'meeting';
  openModal({title: c ? 'Edit comment' : meet ? 'Add a methodology comment from a meeting' : 'Add comment on the AN', sub: meet ? 'A suggestion or question that is not about one specific plot.' : `Recorded under ${cx.label}`, wide: true, submit: 'Save',
    body: (meet ? `<datalist id="mnames">${meetingNames().map(n => `<option value="${esc(n)}">`).join('')}</datalist><div class="cols">${field('Meeting name', `<input type="text" name="meeting" list="mnames" required maxlength="100" value="${esc(c?.meeting || '')}" placeholder="e.g. TMP, Top group meeting">`)}${field('Meeting date', `<input type="date" name="meeting_date" value="${esc(c?.meeting_date || today())}">`)}</div>` : '')
      + `<div class="cols">${field(meet ? 'Who commented' : 'Kind of reviewer', `<select name="role">${CTX[meet ? 'meeting' : 'note'].roles.map(x => `<option ${c?.role === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}${field('Name', `<input type="text" name="name" maxlength="100" value="${esc(c?.name || '')}">`, '', true)}</div>`
      + `<div class="cols">${field('Kind', `<select name="kind">${Object.entries(COMMENT_KINDS).map(([k, l]) => `<option value="${k}" ${(c?.kind || (meet ? 'general' : 'text')) === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}${field(meet ? 'Where (slide, topic)' : 'Where in the AN?', `<input type="text" name="location" maxlength="80" value="${esc(c?.location || '')}" placeholder="${meet ? 'e.g. slide 8, trigger' : 'e.g. Sec 3.1, Tab 10, L390, General'}">`, '', true)}</div>`
      + field('Comment', `<textarea name="text" required maxlength="5000" style="min-height:120px">${esc(c?.text || '')}</textarea>`),
    onSubmit: async fd => {
      const b = {role: fd.get('role'), name: fd.get('name').trim(), kind: fd.get('kind'), location: fd.get('location').trim(), text: fd.get('text').trim()};
      if (meet) { b.meeting = fd.get('meeting').trim(); b.meeting_date = fd.get('meeting_date') || ''; }
      await (c ? api('PATCH', aurl('/an-comments/' + c.id), b) : api('POST', aurl('/an-comments'), {source: src, an_version_id: meet ? null : cx.id, ...b})); await reload();
    }});
}
function resolveAncModal(c) {
  const later = c.anvId ? S.anv.filter(v => v.number > anv(c.anvId).number) : [];
  openModal({title: 'Mark as resolved', wide: true, sub: `<b>${esc(whoStr(c))}</b>${c.location ? ' · ' + esc(c.location) : ''}: “${esc(c.text.length > 220 ? c.text.slice(0, 220) + '…' : c.text)}”`, submit: 'Resolve',
    body: field('What did you change? (optional if your answer says it all)', '<textarea name="note" maxlength="3000" placeholder="e.g. Added a paragraph in Sec 1.1 explaining the choice of y0."></textarea>', 'Your reply to the commenter goes in the “Your answer” box on the comment.')
      + field('Fixed in', `<select name="in"><option value="">Not in a published version yet</option>${S.anv.map(v => `<option value="${v.id}" ${later[0] && later[0].id === v.id ? 'selected' : ''}>${anvLabel(v)}</option>`).join('')}</select>`, 'Which published AN version contains the fix, if any.', true),
    onSubmit: async fd => { await api('POST', aurl(`/an-comments/${c.id}/resolve`), {note: fd.get('note').trim() || (c.answer || 'Resolved').slice(0, 3000), resolved_in: fd.get('in') || null}); await reload(); }});
}

/* ---- a point-by-point reply built from your answers, to paste into an email ---- */
function replyModal() {
  const c = ctx(); if (c.draft) return;
  const figs = cNotes().sort((a, b) => a.fig.localeCompare(b.fig, undefined, {numeric: true}));
  const q = (label, who, text, ans, extra) => `${label}${who ? ' (' + who + ')' : ''}:\n${text}\n→ ${ans && ans.trim() ? ans.trim() : '[no answer written yet]'}${extra ? '\n  (' + extra + ')' : ''}`;
  const parts = [];
  S.anc.filter(x => x.source === 'an' && x.anvId === c.id).forEach(x => parts.push(q((x.location || COMMENT_KINDS[x.kind] || 'Comment'), x.name, x.text, x.answer, x.status === 'resolved' && x.resolvedIn && anv(x.resolvedIn) ? 'addressed in ' + anvLabel(anv(x.resolvedIn)) : '')));
  figs.forEach(u => u.reviews.filter(r => !r.none).forEach(r => { const vs = [r.resolvedVersionId, ...(r.resolvedMore || [])].map(id => id && ver(id)).filter(Boolean); parts.push(q('Fig ' + u.fig + (r.scope === 'figure' ? '' : u.panel ? ' (' + u.panel + ')' : ''), r.name, r.text, r.answer, vs.length ? 'updated plot' + (vs.length > 1 ? 's' : '') + ': ' + vs.map(v => v.fileName).join(', ') : '')); }));
  const text = `Reply to the comments on ${S.an.an_name || S.an.title} ${anvLabel(c.v)}\n\n` + parts.map((t, i) => `${i + 1}. ${t}`).join('\n\n');
  openModal({title: 'Reply document', xl: true, submit: 'Copy to clipboard', sub: `${parts.length} comment${parts.length === 1 ? '' : 's'} with your answers. Edit freely, then copy it into your email.`,
    body: `<textarea id="replytxt" style="width:100%;min-height:380px;font:13.5px/1.5 ui-monospace,monospace;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg)">${esc(text)}</textarea>`,
    onSubmit: async () => { try { await navigator.clipboard.writeText($('#replytxt').value); toast('Copied'); } catch { $('#replytxt').select(); toast('Press Ctrl+C to copy', '', 4000); return false; } }});
}

/* ---- import comments from a pasted e-mail ---- */
function importModal(mode) {
  const cx = ctx(), isNote = mode === 'note';
  if (isNote && cx.draft) { toast('Select a published AN version in the “Viewing” menu first: AN comments belong to a version.', 'err', 6000); return; }
  const key = u => parseFloat(isNote ? u.fig : u.slide) || 0;
  // figures: those of the version being viewed. meetings: every plot record of any meeting, newest first
  const targets = isNote ? cNotes().sort((a, b) => key(a) - key(b)) : meetingUses().sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created - a.created);
  const roles = CTX[isNote ? 'note' : 'meeting'].roles;
  const figGrp = fig => targets.filter(x => x.fig === fig);
  const tgtLabel = u => { const v = ver(u.versionId); return isNote ? `Fig ${u.fig}${u.panel ? ' · ' + u.panel : ''} — ${plot(v.plotId).name} ${verLabel(v)}`
    : `slide ${u.slide || '?'} · ${meetingName(u)} ${fmtDay(u.date)} — ${plot(v.plotId).name} ${verLabel(v)}`; };
  const normFig = s => String(s).toLowerCase().replace(/^fig(ure)?\.?\s*/, '').trim();
  const guess = it => {
    if (isNote) {
      if (it.figs.length === 1) {
        const g = targets.filter(x => normFig(x.fig) === it.figs[0]);
        if (g.length === 1) return g[0].id;
        if (g.length > 1) { const hit = g.filter(x => panelMatches(x.panel, it.raw)); return hit.length === 1 ? hit[0].id : g[0].id + '|figure'; }   // the era named in the comment picks the panel
      }
      return 'an';
    }
    if (it.slides.length === 1) {
      const mn = ($('#imeet')?.value || '').trim().toLowerCase(), hit = targets.filter(x => String(x.slide).trim() === it.slides[0]);
      const u = hit.find(x => mn && meetingName(x).toLowerCase() === mn) || hit[0]; if (u) return u.id;
    }
    return 'text';
  };
  let rows = [], ignored = [];
  const opt = (v, l, cur) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
  const tgtOpts = cur => opt(isNote ? 'an' : 'text', isNote ? 'Text / table / methodology (not a plot)' : 'Methodology / general (not a plot)', cur)
    + (isNote ? figGroups(targets).map(g => (g.length > 1 ? opt(g[0].id + '|figure', `Fig ${g[0].fig} — whole figure (${g.length} panels)`, cur) : '') + g.map(u => opt(u.id, tgtLabel(u), cur)).join('')).join('') : targets.map(u => opt(u.id, tgtLabel(u), cur)).join(''));
  openModal({title: isNote ? `Import comments from the convenors · ${cx.label}` : 'Import comments from a meeting', xl: true, submit: 'Import ticked comments',
    sub: 'Paste the whole email. The text is split into separate comments here in your browser; nothing is saved until you click Import.',
    body: (isNote ? '' : `<datalist id="mnames">${meetingNames().map(n => `<option value="${esc(n)}">`).join('')}</datalist><div class="cols">${field('Meeting name', '<input type="text" name="meeting" id="imeet" list="mnames" required maxlength="100" placeholder="e.g. TMP, Top group meeting">')}${field('Meeting date', `<input type="date" name="meeting_date" value="${today()}">`)}</div>`)
      + `<div class="cols">${field(isNote ? 'Kind of reviewer' : 'Who commented', `<select name="role">${roles.map(x => `<option>${x}</option>`).join('')}</select>`)}${field('Name', '<input type="text" name="name" id="iname" maxlength="100" placeholder="filled from the email when possible">', '', true)}</div>`
      + field('Email text', '<textarea name="email" id="iemail" rows="7" placeholder="Paste the email here (Ctrl+V), then click “Read comments”."></textarea>')
      + '<div><button type="button" class="btn" id="iparse">Read comments</button></div><div id="iprev"></div>',
    setup: f => {
      const sync = () => f.querySelectorAll('.irow').forEach(el => { const i = +el.dataset.i, r = rows[i]; if (!r) return; r.include = $('.ichk', el).checked; r.location = $('.iloc', el).value; r.target = $('.itgt', el).value; r.text = $('.itxt', el).value; });
      f._sync = sync;
      const draw = () => {
        const nOn = rows.filter(r => r.include).length, nFig = rows.filter(r => r.target !== 'an' && r.target !== 'text').length;
        $('#iprev', f).innerHTML = rows.length || ignored.length ? `<div class="isum"><b>${rows.length}</b> comment${rows.length === 1 ? '' : 's'} found · <b>${nOn}</b> ticked · <b>${nFig}</b> matched to a ${isNote ? 'figure' : 'slide'}
          <span style="margin-left:auto"><button type="button" class="link" data-all="1">Tick all</button> · <button type="button" class="link" data-all="0">Untick all</button></span></div>
        ${rows.map((r, i) => `<div class="irow ${r.include ? '' : 'off'}" data-i="${i}"><input type="checkbox" class="ichk" ${r.include ? 'checked' : ''} aria-label="Import this comment"><div class="ibody"><div class="irow1"><input class="iloc" value="${esc(r.location)}" placeholder="Location, e.g. Sec 3.1" maxlength="80"><select class="itgt">${tgtOpts(r.target)}</select>${r.note ? `<span class="badge">${esc(r.note)}</span>` : ''}</div><textarea class="itxt" rows="3" maxlength="5000">${esc(r.text)}</textarea></div></div>`).join('')}
        ${ignored.length ? `<details class="ign"><summary>${ignored.length} ignored part${ignored.length === 1 ? '' : 's'} (greetings, cover note, sign-off)</summary>${ignored.map((g, i) => `<div class="ign1"><span class="meta">${esc(g.reason)}</span><div>${esc(g.text.length > 300 ? g.text.slice(0, 300) + '…' : g.text)}</div><button type="button" class="btn sm" data-ign="${i}">Add as comment</button></div>`).join('')}</details>` : ''}` : '<div class="empty">No comments found. Check the pasted text.</div>';
      };
      const parse = () => {
        const r = parseEmail($('#iemail', f).value);
        rows = r.items.map(it => ({...it, target: guess(it), include: it.include})); ignored = r.ignored;
        if (r.from && !$('#iname', f).value) $('#iname', f).value = r.from;
        draw();
      };
      $('#iparse', f).onclick = parse;
      $('#iemail', f).addEventListener('paste', () => setTimeout(parse, 50));
      f.addEventListener('change', e => { const row = e.target.closest('.irow'); if (row) { sync(); row.classList.toggle('off', !rows[+row.dataset.i].include); } });
      f.addEventListener('click', e => {
        const all = e.target.closest('[data-all]'), ign = e.target.closest('[data-ign]');
        if (all) { sync(); rows.forEach(r => { r.include = all.dataset.all === '1'; }); draw(); }
        if (ign) { sync(); const g = ignored.splice(+ign.dataset.ign, 1)[0], it = {text: g.text, location: '', raw: g.text, figs: [], slides: [], note: ''}; rows.push({...it, target: guess(it), include: true}); draw(); }
      });
      f._rows = () => rows;
    },
    onSubmit: async (fd, f) => {
      f._sync(); const picked = f._rows().filter(r => r.include);
      if (!picked.length) throw new Error('Paste the email, click “Read comments”, and tick the comments you want to import.');
      if (picked.some(r => !r.text.trim())) throw new Error('A ticked comment has no text. Fill it in or untick it.');
      const items = picked.map(r => ({text: r.text.trim(), location: r.location.trim(), target: r.target, kind: kindOfLoc(r.location)}));
      const b = {mode: isNote ? 'an' : 'meeting', an_version_id: isNote ? cx.id : null, role: fd.get('role'), name: fd.get('name').trim(), items};
      if (!isNote) { b.meeting = fd.get('meeting').trim(); b.meeting_date = fd.get('meeting_date') || ''; }
      const res = await api('POST', aurl('/import-comments'), b);
      await reload(); toast(`Imported ${items.length} comment${items.length === 1 ? '' : 's'} (${res.an} not about a plot, ${res.reviews} on plots)`, '', 5000);
    }});
}

/* ============================ actions ============================ */
const A = {
  menu: () => $('#side').classList.toggle('open'),
  theme: () => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); const n = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = n; lsSet('at_theme', n); },
  logout: () => confirmBox('Disconnect', `Remove <b>${esc(GHS.repo)}</b> from this device? Your data stays safe in GitHub; you can reconnect any time with a token. Saved copies of AN PDFs on this device are deleted too.`, 'Disconnect', async () => {
    try { await PDF.clearAll(); } catch {} ghForget(); await afterRepoChange(); }),
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
  'import-email': el => importModal(el.dataset.type),
  'open-pdf': el => PDF.open(el), pdf: el => PDF.act(el),
  'to-review': el => { setCtx(el.dataset.id); go(L('/reviewer')); render(); },
  'to-an': () => moveToAnModal(),
  'presented-yes': async () => { await api('POST', aurl('/presented'), {value: true}); await reload(); go(L('/meetings')); },
  'comments-yes': () => commentsChooser(),
  'comments-no': () => { (ui.hideAsk = ui.hideAsk || {})[S.an.id] = true; render(); },
  'add-mplot': () => meetingPlotModal(),
  'add-mcomment': () => ancModal(null, 'meeting'),
  mfilter: el => { ui.mf = el.dataset.id; render(); }, kfilter: el => { ui.rk = el.dataset.id; render(); },
  'add-anc': () => ancModal(), 'reply-doc': () => replyModal(), 'edit-anc': el => ancModal(S.anc.find(c => c.id === el.dataset.id)),
  'resolve-anc': el => resolveAncModal(S.anc.find(c => c.id === el.dataset.id)),
  'reopen-anc': async el => { await api('POST', aurl(`/an-comments/${el.dataset.id}/reopen`)); await reload(); },
  'del-anc': el => confirmBox('Delete comment', 'Delete this comment?', 'Delete', async () => { await api('DELETE', aurl('/an-comments/' + el.dataset.id)); await reload(); }),
  'add-rv': el => reviewModal(S.usages.find(u => u.id === el.dataset.id)),
  'edit-rv': el => { const f = findReview(el.dataset.id); reviewModal(f.u, f.r); },
  'del-rv': el => confirmBox('Delete feedback', 'Delete this feedback entry?', 'Delete', async () => { await api('DELETE', aurl('/reviews/' + el.dataset.id)); await reload(); }),
  resolve: el => { const f = findReview(el.dataset.id); resolveModal(f.u, f.r); },
  'more-plot': el => { const f = findReview(el.dataset.id); resolveModal(f.u, f.r, true); },
  'add-figure': () => figureBuilderModal(),
  reopen: async el => { const f = findReview(el.dataset.id); try { await api('PATCH', aurl('/reviews/' + f.r.id), {role: f.r.role, name: f.r.name, none: false, text: f.r.text, status: 'pending'}); await reload(); } catch (e) { toast(e.message, 'err'); } },
  'new-doc': () => docModal(), 'edit-doc': el => docModal(S.docs.find(d => d.id === el.dataset.id)),
  'del-doc': el => confirmBox('Delete document', 'Delete this document record?', 'Delete', async () => { await api('DELETE', aurl('/documents/' + el.dataset.id)); await reload(); }),
  'edit-an': () => editAnModal(),
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
document.addEventListener('change', async e => {     // "Your answer" boxes save themselves when you click away
  const t = e.target; if (!t.matches || !t.matches('textarea.ans')) return;
  const kind = t.dataset.kind, id = t.dataset.id, val = t.value.trim(), saved = t.parentElement.querySelector('.saved');
  try {
    await api('POST', aurl(`/${kind === 'anc' ? 'an-comments' : 'reviews'}/${id}/answer`), {answer: val});
    const item = kind === 'anc' ? S.anc.find(c => c.id === id) : findReview(id)?.r; if (item) { item.answer = val; }
    const badge = t.closest('.rv')?.querySelector('.ra .badge');
    if (badge && item && item.status !== 'resolved') { const [cls, label] = stateOf(item.status, val); badge.className = 'badge ' + cls; badge.textContent = label; }
    saved.textContent = 'Saved ✓'; setTimeout(() => { saved.textContent = ''; }, 2000);
  } catch (err) { saved.textContent = ''; toast(err.message, 'err'); }
});
document.addEventListener('click', e => { const s = $('#side'); if (s && s.classList.contains('open') && !e.target.closest('#side') && !e.target.closest('[data-act=menu]')) s.classList.remove('open'); });
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
let demoRunning = false;
async function createDemo() {
  if (demoRunning) return; demoRunning = true;
  const hide = busy('Creating the demo analysis… this can take up to a minute on GitHub. Please wait.');
  try { await createDemoInner(); }
  catch (e) { console.error(e); toast('Demo could not be created: ' + e.message, 'err', 20000); }
  finally { hide(); demoRunning = false; }
}
async function createDemoInner() {
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
  const uTmp = await use(p1v3, 'meeting', slides('12', 20, 'TMP'));
  const cm1 = (await rv(uTmp, {role: 'Convener', name: 'L. Rossi', text: 'Bins are too fine above 100 GeV — statistical fluctuations dominate.'})).id;
  await api('POST', ap(`/reviews/${cm1}/answer`), {answer: 'Will merge the bins above 100 GeV in the next version.'});
  const uGm = await use(p2v2, 'meeting', slides('3', 9, 'Top group meeting'));
  await rv(uGm, {role: 'Meeting member', name: 'S. Park', text: 'Which ID working point is this?'});
  await api('POST', ap('/an-comments'), {source: 'meeting', meeting: 'TMP', meeting_date: slides('12', 20, 'TMP').date, role: 'Convener', name: 'L. Rossi', kind: 'general', location: 'strategy', text: 'Consider also a measurement as a function of the top-pair mass, not only inclusive.'});
  await use(p3.version_id, 'meeting', slides('8', 5, 'Top group meeting'));
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
  await api('POST', ap('/an-comments'), {source: 'an', an_version_id: st.an_versions[1].id, role: 'Convener', name: 'L. Jeppe', kind: 'table', location: 'Tab 10', text: 'Are the labels in the “region type” column correct? Please double-check the region definitions.'});
  const an2 = (await api('POST', ap('/an-comments'), {source: 'an', an_version_id: st.an_versions[1].id, role: 'Convener', name: 'L. Jeppe', kind: 'text', location: 'Sec 1.1', text: 'Explain a bit more the reasoning behind the definition of A_in and A_out.'})).id;
  await api('POST', ap(`/an-comments/${an2}/answer`), {answer: 'Agreed. We will add a short paragraph with the motivation and how y0 is chosen.'});
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
