# FA Improved Layout (FA Ultrawide)

Chrome extension (Manifest V3) that adapts Fur Affinity's modern theme to ultrawide screens and adds a few quality-of-life features.

## Features

**Main switches** (popup): the master switch turns everything off (the page is left untouched); *Ultrawide layout* covers all layout changes; *Bubbles design* covers comment/shout bubbles, the comment box, buttons across the site, pagination arrows, avatar views for watchers and the page frame.

**Layout**
- Centered, configurable site width (FA normally caps html *and* body at 1850px)
- Submission page: image → description → details/keywords/folders panel on the left; stats and Fav/Note/Download above the comments in a right-hand column. Stacks into one column on narrow windows
- Submission image shows FA's small preview until the full file has loaded, and scales to fill the available width/height without clipping (click for actual size)
- Profile pages split: profile text on the left above the galleries, stats/contact/shouts start at the top on the right
- Profile: Featured and Gallery side by side; the Gallery box is filled edge to edge with justified rows of larger thumbnails (more are fetched if needed); Favorites shows only its thumbnail grid; empty panels hidden
- Profile header: optional "Archived Gallery" link next to Gallery, to the artist's backup on furarchiver.net (off by default, asks for confirmation); on removed/disabled accounts the same link appears as a button below the system message
- Banners always centered
- Adjustable thumbnail scale in galleries
- Responsive: every layout adapts to the window size (single column below ~1100px); the top menu stays on one line

**Features** (each can be toggled in the popup)
- Quick view: click a thumbnail to open the submission in an overlay (fav, download, open page, ← → to browse). Shows the thumbnail instantly and fades in the full image when loaded; neighbours are prefetched so browsing doesn't flicker. Includes a scrollable comment list and a box to post comments (e.g. auction bids).
- Comic reader: assembles a whole series on one page, via prev/next/first links in the description or via numbered titles ("Name - Page 9") found with FA's search. Each page is scaled to fit the screen; optional horizontal mode (comments move left, scroll pages left→right with wheel or ← →)
- Infinite scroll in galleries, scraps, favorites, browse, search and the submission inbox (next page is prefetched and appended well before the end)
- Watchers / watching lists load completely on one page
- Pagination buttons (shouts, search, browse) use compact arrow icons
- External links: in-page confirmation instead of FA's interstitial page
- +Fav on submission pages without a page reload
- "More from artist" (9 submissions) below the comments
- Ctrl/Cmd+click a thumbnail opens the submission page instead of the quick view
- Recent watchers / recently watched: one row of avatars; full watcher lists as avatar tiles (real avatars, looked up as they scroll into view and cached)
- Comment & shout style: Classic (FA) or Bubbles; two-row comment toolbar with extra BBCode buttons (strike, sup/sub, headings, colour, quote, spoiler, link, YouTube, user icons/links, line)

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
