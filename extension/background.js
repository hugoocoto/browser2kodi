// browser2kodi: the "Send to Kodi" and "Queue on Kodi" context menu items, and
// the toolbar button, hand a URL to Kodi, through its JSON-RPC API.

import { DEFAULTS, Kodi, origin, timing } from "./kodi.js";

const ICON = "icons/icon-128.png";

const CONTEXTS = ["image", "video", "audio", "link", "page"];
const ITEMS = { send: "Send to Kodi", queue: "Queue on Kodi" };
const DEFAULT_TITLE = "Send this page to Kodi";

async function settings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}

// Browsers put an extension's items in a submenu of their own when there are
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

// Browsers are meant to keep the menu; this is in case one doesn't.
chrome.runtime.onStartup.addListener(buildMenu);

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
    report(tab, id, "!", "Can't send this to Kodi",
           "This picture is part of the page, with no address for Kodi to fetch it from. " +
           "In an image search, open it first, and send the large one.");
    return;
  }
  if (!url || !/^https?:/i.test(url)) {
    report(tab, id, "!", "Can't send this to Kodi", `Kodi can't open ${shorten(url || "this")}.`);
    return;
  }
  const s = await settings();
  if (!s.host || !(await chrome.permissions.contains({ origins: [origin(s)] }))) {
    report(tab, id, "!", "Set up browser2kodi", s.host
      ? `browser2kodi may not talk to ${s.host} yet: save the options again to allow it.`
      : "Enter your Kodi's address in browser2kodi's options.");
    chrome.runtime.openOptionsPage();
    return;
  }
  report(tab, id, "…", queue ? "Queueing on Kodi…" : "Sending to Kodi…", shorten(url));
  // Browsers stop an idle background script after 30s; waiting for Kodi to
  // start playing can take longer, and only calls to their API count as activity.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  let error = null;
  try {
    await new Kodi(s).send(url, { queue, hint });
  } catch (e) {
    error = e.message;
  } finally {
    clearInterval(keepAlive);
  }
  if (error) report(tab, id, "!", queue ? "Kodi didn't queue it" : "Kodi didn't play it", error);
  else report(tab, id, "✓", queue ? "Queued on Kodi" : "Playing on Kodi", shorten(url));
}

// How it goes, as a notification, and on the toolbar button, for desktops
// that show no notifications: a badge ("…", then "✓" for a while, or "!"),
// and the message as its tooltip.
function report(tab, id, mark, title, message) {
  chrome.notifications.create(id, { type: "basic", iconUrl: ICON, title, message });
  if (!tab?.id || tab.id < 0) return;
  const tabId = tab.id;
  const tooltip = mark === "✓" ? DEFAULT_TITLE : `${title}\n${message}`;
  // The tab may be closed by now.
  chrome.action.setBadgeText({ tabId, text: mark }).catch(() => {});
  chrome.action.setTitle({ tabId, title: tooltip }).catch(() => {});
  if (mark === "✓") {
    setTimeout(() => chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {}), timing.badge);
  }
}

function shorten(url) {
  if (url.startsWith("data:")) return url.slice(0, url.indexOf(",") + 1) + "…";
  return url.length > 120 ? url.slice(0, 117) + "…" : url;
}
