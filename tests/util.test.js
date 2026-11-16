"use strict";
// Spotispy — util helpers. Pure functions, no Spotify needed.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const U = require("../src/pwt/util/util.js");

test("ago(0) is never, not a 20300-day-old date", () => {
  // 0 is a value, so `ts == null` does not catch it: ago(0) computed
  // Date.now() - 0 and rendered "20300d ago". A zero timestamp means the
  // thing never happened (the scanners persist lastSyncedAt: 0 on failure).
  assert.equal(U.ago(0), "never", "ago(0) must not read as an ancient date");
  assert.equal(U.ago(null), "never");
  assert.equal(U.ago(undefined), "never");
  assert.equal(U.ago(NaN), "never");
  // Real timestamps still work.
  const now = Date.now();
  assert.equal(U.ago(now, now), "just now");
  assert.equal(U.ago(now - 3600000, now), "1h ago");
  assert.equal(U.ago(now - 5 * 86400000, now), "5d ago");
});

test("lastDays steps by calendar day, so a DST change cannot drop or repeat one", () => {
  // The series must be contiguous and unique. The old rule subtracted a fixed
  // 86400000ms per step, so in a DST zone a day was skipped or emitted twice.
  // Built from the REAL local-time constructor, so it exercises whatever zone
  // the suite runs in; the calendar-day rule holds in every zone.
  const days = U.lastDays(7, new Date(2026, 2, 9, 0, 0, 0).getTime());
  assert.equal(days.length, 7, "seven keys");
  assert.equal(new Set(days).size, 7, "no duplicate key: " + days.join(","));
  for (let i = 1; i < days.length; i++) {
    const a = new Date(days[i - 1] + "T12:00:00");
    const b = new Date(days[i] + "T12:00:00");
    const gap = Math.round((b - a) / 86400000);
    assert.equal(gap, 1, days[i - 1] + " -> " + days[i] + " is not one day apart");
  }
});

test("lastDays is contiguous across both DST transitions", () => {
  // Check the two transition dates for the machine's own zone, plus a fixed
  // sample of days so the assertion is meaningful in a zone with no DST.
  const samples = [];
  const y = 2026;
  for (let m = 0; m < 12; m++) {
    for (const d of [1, 8, 15, 22, 28]) {
      if (d <= new Date(y, m + 1, 0).getDate()) samples.push(new Date(y, m, d, 0, 0, 0).getTime());
    }
  }
  for (const t of samples) {
    const days = U.lastDays(7, t);
    assert.equal(new Set(days).size, 7, "duplicate key at " + new Date(t).toDateString() + ": " + days.join(","));
  }
});
