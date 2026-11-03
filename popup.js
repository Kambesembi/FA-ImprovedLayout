const $ = (id) => document.getElementById(id);
const RANGES = ["max", "gutter", "thumb"];
const CHECKS = ["ultrawide", "design", "imageFit", "quickView", "comic", "comicHorizontal", "infinite", "archiveLink"];
const UNCAPPED_AT_MAX = { max: true }; // top slider position = no cap (stored as 0)

$("version").textContent = "v" + chrome.runtime.getManifest().version;

function fmt(id, v) {
  if (UNCAPPED_AT_MAX[id] && v === 0) return "no cap";
  return id === "thumb" ? Number(v).toFixed(2) + "×" : v + " px";
}

function render(s) {
  $("enabled").checked = s.enabled;
  $("opts").disabled = !s.enabled;
  for (const id of RANGES) {
    const el = $(id);
    el.value = UNCAPPED_AT_MAX[id] && s[id] === 0 ? el.max : s[id];
    $(id + "-v").textContent = fmt(id, s[id]);
  }
  for (const id of CHECKS) $(id).checked = !!s[id];
  for (const seg of document.querySelectorAll(".seg")) {
    for (const b of seg.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.val === s[seg.dataset.key]));
  }
  syncDependents(s);
}

function syncDependents(s) {
  $("comicHorizontal").disabled = !s.comic;
  document.querySelector('[data-group="ultrawide"] .sub').classList.toggle("off", !s.ultrawide);
}

function readSlider(id) {
  const el = $(id);
  const v = Number(el.value);
  return UNCAPPED_AT_MAX[id] && v >= Number(el.max) ? 0 : v;
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
  $(id).addEventListener("change", (e) => {
    save({ [id]: e.target.checked });
    syncDependents({ comic: $("comic").checked, ultrawide: $("ultrawide").checked });
  });
}
for (const seg of document.querySelectorAll(".seg")) {
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    for (const x of seg.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
    save({ [seg.dataset.key]: b.dataset.val });
  });
}
$("enabled").addEventListener("change", (e) => {
  $("opts").disabled = !e.target.checked;
  save({ enabled: e.target.checked });
});
$("reset").addEventListener("click", () => {
  chrome.storage.sync.clear(() => chrome.storage.sync.set(FAW_DEFAULTS, () => render(FAW_DEFAULTS)));
});
