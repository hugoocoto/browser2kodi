// Tests of background.js: the menu, what a right-click sends, and the
// notifications, against fakes of the chrome API and of Kodi.

import assert from "node:assert/strict";
import fs from "node:fs";
import { before, beforeEach, describe, test } from "node:test";
import { proxied, timing } from "../extension/kodi.js";
import { FakeKodi, fakeChrome } from "./fakes.js";

Object.assign(timing, { poll: 0, timeout: 50, badge: 0 });

const chrome = fakeChrome();
globalThis.chrome = chrome;
const tab = { id: 1, url: "https://page/" };
let kodi;

before(async () => { await import("../extension/background.js"); });

beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 5));  // the last test's ✓ gone
  chrome.reset();
  chrome.store.host = "kodi";
  chrome.granted.add("http://kodi/*");
  kodi = new FakeKodi().install();
});

const click = (info, menu = "send") =>
  chrome.on.clicked({ menuItemId: menu, pageUrl: "https://page/", ...info }, tab);

/** What Kodi was given to play, or null. */
function given() {
  const [, open] = kodi.calls.find(([m]) => m === "Player.Open") ?? [];
  if (open?.item.file) return open.item.file;
  const [, add] = kodi.calls.find(([m]) => m === "Playlist.Add") ?? [];
  return add ? add.item[0].file : null;
}

describe("menu", () => {
  test("both items by default, which Chrome puts in a submenu", async () => {
    await chrome.on.installed({ reason: "update" });
    assert.deepEqual(chrome.menus, ["send", "queue"]);
  });

  test("a single item, when only one is wanted", async () => {
    chrome.store.menu = "send";
    await chrome.on.installed({ reason: "update" });
    assert.deepEqual(chrome.menus, ["send"]);
    chrome.store.menu = "queue";
    await chrome.on.storage({ menu: { newValue: "queue" } });
    assert.deepEqual(chrome.menus, ["queue"]);
  });

  test("installing opens the options, until Kodi is set", async () => {
    delete chrome.store.host;
    await chrome.on.installed({ reason: "install" });
    assert.equal(chrome.optionsOpened, 1);
    chrome.store.host = "kodi";
    await chrome.on.installed({ reason: "install" });
    assert.equal(chrome.optionsOpened, 1);
  });
});

describe("what is sent", () => {
  const cases = [
    [{ mediaType: "image", srcUrl: "https://img/a.jpg", linkUrl: "https://link/" }, "https://img/a.jpg"],
    [{ mediaType: "video", srcUrl: "https://cdn/clip.mp4" }, "https://cdn/clip.mp4"],
    [{ mediaType: "audio", srcUrl: "https://cdn/song.mp3" }, "https://cdn/song.mp3"],
    // Streaming players: the page, or the embedded player's.
    [{ mediaType: "video", srcUrl: "blob:https://page/1" },
     "plugin://plugin.video.sendtokodi/?https://page/"],
    [{ mediaType: "video", srcUrl: "blob:https://www.youtube.com/1",
       frameUrl: "https://www.youtube.com/embed/jNQXAC9IVRw" },
     "plugin://plugin.video.youtube/play/?video_id=jNQXAC9IVRw"],
    [{ linkUrl: "https://youtu.be/jNQXAC9IVRw" }, "plugin://plugin.video.youtube/play/?video_id=jNQXAC9IVRw"],
    [{}, "plugin://plugin.video.sendtokodi/?https://page/"],
    // A picture without an extension, like an image search's thumbnails.
    [{ mediaType: "image", srcUrl: "https://tse1.mm.bing.net/th?id=OIP.1" },
     proxied("https://tse1.mm.bing.net/th?id=OIP.1")],
  ];
  for (const [info, file] of cases) {
    test(JSON.stringify(info), async () => {
      await click(info);
      assert.equal(given(), file);
    });
  }

  test("the toolbar button sends the page", async () => {
    await chrome.on.action(tab);
    assert.equal(given(), "plugin://plugin.video.sendtokodi/?https://page/");
  });

  test("the toolbar button needs activeTab to know the page", async () => {
    const manifest = JSON.parse(fs.readFileSync(new URL("../extension/manifest.json", import.meta.url)));
    assert.ok(manifest.permissions.includes("activeTab"));
    await chrome.on.action({ id: 1 });  // what Chrome gives without it: no url
    assert.equal(chrome.badges.at(-1), "!");
  });

  test("nothing Kodi can open", async () => {
    for (const info of [{ mediaType: "image", srcUrl: "blob:https://page/2" },
                        { linkUrl: "javascript:void(0)" }]) {
      chrome.notes = [];
      await click(info);
      assert.equal(chrome.notes[0][0], "Can't send this to Kodi");
      assert.equal(chrome.badges.at(-1), "!");
    }
    assert.deepEqual(kodi.calls, []);
  });

  test("pictures inlined in the page", async () => {
    await click({ mediaType: "image", srcUrl: "data:image/png;base64,AAAA" });
    assert.equal(chrome.notes.length, 1);
    assert.equal(chrome.notes[0][0], "Can't send this to Kodi");
    assert.match(chrome.notes[0][1], /part of the page/);
    assert.deepEqual(kodi.calls, []);
  });
});

describe("notifications", () => {
  test("send and queue", async () => {
    await click({ linkUrl: "https://cdn/a.mp4" });
    assert.deepEqual(chrome.notes.map(([t]) => t), ["Sending to Kodi…", "Playing on Kodi"]);
    assert.deepEqual(chrome.badges, ["…", "✓"]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(chrome.badges.at(-1), "", "the ✓ goes after a while");
    assert.equal(chrome.titles.at(-1), "Send this page to Kodi");
    chrome.notes = [];
    await click({ linkUrl: "https://cdn/b.mp4" }, "queue");
    assert.deepEqual(chrome.notes.map(([t]) => t), ["Queueing on Kodi…", "Queued on Kodi"]);
    assert.deepEqual(kodi.playlists[1], ["https://cdn/a.mp4", "https://cdn/b.mp4"]);
  });

  test("failures", async () => {
    kodi.down = true;
    await click({ linkUrl: "https://cdn/a.mp4" });
    const [title, message] = chrome.notes.at(-1);
    assert.equal(title, "Kodi didn't play it");
    assert.match(message, /Can't reach Kodi/);
    // Shown on the button too, for desktops without notifications.
    assert.equal(chrome.badges.at(-1), "!");
    assert.match(chrome.titles.at(-1), /^Kodi didn't play it\nCan't reach Kodi/);
  });

  test("without Kodi set up, the options open", async () => {
    delete chrome.store.host;
    await click({});
    assert.deepEqual(chrome.notes, [["Set up chrome2kodi", "Enter your Kodi's address in chrome2kodi's options."]]);
    assert.equal(chrome.optionsOpened, 1);
    assert.deepEqual(kodi.calls, []);
  });

  test("without leave to talk to Kodi, the options open", async () => {
    chrome.granted.clear();
    await click({});
    assert.match(chrome.notes[0][1], /may not talk to kodi yet/);
    assert.equal(chrome.optionsOpened, 1);
  });
});
