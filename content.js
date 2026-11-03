// Runs at document_start: sets the switch classes (faw-layout / faw-design) and size variables on
// <html> before FA paints. Once the DOM is ready it also does the structural changes that must not
// flash: splitting the submission sidebar, tagging profile sections, arrow buttons, theme detection.
(() => {
  const DEFAULTS = {
    enabled: true, ultrawide: true, design: true,
    max: 2800, gutter: 24, thumb: 1.25
  };
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
      root.style.setProperty("--faw-gutter", s.gutter + "px");
      root.style.setProperty("--faw-thumb", String(s.thumb));
    } else {
      for (const v of VARS) root.style.removeProperty(v);
    }
    loaded = true;
    run();
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
