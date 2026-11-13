"use strict";
/**
 * Spotispy — track metadata and art resolution tests.
 *
 * Two behaviours the user reported as broken, pinned by test:
 *  - the post-scan metadata pass must actually persist the rows it fetches
 *    (it used to drop them on the floor, so tracks stayed "Unknown track"
 *    with a gradient tile);
 *  - album art must come from the client's own GraphQL (which answers) when
 *    the embed page does not.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");

globalThis.PWT_ART_DISABLED = false;

const U = require("../src/pwt/util/util.js");
const Playlists = require("../src/pwt/core/playlists.js");

function trackUri(c) {
  return "spotify:track:" + c.repeat(22);
}

test("fetchTrackMetadata persists the rows it fetches", async () => {
  const put = [];
  const tracks = {};
  const db = {
    get: function (store, key) {
      return Promise.resolve(tracks[key]);
    },
    batch: function (ops) {
      for (const op of ops) if (op[1] === "put") tracks[op[2].uri] = op[2];
      put.push(...ops);
      return Promise.resolve();
    },
  };
  const net = {
    call: function (spec) {
      if (spec && spec.url && spec.url.indexOf("api.spotify.com/v1/tracks/") >= 0) {
        return Promise.resolve({
          name: "Never Gonna Give You Up",
          artists: [{ name: "Rick Astley" }],
          album: {
            name: "Whenever You Need Somebody",
            images: [{ url: "https://i.scdn.co/image/b00b5b00b5b00b5b00b5b00b5b00b5b00b5b00b5" }],
          },
          duration_ms: 213000,
        });
      }
      return Promise.reject(new Error("unexpected call: " + (spec && spec.url)));
    },
    pool: async function (items, limit, task) {
      const results = [];
      for (const item of items) {
        let ok = true;
        let value;
        try {
          value = await task(item);
        } catch (e) {
          ok = false;
        }
        results.push({ ok: ok, value: value });
      }
      return { results: results, errors: [] };
    },
  };
  globalThis.PWT = {
    util: U,
    sources: {
      ENDPOINTS: {
        trackViaClient: function () {
          return null; // no client GraphQL in this test; the Web API answers
        },
        track: function (id) {
          return { method: "get", url: "https://api.spotify.com/v1/tracks/" + id + "?market=from_token" };
        },
      },
    },
  };
  const n = await Playlists.fetchTrackMetadata({ db: db, net: net }, [trackUri("1")], 10);
  assert.equal(n, 1, "one row written");
  assert.equal(put.length, 1);
  assert.equal(put[0][0], "tracks");
  assert.equal(put[0][2].title, "Never Gonna Give You Up");
  assert.equal(put[0][2].art, "https://i.scdn.co/image/b00b5b00b5b00b5b00b5b00b5b00b5b00b5b00b5");
  // A second pass is a cache hit: nothing fetched, nothing written.
  const n2 = await Playlists.fetchTrackMetadata({ db: db, net: net }, [trackUri("1")], 10);
  assert.equal(n2, 0);
});

test("artFor resolves track art through the client's GraphQL, not the embed page", async () => {
  const Art = require("../src/pwt/core/art.js");
  const TRACK = trackUri("2");
  const calls = [];
  const mem = {};
  globalThis.PWT = {
    util: U,
    sources: {
      ENDPOINTS: {
        trackViaClient: function (uri) {
          return { client: "graphql", def: { name: "getTrack" }, vars: { uri: uri } };
        },
      },
    },
    net: {
      call: function (spec) {
        calls.push(spec);
        if (spec && spec.client === "graphql") {
          return Promise.resolve({
            data: {
              trackUnion: {
                name: "Test Track",
                albumOfTrack: {
                  name: "Test Album",
                  coverArt: {
                    sources: [
                      { url: "https://i.scdn.co/image/small", width: 64 },
                      { url: "https://i.scdn.co/image/large", width: 640 },
                      { url: "https://i.scdn.co/image/mid", width: 300 },
                    ],
                  },
                },
                firstArtist: { items: [{ profile: { name: "An Artist" } }] },
                otherArtists: { items: [] },
                duration: { totalMilliseconds: 1000 },
              },
            },
          });
        }
        return Promise.reject(new Error("the embed route must not be needed"));
      },
    },
    store: {
      getMeta: function (key, fallback) {
        return Promise.resolve(mem[key] === undefined ? fallback : mem[key]);
      },
      setMeta: function (key, value) {
        mem[key] = value;
        return Promise.resolve();
      },
    },
  };
  const url = await Art.artFor(TRACK, {});
  assert.equal(url, "https://i.scdn.co/image/large", "the largest cover wins");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].client, "graphql", "the GraphQL route was used");
});

test("artFor resolves a watched playlist's cover from stored profile data", async () => {
  const Art = require("../src/pwt/core/art.js");
  const PLAYLIST = "spotify:playlist:" + "3".repeat(22);
  const calls = [];
  const mem = {};
  globalThis.PWT = {
    util: U,
    net: {
      call: function () {
        calls.push("net");
        return Promise.reject(new Error("no network expected"));
      },
    },
    db: {
      getAll: function (store) {
        if (store !== "profiles") return Promise.resolve([]);
        return Promise.resolve([
          {
            id: "4".repeat(22),
            name: "Someone",
            plays: [
              { uri: PLAYLIST, name: "A Mix", cover: "spotify:mosaic:tileone:tiletwo" },
            ],
          },
        ]);
      },
    },
    store: {
      getMeta: function (key, fallback) {
        return Promise.resolve(mem[key] === undefined ? fallback : mem[key]);
      },
      setMeta: function (key, value) {
        mem[key] = value;
        return Promise.resolve();
      },
    },
  };
  const url = await Art.artFor(PLAYLIST, {});
  assert.equal(url, "spotify:mosaic:tileone:tiletwo", "the mosaic ref is kept so the UI can composite it");
  assert.equal(calls.length, 0, "no network was used for a stored cover");
});
