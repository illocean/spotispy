"use strict";
/**
 * Spotispy — shared toast dedupe helpers (src/pwt/app.js).
 *
 * The app (open) and the extension (background hourly scans) both register
 * scan hooks, so a scan's digest and error toasts would fire twice. The
 * helpers dedupe on the message, stamp the key ONLY when a toast actually
 * goes out (notify.emit() returns undefined — the senders check their own
 * preconditions), and let a genuinely different message through.
 *
 *   npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot } = require("./support/harness.js");

/** Fresh window + Spicetify stub + loaded sources, per test. */
function fresh() {
  const { win, P } = boot();
  const calls = { toasts: [], nav: [], get: [], post: [], handlers: [] };
  var stub = {
    showNotification: function (msg) { calls.toasts.push(msg); },
    CosmosAsync: { get: async function () { return {}; }, post: async function () { return {}; }, put: async function () { return {}; }, del: async function () { return {}; } },
    LocalStorage: { get: function () { return null; }, set: function () {} },
  };
  win.Spicetify = stub;
  // notify.js reads the Spicetify global of its own realm (globalThis here).
  globalThis.Spicetify = stub;
  // boot() re-evaluates the sources, so this PWT's config module is fresh but
  // still backed by the same localStorage; reset the toast setting explicitly.
  P.config.set({ notifyToast: true });
  // Drop any dedupe state left on the shared realm by an earlier test file.
  delete globalThis.__pwtToastSeen;
  return { win, P, calls };
}

test("a digest toast shows once per message per window, twice for different messages", () => {
  const { win, P, calls } = fresh();
  try {
    // Both bundles call this with the same totals: one toast, not two.
    globalThis.__pwtScanDoneToast({ added: 1, removed: 0, edits: 0, failed: 0, errors: [] });
    globalThis.__pwtScanDoneToast({ added: 1, removed: 0, edits: 0, failed: 0, errors: [] });
    assert.equal(calls.toasts.length, 1, "the same digest (both bundles' hooks) shows one toast: " + JSON.stringify(calls.toasts));
    assert.ok(/\+1/.test(calls.toasts[0]), "the digest line names the change: " + calls.toasts[0]);

    // A genuinely different scan (different message) is a different key.
    globalThis.__pwtScanDoneToast({ added: 4, removed: 1, edits: 0, failed: 0, errors: [] });
    assert.equal(calls.toasts.length, 2, "a different digest shows its own toast: " + JSON.stringify(calls.toasts));

    // A failed-but-nothing-else scan still says what failed.
    globalThis.__pwtScanDoneToast({ added: 0, removed: 0, edits: 0, failed: 2, errors: [] });
    assert.equal(calls.toasts.length, 3, "a failure digest shows a toast: " + JSON.stringify(calls.toasts));
    assert.ok(/2 sources failed/i.test(calls.toasts[2]), "the failure digest names the count: " + calls.toasts[2]);
  } finally {
    delete globalThis.__pwtToastSeen;
    delete globalThis.__pwtScanDoneToast;
    delete globalThis.__pwtScanErrorToast;
    delete globalThis.__pwtScanErrorAt;
    P.db.close();
  }
});

test("scan error toasts dedupe on the message and show different failures", () => {
  const { win, P, calls } = fresh();
  try {
    var e1 = new Error("profile endpoint -1: Resolver not found!");
    globalThis.__pwtScanErrorToast(e1);
    globalThis.__pwtScanErrorToast(e1);
    assert.equal(calls.toasts.length, 1, "the same failure (both bundles' hooks) shows one toast: " + JSON.stringify(calls.toasts));
    assert.ok(/Resolver not found/.test(calls.toasts[0]), "the toast names the failure: " + calls.toasts[0]);

    globalThis.__pwtScanErrorToast(new Error("IndexedDB open failed: SchemaError"));
    assert.equal(calls.toasts.length, 2, "a genuinely different failure shows its own toast: " + JSON.stringify(calls.toasts));
  } finally {
    delete globalThis.__pwtToastSeen;
    delete globalThis.__pwtScanDoneToast;
    delete globalThis.__pwtScanErrorToast;
    delete globalThis.__pwtScanErrorAt;
    P.db.close();
  }
});

test("toasts suppressed by settings never stamp the dedupe key", () => {
  const { win, P, calls } = fresh();
  try {
    P.config.set({ notifyToast: false });
    globalThis.__pwtScanErrorToast(new Error("boom suppressed"));
    globalThis.__pwtScanDoneToast({ added: 1, removed: 0, edits: 0, failed: 0, errors: [] });
    assert.equal(calls.toasts.length, 0, "settings off: no toast goes out");
    assert.ok(!globalThis.__pwtToastSeen || !globalThis.__pwtToastSeen["err:boom suppressed"], "the suppressed error was not stamped");

    // Turning toasts back on must show the real one, not swallow it.
    P.config.set({ notifyToast: true });
    globalThis.__pwtScanErrorToast(new Error("boom suppressed"));
    assert.equal(calls.toasts.length, 1, "the first real toast after enabling still shows: " + JSON.stringify(calls.toasts));
  } finally {
    delete globalThis.__pwtToastSeen;
    delete globalThis.__pwtScanDoneToast;
    delete globalThis.__pwtScanErrorToast;
    delete globalThis.__pwtScanErrorAt;
    P.db.close();
  }
});

test("the app-first boot registers the default hooks (no isBooted early-return)", () => {
  const { win, P, calls } = fresh();
  try {
    // App boots first, with no hooks: the cached defaults must register.
    var booted = P.app.Boot();
    assert.ok(booted, "Boot() returns the shared instance");
    assert.equal(typeof booted.deps.onScanDone, "function", "the default onScanDone is registered even when the app booted first");
    assert.equal(typeof booted.deps.onScanError, "function", "the default onScanError is registered");

    // A second Boot() (extension arriving later, no hooks) must not double-wrap.
    var again = P.app.Boot();
    assert.equal(again, booted, "the same shared instance");
    var chain = booted.deps._hookChain || [];
    assert.equal(chain.length, 3, "each default hook is chained at most once: " + chain.length);
    void calls;
  } finally {
    delete globalThis.__pwtToastSeen;
    delete globalThis.__pwtScanDoneToast;
    delete globalThis.__pwtScanErrorToast;
    delete globalThis.__pwtScanErrorAt;
    P.db.close();
  }
});