# FA Improved Layout (FA Ultrawide)

Chrome extension (Manifest V3) that adapts Fur Affinity's modern theme to ultrawide screens and adds a few quality-of-life features.

## Features

**Layout**
- Centered, configurable site width (FA normally caps html *and* body at 1850px)
- Submission page: image → description → info panel on the left, comments in a right-hand column (or classic sidebar layout)
- Submission image scales to fill the available width/height without clipping (click for actual size)
- Profile pages split: profile text on the left above the galleries, stats/contact/shouts start at the top on the right
- Banners always centered
- Adjustable thumbnail scale in galleries

**Features** (each can be toggled in the popup)
- Quick view: click a thumbnail to open the submission in an overlay (fav, download, open page, ← → to browse). Shows the thumbnail instantly and fades in the full image when loaded.
- Comic reader: assembles a whole series on one page, via prev/next/first links in the description or via numbered titles ("Name - Page 9") found with FA's search
- Infinite scroll in galleries, scraps, favorites, browse, search and the submission inbox

## Install

1. Download / clone this repository
2. Open `chrome://extensions` and enable **Developer mode**
3. **Load unpacked** → select the folder

Disable overlapping features in other FA extensions (e.g. "FurAffinity Features" infinite gallery / quick view) to avoid duplicates.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest |
| `ultrawide.css` / `content.js` | Layout (applied at `document_start`) |
| `features.css` / `features.js` | Image fit, quick view, comic reader, infinite scroll |
| `background.js` | Downloads for the quick view |
| `popup.html` / `popup.js` / `settings.js` | Settings popup |
