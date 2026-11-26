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

test("humanDetail shows before → after for renames, never for images", () => {
  const kit = require("../src/pwt/ui/kit.js");
  // A real rename carries both values.
  assert.equal(
    kit.humanDetail({ kind: "profile.name.changed", extra: { from: "Bob", to: "Robert" } }),
    "Bob → Robert"
  );
  assert.equal(
    kit.humanDetail({ kind: "profile.playlist.renamed", extra: { from: "Old Name", to: "New Name" } }),
    "Old Name → New Name"
  );
  // A first observation has no stored "before"; it just names the new value.
  assert.equal(
    kit.humanDetail({ kind: "profile.name.changed", extra: { to: "Robert" } }),
    "now called “Robert”"
  );
  // Images keep readable text; preview rendering consumes the URLs separately.
  assert.equal(kit.humanDetail({ kind: "profile.avatar.changed", extra: { from: "h1", to: "h2" } }), "new picture");
  assert.equal(kit.humanDetail({ kind: "profile.playlist.cover.changed", extra: { from: "c1", to: "c2" } }), "new cover");
  // Followers keep their from → to form.
  assert.equal(
    kit.humanDetail({ kind: "profile.followers.count", extra: { from: 100, to: 101 } }),
    "100 → 101"
  );
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

test("evaluate logs a genuine cover change with before/after", () => {
  // A real artwork edit IS an observable change and is logged. The event
  // carries the old and new URLs so the row can preview them side by side.
  const Playlists = require("../src/pwt/core/playlists.js");
  const Sources = require("../src/pwt/core/sources.js");
  const U = require("../src/pwt/util/util.js");
  const Events = require("../src/pwt/events.js");
  const Diff = require("../src/pwt/diff.js");
  globalThis.PWT = Object.assign(globalThis.PWT || {}, { util: U, events: Events, diff: Diff, sources: Sources });

  const out = Playlists.evaluate(
    { id: "37i9dQZF1DXcBWIGoYBM5M", name: "P", coverUrl: "https://i.scdn.co/image/oldcover", coverHash: "oldcover", uris: [], source: "client", total: 0 },
    { uris: [], source: "client", total: 0 },
    { uris: [], added: {}, tracks: {}, total: 0, source: "client", capped: false },
    { name: "P", coverUrl: "https://i.scdn.co/image/newcover", coverHash: "newcover" },
    Date.now(),
    {}
  );
  const covers = out.events.filter(function (e) { return e.kind === "profile.playlist.cover.changed"; });
  assert.equal(covers.length, 1, "a genuine cover change IS logged");
  assert.equal(covers[0].extra.fromUrl, "https://i.scdn.co/image/oldcover", "the old cover is kept for preview");
  assert.equal(covers[0].extra.toUrl, "https://i.scdn.co/image/newcover", "the new cover is kept for preview");
  // The cover is still tracked: the new URL/hash are written to the row.
  assert.equal(out.playlist.coverUrl, "https://i.scdn.co/image/newcover", "the new cover URL is still stored on the row");
  assert.equal(out.playlist.coverHash, "newcover", "the new cover hash is still stored on the row");
});

test("evaluate does NOT log a cover change when only the resolution flipped", () => {
  // Spotify serves the SAME image at several sizes under different URLs
  // (.../ab67616d0000b273… 64px vs .../ab67616d0000d4c2… 640px). `bestCover`
  // can switch sizes between scans; the size-independent id makes them equal,
  // so the "cover changed" that used to fire for an unchanged image does not.
  const Playlists = require("../src/pwt/core/playlists.js");
  const Sources = require("../src/pwt/core/sources.js");
  const U = require("../src/pwt/util/util.js");
  const Events = require("../src/pwt/events.js");
  const Diff = require("../src/pwt/diff.js");
  globalThis.PWT = Object.assign(globalThis.PWT || {}, { util: U, events: Events, diff: Diff, sources: Sources });

  const out = Playlists.evaluate(
    { id: "37i9dQZF1DXcBWIGoYBM5M", name: "P", coverUrl: "https://i.scdn.co/image/ab67616d0000b273AAAAAA", coverHash: "ab67616d0000b273AAAAAA", uris: [], source: "client", total: 0 },
    { uris: [], source: "client", total: 0 },
    { uris: [], added: {}, tracks: {}, total: 0, source: "client", capped: false },
    { name: "P", coverUrl: "https://i.scdn.co/image/ab67616d0000d4c2AAAAAA", coverHash: "ab67616d0000d4c2AAAAAA" },
    Date.now(),
    {}
  );
  const covers = out.events.filter(function (e) { return e.kind === "profile.playlist.cover.changed"; });
  assert.equal(covers.length, 0, "a resolution flip is NOT a cover change");
  // The new (higher-res) URL is still stored on the row.
  assert.equal(out.playlist.coverUrl, "https://i.scdn.co/image/ab67616d0000d4c2AAAAAA", "the resolved cover URL is stored");
});

test("evaluate does NOT log a cover change on a mosaic↔single shape switch", () => {
  // A mosaic ref and a single URL are different source routes for artwork, not
  // an edit. Even with sources loaded, a shape transition must not emit a
  // phantom "cover changed"; only a genuine edit within the same shape does.
  const Playlists = require("../src/pwt/core/playlists.js");
  const Sources = require("../src/pwt/core/sources.js");
  const U = require("../src/pwt/util/util.js");
  const Events = require("../src/pwt/events.js");
  const Diff = require("../src/pwt/diff.js");
  globalThis.PWT = Object.assign(globalThis.PWT || {}, { util: U, events: Events, diff: Diff, sources: Sources });

  const MOSAIC = "spotify:mosaic:aaaa1111:bbbb2222";
  const SINGLE = "https://i.scdn.co/image/ab67616d0000b273AAAAAA";

  // Stored mosaic, meta delivers a single image (route switched).
  const fromMosaic = Playlists.evaluate(
    { id: "37i9dQZF1DXcBWIGoYBM5M", name: "P", coverUrl: MOSAIC, coverHash: "", uris: [], source: "client", total: 0 },
    { uris: [], source: "client", total: 0 },
    { uris: [], added: {}, tracks: {}, total: 0, source: "client", capped: false },
    { name: "P", coverUrl: SINGLE, coverHash: "ab67616d0000b273AAAAAA" },
    Date.now(),
    {}
  );
  const covers1 = fromMosaic.events.filter(function (e) { return e.kind === "profile.playlist.cover.changed"; });
  assert.equal(covers1.length, 0, "mosaic → single is NOT a cover change");

  // And the reverse: stored single, meta delivers a mosaic.
  const fromSingle = Playlists.evaluate(
    { id: "37i9dQZF1DXcBWIGoYBM5M", name: "P", coverUrl: SINGLE, coverHash: "ab67616d0000b273AAAAAA", uris: [], source: "client", total: 0 },
    { uris: [], source: "client", total: 0 },
    { uris: [], added: {}, tracks: {}, total: 0, source: "client", capped: false },
    { name: "P", coverUrl: MOSAIC, coverHash: "" },
    Date.now(),
    {}
  );
  const covers2 = fromSingle.events.filter(function (e) { return e.kind === "profile.playlist.cover.changed"; });
  assert.equal(covers2.length, 0, "single → mosaic is NOT a cover change");
});

test("evaluate does NOT log a cover change on a first fill (no prior cover)", () => {
  // A brand-new row has no previous artwork; filling it in is not a change.
  const Playlists = require("../src/pwt/core/playlists.js");
  const Sources = require("../src/pwt/core/sources.js");
  const U = require("../src/pwt/util/util.js");
  const Events = require("../src/pwt/events.js");
  const Diff = require("../src/pwt/diff.js");
  globalThis.PWT = Object.assign(globalThis.PWT || {}, { util: U, events: Events, diff: Diff, sources: Sources });

  const out = Playlists.evaluate(
    { id: "37i9dQZF1DXcBWIGoYBM5M", name: "P", coverUrl: "", coverHash: "", uris: [], source: "client", total: 0 },
    { uris: [], source: "client", total: 0 },
    { uris: [], added: {}, tracks: {}, total: 0, source: "client", capped: false },
    { name: "P", coverUrl: "https://i.scdn.co/image/ab67616d0000b273AAAAAA", coverHash: "ab67616d0000b273AAAAAA" },
    Date.now(),
    {}
  );
  const covers = out.events.filter(function (e) { return e.kind === "profile.playlist.cover.changed"; });
  assert.equal(covers.length, 0, "a first fill is not a change");
  assert.equal(out.playlist.coverUrl, "https://i.scdn.co/image/ab67616d0000b273AAAAAA", "the first cover is stored");
});

test("a scan that only catches up a cover hash still logs no cover change", () => {
  // The cover hash is a pure function of the cover URL; a metadata source that
  // supplies a coverUrl without a hash (embed / pathfinder) used to leave the
  // stored hash stale, and the next scan logged "cover changed" against it. No
  // cover event is emitted now, and the stored hash still tracks the URL.
  const Playlists = require("../src/pwt/core/playlists.js");
  const U = require("../src/pwt/util/util.js");
  const Events = require("../src/pwt/events.js");
  const Diff = require("../src/pwt/diff.js");
  globalThis.PWT = Object.assign(globalThis.PWT || {}, { util: U, events: Events, diff: Diff });

  const URL = "https://i.scdn.co/image/ab67616d0000b273samecover";
  const HASH = "ab67616d0000b273samecover"; // coverHashOf = the URL's last path segment
  const now = Date.now();

  // Scan 1: meta carries the URL but no hash (the embed/pathfinder shape).
  const first = Playlists.evaluate(
    { id: "37i9dQZF1DXcBWIGoYBM5M", name: "P", coverHash: "", coverUrl: "", uris: [], source: "client", total: 0 },
    { uris: [], source: "client", total: 0 },
    { uris: [], added: {}, tracks: {}, total: 0, source: "client", capped: false },
    { name: "P", coverUrl: URL },
    now,
    {}
  );
  assert.equal(first.playlist.coverUrl, URL, "the cover URL is stored");
  assert.equal(first.playlist.coverHash, HASH, "the hash is derived from the stored URL, not left stale");

  // Scan 2: meta now carries a (consistent) hash for the SAME URL.
  const second = Playlists.evaluate(
    first.playlist,
    first.snapshot,
    { uris: [], added: {}, tracks: {}, total: 0, source: "client", capped: false },
    { name: "P", coverUrl: URL, coverHash: HASH },
    now + 1000,
    {}
  );
  const covers = second.events.filter(function (e) { return e.kind === "profile.playlist.cover.changed"; });
  assert.equal(covers.length, 0, "no cover event, even when the hash only now caught up");
});

test("evaluate still logs a name change as before → after", () => {
  const Playlists = require("../src/pwt/core/playlists.js");
  const U = require("../src/pwt/util/util.js");
  const Events = require("../src/pwt/events.js");
  const Diff = require("../src/pwt/diff.js");
  globalThis.PWT = Object.assign(globalThis.PWT || {}, { util: U, events: Events, diff: Diff });

  const out = Playlists.evaluate(
    { id: "37i9dQZF1DXcBWIGoYBM5M", name: "Old Name", coverHash: "c", uris: [], source: "client", total: 0 },
    { uris: [], source: "client", total: 0 },
    { uris: [], added: {}, tracks: {}, total: 0, source: "client", capped: false },
    { name: "New Name", coverHash: "c" },
    Date.now(),
    {}
  );
  const renames = out.events.filter(function (e) { return e.kind === "profile.playlist.renamed"; });
  assert.equal(renames.length, 1, "the rename is logged");
  assert.equal(renames[0].detail, "name: Old Name → New Name", "a non-image scalar keeps before → after");
});
