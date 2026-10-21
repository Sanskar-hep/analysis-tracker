# Analysis-Tracker (GitHub edition)

[![DOI](https://zenodo.org/badge/1418792901.svg)](https://doi.org/10.5281/zenodo.23377664)


A static website (GitHub Pages) that stores all data in a **private GitHub repository**. No server, no database.

    Site repo  (public, holds only this code)   ->  GitHub Pages  ->  https://<owner>.github.io/<site-repo>/
    Data repo  (PRIVATE, holds your data)        <-  the site reads/writes it with each user's own token

Because the data repo is private, only people you add to it can read or write the data. The site itself
contains no data, so it is safe for it to be public.

## One-time setup (about 15 minutes)

1. **Create a GitHub organisation** for the group (free), or use your own account.
2. **Create the data repo**: `analysis-tracker-data`, set to **Private**, tick **Add a README file** (it needs a first commit).
   Add group members: *Settings -> Collaborators and teams -> Add people* with **Write** access.
3. **Create the site repo**: `analysis-tracker` (Public). Upload `index.html`, `app.js`, `backend.js`, `emailparse.js`, `pdfview.js`, `style.css`,
   `config.js`, `.nojekyll` and the `vendor` folder.
   - Optional: edit `config.js` and set `repo: 'your-org/analysis-tracker-data'` so people don't have to type it.
4. **Turn on Pages**: site repo -> *Settings -> Pages -> Build and deployment -> Deploy from a branch ->* `main` / `(root)`.
   After a minute the site is at `https://<owner>.github.io/analysis-tracker/`.
5. **Each person makes a token** (GitHub -> Settings -> Developer settings -> Personal access tokens ->
   *Fine-grained tokens -> Generate new token*):
   - Resource owner: the organisation (or the account that owns the data repo)
   - Repository access: **Only select repositories** -> the data repo
   - Permissions -> Repository -> **Contents: Read and write**
   - Open the site, enter `owner/analysis-tracker-data`, paste the token, **Connect**.

## Several repositories (personal + group)
Everyone can keep any number of data repositories, e.g. a private personal one and the shared group one.
Use the folder drop-down in the top bar to switch, or **Add another repository...** to connect a new one (paste its
token, or leave the token empty to reuse the current one if it also covers the new repository). **Disconnect** removes only
the current repository from this device; your data stays in GitHub.

## Try it locally without GitHub
    python3 dev/preview.py    # then open http://127.0.0.1:8020
    repository grp/data, token github_pat_tokA  (github_pat_tokA also opens alice/personal; github_pat_tokB = second user, group repo only)
The preview uses a fake in-memory GitHub, so data disappears when you stop it.

## How it behaves
- Every save is one git commit in the data repo (history comes for free; you can revert in GitHub).
- Everyone in the group sees all analyses. Only an analysis' owner can edit its settings or delete it; everyone can add
  plots and comments.
- Two people saving at the same moment is handled automatically (the app re-applies the change on top of the newest data).
- The tab refreshes when you return to it after a minute; the refresh button loads the latest changes.

## Limits and security notes
- Rules such as "published records can't be deleted" and "only the owner can delete" are enforced **in the browser**.
  Someone with write access to the data repo can bypass them by editing files directly. This is fine for a trusted group.
- Tokens are stored in your browser (localStorage if you tick "Keep me connected", else sessionStorage) and sent only to
  api.github.com. Use a short expiry, scope it to the one repo, and revoke it from GitHub if a device is lost.
- Keep plots reasonably sized (hundreds of KB to a few MB); GitHub rejects files over 100 MB and repos work best under ~1-5 GB.
- GitHub API limit: 5000 requests/hour per user; normal use is far below this.

## How an analysis is organised
- **Just started:** only plots (with versions). Two buttons on the dashboard: *Have you moved to the AN stage?* and
  *Have you presented in a meeting?*
- **Meetings** (appears after you say you presented, or at the AN stage): type the meeting name yourself (TMP, a group
  name, ...). Record a plot you showed, the comments people gave on it, and general methodology suggestions.
- **AN stage:** AN name, collaboration, and AN versions. After a version is published, *AN review* opens:
  the convenors' comments in two groups, **figures** (linked to the plot you recorded as that Fig number) and
  **text, tables and methodology**. Every comment has a *Your answer* box; *Reply document* turns your answers into a
  point-by-point email.
- **Moving through versions:** each published AN version keeps its own figures and comments; unreleased work lives in the
  working draft until you publish.

## Organising plots and preparing the next AN release
- **Categories and subcategories:** build a folder-like tree (for example Electron -> Data/MC Comparisons, HLT Efficiency).
  A plot can sit directly under a category or in any subcategory. Each plot also records its **location in the AN**
  (page, section or figure number). Plots and comments are independent: a plot does not need a comment.
- **The working version** (Prepare release): always contains every plot at its newest version, compared with the last released
  AN version. Each plot is shown as **New**, **Updated** or **Unchanged**. Uploading or updating a plot updates the working
  version automatically; older plot versions stay in the plot's history, and released AN versions are never changed.
- **Comments:** besides comments on plots, record **methodology**, **general** and text/table comments with your response, the
  action taken and a status (Open, In progress, Resolved). They need no plot.
- **Change summary:** generated from what is recorded (updated and new plots, comments addressed, methodology changes,
  unchanged plots, still open). Add your own explanations with *Record a change*, edit the text if you like, and it is saved
  with the version when you publish.
- **Download ZIP:** one package, for example `AN_v3.zip`, with every plot in the category / subcategory folders,
  `Review_Comments/Comments_and_Responses.md`, `Review_Comments/Change_Summary.md` and `Plot_Inventory.csv`.

## The AN PDF and highlighting
When you add an AN version you can choose its PDF and tick **Store the PDF in your private data repository** (up to 50 MB).
Stored PDFs open automatically on every device and for everyone who has access to the data repository
(AN review -> Open the AN PDF). If you leave it unticked, only the file's name, size and a SHA-256 fingerprint are saved and
you open the file from your own device each time (a copy is then kept in that browser so it reopens by itself).
The fingerprint warns you if you open a different file than the recorded one.
Use *Highlight text* (select text) or *Draw a box* (figures, tables), then attach a comment, or *Place in PDF* for a
comment you already imported. Highlights are saved as page + position, so they follow the comment everywhere.
Stored PDFs live in `analyses/<id>/files/` of the data repository like the plot images.

## Importing comments from an email
On **AN review** or **Meetings** click **Import comments from email**, paste the whole email and click *Read comments*.
The text is split into separate comments in your browser (cover note, greetings and sign-offs are skipped; "Sec 3.1:",
"Tab 10:", "L390:" labels become the location). A comment that mentions "Fig 10" is matched to the figure recorded as Fig 10,
"slide 12" to the plot on that slide; everything else is saved as a comment on the text/methodology. Check the list, then
**Import**: all comments are saved in one commit. Nothing is read from Gmail; you paste the text yourself.

## Files
- `index.html`, `app.js`, `style.css` - interface
- `emailparse.js` - splits a pasted email into comments
- `pdfview.js` + `vendor/pdfjs/` - the PDF viewer (PDF.js, Apache-2.0)
- `release.js` - the working version, change summary and ZIP package
- `backend.js` - storage layer (git commits through the GitHub API) and all the rules
- `config.js` - optional default repository
- `server-version/` - the earlier Python-server edition with real server-side accounts (not used on GitHub)
- `legacy-local-v1.html` - the first browser-only prototype

## Data layout in the data repo
    analyses/<id>/state.json             records of one analysis
    analyses/<id>/files/<fileid>.<ext>   plot images

## License and credit
Analysis-Tracker is designed and built by **Sanskar Nanda** (https://github.com/Sanskar-hep) and released under the
MIT License (see `LICENSE`). You may use and modify it, but you must keep the copyright and licence notice, and
the "Designed & built by" credit in the footer should stay. The bundled PDF.js (`vendor/pdfjs/`) is Apache-2.0
(c) Mozilla and keeps its own licence.

## How to cite
Nanda, S. (2026). *Analysis-Tracker* [Software]. Zenodo. https://doi.org/10.5281/zenodo.23377664
This DOI always points to the latest version. Each release also has its own version DOI, listed on the Zenodo page.

- **Upload many plots at once**: on a category page, **Upload many plots**. Name files `<name>_<era>.png` (for example `bdt_input_pt_2016postVFP.png`); the era is read from the end of the name, files with the same name are grouped, and typing a figure number records the group as one AN figure with one panel per era. A plot that already exists gets a new version instead of a duplicate.
- **Plots of an already published AN**: in the same dialog choose “These plots belong to: AN vN”. They are stored as that version's plots (so convener comments can be linked to them) and appear unchanged in the working version; the published version is never altered. Name clashes are shown and you choose to skip or add a new version.
- **Answer a comment with revised plots**: **Respond / resolve** on a comment lets you write the response and upload one or several revised PNGs. Each file is matched to the plot it replaces (you can correct it) and asks what changed and why; the reason is linked into the response and the change summary automatically, and the old plot stays in its history (**Restore as new version** brings it back).


## Plot Gallery, navigation and the release package

- **Five areas** in the sidebar: *Overview* (what to do next), *Plot Gallery* (all plots, with the folder tree inside it), *Comments* (conveners, meetings, everything pending), *Version History* (published versions and every plot revision) and *Release & Export*. *Documents* and *Settings* are under More.
- **Plot Gallery** groups plots by variable and shows each era in the fixed order 2016preVFP, 2016postVFP, 2017, 2018, with a "Plot unavailable" placeholder for a missing era (only a reminder). Groups expand and collapse, images load as you scroll, and a click enlarges a plot. Search by name, file name or AN location, and filter by era, comment status, revision status (updated, needs my review, new, unchanged), figure, or groups missing an era.
- **Era** is read from the end of the plot name (`c_AL_2017` is variable `c_AL`, era 2017). If a name has no era suffix you can set the era in *Edit plot details*.
- **Plot revision status** is separate from comment status: a comment can be resolved while a revised plot still says "needs review" until you mark it reviewed.
- **Published vs working**: *Compare with published* shows both side by side with file names, the comment that caused the change and your response.
- **Release & Export** shows a checklist of reminders (open comments, comments without a response, revised plots not yet checked, revisions without a reason, groups missing an era, change summary not yet read). They never block publishing and do not mean the AN is scientifically approved.
- **manifest.json** in the downloaded package (format `analysis-tracker-manifest`, `format_version` 1) lists every plot (stable `plot_id`, group, era, file, original file name, category ids and path, AN location, status against the previous release, current revision with what changed / why / reviewed flag, linked `comment_ids`) and every comment (type plot, methodology, general, text, table, equation; response; action taken; status; linked `plot_ids`).

## Scan figures (AN PDF)

Open the AN PDF of a published version (Comments → Convener comments → Open the AN PDF) and click **Scan figures**. The tracker reads every caption (“Figure 4.2: …”) to get the figure number, page and section, compares the pictures embedded in the PDF with the plots you uploaded for that version (an image fingerprint, so different sizes do not matter), and uses plot names and eras mentioned in the caption as a second clue. You get a review list with thumbnails and confidence; after you confirm, the plots are linked to their figures (one panel per era) and each plot's AN location is filled in. Everything happens in your browser; nothing is uploaded. Figures included as PDF (vector) graphics are rendered and compared too, and a picture that merges several plots is split into panels. Plots are compared by their content, so different white margins and sizes do not matter.

While scanning, comments that were recorded as plain AN text and mention a figure ("Fig 3", "Figure 4.2"), or that you placed in the PDF on a figure's page, are proposed for that figure too. If the comment names an era, it is attached to that panel; otherwise to the whole figure. You confirm each one, and its response, status and PDF placement move with it.

**Link comments to figures** (Comments → Convener comments): for comments you imported or typed that are not on a figure yet. Comments whose text names a figure ("Fig. 3") are proposed for that figure, or for the panel whose era they mention; for the others you choose the figure from a list. No PDF scan is needed.

**Delete all comments**: a red button on *Convener comments* (all comments of the AN version you are viewing, on figures and plain) and on *Meeting comments* (all meeting comments). It asks you to type DELETE and offers a backup download (`Comments_and_Responses.md`) first. Plots, figures and revised plots are kept.

## A new AN PDF for every release, and comparing AN versions

- **New AN PDF.** Once an earlier AN version exists, the working version needs its own new AN PDF (the LaTeX document saved as PDF after the plots were updated). Upload it in *Release & Export*. Until then **Publish** and **Download ZIP** are locked, and a PDF identical to an earlier version's PDF is refused. The PDF is stored in your private data repository, becomes the PDF of the new version when you publish, and is included in the downloaded package. (The very first version may be published without a PDF.)
- **Compare AN versions** (Version History → *Compare AN versions*, or *vs previous* on a row, or *Compare with AN vN* in Release & Export). It reads the PDFs in your browser and shows, for the text, the words added and removed section by section, and for the figures which were added, removed, changed (side-by-side pictures) or only got a new caption. Margin line numbers, headers and footers are ignored. Add a summary in your own words and **Save** it: it is kept with the later version (Version History → *Changes*) and, for the working version, goes into the package as `Review_Comments/Changes_between_AN_versions.md`. *Download (.md)* saves a copy without storing it.
- **Export to Google Docs** (button on the comments pages and in Release & Export). One click builds a single `.docx` with every comment (blue box), its reply and action taken (green box) and the plots involved (as commented on, and the revised plot), grouped by AN version, plot / methodology / general comments and meetings. Pictures are inside the file. Drag it into Google Drive and choose *Open with → Google Docs*. Nothing is sent to Google by the website (a direct push would need a Google sign-in and public picture addresses, which a private data repository cannot offer).
- **Finishing the review round** (Release & Export, two buttons). *Update figures in the LaTeX source*: upload the AN source zip (Overleaf: Menu → Download → Source). The page finds every `\includegraphics` (follows `\input`, `\graphicspath`, ignores commented lines), recognises which tracked plot each one is (earlier confirmation, then file name, then the picture itself) and shows which are outdated. Download either only the changed figures under the exact paths the .tex uses, or the whole source with those figures already replaced (old file removed and the extension edited in the .tex if the tracked plot has another format), plus a notes file. Your matches are remembered for the next version. Figures inserted through your own macro cannot be read. *Add figure references to the replies*: scans the new AN PDF, finds where each revised plot ended up and adds `(→ AN_v5: Fig. 4.2, p. 13)` to the end of the reply (re-running updates the same reference instead of repeating it), and refreshes each plot's *location in the AN*. Replies that are still empty are skipped. Everything runs in the browser.
