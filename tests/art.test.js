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
