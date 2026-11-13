/* eslint-disable */
/**
 * Spotispy — pure diff engine.
 *
 * All diffs are set/multiset diffs: a reorder produces no events. Every
 * snapshot records the source that produced it and whether the source caps the
 * list, so a diff never compares an uncapped baseline with a capped fetch
 * (proposal §4.2). A >50% shrink must be confirmed twice before removals are
 * emitted (truncation guard).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.diff = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SHRINK_GUARD = 0.5;

  /** Count occurrences of each key. */
  function multiset(keys) {
    var m = Object.create(null);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      m[k] = m[k] ? m[k] + 1 : 1;
    }
    return m;
  }

  /**
   * Multiset difference of two URI lists.
   * Duplicates are handled per copy: N copies of a track removed => N removal
   * keys, N added => N addition keys. A key is repeated by the size of the
   * count difference, so a playlist that loses one of two copies of a track
   * reports exactly one removal.
   * @returns {{added: string[], removed: string[], reorderOnly: boolean}}
   */
  function diffTracks(prev, next) {
    var p = prev || [];
    var n = next || [];
    var pm = multiset(p);
    var nm = multiset(n);
    var added = [];
    var removed = [];
    var k;
    for (k in nm) {
      if (!pm[k]) {
        for (var a = 0; a < nm[k]; a++) added.push(k);
      } else if (nm[k] > pm[k]) {
        for (var a2 = 0; a2 < nm[k] - pm[k]; a2++) added.push(k);
      }
    }
    for (k in pm) {
      if (!nm[k]) {
        for (var r = 0; r < pm[k]; r++) removed.push(k);
      } else if (pm[k] > nm[k]) {
        for (var r2 = 0; r2 < pm[k] - nm[k]; r2++) removed.push(k);
      }
    }
    return {
      added: added,
      removed: removed,
      reorderOnly: !added.length && !removed.length && p.join("\u0001") !== n.join("\u0001"),
    };
  }

  /** Set difference, used for playlist id sets and follower id sets. */
  function diffSets(prev, next) {
    var pm = multiset((prev || []).map(String));
    var nm = multiset((next || []).map(String));
    var added = [];
    var removed = [];
    var k;
    for (k in nm) if (!pm[k]) added.push(k);
    for (k in pm) if (!nm[k]) removed.push(k);
    return { added: added, removed: removed };
  }

  /**
   * Truncation guard: does `next` look like a partial/failed read rather than a
   * real shrink? Empty reads count as suspicious whenever a baseline existed.
   */
  function isSuspiciousShrink(prevCount, nextCount) {
    if (!prevCount) return false;
    if (nextCount === 0) return true;
    return nextCount < prevCount * SHRINK_GUARD;
  }

  /**
   * Decide what a track diff may emit, given the previous snapshot, the fresh
   * list, the sources involved and the recorded shrink confirmation.
   * Returns { action: 'diff'|'reseed', added, removed, capped, source, seeded }.
   */
  function planTrackDiff(prevSnapshot, next) {
    var nextUris = (next && next.uris) || [];
    var nextSource = (next && next.source) || "unknown";
    var capped = !!(next && next.capped);
    var base = {
      capped: capped,
      source: nextSource,
      count: nextUris.length,
    };
    if (!prevSnapshot || !prevSnapshot.uris) {
      return Object.assign({ action: "reseed", added: [], removed: [], seeded: true }, base);
    }
    if (prevSnapshot.source && prevSnapshot.source !== nextSource) {
      return Object.assign({ action: "reseed", added: [], removed: [], seeded: true, reason: "source-switch" }, base);
    }
    var d = diffTracks(prevSnapshot.uris, nextUris);
    if (isSuspiciousShrink(prevSnapshot.uris.length, nextUris.length)) {
      var confirmations = prevSnapshot.pendingShrink && prevSnapshot.pendingShrink.count === nextUris.length
        ? prevSnapshot.pendingShrink.confirmations + 1
        : 1;
      if (confirmations < 2) {
        return Object.assign({ action: "hold", added: d.added, removed: [], seeded: false, confirmations: confirmations }, base);
      }
      d.removedConfirmed = true;
    }
    if (capped) {
      // A capped read cannot prove absence: re-seed without removal events.
      return Object.assign({ action: "reseed", added: [], removed: [], seeded: true, reason: "capped" }, base);
    }
    return Object.assign({ action: "diff", added: d.added, removed: d.removed, seeded: false }, base);
  }

  /**
   * Scalar diff over an allow-listed set of fields.
   * @param {object} prev
   * @param {object} next
   * @param {string[]} fields
   * @param {object} [opts] { ignoreNull: fields where a null next value means "not reported" }
   * @returns {{field: string, from: any, to: any}[]}
   */
  function diffScalars(prev, next, fields, opts) {
    var ignore = (opts && opts.ignoreNull) || [];
    var out = [];
    prev = prev || {};
    next = next || {};
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (next[f] === undefined) continue;
      if (next[f] === null && ignore.indexOf(f) >= 0) continue;
      var a = norm(prev[f]);
      var b = norm(next[f]);
      if (a !== b) out.push({ field: f, from: prev[f] === undefined ? null : prev[f], to: next[f] });
    }
    return out;
  }

  /** Comparison normaliser: nullish -> "", String otherwise, so 3 === "3". */
  function norm(v) {
    if (v === undefined || v === null) return "";
    return String(v);
  }

  /** Day bucket key (local time) used for aggregates. */
  function dayKey(ts) {
    var d = new Date(ts == null ? Date.now() : ts);
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
  }

  /** Local hour bucket, 0-23. */
  function hourOf(ts) {
    return new Date(ts == null ? Date.now() : ts).getHours();
  }

  return {
    SHRINK_GUARD: SHRINK_GUARD,
    multiset: multiset,
    diffTracks: diffTracks,
    diffSets: diffSets,
    diffScalars: diffScalars,
    isSuspiciousShrink: isSuspiciousShrink,
    planTrackDiff: planTrackDiff,
    dayKey: dayKey,
    hourOf: hourOf,
    norm: norm,
  };
});
