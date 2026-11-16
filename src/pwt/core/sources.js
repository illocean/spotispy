/* eslint-disable */
/**
 * Spotispy — every endpoint in one place (proposal §7.1).
 *
 * Request shapes are the ones recorded in the proposal (§3, §3A, §3B) and
 * re-implemented from the reference implementations' *behaviour*, never copied.
 * When Spotify breaks a route, fix it here.
 *
 * Protocols
 *  - "sp"    : Spicetify internal protocol, handled by CosmosAsync.
 *  - "https" : a real host; sent through CosmosAsync so the client's session
 *              headers/token are attached automatically (no cookie or token we
 *              extract or persist ourselves).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.sources = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SPCLIENT = "https://spclient.wg.spotify.com";
  var PARTNER = "https://api-partner.spotify.com";
  var API = "https://api.spotify.com/v1";
  var PUBLIC = "https://open.spotify.com";

  function q(v) {
    return encodeURIComponent(v);
  }

  /**
   * The client's own playlist API, or null when this build does not expose it.
   * Read through the live global: Spicetify is installed by the host after the
   * app's scripts load, so a captured reference would go stale.
   */
  function clientPlaylistApi() {
    var S = null;
    try {
      S = (typeof globalThis !== "undefined" ? globalThis : window).Spicetify;
    } catch (e) {
      S = null;
    }
    var A = S && S.Platform && S.Platform.PlaylistAPI;
    if (!A || typeof A.getContents !== "function" || typeof A.getMetadata !== "function") return null;
    return A;
  }

  var COVER_LABELS = ["standard", "medium", "large", "extra-large"];

  /**
   * The highest-resolution cover in an album's `images` array. The client sends
   * only `url` + `label` (no width), so `label` is the size signal; a declared
   * `width` still wins when one is present. Returns a spotify:image: ref or URL.
   */
  function bestCover(images) {
    if (!Array.isArray(images) || !images.length) return "";
    var score = function (img) {
      var label = COVER_LABELS.indexOf((img && img.label) || "");
      return ((img && img.width) || 0) + (label < 0 ? 0 : label);
    };
    var sorted = images.slice().sort(function (a, b) {
      return score(b) - score(a);
    });
    var top = sorted[0];
    return (top && top.url) || "";
  }

  /**
   * A stable identity for a cover ref, for the "cover changed" diff.
   *
   * One definition, used by every source: `sources.js` used to derive it three
   * different ways, so the same artwork produced three different hashes and a
   * metadata source switch logged a cover change on its own. Nothing but the
   * artwork may enter it — folding in a playlist `snapshot_id` (which changes on
   * any edit) reported a cover change for every added or removed track.
   */
  function coverHashOf(cover) {
    if (!cover) return "";
    return String(cover).split("/").pop().split("?")[0];
  }

  /**
   * One item of a client playlist read, as a track row. The client already
   * carries the full metadata, so no second lookup is needed: reading it here is
   * what stops the playlist view rendering "Unknown track" with empty artist,
   * album and added-by columns. Returns null for anything that is not a track.
   */
  function clientTrackRow(item) {
    if (!item || !item.uri) return null;
    if (String(item.uri).indexOf("spotify:track:") !== 0) return null;
    var names = [];
    var artists = Array.isArray(item.artists) ? item.artists : [];
    for (var i = 0; i < artists.length; i++) {
      var a = artists[i] || {};
      var n = a.name || (a.profile && a.profile.name) || "";
      if (n) names.push(n);
    }
    var album = item.album || null;
    var duration = item.duration || null;
    return {
      uri: item.uri,
      title: item.name || "",
      artist: names.join(", "),
      album: (album && album.name) || "",
      albumUri: (album && album.uri) || "",
      art: bestCover(album && album.images),
      durationMs: (duration && duration.milliseconds) || 0,
    };
  }

  /**
   * Endpoint definitions. When Spotify breaks a route, fix it here.
   */
  var SOURCES = {
    // ---------------------------------------------------------- playlists
    // ------------------------- general-purpose Web API (works via Cosmos) --------------------------
    /**
     * Web API playlist — the most reliable public-playlist route on current
     * builds. Melior uses the same `api.spotify.com` host through Cosmos.
     */
    apiPlaylistTracks: {
      fn: function (id, opts) {
        opts = opts || {};
        var offset = opts.offset || 0;
        return {
          method: "get",
          url:
            API +
            "/playlists/" + q(id) + "/tracks?limit=100&offset=" + offset + "&market=from_token",
        };
      },
      /** @returns {{uris: string[], added: object, total: number|null, next: string|null}} */
      parse: function (res) {
        var items = (res && (res.items || null)) || [];
        var uris = [];
        var added = {};
        for (var i = 0; i < items.length; i++) {
          var it = items[i] || {};
          var tr = it.track || {};
          var uri = tr.uri;
          if (!uri || String(uri).indexOf("spotify:track:") !== 0) continue;
          uris.push(uri);
          var addedAt = it.added_at ? Date.parse(it.added_at) : null;
          var addedBy =
            (it.added_by && (it.added_by.id || (it.added_by.uri || "").replace(/^spotify:user:/, ""))) || "";
          if (addedAt != null || addedBy) {
            added[uri] = { addedAt: addedAt, addedBy: String(addedBy) };
          }
        }
        return { uris: uris, added: added, total: res && res.total != null ? res.total : null, raw: res };
      },
    },
    /**
     * The client's own playlist API (`Spicetify.Platform.PlaylistAPI`). On
     * current desktop builds this is the only route that reads a playlist's
     * tracks: verified live on 1.3.9.2055 that the renderer cannot reach
     * api.spotify.com at all (CosmosAsync resolves
     * `{code:429,error:"",message:"Failed to fetch"}` and the renderer's own
     * fetch() gets 401), while this object answers in-process.
     *
     * Returned as a `client: "playlistapi"` spec; `net.call` runs it. Null when
     * the build does not expose it, so callers fall through to the HTTP chain.
     */
    clientContents: {
      fn: function (id) {
        var A = clientPlaylistApi();
        return A ? { client: "playlistapi", kind: "contents", api: A, id: id } : null;
      },
      /** @returns {{uris: string[], added: object, tracks: object, total: number|null}} */
      parse: function (res) {
        var items = (res && res.items) || [];
        var uris = [];
        var added = {};
        var tracks = {};
        for (var i = 0; i < items.length; i++) {
          var it = items[i] || {};
          var uri = it.uri;
          if (!uri || String(uri).indexOf("spotify:track:") !== 0) continue;
          uris.push(uri);
          // The same read already carried this track's title, artists, album and
          // cover: keep them, so the playlist view never waits on a second lookup.
          var row = clientTrackRow(it);
          if (row && row.title) tracks[uri] = row;
          var addedAt = it.addedAt ? Date.parse(it.addedAt) : null;
          var addedBy = (it.addedBy && (it.addedBy.username || it.addedBy.uri)) || "";
          if (addedAt != null || addedBy) {
            added[uri] = { addedAt: addedAt, addedBy: String(addedBy).replace(/^spotify:user:/, "") };
          }
        }
        // `totalLength` counts every item — episodes and unavailable tracks
        // included — while `uris` holds only `spotify:track:` entries. So
        // `uris.length < totalLength` is true for a perfectly complete playlist
        // that merely contains one episode, and reporting that as a short read
        // made every scan reseed instead of diff, so such a playlist never
        // logged a single change.
        //
        // The two conditions that really do mean "partial" are separated:
        //   items.length < totalLength  — the page itself was truncated;
        //   uris.length  < items.length — some items were not tracks (normal,
        //     and not a reason to distrust the read).
        var total = res && res.totalLength != null ? res.totalLength : null;
        var items = res && res.items && res.items.length != null ? res.items.length : uris.length;
        return {
          uris: uris,
          added: added,
          tracks: tracks,
          total: total,
          items: items,
          // True when the page carried fewer items than the response says exist.
          truncated: total != null ? items < total : false,
          raw: res,
        };
      },
    },
    clientMeta: {
      fn: function (id) {
        var A = clientPlaylistApi();
        return A ? { client: "playlistapi", kind: "metadata", api: A, id: id } : null;
      },
      /** @returns {{name, description, owner, followers, likes, coverUrl, coverHash, total}} */
      parse: function (res) {
        var r = res || {};
        var images = r.images || [];
        // bestCover scores by declared width/label; taking a fixed end of the
        // array guesses at an order Spotify does not document, and the routes
        // disagreed (some took the last entry, some the first).
        var cover = bestCover(images);
        return {
          name: r.name || "",
          description: r.description || "",
          owner: (r.owner && (r.owner.username || r.owner.uri)) || "",
          // `followers` only when the payload names one. `totalLikes` is a LIKE
          // counter and is reported separately below, because this is the first
          // source in the chain and its value wins over every later one — mapping
          // a like count straight onto `followers` showed it under the
          // "followers" label. Whether the two are the same number on a given
          // build is not knowable from here, so the caller decides.
          followers: r.followers != null ? r.followers : null,
          likes: r.totalLikes != null ? r.totalLikes : null,
          coverUrl: cover,
          coverHash: coverHashOf(cover),
          total: r.totalLength != null ? r.totalLength : null,
          raw: r,
        };
      },
    },
    coreRows: {
      fn: function (id) {
        return {
          method: "get",
          url: "wg://core-playlist/v1/playlist/spotify:playlist:" + q(id) + "/rows",
          body: { policy: { link: true } },
        };
      },
      /** @returns {{uris: string[], added: object}} */
      parse: function (res) {
        var rows = (res && (res.rows || res.items)) || [];
        var uris = [];
        var added = {};
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];
          var uri = r.uri || (r.item && r.item.uri);
          if (!uri || String(uri).indexOf("spotify:track:") !== 0) continue;
          uris.push(uri);
          var addAt = r.addedAt || (r.added_at != null ? r.added_at : null);
          var addBy = r.addedBy || r.added_by || (r.addedByUri != null ? r.addedByUri : null);
          if (addAt != null || addBy != null) {
            added[uri] = {
              addedAt: typeof addAt === "string" ? Date.parse(addAt) : addAt,
              addedBy: addBy ? String(addBy).replace(/^spotify:user:/, "") : "",
            };
          }
        }
        return { uris: uris, added: added, total: res && (res.total != null ? res.total : uris.length), raw: res };
      },
    },
    coreMeta: {
      fn: function (id) {
        return { method: "get", url: "wg://core-playlist/v1/playlist/spotify:playlist:" + q(id) + "/metadata" };
      },
      /** @returns {{name, coverUrl, coverHash, description, owner, followers, descriptionHash}} */
      parse: function (res) {
        var r = res || {};
        var cover = r.image || r.picture || r.cover || (r.images && r.images[0] && r.images[0].url) || "";
        return {
          name: r.name || "",
          description: r.description || "",
          // Stripped here rather than at the one call site that noticed: a
          // `spotify:user:` prefix in `ownerId` is compared against bare ids
          // later (the profile view keys watch rows by bare id), and a stored
          // value that only works because a consumer happens to strip it is a
          // value waiting to be mis-compared.
          owner: String((r.owner && (r.owner.username || r.owner.id || r.owner.uri)) || r.ownerId || "").replace(/^spotify:user:/, ""),
          followers: r.followers != null ? r.followers : null,
          coverUrl: cover,
          coverHash: coverHashOf(cover),
          raw: r,
        };
      },
    },
    apiPlaylist: {
      fn: function (id) {
        return { method: "get", url: API + "/playlists/" + q(id) + "?market=from_token" };
      },
      parse: function (res) {
        var r = res || {};
        return {
          name: r.name || "",
          description: r.description || "",
          owner: (r.owner && (r.owner.id || r.owner.uri)) || "",
          followers: r.followers && r.followers.total != null ? r.followers.total : null,
          coverUrl: bestCover(r.images),
          // Hash the artwork, and nothing else. `snapshot_id` used to be folded
          // in, but it changes on ANY playlist edit — so every added or removed
          // track also changed the cover hash, and `evaluate`'s scalar diff
          // logged "cover changed" beside it. It also hashed `images[0]` while
          // `coverUrl` used bestCover, so the hash and the displayed image could
          // disagree; both now derive from the same chosen cover.
          coverHash: coverHashOf(bestCover(r.images)),
          raw: r,
        };
      },
    },
    embed: {
      fn: function (id) {
        return { method: "fetch", url: PUBLIC + "/embed/playlist/" + q(id), format: "text" };
      },
      /** Parse the embedded __NEXT_DATA__ JSON. Returns null when absent. */
      parse: function (html) {
        var text = html && (html.html || html.body || html);
        if (typeof text !== "string") text = String(text || "");
        var m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(text);
        if (!m) return null;
        var data;
        try {
          data = JSON.parse(m[1]);
        } catch (e) {
          return null;
        }
        var entity = data && data.props && data.props.pageProps && data.props.pageProps.state && data.props.pageProps.state.data
          ? data.props.pageProps.state.data.entity
          : null;
        if (!entity) return null;
        // `trackListFull` first: `trackList` is the short preview the embed page
        // renders, and preferring it meant a playlist with both lost every track
        // past the preview without the read ever being marked incomplete.
        var full = entity.trackListFull;
        var hasFull = Array.isArray(full) && full.length > 0;
        var list = (hasFull ? full : entity.trackList) || [];
        var uris = [];
        var added = {};
        for (var i = 0; i < list.length; i++) {
          var t = list[i] || {};
          var uri = t.uri || (t.id ? "spotify:track:" + t.id : "");
          if (!uri) continue;
          uris.push(uri);
          added[uri] = { addedAt: null, addedBy: "" };
        }
        // The page's own declared total is a stronger signal than the field name:
        // a list that matches it is complete however it was spelled, and a list
        // shorter than it is partial however confidently it was labelled. Both
        // tests are applied, so this decides `capped` from the payload rather
        // than from an assumption about which key a given build uses.
        var declared = entity.total != null ? entity.total : entity.trackCount != null ? entity.trackCount : null;
        var matchesDeclared = declared == null || declared === uris.length;
        return {
          name: entity.name || entity.title || "",
          owner: (entity.subtitle || "").replace(/^By\s+/i, ""),
          coverUrl: bestCover(entity.coverArt && entity.coverArt.sources),
          uris: uris,
          added: added,
          total: declared != null ? declared : list.length,
          // Removals need a read that can prove absence: a full list, or one
          // whose length matches the page's own declared total. A preview-only
          // read proves nothing, so it stays capped and reports no removals.
          capped: !(hasFull && matchesDeclared),
        };
      },
    },
    pathfinder: {
      // ONE hash covers fetchPlaylist/fetchPlaylistMetadata/fetchPlaylistContents;
      // the server picks the operation by name (verified in the 2026 web-player bundle).
      hash: "21ea11a6ac75a5f3e01fd365d29c18e0a4a8b7dc09f89bbb5d73910190c6acaf",
      pageSize: 100,
      fn: function (id, opts) {
        opts = opts || {};
        var vars = {
          enableWatchFeedEntrypoint: false,
          uri: "spotify:playlist:" + id,
        };
        if (opts.offset != null) {
          vars = {
            includeEpisodeContentRatingsV2: false,
            limit: opts.limit || 100,
            offset: opts.offset,
            uri: "spotify:playlist:" + id,
          };
        }
        var opName = opts.offset != null ? "fetchPlaylistContents" : "fetchPlaylistMetadata";
        // Use the client's own persisted-query definition when it ships one:
        // these hashes rotate and the hardcoded value goes stale (401).
        var liveHash = SOURCES.pathfinder.hash;
        try {
          var S = (typeof globalThis !== "undefined" ? globalThis : window).Spicetify;
          var defs = S && S.GraphQL && S.GraphQL.Definitions;
          var def = defs && (defs[opName] || defs[opName.charAt(0).toUpperCase() + opName.slice(1)]);
          if (def && def.sha256Hash) liveHash = def.sha256Hash;
        } catch (e) {
          /* keep the bundled hash */
        }
        return {
          method: "post",
          url: PARTNER + "/pathfinder/v2/query",
          body: {
            variables: vars,
            operationName: opName,
            extensions: { persistedQuery: { version: 1, sha256Hash: liveHash } },
          },
        };
      },
      parseMetadata: function (res) {
        var p = res && res.data && res.data.playlistV2;
        if (!p) return null;
        // An image entry carries `sources`; a payload whose first image has none
        // used to throw here and fail the whole route for a valid response.
        var img = p.images && p.images.items && p.images.items[0];
        var sources = (img && img.sources) || [];
        return {
          name: p.name || "",
          owner: (p.ownerV2 && (p.ownerV2.data && (p.ownerV2.data.username || p.ownerV2.data.uri))) || "",
          coverUrl: bestCover(sources),
          description: p.description || "",
          total: p.content && p.content.totalCount != null ? p.content.totalCount : null,
        };
      },
      parsePage: function (res) {
        var p = res && res.data && res.data.playlistV2;
        if (!p || !p.content) return null;
        var items = p.content.items || [];
        var uris = [];
        var added = {};
        for (var i = 0; i < items.length; i++) {
          var it = items[i] || {};
          var d = (it.itemV2 || {}).data || {};
          var uri = d.uri;
          if (!uri || String(uri).indexOf("spotify:track:") !== 0) continue;
          uris.push(uri);
          var addedAt = it.addedAt && it.addedAt.isoString ? Date.parse(it.addedAt.isoString) : null;
          var addedByData = (it.addedBy || {}).data || {};
          var addedBy = addedByData.username || addedByData.uri || "";
          added[uri] = { addedAt: addedAt, addedBy: String(addedBy).replace(/^spotify:user:/, "") };
        }
        // `items` is the count the caller must advance its offset by: it is how
        // many entries this page consumed, episodes and unavailable items
        // included. `uris.length` is tracks only, and advancing by that would
        // re-read the tail of every page.
        return { uris: uris, added: added, items: items.length, total: p.content.totalCount };
      },
    },
  };

  var ENDPOINTS = {
    // --------------------------------------------------------- profiles
    profile: function (userId, limits) {
      limits = limits || {};
      var l = function (k, d) {
        return limits[k] != null ? limits[k] : d;
      };
      return {
        method: "get",
        url:
          SPCLIENT + "/user-profile-view/v3/profile/" + q(userId) +
          "?playlist_limit=" + l("playlistLimit", 100) +
          "&artist_limit=" + l("artistLimit", 0) +
          "&episode_limit=" + l("episodeLimit", 10) +
          "&market=from_token",
      };
    },
    followers: function (userId) {
      return { method: "get", url: SPCLIENT + "/user-profile-view/v3/profile/" + q(userId) + "/followers?market=from_token" };
    },
    following: function (userId) {
      return { method: "get", url: SPCLIENT + "/user-profile-view/v3/profile/" + q(userId) + "/following?market=from_token" };
    },

    // --------------------------------------------------------- listening
    activityFeed: function () {
      return {
        method: "post",
        url: SPCLIENT + "/listening-activity/v1/feed",
        body: { unused: true, resultLimit: 100 },
      };
    },
    buddylist: function () {
      return { method: "get", url: "https://guc-spclient.spotify.com/presence-view/v1/buddylist" };
    },

    // --------------------------------------------------------- metadata
    playlistMetadata: function (id) {
      return { method: "get", url: SPCLIENT + "/playlist/v2/playlist/" + q(id) + "/metadata" };
    },
    /**
     * Track metadata through the client's own GraphQL (pathfinder). Unlike the
     * Web API this carries the client's session, is not the rate-limited
     * api.spotify.com route, and returns the real album cover. Returns null when
     * the client build has no GraphQL helper; callers fall back.
     */
    trackViaClient: function (trackUri) {
      var S = null;
      try {
        S = (typeof globalThis !== "undefined" ? globalThis : window).Spicetify;
      } catch (e) {
        S = null;
      }
      var Q = S && S.GraphQL;
      var def = Q && Q.Definitions && Q.Definitions.getTrack;
      if (!Q || !def || typeof Q.Request !== "function") return null;
      return { client: "graphql", def: def, vars: { uri: trackUri } };
    },
    track: function (id) {
      return { method: "get", url: API + "/tracks/" + q(id) + "?market=from_token" };
    },
    me: function () {
      return { method: "get", url: API + "/me" };
    },
    clientVersion: function () {
      return { method: "get", url: "sp://desktop/v1/version" };
    },
  };

  /** Normalise a listening-activity context so artist pages are not read as playlists. */
  function normalizeContext(ctx) {
    if (!ctx) return "";
    var s = String(ctx);
    var m = /^spotify:list:popular-release-segments-main-roles:artist_([A-Za-z0-9]{22,40})$/.exec(s);
    if (m) return "spotify:artist:" + m[1];
    return s;
  }

  /**
   * Normalise `listening-activity/v1/feed` output to
   * { userUri, trackUri, timestamp, isPlaying, contextUri } per the feed shape:
   * entities[].userEntity|followEntity { uri, activity { entityUri, timestamp, isPlaying, contextUri } }.
   * Biggest timestamp per user wins. Returns [] on an unexpected shape so the
   * caller can fall through to the buddylist.
   */
  function normalizeActivity(payload) {
    if (!payload || !Array.isArray(payload.entities)) return null;
    var byUser = {};
    for (var i = 0; i < payload.entities.length; i++) {
      var item = payload.entities[i] || {};
      var ent = item.userEntity || item.followEntity;
      if (!ent || !ent.uri || String(ent.uri).indexOf("spotify:user:") !== 0) continue;
      var act = ent.activity;
      if (!act) continue;
      var track = act.entityUri;
      if (!track || String(track).indexOf("spotify:track:") !== 0) continue;
      var tsv = act.timestamp ? Date.parse(act.timestamp) : NaN;
      if (!isFinite(tsv)) continue;
      if (byUser[ent.uri] && byUser[ent.uri].timestamp >= tsv) continue;
      byUser[ent.uri] = {
        userUri: String(ent.uri),
        userName: (ent.name || ent.username || "").trim(),
        avatar: (ent.image && (ent.image.url || ent.image)) || "",
        trackUri: String(track),
        timestamp: tsv,
        isPlaying: act.isPlaying !== false,
        contextUri: normalizeContext(act.contextUri || ""),
      };
    }
    return Object.keys(byUser).map(function (k) {
      return byUser[k];
    });
  }

  /** Legacy buddylist shape -> the same normalised records (timestamp in ms). */
  function normalizeBuddylist(payload) {
    var friends = payload && Array.isArray(payload.friends) ? payload.friends : null;
    if (!friends) return null;
    var out = [];
    for (var i = 0; i < friends.length; i++) {
      var f = friends[i] || {};
      var user = f.user || {};
      if (!user.uri || String(user.uri).indexOf("spotify:user:") !== 0) continue;
      var track = f.track || {};
      var t = f.timestamp != null ? Number(f.timestamp) : NaN;
      if (!track.uri || !isFinite(t)) continue;
      out.push({
        userUri: String(user.uri),
        userName: user.name || "",
        avatar: user.image && (user.image.url || user.image) ? user.image.url || user.image : "",
        trackUri: String(track.uri),
        timestamp: t,
        // Only assert "playing" when the payload says so. The legacy buddylist
        // carries no play/pause flag, and this used to hardcode `true`, which
        // made `session.apply` treat every record as a resume: a pause was never
        // observed, so `resumed` never fired and a pause/resume cycle was never
        // recorded. `undefined` means "unknown", and session's `!!` keeps the
        // last known state instead of inventing one.
        isPlaying: f.isPlaying != null ? !!f.isPlaying : f.playing != null ? !!f.playing : undefined,
        contextUri: normalizeContext((track.artist && track.artist.uri) || ""),
      });
    }
    return out;
  }

  return {
    SOURCES: SOURCES,
    ENDPOINTS: ENDPOINTS,
    normalizeActivity: normalizeActivity,
    normalizeBuddylist: normalizeBuddylist,
    // Shared so every route picks a cover the same way instead of guessing at
    // the array's order (see the profile view, which also uses it).
    bestCover: bestCover,
  };
});
