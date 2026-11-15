"use strict";
/**
 * Spotispy — UI harness support.
 *
 * Loads the real sources into this Node realm (so their `globalThis` is ours),
 * points a jsdom window at them, stubs the Spotify client, seeds synthetic data
 * with images and dates, and mounts routes the way Spicetify does.
 *
 * Nothing here touches the network: every endpoint the app talks to is
 * answered by the stub, so the harness runs offline and deterministically.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

const pa = require("./playlist-api.js");

const ART = {
  avatarUser: "https://image-cdn-ak.spotifycdn.com/image/deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  avatarFriend: "https://image-cdn-ak.spotifycdn.com/image/cafebabecafebabecafebabecafebabecafebabe",
  cover: "https://image-cdn-ak.spotifycdn.com/image/1bad1bad1bad1bad1bad1bad1bad1bad1bad1bad",
  art1: "https://image-cdn-ak.spotifycdn.com/image/feedfacefeedfacefeedfacefeedfacefeedface",
  art2: "https://image-cdn-ak.spotifycdn.com/image/0badf00d0badf00d0badf00d0badf00d0badf00d",
};

const PLAYLIST_ID = "37i9dQZF1DXcBWIGoYBM5M";
const PLAYLIST_ID_2 = "37i9dQZF1DXcBWIGoYBM6M";
const USER_ID = "aaaaaaaaaaaaaaaaaaaaaa";

function boot() {
  const { JSDOM } = require("jsdom");
  const idb = require("fake-indexeddb");
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "https://xpui.app.spotify.com/",
    pretendToBeVisual: true,
  });
  const win = dom.window;
  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.indexedDB = idb.indexedDB;
  globalThis.IDBKeyRange = idb.IDBKeyRange;
  globalThis.PWT = { appDir: ROOT };
  // The scheduler singleton lives on the global, so a second boot() in the same
  // process would otherwise inherit the previous test's scheduler and deps and
  // report isBooted() === true before this test armed anything. node --test
  // isolates files into separate processes, but two boot() calls in ONE file
  // (net-errors, logic-bugs) share the global.
  delete globalThis.__PWT_BOOT__;
  delete globalThis.__pwtToastSeen;
  // Kill switch: the art sweep must never hit the real network in tests/harness.
  globalThis.PWT_ART_DISABLED = true;
  // And neither may anything else: in node, global fetch is real network. A
  // source chain that falls through to the embed page must not answer with a
  // live web page's data in a test.
  globalThis.fetch = function () {
    return Promise.reject(new TypeError("Failed to fetch"));
  };
  if (!win.Element.prototype.remove) {
    win.Element.prototype.remove = function () {
      if (this.parentNode) this.parentNode.removeChild(this);
    };
  }

  const FILES = require(path.join(ROOT, "index.js"));
  for (const f of FILES) {
    const code = fs.readFileSync(path.join(ROOT, f), "utf8");
    new Function(code + "\n//# sourceURL=" + f)();
  }

  let realSpicetify;
  Object.defineProperty(win, "Spicetify", {
    configurable: true,
    get: function () {
      return realSpicetify;
    },
    set: function (v) {
      realSpicetify = v;
    },
  });

  return {
    win: win,
    P: globalThis.PWT,
    setSpicetify: function (v) {
      realSpicetify = v;
      win.Spicetify = v;
    },
  };
}

/** A minimal but honest XPUI History: push/listen/goBack/goForward with a real stack. */
function makeHistory(calls) {
  const hist = {
    location: { pathname: "/Spotispy/", state: { route: "overview" } },
    _stack: [{ pathname: "/Spotispy/", state: { route: "overview" } }],
    _index: 0,
    _listeners: [],
    push: function (loc) {
      const next = { pathname: String((loc && loc.pathname) || "/Spotispy/"), state: (loc && loc.state) || {} };
      hist._stack = hist._stack.slice(0, hist._index + 1);
      hist._stack.push(next);
      hist._index = hist._stack.length - 1;
      hist.location = next;
      calls.nav.push({ op: "push", pathname: next.pathname });
      hist._emit();
    },
    replace: function (loc) {
      const next = { pathname: String((loc && loc.pathname) || "/Spotispy/"), state: (loc && loc.state) || {} };
      hist._stack[hist._index] = next;
      hist.location = next;
      calls.nav.push({ op: "replace", pathname: next.pathname });
      hist._emit();
    },
    listen: function (fn) {
      hist._listeners.push(fn);
      return function () {
        hist._listeners = hist._listeners.filter(function (l) { return l !== fn; });
      };
    },
    goBack: function () {
      calls.nav.push({ op: "goBack" });
      if (hist._index > 0) {
        hist._index -= 1;
        hist.location = hist._stack[hist._index];
        hist._emit();
      }
    },
    goForward: function () {
      calls.nav.push({ op: "goForward" });
      if (hist._index < hist._stack.length - 1) {
        hist._index += 1;
        hist.location = hist._stack[hist._index];
        hist._emit();
      }
    },
    _emit: function () {
      hist._listeners.slice().forEach(function (l) {
        try { l(hist.location); } catch (e) { /* listener errors must not break navigation */ }
      });
    },
    /** Test double: drop the whole stack back to the initial state. */
    reset: function () {
      hist._stack = [{ pathname: "/Spotispy/", state: { route: "overview" } }];
      hist._index = 0;
      hist.location = hist._stack[0];
      hist._listeners = [];
    },
  };
  return hist;
}

/** A Spotify client stub: Cosmos routes answered from memory, no network. */
function stubSpicetify(win, calls) {
  const React = require("react");
  const ReactDOMClient = require("react-dom/client");
  // Older tests build their own `calls` literal; keep the PlaylistAPI log present
  // either way so the stub never throws on a missing array.
  calls.playlistApi = calls.playlistApi || { getContents: [], getMetadata: [] };
  // The modules read the client through `globalThis.Spicetify` or the jsdom
  // window's; both must be the stub, or a route silently reads as "not present".
  const stub = {
    React: React,
    ReactDOM: ReactDOMClient,
    showNotification: function (msg) {
      calls.toasts.push(msg);
    },
    LocalStorage: {
      get: function (k) {
        return win.localStorage.getItem(k);
      },
      set: function (k, v) {
        return win.localStorage.setItem(k, v);
      },
    },
    Platform: {
      History: makeHistory(calls),
      PlaylistAPI: {
        getContents: async function (uri, offset, limit) {
          calls.playlistApi.getContents.push({ uri: uri, offset: offset, limit: limit });
          const h = calls.handlers.find(function (x) { return x.test(uri); });
          if (!h || !h.contents) throw new Error("no playlist contents for " + uri);
          return typeof h.contents === "function" ? h.contents(uri, offset, limit) : h.contents;
        },
        getMetadata: async function (uri) {
          calls.playlistApi.getMetadata.push({ uri: uri });
          const h = calls.handlers.find(function (x) { return x.test(uri); });
          if (!h || !h.meta) throw new Error("no playlist metadata for " + uri);
          return typeof h.meta === "function" ? h.meta(uri) : h.meta;
        },
      },
    },
    CosmosAsync: {
      get: async function (url) {
        calls.get.push(url);
        const h = calls.handlers.find(function (x) { return x.test(url); });
        if (!h) throw new Error("HTTP 404 for " + url);
        return typeof h.value === "function" ? h.value(url) : h.value;
      },
      post: async function (url, body) {
        calls.post.push({ url: url, body: body });
        const h = calls.handlers.find(function (x) { return x.test(url); });
        if (!h) throw new Error("HTTP 404 for " + url);
        return typeof h.value === "function" ? h.value(url, body) : h.value;
      },
      put: async function () { return {}; },
      del: async function () { return {}; },
    },
  };
  globalThis.Spicetify = stub;
  win.Spicetify = stub;
  return stub;
}

/** Synthetic playlist/profile/tracks with covers, art and dates. */
function fixtures() {
  const T0 = Date.now() - 3 * 86400000;
  const tracks = [
    { uri: "spotify:track:1111111111111111111111", title: "First Light", artist: "Nova", album: "Dawn", art: ART.art1 },
    { uri: "spotify:track:2222222222222222222222", title: "Paper Boats", artist: "Kite", album: "Drift", art: ART.art2 },
    { uri: "spotify:track:3333333333333333333333", title: "Slow Trains", artist: "Ember", album: "Lines", art: ART.art2 },
  ];
  return {
    T0: T0,
    tracks: tracks,
    playlistId: PLAYLIST_ID,
    userId: USER_ID,
    art: ART,
    rows: function () {
      return tracks.map(function (t, i) {
        return { uri: t.uri, addedAt: T0 + i * 1000, addedBy: "someone" };
      });
    },
  };
}

/** Answer every endpoint the app knows, from memory. */
function stubHandlers(fx, calls) {
  calls.handlers.push({
    test: function (u) { return /core-playlist\/v1\/playlist\/.*\/rows/.test(u); },
    value: function () { return { rows: fx.rows(), total: fx.tracks.length }; },
  });
  calls.handlers.push({
    test: function (u) { return /core-playlist\/v1\/playlist\/.*\/metadata/.test(u); },
    value: function (u) {
      return {
        name: u.indexOf(PLAYLIST_ID_2) >= 0 ? "Day Drive" : "Night Drive",
        owner: { username: fx.userId },
        followers: 42,
        image: u.indexOf(PLAYLIST_ID_2) >= 0 ? fx.art.art1 : fx.art.cover,
        description: "late night driving",
      };
    },
  });
  calls.handlers.push({
    test: function (u) { return u.indexOf("/user-profile-view/v3/profile/") >= 0 && u.indexOf("/followers") < 0 && u.indexOf("/following") < 0; },
    value: function () {
      return {
        uri: "spotify:user:" + fx.userId,
        name: "Ari",
        image: ART.avatarUser,
        followers_count: 128,
        public_playlists: [
          { uri: "spotify:playlist:" + fx.playlistId, name: "Night Drive", images: [{ url: ART.cover }] },
          { uri: "spotify:playlist:" + PLAYLIST_ID_2, name: "Day Drive", images: [{ url: ART.art1 }] },
        ],
      };
    },
  });
  calls.handlers.push({
    test: function (u) { return u.indexOf("/followers?market=from_token") >= 0; },
    value: function () { return { profiles: [{ uri: "spotify:user:bbbbbbbbbbbbbbbbbbbbbb" }] }; },
  });
  calls.handlers.push({
    test: function (u) { return u.indexOf("/listening-activity/v1/feed") >= 0; },
    value: function () {
      return {
        entities: [
          {
            userEntity: {
              uri: "spotify:user:" + fx.userId,
              name: "Ari",
              image: { url: ART.avatarFriend },
              activity: {
                entityUri: fx.tracks[0].uri,
                timestamp: new Date(Date.now() - 120000).toISOString(),
                isPlaying: true,
                contextUri: "spotify:playlist:" + fx.playlistId,
              },
            },
          },
        ],
      };
    },
  });
  calls.handlers.push({
    test: function (u) { return /api\.spotify\.com\/v1\/playlists\/.*\/tracks/.test(u); },
    value: function (u) {
      var id = u.split("/v1/playlists/")[1].split("/tracks")[0];
      if (id === PLAYLIST_ID_2) {
        return {
          items: [
            {
              track: { uri: fx.tracks[0].uri },
              added_at: new Date(fx.T0).toISOString(),
              added_by: { id: "someone" },
            },
          ],
          total: 1,
        };
      }
      return {
        items: fx.tracks.map(function (t, i) {
          return {
            track: { uri: t.uri },
            added_at: new Date(fx.T0 + i * 1000).toISOString(),
            added_by: { id: "someone" },
          };
        }),
        total: fx.tracks.length,
      };
    },
  });
  calls.handlers.push({
    test: function (u) { return u.indexOf("https://api.spotify.com/v1/tracks/") === 0; },
    value: function (u) {
      const id = u.split("/tracks/")[1].split("?")[0];
      const t = fx.tracks.find(function (x) { return x.uri.endsWith(id); });
      return {
        name: t ? t.title : id,
        artists: [{ name: t ? t.artist : "?" }],
        album: { name: t ? t.album : "?", images: [{ url: t ? t.art : "" }] },
        duration_ms: 210000,
      };
    },
  });
  calls.handlers.push({
    test: function (u) { return u === "sp://desktop/v1/version"; },
    value: function () { return { version: "1.2.3.abc" }; },
  });
  calls.handlers.push({
    test: function (u) { return u === "https://api.spotify.com/v1/me"; },
    value: function () { return { id: "harness-me", display_name: "Harness Me" }; },
  });
  // The client's own playlist route (what Spotispy actually reads through, and
  // what the self-test probes) answers for the seeded playlist.
  // The client route reads the playlist's own items, each carrying its title,
  // artists, album and cover. These are what the scan writes to the track cache,
  // so the playlist view renders real rows instead of "Unknown track".
  pa.addPlaylist(calls, {
    id: PLAYLIST_ID,
    name: "Night Drive",
    cover: ART.cover,
    tracks: [
      {
        uri: fx.tracks[0].uri,
        addedAt: new Date(fx.T0).toISOString(),
        addedBy: "spotify",
      },
      {
        uri: fx.tracks[1].uri,
        addedAt: new Date(fx.T0 + 1000).toISOString(),
        addedBy: "spotify",
      },
      {
        uri: fx.tracks[2].uri,
        addedAt: new Date(fx.T0 + 2000).toISOString(),
        addedBy: "spotify",
      },
    ],
  });
  pa.addPlaylist(calls, {
    id: PLAYLIST_ID_2,
    name: "Day Drive",
    cover: ART.art1,
    tracks: [{ uri: fx.tracks[0].uri, addedAt: new Date(fx.T0).toISOString(), addedBy: "spotify" }],
  });
}

/** Watch one playlist + one profile, then run a real scan so the DB has rows. */
async function seed(P, fx) {
  await P.store.putWatch({ kind: "playlist", id: fx.playlistId });
  await P.store.putWatch({ kind: "profile", id: fx.userId });
  const booted = P.boot.ensure({ onScanDone: function () {} });
  await booted.scheduler.runNow({ scope: "all", force: true });
  await booted.scheduler.activityTick();
  return booted;
}

/** Mount a component with React and return its HTML. */
async function render(P, win, component, props) {
  const el = win.document.createElement("div");
  win.document.body.appendChild(el);
  P.react.mount(el, component, props || {});
  await new Promise(function (r) { setTimeout(r, 120); });
  return el.innerHTML;
}

module.exports = {
  ROOT: ROOT,
  ART: ART,
  PLAYLIST_ID: PLAYLIST_ID,
  PLAYLIST_ID_2: PLAYLIST_ID_2,
  USER_ID: USER_ID,
  boot: boot,
  stubSpicetify: stubSpicetify,
  fixtures: fixtures,
  stubHandlers: stubHandlers,
  seed: seed,
  render: render,
};
