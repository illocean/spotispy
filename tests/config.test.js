"use strict";
/**
 * Spotispy — settings persistence.
 *
 * Every toggle the Settings view renders must survive a reload. A value that
 * `coerce()` drops is a control that silently does nothing: the UI shows the
 * user's choice while the stored config keeps the old value, and the feature
 * reads the default forever.
 *
 *   npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const CONFIG = path.join(__dirname, "..", "src", "pwt", "core", "config.js");

/**
 * Load config against a fresh in-memory LocalStorage and return
 * { get, set, raw, restore } so a test can inspect what was actually persisted.
 *
 * config.js is a UMD module: its `root` resolves to `globalThis` whenever that
 * exists (it always does in Node), and its storage wrapper dereferences
 * `root.localStorage` LAZILY on every call. The fake therefore has to stay
 * installed for the life of the returned handle — restoring it early makes
 * `save()` throw inside its own try/catch and silently persist nothing.
 */
function freshConfig() {
  const backing = {};
  const prev = globalThis.localStorage;
  const prevPWT = globalThis.PWT;
  globalThis.localStorage = {
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null;
    },
    setItem: function (k, v) {
      backing[k] = String(v);
    },
  };
  globalThis.PWT = {};
  const src = require("fs").readFileSync(CONFIG, "utf8");
  const module_ = { exports: {} };
  new Function("module", "exports", src + "\n//# sourceURL=config-under-test.js")(module_, module_.exports);
  const api = module_.exports;
  return {
    KEY: api.KEY,
    get: api.get,
    set: api.set,
    raw: function () {
      const s = backing[api.KEY];
      return s ? JSON.parse(s) : null;
    },
    restore: function () {
      if (prev === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prev;
      globalThis.PWT = prevPWT;
    },
  };
}

test("followers toggle survives a reload (it used to be dropped by coerce)", () => {
  const c = freshConfig();
  try {
    c.set({ followers: false });
    assert.equal(c.get().followers, false, "the stored value is the user's choice, not the default");
    assert.equal(c.raw().followers, false, "and it reached storage, so a reload keeps it");

    c.set({ followers: true });
    assert.equal(c.get().followers, true, "turning it back on works too");
  } finally {
    c.restore();
  }
});

test("activityMs 0 means off and is not silently reverted", () => {
  const c = freshConfig();
  try {
    c.set({ activityMs: 0 });
    assert.equal(c.get().activityMs, 0, "0 is a legal 'off' value");
    assert.equal(c.raw().activityMs, 0, "and it is persisted, so a reload keeps it off");

    c.set({ activityMs: 30000 });
    assert.equal(c.get().activityMs, 30000, "a real interval still works");
  } finally {
    c.restore();
  }
});

test("coerce still rejects values outside the allowed set", () => {
  const c = freshConfig();
  try {
    c.set({ pollMs: 12345 });
    assert.equal(c.get().pollMs, 3600000, "an unlisted interval falls back to the default");
    c.set({ activityMs: 45000 });
    assert.equal(c.get().activityMs, 5000, "an unlisted activity interval falls back too");
    c.set({ activityMs: -1 });
    assert.equal(c.get().activityMs, 5000, "a negative interval is rejected");
    c.set({ logCap: -5 });
    assert.equal(c.get().logCap, 10000, "a negative quantity is rejected");
  } finally {
    c.restore();
  }
});

test("retainDays 0 means 'keep forever' and is not silently reverted", () => {
  const c = freshConfig();
  try {
    c.set({ retainDays: 0 });
    assert.equal(c.get().retainDays, 0, "0 is a legal 'never prune' value");
    assert.equal(c.raw().retainDays, 0, "and it is persisted, so a reload keeps it");

    c.set({ retainDays: 30 });
    assert.equal(c.get().retainDays, 30, "a real window still works");

    // A stored string or an unlisted number must fall back to the default
    // rather than disabling retention or throwing.
    c.set({ retainDays: -1 });
    assert.equal(c.get().retainDays, 90, "a negative window falls back to the default");
    c.set({ retainDays: 7 });
    assert.equal(c.get().retainDays, 90, "an unlisted window falls back too");
  } finally {
    c.restore();
  }
});

test("activityBoostMs is a real cadence and survives a reload", () => {
  const c = freshConfig();
  try {
    c.set({ activityBoostMs: 5000 });
    assert.equal(c.get().activityBoostMs, 5000, "a 5 s boost is allowed");
    assert.equal(c.raw().activityBoostMs, 5000, "and it reaches storage");

    c.set({ activityBoostMs: 60000 });
    assert.equal(c.get().activityBoostMs, 2000, "a boost interval longer than any listed cadence is rejected");
  } finally {
    c.restore();
  }
});

test("a fresh config carries every key the Settings view renders", () => {
  const c = freshConfig();
  try {
    const d = c.get();
    // view.settingsModel() reads all of these; a missing key means a control that
    // cannot reflect its own state.
    ["notifyToast", "notifyOs", "notifyAdditions", "notifyRemovals", "notifyProfile", "notifyPresence", "activityBoost", "followers", "pollMs", "activityMs", "activityBoostMs", "retainDays", "logCap"].forEach(function (k) {
      assert.ok(Object.prototype.hasOwnProperty.call(d, k), "DEFAULTS is missing " + k);
    });
  } finally {
    c.restore();
  }
});