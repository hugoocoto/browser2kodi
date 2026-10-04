# chrome2kodi

[![tests](https://github.com/hugoocoto/chrome2kodi/actions/workflows/tests.yml/badge.svg)](https://github.com/hugoocoto/chrome2kodi/actions/workflows/tests.yml)

A Chrome extension: right-click a picture, video, song or link and pick **Send to Kodi** to play it now, or **Queue on Kodi** to add it to the end of Kodi's queue. It plays on the TV through [send2kodi](https://github.com/hugoocoto/send2kodi), so it handles everything that does: YouTube through the YouTube add-on, links to media files directly, and anything else yt-dlp knows through SendToKodi.

| You right-click | Kodi gets |
|---|---|
| A picture | the picture, in its picture viewer. Pictures inlined in the page (`data:` URLs, like image-search thumbnails) are saved and served from this computer |
| A video or song with a real address | that file |
| A video in a streaming player (YouTube, Twitch, … whose videos are `blob:` addresses) | the page or the embedded player, for yt-dlp or the YouTube add-on to play |
| A link | where it points to, e.g. a YouTube video in a list of them |
| Anywhere else on the page, or the toolbar button | the page |

You are told how it went in a notification, once Kodi has started playing (or queued it), or has failed to.

Pictures can't be added to a slideshow that is already showing, a limit of Kodi's: send them instead, or leave the slideshow first.

## Install

Needs [send2kodi](https://github.com/hugoocoto/send2kodi) installed and configured, and Chrome, Chromium, Brave, Vivaldi, Edge or Helium on Linux.

```sh
./install.sh
```

installs the small program the extension runs send2kodi through (a [native messaging host](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)) in `~/.local/share/chrome2kodi/`, and tells each browser about it. Then, in `chrome://extensions`, turn on *Developer mode*, click *Load unpacked*, and pick the `extension` folder.

`./install.sh --send2kodi PATH` if send2kodi isn't in your PATH; `./install.sh --uninstall` takes the host back out. Run it again if send2kodi moves.

## Notes

- YouTube shows its own menu on right-click on a video; right-click again for the browser's. Or right-click the video's link or thumbnail, or use the toolbar button.
- Kodi fetches what you send by itself, without your browser's cookies, so pictures and videos behind a login won't play.
- Pictures are served from this computer for as long as they are on screen, by a send2kodi in the background.

## Tests

`tests/` runs the native host and the installer against a stand-in send2kodi, and the extension's background script in Node against a stand-in for Chrome's API. Nothing goes to Kodi.

```sh
python3 -m unittest discover tests
```

GitHub Actions runs them on Python 3.9 and 3.14 for every push to `main` and every pull request.

## License

[MIT](LICENSE) © Hugo Coto
