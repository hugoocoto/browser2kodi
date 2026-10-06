// The extension in real browsers: each Chromium- and Firefox-based browser
// found installs its build, saves the options, and sends a few things to a
// fake Kodi, served on this machine's network address. No dependencies: Chrome
// is driven through its DevTools protocol, Firefox through WebDriver BiDi.
//
//   node --test tests/browsers.js
//   BROWSERS="chromium /opt/helium/helium firefox" node --test tests/browsers.js

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { build } from "../build.js";
import { FakeKodi } from "./fakes.js";

const CHROMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
                 "helium", "brave", "brave-browser", "microsoft-edge", "vivaldi"];
const FIREFOXES = ["firefox", "firefox-esr", "librewolf", "zen-browser", "waterfox", "floorp"];
const FIREFOX_ID = "browser2kodi@hugoocoto.github.io";
const SOURCE = new URL("../extension/", import.meta.url).pathname;

const which = (name) => {
  try {
    return execFileSync("sh", ["-c", `command -v "${name}"`], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

/** [{name, bin, engine}] of the browsers to test: $BROWSERS, or all found. */
function browsers() {
  if (process.env.BROWSERS) {
    return process.env.BROWSERS.split(/\s+/).filter(Boolean).map((bin) => {
      const version = execFileSync(bin, ["--version"], { encoding: "utf8" });
      return { name: path.basename(bin), bin,
               engine: /firefox|mozilla|wolf|waterfox|floorp|zen/i.test(version) ? "firefox" : "chrome" };
    });
  }
  const found = (names, engine) =>
    names.map((name) => ({ name, bin: which(name), engine })).filter((b) => b.bin);
  // The same browser under two names is tested once.
  const seen = new Set();
  return [...found(CHROMES, "chrome"), ...found(FIREFOXES, "firefox")].filter(({ bin }) => {
    const real = fs.realpathSync(bin);
    return !seen.has(real) && seen.add(real);
  });
}

/** This machine's address on the network, as Kodi would be: not loopback. */
function lanAddress() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces) if (i.family === "IPv4" && !i.internal) return i.address;
  }
  return "127.0.0.1";
}

/** FakeKodi, behind a real web server. */
async function serve(kodi, host) {
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.method !== "POST") return res.writeHead(405).end();  // e.g. a CORS preflight
    const r = await kodi.fetch(`http://${req.headers.host}${req.url}`,
                               { headers: { Authorization: req.headers.authorization }, body });
    res.writeHead(r.status, { "Content-Type": "application/json" }).end(await r.text());
  });
  await new Promise((resolve) => server.listen(0, host, resolve));
  return server;
}

/**
 * dir with the extension for a browser, as the release has it, but with
 * background.js under e2e.js, which runs a click when a page asks for one.
 */
function testBuild(engine, dir, extra = {}) {
  build(engine, dir);
  fs.writeFileSync(`${dir}/e2e.js`, `
    import { timing } from "./kodi.js";
    import { clicked, pressed } from "./background.js";
    Object.assign(timing, { poll: 100, badge: 600000 });
    chrome.runtime.onMessage.addListener(({ call, args }, sender, respond) => {
      ({ clicked, pressed })[call](...args).then(() => respond("done"));
      return true;
    });`);
  const m = JSON.parse(fs.readFileSync(`${dir}/manifest.json`));
  if (m.background.service_worker) m.background.service_worker = "e2e.js";
  else m.background.scripts = ["e2e.js"];
  fs.writeFileSync(`${dir}/manifest.json`, JSON.stringify({ ...m, ...extra }));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** fn(...args) on the page, which returns something JSON can carry. */
const call = (fn, args) => `(async () => JSON.stringify(await (${fn})(...${JSON.stringify(args)})))()`;

/** A Chromium-based browser, through the DevTools protocol on a pipe. */
class Chrome {
  async launch(bin, profile) {
    this.proc = spawn(bin, [
      `--user-data-dir=${profile}`, "--headless=new", "--no-first-run", "--no-default-browser-check",
      "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", "about:blank",
    ], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
    this.next = 0;
    this.waiting = new Map();
    let buffer = "";
    this.proc.stdio[4].on("data", (data) => {
      const parts = (buffer + data).split("\0");
      buffer = parts.pop();
      for (const part of parts) {
        const msg = JSON.parse(part);
        const w = this.waiting.get(msg.id);
        if (!w) continue;
        this.waiting.delete(msg.id);
        if (msg.error) w.reject(new Error(`${w.method}: ${msg.error.message}`));
        else w.resolve(msg.result);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.next;
    this.proc.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
    return new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject, method }));
  }

  /** Installs the extension in dir; the URL its pages are under. */
  async install(dir) {
    const { id } = await this.send("Extensions.loadUnpacked", { path: dir });
    return `chrome-extension://${id}`;
  }

  /** The addresses of the tabs open. */
  async urls() {
    return (await this.send("Target.getTargets")).targetInfos.map((t) => t.url);
  }

  async open(url) {
    const { targetId } = await this.send("Target.createTarget", { url });
    ({ sessionId: this.session } = await this.send("Target.attachToTarget", { targetId, flatten: true }));
  }

  async run(fn, ...args) {
    const r = await this.send("Runtime.evaluate", {
      expression: call(fn, args), awaitPromise: true, returnByValue: true }, this.session);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return JSON.parse(r.result.value ?? "null");
  }

  async click(x, y) {
    for (const type of ["mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }, this.session);
    }
  }

  close() {
    this.proc.kill();
    return new Promise((resolve) => this.proc.once("exit", resolve));
  }
}

/** A Firefox-based browser, through WebDriver BiDi. */
class Firefox {
  async launch(bin, profile) {
    this.uuid = crypto.randomUUID();
    const prefs = {
      "extensions.webextensions.uuids": JSON.stringify({ [FIREFOX_ID]: this.uuid }),
      // Optional permissions are granted without asking, as if allowed.
      "extensions.webextOptionalPermissionPrompts": false,
      "browser.shell.checkDefaultBrowser": false,
      "datareporting.policy.dataSubmissionEnabled": false,
    };
    fs.writeFileSync(`${profile}/user.js`, Object.entries(prefs)
      .map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});\n`).join(""));
    // System access: to see the extension's pages, and to click on them.
    this.proc = spawn(bin, ["--headless", "--no-remote", "--profile", profile, "--remote-debugging-port=0",
                            "--remote-allow-system-access"], { stdio: ["ignore", "ignore", "pipe"] });
    const url = await new Promise((resolve, reject) => {
      let err = "";
      this.proc.stderr.on("data", (data) => {
        err += data;
        const m = /WebDriver BiDi listening on (ws:\/\/\S+)/.exec(err);
        if (m) resolve(m[1]);
      });
      this.proc.once("exit", () => reject(new Error(`${bin} exited:\n${err}`)));
    });
    this.ws = new WebSocket(`${url}/session`);
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.next = 0;
    this.waiting = new Map();
    this.ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data);
      const w = this.waiting.get(msg.id);
      if (!w) return;
      this.waiting.delete(msg.id);
      if (msg.type === "error") w.reject(new Error(`${w.method}: ${msg.error}: ${msg.message}`));
      else w.resolve(msg.result);
    };
    await this.send("session.new", { capabilities: {} });
  }

  send(method, params = {}) {
    const id = ++this.next;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject, method }));
  }

  async install(dir) {
    await this.send("webExtension.install", { extensionData: { type: "path", path: dir } });
    return `moz-extension://${this.uuid}`;
  }

  async urls() {
    return (await this.send("browsingContext.getTree", { maxDepth: 0 })).contexts.map((c) => c.url);
  }

  async open(url) {
    this.url = url;
    ({ context: this.context } = await this.send("browsingContext.create", { type: "tab" }));
    await this.send("browsingContext.navigate", { context: this.context, url, wait: "complete" });
  }

  async run(fn, ...args) {
    const r = await this.send("script.evaluate", {
      expression: call(fn, args), target: { context: this.context }, awaitPromise: true });
    if (r.type === "exception") throw new Error(r.exceptionDetails.text);
    return JSON.parse(r.result.value ?? "null");
  }

  /**
   * A click at x, y on the page, from the browser's window: WebDriver BiDi
   * won't send input to an extension's pages itself.
   */
  async click(x, y) {
    const { contexts: [window] } = await this.send("browsingContext.getTree",
                                                   { maxDepth: 0, "moz:scope": "chrome" });
    const r = await this.send("script.callFunction", {
      functionDeclaration: String(async (url, x, y) => {
        const tab = gBrowser.tabs.find((t) => t.linkedBrowser.currentURI.spec === url);
        gBrowser.selectedTab = tab;
        // Clicks are lost until the tab is on screen.
        const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
        for (let i = 0; i < 300 && !tab.linkedBrowser.frameLoader.remoteTab.hasLayers; i++) await frame();
        await frame();
        const box = tab.linkedBrowser.getBoundingClientRect();
        // Through the compositor, as the mouse's would, so the page gets them.
        for (const type of ["mousemove", "mousedown", "mouseup"]) {
          window.synthesizeMouseEvent(type, box.x + x, box.y + y, { button: 0 }, { isAsyncEnabled: true });
        }
      }),
      arguments: [{ type: "string", value: this.url }, { type: "number", value: x }, { type: "number", value: y }],
      target: { context: window.context }, awaitPromise: true });
    if (r.type === "exception") throw new Error(r.exceptionDetails.text);
  }

  async close() {
    this.ws.close();
    this.proc.kill();
    await new Promise((resolve) => this.proc.once("exit", resolve));
  }
}

/**
 * Installs the extension in dir, which opens its options, as Kodi isn't set
 * yet; then opens them in a tab of their own, for the test. Whether the
 * extension opened them.
 */
async function install(browser, dir) {
  const base = await browser.install(dir);
  let opened = false;
  for (let i = 0; i < 100 && !opened; i++, await sleep(100)) {
    opened = (await browser.urls()).some((url) => /^about:addons|extensions\/\?options=/.test(url));
  }
  // Only then: Firefox might have opened them in this tab.
  await browser.open(`${base}/options.html`);
  return opened;
}

/** Waits for fn on the page to return something truthy; returns it. */
async function until(browser, fn, what, ms = 15000) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    try {
      if ((last = await browser.run(fn))) return last;
    } catch (e) {
      last = e.message;  // e.g. the page is still loading
    }
    await sleep(100);
  }
  assert.fail(`${what}; last: ${last}`);
}

/** The right-click items there are, on the page: "send queue". */
async function menuItems() {
  const items = [];
  for (const id of ["send", "queue"]) {
    try {
      await chrome.contextMenus.update(id, {});
      items.push(id);
    } catch {}
  }
  return items.join(" ");
}

const found = browsers();
if (!found.length) test("browsers", { skip: "none found" }, () => {});

for (const { name, bin, engine } of found) {
  describe(`${name} (${bin})`, { timeout: 120000 }, () => {
    const host = lanAddress();
    const kodi = new FakeKodi();
    let server, browser, tmp, tab, opened;

    before(async () => {
      server = await serve(kodi, host);
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "browser2kodi-"));
      fs.mkdirSync(`${tmp}/profile`);
      // Chrome can't be told to allow access to Kodi without asking, as Firefox
      // can: the test build asks for it at install.
      testBuild(engine, `${tmp}/extension`,
                engine === "chrome" ? { host_permissions: [`http://${host}/*`] } : {});
      browser = engine === "chrome" ? new Chrome() : new Firefox();
      await browser.launch(bin, `${tmp}/profile`);
      opened = await install(browser, `${tmp}/extension`);
      tab = { id: await until(browser, async () => (await chrome.tabs.getCurrent())?.id, "a tab id") };
    });

    after(async () => {
      await browser?.close();
      server?.close();
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    });

    test("installing opens the options", () => assert.ok(opened));

    test("the right-click menu is there", async () => {
      assert.equal(await until(browser, menuItems, "the menu"), "send queue");
    });

    test("the options are saved, and Kodi answers", async () => {
      const { port } = server.address();
      await until(browser, () => document.forms.form.elements.port.value === "8080", "the options shown");
      const [x, y] = await browser.run((h, p) => {
        const form = document.forms.form;
        form.elements.host.value = h;
        form.elements.port.value = p;
        const button = form.querySelector("button");
        button.scrollIntoView();
        const r = button.getBoundingClientRect();
        return [r.x + r.width / 2, r.y + r.height / 2];
      }, host, String(port));
      await browser.click(x, y);
      const status = await until(browser, () => {
        const s = document.getElementById("status").textContent;
        return s && s !== "Saved. Checking Kodi…" && s;
      }, "a result");
      assert.match(status, /^Saved\. Kodi answers \(JSON-RPC 13\.5\)\.$/);
      assert.deepEqual(await browser.run(() => chrome.storage.local.get(["host", "port"])),
                       { host, port: String(port) });
    });

    const send = (call, ...args) => browser.run(
      (call, args) => chrome.runtime.sendMessage({ call, args }), call, args);
    const badge = () => browser.run((tabId) => chrome.action.getBadgeText({ tabId }), tab.id);

    test("a right-clicked video plays", async () => {
      assert.equal(await send("clicked", { menuItemId: "send", mediaType: "video",
                                           srcUrl: "https://cdn.example/clip.mp4",
                                           pageUrl: "https://example.com/" }, tab), "done");
      assert.deepEqual(kodi.playlists[1], ["https://cdn.example/clip.mp4"]);
      assert.equal(kodi.players[0]?.file, "https://cdn.example/clip.mp4");
      assert.equal(await badge(), "✓");
    });

    test("the toolbar button plays a YouTube page", async () => {
      await send("pressed", { ...tab, url: "https://www.youtube.com/watch?v=jNQXAC9IVRw" });
      assert.deepEqual(kodi.playlists[1], ["plugin://plugin.video.youtube/play/?video_id=jNQXAC9IVRw"]);
      assert.equal(await badge(), "✓");
    });

    test("a song is queued", async () => {
      await send("clicked", { menuItemId: "queue", linkUrl: "https://cdn.example/song.mp3",
                              pageUrl: "https://example.com/" }, tab);
      assert.deepEqual(kodi.playlists[0], ["https://cdn.example/song.mp3"]);
    });
  });

  // extension/ as it is, the way to try changes: it loads, menu and all.
  test(`${name}: extension/ loads as it is`, { timeout: 60000 }, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "browser2kodi-"));
    const browser = engine === "chrome" ? new Chrome() : new Firefox();
    try {
      await browser.launch(bin, tmp);
      assert.ok(await install(browser, SOURCE), "the options opened");
      assert.equal(await until(browser, menuItems, "the menu"), "send queue");
    } finally {
      await browser.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}
