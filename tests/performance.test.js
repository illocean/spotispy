"use strict";
/**
 * Spotispy — performance regressions.
 *
 * Every test here expresses a bound on work, not just a result, so a change
 * that silently reintroduces a full-store scan fails even on small fixtures.
 *
 *   npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { boot, stubSpicetify } = require("./support/harness.js");

globalThis.PWT_ART_DISABLED = true;

function freshBoot() {
  const { win, P } = boot();
  const calls = { toasts: [], nav: [], get: [], post: [], handlers: [] };
  stubSpicetify(win, calls);
  return { win, P, calls };
}

async function clean(P) {
  await P.net.reset();
  if (P.activity && P.activity.reset) P.activity.reset();
  await P.db.purgeAll();
}

function change(i, target, ts) {
  return {
    level: "playlist",
    target: target || "plPerf",
    kind: "playlist.item.added",
    title: "t" + i,
    detail: "",
    ts: ts,
    observedAt: ts,
    uri: "spotify:track:perf" + String(i).padStart(20, "0"),
  };
}

// ---------------------------------------------------------------------------
// 1. commitScan must not load the entire change log to dedupe a few rows.
// ---------------------------------------------------------------------------

test("commitScan dedupes by keyed reads, not a full change-log scan", async () => {
  const { P } = freshBoot();
  try {
    await clean(P);
    const now = Date.now();
    const rows = [];
    for (let i = 0; i < 400; i++) rows.push(change(i, "plPerf", now - i));
    await P.store.commitScan({ changes: rows });

    // Spy on the full-store read. The old implementation called this once per
    // commit regardless of how many changes the plan carried.
    const originalGetAll = P.db.getAll;
    let fullScans = 0;
    P.db.getAll = function (store) {
      if (store === "changes") fullScans++;
      return originalGetAll.call(P.db, store);
    };
    try {
      await P.store.commitScan({ changes: [change(0, "plPerf", now)] }); // replay
      await P.store.commitScan({ changes: [change(999, "plPerf", now)] }); // new
      await P.store.commitScan({ puts: [["meta", { key: "perf", value: 1 }]] }); // no changes
    } finally {
      P.db.getAll = originalGetAll;
    }
    assert.equal(fullScans, 0, "commitScan must use keyed reads for dedupe, got " + fullScans + " full change scans");

    const all = await P.db.getAll("changes");
    assert.equal(all.length, 401, "replay did not duplicate: " + all.length);
    const aggs = await P.db.getAll("aggregates");
    assert.equal(aggs[0].added, 401, "replay did not double-count: " + aggs[0].added);
  } finally {
    await P.db.close();
  }
});

// ---------------------------------------------------------------------------
// 2. recentChanges(changesFor) must stop reading once it has enough matches.
// ---------------------------------------------------------------------------

test("recentChanges(target) reads a bounded cursor, not the whole target index", async () => {
  const { P } = freshBoot();
  try {
    await clean(P);
    const now = Date.now();
    const rows = [];
    // 300 rows for OTHER targets, newer than the 5 wanted rows. The old code
    // loaded all 305 through `range('changes','target',...,{limit:50000})`.
    for (let i = 0; i < 300; i++) rows.push(change(5000 + i, "plOther", now - i));
    for (let i = 0; i < 5; i++) rows.push(change(100 + i, "plWanted", now - 10000 - i));
    await P.store.commitScan({ changes: rows });

    const originalRange = P.db.range;
    let wideReads = 0;
    P.db.range = function (store, index, r, opts) {
      if (store === "changes" && index === "target" && (opts && opts.limit >= 50000)) wideReads++;
      return originalRange.call(P.db, store, index, r, opts);
    };
    let out;
    try {
      out = await P.store.recentChanges(3, "plWanted");
    } finally {
      P.db.range = originalRange;
    }
    assert.equal(wideReads, 0, "recentChanges must not request 50000 rows: " + wideReads);
    assert.equal(out.length, 3, "newest 3 of the target: " + JSON.stringify(out.map((r) => r.title)));
    assert.ok(out.every((r) => r.target === "plWanted"), "only the requested target");
    assert.deepEqual(out.map((r) => r.title), ["t100", "t101", "t102"], "newest first");
  } finally {
    await P.db.close();
  }
});

test("recentChanges(target, kind) filters before the limit with a bounded read", async () => {
  const { P } = freshBoot();
  try {
    await clean(P);
    const now = Date.now();
    const rows = [];
    for (let i = 0; i < 4; i++) {
      const r = change(200 + i, "plKind", now - 20000 - i);
      r.kind = "playlist.item.removed";
      rows.push(r);
    }
    for (let i = 0; i < 3; i++) rows.push(change(300 + i, "plKind", now - 10000 - i));
    await P.store.commitScan({ changes: rows });

    const added = await P.store.recentChanges(2, "plKind", "playlist.item.added");
    assert.equal(added.length, 2);
    assert.ok(added.every((r) => r.kind === "playlist.item.added"));
    assert.deepEqual(added.map((r) => r.title), ["t300", "t301"]);
  } finally {
    await P.db.close();
  }
});
