// The options page: where Kodi is, and how chrome2kodi behaves. Saving asks
// for access to Kodi's address, then checks that Kodi answers.

import { DEFAULTS, Kodi, origin } from "./kodi.js";

const form = document.getElementById("form");
const status = document.getElementById("status");

function show(text, cls = "") {
  status.textContent = text;
  status.className = cls;
}

/** "http://kodi.local:8081/" is taken as host kodi.local, port 8081. */
function read() {
  const s = Object.fromEntries(new FormData(form));
  let host = s.host.trim().replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "");
  const m = /^([^:\]]+|\[[^\]]+\]):(\d+)$/.exec(host);
  if (m) [host, s.port] = [m[1], m[2]];
  return { ...s, host, port: s.port.trim() };
}

const saved = await chrome.storage.local.get(Object.keys(DEFAULTS));
const current = { ...DEFAULTS, ...saved };
for (const [name, value] of Object.entries(current)) {
  const field = form.elements[name];
  if (field) field.value = value;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const s = read();
  form.elements.host.value = s.host;
  form.elements.port.value = s.port;
  // Asked first: Chrome only asks while the click is fresh.
  const granted = await chrome.permissions.request({ origins: [origin(s)] });
  if (!granted) {
    show(`Not saved: chrome2kodi needs your permission to talk to ${s.host}.`, "bad");
    return;
  }
  const old = (await chrome.storage.local.get("host")).host;
  await chrome.storage.local.set(s);
  if (old && old !== s.host) {
    await chrome.permissions.remove({ origins: [origin({ host: old })] }).catch(() => {});
  }
  show("Saved. Checking Kodi…");
  try {
    const kodi = new Kodi(s);
    const { version } = await kodi.rpc("JSONRPC.Version");
    const addons = await kodi.addons();
    const missing = [];
    if (s.youtube === "addon" && !addons.has("plugin.video.youtube")) {
      missing.push("the YouTube add-on (YouTube goes through SendToKodi instead)");
    }
    if (!addons.has("plugin.video.sendtokodi")) {
      missing.push("SendToKodi (needed for pages other than media files)");
    }
    show(`Saved. Kodi answers (JSON-RPC ${version.major}.${version.minor}).` +
         (missing.length ? `\nIt lacks ${missing.join(", and ")}.` : ""), "ok");
  } catch (e) {
    show(`Saved, but: ${e.message}`, "bad");
  }
});
