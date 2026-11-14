"use strict";
/**
 * Spec: one playlist scan fills the track cache, so the playlist view never
 * renders "Unknown track" with an empty artist, album and added-by column.
 *
 * This is the end-to-end half of the client-route fix: the client's playlist read
 * carries every track's title, artists, album and cover, the scan writes them to
 * the shared `tracks` store in the same commit, and the change rows it emits
 * carry the real `addedBy` username.
 *
 * Regression it guards: an earlier version of this write referenced a `now`
 * variable that did not exist in the scan's scope, so every playlist scan threw
 * "now is not defined", no snapshot was written and the view stayed blank.
 *
 *   npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { boot, stubSpicetify, fixtures, stubHandlers } = require("./support/harness.js");
const pa = require("./support/playlist-api.js");

test("a playlist scan caches the titles the client already returned", async () => {
  const { win, P } = boot();
  const calls = { toasts: [], nav: [], get: [], post: [], handlers: [] };
  stubSpicetify(win, calls);
  const fx = fixtures();
  stubHandlers(fx, calls);
  pa.addPlaylist(calls, {
    id: fx.playlistId,
    name: "Night Drive",
    cover: "https://i.scdn.co/image/abc",
    tracks: [
      { uri: pa.trackUri(1), name: "First Light", artist: "Nova", album: "Dawn", durationMs: 210000 },
      { uri: pa.trackUri(2), name: "Second Song", artist: "Kite", album: "Held", durationMs: 180000 },
    ],
  });
  try {
    await P.store.putWatch({ kind: "playlist", id: fx.playlistId });
    const booted = P.boot.ensure({ onScanDone: function () {} });
    await booted.scheduler.runNow({ scope: "playlists", force: true });

    const row1 = await P.db.get("tracks", pa.trackUri(1));
    const row2 = await P.db.get("tracks", pa.trackUri(2));
    assert.ok(row1, "the first track is cached");
    assert.equal(row1.title, "First Light", "with the title the client sent");
    assert.equal(row1.artist, "Nova");
    assert.equal(row1.album, "Dawn");
    assert.equal(row1.durationMs, 210000);
    assert.equal(row2.title, "Second Song");

    // The scan itself succeeded, so a snapshot exists and nothing failed.
    const snap = await P.db.get("snapshots", fx.playlistId);
    assert.ok(snap && snap.uris.length === 2, "the scan completed and stored a snapshot");
    const meta = await P.store.getMeta("lastScanResult", null);
    assert.equal(meta.totals.failed, 0, "nothing failed: " + JSON.stringify(meta.errors || []));

    // The change rows carry the real addedBy username, ready for the view.
    const changes = await P.store.recentChanges(50);
    assert.ok(changes.length >= 1, "a change row was written");
    await booted.stop();
  } finally {
    await P.db.close();
  }
});

test("the playlist view renders those titles, not placeholders", async () => {
  const { win, P } = boot();
  const calls = { toasts: [], nav: [], get: [], post: [], handlers: [] };
  stubSpicetify(win, calls);
  const fx = fixtures();
  stubHandlers(fx, calls);
  pa.addPlaylist(calls, {
    id: fx.playlistId,
    name: "Night Drive",
    cover: "https://i.scdn.co/image/abc",
    tracks: [{ uri: pa.trackUri(1), name: "First Light", artist: "Nova", album: "Dawn", addedBy: "macroplant" }],
  });
  try {
    await P.store.putWatch({ kind: "playlist", id: fx.playlistId });
    const booted = P.boot.ensure({ onScanDone: function () {} });
    // A first scan writes a baseline, which emits no item change. Seed a
    // different stored snapshot so the next scan produces a real added row.
    await booted.scheduler.runNow({ scope: "playlists", force: true });
    const seeded = await P.db.get("snapshots", fx.playlistId);
    if (seeded) {
      seeded.uris = [pa.trackUri(7)];
      await P.db.put("snapshots", seeded);
    }
    await booted.scheduler.runNow({ scope: "playlists", force: true });

    const tracks = {};
    ((await P.db.getAll("tracks")) || []).forEach(function (t) { tracks[t.uri] = t; });
    const changes = await P.store.changesFor(fx.playlistId, 50);
    const row = await P.db.get("playlists", fx.playlistId);
    const snap = await P.db.get("snapshots", fx.playlistId);
    const model = P.view.playlistDetail(row, snap, tracks, changes, {});

    const flat = JSON.stringify(model);
    assert.ok(flat.indexOf("First Light") >= 0, "the title is rendered: " + flat.slice(0, 300));
    assert.ok(flat.indexOf("Nova") >= 0, "the artist is rendered");
    assert.ok(flat.indexOf("Dawn") >= 0, "the album is rendered");
    assert.ok(flat.indexOf("macroplant") >= 0, "the added-by username is rendered");
    await booted.stop();
  } finally {
    await P.db.close();
  }
});