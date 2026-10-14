/* Analysis-Tracker storage layer for GitHub.
 *
 * There is no server. Data lives in a (private) GitHub repository:
 *     analyses/<id>/state.json            all records of one analysis
 *     analyses/<id>/files/<fileid>.<ext>  plot images
 * Every save is one atomic git commit made through the GitHub API with the user's own token, so GitHub's
 * repository permissions decide who can read/write. The app calls api(method, path, body) exactly like the
 * previous server version; this file implements those routes (rules included) on top of git.
 */
'use strict';
(function () {

const CFG = Object.assign({apiBase: 'https://api.github.com', repo: ''}, window.AT_CONFIG || {});
class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const E = (s, m) => new ApiError(s, m);

const GHS = {token: null, repo: null, branch: null, user: null, head: null};
const ME = () => GHS.user;
const STATE_CACHE = new Map();          // analysis id -> {head, st}
const TREE_CACHE = new Map();           // commit sha -> tree sha
const PENDING = new Map();              // file id -> {blob, ext, aid}: uploaded, not yet committed
const IMG_CACHE = {};                   // file id -> object URL

/* ============================ small helpers ============================ */
const nid = () => { const a = new Uint8Array(8); crypto.getRandomValues(a); return [...a].map(x => x.toString(16).padStart(2, '0')).join(''); };
const now = () => Date.now();
const todayStr = () => new Date().toISOString().slice(0, 10);
const MIME = {'.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml'};
function sv(b, k, max = 500, req = false, def = '') {
  let v = b[k]; if (v === undefined || v === null) v = def;
  if (typeof v !== 'string') throw E(400, `"${k}" must be text`);
  v = v.trim();
  if (req && !v) throw E(400, `"${k}" is required`);
  if (v.length > max) throw E(400, `"${k}" is too long (max ${max})`);
  return v;
}
const urlOk = (u, k = 'url') => { if (u && !/^https?:\/\//i.test(u)) throw E(400, `"${k}" must start with http:// or https://`); return u; };
const dateOk = (d, k = 'date') => { if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw E(400, `"${k}" must be YYYY-MM-DD`); return d; };
const byId = (arr, id, what) => { const r = arr.find(x => x.id === id); if (!r) throw E(404, what + ' not found'); return r; };
async function pmap(items, fn, n = 6) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({length: Math.min(n, items.length)}, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
const utf8b64 = s => { const b = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(bin); };
const blobB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });

/* ============================ GitHub client ============================ */
async function ghFetch(path, o = {}) {
  const h = {Authorization: 'Bearer ' + GHS.token, Accept: o.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json'};
  if (o.body) h['Content-Type'] = 'application/json';
  let r;
  try { r = await fetch(CFG.apiBase + path, {method: o.method || 'GET', headers: h, body: o.body ? JSON.stringify(o.body) : undefined, cache: 'no-store'}); }
  catch { throw E(0, 'Cannot reach GitHub. Check your internet connection.'); }
  if (r.ok || (o.allow || []).includes(r.status)) return r;
  let msg = ''; try { msg = (await r.json()).message || ''; } catch {}
  if (r.status === 401) throw E(401, 'Your GitHub token is invalid or has expired. Please reconnect.');
  if ((r.status === 403 || r.status === 429) && r.headers.get('x-ratelimit-remaining') === '0') throw E(429, 'GitHub rate limit reached. Please wait a few minutes and try again.');
  if (r.status === 403) throw E(403, 'GitHub refused the request. The token needs "Contents: Read and write" access to the data repository.');
  throw E(r.status, msg || 'GitHub error ' + r.status);
}
const repoPath = () => '/repos/' + GHS.repo;
const encPath = p => p.split('/').map(encodeURIComponent).join('/');

async function getHead() {
  const r = await ghFetch(`${repoPath()}/git/ref/heads/${GHS.branch}`, {allow: [404, 409]});
  if (r.status === 404 || r.status === 409) throw E(400, 'The data repository is empty. Create it with "Add a README file" so it has a first commit.');
  GHS.head = (await r.json()).object.sha; return GHS.head;
}
async function treeOf(commit) {
  if (!TREE_CACHE.has(commit)) TREE_CACHE.set(commit, (await (await ghFetch(`${repoPath()}/git/commits/${commit}`)).json()).tree.sha);
  return TREE_CACHE.get(commit);
}
async function readText(path, head) {
  const r = await ghFetch(`${repoPath()}/contents/${encPath(path)}?ref=${head}`, {raw: true, allow: [404]});
  return r.status === 404 ? null : r.text();
}
async function listDir(path, head) {
  const r = await ghFetch(`${repoPath()}/contents/${encPath(path)}?ref=${head}`, {allow: [404]});
  return r.status === 404 ? [] : r.json();
}
const statePath = aid => `analyses/${aid}/state.json`;
const filePath = (aid, f) => `analyses/${aid}/files/${f.id}${f.ext}`;

async function getState(aid, head) {
  const c = STATE_CACHE.get(aid); if (c && c.head === head) return c.st;
  const t = await readText(statePath(aid), head); if (t === null) return null;
  const st = JSON.parse(t); STATE_CACHE.set(aid, {head, st}); return st;
}
const newState = () => ({format: 2, analysis: null, an_versions: [], categories: [], plots: [], plot_versions: [], usages: [], documents: [], files: []});

/* One atomic commit: blobs -> tree -> commit -> fast-forward the branch. Throws {conflict:true} if someone pushed meanwhile. */
async function commit(head, changes, message) {
  const tree = [];
  await pmap(changes, async c => {
    if (c.del) { tree.push({path: c.path, mode: '100644', type: 'blob', sha: null}); return; }
    const content = c.blob ? await blobB64(c.blob) : utf8b64(c.text);
    const b = await (await ghFetch(`${repoPath()}/git/blobs`, {method: 'POST', body: {content, encoding: 'base64'}})).json();
    tree.push({path: c.path, mode: '100644', type: 'blob', sha: b.sha});
  }, 4);
  const t = await (await ghFetch(`${repoPath()}/git/trees`, {method: 'POST', body: {base_tree: await treeOf(head), tree}})).json();
  const cm = await (await ghFetch(`${repoPath()}/git/commits`, {method: 'POST', body: {message, tree: t.sha, parents: [head]}})).json();
  const r = await ghFetch(`${repoPath()}/git/refs/heads/${GHS.branch}`, {method: 'PATCH', body: {sha: cm.sha, force: false}, allow: [409, 422]});
  if (r.status === 409 || r.status === 422) { const e = E(409, 'conflict'); e.conflict = true; throw e; }
  TREE_CACHE.set(cm.sha, t.sha); GHS.head = cm.sha; return cm.sha;
}
const changesFor = (aid, st, io) => [
  {path: statePath(aid), text: JSON.stringify(st, null, 1)},
  ...io.newFiles.map(fid => { const p = PENDING.get(fid); return {path: filePath(aid, {id: fid, ext: p.ext}), blob: p.blob}; }),
  ...io.delFiles.map(path => ({path, del: true})),
];

/* ---- transactions: load latest -> apply rule function -> commit; on conflict reload and re-apply ---- */
let BATCH = null;   // when set, writes are collected and committed once (used for the demo analysis)
async function tx(aid, mutator, {create = false, message = 'Update'} = {}) {
  const msg = `${ME().name}: ${message}`;
  if (BATCH) {
    let b = BATCH.get(aid);
    if (!b) {
      const base = create ? null : await getState(aid, await getHead());
      if (!base && !create) throw E(404, 'Analysis not found');
      b = {st: base ? structuredClone(base) : newState(), io: {newFiles: [], delFiles: []}, msg}; BATCH.set(aid, b);
    }
    return mutator(b.st, b.io);
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const head = await getHead(), base = await getState(aid, head);
    if (!base && !create) throw E(404, 'Analysis not found');
    const st = base ? structuredClone(base) : newState(), io = {newFiles: [], delFiles: []};
    const result = await mutator(st, io);
    try { const nh = await commit(head, changesFor(aid, st, io), msg); STATE_CACHE.set(aid, {head: nh, st}); io.newFiles.forEach(f => PENDING.delete(f)); return result; }
    catch (e) { if (e.conflict) continue; throw e; }
  }
  throw E(409, 'Someone else changed this analysis at the same moment. Please try again.');
}
async function batch(fn) {
  BATCH = new Map();
  try {
    await fn(); const jobs = [...BATCH.entries()]; BATCH = null;
    for (const [aid, b] of jobs) {
      for (let i = 0; i < 6; i++) {
        const head = await getHead();
        try { const nh = await commit(head, changesFor(aid, b.st, b.io), b.msg); STATE_CACHE.set(aid, {head: nh, st: b.st}); b.io.newFiles.forEach(f => PENDING.delete(f)); break; }
        catch (e) { if (!e.conflict || i === 5) throw e; }
      }
    }
  } finally { BATCH = null; }
}
async function readState(aid) {
  if (BATCH && BATCH.has(aid)) return BATCH.get(aid).st;
  const st = await getState(aid, await getHead()); if (!st) throw E(404, 'Analysis not found'); return st;
}

/* ============================ images ============================ */
const imgCached = fid => IMG_CACHE[fid] || null;
const inflight = new Map(); let imgSlots = 0; const imgWait = [];
async function fetchImage(aid, fid, ext) {
  if (IMG_CACHE[fid]) return IMG_CACHE[fid];
  if (inflight.has(fid)) return inflight.get(fid);
  const p = (async () => {
    while (imgSlots >= 6) await new Promise(r => imgWait.push(r));
    imgSlots++;
    try {
      const head = STATE_CACHE.get(aid)?.head || GHS.head || await getHead();
      const r = await ghFetch(`${repoPath()}/contents/${encPath(filePath(aid, {id: fid, ext}))}?ref=${head}`, {raw: true});
      const url = URL.createObjectURL(new Blob([await r.arrayBuffer()], {type: MIME[ext] || 'application/octet-stream'}));
      IMG_CACHE[fid] = url; return url;
    } finally { imgSlots--; imgWait.shift()?.(); inflight.delete(fid); }
  })();
  inflight.set(fid, p); return p;
}

/* ============================ session: several saved repositories, one active ============================ */
function normalizeRepo(s) {
  s = (s || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  return /^[\w.-]+\/[\w.-]+$/.test(s) ? s : null;
}
/* Saved connections live in localStorage ("keep me connected") or sessionStorage (this tab only). */
const STORES = () => [[localStorage, true], [sessionStorage, false]];
function loadConns() {
  const out = [];
  for (const [st, remember] of STORES()) {
    try {
      const old = JSON.parse(st.getItem('at_gh') || 'null');                       // older single-repo format
      if (old && old.repo) { st.setItem('at_conns', JSON.stringify({list: [{repo: old.repo, token: old.token}]})); st.removeItem('at_gh'); }
      ((JSON.parse(st.getItem('at_conns') || 'null') || {}).list || []).forEach(c => { if (!out.some(x => x.repo === c.repo)) out.push({...c, remember}); });
    } catch {}
  }
  return out;
}
function saveConns(list, active) {
  for (const [st, remember] of STORES()) { try { st.setItem('at_conns', JSON.stringify({list: list.filter(c => c.remember === remember).map(({repo, token}) => ({repo, token}))})); } catch {} }
  try { if (active) localStorage.setItem('at_active', active); else localStorage.removeItem('at_active'); } catch {}
}
const activeRepo = () => { try { return localStorage.getItem('at_active') || ''; } catch { return ''; } };
const savedRepos = () => loadConns().map(c => c.repo);
const isRemembered = repo => loadConns().find(c => c.repo === repo)?.remember ?? true;
const savedRepo = () => activeRepo() || (savedRepos()[0] || '');

function resetSession() {
  Object.assign(GHS, {token: null, repo: null, branch: null, user: null, head: null});
  STATE_CACHE.clear(); TREE_CACHE.clear(); PENDING.clear();
}
async function ghConnect(repoInput, token, remember) {
  const repo = normalizeRepo(repoInput); token = (token || '').trim();
  if (!repo) throw E(400, 'Enter the data repository as owner/name, for example my-group/analysis-tracker-data');
  if (!token) throw E(400, 'Paste your GitHub access token');
  resetSession(); Object.assign(GHS, {token, repo});
  try {
    const u = await (await ghFetch('/user')).json();
    const r = await ghFetch(`/repos/${repo}`, {allow: [404]});
    if (r.status === 404) throw E(404, 'Repository not found, or this token has no access to it. Give the token access to the repository and check the spelling.');
    const info = await r.json();
    if (info.permissions && info.permissions.push === false) throw E(403, 'You only have read access to this repository. Ask the owner to give you write access.');
    GHS.branch = info.default_branch; GHS.user = {id: u.login, name: u.name || u.login, email: u.email || ''};
    await getHead();
  } catch (e) { resetSession(); throw e; }
  const list = loadConns().filter(c => c.repo !== repo); list.push({repo, token, remember: !!remember}); saveConns(list, repo);
  return GHS.user;
}
/* Connect to the active saved repository (or the first one whose token still works). */
async function ghRestore() {
  const conns = loadConns(); if (!conns.length) return null;
  const first = conns.find(c => c.repo === activeRepo()) || conns[0];
  const order = [first, ...conns.filter(c => c !== first)];
  let lastErr = null;
  for (const c of order) {
    try { return await ghConnect(c.repo, c.token, c.remember); }
    catch (e) { lastErr = e; if (e.status === 401 || e.status === 404) { ghRemove(c.repo); continue; } throw e; }
  }
  throw lastErr;
}
async function ghSwitch(repo) {
  const c = loadConns().find(x => x.repo === repo); if (!c) throw E(404, 'That repository is not saved on this device');
  try { return await ghConnect(c.repo, c.token, c.remember); }
  catch (e) { if (e.status === 401) ghRemove(repo); throw e; }
}
function ghRemove(repo) { const list = loadConns().filter(c => c.repo !== repo); saveConns(list, activeRepo() === repo ? (list[0] ? list[0].repo : '') : activeRepo()); }
function ghForget() {            // drop the current connection from this device
  const repo = GHS.repo; resetSession(); if (repo) ghRemove(repo);
}

/* ============================ rules (ported from the server version) ============================ */
const TYPES = ['note', 'tmp', 'group', 'internal', 'collab'];

function anFields(b, ex) {
  const stage = sv(b, 'stage', 20, true, ex ? ex.stage : '');
  if (!['just_started', 'an_stage'].includes(stage)) throw E(400, 'Invalid stage');
  const d = {stage, an_name: null, collaboration: null, an_status: null};
  if (stage === 'an_stage') {
    d.an_name = sv(b, 'an_name', 100, true, ex?.an_name || '');
    d.collaboration = sv(b, 'collaboration', 100, true, ex?.collaboration || '');
    d.an_status = sv(b, 'an_status', 20, true, ex?.an_status || '');
    if (!['being_written', 'published'].includes(d.an_status)) throw E(400, 'Invalid AN status');
  }
  return d;
}
const summary = st => {
  const a = st.analysis, rv = st.usages.flatMap(u => u.reviews);
  return {...a, plots: st.plots.length, versions: st.an_versions.length,
    latest_version: st.an_versions.length ? Math.max(...st.an_versions.map(v => v.number)) : null,
    pending: rv.filter(r => !r.none && r.status === 'pending').length};
};
async function listAnalyses() {
  const head = await getHead(), ids = (await listDir('analyses', head)).filter(d => d.type === 'dir').map(d => d.name);
  const sts = await pmap(ids, id => getState(id, head));
  return sts.filter(s => s && s.analysis).map(summary).sort((a, b) => b.created - a.created);
}
const clone = x => structuredClone(x);
const isOwner = st => st.analysis.owner === ME().id;

const H = {
  me: async () => ({user: ME()}),
  logout: async () => { ghForget(); return {ok: true}; },
  list: async () => ({analyses: await listAnalyses()}),

  async createAnalysis(_, b) {
    const title = sv(b, 'title', 150, true), f = anFields(b);
    if ((await listAnalyses()).some(a => a.owner === ME().id && a.title === title)) throw E(409, 'You already have an analysis with this title');
    let first = null;
    if (f.an_status === 'published') {
      const fv = b.first_version || {}, num = fv.number ?? 1;
      if (!Number.isInteger(num) || num < 1) throw E(400, 'Version number must be a positive integer');
      first = {num, on: dateOk(sv(fv, 'published_on', 10, false, todayStr()), 'published_on'), notes: sv(fv, 'notes', 2000)};
    }
    const aid = nid();
    await tx(aid, st => {
      st.analysis = {id: aid, title, ...f, owner: ME().id, owner_name: ME().name, created: now()};
      if (first) st.an_versions.push({id: nid(), analysis_id: aid, number: first.num, published_on: first.on, notes: first.notes, status: 'published', created: now()});
    }, {create: true, message: `Create analysis "${title}"`});
    return {id: aid};
  },
  async getAnalysis({aid}) { return clone(await readState(aid)); },
  async updateAnalysis({aid}, b) {
    const cur = await readState(aid); if (!isOwner(cur)) throw E(403, 'Only the owner can change the analysis settings');
    const title = sv(b, 'title', 150, false, cur.analysis.title) || cur.analysis.title;
    if ((await listAnalyses()).some(a => a.owner === cur.analysis.owner && a.title === title && a.id !== aid)) throw E(409, 'You already have an analysis with this title');
    await tx(aid, st => {
      const a = st.analysis, f = anFields(b, a);
      if (a.stage === 'an_stage' && f.stage === 'just_started') throw E(400, 'An analysis cannot go back to the "Just Started" stage');
      if (f.stage === 'an_stage') {
        if (a.stage === 'just_started' && f.an_status === 'published') throw E(400, 'Create the analysis as "AN being written", then publish version 1 from the AN versions page');
        if (a.stage === 'an_stage') f.an_status = a.an_status;
      }
      Object.assign(a, {title, ...f});
    }, {message: 'Edit analysis settings'});
    return {ok: true};
  },
  async deleteAnalysis({aid}) {
    for (let i = 0; i < 5; i++) {
      const head = await getHead(), st = await getState(aid, head); if (!st) throw E(404, 'Analysis not found');
      if (!isOwner(st)) throw E(403, 'Only the owner can delete an analysis');
      const ch = [{path: statePath(aid), del: true}, ...st.files.map(f => ({path: filePath(aid, f), del: true}))];
      try { await commit(head, ch, `${ME().name}: Delete analysis "${st.analysis.title}"`); STATE_CACHE.delete(aid); return {ok: true}; }
      catch (e) { if (!e.conflict) throw e; }
    }
    throw E(409, 'Please try again');
  },
  async exportAnalysis({aid}) {
    const st = clone(await readState(aid)), images = {};
    await pmap(st.plot_versions, async pv => {
      const p = PENDING.get(pv.file_id);
      const blob = p ? p.blob : await (await fetch(await fetchImage(aid, pv.file_id, pv.ext))).blob();
      images[pv.file_id] = await blobB64(blob);
    });
    return {app: 'analysis-tracker', version: 3, state: st, images};
  },

  /* ---- AN versions ---- */
  publish: ({aid}, b) => tx(aid, st => {
    const a = st.analysis; if (a.stage !== 'an_stage') throw E(400, 'Only analyses at the AN stage can publish AN versions');
    const last = st.an_versions.length ? Math.max(...st.an_versions.map(v => v.number)) : 0;
    const num = b.number !== undefined && b.number !== null && b.number !== '' ? b.number : last + 1;
    if (!Number.isInteger(num) || num < 1) throw E(400, 'Version number must be a positive integer');
    if (st.an_versions.some(v => v.number === num)) throw E(409, `Version ${num} already exists`);
    const pub = dateOk(sv(b, 'published_on', 10, false, todayStr()), 'published_on'), notes = sv(b, 'notes', 2000);
    const prev = [...st.an_versions].filter(v => v.number < num).sort((x, y) => y.number - x.number)[0], vid = nid();
    st.an_versions.push({id: vid, analysis_id: a.id, number: num, published_on: pub, notes, status: 'published', created: now()});
    // Stamp the unreleased working draft with this version: it becomes this version's historical record.
    st.plot_versions.forEach(v => { if (!v.an_version_id) v.an_version_id = vid; });
    st.usages.forEach(u => { if (!u.an_version_id) u.an_version_id = vid; });
    let carried = 0;
    if (b.carry_figures && prev) {
      const notesOf = id => st.usages.filter(u => u.an_version_id === id && u.type === 'note');
      const have = new Set(notesOf(vid).map(u => u.fig)), numOf = id => st.an_versions.find(v => v.id === id).number;
      for (const u of notesOf(prev.id)) {
        if (have.has(u.fig)) continue;
        const pv = st.plot_versions.find(x => x.id === u.plot_version_id);
        const lat = st.plot_versions.filter(x => x.plot_id === pv.plot_id && x.an_version_id && numOf(x.an_version_id) <= num).sort((x, y) => y.num - x.num || y.rev - x.rev)[0];
        st.usages.push({id: nid(), analysis_id: a.id, plot_version_id: lat.id, an_version_id: vid, type: 'note', fig: u.fig, an_ver: 'v' + num, link: '', slide: '', date: '', title: '', created: now(), reviews: []}); carried++;
      }
    }
    a.an_status = 'published';
    return {id: vid, number: num, carried};
  }, {message: 'Publish AN version'}),
  updateVersion: ({aid, id}, b) => tx(aid, st => {
    const v = byId(st.an_versions, id, 'Version');
    v.published_on = dateOk(sv(b, 'published_on', 10, false, v.published_on) || v.published_on, 'published_on'); v.notes = sv(b, 'notes', 2000, false, v.notes); return {ok: true};
  }, {message: 'Edit AN version'}),

  /* ---- categories / plots ---- */
  createCategory: ({aid}, b) => tx(aid, st => {
    const name = sv(b, 'name', 100, true);
    if (st.categories.some(c => c.name === name)) throw E(409, 'Category already exists');
    const c = {id: nid(), analysis_id: st.analysis.id, name}; st.categories.push(c); return {id: c.id};
  }, {message: 'Add category'}),
  deleteCategory: ({aid, id}, b) => tx(aid, st => {
    const c = byId(st.categories, id, 'Category'); if (st.plots.some(p => p.category_id === c.id)) throw E(409, 'Category is not empty');
    st.categories = st.categories.filter(x => x.id !== c.id); return {ok: true};
  }, {message: 'Delete category'}),
  async upload({aid}, b, o) {
    await readState(aid);
    const blob = o.raw; if (!blob || !blob.size) throw E(400, 'Empty upload');
    if (blob.size > 25 * 1024 * 1024) throw E(413, 'Image is too large (max 25 MB)');
    const h = new Uint8Array(await blob.slice(0, 4096).arrayBuffer()), asc = String.fromCharCode(...h), ext =
      (h[0] === 0x89 && asc.slice(1, 4) === 'PNG') ? '.png' : (h[0] === 0xff && h[1] === 0xd8) ? '.jpg' : /^GIF8[79]a/.test(asc) ? '.gif'
        : (asc.slice(0, 4) === 'RIFF' && asc.slice(8, 12) === 'WEBP') ? '.webp' : /<svg/i.test(asc) ? '.svg' : null;
    if (!ext) throw E(400, 'Unsupported file. Please upload a PNG, JPG, GIF, WebP or SVG image.');
    const fid = nid(), typed = new Blob([blob], {type: MIME[ext]});
    PENDING.set(fid, {blob: typed, ext, aid}); IMG_CACHE[fid] = URL.createObjectURL(typed);
    return {file_id: fid, ext};
  },
  createPlot: ({aid}, b) => tx(aid, (st, io) => {
    const cat = byId(st.categories, sv(b, 'category_id', 40, true), 'Category'), name = sv(b, 'name', 150, true);
    if (st.plots.some(p => p.category_id === cat.id && p.name === name)) throw E(409, 'A plot with this name already exists in that category');
    const p = {id: nid(), analysis_id: st.analysis.id, category_id: cat.id, name, created: now()}; st.plots.push(p);
    const vid = makeVersion(st, io, p.id, b.version || {}); return {id: p.id, version_id: vid};
  }, {message: 'Add plot'}),
  createVersion: ({aid, pid}, b) => tx(aid, (st, io) => { byId(st.plots, pid, 'Plot'); return {id: makeVersion(st, io, pid, b)}; }, {message: 'Save new plot version'}),
  deleteVersion: ({aid, id}) => tx(aid, (st, io) => {
    const v = byId(st.plot_versions, id, 'Version'), ids = descendants(st, v.id);
    if (ids.some(i => st.plot_versions.find(x => x.id === i).an_version_id)) throw E(409, 'This plot version belongs to a published AN version and is kept as a historical record');
    if (st.plot_versions.filter(x => x.plot_id === v.plot_id).length === ids.length) throw E(409, 'A plot needs at least one version - delete the plot instead');
    purgeVersions(st, io, ids); return {ok: true};
  }, {message: 'Delete plot version'}),
  deletePlot: ({aid, id}) => tx(aid, (st, io) => {
    const p = byId(st.plots, id, 'Plot'), vs = st.plot_versions.filter(v => v.plot_id === p.id);
    if (vs.some(v => v.an_version_id)) throw E(409, 'This plot belongs to published AN versions and is kept as a historical record');
    purgeVersions(st, io, [...vs].sort((x, y) => y.num - x.num || y.rev - x.rev).map(v => v.id)); st.plots = st.plots.filter(x => x.id !== p.id); return {ok: true};
  }, {message: 'Delete plot'}),

  /* ---- usages & reviews ---- */
  createUsage: ({aid}, b) => tx(aid, st => {
    const typ = sv(b, 'type', 10, true); if (!TYPES.includes(typ)) throw E(400, 'Invalid type');
    if (typ === 'note' && st.analysis.stage !== 'an_stage') throw E(400, 'Analysis Note figures are only available at the AN stage');
    const pv = byId(st.plot_versions, sv(b, 'plot_version_id', 40, true), 'Plot version');
    const ver = b.an_version_id ? byId(st.an_versions, b.an_version_id, 'AN version') : null;
    if (ver) {
      const pvv = pv.an_version_id && st.an_versions.find(v => v.id === pv.an_version_id);
      if (!pvv || pvv.number > ver.number) throw E(400, `This plot version did not exist yet at AN version ${ver.number}`);
    }
    const u = {id: nid(), analysis_id: st.analysis.id, plot_version_id: pv.id, an_version_id: ver ? ver.id : null, type: typ, ...usageFields(b, typ), created: now(), reviews: []};
    st.usages.push(u); return {id: u.id};
  }, {message: 'Add record'}),
  updateUsage: ({aid, id}, b) => tx(aid, st => { const u = byId(st.usages, id, 'Record'); Object.assign(u, usageFields(b, u.type)); return {ok: true}; }, {message: 'Edit record'}),
  deleteUsage: ({aid, id}) => tx(aid, st => {
    const u = byId(st.usages, id, 'Record'); if (u.an_version_id) throw E(409, 'This record belongs to a published AN version and is kept as a historical record');
    purgeUsage(st, u.id); return {ok: true};
  }, {message: 'Delete record'}),
  createReview: ({aid, uid}, b) => tx(aid, st => {
    const u = byId(st.usages, uid, 'Record');
    if (u.type === 'note' && !u.an_version_id) throw E(400, 'Reviewer comments can only be recorded against a published AN version');
    const {f} = reviewFields(b), r = {id: nid(), analysis_id: st.analysis.id, usage_id: u.id, ...f, status: 'pending', resolved_version_id: null, resolution: '', resolved_at: null, created: now()};
    u.reviews.push(r); return {id: r.id};
  }, {message: 'Add feedback'}),
  updateReview: ({aid, id}, b) => tx(aid, st => {
    const rv = findReview(st, id), {f, st: s0} = reviewFields(b); let s = f.none ? 'pending' : s0;
    if (s === 'resolved' && rv.status !== 'resolved') throw E(400, 'Use the resolve action to mark feedback as resolved');
    if (s === 'pending' && rv.status === 'resolved') rv.resolved_at = null;
    Object.assign(rv, f, {status: s, resolved_version_id: s === 'resolved' ? rv.resolved_version_id : null}); return {ok: true};
  }, {message: 'Edit feedback'}),
  deleteReview: ({aid, id}) => tx(aid, st => {
    const rv = findReview(st, id); st.plot_versions.forEach(v => { if (v.review_id === rv.id) v.review_id = null; });
    const u = st.usages.find(x => x.id === rv.usage_id); u.reviews = u.reviews.filter(x => x.id !== rv.id); return {ok: true};
  }, {message: 'Delete feedback'}),
  resolveReview: ({aid, id}, b) => tx(aid, (st, io) => {
    const rv = findReview(st, id); if (rv.none) throw E(400, 'There is no comment to resolve');
    const u = st.usages.find(x => x.id === rv.usage_id), mode = sv(b, 'mode', 10, true);
    if (mode === 'plot') {
      const base = byId(st.plot_versions, u.plot_version_id, 'Plot version'), changes = sv(b, 'changes', 3000, true);
      const vid = makeVersion(st, io, base.plot_id, {file_id: b.file_id, summary: (base.summary + ' - revised after review').slice(0, 140), changes,
        motivation: `Response to ${rv.role}${rv.name ? ' · ' + rv.name : ''}: ${rv.text}`.slice(0, 3000), dataset: base.dataset, code: base.code}, base, rv.id, sv(b, 'file_name', 150) || null);
      Object.assign(rv, {status: 'resolved', resolved_version_id: vid, resolution: changes, resolved_at: now()});
    } else if (mode === 'noplot') Object.assign(rv, {status: 'resolved', resolved_version_id: null, resolution: sv(b, 'note', 3000, true), resolved_at: now()});
    else throw E(400, 'Invalid mode');
    return {ok: true};
  }, {message: 'Resolve feedback'}),

  /* ---- documents ---- */
  createDoc: ({aid}, b) => tx(aid, st => { const d = {id: nid(), analysis_id: st.analysis.id, ...docFields(st, b), author: ME().name, created: now()}; st.documents.push(d); return {id: d.id}; }, {message: 'Add document'}),
  updateDoc: ({aid, id}, b) => tx(aid, st => { const d = byId(st.documents, id, 'Document'); Object.assign(d, docFields(st, b)); return {ok: true}; }, {message: 'Edit document'}),
  deleteDoc: ({aid, id}) => tx(aid, st => { byId(st.documents, id, 'Document'); st.documents = st.documents.filter(d => d.id !== id); return {ok: true}; }, {message: 'Delete document'}),
};

function usageFields(b, typ) {
  if (typ === 'note') return {fig: sv(b, 'fig', 40, true), an_ver: sv(b, 'an_ver', 40), link: '', slide: '', date: '', title: ''};
  return {fig: '', an_ver: '', link: urlOk(sv(b, 'link', 500, true), 'link'), slide: sv(b, 'slide', 40, true), date: dateOk(sv(b, 'date', 10, true), 'date'), title: sv(b, 'title', 150)};
}
function reviewFields(b) {
  const none = !!b.none, text = sv(b, 'text', 5000, !none), s = sv(b, 'status', 10, false, 'pending') || 'pending';
  if (!['pending', 'resolved'].includes(s)) throw E(400, 'Invalid status');
  return {f: {role: sv(b, 'role', 60, true), name: sv(b, 'name', 100), none, text: none ? '' : text}, st: s};
}
function docFields(st, b) {
  const ver = b.an_version_id ? byId(st.an_versions, b.an_version_id, 'AN version') : null;
  return {an_version_id: ver ? ver.id : null, title: sv(b, 'title', 200, true), kind: sv(b, 'kind', 40, false, 'Other') || 'Other', url: urlOk(sv(b, 'url', 500)), notes: sv(b, 'notes', 3000)};
}
function findReview(st, id) { for (const u of st.usages) { const r = u.reviews.find(x => x.id === id); if (r) return r; } throw E(404, 'Feedback not found'); }

/* Plot versions are always created in the working draft (an_version_id = null). */
function makeVersion(st, io, plotId, b, parent = null, reviewId = null, fnameBase = null) {
  const fid = sv(b, 'file_id', 40, true), up = PENDING.get(fid);
  if (!up || up.aid !== st.analysis.id) throw E(400, 'Upload the plot image first');
  if (st.files.some(f => f.id === fid)) throw E(400, 'That upload was already used');
  const p = byId(st.plots, plotId, 'Plot'), vs = st.plot_versions.filter(v => v.plot_id === plotId);
  let num, rev;
  if (parent) { num = parent.num; rev = Math.max(0, ...vs.filter(v => v.num === num).map(v => v.rev)) + 1; }
  else { num = Math.max(0, ...vs.map(v => v.num)) + 1; rev = 0; }
  const dflt = `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}_v${num}`;
  const base = (fnameBase || sv(b, 'file_name', 150) || dflt).replace(/[^\w.\-]+/g, '-').replace(/^[-_.]+|[-_.]+$/g, '').slice(0, 150) || 'plot';
  const v = {id: nid(), analysis_id: st.analysis.id, plot_id: plotId, num, rev, parent_id: parent ? parent.id : null, review_id: reviewId, file_id: fid, ext: up.ext, an_version_id: null,
    summary: sv(b, 'summary', 140, true), changes: sv(b, 'changes', 3000, true), motivation: sv(b, 'motivation', 3000), dataset: sv(b, 'dataset', 500), code: sv(b, 'code', 500),
    file_name: base + up.ext, author: ME().name, created: now()};
  st.plot_versions.push(v); st.files.push({id: fid, ext: up.ext, size: up.blob.size, created: now()}); io.newFiles.push(fid);
  return v.id;
}
function descendants(st, vid) { const out = [vid]; for (let i = 0; i < out.length; i++) st.plot_versions.forEach(x => { if (x.parent_id === out[i]) out.push(x.id); }); return out.reverse(); }
function purgeUsage(st, uid) {
  const u = st.usages.find(x => x.id === uid), rids = new Set(u.reviews.map(r => r.id));
  st.plot_versions.forEach(v => { if (rids.has(v.review_id)) v.review_id = null; });
  st.usages = st.usages.filter(x => x.id !== uid);
}
function purgeVersions(st, io, ids) {
  const aid = st.analysis.id, gone = new Set(ids);
  st.usages.forEach(u => u.reviews.forEach(r => { if (gone.has(r.resolved_version_id)) Object.assign(r, {resolved_version_id: null, status: 'pending', resolution: ''}); }));
  st.usages.filter(u => gone.has(u.plot_version_id)).forEach(u => purgeUsage(st, u.id));
  for (const id of ids) {
    const v = st.plot_versions.find(x => x.id === id), f = st.files.find(x => x.id === v.file_id);
    st.plot_versions = st.plot_versions.filter(x => x.id !== id); st.files = st.files.filter(x => x.id !== v.file_id);
    if (io.newFiles.includes(v.file_id)) io.newFiles = io.newFiles.filter(x => x !== v.file_id); else if (f) io.delFiles.push(filePath(aid, f));
  }
}

/* ============================ router: same routes the UI used with the server ============================ */
const ID = '[0-9a-f]{16}', A_ = `^\\/analyses\\/(?<aid>${ID})`;
const R = (m, p, fn) => [m, new RegExp(p), fn];
const ROUTES = [
  R('GET', '^\\/me$', H.me), R('POST', '^\\/logout$', H.logout),
  R('GET', '^\\/analyses$', H.list), R('POST', '^\\/analyses$', H.createAnalysis),
  R('GET', A_ + '$', H.getAnalysis), R('PATCH', A_ + '$', H.updateAnalysis), R('DELETE', A_ + '$', H.deleteAnalysis), R('GET', A_ + '\\/export$', H.exportAnalysis),
  R('POST', A_ + '\\/versions$', H.publish), R('PATCH', A_ + `\\/versions\\/(?<id>${ID})$`, H.updateVersion),
  R('POST', A_ + '\\/categories$', H.createCategory), R('DELETE', A_ + `\\/categories\\/(?<id>${ID})$`, H.deleteCategory),
  R('POST', A_ + '\\/upload$', H.upload),
  R('POST', A_ + '\\/plots$', H.createPlot), R('DELETE', A_ + `\\/plots\\/(?<id>${ID})$`, H.deletePlot),
  R('POST', A_ + `\\/plots\\/(?<pid>${ID})\\/versions$`, H.createVersion), R('DELETE', A_ + `\\/plot-versions\\/(?<id>${ID})$`, H.deleteVersion),
  R('POST', A_ + '\\/usages$', H.createUsage), R('PATCH', A_ + `\\/usages\\/(?<id>${ID})$`, H.updateUsage), R('DELETE', A_ + `\\/usages\\/(?<id>${ID})$`, H.deleteUsage),
  R('POST', A_ + `\\/usages\\/(?<uid>${ID})\\/reviews$`, H.createReview),
  R('PATCH', A_ + `\\/reviews\\/(?<id>${ID})$`, H.updateReview), R('DELETE', A_ + `\\/reviews\\/(?<id>${ID})$`, H.deleteReview),
  R('POST', A_ + `\\/reviews\\/(?<id>${ID})\\/resolve$`, H.resolveReview),
  R('POST', A_ + '\\/documents$', H.createDoc), R('PATCH', A_ + `\\/documents\\/(?<id>${ID})$`, H.updateDoc), R('DELETE', A_ + `\\/documents\\/(?<id>${ID})$`, H.deleteDoc),
];
async function api(method, path, body, opts = {}) {
  if (!GHS.token) { if (window.onAuthLost && !opts.anon) window.onAuthLost(); throw E(401, 'Please connect to GitHub'); }
  for (const [m, rx, fn] of ROUTES) {
    if (m !== method) continue;
    const mt = rx.exec(path); if (!mt) continue;
    try { return await fn(mt.groups || {}, body || {}, opts); }
    catch (e) { if (e instanceof ApiError && e.status === 401 && window.onAuthLost) { ghForget(); window.onAuthLost(); } throw e; }
  }
  throw E(404, 'Not found');
}

/* the only things the UI needs from this file */
Object.assign(window, {api, batch, ghConnect, ghRestore, ghSwitch, ghForget, ghRemove, savedRepo, savedRepos, isRemembered, GHS, imgCached, fetchImage});
})();
