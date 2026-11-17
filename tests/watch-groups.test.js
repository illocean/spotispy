"use strict";
/** Spotispy — pure watch-list grouping (unit). */
const { test } = require("node:test");
const assert = require("node:assert/strict");

// view.js is a renderer module; register the namespaces it lazily reads on a
// fake PWT global, exactly as view.test.js does.
globalThis.PWT = Object.assign({}, globalThis.PWT, {
  util: require("../src/pwt/util/util.js"),
  diff: require("../src/pwt/diff.js"),
  session: require("../src/pwt/session.js"),
  events: require("../src/pwt/events.js"),
});
const V = require("../src/pwt/ui/view.js");

function watch(kind, id, ownerId) {
  return { kind: kind, id: id, ownerId: ownerId, addedAt: 1700000000000 };
}

test("playlists are nested under the watched profile that owns them", () => {
  const watches = [
    watch("profile", "u1"),
    watch("playlist", "p1", "u1"),
    watch("playlist", "p2", "u1"),
    watch("profile", "u2"),
    watch("playlist", "p3", "u2"),
  ];
  const g = V.watchGroups(watches);
  assert.equal(g.groups.length, 2);
  assert.deepEqual(g.groups.map((x) => x.profile.id), ["u1", "u2"], "profile input order is preserved");
  assert.deepEqual(g.groups[0].playlists.map((x) => x.id), ["p1", "p2"]);
  assert.deepEqual(g.groups[1].playlists.map((x) => x.id), ["p3"]);
  assert.deepEqual(g.none, [], "no orphans");
  assert.equal(g.total, 5, "the hint counts all watches");
});

test("a playlist whose owner is not watched goes to none", () => {
  const watches = [watch("profile", "u1"), watch("playlist", "p1", "stranger")];
  const g = V.watchGroups(watches);
  assert.deepEqual(g.groups[0].playlists, []);
  assert.deepEqual(g.none.map((x) => x.id), ["p1"], "the playlist is kept, not dropped");
  assert.equal(g.total, 2);
});

test("a watched profile with no playlists still appears, with an empty list", () => {
  const watches = [watch("profile", "u1"), watch("profile", "u2"), watch("playlist", "p1", "u1")];
  const g = V.watchGroups(watches);
  assert.deepEqual(g.groups.map((x) => x.profile.id), ["u1", "u2"]);
  assert.deepEqual(g.groups[1].playlists, []);
});

test("an absent ownerId sends a playlist to none (older fixtures)", () => {
  const watches = [
    { kind: "playlist", id: "p1", label: "Legacy", addedAt: 1700000000000 },
    watch("profile", "u1"),
  ];
  const g = V.watchGroups(watches);
  assert.deepEqual(g.none.map((x) => x.id), ["p1"]);
  assert.deepEqual(g.groups[0].playlists, []);
});

test("empty input yields no groups, no orphans and a zero total", () => {
  const g = V.watchGroups([]);
  assert.deepEqual(g, { groups: [], none: [], total: 0 });
  assert.deepEqual(V.watchGroups().groups, [], "undefined is treated as empty");
});

test("grouping does not mutate its input rows", () => {
  const p = Object.freeze(watch("profile", "u1"));
  const pl = Object.freeze(watch("playlist", "p1", "u1"));
  const orph = Object.freeze(watch("playlist", "p2", "u2"));
  const watches = Object.freeze([p, pl, orph]);
  const g = V.watchGroups(watches);
  assert.equal(g.groups[0].profile, p, "the same row objects are reused");
  assert.deepEqual(g.groups[0].playlists, [pl]);
  assert.deepEqual(g.none, [orph]);
});
