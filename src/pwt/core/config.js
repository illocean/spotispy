/* eslint-disable */
/** Spotispy — core settings with sane, explicit defaults (§12). */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.config = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var KEY = "pwt:settings:v1";

  var DEFAULTS = {
    pollMs: 3600000,
    activityMs: 5000,
    activityBoostMs: 2000,
    activityBoost: true,
    notifyToast: true,
    notifyOs: true,
    notifyAdditions: true,
    notifyRemovals: true,
    notifyProfile: true,
    notifyPresence: true,
    // Follower/following lists sit behind a capability probe; the toggle is
    // only a user preference and must survive a reload like every other flag.
    followers: true,
    retainDays: 7,
    logCap: 10000,
  };

  var ALLOWED = {
    pollMs: [900000, 1800000, 3600000, 10800000],
    // 0 means "off" and is a legal, documented choice (see Settings' "off"
    // option and the scheduler's `activityMs > 0` guards).
    activityMs: [0, 2000, 5000, 10000, 30000, 60000, 120000],
    // The boost interval must be a real cadence, never longer than the normal
    // one or it could never be "faster".
    activityBoostMs: [1000, 2000, 5000, 10000, 30000],
    // Retention in days. 0 means "never prune"; a stored string or negative
    // must fall back to the default rather than silently disabling the feature.
    retainDays: [0, 7, 30, 90, 180, 365],
  };

  function storage() {
    if (root.Spicetify && root.Spicetify.LocalStorage) {
      return {
        get: function (k) {
          return root.Spicetify.LocalStorage.get(k);
        },
        set: function (k, v) {
          return root.Spicetify.LocalStorage.set(k, v);
        },
      };
    }
    if (typeof root.localStorage !== "undefined") {
      return {
        get: function (k) {
          return root.localStorage.getItem(k);
        },
        set: function (k, v) {
          return root.localStorage.setItem(k, v);
        },
      };
    }
    return { get: function () { return null; }, set: function () {} };
  }

  var current = Object.assign({}, DEFAULTS);
  var loaded = false;
  var LS = storage();

  function coerce(raw) {
    var out = Object.assign({}, DEFAULTS);
    if (!raw || typeof raw !== "object") return out;
    for (var k in DEFAULTS) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) continue;
      var v = raw[k];
      if (v === undefined || v === null) continue;
      if (typeof DEFAULTS[k] === "boolean") {
        out[k] = !!v;
      } else if (typeof DEFAULTS[k] === "number") {
        var n = Number(v);
        if (!isFinite(n)) continue;
        // 0 is a real, documented "off" value for the intervals and for
        // retention; every other numeric setting is a positive quantity.
        var zeroMeansOff = k === "activityMs" || k === "retainDays";
        if (n < 0 || (n === 0 && !zeroMeansOff)) continue;
        if (ALLOWED[k] && ALLOWED[k].indexOf(n) < 0) continue;
        out[k] = n;
      }
    }
    return out;
  }

  function load() {
    if (loaded) return current;
    loaded = true;
    var raw = null;
    try {
      var s = LS.get(KEY);
      raw = typeof s === "string" ? JSON.parse(s) : s;
    } catch (e) {
      raw = null;
    }
    current = coerce(raw);
    return current;
  }

  function get() {
    if (!loaded) load();
    return current;
  }

  function save() {
    try {
      LS.set(KEY, JSON.stringify(current));
    } catch (e) {
      /* settings stay in memory when storage is full */
    }
  }

  function set(patch) {
    // A set before the first get must not be clobbered by the lazy load:
    // mark loaded and merge into whatever current is now.
    if (!loaded) {
      loaded = true;
      try {
        var s0 = LS.get(KEY);
        var raw0 = typeof s0 === "string" ? JSON.parse(s0) : s0;
        if (raw0 && typeof raw0 === "object") current = coerce(raw0);
      } catch (e0) {
        /* keep defaults */
      }
    }
    var merged = Object.assign({}, current, patch);
    current = coerce(merged);
    save();
    return current;
  }

  return {
    KEY: KEY,
    DEFAULTS: DEFAULTS,
    ALLOWED: ALLOWED,
    get: get,
    set: set,
    save: save,
    coerce: coerce,
  };
});
