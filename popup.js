// Settings popup. Values live in chrome.storage.sync (defaults: settings.js); pages pick them up on
// their next load. Texts come from i18n.js via data-i18n / data-i18n-title attributes.
const $ = (id) => document.getElementById(id);
const RANGES = ["gutter", "thumb"];
const CHECKS = ["ultrawide", "design", "imageFit", "quickView", "comic", "comicHorizontal", "infinite", "bbExtra", "topbar", "pins", "pinSubs", "walls", "uploader", "archiveLink"];
const PINBAR = 100;   // same as content.js: minimum gutter while a pin sidebar is shown
let pinCounts = { artists: 0, subs: 0 };

$("version").textContent = "v" + chrome.runtime.getManifest().version;
// the version opens the update page too (check by hand, release notes)
const openUpdate = (e) => { if (e) e.preventDefault(); flush(); chrome.tabs.create({ url: chrome.runtime.getURL("update.html") }); window.close(); };
$("version").addEventListener("click", openUpdate);

function fmt(id, v) { return id === "thumb" ? Number(v).toFixed(2) + "×" : v + " px"; }
function readSlider(id) { return Number($(id).value); }

function applyLang(pref) {
  fawSetLang(pref);
  document.documentElement.lang = FAW_LANG;
  for (const n of document.querySelectorAll("[data-i18n]")) n.textContent = T(n.dataset.i18n);
  for (const n of document.querySelectorAll("[data-i18n-title]")) n.title = T(n.dataset.i18nTitle);
  for (const b of document.querySelectorAll("#langs button")) b.setAttribute("aria-pressed", String(b.dataset.lang === FAW_LANG));
  for (const id of RANGES) $(id + "-v").textContent = fmt(id, readSlider(id));
}

function render(s) {
  $("enabled").checked = s.enabled;
  $("opts").disabled = !s.enabled;
  for (const id of RANGES) $(id).value = s[id];
  for (const id of CHECKS) $(id).checked = !!s[id];
  applyLang(s.lang);
  syncDependents();
}

// Sub-options are dimmed while their parent switch is off
function syncDependents() {
  $("comicHorizontal").disabled = !$("comic").checked;
  // while a pin sidebar is shown the gutter can't go below its width – the slider starts there
  const bar = ($("pins").checked && pinCounts.artists) || ($("pinSubs").checked && pinCounts.subs);
  $("gutter").min = bar ? PINBAR : 0;
  $("gutter-v").textContent = fmt("gutter", readSlider("gutter"));
  document.querySelector('[data-group="ultrawide"] .sub').classList.toggle("off", !$("ultrawide").checked);
}

// Debounced: storage.sync limits writes per minute, sliders fire many input events
let pending = {}, timer = null;
function save(patch) {
  Object.assign(pending, patch);
  clearTimeout(timer);
  timer = setTimeout(flush, 120);
}
// also when the popup closes inside that delay, so the last click isn't lost
function flush() {
  clearTimeout(timer); timer = null;
  if (!Object.keys(pending).length) return;
  chrome.storage.sync.set(pending);
  pending = {};
}
window.addEventListener("pagehide", flush);

chrome.storage.local.get({ pinnedSubs: [] }, (l) => {
  pinCounts.subs = (l.pinnedSubs || []).length;
  chrome.storage.sync.get(FAW_DEFAULTS, (s) => { pinCounts.artists = (s.pinned || []).length; render(s); });
});

for (const id of RANGES) {
  $(id).addEventListener("input", () => {
    const v = readSlider(id);
    $(id + "-v").textContent = fmt(id, v);
    save({ [id]: v });
  });
}
for (const id of CHECKS) {
  $(id).addEventListener("change", (e) => { save({ [id]: e.target.checked }); syncDependents(); });
}
$("enabled").addEventListener("change", (e) => {
  $("opts").disabled = !e.target.checked;
  save({ enabled: e.target.checked });
});
// Language: "auto" (browser language) until a flag is picked
$("langs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-lang]");
  if (!b) return;
  save({ lang: b.dataset.lang });
  applyLang(b.dataset.lang);
});
$("reset").addEventListener("click", () => {
  clearTimeout(timer); pending = {};
  // keeps the pinned artists: Reset only restores the settings
  // (one write over the current values – no clear() first, which would lose the pins if the popup closed in between)
  chrome.storage.sync.get({ pinned: [] }, ({ pinned }) => {
    const fresh = Object.assign({}, FAW_DEFAULTS, { pinned });
    chrome.storage.sync.set(fresh, () => render(fresh));
  });
});

// Update check: latest GitHub release, cached for 6 hours (only the popup asks, never the FA pages)
const REPO = "Kambesembi/FA-ImprovedLayout";
const newer = (a, b) => {               // "2.4.0" > "2.3.2"?
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
chrome.storage.local.get({ updCheck: null }, async ({ updCheck }) => {
  let latest = updCheck && Date.now() - updCheck.t < 6 * 3600e3 ? updCheck : null;
  if (!latest) {
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
      if (r.ok) {
        const j = await r.json();
        latest = { t: Date.now(), tag: String(j.tag_name || "").replace(/^v/, ""), url: j.html_url };
        chrome.storage.local.set({ updCheck: latest });
      }
    } catch (e) { /* offline: no hint */ }
  }
  if (latest && latest.tag && newer(latest.tag, chrome.runtime.getManifest().version)) {
    const a = $("update");
    a.textContent = T("updateAvail", latest.tag);
    a.hidden = false;
    a.addEventListener("click", openUpdate);
  }
});
