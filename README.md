# chrome2kodi

[![tests](https://github.com/hugoocoto/chrome2kodi/actions/workflows/tests.yml/badge.svg)](https://github.com/hugoocoto/chrome2kodi/actions/workflows/tests.yml)

A browser extension that plays what you're looking at on Kodi.

- **Right-click** a picture, video, song or link → **Send to Kodi** (play now) or **Queue on Kodi**.
- **Click the toolbar button** to send the page you're on, e.g. a YouTube video.

Nothing to install on your computer: it talks to Kodi directly.

## Install

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `extension` folder.
2. In the options that open, enter your Kodi's address and click **Save**.
3. In Kodi, turn on **Settings › Services › Control › Allow remote control via HTTP**.
4. Optional Kodi add-ons:
   - **YouTube**, for YouTube videos.
   - **[SendToKodi](https://github.com/firsttris/plugin.video.sendtokodi)**, for other video sites (anything yt-dlp supports).

Tip: pin the toolbar button with the puzzle-piece menu 🧩 next to the address bar.

Works in Chrome, Chromium, Brave, Vivaldi, Edge and Helium.

## Options

Open them from **Details › Extension options**, or by right-clicking the toolbar button.

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
- **On YouTube**, right-click a video twice to get the browser's menu, or use the toolbar button.

## Tests

```sh
node --test
```

These run the extension in Node, against fakes of Chrome and Kodi. CI runs them on every push.

## License

[MIT](LICENSE) © Hugo Coto
