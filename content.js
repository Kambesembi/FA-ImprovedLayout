// Applies layout settings as CSS variables/classes on <html>. Runs at document_start.
(() => {
  const DEFAULTS = {
    enabled: true, max: 2800, gutter: 24, thumb: 1.25, layout: "comments-right"
  };
  const root = document.documentElement;

  function apply(s) {
    s = Object.assign({}, DEFAULTS, s);
    root.classList.toggle("faw-off", !s.enabled);
    root.classList.toggle("faw-sub-classic", s.layout === "classic");
    root.style.setProperty("--faw-max", s.max > 0 ? s.max + "px" : "100vw");
    root.style.setProperty("--faw-gutter", s.gutter + "px");
    root.style.setProperty("--faw-thumb", String(s.thumb));
    // clean up variables from older versions
    for (const v of ["--faw-read", "--faw-sidebar", "--faw-comments"]) root.style.removeProperty(v);
  }

  chrome.storage.sync.get(DEFAULTS, apply);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") chrome.storage.sync.get(DEFAULTS, apply);
  });
})();
