// Talking to Kodi: what send2kodi does with a URL, through Kodi's JSON-RPC
// API, from the browser. No local files, so nothing has to be served.

export const DEFAULTS = {
  host: "",          // address or hostname of the Kodi box (required)
  port: "8080",      // Kodi's web server port
  user: "kodi",      // web server login, if one is set in Kodi
  pass: "",
  youtube: "addon",  // addon = YouTube add-on, ytdlp = SendToKodi
  proxy: true,       // pictures without an extension go through wsrv.nl
  menu: "both",      // right-click items: both, send or queue
};

// Changed by the tests only.
export const timing = { poll: 2000, timeout: 60000, request: 10000, badge: 5000 };

const MUSIC_PLAYLIST = 0;
const VIDEO_PLAYLIST = 1;
const PICTURE_PLAYLIST = 2;
const YOUTUBE_ADDON = "plugin.video.youtube";
const SENDTOKODI_ADDON = "plugin.video.sendtokodi";
const PROXY = "https://wsrv.nl/x.jpg";

// Media by extension, which is what Kodi goes by: the usual part of its own
// lists. Stream manifests are played as videos.
const exts = (kind, list) => list.trim().split(/\s+/).map((ext) => [ext, kind]);
const MEDIA = Object.fromEntries([
  ...exts("video", `.3g2 .3gp .asf .avi .divx .dv .evo .f4v .flv .m2t .m2ts .m2v
    .m4v .mk3d .mkv .mov .mp4 .mpeg .mpg .mts .nuv .ogm .ogv .qt .rm .rmvb .tp
    .trp .ts .vob .webm .wmv .wtv .xvid .m3u8 .mpd`),
  ...exts("audio", `.aac .ac3 .aif .aiff .ape .dff .dsf .dts .flac .m4a .m4b .mka
    .mp2 .mp3 .mpa .mpc .oga .ogg .opus .tak .tta .wav .wma .wv`),
  ...exts("image", `.apng .avif .bmp .gif .ico .jp2 .jpeg .jpg .pcx .png .tga .tif
    .tiff .webp`),
]);

/** Kodi turned a call down, e.g. because a player stopped meanwhile. */
export class KodiError extends Error {}

/** The match pattern of Kodi's web server, for chrome.permissions. */
export function origin(settings) {
  return `http://${settings.host}/*`;
}

/** Of the path in a URL: ".mp4", or "". */
export function extension(url) {
  const m = /\.[^./]+$/.exec(new URL(url).pathname);
  return m ? m[0].toLowerCase() : "";
}

/** The video ID of a YouTube video URL, or null (playlists included). */
export function youtubeId(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  let vid;
  if (host === "youtu.be") {
    vid = u.pathname.replace(/^\/+|\/+$/g, "");
  } else if (host === "youtube.com" || host === "music.youtube.com") {
    const m = /^\/(?:shorts|live|embed)\/([^/?]+)/.exec(u.pathname);
    vid = m ? m[1] : u.searchParams.get("v") ?? "";
  } else {
    return null;
  }
  return /^[\w-]{11}$/.test(vid) ? vid : null;
}

/** 90, 1:30, 1:02:03, 1h2m3s or 90s in seconds; null if it's none of those. */
export function seconds(text) {
  text = text.trim().toLowerCase();
  if (/^\d+(:\d+){0,2}$/.test(text)) {
    return text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  }
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
  if (text && m) {
    const [h, mins, s] = m.slice(1).map((g) => Number(g ?? 0));
    return h * 3600 + mins * 60 + s;
  }
  return null;
}

/** The time a YouTube link starts at (?t=90, ?t=1m30s, #t=90), or 0. */
export function youtubeStart(url) {
  if (!youtubeId(url)) return 0;
  const u = new URL(url);
  const fragment = new URLSearchParams(u.hash.slice(1));
  const param = (name) => u.searchParams.get(name) ?? fragment.get(name);
  return seconds(param("t") || param("start") || "") || 0;
}

/**
 * What a link is: "video", "audio" or "image", by extension, which is what
 * Kodi goes by, else by what the page shows it as (hint: the mediaType of a
 * right-clicked element). null for a page an add-on has to resolve (YouTube,
 * or anything yt-dlp knows).
 */
export function kindOf(url, hint = null) {
  const kind = MEDIA[extension(url)];
  if (kind) return kind;
  if (youtubeId(url)) return null;
  return ["video", "audio", "image"].includes(hint) ? hint : null;
}

/**
 * A picture's address through the wsrv.nl image proxy, as a JPEG under a
 * path ending in .jpg. Kodi goes by the extension of the path: given a
 * picture without one (an image search's thumbnails), its viewer hands it
 * to the video player, which shows a frame of it and stops. send2kodi
 * serves such pictures itself, under a .jpg name; an extension can't serve
 * anything, so the proxy does it.
 */
export function proxied(url) {
  return `${PROXY}?url=${encodeURIComponent(url)}&output=jpg`;
}

function basicAuth(user, pass) {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  return "Basic " + btoa(String.fromCharCode(...bytes));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const millis = (t) => ((t.hours * 60 + t.minutes) * 60 + t.seconds) * 1000 + t.milliseconds;

export class Kodi {
  constructor(settings) {
    this.s = { ...DEFAULTS, ...settings };
    this.addonIds = null;
  }

  async rpc(method, params) {
    const body = { jsonrpc: "2.0", id: 1, method };
    if (params !== undefined) body.params = params;
    const headers = { "Content-Type": "application/json" };
    if (this.s.user || this.s.pass) headers.Authorization = basicAuth(this.s.user, this.s.pass);
    const where = `${this.s.host}:${this.s.port}`;
    let r;
    try {
      r = await fetch(`http://${where}/jsonrpc`, {
        method: "POST", headers, body: JSON.stringify(body),
        signal: AbortSignal.timeout(timing.request),
      });
    } catch (e) {
      throw new Error(`Can't reach Kodi at ${where} (${e.message}). Is it on, and is ` +
                      "Settings > Services > Control > 'Allow remote control via HTTP' enabled?");
    }
    if (r.status === 401) {
      throw new Error(`Kodi at ${this.s.host} rejected the login; ` +
                      "set the user and password in browser2kodi's options.");
    }
    if (!r.ok) throw new Error(`Kodi at ${this.s.host}: HTTP ${r.status} ${r.statusText}`);
    const resp = await r.json();
    if (resp.error) {
      throw new KodiError(`${method} failed: ${resp.error.message} (${resp.error.code})`);
    }
    return resp.result;
  }

  /** The ids of the plugin add-ons enabled in Kodi. */
  async addons() {
    if (!this.addonIds) {
      const result = await this.rpc("Addons.GetAddons",
                                    { type: "xbmc.python.pluginsource", enabled: true });
      this.addonIds = new Set((result.addons ?? []).map((a) => a.addonid));
    }
    return this.addonIds;
  }

  /**
   * How Kodi gets a link: "direct" (it plays it itself), "proxy" (a picture
   * it can't tell for one by its address, through wsrv.nl), or "youtube" /
   * "sendtokodi" (a page that add-on resolves).
   */
  async route(url, kind) {
    if (kind === "image" && MEDIA[extension(url)] !== "image" && this.s.proxy) return "proxy";
    if (kind) return "direct";
    const addons = await this.addons();
    if (youtubeId(url) && this.s.youtube !== "ytdlp" && addons.has(YOUTUBE_ADDON)) {
      return "youtube";
    }
    if (!addons.has(SENDTOKODI_ADDON)) {
      throw new Error(`Kodi needs the SendToKodi add-on (${SENDTOKODI_ADDON}) to play ` +
                      `${url}. See https://github.com/firsttris/plugin.video.sendtokodi`);
    }
    return "sendtokodi";
  }

  /**
   * Play a link now, or with queue add it to the end of Kodi's queue. Resolves
   * once it plays (or is queued); throws, with what went wrong, otherwise.
   */
  async send(url, { queue = false, hint = null } = {}) {
    const kind = kindOf(url, hint);
    const playlist = kind === "image" ? PICTURE_PLAYLIST
                   : kind === "audio" ? MUSIC_PLAYLIST : VIDEO_PLAYLIST;
    const how = await this.route(url, kind);
    const start = youtubeStart(url);
    const file =
      how === "youtube" ? `plugin://${YOUTUBE_ADDON}/play/?video_id=${youtubeId(url)}` +
                          (start ? `&seek=${start}` : "")
      : how === "sendtokodi" ? `plugin://${SENDTOKODI_ADDON}/?${url}`
      : how === "proxy" ? proxied(url)
      : url;

    if (playlist === PICTURE_PLAYLIST && !queue) {
      // Straight to the viewer: Kodi drops PNGs added to a slideshow.
      await this.rpc("Player.Open", { item: { file } });
    } else {
      // Kodi answers OK to adding pictures to an open slideshow, but drops them.
      if (playlist === PICTURE_PLAYLIST &&
          (await this.rpc("Player.GetActivePlayers")).some((p) => p.type === "picture")) {
        throw new Error("Kodi can't add pictures to a slideshow that is already showing. " +
                        "Leave it, or send the picture instead.");
      }
      await this.enqueue(file, playlist, !queue);
    }
    if (queue) return;
    const player = await this.waitForStart(playlist, file);
    if (player === null) {
      throw new Error(`Nothing started playing after ${timing.timeout / 1000}s; ` +
                      "the link may be unsupported or failed to resolve.");
    }
    if (start && how !== "youtube") await this.seek(player, start);  // that add-on seeks by itself
  }

  /** Add a file to a Kodi playlist; to play it now, in place of what it has. */
  async enqueue(file, playlist, play) {
    if (play) {
      // Whatever is playing goes first: it would pass for ours while an
      // add-on is still resolving ours.
      for (const player of await this.rpc("Player.GetActivePlayers")) {
        if (player.type !== "picture") await this.rpc("Player.Stop", { playerid: player.playerid });
      }
      await this.rpc("Playlist.Clear", { playlistid: playlist });
    }
    // Kodi adds pictures there and then, dropping some; videos and songs a
    // moment later, all of them.
    const before = playlist === PICTURE_PLAYLIST ? await this.playlistSize(playlist) : 0;
    await this.rpc("Playlist.Add", { playlistid: playlist, item: [{ file }] });
    if (playlist === PICTURE_PLAYLIST && await this.playlistSize(playlist) === before) {
      throw new Error("Kodi didn't take the picture. It drops PNGs added to a slideshow; " +
                      "send it instead of queueing it.");
    }
    if (play) await this.rpc("Player.Open", { item: { playlistid: playlist, position: 0 } });
  }

  async playlistSize(playlist) {
    return (await this.rpc("Playlist.GetItems", { playlistid: playlist })).limits.total;
  }

  /**
   * The id of the player once Kodi is playing what we sent, null on timeout.
   *
   * A video counts once its clock runs: Kodi knows the length of a stream it
   * is still buffering, and would lose a seek to it, and a live stream has no
   * length at all. A picture counts once the viewer shows it.
   */
  async waitForStart(playlist, file) {
    const deadline = Date.now() + timing.timeout;
    while (Date.now() < deadline) {
      await sleep(timing.poll);
      try {
        for (const player of await this.rpc("Player.GetActivePlayers")) {
          const pid = player.playerid;
          if (playlist === PICTURE_PLAYLIST) {
            if (player.type === "picture" && await this.playing(pid) === file) return pid;
            continue;
          }
          const props = await this.rpc("Player.GetProperties", {
            playerid: pid, properties: ["playlistid", "position", "time"] });
          if (props.playlistid === playlist && props.position >= 0 &&
              millis(props.time) > 0) {  // below 0 till the 1st frame
            return pid;
          }
        }
      } catch (e) {
        if (!(e instanceof KodiError)) throw e;  // e.g. the player stopped between two calls
      }
    }
    return null;
  }

  /** The file a player is on. */
  async playing(player) {
    const r = await this.rpc("Player.GetItem", { playerid: player, properties: ["file"] });
    return r.item.file ?? "";
  }

  /** Jump to s seconds into what the player is playing; not starting there isn't fatal. */
  async seek(player, s) {
    try {
      await this.rpc("Player.Seek", { playerid: player, value: { time: {
        hours: Math.floor(s / 3600), minutes: Math.floor(s / 60) % 60, seconds: s % 60 } } });
    } catch (e) {
      if (!(e instanceof KodiError)) throw e;
    }
  }
}
