// FA Ultrawide — image fit, quick view, comic reader, infinite scroll.
// Runs at document_idle. Feature toggles come from chrome.storage.sync (popup).
(() => {
  "use strict";

  const DEFAULTS = { enabled: true, imageFit: true, quickView: true, comic: true, comicHorizontal: false, infinite: true };
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

  chrome.storage.sync.get(DEFAULTS, (s) => {
    S = s;
    if (!S.enabled) return;
    if (page === "pageid-submission") {
      if (S.imageFit) initImageFit();
      if (S.comic) initComic();
    }
    if (S.infinite) initInfinite();
    if (S.quickView) initQuickView();
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "sync") return;
    for (const k in c) S[k] = c[k].newValue;
    root.classList.toggle("faw-fit", !!(S.enabled && S.imageFit && document.getElementById("submissionImg")));
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
      comicLinks
    };
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

    // Horizontal reader: vertical wheel scrolls the strip; ← → step one page
    function enableHorizontal(strip) {
      strip.addEventListener("wheel", (e) => {
        if (!root.classList.contains("faw-comic-h") || e.ctrlKey) return;
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const max = strip.scrollWidth - strip.clientWidth;
        if ((d < 0 && strip.scrollLeft <= 0) || (d > 0 && strip.scrollLeft >= max - 1)) return; // let the page scroll at the ends
        e.preventDefault();
        strip.scrollLeft += d * (e.deltaMode === 1 ? 40 : 1);
      }, { passive: false });
      document.addEventListener("keydown", (e) => {
        if (!root.classList.contains("faw-comic-h") || document.querySelector(".faw-qv:not([hidden])")) return;
        if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable]")) return;
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const pages = [...strip.children];
        const sl = strip.getBoundingClientRect().left;
        let i = pages.findIndex((pg) => { const r = pg.getBoundingClientRect(); return r.left + r.width / 2 > sl; });
        if (i < 0) i = pages.length - 1;
        const target = pages[Math.max(0, Math.min(pages.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)))];
        strip.scrollTo({ left: strip.scrollLeft + target.getBoundingClientRect().left - sl, behavior: "smooth" });
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

    async function loadMore() {
      if (loading || done) return;
      loading = true;
      status.textContent = `Loading page ${pageNo + 1}…`;
      try {
        const { doc, url } = await fetchDoc(next.url, next.init);
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
        if (!next || !added) {
          done = true;
          status.textContent = added ? `End · ${pageNo} pages loaded` : "No more submissions";
        } else {
          status.textContent = `${pageNo} pages loaded · scroll for more`;
        }
      } catch (err) {
        status.textContent = `Couldn't load page ${pageNo + 1} (${err.message}) `;
        const retry = el("button", null, "Retry");
        retry.onclick = () => loadMore();
        status.appendChild(retry);
        loading = false;
        return;
      }
      loading = false;
      // keep filling if the sentinel is still on screen (very wide screens)
      requestAnimationFrame(() => {
        if (!done && status.getBoundingClientRect().top < innerHeight + 1600) loadMore();
      });
    }

    new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { rootMargin: "0px 0px 1600px 0px" }).observe(status);

    infinite = { loadMore, get done() { return done; }, get loading() { return loading; } };
  }

  // "Next" link or button (forms are used on browse/search/favorites)
  function findNext(doc, baseUrl) {
    const cands = [...doc.querySelectorAll("a[href], button")].filter((e) => {
      const t = e.textContent.trim();
      return /^next\b/i.test(t) && !e.closest(".faw-qv, #ddmenu, .submission-description");
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

    const isQvAnchor = (a) =>
      a && a.matches("a[href]") && viewId(a.getAttribute("href")) &&
      /^\/view\/\d+\/?$/.test(new URL(a.href).pathname) &&
      a.querySelector("img") && !a.closest(".faw-qv, .faw-comic, .submission-description, #submission-main-content .submission-area");

    // window + capture runs before FA's (and other extensions') handlers on the page
    window.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest("a[href]");
      if (!isQvAnchor(a)) return;
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
          <button class="faw-qv__nav faw-qv__nav--prev" title="Previous (←)">‹</button>
          <button class="faw-qv__nav faw-qv__nav--next" title="Next (→)">›</button>
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
          <div class="faw-qv__hint">← → browse · F fav · D download · click image for actual size · Esc close</div>
        </aside>`;
      document.body.appendChild(qv);
      const $ = (s) => qv.querySelector(s);
      $(".faw-qv__close").onclick = close;
      $(".faw-qv__nav--prev").onclick = () => go(-1);
      $(".faw-qv__nav--next").onclick = () => go(1);
      $("[data-act=fav]").onclick = toggleFav;
      $("[data-act=dl]").onclick = download;
      $(".faw-qv__stage").addEventListener("click", (e) => { if (e.target === e.currentTarget) close(); });
      $(".faw-qv__frame").addEventListener("click", () => {
        $(".faw-qv__stage").classList.toggle("is-actual");
        fitImage();
      });
      $(".faw-qv__low").addEventListener("load", fitImage);
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
      // Low-quality layer first: the (enlarged) thumbnail, sized from its aspect ratio
      frame.classList.remove("is-hq");
      img.removeAttribute("src");
      img.dataset.w = item.tw || "";
      img.dataset.h = item.th || "";
      img.dataset.exact = "";
      frame.style.visibility = item.thumb ? "" : "hidden";
      $(".faw-qv__spinner").hidden = !!item.thumb;
      if (item.thumb) {
        low.src = bigThumb(item.thumb);
        fitImage();
      } else {
        low.removeAttribute("src");
      }
      $(".faw-qv__title a").textContent = "";
      $(".faw-qv__title a").href = "/view/" + item.id + "/";
      $("[data-act=open]").href = "/view/" + item.id + "/";
      $(".faw-qv__by").textContent = "";
      $(".faw-qv__meta").textContent = "";
      $(".faw-qv__tags").textContent = "";
      $(".faw-qv__desc").textContent = "";
      try {
        data = await getSubmission("/view/" + item.id + "/");
      } catch (err) {
        if (t !== token) return;
        $(".faw-qv__spinner").textContent = "Couldn't load submission (" + err.message + ")";
        return;
      }
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
      updateFavBtn();
      $("[data-act=dl]").disabled = !data.download;

      if (data.res) {
        img.dataset.w = data.res.w;
        img.dataset.h = data.res.h;
        img.dataset.exact = "1";
      }
      fitImage();
      img.alt = data.title;
      if (data.full) img.src = data.full;   // fades in over the thumbnail once loaded
      else frame.classList.add("is-hq");
      // prefetch neighbours' pages
      for (const d of [1, -1]) if (list[idx + d]) getSubmission("/view/" + list[idx + d].id + "/").catch(() => {});
    }

    // Sizes the frame (both layers). Exact dimensions come from the submission page;
    // until then the thumbnail's aspect ratio is used.
    function fitImage() {
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
      frame.style.width = Math.round(nw * scale) + "px";
      frame.style.height = Math.round(nh * scale) + "px";
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
