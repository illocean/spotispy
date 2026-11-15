/* eslint-disable */
/**
 * Spotispy â€” artwork layer.
 *
 * Every Spotify entity the app renders (track/playlist/artist/album row,
 * profile, friend in the activity feed) can have its real artwork fetched
 * from Spotify and cached locally (meta key "art:<uri>") by the sweep that
 * runs after scans. Views read the cache as a fallback when the stored row
 * has no image. The sweep is best effort and never breaks a scan; the
 * global PWT_ART_DISABLED disables it entirely (tests, harness).
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.art = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function P() {
    return root.PWT;
  }

  /** Embed-page spec for track/playlist/artist/album, or null for anything else. */
  function specEmbed(uri) {
    if (root.PWT_ART_DISABLED) return null;
    var m = /^spotify:(track|playlist|artist|album):([A-Za-z0-9]{22,40})$/.exec(uri || "");
    if (!m) return null;
    return { method: "fetch", url: "https://open.spotify.com/embed/" + m[1] + "/" + m[2], format: "text" };
  }

  /**
   * Pull the artwork URL out of an embed page's __NEXT_DATA__ blob.
   * Preference order: largest visualIdentity.image; then the last coverArt
   * array entry; then the last coverArt.sources entry; else null. Never throws.
   */
  function parseArtResponse(html) {
    try {
      var m = /<script[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html || "");
      if (!m) return null;
      var data = JSON.parse(m[1]);
      var cur = data;
      var keys = ["props", "pageProps", "state", "data", "entity"];
      for (var i = 0; i < keys.length; i++) {
        if (!cur || typeof cur !== "object") return null;
        cur = cur[keys[i]];
      }
      var entity = cur;
      if (!entity || typeof entity !== "object") return null;
      var imgs = entity.visualIdentity && entity.visualIdentity.image;
      if (Array.isArray(imgs) && imgs.length) {
        var best = null;
        for (var j = 0; j < imgs.length; j++) {
          var im = imgs[j];
          if (!im || !im.url) continue;
          if (!best) {
            best = im;
            continue;
          }
          var w = Number(im.maxWidth) || 0;
          var bw = Number(best.maxWidth) || 0;
          if (w > bw) best = im;
        }
        if (best && best.url) return best.url;
        for (var k = 0; k < imgs.length; k++) if (imgs[k] && imgs[k].url) return imgs[k].url;
      }
      var cover = entity.coverArt;
      if (Array.isArray(cover) && cover.length) {
        // A bare coverArt array carries no width or label, so the embed page's
        // own order (largest last) is the only signal there is. This is a
        // fallback: the scored `visualIdentity.image` path above runs first.
        for (var c = cover.length - 1; c >= 0; c--) {
          var last = cover[c];
          if (last && last.url) return last.url;
          if (typeof last === "string" && last) return last;
        }
        return null;
      }
      if (cover && Array.isArray(cover.sources) && cover.sources.length) {
        // Same: an unsized sources array, so the last entry is the largest.
        var lastSrc = cover.sources[cover.sources.length - 1];
        return (lastSrc && lastSrc.url) || null;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /** The embed page: works where open.spotify.com is reachable, absent elsewhere. */
  async function embedArt(uri, pwt, deps) {
    var net = (deps && deps.net) || (pwt && pwt.net);
    var spec = specEmbed(uri);
    if (!spec || !net) return "";
    try {
      var html = await net.call(spec);
      return parseArtResponse(html) || "";
    } catch (e) {
      return "";
    }
  }

  /**
   * Track art: the client's own GraphQL (album of track coverArt), which does
   * not depend on the embed page or the Web API. Falls back to the embed page
   * on clients that expose nothing else.
   */
  async function trackArt(uri, pwt, deps) {
    var net = (deps && deps.net) || (pwt && pwt.net);
    var endpoints = pwt && pwt.sources && pwt.sources.ENDPOINTS;
    var spec = endpoints && endpoints.trackViaClient ? endpoints.trackViaClient(uri) : null;
    if (!spec || !net || !net.call) return "";
    try {
      var g = await net.call(spec);
      var t = g && g.data && g.data.trackUnion;
      var sources = t && t.albumOfTrack && t.albumOfTrack.coverArt && t.albumOfTrack.coverArt.sources;
      if (!Array.isArray(sources) || !sources.length) return "";
      var best = sources.slice().sort(function (a, b) {
        return (b.width || 0) - (a.width || 0);
      })[0];
      return (best && best.url) || "";
    } catch (e) {
      return "";
    }
  }

  /**
   * A watched playlist's cover comes free with the profile route, which this
   * client answers (the mosaic refs it carries resolve through imageUrl). Read
   * what is already stored instead of touching the network.
   */
  async function playlistCover(id, pwt, deps) {
    var db = (deps && deps.db) || (pwt && pwt.db);
    if (!db || !db.getAll) return "";
    try {
      var profiles = await db.getAll("profiles");
      var wanted = "spotify:playlist:" + id;
      for (var i = 0; i < profiles.length; i++) {
        var plays = profiles[i] && profiles[i].plays;
        if (!Array.isArray(plays)) continue;
        for (var j = 0; j < plays.length; j++) {
          var p = plays[j];
          if (!p || String(p.uri) !== wanted || !p.cover) continue;
          var u = pwt && pwt.util && pwt.util.imageUrl ? pwt.util.imageUrl(p.cover) : p.cover;
          if (u) return u;
        }
      }
    } catch (e) {
      /* no stored profile data */
    }
    return "";
  }

  /**
   * Resolve art for a Spotify URI ("spotify:user:<22>" or the specEmbed kinds).
   * Successful fetches are cached forever; negative caching only gates retries
   * of missing art (3 attempts). Never throws; returns "" when nothing is found.
   */
  async function artFor(uri, deps) {
    if (root.PWT_ART_DISABLED) return "";
    try {
      if (!uri) return "";
      var store = (deps && deps.store) || (root.PWT && root.PWT.store);
      var net = (deps && deps.net) || (root.PWT && root.PWT.net);
      var meta = null;
      try {
        meta = store && store.getMeta ? await store.getMeta("art:" + uri, null) : null;
      } catch (e) {
        meta = null;
      }
      if (meta && typeof meta.url === "string" && meta.url) return meta.url;
      // A cached spotify:image:/spotify:mosaic: ref is real artwork: the client
      // converts it to https://i.scdn.co/image/<hash>, no fetch needed.
      if (meta && typeof meta.ref === "string" && meta.ref) {
        var pwtU = (root.PWT && root.PWT.util) || null;
        var refUrl = pwtU && pwtU.imageUrl ? pwtU.imageUrl(meta.ref) : "";
        if (refUrl) return refUrl;
      }
      var attempts = meta && typeof meta.attempts === "number" ? meta.attempts : 0;
      // Cached negatives from before the current resolver strategy: one fresh
      // attempt, then the counter behaves as usual. Version 4 = the profile
      // display-name/avatar parse fix, so URIs cached as negative before it get
      // one retry with the corrected resolver.
      var CURRENT_ART_V = 4;
      var freshAttempt = !meta || meta.v !== CURRENT_ART_V;
      if (freshAttempt) attempts = 0;
      // A URI that keeps failing stops consuming network after 6 tries; the next
      // CURRENT_ART_V bump gives it one again.
      if (attempts >= 6) return "";
      var url = "";
      try {
        var pwt = root.PWT || {};
        var userMatch = /^spotify:user:([A-Za-z0-9]{22,40})$/.exec(uri);
        var trackMatch = /^spotify:track:([A-Za-z0-9]{22,40})$/.exec(uri);
        var playlistMatch = /^spotify:playlist:([A-Za-z0-9]{22,40})$/.exec(uri);
        if (userMatch && pwt.sources && pwt.profiles) {
          if (attempts < 3) {
            var res = await net.call(pwt.sources.ENDPOINTS.profile(userMatch[1], { playlistLimit: 1, artistLimit: 0, episodeLimit: 0 }));
            // The endpoint answers with an error body (with or without a message) when the profile is unavailable; parseProfile would invent an empty profile. A transport failure is reported unreachable, not as a status.
            var profileBodyError = net.bodyError ? net.bodyError(res) : null;
            if (profileBodyError) throw new Error(net.bodyErrorMessage("profile", profileBodyError));
            var parsed = pwt.profiles.parseProfile(res);
            url = (parsed && parsed.avatarUrl) || "";
          }
        } else if (trackMatch) {
          url = await trackArt(uri, pwt, deps);
          if (!url && attempts < 3) url = await embedArt(uri, pwt, deps);
        } else if (playlistMatch) {
          url = await playlistCover(playlistMatch[1], pwt, deps);
          if (!url && attempts < 3) url = await embedArt(uri, pwt, deps);
        } else if (attempts < 3) {
          url = await embedArt(uri, pwt, deps);
        }
      } catch (e2) {
        url = "";
      }
      try {
        if (store && store.setMeta) {
          await store.setMeta(
            "art:" + uri,
            url
              ? { url: url, at: Date.now(), attempts: 0, v: CURRENT_ART_V }
              : { url: "", at: Date.now(), attempts: Math.min(attempts + 1, 10), v: CURRENT_ART_V }
          );
        }
      } catch (e3) {
        /* cache write is best effort */
      }
      return url;
    } catch (e4) {
      return "";
    }
  }

  /**
   * Fill the art cache for the gaps the app has: tracks with no art (row gets
   * it merged back in), playlists/profiles/activityName meta rows with no art
   * (meta only, views read the cache as fallback).
   * @returns {{ checked?: number, filled?: number, skipped?: boolean }}
   */
  async function sweep(deps, opts) {
    if (root.PWT_ART_DISABLED) return { skipped: true };
    try {
      var limit = Math.max(0, Math.min(opts && opts.limit != null ? opts.limit : 30, 50));
      if (limit === 0) return { checked: 0, filled: 0, skipped: true };
      var pwt = root.PWT || {};
      var db = (deps && deps.db) || pwt.db;
      var store = (deps && deps.store) || pwt.store;
      if (!db || !store) return { skipped: true };
      var gaps = [];
      var tracks = [];
      try {
        tracks = (await db.getAll("tracks")) || [];
      } catch (e) {
        tracks = [];
      }
      for (var i = 0; i < tracks.length; i++) {
        var t = tracks[i];
        if (t && t.uri && !t.art) gaps.push({ kind: "track", uri: t.uri, at: t.fetchedAt || t.lastSyncedAt || 0 });
      }
      var playlists = [];
      try {
        playlists = (await db.getAll("playlists")) || [];
      } catch (e2) {
        playlists = [];
      }
      for (var j = 0; j < playlists.length; j++) {
        var pl = playlists[j];
        if (pl && pl.id && !pl.coverUrl) gaps.push({ kind: "playlist", id: pl.id, uri: "spotify:playlist:" + pl.id, at: pl.lastSyncedAt || pl.fetchedAt || 0 });
      }
      var profiles = [];
      try {
        profiles = (await db.getAll("profiles")) || [];
      } catch (e3) {
        profiles = [];
      }
      for (var k = 0; k < profiles.length; k++) {
        var p = profiles[k];
        if (p && p.id && !p.avatarUrl) gaps.push({ kind: "profile", id: p.id, uri: "spotify:user:" + p.id, at: p.lastSyncedAt || p.fetchedAt || 0 });
      }
      var metaRows = [];
      try {
        metaRows = (await db.getAll("meta")) || [];
      } catch (e4) {
        metaRows = [];
      }
      for (var m = 0; m < metaRows.length; m++) {
        var row = metaRows[m];
        if (!row || !row.key || row.key.indexOf("activityName:") !== 0) continue;
        var value = row.value || {};
        if (value.avatar) continue;
        var uid = row.key.slice("activityName:".length);
        gaps.push({ kind: "activityName", uri: "spotify:user:" + uid, key: row.key, value: value, at: value.at || 0 });
      }
      gaps.sort(function (a, b) {
        return a.at - b.at;
      });
      gaps = gaps.slice(0, limit);
      var filled = 0;
      var out = await pwt.net.pool(
        gaps,
        3,
        async function (gap) {
          try {
            var url = await artFor(gap.uri, deps);
            if (!url) return false;
            if (gap.kind === "track") {
              try {
                var fresh = await db.get("tracks", gap.uri);
                if (!fresh || fresh.art) return false;
                await db.put("tracks", Object.assign({}, fresh, { art: url }));
                return true;
              } catch (e5) {
                return false; /* persist did not happen */
              }
            }
            if (gap.kind === "activityName") {
              try {
                var freshMeta = null;
                try {
                  var rawMeta = await db.get("meta", gap.key);
                  freshMeta = rawMeta && rawMeta.value !== undefined ? rawMeta.value : null;
                } catch (e6) {
                  freshMeta = null;
                }
                var base = freshMeta || gap.value || {};
                await store.setMeta(gap.key, Object.assign({}, base, { avatar: url, uri: (base && base.uri) || (gap.value && gap.value.uri) }));
              } catch (e7) {
                /* meta write-back is best effort; art is still cached by artFor */
              }
              return true;
            }
            // Playlists and profiles: artFor caches the URL under `meta:art:`,
            // but the GAP is a missing field on the entity row. Write it back
            // or the same row is re-fetched on every sweep forever, starving
            // the newer gaps behind it in the `at`-sorted, `limit`-sliced list.
            var storeName = gap.kind === "playlist" ? "playlists" : "profiles";
            var field = gap.kind === "playlist" ? "coverUrl" : "avatarUrl";
            try {
              var freshRow = await db.get(storeName, gap.id);
              // Only fill a row that is still missing it: a scan may have
              // resolved the cover in the meantime, and that answer wins.
              if (!freshRow || freshRow[field]) return false;
              var patch = {};
              patch[field] = url;
              await db.put(storeName, Object.assign({}, freshRow, patch));
              return true;
            } catch (e9) {
              return false; /* the row is gone or the write failed */
            }
          } catch (e8) {
            return false;
          }
        },
        null,
        250
      );
      for (var r = 0; r < out.results.length; r++) if (out.results[r] && out.results[r].ok && out.results[r].value) filled++;
      return { checked: gaps.length, filled: filled };
    } catch (e8) {
      return { skipped: true };
    }
  }

  return {
    specEmbed: specEmbed,
    parseArtResponse: parseArtResponse,
    artFor: artFor,
    sweep: sweep,
  };
});
