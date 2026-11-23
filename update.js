// Update page (opened from the popup): the installed version, the newest GitHub release with its notes,
// and a link to download it. Updating is done by hand (the extension doesn't write its own files); a signed
// Firefox install still updates itself through Firefox's own update_url.
const $ = (id) => document.getElementById(id);
const REPO = "Kambesembi/FA-ImprovedLayout";
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
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    rel = { version: String(j.tag_name || "").replace(/^v/, ""), url: j.html_url, notes: j.body || "", assets: j.assets || [] };
  } catch (e) {
    status(T("updOffline", e.message), "bad");
    return;
  }
  $("latest").textContent = T("updLatest", rel.version);
  if (rel.notes.trim()) { $("notes").textContent = rel.notes; $("notesCard").hidden = false; }
  chrome.storage.local.set({ updCheck: { t: Date.now(), tag: rel.version, url: rel.url } });
  const link = $("manual");
  link.href = rel.url;
  link.hidden = false;
  if (!newer(rel.version, VERSION)) { status(T("updUpToDate"), "ok"); return; }
  status(T("updAvail", rel.version));
  // the package for this browser, straight from the release
  const pkg = rel.assets.find((a) => (isFirefox ? /firefox\.xpi$/i : /chrome\.zip$/i).test(a.name));
  if (pkg) {
    const dl = $("download");
    dl.href = pkg.browser_download_url;
    dl.textContent = T("updDownload", pkg.name);
    dl.hidden = false;
  }
  $("howto").textContent = T(isFirefox ? "updHowFF" : "updHowChrome");
  $("howto").hidden = false;
}
main();
