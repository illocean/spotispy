"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

// view.js is a browser-renderer module; the test exercises its pure
// view-model functions by registering them on a fake PWT namespace.
const U = require("../src/pwt/util/util.js");
const D = require("../src/pwt/diff.js");
const S = require("../src/pwt/session.js");
globalThis.PWT = { util: U, diff: D, session: S, events: require("../src/pwt/events.js") };
const V = require("../src/pwt/ui/view.js");

test("presenceBars spans the visible tick and marks hidden segments", () => {
  const day = "2026-11-10";
  const base = new Date(day + "T08:00:00").getTime();
  const ticks = [
    { ts: base, hidden: false },
    { ts: base + 60000, hidden: false },
    { ts: base + 120000, hidden: true },
    { ts: base + 180000, hidden: true },
    { ts: base + 240000, hidden: false },
  ];
  const bars = V.presenceBars([{ day, userId: "u1", key: day + ":u1", ticks }], day, base + 10 * 60000, { u1: "Ari" });
  assert.equal(bars.length, 1);
  assert.equal(bars[0].name, "Ari");
  assert.equal(bars[0].segments.length, 3);
  assert.equal(bars[0].segments[1].hidden, true);
  assert.ok(bars[0].label.indexOf("online") > 0);
  assert.ok(bars[0].label !== "0m online" && bars[0].label !== "0s online", "online time must be counted");
});

test("presenceBars ignores rows from other days", () => {
  const day = "2026-11-10";
  const bars = V.presenceBars([{ day: "2026-11-09", userId: "u1", ticks: [{ ts: 1, hidden: false }] }], day, Date.now());
  assert.equal(bars.length, 0);
});

test("presenceBars renders a zero-width sliver for a tick at the very end of today", () => {
  const now = Date.now();
  const day = V === undefined ? "" : new (require("../src/pwt/diff.js").dayKey ? Object : Object)();
  const today = require("../src/pwt/diff.js").dayKey(now);
  const bars = V.presenceBars([{ day: today, userId: "u", ticks: [{ ts: now, hidden: false }] }], today, now);
  assert.equal(bars[0].segments.length, 1);
  assert.ok(bars[0].segments[0].left >= 0 && bars[0].segments[0].left <= 100);
  assert.ok(bars[0].segments[0].width > 0);
});

test("heatmap buckets plays by hour and day", () => {
  const now = Date.now();
  const plays = [
    { ts: now, contextUri: "spotify:playlist:x" },
    { ts: now, contextUri: "spotify:playlist:x" },
    { ts: now - 5 * 3600000, contextUri: "spotify:playlist:y" },
  ];
  const h = V.heatmap(plays, now);
  const today = D.dayKey(now);
  assert.equal(h.days[0].day, today);
  assert.equal(h.data[today][D.hourOf(now)], 2);
});

test("topContexts ranks contexts and labels them", () => {
  const top = V.topContexts([
    { contextUri: "spotify:playlist:a" },
    { contextUri: "spotify:playlist:a" },
    { contextUri: "spotify:artist:b" },
  ]);
  assert.equal(top[0].label, "Playlist");
  assert.equal(top[0].value, 2);
  assert.equal(top[1].label, "Artist page");
});

test("filterChanges matches query, kind and level", () => {
  const rows = [
    { kind: "playlist.item.added", level: "playlist", title: "Song", detail: "some track", uri: "spotify:track:x", ts: 1 },
    { kind: "profile.name.changed", level: "profile", title: "Name", detail: "a -> b", uri: "", ts: 2 },
  ];
  assert.equal(V.filterChanges(rows, "some", "", "").length, 1);
  assert.equal(V.filterChanges(rows, "", "profile.name.changed", "").length, 1);
  assert.equal(V.filterChanges(rows, "", "", "profile").length, 1);
  assert.equal(V.filterChanges(rows, "zzz", "", "").length, 0);
});

test("liveStrip resolves cached title/artist for the card", () => {
  const now = Date.now();
  const live = V.liveStrip(
    [{ userUri: "spotify:user:u", userName: "Ari", trackUri: "spotify:track:t", contextUri: "spotify:playlist:x", isPlaying: true, timestamp: now - 60000 }],
    {},
    now,
    { "spotify:track:t": { title: "Paper Boats", artist: "Kite" } }
  );
  assert.equal(live[0].trackTitle, "Paper Boats");
  assert.equal(live[0].trackArtist, "Kite");
  assert.equal(live[0].contextLabel, "Playlist");
});
