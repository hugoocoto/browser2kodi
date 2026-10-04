// chrome2kodi: the "Send to Kodi" and "Queue on Kodi" context menu items, and
// the toolbar button, hand a URL to the native host, which runs send2kodi on it.

const HOST = "com.hugoocoto.chrome2kodi";
const ICON = "icons/icon-128.png";

const CONTEXTS = ["image", "video", "audio", "link", "page"];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "send", title: "Send to Kodi", contexts: CONTEXTS });
    chrome.contextMenus.create({ id: "queue", title: "Queue on Kodi", contexts: CONTEXTS });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  send(target(info), tab, info.menuItemId === "queue");
});

chrome.action.onClicked.addListener((tab) => {
  send(tab.url, tab);
});

// What to send for a right-click: the picture, video or song itself if it has
// an address Kodi can open, else the link, else the page.
function target(info) {
  const src = info.srcUrl;
  if (info.mediaType && src) {
    if (/^(https?|data):/i.test(src)) return src;
    // A blob: video only exists in this tab: it is a streaming player
    // (YouTube, Twitch, ...), whose page yt-dlp knows how to play instead.
    if (info.mediaType !== "image") return info.frameUrl || info.pageUrl;
    return null;
  }
  return info.linkUrl || info.pageUrl;
}

async function send(url, tab, queue = false) {
  const id = `send-${Date.now()}`;
  if (!url || !/^(https?|data):/i.test(url)) {
    notify(id, "Can't send this to Kodi", `Kodi can't open ${shorten(url || "this")}.`);
    return;
  }
  notify(id, queue ? "Queueing on Kodi…" : "Sending to Kodi…", shorten(url));
  badge(tab, "…");
  let reply;
  try {
    reply = await chrome.runtime.sendNativeMessage(HOST, { url, queue });
  } catch (e) {
    reply = {
      ok: false,
      message: `${e.message}\nRun install.sh from the chrome2kodi folder, then reload the extension.`,
    };
  }
  badge(tab, reply.ok ? "" : "!");
  const title = reply.ok ? (queue ? "Queued on Kodi" : "Playing on Kodi")
                         : (queue ? "Kodi didn't queue it" : "Kodi didn't play it");
  notify(id, title, reply.ok ? shorten(url) : reply.message);
}

function notify(id, title, message) {
  chrome.notifications.create(id, { type: "basic", iconUrl: ICON, title, message });
}

function badge(tab, text) {
  if (!tab?.id || tab.id < 0) return;
  chrome.action.setBadgeText({ tabId: tab.id, text }).catch(() => {}); // tab closed
}

function shorten(url) {
  if (url.startsWith("data:")) return url.slice(0, url.indexOf(",") + 1) + "…";
  return url.length > 120 ? url.slice(0, 117) + "…" : url;
}
