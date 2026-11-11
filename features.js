// FA-ImprovedLayout — everything that needs scripting after the page has loaded: image fit + full-screen
// viewer, quick view, comic reader, infinite scroll, profile gallery, watcher avatars, comment toolbar,
// pagination arrows, system message colours. Runs at document_idle; texts come from i18n.js (T()).
(() => {
  "use strict";

  // After the extension is reloaded/updated, scripts still running in open tabs lose access to chrome.*
  // ("Extension context invalidated"). Catch that instead of logging errors, and tell the user once.
  let staleShown = false;
  function onStale(e, reason) {
    if (!/context invalidated/i.test(String(reason && reason.message || reason))) return;
    e.preventDefault();
    if (!staleShown && document.body) { staleShown = true; toast(T("staleCtx")); }
  }
  window.addEventListener("unhandledrejection", (e) => onStale(e, e.reason));
  window.addEventListener("error", (e) => onStale(e, e.error || e.message));

  const DEFAULTS = {
    enabled: true, ultrawide: true, pageLayout: null, design: true,
    imageFit: true, quickView: true, comic: true, comicHorizontal: false, infinite: true,
    archiveLink: false, bbExtra: true, topbar: true, pins: true, pinned: [], pinSubs: true, walls: false, thumb: 1.25, lang: "auto"
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

  // Master switch off → nothing runs. "Profile & submission layout" and "Bubbles design" gate their own parts;
  // the feature switches (quick view, comic reader, …) work with either.
  const pagesOn = () => S.enabled && S.pageLayout;      // reworked profile / submission pages
  const designOn = () => S.enabled && S.design;
  // Each feature starts on its own: one that trips over a change in FA's markup doesn't take the rest down
  const start = (on, ...fns) => {
    if (!on) return;
    for (const fn of fns) {
      try { const p = fn(); if (p && p.catch) p.catch((e) => console.warn("FA-ImprovedLayout:", fn.name, e)); }
      catch (e) { console.warn("FA-ImprovedLayout:", fn.name, e); }
    }
  };
  // "%E0" and the like in an address: not a name FA has, and decodeURIComponent would throw
  const decode = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  chrome.storage.sync.get(DEFAULTS, (s) => {
    S = s;
    if (S.pageLayout == null) S.pageLayout = S.ultrawide;   // never set (before 2.9.1): it was part of "Ultrawide layout"
    if (!S.enabled) return;
    fawSetLang(S.lang);
    const sub = page === "pageid-submission", user = page === "pageid-userpage";
    start(sub && S.imageFit && pagesOn(), initImageFit);
    start(sub, initLightbox);
    start(sub && S.comic, initComic);
    start(sub, initAjaxFav);
    start(sub && pagesOn(), initMoreFromArtist, initSubmissionNav);
    start(S.infinite, initInfinite);
    start(S.archiveLink, initArchiveLink);
    start(user && pagesOn(), initProfileGallery);
    start(user && designOn(), initWatcherRows);
    start(page === "pageid-watchlist", initWatchlistAll);
    start(true, initCommentToolbar, initExternalConfirm, indentReplies);
    start(designOn(), applyArrowButtons, classifySystemMessages);
    onDomChange(() => { if (designOn()) applyArrowButtons(); initCommentToolbar(); indentReplies(); });
    start(S.quickView, initQuickView);
    start(S.topbar, initTopBar);
    start(S.pins, initPins);
    start(S.pinSubs && sub, initSubPin);
    start(S.walls, initWallsNav);
    start(S.walls && sub, initWallButton);
  });

  // ------------------------------------------------------------------ fetching / parsing
  const docCache = new Map();
  // Requests run in the page's context so FA sees a normal same-site request with the user's login.
  // Chrome's content-script fetch already does; Firefox needs content.fetch (bodies passed as strings).
  const pageFetch = typeof content !== "undefined" && content && typeof content.fetch === "function"
    ? (url, init = {}) => {
      const o = Object.assign({}, init);
      if (o.body instanceof URLSearchParams) {
        o.headers = { "Content-Type": "application/x-www-form-urlencoded" };
        o.body = o.body.toString();
      }
      return content.fetch(new URL(url, location.href).href, o);
    }
    : (url, init) => fetch(url, init);

  async function fetchDoc(url, init) {
    const res = await pageFetch(url, Object.assign({ credentials: "same-origin" }, init));
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
      desc: descEl ? sanitize(descEl) : null,
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
        body: text ? sanitize(text) : null
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

  // Cleaned copy of FA user content (description / comment) for the quick view: no scripts, embeds,
  // event handlers or javascript: links. Inserted as DOM nodes (showContent), never as an HTML string.
  function sanitize(node) {
    const c = node.cloneNode(true);
    // the header (avatar/title/artist/date) duplicates what the quick view already shows
    c.querySelectorAll("script, style, iframe, object, embed, .submission-description-header, .submission-id-container")
      .forEach((n) => n.remove());
    c.querySelectorAll("*").forEach((n) => {
      for (const at of [...n.attributes]) {
        if (/^on/i.test(at.name) || /^\s*javascript:/i.test(at.value)) n.removeAttribute(at.name);
      }
    });
    return c;
  }

  function showContent(target, node) {
    target.replaceChildren(...(node ? [...node.childNodes].map((n) => document.importNode(n, true)) : []));
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

    // Upgrade to the full-resolution file if FA served a smaller one that would be upscaled
    const ensureFull = () => {
      if (!full || abs(img.getAttribute("src")) === full) return;
      if (img.clientWidth > img.naturalWidth + 2) img.src = full;
    };
    img.addEventListener("load", () => {
      if (!res && img.naturalWidth) setDims(img.naturalWidth, img.naturalHeight);
      ensureFull();
    });
    if (img.complete) ensureFull();
    window.addEventListener("resize", ensureFull);
  }

  // ------------------------------------------------------------------ submission: full-screen image viewer
  // Click the submission image → just the image, centered, full screen. Click in it to zoom at the
  // cursor (drag to pan), click again to fit; click the backdrop or press Esc to close.
  function initLightbox() {
    const img = document.getElementById("submissionImg");
    if (!img) return;
    root.classList.add("faw-lb-ready");                        // zoom-in cursor only while the viewer exists
    let lb = null, offResize = null;
    const open = () => {
      const full = abs(img.getAttribute("data-fullview-src")) || img.currentSrc || img.src;
      lb = el("div", "faw-lb");
      const stage = el("div", "faw-lb__stage");
      const pic = el("img", "faw-lb__img");
      pic.alt = img.alt || "";
      pic.src = img.currentSrc || img.src;                    // already loaded → shows instantly
      if (full && full !== pic.src) { const hi = new Image(); hi.onload = () => { pic.src = full; }; hi.src = full; }
      const closeBtn = el("button", "faw-lb__close", "×");
      closeBtn.title = T("close");
      stage.appendChild(pic);
      lb.append(stage, closeBtn);
      document.body.appendChild(lb);
      document.documentElement.classList.add("faw-lb-open");
      // fitted view: as large as the screen allows (small images are scaled up too)
      const fit = () => {
        if (!lb || lb.classList.contains("is-zoom") || !pic.naturalWidth) return;
        const s = Math.min((stage.clientWidth - 32) / pic.naturalWidth, (stage.clientHeight - 32) / pic.naturalHeight);
        pic.style.width = Math.round(pic.naturalWidth * s) + "px";
        pic.style.height = Math.round(pic.naturalHeight * s) + "px";
      };
      pic.addEventListener("load", fit);
      window.addEventListener("resize", fit);
      if (pic.complete) fit();
      const pan = makePannable(pic, { x: stage, y: stage, active: () => lb.classList.contains("is-zoom"), hostClass: stage });
      offResize = () => { window.removeEventListener("resize", fit); pan.destroy(); };
      pic.addEventListener("click", (e) => {
        e.stopPropagation();
        if (pan.consumeDrag()) return;
        const r = pic.getBoundingClientRect();
        const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
        const zoomIn = !lb.classList.contains("is-zoom");
        if (zoomIn) {
          const w = Math.round(Math.max(pic.naturalWidth || 0, r.width * 1.75));
          pic.style.width = w + "px";
          pic.style.height = Math.round(w * r.height / r.width) + "px";
        }
        lb.classList.toggle("is-zoom", zoomIn);
        if (!zoomIn) fit();
        stage.classList.toggle("faw-pannable", zoomIn);
        if (zoomIn) {
          const r2 = pic.getBoundingClientRect();
          stage.scrollLeft += r2.left + fx * r2.width - e.clientX;
          stage.scrollTop += r2.top + fy * r2.height - e.clientY;
        }
      });
      stage.addEventListener("click", (e) => { if (e.target === stage) close(); });
      closeBtn.addEventListener("click", close);
      document.addEventListener("keydown", onKey, true);
    };
    const close = () => {
      if (!lb) return;
      lb.remove(); lb = null;
      if (offResize) offResize();
      document.documentElement.classList.remove("faw-lb-open");
      document.removeEventListener("keydown", onKey, true);
    };
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    window.addEventListener("click", (e) => {
      if (e.target !== img || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      open();
    }, true);
  }

  // Drag-to-pan for a zoomed image. x / y: elements to scroll (null = the window).
  function makePannable(target, { x, y, active, hostClass }) {
    let start = null, dragged = false;
    const scrollBy = (el, dx, dy) => { if (el) { el.scrollLeft -= dx; el.scrollTop -= dy; } else window.scrollBy(-dx, -dy); };
    target.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || !active()) return;
      e.preventDefault();
      start = { x: e.clientX, y: e.clientY, moved: false };
      dragged = false;
    });
    const onMove = (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!start.moved && Math.hypot(dx, dy) < 4) return;
      start.moved = true;
      if (hostClass) hostClass.classList.add("faw-panning");
      if (x === y) scrollBy(x, dx, dy);
      else { scrollBy(x, dx, 0); scrollBy(y, 0, dy); }
      start.x = e.clientX; start.y = e.clientY;
    };
    const onUp = () => {
      if (!start) return;
      dragged = start.moved;
      start = null;
      if (hostClass) hostClass.classList.remove("faw-panning");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return {
      consumeDrag: () => { const d = dragged; dragged = false; return d; },
      destroy: () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); }
    };
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
    const btn = el("button", "button standard", T("readComic"));
    const status = el("span");
    bar.append(btn, status);
    const area = img.closest(".submission-area") || img.parentElement;
    // The bar lives in FA's #minigallery row under the image (its own box is hidden by the layout)
    const placeBar = () => {
      const mini = document.getElementById("minigallery");
      if (mini) { mini.classList.add("faw-has-comic"); mini.appendChild(bar); }
      else area.after(bar);
    };

    // Title-based series ("Name - Page 9"): the siblings are looked up with FA's search when the button
    // is clicked – not on every page whose title ends in a number
    let titleMatches = null;
    placeBar();

    let container = null, loading = false;
    const MAX = 150;

    const setOpen = (open) => {
      root.classList.toggle("faw-comic-open", open);
      root.classList.toggle("faw-comic-h", open && !!S.comicHorizontal);
      container.hidden = !open;
      btn.textContent = open ? T("singlePage") : T("readComicN", container.children.length);
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

    const progress = (n) => { status.textContent = T("loadingPagesFound", n); };
    btn.addEventListener("click", async () => {
      if (container) { setOpen(container.hidden); return; }
      if (loading) return;
      loading = true;
      btn.disabled = true;
      try {
        if (!byLinks && !titleMatches) {
          status.textContent = T("comicSearching");
          const m = await findTitledSeries(titled, current);
          if (m.length < 2) { status.textContent = T("comicNone"); btn.remove(); return; }
          titleMatches = m;
        }
        const pages = titleMatches
          ? await loadTitled(titleMatches, progress)
          : await loadSeries(current, progress);
        container = renderComic(pages, current.id);
        area.appendChild(container);
        if (S.comicHorizontal) enableHorizontal(container);
        status.textContent = "";
        setOpen(true);
      } catch (err) {
        status.textContent = T("seriesFailed", err.message);
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
        progress(before.length + after.length + 1);
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
          progress(before.length + 1);
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
        progress(before.length + after.length + 1);
        await sleep(200);
      }
      return [...before, cur, ...after];
    }

    async function loadTitled(matches, progress) {
      const pages = [];
      for (let i = 0; i < matches.length; i++) {
        progress(i + 1);
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
        const a = el("a", null, p.title || T("untitled"));
        a.href = "/view/" + p.id + "/";
        label.append(T("pageOf", i + 1, pages.length), a);
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
      /^(.*?)[\s\-–—:|,.(\[]*(?:\b(?:page|pg|part|pt|chapter|ch|episode|ep|no))?\.?\s*#?\s*(\d{1,4})(?:\s*(?:\/|of)\s*\d{1,4})?[\s)\]]*$/i
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
    const name = decode(m[1]).toLowerCase();
    const url = "https://furarchiver.net/Artist/Gallery?artist=" + encodeURIComponent(name);
    const wrap = el("div", "faw-archive-sys");
    const btn = el("button", "button standard", T("archivedGallery"));
    btn.type = "button";
    btn.title = T("archiveTitle");
    btn.addEventListener("click", () => confirmExternal(T("openArchive", name), url));
    wrap.append(el("span", null, T("accountUnavailable")), btn);
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
    const name = decode(m[1]).toLowerCase();
    const url = "https://furarchiver.net/Artist/Gallery?artist=" + encodeURIComponent(name);

    const li = el("li", "faw-archive");
    const h3 = el("h3");
    const a = el("a", null, T("archivedGallery"));
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = T("archiveTitle");
    const ask = (e) => {
      if (e.type === "auxclick" && e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      confirmExternal(T("openArchive", name), url);
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
    confirmBox(text, url, T("openNewTab"), () => window.open(url, "_blank", "noopener,noreferrer"));
  }
  // Generic confirmation overlay: text, optional highlighted detail line, OK label, action
  function confirmBox(text, detail, okLabel, onOk, danger) {
    const ov = el("div", "faw-confirm");
    const box = el("div", "faw-confirm__box");
    const p = el("p", null, text);
    const row = el("div", "faw-confirm__row");
    const cancel = el("button", "button standard", T("cancel"));
    const ok = el("button", "button standard faw-confirm__ok" + (danger ? " is-danger" : ""), okLabel);
    row.append(cancel, ok);
    box.append(p);
    if (detail) box.append(el("div", "faw-confirm__url", detail));
    box.append(row);
    ov.appendChild(box);
    document.body.appendChild(ov);
    (danger ? cancel : ok).focus();                 // something that can't be undone: Cancel is the default
    const done = (go) => {
      ov.remove();
      document.removeEventListener("keydown", onKey, true);
      if (go) onOk();
    };
    // Enter acts on the focused button (Cancel stays Cancel); the keys don't reach the page or the quick view
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); done(danger ? document.activeElement === ok : document.activeElement !== cancel); }
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
          applyBlocklist(f.querySelector("img"));              // FA's own script only saw the first 20
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

  // ------------------------------------------------------------------ system messages: success → green, failure → red
  function classifySystemMessages() {
    for (const h of document.querySelectorAll(".section-header, h2")) {
      if (!/system message/i.test(h.textContent) || h.textContent.length > 60) continue;
      const box = h.closest("section") || h.parentElement;
      if (!box || box.classList.contains("faw-msg-ok") || box.classList.contains("faw-msg-err")) continue;
      const body = box.querySelector(".section-body") || box;
      const text = body.textContent.replace(/continue\s*»?/i, "");
      const err = /\b(error|fail(ed|ure)?|invalid|could not|couldn't|unable|denied|not (be |been )?(allowed|found|saved|valid)|must|incorrect|wrong|too (long|short|many))\b/i.test(text);
      const ok = !err && /\b(updated|saved|success(ful(ly)?)?|has been (added|removed|changed|sent|submitted|deleted|created|posted)|thank you|completed?)\b/i.test(text);
      if (!ok && !err) continue;
      box.classList.add(ok ? "faw-msg-ok" : "faw-msg-err");
      // colour the message itself, not the Continue button
      for (const n of body.querySelectorAll("p, div, span, td")) {
        if (n.children.length === 0 && n.textContent.trim().length > 3 && !n.closest("a, button, .button")) n.classList.add("faw-msg-text");
      }
      if (!body.querySelector(".faw-msg-text")) {
        for (const t of [...body.childNodes]) {
          if (t.nodeType === 3 && t.textContent.trim().length > 3) t.replaceWith(el("span", "faw-msg-text", t.textContent));
        }
      }
    }
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
  // Shout pager: FA decorates the current page number as ⚞1⚟
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

  // ------------------------------------------------------------------ avatars (watcher rows / tiles)
  // FA lists don't include avatars. The short address a.furaffinity.net/<name>.gif usually works;
  // only if it keeps failing is the real (timestamped) URL read from the user's profile page —
  // two lookups at a time, cached in localStorage for two weeks.
  const AV_DEFAULT = "https://a.furaffinity.net/default.gif";
  const AV_DAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");
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
      pageFetch("/user/" + encodeURIComponent(slug) + "/", { credentials: "same-origin" })
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
  // Short avatar address, loaded through a small queue: only tiles near the viewport, six at a time.
  // Requesting hundreds at once makes FA's image server fail some (broken or wrong images); failed
  // ones are retried with a fresh address, and only after that looked up on the profile.
  const avLoadQ = [];
  let avLoading = 0, avIO = null;
  function avNext() {
    while (avLoading < 6 && avLoadQ.length) {
      const job = avLoadQ.shift();
      avLoading++;
      job();
    }
  }
  function avStart(img, key, attempt) {
    avLoadQ.push(() => {
      const done = () => { avLoading--; avNext(); };
      img.onload = () => { img.onload = img.onerror = null; done(); };
      img.onerror = () => {
        img.onload = img.onerror = null;
        done();
        if (attempt < 2) setTimeout(() => avStart(img, key, attempt + 1), 700 * (attempt + 1));
        else resolveAvatar(key).then((u) => { img.onerror = () => { img.onerror = null; img.src = AV_DEFAULT; }; img.src = u; });
      };
      const cached = attempt === 0 && avCacheGet(key);
      img.src = cached || "https://a.furaffinity.net/" + encodeURIComponent(key) + ".gif?d=" + AV_DAY + (attempt ? "-" + attempt : "");
    });
    avNext();
  }
  function attachAvatar(img, slug) {
    img.dataset.fawAv = String(slug).toLowerCase();
    img.decoding = "async";
    avIO = avIO || new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        avIO.unobserve(e.target);
        avStart(e.target, e.target.dataset.fawAv, 0);
      }
    }, { rootMargin: "600px 0px" });
    avIO.observe(img);
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
  function initWatchlistAll() {
    const list = document.querySelector(".watch-list");
    const nav = document.querySelector(".watchlist-navigation");
    if (!list) return;
    decorateWatchlist(list);
    let next = findNext(document, location.href);
    if (!next) return;
    // the rest of the list is fetched when asked for (up to 100 pages a go); until then FA's pager stays
    const status = el("div", "faw-inf-status");
    list.after(status);
    const offer = (label) => {
      status.textContent = T("entriesMore", list.children.length) + " ";
      const more = el("button", null, label);
      more.type = "button";
      more.onclick = () => { if (nav) nav.style.display = "none"; status.textContent = T("loadingEntriesN", list.children.length); run(); };
      status.appendChild(more);
    };
    const seen = new Set([...list.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")));
    // 100 pages per run; a longer list gets a "Load more" button instead of ending as if it were complete
    const run = async () => {
    let pages = 0;
    try {
      while (next && pages < 100) {
        const { doc, url } = await fetchDoc(next.url, next.init);
        const items = [...doc.querySelectorAll(".watch-list > *")].filter((it) => {
          const h = it.querySelector("a[href]")?.getAttribute("href");
          if (!h || seen.has(h)) return false;
          seen.add(h);
          return true;
        });
        if (!items.length) { next = null; break; }
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
        status.textContent = T("loadingEntriesN", list.children.length);
        next = findNext(doc, url);
        if (next) await sleep(250);
      }
      if (next) offer(T("upLoadMore"));
      else status.textContent = T("entriesN", list.children.length);
    } catch (err) {
      status.textContent = T("stoppedAfter", list.children.length, err.message);
      if (nav) nav.style.display = "";
    }
    };
    offer(T("loadAll"));
  }

  // ------------------------------------------------------------------ comment box: more BBCode buttons
  // FA's toolbar only has B/I/U + alignment; add the rest of FA's tags & codes.
  // Two rows: text formatting (FA's B/I/U first) / alignment + inserts. Order is set via CSS `order`
  // because FA's own buttons and ours share one flex container.
  const BB_TOOLS = [
    { row: 2, sep: true },
    { row: 2, t: "S", tk: "bbStrike", wrap: ["[s]", "[/s]"], cls: "s" },
    { row: 2, t: "x²", tk: "bbSup", wrap: ["[sup]", "[/sup]"] },
    { row: 2, t: "x₂", tk: "bbSub", wrap: ["[sub]", "[/sub]"] },
    { row: 2, sep: true },
    { row: 2, t: "H1", tk: "bbH1", wrap: ["[h1]", "[/h1]"] },
    { row: 2, t: "H2", tk: "bbH2", wrap: ["[h2]", "[/h2]"] },
    { row: 2, t: "H3", tk: "bbH3", wrap: ["[h3]", "[/h3]"] },
    { row: 2, sep: true },
    { row: 2, t: "A", tk: "bbColor", color: true },
    { row: 3, br: true },
    { row: 5, sep: true },
    { row: 5, t: "❝", tk: "bbQuote", wrap: ["[quote]", "[/quote]"] },
    { row: 5, t: "◼", tk: "bbSpoiler", wrap: ["[spoiler]", "[/spoiler]"] },
    { row: 5, t: "🔗", tk: "bbLink", url: true },
    { row: 5, t: "▶", tk: "bbYt", wrap: ["[yt]", "[/yt]"] },
    { row: 5, sep: true },
    { row: 5, t: "@i", tk: "bbIcon", wrap: [":icon", ":"] },
    { row: 5, t: "@l", tk: "bbUlink", wrap: [":link", ":"] },
    { row: 5, t: "—", tk: "bbHr", insert: "\n-----\n" }
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
    for (const bar of document.querySelectorAll("form .floatleft:has(> .bbcodeformat)")) {
      if (bar.querySelector(".faw-bb") || bar.classList.contains("faw-bb-plain")) continue;
      const ta = bar.closest("form").querySelector("textarea");
      if (!ta) continue;
      // FA puts &nbsp; between its buttons; in the flex toolbar they become blank items that indent row 1
      for (const n of [...bar.childNodes]) if (n.nodeType === 3) n.remove();
      if (!S.bbExtra) { bar.classList.add("faw-bb-plain"); continue; }
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
        btn.title = T(tool.tk);
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
      confirmExternal(T("leavingFA"), url.href);
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

  // ------------------------------------------------------------------ submission: newer / older buttons
  // Small arrow buttons below the image replace FA's "Main Gallery · Newer | Older" box.
  function initSubmissionNav() {
    const area = document.querySelector("#pageid-submission .submission-area");
    const nav = document.querySelector("#minigallery .minigallery-navigation");
    if (!area || document.querySelector(".faw-subnav-row")) return;
    const links = nav ? [...nav.querySelectorAll("a[href]")] : [];
    const newer = links.find((a) => /newer/i.test(a.textContent));
    const older = links.find((a) => /older/i.test(a.textContent));
    if (!newer && !older) return;
    const row = el("div", "faw-subnav-row");
    const mk = (a, arrow, title) => {
      const x = el("a", "button standard faw-arrow-btn" + (a ? "" : " is-off"));
      x.dataset.fawArrow = arrow;
      x.title = title;
      if (a) x.href = a.getAttribute("href");
      row.appendChild(x);
    };
    mk(newer, "<", T("newerSub"));
    mk(older, ">", T("olderSub"));
    area.appendChild(row);
    document.documentElement.classList.add("faw-subnav-on");
  }

  // Small stroke icon (24×24 viewBox) built as DOM nodes
  const SVG_NS = "http://www.w3.org/2000/svg";
  function icon(d, size = 13) {
    const svg = document.createElementNS(SVG_NS, "svg");
    for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor",
      "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round" })) svg.setAttribute(k, v);
    for (const pd of [].concat(d)) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", pd);
      svg.appendChild(path);
    }
    return svg;
  }
  const ICONS = {
    arrow: "M5 12h14M13 6l6 6-6 6",
    bellOff: ["M8.7 3A6 6 0 0 1 18 8c0 2.7.6 4.6 1.3 6", "M17 17H3s3-2 3-9c0-.8.1-1.5.4-2.2", "M10.3 21a1.94 1.94 0 0 0 3.4 0", "M2 2l20 20"],
    pinOff: ["M12 17v5", "M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89", "M2 2l20 20", "M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11"],
    wall: ["M3 3h7v9H3z", "M14 3h7v5h-7z", "M14 12h7v9h-7z", "M3 16h7v5H3z"],
    wallOn: ["M3 3h7v9H3z", "M14 3h7v5h-7z", "M3 16h7v5H3z", "M14 16.5l2.5 2.5 4.5-5"],   // last tile → check mark
    pin: ["M12 17v5", "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"]
  };

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
        .filter((f) => !blockReasons(f.querySelector("img")).length)   // nothing the blocklist hides
        .slice(0, 9);
      if (!figs.length) return;
      const box = el("section", "faw-more");
      const head = el("div", "faw-more__head");
      head.append(el("span", null, T("moreFrom", me.artist.name)));
      const all = el("a", null, T("viewGallery"));
      all.append(icon(ICONS.arrow));
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

  // FA's tag/user blocklist (censor.js) only checks the thumbnails present at load: every thumbnail
  // arrives marked "blocked-content" and FA unmarks the allowed ones. Appended pages get the same
  // rules here: blocked tags, blocked users (u_<name> meta tag) and "hide content without tags".
  const blocklist = (() => {
    const b = document.body;
    if (!b || b.getAttribute("data-user-logged-in") !== "1") return null;
    const split = (v) => (v || "").split(/\s+/).filter(Boolean);
    return {
      tags: new Set(split(b.getAttribute("data-tag-blocklist"))),
      users: new Set(split(b.getAttribute("data-user-blocklist")).map((u) =>
        "u_" + u.replace(/[^\w-]/gi, "_").replace(/_{2,}/g, "_").replace(/^[\s_]+|[\s_]+$/g, ""))),
      tagless: b.getAttribute("data-tag-blocklist-hide-tagless") === "1"
    };
  })();
  // why a thumbnail is blocked ([] = it isn't); FA's rules, from the image's data-tags
  function blockReasons(img) {
    if (!blocklist || !img || !img.hasAttribute("data-tags")) return [];
    const tags = img.getAttribute("data-tags").trim().toLowerCase().split(/\s+/).filter(Boolean);
    const reasons = [...new Set(tags.filter((t) => blocklist.tags.has(t)))];
    if (tags.some((t) => blocklist.users.has(t))) reasons.push("User is blocked by you.");
    if (blocklist.tagless && tags.length - 4 <= 0) reasons.push("Content has no non-meta tags.");
    return reasons;
  }
  function applyBlocklist(img) {
    if (!img || !img.hasAttribute("data-tags")) return;
    const reasons = blockReasons(img);
    const blocked = reasons.length > 0;
    img.classList.toggle("blocked-content", blocked);
    if (blocked) {
      img.title = "Blocked:\n• " + reasons.join("\n• ");
      img.setAttribute("data-reason", JSON.stringify(reasons));   // FA's hover popup lists these
    } else img.removeAttribute("data-reason");
    // FA's blur (blur(60px), no reveal on hover) only applies while the <noscript> next to the image is
    // empty, as it is on a live page; pages read with DOMParser keep its <span> inside, so empty it
    for (const n of (img.closest("figure") || img.parentElement).querySelectorAll("noscript")) n.textContent = "";
  }

  function initInfinite() {
    if (!document.querySelector("section.gallery")) return;
    if (/^pageid-(userpage|submission)$/.test(page)) return;

    let next = findNext(document, location.href);
    if (!next) return;

    let pageNo = 1, loading = false, done = false;
    const isMsgCenter = page === "pageid-messagecenter-submissions";
    const status = el("div", "faw-inf-status", T("scrollMore"));
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

    // one load at a time; a caller arriving mid-load (quick view's "next") waits for that one
    let inflight = null;
    function loadMore() {
      if (done) return Promise.resolve();
      if (!inflight) inflight = loadPage().finally(() => { inflight = null; });
      return inflight;
    }
    async function loadPage() {
      if (loading || done) return;
      loading = true;
      status.textContent = T("loadingPage", pageNo + 1);
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
            sec.querySelectorAll("figure").forEach((f) => { f.classList.add("faw-inf-added"); applyBlocklist(f.querySelector("img")); });
            target.after(document.adoptNode(divider), document.adoptNode(sec));
          } else {
            if (!isMsgCenter && added === 0) target.appendChild(el("div", "faw-inf-page", T("pageDivider", pageNo + 1)));
            for (const f of figs) {
              f.classList.add("faw-inf-added");
              target.appendChild(document.adoptNode(f));
              applyBlocklist(f.querySelector("img"));
            }
          }
          added += figs.length;
        }
        pageNo++;
        lastSection().after(status);
        next = findNext(doc, url);
        if (next && added) prefetch();
        if (!next || !added) {
          done = true;
          status.textContent = added ? T("endPages", pageNo) : T("noMore");
        } else {
          status.textContent = T("pagesLoaded", pageNo);
        }
      } catch (err) {
        status.textContent = T("pageFailed", pageNo + 1, err.message);
        const retry = el("button", null, T("retry"));
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

    // While "Enable Titles" is off, FA moves each figure's caption into its link on mouseenter (styled as a
    // dark header with clickable title + artist) and back on mouseleave – but only for figures present at
    // load. Appended figures get the same treatment here.
    const capHost = (f) => f.querySelector(":scope > b > u > a") || f.querySelector(":scope > b a");
    document.addEventListener("mouseenter", (e) => {
      const f = e.target;
      if (!(f instanceof Element) || !f.matches("figure.faw-inf-added")) return;
      const cap = f.querySelector(":scope > figcaption"), host = capHost(f);
      if (cap && host && getComputedStyle(cap).display === "none") host.appendChild(cap);
    }, true);
    document.addEventListener("mouseleave", (e) => {
      const f = e.target;
      if (!(f instanceof Element) || !f.matches("figure.faw-inf-added")) return;
      const cap = f.querySelector(":scope > b figcaption");
      if (cap) f.appendChild(cap);
    }, true);
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

  // ------------------------------------------------------------------ top bar: clear all notifications, SFW switch
  function initTopBar() {
    const bar = document.querySelector("#ddmenu ul.navhideonmobile");
    const msgs = bar && bar.querySelector("li.message-bar-desktop");
    if (!msgs || bar.querySelector(".faw-topbar")) return;           // not logged in
    const li = el("li", "faw-topbar");

    // Clear all: presses every "Nuke" button FA offers on the two notification pages
    const hasAny = !!msgs.querySelector("a.notification-container");
    const nuke = el("button", "faw-tb-btn faw-tb-nuke");
    nuke.type = "button";
    nuke.title = T("nukeAll");
    nuke.disabled = !hasAny;
    nuke.append(icon(ICONS.bellOff, 17));
    nuke.addEventListener("click", () => confirmBox(T("nukeConfirm"), null, T("nukeOk"), async () => {
      nuke.disabled = true;
      nuke.classList.add("is-busy");
      try {
        for (const page of ["/msg/submissions/", "/msg/others/"]) {
          const done = new Set();
          for (let i = 0; i < 12; i++) {                            // one Nuke button per request, page re-read each time
            const { doc } = await fetchDoc(new URL(page, location.origin).href);
            const btn = [...doc.querySelectorAll("form button.nuke, form input.nuke")]
              .find((b) => !done.has(b.name + "=" + b.value));
            if (!btn) break;
            done.add(btn.name + "=" + btn.value);
            const form = btn.form || btn.closest("form");
            const body = new URLSearchParams(new FormData(form));
            if (btn.name) body.set(btn.name, btn.value);
            await pageFetch(new URL(form.getAttribute("action") || page, location.origin).href, { method: "POST", body, credentials: "same-origin" });
            await sleep(250);
          }
        }
      } catch (e) { /* reload shows what's left */ }
      location.reload();
    }, true));
    li.append(nuke);

    // SFW / NSFW: our switch drives FA's own toggle (moved out of the menu), so FA's logic stays in charge
    const fa = document.getElementById("sfw-toggle-mobile");
    if (fa) {
      const sw = el("button", "faw-tb-sfw");
      sw.type = "button";
      sw.title = T("sfwTitle");
      const sfw = el("span", "faw-tb-sfw__opt", "SFW"), nsfw = el("span", "faw-tb-sfw__opt is-nsfw", "NSFW");
      sw.append(sfw, nsfw);
      const sync = () => { sfw.classList.toggle("is-on", fa.checked); nsfw.classList.toggle("is-on", !fa.checked); };
      sync();
      sw.addEventListener("click", () => { fa.click(); setTimeout(sync, 0); });
      fa.addEventListener("change", sync);
      li.append(sw);
      document.documentElement.classList.add("faw-sfw-moved");
    }
    msgs.after(li);
    root.classList.add("faw-nav-flex");   // keeps FA's menu on one line with the extra buttons, layout on or off
  }

  // ------------------------------------------------------------------ pinned artists: Pin button on profiles
  // The list lives in chrome.storage.sync ([{ u: slug, n: name }]; older entries also "a": avatar URL); content.js draws the
  // sidebar at page start and redraws it whenever the list changes.
  function initPins() {
    const buttons = document.querySelector("userpage-nav-interface-buttons");
    const slugHere = (location.pathname.match(/^\/(?:user|gallery|scraps|favorites|journals|commissions|stats)\/([^/]+)/i) || [])[1];
    if (!buttons || !slugHere) return;
    const here = decode(slugHere).toLowerCase();
    let pins = Array.isArray(S.pinned) ? S.pinned : [];
    const btn = el("a", "button standard faw-pin-btn");
    btn.href = "#";
    const update = () => {
      const on = pins.some((q) => q.u === here);
      btn.replaceChildren(icon(on ? ICONS.pinOff : ICONS.pin, 21));   // crossed-out pin = click to unpin
      btn.classList.toggle("is-on", on);
      btn.title = on ? T("unpin") : T("pinTitle");
      btn.setAttribute("aria-label", btn.title);
    };
    // The synced list holds slug and name only (storage.sync takes 8 KB per item, and an avatar address is
    // most of an entry). Avatar addresses are kept on this device, in storage.local "pinAvatars", and
    // refreshed whenever a pinned artist's profile is open; elsewhere the short address is used.
    const avHere = () => { const av = document.querySelector("userpage-nav-avatar img"); return av ? abs(av.getAttribute("src")) || "" : ""; };
    const slim = (list, avatars) => list.map((q) => { if (q.a && !avatars[q.u]) avatars[q.u] = q.a; return { u: q.u, n: q.n }; });
    const savePins = (list) => chrome.storage.local.get({ pinAvatars: {} }, (l) => {
      const avatars = Object.assign({}, l.pinAvatars);
      const out = slim(list, avatars);                         // older entries: their address moves over
      if (out.some((q) => q.u === here) && avHere()) avatars[here] = avHere();
      for (const u of Object.keys(avatars)) if (!out.some((q) => q.u === u)) delete avatars[u];
      chrome.storage.local.set({ pinAvatars: avatars });
      // a write that doesn't fit is refused: say so
      chrome.storage.sync.set({ pinned: out }, () => { if (chrome.runtime.lastError) toast(T("pinFull")); });
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (pins.some((q) => q.u === here)) { savePins(pins.filter((q) => q.u !== here)); return; }
      const name = (document.querySelector("userpage-nav-user-details .js-displayName-block, userpage-nav-user-details .c-usernameBlock__displayName") || {}).textContent;
      savePins(pins.concat({ u: here, n: (name || here).trim() }));
    });
    // on a pinned artist's profile: keep the stored avatar address current
    if (pins.some((q) => q.u === here) && avHere()) {
      chrome.storage.local.get({ pinAvatars: {} }, (l) => {
        if (l.pinAvatars[here] !== avHere()) chrome.storage.local.set({ pinAvatars: Object.assign({}, l.pinAvatars, { [here]: avHere() }) });
      });
    }
    const watch = buttons.querySelector("#watch-button");
    // FA separates its inline buttons with whitespace; give ours the same gap
    if (watch) watch.after(" ", btn); else buttons.prepend(btn, " ");
    update();
    chrome.storage.onChanged.addListener((c, area) => {
      if (area !== "sync" || !c.pinned) return;
      pins = Array.isArray(c.pinned.newValue) ? c.pinned.newValue : [];
      update();
    });
  }

  // ------------------------------------------------------------------ pinned submissions (left sidebar)
  // List in chrome.storage.local "pinnedSubs" as [{ u: id, n: title, a: thumbnail }]; content.js draws it.
  const subPins = {
    get: () => new Promise((r) => chrome.storage.local.get({ pinnedSubs: [] }, (l) => r(l.pinnedSubs || []))),
    async toggle(entry) {
      const list = await subPins.get();
      const has = list.some((p) => String(p.u) === String(entry.u));
      await new Promise((r) => chrome.storage.local.set({ pinnedSubs: has ? list.filter((p) => String(p.u) !== String(entry.u)) : list.concat(entry) }, r));
      return !has;
    },
    // keeps a pin button's icon/title in sync with the stored list
    bind(btn, getId) {
      const update = (list) => {
        const on = list.some((p) => String(p.u) === String(getId()));
        btn.replaceChildren(icon(on ? ICONS.pinOff : ICONS.pin, btn.dataset.size ? +btn.dataset.size : 18));
        btn.classList.toggle("is-on", on);
        btn.title = on ? T("unpinSub") : T("pinSub");
      };
      subPins.get().then(update);
      chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c.pinnedSubs) update(c.pinnedSubs.newValue || []); });
      return () => subPins.get().then(update);
    }
  };
  const thumb300 = (u) => (u ? abs(u).replace(/@\d+-/, "@300-") : "");

  function initSubPin() {
    const controls = document.querySelector(".submission-controls-upper");
    const id = viewId(location.pathname);
    if (!controls || !id) return;
    const img = document.getElementById("submissionImg");
    const btn = el("a", "button standard mobile-fix faw-subpin-btn");
    btn.href = "#";
    btn.dataset.size = "18";
    subPins.bind(btn, () => id);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const cur = parseSubmission(document, location.pathname);
      subPins.toggle({ u: id, n: (cur.title || "").slice(0, 80), a: thumb300(img && (img.getAttribute("data-preview-src") || img.getAttribute("src"))) });
    });
    const dl = [...controls.children].find((x) => /download/i.test(x.textContent));
    if (dl) dl.after(btn); else controls.append(btn);
  }

  // ------------------------------------------------------------------ reference walls (walls.html)
  // "Add to wall" places the submission on the active wall, to the right of what's already there
  // (new row after ~4000px). Data in chrome.storage.local, see walls.js.
  const getWalls = () => new Promise((r) => chrome.storage.local.get({ walls: [], activeWall: null }, (l) => {
    const walls = Array.isArray(l.walls) ? l.walls : [];
    r({ walls, w: walls.find((x) => x.id === l.activeWall) || walls[0] || null });
  }));
  const GAP = 12;   // space between automatically placed images
  // First free spot for a w×h image, reading order (top to bottom, then left to right) within the wall's
  // width (at least 4000 board px): candidates are right of and below every image already there, so gaps
  // left by images moved or resized by hand get filled too.
  function freeSpot(items, w, h) {
    if (!items.length) return { x: 0, y: 0 };
    const x0 = Math.min(...items.map((i) => i.x)), y0 = Math.min(...items.map((i) => i.y));
    const maxX = x0 + Math.max(4000, Math.max(...items.map((i) => i.x + i.w)) - x0);
    const hits = (x, y) => items.some((i) => x < i.x + i.w + GAP && x + w + GAP > i.x && y < i.y + i.h + GAP && y + h + GAP > i.y);
    const cands = [{ x: x0, y: y0 }];
    for (const i of items) cands.push({ x: i.x + i.w + GAP, y: i.y }, { x: i.x, y: i.y + i.h + GAP }, { x: x0, y: i.y + i.h + GAP });
    cands.sort((a, b) => a.y - b.y || a.x - b.x);
    for (const c of cands) if (c.x >= x0 && c.y >= y0 && c.x + w <= maxX && !hits(c.x, c.y)) return c;
    return { x: x0, y: Math.max(...items.map((i) => i.y + i.h)) + GAP };   // nothing fits: new row below everything
  }
  // Toggle: adds the submission to the active wall, or takes it off again if it's already there
  async function toggleWall({ sid, src, res }) {
    let { walls, w } = await getWalls();
    if (!w) { w = { id: Math.random().toString(36).slice(2, 10), name: T("wallName", 1), pinned: false, view: { x: 40, y: 40, z: 0.5 }, items: [] }; walls.push(w); }
    if (w.items.some((i) => String(i.sid) === String(sid))) {
      w.items = w.items.filter((i) => String(i.sid) !== String(sid));
      await new Promise((r) => chrome.storage.local.set({ walls }, r));
      toast(T("wallRemoved", w.name), w.id);
      return;
    }
    const width = 600, height = res ? Math.round(width * res.h / res.w) : width;
    const { x, y } = freeSpot(w.items, width, height);
    w.items.push({ id: Math.random().toString(36).slice(2, 10), sid: String(sid), src, x, y, w: width, h: height, fixed: !!res });
    await new Promise((r) => chrome.storage.local.set({ walls, activeWall: w.id }, r));
    toast(T("wallAdded", w.name), w.id);
  }
  // Wall buttons show whether their submission is on the active wall (accent + check mark)
  const wallBtns = new Map();   // button → () => submission id
  async function refreshWallBtns() {
    const { w } = await getWalls();
    for (const [b, getSid] of wallBtns) {
      const sid = getSid();
      const on = !!(w && sid && w.items.some((i) => String(i.sid) === String(sid)));
      b.classList.toggle("is-on", on);
      b.replaceChildren(icon(on ? ICONS.wallOn : ICONS.wall, b.dataset.size));
      b.title = on ? T("wallOn", w.name) : T("wallAdd");
      b.setAttribute("aria-label", b.title);
    }
  }
  let wallWatch = false;
  function bindWallBtn(b, getSid) {
    wallBtns.set(b, getSid);
    if (!wallWatch) {
      wallWatch = true;
      chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && (c.walls || c.activeWall)) refreshWallBtns(); });
    }
    refreshWallBtns();
  }
  // after an extension update the old page's connection is gone: say so instead of failing silently
  const openWalls = (id) => {
    try { chrome.runtime.sendMessage({ type: "faw-open-walls", wall: id || "" }); } catch (e) { toast(T("staleCtx")); }
  };
  let toastEl = null, toastTimer = null;
  function toast(text, wallId) {
    if (!toastEl) { toastEl = el("div", "faw-toast"); document.body.appendChild(toastEl); }
    toastEl.replaceChildren(el("span", null, text));
    if (wallId !== undefined) {                     // wall toasts get an "Open wall" button
      const open = el("button", null, T("wallOpen"));
      open.type = "button";
      open.addEventListener("click", () => openWalls(wallId));
      toastEl.append(open);
    }
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 3500);
  }
  function wallButton(cls, size) {
    const b = el("button", cls);
    b.type = "button";
    b.dataset.size = size;
    b.title = T("wallAdd");
    b.append(icon(ICONS.wall, size));
    return b;
  }
  // Top bar: "Open walls" in its own section between the NSFW switch and the avatar
  function initWallsNav() {
    const bar = document.querySelector("#ddmenu ul.navhideonmobile");
    const anchor = bar && (bar.querySelector("li.faw-topbar") || bar.querySelector("li.message-bar-desktop"));
    if (!anchor || bar.querySelector(".faw-topbar--walls")) return;
    const li = el("li", "faw-topbar faw-topbar--walls");
    const b = el("button", "faw-tb-btn faw-tb-walls");
    b.type = "button";
    b.title = T("wallOpenAll");
    b.setAttribute("aria-label", b.title);
    b.append(icon(ICONS.wall, 15));
    b.addEventListener("click", () => openWalls());
    li.append(b);
    anchor.after(li);
    root.classList.add("faw-nav-flex");
  }
  function initWallButton() {
    const controls = document.querySelector(".submission-controls-upper");
    const id = viewId(location.pathname);
    if (!controls || !id) return;
    const btn = wallButton("button standard mobile-fix faw-wall-btn", 18);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const cur = parseSubmission(document, location.pathname);
      if (cur.full) toggleWall({ sid: id, src: cur.full, res: cur.res });
    });
    bindWallBtn(btn, () => id);
    const after = controls.querySelector(".faw-subpin-btn") || [...controls.children].find((x) => /download/i.test(x.textContent));
    if (after) after.after(btn); else controls.append(btn);
  }

  // ------------------------------------------------------------------ quick view
  function initQuickView() {
    let qv = null, list = [], idx = 0, token = 0;
    const ready = new Map();   // id → parsed submission, for neighbours already prefetched

    const isQvAnchor = (a) =>
      a && a.matches("a[href]") && viewId(a.getAttribute("href")) &&
      /^\/view\/\d+\/?$/.test(new URL(a.href).pathname) &&
      a.querySelector("img") && !a.closest(".faw-qv, .faw-comic, .faw-pinbar, .submission-description, #submission-main-content .submission-area");

    const DBL_MS = 230;          // how long a single click waits for a second one
    let pendingOpen = null;
    // window + capture runs before FA's (and other extensions') handlers on the page
    window.addEventListener("click", (e) => {
      // Ctrl/Cmd/Shift/Alt+click stay the browser's (new tab, new window, download)
      if (e.defaultPrevented || e.button !== 0 || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
      const a = e.target.closest && e.target.closest("a[href]");
      if (!isQvAnchor(a)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // double-click: straight to the submission page. A single click waits one double-click
      // interval before opening the quick view, so a double-click never flashes the popup.
      if (e.detail >= 2) {
        clearTimeout(pendingOpen);
        pendingOpen = null;
        location.href = a.href;
        return;
      }
      clearTimeout(pendingOpen);
      pendingOpen = setTimeout(() => { pendingOpen = null; buildList(a); open(); }, DBL_MS);
    }, true);

    function buildList(anchor) {
      const seen = new Set();
      const start = viewId(anchor.getAttribute("href"));
      list = [];
      for (const a of document.querySelectorAll("a[href*='/view/']")) {
        if (!isQvAnchor(a)) continue;
        const id = viewId(a.getAttribute("href"));
        if (seen.has(id)) continue;
        const ti = a.querySelector("img");
        // thumbnails hidden by the blocklist are stepped over (and not prefetched); one that was
        // clicked on purpose still opens
        if (ti.classList.contains("blocked-content") && id !== start) continue;
        seen.add(id);
        list.push({ id, thumb: ti.currentSrc || ti.src || "", tw: ti.naturalWidth || 0, th: ti.naturalHeight || 0 });
      }
      idx = Math.max(0, list.findIndex((x) => x.id === start));
    }

    function build() {
      qv = el("div", "faw-qv");
      qv.hidden = true;
      // static markup (only our own texts) parsed once; DOMParser instead of innerHTML
      const tpl = `
        <div class="faw-qv__view">
        <div class="faw-qv__stage">
          <span class="faw-qv__spinner">${T("loading")}</span>
          <div class="faw-qv__frame">
            <img class="faw-qv__low" alt="">
            <img class="faw-qv__img" alt="">
            <span class="faw-qv__badge">${T("loadingFull")}</span>
          </div>
        </div>
          <button class="faw-qv__nav faw-qv__nav--prev" title="${T("prev")}"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button>
          <button class="faw-qv__nav faw-qv__nav--next" title="${T("next")}"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></button>
        </div>
        <aside class="faw-qv__panel">
          <div class="faw-qv__top">
            <div><h2 class="faw-qv__title"><a></a></h2><div class="faw-qv__by"></div></div>
            <button class="faw-qv__close" title="${T("close")}">×</button>
          </div>
          <div class="faw-qv__actions">
            <button class="faw-qv__btn" data-act="fav">+Fav</button>
            <button class="faw-qv__btn" data-act="dl">${T("download")}</button>
            <a class="faw-qv__btn" data-act="open">${T("openPage")}</a>
            <button class="faw-qv__btn faw-qv__pin" data-act="pin" data-size="15"></button>
            <button class="faw-qv__btn faw-qv__wall" data-act="wall"></button>
          </div>
          <dl class="faw-qv__meta"></dl>
          <div class="faw-qv__tags"></div>
          <div class="faw-qv__desc"></div>
          <div class="faw-qv__comments">
            <h3 class="faw-qv__ch">${T("comments")} <span></span></h3>
            <div class="faw-qv__clist"></div>
            <form class="faw-qv__cform">
              <textarea placeholder="${T("writeComment")}" rows="3"></textarea>
              <div class="faw-qv__crow"><span class="faw-qv__cstatus"></span><button class="faw-qv__btn" type="submit">${T("post")}</button></div>
            </form>
          </div>
          <div class="faw-qv__hint">${T("qvHint")}</div>
        </aside>`;
      qv.append(...new DOMParser().parseFromString(tpl, "text/html").body.childNodes);
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
      // pin to the submissions sidebar
      const pinBtn = $("[data-act=pin]");
      if (S.pinSubs) {
        refreshPin = subPins.bind(pinBtn, () => list[idx] && list[idx].id);
        pinBtn.onclick = () => {
          const it = list[idx];
          if (!it) return;
          subPins.toggle({ u: it.id, n: ((data && String(data.id) === String(it.id) && data.title) || "").slice(0, 80), a: thumb300(it.thumb || (data && data.preview)) });
        };
      } else pinBtn.remove();
      const wallBtn = $("[data-act=wall]");
      if (S.walls) {
        wallBtn.dataset.size = 15;
        wallBtn.onclick = () => { if (data && data.full) toggleWall({ sid: data.id, src: data.full, res: data.res }); };
        bindWallBtn(wallBtn, () => list[idx] && list[idx].id);
      } else wallBtn.remove();
      $(".faw-qv__stage").addEventListener("click", (e) => { if (e.target === e.currentTarget) close(); });
      const qvStage = $(".faw-qv__stage"), qvFrame = $(".faw-qv__frame");
      const qvPan = makePannable(qvFrame, { x: qvStage, y: qvStage, active: () => qvStage.classList.contains("is-actual"), hostClass: qvFrame });
      qvFrame.addEventListener("click", (e) => {
        if (qvPan.consumeDrag()) return;
        const r = qvFrame.getBoundingClientRect();
        const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
        const zoomIn = !qvStage.classList.contains("is-actual");
        qvStage.classList.toggle("is-actual", zoomIn);
        qvFrame.classList.toggle("faw-pannable", zoomIn);
        fitImage(true);
        if (zoomIn) {
          const r2 = qvFrame.getBoundingClientRect();
          qvStage.scrollLeft += r2.left + fx * r2.width - e.clientX;
          qvStage.scrollTop += r2.top + fy * r2.height - e.clientY;
        }
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
      // full file failed: try FA's download link once, otherwise keep the preview and drop the badge
      $(".faw-qv__img").addEventListener("error", (e) => {
        const src = e.target.getAttribute("src");
        if (!src || !data) return;
        if (data.download && abs(data.download) !== src) { e.target.src = abs(data.download); return; }
        e.target.removeAttribute("src");
        qv.querySelector(".faw-qv__frame").classList.add("is-failed");
      });
      window.addEventListener("resize", () => { if (!qv.hidden) fitImage(); });
      document.addEventListener("keydown", (e) => {
        if (qv.hidden || e.ctrlKey || e.metaKey || e.altKey) return;           // leave browser shortcuts alone
        if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable]")) return;
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
      qv.querySelector(".faw-qv__stage").classList.remove("is-actual");
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
      $(".faw-qv__frame").classList.remove("faw-pannable");
      if (refreshPin) refreshPin();                                // pin + wall state of the new item right away
      if (S.walls) refreshWallBtns();
      data = null;                                                 // no stale fav / download state from the last item
      updateFavBtn();
      $("[data-act=dl]").disabled = true;
      $(".faw-qv__nav--prev").disabled = idx === 0;
      $(".faw-qv__nav--next").disabled = idx >= list.length - 1 && !(infinite && !infinite.done);
      // Low-quality layer first: the (enlarged) thumbnail. Sized with the exact dimensions when the
      // page is already prefetched, otherwise from the thumbnail's aspect ratio. The previous image
      // is cleared first so it never shows stretched in the new frame.
      frame.classList.remove("is-hq", "is-failed");
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
      // into a local first: an answer that arrives after the user moved on must not replace the data of
      // the submission now shown (Fav, Download, wall and comments all act on `data`)
      let got;
      try {
        got = await getSubmission("/view/" + item.id + "/");
      } catch (err) {
        if (t !== token) return;
        $(".faw-qv__spinner").textContent = T("loadFailed", err.message);
        return;
      }
      ready.set(item.id, got);
      if (t !== token) return;
      data = got;
      $(".faw-qv__spinner").textContent = T("loading");
      $(".faw-qv__title a").textContent = data.title;
      const by = $(".faw-qv__by");
      if (data.artist) {
        const a = el("a", null, data.artist.name);
        a.href = data.artist.href;
        by.append(T("by") + " ", a);
      }
      const meta = $(".faw-qv__meta");
      for (const [k, v] of [[T("category"), data.category], [T("species"), data.species],
        [T("resolution"), data.res ? `${data.res.w} × ${data.res.h}` : ""], [T("rating"), data.rating]]) {
        if (!v) continue;
        meta.append(el("dt", null, k), el("dd", null, v));
      }
      const tags = $(".faw-qv__tags");
      for (const tg of data.tags.slice(0, 40)) {
        const a = el("a", null, tg.text);
        a.href = tg.href;
        tags.appendChild(a);
      }
      showContent($(".faw-qv__desc"), data.desc);
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
      if (data.full) {                                            // fades in over the thumbnail
        if (img.getAttribute("src") !== data.full) img.src = data.full;
        else if (img.complete && img.naturalWidth) frame.classList.add("is-hq");
      } else frame.classList.add("is-hq");
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
      const cs = getComputedStyle(stage);
      const aw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const ah = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const scale = Math.min(aw / nw, ah / nh, exact ? 2 : Infinity);
      if (stage.classList.contains("is-actual")) {
        // zoomed: native size, but always noticeably larger than the fitted view
        const z = Math.max(1, scale * 1.75);
        frame.style.width = Math.round(nw * z) + "px";
        frame.style.height = Math.round(nh * z) + "px";
        return;
      }
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
      if (!cs.length) list.appendChild(el("div", "faw-qv__cempty", T("noComments")));
      for (const c of cs) {
        const item = el("div", "faw-qv__c");
        item.style.marginLeft = Math.min(c.depth, 6) * 14 + "px";
        const img = el("img");
        img.src = c.avatar || AV_DEFAULT;
        img.alt = "";
        const body = el("div", "faw-qv__cbody");
        const head = el("div", "faw-qv__chead");
        const who = el("a", null, c.name || "?");
        if (c.href) who.href = c.href;
        head.append(who, el("span", null, c.date));
        const text = el("div", "faw-qv__ctext");
        showContent(text, c.body);
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
      st.textContent = T("posting");
      try {
        const body = new URLSearchParams(cur.commentForm.fields);
        body.set("reply", text);
        const url = new URL(cur.commentForm.action || `/view/${cur.id}/`, location.origin).href;
        const res = await pageFetch(url, { method: "POST", body, credentials: "same-origin" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const doc = new DOMParser().parseFromString(await res.text(), "text/html");
        const fresh = parseSubmission(doc, `/view/${cur.id}/`);
        // FA answers 200 for its own refusals too (flood protection, blocked, comments off): the comment
        // counts as posted only when the returned page lists one more. Otherwise the text stays in the box.
        const isSub = !!doc.querySelector("#submissionImg, #comments-submission, #add_comment_form");
        if (isSub) {
          docCache.set(cur.id, Promise.resolve(fresh));
          ready.set(cur.id, fresh);
          if (data === cur) {
            data = fresh;
            renderComments();
            const panel = qv.querySelector(".faw-qv__panel");
            if (panel) panel.scrollTop = panel.scrollHeight;
          }
        }
        if (!isSub || fresh.comments.length <= cur.comments.length) {
          const why = doc.querySelector("section.notice-message .section-body, .redirect-message, .error-message");
          st.textContent = why ? T("postFailed", why.textContent.replace(/\s+/g, " ").trim().slice(0, 160)) : T("postUnclear");
          return;
        }
        ta.value = "";
        st.textContent = T("posted");
      } catch (err) {
        st.textContent = T("postFailed", err.message);
      } finally {
        btn.disabled = false;
      }
    }

    let refreshPin = null;
    function updateFavBtn() {
      if (refreshPin) refreshPin();
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
        b.textContent = T("favFailed");
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
