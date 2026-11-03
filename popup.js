const $ = (id) => document.getElementById(id);
const RANGES = ["max", "gutter", "thumb"];
const CHECKS = ["imageFit", "quickView", "comic", "comicHorizontal", "infinite"];
const SELECTS = ["layout"];
const UNCAPPED_AT_MAX = { max: true }; // top slider position = no cap (stored as 0)

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
  for (const id of SELECTS) $(id).value = s[id];
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
for (const id of CHECKS) $(id).addEventListener("change", (e) => save({ [id]: e.target.checked }));
for (const id of SELECTS) $(id).addEventListener("change", (e) => save({ [id]: e.target.value }));
$("enabled").addEventListener("change", (e) => {
  $("opts").disabled = !e.target.checked;
  save({ enabled: e.target.checked });
});
$("reset").addEventListener("click", () => {
  chrome.storage.sync.clear(() => chrome.storage.sync.set(FAW_DEFAULTS, () => render(FAW_DEFAULTS)));
});
