/* eslint-disable */
/**
 * Spotispy — pure session / presence builder for the listening
 * activity module (proposal §3B.3). No I/O, no clock of its own: the caller
 * passes samples with explicit timestamps, so every rule is unit-testable.
 *
 * One sample per tick per friend:
 *   { userId, trackUri, contextUri, ts, isPlaying, durationMs }
 *
 * Rules
 *  - a play event opens when the track changes, or when playing resumes after a
 *    pause on the same track;
 *  - the same track sampled again within REANNOUNCE_MS is the feed re-announcing
 *    one play, not a second play;
 *  - a session closes after INACTIVITY_MS without a play event;
 *  - a friend missing from the feed DISAPPEARED_COUNT ticks in a row is hidden
 *    (private session => "out of view", not a data hole);
 *  - the previous play of a friend counts as skipped when it ended before
 *    SKIP_RATIO of its known duration;
 *  - LOOP_AT consecutive plays of the same track set looped = true.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.session = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DEFAULT_TUNING = {
    INACTIVITY_MS: 180000, // 3 min without a play closes the session
    REANNOUNCE_MS: 5000, // a same-track timestamp this close is the same play
    SKIP_RATIO: 0.5,
    LOOP_AT: 3,
    DISAPPEARED_COUNT: 2,
  };

  function state() {
    return {
      lastSeenAt: 0,
      lastTrackUri: "",
      lastContextUri: "",
      lastTs: 0,
      playing: true,
      missed: 0,
      streak: { trackUri: "", count: 0 },
      session: null,
      previousPlay: null,
      // Last completed session, kept so the UI can show a closing card.
      lastSession: null,
    };
  }

  /** Rebuild a state object from persisted activityState. */
  function restore(saved) {
    var s = state();
    if (!saved) return s;
    for (var k in s) {
      if (!Object.prototype.hasOwnProperty.call(saved, k) || saved[k] == null) continue;
      // The open-session marker is only trusted when the session itself is
      // present; a stale marker must never resurrect a finished session.
      if (k === "session") {
        if (!saved.session || typeof saved.session.startedAt !== "number") continue;
      }
      s[k] = saved[k];
    }
    return s;
  }

  /** Serialisable slice persisted between launches. */
  function snapshot(s) {
    if (!s) return null;
    return {
      lastSeenAt: s.lastSeenAt,
      lastTrackUri: s.lastTrackUri,
      lastContextUri: s.lastContextUri,
      lastTs: s.lastTs,
      playing: s.playing,
      missed: s.missed,
      streak: s.streak,
      session: s.session,
      previousPlay: s.previousPlay,
      lastSession: s.lastSession,
    };
  }

  function finalizeSession(session, ts, unclean) {
    if (!session) return null;
    var out = {
      id: session.id,
      userId: session.userId,
      startedAt: session.startedAt,
      endedAt: Math.max(ts, session.startedAt),
      trackCount: session.trackCount,
      looped: session.looped,
      skipped: session.skipped,
      tracks: session.tracks.slice(),
      unclean: !!unclean,
    };
    out.durationMs = out.endedAt - out.startedAt;
    return out;
  }

  /**
   * Feed one sample for one friend.
   * @returns {{ plays: object[], start: object|null, end: object|null,
   *             online: object|null, hidden: object|null, session: object|null }}
   */
  function apply(s, p, tuning) {
    var t = tuning || DEFAULT_TUNING;
    var out = { plays: [], start: null, end: null, online: null, hidden: null, session: null };
    if (!s || !p) return out;
    var ts = p.ts;
    if (ts == null) return out;

    // 1. session timeout, evaluated against the sample time so a gap measured in
    //    ticks, not wall clock, still closes the session.
    if (s.session && ts - s.session.lastPlayAt > t.INACTIVITY_MS) {
      var closed = finalizeSession(s.session, s.session.lastPlayAt, false);
      s.lastSession = closed;
      s.session = null;
      out.end = closed;
    }

    // 2. presence
    if (!s.lastSeenAt) {
      out.online = { userId: p.userId, ts: ts, first: true };
    } else if (s.missed >= t.DISAPPEARED_COUNT) {
      out.online = { userId: p.userId, ts: ts, first: false };
      s.missed = 0;
    } else {
      s.missed = 0;
    }
    s.lastSeenAt = ts;

    // 3. is this a new play?
    var track = p.trackUri || "";
    var sameTrack = !!track && track === s.lastTrackUri;
    var reannounce = sameTrack && ts - s.lastTs <= t.REANNOUNCE_MS;
    var resumed = sameTrack && p.isPlaying && !s.playing;
    // A new play is: a different track; or the same track re-announced after the
    // jitter window (the feed has moved on, so this is a fresh position); or
    // playing resuming after a pause.
    var newPlay = !!track && (sameTrack ? !reannounce || resumed : true);

    if (newPlay) {
      var play = {
        userId: p.userId,
        trackUri: track,
        ts: ts,
        observedAt: p.observedAt != null ? p.observedAt : ts,
        isPlaying: !!p.isPlaying,
        contextUri: p.contextUri || "",
        skipped: false,
        loopIndex: 1,
      };
      // skip heuristic on the previous play of this friend
      if (s.previousPlay && s.previousPlay.durationMs > 0) {
        var playedFor = ts - s.previousPlay.ts;
        play.priorSkipped = playedFor < s.previousPlay.durationMs * t.SKIP_RATIO;
        if (play.priorSkipped) {
          out.priorSkipped = { userId: p.userId, trackUri: s.previousPlay.trackUri, ts: s.previousPlay.ts };
        }
      }
      // loop heuristic — consecutive plays of the SAME track count as one run;
      // a resume after a pause keeps the run, a different track restarts it.
      if (s.streak.trackUri === track && !resumed) s.streak = { trackUri: track, count: s.streak.count + 1 };
      else s.streak = { trackUri: track, count: 1 };
      play.loopIndex = s.streak.count;

      if (!s.session) {
        s.session = {
          id: p.userId + ":" + ts,
          userId: p.userId,
          startedAt: ts,
          lastPlayAt: ts,
          trackCount: 0,
          looped: false,
          skipped: false,
          tracks: [],
        };
        out.start = s.session;
      }
      s.session.lastPlayAt = ts;
      s.session.trackCount += 1;
      s.session.tracks.push(track);
      if (s.streak.count >= t.LOOP_AT) {
        s.session.looped = true;
        play.looped = true;
      }
      out.plays.push(play);
      s.previousPlay = {
        trackUri: track,
        ts: ts,
        durationMs: p.durationMs || 0,
      };
      s.lastTs = ts;
    } else if (track) {
      s.lastTs = ts;
    }
    if (reannounce) {
      // The feed re-announces the current track every few seconds. That is one
      // play, but a run of re-announcements means the track is looping.
      var before = s.streak.trackUri === track ? s.streak.count : 0;
      s.streak = { trackUri: track, count: before + 1 };
      if (s.streak.count >= t.LOOP_AT && s.session) {
        s.session.looped = true;
        if (before && before < t.LOOP_AT) out.looped = true; // report once per run
      }
    }
    if (track) s.lastTrackUri = track;
    if (p.contextUri) s.lastContextUri = p.contextUri;
    s.playing = !!p.isPlaying;
    if (out.priorSkipped && s.session) s.session.skipped = true;

    out.session = s.session;
    return out;
  }

  /** True when this friend's absence this tick completes a hidden window. */
  function missed(s, p, tuning) {
    var t = tuning || DEFAULT_TUNING;
    if (!s) return null;
    s.missed = (s.missed || 0) + 1;
    if (s.missed === t.DISAPPEARED_COUNT) return { userId: p.userId, ts: p.ts };
    return null;
  }

  /**
   * Close every open session at shutdown. The session ends at its last observed
   * play, never stretched to "now", and is flagged unclean (proposal §6.4).
   */
  function closeAll(states, ts) {
    var out = [];
    for (var userId in states) {
      var s = states[userId];
      if (s && s.session) {
        out.push(finalizeSession(s.session, s.session.lastPlayAt, true));
        s.session = null;
      }
    }
    return out;
  }

  /** Presence bar segments for one day: [{from,to,hidden}] built from ticks. */
  function presenceWindows(ticks, tuning) {
    var t = tuning || DEFAULT_TUNING;
    var windows = [];
    var current = null;
    var sorted = (ticks || []).slice().sort(function (a, b) {
      return a.ts - b.ts;
    });
    for (var i = 0; i < sorted.length; i++) {
      var tick = sorted[i];
      var gap = current ? tick.ts - current.to : 0;
      if (!current || current.hidden !== !!tick.hidden || gap > t.INACTIVITY_MS) {
        current = { from: tick.ts, to: tick.ts, hidden: !!tick.hidden };
        windows.push(current);
      } else {
        current.to = tick.ts;
      }
    }
    return windows;
  }

  /** Loop count for the trailing run of one track in an ordered play list. */
  function loopStreak(plays, trackUri) {
    var n = 0;
    for (var i = (plays || []).length - 1; i >= 0; i--) {
      if (plays[i].trackUri === trackUri) n++;
      else break;
    }
    return n;
  }

  return {
    DEFAULT_TUNING: DEFAULT_TUNING,
    state: state,
    restore: restore,
    snapshot: snapshot,
    apply: apply,
    missed: missed,
    closeAll: closeAll,
    finalizeSession: finalizeSession,
    presenceWindows: presenceWindows,
    loopStreak: loopStreak,
  };
});
