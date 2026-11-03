# FA Improved Layout (FA Ultrawide)

Chrome extension (Manifest V3) that adapts Fur Affinity's modern theme to ultrawide screens and adds a few quality-of-life features.

## Features

**Layout**
- Centered, configurable site width (FA normally caps html *and* body at 1850px)
- Submission page: image → description → details/keywords/folders panel on the left; stats and Fav/Note/Download above the comments in a right-hand column (or classic sidebar layout). Stacks into one column on narrow windows
- Submission image scales to fill the available width/height without clipping (click for actual size)
- Profile pages split: profile text on the left above the galleries, stats/contact/shouts start at the top on the right
- Profile: Featured and Gallery side by side; the Gallery box is filled edge to edge with justified rows of larger thumbnails (more are fetched if needed); Favorites shows only its thumbnail grid; empty panels hidden
- Profile header: optional "Archived Gallery" link next to Gallery, to the artist's backup on furarchiver.net (off by default, asks for confirmation)
- Banners always centered
- Adjustable thumbnail scale in galleries
- Responsive: every layout adapts to the window size (single column below ~1100px); the top menu stays on one line

**Features** (each can be toggled in the popup)
- Quick view: click a thumbnail to open the submission in an overlay (fav, download, open page, ← → to browse). Shows the thumbnail instantly and fades in the full image when loaded; neighbours are prefetched so browsing doesn't flicker.
- Comic reader: assembles a whole series on one page, via prev/next/first links in the description or via numbered titles ("Name - Page 9") found with FA's search. Each page is scaled to fit the screen; optional horizontal mode (comments move left, scroll pages left→right with wheel or ← →)
- Infinite scroll in galleries, scraps, favorites, browse, search and the submission inbox (next page is prefetched and appended well before the end)
- Watchers / watching lists load completely on one page
- Profile shout pagination uses compact << < > >> buttons
- Recent watchers / recently watched: one row of avatars
- Comment style presets: Cards, Bubbles, Compact, Minimal or FA default

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
| `popup.html` / `popup.js` / `settings.js` | Settings popup (switches, presets) |
