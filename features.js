// FA Ultrawide — image fit, quick view, comic reader, infinite scroll.
// Runs at document_idle. Feature toggles come from chrome.storage.sync (popup).
(() => {
  "use strict";

  const DEFAULTS = {
    enabled: true, ultrawide: true, design: true,
    imageFit: true, quickView: true, comic: true, comicHorizontal: false, infinite: true,
    archiveLink: false, thumb: 1.25
  };
  const root = document.documentElement;
  const page = document.body ? document.body.id : "";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const abs = (u) => (u && u.startsWith("//") ? "https:" + u : u);
  const viewId = (href) => {
    const m = String(href || "").match(/\/view\/(\d+)/);
    return m ? m[1] : null;
  };
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  let S = Object.assign({}, DEFAULTS);

  // Master switch off → nothing runs. "Ultrawide layout" and "Bubbles design" gate their own parts;
  // the feature switches (quick view, comic reader, …) work with either.
  const layoutOn = () => S.enabled && S.ultrawide;
  const designOn = () => S.enabled && S.design;
  chrome.storage.sync.get(DEFAULTS, (s) => {
    S = s;
    if (!S.enabled) return;
    if (page === "pageid-submission") {
      if (S.imageFit && layoutOn()) initImageFit();
      if (S.comic) initComic();
      initAjaxFav();
      if (layoutOn()) initMoreFromArtist();
    }
    if (S.infinite) initInfinite();
    if (S.archiveLink) initArchiveLink();
    if (page === "pageid-userpage") {
      if (layoutOn()) initProfileGallery();
      if (designOn()) initWatcherRows();
    }
    if (page === "pageid-watchlist") initWatchlistAll();
    initCommentToolbar();
    initExternalConfirm();
    indentReplies();
    if (designOn()) applyArrowButtons();
    onDomChange(() => { if (designOn()) applyArrowButtons(); initCommentToolbar(); indentReplies(); });
    if (S.quickView) initQuickView();
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "sync") return;
    for (const k in c) S[k] = c[k].newValue;
    root.classList.toggle("faw-fit", !!(S.enabled && S.ultrawide && S.imageFit && document.getElementById("submissionImg")));
  });

  // ------------------------------------------------------------------ fetching / parsing
  const docCache = new Map();
  async function fetchDoc(url, init) {
    const res = await fetch(url, Object.assign({ credentials: "same-origin" }, init));
    if (!res.ok) throw new Error("HTTP " + res.status);
    const html = await res.text();
    return { doc: new DOMParser().parseFromString(html, "text/html"), url: res.url };
  }

  // Value cell next to a label cell in FA's info table ("Resolution", "Category", ...)
  function metaValue(doc, label) {
    const scope = doc.querySelector(".submission-content-stats, .info") || doc;
    for (const n of scope.querySelectorAll("div, span, strong, b, td")) {
      if (n.children.length === 0 && n.textContent.trim() === label) {
        // Modern theme: a column of labels next to a column of values
        const parent = n.parentElement;
        const col = parent && parent.nextElementSibling;
        if (col && col.children.length === parent.children.length && parent.children.length > 1) {
          return col.children[[...parent.children].indexOf(n)].textContent.trim();
        }
        const v = n.nextElementSibling;
        if (v) return v.textContent.trim();
      }
    }
    return "";
  }
  function parseRes(str) {
    const m = String(str).match(/(\d+)\s*[x×]\s*(\d+)/);
    return m ? { w: +m[1], h: +m[2] } : null;
  }

  function classifyLink(a) {
    const t = (a.textContent || a.title || "").trim().toLowerCase();
    if (!t || !viewId(a.getAttribute("href"))) return null;
    if (/first/.test(t)) return "first";
    if (/last|latest|newest/.test(t)) return "last";
    if (/prev|back|<<|«|‹|←|^<$/.test(t)) return "prev";
    if (/next|>>|»|›|→|^>$/.test(t)) return "next";
    return null;
  }

  function parseSubmission(doc, url) {
    const id = viewId(url);
    const img = doc.querySelector("#submissionImg");
    const full = img ? abs(img.getAttribute("data-fullview-src") || img.getAttribute("src")) : null;
    const preview = img ? abs(img.getAttribute("data-preview-src") || img.getAttribute("src")) : null;
    const anyImg = full || abs((doc.querySelector(".submission-area img") || {}).getAttribute?.("src"));
    const titleEl = doc.querySelector(".submission-title h2, .submission-title");
    const title = titleEl ? titleEl.textContent.trim() : doc.title.replace(/\s*--.*$/, "");
    const artistA = [...doc.querySelectorAll(
      ".submission-description-header a[href^='/user/'], .submission-id-sub-container a[href^='/user/'], .c-usernameBlockSimple a[href^='/user/']"
    )].find((a) => a.textContent.trim());
    const favA = doc.querySelector("a[href^='/fav/'], a[href^='/unfav/']");
    const dlA = [...doc.querySelectorAll("a[href]")].find((a) => /^\s*download\s*$/i.test(a.textContent));
    const descEl = doc.querySelector(".submission-description");
    const comicLinks = {};
    if (descEl) {
      for (const a of descEl.querySelectorAll("a[href]")) {
        const kind = classifyLink(a);
        if (kind && !comicLinks[kind]) comicLinks[kind] = new URL(a.getAttribute("href"), location.origin).href;
      }
    }
    return {
      id, url, title, full: anyImg, preview,
      isImage: !!img,
      res: parseRes(metaValue(doc, "Resolution")),
      category: metaValue(doc, "Category"),
      species: metaValue(doc, "Species"),
      rating: (doc.querySelector(".rating-box, .rating span") || {}).textContent?.trim() || "",
      artist: artistA ? { name: artistA.textContent.trim(), href: artistA.getAttribute("href") } : null,
      fav: favA ? { href: favA.getAttribute("href"), faved: favA.getAttribute("href").startsWith("/unfav/") } : null,
      download: dlA ? abs(dlA.getAttribute("href")) : null,
      descHTML: descEl ? sanitize(descEl) : "",
      tags: [...doc.querySelectorAll(".submission-tags a[href*='/search/'], .tags a[href*='/search/']")].map((a) => ({
        text: a.textContent.trim(), href: a.getAttribute("href")
      })).filter((t) => t.text),
      comicLinks,
      comments: parseComments(doc),
      commentForm: parseCommentForm(doc)
    };
  }

  // Comments of a fetched submission page (for the quick view)
  function parseComments(doc) {
    const out = [];
    for (const c of doc.querySelectorAll("#comments-submission .comment_container")) {
      const cc = c.querySelector("comment-container");
      if (!cc) continue;
      const w = parseFloat((c.getAttribute("style") || "").match(/width:\s*([\d.]+)%/)?.[1] || "100");
      const av = cc.querySelector(".avatar img");
      const name = cc.querySelector(".c-usernameBlock__displayName, comment-username a");
      const user = cc.querySelector("comment-username a[href^='/user/'], .avatar a[href^='/user/']");
      const date = cc.querySelector("comment-date span[title], comment-date");
      const text = cc.querySelector("comment-user-text, .comment_text");
      out.push({
        depth: Math.max(0, Math.round((100 - w) / 3)),
        avatar: av ? abs(av.getAttribute("src")) : "",
        name: name ? name.textContent.trim() : "",
        href: user ? user.getAttribute("href") : "",
        date: date ? (date.getAttribute("title") || date.textContent).trim() : "",
        html: text ? sanitize(text) : ""
      });
    }
    return out;
  }
  function parseCommentForm(doc) {
    const form = doc.querySelector("#add_comment_form");
    if (!form) return null;
    const fields = {};
    for (const i of form.querySelectorAll("input[type=hidden][name]")) fields[i.name] = i.value;
    return { action: form.getAttribute("action") || "", fields };
  }

  function sanitize(node) {
    const c = node.cloneNode(true);
    // the header (avatar/title/artist/date) duplicates what the quick view already shows
    c.querySelectorAll("script, style, iframe, object, embed, .submission-description-header, .submission-id-container")
      .forEach((n) => n.remove());
    c.querySelectorAll("*").forEach((n) => {
      for (const at of [...n.attributes]) if (/^on/i.test(at.name)) n.removeAttribute(at.name);
    });
    return c.innerHTML;
  }

  function getSubmission(url) {
    const id = viewId(url);
    if (!docCache.has(id)) {
      const p = fetchDoc(new URL("/view/" + id + "/", location.origin).href)
        .then(({ doc }) => parseSubmission(doc, "/view/" + id + "/"));
      p.catch(() => docCache.delete(id));
      docCache.set(id, p);
    }
    return docCache.get(id);
  }

  // ------------------------------------------------------------------ image fit
  function initImageFit() {
    const img = document.getElementById("submissionImg");
    if (!img) return;
    const full = abs(img.getAttribute("data-fullview-src"));
    const res = parseRes(metaValue(document, "Resolution"));
    const setDims = (w, h) => {
      img.style.setProperty("--faw-ar", String(w / h));
      img.style.setProperty("--faw-natw", w + "px");
    };
    if (res) setDims(res.w, res.h);
    root.classList.add("faw-fit");

    // Upgrade to the full-resolution file when the preview would be upscaled
    const ensureFull = () => {
      if (!full || img.getAttribute("src") === full || abs(img.getAttribute("src")) === full) return;
      if (img.clientWidth > img.naturalWidth + 2 || root.classList.contains("faw-actual")) img.src = full;
    };
    img.addEventListener("load", () => {
      if (!res && img.naturalWidth) setDims(img.naturalWidth, img.naturalHeight);
      ensureFull();
    });
    if (img.complete) ensureFull();
    window.addEventListener("resize", ensureFull);

    // Click toggles fit / actual size (replaces FA's preview/full toggle)
    window.addEventListener("click", (e) => {
      if (e.target !== img || !S.imageFit || !S.enabled) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      root.classList.toggle("faw-actual");
      ensureFull();
      if (!root.classList.contains("faw-actual")) img.scrollIntoView({ block: "nearest" });
    }, true);
  }

  // ------------------------------------------------------------------ comic reader
  function initComic() {
    const img = document.getElementById("submissionImg");
    if (!img) return;
    const current = parseSubmission(document, location.pathname);
    const L = current.comicLinks;
    const byLinks = !!(L.prev || L.next || L.first);
    const titled = byLinks ? null : parseNumberedTitle(current.title);
    if (!byLinks && !(titled && current.artist)) return;

    const bar = el("div", "faw-comic-bar");
    const btn = el("button", "button standard", "Read as comic");
    const status = el("span");
    bar.append(btn, status);
    const area = img.closest(".submission-area") || img.parentElement;
    // Sit next to FA's "Main Gallery / Newer / Older" box under the image
    const placeBar = () => {
      const mini = document.getElementById("minigallery");
      if (mini) { mini.classList.add("faw-has-comic"); mini.appendChild(bar); }
      else area.after(bar);
    };

    // Title-based series ("Name - Page 9"): find siblings via FA search before showing the button
    let titleMatches = null;
    if (!byLinks) {
      findTitledSeries(titled, current).then((m) => {
        if (m.length < 2) return;
        titleMatches = m;
        btn.textContent = `Read as comic (${m.length} pages)`;
        placeBar();
      }).catch(() => {});
    } else {
      placeBar();
    }

    let container = null, loading = false;
    const MAX = 150;

    const setOpen = (open) => {
      root.classList.toggle("faw-comic-open", open);
      root.classList.toggle("faw-comic-h", open && !!S.comicHorizontal);
      container.hidden = !open;
      btn.textContent = open ? "Show single page" : `Read as comic (${container.children.length} pages)`;
      if (open) showCurrent();
    };
    const showCurrent = () => {
      const cur = container.querySelector(".is-current");
      if (!cur) return;
      if (S.comicHorizontal) {
        container.scrollIntoView({ block: "start" });
        window.scrollBy(0, -(parseFloat(getComputedStyle(root).getPropertyValue("--faw-nav")) || 50) - 6);
        container.scrollLeft += cur.getBoundingClientRect().left - container.getBoundingClientRect().left;
      } else {
        cur.scrollIntoView({ block: "start" });
        window.scrollBy(0, -56);
      }
    };

    btn.addEventListener("click", async () => {
      if (container) { setOpen(container.hidden); return; }
      if (loading) return;
      loading = true;
      btn.disabled = true;
      try {
        const pages = titleMatches
          ? await loadTitled(titleMatches, (n, total) => { status.textContent = `Loading page ${n}/${total}…`; })
          : await loadSeries(current, (n, dir) => { status.textContent = `Loading… ${n} pages found (${dir})`; });
        container = renderComic(pages, current.id);
        area.appendChild(container);
        if (S.comicHorizontal) enableHorizontal(container);
        status.textContent = `${pages.length} pages`;
        setOpen(true);
      } catch (err) {
        status.textContent = "Couldn't load series: " + err.message;
      } finally {
        loading = false;
        btn.disabled = false;
      }
    });

    async function loadSeries(cur, progress) {
      const seen = new Set([cur.id]);
      const before = [], after = [];
      // Walk backwards via "prev" (jump to "first" if there is no prev link)
      let p = cur, link = cur.comicLinks.prev || cur.comicLinks.first;
      while (link && before.length + after.length < MAX) {
        const id = viewId(link);
        if (!id || seen.has(id)) break;
        seen.add(id);
        p = await getSubmission(link);
        before.unshift(p);
        progress(before.length + after.length + 1, "earlier");
        link = p.comicLinks.prev || (p.comicLinks.first && !seen.has(viewId(p.comicLinks.first)) ? p.comicLinks.first : null);
        await sleep(200);
      }
      // If we jumped to "first", fill the gap forward until we reach cur
      if (before.length && !cur.comicLinks.prev && cur.comicLinks.first) {
        let q = before[before.length - 1];
        while (q.comicLinks.next && viewId(q.comicLinks.next) !== cur.id && before.length < MAX) {
          const id = viewId(q.comicLinks.next);
          if (seen.has(id)) break;
          seen.add(id);
          q = await getSubmission(q.comicLinks.next);
          before.push(q);
          progress(before.length + 1, "earlier");
          await sleep(200);
        }
      }
      // Walk forwards via "next"
      let n = cur;
      while (n.comicLinks.next && before.length + after.length < MAX) {
        const id = viewId(n.comicLinks.next);
        if (!id || seen.has(id)) break;
        seen.add(id);
        n = await getSubmission(n.comicLinks.next);
        after.push(n);
        progress(before.length + after.length + 1, "later");
        await sleep(200);
      }
      return [...before, cur, ...after];
    }

    async function loadTitled(matches, progress) {
      const pages = [];
      for (let i = 0; i < matches.length; i++) {
        progress(i + 1, matches.length);
        if (matches[i].id === current.id) { pages.push(current); continue; }
        const wasCached = docCache.has(matches[i].id);
        pages.push(await getSubmission("/view/" + matches[i].id + "/"));
        if (!wasCached) await sleep(200);
      }
      return pages;
    }

    function renderComic(pages, currentId) {
      const c = el("div", "faw-comic");
      pages.forEach((p, i) => {
        const wrap = el("div", "faw-comic__page" + (p.id === currentId ? " is-current" : ""));
        const label = el("div", "faw-comic__label");
        const a = el("a", null, p.title || "Untitled");
        a.href = "/view/" + p.id + "/";
        label.append(`Page ${i + 1}/${pages.length} · `, a);
        const im = el("img");
        im.loading = i === 0 || p.id === currentId ? "eager" : "lazy";
        im.decoding = "async";
        im.src = p.full;
        im.alt = p.title || "";
        if (p.res) {
          im.style.setProperty("--natw", p.res.w + "px");
          im.style.setProperty("--ar", String(p.res.w / p.res.h));
          im.style.aspectRatio = p.res.w + " / " + p.res.h;
        }
        wrap.append(label, im);
        c.appendChild(wrap);
      });
      return c;
    }

    // Horizontal reader: each wheel notch / arrow key steps one page (smooth). Plain pixel scrolling
    // fought with scroll-snap, which pulled small wheel deltas back to the same page.
    function enableHorizontal(strip) {
      const pageIndex = () => {
        const sl = strip.getBoundingClientRect().left;
        const pages = [...strip.children];
        let i = pages.findIndex((pg) => { const r = pg.getBoundingClientRect(); return r.left + r.width / 2 > sl; });
        return { pages, i: i < 0 ? pages.length - 1 : i, sl };
      };
      const step = (dir) => {
        const { pages, i, sl } = pageIndex();
        const j = Math.max(0, Math.min(pages.length - 1, i + dir));
        if (j === i && ((dir > 0 && strip.scrollLeft >= strip.scrollWidth - strip.clientWidth - 1) || (dir < 0 && strip.scrollLeft <= 0))) return false;
        strip.scrollTo({ left: strip.scrollLeft + pages[j].getBoundingClientRect().left - sl, behavior: "smooth" });
        return true;
      };
      let lastWheel = 0;
      strip.addEventListener("wheel", (e) => {
        if (!root.classList.contains("faw-comic-h") || e.ctrlKey) return;
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (!d) return;
        const max = strip.scrollWidth - strip.clientWidth;
        if ((d < 0 && strip.scrollLeft <= 0) || (d > 0 && strip.scrollLeft >= max - 1)) return; // let the page scroll at the ends
        e.preventDefault();
        const now = performance.now();
        if (now - lastWheel < 280) return;                       // one page per notch / gesture burst
        lastWheel = now;
        step(d > 0 ? 1 : -1);
      }, { passive: false });
      document.addEventListener("keydown", (e) => {
        if (!root.classList.contains("faw-comic-h") || document.querySelector(".faw-qv:not([hidden])")) return;
        if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable]")) return;
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        step(e.key === "ArrowRight" ? 1 : -1);
        e.preventDefault();
      });
    }
  }

  // "Aquarium Encounter - Page 9", "Story pt.3", "Comic #12", "Name 4/10" → { base, num }
  function parseNumberedTitle(title) {
    const m = String(title || "").trim().match(
      /^(.*?)[\s\-–—:|,.(\[]*(?:page|pg|part|pt|chapter|ch|episode|ep|no)?\.?\s*#?\s*(\d{1,4})(?:\s*(?:\/|of)\s*\d{1,4})?[\s)\]]*$/i
    );
    if (!m) return null;
    if (+m[2] >= 1900 && +m[2] <= 2100) return null;   // a year, not a page number
    const base = m[1].replace(/[\s\-–—:|,.(\[#]+$/, "").trim();
    if (base.length < 3) return null;
    return { base, num: +m[2] };
  }
  function normBase(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  // Searches the artist's submissions for the same base title, returns [{id, num}] sorted by page number
  async function findTitledSeries(titled, current) {
    const artist = (current.artist.href.match(/\/user\/([^/]+)/) || [])[1];
    if (!artist) return [];
    const q = `@title "${titled.base.replace(/["@!&|()\-]/g, " ").replace(/\s+/g, " ").trim()}" @lower ${artist}`;
    const want = normBase(titled.base);
    const byNum = new Map([[titled.num, current.id]]);
    let next = { url: new URL("/search/?q=" + encodeURIComponent(q), location.origin).href };
    for (let pageNo = 0; next && pageNo < 5; pageNo++) {
      const { doc, url } = await fetchDoc(next.url, next.init);
      for (const a of doc.querySelectorAll("section.gallery figure figcaption a[href*='/view/']")) {
        const t = parseNumberedTitle(a.getAttribute("title") || a.textContent);
        if (!t || normBase(t.base) !== want || byNum.has(t.num)) continue;
        byNum.set(t.num, viewId(a.getAttribute("href")));
      }
      next = findNext(doc, url);
      if (next) await sleep(250);
    }
    return [...byNum].sort((a, b) => a[0] - b[0]).map(([num, id]) => ({ num, id }));
  }

  // ------------------------------------------------------------------ profile: "Archived Gallery" link
  // Account removed/disabled: FA shows only a "System Message" box → offer the archive below it
  function initArchiveUnavailable() {
    const m = location.pathname.match(/^\/(?:user|gallery|scraps|favorites|journals|commissions|stats)\/([^/]+)/i);
    if (!m || document.querySelector(".faw-archive-sys")) return;
    const head = [...document.querySelectorAll("h1, h2, h3, .section-header, .notice-message, td.cat, th")]
      .find((e) => /system message/i.test(e.textContent) && e.textContent.length < 200);
    if (!head) return;
    const box = head.closest("section, table, .notice-message") || head.parentElement;
    const name = decodeURIComponent(m[1]).toLowerCase();
    const url = "https://furarchiver.net/Artist/Gallery?artist=" + encodeURIComponent(name);
    const wrap = el("div", "faw-archive-sys");
    const btn = el("button", "button standard", "Archived Gallery");
    btn.type = "button";
    btn.title = "Backup of this gallery on furarchiver.net (external site)";
    btn.addEventListener("click", () => confirmExternal(`Open the archived gallery of “${name}” on furarchiver.net?`, url));
    wrap.append(el("span", null, "This account isn't available. An archived copy of the gallery may exist:"), btn);
    box.after(wrap);
    const match = () => { wrap.style.width = box.getBoundingClientRect().width + "px"; };
    match();
    new ResizeObserver(match).observe(box);
  }
  function initArchiveLink() {
    const ul = document.querySelector(".user-nav-page-links");
    if (!ul) { initArchiveUnavailable(); return; }
    if (ul.querySelector(".faw-archive")) return;
    const home = [...ul.querySelectorAll("a[href]")].map((a) => a.getAttribute("href").match(/^\/user\/([^/]+)/)).find(Boolean);
    const m = home || location.pathname.match(/^\/(?:user|gallery|scraps|favorites|journals|commissions|stats)\/([^/]+)/i);
    if (!m) return;
    const name = decodeURIComponent(m[1]).toLowerCase();
    const url = "https://furarchiver.net/Artist/Gallery?artist=" + encodeURIComponent(name);

    const li = el("li", "faw-archive");
    const h3 = el("h3");
    const a = el("a", null, "Archived Gallery");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = "Backup of this gallery on furarchiver.net (external site)";
    const ask = (e) => {
      if (e.type === "auxclick" && e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      confirmExternal(`Open the archived gallery of “${name}” on furarchiver.net?`, url);
    };
    a.addEventListener("click", ask);
    a.addEventListener("auxclick", ask);
    h3.appendChild(a);
    li.appendChild(h3);
    const gallery = [...ul.children].find((x) => /^\/gallery\//.test(x.querySelector("a")?.getAttribute("href") || ""));
    if (gallery) gallery.after(li); else ul.appendChild(li);
  }

  // Small in-page confirmation (a native confirm() would block the page)
  function confirmExternal(text, url) {
    const ov = el("div", "faw-confirm");
    const box = el("div", "faw-confirm__box");
    const p = el("p", null, text);
    const host = el("div", "faw-confirm__url", url);
    const row = el("div", "faw-confirm__row");
    const cancel = el("button", "button standard", "Cancel");
    const ok = el("button", "button standard faw-confirm__ok", "Open in new tab");
    row.append(cancel, ok);
    box.append(p, host, row);
    ov.appendChild(box);
    document.body.appendChild(ov);
    ok.focus();
    const done = (go) => {
      ov.remove();
      document.removeEventListener("keydown", onKey, true);
      if (go) window.open(url, "_blank", "noopener,noreferrer");
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); done(false); }
      else if (e.key === "Enter") { e.preventDefault(); done(true); }
    };
    document.addEventListener("keydown", onKey, true);
    cancel.onclick = () => done(false);
    ok.onclick = () => done(true);
    ov.addEventListener("click", (e) => { if (e.target === ov) done(false); });
  }

  // ------------------------------------------------------------------ profile: gallery box
  // Justified rows of larger thumbnails that exactly fill the Gallery box next to Featured;
  // pulls more submissions from the gallery if the 20 on the profile aren't enough.
  function initProfileGallery() {
    const box = document.getElementById("gallery-latest-submissions");
    const section = box && box.closest(".gallery_container");
    if (!box || !section || !box.querySelector("figure")) return;
    box.classList.add("faw-justified");

    const GAP = 6, PAD = 6;
    const home = location.pathname.match(/^\/user\/([^/]+)/);
    let next = home ? { url: new URL(`/gallery/${home[1]}/`, location.origin).href } : null;
    let pagesFetched = 0, fetching = false;
    const seen = new Set([...box.querySelectorAll(":scope > figure")].map((f) => f.id));

    const ratio = (f) => {
      const i = f.querySelector("img");
      if (!i) return 1;
      const w = +i.getAttribute("data-width") || i.naturalWidth || 1;
      const h = +i.getAttribute("data-height") || i.naturalHeight || 1;
      return w / h;
    };

    // Break items into justified rows for a target row height; returns rows that fit into maxH
    function plan(figs, W, maxH, target) {
      const rows = [];
      let row = [], sum = 0, y = 0;
      for (const f of figs) {
        row.push(f);
        sum += ratio(f);
        if (sum * target + GAP * (row.length - 1) >= W) {
          const h = (W - GAP * (row.length - 1)) / sum;
          if (y + h > maxH + 0.5) return { rows, used: y, complete: true };
          rows.push({ items: row, h });
          y += h + GAP;
          row = []; sum = 0;
        }
      }
      return { rows, used: y, complete: false, rest: row };
    }

    function layout() {
      const figs = [...box.querySelectorAll(":scope > figure")];
      const contained = getComputedStyle(section).contain.includes("size");
      const W = box.clientWidth - 2 * PAD;
      const base = Math.round(170 * (+S.thumb || 1.25));
      const maxH = contained ? box.clientHeight - 2 * PAD : 2 * base + GAP;
      if (W <= 0 || maxH <= 0) return;

      // Try many row heights. Leftover space is absorbed by slightly wider row gaps (≤6px each)
      // and then by cropping rows a little (object-fit). Among layouts that crop under 12% and still
      // show at least 5 submissions, take the one with the LARGEST thumbnails (the gallery should
      // stand out against Favorites); otherwise fall back to whatever shows the most.
      let best = null, fallback = null;
      const MIN_ITEMS = Math.min(5, figs.length);
      const count = (p) => p.rows.reduce((n, r) => n + r.items.length, 0);
      for (let k = 0.5; k <= 2.2; k += 0.01) {
        const p = plan(figs, W, maxH, base * k);
        if (!p.complete || !p.rows.length) { fallback = fallback || p; continue; }
        const n = p.rows.length;
        const left = Math.max(0, maxH - (p.used - GAP));
        const avg = (p.used - GAP * n) / n;
        const gapExtra = Math.min(left, (n - 1) * 6);
        const crop = (left - gapExtra) / n / avg;
        Object.assign(p, { left, avg, gapExtra, crop, items: count(p) });
        const good = crop <= 0.12 && p.items >= MIN_ITEMS;
        const bestGood = best && best.crop <= 0.12 && best.items >= MIN_ITEMS;
        if (good && (!bestGood || p.avg > best.avg)) best = p;
        else if (!good && !bestGood && (!best || p.items > best.items || (p.items === best.items && crop < best.crop))) best = p;
      }
      best = best || fallback;
      if (!best) return;

      // not enough submissions to fill the box → fetch more, then lay out again
      if ((!best.complete || best.items >= figs.length - 1) && figs.length < 40 && next && pagesFetched < 4 && !fetching) loadMore();

      figs.forEach((f) => f.classList.add("faw-hide"));
      const n = best.rows.length;
      box.style.setProperty("--faw-rowgap", (GAP + (best.complete && n > 1 ? best.gapExtra / (n - 1) : 0)) + "px");
      const extra = best.complete ? Math.max(0, best.left - best.gapExtra) : 0;
      best.rows.forEach((r) => {
        const h = r.h + extra / n;
        for (const f of r.items) {
          f.classList.remove("faw-hide");
          f.style.setProperty("--w", Math.floor(ratio(f) * r.h) + "px");
          f.style.setProperty("--h", Math.floor(h) + "px");
          upgradeThumb(f, h);
        }
      });
      if (!best.complete && best.rest) {
        const h = Math.min(base, maxH - best.used);
        if (h > 40) for (const f of best.rest) {
          f.classList.remove("faw-hide");
          f.style.setProperty("--w", Math.floor(ratio(f) * h) + "px");
          f.style.setProperty("--h", Math.floor(h) + "px");
          upgradeThumb(f, h);
        }
      }
    }

    function upgradeThumb(f, h) {
      const i = f.querySelector("img");
      if (!i || i.dataset.fawUp || h <= 150) return;
      const src = i.getAttribute("src") || "";
      const m = src.match(/@(\d+)-/);
      if (m && +m[1] < 400) { i.src = src.replace(/@\d+-/, "@400-"); }
      i.dataset.fawUp = "1";
    }

    async function loadMore() {
      fetching = true;
      try {
        const { doc, url } = await fetchDoc(next.url, next.init);
        pagesFetched++;
        let added = 0;
        for (const f of doc.querySelectorAll("section.gallery figure")) {
          if (!f.id || seen.has(f.id)) continue;
          seen.add(f.id);
          box.appendChild(document.adoptNode(f));
          added++;
        }
        next = added ? findNext(doc, url) : null;
      } catch (e) {
        next = null;
      }
      fetching = false;
      layout();
    }

    let lastW = 0, lastH = 0, timer = null;
    new ResizeObserver(() => {
      const contained = getComputedStyle(section).contain.includes("size");
      const w = box.clientWidth, h = contained ? box.clientHeight : 0;
      if (Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 2) return;
      lastW = w; lastH = h;
      clearTimeout(timer);
      timer = setTimeout(layout, 60);
    }).observe(box);
    layout();
  }

  // ------------------------------------------------------------------ pagination: << < > >> buttons
  // Shouts, search, browse… The original label stays in the DOM (hidden span) because FA's own
  // scripts read the button text; the arrow is drawn with CSS. Re-applied when FA re-renders.
  const ARROWS = {
    "first": "<<", "first page": "<<",
    "prev": "<", "prev page": "<", "previous": "<", "previous page": "<", "back": "<",
    "next": ">", "next page": ">",
    "last": ">>", "last page": ">>"
  };
  function tidyPageSelects(scope) {
    for (const o of (scope || document).querySelectorAll("select.button option")) {
      if (/[⚞⚟]/.test(o.textContent)) o.textContent = o.textContent.replace(/[⚞⚟]/g, "").trim();
    }
  }
  function applyArrowButtons(scope) {
    tidyPageSelects(scope);
    for (const b of (scope || document).querySelectorAll("button, a.button, .button > a")) {
      if (b.classList.contains("faw-arrow-btn") || b.closest("#ddmenu, .faw-qv, .faw-confirm")) continue;
      const label = b.textContent.trim().toLowerCase();
      const arrow = ARROWS[label];
      if (!arrow || b.children.length) continue;
      const span = el("span", "faw-hide-text", b.textContent);
      b.textContent = "";
      b.appendChild(span);
      b.dataset.fawArrow = arrow;
      if (!b.title) b.title = span.textContent.trim();
      b.classList.add("faw-arrow-btn");
    }
  }

  // One shared observer for features that must survive FA re-rendering parts of the page
  const domHooks = [];
  function onDomChange(fn) {
    domHooks.push(fn);
    if (domHooks.length > 1) return;
    let t = null;
    new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => domHooks.forEach((f) => { try { f(); } catch (e) {} }), 80);
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ------------------------------------------------------------------ profile: recent watchers as avatars
  function initWatcherRows() {
    for (const block of document.querySelectorAll(".watched-by-block, .is-watching-block")) {
      const table = block.querySelector(".section-body table");
      if (!table || block.querySelector(".faw-watchrow")) continue;
      const links = [...table.querySelectorAll("a[href^='/user/']")];
      if (!links.length) continue;
      const row = el("div", "faw-watchrow");
      for (const a of links) {
        const slug = (a.getAttribute("href").match(/^\/user\/([^/]+)/) || [])[1];
        if (!slug) continue;
        const item = el("a");
        item.href = a.getAttribute("href");
        item.title = a.textContent.trim();
        const img = el("img");
                img.alt = "";
        attachAvatar(img, slug);
        item.append(img, el("span", null, a.textContent.trim()));
        row.appendChild(item);
      }
      table.before(row);
      fitWatchRow(row);
      new ResizeObserver(() => fitWatchRow(row)).observe(row);
    }
  }
  // Exactly one row: hide whatever doesn't fully fit instead of wrapping or clipping it
  function fitWatchRow(row) {
    const items = [...row.children];
    items.forEach((it) => { it.hidden = false; });
    const right = row.getBoundingClientRect().right - parseFloat(getComputedStyle(row).paddingRight);
    const top = items[0] ? items[0].getBoundingClientRect().top : 0;
    for (const it of items) {
      const r = it.getBoundingClientRect();
      if (r.right > right + 1 || r.top > top + 2) it.hidden = true;
    }
  }

  // Avatar tiles for the full watchers / watching list
  // The short form a.furaffinity.net/<name>.gif is unreliable (stale or default images), so the real
  // URL (with its timestamp) is read from the user's page — only for avatars that scroll into view,
  // two requests at a time, cached in localStorage for two weeks.
  const AV_DEFAULT = "https://a.furaffinity.net/default.gif";
  const AV_TTL = 14 * 864e5;
  const avPending = new Map();
  const avQueue = [];
  let avActive = 0;
  function avCacheGet(slug) {
    try {
      const v = JSON.parse(localStorage.getItem("faw-av:" + slug) || "null");
      if (v && Date.now() - v.t < AV_TTL) return v.u;
    } catch {}
    return null;
  }
  function avCacheSet(slug, u) {
    try { localStorage.setItem("faw-av:" + slug, JSON.stringify({ u, t: Date.now() })); } catch {}
  }
  function avPump() {
    while (avActive < 2 && avQueue.length) {
      const { slug, resolve } = avQueue.shift();
      avActive++;
      fetch("/user/" + encodeURIComponent(slug) + "/", { credentials: "include" })
        .then((r) => r.text())
        .then((html) => {
          const esc = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const m = html.match(new RegExp("(?:https?:)?//a\\.furaffinity\\.net/(\\d+)/" + esc + "\\.gif", "i"));
          const nav = !m && html.match(/userpage-nav-avatar[\s\S]{0,400}?src="([^"]+)"/);
          const u = m ? "https://a.furaffinity.net/" + m[1] + "/" + slug + ".gif"
            : nav ? new URL(nav[1], location.href).href : AV_DEFAULT;
          avCacheSet(slug, u);
          resolve(u);
        })
        .catch(() => resolve(AV_DEFAULT))
        .finally(() => { avActive--; setTimeout(avPump, 120); });
    }
  }
  function resolveAvatar(slug) {
    slug = String(slug).toLowerCase();
    const cached = avCacheGet(slug);
    if (cached) return Promise.resolve(cached);
    if (!avPending.has(slug)) avPending.set(slug, new Promise((resolve) => { avQueue.push({ slug, resolve }); avPump(); }));
    return avPending.get(slug);
  }
  // Fast path: the short avatar address loads instantly. A real (timestamped) URL from an earlier
  // lookup is preferred when cached; only avatars that fail to load are looked up on the profile.
  function attachAvatar(img, slug) {
    const key = String(slug).toLowerCase();
    img.loading = "lazy";
    img.decoding = "async";
    const cached = avCacheGet(key);
    img.onerror = () => {
      img.onerror = () => { img.onerror = null; img.src = AV_DEFAULT; };
      resolveAvatar(key).then((u) => { if (u !== img.src) img.src = u; else img.onerror(); });
    };
    img.src = cached || "https://a.furaffinity.net/" + encodeURIComponent(key) + ".gif";
  }
  function decorateWatchlist(list) {
    if (!designOn()) return;
    list.classList.add("faw-tiles");
    for (const it of list.children) {
      if (it.dataset.fawTile) continue;
      const a = it.querySelector("a[href^='/user/']");
      if (!a) continue;
      const slug = (a.getAttribute("href").match(/^\/user\/([^/]+)/) || [])[1];
      if (!slug) continue;
      const img = el("img", "faw-tile__img");
            img.alt = "";
      attachAvatar(img, slug);
      a.prepend(img);
      it.dataset.fawTile = "1";
    }
  }

  // ------------------------------------------------------------------ watchers / watching: all on one page
  async function initWatchlistAll() {
    const list = document.querySelector(".watch-list");
    const nav = document.querySelector(".watchlist-navigation");
    if (!list) return;
    decorateWatchlist(list);
    let next = findNext(document, location.href);
    if (!next) return;
    const status = el("div", "faw-inf-status", "Loading all entries…");
    list.after(status);
    if (nav) nav.style.display = "none";
    const seen = new Set([...list.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")));
    let pages = 1;
    try {
      while (next && pages < 100) {
        const { doc, url } = await fetchDoc(next.url, next.init);
        const items = [...doc.querySelectorAll(".watch-list > *")].filter((it) => {
          const h = it.querySelector("a[href]")?.getAttribute("href");
          if (!h || seen.has(h)) return false;
          seen.add(h);
          return true;
        });
        if (!items.length) break;
        // FA starts a new row ("new-section") at each new initial letter; a page boundary inside the
        // same letter must not start one
        const initial = (it) => (it.textContent.replace(/[^a-z0-9]/gi, "")[0] || "").toLowerCase();
        const last = list.lastElementChild;
        if (last && items[0].classList.contains("new-section") && initial(items[0]) === initial(last)) {
          items[0].classList.remove("new-section");
          items[0].classList.add("inline");
        }
        for (const it of items) list.appendChild(document.adoptNode(it));
        decorateWatchlist(list);
        pages++;
        status.textContent = `Loading all entries… ${list.children.length} so far`;
        next = findNext(doc, url);
        if (next) await sleep(250);
      }
      status.textContent = `${list.children.length} entries`;
    } catch (err) {
      status.textContent = `Stopped after ${list.children.length} entries (${err.message})`;
      if (nav) nav.style.display = "";
    }
  }

  // ------------------------------------------------------------------ comment box: more BBCode buttons
  // FA's toolbar only has B/I/U + alignment; add the rest of FA's tags & codes.
  // Two rows: text formatting (FA's B/I/U first) / alignment + inserts. Order is set via CSS `order`
  // because FA's own buttons and ours share one flex container.
  const BB_TOOLS = [
    { row: 2, sep: true },
    { row: 2, t: "S", title: "Strikethrough", wrap: ["[s]", "[/s]"], cls: "s" },
    { row: 2, t: "x²", title: "Superscript", wrap: ["[sup]", "[/sup]"] },
    { row: 2, t: "x₂", title: "Subscript", wrap: ["[sub]", "[/sub]"] },
    { row: 2, sep: true },
    { row: 2, t: "H1", title: "Heading 1", wrap: ["[h1]", "[/h1]"] },
    { row: 2, t: "H2", title: "Heading 2", wrap: ["[h2]", "[/h2]"] },
    { row: 2, t: "H3", title: "Heading 3", wrap: ["[h3]", "[/h3]"] },
    { row: 2, sep: true },
    { row: 2, t: "A", title: "Text colour", color: true },
    { row: 3, br: true },
    { row: 5, sep: true },
    { row: 5, t: "❝", title: "Quote", wrap: ["[quote]", "[/quote]"] },
    { row: 5, t: "◼", title: "Spoiler", wrap: ["[spoiler]", "[/spoiler]"] },
    { row: 5, t: "🔗", title: "Link (select a URL or text)", url: true },
    { row: 5, t: "▶", title: "YouTube video", wrap: ["[yt]", "[/yt]"] },
    { row: 5, sep: true },
    { row: 5, t: "@i", title: "User icon  :iconname:", wrap: [":icon", ":"] },
    { row: 5, t: "@l", title: "User link  :linkname:", wrap: [":link", ":"] },
    { row: 5, t: "—", title: "Horizontal line", insert: "\n-----\n" }
  ];
  function insertBB(ta, open, close, placeholder) {
    const a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
    const sel = v.slice(a, b) || placeholder || "";
    ta.focus();
    ta.setRangeText(open + sel + (close || ""), a, b, "end");
    if (!v.slice(a, b) && placeholder == null) {             // nothing selected: put the cursor between the tags
      const pos = a + open.length;
      ta.setSelectionRange(pos, pos);
    }
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function initCommentToolbar() {
    for (const bar of document.querySelectorAll("form span.floatleft:has(> .bbcodeformat)")) {
      if (bar.querySelector(".faw-bb")) continue;
      const ta = bar.closest("form").querySelector("textarea");
      if (!ta) continue;
      // FA puts &nbsp; between its buttons; in the flex toolbar they become blank items that indent row 1
      for (const n of [...bar.childNodes]) if (n.nodeType === 3) n.remove();
      const wrapBox = el("span", "faw-bb");
      for (const tool of BB_TOOLS) {
        if (tool.sep || tool.br) {
          const x = el("span", tool.br ? "faw-bb__br" : "faw-bb__sep");
          x.style.order = tool.row;
          wrapBox.appendChild(x);
          continue;
        }
        const btn = el("button", "faw-bb__btn" + (tool.cls ? " is-" + tool.cls : ""), tool.t);
        btn.style.order = tool.row;
        btn.type = "button";
        btn.title = tool.title;
        if (tool.color) {
          const picker = el("input");
          picker.type = "color";
          picker.value = "#e0a64b";
          picker.className = "faw-bb__color";
          picker.addEventListener("change", () => insertBB(ta, `[color=${picker.value}]`, "[/color]"));
          btn.addEventListener("click", () => picker.click());
          btn.appendChild(picker);
        } else if (tool.url) {
          btn.addEventListener("click", () => {
            const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
            if (/^https?:\/\//i.test(sel)) insertBB(ta, `[url=${sel}]`, "[/url]", sel);
            else insertBB(ta, "[url=https://]", "[/url]");
          });
        } else if (tool.insert) {
          btn.addEventListener("click", () => insertBB(ta, tool.insert, "", ""));
        } else {
          btn.addEventListener("click", () => insertBB(ta, tool.wrap[0], tool.wrap[1]));
        }
        wrapBox.appendChild(btn);
      }
      bar.appendChild(wrapBox);
    }
  }

  // ------------------------------------------------------------------ replies: depth for indentation
  function indentReplies() {
    for (const c of document.querySelectorAll(":is(#comments-submission, #comments-journal) .comment_container:not([data-faw-depth])")) {
      const w = parseFloat((c.getAttribute("style") || "").match(/width:\s*([\d.]+)%/)?.[1] || "100");
      const depth = Math.max(0, Math.round((100 - w) / 3));
      c.dataset.fawDepth = String(depth);
      c.style.setProperty("--faw-depth", String(Math.min(depth, 8)));
    }
  }

  // ------------------------------------------------------------------ external links: in-page confirmation
  // Replaces FA's "You are leaving Fur Affinity" interstitial with the same overlay as Archived Gallery.
  function initExternalConfirm() {
    const handler = (e) => {
      if (e.defaultPrevented) return;
      if (e.type === "click" && (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)) return;
      if (e.type === "auxclick" && e.button !== 1) return;
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a || a.closest(".faw-archive, .faw-confirm")) return;
      let url;
      try { url = new URL(a.getAttribute("href"), location.href); } catch (err) { return; }
      if (!/^https?:$/.test(url.protocol)) return;
      if (/(^|\.)(furaffinity\.net|facdn\.net)$/i.test(url.hostname)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      confirmExternal("You are leaving Fur Affinity for:", url.href);
    };
    window.addEventListener("click", handler, true);
    window.addEventListener("auxclick", handler, true);
  }

  // ------------------------------------------------------------------ submission: +Fav without reload
  function initAjaxFav() {
    window.addEventListener("click", async (e) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const a = e.target.closest && e.target.closest("a[href^='/fav/'], a[href^='/unfav/']");
      if (!a || a.closest(".faw-qv")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (a.dataset.fawBusy) return;
      a.dataset.fawBusy = "1";
      a.classList.add("faw-busy");
      const wasFav = a.getAttribute("href").startsWith("/unfav/");
      try {
        const { doc } = await fetchDoc(new URL(a.getAttribute("href"), location.origin).href);
        const fresh = doc.querySelector("a[href^='/fav/'], a[href^='/unfav/']");
        if (!fresh) throw new Error("no fav link in response");
        for (const link of document.querySelectorAll("a[href^='/fav/'], a[href^='/unfav/']")) {
          if (link.closest(".faw-qv")) continue;
          link.setAttribute("href", fresh.getAttribute("href"));
          link.textContent = fresh.textContent;
        }
        // keep the Favorites counter in the stats in sync
        for (const lab of document.querySelectorAll(".submission-page-stats .highlight")) {
          if (!/favorites/i.test(lab.textContent)) continue;
          const num = lab.previousElementSibling;
          const n = parseInt((num && num.textContent || "").replace(/\D/g, ""), 10);
          if (num && !isNaN(n)) num.textContent = String(Math.max(0, n + (wasFav ? -1 : 1)));
        }
      } catch (err) {
        location.href = a.href;                                   // fall back to FA's normal behaviour
      } finally {
        delete a.dataset.fawBusy;
        a.classList.remove("faw-busy");
      }
    }, true);
  }

  // ------------------------------------------------------------------ submission: "More from artist" below the comments
  async function initMoreFromArtist() {
    const list = document.querySelector(".comments-list");
    if (!list || document.querySelector(".faw-more")) return;
    const me = parseSubmission(document, location.pathname);
    const slug = me.artist && (me.artist.href.match(/^\/user\/([^/]+)/) || [])[1];
    if (!slug) return;
    try {
      const { doc } = await fetchDoc(new URL(`/gallery/${slug}/`, location.origin).href);
      const figs = [...doc.querySelectorAll("section.gallery figure")]
        .filter((f) => viewId(f.querySelector("a[href*='/view/']")?.getAttribute("href")) !== me.id)
        .slice(0, 9);
      if (!figs.length) return;
      const box = el("section", "faw-more");
      const head = el("div", "faw-more__head");
      head.append(el("span", null, `More from ${me.artist.name}`));
      const all = el("a", null, "View gallery");
      all.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>');
      all.href = `/gallery/${slug}/`;
      head.appendChild(all);
      const grid = el("div", "faw-more__grid");
      for (const f of figs) {
        const a = f.querySelector("a[href*='/view/']");
        const img = f.querySelector("img");
        if (!a || !img) continue;
        const t = el("a", "faw-more__item");
        t.href = a.getAttribute("href");
        t.title = (f.querySelector("figcaption a[title]") || {}).title || img.getAttribute("alt") || "";
        const im = el("img");
        im.loading = "lazy";
        im.alt = t.title;
        im.src = abs(img.getAttribute("src")).replace(/@\d+-/, "@300-");
        im.onerror = () => { im.onerror = null; im.src = abs(img.getAttribute("src")); };
        t.appendChild(im);
        grid.appendChild(t);
      }
      box.append(head, grid);
      list.append(el("div", "faw-sep"), box);
    } catch (e) { /* optional extra, ignore failures */ }
  }

  // ------------------------------------------------------------------ infinite scroll
  let infinite = null;

  function initInfinite() {
    if (!document.querySelector("section.gallery")) return;
    if (/^pageid-(userpage|submission)$/.test(page)) return;

    let next = findNext(document, location.href);
    if (!next) return;

    let pageNo = 1, loading = false, done = false;
    const isMsgCenter = page === "pageid-messagecenter-submissions";
    const status = el("div", "faw-inf-status", "Scroll for more");
    const lastSection = () => {
      const all = document.querySelectorAll("section.gallery");
      return all[all.length - 1];
    };
    lastSection().after(status);

    // The next page is always fetched ahead of time, so appending is instant when it's needed
    let pending = null;
    const prefetch = () => {
      if (next && !pending) {
        pending = fetchDoc(next.url, next.init);
        pending.catch(() => {});
      }
    };
    prefetch();

    async function loadMore() {
      if (loading || done) return;
      loading = true;
      status.textContent = `Loading page ${pageNo + 1}…`;
      try {
        prefetch();
        const req = pending;
        pending = null;
        const { doc, url } = await req;
        const secs = [...doc.querySelectorAll("section.gallery")];
        let added = 0;
        for (const sec of secs) {
          const figs = [...sec.querySelectorAll(":scope > figure")];
          if (!figs.length) continue;
          const target = lastSection();
          const divider = sec.previousElementSibling && sec.previousElementSibling.matches("h4.date-divider")
            ? sec.previousElementSibling : null;
          const curDividers = document.querySelectorAll("h4.date-divider");
          const lastDivText = curDividers.length ? curDividers[curDividers.length - 1].textContent.trim() : null;

          if (divider && divider.textContent.trim() !== lastDivText) {
            // new date group in message center: keep its header
            sec.removeAttribute("id");
            target.after(document.adoptNode(divider), document.adoptNode(sec));
          } else {
            if (!isMsgCenter && added === 0) target.appendChild(el("div", "faw-inf-page", `— page ${pageNo + 1} —`));
            for (const f of figs) target.appendChild(document.adoptNode(f));
          }
          added += figs.length;
        }
        pageNo++;
        lastSection().after(status);
        next = findNext(doc, url);
        if (next && added) prefetch();
        if (!next || !added) {
          done = true;
          status.textContent = added ? `End · ${pageNo} pages loaded` : "No more submissions";
        } else {
          status.textContent = `${pageNo} pages loaded · scroll for more`;
        }
      } catch (err) {
        status.textContent = `Couldn't load page ${pageNo + 1} (${err.message}) `;
        const retry = el("button", null, "Retry");
        retry.onclick = () => { pending = null; loadMore(); };
        status.appendChild(retry);
        loading = false;
        return;
      }
      loading = false;
      // keep filling if the sentinel is still on screen (very wide screens)
      requestAnimationFrame(() => {
        if (!done && status.getBoundingClientRect().top < innerHeight * 3.5) loadMore();
      });
    }

    // Append while the end of the list is still ~2.5 screens away
    new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { rootMargin: "0px 0px 250% 0px" }).observe(status);
    window.addEventListener("scroll", () => {
      if (!loading && !done && status.getBoundingClientRect().top < innerHeight * 3.5) loadMore();
    }, { passive: true });

    infinite = { loadMore, get done() { return done; }, get loading() { return loading; } };
  }

  // "Next" link or button (forms are used on browse/search/favorites)
  function findNext(doc, baseUrl) {
    const cands = [...doc.querySelectorAll("a[href], button")].filter((e) => {
      const t = e.textContent.trim();
      return /^next\b/i.test(t) && !e.disabled && !e.closest(".faw-qv, #ddmenu, .submission-description");
    });
    const n = cands[cands.length - 1];
    if (!n) return null;
    if (n.tagName === "A") {
      const href = n.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return null;
      return { url: new URL(href, baseUrl).href };
    }
    const form = n.form;
    if (!form) return null;
    const fd = new FormData(form);
    if (n.name) fd.set(n.name, n.value);
    const action = new URL(form.getAttribute("action") || baseUrl, baseUrl);
    if ((form.getAttribute("method") || "get").toLowerCase() === "post") {
      return { url: action.href, init: { method: "POST", body: new URLSearchParams(fd) } };
    }
    for (const [k, v] of fd) action.searchParams.set(k, v);
    return { url: action.href };
  }

  // ------------------------------------------------------------------ quick view
  function initQuickView() {
    let qv = null, list = [], idx = 0, token = 0;
    const ready = new Map();   // id → parsed submission, for neighbours already prefetched

    const isQvAnchor = (a) =>
      a && a.matches("a[href]") && viewId(a.getAttribute("href")) &&
      /^\/view\/\d+\/?$/.test(new URL(a.href).pathname) &&
      a.querySelector("img") && !a.closest(".faw-qv, .faw-comic, .submission-description, #submission-main-content .submission-area");

    // window + capture runs before FA's (and other extensions') handlers on the page
    window.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest("a[href]");
      if (!isQvAnchor(a)) return;
      if (e.ctrlKey || e.metaKey) {                 // Ctrl/Cmd+click: go straight to the submission page
        e.preventDefault();
        e.stopImmediatePropagation();
        location.href = a.href;
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      buildList(a);
      open();
    }, true);

    function buildList(anchor) {
      const seen = new Set();
      list = [];
      for (const a of document.querySelectorAll("a[href*='/view/']")) {
        if (!isQvAnchor(a)) continue;
        const id = viewId(a.getAttribute("href"));
        if (seen.has(id)) continue;
        seen.add(id);
        const ti = a.querySelector("img");
        list.push({ id, thumb: ti.currentSrc || ti.src || "", tw: ti.naturalWidth || 0, th: ti.naturalHeight || 0 });
      }
      idx = Math.max(0, list.findIndex((x) => x.id === viewId(anchor.getAttribute("href"))));
    }

    function build() {
      qv = el("div", "faw-qv");
      qv.hidden = true;
      qv.innerHTML = `
        <div class="faw-qv__stage">
          <span class="faw-qv__spinner">Loading…</span>
          <div class="faw-qv__frame">
            <img class="faw-qv__low" alt="">
            <img class="faw-qv__img" alt="">
            <span class="faw-qv__badge">loading full quality…</span>
          </div>
          <button class="faw-qv__nav faw-qv__nav--prev" title="Previous (←)"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button>
          <button class="faw-qv__nav faw-qv__nav--next" title="Next (→)"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></button>
        </div>
        <aside class="faw-qv__panel">
          <div class="faw-qv__top">
            <div><h2 class="faw-qv__title"><a></a></h2><div class="faw-qv__by"></div></div>
            <button class="faw-qv__close" title="Close (Esc)">×</button>
          </div>
          <div class="faw-qv__actions">
            <button class="faw-qv__btn" data-act="fav">+Fav</button>
            <button class="faw-qv__btn" data-act="dl">Download</button>
            <a class="faw-qv__btn" data-act="open">Open page</a>
          </div>
          <dl class="faw-qv__meta"></dl>
          <div class="faw-qv__tags"></div>
          <div class="faw-qv__desc"></div>
          <section class="faw-qv__comments">
            <h3 class="faw-qv__ch">Comments <span></span></h3>
            <div class="faw-qv__clist"></div>
            <form class="faw-qv__cform">
              <textarea placeholder="Write a comment…" rows="3"></textarea>
              <div class="faw-qv__crow"><span class="faw-qv__cstatus"></span><button class="faw-qv__btn" type="submit">Post</button></div>
            </form>
          </section>
          <div class="faw-qv__hint">← → browse · F fav · D download · click image for actual size · Esc close</div>
        </aside>`;
      document.body.appendChild(qv);
      const $ = (s) => qv.querySelector(s);
      $(".faw-qv__close").onclick = close;
      $(".faw-qv__nav--prev").onclick = () => go(-1);
      $(".faw-qv__nav--next").onclick = () => go(1);
      $("[data-act=fav]").onclick = toggleFav;
      $(".faw-qv__cform").addEventListener("submit", (e) => { e.preventDefault(); postComment(); });
      $(".faw-qv__cform textarea").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); postComment(); }
        e.stopPropagation();                                       // don't trigger F / D / arrows while typing
      });
      $("[data-act=dl]").onclick = download;
      $(".faw-qv__stage").addEventListener("click", (e) => { if (e.target === e.currentTarget) close(); });
      $(".faw-qv__frame").addEventListener("click", () => {
        $(".faw-qv__stage").classList.toggle("is-actual");
        fitImage();
      });
      $(".faw-qv__low").addEventListener("load", (e) => { fitImage(); e.target.style.opacity = "1"; });
      $(".faw-qv__low").addEventListener("error", (e) => {
        // larger thumbnail size not available → fall back to the one on the page
        const t = list[idx] && list[idx].thumb;
        if (t && e.target.getAttribute("src") !== t) e.target.src = t;
      });
      $(".faw-qv__img").addEventListener("load", (e) => {
        if (!e.target.getAttribute("src")) return;
        fitImage();
        qv.querySelector(".faw-qv__frame").classList.add("is-hq");
      });
      window.addEventListener("resize", () => { if (!qv.hidden) fitImage(); });
      document.addEventListener("keydown", (e) => {
        if (qv.hidden || (e.target.closest && e.target.closest("input, textarea, select, [contenteditable]"))) return;
        if (e.key === "Escape") close();
        else if (e.key === "ArrowLeft") go(-1);
        else if (e.key === "ArrowRight") go(1);
        else if (e.key.toLowerCase() === "f") toggleFav();
        else if (e.key.toLowerCase() === "d") download();
        else return;
        e.preventDefault();
      });
    }

    function open() {
      if (!qv) build();
      qv.hidden = false;
      root.style.overflow = "hidden";
      show();
    }
    function close() {
      qv.hidden = true;
      root.style.overflow = "";
      qv.querySelector(".faw-qv__img").removeAttribute("src");
      qv.querySelector(".faw-qv__low").removeAttribute("src");
    }

    // FA thumbnails: //t.furaffinity.net/<id>@<size>-<ts>.jpg — ask for a larger size for the preview layer
    const bigThumb = (u) => (u ? u.replace(/@\d+-/, "@600-") : u);

    async function go(d) {
      const j = idx + d;
      if (j >= list.length && d > 0 && infinite && !infinite.done) {
        await infinite.loadMore();
        const cur = list[idx];
        buildList({ getAttribute: () => "/view/" + cur.id + "/" });
      }
      if (j < 0 || j >= list.length) return;
      idx = j;
      show();
    }

    let data = null;
    async function show() {
      const t = ++token;
      const $ = (s) => qv.querySelector(s);
      const item = list[idx];
      const img = $(".faw-qv__img");
      const low = $(".faw-qv__low");
      const frame = $(".faw-qv__frame");
      $(".faw-qv__stage").classList.remove("is-actual");
      $(".faw-qv__nav--prev").disabled = idx === 0;
      $(".faw-qv__nav--next").disabled = idx >= list.length - 1 && !(infinite && !infinite.done);
      // Low-quality layer first: the (enlarged) thumbnail. Sized with the exact dimensions when the
      // page is already prefetched, otherwise from the thumbnail's aspect ratio. The previous image
      // is cleared first so it never shows stretched in the new frame.
      frame.classList.remove("is-hq");
      img.removeAttribute("src");
      low.removeAttribute("src");
      low.style.opacity = "0";
      const known = ready.get(item.id);
      img.dataset.w = known && known.res ? known.res.w : item.tw || "";
      img.dataset.h = known && known.res ? known.res.h : item.th || "";
      img.dataset.exact = known && known.res ? "1" : "";
      frame.style.visibility = item.thumb ? "" : "hidden";
      $(".faw-qv__spinner").hidden = !!item.thumb;
      if (item.thumb) {
        fitImage(true);
        low.src = bigThumb(item.thumb);
      }
      if (known && known.full) img.src = known.full;
      $(".faw-qv__title a").textContent = "";
      $(".faw-qv__title a").href = "/view/" + item.id + "/";
      $("[data-act=open]").href = "/view/" + item.id + "/";
      $(".faw-qv__by").textContent = "";
      $(".faw-qv__meta").textContent = "";
      $(".faw-qv__tags").textContent = "";
      $(".faw-qv__desc").textContent = "";
      $(".faw-qv__clist").textContent = "";
      $(".faw-qv__ch span").textContent = "";
      $(".faw-qv__cstatus").textContent = "";
      try {
        data = await getSubmission("/view/" + item.id + "/");
      } catch (err) {
        if (t !== token) return;
        $(".faw-qv__spinner").textContent = "Couldn't load submission (" + err.message + ")";
        return;
      }
      ready.set(item.id, data);
      if (t !== token) return;
      $(".faw-qv__spinner").textContent = "Loading…";
      $(".faw-qv__title a").textContent = data.title;
      const by = $(".faw-qv__by");
      if (data.artist) {
        const a = el("a", null, data.artist.name);
        a.href = data.artist.href;
        by.append("by ", a);
      }
      const meta = $(".faw-qv__meta");
      for (const [k, v] of [["Category", data.category], ["Species", data.species],
        ["Resolution", data.res ? `${data.res.w} × ${data.res.h}` : ""], ["Rating", data.rating]]) {
        if (!v) continue;
        meta.append(el("dt", null, k), el("dd", null, v));
      }
      const tags = $(".faw-qv__tags");
      for (const tg of data.tags.slice(0, 40)) {
        const a = el("a", null, tg.text);
        a.href = tg.href;
        tags.appendChild(a);
      }
      $(".faw-qv__desc").innerHTML = data.descHTML;
      renderComments();
      updateFavBtn();
      $("[data-act=dl]").disabled = !data.download;

      if (data.res) {
        img.dataset.w = data.res.w;
        img.dataset.h = data.res.h;
        img.dataset.exact = "1";
      }
      fitImage();
      img.alt = data.title;
      if (data.full) { if (img.getAttribute("src") !== data.full) img.src = data.full; } // fades in over the thumbnail
      else frame.classList.add("is-hq");
      // prefetch neighbours: page data, enlarged thumbnail, and the next full image
      for (const d of [1, -1]) {
        const nb = list[idx + d];
        if (!nb) continue;
        if (nb.thumb) new Image().src = bigThumb(nb.thumb);
        getSubmission("/view/" + nb.id + "/").then((nd) => {
          ready.set(nb.id, nd);
          if (d === 1 && nd.full) new Image().src = nd.full;
        }).catch(() => {});
      }
    }

    // Sizes the frame (both layers). Exact dimensions come from the submission page;
    // until then the thumbnail's aspect ratio is used.
    function fitImage(force) {
      const img = qv.querySelector(".faw-qv__img");
      const low = qv.querySelector(".faw-qv__low");
      const frame = qv.querySelector(".faw-qv__frame");
      const stage = qv.querySelector(".faw-qv__stage");
      let nw, nh, exact;
      if (img.dataset.exact) { nw = +img.dataset.w; nh = +img.dataset.h; exact = true; }
      else if (img.naturalWidth) { nw = img.naturalWidth; nh = img.naturalHeight; exact = true; }
      else { nw = +img.dataset.w || low.naturalWidth; nh = +img.dataset.h || low.naturalHeight; exact = false; }
      if (!nw || !nh) return;
      qv.querySelector(".faw-qv__spinner").hidden = true;
      frame.style.visibility = "";
      if (stage.classList.contains("is-actual") && exact) {
        frame.style.width = nw + "px";
        frame.style.height = nh + "px";
        return;
      }
      const cs = getComputedStyle(stage);
      const aw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const ah = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const scale = Math.min(aw / nw, ah / nh, exact ? 2 : Infinity);
      const w = Math.round(nw * scale), h = Math.round(nh * scale);
      // ignore sub-1.5% corrections (thumbnail vs. exact aspect rounding) to avoid a visible jump
      const ow = parseFloat(frame.style.width) || 0, oh = parseFloat(frame.style.height) || 0;
      if (!force && ow && Math.abs(w - ow) / ow < 0.015 && Math.abs(h - oh) / oh < 0.015) return;
      frame.style.width = w + "px";
      frame.style.height = h + "px";
    }

    function renderComments() {
      const list = qv.querySelector(".faw-qv__clist");
      list.textContent = "";
      const cs = (data && data.comments) || [];
      qv.querySelector(".faw-qv__ch span").textContent = cs.length ? `(${cs.length})` : "";
      if (!cs.length) list.appendChild(el("div", "faw-qv__cempty", "No comments yet."));
      for (const c of cs) {
        const item = el("div", "faw-qv__c");
        item.style.marginLeft = Math.min(c.depth, 6) * 14 + "px";
        const img = el("img");
        img.src = c.avatar || "https://a.furaffinity.net/default.gif";
        img.alt = "";
                const body = el("div", "faw-qv__cbody");
        const head = el("div", "faw-qv__chead");
        const who = el("a", null, c.name || "?");
        if (c.href) who.href = c.href;
        head.append(who, el("span", null, c.date));
        const text = el("div", "faw-qv__ctext");
        text.innerHTML = c.html;
        body.append(head, text);
        item.append(img, body);
        list.appendChild(item);
      }
      const form = qv.querySelector(".faw-qv__cform");
      form.hidden = !(data && data.commentForm);
    }

    async function postComment() {
      const cur = data;
      const ta = qv.querySelector(".faw-qv__cform textarea");
      const st = qv.querySelector(".faw-qv__cstatus");
      const btn = qv.querySelector(".faw-qv__cform button");
      const text = ta.value.trim();
      if (!cur || !cur.commentForm || !text) return;
      btn.disabled = true;
      st.textContent = "Posting…";
      try {
        const body = new URLSearchParams(cur.commentForm.fields);
        body.set("reply", text);
        const url = new URL(cur.commentForm.action || `/view/${cur.id}/`, location.origin).href;
        const res = await fetch(url, { method: "POST", body, credentials: "same-origin" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const doc = new DOMParser().parseFromString(await res.text(), "text/html");
        const fresh = parseSubmission(doc, `/view/${cur.id}/`);
        docCache.set(cur.id, Promise.resolve(fresh));
        ready.set(cur.id, fresh);
        if (data === cur) {
          data = fresh;
          renderComments();
          const panel = qv.querySelector(".faw-qv__panel");
          if (panel) panel.scrollTop = panel.scrollHeight;
        }
        ta.value = "";
        st.textContent = "Posted";
      } catch (err) {
        st.textContent = "Couldn't post (" + err.message + ")";
      } finally {
        btn.disabled = false;
      }
    }

    function updateFavBtn() {
      const b = qv.querySelector("[data-act=fav]");
      b.disabled = !data || !data.fav;
      const faved = data && data.fav && data.fav.faved;
      b.textContent = faved ? "−Fav" : "+Fav";
      b.classList.toggle("is-faved", !!faved);
    }

    async function toggleFav() {
      if (!data || !data.fav) return;
      const b = qv.querySelector("[data-act=fav]");
      const cur = data;
      b.disabled = true;
      try {
        const { doc } = await fetchDoc(new URL(cur.fav.href, location.origin).href);
        const fresh = parseSubmission(doc, "/view/" + cur.id + "/");
        docCache.set(cur.id, Promise.resolve(fresh));
        ready.set(cur.id, fresh);
        if (data === cur) data = fresh;
      } catch (err) {
        b.textContent = "Fav failed";
        setTimeout(updateFavBtn, 1500);
        return;
      }
      updateFavBtn();
    }

    function download() {
      if (!data || !data.download) return;
      chrome.runtime.sendMessage({ type: "faw-download", url: data.download }, (r) => {
        if (chrome.runtime.lastError || !r || !r.ok) window.open(data.download, "_blank", "noopener");
      });
    }
  }
})();
