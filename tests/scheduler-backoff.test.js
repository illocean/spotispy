"use strict";
/**
 * Spotispy — activity error back-off.
 *
 * The activity timer is a fixed setInterval armed by reschedule(). reschedule()
 * is the only place that reads `activityErrors` to pick the interval, so a tick
 * that fails must CALL reschedule() or the back-off never engages: the feed
 * keeps being polled at the normal (or boost) cadence even though it is dead.
 * Recovery must re-arm too, or the timer stays stuck at the backed-off interval
 * after the feed comes back.
 *
 * These tests drive a real scheduler with a stubbed activity.tick and assert on
 * bus.activityMs, the interval reschedule() computed.
 *
 *   npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot } = require("./support/harness.js");

const NORMAL_MS = 5000;
const BACKOFF_MS = 180000; // ACTIVITY_ERROR_BACKOFF_MS, must be >= normal

function makeScheduler(activityImpl) {
  const { P } = boot();
  // A config whose activityMs is known, so the interval is predictable.
  const config = {
    get: function () {
      return {
        pollMs: 3600000,
        activityMs: NORMAL_MS,
        activityBoost: false,
        activityBoostMs: 2000,
        retainDays: 0,
      };
    },
  };
  // Stub the activity module the scheduler calls into. Each test supplies how a
  // tick resolves; the scheduler owns the cadence logic under test.
  P.activity = { tick: activityImpl };
  const store = {
    _meta: {},
    setMeta: function (k, v) {
      this._meta[k] = v;
      return Promise.resolve();
    },
    getMeta: function (k, dflt) {
      return Promise.resolve(this._meta[k] === undefined ? dflt : this._meta[k]);
    },
  };
  const deps = {
    config: config,
    store: store,
    db: { getAll: function () { return Promise.resolve([]); } },
  };
  return { P: P, sched: P.scheduler.create(deps), store: store };
}

test("a failing activity tick engages the error back-off (re-arms the timer)", async () => {
  // Start with a healthy tick so start()'s own tick does not pre-fail; then flip
  // to failing and assert the first failure re-arms at the backed-off interval.
  let fail = false;
  const { P, sched } = makeScheduler(function () {
    if (fail) return Promise.resolve({ state: "unavailable", errors: ["feed down"] });
    return Promise.resolve({ state: "ok", plays: 0, sessions: 0, online: 0, records: [] });
  });
  try {
    await sched.start();
    assert.equal(sched.bus.activityMs, NORMAL_MS, "starts at the normal cadence");
    fail = true;
    await sched.activityTick();
    assert.ok(
      sched.bus.activityMs >= BACKOFF_MS,
      "after the first failed tick the timer is armed at the backed-off interval, got " + sched.bus.activityMs
    );
    assert.ok(sched._state().activityErrors >= 1, "the failure was counted");
  } finally {
    await sched.stop();
    await P.db.close();
  }
});

test("a throwing activity tick also engages the back-off", async () => {
  const { P, sched } = makeScheduler(function () {
    return Promise.reject(new Error("network down"));
  });
  try {
    await sched.start();
    await sched.activityTick();
    assert.ok(
      sched.bus.activityMs >= BACKOFF_MS,
      "a thrown tick backs the timer off too, got " + sched.bus.activityMs
    );
  } finally {
    await sched.stop();
    await P.db.close();
  }
});

test("recovery restores the normal cadence after the back-off", async () => {
  let fail = true;
  const { P, sched } = makeScheduler(function () {
    if (fail) return Promise.resolve({ state: "unavailable", errors: ["down"] });
    return Promise.resolve({ state: "ok", plays: 0, sessions: 0, online: 0, records: [] });
  });
  try {
    await sched.start();
    await sched.activityTick(); // fail -> back off
    assert.ok(sched.bus.activityMs >= BACKOFF_MS, "backed off while failing");
    fail = false;
    await sched.activityTick(); // recover -> normal cadence
    assert.equal(
      sched.bus.activityMs,
      NORMAL_MS,
      "a successful tick after failures restores the normal cadence, got " + sched.bus.activityMs
    );
  } finally {
    await sched.stop();
    await P.db.close();
  }
});