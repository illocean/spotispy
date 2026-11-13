/* eslint-disable */
/**
 * Spotispy — boot seam.
 *
 * `ensure()` is idempotent and safe to call from both the extension (runs at
 * Spotify start-up) and the app (runs when the tab opens). Whoever calls first
 * creates the scheduler; the other reuses it. The scheduler keeps running when
 * the app tab is closed, because the extension owns it. Live progress is
 * published on `PWT.bus` (the scheduler's own bus object), so no message bus is
 * needed between the two.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.boot = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function P() {
    return root.PWT;
  }

  /**
   * The extension bundle and the custom-app bundle each carry a self-contained
   * copy of PWT, and both run in the same window. Without a window-level
   * singleton they would each create their own scheduler: the app's copy is
   * never started, `pwt.bus` points at it, and the UI reads a dead bus
   * (activityRecords stays empty forever, hourly scans don't reach the app's
   * bus, and the two race on the same IndexedDB). Whoever boots first wins;
   * everyone else reuses that exact instance.
   */
  var SINGLETON_KEY = "__PWT_BOOT__";

  function shared() {
    try {
      if (root && root[SINGLETON_KEY]) return root[SINGLETON_KEY];
    } catch (e) {
      /* unreadable global; fall through to the per-bundle copy */
    }
    return null;
  }

  function remember(b) {
    try {
      if (root) root[SINGLETON_KEY] = b;
    } catch (e) {
      /* a frozen global just means the per-bundle fallback applies */
    }
    return b;
  }

  /** Per-bundle fallback cache, used only when the global cannot hold the singleton. */
  var booted = null;

  /**
   * @param {object} hooks { onScanDone, onScanError, onActivity, onNotify, onStart, onStop }
   */
  function ensure(hooks) {
    hooks = hooks || {};
    var pwt = P();
    var prior = shared() || booted;
    if (prior) {
      // A second caller (usually the app after the extension) reuses the
      // shared instance and merges its hooks, so both surfaces get the
      // callbacks they registered. Each callable is chained at most once.
      // The shared scheduler is not recreated; `start()` stays idempotent.
      var chainList = prior.deps._hookChain || (prior.deps._hookChain = []);
      var merge = function (name) {
        var fn = hooks && hooks[name];
        var current = prior.deps[name];
        if (typeof fn !== "function" || chainList.indexOf(fn) >= 0) return;
        chainList.push(fn);
        prior.deps[name] = current
          ? function (a, b, c) { var self = this; try { current.apply(self, arguments); } catch (e) { /* a broken hook must not take down the other */ } try { fn.apply(self, arguments); } catch (e) { /* same */ } }
          : fn;
      };
      merge("onScanDone");
      merge("onScanError");
      merge("onActivity");
      merge("onStart");
      merge("onStop");
      booted = prior;
      pwt.bus = prior.scheduler.bus;
      return prior;
    }
    if (pwt.telemetry && pwt.telemetry.installGlobalHook) pwt.telemetry.installGlobalHook();
    var deps = {
      db: pwt.db,
      store: pwt.store,
      net: pwt.net,
      config: pwt.config,
      // Live scan progress. The scheduler owns the bus, so progress is forwarded
      // there; without this the progress bar and the per-item "scanning…" marker
      // never moved.
      progress: function (stage, done, total, totals, item) {
        if (deps._progressExtra) deps._progressExtra(stage, done, total, totals, item);
        else if (pwt.bus && pwt.bus.progress) pwt.bus.progress(stage, done, total, totals, item);
      },
      // Feature flag for the per-profile "watch activity" gate. The actual
      // answer is read from the stored profile flag by the activity module
      // (it needs the database); this only says the gate is in force.
      watchActivity: function () {
        return true;
      },
    };
    deps.onScanDone = function (out, totals) {
      if (hooks.onScanDone) hooks.onScanDone(out, totals);
    };
    deps.onScanError = function (e) {
      if (hooks.onScanError) hooks.onScanError(e);
    };
    deps.onActivity = function (r) {
      if (hooks.onActivity) hooks.onActivity(r);
    };
    deps.onStart = function () {
      if (hooks.onStart) hooks.onStart();
    };
    deps.onStop = function () {
      if (hooks.onStop) hooks.onStop();
    };
    var scheduler = pwt.scheduler.create(deps);
    pwt.bus = scheduler.bus;
    var fresh = { scheduler: scheduler, deps: deps, started: false };
    // The initial registration must be recorded too, or a second ensure()
    // (app mount after extension boot) chains the SAME callables again and
    // every hook fires twice from the second mount on.
    if (!deps._hookChain) deps._hookChain = [];
    ["onScanDone", "onScanError", "onActivity", "onStart", "onStop"].forEach(function (name) {
      if (typeof hooks[name] === "function") deps._hookChain.push(hooks[name]);
    });
    fresh.start = function () {
      if (fresh.started) return Promise.resolve();
      fresh.started = true;
      return scheduler.start();
    };
    fresh.stop = function () {
      fresh.started = false;
      return scheduler.stop();
    };
    fresh.deps = deps;
    booted = remember(fresh);
    return fresh;
  }

  function isBooted() {
    return !!(shared() || booted);
  }

  function instance() {
    return shared() || booted;
  }

  return { ensure: ensure, isBooted: isBooted, instance: instance };
});
