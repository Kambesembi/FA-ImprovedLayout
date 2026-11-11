# FA-ImprovedLayout

Browser extension that adapts Fur Affinity's modern theme to wide and ultrawide screens and adds quality-of-life features. Works with all FA colour schemes. Languages: English, Deutsch, Русский.

## Features

- **Ultrawide layout** – centered page, width set by the side gutter
- **Profile & submission layout** (own switch) – submission page with comments beside the image; profile split into two columns with a justified gallery box
- **Bubbles design** – rounded panels and buttons, chat-bubble comments and shouts, avatar tiles for watchers, coloured system messages
- **Quick view** – click a thumbnail to open it in an overlay (fav, download, comments, ← → to browse); double-click opens the submission page
- **Full-screen viewer** – click a submission image; click again to zoom at the cursor, drag to pan
- **Comic reader** – loads a whole series on one page (vertical or horizontal)
- **Infinite scroll** – galleries, favorites, browse, search and the submission inbox
- **Pinned artists & submissions** – pin button next to Watch on profiles and on submissions / in the quick view; artists stay in a sidebar on the right, submissions on the left (drag to reorder); the sidebars fill the free space beside the page or stay narrow
- **Top bar** – clear all notifications with one click (with confirmation), SFW/NSFW switch next to the notifications
- **Reference walls** (optional) – PureRef-style boards: add submissions with one click or drop, paste and upload your own images, arrange and resize them, up to 12 named walls, open them from the top bar or pin one to the left sidebar, export as PNG
- **Quick upload** – FA's three upload pages as one form: several files at once (one submission each, or set apart for their own description), keywords as chips, settings copied from one of your submissions, last choices remembered; the queue shows progress, survives a reload and checks your gallery before an unclear upload is sent again
- **Extras** – extra BBCode buttons, +Fav without reload, "More from this artist", full watcher lists, in-page link warnings, optional link to archived galleries

Everything can be switched on or off in the popup.

## Install

Download the latest package from [Releases](../../releases/latest).

**Chrome / Edge / Brave:** unzip `…-chrome.zip`, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select the `FA-ImprovedLayout` folder.

**Firefox:** download `…-firefox.xpi` from the release and open it with Firefox (or drag it into a Firefox window), then confirm. It's signed by Mozilla.

## Updates

The toolbar icon shows **↑** when a newer release is out; the popup then offers the update, and clicking the version number opens the update page any time.

- **Chrome / Edge / Brave:** the update page writes the new release into the extension folder and restarts the extension. Browsers don't let an extension replace itself, so the first time you pick the folder you loaded (its path is shown under `chrome://extensions`); after that an update is one click. Every file is checked against GitHub's hash before anything is written.
- **Firefox:** from 2.8.0 on, Firefox updates the add-on by itself; **Update now** makes it check right away. Older versions: install the newer `.xpi` once.

## Privacy

No data is collected. Settings are stored in the browser's own storage; the extension only talks to furaffinity.net, opens furarchiver.net only after you confirm, and it checks GitHub for a newer release (the update page downloads it from there).

## Building

`./build.sh` creates both packages and Firefox's `updates.json` in `dist/` (`manifest.firefox.json` becomes the Firefox manifest).

Releases are made by GitHub Actions (`.github/workflows/release.yml`): every push to `main` builds the packages, and when the version in `manifest.json` has no tag yet, release `vX` is published with the two zips. To release, raise the version in both manifests and push. With the repository secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` (addons.mozilla.org → Tools → Manage API Keys) the Firefox package is signed there too and the release also gets `FA-ImprovedLayout-vX-firefox.xpi` and `updates.json`; without them those two are added by hand.
