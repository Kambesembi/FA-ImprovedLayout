// Reference walls (PureRef-style boards). Data in chrome.storage.local:
//   walls: [{ id, name, pinned, view: { x, y, z }, items: [{ id, sid, src, x, y, w, h }] }]
//   activeWall: id of the wall that "Add to wall" on FA pages adds to (= the selected tab here)
// Drag the background to pan, wheel to zoom at the cursor, drag images to move, the side/corner handles to
// resize, Delete to remove, double-click to open the submission on FA.
const MAX_WALLS = 12;
const $ = (id) => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";
function icon(paths, size = 16) {
  const s = document.createElementNS(SVG, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor",
    "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" })) s.setAttribute(k, v);
  for (const d of paths) { const p = document.createElementNS(SVG, "path"); p.setAttribute("d", d); s.appendChild(p); }
  return s;
}
const PIN = ["M12 17v5", "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"];
const TRASH = ["M3 6h18", "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"];
const uid = () => Math.random().toString(36).slice(2, 10);

let walls = [], activeId = null, selected = null;
const wall = () => walls.find((w) => w.id === activeId) || walls[0];

// ---------------------------------------------------------------- storage
let saveTimer = null, lastSaved = "";
function save(now) {
  clearTimeout(saveTimer);
  const run = () => {
    lastSaved = JSON.stringify(walls);
    chrome.storage.local.set({ walls, activeWall: activeId });
  };
  if (now) run(); else saveTimer = setTimeout(run, 250);
}
function load(cb) {
  chrome.storage.local.get({ walls: [], activeWall: null }, (l) => {
    walls = Array.isArray(l.walls) ? l.walls : [];
    if (!walls.length) walls.push(newWall(1));
    const want = new URLSearchParams(location.search).get("wall");
    activeId = walls.some((w) => w.id === want) ? want : walls.some((w) => w.id === l.activeWall) ? l.activeWall : walls[0].id;
    cb();
  });
}
const DIRS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];   // resize handles around a selected image
function newWall(n) { return { id: uid(), name: T("wallName", n), pinned: false, view: { x: 40, y: 40, z: 0.5 }, items: [] }; }
// another tab (FA page) added something → redraw, unless it's our own write coming back
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== "local" || !c.walls) return;
  const json = JSON.stringify(c.walls.newValue || []);
  if (json === lastSaved) return;
  walls = c.walls.newValue || [];
  if (!walls.some((w) => w.id === activeId) && walls[0]) activeId = walls[0].id;
  renderTabs(); renderBoard();
});

// ---------------------------------------------------------------- tabs / toolbar
function renderTabs() {
  const tabs = $("tabs");
  tabs.replaceChildren();
  for (const w of walls) {
    const b = document.createElement("button");
    b.className = "tab" + (w.id === activeId ? " is-active" : "");
    b.textContent = w.name;
    b.title = T("wallRenameHint");
    if (w.pinned) { const p = document.createElement("span"); p.className = "pinned"; p.textContent = "•"; b.append(p); }
    b.addEventListener("click", () => { if (activeId !== w.id) { activeId = w.id; selected = null; save(true); renderTabs(); renderBoard(); } });
    b.addEventListener("dblclick", () => rename(b, w));
    tabs.appendChild(b);
  }
  $("add").disabled = walls.length >= MAX_WALLS;
  $("del").disabled = walls.length <= 1 && !wall().items.length;
  $("pin").classList.toggle("is-on", !!wall().pinned);
  $("pin").title = T(wall().pinned ? "wallUnpin" : "wallPin");
  document.title = wall().name + " – FA-ImprovedLayout";
}
function rename(tabEl, w) {
  const input = document.createElement("input");
  input.value = w.name;
  input.maxLength = 40;
  tabEl.replaceChildren(input);
  input.focus(); input.select();
  const done = (ok) => { if (ok && input.value.trim()) w.name = input.value.trim(); save(true); renderTabs(); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(true); else if (e.key === "Escape") done(false); e.stopPropagation(); });
  input.addEventListener("blur", () => done(true));
}
$("add").addEventListener("click", () => {
  if (walls.length >= MAX_WALLS) return;
  const w = newWall(walls.length + 1);
  walls.push(w); activeId = w.id; selected = null;
  save(true); renderTabs(); renderBoard();
});
$("del").addEventListener("click", () => {
  if (!confirm(T("wallDeleteConfirm", wall().name))) return;
  walls = walls.filter((w) => w.id !== activeId);
  if (!walls.length) walls.push(newWall(1));
  activeId = walls[0].id; selected = null;
  save(true); renderTabs(); renderBoard();
});
$("pin").addEventListener("click", () => { wall().pinned = !wall().pinned; save(true); renderTabs(); });
$("fit").addEventListener("click", fit);
$("export").addEventListener("click", exportPng);

// ---------------------------------------------------------------- board
const board = $("board"), layer = $("layer");
function applyView() {
  const v = wall().view;
  layer.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
  layer.style.setProperty("--z", v.z);   // keeps the resize handles the same size on screen
  board.style.backgroundPosition = `${v.x}px ${v.y}px`;
  board.style.backgroundSize = `${24 * v.z}px ${24 * v.z}px`;
}
function renderBoard() {
  layer.replaceChildren();
  for (const it of wall().items) {
    const d = document.createElement("div");
    d.className = "item" + (it.id === selected ? " is-selected" : "");
    d.dataset.id = it.id;
    Object.assign(d.style, { left: it.x + "px", top: it.y + "px", width: it.w + "px", height: it.h + "px" });
    const img = document.createElement("img");
    img.src = it.src;
    img.alt = "";
    // the stored size was a guess until the image is known → fix the height to the real aspect
    img.addEventListener("load", () => {
      if (!it.fixed && img.naturalWidth) {
        it.h = Math.round(it.w * img.naturalHeight / img.naturalWidth);
        it.fixed = true;
        d.style.height = it.h + "px";
        save();
      }
    }, { once: true });
    d.append(img);
    for (const dir of DIRS) {
      const h = document.createElement("div");
      h.className = "handle h-" + dir;
      h.dataset.dir = dir;
      d.append(h);
    }
    layer.appendChild(d);
  }
  $("empty").hidden = wall().items.length > 0;
  applyView();
  renderTabs();
}
const itemOf = (el) => { const d = el.closest(".item"); return d && wall().items.find((i) => i.id === d.dataset.id); };
function select(id) {
  selected = id;
  for (const d of layer.children) d.classList.toggle("is-selected", d.dataset.id === id);
}

// pan / move / resize with one pointer handler
let drag = null;
board.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 && e.button !== 1) return;
  const it = e.button === 0 && itemOf(e.target);
  const v = wall().view;
  if (it) {
    // bring to front
    const items = wall().items;
    items.push(items.splice(items.indexOf(it), 1)[0]);
    const el = layer.querySelector(`[data-id="${it.id}"]`);
    layer.appendChild(el);
    select(it.id);
    const dir = e.target.dataset.dir;
    drag = { mode: dir ? "resize" : "move", dir, it, el, sx: e.clientX, sy: e.clientY, ox: it.x, oy: it.y, ow: it.w, oh: it.h };
  } else {
    select(null);
    drag = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: v.x, oy: v.y };
    board.classList.add("is-panning");
  }
});
window.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const z = wall().view.z, dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (drag.mode === "pan") {
    wall().view.x = drag.ox + dx; wall().view.y = drag.oy + dy; applyView();
  } else if (drag.mode === "move") {
    drag.it.x = Math.round(drag.ox + dx / z); drag.it.y = Math.round(drag.oy + dy / z);
    drag.el.style.left = drag.it.x + "px"; drag.el.style.top = drag.it.y + "px";
  } else {
    // any side or corner, aspect ratio kept; the opposite side stays put (edges scale from the middle)
    const { dir, ow, oh, ox, oy } = drag;
    const fx = dir.includes("e") ? (ow + dx / z) / ow : dir.includes("w") ? (ow - dx / z) / ow : 0;
    const fy = dir.includes("s") ? (oh + dy / z) / oh : dir.includes("n") ? (oh - dy / z) / oh : 0;
    const f = Math.max(40 / ow, 40 / oh, dir.length === 2 ? Math.max(fx, fy) : fx || fy);
    const w = Math.round(ow * f), h = Math.round(oh * f);
    const x = dir.includes("w") ? ox + ow - w : dir.includes("e") ? ox : ox + (ow - w) / 2;
    const y = dir.includes("n") ? oy + oh - h : dir.includes("s") ? oy : oy + (oh - h) / 2;
    Object.assign(drag.it, { w, h, x: Math.round(x), y: Math.round(y) });
    Object.assign(drag.el.style, { width: w + "px", height: h + "px", left: drag.it.x + "px", top: drag.it.y + "px" });
  }
});
const endDrag = () => { if (!drag) return; drag = null; board.classList.remove("is-panning"); save(); };
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);
board.addEventListener("wheel", (e) => {
  e.preventDefault();
  const v = wall().view, r = board.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const z = Math.min(8, Math.max(0.03, v.z * Math.exp(-e.deltaY * 0.0015)));
  v.x = mx - (mx - v.x) * (z / v.z); v.y = my - (my - v.y) * (z / v.z); v.z = z;
  applyView(); save();
}, { passive: false });
board.addEventListener("dblclick", (e) => {
  const it = itemOf(e.target);
  if (it && it.sid) window.open("https://www.furaffinity.net/view/" + it.sid + "/", "_blank", "noopener");
});
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input")) return;
  if ((e.key === "Delete" || e.key === "Backspace") && selected) {
    wall().items = wall().items.filter((i) => i.id !== selected);
    selected = null; save(); renderBoard();
  } else if (e.key === "f" || e.key === "F") fit();
});

function bounds(items) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const i of items) { x1 = Math.min(x1, i.x); y1 = Math.min(y1, i.y); x2 = Math.max(x2, i.x + i.w); y2 = Math.max(y2, i.y + i.h); }
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
}
function fit() {
  const items = wall().items;
  if (!items.length) return;
  const b = bounds(items), r = board.getBoundingClientRect(), pad = 40;
  const z = Math.min(4, (r.width - 2 * pad) / b.w, (r.height - 2 * pad) / b.h);
  Object.assign(wall().view, { z, x: (r.width - b.w * z) / 2 - b.x1 * z, y: (r.height - b.h * z) / 2 - b.y1 * z });
  applyView(); save();
}

// ---------------------------------------------------------------- export as PNG (board units = pixels)
async function exportPng() {
  const items = wall().items;
  if (!items.length) return;
  const note = document.createElement("div");
  note.className = "busy";
  note.textContent = T("wallExporting");
  document.body.appendChild(note);
  try {
    const b = bounds(items), pad = 40;
    const scale = Math.min(1, 12000 / Math.max(b.w + 2 * pad, b.h + 2 * pad));   // browsers cap canvas size
    const c = document.createElement("canvas");
    c.width = Math.ceil((b.w + 2 * pad) * scale); c.height = Math.ceil((b.h + 2 * pad) * scale);
    const g = c.getContext("2d");
    g.fillStyle = "#1b1c20"; g.fillRect(0, 0, c.width, c.height);
    for (const it of items) {                 // in stacking order
      try {
        const blob = await (await fetch(it.src)).blob();
        const bmp = await createImageBitmap(blob);
        g.drawImage(bmp, (it.x - b.x1 + pad) * scale, (it.y - b.y1 + pad) * scale, it.w * scale, it.h * scale);
      } catch (err) { /* an image that can't be fetched is left out */ }
    }
    const png = await new Promise((r) => c.toBlob(r, "image/png"));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(png);
    a.download = wall().name.replace(/[\\/:*?"<>|]+/g, "_") + ".png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } finally { note.remove(); }
}

// ---------------------------------------------------------------- start
chrome.storage.sync.get({ lang: "auto" }, ({ lang }) => {
  fawSetLang(lang);
  for (const n of document.querySelectorAll("[data-i18n]")) n.textContent = T(n.dataset.i18n);
  for (const n of document.querySelectorAll("[data-i18n-title]")) n.title = T(n.dataset.i18nTitle);
  $("pin").append(icon(PIN));
  $("del").append(icon(TRASH));
  load(() => { save(true); renderBoard(); });
});
