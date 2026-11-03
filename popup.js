// Settings popup. Values live in chrome.storage.sync (defaults: settings.js); pages pick them up on
// their next load. Texts come from i18n.js via data-i18n / data-i18n-title attributes.
const $ = (id) => document.getElementById(id);
const RANGES = ["max", "gutter", "thumb"];
const CHECKS = ["ultrawide", "design", "imageFit", "quickView", "comic", "comicHorizontal", "infinite", "bbExtra", "archiveLink"];

$("version").textContent = "v" + chrome.runtime.getManifest().version;

// "max" slider: the top position means "no cap" (stored as 0)
function fmt(id, v) {
  if (id === "max" && v === 0) return T("noCap");
  return id === "thumb" ? Number(v).toFixed(2) + "×" : v + " px";
}
function readSlider(id) {
  const el = $(id), v = Number(el.value);
  return id === "max" && v >= Number(el.max) ? 0 : v;
}

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
  for (const id of RANGES) $(id).value = id === "max" && s[id] === 0 ? $(id).max : s[id];
  for (const id of CHECKS) $(id).checked = !!s[id];
  applyLang(s.lang);
  syncDependents();
}

// Sub-options are dimmed while their parent switch is off
function syncDependents() {
  $("comicHorizontal").disabled = !$("comic").checked;
  document.querySelector('[data-group="ultrawide"] .sub').classList.toggle("off", !$("ultrawide").checked);
}

// Debounced: storage.sync limits writes per minute, sliders fire many input events
let pending = {}, timer = null;
function save(patch) {
  Object.assign(pending, patch);
  clearTimeout(timer);
  timer = setTimeout(() => { chrome.storage.sync.set(pending); pending = {}; }, 120);
}

chrome.storage.sync.get(FAW_DEFAULTS, render);

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
  chrome.storage.sync.clear(() => chrome.storage.sync.set(FAW_DEFAULTS, () => render(FAW_DEFAULTS)));
});
