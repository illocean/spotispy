"use strict";
/**
 * Spotispy — telemetry unit tests.
 *
 * The self-observation layer must never throw into the app and must report a
 * failing check instead of hiding it.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");

globalThis.PWT = globalThis.PWT || {};
globalThis.PWT.config = { get: function () { return { pollMs: 3600000 }; } };
const T = require("../src/pwt/core/telemetry.js");

test("time records a sync operation", () => {
  T.reset();
  const out = T.time("unit.sync", function () { return 42; });
  assert.equal(out, 42);
  const entries = T._entries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "unit.sync");
  assert.equal(entries[0].ok, true);
  assert.ok(entries[0].ms >= 0);
});

test("time records an async operation and rethrows failures", async () => {
  T.reset();
  const ok = await T.time("unit.async", async function () { return "done"; });
  assert.equal(ok, "done");
  await assert.rejects(
    T.time("unit.boom", async function () { throw new Error("nope"); }),
    /nope/
  );
  const names = T._entries().map((e) => e.name);
  assert.ok(names.includes("unit.async") && names.includes("unit.boom"));
  const failed = T._entries().find((e) => e.name === "unit.boom");
  assert.equal(failed.ok, false);
  assert.match(failed.detail, /nope/);
});

test("errors are captured with scope and message", () => {
  T.reset();
  T.captureError("scan.profiles", new Error("endpoint died"));
  const report = T.report();
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].scope, "scan.profiles");
  assert.match(report.errors[0].message, /endpoint died/);
});

test("report exposes counters, uptime and the slowest operations", () => {
  T.reset();
  T.count("scans");
  T.count("scans");
  T.record("slow.one", 500, true, "detail");
  T.record("fast.one", 5, true, "");
  const report = T.report();
  assert.equal(report.counters.scans, 2);
  assert.ok(report.upMs >= 0);
  assert.equal(report.slowest[0].name, "slow.one");
});

test("runSelfTest isolates failures and reports every check", async () => {
  T.reset();
  globalThis.Spicetify = { CosmosAsync: {} };
  const fakeDb = {
    open: async function () { return {}; },
    count: async function () { return 7; },
    getAll: async function () { return [{ art: "x" }]; },
  };
  const fakeStore = {
    recentChanges: async function () { return [{ id: 1 }]; },
    listWatches: async function () { return [{ kind: "playlist", id: "p" }]; },
    setMeta: async function () {},
  };
  const result = await T.runSelfTest({
    db: fakeDb,
    store: fakeStore,
    bus: { lastScanAt: Date.now() - 1000, nextScanAt: Date.now() + 1000 },
    probeNetwork: false,
  });
  assert.ok(result.total >= 8);
  assert.equal(result.fail, 0, JSON.stringify(result.checks.filter((c) => !c.ok)));
  assert.equal(result.pass, result.total);
  assert.ok(result.checks.every((c) => typeof c.ms === "number"));
});

test("runSelfTest reports a failing check instead of throwing", async () => {
  T.reset();
  const brokenStore = {
    recentChanges: async function () { throw new Error("store down"); },
    listWatches: async function () { throw new Error("store down"); },
    setMeta: async function () {},
  };
  const result = await T.runSelfTest({
    db: { open: async function () {}, count: async function () { return 0; }, getAll: async function () { return []; } },
    store: brokenStore,
    bus: {},
    probeNetwork: false,
  });
  assert.ok(result.fail >= 1);
  // A real failure is `state === "fail"`. (`ok` is false for a *skipped* check
  // too, so `!ok` no longer identifies a failure on its own.)
  assert.ok(result.checks.some((c) => c.state === "fail" && /store down/.test(c.detail)));
});
