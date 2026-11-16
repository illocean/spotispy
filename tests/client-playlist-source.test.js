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
    assert.equal(calls.playlistApi.getMetadata.length, 1, "the client route was asked once");
    // The client route reports a LIKE counter (`totalLikes`), not a follower
    // count. It used to be mapped onto `followers`, which is the first source in
    // the chain and therefore wins over every later one — so a playlist whose
    // client metadata carried a like count showed it under the "followers"
    // label. Leaving it null hands the real count to `coreMeta`/`apiPlaylist`.
    assert.ok(meta.followers == null, "a like count is not reported as a follower count: " + meta.followers);
  } finally {
    await P.db.close();
  }
});

test("a source that names followers is used when the client route cannot answer", async () => {
  // The count is not dropped, just sourced honestly. The client route is tried
  // first and its payload has no followers field at all, so the Web API's
  // `followers.total` has to be the one that lands.
  const { P, calls } = fresh();
  try {
    // No client playlist registered: the chain falls through to HTTP.
    calls.handlers.push({
      test: function (u) {
        return String(u).indexOf("/v1/playlists/" + ID + "?") >= 0;
      },
      value: {
        name: "Night Drive",
        images: [{ url: "https://i.scdn.co/image/abc" }],
        owner: { id: "someone" },
        followers: { total: 42 },
        tracks: { total: 12 },
      },
    });
    const meta = await Playlists.fetchMeta(ID);
    assert.equal(meta.followers, 42, "the follower count comes from the Web API's followers.total: " + meta.followers);
  } finally {
    await P.db.close();
  }
});

test("keeps a like counter out of the followers field when nothing else answers", async () => {
  // The client route's payload has a LIKE counter, not a followers field. With
  // the HTTP chain unreachable there is no honest follower count to be had, so
  // the like counter must NOT be presented as one — it is carried separately and
  // the view labels it "likes".
  const { P, calls } = fresh();
  try {
    pa.addPlaylist(calls, { id: ID, name: "Night Drive", cover: "https://i.scdn.co/image/abc", followers: 999, owner: "someone" });
    // Make the Web API unreachable so it cannot supply a real count.
    calls.handlers = calls.handlers.filter(function (h) {
      return String(h.test("https://api.spotify.com/v1/playlists/" + ID + "?market=from_token")).indexOf("false") >= 0;
    });
    const meta = await Playlists.fetchMeta(ID);
    assert.ok(meta.followers == null, "a like counter is never shown as a follower count: " + meta.followers);
    assert.equal(meta.likesOnly, 999, "the like counter is reported under its own name: " + meta.likesOnly);
  } finally {
    await P.db.close();
  }
});

test("recovers the follower count from the Web API when the client route has none", async () => {
  // The client route answers name and cover but carries only a like counter, so
  // the old "fill followers from whichever source answered first" left the count
  // permanently missing. Ask specifically for it from a source that names it.
  const { P, calls } = fresh();
  try {
    pa.addPlaylist(calls, { id: ID, name: "Night Drive", cover: "https://i.scdn.co/image/abc", followers: 999, owner: "someone" });
    calls.handlers.push({
      test: function (u) {
        return String(u).indexOf("/v1/playlists/" + ID + "?") >= 0;
      },
      value: {
        name: "Night Drive",
        images: [{ url: "https://i.scdn.co/image/abc" }],
        owner: { id: "someone" },
        followers: { total: 42 },
        tracks: { total: 12 },
      },
    });
    const meta = await Playlists.fetchMeta(ID);
    assert.equal(meta.followers, 42, "the real count wins over the like counter: " + meta.followers);
    assert.ok(meta.likesOnly == null, "and the fallback is not flagged when a real count was found: " + meta.likesOnly);
  } finally {
    await P.db.close();
  }
});

test("clientContents: an episode in a complete playlist does not mark it truncated", async () => {
  // The defect: uris holds only spotify:track: entries while totalLength
  // counts every item, so a complete playlist of 10 tracks plus one podcast
  // episode compared 10 < 11 and was "capped" on every scan. A capped read
  // reseeds instead of diffing, so such a playlist never logged a change.
  const s = require("../src/pwt/core/sources.js");
  const mk = function (nTracks, nEpisodes, totalLength) {
    const items = [];
    for (let i = 0; i < nTracks; i++) items.push({ uri: pa.trackUri(i) });
    for (let i = 0; i < nEpisodes; i++) items.push({ uri: "spotify:episode:" + String(900000000000000000000 + i).slice(-22) });
    return { items: items, totalLength: totalLength == null ? items.length : totalLength };
  };

  const withEpisode = s.SOURCES.clientContents.parse(mk(10, 1, 11));
  assert.equal(withEpisode.uris.length, 10, "the ten tracks are all read");
  assert.equal(withEpisode.items, 11, "eleven items were carried");
  assert.equal(withEpisode.truncated, false, "a complete read that merely contains an episode is not truncated");

  const plain = s.SOURCES.clientContents.parse(mk(10, 0, 10));
  assert.equal(plain.truncated, false, "a complete playlist of only tracks is not truncated");
});

test("clientContents: a page shorter than the declared total is truncated", async () => {
  // The other direction, so the fix cannot simply disable the check.
  const s = require("../src/pwt/core/sources.js");
  const mk = function (nTracks, totalLength) {
    const items = [];
    for (let i = 0; i < nTracks; i++) items.push({ uri: pa.trackUri(i) });
    return { items: items, totalLength: totalLength };
  };

  assert.equal(s.SOURCES.clientContents.parse(mk(10, 500)).truncated, true, "500 claimed, 10 returned: truncated");
  assert.equal(s.SOURCES.clientContents.parse(mk(10, 11)).truncated, true, "11 claimed, 10 returned: truncated");

  // With no declared total there is nothing to contradict, so no claim is made.
  const bare = mk(10, undefined);
  delete bare.totalLength;
  assert.equal(s.SOURCES.clientContents.parse(bare).truncated, false, "no totalLength means no truncation claim");
});

test("fetchContents still reports a genuinely short client read as capped", async () => {
  // End to end: the parse flag has to reach the fetchContents result.
  const { P, calls } = fresh();
  try {
    pa.addPlaylist(calls, { id: ID, total: 500, tracks: [{ uri: pa.trackUri(9) }] });
    const res = await Playlists.fetchContents(ID);
    assert.equal(res.capped, true, "fewer items than totalLength is still capped");
    assert.equal(res.total, 500, "and the declared total is preserved");
  } finally {
    await P.db.close();
  }
});
