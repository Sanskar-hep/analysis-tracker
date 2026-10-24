/* Landing page shown before connecting: what Analysis-Tracker is, who it is for, what it does today and what it does not do.
   Every statement here describes something the code does now; planned items are labelled as planned. */
window.LANDING = (() => {
  const chain = `<div class="lchain" aria-label="Example of one comment followed to the AN version that fixes it">
    <div class="lnode"><small>Convener comment</small><b>“Fig. 4.2: please use 30 bins”</b></div><span class="larr">→</span>
    <div class="lnode"><small>Plot</small><b>electron_pt_2017</b><i>v4 · as commented on</i></div><span class="larr">→</span>
    <div class="lnode"><small>Revised plot</small><b>v4.1</b><i>“rebinned 15 → 30, because …”</i></div><span class="larr">→</span>
    <div class="lnode"><small>Your reply</small><b>“Done, see v4.1”</b></div><span class="larr">→</span>
    <div class="lnode ok"><small>Release</small><b>AN v5</b><i>listed in the change summary</i></div></div>`;
  const eras = `<p class="lcap">How one variable looks in the Plot Gallery: each era in a fixed order, with its newest version, and a reminder where an era is missing.</p><div class="leras" aria-label="Plots of one variable, era by era"><div><b>2016preVFP</b><i class="y">v2</i></div><div><b>2016postVFP</b><i class="y">v2</i></div><div><b>2017</b><i class="y">v4.1</i></div><div class="gap"><b>2018</b><i>Plot unavailable</i></div></div>`;
  const card = (t, body, ex) => `<div class="lcard"><h3>${t}</h3><p>${body}</p>${ex ? `<p class="lex"><b>For example:</b> ${ex}</p>` : ''}</div>`;
  const li = (t, d) => `<li><b>${t}</b><span>${d}</span></li>`;
  const step = (n, t, d) => `<div class="lstep"><span>${n}</span><b>${t}</b><p>${d}</p></div>`;

  const page = (connectCard, credit) => `<div class="landing">
  <header class="ltop"><a class="lbrand" href="#"><span class="logo">${window.__logo || ''}</span>Analysis-Tracker</a><span class="lby">by <a href="https://github.com/Sanskar-hep" target="_blank" rel="noopener noreferrer"><b>Sanskar Nanda</b></a></span>
    <nav><a href="#lfeat">Features</a><a href="#ldocs">Documentation</a><button class="btn sm" data-act="login">Login</button><button class="btn sm primary" data-act="tryDemo">Explore Demo</button></nav></header>

  <section class="lhero"><div class="lheadtxt">
    <p class="leyebrow">Analysis traceability for high-energy physics</p>
    <h1>Never lose the story behind a physics result.</h1>
    <p class="lsub">Every plot has a history. Every reviewer comment has a context. Every analysis decision has a reason.</p>
    <p class="lsub"><b>Analysis-Tracker</b> brings your plots, version history, reviewer discussions and the reasons for each change together in one place, from the first draft to the final Analysis Note.</p>
    <p class="lcta"><button class="btn primary" data-act="tryDemo">Explore the Demo →</button><a class="btn" href="#lflow">See How It Works</a></p>
    <p class="lnote" style="margin-top:10px">No sign-in required to explore the demo.</p>
  </div><div id="connect" class="lconnect">${connectCard}</div></section>


  <section class="lsec"><h2>More than plot storage</h2>
    <div class="lgrid2">
      ${card('Trace every change', 'Each plot keeps all its versions, with what changed, why, the dataset and a link to the code that made it. The activity log shows who did what and when.')}
      ${card('Never lose review context', 'Comments, replies and reviewer decisions stay linked to the plot and version they discuss. Several people can answer one comment; the owner accepts or discards responses, with a reason, and nothing is deleted.')}
      ${card('See what each plot is used for', 'Open a plot version to see the AN figures, meetings and comments tied to it, and a working draft that shows what is new, updated or unchanged before you publish.')}
      ${card('Know what needs checking next', 'Open and unanswered comments, missing data-taking eras, and plots that changed since the last release are listed for you.')}
    </div>
    <p class="lnote">Built for high-energy physics. Designed around the analysis review workflow.</p>
  </section>

  <section id="lwhy" class="lsec"><h2>The problem it solves</h2>
    <p class="lead">In a review round the same figure changes several times, and the discussion about it lives somewhere else.</p>
    <div class="lgrid3">
      <div class="lprob"><b>“Which plot did they mean?”</b><p>Comments arrive by email or in a meeting, referring to “Fig. 4.2” of a version that has since moved on.</p></div>
      <div class="lprob"><b>“Why did this change?”</b><p><code>ept_final_v2_NEW.png</code> in a shared folder does not say what was rebinned, or which comment asked for it.</p></div>
      <div class="lprob"><b>“What is in the next AN?”</b><p>Before sending a new version you rebuild by hand which plots are new, updated or unchanged, and which comments are still unanswered.</p></div>
    </div>
    <p class="lnote">A file store keeps the images. A task board keeps the to-do list. Neither knows that a comment, a plot version and an AN release belong together. Analysis-Tracker records that link.</p>
  </section>

  <section id="lfeat" class="lsec alt"><h2>What makes it different</h2>
    <p class="lead">Five ideas, each tied to a step of real analysis work.</p>
    ${chain}
    <div class="lgrid2">
      ${card('1 · Plots are evolving records, not image files', 'Every plot keeps all its versions, each with what changed and why. You can put the current plot beside the published one, together with the comment that caused the change and your answer.', 'v4 → v4.1: “rebinned 15 → 30 bins, requested by the convener”.')}
      ${card('2 · Working draft versus published AN', 'Published AN versions never change. New work goes into a working draft that always shows every plot as New, Updated or Unchanged against the last release. When you publish, figures that were in the previous version are carried forward for you.', 'Preparing AN v5 while AN v4 stays exactly as it was reviewed.')}
      ${card('3 · Review traceability', 'A comment stays linked to the plot it is about, your reply, the revised plot and the version that resolved it. Paste an email and it is split into separate comments; a comment that mentions “Fig 10” is linked to Fig 10. You can also mark places in the AN PDF itself.', 'Ask “which comments are still open?” and “what did we answer?” in one place.')}
      ${card('4 · Organised the way HEP analyses are', 'Categories and subcategories, data-taking eras read from the plot name (<code>c_AL_2017</code>), figure numbers and the location in the AN. Missing eras show as a reminder. Each analysis also records, only when you confirm it, whether it has a CADI line, and shows a CADI badge if it does.', 'electron_pt in 2016preVFP, 2016postVFP, 2017 and 2018 side by side.')}
      ${card('5 · The end of a review round is mostly automatic', 'Scan the new AN PDF to find where each figure ended up. Download a release package with the plots, the comments and responses, a change summary and a manifest. Update figures in your LaTeX source, and add “Fig. 4.2, p. 13” to your replies.', 'AN_v5.zip with plots, <code>Comments_and_Responses.md</code> and <code>Change_Summary.md</code>.')}
    </div>
    ${eras}
  </section>

  <section id="lflow" class="lsec"><h2>Where it fits in the life of an analysis</h2>
    <div class="lsteps">
      ${step(1, 'Make plots', 'Upload one plot or many at once. Era and variable are read from the file names.')}
      ${step(2, 'Present and discuss', 'Record the plots you showed in a meeting and the comments you got.')}
      ${step(3, 'Publish an AN version', 'Freeze what was released. Add its PDF if you want to open it next to the comments.')}
      ${step(4, 'Review and respond', 'Import convener comments, write answers, upload revised plots with a reason.')}
      ${step(5, 'Prepare the next version', 'The working draft collects every change. Check the reminders, then download the package.')}
    </div>
    <p class="lnote">The cycle repeats with the next AN version, and each earlier version stays available.</p>
  </section>

  <section id="ldocs" class="lsec"><h2>Documentation</h2>
    <p class="lead">From the demo to your own analysis in six steps.</p>
    <div class="lsteps">
      ${step(1, 'Look around', 'Press Explore Demo. It is read-only sample data; nothing to sign in to, nothing saved.')}
      ${step(2, 'Make a private repository', 'On GitHub, create a private repository with a README. It will hold your plots, comments and history.')}
      ${step(3, 'Create a token', 'Fine-grained token, only that repository, Contents: Read and write. The token is your sign-in; it is sent only to GitHub.')}
      ${step(4, 'Sign in and create an analysis', 'Login, then New analysis. Add the team members who may answer comments, if you work in a group.')}
      ${step(5, 'Add plots and comments', 'Upload plots (one or many), record meetings, import convener comments and answer them.')}
      ${step(6, 'Publish AN versions', 'Publish a version, scan its PDF, and download the release package with the change summary.')}
    </div>
    <p class="lnote">Questions about setup are answered under “How do I set this up?” in the Login window.</p>
  </section>

  <section id="lstate" class="lsec alt"><h2>What it does today, and what it does not</h2>
    <div class="lstatus">
      <div><h3 class="ok">Available now</h3><ul>
        ${li('Versioned plots', 'with what changed and why, categories, eras, bulk upload')}
        ${li('Working draft and published AN versions', 'with change summary and a downloadable package')}
        ${li('Comments, replies and revised plots', 'meetings, conveners and general comments; email import; point-by-point reply document; highlights in the AN PDF')}
        ${li('AN PDF tools', 'figure scanning and matching, comparison of two AN versions')}
        ${li('Meeting Slides (experimental)', 'build a group-meeting or collaboration-meeting talk: choose plots and text, pick a layout for each slide, edit, save, then export to Google Slides (after a one-time Google setup) or download a PowerPoint file')}
        ${li('Slides from plots', 'choose plots and versions; one click makes a .pptx with each plot, what changed, why, dataset and comments, ready to open in Google Slides')}
        ${li('Export to Google Docs', 'one click builds a .docx with every comment, reply and plot; you drag it into Google Drive')}
        ${li('LaTeX helpers', 'update figures in your source zip and add figure and page references to replies')}
        ${li('Public demo with guided tours', 'two read-only sample analyses (invented numbers) and a sample presentation, with 13 short guided tours that light up the real buttons and explain every feature; every change is blocked and sign-in is offered instead')}
        ${li('CADI line status', 'asked once per analysis and stored per analysis')}
      </ul></div>
      <div><h3 class="plan">Not available yet</h3><ul>
        ${li('Dependency tracing', 'automatically listing which results need revalidation after an upstream change is planned, not built')}
        ${li('Validation evidence and configuration tracking', 'a plot version records its dataset and a code link; full configurations and validation records are not tracked')}
        ${li('Google Slides export without setup', 'exporting straight to Google Slides needs your own free Google OAuth client ID (one-time); until then you download a .pptx')}
        ${li('Direct push to Google Docs', 'today you open the exported file yourself')}
        ${li('Automatic ingestion from analysis workflows', 'plots are uploaded by you, singly or in bulk')}
        ${li('User accounts and permissions of its own', 'access is whatever GitHub gives to the data repository')}
        ${li('CERN single sign-on', 'not part of this version')}
      </ul></div>
    </div>
  </section>

  <section class="lsec"><h2>How it is built, and what that means for your data</h2>
    <div class="larch"><div><b>Public site repository</b><span>Only the code, shown here through GitHub Pages</span></div><span class="larr">⇄</span><div><b>Your browser</b><span>Does the work; files are read here</span></div><span class="larr">⇄</span><div><b>Your private data repository</b><span>Plots, comments and history, one Git commit per save</span></div></div>
    <ul class="lplain">
      <li>There is no application server and no database. You can see the history of every change in GitHub and revert it there.</li>
      <li>The data repository is private, so only the people you add on GitHub can read it. Each person signs in with their own GitHub token, which is sent only to GitHub.</li>
      <li>Rules such as “only the owner deletes an analysis” are enforced in the browser. Anyone with write access to the data repository can edit its files directly, so it suits a group that trusts each other.</li>
      <li>It is open source under the MIT licence and can be cited through Zenodo (<a href="https://doi.org/10.5281/zenodo.23377664" target="_blank" rel="noopener noreferrer">10.5281/zenodo.23377664</a>).</li>
    </ul>
  </section>

  <section class="lsec alt lend"><h2>Ready to try it?</h2><p class="lead">Look around the demo first. To keep your own work you need a private GitHub repository for your data and a fine-grained token for it. The steps are in the “How do I get a token?” box above.</p>
    <p><button class="btn primary" data-act="tryDemo">Explore Demo</button> <button class="btn" data-act="getStarted">Get Started</button></p></section>
  ${credit}</div>`;
  return {page};
})();
