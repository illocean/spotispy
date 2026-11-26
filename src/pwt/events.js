/* eslint-disable */
/**
 * Spotispy — event catalogue and pure change-row builder.
 * Every change row carries the same shape, whichever module produced it:
 *
 *   { ts, observedAt, sourceDate?, level, target, kind, title, detail, extra? }
 *
 * `ts` is the sort key. `sourceDate` is only set when Spotify itself supplied a
 * date; otherwise the row is observation-only and the UI shows the `obs` chip.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.events = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // level -> kinds. Activity kinds never reach the `changes` log; they are views
  // over plays/sessions/presence (proposal §8), but they share the row shape.
  var KINDS = {
    profile: [
      "profile.name.changed",
      "profile.avatar.changed",
      "profile.playlist.added",
      "profile.playlist.removed",
      "profile.playlist.renamed",
      "profile.playlist.visibility.changed",
      "profile.followers.count",
      "profile.follower.appear",
      "profile.follower.disappear",
    ],
    playlist: ["playlist.item.added", "playlist.item.removed", "playlist.item.count", "playlist.meta.changed"],
    activity: [
      "activity.play",
      "activity.session.start",
      "activity.session.end",
      "activity.online",
      "activity.offline",
      "activity.hidden",
    ],
  };

  function levelOf(kind) {
    for (var l in KINDS) {
      if (!Object.prototype.hasOwnProperty.call(KINDS, l)) continue;
      if (KINDS[l].indexOf(kind) >= 0) return l;
    }
    return null;
  }

  /**
   * Level used for the per-day aggregate bucket of a kind. The level decides the
   * bucket, not the kind's name prefix: a playlist edit (playlist.meta.changed)
   * is a playlist-level change even though its kind does not start with
   * "playlist.item.", and filing it under the person mis-attributes it.
   */
  function aggregateLevel(kind) {
    var level = levelOf(kind);
    return level || "profile";
  }

  /** Aggregate counter a kind increments: added | removed | edits. */
  function aggregateField(kind) {
    if (kind === "playlist.item.added") return "added";
    if (kind === "playlist.item.removed") return "removed";
    return "edits";
  }

  /**
   * Build a normalised change row.
   * @param {object} e { level, target, kind, title, detail?, uri?, extra?, sourceDate?, observedAt? }
   */
  function makeEvent(e, now) {
    var observedAt = e.observedAt != null ? e.observedAt : now != null ? now : Date.now();
    var row = {
      ts: e.sourceDate != null ? e.sourceDate : observedAt,
      observedAt: observedAt,
      level: e.level || levelOf(e.kind) || "profile",
      target: String(e.target == null ? "" : e.target),
      kind: e.kind,
      title: String(e.title == null ? "" : e.title),
      detail: String(e.detail == null ? "" : e.detail),
    };
    if (e.uri) row.uri = String(e.uri);
    if (e.extra && typeof e.extra === "object") row.extra = e.extra;
    if (e.sourceDate != null) row.sourceDate = e.sourceDate;
    return row;
  }

  /**
   * Stable key for a logged row, so a re-scan cannot duplicate it. The day is
   * the granularity: two observations of the same fact on the same day are one
   * change, while a genuine second edit on a later day is its own row.
   */
  function rowKey(r) {
    // Local day, matching diff.dayKey — the aggregate bucket and every label
    // the UI renders use local days. toISOString() buckets by UTC, so for part
    // of the day in any timezone east or west of UTC the row key's day and the
    // aggregate's day disagree: the same fact gets two rows (one per local day
    // it was seen on) and its aggregate lands in the other day's bucket.
    // Inlined rather than calling diff.dayKey: this module is pure by design
    // and must not reach back into PWT.
    var when = new Date(r.sourceDate != null ? r.sourceDate : r.ts);
    var mo = when.getMonth() + 1;
    var da = when.getDate();
    var day = when.getFullYear() + "-" + (mo < 10 ? "0" + mo : mo) + "-" + (da < 10 ? "0" + da : da);
    return [r.level, r.target, r.kind, r.uri || "", day, r.detail || ""].join("\u0001");
  }

  return {
    KINDS: KINDS,
    levelOf: levelOf,
    aggregateLevel: aggregateLevel,
    aggregateField: aggregateField,
    makeEvent: makeEvent,
    rowKey: rowKey,
  };
});
