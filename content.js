// Runs at document_start: sets the switch classes (faw-layout / faw-design) and size variables on
// <html> before FA paints. Once the DOM is ready it also does the structural changes that must not
// flash: splitting the submission sidebar, tagging profile sections, arrow buttons, theme detection.
(() => {
  const DEFAULTS = {
    enabled: true, ultrawide: true, design: true,
    max: 2800, gutter: 24, thumb: 1.25, pins: true, pinned: [], lang: "auto"
  };
  const PINBAR = 116;   // px kept free on both sides for the pinned-artists sidebar (88px wide + margins)
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
  const VARS = ["--faw-max", "--faw-gutter", "--faw-thumb"];
  const layoutOn = () => current.enabled && current.ultrawide;
  const designOn = () => current.enabled && current.design;

  // Master switch off → no classes, no variables, no DOM changes: FA as if the extension weren't there.
  function apply(s) {
    s = Object.assign({}, DEFAULTS, s);
    current = s;
    root.classList.toggle("faw-layout", layoutOn());
    root.classList.toggle("faw-design", designOn());
    if (layoutOn()) {
      root.style.setProperty("--faw-max", s.max > 0 ? s.max + "px" : "100vw");
      const pinsShown = s.pins && Array.isArray(s.pinned) && s.pinned.length > 0;
      root.style.setProperty("--faw-gutter", (pinsShown ? Math.max(s.gutter, PINBAR) : s.gutter) + "px");
      root.style.setProperty("--faw-thumb", String(s.thumb));
    } else {
      for (const v of VARS) root.style.removeProperty(v);
    }
    loaded = true;
    if (typeof fawSetLang === "function") fawSetLang(s.lang);
    renderPinBar();
    run();
  }

  // ---- pinned artists sidebar: drawn at page start (before FA renders) so it doesn't pop in late.
  //      Removing entries needs "delete mode" (trash icon) so a stray click can't unpin anyone.
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
  let pinBar = null;
  function renderPinBar() {
    const pins = current.enabled && current.pins && Array.isArray(current.pinned) ? current.pinned : [];
    if (!pins.length) { if (pinBar) { pinBar.hidden = true; pinBar.classList.remove("is-deleting"); } return; }
    if (!pinBar) {
      pinBar = document.createElement("aside");
      pinBar.className = "faw-pinbar";
      const head = document.createElement("div");
      head.className = "faw-pinbar__head";
      const label = document.createElement("span");
      label.append(svgIcon(PIN_ICON, 15));
      const trash = document.createElement("button");
      trash.type = "button";
      trash.className = "faw-pinbar__trash";
      trash.append(svgIcon(TRASH_ICON, 15));
      trash.addEventListener("click", () => pinBar.classList.toggle("is-deleting"));
      head.append(label, trash);
      const list = document.createElement("div");
      list.className = "faw-pinbar__list";
      // in delete mode a click removes the entry instead of opening the profile
      list.addEventListener("click", (e) => {
        const a = e.target.closest(".faw-pin");
        if (!a || !pinBar.classList.contains("is-deleting")) return;
        e.preventDefault();
        chrome.storage.sync.set({ pinned: current.pinned.filter((q) => q.u !== a.dataset.u) });
      });
      pinBar.append(head, list);
      (document.body || root).appendChild(pinBar);
      if (!document.body) document.addEventListener("DOMContentLoaded", () => document.body.appendChild(pinBar), { once: true });
    }
    pinBar.hidden = false;
    pinBar.querySelector(".faw-pinbar__head span").title = tr("pinnedArtists", "Pinned artists");
    pinBar.querySelector(".faw-pinbar__trash").title = tr("pinDelete", "Remove artists");
    const here = (location.pathname.match(/^\/(?:user|gallery|scraps|favorites|journals|commissions|stats)\/([^/]+)/i) || [])[1];
    const list = pinBar.querySelector(".faw-pinbar__list");
    list.replaceChildren();
    for (const p of pins) {
      const a = document.createElement("a");
      a.className = "faw-pin" + (here && decodeURIComponent(here).toLowerCase() === p.u ? " is-current" : "");
      a.href = "/user/" + encodeURIComponent(p.u) + "/";
      a.title = p.n || p.u;
      a.dataset.u = p.u;
      const img = document.createElement("img");
      img.alt = "";
      img.src = p.a || "https://a.furaffinity.net/" + encodeURIComponent(p.u) + ".gif";
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
  chrome.storage.sync.get(DEFAULTS, apply);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") chrome.storage.sync.get(DEFAULTS, apply);
  });
  if (!domReady) {
    document.addEventListener("DOMContentLoaded", () => { domReady = true; run(); }, { once: true });
  }
})();
