# browser2kodi

[![tests](https://github.com/hugoocoto/browser2kodi/actions/workflows/tests.yml/badge.svg)](https://github.com/hugoocoto/browser2kodi/actions/workflows/tests.yml)

A browser extension that plays what you're looking at on Kodi. For Firefox, Chrome, and the browsers built on them.

- **Right-click** a picture, video, song or link → **Send to Kodi** (play now) or **Queue on Kodi**.
- **Click the toolbar button** to send the page you're on, e.g. a YouTube video.

Nothing to install on your computer: it talks to Kodi directly.

## Install

Download it from the [latest release](https://github.com/hugoocoto/browser2kodi/releases/latest).

**Firefox**, LibreWolf, Waterfox, Zen, Floorp (Firefox 140 or later):

1. Open `browser2kodi-…-firefox.xpi` with Firefox, or drag it onto a Firefox window, and click **Add**.

**Chrome**, Chromium, Brave, Vivaldi, Edge, Opera, Helium:

1. Unzip `browser2kodi-…-chrome.zip`.
2. Open the browser's extensions page, `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `browser2kodi` folder.
3. Pin the toolbar button with the puzzle-piece menu 🧩 next to the address bar.

**Then, in any browser:**

1. In the options that open, enter your Kodi's address, click **Save**, and allow browser2kodi to talk to it.
2. In Kodi, turn on **Settings › Services › Control › Allow remote control via HTTP**.
3. Optional Kodi add-ons:
   - **YouTube**, for YouTube videos.
   - **[SendToKodi](https://github.com/firsttris/plugin.video.sendtokodi)**, for other video sites (anything yt-dlp supports).

## Options

Right-click the toolbar button › **Options** (Chrome) or **Manage Extension** › **Options** (Firefox).

- **YouTube**: play through the YouTube add-on (faster) or SendToKodi.
- **Pictures**: send pictures without a file extension through wsrv.nl (see below).
- **Right-click menu**: show both items, or just one. With one item it appears directly in the menu instead of in a submenu.

## How you know it worked

A notification, plus a badge on the toolbar button: `…` sending, `✓` playing, `!` failed (hover for why). The badge is there for desktops without notifications.

## Limitations

- **Pictures without a file extension** (like Google and Bing thumbnails): Kodi can't show these directly, so they go through the [wsrv.nl](https://wsrv.nl) image proxy, which only sees the picture's address. If you turn this off, those pictures flash and vanish.
- **Pictures embedded in the page** (the first rows of Google Images): these have no address to send. Click the picture and send the large one instead.
- **Things behind a login** won't play, because Kodi fetches them without your browser's cookies.
- **Files on your computer** can't be sent. Use [send2kodi](https://github.com/hugoocoto/send2kodi) for those.
- **On YouTube**, right-click a video twice (Shift+right-click in Firefox) to get the browser's menu, or use the toolbar button.
- **Firefox for Android and Safari** aren't supported.

## Development

`extension/` is the extension for every browser: load it as it is to try a change.

- **Firefox**: open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and pick `extension/manifest.json`. It stays until Firefox restarts.
- **Chrome**: **Load unpacked** the `extension` folder. Chrome may warn about Firefox's keys in the manifest; that's fine.

`node build.js` makes `dist/chrome` and `dist/firefox`, each without the other browser's keys. That's what the releases have.

### Tests

```sh
node --test                   # against fakes of the browser and Kodi
node --test tests/browsers.js # in the Chrome- and Firefox-based browsers installed here
```

The second runs the extension in each browser it finds, against a fake Kodi on your network address. Pick the browsers with `BROWSERS="chromium firefox"`. CI runs both on every push, the second in Chrome, Edge and Firefox.

### Releases

Push a tag with the version in `extension/manifest.json`:

```sh
git tag v0.3.0 && git push origin v0.3.0
```

The [release workflow](.github/workflows/release.yml) tests it, and adds the Chrome zip and the Firefox add-on to a GitHub release. Firefox only installs add-ons signed by Mozilla: for the workflow to have them signed, create an [addons.mozilla.org API key](https://addons.mozilla.org/developers/addon/api/key/) and save it as the repository secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`. The add-on is signed for you to share, not listed on addons.mozilla.org.

## License

[MIT](LICENSE) © Hugo Coto
