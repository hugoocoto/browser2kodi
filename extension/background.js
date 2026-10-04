// chrome2kodi: the "Send to Kodi" and "Queue on Kodi" context menu items, and
// the toolbar button, hand a URL to Kodi, through its JSON-RPC API.

import { DEFAULTS, Kodi, origin } from "./kodi.js";

const ICON = "icons/icon-128.png";

const CONTEXTS = ["image", "video", "audio", "link", "page"];
const ITEMS = { send: "Send to Kodi", queue: "Queue on Kodi" };

async function settings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}

// Chrome puts an extension's items in a submenu of their own when there are
// several; a single one goes in the right-click menu itself.
async function buildMenu() {
  const { menu } = await settings();
  await chrome.contextMenus.removeAll();
  for (const [id, title] of Object.entries(ITEMS)) {
    if (menu === "both" || menu === id) chrome.contextMenus.create({ id, title, contexts: CONTEXTS });
  }
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await buildMenu();
  if (reason === "install" && !(await settings()).host) chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.menu) return buildMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const [url, hint] = target(info);
  return send(url, tab, { queue: info.menuItemId === "queue", hint });
});

chrome.action.onClicked.addListener((tab) => send(tab.url, tab));

// What to send for a right-click, and what the page shows it as: the
// picture, video or song itself if it has an address Kodi can open, else the
// link, else the page.
function target(info) {
  const src = info.srcUrl;
  if (info.mediaType && src) {
    if (/^(https?|data):/i.test(src)) return [src, info.mediaType];
    // A blob: video only exists in this tab: it is a streaming player
    // (YouTube, Twitch, ...), whose page yt-dlp knows how to play instead.
    if (info.mediaType !== "image") return [info.frameUrl || info.pageUrl, null];
    return [null, null];
  }
  return [info.linkUrl || info.pageUrl, null];
}

async function send(url, tab, { queue = false, hint = null } = {}) {
  const id = `send-${Date.now()}`;
  if (url?.startsWith("data:")) {
    notify(id, "Can't send this to Kodi",
           "This picture is part of the page, with no address for Kodi to fetch it from. " +
           "In an image search, open it first, and send the large one.");
    return;
  }
  if (!url || !/^https?:/i.test(url)) {
    notify(id, "Can't send this to Kodi", `Kodi can't open ${shorten(url || "this")}.`);
    return;
  }
  const s = await settings();
  if (!s.host || !(await chrome.permissions.contains({ origins: [origin(s)] }))) {
    notify(id, "Set up chrome2kodi", s.host
      ? `chrome2kodi may not talk to ${s.host} yet: save the options again to allow it.`
      : "Enter your Kodi's address in chrome2kodi's options.");
    chrome.runtime.openOptionsPage();
    return;
  }
  notify(id, queue ? "Queueing on Kodi…" : "Sending to Kodi…", shorten(url));
  badge(tab, "…");
  // Chrome stops an idle service worker after 30s; waiting for Kodi to start
  // playing can take longer, and only calls to its API count as activity.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  let error = null;
  try {
    await new Kodi(s).send(url, { queue, hint });
  } catch (e) {
    error = e.message;
  } finally {
    clearInterval(keepAlive);
  }
  badge(tab, error ? "!" : "");
  const title = !error ? (queue ? "Queued on Kodi" : "Playing on Kodi")
                       : (queue ? "Kodi didn't queue it" : "Kodi didn't play it");
  notify(id, title, error ?? shorten(url));
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
