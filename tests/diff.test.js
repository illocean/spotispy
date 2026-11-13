"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const diff = require("../src/pwt/diff.js");

const T = (n) => Array.from({ length: n }, (_, i) => "spotify:track:t" + i);

test("diffTracks: pure insert", () => {
  const r = diff.diffTracks(T(3), T(3).concat(["spotify:track:x"]));
  assert.deepEqual(r.added, ["spotify:track:x"]);
  assert.deepEqual(r.removed, []);
});

test("diffTracks: pure removal", () => {
  const r = diff.diffTracks(T(3), ["spotify:track:t0", "spotify:track:t2"]);
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.removed, ["spotify:track:t1"]);
});

test("diffTracks: reorder only produces nothing", () => {
  const r = diff.diffTracks(T(3), ["spotify:track:t2", "spotify:track:t0", "spotify:track:t1"]);
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.removed, []);
  assert.equal(r.reorderOnly, true);
});

test("diffTracks: duplicates handled as a multiset", () => {
  const prev = ["a", "a", "b"];
  const next = ["a", "b", "b"];
  const r = diff.diffTracks(prev, next);
  assert.deepEqual(r.added, ["b"]);
  assert.deepEqual(r.removed, ["a"]);
});

test("diffTracks: an insertion at the head is one addition", () => {
  const prev = T(5);
  const r = diff.diffTracks(prev, ["spotify:track:new"].concat(prev));
  assert.deepEqual(r.added, ["spotify:track:new"]);
  assert.deepEqual(r.removed, []);
});

test("diffTracks: 100 -> 2 emits exactly 98 removals", () => {
  const r = diff.diffTracks(T(100), ["spotify:track:t0", "spotify:track:t1"]);
  assert.equal(r.removed.length, 98);
  assert.deepEqual(r.added, []);
});

test("diffSets: playlist id add/remove", () => {
  const r = diff.diffSets(["a", "b"], ["b", "c"]);
  assert.deepEqual(r.added, ["c"]);
  assert.deepEqual(r.removed, ["a"]);
});

test("isSuspiciousShrink: empty and >50% shrink are suspicious", () => {
  assert.equal(diff.isSuspiciousShrink(10, 0), true);
  assert.equal(diff.isSuspiciousShrink(10, 4), true);
  assert.equal(diff.isSuspiciousShrink(10, 6), false);
  assert.equal(diff.isSuspiciousShrink(0, 0), false);
  assert.equal(diff.isSuspiciousShrink(1, 1), false);
});

test("planTrackDiff: no baseline => reseed", () => {
  const p = diff.planTrackDiff(null, { uris: ["a"], source: "core" });
  assert.equal(p.action, "reseed");
  assert.equal(p.seeded, true);
});

test("planTrackDiff: source switch reseeds and emits no removals", () => {
  const p = diff.planTrackDiff({ uris: ["a", "b"], source: "embed" }, { uris: ["a"], source: "core" });
  assert.equal(p.action, "reseed");
  assert.equal(p.reason, "source-switch");
  assert.deepEqual(p.removed, []);
});

test("planTrackDiff: capped result never emits removals", () => {
  const p = diff.planTrackDiff({ uris: ["a", "b"], source: "core" }, { uris: ["a"], source: "core", capped: true });
  assert.equal(p.action, "reseed");
  assert.deepEqual(p.removed, []);
});

test("planTrackDiff: big shrink holds on the first read and confirms on the second", () => {
  const prev = { uris: T(10), source: "core" };
  const one = diff.planTrackDiff(prev, { uris: T(2), source: "core" });
  assert.equal(one.action, "hold");
  assert.deepEqual(one.removed, []);
  assert.equal(one.confirmations, 1);
  const two = diff.planTrackDiff(Object.assign({}, prev, { pendingShrink: { count: 2, confirmations: 1 } }), { uris: T(2), source: "core" });
  assert.equal(two.action, "diff");
  assert.equal(two.removed.length, 8);
});

test("planTrackDiff: normal diff passes through", () => {
  const p = diff.planTrackDiff({ uris: T(4), source: "core" }, { uris: T(4).concat(["n"]), source: "core" });
  assert.equal(p.action, "diff");
  assert.deepEqual(p.added, ["n"]);
});

test("diffScalars: reports only changed fields", () => {
  const r = diff.diffScalars({ name: "A", cover: "c1", followers: 3 }, { name: "B", cover: "c1", followers: 3 }, ["name", "cover", "followers"]);
  assert.deepEqual(r.map((x) => x.field), ["name"]);
});

test("diffScalars: null counts as a change, but ignoreNull skips it", () => {
  const a = diff.diffScalars({ followers: 3 }, { followers: null }, ["followers"]);
  assert.equal(a.length, 1);
  const b = diff.diffScalars({ followers: 3 }, { followers: null }, ["followers"], { ignoreNull: ["followers"] });
  assert.equal(b.length, 0);
});

test("diffScalars: undefined next value is not a change", () => {
  assert.equal(diff.diffScalars({ name: "A" }, {}, ["name"]).length, 0);
});

test("dayKey and hourOf bucket locally", () => {
  const ts = new Date(2026, 10, 10, 13, 5).getTime();
  assert.equal(diff.dayKey(ts), "2026-11-10");
  assert.equal(diff.hourOf(ts), 13);
});

test("multiset counts occurrences", () => {
  assert.deepEqual(Object.assign({}, diff.multiset(["a", "a", "b"])), { a: 2, b: 1 });
});
