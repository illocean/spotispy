"use strict";
/**
 * Spec: the playlist read path uses the client's own `Platform.PlaylistAPI`.
 *
 * Verified live on this machine (Spotify 1.3.9.2055 / Spicetify 2.46.4):
 *   CosmosAsync.get("https://api.spotify.com/v1/me")
 *     -> resolves {code:429, error:"", message:"Failed to fetch"}
 *   the same request through the renderer's own fetch() -> 401
 * so the Web API is not reachable from the client at all, and the self-test
 * reported "unreachable - Failed to fetch" for both Web API probes.
 *
 *   Spicetify.Platform.PlaylistAPI.getContents(uri)  -> {items, offset, limit, totalLength}
 *   Spicetify.Platform.PlaylistAPI.getMetadata(uri)  -> {name, images, owner, totalLikes, ...}
 * answered in-process, so that is the route Spotispy reads through.
 *
 *   npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { boot, stubSpicetify } = require("./support/harness.js");
const pa = require("./support/playlist-api.js");
const Playlists = require("../src/pwt/core/playlists.js");
const Sources = require("../src/pwt/core/sources.js");
const Util = require("../src/pwt/util/util.js");
const RealNet = require("../src/pwt/core/net.js");

const ID = "37i9dQZF1DXcBWIGoYBM5M";

function fresh() {
  const { win, P } = boot();
  const calls = { toasts: [], nav: [], get: [], post: [], handlers: [] };
  stubSpicetify(win, calls);
  // The real net door already routes the client spec; only its HTTP path needs
  // to be dead, which is what the live client does for api.spotify.com.
  const realNet = P.net;
  realNet.request = function () { return Promise.reject(new Error("no HTTP route on this client")); };
  // The embed source uses the renderer's fetch; offline in tests.
  globalThis.fetch = function () { return Promise.reject(new TypeError("Failed to fetch")); };
  return { P: P, calls: calls };
}

test("fetchContents reads a playlist through the client's PlaylistAPI", async () => {
  const { P, calls } = fresh();
  try {
    const tracks = [
      { uri: pa.trackUri(1), addedAt: "2026-11-01T00:00:00.000Z", addedBy: "spotify" },
      { uri: pa.trackUri(2), addedAt: "2026-11-02T00:00:00.000Z", addedBy: "spotify" },
    ];
    pa.addPlaylist(calls, { id: ID, name: "Night Drive", tracks: tracks });

    const res = await Playlists.fetchContents(ID);
    assert.equal(res.source, "client", "the read came from the client's own API: " + res.source);
    assert.deepEqual(res.uris, [pa.trackUri(1), pa.trackUri(2)]);
    assert.equal(res.total, 2);
    assert.equal(res.capped, false, "a complete read is not capped");
    assert.ok(res.added[pa.trackUri(1)], "added_at survives from the client route");
    assert.equal(res.added[pa.trackUri(1)].addedBy, "spotify", "and so does added_by");
    assert.equal(calls.playlistApi.getContents.length, 1, "the client route was asked once");
    await P.db.close();
  } finally {
    await P.db.close();
  }
});

test("fetchContents: a client read with fewer items than totalLength is capped", async () => {
  const { P, calls } = fresh();
  try {
    pa.addPlaylist(calls, { id: ID, total: 500, tracks: [{ uri: pa.trackUri(9) }] });
    const res = await Playlists.fetchContents(ID);
    assert.equal(res.capped, true, "fewer items than totalLength must be capped, never a full snapshot");
    assert.equal(res.total, 500);
    assert.equal(res.uris.length, 1);
  } finally {
    await P.db.close();
  }
});

test("fetchContents: a client route that cannot answer is recorded, then the chain moves on", async () => {
  const { P, calls } = fresh();
  try {
    // Every route that could answer is dead: the client route throws, and the
    // core resolver returns no rows (as an unregistered resolver does).
    calls.handlers.push({
      test: function (u) { return String(u).indexOf("spotify:playlist:" + ID) >= 0; },
      contents: function () { throw new Error("playlist not found"); },
    });
    calls.handlers.push({
      test: function (u) { return /core-playlist\/v1\/playlist\/.*\/rows/.test(u); },
      value: { rows: [], total: 0 },
    });
    const err = await Playlists.fetchContents(ID).then(
      function () { return null; },
      function (e) { return e; }
    );
    assert.ok(err, "no source carried tracks, so the read throws instead of logging an empty playlist");
    const attempts = (err.attempts || []).map(function (a) { return a.source + ":" + a.ok; });
    assert.ok(attempts.indexOf("client:false") >= 0, "the client failure is recorded: " + JSON.stringify(attempts));
  } finally {
    await P.db.close();
  }
});

test("fetchContents: a short client read is capped, never a full snapshot", async () => {
  const { P, calls } = fresh();
  try {
    // totalLength says 500 but only one item comes back: the read is partial,
    // so it must be capped or the next scan diffs a truncation into removals.
    pa.addPlaylist(calls, { id: ID, total: 500, tracks: [{ uri: pa.trackUri(4) }] });
    const res = await Playlists.fetchContents(ID);
    assert.equal(res.source, "client");
    assert.equal(res.capped, true, "a short read must be capped");
  } finally {
    await P.db.close();
  }
});

test("fetchContents: with no PlaylistAPI the old chain still runs and reports honestly", async () => {
  const { P, calls } = fresh();
  try {
    // Remove the client route, as on a build that does not expose it.
    const stub = globalThis.Spicetify;
    const saved = stub.Platform.PlaylistAPI;
    delete stub.Platform.PlaylistAPI;
    calls.handlers.push({ test: function () { return true; }, value: { code: 429, message: "Failed to fetch" } });

    const err = await Playlists.fetchContents(ID).then(
      function () { return null; },
      function (e) { return e; }
    );
    assert.ok(err, "with no working source it throws");
    assert.ok(!/web api 429/.test(err.message), "and never invents a 429: " + err.message);
    stub.Platform.PlaylistAPI = saved;
  } finally {
    await P.db.close();
  }
});

test("fetchMeta prefers the client's own playlist metadata", async () => {
  const { P, calls } = fresh();
  try {
    pa.addPlaylist(calls, {
      id: ID,
      name: "Night Drive",
      cover: "https://i.scdn.co/image/abc",
      followers: 42,
      owner: "someone",
    });
    const meta = await Playlists.fetchMeta(ID);
    assert.equal(meta.name, "Night Drive", "the name came from the client route");
    assert.equal(meta.coverUrl, "https://i.scdn.co/image/abc");
    assert.equal(meta.followers, 42, "a real follower count, not a placeholder");
    assert.equal(calls.playlistApi.getMetadata.length, 1, "the client route was asked once");
  } finally {
    await P.db.close();
  }
});