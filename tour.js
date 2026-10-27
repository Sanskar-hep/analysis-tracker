/*! Analysis-Tracker - Copyright (c) 2026 Sanskar Nanda - MIT License (see LICENSE). https://github.com/Sanskar-hep */
/* Guided tours of the public demo: a spotlight on the real button or panel, and a short explanation of how to use it.
 * Every tour runs on the demo's sample data. Buttons that would change data are only explained (the demo is read-only);
 * buttons that are safe to open (exports, Make Slides) have a "Try it" button.
 * RULE FOR NEW FEATURES: add sample data for it in the demo (createDemoInner / createHiggsDemo in app.js) and a tour here. */
window.TOUR = (() => {
  'use strict';
  const $q = (s, r = document) => r.querySelector(s);
  const idOf = key => (AL.find(a => a.title.includes(key)) || {}).id;
  const TQ = () => idOf('Top-Quark'), HG = () => idOf('H→γγ');
  const A = (key, path = '') => () => `#/a/${key()}${path}`;
  const plotPath = name => () => { const p = S && S.plots.find(x => x.name === name); return p ? `#/a/${S.an.id}/plot/${p.id}` : null; };
  const pdfPath = () => { const v = S && S.anv.find(a => a.number === 2) || (S && S.anv[S.anv.length - 1]); return v ? `#/a/${S.an.id}/pdf/${v.id}` : null; };
  const deckPath = () => { const id = [...MS.state.mem.keys()][0]; return id ? '#/slides/p/' + id : '#/slides'; };

  /* Each step: sel (what to light up), title, text, go (a route to open first), wait (selector to wait for), next (run when "Next" is pressed), try ({label, run}) */
  const TOURS = [
    {id: 'start', icon: '🧭', title: 'Find your way around', blurb: 'The menu, versions and search. Start here.', start: A(TQ), steps: [
      {sel: '#side .aname', title: 'One workspace per analysis', text: 'Everything about one analysis lives here: plots, comments, AN versions and releases. This demo analysis is invented sample data.'},
      {sel: '#side .nav a[href$="/gallery"]', title: 'Plot Gallery', text: 'All plots grouped by variable, with every version kept. You add plots here, one at a time or many at once.'},
      {sel: '#side .nav a[href$="/reviewer"]', title: 'Comments', text: 'Convener and reviewer comments, your replies, and the plots you revised in response. The number is how many are still open.'},
      {sel: '#side .nav a[href$="/versions"]', title: 'Version History', text: 'Every published AN version, frozen as it was reviewed, with its PDF.'},
      {sel: '#side .nav a[href$="/release"]', title: 'Release & Export', text: 'Where you prepare the next AN version: what is ready, the change summary, and the download package.'},
      {sel: '#side a[href="#/slides"]', title: 'Meeting Slides', text: 'Build a talk for a group or collaboration meeting from your plots and your own text.'},
      {sel: '#top .ctxsel', title: 'Published or working draft', text: 'Switch between an AN version as it was published and the working draft. Published versions never change; new work goes into the draft.'},
      {sel: '#top .search', title: 'Search', text: 'Find any plot in this analysis by name.'},
    ]},
    {id: 'plots', icon: '📈', title: 'Plots, versions and categories', blurb: 'Add plots, keep every version, compare them.', start: A(TQ, '/gallery'), steps: [
      {sel: '[data-act=new-plot]', title: 'Add a plot', text: 'Give it a name, a category and where it appears in the AN, then add its first version. <b>In your own workspace this opens a form.</b> Here the demo is read-only, so it asks you to sign in.'},
      {sel: '[data-act=bulk-plots]', title: 'Upload many plots at once', text: 'Drop a whole folder of plot files. The tracker reads the variable and the data-taking era from each file name (for example <code>m_ll_2017.png</code>) and groups them for you.'},
      {sel: '[data-act=new-cat]', title: 'Categories and subcategories', text: 'Organise plots like Electron / Data-MC comparisons / HLT efficiency. Subcategories can be nested as deep as you like.'},
      {sel: '#main .gal', title: 'The gallery', text: 'Each card is a plot with its newest version. Click one to see its whole history.'},
      {go: plotPath('Leading electron pT'), sel: '#main .bigimg', title: 'One plot, many versions', text: 'The big picture is the version you selected. Use the buttons to view it side by side, as a swipe, or overlaid with another version.'},
      {sel: '#main .vitem', title: 'Every version keeps its story', text: 'Each version records <b>what changed</b> and <b>why</b>, the dataset and a link to the code. Click a version to view it.'},
      {sel: '[data-act=new-ver]', title: 'Add a new version', text: 'When the plot changes, upload the new picture with a reason. The old version is never overwritten.'},
      {sel: '[data-act=go-cmp]', title: 'Compare versions', text: 'Open any two versions together to see exactly what changed.'},
      {sel: '#main .usehead', title: 'Where the plot is used', text: 'The AN figure or meeting slide that uses this version, with the comments about it underneath.'},
    ]},
    {id: 'comments', icon: '💬', title: 'Comments and replies', blurb: 'Import comments, answer them, resolve with a revised plot.', start: A(TQ, '/reviewer'), steps: [
      {sel: '.legend', title: 'Colours show the state', text: 'Every comment has a coloured bar: purple = in progress, green = answered or resolved, red = open. The ones you have started on or answered are listed first, so you do not have to search.'},
      {sel: '[data-act=add-anc]', title: 'Add a comment', text: 'Type in a comment from a convener or reviewer: on a figure, a table, an equation or the analysis in general.'},
      {sel: '[data-act=import-email]', title: 'Paste an email, get separate comments', text: 'Paste the whole review email. The tracker splits it into one comment per point and links a comment that mentions “Fig 10” to Fig 10.'},
      {sel: '[data-act=add-figure]', title: 'A figure with several plots', text: 'For figures made of several panels, such as one plot per era, record all the plots that belong to the figure.'},
      {sel: '[data-act=link-comments]', title: 'Link comments to figures', text: 'Puts every comment that mentions a figure onto that figure automatically.'},
      {sel: '#main textarea.ans', title: 'Write your reply', text: 'Type your answer. It saves itself when you click away. If your group uses a team list, each person’s reply is kept separately.'},
      {sel: '[data-act=resolve]', title: 'Resolve with a revised plot', text: 'Close a comment by uploading the revised plot and saying what you changed. The revised plot, your reply and the comment stay linked.'},
      {sel: '[data-act=rfilter]', title: 'Filters', text: 'Show only open comments, only those in progress, or only resolved ones.'},
      {sel: '[data-act=open-pdf]', title: 'Open the AN PDF', text: 'Open the PDF next to the comments and mark the exact place a comment is about.'},
      {sel: '[data-act=reply-doc]', title: 'Point-by-point reply document', text: 'One click builds the reply document for the conveners: each comment, your answer and the plot that fixed it.'},
    ]},
    {id: 'meetings', icon: '🗓️', title: 'Meetings', blurb: 'Plots you showed and the comments you got.', start: A(TQ, '/meetings'), steps: [
      {sel: '[data-act=add-mplot]', title: 'Record a plot shown in a meeting', text: 'Pick the plot version you presented, the meeting name and date, and the slide number.'},
      {sel: '[data-act=add-mcomment]', title: 'Methodology and general comments', text: 'Suggestions that are not about one plot, such as “also measure it as a function of the top-pair mass”.'},
      {sel: '[data-act=import-email]', title: 'Import comments from email', text: 'Paste the meeting notes or an email and get one comment per point.'},
      {sel: '[data-act=mfilter]', title: 'Filter by meeting', text: 'Show one meeting at a time.'},
      {sel: '#main .sechead', title: 'Everything from one meeting together', text: 'Each meeting lists the plots you showed and the comments, with your replies and their status.'},
    ]},
    {id: 'versions', icon: '📚', title: 'AN versions and the PDF viewer', blurb: 'Publish a version, open its PDF, scan its figures.', start: A(TQ, '/versions'), steps: [
      {sel: '[data-act=publish]', title: 'Publish an AN version', text: 'Freezes what was released: which plot versions are in which figure. Figures from the previous version are carried forward for you.'},
      {sel: '[data-act=open-pdf]', title: 'Open the PDF', text: 'Each version can keep its PDF in your private repository, so it opens on every device.'},
      {go: pdfPath, sel: '#pdfpane, #main .pdftools', wait: '#main .pdftools', title: 'The PDF viewer', text: 'Read the AN here and mark places for comments: highlight text or draw a box. A comment then points to the exact page.'},
      {sel: '[data-act=pdf][data-op=tool]', title: 'Highlight or draw', text: 'Choose a tool, then select text or drag a box on the page.'},
      {sel: '[data-act=pdf][data-op=scan]', title: 'Scan the figures', text: 'The tracker reads the figure captions (“Figure 4.2: …”) and proposes which plot is which figure, so you do not have to type figure numbers.'},
    ]},
    {id: 'release', icon: '📦', title: 'Release and package', blurb: 'Check what is ready, then download the package.', start: A(TQ, '/release'), steps: [
      {sel: '#main .tiles', title: 'What is ready', text: 'A quick view of the working draft: how many plots are new, updated or unchanged against the last release, and what still needs attention.'},
      {sel: '#main .sumsec', title: 'Change summary', text: 'A written summary of every change since the last version, built from the reasons you recorded. Edit it and mark it reviewed.'},
      {sel: '[data-act=rel]', title: 'Download the package', text: 'A zip with the plots, the comments and responses, the change summary and a manifest. Publishing and downloading unlock once the new AN PDF is uploaded.'},
      {sel: '[data-act=anf]', title: 'Finishing the review round', text: 'Upload your LaTeX source: the tracker updates the figures to the new plot files, and adds “Fig. 4.2, p. 13” references to your replies.'},
      {sel: '[data-act=gdoc]', title: 'Export to Google Docs', text: 'Every comment, reply and plot in one document that opens as a Google Doc.', try: {label: 'Try it: build the document', run: () => GDOC.run()}},
    ]},
    {id: 'compare', icon: '🔍', title: 'Compare two AN versions', blurb: 'See what changed between two PDFs.', start: A(TQ, '/compare-an'), steps: [
      {sel: '#main .actions, #main .card', title: 'Pick two versions', text: 'Choose two AN versions (or the working draft). Their PDFs are read in your browser.'},
      {sel: '#main .ancsec, #main .card.empty, #main .card', title: 'What changed, section by section', text: 'Changed sections open with the differences highlighted. Unchanged sections stay folded away, so you only read what is new.'},
      {sel: '#main .ancpair, #main .ancpanels, #main .card', title: 'Figures side by side', text: 'New and changed figures are shown next to each other.'},
    ]},
    {id: 'eras', icon: '🗂️', title: 'Eras and reminders in the gallery', blurb: 'One variable across data-taking eras.', start: A(HG, '/gallery'), steps: [
      {sel: '#main .egroup', title: 'One variable, every era', text: 'Plots named like <code>m_gg_2017</code> are grouped by variable. Each era sits in a fixed slot, in order: 2016preVFP, 2016postVFP, 2017, 2018.'},
      {sel: '#main .ecell', title: 'Newest version per era', text: 'Every slot shows the newest version for that era. Click to open the plot.'},
      {sel: '#main .egroup .ecell.miss, #main .egroup .ecell:last-child, #main .egroup', title: 'A reminder for the missing era', text: 'The 2018 slot is empty on purpose: the gallery reminds you that this variable has no plot for that era yet.'},
    ]},
    {id: 'cadi', icon: '🏷️', title: 'CADI line status', blurb: 'Mark whether the analysis has a CADI line.', start: A(HG, ''), steps: [
      {sel: '#main .badge.cadi, #main h1', title: 'The CADI badge', text: 'When an analysis has a CADI line, a CADI badge shows next to it everywhere: the list, the menu and the overview. The line in this demo is invented.'},
      {go: A(HG, '/settings'), sel: '[data-act=cadi]', title: 'Set it once', text: 'The first time you open an analysis the tracker asks if it has a CADI line. You can change the answer, the line name and link here.'},
    ]},
    {id: 'team', icon: '👥', title: 'Team list and “Who is this?”', blurb: 'Several people, several replies, one record.', start: A(HG, ''), before: () => { ui.who = {}; }, steps: [
      {sel: '#whoov .modal', wait: '#whoov', title: '“Who is this?”', text: 'The owner writes the names of the people who may answer comments and add plots. Whoever opens the analysis clicks their own name. <b>This identifies people in the record; it is not a password.</b> GitHub decides who can open the data.', next: () => { const b = $q('#whoov [data-who="Dana Lee"]'); if (b) b.click(); }},
      {sel: '[data-act=team][data-op=switch]', title: 'Working as…', text: 'Your name is shown here. Click it to switch to another person on the list.'},
      {go: A(HG, '/reviewer'), sel: '#main details.resp, #main .resplist', wait: '#main .resplist, #main details.resp', title: 'Every reply is kept', text: 'Each person’s reply is its own entry with their name, the GitHub account that saved it, and the time. If someone edits their reply, the earlier wording is kept.'},
      {sel: '[data-act=team][data-op=select], [data-act=team][data-op=discard], [data-act=team][data-op=restore]', title: 'Accept or discard', text: 'The analysis owner accepts the answers that go into the reply document and can discard others, <b>with a reason</b>. Nothing is deleted, and a discarded reply can be restored.'},
      {go: A(HG, '/settings'), sel: '[data-team-add], #main .card', title: 'The owner’s list', text: 'The owner adds or removes names here. Removing a name keeps what that person wrote.'},
      {go: A(HG, '/activity'), sel: '#main .card, #main table', title: 'Activity log', text: 'Who did what and when: replies, decisions, new plots, resolved and reopened comments. You can filter by person or action. It can only grow; nothing is edited or deleted.'},
    ]},
    {id: 'gdocs', icon: '📄', title: 'Export to Google Docs', blurb: 'Comments, replies and plots in one document.', start: A(TQ, '/reviewer'), steps: [
      {sel: '[data-act=gdoc]', title: 'One document with everything', text: 'Opens the export window: create a linked Google Doc that updates itself, or download the file. The document lists in-progress and answered comments first, with a colour for each state, in a plain numbered report layout.', try: {label: 'Try it: build the document', run: () => GDOC.run()}},
      {sel: '[data-gsync]', title: 'A Google Doc that stays up to date', text: 'Once you link a Google Doc, it is refreshed a few seconds after you answer or resolve a comment, while this site is open. Here it is shown as linked (demo). It needs a one-time Google setup of your own; if your Google sign-in has lapsed, an Update now button appears.'},
      {sel: '[data-act=reply-doc]', title: 'Or the point-by-point reply', text: 'The shorter reply document for the conveners, built from your answers.'},
    ]},
    {id: 'quickslides', icon: '🖼️', title: 'Quick slides from plots', blurb: 'Tick plots, get a PowerPoint file.', start: A(TQ, '/gallery'), steps: [
      {sel: '[data-act=slides]', title: 'Make slides', text: 'Tick plots and versions; each becomes a slide with its picture and the facts recorded for it. Optional before/after slides and a comments slide. You get a PowerPoint file that Google Slides opens.', try: {label: 'Try it: choose plots', run: () => SLIDES.run()}},
    ]},
    {id: 'meetingslides', icon: '🎤', title: 'Meeting Slides in three steps', blurb: 'Choose content, edit the slides, export.', start: () => '#/slides', steps: [
      {sel: '.mtypes', title: 'Choose the kind of meeting', text: 'Group meeting, collaboration meeting, or from scratch. This only sets a starting point: every slide can be changed. <b>Meeting Slides is marked Experimental</b>: it is new, so check each slide before you present.'},
      {sel: '.pres', title: 'A sample presentation', text: 'This sample was made from the demo analysis; its text is invented. Your own presentations are saved in your data repository.'},
      {go: deckPath, sel: '#msTop .steps', wait: '#msTop .steps', title: 'Three simple steps', text: 'Everything happens in order: <b>1 Choose content</b>, <b>2 Edit slides</b>, <b>3 Export</b>. You can click any step at any time.', next: () => { const b = $q('#msTop [data-t="1"]'); if (b) b.click(); }},
      {sel: '#msBody .plotlist', wait: '#msBody .stepwrap', title: 'Step 1: tick your plots', text: 'The plots of the analysis you chose. Tick the ones you want to show. Each one becomes a slide. You can also add your own text slide or upload your own figure.'},
      {sel: '#msBody .opts', title: 'More options (you can ignore these)', text: 'Plots per slide, the meeting outline, an agenda slide and optional review comments. The defaults are fine for most talks.'},
      {sel: '#msTop [data-ms=make]', title: 'Make slides', text: 'Turns what you ticked into slides. It writes no physics text for you: text next to a plot comes only from what is recorded for that plot.', next: () => { const b = $q('#msTop [data-t="2"]'); if (b) b.click(); }},
      {sel: '#msCenter .canvaswrap', wait: '#msCenter .msslide', title: 'Step 2: edit your slides', text: 'This is the slide. <b>Click any text to change it.</b> In a bullet list, press <b>Tab</b> to make a bullet a sub-point. Click an empty box to add a plot.'},
      {sel: '#msLeft .thumbs', title: 'Your slides', text: 'All slides in order. Click one to open it. Drag one to move it.'},
      {sel: '#msRight .layoutpick', title: 'Change the layout', text: 'Pick how the slide is arranged: plot with text, plots only, or text only. “Pick a layout for me” chooses one for you.'},
      {sel: '#msRight .themepick', title: 'Choose a look', text: 'Four themes. Fonts, colours and the footer are under “More style options”.', next: () => { const b = $q('#msTop [data-t="3"]'); if (b) b.click(); }},
      {sel: '#msBody .exportcards', wait: '#msBody .stepwrap', title: 'Step 3: export', text: '<b>Download PowerPoint</b> gives you a file that also opens in Google Slides (upload it to Drive). <b>Export to Google Slides</b> does the upload for you after a one-time Google setup.'},
      {sel: '#msBody [data-ms=save]', title: 'Save a version', text: 'Your work saves itself while you edit. “Save a version” keeps a copy you can return to. If a plot gets a newer version later, the slide tells you and lets you keep, replace or compare. It never swaps a plot silently.'},
    ]},
  ];

  /* ---------------- engine ---------------- */
  let st = null, root = null, hidden = false;
  const gate = () => { const g = $q('#whoov'); if (g && st && !st.step.wait) { const o = g.querySelector('[data-owner]') || g.querySelector('[data-who]'); if (o) o.click(); } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function waitFor(sel, ms = 5000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const el = sel && $q(sel); if (el && el.getBoundingClientRect().width > 0) return el; await sleep(120); } return null; }
  function ensureRoot() {
    if (root) return root; root = document.createElement('div'); root.id = 'tourov';
    root.innerHTML = '<div class="tour-block"></div><div class="tour-spot" hidden></div><div class="tour-card" role="dialog" aria-live="polite"></div>';
    document.body.appendChild(root); return root;
  }
  function stop() { st = null; hidden = false; if (root) { root.remove(); root = null; } window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('keydown', onKey, true); }
  function onKey(e) { if (!st || hidden) return; if (e.key === 'Escape') { stop(); } else if (e.key === 'ArrowRight') { go(1); } else if (e.key === 'ArrowLeft') { go(-1); } }
  async function start(id) {
    const t = TOURS.find(x => x.id === id); if (!t) return;
    document.querySelectorAll('.overlay').forEach(o => o.remove());
    stop(); st = {t, i: 0, step: t.steps[0]}; ensureRoot();
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true); document.addEventListener('keydown', onKey, true);
    if (t.before) t.before();
    const target = t.start(); if (target && location.hash !== target) { location.hash = target; await sleep(500); } else if (target) { render(); await sleep(100); }
    await show(0);
  }
  async function show(i) {
    const t = st.t; st.i = i; st.step = t.steps[i]; const s = st.step;
    paint(null, true);
    if (s.go) { const h = typeof s.go === 'function' ? s.go() : s.go; if (h && location.hash !== h) { location.hash = h; await sleep(450); } }
    if (!s.wait) gate();
    const el = await waitFor(s.wait || s.sel, 4500);
    if (!st) return;
    const target = el || await waitFor(s.sel, 1500);
    if (target) { target.scrollIntoView({block: 'center', behavior: 'instant'}); await sleep(60); }
    paint(target, false);
  }
  function go(d) {
    if (!st) return; const n = st.i + d; if (st.step.next && d > 0) { try { st.step.next(); } catch {} }
    if (n < 0) return; if (n >= st.t.steps.length) { const next = TOURS[TOURS.findIndex(x => x.id === st.t.id) + 1]; stop(); finish(next); return; } setTimeout(() => st && show(n), d > 0 && st.step.next ? 400 : 0);
  }
  function finish(next) {
    openModal({title: 'Tour finished', submit: next ? `Next tour: ${next.title}` : 'Close', allowDemo: true, sub: 'You can run any tour again from “Guided tours” at the top.', body: '<p style="margin:0">Everything you saw is real, working code on invented sample data. When you sign in, the same buttons work on your own analyses.</p>',
      onSubmit: async () => { if (next) setTimeout(() => start(next.id), 150); }});
  }
  function paint(target, loading) {
    if (!root) return; const s = st.step, i = st.i, n = st.t.steps.length, card = $q('.tour-card', root), spot = $q('.tour-spot', root);
    card.innerHTML = `<div class="tc-top"><span class="tc-count">${st.t.icon} ${esc(st.t.title)} · ${i + 1} of ${n}</span><button type="button" class="tc-x" data-tour="stop" aria-label="Exit tour">×</button></div>
      <h4>${loading ? 'One moment…' : s.title}</h4><p>${loading ? '' : s.text}</p>
      ${!loading && s.try ? `<button type="button" class="btn sm" data-tour="try">${esc(s.try.label)}</button>` : ''}
      <div class="tc-nav"><button type="button" class="btn sm" data-tour="back" ${i ? '' : 'disabled'}>Back</button><button type="button" class="btn sm primary" data-tour="next">${i === n - 1 ? 'Finish' : 'Next'}</button></div>`;
    st.target = target; if (!target) spot.hidden = true; place();
  }
  function place() {
    if (!root || !st || hidden) return; const card = $q('.tour-card', root), spot = $q('.tour-spot', root), t = st.target;
    const vw = innerWidth, vh = innerHeight, cw = Math.min(360, vw - 24);
    card.style.width = cw + 'px';
    if (!t || !document.contains(t)) { spot.hidden = true; card.style.left = Math.max(12, (vw - cw) / 2) + 'px'; card.style.top = Math.max(12, vh / 2 - card.offsetHeight / 2) + 'px'; return; }
    const r = t.getBoundingClientRect(), pad = 6; spot.hidden = false;
    Object.assign(spot.style, {left: r.left - pad + 'px', top: r.top - pad + 'px', width: Math.min(r.width, vw) + pad * 2 + 'px', height: Math.min(r.height, vh * 0.9) + pad * 2 + 'px'});
    const ch = card.offsetHeight; let x, y;
    if (vw < 700) { x = 12; y = r.bottom + 14 + ch < vh ? r.bottom + 14 : Math.max(12, r.top - ch - 14); }
    else if (r.right + 16 + cw < vw) { x = r.right + 16; y = r.top; }
    else if (r.left - 16 - cw > 0) { x = r.left - 16 - cw; y = r.top; }
    else if (r.bottom + 16 + ch < vh) { x = Math.min(Math.max(12, r.left), vw - cw - 12); y = r.bottom + 16; }
    else { x = Math.min(Math.max(12, r.left), vw - cw - 12); y = Math.max(12, r.top - ch - 16); }
    card.style.left = Math.max(12, Math.min(x, vw - cw - 12)) + 'px'; card.style.top = Math.max(12, Math.min(y, vh - ch - 12)) + 'px';
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-tour]'); if (!b) return; e.stopPropagation(); const k = b.dataset.tour;
    if (k === 'stop') stop(); else if (k === 'next') go(1); else if (k === 'back') go(-1);
    else if (k === 'try' && st) { const run = st.step.try.run; hidden = true; root.style.display = 'none'; try { run(); } catch (err) { toast(err.message, 'err'); }
      const t = setInterval(() => { if (!st) return clearInterval(t); if (!document.querySelector('.overlay') && !document.querySelector('.busybar')) { clearInterval(t); hidden = false; root.style.display = ''; place(); } }, 500); }
    else if (k === 'open') menu(); else if (k === 'start') { document.querySelector('.overlay')?.remove(); start(b.dataset.id); }
  }, true);

  /* ---------------- entry points ---------------- */
  function menu() {
    openModal({title: 'Guided tours', xl: true, submit: 'Close', allowDemo: true, sub: 'Each tour lights up the real buttons on the demo analyses and explains how to use them. About a minute each.',
      body: `<div class="tourgrid">${TOURS.map(t => `<button type="button" class="tourcard" data-tour="start" data-id="${t.id}"><span class="ti">${t.icon}</span><b>${esc(t.title)}</b><span class="meta">${esc(t.blurb)}</span><span class="meta">${t.steps.length} steps</span></button>`).join('')}</div>`,
      onSubmit: async () => {}});
  }
  function welcome() {
    try { if (sessionStorage.getItem('at_tour_welcome')) return; sessionStorage.setItem('at_tour_welcome', '1'); } catch {}
    openModal({title: 'Welcome to the demo', submit: 'Start with “Find your way around”', allowDemo: true, sub: 'These are invented sample analyses. Click around freely: nothing here can be changed or saved.',
      body: '<p style="margin:0">New here? Take a one-minute tour, or pick a tour for any feature from <b>Guided tours</b> at the top. Each tour shows you the real buttons and how to use them.</p>',
      onSubmit: async () => { setTimeout(() => start('start'), 150); }});
  }
  return {TOURS, start, stop, menu, welcome, list: () => TOURS.map(t => t.id)};
})();
