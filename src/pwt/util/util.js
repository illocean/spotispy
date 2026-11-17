/* eslint-disable */
/** Spotispy â€” small dependency-free utilities. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.util = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function hash(text) {
    // FNV-1a 32-bit, hex. Enough for change detection, not for security.
    var h = 0x811c9dc5;
    var s = String(text == null ? "" : text);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return ("00000000" + h.toString(16)).slice(-8);
  }

  var ID_RE = /^[A-Za-z0-9]{22,40}$/;

  /**
   * Parse a playlist or user reference. Accepts open.spotify.com URLs, app
   * deep links, "spotify:playlist:<id>" and bare 22-char ids.
   * @returns {{type:'playlist'|'user', id:string} | null}
   */
  function parseRef(ref, expectType) {
    if (!ref) return null;
    var s = String(ref).trim();
    if (!s) return null;
    var m;
    if (ID_RE.test(s)) return { type: expectType || "playlist", id: s };
    m = /^spotify:(playlist|user|profile):([A-Za-z0-9]{22,40})(?:[?:].*)?$/.exec(s);
    if (m) {
      var t = m[1] === "profile" ? "user" : m[1];
      if (expectType && t !== expectType) return null;
      return { type: t, id: m[2] };
    }
    m = /^(?:https?:\/\/)?(?:open|play)\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|user)\/([A-Za-z0-9]{22,40})/.exec(s);
    if (m) {
      if (expectType && m[1] !== expectType) return null;
      return { type: m[1], id: m[2] };
    }
    m = /^(?:https?:\/\/)?spicetify\.app\/(?:playlist|user)\/([A-Za-z0-9]{22,40})/.exec(s);
    if (m) return { type: expectType || "playlist", id: m[1] };
    return null;
  }

  function playlistId(uriOrId) {
    if (!uriOrId) return "";
    var s = String(uriOrId);
    var m = /^spotify:playlist:([A-Za-z0-9]{22,40})$/.exec(s);
    if (m) return m[1];
    var r = parseRef(s, "playlist");
    return r ? r.id : "";
  }

  function userId(uriOrId) {
    if (!uriOrId) return "";
    var s = String(uriOrId);
    var m = /^spotify:user:([A-Za-z0-9]{22,40})$/.exec(s);
    if (m) return m[1];
    m = /^spotify:user:([^\s:/?&]+)$/.exec(s);
    if (m) return m[1];
    return s.replace(/^spotify:user:/, "");
  }

  function playlistUri(id) {
    return "spotify:playlist:" + playlistId(id);
  }

  function userUri(id) {
    return "spotify:user:" + userId(id);
  }

  /** Human date and 12-hour time, local, e.g. "10 Nov 2026, 2:05 PM". */
  function fmtDateTime(ts) {
    if (ts == null || !isFinite(ts)) return "â€”";
    var d = new Date(ts);
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear() + ", " + fmtTime(ts);
  }

  function fmtDate(ts) {
    if (ts == null || !isFinite(ts)) return "â€”";
    var d = new Date(ts);
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
  }

  /** 12-hour local time, e.g. "9:05 PM" / "12:30 AM" — no leading zero, padded
   *  minutes, uppercase suffix. */
  function fmtTime(ts) {
    var d = new Date(ts);
    var hours = d.getHours();
    var suffix = hours >= 12 ? "PM" : "AM";
    var hour12 = hours % 12;
    if (hour12 === 0) hour12 = 12;
    return hour12 + ":" + pad(d.getMinutes()) + " " + suffix;
  }

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  /** "3m ago", "2h ago", "5d ago". */
  function ago(ts, now) {
    // 0 is a value, not an absence: `ts == null` does not catch it, so `ago(0)`
    // computed Date.now() - 0 and rendered "20773d ago". A zero timestamp means
    // "never happened" (the scanners persist lastSyncedAt: 0 when a scan fails),
    // so it takes the same branch as a missing one.
    if (ts == null || ts === 0 || !isFinite(ts)) return "never";
    var diff = Math.max(0, (now == null ? Date.now() : now) - ts);
    var s = Math.floor(diff / 1000);
    if (s < 45) return "just now";
    var m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    var h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    var d = Math.floor(h / 24);
    return d + "d ago";
  }

  /** "12m 04s" style duration for sessions. */
  function fmtDuration(ms) {
    if (ms == null || ms < 0) return "â€”";
    var s = Math.round(ms / 1000);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    if (h) return h + "h " + pad(m) + "m";
    if (m) return m + "m " + pad(sec) + "s";
    return sec + "s";
  }

  /** Split an array into chunks. */
  function chunk(arr, size) {
    var out = [];
    for (var i = 0; i < (arr || []).length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  /** Deterministic pseudo-random in [0,1) from a string, for stable cover colours. */
  function seedRandom(seed) {
    var h = 2166136261;
    var s = String(seed == null ? "" : seed);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return function () {
      h = (Math.imul(h ^ (h >>> 15), 2246822507) + 2654435769) >>> 0;
      return h / 4294967296;
    };
  }

  /** Escape text for CSV (RFC 4180). */
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /** Build CSV from headers + row arrays. */
  function toCsv(headers, rows) {
    var lines = [headers.map(csvCell).join(",")];
    for (var i = 0; i < (rows || []).length; i++) lines.push(rows[i].map(csvCell).join(","));
    return lines.join("\r\n");
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(t);
      t = setTimeout(function () {
        fn.apply(self, args);
      }, ms);
    };
  }

  /** Today's date key matching diff.dayKey. */
  function todayKey(now) {
    var d = new Date(now == null ? Date.now() : now);
    var m = d.getMonth() + 1;
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (d.getDate() < 10 ? "0" + d.getDate() : d.getDate());
  }

  /**
   * The last N day keys, oldest first, ending today.
   *
   * Steps back a calendar day at a time rather than subtracting 86400000ms:
   * `new Date(ts - 86400000)` crosses a DST boundary at the wrong local hour, so
   * in a DST zone the series skipped a day at spring-forward and repeated one at
   * fall-back. `dayLabel` already refuses that arithmetic; this was the last place
   * using it.
   */
  function lastDays(n, now) {
    var d = new Date(now == null ? Date.now() : now);
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
      out.push(todayKey(day.getTime()));
    }
    return out;
  }

  function shortId(id, n) {
    var s = String(id || "");
    return s.length > (n || 8) ? s.slice(0, n || 8) : s;
  }

  // A transport failure ("Failed to fetch", "Load failed", ...) means the
  // request never reached the server, so whatever code a client attaches to
  // that body is not an HTTP status it returned. Matched as the renderer's own
  // exact signatures — never a bare "network error", which a real 5xx body
  // could legitimately contain.
  var TRANSPORT_FAIL_RE = /failed to fetch|load failed|networkerror when attempting to fetch|network error when|the network connection was lost|err_connection|err_internet_disconnected|err_name_not_resolved/i;
  function isTransportFailure(msg) {
    return typeof msg === "string" && TRANSPORT_FAIL_RE.test(msg);
  }

  /**
   * Split a spotify:mosaic: ref ("spotify:mosaic:<tile>:<tile>[:<tile>:<tile>]")
   * into the https URLs of its tiles. A Spotify mosaic cover IS its tiles laid
   * out as a 2x2 grid, so the exact artwork needs all of them â€” taking only the
   * first tile shows a quarter of a playlist cover. Returns null for anything
   * that is not a mosaic ref.
   */
  function mosaicTiles(ref) {
    var s = ref == null ? "" : String(ref).trim();
    if (s.indexOf("spotify:mosaic:") !== 0) return null;
    var tiles = s.slice("spotify:mosaic:".length).split(":").filter(function (t) {
      return /^[A-Za-z0-9]{8,}$/.test(t);
    });
    if (!tiles.length) return null;
    return tiles.map(function (t) {
      return "https://i.scdn.co/image/" + t;
    });
  }

  /**
   * Turn whatever image reference Spotify hands us into something a surface can
   * render. Plain https URLs pass through; spotify:image:<hash> becomes the
   * i.scdn.co URL; a spotify:mosaic: ref passes through unchanged because only
   * the kit knows how to composite it (a plain <img>/CSS layer can hold one
   * tile, never the 2x2).
   */
  function imageUrl(ref) {
    var s = ref == null ? "" : String(ref).trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    var m = /^spotify:image:([A-Za-z0-9]+)/.exec(s);
    if (m) return "https://i.scdn.co/image/" + m[1];
    if (/^spotify:mosaic:/.test(s)) return s;
    return "";
  }

  return {
    hash: hash,
    imageUrl: imageUrl,
    mosaicTiles: mosaicTiles,
    parseRef: parseRef,
    playlistId: playlistId,
    userId: userId,
    playlistUri: playlistUri,
    userUri: userUri,
    fmtDateTime: fmtDateTime,
    fmtDate: fmtDate,
    fmtTime: fmtTime,
    ago: ago,
    fmtDuration: fmtDuration,
    chunk: chunk,
    seedRandom: seedRandom,
    csvCell: csvCell,
    toCsv: toCsv,
    debounce: debounce,
    todayKey: todayKey,
    lastDays: lastDays,
    shortId: shortId,
    isTransportFailure: isTransportFailure,
  };
});
