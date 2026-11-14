"use strict";
/**
 * Spec: the playlist change log shows real people and real tracks.
 *
 * Two defects, both verified live on 1.3.9.2055:
 *
 *  1. "Added by" was always blank. The change row stores `extra.addedBy`, which
 *     the client supplies as a *username* ("spotify", "macroplant"), and the view
 *     looked it up in a map of playlist/user ids. A username is already a name:
 *     using it directly is what fills the column.
 *  2. Track title, artist, album and artwork came from a second metadata pass
 *     with no working route on this build, so rows rendered "Unknown track".
 *     The client's playlist read already carries all of it; the scan writes it to
 *     the track cache and the view reads it from there.
 *
 *   npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const U = require("../src/pwt/util/util.js");
const vm = require("../src/pwt/ui/view.js");

// view.js reads its helpers off the PWT bag, as the app does.
globalThis.PWT = Object.assign(globalThis.PWT || {}, { util: U, diff: require("../src/pwt/diff.js") });

const TRACK = "spotify:track:0000000000000000000000";

function changes() {
  return [
    {
      kind: "playlist.item.added",
      ts: Date.parse("2026-11-06T05:02:41.000Z"),
      uri: TRACK,
      target: "37i9dQZF1DXcBWIGoYBM5M",
      extra: { addedBy: "macroplant" },
    },
    {
      kind: "playlist.item.added",
      ts: Date.parse("2026-11-06T05:03:41.000Z"),
      uri: "spotify:track:0000000000000000000009",
      target: "37i9dQZF1DXcBWIGoYBM5M",
      extra: { addedBy: "spotify:user:3333333333333333333333" },
    },
    {
      kind: "playlist.item.added",
      ts: Date.parse("2026-11-06T05:04:41.000Z"),
      uri: "spotify:track:0000000000000000000008",
      target: "37i9dQZF1DXcBWIGoYBM5M",
      // No addedBy at all: the column must say nothing rather than invent a name.
    },
  ];
}

function tracks() {
  var t = {};
  t[TRACK] = { title: "BbY WOW", artist: "KAROL G, Judeline", album: "NO ME ARREPIENTO", art: "https://i.scdn.co/image/x" };
  return t;
}

test("the 'added by' column shows the username the client supplied", () => {
  const model = vm.playlistDetail({ id: "37i9dQZF1DXcBWIGoYBM5M", name: "P" }, null, tracks(), changes(), {});
  const rows = model.changes || [];
  assert.ok(rows.length >= 1, "the timeline rendered rows: " + JSON.stringify(Object.keys(model)));
  assert.ok(
    rows.some(function (r) { return r.addedBy === "macroplant"; }),
    "the username reaches the row: " + JSON.stringify(rows.map(function (r) { return r.addedBy; }))
  );
});

test("playlistDetail resolves a username addedBy without a name map", () => {
  const model = vm.playlistDetail({ id: "37i9dQZF1DXcBWIGoYBM5M", name: "P" }, null, tracks(), changes(), {});
  const flat = JSON.stringify(model);
  assert.ok(flat.indexOf("macroplant") >= 0, "the username reaches the model: " + flat.slice(0, 400));
});

test("playlistDetail still strips a spotify:user: prefix from addedBy", () => {
  const model = vm.playlistDetail({ id: "37i9dQZF1DXcBWIGoYBM5M", name: "P" }, null, tracks(), changes(), {});
  const addedBys = (model.changes || []).map(function (r) { return r.addedBy; });
  assert.ok(addedBys.indexOf("macroplant") >= 0, "a username is used as-is: " + JSON.stringify(addedBys));
  assert.ok(
    addedBys.every(function (v) { return v.indexOf("spotify:user:") < 0; }),
    "no raw user uri is rendered: " + JSON.stringify(addedBys)
  );
  // The user id is not a name, so it must not be shown either.
  assert.ok(addedBys.indexOf("3333333333333333333333") < 0, "a bare id is not a name: " + JSON.stringify(addedBys));
});

test("playlistDetail shows the cached track title, artist, album and art", () => {
  const model = vm.playlistDetail({ id: "37i9dQZF1DXcBWIGoYBM5M", name: "P" }, null, tracks(), changes(), {});
  const flat = JSON.stringify(model);
  assert.ok(flat.indexOf("BbY WOW") >= 0, "the title from the cache is shown: " + flat.slice(0, 400));
  assert.ok(flat.indexOf("KAROL G, Judeline") >= 0, "the artist is shown");
  assert.ok(flat.indexOf("NO ME ARREPIENTO") >= 0, "the album is shown");
});

test("playlistDetail says 'Unknown track' only when nothing is cached", () => {
  const model = vm.playlistDetail({ id: "37i9dQZF1DXcBWIGoYBM5M", name: "P" }, null, {}, changes(), {});
  const flat = JSON.stringify(model);
  assert.ok(flat.indexOf("Unknown track") >= 0, "an unknown track is labelled honestly");
});
test("a change row carries its own track title, not a bare id", () => {
  const kit = require("../src/pwt/ui/kit.js");
  // What the scan now writes: detail is the cached title, "" when unknown.
  assert.equal(kit.humanDetail({ kind: "playlist.item.added", detail: "First Light" }), "added “First Light”");
  assert.equal(kit.humanDetail({ kind: "playlist.item.removed", detail: "First Light" }), "removed “First Light”");
  // No title known: say what happened, never print an id.
  assert.equal(kit.humanDetail({ kind: "playlist.item.added" }), "added");
  assert.equal(kit.humanDetail({ kind: "playlist.item.removed", detail: "0000000000000000000009" }), "removed");
});

test("evaluate stores the title in detail, never a track id", () => {
  const Playlists = require("../src/pwt/core/playlists.js");
  const U = require("../src/pwt/util/util.js");
  const Events = require("../src/pwt/events.js");
  globalThis.PWT = Object.assign(globalThis.PWT || {}, { util: U, events: Events });

  const TRACKS = ["spotify:track:" + "a".repeat(22), "spotify:track:" + "b".repeat(22)];
  const tracks = {};
  tracks[TRACKS[0]] = { uri: TRACKS[0], title: "First Light" };
  // A removed track is no longer in the playlist, so the scan has no row for it:
  // its detail stays empty rather than becoming an id.

  const out = Playlists.evaluate(
    { id: "37i9dQZF1DXcBWIGoYBM5M", name: "P" },
    { uris: [], source: "client", total: 0 },
    { uris: TRACKS, added: {}, tracks: tracks, total: 2, source: "client", capped: false },
    { name: "P", coverUrl: "https://i.scdn.co/x" },
    Date.now(),
    tracks
  );
  const added = out.events.filter(function (e) { return e.kind === "playlist.item.added"; });
  assert.equal(added.length, 2, "both tracks are logged as added");
  const first = added.filter(function (e) { return e.uri === TRACKS[0]; })[0];
  const second = added.filter(function (e) { return e.uri === TRACKS[1]; })[0];
  assert.equal(first.detail, "First Light", "a known track carries its title");
  assert.equal(second.detail, "", "an unknown track carries nothing rather than an id");
});
