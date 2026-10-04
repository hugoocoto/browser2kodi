// Tests of kodi.js: reading links, and what Kodi is asked to do with them.

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { Kodi, kindOf, seconds, timing, youtubeId, youtubeStart } from "../extension/kodi.js";
import { FakeKodi } from "./fakes.js";

Object.assign(timing, { poll: 0, timeout: 50 });

const SETTINGS = { host: "kodi", port: "8080", user: "", pass: "" };
const VIDEO = "jNQXAC9IVRw";

describe("links", () => {
  test("YouTube video IDs", () => {
    for (const url of [`https://youtu.be/${VIDEO}`, `https://www.youtube.com/watch?v=${VIDEO}`,
                       `https://m.youtube.com/watch?v=${VIDEO}&t=5`,
                       `https://music.youtube.com/watch?v=${VIDEO}`,
                       `https://youtube.com/shorts/${VIDEO}`, `https://www.youtube.com/embed/${VIDEO}`,
                       `https://www.youtube.com/live/${VIDEO}?si=x`]) {
      assert.equal(youtubeId(url), VIDEO, url);
    }
    for (const url of ["https://www.youtube.com/playlist?list=PL123",
                       "https://www.youtube.com/watch?v=short", "https://vimeo.com/123", "nonsense"]) {
      assert.equal(youtubeId(url), null, url);
    }
  });

  test("times", () => {
    assert.equal(seconds("90"), 90);
    assert.equal(seconds("1:30"), 90);
    assert.equal(seconds("1:02:03"), 3723);
    assert.equal(seconds("1h2m3s"), 3723);
    assert.equal(seconds("90s"), 90);
    assert.equal(seconds("soon"), null);
    assert.equal(seconds(""), null);
  });

  test("where a YouTube link starts", () => {
    assert.equal(youtubeStart(`https://youtu.be/${VIDEO}?t=90`), 90);
    assert.equal(youtubeStart(`https://www.youtube.com/watch?v=${VIDEO}&t=1m30s`), 90);
    assert.equal(youtubeStart(`https://www.youtube.com/watch?v=${VIDEO}#t=90`), 90);
    assert.equal(youtubeStart(`https://www.youtube.com/embed/${VIDEO}?start=90`), 90);
    assert.equal(youtubeStart(`https://youtu.be/${VIDEO}`), 0);
    assert.equal(youtubeStart("https://example.com/?t=90"), 0);
  });

  test("what a link is", () => {
    assert.equal(kindOf("https://cdn/clip.MP4"), "video");
    assert.equal(kindOf("https://cdn/live/index.m3u8?token=1"), "video");
    assert.equal(kindOf("https://cdn/song.mp3"), "audio");
    assert.equal(kindOf("https://img/a.jpg"), "image");
    assert.equal(kindOf(`https://youtu.be/${VIDEO}`, "video"), null);
    assert.equal(kindOf("https://example.com/watch/1"), null);
    // Without an extension, what the page showed it as.
    assert.equal(kindOf("https://img/proxy?u=1", "image"), "image");
    assert.equal(kindOf("https://cdn/stream", "audio"), "audio");
  });
});

describe("sending", () => {
  let kodi;
  beforeEach(() => { kodi = new FakeKodi().install(); });
  const send = (url, opts, settings = {}) => new Kodi({ ...SETTINGS, ...settings }).send(url, opts);

  test("YouTube goes to the YouTube add-on, which starts at the link's time", async () => {
    await send(`https://youtu.be/${VIDEO}?t=90`);
    assert.deepEqual(kodi.playlists[1], [`plugin://plugin.video.youtube/play/?video_id=${VIDEO}&seek=90`]);
    assert.equal(kodi.players[0].type, "video");
    assert.ok(!kodi.methods().includes("Player.Seek"));
  });

  test("YouTube through SendToKodi, when asked to, is sought to the link's time", async () => {
    const url = `https://youtu.be/${VIDEO}?t=90`;
    await send(url, {}, { youtube: "ytdlp" });
    assert.deepEqual(kodi.playlists[1], [`plugin://plugin.video.sendtokodi/?${url}`]);
    const [, seek] = kodi.calls.find(([m]) => m === "Player.Seek");
    assert.deepEqual(seek.value, { time: { hours: 0, minutes: 1, seconds: 30 } });
  });

  test("YouTube through SendToKodi, without the YouTube add-on", async () => {
    kodi.addons = ["plugin.video.sendtokodi"];
    await send(`https://youtu.be/${VIDEO}`);
    assert.deepEqual(kodi.playlists[1], [`plugin://plugin.video.sendtokodi/?https://youtu.be/${VIDEO}`]);
  });

  test("pages need SendToKodi", async () => {
    kodi.addons = ["plugin.video.youtube"];
    await assert.rejects(send("https://example.com/watch/1"), /needs the SendToKodi add-on/);
    assert.ok(!kodi.methods().includes("Playlist.Add"));
  });

  test("media files are played by Kodi itself, songs in the music player", async () => {
    await send("https://cdn/clip.mp4");
    assert.deepEqual(kodi.playlists[1], ["https://cdn/clip.mp4"]);
    await send("https://cdn/song.mp3");
    assert.deepEqual(kodi.playlists[0], ["https://cdn/song.mp3"]);
    assert.ok(!kodi.methods().includes("Addons.GetAddons"));
  });

  test("playing replaces what plays, but leaves pictures on screen", async () => {
    kodi.players = [{ playerid: 1, type: "video", file: "old", playlistid: 1 },
                    { playerid: 2, type: "picture", file: "pic", playlistid: -1 }];
    kodi.playlists[1] = ["old", "older"];
    await send("https://cdn/clip.mp4");
    assert.deepEqual(kodi.calls.find(([m]) => m === "Player.Stop")[1], { playerid: 1 });
    assert.deepEqual(kodi.playlists[1], ["https://cdn/clip.mp4"]);
    assert.deepEqual(kodi.calls.filter(([m]) => m === "Player.Stop").length, 1);
  });

  test("pictures go straight to the viewer", async () => {
    await send("https://img/a.png");
    assert.deepEqual(kodi.calls.find(([m]) => m === "Player.Open")[1], { item: { file: "https://img/a.png" } });
    assert.equal(kodi.players[0].type, "picture");
  });

  test("queueing adds to the end, and doesn't wait", async () => {
    kodi.playlists[1] = ["first"];
    await send("https://cdn/clip.mp4", { queue: true });
    assert.deepEqual(kodi.playlists[1], ["first", "https://cdn/clip.mp4"]);
    assert.deepEqual(kodi.methods(), ["Playlist.Add"]);
  });

  test("pictures can't be queued on a slideshow that is showing", async () => {
    kodi.players = [{ playerid: 2, type: "picture", file: "pic", playlistid: 2 }];
    await assert.rejects(send("https://img/a.jpg", { queue: true }), /already showing/);
  });

  test("a picture Kodi drops from the queue is an error", async () => {
    kodi.dropPictures = true;
    await assert.rejects(send("https://img/a.png", { queue: true }), /didn't take the picture/);
  });

  test("nothing starting to play is an error", async () => {
    await assert.rejects(send("https://cdn/fail.mp4"), /Nothing started playing/);
  });

  test("Kodi off", async () => {
    kodi.down = true;
    await assert.rejects(send("https://cdn/clip.mp4"),
                         /Can't reach Kodi at kodi:8080.*Allow remote control via HTTP/s);
  });

  test("login", async () => {
    kodi.login = "kodi:secret";
    await assert.rejects(send("https://cdn/clip.mp4", {}, { user: "kodi", pass: "wrong" }),
                         /rejected the login/);
    await send("https://cdn/clip.mp4", {}, { user: "kodi", pass: "secret" });
    assert.equal(kodi.requests.at(-1).url, "http://kodi:8080/jsonrpc");
  });
});
