// Stand-ins for Kodi (behind fetch) and for the chrome API, so the tests
// don't need either.

const PLAYLIST_TYPE = { 0: "audio", 1: "video", 2: "picture" };

/**
 * A Kodi that answers JSON-RPC calls from what it keeps in memory, and
 * writes each call down. Links with "fail" in them never start playing.
 */
export class FakeKodi {
  constructor({ addons = ["plugin.video.youtube", "plugin.video.sendtokodi"],
                login = null, down = false, dropPictures = false } = {}) {
    Object.assign(this, { addons, login, down, dropPictures });
    this.calls = [];
    this.players = [];  // {playerid, type, file, playlistid}
    this.playlists = { 0: [], 1: [], 2: [] };
    this.requests = [];
  }

  /** Install as the global fetch. */
  install() {
    globalThis.fetch = (url, init) => this.fetch(url, init);
    return this;
  }

  async fetch(url, init) {
    this.requests.push({ url, headers: init.headers });
    if (this.down) throw new TypeError("Failed to fetch");
    if (this.login && init.headers.Authorization !== `Basic ${btoa(this.login)}`) {
      return new Response("", { status: 401, statusText: "Unauthorized" });
    }
    const { method, params, id } = JSON.parse(init.body);
    this.calls.push([method, params]);
    try {
      return Response.json({ jsonrpc: "2.0", id, result: this.answer(method, params ?? {}) });
    } catch (e) {
      return Response.json({ jsonrpc: "2.0", id, error: { code: -32100, message: e.message } });
    }
  }

  player(id) {
    const p = this.players.find((p) => p.playerid === id);
    if (!p) throw new Error("Failed to execute method.");
    return p;
  }

  start(file, type, playlistid) {
    this.players = this.players.filter((p) => p.type !== type);
    if (!file.includes("fail")) {
      this.players.push({ playerid: { audio: 0, video: 1, picture: 2 }[type], type, file, playlistid });
    }
  }

  answer(method, p) {
    switch (method) {
      case "JSONRPC.Version": return { version: { major: 13, minor: 5, patch: 0 } };
      case "Addons.GetAddons": return { addons: this.addons.map((addonid) => ({ addonid })) };
      case "Player.GetActivePlayers":
        return this.players.map(({ playerid, type }) => ({ playerid, type }));
      case "Player.Stop":
        this.player(p.playerid);
        this.players = this.players.filter((x) => x.playerid !== p.playerid);
        return "OK";
      case "Player.GetItem": return { item: { file: this.player(p.playerid).file } };
      case "Player.GetProperties": {
        const x = this.player(p.playerid);
        return { playlistid: x.playlistid, position: 0,
                 time: { hours: 0, minutes: 0, seconds: 1, milliseconds: 0 } };
      }
      case "Player.Seek": this.player(p.playerid); return {};
      case "Player.Open":
        if (p.item.file) this.start(p.item.file, "picture", -1);
        else this.start(this.playlists[p.item.playlistid][p.item.position],
                        PLAYLIST_TYPE[p.item.playlistid], p.item.playlistid);
        return "OK";
      case "Playlist.Clear": this.playlists[p.playlistid] = []; return "OK";
      case "Playlist.Add":
        if (!(p.playlistid === 2 && this.dropPictures)) {
          this.playlists[p.playlistid].push(...p.item.map((i) => i.file));
        }
        return "OK";
      case "Playlist.GetItems": {
        const items = this.playlists[p.playlistid];
        return { items: items.map((file) => ({ file })), limits: { start: 0, end: items.length, total: items.length } };
      }
      default: throw new Error(`Method not found: ${method}`);
    }
  }

  /** The calls made, by method name only. */
  methods() {
    return this.calls.map(([m]) => m);
  }
}

const event = (on, name) => ({ addListener: (f) => { on[name] = f; } });

/** The parts of the chrome API browser2kodi uses; on holds the listeners. */
export function fakeChrome() {
  const chrome = {
    on: {}, menus: [], notes: [], optionsOpened: 0, badges: [], titles: [],
    store: {}, granted: new Set(),
    reset() {
      Object.assign(this, { menus: [], notes: [], optionsOpened: 0, badges: [], titles: [], store: {} });
      this.granted.clear();
    },
  };
  const on = chrome.on;
  Object.assign(chrome, {
    runtime: {
      onInstalled: event(on, "installed"),
      onStartup: event(on, "startup"),
      openOptionsPage: () => { chrome.optionsOpened++; },
      getPlatformInfo: async () => ({ os: "linux" }),
    },
    storage: {
      local: {
        get: async (keys) => Object.fromEntries(
          keys.filter((k) => k in chrome.store).map((k) => [k, chrome.store[k]])),
        set: async (values) => { Object.assign(chrome.store, values); },
      },
      onChanged: event(on, "storage"),
    },
    permissions: {
      contains: async ({ origins }) => origins.every((o) => chrome.granted.has(o)),
    },
    contextMenus: {
      create: (m) => { chrome.menus.push(m.id); },
      removeAll: async () => { chrome.menus = []; },
      onClicked: event(on, "clicked"),
    },
    action: {
      onClicked: event(on, "action"),
      setBadgeText: async ({ text }) => { chrome.badges.push(text); },
      setTitle: async ({ title }) => { chrome.titles.push(title); },
    },
    notifications: { create: (id, n) => { chrome.notes.push([n.title, n.message]); } },
  });
  return chrome;
}
