"""Tests: the native host, the installer, and the extension's background script.

    python3 -m unittest discover tests      # no dependencies

send2kodi is a stand-in that writes down how it was run, so nothing talks to
Kodi. The background script runs in Node, against a stand-in for the chrome
API; those tests are skipped without Node.
"""

import base64
import hashlib
import json
import os
import shutil
import struct
import subprocess
import tempfile
import time
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST = os.path.join(REPO, "host", "chrome2kodi-host")
INSTALLER = os.path.join(REPO, "install.sh")
EXTENSION = os.path.join(REPO, "extension")
HOST_NAME = "com.hugoocoto.chrome2kodi"

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + bytes(100)).decode()

# Writes its arguments to $FAKE_LOG, one per line; fails as send2kodi does
# when the URL has "fail" in it.
FAKE_SEND2KODI = """#!/bin/sh
printf '%s\\n' "$@" > "$FAKE_LOG"
case "$*" in
    *fail*) echo "send2kodi: nothing started playing after 60s;" >&2
            echo "  the link may be unsupported" >&2; exit 1 ;;
esac
echo "Sent 1 item to kodi, waiting for playback..."
echo "Playing."
"""


def extension_id():
    """The ID Chrome gives the extension: from the key in its manifest."""
    with open(os.path.join(EXTENSION, "manifest.json")) as f:
        key = base64.b64decode(json.load(f)["key"])
    return "".join(chr(ord("a") + int(c, 16))
                   for c in hashlib.sha256(key).hexdigest()[:32])


def encode(msg):
    data = json.dumps(msg).encode()
    return struct.pack("=I", len(data)) + data


def decode(out):
    replies = []
    while out:
        (n,) = struct.unpack("=I", out[:4])
        replies.append(json.loads(out[4:4 + n]))
        out = out[4 + n:]
    return replies


class Case(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="chrome2kodi-test-")
        self.addCleanup(shutil.rmtree, self.tmp)
        self.bin = os.path.join(self.tmp, "bin")
        os.mkdir(self.bin)
        self.send2kodi = os.path.join(self.bin, "send2kodi")
        with open(self.send2kodi, "w") as f:
            f.write(FAKE_SEND2KODI)
        os.chmod(self.send2kodi, 0o755)
        self.log = os.path.join(self.tmp, "args")
        self.env = {
            "HOME": self.tmp,
            "PATH": f"{self.bin}:/usr/bin:/bin",
            "XDG_CONFIG_HOME": os.path.join(self.tmp, "config"),
            "XDG_DATA_HOME": os.path.join(self.tmp, "data"),
            "XDG_CACHE_HOME": os.path.join(self.tmp, "cache"),
            "FAKE_LOG": self.log,
        }

    def args(self):
        """How send2kodi was last run."""
        with open(self.log) as f:
            return f.read().splitlines()


class Host(Case):
    def talk(self, *msgs, host=HOST):
        r = subprocess.run([host], input=b"".join(map(encode, msgs)),
                           capture_output=True, env=self.env, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr.decode())
        return decode(r.stdout)

    def test_plays_a_url(self):
        [reply] = self.talk({"url": "https://youtu.be/jNQXAC9IVRw"})
        self.assertTrue(reply["ok"])
        self.assertEqual(self.args(), ["--bg", "--", "https://youtu.be/jNQXAC9IVRw"])

    def test_queues(self):
        [reply] = self.talk({"url": "https://host/clip.mp4", "queue": True})
        self.assertTrue(reply["ok"])
        self.assertEqual(self.args(), ["--bg", "-q", "--", "https://host/clip.mp4"])

    def test_failure_is_send2kodis_message(self):
        [reply] = self.talk({"url": "https://host/fail"})
        self.assertFalse(reply["ok"])
        self.assertEqual(reply["message"], "nothing started playing after 60s;\n"
                                           "  the link may be unsupported")

    def test_answers_each_message(self):
        replies = self.talk({"url": "https://host/a.jpg"}, {"url": "https://host/fail"},
                            {"url": "https://host/b.jpg", "queue": True})
        self.assertEqual([r["ok"] for r in replies], [True, False, True])

    def test_refuses_what_kodi_cant_open(self):
        for url in ("blob:https://host/1234", "file:///etc/passwd", "-h", ""):
            with self.subTest(url=url):
                [reply] = self.talk({"url": url})
                self.assertFalse(reply["ok"])
                self.assertFalse(os.path.exists(self.log))

    def test_data_url_becomes_a_file(self):
        [reply] = self.talk({"url": f"data:image/png;base64,{PNG}"})
        self.assertTrue(reply["ok"])
        bg, dashes, path = self.args()
        self.assertEqual((bg, dashes), ("--bg", "--"))
        self.assertEqual(os.path.dirname(path),
                         os.path.join(self.env["XDG_CACHE_HOME"], "chrome2kodi"))
        self.assertTrue(path.endswith(".png"))
        with open(path, "rb") as f:
            self.assertEqual(f.read(), base64.b64decode(PNG))

    def test_saved_pictures_go_after_a_day(self):
        cache = os.path.join(self.env["XDG_CACHE_HOME"], "chrome2kodi")
        os.makedirs(cache)
        old, recent = os.path.join(cache, "old.png"), os.path.join(cache, "recent.png")
        for path in (old, recent):
            open(path, "w").close()
        day_ago = time.time() - 25 * 3600
        os.utime(old, (day_ago, day_ago))
        self.talk({"url": f"data:image/png;base64,{PNG}"})
        self.assertFalse(os.path.exists(old))
        self.assertTrue(os.path.exists(recent))
        self.assertEqual(len(os.listdir(cache)), 2)

    def test_without_send2kodi(self):
        os.remove(self.send2kodi)
        [reply] = self.talk({"url": "https://host/clip.mp4"})
        self.assertFalse(reply["ok"])
        self.assertIn("send2kodi not found", reply["message"])

    def test_ends_when_the_browser_closes_the_pipe(self):
        self.assertEqual(self.talk(), [])


class Installer(Case):
    def install(self, *args, check=True):
        r = subprocess.run([INSTALLER, *args], capture_output=True, text=True,
                           env=self.env, timeout=30)
        if check:
            self.assertEqual(r.returncode, 0, r.stderr)
        return r

    def browser(self, name):
        path = os.path.join(self.env["XDG_CONFIG_HOME"], name)
        os.makedirs(path)
        return os.path.join(path, "NativeMessagingHosts", HOST_NAME + ".json")

    def test_installs_for_each_browser_there_is(self):
        chromium, brave = self.browser("chromium"), self.browser("BraveSoftware/Brave-Browser")
        self.install()
        host = os.path.join(self.env["XDG_DATA_HOME"], "chrome2kodi", "chrome2kodi-host")
        for manifest in (chromium, brave):
            with open(manifest) as f:
                m = json.load(f)
            self.assertEqual(m["name"], HOST_NAME)
            self.assertEqual(m["path"], host)
            self.assertEqual(m["allowed_origins"], [f"chrome-extension://{extension_id()}/"])
        self.assertFalse(os.path.exists(os.path.join(self.env["XDG_CONFIG_HOME"],
                                                     "google-chrome")))

    def test_installed_host_finds_send2kodi_outside_path(self):
        self.browser("chromium")
        self.install()
        host = os.path.join(self.env["XDG_DATA_HOME"], "chrome2kodi", "chrome2kodi-host")
        self.env["PATH"] = "/usr/bin:/bin"  # as the browser may start it
        r = subprocess.run([host], input=encode({"url": "https://host/clip.mp4"}),
                           capture_output=True, env=self.env, timeout=30)
        [reply] = decode(r.stdout)
        self.assertTrue(reply["ok"], reply)

    def test_send2kodi_given_as_a_relative_path(self):
        self.browser("chromium")
        self.env["PATH"] = "/usr/bin:/bin"
        r = subprocess.run([INSTALLER, "--send2kodi", "bin/send2kodi"], cwd=self.tmp,
                           capture_output=True, text=True, env=self.env, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(f"runs {self.send2kodi}", r.stdout)

    def test_without_send2kodi(self):
        self.browser("chromium")
        os.remove(self.send2kodi)
        r = self.install(check=False)
        self.assertEqual(r.returncode, 1)
        self.assertIn("send2kodi is not in PATH", r.stderr)

    def test_without_a_browser(self):
        r = self.install(check=False)
        self.assertEqual(r.returncode, 1)
        self.assertIn("no Chrome, Chromium", r.stderr)

    def test_uninstall(self):
        manifest = self.browser("chromium")
        self.install()
        self.install("--uninstall")
        self.assertFalse(os.path.exists(manifest))
        self.assertFalse(os.path.exists(os.path.join(self.env["XDG_DATA_HOME"], "chrome2kodi")))


# Runs background.js against a stand-in chrome API: each case is a menu click
# (or a toolbar click, without "menu"), answered with "reply", or an error if
# that is null. Prints what was sent to the host and the notifications shown.
HARNESS = r"""
const fs = require("fs"), vm = require("vm");
const src = fs.readFileSync(process.argv[1], "utf8");
const cases = JSON.parse(fs.readFileSync(0, "utf8"));

async function run(c) {
  const on = {}, sent = [], notes = [], menus = [];
  const event = (name) => ({ addListener: (f) => { on[name] = f; } });
  const chrome = {
    runtime: {
      onInstalled: event("installed"),
      sendNativeMessage: async (host, msg) => {
        sent.push({ host, msg });
        if (c.reply === null) throw new Error("Specified native messaging host not found.");
        return c.reply;
      },
    },
    contextMenus: { create: (m) => menus.push(m.id), removeAll: (cb) => cb(), onClicked: event("clicked") },
    action: { onClicked: event("action"), setBadgeText: async () => {} },
    notifications: { create: (id, n) => notes.push([n.title, n.message]) },
  };
  vm.runInNewContext(src, { chrome, console });
  on.installed();
  const tab = { id: 1, url: "https://page/" };
  if (c.menu) on.clicked({ menuItemId: c.menu, pageUrl: "https://page/", ...c.info }, tab);
  else on.action(tab);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { sent, notes, menus };
}

(async () => {
  const out = [];
  for (const c of cases) out.push(await run(c));
  console.log(JSON.stringify(out));
})();
"""

OK = {"ok": True, "message": "Playing."}


@unittest.skipUnless(shutil.which("node"), "needs Node")
class Extension(unittest.TestCase):
    def run_cases(self, cases):
        r = subprocess.run(["node", "-e", HARNESS, os.path.join(EXTENSION, "background.js")],
                           input=json.dumps(cases), capture_output=True, text=True,
                           timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def sent(self, info, menu="send"):
        """The URL a right-click sends, or None."""
        [result] = self.run_cases([{"menu": menu, "info": info, "reply": OK}])
        return result["sent"][0]["msg"]["url"] if result["sent"] else None

    def test_menu_items(self):
        [result] = self.run_cases([{"reply": OK}])
        self.assertEqual(result["menus"], ["send", "queue"])

    def test_what_is_sent(self):
        cases = [
            ({"mediaType": "image", "srcUrl": "https://img/a.jpg",
              "linkUrl": "https://link/"}, "https://img/a.jpg"),
            ({"mediaType": "image", "srcUrl": f"data:image/png;base64,{PNG}"},
             f"data:image/png;base64,{PNG}"),
            ({"mediaType": "video", "srcUrl": "https://cdn/clip.mp4"}, "https://cdn/clip.mp4"),
            ({"mediaType": "audio", "srcUrl": "https://cdn/song.mp3"}, "https://cdn/song.mp3"),
            # Streaming players: the page, or the embedded player's.
            ({"mediaType": "video", "srcUrl": "blob:https://page/1"}, "https://page/"),
            ({"mediaType": "video", "srcUrl": "blob:https://www.youtube.com/1",
              "frameUrl": "https://www.youtube.com/embed/jNQXAC9IVRw"},
             "https://www.youtube.com/embed/jNQXAC9IVRw"),
            ({"linkUrl": "https://youtu.be/jNQXAC9IVRw"}, "https://youtu.be/jNQXAC9IVRw"),
            ({}, "https://page/"),
            # Nothing Kodi can open.
            ({"mediaType": "image", "srcUrl": "blob:https://page/2"}, None),
            ({"linkUrl": "javascript:void(0)"}, None),
        ]
        for info, url in cases:
            with self.subTest(info=info):
                self.assertEqual(self.sent(info), url)

    def test_send_and_queue(self):
        send, queue, button = self.run_cases([
            {"menu": "send", "info": {"linkUrl": "https://a/"}, "reply": OK},
            {"menu": "queue", "info": {"linkUrl": "https://b/"}, "reply": OK},
            {"reply": OK},
        ])
        self.assertEqual(send["sent"], [{"host": HOST_NAME,
                                         "msg": {"url": "https://a/", "queue": False}}])
        self.assertEqual(queue["sent"][0]["msg"], {"url": "https://b/", "queue": True})
        self.assertEqual(button["sent"][0]["msg"], {"url": "https://page/", "queue": False})
        self.assertEqual([t for t, _ in send["notes"]], ["Sending to Kodi…", "Playing on Kodi"])
        self.assertEqual([t for t, _ in queue["notes"]], ["Queueing on Kodi…", "Queued on Kodi"])

    def test_failures_are_shown(self):
        failed, no_host, nothing = self.run_cases([
            {"menu": "send", "info": {}, "reply": {"ok": False, "message": "cannot reach Kodi"}},
            {"menu": "queue", "info": {}, "reply": None},
            {"menu": "send", "info": {"mediaType": "image", "srcUrl": "blob:x"}, "reply": OK},
        ])
        self.assertEqual(failed["notes"][-1], ["Kodi didn't play it", "cannot reach Kodi"])
        title, message = no_host["notes"][-1]
        self.assertEqual(title, "Kodi didn't queue it")
        self.assertIn("Run install.sh", message)
        self.assertEqual(nothing["sent"], [])
        self.assertEqual(nothing["notes"][0][0], "Can't send this to Kodi")

    def test_icons_exist(self):
        with open(os.path.join(EXTENSION, "manifest.json")) as f:
            icons = json.load(f)["icons"].values()
        for icon in icons:
            self.assertTrue(os.path.isfile(os.path.join(EXTENSION, icon)), icon)


if __name__ == "__main__":
    unittest.main()
