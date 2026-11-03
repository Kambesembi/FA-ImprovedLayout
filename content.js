// Applies layout settings as CSS variables/classes on <html>. Runs at document_start.
// On submission pages it also splits FA's sidebar as soon as the DOM is ready:
// stats + Fav/Note/Download stay in the aside above the comments, while the details table,
// keywords and folders move into a panel below the description.
(() => {
  const DEFAULTS = {
    enabled: true, ultrawide: true, design: true,
    max: 2800, gutter: 24, thumb: 1.25, layout: "comments-right"
  };
  const root = document.documentElement;
  let current = DEFAULTS;
  let loaded = false;            // settings read from storage
  let domReady = document.readyState !== "loading";
  // DOM work waits for both the settings and the parsed page, so a disabled extension never touches it
  function run() {
    if (!loaded || !domReady) return;
    arrowButtons();
    splitSubmissionPanel();
    tagProfile();
  }
  const VARS = ["--faw-max", "--faw-gutter", "--faw-thumb", "--faw-read", "--faw-sidebar", "--faw-comments"];
  const layoutOn = () => current.enabled && current.ultrawide;
  const designOn = () => current.enabled && current.design;

  // Master switch off → no classes, no variables, no DOM changes: FA as if the extension weren't there.
  function apply(s) {
    s = Object.assign({}, DEFAULTS, s);
    current = s;
    root.classList.toggle("faw-layout", layoutOn());
    root.classList.toggle("faw-design", designOn());
    root.classList.toggle("faw-cmt-bubbles", designOn());
    root.classList.toggle("faw-sub-classic", layoutOn() && s.layout === "classic");
    root.classList.remove("faw-off");
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

  // ---- submission page: move details/keywords/folders below the description (reversible)
  const moved = [];
  function splitSubmissionPanel() {
    if (!document.body || document.body.id !== "pageid-submission") return;
    const want = layoutOn() && current.layout !== "classic";
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
    const bg = getComputedStyle(side).backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)") panel.style.setProperty("--faw-panel-bg", bg);
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
  chrome.storage.sync.get(DEFAULTS, apply);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") chrome.storage.sync.get(DEFAULTS, apply);
  });
  if (!domReady) {
    document.addEventListener("DOMContentLoaded", () => { domReady = true; run(); }, { once: true });
  }
})();
