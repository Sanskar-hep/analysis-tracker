/* Team list ("who is this?"), responses to comments with their history, and the activity log.
   The owner writes the list of names; whoever opens the analysis picks theirs. This identifies people for the record: it is not a password.
   Every saved change also records the GitHub account that made it, which is what GitHub itself has verified. */
window.TEAM = (() => {
  const names = () => (S.an.team || []).map(t => t.name);
  const isOwnerU = () => S.an.owner === U.id;
  const who = () => (ui.who && ui.who[S.an.id]) || '';
  const local = t => new Date(t).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'});
  const utc = t => new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const time = t => `<time title="${utc(t)}">${esc(local(t))}</time>`;
  const NOTE = 'Choosing a name identifies you in the record. It is not a password: access to the data is controlled by GitHub.';

  /* ---------- "who is this?" when an analysis is opened ---------- */
  function needWho() { return names().length > 0 && !who(); }
  function whoModal() {
    if (document.getElementById('whoov')) return;
    const m = document.createElement('div'); m.className = 'overlay'; m.id = 'whoov';
    const owner = isOwnerU();
    m.innerHTML = `<div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="whoh"><header><h3 id="whoh">Who is this?</h3></header>
      <p class="sub">Analysis: <b>${esc(S.an.title)}</b>. Click your name to continue. ${NOTE}</p>
      <div class="mbody"><div class="whogrid">${names().map(n => `<button type="button" class="whobtn" data-who="${esc(n)}"><span class="whoav">${esc(n.trim()[0] || '?').toUpperCase()}</span>${esc(n)}</button>`).join('')}</div>
        ${owner ? `<p class="meta" style="margin:14px 0 0">You are the owner. Not on the list? <button type="button" class="link" data-who="${esc(S.an.owner_name || S.an.owner)}" data-owner="1">Continue as ${esc(S.an.owner_name || S.an.owner)}</button> and edit the list in Settings.</p>` : `<p class="meta" style="margin:14px 0 0">Your name is not here? Ask the analysis owner to add it.</p>`}</div>
      <footer><a class="btn" href="#/">← All analyses</a></footer></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => {
      const b = e.target.closest('[data-who]'); if (!b) return;
      ui.who = ui.who || {}; ui.who[S.an.id] = b.dataset.who; m.remove(); render();
      toast('Working as ' + b.dataset.who);
    });
    m.querySelector('.whobtn')?.focus();
  }
  /* called after every render: ask who this is before anything else */
  function gate() {
    if (!needWho()) return false;
    whoModal(); return true;
  }
  const chip = () => !names().length ? '' : `<button class="btn sm" data-act="team" data-op="switch" title="Change who you are working as">👤 ${who() ? esc(who()) : 'Choose name'}</button>`;

  /* ---------- Settings card: the owner's list of names ---------- */
  function settingsCard() {
    const list = S.an.team || [], own = isOwnerU();
    return `<div class="card pad" style="max-width:760px;display:grid;gap:12px;margin-top:16px"><div><h3 style="margin:0 0 4px">Team members</h3>
      <p class="meta" style="margin:0">${own ? 'People who may answer comments and add plots. When this list has names, everyone who opens the analysis is asked who they are.' : 'The people the owner has listed for this analysis.'}</p></div>
      ${list.length ? `<div class="teamlist">${list.map(t => `<span class="teamchip">${esc(t.name)}${own ? `<button type="button" class="x" data-act="team" data-op="remove" data-name="${esc(t.name)}" title="Remove from the list (their earlier work stays)" aria-label="Remove ${esc(t.name)}">×</button>` : ''}</span>`).join('')}</div>` : '<p class="meta" style="margin:0">No names yet, so nobody is asked who they are.</p>'}
      ${own ? `<form class="teamadd" data-team-add><input type="text" name="names" placeholder="Add names, separated by commas (e.g. Anil Kumar, Priya Singh)" maxlength="600" aria-label="Names to add"><button class="btn primary">Add</button></form>` : ''}
      <p class="meta" style="margin:0">${NOTE} Removing a name keeps everything that person already wrote. <a href="${L('/activity')}">View the activity log</a>.</p></div>`;
  }
  async function saveTeam(next) {
    await api('POST', aurl('/team'), {names: next}); await reload();
  }

  /* ---------- responses under a comment ---------- */
  const ST = {active: ['Active', 'r-act'], selected: ['Selected ✓', 'r-sel'], discarded: ['Discarded', 'r-dis'], superseded: ['Superseded', 'r-sup']};
  function eventLine(r) {
    const e = (r.events || [])[(r.events || []).length - 1]; if (!e) return '';
    const verb = {select: 'Selected', unselect: 'Unselected', discard: 'Discarded', restore: 'Restored', superseded: 'Superseded'}[e.action] || e.action;
    return `<div class="rmeta">${verb} by <b>${esc(e.by)}</b> · ${time(e.at)}${e.reason ? ` · “${esc(e.reason)}”` : ''}</div>`;
  }
  function row(cid, r, owner) {
    const [lab, cls] = ST[r.status] || ST.active, revs = r.revisions || [];
    const btns = !owner ? '' : r.status === 'discarded' ? `<button class="btn sm" data-act="team" data-op="restore" data-cid="${cid}" data-rid="${r.id}">Restore</button>`
      : `${r.status === 'selected' ? `<button class="btn sm" data-act="team" data-op="unselect" data-cid="${cid}" data-rid="${r.id}">Unselect</button>` : `<button class="btn sm primary" data-act="team" data-op="select" data-cid="${cid}" data-rid="${r.id}">Accept</button>`}<button class="btn sm" data-act="team" data-op="discard" data-cid="${cid}" data-rid="${r.id}">Discard…</button>`;
    return `<div class="resprow ${cls}"><div class="rhead"><b>${esc(r.person)}</b>${r.earlier ? ' <span class="meta">(written before the history existed)</span>' : ''}<span class="rmeta"> · GitHub account <span class="mono">${esc(r.login)}</span> · ${time(r.at)}${r.edited_at ? ` · edited ${time(r.edited_at)}` : ''}</span><span class="badge ${cls}">${lab}</span></div>
      <div class="rtext${r.status === 'discarded' ? ' struck' : ''}">${(r.text || '').trim() ? esc(r.text) : '<i class="meta">(empty)</i>'}</div>${eventLine(r)}
      ${revs.length ? `<details class="rrev"><summary>Earlier wording (${revs.length})</summary>${revs.map(v => `<div class="rtext old">${esc(v.text) || '<i>(empty)</i>'}<div class="rmeta">${time(v.at)}</div></div>`).join('')}</details>` : ''}
      ${btns ? `<div class="ract">${btns}</div>` : ''}</div>`;
  }
  function block(kind, item) {
    const rs = [...(item.responses || [])].sort((a, b) => a.at - b.at), me = who() || U.name, owner = isOwnerU();
    const mine = [...rs].reverse().find(r => r.person === me && (r.status === 'active' || r.status === 'selected'));
    const nsel = rs.filter(r => r.status === 'selected').length, others = rs.filter(r => r !== mine).length;
    const open = ui.openResp && ui.openResp[item.id];
    const hist = (item.history || []).length ? `<div class="rmeta" style="margin-top:6px">Reopened ${(item.history || []).length}× — earlier resolutions are kept below.</div>` + (item.history || []).map(h => `<div class="resprow r-sup"><div class="rhead"><b>Earlier resolution</b><span class="rmeta"> · resolved ${h.resolved_at ? time(h.resolved_at) : ''} · reopened ${time(h.reopened_at)} by ${esc(h.reopened_by)}</span></div>${h.resolution ? `<div class="rtext">${esc(h.resolution)}</div>` : ''}</div>`).join('') : '';
    return `<div class="ansbox"><label>${names().length ? `Your response · as <b>${esc(me)}</b>` : 'Your response'}</label>
      <textarea class="ans" data-kind="${kind}" data-id="${item.id}" rows="2" maxlength="5000" placeholder="Write your reply to this comment…">${esc(mine ? mine.text : '')}</textarea><span class="saved" aria-live="polite"></span></div>
      ${rs.length ? `<details class="resp" data-resp="${item.id}" ${open ? 'open' : ''}><summary>${rs.length} response${rs.length > 1 ? 's' : ''}${nsel ? ` · ${nsel} accepted` : ''}${others ? ` · from ${new Set(rs.map(r => r.person)).size} ${new Set(rs.map(r => r.person)).size > 1 ? 'people' : 'person'}` : ''} — view history</summary>
        <div class="resplist">${rs.map(r => row(item.id, r, owner)).join('')}${hist}</div></details>` : (item.history || []).length ? `<details class="resp"><summary>Earlier resolutions</summary><div class="resplist">${hist}</div></details>` : ''}`;
  }

  /* ---------- activity log page ---------- */
  const ACT = {response_added: 'added a response', response_edited: 'edited a response', response_select: 'accepted a response', response_unselect: 'unselected a response', response_discard: 'discarded a response', response_restore: 'restored a response',
    comment_resolved: 'resolved a comment', comment_reopened: 'reopened a comment', comments_deleted: 'deleted comments', plot_added: 'added a plot', plot_version_added: 'added a plot version', plots_revised: 'uploaded revised plots', team_changed: 'changed the team list'};
  function view() {
    const f = ui.af || {p: '', a: ''}, ev = [...(S.audit || [])].reverse();
    const people = [...new Set(ev.map(e => e.person))], acts = [...new Set(ev.map(e => e.action))];
    const shown = ev.filter(e => (!f.p || e.person === f.p) && (!f.a || e.action === f.a)).slice(0, 400);
    return `<div class="pagehead"><div><h1>Activity log</h1><p>Who did what, and when. Entries can only be added: the site has no way to edit or remove them, and GitHub also keeps the full history of every change.</p></div></div>
      <div class="card pad" style="margin-bottom:14px"><div class="cols"><div class="f"><label class="l">Person</label><select data-af="p"><option value="">Everyone</option>${people.map(p => `<option ${f.p === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div>
        <div class="f"><label class="l">Action</label><select data-af="a"><option value="">All actions</option>${acts.map(a => `<option value="${esc(a)}" ${f.a === a ? 'selected' : ''}>${esc(ACT[a] || a)}</option>`).join('')}</select></div></div></div>
      ${shown.length ? `<div class="card" style="overflow:auto"><table class="vtable"><tr><th>When</th><th>Person</th><th>GitHub account</th><th>Action</th><th>Details</th></tr>${shown.map(e => `<tr><td>${time(e.at)}</td><td><b>${esc(e.person)}</b></td><td class="mono">${esc(e.actor)}</td><td>${esc(ACT[e.action] || e.action)}</td><td>${esc(e.detail)}${e.reason ? `<div class="meta">Reason: ${esc(e.reason)}</div>` : ''}</td></tr>`).join('')}</table></div>` : '<div class="card empty"><p>Nothing recorded yet. Responses, decisions, resolved or reopened comments, new plots and changes to the team list appear here.</p></div>'}
      <p class="meta" style="margin-top:10px">Actions before this log existed are not listed. ${NOTE}</p>`;
  }

  /* ---------- clicks ---------- */
  function discardModal(cid, rid) {
    openModal({title: 'Discard this response', submit: 'Discard', sub: 'The response stays in the history, marked as discarded, together with your reason.',
      body: field('Reason', '<textarea name="reason" required maxlength="1000" rows="3" placeholder="e.g. Superseded by Anil’s answer, which uses the final binning."></textarea>'),
      onSubmit: async fd => { const reason = fd.get('reason').trim(); if (!reason) { toast('A reason is required', 'err'); return false; }
        await api('POST', aurl(`/comments/${cid}/responses/${rid}/decide`), {action: 'discard', reason}); await reload(); toast('Response discarded (kept in the history)'); }});
  }
  async function act(el) {
    const op = el.dataset.op;
    if (op === 'switch') { ui.who[S.an.id] = ''; render(); return; }
    if (op === 'discard') return discardModal(el.dataset.cid, el.dataset.rid);
    if (['select', 'unselect', 'restore'].includes(op)) { await api('POST', aurl(`/comments/${el.dataset.cid}/responses/${el.dataset.rid}/decide`), {action: op}); await reload(); return; }
    if (op === 'remove') { const n = el.dataset.name; confirmBox('Remove from the list', `Remove <b>${esc(n)}</b>? Everything this person wrote stays in the history.`, 'Remove', () => saveTeam(names().filter(x => x !== n))); }
  }
  document.addEventListener('submit', async e => {
    const f = e.target.closest && e.target.closest('[data-team-add]'); if (!f) return; e.preventDefault();
    const add = f.names.value.split(/[,;\n]/).map(s => s.trim()).filter(Boolean); if (!add.length) return;
    try { await saveTeam([...names(), ...add]); toast('Team list updated'); } catch (err) { toast(err.message, 'err'); }
  });
  document.addEventListener('toggle', e => { const d = e.target; if (d.matches && d.matches('details.resp[data-resp]')) { ui.openResp = ui.openResp || {}; ui.openResp[d.dataset.resp] = d.open; } }, true);
  document.addEventListener('change', e => { const s = e.target; if (s.matches && s.matches('[data-af]')) { ui.af = ui.af || {p: '', a: ''}; ui.af[s.dataset.af] = s.value; render(); } });

  return {gate, chip, settingsCard, block, view, act, who};
})();
