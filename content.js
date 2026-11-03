// Applies layout settings as CSS variables/classes on <html>. Runs at document_start.
// On submission pages it also splits FA's sidebar as soon as the DOM is ready:
// stats + Fav/Note/Download stay in the aside above the comments, while the details table,
// keywords and folders move into a panel below the description.
(() => {
  const DEFAULTS = {
    enabled: true, max: 2800, gutter: 24, thumb: 1.25, layout: "comments-right"
  };
  const root = document.documentElement;
  let current = DEFAULTS;

  function apply(s) {
    s = Object.assign({}, DEFAULTS, s);
    current = s;
    root.classList.toggle("faw-off", !s.enabled);
    root.classList.toggle("faw-sub-classic", s.layout === "classic");
    root.style.setProperty("--faw-max", s.max > 0 ? s.max + "px" : "100vw");
    root.style.setProperty("--faw-gutter", s.gutter + "px");
    root.style.setProperty("--faw-thumb", String(s.thumb));
    // clean up variables from older versions
    for (const v of ["--faw-read", "--faw-sidebar", "--faw-comments"]) root.style.removeProperty(v);
    if (document.readyState !== "loading") splitSubmissionPanel();
  }

  // ---- submission page: move details/keywords/folders below the description (reversible)
  const moved = [];
  function splitSubmissionPanel() {
    if (!document.body || document.body.id !== "pageid-submission") return;
    const want = current.enabled && current.layout !== "classic";
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

  chrome.storage.sync.get(DEFAULTS, apply);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") chrome.storage.sync.get(DEFAULTS, apply);
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", splitSubmissionPanel, { once: true });
  }
})();
