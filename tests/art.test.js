"use strict";
/**
 * Spotispy — art layer unit tests.
 *
 * The artwork layer is additive and network-free in tests: the kill switch
 * PWT_ART_DISABLED disables it entirely, embed parsing is pure string work,
 * and URI validation rejects anything that is not a known entity.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");

globalThis.PWT = globalThis.PWT || {};
globalThis.PWT_ART_DISABLED = false;
const Art = require("../src/pwt/core/art.js");

function embed(entity) {
  var doc = { props: { pageProps: { state: { data: { entity: entity } } } } };
  return (
    '<!doctype html><html><head><script id="__NEXT_DATA__" type="application/json">' +
    JSON.stringify(doc) +
    "</scr" +
    "ipt></head><body></body></html>"
  );
}

function memStore() {
  var data = {};
  return {
    getMeta: function (key, fallback) {
      return Promise.resolve(data[key] === undefined ? fallback : data[key]);
    },
    setMeta: function (key, value) {
      data[key] = value;
      return Promise.resolve();
    },
  };
}

test("parseArtResponse picks the largest visualIdentity image", () => {
  var html = embed({
    visualIdentity: {
      image: [
        { url: "https://i.example/small.jpg", maxWidth: 300 },
        { url: "https://i.example/large.jpg", maxWidth: 640 },
        { url: "https://i.example/mid.jpg", maxWidth: 480 },
      ],
    },
  });
  assert.equal(Art.parseArtResponse(html), "https://i.example/large.jpg");
});

test("parseArtResponse keeps the image array when coverArt is an empty string", () => {
  var html = embed({
    coverArt: "",
    visualIdentity: { image: [{ url: "https://i.example/editorial.jpg", maxWidth: 640 }] },
  });
  assert.equal(Art.parseArtResponse(html), "https://i.example/editorial.jpg");
});

test("parseArtResponse falls back to the last coverArt array entry", () => {
  var html = embed({
    coverArt: [{ url: "https://i.example/small.jpg" }, { url: "https://i.example/big.jpg" }],
  });
  assert.equal(Art.parseArtResponse(html), "https://i.example/big.jpg");
});

test("parseArtResponse falls back to the last coverArt.sources entry", () => {
  var html = embed({
    coverArt: { sources: [{ url: "https://i.example/s1.jpg" }, { url: "https://i.example/s2.jpg" }] },
  });
  assert.equal(Art.parseArtResponse(html), "https://i.example/s2.jpg");
});

test("parseArtResponse tolerates attribute order in the script tag", () => {
  var doc = { props: { pageProps: { state: { data: { entity: { visualIdentity: { image: [{ url: "https://i.example/any-order.jpg", maxWidth: 640 }] } } } } } } };
  var html =
    '<!doctype html><html><script type="application/json" data-x-y="1" id="__NEXT_DATA__">' + JSON.stringify(doc) + "</scr" + "ipt></html>";
  assert.equal(Art.parseArtResponse(html), "https://i.example/any-order.jpg");
});

test("parseArtResponse returns null on garbage input", () => {
  assert.equal(Art.parseArtResponse("not html at all"), null);
  assert.equal(Art.parseArtResponse('<script id="__NEXT_DATA__">{broken</scr' + 'ipt>'), null);
  assert.equal(Art.parseArtResponse(""), null);
  assert.equal(Art.parseArtResponse(null), null);
});

test("specEmbed builds embed urls for the four kinds and rejects the rest", () => {
  globalThis.PWT_ART_DISABLED = false;
  var id = "A".repeat(22);
  for (const kind of ["track", "playlist", "artist", "album"]) {
    var spec = Art.specEmbed("spotify:" + kind + ":" + id);
    assert.deepEqual(spec, { method: "fetch", url: "https://open.spotify.com/embed/" + kind + "/" + id, format: "text" });
  }
  assert.equal(Art.specEmbed("spotify:episode:" + id), null);
  assert.equal(Art.specEmbed("spotify:track:" + "A".repeat(21)), null);
  assert.equal(Art.specEmbed("spotify:track:" + "A".repeat(41)), null);
  assert.equal(Art.specEmbed("spotify:track:" + "A".repeat(22) + "!"), null);
  assert.equal(Art.specEmbed("spotify:user:abc"), null);
  assert.equal(Art.specEmbed(""), null);
  assert.equal(Art.specEmbed(null), null);
});

test("two failures then success caches the art with attempts reset to 0", async () => {
  globalThis.PWT_ART_DISABLED = false;
  var TRACK = "spotify:track:" + "B".repeat(22);
  var netCalls = 0;
  globalThis.PWT = {
    net: {
      call: function () {
        netCalls++;
        if (netCalls <= 2) return Promise.reject(new Error("boom"));
        return Promise.resolve(embed({ visualIdentity: { image: [{ url: "https://i.example/art.jpg", maxWidth: 640 }] } }));
      },
    },
    store: memStore(),
  };
  var r1 = await Art.artFor(TRACK, {});
  var r2 = await Art.artFor(TRACK, {});
  var r3 = await Art.artFor(TRACK, {});
  var r4 = await Art.artFor(TRACK, {});
  assert.equal(r1, "");
  assert.equal(r2, "");
  assert.equal(r3, "https://i.example/art.jpg");
  assert.equal(r4, "https://i.example/art.jpg", "the 4th call must hit the cache, not the network");
  assert.equal(netCalls, 3, "the 4th call must not call the network again");
  var stored = await globalThis.PWT.store.getMeta("art:" + TRACK, null);
  assert.equal(stored.attempts, 0, "a success resets the attempts counter");
});

test("three failures make the cache give up and stop hitting the network", async () => {
  globalThis.PWT_ART_DISABLED = false;
  var TRACK = "spotify:track:" + "C".repeat(22);
  var netCalls = 0;
  globalThis.PWT = {
    net: {
      call: function () {
        netCalls++;
        return Promise.reject(new Error("boom"));
      },
    },
    store: memStore(),
  };
  assert.equal(await Art.artFor(TRACK, {}), "");
  assert.equal(await Art.artFor(TRACK, {}), "");
  assert.equal(await Art.artFor(TRACK, {}), "");
  assert.equal(netCalls, 3);
  assert.equal(await Art.artFor(TRACK, {}), "");
  assert.equal(netCalls, 3, "the 4th call must not reach the network");
});

test("a cached spotify:image response is served as a real URL without a fetch", async () => {
  globalThis.PWT_ART_DISABLED = false;
  var USER = "spotify:user:" + "C".repeat(22);
  var netCalls = 0;
  globalThis.PWT = {
    util: require("../src/pwt/util/util.js"),
    net: {
      call: function () {
        netCalls++;
        return Promise.resolve(embed({}));
      },
    },
    store: memStore(),
  };
  await globalThis.PWT.store.setMeta("art:" + USER, { ref: "spotify:image:abc123", at: Date.now(), attempts: 0 });
  var url = await Art.artFor(USER, {});
  assert.equal(url, "https://i.scdn.co/image/abc123", "the ref must be converted, not re-fetched");
  assert.equal(netCalls, 0, "a cached ref must not hit the network");
});

test("artFor returns empty and never calls the network when PWT_ART_DISABLED is set", async () => {
  globalThis.PWT_ART_DISABLED = true;
  var netCalls = 0;
  globalThis.PWT = {
    net: {
      call: function () {
        netCalls++;
        return Promise.resolve(embed({ visualIdentity: { image: [{ url: "https://i.example/art.jpg", maxWidth: 640 }] } }));
      },
    },
    store: memStore(),
  };
  try {
    assert.equal(await Art.artFor("spotify:track:" + "D".repeat(22), {}), "");
    assert.equal(netCalls, 0, "artFor touched the network despite the kill switch");
  } finally {
    globalThis.PWT_ART_DISABLED = false;
  }
});

test("sweep is a no-op when PWT_ART_DISABLED is set", async () => {
  globalThis.PWT_ART_DISABLED = true;
  var calls = [];
  var netCalls = 0;
  globalThis.PWT = {
    net: {
      call: function () {
        netCalls++;
        return Promise.reject(new Error("must not be called"));
      },
      pool: function () {
        calls.push("pool");
        return Promise.reject(new Error("must not be called"));
      },
    },
    store: {},
    db: {},
  };
  var deps = {
    db: {
      getAll: function () {
        calls.push("getAll");
        return Promise.reject(new Error("must not be called"));
      },
      get: function () {
        calls.push("get");
        return Promise.reject(new Error("must not be called"));
      },
    },
    store: {
      getMeta: function () {
        calls.push("getMeta");
        return Promise.reject(new Error("must not be called"));
      },
      setMeta: function () {
        calls.push("setMeta");
        return Promise.reject(new Error("must not be called"));
      },
    },
  };
  try {
    var out = await Art.sweep(deps, { limit: 30 });
    assert.deepEqual(out, { skipped: true });
    assert.deepEqual(calls, [], "sweep touched the database despite the kill switch");
    assert.equal(netCalls, 0, "sweep touched the network despite the kill switch");
  } finally {
    globalThis.PWT_ART_DISABLED = false;
  }
});

test("sweep clears a missing playlist cover on the playlist row itself", async () => {
  // The gap is a missing `coverUrl` on the playlist row, and artFor caches the
  // URL under `meta:art:`. Without a write-back to the row, the same playlist is
  // re-fetched on every sweep forever, starving the newer gaps behind it.
  globalThis.PWT_ART_DISABLED = false;
  var playlistRow = { id: "37i9dQZF1DXcBWIGoYBM5M", name: "Night Drive", coverUrl: "" };
  var writes = [];
  var artCalls = 0;
  globalThis.PWT = {
    // playlistCover() resolves a playlist's cover from the watched profiles'
    // own play lists — no network — so seed one.
    util: { imageUrl: function (r) { return r; } },
    net: {
      pool: function (items, _size, worker) {
        // The real pool returns { results: [...] }, where each entry is
        // { ok, value } — sweep counts the `value` entries.
        return Promise.all(
          items.map(function (item) {
            return worker(item).then(function (v) { return { ok: true, value: v }; });
          })
        ).then(function (results) {
          return { results: results };
        });
      },
    },
    store: {},
    db: {},
  };

  var deps = {
    db: {
      getAll: function (name) {
        if (name === "playlists") return Promise.resolve([playlistRow]);
        if (name === "profiles") {
          return Promise.resolve([
            { id: "u1", avatarUrl: "https://i.scdn.co/image/avatar", plays: [{ uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M", cover: "https://i.scdn.co/image/found" }] },
          ]);
        }
        return Promise.resolve([]);
      },
      get: function (store, id) {
        if (store === "playlists" && id === "37i9dQZF1DXcBWIGoYBM5M") return Promise.resolve(playlistRow);
        return Promise.resolve(null);
      },
      put: function (store, row) {
        writes.push({ store: store, row: row });
        if (store === "playlists") playlistRow = row;
        return Promise.resolve();
      },
    },
    store: { getMeta: function () { return Promise.resolve(null); }, setMeta: function () { return Promise.resolve(); } },
  };
  try {
    var out = await Art.sweep(deps, { limit: 10 });
    assert.equal(out.checked, 1, "the playlist gap was checked: " + JSON.stringify(out));
    assert.equal(out.filled, 1, "and filled: " + JSON.stringify(out));
    assert.equal(playlistRow.coverUrl, "https://i.scdn.co/image/found", "the cover is written back to the playlist row");
    assert.equal(writes.length, 1, "exactly one write");
    assert.equal(writes[0].store, "playlists", "to the playlist store");

    // A second sweep must not re-fetch it: the gap is gone.
    var before = artCalls;
    var out2 = await Art.sweep(deps, { limit: 10 });
    assert.equal(out2.checked, 0, "nothing left to fetch: " + JSON.stringify(out2));
    assert.equal(artCalls, before, "and no network call was made");
  } finally {
    globalThis.PWT_ART_DISABLED = false;
  }
});

test("sweep leaves a cover that a scan already resolved", async () => {
  // A concurrent scan may have filled the row while the fetch was in flight.
  // The sweep must not overwrite it.
  globalThis.PWT_ART_DISABLED = false;
  var playlistRow = { id: "PL2", name: "Day Drive", coverUrl: "" };
  globalThis.PWT = {
    art: { artFor: function () { return Promise.resolve("https://i.scdn.co/image/sweep"); } },
    net: {
      pool: function (items, _s, worker) {
        return Promise.all(items.map(function (item) { return worker(item).then(function (v) { return { ok: true, value: v }; }); }))
          .then(function (results) { return { results: results }; });
      },
    },
    store: {}, db: {},
  };
  var deps = {
    db: {
      getAll: function (n) {
        if (n === "playlists") return Promise.resolve([playlistRow]);
        return Promise.resolve([]);
      },
      get: function (store, id) {
        // The row gained a cover while the fetch was running.
        if (store === "playlists" && id === "PL2") return Promise.resolve({ id: "PL2", name: "Day Drive", coverUrl: "https://i.scdn.co/image/scan" });
        return Promise.resolve(null);
      },
      put: function () { return Promise.reject(new Error("must not write over a resolved cover")); },
    },
    store: { getMeta: function () { return Promise.resolve(null); }, setMeta: function () { return Promise.resolve(); } },
  };
  try {
    var out = await Art.sweep(deps, { limit: 10 });
    assert.equal(out.filled, 0, "the sweep did not overwrite the scanned cover: " + JSON.stringify(out));
  } finally {
    globalThis.PWT_ART_DISABLED = false;
  }
});
