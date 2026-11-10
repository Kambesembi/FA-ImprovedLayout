// Update page (opened from the popup). Browsers don't let an extension replace its own files, so:
// - Chromium, unpacked ("Load unpacked"): the user picks the extension folder once (File System Access API,
//   the handle is kept in IndexedDB); the files of the newest release tag are read from GitHub, each checked
//   against its git hash, written over the old ones (manifest.json last, everything put back on a failure),
//   files the new release dropped are removed, then the extension reloads itself.
// - Firefox with the signed .xpi: Firefox updates add-ons itself (update_url in manifest.firefox.json →
//   updates.json in the newest release); the button only asks it to check now. background.js applies a found
//   update right away.
// - Anything else: a link to the release.
const $ = (id) => document.getElementById(id);
const REPO = "Kambesembi/FA-ImprovedLayout";
const API = "https://api.github.com/repos/" + REPO;
// What belongs to the extension: files of these kinds, minus the Firefox manifest. Everything else in the
// repository (README, build script, notes, licence, dot files) stays out of the extension folder.
const SKIP = new Set(["manifest.firefox.json"]);
const KINDS = /\.(js|css|html|json|png|svg|gif|jpe?g|webp|woff2?)$/i;
const isExtFile = (x) => x.type === "blob" && KINDS.test(x.path) && !SKIP.has(x.path) && !x.path.split("/").some((p) => p.startsWith("."));
async function treeOf(tag) {
  const r = await fetch(`${API}/git/trees/${encodeURIComponent(tag)}?recursive=1`, { headers: { Accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error("GitHub: HTTP " + r.status + (r.status === 403 || r.status === 429 ? " (rate limit – try again later)" : ""));
  const tree = await r.json();
  if (!tree || !Array.isArray(tree.tree) || tree.truncated) throw new Error("file list");
  return tree.tree.filter(isExtFile);
}
const VERSION = chrome.runtime.getManifest().version;
const isFirefox = typeof browser !== "undefined" && !!chrome.runtime.getBrowserInfo;

const newer = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
function status(text, kind) {
  $("status").textContent = text;
  $("status").className = kind || "";
}

// ---- the folder handle, kept between visits
const db = () => new Promise((res, rej) => {
  const r = indexedDB.open("faw-update", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("kv");
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function kv(key, value) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction("kv", value === undefined ? "readonly" : "readwrite");
    const s = t.objectStore("kv");
    const r = value === undefined ? s.get(key) : s.put(value, key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

// git's blob hash: sha1("blob <size>\0" + content), as listed in the tag's tree
async function gitSha(buf) {
  const head = new TextEncoder().encode("blob " + buf.byteLength + "\0");
  const all = new Uint8Array(head.length + buf.byteLength);
  all.set(head); all.set(new Uint8Array(buf), head.length);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", all));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readManifest(dir) {
  try {
    const f = await (await dir.getFileHandle("manifest.json")).getFile();
    return JSON.parse(await f.text());
  } catch (e) { return null; }
}
async function dirFor(root, path, create) {
  let d = root;
  const parts = path.split("/");
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create });
  return { d, name: parts[parts.length - 1] };
}
async function readFile(root, path) {
  try { const { d, name } = await dirFor(root, path, false); return await (await (await d.getFileHandle(name)).getFile()).arrayBuffer(); }
  catch (e) { return null; }
}
async function writeFile(root, path, buf) {
  const { d, name } = await dirFor(root, path, true);
  const w = await (await d.getFileHandle(name, { create: true })).createWritable();
  await w.write(buf);
  await w.close();
}
async function removeFile(root, path) {
  try { const { d, name } = await dirFor(root, path, false); await d.removeEntry(name); } catch (e) { /* gone already */ }
}

// The chosen folder must be the one Chrome runs: its manifest says FA-ImprovedLayout and the running version
async function checkFolder(dir) {
  const m = await readManifest(dir);
  if (!m || m.name !== "FA-ImprovedLayout") throw new Error(T("updNoManifest"));
  if (m.version !== VERSION) throw new Error(T("updWrongFolder", m.version, VERSION));
  // a developer's checkout: writing the release over it would discard local changes
  const git = await dir.getDirectoryHandle(".git").catch(() => null);
  if (git) throw new Error(T("updGitFolder"));
}
async function folder(pick) {
  let dir = pick ? null : await kv("dir").catch(() => null);
  if (!dir) {
    dir = await window.showDirectoryPicker({ id: "faw-extension", mode: "readwrite" });
    await checkFolder(dir);
    await kv("dir", dir).catch(() => {});
  } else {
    const opts = { mode: "readwrite" };
    if ((await dir.queryPermission(opts)) !== "granted" && (await dir.requestPermission(opts)) !== "granted") throw new Error(T("updDenied"));
    await checkFolder(dir);
  }
  return dir;
}

async function updateFolder(rel, pick) {
  const dir = await folder(pick);
  $("folder").textContent = T("updFolderLabel", dir.name);
  $("folder").hidden = false;
  // 1. everything downloaded and checked before a single file is touched
  const files = await treeOf(rel.tag);
  // files of the running version that the new one no longer has (removed at the end; without the old
  // tag's list nothing is removed)
  const old = await treeOf("v" + VERSION).catch(() => []);
  const gone = old.map((x) => x.path).filter((p) => !files.some((f) => f.path === p));
  if (!files.some((x) => x.path === "manifest.json")) throw new Error("manifest.json missing in the release");
  const bar = $("bar");
  bar.hidden = false; bar.max = files.length * 2; bar.value = 0;
  const got = new Map();
  for (const [i, f] of files.entries()) {
    status(T("updFetching", i + 1, files.length));
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${encodeURIComponent(rel.tag)}/${f.path.split("/").map(encodeURIComponent).join("/")}`, { cache: "no-store" });
    if (!r.ok) throw new Error(f.path + ": HTTP " + r.status);
    const buf = await r.arrayBuffer();
    if (await gitSha(buf) !== f.sha) throw new Error(f.path + ": checksum");
    got.set(f.path, buf);
    bar.value++;
  }
  const nm = JSON.parse(new TextDecoder().decode(got.get("manifest.json")));
  if (nm.name !== "FA-ImprovedLayout" || nm.version !== rel.version) throw new Error("manifest.json " + nm.version);
  // 2. write, manifest.json last; on a failure the old files go back
  status(T("updWriting"));
  const order = [...got.keys()].filter((p) => p !== "manifest.json").concat("manifest.json");
  const backup = [];
  try {
    for (const p of order) {
      backup.push([p, await readFile(dir, p)]);
      await writeFile(dir, p, got.get(p));
      bar.value++;
    }
  } catch (e) {
    for (const [p, old] of backup.reverse()) {
      try { if (old) await writeFile(dir, p, old); else await removeFile(dir, p); } catch (e2) { /* best effort */ }
    }
    throw e;
  }
  for (const p of gone) await removeFile(dir, p);
  await new Promise((r) => chrome.storage.local.set({ updCheck: null }, r));
  status(T("updDone", rel.version), "ok");
  setTimeout(() => chrome.runtime.reload(), 1800);
}

// Firefox: let it look for the update (update_url) and install it
function firefoxCheck(rel) {
  status(T("updCheckFF"));
  chrome.runtime.requestUpdateCheck((res) => {
    const st = res && (res.status || res);
    if (st === "update_available") status(T("updFFFound", rel.version), "ok");   // background.js reloads into it
    else { status(T("updFFNone"), "bad"); $("manual").hidden = false; }
  });
}

async function main() {
  const s = await new Promise((r) => chrome.storage.sync.get({ lang: "auto" }, r));
  fawSetLang(s.lang);
  document.documentElement.lang = FAW_LANG;
  for (const n of document.querySelectorAll("[data-i18n]")) n.textContent = T(n.dataset.i18n);
  document.title = T("updTitle");
  $("cur").textContent = T("updCurrent", VERSION);
  status(T("updLooking"));
  let rel;
  try {
    const r = await fetch(`${API}/releases/latest`, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    rel = { tag: j.tag_name, version: String(j.tag_name || "").replace(/^v/, ""), url: j.html_url, notes: j.body || "", assets: j.assets || [] };
  } catch (e) {
    status(T("updOffline", e.message), "bad");
    return;
  }
  $("latest").textContent = T("updLatest", rel.version);
  $("manual").href = rel.url;
  if (rel.notes.trim()) { $("notes").textContent = rel.notes; $("notesCard").hidden = false; }
  chrome.storage.local.set({ updCheck: { t: Date.now(), tag: rel.version, url: rel.url } });
  if (!newer(rel.version, VERSION)) { status(T("updUpToDate"), "ok"); return; }

  const self = await new Promise((r) => { try { chrome.management.getSelf((m) => r(m || {})); } catch (e) { r({}); } });
  // store installs get an update_url added to their manifest, unpacked ones don't
  if (!self.installType) self.installType = chrome.runtime.getManifest().update_url ? "normal" : "development";
  const go = $("go");
  go.textContent = T("updNow");
  status(T("updAvail", rel.version));
  let run;
  if (isFirefox) {
    if (self.installType === "development") {             // temporary add-on (about:debugging)
      $("howto").textContent = T("updHowFFDev"); $("howto").hidden = false; $("manual").hidden = false;
      return;
    }
    run = () => firefoxCheck(rel);
  } else if (self.installType === "development" && window.showDirectoryPicker) {
    $("howto").textContent = T("updPickHint"); $("howto").hidden = false;
    const known = await kv("dir").catch(() => null);
    if (known) { $("folder").textContent = T("updFolderLabel", known.name); $("folder").hidden = false; $("refolder").hidden = false; }
    run = (pick) => updateFolder(rel, pick);
  } else {
    $("howto").textContent = T("updHowOther"); $("howto").hidden = false; $("manual").hidden = false;
    return;
  }
  const start = async (pick) => {
    go.disabled = $("refolder").disabled = true;
    try { await run(pick); }
    catch (e) {
      if (e && e.name === "AbortError") status(T("updAvail", rel.version));   // folder dialog closed
      else { status(T("updFailed", e.message || String(e)), "bad"); $("manual").hidden = false; }
      $("bar").hidden = true;
      go.disabled = $("refolder").disabled = false;
    }
  };
  go.hidden = false;
  go.addEventListener("click", () => start(false));
  $("refolder").addEventListener("click", () => start(true));
}
main();
