# FA-ImprovedLayout

Browser extension that adapts Fur Affinity's modern theme to wide and ultrawide screens and adds quality-of-life features. Works with all FA colour schemes. Languages: English, Deutsch, Русский.

## Features

- **Ultrawide layout** – centered page, width set by the side gutter; submission page with comments beside the image; profile split into two columns with a justified gallery box
- **Bubbles design** – rounded panels and buttons, chat-bubble comments and shouts, avatar tiles for watchers, coloured system messages
- **Quick view** – click a thumbnail to open it in an overlay (fav, download, comments, ← → to browse)
- **Full-screen viewer** – click a submission image; click again to zoom at the cursor, drag to pan
- **Comic reader** – loads a whole series on one page (vertical or horizontal)
- **Infinite scroll** – galleries, favorites, browse, search and the submission inbox
- **Pinned artists & submissions** – pin button next to Watch on profiles and on submissions / in the quick view; artists stay in a sidebar on the right, submissions on the left (drag to reorder)
- **Top bar** – clear all notifications with one click (with confirmation), SFW/NSFW switch next to the notifications
- **Extras** – extra BBCode buttons, +Fav without reload, "More from this artist", full watcher lists, in-page link warnings, optional link to archived galleries

Everything can be switched on or off in the popup.

## Install

Download the latest package from [Releases](../../releases/latest).

**Chrome / Edge / Brave:** unzip `…-chrome.zip`, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select the `FA-ImprovedLayout` folder. To update, replace the folder's contents and click the reload icon.

**Firefox:** download `…-firefox.xpi` from the release and open it with Firefox (or drag it into a Firefox window), then confirm. It's signed by Mozilla and updates by installing the newer `.xpi`.

## Privacy

No data is collected. Settings are stored in the browser's own sync storage; the extension only talks to furaffinity.net and opens furarchiver.net only after you confirm.

## Building

`./build.sh` creates both packages in `dist/` (`manifest.firefox.json` becomes the Firefox manifest).
