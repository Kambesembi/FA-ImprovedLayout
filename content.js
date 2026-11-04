// Runs at document_start: sets the switch classes (faw-layout / faw-design) and size variables on
// <html> before FA paints. Once the DOM is ready it also does the structural changes that must not
// flash: splitting the submission sidebar, tagging profile sections, arrow buttons, theme detection.
(() => {
  const DEFAULTS = {
    enabled: true, ultrawide: true, design: true,
    gutter: 24, thumb: 1.25, pins: true, pinned: [], pinSubs: true, lang: "auto"
  };
  const PINBAR = 100;   // minimum side gutter while a pin sidebar is shown (sidebar ≥76px + margins); popup.js mirrors it
  let pinnedSubs = [];  // pinned submissions live in storage.local (more room than sync)
  const root = document.documentElement;
  let current = DEFAULTS;
  let loaded = false;            // settings read from storage
  let domReady = document.readyState !== "loading";
  // DOM work waits for both the settings and the parsed page, so a disabled extension never touches it
  function run() {
    if (!loaded || !domReady) return;
    if (current.enabled) detectTheme();
    arrowButtons();
    if (current.enabled) previewPlaceholder();
    splitSubmissionPanel();
    tagProfile();
  }
  const VARS = ["--faw-gutter", "--faw-thumb"];
  const layoutOn = () => current.enabled && current.ultrawide;
  const designOn = () => current.enabled && current.design;

  // Master switch off → no classes, no variables, no DOM changes: FA as if the extension weren't there.
  function apply(s) {
    s = Object.assign({}, DEFAULTS, s);
    current = s;
    root.classList.toggle("faw-layout", layoutOn());
    root.classList.toggle("faw-design", designOn());
    if (layoutOn()) {
      root.style.setProperty("--faw-gutter", (barsShown() ? Math.max(s.gutter, PINBAR) : s.gutter) + "px");
      root.style.setProperty("--faw-thumb", String(s.thumb));
    } else {
      for (const v of VARS) root.style.removeProperty(v);
    }
    loaded = true;
    if (typeof fawSetLang === "function") fawSetLang(s.lang);
    renderBars();
    run();
  }
  const barsShown = () => (current.pins && Array.isArray(current.pinned) && current.pinned.length > 0) ||
    (current.pinSubs && pinnedSubs.length > 0);

  // ---- pin sidebars: pinned artists on the right, pinned submissions on the left. Drawn at page start
  //      (before FA renders) so they don't pop in late. Removing entries needs "delete mode" (trash
  //      icon) so a stray click can't unpin anything; click-hold-drag reorders.
  const SVG = "http://www.w3.org/2000/svg";
  function svgIcon(paths, size) {
    const svg = document.createElementNS(SVG, "svg");
    for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor",
      "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round" })) svg.setAttribute(k, v);
    for (const d of paths) { const p = document.createElementNS(SVG, "path"); p.setAttribute("d", d); svg.appendChild(p); }
    return svg;
  }
  const PIN_ICON = ["M12 17v5", "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"];
  const TRASH_ICON = ["M3 6h18", "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", "M10 11v6M14 11v6"];
  const tr = (k, fallback) => (typeof T === "function" ? T(k) : fallback);

  // entries: artists { u: slug, n: name, a: avatar }   submissions { u: id, n: title, a: thumbnail }
  const herePath = location.pathname;
  const BARS = {
    artists: {
      side: "right", area: "sync", key: "pinned", titleKey: "pinnedArtists", deleteKey: "pinDelete",
      on: () => current.pins, list: () => current.pinned || [],
      href: (p) => "/user/" + encodeURIComponent(p.u) + "/",
      img: (p) => p.a || "https://a.furaffinity.net/" + encodeURIComponent(p.u) + ".gif",
      isHere: (p) => { const m = herePath.match(/^\/(?:user|gallery|scraps|favorites|journals|commissions|stats)\/([^/]+)/i); return !!m && decodeURIComponent(m[1]).toLowerCase() === p.u; }
    },
    subs: {
      side: "left", area: "local", key: "pinnedSubs", titleKey: "pinnedSubs", deleteKey: "pinDeleteSubs",
      on: () => current.pinSubs, list: () => pinnedSubs,
      href: (p) => "/view/" + p.u + "/",
      img: (p) => p.a,
      isHere: (p) => herePath.startsWith("/view/" + p.u + "/")
    }
  };
  const saveBar = (cfg, list) => chrome.storage[cfg.area].set({ [cfg.key]: list });

  function renderBars() { for (const k in BARS) renderBar(BARS[k]); }
  function renderBar(cfg) {
    const pins = current.enabled && cfg.on() && Array.isArray(cfg.list()) ? cfg.list() : [];
    if (!pins.length) { if (cfg.el) { cfg.el.hidden = true; cfg.el.classList.remove("is-deleting"); } return; }
    if (!cfg.el) {
      const bar = cfg.el = document.createElement("aside");
      bar.className = "faw-pinbar faw-pinbar--" + cfg.side;
      const head = document.createElement("div");
      head.className = "faw-pinbar__head";
      const label = document.createElement("span");
      label.append(svgIcon(PIN_ICON, 15));
      const trash = document.createElement("button");
      trash.type = "button";
      trash.className = "faw-pinbar__trash";
      trash.append(svgIcon(TRASH_ICON, 15));
      trash.addEventListener("click", () => bar.classList.toggle("is-deleting"));
      head.append(label, trash);
      const list = document.createElement("div");
      list.className = "faw-pinbar__list";
      // in delete mode a click removes the entry instead of opening it
      list.addEventListener("click", (e) => {
        const a = e.target.closest(".faw-pin");
        if (!a || !bar.classList.contains("is-deleting")) return;
        e.preventDefault();
        saveBar(cfg, cfg.list().filter((q) => String(q.u) !== a.dataset.u));
      });
      enableReorder(cfg, list);
      bar.append(head, list);
      (document.body || root).appendChild(bar);
      if (!document.body) document.addEventListener("DOMContentLoaded", () => document.body.appendChild(bar), { once: true });
    }
    const bar = cfg.el;
    bar.hidden = false;
    bar.querySelector(".faw-pinbar__head span").title = tr(cfg.titleKey, "Pinned");
    bar.querySelector(".faw-pinbar__trash").title = tr(cfg.deleteKey, "Remove");
    const list = bar.querySelector(".faw-pinbar__list");
    list.replaceChildren();
    for (const p of pins) {
      const a = document.createElement("a");
      a.className = "faw-pin" + (cfg.isHere(p) ? " is-current" : "");
      a.href = cfg.href(p);
      a.title = p.n || p.u;
      a.dataset.u = String(p.u);
      a.draggable = false;
      const img = document.createElement("img");
      img.alt = "";
      img.draggable = false;
      img.src = cfg.img(p) || "https://a.furaffinity.net/default.gif";
      img.onerror = () => { img.onerror = null; img.src = "https://a.furaffinity.net/default.gif"; };
      const name = document.createElement("span");
      name.textContent = p.n || p.u;
      const x = document.createElement("i");
      x.className = "faw-pin__x";
      x.textContent = "×";
      a.append(img, name, x);
      list.appendChild(a);
    }
  }

  // ---- submission page: stats + Fav/Note/Download stay in the aside above the comments; the details
  //      table, keywords and folders move into a panel below the description (reversible)
  const moved = [];
  function splitSubmissionPanel() {
    if (!document.body || document.body.id !== "pageid-submission") return;
    const want = layoutOn();
    let panel = document.getElementById("faw-subinfo");

    if (!want) {                                   // put everything back where FA had it
      while (moved.length) {
        const { node, marker } = moved.pop();
        marker.replaceWith(node);
      }
      if (panel) panel.remove();
      return;
    }
    if (panel) return;
    const details = document.querySelector(".submission-details");
    const side = document.querySelector("#submission-main-content > div:nth-child(2)");
    if (!details || !side) return;

    panel = document.createElement("div");
    panel.id = "faw-subinfo";
    for (const sel of [".submission-content-stats", ".submission-tags", "#sidebar-lower-reverse"]) {
      const node = side.querySelector(sel);
      if (!node) continue;
      const marker = document.createComment("faw:" + sel);
      node.replaceWith(marker);
      moved.push({ node, marker });
      panel.appendChild(node);
    }
    if (panel.children.length) details.after(panel);
  }

  // Click, hold and drag an entry to reorder; the new order is saved when it's dropped
  function enableReorder(cfg, list) {
    let drag = null, swallowClick = false;
    list.addEventListener("mousedown", (e) => {
      const a = e.target.closest(".faw-pin");
      if (!a || e.button !== 0 || cfg.el.classList.contains("is-deleting")) return;
      e.preventDefault();
      drag = { a, x: e.clientX, y: e.clientY, active: false };
    });
    window.addEventListener("mousemove", (e) => {
      if (!drag) return;
      if (!drag.active) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
        drag.active = true;
        drag.a.classList.add("is-dragging");
        cfg.el.classList.add("is-reordering");
      }
      // move the entry in front of the first sibling that comes after the pointer in reading order
      const others = [...list.children].filter((x) => x !== drag.a);
      const next = others.find((x) => {
        const r = x.getBoundingClientRect();
        return e.clientY < r.top || (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2);
      });
      if (next) { if (drag.a.nextSibling !== next) list.insertBefore(drag.a, next); }
      else if (list.lastChild !== drag.a) list.appendChild(drag.a);
      // scroll the list while dragging near its edges
      const lr = list.getBoundingClientRect();
      if (e.clientY < lr.top + 30) list.scrollTop -= 12;
      else if (e.clientY > lr.bottom - 30) list.scrollTop += 12;
    });
    window.addEventListener("mouseup", () => {
      if (!drag) return;
      const { a, active } = drag;
      drag = null;
      if (!active) return;
      a.classList.remove("is-dragging");
      cfg.el.classList.remove("is-reordering");
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 0);
      const byU = new Map(cfg.list().map((p) => [String(p.u), p]));
      saveBar(cfg, [...list.children].map((x) => byU.get(x.dataset.u)).filter(Boolean));
    });
    list.addEventListener("click", (e) => { if (swallowClick) { e.preventDefault(); e.stopPropagation(); } }, true);
  }

  // ---- profile page: tag the left-column sections so CSS can pair Featured | Gallery reliably
  function tagProfile() {
    if (!layoutOn() || !document.body || document.body.id !== "pageid-userpage") return;
    const lc = document.querySelector(".userpage-layout-left-col-content");
    if (!lc) return;
    let featured = null, gallery = null;
    for (const sec of lc.children) {
      if (!sec.classList.contains("gallery_container")) continue;
      const g = sec.querySelector("#gallery-latest-submissions");
      const f = sec.querySelector("#gallery-latest-favorites");
      if (g) { sec.classList.add("faw-gallery"); gallery = sec; }
      else if (f) sec.classList.add("faw-favs");
      else { sec.classList.add("faw-featured"); featured = sec; }
      const grid = g || f;
      if (grid && !grid.querySelector("figure")) sec.classList.add("faw-empty");
      if (!grid && !sec.querySelector("img")) sec.classList.add("faw-empty");
    }
    const pair = featured && gallery && !featured.classList.contains("faw-empty") && !gallery.classList.contains("faw-empty");
    lc.classList.toggle("faw-pair", !!pair);
  }
  // ---- pagination arrows as early as possible (before first paint) so the long labels never flash;
  //      features.js re-applies them when FA re-renders. The label stays in the DOM for FA's scripts.
  const ARROWS = {
    "first": "<<", "first page": "<<", "prev": "<", "prev page": "<", "previous": "<", "previous page": "<",
    "back": "<", "next": ">", "next page": ">", "last": ">>", "last page": ">>"
  };
  function arrowButtons() {
    if (!designOn()) return;
    for (const b of document.querySelectorAll("button, a.button, .button > a")) {
      if (b.classList.contains("faw-arrow-btn") || b.children.length || b.closest("#ddmenu")) continue;
      const arrow = ARROWS[b.textContent.trim().toLowerCase()];
      if (!arrow) continue;
      const span = document.createElement("span");
      span.className = "faw-hide-text";
      span.textContent = b.textContent;
      b.textContent = "";
      b.appendChild(span);
      b.dataset.fawArrow = arrow;
      if (!b.title) b.title = span.textContent.trim();
      b.classList.add("faw-arrow-btn");
    }
  }
  // Submission page: show FA's small preview under the full image until the full file has loaded
  // (same idea as the quick view). Only a background on the <img>, removed once it has loaded.
  function previewPlaceholder() {
    const img = document.getElementById("submissionImg");
    if (!img || img.complete || img.dataset.fawPh) return;
    const pv = img.getAttribute("data-preview-src");
    if (!pv) return;
    img.dataset.fawPh = "1";
    img.style.backgroundImage = `url("${new URL(pv, location.href).href}")`;
    img.style.backgroundSize = "100% 100%";
    img.style.backgroundRepeat = "no-repeat";
    const done = () => { img.style.backgroundImage = ""; };
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
  }
  // FA colour scheme (Dark, Dark retro, Light, …): light schemes flip the extension's palette
  function detectTheme() {
    const link = document.querySelector('link[href*="ui_theme_"]');
    const name = link ? (link.getAttribute("href").match(/ui_theme_([a-z0-9_-]+)/i) || [])[1] || "" : "";
    let light = /light/i.test(name);
    if (!light && document.body) {
      const m = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g);
      if (m && m.length >= 3 && (m[3] === undefined || +m[3] > 0)) light = (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) > 150;
    }
    root.classList.toggle("faw-light", light);
    if (name) root.dataset.fawTheme = name;
  }
  chrome.storage.local.get({ pinnedSubs: [] }, (l) => {
    pinnedSubs = Array.isArray(l.pinnedSubs) ? l.pinnedSubs : [];
    chrome.storage.sync.get(DEFAULTS, apply);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.pinnedSubs) pinnedSubs = changes.pinnedSubs.newValue || [];
    if (area === "sync" || (area === "local" && changes.pinnedSubs)) chrome.storage.sync.get(DEFAULTS, apply);
  });
  if (!domReady) {
    document.addEventListener("DOMContentLoaded", () => { domReady = true; run(); }, { once: true });
  }
})();
