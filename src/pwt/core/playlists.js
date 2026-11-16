/* eslint-disable */
/**
 * Spotispy — playlist scan stage.
 *
 * For each watched playlist: fetch contents through the source chain
 * (client playlist API -> Web API via Cosmos -> embed JSON -> web-player
 * GraphQL -> last-ditch core rows),
 * decide with the pure differ whether anything is loggable, and return one atomic
 * commit plan. A failed fetch writes nothing (proposal §4.2).
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.playlists = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function P() {
    return root.PWT;
  }

  function U() {
    return P().util;
  }

  // Resolved error-body detection/classification/wording is shared (net.js) so
  // every surface reports a dead endpoint the same honest way.
  function bodyError(res) {
    var net = P().net;
    return net && net.bodyError ? net.bodyError(res) : null;
  }
  function bodyErrorCode(be, fallback) {
    var net = P().net;
    return net && net.bodyErrorCode ? net.bodyErrorCode(be, fallback) : fallback || "network";
  }
  function bodyErrorMessage(prefix, be) {
    var net = P().net;
    return net && net.bodyErrorMessage ? net.bodyErrorMessage(prefix, be) : prefix + ": error";
  }

  // Source chain, cheapest/most-reliable first. The client's own playlist API
  // (Platform.PlaylistAPI) is first: verified live on 1.3.9.2055 that the
  // renderer cannot reach api.spotify.com at all, while this object answers
  // in-process. Then the HTTP chain: embed JSON needs no session; pathfinder is
  // the public web-player GraphQL; the in-client sp:// core-playlist resolver is
  // unregistered on current builds (-1 Resolver not found), so it stays only as a
  // last-ditch attempt.
  var CFG = { sourceOrder: ["client", "api", "embed", "pathfinder", "core"] };

  /**
   * Fetch one playlist's contents, preferring the client's own route and
   * falling back when it is unavailable. Returns
   * { uris, added, total, source, capped, rawMeta } or throws.
   */
  async function fetchContents(id, opts) {
    opts = opts || {};
    var pwt = P();
    var sources = pwt.sources;
    var net = pwt.net;
    var attempts = [];

    for (var i = 0; i < CFG.sourceOrder.length; i++) {
      var name = CFG.sourceOrder[i];
      // A source whose spec cannot even be built (no PlaylistAPI on this build)
      // is not a failure to report: it is a route that does not exist here.
      if (name === "client" && !sources.SOURCES.clientContents.fn(id)) continue;
      try {
        if (name === "client") {
          var cliRes = await net.call(sources.SOURCES.clientContents.fn(id));
          var cliParsed = sources.SOURCES.clientContents.parse(cliRes);
          // A short read is a partial read, and "short" means the page carried
          // fewer items than the response says exist (`truncated`). What must
          // NOT count is `uris.length` against `totalLength`: `totalLength`
          // includes episodes, so a complete playlist of 10 tracks plus one
          // episode was marked capped forever — and a capped read reseeds instead
          // of diffing, so that playlist never reported a single change.
          if (!cliParsed.uris.length) throw new Error("client playlist route returned no track URIs");
          var cliTotal = cliParsed.total == null ? cliParsed.uris.length : cliParsed.total;
          var cliCapped = !!cliParsed.truncated;
          attempts.push({ source: "client", ok: true, capped: cliCapped });
          // The same read carries each track's title, artists, album and cover;
          // hand them to the caller so the cache is filled without a second pass
          // (on this build there is no second pass that works).
          return {
            uris: cliParsed.uris,
            added: cliParsed.added,
            tracks: cliParsed.tracks,
            total: cliTotal,
            source: "client",
            capped: cliCapped,
          };
        }
        if (name === "api") {
          var total = null;
          var urisA = [];
          var addedA = {};
          var offset = 0;
          var pagesA = 0;
          while (pagesA < 20) {

            var apiSpec = sources.SOURCES.apiPlaylistTracks.fn(id, { offset: offset });
            var apiRes = await net.call(apiSpec);
            // The client answers an unreachable or rate-limited Web API with a
            // resolved {code,message} body instead of throwing — detect it here
            // or the source silently "succeeds" with zero tracks.
            var apiBodyError = bodyError(apiRes);
            if (apiBodyError) {
              var apiErr = new Error(bodyErrorMessage("web api", apiBodyError));
              apiErr.code = bodyErrorCode(apiBodyError, "network");
              throw apiErr;
            }
            var parsed = sources.SOURCES.apiPlaylistTracks.parse(apiRes);
            // An empty playlist is a legal outcome; a crash of the source is not.
            if (parsed.total === 0) {
              attempts.push({ source: "api", ok: true, empty: true });
              return { uris: [], added: {}, total: 0, source: "api", capped: false };
            }
            if (!parsed.uris.length && offset === 0 && pagesA === 0) throw new Error("api returned no track URIs");
            if (parsed.total != null) total = parsed.total;
            urisA = urisA.concat(parsed.uris);
            Object.assign(addedA, parsed.added);
            // Advance by the number of items the page RETURNED, not the number
            // of track URIs it yielded: `total` counts items (episodes, local
            // files, unavailable tracks included), so advancing by filtered
            // tracks skips and re-reads pages on any playlist that is not all
            // playable tracks.
            var pageItems = parsed.raw && Array.isArray(parsed.raw.items) ? parsed.raw.items.length : parsed.uris.length;
            if (parsed.total == null || urisA.length >= parsed.total || pageItems === 0) break;
            offset += pageItems;
            pagesA++;
          }
          if (!urisA.length) throw new Error("api tracks pipeline finished with zero URIs");
          // 20 pages x 100 tracks: a longer playlist is read partially, and a
          // partial read must not diff as "everything else was removed".
          var apiCapped = pagesA >= 20 && (total == null || urisA.length < total);
          attempts.push({ source: "api", ok: true, capped: apiCapped });
          return { uris: urisA, added: addedA, total: total == null ? urisA.length : total, source: "api", capped: apiCapped };
        }
        if (name === "core") {
          var spec = sources.SOURCES.coreRows.fn(id);
          var res = await net.call(spec);
          if (res && bodyError(res)) {
            var coreBe = bodyError(res);
            var coreErr = new Error(bodyErrorMessage("core resolver", coreBe));
            coreErr.code = bodyErrorCode(coreBe, "notfound");
            throw coreErr;
          }
          var parsed = sources.SOURCES.coreRows.parse(res);
          if (!parsed.uris.length) {
            // A core read with no tracks is not a successful empty playlist: on
            // a build where the resolver answers empty, returning [] would let a
            // second scan diff a zero snapshot into a mass removal.
            throw new Error("core rows returned no track URIs");
          }
          attempts.push({ source: "core", ok: true });
          return { uris: parsed.uris, added: parsed.added, total: parsed.total || parsed.uris.length, source: "core", capped: false };
        }
        if (name === "pathfinder") {
          var metaSpec = sources.SOURCES.pathfinder.fn(id, {});
          var meta = await net.call(metaSpec);
          var pathBe = bodyError(meta);
          if (pathBe) {
            var pfErr = new Error(bodyErrorMessage("pathfinder", pathBe));
            pfErr.code = bodyErrorCode(pathBe, "network");
            throw pfErr;
          }
          var info = sources.SOURCES.pathfinder.parseMetadata(meta);
          if (!info) throw new Error("pathfinder returned no playlist");
          // One GraphQL hash serves both fetchPlaylistMetadata and
          // fetchPlaylistContents. A metadata-only answer legitimately has no
          // `content`: treating that as a successful 0-track read would let a
          // second scan confirm an empty snapshot and emit every track as
          // removed. Fall through to the next source instead.
          if (!meta || !meta.data || !meta.data.playlistV2 || meta.data.playlistV2.content == null) {
            throw new Error("pathfinder returned no playlist contents");
          }
          var total = info.total == null ? 0 : info.total;
          if (total === 0) throw new Error("pathfinder reported an empty playlist");
          var uris = [];
          var added = {};
          var offset = 0;
          var pages = 0;
          while (offset < total && pages < 200) {
            var pageSpec = sources.SOURCES.pathfinder.fn(id, { offset: offset, limit: sources.SOURCES.pathfinder.pageSize });
            var page = await net.call(pageSpec);
            if (page && bodyError(page)) {
              var pageBe = bodyError(page);
              var pfPageErr = new Error(bodyErrorMessage("pathfinder", pageBe));
              pfPageErr.code = bodyErrorCode(pageBe, "network");
              throw pfPageErr;
            }
            var parsedPage = sources.SOURCES.pathfinder.parsePage(page);
            if (!parsedPage || !parsedPage.uris.length) throw new Error("pathfinder page empty at offset " + offset);
            uris = uris.concat(parsedPage.uris);
            Object.assign(added, parsedPage.added);
            // Advance by ITEMS, not tracks: `offset` indexes `content.items`, so
            // advancing by `uris.length` re-read the tail of every page that
            // contained an episode, duplicating URIs and — once the page count
            // ran out — truncating the list while still claiming completeness.
            offset += parsedPage.items || parsedPage.uris.length;
            pages++;
          }
          attempts.push({ source: "pathfinder", ok: true });
          // The `pages < 200` guard is a hard stop, not a full read: a 10,000-item
          // playlist needs 100 pages even with no episodes, and one with episodes
          // needs more, so hitting the cap leaves a truncated list. Claiming
          // `capped: false` then lets the next scan diff that short list and
          // report every unread track as removed. Say so instead.
          var hitPageCap = offset < total;
          return {
            uris: uris,
            added: added,
            total: total,
            source: "pathfinder",
            capped: hitPageCap,
            meta: info,
          };
        }
        if (name === "embed") {
          var embedSpec = sources.SOURCES.embed.fn(id);
          var html = await net.call(embedSpec);
          var entity = sources.SOURCES.embed.parse(html);
          if (!entity || !entity.uris.length) throw new Error("embed JSON missing or empty");
          attempts.push({ source: "embed", ok: true });
          // Take the parse result's own verdict. This used to hardcode `true`,
          // discarding a correctly-computed `capped: false` for a read that got
          // `trackListFull` matching the page's declared total — so on a build
          // where the client and Web API routes both fail, every playlist was
          // read through embed and marked capped on every scan, reseeding instead
          // of diffing and never logging a single track change.
          return { uris: entity.uris, added: entity.added, total: entity.total, source: "embed", capped: entity.capped, meta: entity };
        }
      } catch (e) {
        attempts.push({ source: name, ok: false, error: e && e.message });
      }
    }
    // A message a person can act on: name the first reason, not a JSON blob.
    var first = null;
    for (var ai = 0; ai < attempts.length; ai++) {
      if (!attempts[ai].ok && attempts[ai].error) {
        first = attempts[ai];
        break;
      }
    }
    var summary = first
      ? first.source + ": " + String(first.error).slice(0, 160)
      : "every source answered but none carried tracks";
    var err = new Error(summary);
    err.attempts = attempts;
    throw err;
  }

  /** Fetch playlist metadata (name, cover, owner, followers) through the chain. */
  async function fetchMeta(id) {
    var pwt = P();
    var out = {};
    // 1) The client's own playlist API: the one route that still answers on
    //    current desktop builds (verified live on 1.3.9.2055 that the renderer
    //    cannot reach api.spotify.com at all). Its answer is the real playlist
    //    object, so an absent field here means the playlist has none.
    try {
      var clientSpec = pwt.sources.SOURCES.clientMeta.fn(id);
      if (clientSpec) {
        var clientRes = await pwt.net.call(clientSpec);
        if (!bodyError(clientRes)) {
          var parsedClient = pwt.sources.SOURCES.clientMeta.parse(clientRes);
          // Never let an empty field from a later source erase a real value.
          for (var ck in parsedClient) {
            if (!Object.prototype.hasOwnProperty.call(parsedClient, ck)) continue;
            if (parsedClient[ck] == null || parsedClient[ck] === "") continue;
            out[ck] = parsedClient[ck];
          }
        }
      }
    } catch (eClient) {
      /* fall through to the HTTP chain */
    }
    // 2) Web API, where the client can reach api.spotify.com at all. A
    //    rate-limited answer arrives as {code,message} and is never parsed as
    //    metadata (an empty name is not a name).
    if (!out.name || !out.coverUrl) {
      try {
        var api = await pwt.net.call(pwt.sources.SOURCES.apiPlaylist.fn(id));
        if (!bodyError(api)) {
          var parsedApi = pwt.sources.SOURCES.apiPlaylist.parse(api);
          for (var ak in parsedApi) {
            if (!Object.prototype.hasOwnProperty.call(parsedApi, ak)) continue;
            if (out[ak] != null && out[ak] !== "") continue;
            if (parsedApi[ak] == null || parsedApi[ak] === "") continue;
            out[ak] = parsedApi[ak];
          }
        }
      } catch (eApi) {
        /* fall through */
      }
    }
    // 2b) The client route answers even when the HTTP chain does not, and its
    //     payload carries a LIKE counter rather than a followers field. So the
    //     follower count can still be missing after step 1 succeeded on name and
    //     cover — which is exactly the case step 2 above skips. Ask specifically
    //     for the count rather than letting it stay absent, and only accept a
    //     value from a source that names followers. `likes` is a last resort and
    //     is labelled as such by the caller, never silently passed off as
    //     followers.
    if (out.followers == null) {
      try {
        var api2 = await pwt.net.call(pwt.sources.SOURCES.apiPlaylist.fn(id));
        if (!bodyError(api2)) {
          var parsedApi2 = pwt.sources.SOURCES.apiPlaylist.parse(api2);
          if (parsedApi2 && parsedApi2.followers != null && parsedApi2.followers !== "") out.followers = parsedApi2.followers;
        }
      } catch (eApi2) {
        /* the count stays unknown; the UI shows "—" rather than a guess */
      }
    }
    // 3) wg core-playlist metadata, if the resolver exists.
    if (!out.name) {
      try {
        var core = await pwt.net.call(pwt.sources.SOURCES.coreMeta.fn(id));
        var coreMetaBe = bodyError(core);
        if (!coreMetaBe) {
          var parsedCore = pwt.sources.SOURCES.coreMeta.parse(core);
          // Fill what the Web API could not, keep what it did — never let an
          // empty field from the core resolver erase a real value.
          for (var mk in parsedCore) {
            if (!Object.prototype.hasOwnProperty.call(parsedCore, mk)) continue;
            if (out[mk] == null || out[mk] === "") out[mk] = parsedCore[mk];
          }
        }
      } catch (e2) {
        /* fall through */
      }
    }
    // 4) The profile view lists a user's public playlists with name + image_url
    //    (spotify:mosaic: refs). It works whenever the profile route works, even
    //    while the Web API is rate limited.
    if (!out.name || !out.coverUrl) {
      try {
        var ownerIds = [];
        var addOwner = function (v) {
          var s = String(v || "").replace(/^spotify:user:/, "");
          if (s && s.length >= 20 && ownerIds.indexOf(s) < 0) ownerIds.push(s);
        };
        addOwner(out.owner);
        try {
          var stored = await pwt.db.get("playlists", id);
          addOwner(stored && stored.ownerId);
        } catch (eStored) {
          /* no stored row yet */
        }
        try {
          var ws = await pwt.store.listWatches("profile");
          (ws || []).forEach(function (w) {
            addOwner(w.id);
          });
        } catch (eW) {
          /* no profile watches */
        }
        for (var oi = 0; oi < ownerIds.length && (!out.name || !out.coverUrl); oi++) {
          try {
            var prof = await pwt.net.call(pwt.sources.ENDPOINTS.profile(ownerIds[oi], { playlistLimit: 200, artistLimit: 0, episodeLimit: 0 }));
            // Same rule as the scan path: an endpoint error body is not an empty profile.
            if (!prof || bodyError(prof)) continue;
            var parsedProf = pwt.profiles && pwt.profiles.parseProfile ? pwt.profiles.parseProfile(prof) : null;
            var found = null;
            ((parsedProf && parsedProf.plays) || []).forEach(function (x) {
              if (!found && String(x.uri) === "spotify:playlist:" + id) found = x;
            });
            if (found) {
              if (!out.name && found.name) out.name = found.name;
              if (!out.coverUrl && found.cover) out.coverUrl = found.cover;
              // NOT `found.total`: that is the playlist's track count (see
              // profiles.js parseProfile), so storing it as `followers` put a
              // track count under the "followers" label and, because it filled
              // the slot first, also suppressed the real like counter below.
              if (!out.owner) out.owner = ownerIds[oi];
            }
          } catch (eP) {
            /* try the next profile */
          }
        }
      } catch (e3) {
        /* the profile route is another fallback, not a requirement */
      }
    }
    // Decided last, against every source: a like counter is only reported as
    // such when no source supplied a real follower count. Earlier placements ran
    // before the profile fallback could fill `followers`, so a valid count found
    // there still left this flag set and the view hid the likes alongside it.
    if (out.followers == null && out.likes != null && out.likes !== "") {
      out.likesOnly = out.likes;
    }
    return out;
  }

  /**
   * Diff one playlist against its stored snapshot and build events.
   * @param {object} row stored `playlists` row (may carry `pendingShrink`)
   * @param {object} snapshot stored `snapshots` row (optional)
   * @param {object} fresh fetchContents() result
   * @param {object} meta fresh metadata (optional)
   * @param {number} now
   * @returns {{ events: object[], snapshot: object, playlist: object, counts: object }}
   */
  function evaluate(row, snapshot, fresh, meta, now, trackRows) {
    var pwt = P();
    var diff = pwt.diff;
    var ev = pwt.events;
    var id = row.id;
    var title = (meta && meta.name) || row.name || "Untitled playlist";
    var events = [];

    var plan = diff.planTrackDiff(snapshot, fresh);
    var snapshotRow = {
      playlistId: id,
      uris: fresh.uris.slice(),
      source: fresh.source,
      capped: !!fresh.capped,
      total: fresh.total != null ? fresh.total : fresh.uris.length,
      lastSyncedAt: now,
    };
    if (plan.action === "hold") {
      snapshotRow.pendingShrink = { count: fresh.uris.length, confirmations: plan.confirmations };
      // Keep the PRE-shrink list: the confirmation scan has to compare against it
      // for `isSuspiciousShrink` to fire again, which is what proves the removals.
      snapshotRow.uris = (snapshot && snapshot.uris) || fresh.uris.slice();
      // But the additions reported by this hold must not be reported again when
      // the shrink is confirmed. Record them so the next scan can skip them.
      snapshotRow.reportedAdds = (snapshot && snapshot.reportedAdds ? snapshot.reportedAdds.slice() : []);
      for (var ra = 0; ra < plan.added.length; ra++) {
        if (snapshotRow.reportedAdds.indexOf(plan.added[ra]) < 0) snapshotRow.reportedAdds.push(plan.added[ra]);
      }
    } else {
      // Any scan that is not a hold closes the window: from here the snapshot
      // reflects what was actually reported.
      snapshotRow.reportedAdds = [];
    }

    // Additions are emitted for a diff OR a hold. A hold means "the shrink is
    // unconfirmed, so emit no removals yet" — it is not a reason to drop adds,
    // which the same read already proved. Dropping them meant a genuine new
    // track was invisible for a cycle.
    if (plan.action === "diff" || plan.action === "hold") {
      var already = (snapshot && snapshot.reportedAdds) || [];
      for (var a = 0; a < plan.added.length; a++) {
        var uri = plan.added[a];
        // Skip additions this snapshot already reported during an unconfirmed
        // shrink. The confirmation scan diffs against the same pre-shrink list,
        // so it would otherwise emit them a second time — on a later day, where
        // `rowKey` cannot dedupe and the aggregate counts the track twice.
        if (already.indexOf(uri) >= 0) continue;
        var add = fresh.added && fresh.added[uri] ? fresh.added[uri] : null;
        var addedRow = trackRows && trackRows[uri] ? trackRows[uri] : null;
        events.push(
          ev.makeEvent(
            {
              level: "playlist",
              target: id,
              kind: "playlist.item.added",
              uri: uri,
              title: title,
              // The row's own title is a label; the uri stays the identity (the
              // "open" action needs it) and never reaches the detail column.
              detail: (addedRow && addedRow.title) || "",
              sourceDate: add && add.addedAt && add.addedAt > 0 ? add.addedAt : undefined,
              extra: add && add.addedBy ? { addedBy: add.addedBy } : undefined,
            },
            now
          )
        );
      }
      for (var r = 0; r < plan.removed.length; r++) {
        var removedRow = trackRows && trackRows[plan.removed[r]] ? trackRows[plan.removed[r]] : null;
        events.push(
          ev.makeEvent(
            {
              level: "playlist",
              target: id,
              kind: "playlist.item.removed",
              uri: plan.removed[r],
              title: title,
              detail: (removedRow && removedRow.title) || "",
            },
            now
          )
        );
      }
    }

    // Metadata edits (name / cover / description) are per-playlist changes.
    var fields = diff.diffScalars(row, meta || {}, ["name", "coverHash", "description"], { ignoreNull: ["coverHash", "description", "name"] });
    for (var f = 0; f < fields.length; f++) {
      var c = fields[f];
      events.push(
        ev.makeEvent(
          {
            level: "playlist",
            target: id,
            kind: c.field === "coverHash" ? "profile.playlist.cover.changed" : c.field === "name" ? "profile.playlist.renamed" : "playlist.meta.changed",
            title: title,
            detail: c.field + ": " + (c.from == null ? "—" : c.from) + " → " + (c.to == null ? "—" : c.to),
            extra: { field: c.field, from: c.from, to: c.to },
          },
          now
        )
      );
    }

    var playlistRow = Object.assign({}, row, {
      lastSyncedAt: now,
      lastChangeAt: events.length ? now : row.lastChangeAt || now,
      trackCount: fresh.total != null ? fresh.total : fresh.uris.length,
      health: "ok",
      // A clean scan proves the row healthy; a stale failure must not linger.
      failures: 0,
      lastError: "",
      pendingShrink: plan.action === "hold" ? snapshotRow.pendingShrink : null,
    });
    if (meta) {
      if (meta.name) playlistRow.name = meta.name;
      if (meta.coverUrl) playlistRow.coverUrl = meta.coverUrl;
      if (meta.coverHash) playlistRow.coverHash = meta.coverHash;
      if (meta.description != null) playlistRow.description = meta.description;
      if (meta.followers != null) playlistRow.followers = meta.followers;
      // Keep the like counter under its own name. It is NOT a follower count, so
      // storing it as one would show a wrong number; storing it separately lets
      // the detail view say "likes" when that is all this client exposes.
      if (meta.followers == null && meta.likesOnly != null) playlistRow.likes = meta.likesOnly;
      if (meta.owner) playlistRow.ownerId = meta.owner;
    }

    return {
      events: events,
      snapshot: snapshotRow,
      playlist: playlistRow,
      // Counts describe what was actually WRITTEN. A hold writes the additions
      // it proved and no removals, so both counts must follow the events array
      // rather than the plan: reporting plan.added for a reseed (which writes
      // nothing) would claim changes that do not exist and drive edits negative.
      counts: {
        added: events.filter(function (e) { return e.kind === "playlist.item.added"; }).length,
        removed: events.filter(function (e) { return e.kind === "playlist.item.removed"; }).length,
      },
      held: plan.action === "hold",
      reseeded: plan.action === "reseed",
    };
  }

  /**
   * Scan watched playlists.
   * @param {object} deps { db, store, net, config, progress }
   * @param {object} [opts] { only: playlistId } — restrict the pass to one
   *   watched playlist. A manual "Scan now" on a playlist page must not spend a
   *   request on (or change the health of) playlists the user did not ask about.
   */
  async function scanPlaylists(deps, opts) {
    var pwt = P();
    var net = deps.net || pwt.net;
    var db = deps.db || pwt.db;
    var store = deps.store || pwt.store;
    opts = opts || {};
    var watches = await store.listWatches("playlist");
    // An unknown id scans nothing at all rather than silently scanning all:
    // a silent full pass is exactly the surprise this option exists to stop.
    if (opts.only) watches = watches.filter(function (w) { return w.id === opts.only; });
    var total = watches.length;
    var done = 0;
    var totals = { added: 0, removed: 0, edits: 0, failed: 0, held: 0, reseeded: 0 };
    var results = [];

    async function scanOne(w) {
      var row = (await db.get("playlists", w.id)) || {
        id: w.id,
        ownerId: "",
        name: "",
        coverHash: "",
        coverUrl: "",
        description: "",
        followers: null,
        watchedAt: w.addedAt,
        lastSyncedAt: 0,
        lastChangeAt: 0,
        trackCount: 0,
        health: "new",
        failures: 0,
      };
      if (net.isNegative("playlist:" + w.id) && !opts.force) {
        return { skipped: true, id: w.id };
      }
      var snapshot = await db.get("snapshots", w.id);
      var fresh;
      try {
        fresh = await fetchContents(w.id, opts);
      } catch (e) {
        var failures = (row.failures || 0) + 1;
        var badHealth = failures >= 3 ? "failing" : "degraded";
        var why = String((e && e.message) || e).slice(0, 300);
        await store.commitScan({
          puts: [["playlists", Object.assign({}, row, { failures: failures, health: badHealth, lastError: why })]],
        });
        // Even when the track list cannot be read, the playlist's name and
        // cover usually can (the profile route). Showing them means a failing
        // scan still leaves a usable playlist page instead of three hash rows.
        try {
          var metaOnError = await fetchMeta(w.id);
          if (metaOnError && (metaOnError.name || metaOnError.coverUrl)) {
            row = Object.assign({}, row, {
              name: metaOnError.name || row.name,
              coverUrl: metaOnError.coverUrl || row.coverUrl,
              ownerId: String(metaOnError.owner || row.ownerId || "").replace(/^spotify:user:/, ""),
              // Carry the failure bookkeeping into the same row, or this second
              // write clobbers the one commit above (stale failures/lastError).
              failures: failures,
              health: badHealth,
              lastError: why,
            });
            await store.commitScan({ puts: [["playlists", row]] });
          }
        } catch (eMetaErr) {
          /* the name is a bonus; the failure below is what matters */
        }
        // Surfaced by the scan summary: "N sources failed" with the reason.
        if (!totals.errors) totals.errors = [];
        totals.errors.push({ id: w.id, name: row.name || "", error: why });
        if (e.code === "notfound" || e.code === "forbidden") net.markNegative("playlist:" + w.id);
        return { id: w.id, error: e.message };
      }
      net.clearNegative("playlist:" + w.id);
      var meta = fresh.meta || null;
      if (meta && meta.owner) meta.owner = String(meta.owner).replace(/^spotify:user:/, "");
      if (!meta || !meta.name || !meta.coverUrl) {
        try {
          var fromProfile = await fetchMeta(w.id);
          meta = Object.assign({}, meta || {}, fromProfile || {});
          if (meta.owner) meta.owner = String(meta.owner).replace(/^spotify:user:/, "");
        } catch (e2) {
          meta = meta || null;
        }
      }
      var evaluated = evaluate(row, snapshot, fresh, meta, Date.now(), fresh.tracks);
      // The playlist read already carried every track's title, artists, album and
      // cover (the client route does). Write them to the shared track cache in the
      // same commit, so the playlist view shows real rows instead of "Unknown
      // track" while the separate metadata pass catches up.
      var trackRows = fresh.tracks || {};
      var trackPuts = [];
      for (var tk in trackRows) {
        if (!Object.prototype.hasOwnProperty.call(trackRows, tk)) continue;
        var tr = trackRows[tk];
        var util = U();
        trackPuts.push([
          "tracks",
          {
            uri: tr.uri,
            title: tr.title,
            artist: tr.artist,
            album: tr.album,
            art: util && util.imageUrl ? util.imageUrl(tr.art) : tr.art,
            durationMs: tr.durationMs || 0,
            fetchedAt: Date.now(),
          },
        ]);
      }
      try {
        await store.commitScan({
          puts: [["playlists", evaluated.playlist], ["snapshots", evaluated.snapshot]].concat(trackPuts),
          changes: evaluated.events,
        });
      } catch (eCommit) {
        // A persistence failure is the playlist's failure, not an anonymous
        // one: the row's name and health are still the previous scan's, so
        // record the reason against the id and let the pool callback count it
        // once (it must not push a second, nameless copy).
        var commitWhy = String((eCommit && eCommit.message) || eCommit).slice(0, 300);
        if (!totals.errors) totals.errors = [];
        totals.errors.push({ id: w.id, name: row.name || "", error: "save failed: " + commitWhy });
        return { error: "save failed: " + commitWhy };
      }
      // Remember what this playlist holds, so its tracks get real titles and
      // album art (the scan reads these to fill the metadata cache).
      try {
        await store.setMeta("seenTracks:" + w.id, fresh.uris.slice(0, 500));
      } catch (eSeen) {
        /* the metadata pass is an enrichment, never a scan requirement */
      }
      totals.added += evaluated.counts.added;
      totals.removed += evaluated.counts.removed;
      totals.edits += evaluated.events.length - evaluated.counts.added - evaluated.counts.removed;
      if (evaluated.held) totals.held++;
      if (evaluated.reseeded) totals.reseeded++;
      results.push({ id: w.id, added: evaluated.counts.added, removed: evaluated.counts.removed, held: evaluated.held });
      return evaluated;
    }

    // Every track this scan saw, most recent playlist first: the metadata pass
    // below turns their URIs into titles and real album covers.
    var seen = [];
    var seenSet = {};
    var collectSeen = async function () {
      for (var wi = 0; wi < watches.length; wi++) {
        try {
          var uris = (await store.getMeta("seenTracks:" + watches[wi].id, null)) || [];
          for (var ui = 0; ui < uris.length && seen.length < 400; ui++) {
            if (!seenSet[uris[ui]]) {
              seenSet[uris[ui]] = true;
              seen.push(uris[ui]);
            }
          }
        } catch (eSeen) {
          /* a playlist with no recorded tracks contributes nothing */
        }
      }
    };

    await net.pool(
      watches,
      3,
      scanOne,
      function (d, t, item, result) {
        done++;
        // A playlists scan result is one of:
        //   { ok: true,  value: evaluatedRecord }      – success
        //   { ok: true,  value: { skipped: true } }    – backed off, not a failure
        //   { ok: true,  value: { error: "…" } }       – fetch/commit failed
        //   { ok: false, error: e }                    – task threw unexpectedly
        // Everything counts as failed except a clean evaluation or an explicit skip.
        var value = result && result.ok === false ? null : result && result.value;
        var looksFailed = !value || (!value.skipped && (value.error || result.ok === false));
        if (looksFailed) {
          totals.failed++;
          // A fetch failure already recorded its reason (with the playlist's
          // name) in scanOne's own error path. Only a task that threw before
          // reaching that path needs one recorded here, or every playlist's
          // error lands in the list twice.
          if (result && result.ok === false) {
            var reason = (result && result.error && (result.error.message || result.error)) || "";
            if (!totals.errors) totals.errors = [];
            totals.errors.push({ id: (item && item.id) || "", name: "", error: String(reason).slice(0, 300) });
          }
        }
        var report = (opts && opts.progress) || deps.progress;
        if (report) report("playlists", done, t, totals, item);
      },
      250
    );

    // Fill titles and album art for the tracks this scan saw. Best effort: a
    // rate-limited client just keeps "Unknown track" until the next pass.
    try {
      await collectSeen();
      await fetchTrackMetadata({ db: db, net: net }, seen, 60);
    } catch (eMeta) {
      /* enrichment only */
    }

    return { totals: totals, results: results, total: total };
  }

  /**
   * One track's metadata row: title, artist, album, cover, duration.
   * The client's own GraphQL carries the session and returns the real album
   * cover; api.spotify.com is the fallback (it is rate limited on some
   * sessions, which is why a Web-API-only lookup left rows as "Unknown track"
   * with a gradient tile). Returns null when neither answers.
   */
  async function fetchTrackRow(deps, uri) {
    var pwt = P();
    var net = (deps && deps.net) || pwt.net;
    // A row written by a client playlist read already has the real title,
    // artists, album and cover: use it instead of asking again (on this build
    // every network route for a single track is dead).
    var db0 = (deps && deps.db) || pwt.db;
    if (db0 && db0.get) {
      try {
        var known = await db0.get("tracks", uri);
        if (known && known.title) return known;
      } catch (eKnown) {
        /* fall through to the network */
      }
    }
    // 1) The client's own GraphQL.
    try {
      var spec = pwt.sources.ENDPOINTS.trackViaClient(uri);
      if (spec) {
        var g = await net.call(spec);
        var t = g && g.data && g.data.trackUnion;
        if (t && t.name) {
          var covers = (t.albumOfTrack && t.albumOfTrack.coverArt && t.albumOfTrack.coverArt.sources) || [];
          var pick = covers.slice().sort(function (a, b) {
            return (b.width || 0) - (a.width || 0);
          })[0];
          var names = [];
          ((t.firstArtist && t.firstArtist.items) || []).forEach(function (a) {
            if (a && a.profile && a.profile.name) names.push(a.profile.name);
          });
          ((t.otherArtists && t.otherArtists.items) || []).forEach(function (a) {
            if (a && a.profile && a.profile.name) names.push(a.profile.name);
          });
          return {
            uri: uri,
            title: t.name,
            artist: names.join(", "),
            album: t.albumOfTrack && t.albumOfTrack.name ? t.albumOfTrack.name : "",
            art: (pick && pick.url) || "",
            durationMs: (t.duration && t.duration.totalMilliseconds) || 0,
            fetchedAt: Date.now(),
          };
        }
      }
    } catch (eG) {
      /* fall through to the Web API */
    }
    // 2) Web API.
    try {
      var id = uri.split(":")[2];
      var res = await net.call(pwt.sources.ENDPOINTS.track(id));
      var trkBe = bodyError(res);
      if (trkBe) throw new Error(bodyErrorMessage("web api", trkBe));
      if (res && res.name) {
        return {
          uri: uri,
          title: res.name,
          artist: (res.artists || []).map(function (a) {
            return a.name;
          }).join(", "),
          album: res.album && res.album.name ? res.album.name : "",
          art: (res.album && res.album.images && res.album.images[0] && res.album.images[0].url) || "",
          durationMs: res.duration_ms || 0,
          fetchedAt: Date.now(),
        };
      }
    } catch (e) {
      /* metadata is optional; a later pass retries */
    }
    return null;
  }

  /** Fetch metadata for up to `limit` recently seen tracks (fills the shared cache). */
  async function fetchTrackMetadata(deps, uris, limit) {
    var pwt = P();
    var db = deps.db || pwt.db;
    var net = deps.net || pwt.net;
    var wanted = (uris || []).filter(function (u) {
      return /^spotify:track:[A-Za-z0-9]{22,40}$/.test(u);
    });
    var missing = [];
    for (var i = 0; i < wanted.length && missing.length < (limit || 40); i++) {
      var cached = await db.get("tracks", wanted[i]);
      if (!cached || !cached.title) missing.push(wanted[i]);
    }
    if (!missing.length) return 0;
    var ops = [];
    await net.pool(
      missing,
      4,
      async function (uri) {
        var row = await fetchTrackRow({ db: db, net: net }, uri);
        if (row) ops.push(["tracks", "put", row]);
      },
      50
    );
    if (ops.length) await db.batch(ops);
    return ops.length;
  }

  return {
    CFG: CFG,
    fetchTrackRow: fetchTrackRow,
    fetchContents: fetchContents,
    fetchMeta: fetchMeta,
    evaluate: evaluate,
    scanPlaylists: scanPlaylists,
    fetchTrackMetadata: fetchTrackMetadata,
  };
});
