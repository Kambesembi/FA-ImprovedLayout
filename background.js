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
