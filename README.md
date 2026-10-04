# chrome2kodi

[![tests](https://github.com/hugoocoto/chrome2kodi/actions/workflows/tests.yml/badge.svg)](https://github.com/hugoocoto/chrome2kodi/actions/workflows/tests.yml)

A Chrome extension: right-click a picture, video, song or link and pick **Send to Kodi** to play it now, or **Queue on Kodi** to add it to the end of Kodi's queue. It talks to Kodi's JSON-RPC API directly, the way [send2kodi](https://github.com/hugoocoto/send2kodi) does, with nothing else to install: YouTube goes through the YouTube add-on, links to media files are played by Kodi itself, and anything else yt-dlp knows goes through SendToKodi.

| You right-click | Kodi gets |
|---|---|
| A picture | the picture, in its picture viewer. One whose address has no extension, like an image search's thumbnails, through the [wsrv.nl](https://wsrv.nl) image proxy (see below) |
| A video or song with a real address | that file |
| A video in a streaming player (YouTube, Twitch, … whose videos are `blob:` addresses) | the page or the embedded player, for yt-dlp or the YouTube add-on to play |
| A link | where it points to, e.g. a YouTube video in a list of them |
| Anywhere else on the page, or the toolbar button | the page |

You are told how it went in a notification, once Kodi has started playing (or queued it), or has failed to.

## Install

1. In `chrome://extensions`, turn on *Developer mode*, click *Load unpacked*, and pick the `extension` folder. Works in Chrome, Chromium, Brave, Vivaldi, Edge, Helium and the like.
2. The options open: enter your Kodi's address (and port, user and password, if they aren't the defaults), and *Save*. Chrome asks to let chrome2kodi talk to that address; it reaches nothing else.
3. In Kodi, turn on *Settings › Services › Control › Allow remote control via HTTP*. For pages other than media files, install the [SendToKodi](https://github.com/firsttris/plugin.video.sendtokodi) add-on; for YouTube, the YouTube add-on (or SendToKodi does it too).

The options are in the extension's *Details › Extension options*, or on right-click on its toolbar button. There you can also choose:

- **YouTube**: through the YouTube add-on (starts faster), or through SendToKodi.
- **Pictures**: whether pictures without an extension go through wsrv.nl (on by default).
- **Right-click menu**: both items, or only *Send to Kodi* or only *Queue on Kodi*. Chrome puts an extension's items in a submenu of their own when there are several, so pick one to have it right in the menu.

## Notes

- YouTube shows its own menu on right-click on a video; right-click again for the browser's. Or right-click the video's link or thumbnail, or use the toolbar button.
- Kodi fetches what you send by itself, without your browser's cookies, so pictures and videos behind a login won't play.
- Kodi only shows a picture whose address ends in `.jpg`, `.png`, …: given one without, like Google's and Bing's thumbnails, its viewer hands it to the video player, which shows it for a frame and stops. send2kodi serves such pictures from your computer under a `.jpg` name; an extension can't serve anything, so chrome2kodi sends Kodi `https://wsrv.nl/x.jpg?url=<the picture>&output=jpg` instead: [wsrv.nl](https://wsrv.nl) fetches the picture and hands it on as a JPEG. It sees those pictures' addresses and nothing else. Turned off in the options, they flash and vanish.
- Pictures inlined in a page (`data:` addresses, like the first rows of Google's image results) have no address for Kodi or wsrv.nl to fetch, so they can't be sent: open the picture, and send the large one. Nor can files on this computer: send2kodi does those.
- Pictures can't be queued on a slideshow that is already showing, a limit of Kodi's: send them instead, or leave the slideshow first.

## Tests

`tests/` runs the extension in Node, against stand-ins for Chrome's API and for Kodi. Nothing goes to Kodi.

```sh
node --test
```

GitHub Actions runs them on Node 22 and the latest Node for every push to `main` and every pull request.

## License

[MIT](LICENSE) © Hugo Coto
