# Analysis-Tracker (GitHub edition)

A static website (GitHub Pages) that stores all data in a **private GitHub repository**. No server, no database.

    Site repo  (public, holds only this code)   ->  GitHub Pages  ->  https://<owner>.github.io/<site-repo>/
    Data repo  (PRIVATE, holds your data)        <-  the site reads/writes it with each user's own token

Because the data repo is private, only people you add to it can read or write the data. The site itself
contains no data, so it is safe for it to be public.

## One-time setup (about 15 minutes)

1. **Create a GitHub organisation** for the group (free), or use your own account.
2. **Create the data repo**: `analysis-tracker-data`, set to **Private**, tick **Add a README file** (it needs a first commit).
   Add group members: *Settings -> Collaborators and teams -> Add people* with **Write** access.
3. **Create the site repo**: `analysis-tracker` (Public). Upload `index.html`, `app.js`, `backend.js`, `style.css`,
   `config.js`, `.nojekyll`.
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
    repository grp/data, token tokA  (tokA also opens alice/personal; tokB = second user, group repo only)
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

## Files
- `index.html`, `app.js`, `style.css` - interface
- `backend.js` - storage layer (git commits through the GitHub API) and all the rules
- `config.js` - optional default repository
- `server-version/` - the earlier Python-server edition with real server-side accounts (not used on GitHub)
- `legacy-local-v1.html` - the first browser-only prototype

## Data layout in the data repo
    analyses/<id>/state.json             records of one analysis
    analyses/<id>/files/<fileid>.<ext>   plot images
