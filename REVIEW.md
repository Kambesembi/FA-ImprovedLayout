# Code review – FA-ImprovedLayout v2.8.0

Scope: every file in the repository at `ce9a0fc` (about 6,800 lines).

How it was checked: by reading the code. Two items were also run in Node (the comic title parser and the
i18n key check). Nothing was run against furaffinity.net or in a browser, so each finding carries a status:

- **confirmed** – follows from the code alone, or was run
- **likely** – depends on browser or FA behaviour that was not tested here
- **to verify** – could not be checked (the session had no access to MDN)

Note on this file: the in-extension updater copies every repository file that is not on its skip list
(`update.js:14`), so `REVIEW.md` would land in users' extension folders with the next release. Add it to
`SKIP` or remove it before tagging. See B14.

## Fix first

| # | Problem | Where | Status |
|---|---------|-------|--------|
| B1 | Quick view can act on the wrong submission (fav, download, wall, **comment**) | `features.js:1988` | confirmed |
| B2 | Upload queue crawls in a background tab and a second tab can take it over → duplicate uploads | `uploader.js:795-857, 1334` | likely |
| B3 | Enter always confirms a dialog, even with Cancel focused; used for "clear all notifications" | `features.js:670-673` | confirmed |
| B4 | Pinned artists stop saving at roughly 70–90 entries, with no message | `features.js:1565-1568` | confirmed |
| B5 | Comic detection fails for titles like "Sketch 2", "Concept 3", "Step 2" | `features.js:560` | confirmed (run) |
| B6 | An "unclear" upload can be marked done because another submission has the same title | `uploader.js:897-905` | confirmed |
| B7 | Firefox "Update now" may call an API Firefox does not have | `update.js:148` | to verify |

## Bugs

### B1 – Quick view: a late response replaces the current submission's data
`show()` assigns `data = await getSubmission(...)` and only then checks whether the user has moved on
(`features.js:1988-1995`). A slow response for an item the user already left overwrites `data` while a
different item is on screen.

Reachable case: at item X the neighbours are prefetched. Press → to X+1 (cached), → to X+2 (not cached,
loading), ← back to X+1 (cached, shown at once). When X+2 arrives, `data` is X+2 but X+1 is displayed.
From then on `F` favourites X+2, `D` downloads it, the wall button adds it, and a comment is posted to it.

Fix: await into a local variable, return if `t !== token`, then assign `data`.

### B2 – Upload queue and background tabs (Chrome)
Chrome limits timers in a tab hidden for more than five minutes to about one wake-up per minute.

- `countdown()` counts ticks of `sleep(1000)` (`uploader.js:851-857`). The 30-second pause between uploads
  then takes about 30 minutes. A 12-file queue already runs longer than five minutes, so anyone who switches
  tabs hits this.
- The "one tab sends" lock is a heartbeat written every 5 s and considered dead after 20 s
  (`uploader.js:797, 822`). With throttled timers the heartbeat goes stale. A second `/submit/` tab then
  claims the queue, `recover()` puts the upload the first tab is still sending back to "wait"
  (`uploader.js:809-815`), and the file is sent twice.

Fix: wait until a timestamp instead of counting ticks, and use `navigator.locks` for the single-sender lock
(released by the browser when the tab goes away, no heartbeat needed).

### B3 – `confirmBox`: Enter confirms regardless of focus
The capture-phase key handler maps Enter to "OK" (`features.js:670-673`). Tabbing to Cancel and pressing
Enter runs the action. The same box guards "clear all notifications" (`features.js:1502`), which cannot be
undone. The OK button also has focus by default in the danger variant.

Fix: let Enter act on the focused button; focus Cancel when `danger` is set. Also stop the Escape key from
reaching the quick view's handler, which closes too.

### B4 – Pinned artists hit the `storage.sync` per-item limit
All pinned artists are one `pinned` array in `storage.sync`, where a single item may be 8,192 bytes. Each
entry holds slug, display name and a full avatar URL (about 90–120 bytes), so the limit is reached at
roughly 70–90 artists. The `set` calls have no callback (`features.js:1565, 1568`; `content.js:90`), so the
write fails without any feedback and the button does not change.

No storage write in the project checks `chrome.runtime.lastError`.

Fix: store only slug and name (the avatar address can be derived or resolved), or one key per artist, or move
the list to `storage.local`; show a toast when a write fails.

### B5 – Comic title parser: keywords match inside words
In `parseNumberedTitle` the optional keyword group `(?:page|pg|part|pt|chapter|ch|episode|ep|no)` has no
word boundary and the base is matched lazily, so the end of an ordinary word is taken as a keyword:

| Title | Parsed base | Result |
|-------|-------------|--------|
| Sketch 2 | `Sket` | FA search for "Sket" finds nothing, no reader button |
| Concept 3 | `Conce` | same |
| Piano 5 | `Pia` | same |
| Step 2, Deep 2 | (under 3 characters) | rejected outright |

Fix: require a separator or start of string before the keyword (`(?:^|[\s\-–—:|,.(\[])` or `\b`).

### B6 – `findUploaded` matches by title and a floor that is not kept current
After an unclear finalize the code looks in the gallery for a submission with the same title and an ID above
`q.floor` (`uploader.js:897-905`). `q.floor` is fixed when the job is queued (`uploader.js:662`).

- Two files with the same title in one batch: the first finishes with ID N. If the second ends unclear, the
  check finds N (same title, above the old floor), marks the second "done" with the first one's link and
  deletes its file. The second file was never uploaded.
- `st.floor` is refreshed by `loadGallery()`, which runs last in the start-up sequence
  (`uploader.js:1376`), after the queue has already started.

Fix: compare against `Math.max(q.floor, st.floor)` at check time and raise the floor of the remaining jobs
in `finish()`.

### B7 – Firefox: `runtime.requestUpdateCheck` (to verify)
`firefoxCheck` calls `chrome.runtime.requestUpdateCheck` (`update.js:148`). From memory Firefox does not
implement this method; I could not confirm it because developer.mozilla.org was not reachable from this
session. If it is missing, the call throws and the page reports "Update failed" for every Firefox user,
which is the headline feature of 2.8.0 on that browser. Worth one manual test in Firefox 140; guard with
`typeof chrome.runtime.requestUpdateCheck === "function"` either way.

### B8 – Watcher lists above 100 pages are cut off and the pager stays hidden
`initWatchlistAll` hides FA's navigation, loads at most 100 pages, then prints "N entries" as if complete
(`features.js:1036-1064`). The navigation is only restored on an error, so the rest of a very large list
cannot be reached.

### B9 – Quick view comment: any HTTP 200 counts as posted
`postComment` treats `res.ok` as success, clears the textarea and shows "posted" (`features.js:2117-2130`).
FA answers 200 for its own error pages (flood protection, blocked by the user, comments disabled). The typed
text is lost. Check that the returned page has one more comment, or look for FA's message box first (the
uploader already has `faMessage()` for this).

### B10 – "Copy settings" picker: typing an ID fires at the fifth digit
The search field treats any value starting with five or more digits as an ID and applies it on every
keystroke (`uploader.js:1154-1155`). Typing an eight-digit ID requests the 5-, 6-, 7- and 8-digit numbers
and closes the picker at the first. Titles that start with a date ("20240101 sketch") trigger it too. Only
pasting works. Apply on Enter or on paste instead.

### B11 – Walls: Escape does not cancel a rename in Chrome (likely)
`done(false)` re-renders the tabs, which removes the focused input. Chrome fires `blur` on removal, and the
blur handler calls `done(true)` with the edited text (`walls.js:172-174`). Enter saves twice the same way.
Guard `done` with a "finished" flag. The input also sits inside a `<button>`, which is invalid HTML and
behaves differently in Firefox.

### B12 – Walls: PNG export fails without a message
- `canvas.toBlob` returns `null` when the canvas is too large; `URL.createObjectURL(null)` then throws and
  nothing tells the user (`walls.js:357-359`).
- The 12,000 px cap (`walls.js:345`) allows 144 megapixels. Firefox's limit is lower (about 125 MP,
  from memory), and the canvas needs up to 576 MB.
- Images that cannot be fetched are left out silently (`walls.js:355`).

### B13 – Blocklist is applied to infinite scroll only (likely)
The comment at `features.js:1311-1313` says every thumbnail arrives marked "blocked-content" and has to be
processed. `applyBlocklist` is called for infinite scroll, but not for:

- the extra figures the profile gallery box fetches (`features.js:795-799`) – they would stay blurred;
- "More from this artist" (`features.js:1276-1302`), which builds its own `<img>` and ignores blocked tags;
- the quick view, whose arrow keys step through blocked thumbnails and show them unblurred.

### B14 – Updater: deny-list, leftovers, error handling
- `SKIP` is a deny-list (`update.js:14`) while `build.sh` uses an allow-list (`build.sh:11`). Any new
  repository file (a licence, screenshots, docs, this review) is written into the extension folder.
- Files removed in a newer release are never deleted from the folder.
- The tree request has no `r.ok` check (`update.js:106-107`); a GitHub rate limit shows as
  "Update failed (file list)". Error texts in this path are not translated.
- A developer who loaded the extension from a git checkout and picks that folder gets the working tree
  overwritten; `checkFolder` only compares name and version.
- `updDone` is written to storage (`update.js:140`) and never read.

### B15 – Smaller confirmed bugs
- **Popup changes can be lost.** Writes are debounced by 120 ms (`popup.js:46-51`); closing the popup inside
  that window, or clicking the version link (`window.close()`, `popup.js:11`), drops the change. Flush on
  `pagehide` or write switches immediately.
- **Reset is not atomic.** `sync.clear()` then `sync.set()` (`popup.js:84`): if the popup closes between
  the two, the pinned artists are gone. `set(fresh)` alone is enough.
- **Missing i18n key.** `data-i18n-title="language"` (`popup.html:87`) has no entry, so the tooltip reads
  "language" in all three languages. Unused keys: `tagline`, `maxWidth`, `noCap`, `pin`, `wallAlready`.
- **Listener leak.** Every opening of the full-screen viewer calls `makePannable`, which adds two `window`
  listeners that are never removed (`features.js:289, 340-355`).
- **One failing feature stops the rest.** The init calls run in sequence with no isolation
  (`features.js:44-73`). `decodeURIComponent` on a malformed path throws in `initPins`
  (`features.js:1552`) and in `content.js:79`, and everything after it is skipped.
- **Ungated CSS.** `#pageid-submission #submissionImg { cursor: zoom-in !important }`
  (`features.css:123`) applies even with the extension switched off.
- **`F` in the walls page** also fires on Ctrl+F (`walls.js:318`). Delete has no undo.
- **Wall drag and remote changes.** A storage change from an FA tab replaces `walls` while a drag is in
  progress; the drag keeps moving a detached object and the move is lost (`walls.js:137-144, 275-296`).
- **Version in two manifests.** `build.sh:10` reads the version from `manifest.json` only; if
  `manifest.firefox.json` differs, `updates.json` announces a version the `.xpi` does not have.

## Decisions worth reconsidering

### D1 – Background requests to FA
One page view triggers several requests the user did not ask for:

| Trigger | Requests | Where |
|---------|----------|-------|
| Any submission whose title ends in a number (comic reader on) | up to 5 FA **search** pages | `features.js:383-389, 573-591` |
| Any submission page (layout on) | the artist's gallery page | `features.js:1268-1275` |
| Any gallery, browse, search or inbox page | the next page, before any scrolling | `features.js:1360-1366` |
| Each quick view step | both neighbours' pages, plus the next full-size image | `features.js:2033-2041` |
| Any watcher list | up to 100 pages, automatically | `features.js:1040` |
| Avatars that fail three times | a full profile page each | `features.js:944-962` |

Consequences: more load on FA and a higher chance of running into its rate limiting or Cloudflare checks;
page fetches of submissions the user never looked at may count as views; full-size preloads cost bandwidth.
The search and the watcher crawl are the two I would make on-demand first (a button, or scroll-driven).

### D2 – Click handling on thumbnails
- Ctrl/Cmd+click is intercepted and opens the submission in the **same** tab (`features.js:1758-1763`).
  Everywhere else that gesture means "open in a new tab".
- Every single click waits 230 ms to rule out a double-click (`features.js:1751-1775`), so the quick view
  always opens late.

### D3 – Self-updater instead of a store listing
The Chrome path writes code from a GitHub tag into the extension folder. The hash check compares the file
against the tree listing from the same GitHub account, so it detects corruption, not a compromised account
or a moved tag; the README's wording ("checked against GitHub's hash") can be read as more than that.
A Chrome Web Store listing would remove the folder picker, the updater and the developer-mode warning.
Also to verify: Brave ships without `showDirectoryPicker` by default, so the README's "Chrome / Edge /
Brave" one-click claim may not hold there.

### D4 – `chrome.runtime.reload()` as soon as an update is available
`background.js:27` reloads at once. The comment says Firefox, but it also runs for Chrome store installs.
It cuts off a running upload queue and disconnects every open FA tab. Reload when no `/submit/` tab is
sending, or leave it to the browser.

### D5 – Walls storage model
All walls are one array under one key, rewritten on every drag, zoom and image load, and modified
read-modify-write from the walls page, FA tabs and the pin bar (`walls.js:117-124`,
`features.js:1647-1660`, `content.js:125-127`). Concurrent edits overwrite each other. FA images are stored
as links to the full-size file, so a wall of 100 submissions loads 100 originals, and an image disappears
when its submission is deleted or replaced. There is no backup: uninstalling loses every wall.

### D6 – Privacy option "remove location data" has gaps
`stripExif` handles JPEG APP1 Exif and standard XMP only (`uploader.js:1276-1298`). Not covered: PNG
metadata chunks (`eXIf`, `tEXt`), extended XMP (`http://ns.adobe.com/xmp/extension/`), IPTC in APP13.
Users will rely on the checkbox, so either cover these or word the label as "JPEG EXIF".

### D7 – Other
- **Avatar cache in FA's `localStorage`** (`features.js:934-943`): entries are never purged, and the site's
  own storage is not the extension's to fill. `storage.local` fits better.
- **`sanitize()` is a deny-list** (`features.js:203-214`). The input is FA's own rendered HTML, so the risk
  is low, but `java\tscript:` URLs, `<form>`, `<base>`, `<meta>` and SVG pass. An allow-list of tags and
  attributes is the safer shape.
- **Settings apply half-live.** `content.js` reacts to storage changes at once (`content.js:324-333`);
  `features.js` reads settings once. Switching the extension off in the popup removes the layout classes but
  leaves the quick view, top bar buttons and listeners until a reload.
- **Not everything has a switch**, contrary to the README: full-screen viewer, +Fav without reload, link
  warnings, full watcher lists, "More from this artist".
- **Update check runs at browser start only** (`background.js:55-56`); a browser left open for weeks never
  shows the badge unless the popup is opened.

## Improvements

**Structure**
- Load `settings.js` in the content scripts instead of three hand-kept copies of the defaults
  (`settings.js`, `content.js:9`, `features.js:18`).
- Other duplicates to fold into shared modules: `newer()` and the release fetch (3×), the SVG icon helper
  and pin path (3×), the arrow-label map (2×), the profile-path regex (5×), the new-wall literal (2×).
- Generate the Firefox manifest from `manifest.json` plus the gecko block.
- `features.js` (2,174 lines) and `uploader.js` (1,379 lines, one `init()` closure) are hard to test; the
  parsers and pure helpers could move out.

**Safety net**
- Unit tests for the pure functions: `parseNumberedTitle`, `freeSpot`, `bbcode`, `cleanKw`, `newer`,
  `stripExif`, and `finalizeData` / `parseSubmission` against saved FA pages. FA markup changes are the main
  way this extension breaks, and fixtures would show it.
- CI: run `build.sh` and `web-ext lint` on push.
- Wrap each feature's init in `try/catch` and check `lastError` on storage writes.

**Product**
- Walls: undo for delete, JSON export/import, thumbnails at low zoom.
- Infinite scroll: remember the position for the Back button; the page number is lost today.
- Accessibility: dialogs have no `role="dialog"` or focus trap; pin reordering is mouse-only, although the
  Firefox manifest declares Android support.
- Set `minimum_chrome_version` (the code relies on `:has()`, File System Access and MV3 features).
