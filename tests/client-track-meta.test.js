"use strict";
/**
 * Spec: track metadata comes from the same read that finds the tracks.
 *
 * Verified live (Spotify 1.3.9.2055 / Spicetify 2.46.4):
 * `Platform.PlaylistAPI.getContents(uri)` returns every playlist item with its
 * full metadata inline — name, artists, album (with cover images), release date,
 * addedAt, addedBy, duration. The old parser read only `uri`, so titles were
 * dropped on the floor and the playlist view rendered "Unknown track" with an
 * empty artist, album and "Added by" column until a second metadata pass filled
 * them in. On this build that pass has no working route (GraphQL getTrack throws
 * HttpResponseError, api.spotify.com is unreachable), so the columns stayed blank.
 *
 *   npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { boot, stubSpicetify } = require("./support/harness.js");
const pa = require("./support/playlist-api.js");
const Sources = require("../src/pwt/core/sources.js");
const RealNet = require("../src/pwt/core/net.js");
const Util = require("../src/pwt/util/util.js");

const ID = "37i9dQZF1DXcBWIGoYBM5M";

/** A client item in exactly the shape the live build returns. */
const LIVE_ITEM = {
  type: "track",
  uri: "spotify:track:0000000000000000000000",
  name: "BbY WOW",
  album: {
    type: "album",
    uri: "spotify:album:1111111111111111111111",
    name: "NO ME ARREPIENTO DE SENTIR TANTO",
    artist: { type: "artist", uri: "spotify:artist:2222222222222222222222", name: "KAROL G" },
    images: [
      { url: "spotify:image:0badc0de0badc0de0badc0de0badc0de0badc0de", label: "standard" },
      { url: "spotify:image:0badf00d0badf00d0badf00d0badf00d0badf00d", label: "large" },
    ],
  },
  artists: [
    { type: "artist", uri: "spotify:artist:2222222222222222222222", name: "KAROL G" },
    { type: "artist", uri: "spotify:artist:3333333333333333333333", name: "Judeline" },
  ],
  release: { isoString: "2026-08-07T00:00:00.000Z", precision: "DAY" },
  addedAt: "2026-11-06T05:02:41.000Z",
  addedBy: { type: "user", uri: "spotify:user:spotify", username: "spotify", displayName: "Spotify" },
  duration: { milliseconds: 226000 },
};

function tracksOf(parsed) {
  return parsed.tracks[LIVE_ITEM.uri];
}

test("parse reads the track metadata the client already returned", () => {
  const parsed = Sources.SOURCES.clientContents.parse({ items: [LIVE_ITEM], offset: 0, limit: 100, totalLength: 1 });
  const t = tracksOf(parsed);
  assert.ok(t, "a track entry exists for the uri");
  assert.equal(t.title, "BbY WOW", "the title comes from the same read");
  assert.equal(t.artist, "KAROL G, Judeline", "every artist is kept, in order");
  assert.equal(t.album, "NO ME ARREPIENTO DE SENTIR TANTO");
  assert.equal(t.albumUri, "spotify:album:1111111111111111111111", "the album uri is kept for artwork lookups");
  // The row keeps the raw ref; the UI resolves it. "large" beats "standard".
  assert.equal(t.art, "spotify:image:0badf00d0badf00d0badf00d0badf00d0badf00d", "the largest cover ref wins");
  assert.equal(
    Util.imageUrl(t.art),
    "https://i.scdn.co/image/0badf00d0badf00d0badf00d0badf00d0badf00d",
    "and resolves to the https URL the view renders"
  );
  assert.equal(t.durationMs, 226000);
});

test("parse keeps added_at and added_by from the same read", () => {
  const parsed = Sources.SOURCES.clientContents.parse({ items: [LIVE_ITEM], offset: 0, limit: 100, totalLength: 1 });
  const added = parsed.added[LIVE_ITEM.uri];
  assert.ok(added, "an added entry exists");
  assert.equal(added.addedAt, Date.parse("2026-11-06T05:02:41.000Z"), "addedAt is the real Spotify date, not the scan time");
  assert.equal(added.addedBy, "spotify", "addedBy is the username, without the spotify:user: prefix");
});

test("parse is honest when the client omits a field", () => {
  const sparse = { type: "track", uri: LIVE_ITEM.uri, name: "No Album Track" };
  const t = tracksOf(Sources.SOURCES.clientContents.parse({ items: [sparse], totalLength: 1 }));
  assert.equal(t.title, "No Album Track");
  assert.equal(t.artist, "", "no artists means an empty string, never a placeholder");
  assert.equal(t.album, "");
  assert.equal(t.art, "", "no cover means no image, so the UI can fall back");
});

test("parse ignores items that are not tracks", () => {
  const episode = { type: "episode", uri: "spotify:episode:0000000000000000000001", name: "Ep" };
  const parsed = Sources.SOURCES.clientContents.parse({ items: [episode], totalLength: 1 });
  assert.deepEqual(parsed.uris, [], "an episode is not a track uri");
  assert.equal(tracksOf(parsed), undefined, "and it contributes no track row");
  assert.equal(parsed.total, 1, "but it still counts toward the total, so a short read stays capped");
});

test("fetchTrackRow reads the title from a track row written by a client read", async () => {
  const { win, P } = boot();
  const calls = { toasts: [], nav: [], get: [], post: [], handlers: [] };
  stubSpicetify(win, calls);
  const RealPlaylists = require("../src/pwt/core/playlists.js");
  const parsed = Sources.SOURCES.clientContents.parse({ items: [LIVE_ITEM], totalLength: 1 });
  await P.db.put("tracks", {
    uri: LIVE_ITEM.uri,
    title: tracksOf(parsed).title,
    artist: tracksOf(parsed).artist,
    album: tracksOf(parsed).album,
    art: Util.imageUrl(tracksOf(parsed).art),
  });
  const row = await RealPlaylists.fetchTrackRow({ db: P.db, net: P.net }, LIVE_ITEM.uri);
  assert.ok(row, "a cached client row is returned without any network call");
  assert.equal(row.title, "BbY WOW");
  assert.equal(row.artist, "KAROL G, Judeline");
  await P.db.close();
  void RealNet;
});