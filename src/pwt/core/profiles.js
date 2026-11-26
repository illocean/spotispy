/* eslint-disable */
/**
 * Spotispy — profile scan stage (§3A).
 *
 * Reads the profile view, diffs display name / avatar / follower count, diffs
 * the profile's playlist id set (rename vs departure resolved by id), and
 * records per-playlist metadata changes even for playlists never watched
 * directly — a profile rename is visible without following the playlist.
 * Follower *lists* sit behind a capability probe and report
 * ok / degraded / unavailable instead of a silent zero.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.profiles = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function P() {
    return root.PWT;
  }

  function hash(s) {
    var p2 = P();
    return p2.util ? p2.util.hash(String(s || "")) : String(s || "");
  }

  /**
   * A bare base62 token of 22+ chars is an id (Spotify ids run 22/26/28/31
   * characters), never a display name. Current builds hand `username`
   * exactly that.
   */
  var ID_SHAPED = /^[A-Za-z0-9]{22,}$/;

  function idShaped(s) {
    return ID_SHAPED.test(String(s || "").trim());
  }

  /**
   * Resolve a display name, never a user code. Spotify has used several key
   * shapes across builds; a candidate equal to the user id or shaped like an id
   * is rejected, and an unresolvable name is reported as "" so callers show
   * "Unknown listener" rather than a 28-character hash.
   */
  function displayNameOf(p) {
    if (!p || typeof p !== "object") return "";
    var candidates = [
      p.display_name,
      p.displayName,
      p.name,
      p.fullName,
      p.full_name,
      p.unescapedName,
      p.unescaped_name,
      p.first_name,
    ];
    var username = p.username;
    // `username` is a genuine handle only when it is not a raw id.
    if (username && !idShaped(username)) candidates.push(username);
    for (var i = 0; i < candidates.length; i++) {
      var v = candidates[i];
      if (v == null) continue;
      var s = String(v).trim();
      if (!s) continue;
      // Never a user code: an id-shaped value under a name field is the
      // account's raw id, not something a human should have to read.
      if (idShaped(s)) continue;
      return s;
    }
    return "";
  }

  /** Parse a user-profile-view payload into the fields the watcher keeps. */
  function parseProfile(res) {
    if (!res || typeof res !== "object") return null;
    var p = res;
    if (res.profile && typeof res.profile === "object") p = res.profile;
    // The user id: uri first, then id/username. Any of them may legitimately
    // be a short synthetic id in tests or older payloads, so no shape filter
    // here — displayNameOf() is what keeps id-shaped values out of the name.
    var id = p.uri ? String(p.uri).replace(/^spotify:user:/, "") : p.id || p.username || "";
    // The user-profile-view endpoint returns `image_url` (a plain string) on
    // current desktop builds; older payloads used image/images/avatar. Read all
    // of them — dropping image_url is why every profile showed a gradient tile.
    var image =
      p.image_url ||
      p.imageUrl ||
      (typeof p.image === "string" ? p.image : "") ||
      (p.image && (p.image.url || p.image.uri)) ||
      (p.images && (p.images[0] && (p.images[0].url || p.images[0]))) ||
      p.avatar ||
      "";
    var plays = [];
    var list = [];
    var candidates = ["public_playlists", "playlists", "publicPlaylists", "playlist_uri", "playlist_uris"];
    for (var c = 0; c < candidates.length; c++) {
      var v = p[candidates[c]];
      if (Array.isArray(v)) {
        list = list.concat(v);
        break;
      }
    }
    if (Array.isArray(p.playlistsV2)) list = list.concat(p.playlistsV2);
    if (!list.length && Array.isArray(p.public_playlists)) list = p.public_playlists;
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (typeof item === "string") {
        if (item.indexOf("spotify:playlist:") === 0) plays.push({ uri: item, name: "" });
        continue;
      }
      var uri = item.uri || (item.id ? "spotify:playlist:" + item.id : "");
      if (!uri) continue;
      var nm = item.name || item.title || "";
      var subtitle = "";
      if (typeof item.subtitle === "string") subtitle = item.subtitle;
      else if (Array.isArray(item.subtitle)) subtitle = item.subtitle.join(" ");
      var covers = "";
      try {
        var pwtU = P();
        var toU = function (ref) {
          var raw = typeof ref === "string" ? ref : (ref && (ref.url || ref.uri)) || "";
          if (!raw) return "";
          return pwtU.util && pwtU.util.imageUrl ? pwtU.util.imageUrl(raw) : raw;
        };
        // `image_url` first: profile-view playlists carry spotify:mosaic: refs.
        // The plain `images` array is scored the same way every other route
        // scores it, rather than taking a fixed end.
        covers =
          toU(item.image_url) ||
          toU(item.imageUrl) ||
          toU(pwtU.sources && pwtU.sources.bestCover ? pwtU.sources.bestCover(item.images) : "") ||
          toU(item.cover) ||
          "";
      } catch (e) {
        covers = "";
      }
      plays.push({
        uri: uri,
        name: nm,
        subtitle: subtitle,
        cover: covers || "",
        total: item.total != null ? item.total : item.trackCount != null ? item.trackCount : null,
      });
    }
    var toUrl = function (ref) {
      var pwt = P();
      var raw = typeof ref === "string" ? ref : (ref && (ref.url || ref.uri)) || "";
      if (!raw) return "";
      return pwt.util && pwt.util.imageUrl ? pwt.util.imageUrl(raw) : raw;
    };
    return {
      id: id,
      name: displayNameOf(p),
      avatarUrl: toUrl(image),
      avatarHash: hash(toUrl(image) || image),
      followers: p.followers_count != null ? p.followers_count : p.followers != null ? p.followers : null,
      plays: plays,
      playlists: plays.map(function (x) {
        return x.uri;
      }),
      raw: res,
    };
  }

  /**
   * Profile-view playlist counts only tell us a playlist changed if we track
   * per-id metadata; the profile pass records the id set + name/cover per id.
   */
  function diffProfile(prev, next, now) {
    var pwt = P();
    var ev = pwt.events;
    var diff = pwt.diff;
    var events = [];
    var id = next.id || (prev && prev.id);
    // Heal a nameless payload to the stored name BEFORE diffing. `displayNameOf`
    // returns "" when no candidate resolves, and `diffScalars` ignores null but
    // not "", so an unhealed "" logged "name: Bob → " — a rename to nothing that
    // never happened (the caller's row merge keeps the old name). Because
    // `rowKey` includes the day, it re-fired once per scan, forever. Doing it
    // here rather than in the caller keeps every caller safe.
    if (prev && prev.name && !next.name) next = Object.assign({}, next, { name: prev.name });
    var fields = diff.diffScalars(prev || {}, next, ["name", "avatarHash", "followers"], { ignoreNull: ["followers", "name"] });
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var kind =
        f.field === "name" ? "profile.name.changed" : f.field === "avatarHash" ? "profile.avatar.changed" : "profile.followers.count";
      events.push(
        ev.makeEvent(
          {
            level: "profile",
            target: id,
            kind: kind,
            title: next.name || "",
            // An image change (avatar) stores its before/after URLs for previews.
            detail: f.field === "avatarHash" ? "avatar changed" : f.field + ": " + (f.from == null ? "—" : f.from) + " → " + (f.to == null ? "—" : f.to),
            extra: {
              field: f.field,
              from: f.from,
              to: f.to,
              fromUrl: f.field === "avatarHash" ? (prev && prev.avatarUrl) || "" : "",
              toUrl: f.field === "avatarHash" ? next.avatarUrl || "" : "",
            },
          },
          now
        )
      );
    }
    var set = diff.diffSets((prev && prev.playlists) || [], next.playlists || []);
    var byUri = {};
    for (var k = 0; k < next.plays.length; k++) byUri[next.plays[k].uri] = next.plays[k];
    for (var a = 0; a < set.added.length; a++) {
      var pl = byUri[set.added[a]] || {};
      events.push(
        ev.makeEvent(
          {
            level: "profile",
            target: id,
            kind: "profile.playlist.added",
            uri: set.added[a],
            title: next.name || "",
            detail: pl.name || "their playlist",
            extra: pl.cover ? { cover: pl.cover } : undefined,
          },
          now
        )
      );
    }
    for (var r = 0; r < set.removed.length; r++) {
      events.push(
        ev.makeEvent(
          {
            level: "profile",
            target: id,
            kind: "profile.playlist.removed",
            uri: set.removed[r],
            title: next.name || "",
            detail: "their playlist",
          },
          now
        )
      );
    }
    // Rename vs new-or-departed is decided by id, not by name (reference semantics).
    var prevByUri = {};
    for (var z = 0; prev && prev.plays && z < prev.plays.length; z++) prevByUri[prev.plays[z].uri] = prev.plays[z];
    for (var m = 0; m < next.plays.length; m++) {
      var cur = next.plays[m];
      var old = prevByUri[cur.uri];
      if (!old) continue;
      if (old.name && cur.name && old.name !== cur.name) {
        events.push(
          ev.makeEvent(
            {
              level: "profile",
              target: id,
              kind: "profile.playlist.renamed",
              uri: cur.uri,
              title: next.name || "",
              detail: old.name + " → " + cur.name,
              extra: { from: old.name, to: cur.name },
            },
            now
          )
        );
      }
      // A cover change here (profile-view playlist artwork) is the same
      // observable edit the playlist scan logs. Compare size- and shape-
      // independently so a resolution flip or a mosaic↔single switch is not a
      // phantom, and only fire on a genuine change.
      var pid = P();
      var oldCover = old.cover || "";
      var curCover = cur.cover || "";
      // Without the sources helper a size/shape-aware comparison is impossible;
      // emit nothing rather than risk a phantom (production always has sources).
      var changed = pid.sources && pid.sources.coverChanged
        ? pid.sources.coverChanged(oldCover, curCover)
        : false;
      if (changed) {
        events.push(
          ev.makeEvent(
            {
              level: "profile",
              target: id,
              kind: "profile.playlist.cover.changed",
              uri: cur.uri,
              title: next.name || "",
              detail: cur.name || cur.uri,
              extra: { from: oldCover, to: curCover, fromUrl: oldCover, toUrl: curCover },
            },
            now
          )
        );
      }
    }
    return { events: events, fields: fields, added: set.added.length, removed: set.removed.length };
  }

  /**
   * Capability-gated follower list. Returns
   * { state: 'ok'|'degraded'|'unavailable', ids: string[], error? }.
   *
   * Only followers: `sources.ENDPOINTS.following` exists and is deliberately
   * unused, because nothing consumes a following list — the event catalogue has
   * no `following` kinds and no view renders one. The signature used to take a
   * `which` argument and branch on "following", which advertised a capability
   * the app does not have; the Settings toggle below says "followers" only.
   */
  async function fetchFollowersNet(deps, userId) {
    var pwt = P();
    var net = deps.net || pwt.net;
    var spec = pwt.sources.ENDPOINTS.followers(userId);
    try {
      var res = await net.call(spec);
      // An error body is not a list. Without this, a rate-limited-but-200 answer
      // reads as "no followers" and every known follower is reported as gone.
      var be = net.bodyError ? net.bodyError(res) : null;
      if (be) {
        var err = new Error(net.bodyErrorMessage ? net.bodyErrorMessage("followers", be) : "request failed");
        err.code = net.bodyErrorCode ? net.bodyErrorCode(be, "network") : "network";
        throw err;
      }
      var list = (res && (res.profiles || res.users || res.followers || res.following)) || null;
      if (!Array.isArray(list)) return { state: "degraded", ids: [], error: "unexpected payload shape" };
      // An empty list that contradicts a declared total is a truncated or
      // partial read, not a mass departure. Reporting it as `ok` would emit one
      // "a follower left" row per known follower.
      var declared = res && (res.total != null ? res.total : res.count != null ? res.count : null);
      if (!list.length && declared != null && declared > 0) {
        return { state: "degraded", ids: [], error: "the list came back empty but the endpoint reports " + declared + " follower(s)" };
      }
      var ids = [];
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        if (typeof it === "string") ids.push(it);
        else if (it && (it.uri || it.username || it.id)) ids.push(String(it.uri || it.username || it.id).replace(/^spotify:user:/, ""));
      }
      return { state: "ok", ids: ids };
    } catch (e) {
      var state = e.code === "forbidden" || e.code === "unauthorized" || e.code === "notfound" ? "unavailable" : "degraded";
      return { state: state, ids: [], error: e.message };
    }
  }

  /**
   * Scan all watched profiles.
   */
  async function scanProfiles(deps, opts) {
    var pwt = P();
    var net = deps.net || pwt.net;
    var db = deps.db || pwt.db;
    var store = deps.store || pwt.store;
    var settings = deps.config ? deps.config.get() : {};
    opts = opts || {};
    var watches = await store.listWatches("profile");
    var totals = { edits: 0, added: 0, removed: 0, failed: 0 };
    var done = 0;

    async function scanOne(w) {
      var prev = (await db.get("profiles", w.id)) || {
        id: w.id,
        name: "",
        avatarHash: "",
        avatarUrl: "",
        followers: null,
        playlists: [],
        plays: [],
        watchActivity: false,
        health: "new",
        failures: 0,
      };
      if (net.isNegative("profile:" + w.id) && !opts.force) return { skipped: true };
      var res;
      try {
        res = await net.call(pwt.sources.ENDPOINTS.profile(w.id, { playlistLimit: 100 }));
        // The client answers dead or blocked endpoints with HTTP 200 and an
        // error body, which never throws. Detect it, or the reader sees an
        // empty profile instead of the endpoint's actual answer. A transport
        // failure ("Failed to fetch") is reported unreachable, not as a status.
        var profileBodyError = net.bodyError ? net.bodyError(res) : null;
        if (profileBodyError) {
          var bodyErr = new Error(net.bodyErrorMessage("profile endpoint", profileBodyError));
          bodyErr.code = net.bodyErrorCode(profileBodyError, "network");
          throw bodyErr;
        }
      } catch (e) {
        var failures = (prev.failures || 0) + 1;
        // Heal the stored name while failing: a pre-fix row may carry the raw
        // user code as its name, and that must stop rendering.
        var healedName = idShaped(prev.name) ? "" : prev.name;
        var failedRow = Object.assign({}, prev, { name: healedName, failures: failures, health: failures >= 3 ? "failing" : "degraded", lastError: String(e.message).slice(0, 300) });
        try {
          await store.commitScan({ puts: [["profiles", failedRow]] });
        } catch (writeErr) {
          failedRow.lastError = "write failed: " + writeErr.message + " | " + failedRow.lastError;
        }
        if (deps.onError) deps.onError("profile " + w.id, e);
        // A deleted or private profile will not start answering: back it off for
        // the negative-cache TTL instead of re-requesting it every scan.
        if (e.code === "notfound" || e.code === "forbidden") net.markNegative("profile:" + w.id);
        // The pool callback counts the failure; only the reason is recorded here.
        if (!totals.errors) totals.errors = [];
        totals.errors.push({ id: w.id, name: prev.name || "", error: String(e.message || e).slice(0, 300) });
        return { error: e.message };
      }
      net.clearNegative("profile:" + w.id);
      var next = parseProfile(res);
      if (!next || !next.id) throw new Error("profile view returned no user id");
      // `next.name` is "" when the payload resolves no name — only fall back
      // to the stored name when that name is not itself the raw user code
      // (rows stored before the fix would otherwise keep leaking it).
      var healedPrevName = idShaped(prev.name) ? "" : prev.name;
      var evaluated = diffProfile(prev, next, Date.now());
      var row = Object.assign({}, prev, {
        id: next.id,
        name: next.name || healedPrevName,
        avatarUrl: next.avatarUrl || prev.avatarUrl,
        avatarHash: next.avatarHash || prev.avatarHash,
        followers: next.followers != null ? next.followers : prev.followers,
        playlists: next.playlists,
        plays: next.plays,
        lastSyncedAt: Date.now(),
        failures: 0,
        health: "ok",
        lastError: "",
      });

      var puts = [["profiles", row]];
      var changes = evaluated.events.slice();

      // Capability-gated follower logs (only when enabled).
      if (settings.followers !== false) {
        var followers = await fetchFollowersNet(deps, w.id);
        if (followers.state === "ok") {
          var base = await db.get("profileSets", "followers:" + w.id);
          if (base) {
            var d = pwt.diff.diffSets(base.ids, followers.ids);
            for (var i = 0; i < d.added.length; i++) {
              changes.push(
                pwt.events.makeEvent({ level: "profile", target: w.id, kind: "profile.follower.appear", title: row.name, detail: "a new follower", uri: "spotify:user:" + d.added[i] }, Date.now())
              );
            }
            for (var j = 0; j < d.removed.length; j++) {
              changes.push(
                pwt.events.makeEvent({ level: "profile", target: w.id, kind: "profile.follower.disappear", title: row.name, detail: "a follower left", uri: "spotify:user:" + d.removed[j] }, Date.now())
              );
            }
          }
          puts.push(["profileSets", { key: "followers:" + w.id, profileId: w.id, kind: "followers", ids: followers.ids, lastSyncedAt: Date.now() }]);
        }
        row.probe = Object.assign({}, row.probe, { followersList: followers.state });
        if (followers.state === "unavailable") row.probeError = followers.error || "";
      }

      // `events` includes the playlist added/removed rows, so subtracting
      // added/removed leaves only the scalar edits (name/avatar/followers) —
      // otherwise a playlist addition is counted as both an edit and an add.
      var playlistEvents = evaluated.added + evaluated.removed;
      totals.edits += evaluated.events.length - playlistEvents;
      totals.added += evaluated.added;
      totals.removed += evaluated.removed;
      await store.commitScan({ puts: puts, changes: changes });
      return { id: w.id, events: changes.length };
    }

    await net.pool(
      watches,
      2,
      scanOne,
      function (d, t, item, result) {
        done++;
        // A profile scan result is one of:
        //   { ok: true,  value: evaluatedRecord }   – success
        //   { ok: true,  value: { skipped: true } } – backed off, not a failure
        //   { ok: true,  value: { error: "…" } }    – fetch failed; the reason
        //                                            was already recorded by scanOne
        //   { ok: false, error: e }                 – task threw unexpectedly
        // Count the failure; only a task that threw before reaching scanOne's
        // own error path needs its reason pushed here (or errors double up).
        var value = result && result.ok === false ? null : result && result.value;
        var looksFailed = !value || (!value.skipped && (value.error || result.ok === false));
        if (looksFailed) {
          totals.failed++;
          if (result && result.ok === false) {
            var reason = (result && result.error && (result.error.message || result.error)) || "";
            if (!totals.errors) totals.errors = [];
            totals.errors.push({ id: (item && item.id) || "", name: "", error: String(reason).slice(0, 300) });
          }
        }
        var report = (opts && opts.progress) || deps.progress;
        if (report) report("profiles", done, watches.length, totals, item);
      },
      250
    );

    return { totals: totals, total: watches.length };
  }

  return { parseProfile: parseProfile, diffProfile: diffProfile, fetchFollowersNet: fetchFollowersNet, scanProfiles: scanProfiles };
});
