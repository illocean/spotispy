/* eslint-disable */
/**
 * Spotispy — scheduler.
 *
 * One code path for automatic and manual scans:
 *   hourly    -> runNow({scope:'all'})   profiles -> playlists -> metrics
 *   every 60s -> activityTick()          one request, adaptive cadence
 *
 * Single-flight: a second runNow while one is in flight returns the same
 * promise. `force:true` only skips the "polled < 5 min ago" guard. Live progress
 * is published on the shared `bus` object, which the app reads.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.scheduler = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function P() {
    return root.PWT;
  }

  var MANUAL_GUARD_MS = 5 * 60000;
  var ACTIVITY_ERROR_BACKOFF_MS = 180000;

  function create(deps) {
    deps = deps || {};
    var timers = { scan: null, activity: null };
    var running = null;
    var activityRunning = null;
    var activityErrors = 0;
    var stopped = true;
    var startedAt = Date.now();
    var config = deps.config || (P() && P().config);
    var bus = {
      scanning: false,
      stage: "",
      done: 0,
      total: 0,
      totals: { added: 0, removed: 0, edits: 0, failed: 0, errors: [] },
      lastScanAt: 0,
      crashAt: 0,
      nextScanAt: 0,
      current: null,
      lastActivityAt: 0,
      activityState: "idle",
      activity: { plays: 0, sessions: 0 },
      listeners: [],
    };

    function settings() {
      return config ? config.get() : { pollMs: 3600000, activityMs: 60000, activityBoost: true, activityBoostMs: 10000 };
    }

    function emit() {
      for (var i = 0; i < bus.listeners.length; i++) {
        try {
          bus.listeners[i](bus);
        } catch (e) {
          /* a broken listener must not stop a scan */
        }
      }
    }

    /**
     * The live per-phase totals, by phase name. The bus's own `totals` field is
     * recomputed from these on every progress call — never handed a scanner's
     * object, which would make " += " merge into itself (double counting) and
     * let the playlists phase overwrite the profiles phase.
     */
    var phaseTotals = {};

    function recomputeTotals() {
      var out = { added: 0, removed: 0, edits: 0, failed: 0, errors: [] };
      ["profiles", "playlists"].forEach(function (key) {
        var t = phaseTotals[key];
        if (!t) return;
        out.added += t.added || 0;
        out.removed += t.removed || 0;
        out.edits += t.edits || 0;
        out.failed += t.failed || 0;
        if (Array.isArray(t.errors)) out.errors = out.errors.concat(t.errors);
      });
      return out;
    }

    function progress(stage, done, total, totals, item) {
      bus.stage = stage;
      bus.done = done;
      bus.total = total;
      if (totals) {
        var phase = stage === "profiles" ? "profiles" : "playlists";
        phaseTotals[phase] = totals;
        bus.totals = recomputeTotals();
      }
      bus.current = item && item.id ? item.id : null;
      emit();
    }

    // The bus exposes its own progress channel, so `deps.progress` (which the
    // scanners call) reaches the same state the UI reads.
    bus.progress = progress;

    /**
     * Run a scan.
     * @param {object} opts { scope: 'all'|'profiles'|'playlists', force }
     */
    function runNow(opts) {
      opts = opts || {};
      var scope = opts.scope || "all";
      if (running) return running;
      var last = bus.lastScanAt || 0;
      if (!opts.force && last && Date.now() - last < MANUAL_GUARD_MS && scope === "all") {
        return Promise.resolve({ skipped: "recent" });
      }
      var pwt = P();
      bus.scanning = true;
      bus.stage = scope;
      bus.done = 0;
      bus.total = 0;
      phaseTotals = {};
      bus.totals = recomputeTotals();
      emit();

      running = (async function () {
        var out = { scope: scope, startedAt: Date.now() };
        try {
          if (scope === "all" || scope === "profiles") {
            out.profiles = await pwt.profiles.scanProfiles(deps, Object.assign({}, opts, { progress: progress }));
            // The scanner's own running totals were registered phase-by-phase
            // in phaseTotals; the aggregate is rebuilt from them, never merged
            // against itself.
            if (out.profiles && out.profiles.totals) phaseTotals.profiles = out.profiles.totals;
            bus.totals = recomputeTotals();
            emit();
          }
          if (scope === "all" || scope === "playlists") {
            out.playlists = await pwt.playlists.scanPlaylists(deps, {
              force: opts.force,
              progress: progress,
            });
            if (out.playlists && out.playlists.totals) phaseTotals.playlists = out.playlists.totals;
            bus.totals = recomputeTotals();
            emit();
          }
          out.finishedAt = Date.now();
          bus.lastScanAt = out.finishedAt;
          bus.error = "";
          bus.nextScanAt = out.finishedAt + settings().pollMs;
          await deps.store.setMeta("lastScanAt", out.finishedAt);
          await deps.store.setMeta("lastScanResult", { at: out.finishedAt, totals: bus.totals, scope: scope, errors: bus.totals.errors });
          if (deps.onScanDone) deps.onScanDone(out, bus.totals);
          if (P().telemetry) P().telemetry.record("scan." + scope, out.finishedAt - out.startedAt, !out.error, out.error || "");
          return out;
        } catch (e) {
          bus.error = String((e && e.message) || e);
          out.error = bus.error;
          out.finishedAt = Date.now();
          // A signal the UI listens for: the app reloads its route on this
          // tick, not on lastScanAt, so a crashed run's reason actually shows.
          bus.crashAt = out.finishedAt;
          // Even a crashed run owes the UI an honest answer: record the
          // attempt and why it failed. lastScanAt deliberately stays put —
          // "refreshed" means the last scan that actually succeeded.
          try {
            await deps.store.setMeta("lastScanResult", { at: out.finishedAt, totals: bus.totals, scope: scope, error: bus.error, errors: bus.totals.errors });
          } catch (e2) {
            /* diagnostics is best effort */
          }
          if (P().telemetry) {
            P().telemetry.record("scan." + scope, out.finishedAt - out.startedAt, false, bus.error);
            P().telemetry.captureError("scan." + scope, e);
          }
          if (deps.onScanError) deps.onScanError(e);
          return out;
        } finally {
          bus.scanning = false;
          bus.stage = "";
          bus.current = null;
          // Art cache fill: never part of the scan contract; a no-op in tests.
          try {
            if (P().art && P().art.sweep) await P().art.sweep(P(), { limit: 30 });
          } catch (e) {
            /* art is a cache fill, not part of the scan contract */
          }
          running = null;
          emit();
        }
      })();
      return running;
    }

    /** One activity tick; the tick itself is single-flight. */
    function activityTick(opts) {
      if (activityRunning) return activityRunning;
      var pwt = P();
      activityRunning = (async function () {
        try {
          var tTick = Date.now();
          var r = await pwt.activity.tick(deps, opts);
          if (pwt.telemetry) pwt.telemetry.record("activity.tick", Date.now() - tTick, true, r.state || "");
          // An `unavailable` tick is a failed poll, not a success: the feed did
          // not answer. Counting it is what lets the error back-off engage, so a
          // dead endpoint does not keep polling at the normal cadence.
          if (r.state === "unavailable" || r.state === "error") {
            activityErrors++;
            bus.activityState = r.state;
            bus.activityError = (r.errors && r.errors.join("; ")) || r.error || "activity unavailable";
            if (deps.onActivity) deps.onActivity(r);
            emit();
            return r;
          }
          activityErrors = 0;
          bus.lastActivityAt = Date.now();
          bus.activityState = r.state;
          bus.activity = { plays: r.plays || 0, sessions: r.sessions || 0, online: r.online || 0, hidden: r.hidden || 0 };
          if (r.records) {
            bus.activityRecords = r.records;
          } else if (r.unchanged) {
            // Records are unchanged; keep them only when the caller asked or the bus has none.
            if (!bus.activityRecords) bus.activityRecords = [];
          }
          if (deps.onActivity) deps.onActivity(r);
          emit();
          return r;
        } catch (e) {
          activityErrors++;
          bus.activityState = "error";
          bus.activityError = String((e && e.message) || e);
          if (pwt.telemetry) {
            pwt.telemetry.record("activity.tick", Date.now() - tTick, false, bus.activityError);
            pwt.telemetry.captureError("activity.tick", e);
          }
          emit();
          return { state: "error", error: bus.activityError };
        } finally {
          activityRunning = null;
        }
      })();
      return activityRunning;
    }

    /** Re-arm both timers from current settings; safe to call any time. */
    function reschedule() {
      var s = settings();
      clearInterval(timers.scan);
      clearInterval(timers.activity);
      timers.scan = setInterval(function () {
        if (Date.now() - (bus.lastScanAt || 0) >= s.pollMs - 5000) runNow({ scope: "all" });
      }, Math.min(s.pollMs, 60000));
      var activityMs = activityErrors ? Math.max(s.activityMs, ACTIVITY_ERROR_BACKOFF_MS) : s.activityMs;
      // Re-arm from the current error state, so a failure that arrived after
      // start() still backs the timer off instead of leaving it at the normal
      // cadence. reschedule() is the only place that reads activityErrors, and
      // it is called on the settings path and on demand.
      if (s.activityMs > 0) {
        timers.activity = setInterval(function () {
          if (typeof navigator !== "undefined" && navigator.onLine === false) return;
          activityTick();
        }, activityMs);
      }
      bus.activityMs = activityMs;
      bus.nextScanAt = (bus.lastScanAt || Date.now()) + s.pollMs;
      emit();
    }

    /** Boot: reschedule, then catch up if a whole interval elapsed while closed. */
    async function start() {
      if (!stopped) return;
      stopped = false;
      var store = deps.store;
      var last = await store.getMeta("lastScanAt", 0);
      bus.lastScanAt = last || 0;
      bus.nextScanAt = (last || Date.now()) + settings().pollMs;
      reschedule();
      if (deps.onStart) deps.onStart();
      if (!last || Date.now() - last > settings().pollMs) {
        // Catch-up batch, labelled as such by the scan's own timestamp.
        runNow({ scope: "all" });
      }
      if (settings().activityMs > 0) {
        activityTick();
      }
      return true;
    }

    async function stop() {
      stopped = true;
      clearInterval(timers.scan);
      clearInterval(timers.activity);
      timers.scan = null;
      timers.activity = null;
      // Session repair: close every open session at its last observed play.
      try {
        var pwt = P();
        var all = await deps.db.getAll("activityState");
        var states = {};
        for (var i = 0; i < all.length; i++) states[all[i].userId] = pwt.session.restore(all[i]);
        var closed = pwt.session.closeAll(states, Date.now());
        if (closed.length) {
          await deps.store.putSessions(closed);
          for (var uid in states) await deps.db.put("activityState", Object.assign({ userId: uid }, pwt.session.snapshot(states[uid])));
        }
      } catch (e) {
        /* shutdown repair is best effort */
      }
      if (deps.onStop) deps.onStop();
    }

    function on(fn) {
      bus.listeners.push(fn);
      return function () {
        bus.listeners = bus.listeners.filter(function (f) {
          return f !== fn;
        });
      };
    }

    return {
      start: start,
      stop: stop,
      runNow: runNow,
      activityTick: activityTick,
      reschedule: reschedule,
      on: on,
      bus: bus,
      _state: function () {
        return { running: !!running, activityRunning: !!activityRunning, startedAt: startedAt, activityErrors: activityErrors };
      },
    };
  }

  return { create: create, MANUAL_GUARD_MS: MANUAL_GUARD_MS };
});
