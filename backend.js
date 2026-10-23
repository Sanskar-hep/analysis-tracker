/*! Analysis-Tracker - Copyright (c) 2026 Sanskar Nanda - MIT License (see LICENSE). https://github.com/Sanskar-hep */
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
const MIME = {'.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf'};
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

/* ============================ demo mode: a small in-memory stand-in for GitHub ============================ */
/* Used by "Try the demo": the same code runs against a throw-away repository that lives in this tab only. Nothing is sent anywhere. */
const DEMO_MSG = 'This is the read-only demo. Sign in to make changes.';
const DEMO = {blobs: {}, trees: {}, commits: {}, ref: null, n: 0};
const demoSha = () => (++DEMO.n).toString(16).padStart(40, '0');
function demoReset() {
  Object.assign(DEMO, {blobs: {}, trees: {}, commits: {}, n: 0});
  const b = demoSha(), t = demoSha(), c = demoSha();
  DEMO.blobs[b] = new TextEncoder().encode('# demo data'); DEMO.trees[t] = {'README.md': b}; DEMO.commits[c] = {tree: t, parents: []}; DEMO.ref = c;
}
async function demoFetch(path, o = {}) {
  const j = (code, obj) => new Response(JSON.stringify(obj), {status: code, headers: {'Content-Type': 'application/json'}});
  const body = o.body || {}, m = o.method || 'GET', p = path.slice(repoPath().length), [pp, qs] = p.split('?');
  let mm;
  if (GHS.readonly && m !== 'GET') return j(403, {message: 'DEMO_LOCKED'});          // the demo repository cannot be written to once it is built
  if (pp === '/git/ref/heads/main') return j(200, {object: {sha: DEMO.ref}});
  if ((mm = pp.match(/^\/git\/commits\/(\w+)$/)) && m === 'GET') return j(200, {sha: mm[1], tree: {sha: DEMO.commits[mm[1]].tree}});
  if (pp === '/git/blobs' && m === 'POST') { const h = demoSha(); DEMO.blobs[h] = Uint8Array.from(atob(body.content), ch => ch.charCodeAt(0)); return j(201, {sha: h}); }
  if (pp === '/git/trees' && m === 'POST') {
    const ents = {...DEMO.trees[body.base_tree]}; body.tree.forEach(t => { if (t.sha === null) delete ents[t.path]; else ents[t.path] = t.sha; });
    const h = demoSha(); DEMO.trees[h] = ents; return j(201, {sha: h});
  }
  if (pp === '/git/commits' && m === 'POST') { const h = demoSha(); DEMO.commits[h] = {tree: body.tree, parents: body.parents}; return j(201, {sha: h}); }
  if (pp === '/git/refs/heads/main' && m === 'PATCH') {
    if (DEMO.commits[body.sha].parents[0] !== DEMO.ref) return j(422, {message: 'Update is not a fast forward'});
    DEMO.ref = body.sha; return j(200, {object: {sha: body.sha}});
  }
  if ((mm = pp.match(/^\/contents\/(.*)$/)) && m === 'GET') {
    const file = decodeURIComponent(mm[1]).replace(/\/+$/, ''), ents = DEMO.trees[DEMO.commits[new URLSearchParams(qs).get('ref')].tree];
    if (file in ents) return o.raw ? new Response(DEMO.blobs[ents[file]], {status: 200}) : j(200, {type: 'file', path: file});
    const kids = {}; Object.keys(ents).forEach(k => { if (k.startsWith(file + '/')) { const rest = k.slice(file.length + 1); kids[rest.split('/')[0]] = rest.includes('/') ? 'dir' : 'file'; } });
    const names = Object.keys(kids);
    return names.length ? j(200, names.map(n => ({name: n, type: kids[n], path: file + '/' + n}))) : j(404, {message: 'Not Found'});
  }
  return j(404, {message: 'Not Found'});
}

/* ============================ GitHub client ============================ */
async function ghFetch(path, o = {}) {
  if (GHS.demo) { const r = await demoFetch(path, o); if (r.ok || (o.allow || []).includes(r.status)) return r; throw E(r.status, r.status === 403 ? DEMO_MSG : 'Demo error ' + r.status); }
  const h ={Authorization: 'Bearer ' + GHS.token, Accept: o.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json'};
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
  const st = JSON.parse(t); migrate(st); STATE_CACHE.set(aid, {head, st}); return st;
}
function liftResp(st, c) {
  c.responses = c.responses || []; c.history = c.history || [];
  if (!c.responses.length && (c.answer || '').trim() && st.analysis) c.responses.push({id: c.id, person: st.analysis.owner_name || st.analysis.owner, login: st.analysis.owner, text: c.answer, at: c.created || 0, status: 'active', revisions: [], events: [], earlier: true});
  if (c.responses.length) syncAnswer(c);
}
function migrate(st) {                                    // older files get the newer fields
  st.an_comments = st.an_comments || []; st.audit = st.audit || []; st.analysis && (st.analysis.team = st.analysis.team || []);
  st.an_comments.forEach(c => { c.source = c.source || 'an'; c.kind = c.kind || 'text'; c.answer = c.answer || ''; c.meeting = c.meeting || ''; c.meeting_date = c.meeting_date || ''; if (c.anchor === undefined) c.anchor = null; });
  st.usages.forEach(u => { u.panel = u.panel || ''; u.reviews.forEach(r => { r.answer = r.answer || ''; if (r.anchor === undefined) r.anchor = null; r.scope = r.scope || 'panel'; r.resolved_more = r.resolved_more || []; }); });
  /* every comment keeps a list of responses; an answer written before this existed becomes the first one (same id as the comment) */
  st.an_comments.forEach(c => liftResp(st, c)); st.usages.forEach(u => u.reviews.forEach(r => liftResp(st, r)));
  st.an_versions.forEach(v => { if (v.pdf === undefined) v.pdf = null; v.change_summary = v.change_summary || ''; });
  st.categories.forEach(c => { if (c.parent_id === undefined) c.parent_id = null; });
  st.plots.forEach(p => { p.location = p.location || ''; p.era = p.era || ''; });
  st.plot_versions.forEach(v => { v.reviewed = !!v.reviewed; });
  st.working = st.working || {name: '', entries: [], summary_md: null, summary_reviewed: false};
  if (st.working.pdf === undefined) st.working.pdf = null; st.working.change_report = st.working.change_report || '';
  st.src_map = st.src_map || {};
  st.an_versions.forEach(v => { v.change_report = v.change_report || ''; });
  if (st.analysis && st.analysis.presented === undefined) st.analysis.presented = false;
  return st;
}
const newState = () => ({format: 2, analysis: null, an_versions: [], categories: [], plots: [], plot_versions: [], usages: [], documents: [], files: [], an_comments: [], src_map: {}, audit: [], working: {name: '', entries: [], summary_md: null}});

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
  Object.assign(GHS, {token: null, repo: null, branch: null, user: null, head: null, demo: false, readonly: false});
  STATE_CACHE.clear(); TREE_CACHE.clear(); PENDING.clear();
}
async function ghConnect(repoInput, token, remember) {
  const repo = normalizeRepo(repoInput); token = (token || '').replace(/\s+/g, '');   // phones add spaces / line breaks when pasting
  if (token && !/^(github_pat_|ghp_|gho_|ghu_|ghs_)/.test(token)) throw E(400, 'That does not look like a GitHub token. It should start with "github_pat_". (A GitHub password does not work here.)');
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
/* Demo session: nothing is saved on the device and nothing leaves the browser. */
async function ghDemo() {
  resetSession(); demoReset();
  Object.assign(GHS, {token: 'demo', repo: 'demo/sample-data', branch: 'main', demo: true, readonly: false, user: {id: 'visitor', name: 'Demo visitor', email: ''}});
  await getHead(); return GHS.user;
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
const TYPES = ['note', 'tmp', 'group', 'internal', 'collab', 'meeting'];   // tmp/group/internal/collab only exist in older data; new records use 'note' or 'meeting'
const NEW_TYPES = ['note', 'meeting'];
const KINDS = ['text', 'table', 'equation', 'general', 'figure', 'methodology'];
const OPEN_STATES = ['pending', 'in_progress'];          // 'pending' is shown as "Open"

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
    pending: rv.filter(r => !r.none && r.status !== 'resolved').length + (st.an_comments || []).filter(c => c.status !== 'resolved').length};
};
async function listAnalyses() {
  const head = await getHead(), ids = (await listDir('analyses', head)).filter(d => d.type === 'dir').map(d => d.name);
  const sts = await pmap(ids, id => getState(id, head));
  return sts.filter(s => s && s.analysis).map(summary).sort((a, b) => b.created - a.created);
}
const clone = x => structuredClone(x);
const isOwner = st => st.analysis.owner === ME().id;

/* ---- who is acting, responses to comments, and the activity log ----
   The person is picked from the owner's team list in the browser; the GitHub account that saved the change is always recorded as well. */
function syncAnswer(c) {            // c.answer = what the rest of the site shows as "the answer": the selected responses, else the newest active one
  const rs = (c.responses || []).filter(r => (r.text || '').trim()), sel = rs.filter(r => r.status === 'selected'), act = rs.filter(r => r.status === 'active');
  c.answer = sel.length ? sel.map(r => r.text.trim()).join('\n\n') : act.length ? act[act.length - 1].text.trim() : '';
}
function personOf(st, b, strict = true) {
  const names = (st.analysis.team || []).map(t => t.name), p = typeof b._person === 'string' ? b._person.trim() : '';
  if (!names.length) return ME().name;
  if (names.includes(p) || (p && p === st.analysis.owner_name && isOwner(st))) return p;
  if (strict) throw E(403, 'Choose who you are first. The people allowed to answer comments and add plots are listed by the analysis owner.');
  return ME().name;
}
function audit(st, action, o = {}) {
  (st.audit = st.audit || []).push({id: nid(), at: now(), actor: ME().id, person: o.person || ME().name, action, target: o.target || '', detail: String(o.detail || '').slice(0, 300), reason: String(o.reason || '').slice(0, 1000)});
}
function findComment(st, id) {
  let c = null; for (const u of st.usages) { const r = u.reviews.find(x => x.id === id && !x.none); if (r) { c = r; break; } }
  c = c || byId(st.an_comments, id, 'Comment'); liftResp(st, c); return c;
}
const cmtLabel = c => (c.location || (c.role ? c.role + (c.name ? ' · ' + c.name : '') : 'Comment')) + ': ' + String(c.text || '').slice(0, 60);
function archiveResolution(st, c, person) {       // reopening keeps what the earlier resolution was
  if (c.status !== 'resolved') return;
  c.history.push({resolution: c.resolution || '', resolved_in: c.resolved_in || null, resolved_version_id: c.resolved_version_id || null, resolved_more: c.resolved_more || [], resolved_at: c.resolved_at || null, reopened_at: now(), reopened_by: person});
  c.responses.forEach(r => { if (r.status === 'selected') { r.status = 'superseded'; r.events.push({at: now(), by: person, action: 'superseded', reason: 'The comment was reopened'}); } });
  syncAnswer(c); audit(st, 'comment_reopened', {person, target: c.id, detail: cmtLabel(c)});
}
const setMyResponse = ({aid, id}, b) => tx(aid, st => {
  const c = findComment(st, id), person = personOf(st, b), text = sv(b, 'answer', 5000);
  const mine = [...c.responses].reverse().find(r => r.person === person && (r.status === 'active' || r.status === 'selected'));
  if (mine) {
    if (mine.text !== text) { mine.revisions.push({text: mine.text, at: mine.edited_at || mine.at, by: mine.edited_by || mine.login}); mine.text = text; mine.edited_at = now(); mine.edited_by = ME().id; audit(st, 'response_edited', {person, target: c.id, detail: cmtLabel(c)}); }
  } else if (text) {
    c.responses.push({id: nid(), person, login: ME().id, text, at: now(), status: 'active', revisions: [], events: []}); audit(st, 'response_added', {person, target: c.id, detail: cmtLabel(c)});
  }
  syncAnswer(c); return {ok: true};
}, {message: 'Write answer'});

const H = {
  /* the people the owner allows to answer comments and add plots (chosen from a list when the analysis is opened) */
  setTeam: ({aid}, b) => tx(aid, st => {
    if (!isOwner(st)) throw E(403, 'Only the owner can change the team list');
    const raw = Array.isArray(b.names) ? b.names : []; if (raw.length > 60) throw E(400, 'The list is limited to 60 names');
    const seen = new Set(), old = st.analysis.team || [], next = [];
    for (const n0 of raw) { const n = String(n0 ?? '').trim(); if (!n) continue; if (n.length > 60) throw E(400, 'A name is too long (max 60)'); const k = n.toLowerCase(); if (seen.has(k)) continue; seen.add(k);
      next.push(old.find(t => t.name === n) || {name: n, added_at: now(), added_by: ME().id}); }
    const add = next.filter(n => !old.some(o => o.name === n.name)).map(n => n.name), del = old.filter(o => !next.some(n => n.name === o.name)).map(o => o.name);
    st.analysis.team = next; if (add.length || del.length) audit(st, 'team_changed', {detail: [add.length ? 'added ' + add.join(', ') : '', del.length ? 'removed ' + del.join(', ') : ''].filter(Boolean).join('; ')});
    return {ok: true};
  }, {message: 'Edit team list'}),
  /* the owner decides which responses to keep: select (several allowed), discard (reason required), restore. Nothing is ever deleted. */
  decideResponse: ({aid, id, rid}, b) => tx(aid, st => {
    if (!isOwner(st)) throw E(403, 'Only the analysis owner can select or discard responses');
    const c = findComment(st, id), r = byId(c.responses, rid, 'Response'), act = sv(b, 'action', 10, true), person = personOf(st, b), reason = sv(b, 'reason', 1000, act === 'discard');
    if (act === 'select') { if (r.status === 'discarded') throw E(400, 'Restore the response first'); r.status = 'selected'; }
    else if (act === 'unselect') { if (r.status !== 'selected') throw E(400, 'This response is not selected'); r.status = 'active'; }
    else if (act === 'discard') { if (r.status === 'discarded') throw E(400, 'Already discarded'); r.status = 'discarded'; }
    else if (act === 'restore') { if (r.status !== 'discarded') throw E(400, 'This response is not discarded'); r.status = 'active'; }
    else throw E(400, 'Unknown action');
    r.events.push({at: now(), by: person, action: act, reason}); syncAnswer(c);
    audit(st, 'response_' + act, {person, target: c.id, detail: `${r.person}'s response · ${cmtLabel(c)}`, reason}); return {ok: true};
  }, {message: 'Review a response'}),
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
      first = {num, on: dateOk(sv(fv, 'published_on', 10, false, todayStr()), 'published_on'), notes: sv(fv, 'notes', 2000), pdf: pdfInfo(fv.pdf)};
    }
    const aid = nid();
    await tx(aid, st => {
      st.analysis = {id: aid, title, ...f, owner: ME().id, owner_name: ME().name, presented: false, team: [], created: now()};
      if (first) st.an_versions.push({id: nid(), analysis_id: aid, number: first.num, published_on: first.on, notes: first.notes, pdf: first.pdf, status: 'published', created: now()});
    }, {create: true, message: `Create analysis "${title}"`});
    return {id: aid};
  },
  /* CADI line of this analysis: {status: 'yes' | 'no' | 'unspecified', line, url}; stored per analysis */
  setCadi: ({aid}, b) => tx(aid, st => {
    const status = ['yes', 'no', 'unspecified'].includes(b.status) ? b.status : null; if (!status) throw E(400, 'Invalid CADI status');
    const line = status === 'yes' ? sv(b, 'line', 100, false, '') : '', url = status === 'yes' ? sv(b, 'url', 500, false, '') : '';
    if (url && !/^https?:\/\//i.test(url)) throw E(400, 'The CADI link must start with http:// or https://');
    st.analysis.cadi = {status, line, url, by: ME().name, at: now()}; return {ok: true};
  }, {message: 'Set CADI line status'}),
  setPresented: ({aid}, b) => tx(aid, st => { st.analysis.presented = !!b.value; return {ok: true}; }, {message: 'Meetings section ' + (b.value ? 'enabled' : 'disabled')}),
  async getAnalysis({aid}) { return clone(await readState(aid)); },
  async updateAnalysis({aid}, b) {
    const cur = await readState(aid); if (!isOwner(cur)) throw E(403, 'Only the owner can change the analysis settings');
    const title = sv(b, 'title', 150, false, cur.analysis.title) || cur.analysis.title;
    if ((await listAnalyses()).some(a => a.owner === cur.analysis.owner && a.title === title && a.id !== aid)) throw E(409, 'You already have an analysis with this title');
    await tx(aid, st => {
      const a = st.analysis, f = anFields(b, a);
      if (a.stage === 'an_stage' && f.stage === 'just_started') throw E(400, 'An analysis cannot go back to the "Just Started" stage');
      if (f.stage === 'an_stage') {
        if (a.stage === 'just_started' && f.an_status === 'published') {          // moving to the AN stage with a version already published
          const fv = b.first_version || {}, num = fv.number ?? 1;
          if (!Number.isInteger(num) || num < 1) throw E(400, 'Version number must be a positive integer');
          st.an_versions.push({id: nid(), analysis_id: a.id, number: num, published_on: dateOk(sv(fv, 'published_on', 10, false, todayStr()), 'published_on'), notes: sv(fv, 'notes', 2000), pdf: pdfInfo(fv.pdf), status: 'published', created: now()});
        }
        if (a.stage === 'an_stage') f.an_status = a.an_status;
      }
      Object.assign(a, {title, ...f});
      if (f.stage === 'an_stage') a.presented = true;
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

  /* ---- the working (unreleased) AN version: its name, the analyst's own change notes, and an optionally edited summary ---- */
  updateWorking: ({aid}, b) => tx(aid, st => {
    const w = st.working; if (b.name !== undefined) w.name = sv(b, 'name', 60);
    if (b.summary_md !== undefined) w.summary_md = b.summary_md === null ? null : sv(b, 'summary_md', 60000);
    if (b.summary_reviewed !== undefined) w.summary_reviewed = !!b.summary_reviewed;
    if (b.change_report !== undefined) w.change_report = sv(b, 'change_report', 120000);
    return {ok: true};
  }, {message: 'Update working version'}),
  addWorkingEntry: ({aid}, b) => tx(aid, st => {
    const section = sv(b, 'section', 20, true); if (!['plots', 'methodology', 'other'].includes(section)) throw E(400, 'Invalid section');
    const e = {id: nid(), section, text: sv(b, 'text', 3000, true), author: ME().name, created: now()}; st.working.entries.push(e); return {id: e.id};
  }, {message: 'Record a change'}),
  deleteWorkingEntry: ({aid, id}) => tx(aid, st => { byId(st.working.entries, id, 'Entry'); st.working.entries = st.working.entries.filter(e => e.id !== id); return {ok: true}; }, {message: 'Remove a recorded change'}),
  /* the new AN PDF of the working version: it must be uploaded before the version can be published or exported */
  setWorkingPdf: ({aid}, b) => tx(aid, (st, io) => {
    const info = pdfInfo(b.pdf), fid = sv(b, 'file_id', 40, true), up = PENDING.get(fid), w = st.working;
    if (!info) throw E(400, 'PDF details are missing');
    if (!up || up.aid !== st.analysis.id || up.ext !== '.pdf') throw E(400, 'Upload the PDF first');
    if (st.files.some(f => f.id === fid)) throw E(400, 'That upload was already used');
    if (st.an_versions.some(v => v.pdf && v.pdf.sha256 === info.sha256)) throw E(400, 'This PDF is identical to the PDF of a published AN version. Upload the updated AN PDF.');
    if (w.pdf && w.pdf.file_id) dropStoredPdf(st, io, w.pdf);
    st.files.push({id: fid, ext: '.pdf', size: up.blob.size, created: now()}); io.newFiles.push(fid);
    w.pdf = {...info, file_id: fid, ext: '.pdf', uploaded: now(), by: ME().name}; return {ok: true};
  }, {message: 'Upload the new AN PDF'}),
  removeWorkingPdf: ({aid}) => tx(aid, (st, io) => { const w = st.working; if (w.pdf && w.pdf.file_id) dropStoredPdf(st, io, w.pdf); w.pdf = null; return {ok: true}; }, {message: 'Remove the new AN PDF'}),
  /* the documented changes between two successive AN versions (text and figures), kept with the later version */
  setVersionChanges: ({aid, id}, b) => tx(aid, st => { byId(st.an_versions, id, 'Version').change_report = sv(b, 'report', 120000); return {ok: true}; }, {message: 'Save the changes between AN versions'}),
  /* ---- AN versions ---- */
  publish: ({aid}, b) => tx(aid, st => {
    const a = st.analysis; if (a.stage !== 'an_stage') throw E(400, 'Only analyses at the AN stage can publish AN versions');
    const last = st.an_versions.length ? Math.max(...st.an_versions.map(v => v.number)) : 0;
    const num = b.number !== undefined && b.number !== null && b.number !== '' ? b.number : last + 1;
    if (!Number.isInteger(num) || num < 1) throw E(400, 'Version number must be a positive integer');
    if (st.an_versions.some(v => v.number === num)) throw E(409, `Version ${num} already exists`);
    const pub = dateOk(sv(b, 'published_on', 10, false, todayStr()), 'published_on'), notes = sv(b, 'notes', 2000);
    let pdf = pdfInfo(b.pdf);
    if (st.an_versions.length && !b.skip_pdf_check) {                 // every later version needs its own, new AN PDF
      const wp = st.working.pdf; if (!wp || !wp.file_id) throw E(400, 'Upload the new AN PDF (Release & Export) before publishing');
      if (st.an_versions.some(v => v.pdf && v.pdf.sha256 === wp.sha256)) throw E(400, 'The new AN PDF is identical to the PDF of an earlier version');
      pdf = wp;
    }
    const prev = [...st.an_versions].filter(v => v.number < num).sort((x, y) => y.number - x.number)[0], vid = nid();
    st.an_versions.push({id: vid, analysis_id: a.id, number: num, published_on: pub, notes, pdf, change_summary: sv(b, 'change_summary', 60000), change_report: st.working.change_report || '', status: 'published', created: now()});
    st.working = {name: '', entries: [], summary_md: null, summary_reviewed: false, pdf: null, change_report: ''};      // the working version starts over for the next release
    // Stamp the unreleased working draft with this version: it becomes this version's historical record.
    st.plot_versions.forEach(v => { if (!v.an_version_id) v.an_version_id = vid; });
    st.usages.forEach(u => { if (!u.an_version_id && u.type === 'note') u.an_version_id = vid; });   // meeting records are not tied to an AN version
    let carried = 0;
    if (b.carry_figures && prev) {
      const notesOf = id => st.usages.filter(u => u.an_version_id === id && u.type === 'note');
      const keyOf = u => u.fig + '|' + (u.panel || ''), have = new Set(notesOf(vid).map(keyOf)), numOf = id => st.an_versions.find(v => v.id === id).number;
      for (const u of notesOf(prev.id)) {
        if (have.has(keyOf(u))) continue;
        const pv = st.plot_versions.find(x => x.id === u.plot_version_id);
        const lat = st.plot_versions.filter(x => x.plot_id === pv.plot_id && x.an_version_id && numOf(x.an_version_id) <= num).sort((x, y) => y.num - x.num || y.rev - x.rev)[0];
        st.usages.push({id: nid(), analysis_id: a.id, plot_version_id: lat.id, an_version_id: vid, type: 'note', fig: u.fig, panel: u.panel || '', an_ver: 'v' + num, link: '', slide: '', date: '', title: '', created: now(), reviews: []}); carried++;
      }
    }
    a.an_status = 'published';
    return {id: vid, number: num, carried};
  }, {message: 'Publish AN version'}),
  updateVersion: ({aid, id}, b) => tx(aid, (st, io) => {
    const v = byId(st.an_versions, id, 'Version');
    v.published_on = dateOk(sv(b, 'published_on', 10, false, v.published_on) || v.published_on, 'published_on'); v.notes = sv(b, 'notes', 2000, false, v.notes);
    if (b.pdf !== undefined) {
      const old = v.pdf, nw = pdfInfo(b.pdf);
      if (old && old.file_id) { if (nw && old.sha256 === nw.sha256) { nw.file_id = old.file_id; nw.ext = old.ext; } else dropStoredPdf(st, io, old); }
      v.pdf = nw;
    }
    return {ok: true};
  }, {message: 'Edit AN version'}),
  /* the AN PDF itself, stored in the repository so every device (and the group) can open it */
  setVersionPdf: ({aid, id}, b) => tx(aid, (st, io) => {
    const v = byId(st.an_versions, id, 'Version'), info = pdfInfo(b.pdf), fid = sv(b, 'file_id', 40, true), up = PENDING.get(fid);
    if (!info) throw E(400, 'PDF details are missing');
    if (!up || up.aid !== st.analysis.id || up.ext !== '.pdf') throw E(400, 'Upload the PDF first');
    if (st.files.some(f => f.id === fid)) throw E(400, 'That upload was already used');
    if (v.pdf && v.pdf.file_id) dropStoredPdf(st, io, v.pdf);
    st.files.push({id: fid, ext: '.pdf', size: up.blob.size, created: now()}); io.newFiles.push(fid);
    v.pdf = {...info, file_id: fid, ext: '.pdf'}; return {ok: true};
  }, {message: 'Store AN PDF'}),
  removeVersionPdf: ({aid, id}) => tx(aid, (st, io) => {
    const v = byId(st.an_versions, id, 'Version'); if (v.pdf && v.pdf.file_id) { dropStoredPdf(st, io, v.pdf); delete v.pdf.file_id; delete v.pdf.ext; } return {ok: true};
  }, {message: 'Remove stored AN PDF'}),

  /* ---- categories / plots ---- */
  createCategory: ({aid}, b) => tx(aid, st => {
    const name = sv(b, 'name', 100, true), parent = b.parent_id ? byId(st.categories, b.parent_id, 'Category') : null, pid = parent ? parent.id : null;
    if (parent && catDepth(st, parent.id) >= 4) throw E(400, 'Categories can be nested up to 5 levels deep');
    if (st.categories.some(c => (c.parent_id || null) === pid && c.name === name)) throw E(409, 'A category with this name already exists here');
    const c = {id: nid(), analysis_id: st.analysis.id, name, parent_id: pid}; st.categories.push(c);
    const subs = Array.isArray(b.subs) ? b.subs.slice(0, 40) : [];                           // optional subcategories created together with the category
    for (const s of subs) { const n = typeof s === 'string' ? s.trim() : ''; if (!n) continue; if (n.length > 100) throw E(400, 'A subcategory name is too long');
      if (!st.categories.some(x => x.parent_id === c.id && x.name === n)) st.categories.push({id: nid(), analysis_id: st.analysis.id, name: n, parent_id: c.id}); }
    return {id: c.id};
  }, {message: 'Add category'}),
  updateCategory: ({aid, id}, b) => tx(aid, st => {
    const c = byId(st.categories, id, 'Category'), name = sv(b, 'name', 100, false, c.name) || c.name;
    const pid = b.parent_id === undefined ? (c.parent_id || null) : (b.parent_id || null);
    if (pid) {
      byId(st.categories, pid, 'Category');
      if (pid === c.id || catAncestors(st, pid).includes(c.id)) throw E(400, 'A category cannot be moved inside itself');
      if (catDepth(st, pid) + 1 + catHeight(st, c.id) > 4) throw E(400, 'Categories can be nested up to 5 levels deep');
    }
    if (st.categories.some(x => x.id !== c.id && (x.parent_id || null) === pid && x.name === name)) throw E(409, 'A category with this name already exists there');
    c.name = name; c.parent_id = pid; return {ok: true};
  }, {message: 'Edit category'}),
  deleteCategory: ({aid, id}, b) => tx(aid, st => {
    const c = byId(st.categories, id, 'Category'), plots = st.plots.filter(p => p.category_id === c.id), kids = st.categories.filter(x => x.parent_id === c.id);
    if (plots.length || kids.length) {                       // not empty: its contents must be moved somewhere (published plots are never deleted)
      const top = b.move_to === '__top', dest = b.move_to && !top ? byId(st.categories, b.move_to, 'Category') : null;
      if (!b.move_to) throw E(409, 'Category is not empty: choose where to move its plots and subcategories');
      if (plots.length && !dest) throw E(400, 'Plots need a category: choose where to move them');
      if (dest) { const inside = new Set([c.id]); let grow = true; while (grow) { grow = false; st.categories.forEach(x => { if (!inside.has(x.id) && inside.has(x.parent_id)) { inside.add(x.id); grow = true; } }); } if (inside.has(dest.id)) throw E(400, 'Choose a different category: it cannot be inside the one being deleted'); }
      const pid = dest ? dest.id : null;
      kids.forEach(k => { if (st.categories.some(x => x.id !== k.id && x.parent_id === pid && x.name.toLowerCase() === k.name.toLowerCase() && x.id !== c.id)) throw E(409, `The destination already has a subcategory called “${k.name}”`); });
      plots.forEach(p => { if (st.plots.some(x => x.category_id === pid && x.name === p.name)) throw E(409, `The destination already has a plot called “${p.name}”`); });
      kids.forEach(k => { k.parent_id = pid; }); plots.forEach(p => { p.category_id = pid; });
    }
    st.categories = st.categories.filter(x => x.id !== c.id); return {ok: true};
  }, {message: 'Delete category'}),
  async upload({aid}, b, o) {
    await readState(aid);
    const blob = o.raw; if (!blob || !blob.size) throw E(400, 'Empty upload');
    const h = new Uint8Array(await blob.slice(0, 4096).arrayBuffer()), asc = String.fromCharCode(...h), ext =
      (h[0] === 0x89 && asc.slice(1, 4) === 'PNG') ? '.png' : (h[0] === 0xff && h[1] === 0xd8) ? '.jpg' : /^GIF8[79]a/.test(asc) ? '.gif'
        : (asc.slice(0, 4) === 'RIFF' && asc.slice(8, 12) === 'WEBP') ? '.webp' : /<svg/i.test(asc) ? '.svg' : asc.slice(0, 5) === '%PDF-' ? '.pdf' : null;
    if (!ext) throw E(400, 'Unsupported file. Please upload a PNG, JPG, GIF, WebP or SVG image, or a PDF.');
    if (ext === '.pdf' ? blob.size > 50 * 1024 * 1024 : blob.size > 25 * 1024 * 1024) throw E(413, ext === '.pdf' ? 'This PDF is larger than 50 MB. Keep it on your computer instead of storing it in the repository.' : 'Image is too large (max 25 MB)');
    const fid = nid(), typed = new Blob([blob], {type: MIME[ext]});
    PENDING.set(fid, {blob: typed, ext, aid}); IMG_CACHE[fid] = URL.createObjectURL(typed);
    return {file_id: fid, ext};
  },
  createPlot: ({aid}, b) => tx(aid, (st, io) => {
    const person = personOf(st, b);
    const cat = byId(st.categories, sv(b, 'category_id', 40, true), 'Category'), name = sv(b, 'name', 150, true);
    if (st.plots.some(p => p.category_id === cat.id && p.name === name)) throw E(409, 'A plot with this name already exists in that category');
    const p = {id: nid(), analysis_id: st.analysis.id, category_id: cat.id, name, location: sv(b, 'location', 200), era: sv(b, 'era', 40), created: now()}; st.plots.push(p);
    const vid = makeVersion(st, io, p.id, b.version || {}); st.plot_versions.find(v => v.id === vid).person = person; audit(st, 'plot_added', {person, target: p.id, detail: p.name});
    if (b.an_version_id) { const av = byId(st.an_versions, sv(b, 'an_version_id', 40, true), 'AN version'); st.plot_versions.find(v => v.id === vid).an_version_id = av.id; }   // plot of an already published AN version (first version only)
    return {id: p.id, version_id: vid};
  }, {message: 'Add plot'}),
  updatePlot: ({aid, id}, b) => tx(aid, st => {
    const p = byId(st.plots, id, 'Plot'), name = sv(b, 'name', 150, false, p.name) || p.name, cid = b.category_id ? byId(st.categories, b.category_id, 'Category').id : p.category_id;
    if (st.plots.some(x => x.id !== p.id && x.category_id === cid && x.name === name)) throw E(409, 'A plot with this name already exists in that category');
    p.name = name; p.category_id = cid; if (b.location !== undefined) p.location = sv(b, 'location', 200); if (b.era !== undefined) p.era = sv(b, 'era', 40); return {ok: true};
  }, {message: 'Edit plot details'}),
  createVersion: ({aid, pid}, b) => tx(aid, (st, io) => {
    const pl = byId(st.plots, pid, 'Plot'), person = personOf(st, b), id = makeVersion(st, io, pid, b);
    st.plot_versions.find(v => v.id === id).person = person; audit(st, 'plot_version_added', {person, target: pid, detail: pl.name}); return {id};
  }, {message: 'Save new plot version'}),
  /* the analyst's own check of a revised plot (separate from the comment being resolved) */
  setVersionReviewed: ({aid, id}, b) => tx(aid, st => { const v = byId(st.plot_versions, id, 'Version'); v.reviewed = !!b.reviewed; v.reviewed_at = v.reviewed ? now() : null; v.reviewed_by = v.reviewed ? ME().name : ''; return {ok: true}; }, {message: 'Mark plot revision as reviewed'}),
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
    const typ = sv(b, 'type', 10, true); if (!NEW_TYPES.includes(typ)) throw E(400, 'Invalid type');
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
    const {f} = reviewFields(b), r = {id: nid(), analysis_id: st.analysis.id, usage_id: u.id, ...f, scope: b.scope === 'figure' ? 'figure' : 'panel', resolved_more: [], answer: '', anchor: null, status: 'pending', resolved_version_id: null, resolution: '', resolved_at: null, created: now()};
    u.reviews.push(r); return {id: r.id};
  }, {message: 'Add feedback'}),
  updateReview: ({aid, id}, b) => tx(aid, st => {
    const rv = findReview(st, id), {f, st: s0} = reviewFields(b); let s = f.none ? 'pending' : s0;
    if (s === 'resolved' && rv.status !== 'resolved') throw E(400, 'Use the resolve action to mark feedback as resolved');
    liftResp(st, rv); if (s !== 'resolved' && rv.status === 'resolved') { archiveResolution(st, rv, personOf(st, b, false)); rv.resolved_at = null; }
    Object.assign(rv, f, {status: s, resolved_version_id: s === 'resolved' ? rv.resolved_version_id : null}); return {ok: true};
  }, {message: 'Edit feedback'}),
  setReviewStatus: ({aid, id}, b) => tx(aid, st => {
    const rv = findReview(st, id), s = sv(b, 'status', 12, true); if (!OPEN_STATES.includes(s)) throw E(400, 'Use the resolve action to mark a comment as resolved');
    if (rv.status === 'resolved') throw E(400, 'Reopen the comment first'); rv.status = s; return {ok: true};
  }, {message: 'Set comment status'}),
  setAnCommentStatus: ({aid, id}, b) => tx(aid, st => {
    const c = byId(st.an_comments, id, 'Comment'), s = sv(b, 'status', 12, true); if (!OPEN_STATES.includes(s)) throw E(400, 'Use the resolve action to mark a comment as resolved');
    if (c.status === 'resolved') throw E(400, 'Reopen the comment first'); c.status = s; return {ok: true};
  }, {message: 'Set comment status'}),
  deleteReview: ({aid, id}) => tx(aid, st => {
    const rv = findReview(st, id); st.plot_versions.forEach(v => { if (v.review_id === rv.id) v.review_id = null; });
    const u = st.usages.find(x => x.id === rv.usage_id); u.reviews = u.reviews.filter(x => x.id !== rv.id); return {ok: true};
  }, {message: 'Delete feedback'}),
  resolveReview: ({aid, id}, b) => tx(aid, (st, io) => {
    const rv = findReview(st, id), person = personOf(st, b); if (rv.none) throw E(400, 'There is no comment to resolve'); liftResp(st, rv);
    const own = st.usages.find(x => x.id === rv.usage_id), mode = sv(b, 'mode', 10, true), more = !!b.add;
    if (more && rv.status !== 'resolved') throw E(400, 'Resolve the comment first');
    if (mode === 'plot') {
      // which plot was updated: the panel chosen by the user (must belong to the same figure), else the plot the comment is under
      const target = b.usage_id ? byId(st.usages, b.usage_id, 'Record') : own;
      if (own.type === 'note' && (target.type !== 'note' || target.fig !== own.fig || (target.an_version_id || null) !== (own.an_version_id || null))) throw E(400, 'That plot is not part of this figure');
      if (own.type !== 'note' && target.id !== own.id) throw E(400, 'Invalid plot');
      const base = byId(st.plot_versions, target.plot_version_id, 'Plot version'), changes = sv(b, 'changes', 3000, true);
      const vid = makeVersion(st, io, base.plot_id, {file_id: b.file_id, summary: (base.summary + ' - revised after review').slice(0, 140), changes,
        motivation: `Response to ${rv.role}${rv.name ? ' · ' + rv.name : ''}: ${rv.text}`.slice(0, 3000), dataset: base.dataset, code: base.code}, base, rv.id, sv(b, 'file_name', 150) || null);
      if (more) { rv.resolved_more.push(vid); rv.resolution = (rv.resolution + '\n' + changes).trim(); }
      else Object.assign(rv, {status: 'resolved', resolved_version_id: vid, resolution: changes, resolved_at: now()});
    } else if (mode === 'noplot') Object.assign(rv, {status: 'resolved', resolved_version_id: null, resolution: sv(b, 'note', 3000, true), resolved_at: now()});
    else throw E(400, 'Invalid mode');
    if (mode === 'plot') { const nv = st.plot_versions[st.plot_versions.length - 1]; if (nv) nv.person = person; }
    audit(st, 'comment_resolved', {person, target: rv.id, detail: cmtLabel(rv)});
    return {ok: true};
  }, {message: 'Resolve feedback'}),

  /* answer a comment with one or more revised plots: each replaces the plot in the working version (older versions stay in its history) */
  reviseReview: ({aid, id}, b) => tx(aid, (st, io) => {
    const rv = findComment(st, id), person = personOf(st, b); if (rv.none) throw E(400, 'There is no comment to resolve');
    const items = Array.isArray(b.items) ? b.items : []; if (!items.length) throw E(400, 'Add at least one revised plot'); if (items.length > 40) throw E(400, 'Too many plots at once (max 40)');
    if (b.answer !== undefined) { const t = sv(b, 'answer', 5000), mine = [...rv.responses].reverse().find(x => x.person === person && (x.status === 'active' || x.status === 'selected'));
      if (mine) { if (mine.text !== t) { mine.revisions.push({text: mine.text, at: mine.edited_at || mine.at, by: mine.edited_by || mine.login}); mine.text = t; mine.edited_at = now(); mine.edited_by = ME().id; } }
      else if (t) rv.responses.push({id: nid(), person, login: ME().id, text: t, at: now(), status: 'active', revisions: [], events: []});
      syncAnswer(rv); }
    const seen = new Set(), vids = [], lines = [];
    for (const it of items) {
      const p = byId(st.plots, sv(it, 'plot_id', 40, true), 'Plot'); if (seen.has(p.id)) throw E(400, 'Two revised files are for the same plot'); seen.add(p.id);
      const vs = st.plot_versions.filter(v => v.plot_id === p.id).sort((x, y) => x.num - y.num || x.rev - y.rev), prev = vs[vs.length - 1];
      const changes = sv(it, 'changes', 3000, true), why = sv(it, 'why', 3000);
      vids.push(makeVersion(st, io, p.id, {file_id: it.file_id, summary: (prev.summary + ' - revised after review').slice(0, 140), changes,
        motivation: why || `Response to ${rv.role}${rv.name ? ' · ' + rv.name : ''}: ${rv.text}`.slice(0, 3000), dataset: prev.dataset, code: prev.code}, prev, rv.id, sv(it, 'file_name', 150) || null));
      lines.push(`${p.name}: ${changes}`);
    }
    const was = rv.status === 'resolved'; vids.forEach(v => { st.plot_versions.find(x => x.id === v).person = person; }); audit(st, 'plots_revised', {person, target: rv.id, detail: lines.join('; ')});
    vids.forEach(v => { if (!rv.resolved_version_id) rv.resolved_version_id = v; else rv.resolved_more.push(v); });
    rv.resolution = (was ? rv.resolution + '\n' : '') + lines.join('\n'); rv.resolution = rv.resolution.trim();
    if (!was) { rv.status = 'resolved'; rv.resolved_at = now(); }
    return {ok: true, versions: vids};
  }, {message: 'Answer comment with revised plot(s)'}),

  /* ---- comments on the AN text / tables / methodology (not tied to a plot) ---- */
  createAnComment: ({aid}, b) => tx(aid, st => {
    const source = sv(b, 'source', 10, false, 'an') || 'an';
    if (!['an', 'meeting'].includes(source)) throw E(400, 'Invalid source');
    const ver = source === 'an' ? byId(st.an_versions, sv(b, 'an_version_id', 40, true), 'AN version') : null;
    const c = {id: nid(), analysis_id: st.analysis.id, source, an_version_id: ver ? ver.id : null, ...anCommentFields(b, source), answer: '', anchor: null, status: 'pending', resolution: '', resolved_in: null, resolved_at: null, created: now()};
    st.an_comments.push(c); return {id: c.id};
  }, {message: 'Add AN comment'}),
  updateAnComment: ({aid, id}, b) => tx(aid, st => { const c = byId(st.an_comments, id, 'Comment'); Object.assign(c, anCommentFields(b, c.source)); return {ok: true}; }, {message: 'Edit comment'}),
  answerAnComment: setMyResponse,
  /* which file of the LaTeX source belongs to which plot (remembered for the next AN version) */
  setSourceMap: ({aid}, b) => tx(aid, st => {
    const m = b.map && typeof b.map === 'object' ? b.map : {}, ids = new Set(st.plots.map(p => p.id)); st.src_map = st.src_map || {};
    for (const [k, v] of Object.entries(m)) { const key = String(k).slice(0, 300); if (!key) continue; if (v === null) delete st.src_map[key]; else if (ids.has(v)) st.src_map[key] = v; }
    const keys = Object.keys(st.src_map); if (keys.length > 3000) throw E(400, 'Too many remembered source files (limit 3000)');
    return {ok: true, count: keys.length};
  }, {message: 'Remember which source files belong to which plots'}),
  answerReview: setMyResponse,
  anchorAnComment: ({aid, id}, b) => tx(aid, st => { byId(st.an_comments, id, 'Comment').anchor = anchorOk(b.anchor); return {ok: true}; }, {message: 'Place comment in the PDF'}),
  anchorReview: ({aid, id}, b) => tx(aid, st => { findReview(st, id).anchor = anchorOk(b.anchor); return {ok: true}; }, {message: 'Place comment in the PDF'}),
  resolveAnComment: ({aid, id}, b) => tx(aid, st => {
    const c = byId(st.an_comments, id, 'Comment'), note = sv(b, 'note', 3000, true), rin = b.resolved_in ? byId(st.an_versions, b.resolved_in, 'AN version').id : null;
    Object.assign(c, {status: 'resolved', resolution: note, resolved_in: rin, resolved_at: now()}); audit(st, 'comment_resolved', {person: personOf(st, b, false), target: c.id, detail: cmtLabel(c)}); return {ok: true};
  }, {message: 'Resolve AN comment'}),
  reopenAnComment: ({aid, id}, b) => tx(aid, st => { const c = findComment(st, id); archiveResolution(st, c, personOf(st, b, false)); Object.assign(c, {status: 'pending', resolution: '', resolved_in: null, resolved_at: null}); return {ok: true}; }, {message: 'Reopen AN comment'}),
  /* a comment that was recorded as plain AN text turns out to be about a figure: move it onto that figure (nothing is lost) */
  anCommentToFigure: ({aid, id}, b) => tx(aid, st => {
    const c = byId(st.an_comments, id, 'Comment'), u = byId(st.usages, sv(b, 'usage_id', 40, true), 'Record');
    if (c.source !== 'an') throw E(400, 'Only comments on the AN can be moved onto a figure');
    if (u.type !== 'note' || (u.an_version_id || null) !== (c.an_version_id || null)) throw E(400, 'That figure belongs to a different AN version');
    const loc = c.location || '';
    u.reviews.push({id: nid(), analysis_id: st.analysis.id, usage_id: u.id, role: c.role, name: c.name, none: false, text: loc && !/^fig/i.test(loc) ? `${loc}: ${c.text}` : c.text, answer: c.answer || '', responses: c.responses || [], history: c.history || [], anchor: c.anchor || null,
      scope: b.scope === 'figure' ? 'figure' : 'panel', resolved_more: [], status: c.status || 'pending', resolved_version_id: null, resolution: c.resolution || '', resolved_at: c.resolved_at || null, created: c.created});
    st.an_comments = st.an_comments.filter(x => x.id !== c.id); return {ok: true};
  }, {message: 'Attach comment to a figure'}),
  /* delete every comment of one kind in one go: all comments of an AN version (on figures and plain), or all meeting comments. Plots, figures and revised plots stay. */
  deleteAllComments: ({aid}, b) => tx(aid, st => {
    const scope = sv(b, 'scope', 10, true); if (!['an', 'meeting'].includes(scope)) throw E(400, 'Invalid scope');
    const ver = scope === 'an' ? byId(st.an_versions, sv(b, 'an_version_id', 40, true), 'AN version') : null, ids = new Set(); let nR = 0;
    st.usages.filter(u => scope === 'an' ? (u.type === 'note' && u.an_version_id === ver.id) : u.type !== 'note').forEach(u => { u.reviews.forEach(r => ids.add(r.id)); nR += u.reviews.filter(r => !r.none).length; u.reviews = []; });
    const before = st.an_comments.length; st.an_comments = st.an_comments.filter(c => !(scope === 'an' ? (c.source === 'an' && c.an_version_id === ver.id) : c.source === 'meeting'));
    st.plot_versions.forEach(v => { if (v.review_id && ids.has(v.review_id)) v.review_id = null; });
    audit(st, 'comments_deleted', {person: personOf(st, b, false), detail: `${nR + before - st.an_comments.length} comment(s), scope ${scope}`});
    return {reviews: nR, comments: before - st.an_comments.length};
  }, {message: 'Delete all comments'}),
  deleteAnComment: ({aid, id}) => tx(aid, st => { byId(st.an_comments, id, 'Comment'); st.an_comments = st.an_comments.filter(c => c.id !== id); return {ok: true}; }, {message: 'Delete AN comment'}),
  /* many comments from one e-mail, saved as ONE commit: target 'an' = text comment, otherwise the id of a figure / meeting record */
  importComments: ({aid}, b) => tx(aid, st => {
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) throw E(400, 'Nothing to import'); if (items.length > 300) throw E(400, 'Too many comments at once (max 300)');
    const role = sv(b, 'role', 60, true), name = sv(b, 'name', 100), ver = b.an_version_id ? byId(st.an_versions, b.an_version_id, 'AN version') : null;
    const mode = sv(b, 'mode', 10, false, 'an') || 'an', meeting = mode === 'meeting' ? sv(b, 'meeting', 100, true) : '', mdate = mode === 'meeting' ? dateOk(sv(b, 'meeting_date', 10), 'meeting_date') : '';
    let nRev = 0, nAn = 0;
    for (const it of items) {
      const text = sv(it, 'text', 5000, true), loc = sv(it, 'location', 80), target = sv(it, 'target', 40, true), kind = KINDS.includes(it.kind) ? it.kind : 'text';
      if (target === 'an' || target === 'text') {
        if (mode === 'an' && !ver) throw E(400, 'Choose a published AN version to import into');
        st.an_comments.push({id: nid(), analysis_id: st.analysis.id, source: mode, an_version_id: mode === 'an' ? ver.id : null, meeting, meeting_date: mdate, kind, role, name, location: loc, text, answer: '', anchor: null,
          status: 'pending', resolution: '', resolved_in: null, resolved_at: null, created: now()}); nAn++;
      } else {
        const wholeFig = target.endsWith('|figure'), u = byId(st.usages, wholeFig ? target.slice(0, -7) : target, 'Record');
        if (u.type === 'note' && (!u.an_version_id || (ver && u.an_version_id !== ver.id))) throw E(400, 'A figure belongs to a different AN version');
        u.reviews.push({id: nid(), analysis_id: st.analysis.id, usage_id: u.id, role, name, none: false, text: loc && !/^fig/i.test(loc) ? `${loc}: ${text}` : text, answer: '', anchor: null, scope: wholeFig ? 'figure' : 'panel', resolved_more: [],
          status: 'pending', resolved_version_id: null, resolution: '', resolved_at: null, created: now()}); nRev++;
      }
    }
    return {reviews: nRev, an: nAn};
  }, {message: 'Import comments from e-mail'}),

  /* ---- documents ---- */
  createDoc: ({aid}, b) => tx(aid, st => { const d = {id: nid(), analysis_id: st.analysis.id, ...docFields(st, b), author: ME().name, created: now()}; st.documents.push(d); return {id: d.id}; }, {message: 'Add document'}),
  updateDoc: ({aid, id}, b) => tx(aid, st => { const d = byId(st.documents, id, 'Document'); Object.assign(d, docFields(st, b)); return {ok: true}; }, {message: 'Edit document'}),
  deleteDoc: ({aid, id}) => tx(aid, st => { byId(st.documents, id, 'Document'); st.documents = st.documents.filter(d => d.id !== id); return {ok: true}; }, {message: 'Delete document'}),
};

function anCommentFields(b, source = 'an') {
  const kind = sv(b, 'kind', 12, false, 'text') || 'text'; if (!KINDS.includes(kind)) throw E(400, 'Invalid comment kind');
  const f = {role: sv(b, 'role', 60, true), name: sv(b, 'name', 100), location: sv(b, 'location', 80), text: sv(b, 'text', 5000, true), kind, meeting: '', meeting_date: ''};
  if (source === 'meeting') { f.meeting = sv(b, 'meeting', 100, true); f.meeting_date = dateOk(sv(b, 'meeting_date', 10), 'meeting_date'); }
  return f;
}
const catAncestors = (st, id) => { const out = []; let c = st.categories.find(x => x.id === id); while (c && c.parent_id) { out.push(c.parent_id); c = st.categories.find(x => x.id === c.parent_id); } return out; };
const catDepth = (st, id) => catAncestors(st, id).length;                               // 0 = top level
const catHeight = (st, id) => { const kids = st.categories.filter(x => x.parent_id === id); return kids.length ? 1 + Math.max(...kids.map(k => catHeight(st, k.id))) : 0; };
function dropStoredPdf(st, io, pdf) {                        // remove the stored PDF file from the repository
  const f = st.files.find(x => x.id === pdf.file_id); if (!f) return;
  st.files = st.files.filter(x => x !== f);
  if (io.newFiles.includes(f.id)) io.newFiles = io.newFiles.filter(x => x !== f.id); else io.delFiles.push(filePath(st.analysis.id, f));
}
function pdfInfo(p) {
  if (p === null || p === undefined) return null;
  if (typeof p !== 'object') throw E(400, 'Invalid PDF details');
  const sha = sv(p, 'sha256', 64, true).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha)) throw E(400, 'Invalid PDF fingerprint');
  if (!Number.isInteger(p.size) || p.size < 0) throw E(400, 'Invalid PDF size');
  if (p.pages != null && !(Number.isInteger(p.pages) && p.pages > 0)) throw E(400, 'Invalid page count');
  return {name: sv(p, 'name', 200, true), size: p.size, sha256: sha, pages: p.pages ?? null};   // file_id/ext are set only by the server-side store/remove actions
}
/* a highlight in the PDF: page number + rectangles as fractions of the page (independent of zoom) + the highlighted text */
function anchorOk(a) {
  if (a === null || a === undefined) return null;
  if (typeof a !== 'object' || !Number.isInteger(a.page) || a.page < 1 || a.page > 5000 || !['text', 'box'].includes(a.kind)) throw E(400, 'Invalid highlight');
  const n = v => { const x = Number(v); if (!isFinite(x)) throw E(400, 'Invalid highlight'); return Math.round(Math.min(1, Math.max(0, x)) * 10000) / 10000; };
  const rects = (Array.isArray(a.rects) ? a.rects : []).slice(0, 80).map(r => ({x: n(r.x), y: n(r.y), w: n(r.w), h: n(r.h)}));
  if (!rects.length) throw E(400, 'Invalid highlight');
  return {page: a.page, kind: a.kind, rects, quote: sv(a, 'quote', 600)};
}
function usageFields(b, typ) {
  if (typ === 'note') return {fig: sv(b, 'fig', 40, true), panel: sv(b, 'panel', 60), an_ver: sv(b, 'an_ver', 40), link: '', slide: '', date: '', title: ''};
  return {fig: '', panel: '', an_ver: '', link: urlOk(sv(b, 'link', 500), 'link'), slide: sv(b, 'slide', 40), date: dateOk(sv(b, 'date', 10, true), 'date'), title: sv(b, 'title', 150, typ === 'meeting')};
}
function reviewFields(b) {
  const none = !!b.none, text = sv(b, 'text', 5000, !none), s = sv(b, 'status', 10, false, 'pending') || 'pending';
  if (!['pending', 'in_progress', 'resolved'].includes(s)) throw E(400, 'Invalid status');
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
  const dflt = `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}_v${num}${rev ? '_r' + rev : ''}`;
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
  st.usages.forEach(u => u.reviews.forEach(r => { r.resolved_more = (r.resolved_more || []).filter(x => !gone.has(x)); if (gone.has(r.resolved_version_id)) Object.assign(r, {resolved_version_id: null, status: 'pending', resolution: ''}); }));
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
  R('POST', A_ + `\\/versions\\/(?<id>${ID})\\/pdf$`, H.setVersionPdf), R('DELETE', A_ + `\\/versions\\/(?<id>${ID})\\/pdf$`, H.removeVersionPdf),
  R('POST', A_ + '\\/categories$', H.createCategory), R('PATCH', A_ + `\\/categories\\/(?<id>${ID})$`, H.updateCategory),
  R('PATCH', A_ + `\\/plots\\/(?<id>${ID})$`, H.updatePlot), R('POST', A_ + '\\/source-map$', H.setSourceMap), R('POST', A_ + '\\/cadi$', H.setCadi), R('POST', A_ + '\\/team$', H.setTeam), R('POST', A_ + `\\/comments\\/(?<id>${ID})\\/responses\\/(?<rid>${ID})\\/decide$`, H.decideResponse), R('POST', A_ + '\\/working\\/pdf$', H.setWorkingPdf), R('DELETE', A_ + '\\/working\\/pdf$', H.removeWorkingPdf), R('POST', A_ + `\\/versions\\/(?<id>${ID})\\/changes$`, H.setVersionChanges), R('POST', A_ + '\\/working$', H.updateWorking), R('POST', A_ + '\\/working\\/entries$', H.addWorkingEntry), R('DELETE', A_ + `\\/working\\/entries\\/(?<id>${ID})$`, H.deleteWorkingEntry),
  R('POST', A_ + `\\/reviews\\/(?<id>${ID})\\/status$`, H.setReviewStatus), R('POST', A_ + `\\/an-comments\\/(?<id>${ID})\\/status$`, H.setAnCommentStatus), R('DELETE', A_ + `\\/categories\\/(?<id>${ID})$`, H.deleteCategory),
  R('POST', A_ + '\\/upload$', H.upload),
  R('POST', A_ + '\\/plots$', H.createPlot), R('DELETE', A_ + `\\/plots\\/(?<id>${ID})$`, H.deletePlot),
  R('POST', A_ + `\\/plot-versions\\/(?<id>${ID})\\/reviewed$`, H.setVersionReviewed),
  R('POST', A_ + `\\/plots\\/(?<pid>${ID})\\/versions$`, H.createVersion), R('DELETE', A_ + `\\/plot-versions\\/(?<id>${ID})$`, H.deleteVersion),
  R('POST', A_ + '\\/usages$', H.createUsage), R('PATCH', A_ + `\\/usages\\/(?<id>${ID})$`, H.updateUsage), R('DELETE', A_ + `\\/usages\\/(?<id>${ID})$`, H.deleteUsage),
  R('POST', A_ + `\\/usages\\/(?<uid>${ID})\\/reviews$`, H.createReview),
  R('PATCH', A_ + `\\/reviews\\/(?<id>${ID})$`, H.updateReview), R('DELETE', A_ + `\\/reviews\\/(?<id>${ID})$`, H.deleteReview),
  R('POST', A_ + `\\/reviews\\/(?<id>${ID})\\/resolve$`, H.resolveReview),
  R('POST', A_ + `\\/reviews\\/(?<id>${ID})\\/revise$`, H.reviseReview),
  R('POST', A_ + '\\/delete-comments$', H.deleteAllComments),
  R('POST', A_ + '\\/an-comments$', H.createAnComment), R('PATCH', A_ + `\\/an-comments\\/(?<id>${ID})$`, H.updateAnComment), R('DELETE', A_ + `\\/an-comments\\/(?<id>${ID})$`, H.deleteAnComment),
  R('POST', A_ + `\\/an-comments\\/(?<id>${ID})\\/to-figure$`, H.anCommentToFigure),
  R('POST', A_ + `\\/an-comments\\/(?<id>${ID})\\/resolve$`, H.resolveAnComment), R('POST', A_ + `\\/an-comments\\/(?<id>${ID})\\/reopen$`, H.reopenAnComment),
  R('POST', A_ + '\\/import-comments$', H.importComments), R('POST', A_ + '\\/presented$', H.setPresented),
  R('POST', A_ + `\\/an-comments\\/(?<id>${ID})\\/answer$`, H.answerAnComment), R('POST', A_ + `\\/an-comments\\/(?<id>${ID})\\/anchor$`, H.anchorAnComment),
  R('POST', A_ + `\\/reviews\\/(?<id>${ID})\\/answer$`, H.answerReview), R('POST', A_ + `\\/reviews\\/(?<id>${ID})\\/anchor$`, H.anchorReview),
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
const demoLock = () => { GHS.readonly = true; };
async function demoResume() {        // a failed sign-in attempt must not end the demo
  resetSession(); Object.assign(GHS, {token: 'demo', repo: 'demo/sample-data', branch: 'main', demo: true, readonly: true, user: {id: 'visitor', name: 'Demo visitor', email: ''}}); await getHead(); return GHS.user;
}
Object.assign(window, {api, batch, ghDemo, demoLock, demoResume, DEMO_MSG, ghConnect, ghRestore, ghSwitch, ghForget, ghRemove, savedRepo, savedRepos, isRemembered, GHS, imgCached, fetchImage});
})();
