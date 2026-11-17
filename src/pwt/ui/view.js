/* eslint-disable */
/**
 * Spotispy — view models.
 *
 * Pure functions: stored rows in, render-ready objects out. Keeping the shaping
 * here (rather than inside components) is what makes the UI testable against
 * synthetic fixtures and keeps every view a thin renderer.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.view = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function U() {
    return root.PWT.util;
  }

  function D() {
    return root.PWT.diff;
  }

  // Stored rows written before the parse fix can still carry the raw user code
  // as the name; it never renders. 22 chars matches Spotify's id length, so
  // short human names never trip it.
  var ID_SHAPED = /^[A-Za-z0-9]{22,}$/;

  function displayName(name, fallback) {
    var s = String(name || "").trim();
    return s && !ID_SHAPED.test(s) ? s : fallback;
  }

  /**
   * User-centric dashboard.
   *
   * The watched people become the index: pick a user, see their pictures,
   * their public playlists (covers fetched by the scan), and their updates —
   * every change that touched them or one of their playlists. `selectedId`
   * falls back to the first watched user when null or unknown. The
   * "everyone" aggregate (KPIs, chart, recent feed) rides along for the
   * "All" chip.
   *
   * data: { profiles, playlists, watches, recent, daily, lastScanAt,
   *         nextScanAt, lastScanTotals, scan }
   */
  function userDashboard(data, selectedId, now) {
    var profiles = data.profiles || [];
    var plRows = data.playlists || [];
    var watches = data.watches || [];
    var changes = data.recent || [];
    var plById = {};
    plRows.forEach(function (pl) {
      plById[pl.id] = pl;
    });
    var playlistWatch = {};
    var profileWatch = {};
    watches.forEach(function (w) {
      if (w.kind === "playlist") playlistWatch[w.id] = w;
      else if (w.kind === "profile") profileWatch[w.id] = w;
    });

    /** Changes that mention this user or one of this user's playlists. */
    function changesOf(p) {
      var ids = {};
      (p.plays || []).forEach(function (x) {
        ids[String(x.uri || "").split(":")[2]] = true;
      });
      return changes.filter(function (c) {
        return c.target === p.id || ids[c.target];
      });
    }

    // The dashboard is user-first: the people the user watches, never stale
    // rows from watches since removed. Without this filter a nameless leftover
    // row lands on the dashboard and the real watched user is one chip over.
    var watchedProfiles = profiles.filter(function (p) {
      return !!profileWatch[p.id];
    });

    var users = watchedProfiles.map(function (p) {
      var own = changesOf(p);
      var last = own[0];
      var watchedCount = 0;
      (p.plays || []).forEach(function (x) {
        var pid = String(x.uri || "").split(":")[2];
        if (pid && plById[pid]) watchedCount++;
      });
      return {
        id: p.id,
        // A person is shown by name. An id is never a label; until the first
        // scan resolves the name, say "Unknown listener".
        name: displayName(p.name, "Unknown listener"),
        avatarUrl: p.avatarUrl || "",
        followers: p.followers != null ? p.followers : null,
        activity: !!p.watchActivity,
        publicPlaylists: (p.plays || []).length,
        watchedPlaylists: watchedCount,
        changes: own.length,
        lastChangeAt: last ? last.ts : 0,
        lastChangeLabel: last ? last.detail : "",
        health: p.health || "new",
        lastSyncedAt: p.lastSyncedAt || 0,
        watchedAt: (profileWatch[p.id] && profileWatch[p.id].addedAt) || 0,
      };
    });

    var selected = null;
    // "all" means the aggregate view; null/unknown means the first watched user.
    var wanted = selectedId === "all" || selectedId === "everyone" ? null : selectedId || (users[0] && users[0].id) || null;
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === wanted) selected = users[i];
    }
    // A persisted selection naming a profile we no longer store falls back to the first watched user.
    if (!selected && users.length) selected = users[0];

    var detail = null;
    if (selected) {
      var profile = profiles.filter(function (p) {
        return p.id === selected.id;
      })[0];
      var playlists = (profile.plays || []).map(function (x) {
        var pid = String(x.uri || "").split(":")[2];
        var row = pid ? plById[pid] : null;
        var watch = pid ? playlistWatch[pid] : null;
        return {
          id: pid || "",
          uri: x.uri || (pid ? "spotify:playlist:" + pid : ""),
          name: x.name || (row && row.name) || "Untitled playlist",
          coverUrl: x.cover || (row && row.coverUrl) || "",
          trackCount: x.total != null ? x.total : row ? row.trackCount : null,
          followers: row && row.followers != null ? row.followers : null,
          watched: !!row,
          watchedAt: (watch && watch.addedAt) || (row && row.watchedAt) || 0,
          lastChangeAt: (row && row.lastChangeAt) || 0,
          lastSyncedAt: (row && row.lastSyncedAt) || 0,
          health: row ? row.health : null,
        };
      });
      detail = {
        id: selected.id,
        name: selected.name,
        avatarUrl: selected.avatarUrl,
        followers: selected.followers,
        activity: selected.activity,
        health: selected.health,
        watchedAt: selected.watchedAt,
        lastSyncedAt: selected.lastSyncedAt,
        playlists: playlists,
        updates: changesOf(profile).slice(0, 14),
      };
    }

    var aggregate = overview(data, now);
    return {
      users: users,
      selectedId: selected ? selected.id : null,
      detail: detail,
      series: aggregate.series,
      recent: aggregate.recent,
      profiles: aggregate.profiles,
      playlists: aggregate.playlists,
      added7: aggregate.added7,
      removed7: aggregate.removed7,
      edits7: aggregate.edits7,
      lastScanAt: aggregate.lastScanAt,
      nextScanAt: aggregate.nextScanAt,
      lastScanTotals: aggregate.lastScanTotals,
      lastResult: aggregate.lastResult,
      scan: aggregate.scan,
      empty: aggregate.empty,
    };
  }

  /** KPI strip for the Overview (§5.1). Counts the watch list, not stale rows. */
  function overview(data, now) {
    var u = U();
    var watches = data.watches || [];
    var watchedProfiles = 0;
    var watchedPlaylists = 0;
    for (var i = 0; i < watches.length; i++) {
      if (watches[i].kind === "profile") watchedProfiles++;
      else if (watches[i].kind === "playlist") watchedPlaylists++;
    }
    var days = u.lastDays(30, now);
    var series = days.map(function (day) {
      var d = data.daily[day] || {};
      return { day: day, added: d.added || 0, removed: d.removed || 0, edits: d.edits || 0 };
    });
    var week = series.slice(-7).reduce(
      function (acc, d) {
        acc.added += d.added;
        acc.removed += d.removed;
        acc.edits += d.edits;
        return acc;
      },
      { added: 0, removed: 0, edits: 0 }
    );
    return {
      profiles: watchedProfiles,
      playlists: watchedPlaylists,
      added7: week.added,
      removed7: week.removed,
      edits7: week.edits,
      lastScanAt: data.lastScanAt || 0,
      nextScanAt: data.nextScanAt || 0,
      lastScanTotals: data.lastScanTotals || null,
      lastResult: data.lastScanResult || null,
      scan: data.scan || {},
      series: series,
      recent: (data.recent || []).slice(0, 20),
      empty: !(data.profiles || []).length && !(data.playlists || []).length,
    };
  }

  /** Profile roster row (§5.2). */
  function profileRow(p, playlists, changes) {
    var owned = (playlists || []).filter(function (pl) {
      return p.ownerId && pl.ownerId === p.id;
    });
    var last = (changes || [])[0];
    return {
      id: p.id,
      name: displayName(p.name, "Unknown listener"),
      avatarUrl: p.avatarUrl,
      followers: p.followers,
      playlistCount: (p.playlists || []).length,
      watchedPlaylists: owned.length,
      watchedAt: p.watchedAt || 0,
      lastSyncedAt: p.lastSyncedAt || 0,
      lastChangeAt: last ? last.ts : 0,
      lastChangeLabel: last ? last.detail : "",
      activity: !!p.watchActivity,
      health: p.health || "new",
      probe: p.probe || {},
      probeError: p.probeError || "",
      changes: changes || [],
    };
  }

  /**
   * "Today" / "Yesterday" / full local date. The previous day is derived with
   * local-date arithmetic, not 86400000 ms, so DST transitions can't shift it.
   */
  function dayLabel(ts, now) {
    var u = U();
    if (ts == null || !isFinite(ts)) return "—";
    var base = now == null ? Date.now() : now;
    var yesterday = new Date(base);
    yesterday.setDate(yesterday.getDate() - 1);
    var key = D().dayKey(ts);
    if (key === D().dayKey(base)) return "Today";
    if (key === D().dayKey(yesterday.getTime())) return "Yesterday";
    return u.fmtDate(ts);
  }

  /** Per-profile timeline grouped by day (§5.2). */
  function timeline(rows) {
    var u = U();
    var groups = [];
    var byDay = {};
    (rows || []).forEach(function (r) {
      var day = D().dayKey(r.ts);
      if (!byDay[day]) {
        byDay[day] = { day: day, label: dayLabel(r.ts, Date.now()), rows: [] };
        groups.push(byDay[day]);
      }
      byDay[day].rows.push(r);
    });
    groups.sort(function (a, b) {
      return a.day < b.day ? 1 : -1;
    });
    return groups;
  }

  /** Playlist detail header + timeline (§5.3). names: userId/trackId -> label, for "added by". */
  function playlistDetail(row, snapshot, tracks, changes, names) {
    var u = U();
    var isIdShaped = function (s) {
      return /^[A-Za-z0-9]{18,}$/.test(String(s || ""));
    };
    var seen = {};
    var unique = [];
    (changes || []).forEach(function (c) {
      if (seen[c.kind + c.ts + (c.uri || "")]) return;
      seen[c.kind + c.ts + (c.uri || "")] = true;
      unique.push(c);
    });
    var enriched = unique.map(function (c) {
      var t = c.uri ? tracks[c.uri] : null;
      var detail = c.detail || "";
      if (isIdShaped(detail)) detail = ""; // a bare track/playlist id never renders
      var addedById = c.extra && c.extra.addedBy ? String(c.extra.addedBy) : "";
      // The client supplies a username ("macroplant"), which is already a name.
      // A stored user uri is resolved through the name map when it has one, and
      // stripped to the bare id otherwise - a raw uri is never rendered.
      var addedBy = addedById ? (names && names[addedById]) || addedById.replace(/^spotify:user:/, "") : "";
      // A bare id is not a name: the column says nothing rather than inventing
      // one (the row's identity is the track, not the id of whoever added it).
      if (addedBy && ID_SHAPED.test(addedBy)) addedBy = "";
      return Object.assign({}, c, {
        trackLabel: t ? t.title : "Unknown track",
        artist: t ? t.artist : "",
        album: t ? t.album : "",
        art: t ? u.imageUrl(t.art) : "",
        detail: detail,
        addedBy: addedBy,
        display: c.display || c.targetName || "",
      });
    });
    var addedByDay = {};
    enriched.forEach(function (c) {
      if (c.kind !== "playlist.item.added") return;
      var day = D().dayKey(c.ts);
      addedByDay[day] = (addedByDay[day] || 0) + 1;
    });
    return {
      id: row.id,
      name: row.name || "Untitled playlist",
      ownerId: row.ownerId,
      coverHash: row.coverHash,
      coverUrl: u.imageUrl(row.coverUrl || ""),
      followers: row.followers,
      // A like counter is not a follower count. Carried so the view can label it
      // "likes" rather than dropping a real number on the floor.
      likes: row.likes,
      watchedAt: row.watchedAt,
      lastSyncedAt: row.lastSyncedAt,
      lastChangeAt: row.lastChangeAt,
      trackCount: row.trackCount,
      health: row.health || "new",
      source: snapshot ? snapshot.source : "",
      capped: snapshot ? !!snapshot.capped : false,
      pendingShrink: row.pendingShrink || null,
      daysSinceUpdate: row.lastChangeAt ? Math.floor(((Date.now() - row.lastChangeAt) / 86400000)) : null,
      changes: enriched,
      addedByDay: addedByDay,
      lastSyncLabel: u.ago(row.lastSyncedAt),
    };
  }

  /** Live activity strip (§5.4). */
  function liveStrip(records, states, now, trackCache) {
    var u = U();
    return (records || []).map(function (r) {
      var userId = r.userUri.replace(/^spotify:user:/, "");
      var st = states[userId] || {};
      var since = st.session && st.session.startedAt ? st.session.startedAt : r.timestamp;
      var cached = trackCache && trackCache[r.trackUri] ? trackCache[r.trackUri] : null;
      return {
        userId: userId,
        // The feed carries the person's display name; an id is never shown.
        name: displayName(r.userName, "Unknown listener"),
        avatar: u.imageUrl(r.avatar),
        trackUri: r.trackUri,
        trackTitle: cached ? cached.title || "" : "",
        trackArtist: cached ? cached.artist || "" : "",
        contextUri: r.contextUri,
        contextLabel: labelForContext(r.contextUri),
        trackArt: cached ? u.imageUrl(cached.art) : "",
        isPlaying: r.isPlaying,
        forLabel: u.fmtDuration((now || Date.now()) - since),
        since: since,
        hidden: false,
      };
    });
  }

  /** Session cards (§5.4). names: userId -> string | {name, avatar} */
  function sessionCards(sessions, tracks, names) {
    var u = U();
    return (sessions || []).map(function (s) {
      var person = (names && names[s.userId]) || null;
      var userName = displayName(typeof person === "string" ? person : person && person.name ? person.name : "", "Unknown listener") || "Unknown listener";
      var avatar = person && person.avatar ? u.imageUrl(person.avatar) : "";
      var list = (s.tracks || []).map(function (uri) {
        var t = tracks[uri];
        return {
          uri: uri,
          // No title yet means the track row was not fetched; "Unknown track"
          // beats a 10-character id fragment in a listening history.
          title: t ? t.title : "Unknown track",
          artist: t ? t.artist : "",
          art: t ? u.imageUrl(t.art) : "",
        };
      });
      return {
        id: s.id,
        userId: s.userId,
        userName: userName,
        avatar: avatar,
        startedAt: s.startedAt,
        endedAt: s.endedAt || 0,
        durationLabel: u.fmtDuration(s.endedAt ? (s.durationMs != null ? s.durationMs : s.endedAt - s.startedAt) : 0),
        trackCount: s.trackCount,
        loops: s.looped,
        skips: s.skipped,
        unclean: !!s.unclean,
        tracks: list,
      };
    });
  }

  /** One presence bar per friend for one day, with merged online/hidden segments. */
  function presenceBars(ticksRows, day, now, names) {
    var S = root.PWT.session;
    var u = U();
    var out = [];
    var date = new Date(day + "T00:00:00");
    var dayStart = date.getTime();
    var dayEnd = Math.min(now == null ? Date.now() : now, dayStart + 86400000);
    (ticksRows || []).forEach(function (row) {
      if (row.day !== day) return;
      var windowList = S.presenceWindows(row.ticks || [], { INACTIVITY_MS: 5 * 60000 });
      var total = Math.max(1, dayEnd - dayStart);
      var onlineSeconds = 0;
      var segments = [];
      var TICK_MS = 60000; // one activity poll ≈ one interval segment; a point reads as a tick
      windowList.forEach(function (w) {
        var from = Math.max(w.from, dayStart);
        var to = Math.max(w.to, w.from + Math.min(TICK_MS, Math.max(1, dayEnd - w.from)));
        if (to <= from) {
          // Tick exactly at the right edge: render a sliver pinned to "now".
          from = Math.max(dayStart, Math.min(from, dayEnd - 1));
          to = dayEnd;
          if (to <= from) return;
        }
        if (to > dayEnd) { to = dayEnd; }
        if (from > dayEnd) return;
        if (!w.hidden) onlineSeconds += (to - from) / 1000;
        var segWidth = Math.max(((to - from) / total) * 100, 0.4);
        var segLeft = Math.min(((from - dayStart) / total) * 100, 99.6 - segWidth);
        segments.push({
          from: from,
          to: to,
          hidden: !!w.hidden,
          left: segLeft,
          width: segWidth,
          title: u.fmtTime(from) + " – " + u.fmtTime(to) + (w.hidden ? " · out of view" : " · online"),
        });
      });
      var minutes = Math.round(onlineSeconds / 60);
      var label = onlineSeconds >= 60 ? minutes + "m online" : Math.max(1, Math.round(onlineSeconds)) + "s online";
      var person = names && names[row.userId];
      out.push({
        userId: row.userId,
        name: displayName(typeof person === "string" ? person : person && person.name ? person.name : "", "Unknown listener") || "Unknown listener",
        avatar: person && person.avatar ? u.imageUrl(person.avatar) : "",
        segments: segments,
        label: label,
      });
    });
    out.sort(function (a, b) {
      return b.segments.length - a.segments.length;
    });
    return out;
  }

  /** Hour x day heatmap data from plays. */
  function heatmap(plays, now) {
    var u = U();
    var days = u.lastDays(14, now);
    var data = {};
    (plays || []).forEach(function (p) {
      var day = D().dayKey(p.ts);
      if (!data[day]) data[day] = new Array(24).fill(0);
      data[day][D().hourOf(p.ts)] += 1;
    });
    return {
      days: days.map(function (d) {
        return { day: d };
      }).reverse(),
      data: data,
    };
  }

  /** "Top contexts" table rows from plays. */
  function topContexts(plays, limit) {
    var counts = {};
    (plays || []).forEach(function (p) {
      var c = p.contextUri || "unknown";
      counts[c] = (counts[c] || 0) + 1;
    });
    return Object.keys(counts)
      .map(function (c) {
        return { label: labelForContext(c), value: counts[c], uri: c };
      })
      .sort(function (a, b) {
        return b.value - a.value;
      })
      .slice(0, limit || 8);
  }

  function labelForContext(c) {
    if (!c || c === "unknown") return "unknown context";
    if (c.indexOf("spotify:artist:") === 0) return "Artist page";
    if (c.indexOf("spotify:playlist:") === 0) return "Playlist";
    if (c.indexOf("spotify:album:") === 0) return "Album";
    if (c.indexOf("spotify:collection") === 0) return "Liked Songs";
    if (c.indexOf("spotify:station") === 0) return "Radio station";
    return c.replace("spotify:", "");
  }

  /** Change-log filter model (§5.5). */
  function filterChanges(rows, query, kind, level) {
    var q = (query || "").toLowerCase();
    return (rows || []).filter(function (r) {
      if (kind && r.kind !== kind) return false;
      if (level && r.level !== level) return false;
      if (!q) return true;
      return (
        (r.title || "").toLowerCase().indexOf(q) >= 0 ||
        (r.detail || "").toLowerCase().indexOf(q) >= 0 ||
        (r.kind || "").toLowerCase().indexOf(q) >= 0 ||
        (r.uri || "").toLowerCase().indexOf(q) >= 0 ||
        String(r.target || "").toLowerCase().indexOf(q) >= 0
      );
    });
  }

  /** Settings model (§5.6). */
  function settingsModel(settings, info) {
    var u = U();
    return {
      pollMs: settings.pollMs,
      pollLabel: minutesLabel(settings.pollMs),
      activityMs: settings.activityMs,
      activityLabel: minutesLabel(settings.activityMs),
      // The boost interval and retention window are user choices the Settings
      // view renders as controls; without them the view cannot show its own state.
      activityBoostMs: settings.activityBoostMs,
      toggles: [
        { key: "notifyToast", label: "In-app toast after a scan", value: !!settings.notifyToast },
        { key: "notifyOs", label: "OS notification when Spotify is minimised", value: !!settings.notifyOs },
        { key: "notifyAdditions", label: "Notify on track additions", value: !!settings.notifyAdditions },
        { key: "notifyRemovals", label: "Notify on removals", value: !!settings.notifyRemovals },
        { key: "notifyProfile", label: "Notify on profile edits", value: !!settings.notifyProfile },
        { key: "notifyPresence", label: "Notify when a friend goes online/offline", value: !!settings.notifyPresence },
        { key: "activityBoost", label: "Faster activity polls while a friend is playing", value: !!settings.activityBoost },
        { key: "followers", label: "Track followers (when the client allows it)", value: settings.followers !== false },
      ],
      retainDays: settings.retainDays,
      logCap: settings.logCap,
      os: info && info.os ? info.os : { supported: false, state: "unknown" },
      cacheBytes: info ? info.cacheBytes || 0 : 0,
      cacheLabel: u && info ? formatBytes(info.cacheBytes || 0) : "—",
      counts: info && info.counts ? info.counts : {},
    };
  }

  function minutesLabel(ms) {
    if (!ms) return "off";
    var m = Math.round(ms / 60000);
    return m + " min";
  }

  function formatBytes(n) {
    if (!n) return "0 B";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }

  return {
    overview: overview,
    userDashboard: userDashboard,
    profileRow: profileRow,
    timeline: timeline,
    dayLabel: dayLabel,
    playlistDetail: playlistDetail,
    liveStrip: liveStrip,
    sessionCards: sessionCards,
    presenceBars: presenceBars,
    heatmap: heatmap,
    topContexts: topContexts,
    labelForContext: labelForContext,
    filterChanges: filterChanges,
    settingsModel: settingsModel,
    minutesLabel: minutesLabel,
    formatBytes: formatBytes,
  };
});
