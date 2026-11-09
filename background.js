// Downloads for the quick view (files live on d.furaffinity.net, so <a download> won't work)
// and opening the reference walls page from FA pages (content scripts can't open extension pages)
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === "faw-open-walls") {
    const id = typeof msg.wall === "string" ? msg.wall.replace(/[^a-z0-9]/gi, "") : "";
    chrome.tabs.create({ url: chrome.runtime.getURL("walls.html") + (id ? "?wall=" + id : "") });
    return;
  }
  if (!msg || msg.type !== "faw-download") return;
  let url;
  try {
    url = new URL(msg.url);
  } catch (e) {
    reply({ ok: false });
    return;
  }
  if (!/(^|\.)furaffinity\.net$|(^|\.)facdn\.net$/.test(url.hostname)) {
    reply({ ok: false });
    return;
  }
  chrome.downloads.download({ url: url.href }, (id) => reply({ ok: !chrome.runtime.lastError && id != null }));
  return true; // async reply
});

// ---- updates
// Firefox (signed .xpi): an update it found is installed right away instead of at the next browser start
if (chrome.runtime.onUpdateAvailable) chrome.runtime.onUpdateAvailable.addListener(() => chrome.runtime.reload());

// "↑" on the toolbar icon while a newer GitHub release exists. Checked when the browser starts (at most every
// 6 hours, shared with the popup's check); the popup leads to the update page.
const REPO = "Kambesembi/FA-ImprovedLayout";
const newer = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
function badge(latest) {
  const on = !!(latest && latest.tag && newer(latest.tag, chrome.runtime.getManifest().version));
  chrome.action.setBadgeText({ text: on ? "↑" : "" });
  if (on) chrome.action.setBadgeBackgroundColor({ color: "#e0a64b" });
}
function checkUpdate() {
  chrome.storage.local.get({ updCheck: null }, async ({ updCheck }) => {
    if (updCheck && Date.now() - updCheck.t < 6 * 3600e3) { badge(updCheck); return; }
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
      if (!r.ok) return;
      const j = await r.json();
      const latest = { t: Date.now(), tag: String(j.tag_name || "").replace(/^v/, ""), url: j.html_url };
      chrome.storage.local.set({ updCheck: latest });
      badge(latest);
    } catch (e) { /* offline: next time */ }
  });
}
chrome.runtime.onStartup.addListener(checkUpdate);
chrome.runtime.onInstalled.addListener(checkUpdate);
// the popup and the update page store fresh results → the badge follows
chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c.updCheck) badge(c.updCheck.newValue); });
