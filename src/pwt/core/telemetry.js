/* eslint-disable */
/**
 * Spotispy — self-observation (telemetry).
 *
 * The app watches itself: every timed operation lands in a bounded ring buffer,
 * uncaught errors are captured with scope + stack, and the Diagnostics panel in
 * Settings renders the result. Nothing leaves the machine unless the user copies
 * a report. Used to find bottlenecks and to answer "why does it not work" with
 * captured evidence instead of a silent failure.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.telemetry = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var MAX_ENTRIES = 300;
  var MAX_ERRORS = 60;

  var entries = [];
  var errors = [];
  var counters = {};
  var bootAt = Date.now();
  var hookInstalled = false;
  var lastSelfTest = null;

  function now() {
    return root.performance && typeof root.performance.now === "function" ? root.performance.now() : Date.now();
  }

  function record(name, ms, ok, detail) {
    entries.push({
      name: String(name),
      ms: Math.round(ms * 10) / 10,
      ok: ok !== false,
      at: Date.now(),
      detail: detail == null ? "" : String(detail).slice(0, 300),
    });
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  }

  function count(name, by) {
    counters[name] = (counters[name] || 0) + (by == null ? 1 : by);
  }

  function captureError(scope, err) {
    var e = err || {};
    var message = String(e.message || e.reason || e || "unknown error");
    errors.push({
      scope: String(scope || "unknown"),
      message: message.slice(0, 300),
      stack: String(e.stack || "").slice(0, 600),
      at: Date.now(),
    });
    if (errors.length > MAX_ERRORS) errors.splice(0, errors.length - MAX_ERRORS);
    count("errors");
    return errors[errors.length - 1];
  }

  /**
   * Time `fn`. Works for sync and async functions; rethrows on failure so
   * callers behave as before, but the failure is recorded first.
   */
  function time(name, fn, detail) {
    var t0 = now();
    try {
      var r = fn();
      if (r && typeof r.then === "function") {
        return r.then(
          function (v) {
            record(name, now() - t0, true, detail);
            return v;
          },
          function (e) {
            record(name, now() - t0, false, (e && e.message) || String(e));
            captureError(name, e);
            throw e;
          }
        );
      }
      record(name, now() - t0, true, detail);
      return r;
    } catch (e) {
      record(name, now() - t0, false, (e && e.message) || String(e));
      captureError(name, e);
      throw e;
    }
  }

  /** Capture window.onerror / unhandledrejection; safe to call twice. */
  function installGlobalHook() {
    if (hookInstalled) return true;
    hookInstalled = true;
    try {
      if (typeof root.addEventListener === "function") {
        root.addEventListener("error", function (ev) {
          var err = ev && ev.error ? ev.error : { message: (ev && ev.message) || "window error" };
          captureError("window", err);
        });
        root.addEventListener("unhandledrejection", function (ev) {
          captureError("unhandledrejection", ev && (ev.reason || ev));
        });
        return true;
      }
    } catch (e) {
      /* hook is best effort */
    }
    return false;
  }

  function slowest(limit) {
    var okOnes = entries.slice().sort(function (a, b) {
      return b.ms - a.ms;
    });
    return okOnes.slice(0, limit || 8);
  }

  function report() {
    return {
      bootAt: bootAt,
      upMs: Date.now() - bootAt,
      counters: Object.assign({}, counters),
      slowest: slowest(10),
      errors: errors.slice(-20),
      recent: entries.slice(-30),
      lastSelfTest: lastSelfTest,
    };
  }

  function reset() {
    entries = [];
    errors = [];
    counters = {};
    lastSelfTest = null;
  }

  /**
   * In-app self-test. Each check is timed and isolated; a failing check is
   * reported, never thrown. Network checks are read-only and optional.
   * @param {object} deps { db, store, bus, scheduler, probeNetwork }
   */
  async function runSelfTest(deps) {
    deps = deps || {};
    var pwt = root.PWT || {};
    var checks = [];
    var tAll = now();

    async function check(name, fn) {
      var t0 = now();
      try {
        var detail = await fn();
        var ms = Math.round((now() - t0) * 10) / 10;
        checks.push({ name: name, ok: true, ms: ms, detail: detail == null ? "" : String(detail) });
        record("selftest." + name, ms, true);
      } catch (e) {
        var ms2 = Math.round((now() - t0) * 10) / 10;
        var message = String((e && e.message) || e);
        checks.push({ name: name, ok: false, ms: ms2, detail: message.slice(0, 300) });
        record("selftest." + name, ms2, false, message);
        captureError("selftest:" + name, e);
      }
    }

    var db = deps.db || pwt.db;
    var store = deps.store || pwt.store;
    var bus = deps.bus || pwt.bus;

    await check("IndexedDB opens and counts rows", async function () {
      if (!db) throw new Error("PWT.db is missing");
      await db.open();
      var counts = {};
      counts.changes = await db.count("changes");
      counts.plays = await db.count("plays");
      counts.playlists = await db.count("playlists");
      counts.profiles = await db.count("profiles");
      return (
        counts.changes + " changes · " + counts.plays + " plays · " +
        counts.playlists + " playlists · " + counts.profiles + " profiles"
      );
    });

    await check("Settings storage readable", async function () {
      var cfg = pwt.config && pwt.config.get();
      if (!cfg || !(cfg.pollMs > 0)) throw new Error("config returned no poll interval");
      return "poll " + Math.round(cfg.pollMs / 60000) + " min";
    });

    await check("Change log readable", async function () {
      var rows = await store.recentChanges(1);
      return rows.length + " row(s) sampled";
    });

    await check("Watch list readable", async function () {
      var watches = await store.listWatches();
      return watches.length + " watch(es)";
    });

    await check("Track metadata cache", async function () {
      var tracks = await db.getAll("tracks");
      var withArt = tracks.filter(function (t) { return t && t.art; }).length;
      return tracks.length + " tracks, " + withArt + " with art";
    });

    await check("Scheduler bus alive", async function () {
      if (!bus) throw new Error("no shared bus; boot did not complete");
      if (bus.lastScanAt) {
        return "last scan " + new Date(bus.lastScanAt).toLocaleString() + (bus.scanning ? " · scanning now" : "");
      }
      return "never scanned · next at " + (bus.nextScanAt ? new Date(bus.nextScanAt).toLocaleString() : "—");
    });

    await check("Spicetify client session", async function () {
      var S = root.Spicetify;
      if (!S) throw new Error("Spicetify global missing — extension/app did not load");
      if (!S.CosmosAsync) throw new Error("Spicetify.CosmosAsync missing — client not ready (or unsupported build)");
      return "CosmosAsync present";
    });

    await check("Storage quota", async function () {
      var nav = root.navigator;
      if (!nav || !nav.storage || !nav.storage.estimate) return "estimate unsupported (ok)";
      var est = await nav.storage.estimate();
      return Math.round((est.usage || 0) / 1048576 * 10) / 10 + " MB used";
    });

    if (deps.probeNetwork !== false) {
      // The route probes report what THIS client can answer. Probing a host the
      // client cannot reach at all (verified live on 1.3.9.2055:
      // api.spotify.com resolves {code:429,message:"Failed to fetch"} and the
      // renderer's own fetch() gets 401) only says "unreachable", which is
      // indistinguishable from a real network fault. So probe the routes
      // Spotispy actually reads through: the client playlist API and spclient.
      await check("Playlist route (client playlist API)", async function () {
        var net = pwt.net;
        var S = root.Spicetify;
        var A = S && S.Platform && S.Platform.PlaylistAPI;
        if (!net || !pwt.sources) throw new Error("net/sources missing");
        if (!A || typeof A.getContents !== "function") {
          throw new Error("unsupported — this build has no Platform.PlaylistAPI; Spotispy uses the HTTP chain instead");
        }
        var res;
        try {
          res = await Promise.race([
            net.call(pwt.sources.SOURCES.clientContents.fn("37i9dQZF1DXcBWIGoYBM5M")),
            new Promise(function (_, reject) {
              setTimeout(function () { reject(new Error("timed out after 5s")); }, 5000);
            }),
          ]);
        } catch (e) {
          throw new Error("the client playlist route failed: " + String((e && e.message) || e));
        }
        var be = net.bodyError ? net.bodyError(res) : null;
        if (be) throw new Error("the client playlist route returned an error: " + (be.message || "unknown"));
        var parsed = pwt.sources.SOURCES.clientContents.parse(res);
        if (!parsed.uris.length) throw new Error("the client playlist route answered, but carried no track URIs");
        return "responded with " + parsed.uris.length + " of " + (parsed.total == null ? "?" : parsed.total) + " tracks";
      });

      await check("Profile route (spclient user-profile-view)", async function () {
        var net = pwt.net;
        if (!net || !pwt.sources) throw new Error("net/sources missing");
        var res;
        try {
          res = await Promise.race([
            net.call(pwt.sources.ENDPOINTS.profile("spotify", { playlistLimit: 1, artistLimit: 0, episodeLimit: 0 })),
            new Promise(function (_, reject) {
              setTimeout(function () { reject(new Error("timed out after 6s")); }, 6000);
            }),
          ]);
        } catch (e) {
          var eMsg = String((e && e.message) || "");
          var eTransport = pwt.util && pwt.util.isTransportFailure && pwt.util.isTransportFailure(eMsg);
          // A status means the client answered; anything else never got there.
          throw new Error((e && e.status) && !eTransport ? "http " + e.status + ": " + eMsg : "unreachable — " + eMsg);
        }
        var be = net.bodyError ? net.bodyError(res) : null;
        if (be) {
          // Same rule as every other surface: a transport-failure body is
          // unreachable, anything else is a real answer shown through the
          // shared wording (never a fabricated status).
          var text = net.describeError ? net.describeError(res) : String((be && be.message) || res);
          throw new Error(be.transport ? "unreachable — " + text : text);
        }
        if (res && res.uri) return "responded for " + (res.name || res.uri);
        throw new Error("answered with an unexpected shape (no profile uri)");
      });
    }

    var pass = checks.filter(function (c) { return c.ok; }).length;
    var result = {
      at: Date.now(),
      pass: pass,
      fail: checks.length - pass,
      total: checks.length,
      totalMs: Math.round((now() - tAll) * 10) / 10,
      checks: checks,
    };
    lastSelfTest = result;
    count("selftests");
    if (store && store.setMeta) {
      try {
        await store.setMeta("selfTest", { at: result.at, pass: result.pass, fail: result.fail, totalMs: result.totalMs });
      } catch (e) {
        /* diagnostics must never break the app */
      }
    }
    return result;
  }

  return {
    record: record,
    count: count,
    captureError: captureError,
    time: time,
    installGlobalHook: installGlobalHook,
    slowest: slowest,
    report: report,
    runSelfTest: runSelfTest,
    reset: reset,
    _entries: function () {
      return entries.slice();
    },
  };
});
