/* eslint-disable */
/**
 * Spotispy — listening activity stage (§3B).
 *
 * One request per tick covers every friend. The payload is hashed: unchanged
 * means no parse, no write, no re-render. Sessions, presence windows and play
 * events come from the pure session builder. The legacy buddylist is a
 * fallback; when neither answers, the module reports `unavailable` rather than
 * showing an empty feed.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.activity = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function P() {
    return root.PWT;
  }

  var lastHash = "";

  /** Fetch the feed through the chain: listening-activity -> buddylist. */
  async function fetchFeed(deps) {
    var pwt = P();
    var net = deps.net || pwt.net;
    var errors = [];
    try {
      var res = await net.call(pwt.sources.ENDPOINTS.activityFeed());
      if (res === null || res === undefined) {
        errors.push("listening-activity: no response");
        throw new Error("no response");
      }
      var norm = pwt.sources.normalizeActivity(res);
      if (norm) return { records: norm, source: "listening-activity" };
      errors.push("listening-activity: unexpected payload");
    } catch (e) {
      if (!errors.length) errors.push("listening-activity: " + e.message);
    }
    try {
      var legacy = await net.call(pwt.sources.ENDPOINTS.buddylist());
      if (legacy !== null && legacy !== undefined) {
        var norm2 = pwt.sources.normalizeBuddylist(legacy);
        if (norm2) return { records: norm2, source: "buddylist" };
      }
      errors.push("buddylist: unexpected payload");
    } catch (e2) {
      errors.push("buddylist: " + e2.message);
    }
    return { records: null, source: null, errors: errors };
  }

  /**
   * One activity tick.
   * @param {object} deps { db, store, net, config, watchActivity: fn(userId)->bool, progress }
   * @returns {{ unchanged?: boolean, source?: string, plays?: number, sessions?: number,
   *             online?: number, hidden?: number, state: string }}
   */
  async function tick(deps, opts) {
    var pwt = P();
    var db = deps.db || pwt.db;
    var store = deps.store || pwt.store;
    var net = deps.net || pwt.net;
    var session = pwt.session;
    opts = opts || {};
    var now = Date.now();

    var feed = await fetchFeed(deps);
    // The per-profile flags can change between ticks (the Watch activity
    // toggle), so the cache is rebuilt every tick.
    deps._watchCache = {};
    if (!feed.records) {
      await store.setMeta("activityHealth", { state: "unavailable", at: now, errors: feed.errors });
      return { state: "unavailable", errors: feed.errors };
    }

    var hash = pwt.util.hash(JSON.stringify(feed.records));
    if (hash === lastHash && !opts.force) {
      await store.setMeta("activityHealth", { state: "ok", source: feed.source, at: now });
      return { state: "ok", unchanged: true, source: feed.source, records: feed.records };
    }
    lastHash = hash;

    var seen = {};
    var plays = [];
    var sessions = [];
    var online = 0;
    var hidden = 0;
    var transitions = [];
    var states = {};
    var durations = await durationsFor(deps, feed.records);

    for (var i = 0; i < feed.records.length; i++) {
      var rec = feed.records[i];
      var userId = rec.userUri.replace(/^spotify:user:/, "");
      // The per-profile Watch activity toggle decides for online friends too:
      // without this an unwatched person is recorded the moment they play.
      // `seen` is only set for a watched friend, so an unwatched one is never
      // mistaken for "missing this tick" and never accrues a phantom
      // `missed`/`hidden` in the absence pass below.
      if (!(await watchedFor(deps, userId))) continue;
      seen[userId] = true;
      var saved = await db.get("activityState", userId);
      var st = session.restore(saved);
      var out = session.apply(st, {
        userId: userId,
        trackUri: rec.trackUri,
        contextUri: rec.contextUri,
        ts: rec.timestamp,
        isPlaying: rec.isPlaying,
        durationMs: durations[rec.trackUri] || 0,
      });
      if (out.online) {
        online++;
        if (!out.online.first) transitions.push({ userId: userId, kind: "activity.online", ts: out.online.ts, name: rec.userName });
      }
      plays = plays.concat(out.plays);
      if (out.end) sessions.push(out.end);
      states[userId] = st;
      // Keep any avatar resolved by an earlier tick: the feed rarely carries
      // one, and overwriting the cache with "" destroys it. The art sweep below
      // still fills a genuinely missing avatar.
      if (rec.avatar || !(await hasAvatar(store, userId))) {
        await store.setMeta("activityName:" + userId, { name: rec.userName || "", avatar: rec.avatar || "", uri: rec.userUri });
      }
    }

    // Fill missing friend avatars from Spotify (cached). Never breaks a tick.
    try {
      for (var ai = 0; ai < feed.records.length; ai++) {
        var recA = feed.records[ai];
        if (!recA || recA.avatar) continue;
        var fid = String(recA.userUri || "").replace(/^spotify:user:/, "");
        if (!fid) continue;
        try {
          var cached = null;
          try {
            cached = await store.getMeta("activityName:" + fid, null);
          } catch (e0) {
            cached = null;
          }
          var resolved =
            cached && cached.avatar
              ? cached.avatar
              : !root.PWT_ART_DISABLED && P().art && P().art.artFor
                ? await P().art.artFor("spotify:user:" + fid, { store: store, db: db, net: net })
                : "";
          if (resolved) {
            recA.avatar = resolved;
            await store.setMeta("activityName:" + fid, { name: recA.userName || "", avatar: resolved, uri: recA.userUri });
          }
        } catch (eArt) {
          /* avatar is decorative; a miss must not break the tick */
        }
      }
    } catch (eWrap) {
      /* best effort */
    }

    // Absences: a friend missing this tick accrues a miss; DISAPPEARED_COUNT
    // consecutive misses make the window hidden (private session), not a hole.
    var all = (await db.getAll("activityState")) || [];
    var known = {};
    for (var a = 0; a < all.length; a++) known[all[a].userId] = all[a];
    for (var uid in known) {
      // `seen` says "present in this feed"; it cannot tell an unwatched friend
      // from a genuinely absent one, so the Watch-activity flag still decides.
      // Without this an unwatched friend accrues a phantom miss every tick.
      if (seen[uid]) continue;
      if (!(await watchedFor(deps, uid))) continue;
      var stx = session.restore(known[uid]);
      var wasHidden = stx.missed >= session.DEFAULT_TUNING.DISAPPEARED_COUNT;
      session.missed(stx, { userId: uid, ts: now });
      var nowHidden = stx.missed >= session.DEFAULT_TUNING.DISAPPEARED_COUNT;
      if (nowHidden && !wasHidden) {
        hidden++;
        transitions.push({ userId: uid, kind: "activity.hidden", ts: now });
      }
      states[uid] = stx;
    }

    var tickRows = [];
    for (var u in states) {
      // `states` only holds watched friends, so no per-row gate is needed.
      var st2 = states[u];
      tickRows.push({
        key: u + ":" + (seen[u] ? "1" : "0"),
        userId: u,
        ts: now,
        hidden: !seen[u] && st2.missed >= session.DEFAULT_TUNING.DISAPPEARED_COUNT,
        trackUri: st2.lastTrackUri || "",
        contextUri: st2.lastContextUri || "",
      });
      await db.put("activityState", Object.assign({ userId: u }, session.snapshot(st2)));
    }

    if (plays.length) await store.addPlays(plays);
    if (sessions.length) await store.putSessions(sessions);
    if (tickRows.length) {
      var existing = (await db.getAll("dayTicks")) || [];
      var byKey = {};
      for (var e = 0; e < existing.length; e++) byKey[existing[e].day + ":" + existing[e].userId] = existing[e];
      var ops = [];
      for (var t = 0; t < tickRows.length; t++) {
        var row = tickRows[t];
        var day = pwt.diff.dayKey(now);
        var k = day + ":" + row.userId;
        var agg = byKey[k];
        if (!agg) {
          agg = { key: k, day: day, userId: row.userId, ticks: [] };
          byKey[k] = agg;
        }
        agg.ticks.push({ ts: now, hidden: row.hidden });
        if (agg.ticks.length > 2000) agg.ticks = agg.ticks.slice(-2000);
        ops.push(["dayTicks", "put", agg]);
      }
      if (ops.length) await db.batch(ops);
    }

    await store.setMeta("activityHealth", { state: "ok", source: feed.source, at: now });
    await store.setMeta("activityLastTick", now);
    return {
      state: "ok",
      source: feed.source,
      plays: plays.length,
      sessions: sessions.length,
      online: online,
      hidden: hidden,
      transitions: transitions,
      records: feed.records,
    };
  }

  /**
   * Whether a cached avatar already exists for this friend. The feed record
   * usually carries no avatar, so writing one over a resolved value would
   * destroy it every tick.
   */
  async function hasAvatar(store, userId) {
    try {
      var cached = await store.getMeta("activityName:" + userId, null);
      return !!(cached && cached.avatar);
    } catch (e) {
      return false;
    }
  }

  /**
   * Whether this person's listening activity is watched. The per-profile flag
   * decides; a person we have never stored counts as watched, so a first
   * sighting is never dropped. Read once per tick and cached.
   */
  async function watchedFor(deps, userId) {
    var cache = deps._watchCache || (deps._watchCache = {});
    if (cache[userId] != null) return cache[userId];
    var watched = true;
    try {
      var db = deps.db || P().db;
      var row = await db.get("profiles", userId);
      if (row && row.watchActivity === false) watched = false;
    } catch (e) {
      /* an unreadable profile counts as watched */
    }
    cache[userId] = watched;
    return watched;
  }

  /** Track durations for the skip heuristic, from the shared tracks cache. */
  async function durationsFor(deps, records) {
    var pwt = P();
    var db = deps.db || pwt.db;
    var out = {};
    var seen = {};
    for (var i = 0; i < records.length; i++) {
      var uri = records[i].trackUri;
      if (seen[uri]) continue;
      seen[uri] = true;
      var row = await db.get("tracks", uri);
      if (row && row.durationMs) out[uri] = row.durationMs;
      else {
        try {
          // Same lookup the scanner uses: the client's GraphQL first (real
          // cover + duration, not rate limited), Web API as the fallback.
          var fresh = await (pwt.playlists && pwt.playlists.fetchTrackRow
            ? pwt.playlists.fetchTrackRow(deps, uri)
            : null);
          if (fresh) {
            if (fresh.durationMs) out[uri] = fresh.durationMs;
            await db.put("tracks", fresh);
          }
        } catch (e) {
          /* duration stays unknown; the skip heuristic simply does not fire */
        }
      }
    }
    return out;
  }

  function reset() {
    lastHash = "";
  }

  return { fetchFeed: fetchFeed, tick: tick, reset: reset };
});
