/* eslint-disable */
/**
 * Spotispy ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â app controller.
 *
 * Loads everything a view needs from IndexedDB into one model, keeps it fresh on
 * scheduler progress and on a light page-visibility poll, and exposes the
 * callbacks each route calls. Rendering is delegated to `PWT.ui.App`.
 */
(function (root, factory) {
  root.PWT = root.PWT || {};
  root.PWT.ui = root.PWT.ui || {};
  root.PWT.ui.AppController = factory(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var VERSION = "1.0.0";

  function Controller(props) {
    var P = root.PWT;
    var h = P.react.h;
    var hooks = P.react.hooks();
    var useState = hooks.useState;
    var useRef = hooks.useRef;
    var useEffect = hooks.useEffect;

    var initialRoute = (props && props.route) || initialFromHistory() || "overview";
    var routeState = useState(initialRoute);
    var route = routeState[0];
    var setRoute = routeState[1];
    // Every navigation bumps the epoch, so a revisit of the same route still
    // reloads its data.
    var routeEpochState = useState(0);
    var routeEpoch = routeEpochState[0];
    var setRouteEpoch = routeEpochState[1];
    var modelState = useState({ ready: false, route: route, scan: {}, watches: [], addState: {} });
    var model = modelState[0];
    var setModel = modelState[1];
    // The log filters by change kind; the playlist filters by added/removed.
    // They are different things, so they get different slots.
    var filterState = useState({ query: "", kind: "", level: "" });
    var filter = filterState[0];
    var setFilter = filterState[1];
    var playlistFilterState = useState({ kind: "", query: "" });
    var playlistFilter = playlistFilterState[0];
    var setPlaylistFilter = playlistFilterState[1];
    var activityFilterState = useState({ query: "" });
    var activityFilter = activityFilterState[0];
    var setActivityFilter = activityFilterState[1];
    var addState = useState({ playlist: "", profile: "", error: "" });
    var add = addState[0];
    var setAdd = addState[1];
    var routeRef = useRef(route);
    routeRef.current = route;
    var lastScanSeenRef = useRef(0);
    var lastCrashSeenRef = useRef(0);
    var filterRef = useRef(filter);
    filterRef.current = filter;
    var playlistFilterRef = useRef(playlistFilter);
    playlistFilterRef.current = playlistFilter;
    var activityFilterRef = useRef(activityFilter);
    activityFilterRef.current = activityFilter;
    var playlistIdRef = useRef("");
    // The selected person and the open playlist outlive a route change.
    var selectedRef = useRef(null);
    var diagState = useState({ running: false, result: null });
    var diag = diagState[0];
    var setDiag = diagState[1];

    /**
     * Switch routes and drop the previous route's payload. Without the reset,
     * the new route can briefly render with the OLD route's `model`/`vm`
     * (different shapes) ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â which is how the Activity view used to throw and
     * take the whole React tree down with it.
     *
     * The selection and the open playlist live in refs, not in the model, so
     * they survive the reset: navigating away and back keeps the same person
     * and the same playlist selected.
     */
    function goRoute(next) {
      setModel(function (m) {
        return Object.assign({}, m, {
          model: undefined,
          vm: undefined,
          rows: undefined,
          watches: undefined,
          error: undefined,
          liveNow: undefined,
          loading: true,
        });
      });
      setRoute(next);
      // Bump the epoch so the route effect re-runs even when the route itself
      // did not change (revisiting the current page must reload it, not leave
      // it on "Loadingâ€¦" forever).
      setRouteEpoch(function (e) {
        return e + 1;
      });
    }

    function navigate(next, opts) {
      var state = Object.assign({ pathname: "/Spotispy/" + (next === "overview" ? "" : next), state: { route: next } }, (opts && opts.state) || {});
      if (opts && opts.state && opts.state.playlistId) {
        playlistIdRef.current = opts.state.playlistId;
        setModel(function (m) {
          return Object.assign({}, m, { playlistId: opts.state.playlistId });
        });
      }
      try {
        if (root.Spicetify && root.Spicetify.Platform && root.Spicetify.Platform.History && (!opts || opts.push !== false)) {
          navPush(state.pathname);
          root.Spicetify.Platform.History.push(state);
          goRoute(next);
          return;
        }
      } catch (e) {
        /* ignore: routing still updates local state */
      }
      navPush(state.pathname);
      goRoute(next);
    }

    /** XPUI history back/forward, across the builds we meet (history v4- and v5-style). */
    function historyApi() {
      var H = null;
      try {
        H = root.Spicetify && root.Spicetify.Platform && root.Spicetify.Platform.History;
      } catch (e) {
        H = null;
      }
      if (!H) return null;
      if (typeof H.goBack === "function") {
        return {
          back: function () { H.goBack(); },
          forward: function () {
            if (typeof H.goForward === "function") H.goForward();
            else if (typeof H.forward === "function") H.forward();
            else if (typeof H.go === "function") H.go(1);
          },
        };
      }
      if (typeof H.back === "function") {
        return {
          back: function () { H.back(); },
          forward: function () {
            if (typeof H.forward === "function") H.forward();
            else if (typeof H.go === "function") H.go(1);
          },
        };
      }
      if (typeof H.go === "function") {
        return {
          back: function () { H.go(-1); },
          forward: function () { H.go(1); },
        };
      }
      return null;
    }

    /**
     * The app's own history stack. The client's history is shared with the rest
     * of Spotify, so "can I go back?" is answered from what WE navigated:
     * a stack of the routes we visited, with a pointer at the current one.
     * It lives in a ref: the component body runs again on every render.
     */
    var navStackRef = useRef({ entries: [], index: -1 });

    function navPush(pathname) {
      var navStack = navStackRef.current;
      var i = navStack.entries.indexOf(pathname);
      if (i >= 0 && i === navStack.index) return;
      navStack.entries = navStack.entries.slice(0, navStack.index + 1);
      navStack.entries.push(pathname);
      navStack.index = navStack.entries.length - 1;
    }

    function navSync(pathname) {
      // The client moved the history (back/forward): find where we are.
      var navStack = navStackRef.current;
      var i = navStack.entries.indexOf(pathname);
      if (i >= 0) navStack.index = i;
    }

    function hud() {
      var nav = historyApi();
      if (!nav) return { onBack: undefined, onForward: undefined, canGoBack: false, canGoForward: false };
      var navStack = navStackRef.current;
      var wrap = function (label, fn) {
        return function () {
          try {
            fn();
          } catch (e) {
            reportError(label, e);
          }
        };
      };
      return {
        onBack: wrap("go back", nav.back),
        onForward: wrap("go forward", nav.forward),
        canGoBack: navStack.index > 0,
        canGoForward: navStack.index >= 0 && navStack.index < navStack.entries.length - 1,
      };
    }

    /** A visible failure, not an unhandled rejection. Never throws. */
    function reportError(where, e) {
      var message = String((e && (e.message || e)) || e).split("\n")[0];
      try {
        if (P.telemetry && P.telemetry.captureError) P.telemetry.captureError("ui." + where, e);
      } catch (e2) {
        /* telemetry is best effort */
      }
      try {
        if (P.notify && P.notify.toast) P.notify.toast("Spotispy: " + where + " failed ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â " + message);
      } catch (e3) {
        /* no toast channel; the ribbon/console carries the detail */
      }
      root.console && root.console.error && root.console.error("[Spotispy] " + where + ":", e);
    }

    /** Wrap an async UI action so a failure surfaces instead of vanishing. */
    function guard(where, fn) {
      return function () {
        var self = this;
        var args = arguments;
        return Promise.resolve()
          .then(function () {
            return fn.apply(self, args);
          })
          .catch(function (e) {
            reportError(where, e);
          });
      };
    }

    /** Read cached art URLs ("art:<uri>") from meta; fetch what the cache lacks. */
    async function artFallback(uris) {
      var store = P.store;
      var out = {};
      var seen = {};
      var misses = [];
      for (var i = 0; i < (uris || []).length; i++) {
        var key = uris[i];
        if (!key || seen[key]) continue;
        seen[key] = true;
        try {
          var meta = await store.getMeta("art:" + key, null);
          if (meta && meta.url) {
            out[key] = meta.url;
            continue;
          }
          // A cached spotify:image:/mosaic: ref is real artwork, already local.
          if (meta && typeof meta.ref === "string" && meta.ref && P.util && P.util.imageUrl) {
            var refUrl = P.util.imageUrl(meta.ref);
            if (refUrl) {
              out[key] = refUrl;
              continue;
            }
          }
        } catch (e) {
          /* decorative only */
        }
        misses.push(key);
      }
      // A miss is not an answer: ask the art layer (it knows the routes that
      // work on this client and negative-caches the ones that don't). Cached
      // gaps resolve concurrently; the batch is capped so a page load can't
      // stall on artwork.
      if (P.art && P.art.artFor) {
        await Promise.all(
          misses.slice(0, 12).map(async function (key) {
            try {
              var fetched = await P.art.artFor(key, { db: P.db, store: P.store, net: P.net });
              if (fetched) out[key] = fetched;
            } catch (eArt) {
              /* decorative only */
            }
          })
        );
      }
      return out;
    }

    /**
     * Ids of the people currently playing, taken from the listening-activity
     * feed. The feed is already scoped to this account's friends by the
     * client, so no second (undocumented) friend list is needed.
     */
    function liveNowIds() {
      var out = [];
      try {
        var records = (P.bus && P.bus.activityRecords) || [];
        for (var i = 0; i < records.length; i++) {
          var r = records[i];
          if (!r || r.isPlaying === false) continue;
          var id = String(r.userUri || "").replace(/^spotify:user:/, "");
          if (id) out.push(id);
        }
      } catch (e) {
        /* presence is decorative; the activity feed is the source of truth */
      }
      return out;
    }

    /** A copy of the bus for the UI: state only, never the listener array. */
    function busSnapshot() {
      var bus = P.bus;
      if (!bus) return {};
      var out = {};
      for (var k in bus) {
        if (!Object.prototype.hasOwnProperty.call(bus, k)) continue;
        if (k === "listeners" || typeof bus[k] === "function") continue;
        out[k] = bus[k];
      }
      return out;
    }

    /** Load everything the current route needs. */
    async function load(routeName, extra) {
      var pwt = P;
      var db = pwt.db;
      var store = pwt.store;
      var u = pwt.util;
      var vm = pwt.view;
      var now = Date.now();
      var __tLoad = Date.now();
      var out = { ready: true, route: routeName, scan: busSnapshot() };
      // Profile names get the id-shape guard: stored rows written before the
      // parse fix can carry the raw user code as the name. Playlist names are
      // NOT filtered — they can legitimately be long alnum.
      var ID_SHAPED = /^[A-Za-z0-9]{22,}$/;
      var profileName = function (n) {
        var s = String(n || "").trim();
        return s && !ID_SHAPED.test(s) ? s : "";
      };
      try {
        out.addState = { playlist: add.playlist, profile: add.profile, error: "" };
        if (routeName === "overview" || routeName === "log") {
          var daily = await store.dailyTotals(null, u.lastDays(30, now)[0]);
          var recent = await store.recentChanges(routeName === "log" ? 5000 : 200);
          var profilesAll = (await db.getAll("profiles")) || [];
          var playlistsAll = (await db.getAll("playlists")) || [];
          out.profiles = profilesAll;
          out.playlists = playlistsAll;
          var displayOf = {};
          var imageOf = {};
          // Names and images are normalised here, once: the views never see a
          // raw id as a label or a spotify:image:/spotify:mosaic: ref as a URL.
          var imgUrl = function (ref) {
            return u.imageUrl ? u.imageUrl(ref) : ref || "";
          };
          // Profile names get the id-shape guard via the load-scoped
          // profileName helper above; playlist names are never filtered.
          profilesAll.forEach(function (p) {
            var pn = profileName(p.name);
            if (pn) displayOf[p.id] = pn;
            imageOf[p.id] = imgUrl(p.avatarUrl);
          });
          playlistsAll.forEach(function (pl) {
            if (pl.name) displayOf[pl.id] = pl.name;
            imageOf[pl.id] = imgUrl(pl.coverUrl);
            if (pl.ownerId && displayOf[pl.ownerId] === undefined) displayOf[pl.ownerId] = "";
          });
          // Change rows point at a playlist/user id; give each target a name
          // from anything we know (watched row, playlist owner, activity name).
          try {
            var nameRows = (await db.getAll("meta")) || [];
            for (var nr = 0; nr < nameRows.length; nr++) {
              var nrow = nameRows[nr];
              if (!nrow || !nrow.key || nrow.key.indexOf("activityName:") !== 0) continue;
              var nid = nrow.key.slice("activityName:".length);
              var an = nrow.value && nrow.value.name ? profileName(nrow.value.name) : "";
              if (!displayOf[nid] && an) displayOf[nid] = an;
            }
          } catch (eNames) {
            /* names are cosmetic; a miss falls back below */
          }
          // Track art for the first rows so the feed leads with images.
          var artOf = {};
          var titleOf = {};
          var artUris = [];
          for (var ai = 0; ai < recent.length && artUris.length < 40; ai++) {
            var auri = recent[ai].uri;
            if (auri && String(auri).indexOf("spotify:track:") === 0 && artUris.indexOf(auri) < 0) artUris.push(auri);
          }
          for (var aj = 0; aj < artUris.length; aj++) {
            try {
              var trow = await db.get("tracks", artUris[aj]);
              if (trow && trow.art) artOf[artUris[aj]] = trow.art;
              if (trow && trow.title) titleOf[artUris[aj]] = trow.title;
            } catch (artErr) {
              /* art is decorative; a miss must not break the feed */
            }
          }
          // Meta art cache fills what Spotify never supplied (art:<uri>).
          var artMissing = [];
          profilesAll.forEach(function (p) {
            if (!imageOf[p.id]) artMissing.push("spotify:user:" + p.id);
          });
          playlistsAll.forEach(function (pl) {
            if (!imageOf[pl.id]) artMissing.push("spotify:playlist:" + pl.id);
          });
          for (var am = 0; am < artUris.length; am++) if (!artOf[artUris[am]]) artMissing.push(artUris[am]);
          if (artMissing.length) {
            var artMap = await artFallback(artMissing);
            profilesAll.forEach(function (p) {
              if (!imageOf[p.id] && artMap["spotify:user:" + p.id]) imageOf[p.id] = artMap["spotify:user:" + p.id];
            });
            playlistsAll.forEach(function (pl) {
              if (!imageOf[pl.id] && artMap["spotify:playlist:" + pl.id]) imageOf[pl.id] = artMap["spotify:playlist:" + pl.id];
            });
            for (var am2 = 0; am2 < artUris.length; am2++) {
              if (!artOf[artUris[am2]] && artMap[artUris[am2]]) artOf[artUris[am2]] = artMap[artUris[am2]];
            }
          }
          // Clone rows with any resolved art so the vm sees real covers.
          profilesAll = profilesAll.map(function (p) {
            var clone = Object.assign({}, p);
            if (!clone.avatarUrl && imageOf[p.id]) clone.avatarUrl = imageOf[p.id];
            if (Array.isArray(p.plays)) {
              clone.plays = p.plays.map(function (x) {
                if (!x || x.cover || !x.uri) return x;
                var pid = String(x.uri).split(":")[2];
                var url = pid && imageOf[pid];
                return url ? Object.assign({}, x, { cover: url }) : x;
              });
            }
            return clone;
          });
          playlistsAll = playlistsAll.map(function (pl) {
            return pl.coverUrl || !imageOf[pl.id] ? pl : Object.assign({}, pl, { coverUrl: imageOf[pl.id] });
          });
          out.profiles = profilesAll;
          out.playlists = playlistsAll;
          recent = (recent || []).map(function (r) {
            var img = "";
            if (r.uri && artOf[r.uri]) img = artOf[r.uri];
            else if (imageOf[r.target]) img = imageOf[r.target];
            // A user row shows the person's name; never their id. A stored title
            // from before the id fixes can still be a bare token, so it is
            // id-shape-checked here, once.
            var name = displayOf[r.target];
            if (!name) {
              var head = String(r.title || "");
              name = head.length <= 40 && !ID_SHAPED.test(head) ? head : "";
            }
            return Object.assign({}, r, {
              display: name || "",
              targetName: name || "",
              image: imgUrl(img),
              trackTitle: r.uri ? titleOf[r.uri] || "" : "",
            });
          });
          var lastResult = (await store.getMeta("lastScanResult", null)) || null;
          var allWatches = (await store.listWatches()) || [];
          out.dashboard = {
            profiles: profilesAll,
            playlists: playlistsAll,
            watches: allWatches,
            recent: recent,
            daily: daily,
            lastScanAt: (await store.getMeta("lastScanAt", 0)) || 0,
            nextScanAt: pwt.bus ? pwt.bus.nextScanAt : 0,
            lastScanTotals: lastResult && lastResult.totals,
            lastScanResult: lastResult,
            scan: busSnapshot(),
          };
          out.vm = { dashboard: out.dashboard };
          out.liveNow = liveNowIds();
          if (routeName === "log") {
            out.rows = vm.filterChanges(recent || [], filterRef.current.query, filterRef.current.kind, filterRef.current.level);
          }
        }
        if (routeName === "profiles") {
          var profiles = (await db.getAll("profiles")) || [];
          var allPlaylists = (await db.getAll("playlists")) || [];
          var watchRows = (await store.listWatches("profile")) || [];
          // The roster is the watch list: rows from watches since removed are not people to show.
          var watchedIds = {};
          watchRows.forEach(function (w) { watchedIds[w.id] = true; });
          profiles = profiles.filter(function (p) { return !!p && !!watchedIds[p.id]; });
          var watchedAtById = {};
          watchRows.forEach(function (w) {
            watchedAtById[w.id] = w.addedAt || 0;
          });
          var avatarOf = {};
          var imgUrl2 = function (ref) {
            return u.imageUrl ? u.imageUrl(ref) : ref || "";
          };
          var imgUrlS = imgUrl2;
          profiles.forEach(function (p) {
            avatarOf[p.id] = imgUrl2(p.avatarUrl);
          });
          allPlaylists.forEach(function (pl) {
            avatarOf[pl.id] = imgUrl2(pl.coverUrl);
          });
          var profileMissing = [];
          profiles.forEach(function (p) {
            if (!avatarOf[p.id]) profileMissing.push("spotify:user:" + p.id);
          });
          allPlaylists.forEach(function (pl) {
            if (!avatarOf[pl.id]) profileMissing.push("spotify:playlist:" + pl.id);
          });
          if (profileMissing.length) {
            var artMapP = await artFallback(profileMissing);
            profiles.forEach(function (p) {
              if (!avatarOf[p.id] && artMapP["spotify:user:" + p.id]) avatarOf[p.id] = artMapP["spotify:user:" + p.id];
            });
            allPlaylists.forEach(function (pl) {
              if (!avatarOf[pl.id] && artMapP["spotify:playlist:" + pl.id]) avatarOf[pl.id] = artMapP["spotify:playlist:" + pl.id];
            });
          }
          var rows = [];
          for (var i = 0; i < profiles.length; i++) {
            var changes = await store.changesFor("profile:" + profiles[i].id, 400);
            var byName = changes
              .concat(await store.changesFor(profiles[i].id, 400))
              .map(function (c) {
                return Object.assign({}, c, {
                  display: profiles[i].name || "",
                  targetName: profiles[i].name || "",
                  image: avatarOf[c.target] || avatarOf[profiles[i].id] || "",
                });
              })
              .sort(function (a, b) {
                return b.ts - a.ts;
              });
            var baseRow = Object.assign({ watchedAt: watchedAtById[profiles[i].id] || 0 }, profiles[i]);
            if (!baseRow.avatarUrl && avatarOf[profiles[i].id]) baseRow.avatarUrl = avatarOf[profiles[i].id];
            baseRow.avatarUrl = imgUrlS(baseRow.avatarUrl);
            rows.push(
              Object.assign(vm.profileRow(baseRow, allPlaylists, byName, now), {
                followerHistory: (await followerHistory(profiles[i].id)) || [],
              })
            );
          }
          out.model = { rows: rows, selected: (extra && extra.selected) || selectedRef.current || null };
          if (out.model.selected) selectedRef.current = out.model.selected;
        }
        if (routeName === "playlist") {
          var id = (extra && extra.playlistId) || playlistIdRef.current || (props.initial && props.initial.playlistId) || (await store.listWatches("playlist"))[0];
          if (id) playlistIdRef.current = id;
          id = typeof id === "object" && id ? id.id : id;
          if (id) {
            var row = await db.get("playlists", id);
            if ((!row || !row.coverUrl) && id) {
              var artMapPL = await artFallback(["spotify:playlist:" + id]);
              var artUrlPL = artMapPL["spotify:playlist:" + id];
              if (artUrlPL) row = Object.assign({}, row || { id: id, name: "Untitled playlist" }, { coverUrl: artUrlPL });
            }
          var snap = await db.get("snapshots", id);
          // The rows for the log want the same display-name treatment.
          var logDisplayOf = {};
          ((await db.getAll("playlists")) || []).forEach(function (pl) { if (pl.name) logDisplayOf[pl.id] = pl.name; });
          ((await db.getAll("profiles")) || []).forEach(function (p) {
            var pn = profileName(p.name);
            if (pn) logDisplayOf[p.id] = pn;
          });
          try {
            var nameRowsP = (await db.getAll("meta")) || [];
            for (var nrP = 0; nrP < nameRowsP.length; nrP++) {
              var nrowP = nameRowsP[nrP];
              if (!nrowP || !nrowP.key || nrowP.key.indexOf("activityName:") !== 0) continue;
              var pnP = profileName(nrowP.value && nrowP.value.name);
              var nidP = nrowP.key.slice("activityName:".length);
              if (!logDisplayOf[nidP] && pnP) logDisplayOf[nidP] = pnP;
            }
          } catch (eNamesP) {
            /* names are cosmetic */
          }
          var changes2 = await store.changesFor(id, 1000);
          changes2 = changes2.map(function (c) {
            // A row's subject is a playlist or a person; show the name, never an id.
            return Object.assign({}, c, {
              display: logDisplayOf[c.target] || c.targetName || "",
              targetName: logDisplayOf[c.target] || c.targetName || "",
            });
          });
            var tracks = {};
            for (var c = 0; c < changes2.length; c++) {
              if (!changes2[c].uri) continue;
              var tr = await db.get("tracks", changes2[c].uri);
              if (tr) tracks[changes2[c].uri] = tr;
            }
            // Also try the art cache for a row whose stored cover is a
            // spotify:image:/spotify:mosaic: ref that imageUrl() can already read.
            if (row && row.coverUrl && u.imageUrl) row = Object.assign({}, row, { coverUrl: u.imageUrl(row.coverUrl) || row.coverUrl });
            out.model = vm.playlistDetail(row || { id: id, name: "Untitled playlist" }, snap, tracks, changes2, logDisplayOf);
          } else {
            out.model = null;
          }
        }
        if (routeName === "activity") {
          var health = (await store.getMeta("activityHealth", { state: "idle" })) || {};
          var states = {};
          var allStates = (await db.getAll("activityState")) || [];
          for (var s = 0; s < allStates.length; s++) states[allStates[s].userId] = allStates[s];
          var sessions = await store.sessionsFor(null, 100);
          var plays = await store.playsFor(null, 0, 5000);
          var tracksCache = {};
          for (var pp = 0; pp < plays.length; pp++) {
            if (!plays[pp].trackUri) continue;
            var trow = await db.get("tracks", plays[pp].trackUri);
            if (trow) tracksCache[plays[pp].trackUri] = trow;
          }
          var records = (pwt.bus && pwt.bus.activityRecords) || [];
          var liveTracks = {};
          for (var lc = 0; lc < records.length; lc++) {
            if (tracksCache[records[lc].trackUri]) {
              liveTracks[records[lc].trackUri] = tracksCache[records[lc].trackUri];
            } else {
              var liveHit = await db.get("tracks", records[lc].trackUri);
              if (liveHit) liveTracks[records[lc].trackUri] = liveHit;
            }
          }
          var activityMeta = {};
          var metaSeen = {};
          var metaEmpty = {};
          try {
            var metaRows = (await db.getAll("meta")) || [];
            for (var mm = 0; mm < metaRows.length; mm++) {
              if (metaRows[mm].key && metaRows[mm].key.indexOf("activityName:") === 0) {
                var metaId = metaRows[mm].key.slice("activityName:".length);
                var metaName = profileName(metaRows[mm].value && metaRows[mm].value.name) || "";
                activityMeta[metaId] = {
                  name: metaName,
                  avatar: (metaRows[mm].value && metaRows[mm].value.avatar) || "",
                };
                metaSeen[metaId] = true;
                if (!metaName) metaEmpty[metaId] = true;
              }
            }
          } catch (e) {
            /* best effort */
          }
          // Name fallback chain: the feed (reaching this route via the meta
          // cache) is often silent, so the watched-profile rows — which do
          // hold the display name — fill the gap. Only names that survive the
          // id-shape guard are used; nothing is invented.
          var pfRows = [];
          try {
            pfRows = (await db.getAll("profiles")) || [];
          } catch (eProfiles) {
            pfRows = [];
          }
          var profileById = {};
          for (var ppi = 0; ppi < pfRows.length; ppi++) {
            var pfRow = pfRows[ppi];
            if (!pfRow || !pfRow.id) continue;
            var pfName = profileName(pfRow.name);
            var pfAvatar = pfRow.avatarUrl || "";
            if (!pfName && !pfAvatar) continue;
            profileById[pfRow.id] = { name: pfName, avatar: pfAvatar };
          }
          var backfillIds = [];
          for (var pfId in profileById) {
            if (!Object.prototype.hasOwnProperty.call(profileById, pfId)) continue;
            var pfProf = profileById[pfId];
            if (!pfProf.name) continue; // no usable name; stay honest
            var pfCur = activityMeta[pfId];
            if (pfCur && pfCur.name) continue; // feed/meta name wins
            activityMeta[pfId] = {
              name: pfProf.name,
              // Keep the cached meta avatar if there is one; otherwise the
              // profile's. Same raw form the rest of activityMeta uses —
              // the views apply imageUrl().
              avatar: (pfCur && pfCur.avatar) || pfProf.avatar || "",
            };
            if (!metaSeen[pfId] || metaEmpty[pfId]) backfillIds.push(pfId);
          }
          // In-memory only: the live records get the same treatment so the
          // strip and the now-playing hero never render a bare id.
          records = records.map(function (rec) {
            if (!rec) return rec;
            var rfid = String(rec.userUri || "").replace(/^spotify:user:/, "");
            var rprof = rfid ? profileById[rfid] : null;
            if (!rprof) return rec;
            var patch = null;
            if (!rec.userName && rprof.name) patch = { userName: rprof.name };
            if (!rec.avatar && rprof.avatar) patch = Object.assign(patch || {}, { avatar: rprof.avatar });
            return patch ? Object.assign({}, rec, patch) : rec;
          });
          // Meta art fills gaps: live records, session names, track caches.
          var artNeeded = [];
          for (var an = 0; an < records.length; an++) {
            if (records[an] && !records[an].avatar) {
              var afid = String(records[an].userUri || "").replace(/^spotify:user:/, "");
              if (afid) artNeeded.push("spotify:user:" + afid);
            }
          }
          for (var an2 in activityMeta) {
            if (activityMeta[an2] && !activityMeta[an2].avatar) artNeeded.push("spotify:user:" + an2);
          }
          for (var tk in tracksCache) {
            if (tracksCache[tk] && !tracksCache[tk].art) artNeeded.push(tk);
          }
          for (var tk2 in liveTracks) {
            if (liveTracks[tk2] && !liveTracks[tk2].art) artNeeded.push(tk2);
          }
          var artMapA = artNeeded.length ? await artFallback(artNeeded) : {};
          records = records.map(function (rec) {
            if (!rec || rec.avatar) return rec;
            var rfid = String(rec.userUri || "").replace(/^spotify:user:/, "");
            return artMapA["spotify:user:" + rfid] ? Object.assign({}, rec, { avatar: artMapA["spotify:user:" + rfid] }) : rec;
          });
          for (var an3 in activityMeta) {
            if (activityMeta[an3] && !activityMeta[an3].avatar && artMapA["spotify:user:" + an3]) {
              activityMeta[an3] = Object.assign({}, activityMeta[an3], { avatar: artMapA["spotify:user:" + an3] });
            }
          }
          // Bounded, honest backfill: a name resolved from db.profiles for an
          // id with no meta row (or an empty one) is written back so the watch
          // list and the art sweep stay consistent. Ids with nothing to
          // resolve are left untouched.
          for (var bf = 0; bf < backfillIds.length; bf++) {
            var bfMeta = activityMeta[backfillIds[bf]];
            if (!bfMeta || !bfMeta.name) continue;
            try {
              await store.setMeta("activityName:" + backfillIds[bf], {
                name: bfMeta.name,
                avatar: bfMeta.avatar || "",
                uri: "spotify:user:" + backfillIds[bf],
              });
            } catch (eBackfill) {
              /* best effort; rendering does not depend on the write */
            }
          }
          for (var tk3 in tracksCache) {
            if (tracksCache[tk3] && !tracksCache[tk3].art && artMapA[tk3]) {
              tracksCache[tk3] = Object.assign({}, tracksCache[tk3], { art: artMapA[tk3] });
            }
          }
          for (var tk4 in liveTracks) {
            if (liveTracks[tk4] && !liveTracks[tk4].art && artMapA[tk4]) {
              liveTracks[tk4] = Object.assign({}, liveTracks[tk4], { art: artMapA[tk4] });
            }
          }
          var tickRows = [];
          try {
            var todayKey = pwt.diff.dayKey(now);
            var allTicks = (await db.getAll("dayTicks")) || [];
            for (var dt = 0; dt < allTicks.length; dt++) {
              if (allTicks[dt].day === todayKey) tickRows.push(allTicks[dt]);
            }
          } catch (e2) {
            /* presence is optional */
          }
          out.model = {
            state: health.state || "idle",
            errors: health.errors,
            source: health.source,
            lastTick: health.at,
            live: vm.liveStrip(records, states, now, liveTracks),
            sessions: vm.sessionCards(sessions, tracksCache, activityMeta),
            heat: vm.heatmap(plays, now),
            presence: vm.presenceBars(tickRows, pwt.diff.dayKey(now), now, activityMeta),
          };
        }
        if (routeName === "settings") {
          var watches = await store.listWatches();
          var labelled = [];
          var imgUrlS = function (ref) {
            return u.imageUrl ? u.imageUrl(ref) : ref || "";
          };
          for (var w = 0; w < watches.length; w++) {
            // The watch list shows names, never ids; an unresolved name waits
            // for the next scan instead of displaying a 22-character hash.
            var kindName = watches[w].kind === "playlist" ? "Untitled playlist" : "Unknown listener";
            var label = watches[w].name || kindName;
            var image = "";
            if (watches[w].kind === "playlist") {
              var prow = await db.get("playlists", watches[w].id);
              if (prow && prow.name) label = prow.name;
              if (prow) image = imgUrlS(prow.coverUrl);
            } else {
              var urow = await db.get("profiles", watches[w].id);
              if (urow && profileName(urow.name)) label = profileName(urow.name);
              if (!urow || !profileName(urow.name)) {
                try {
                  var cached = await store.getMeta("activityName:" + watches[w].id, null);
                  if (cached && profileName(cached.name)) label = profileName(cached.name);
                } catch (eCached) {
                  /* no cached name yet */
                }
              }
              if (urow) image = imgUrlS(urow.avatarUrl);
            }
            labelled.push(Object.assign({}, watches[w], { label: label, image: image }));
          }
          var settingsMissing = [];
          labelled.forEach(function (w) {
            if (w.image) return;
            settingsMissing.push((w.kind === "playlist" ? "spotify:playlist:" : "spotify:user:") + w.id);
          });
          if (settingsMissing.length) {
            var artMapS = await artFallback(settingsMissing);
            labelled = labelled.map(function (w) {
              if (w.image) return w;
              var url = artMapS[(w.kind === "playlist" ? "spotify:playlist:" : "spotify:user:") + w.id];
              return url ? Object.assign({}, w, { image: imgUrlS(url) }) : w;
            });
          }
          out.watches = labelled;
          var cfg = pwt.config.get();
          out.model = vm.settingsModel(cfg, {
            os: pwt.notify.osState(),
            cacheBytes: await estimateSize(),
            counts: await counts(db),
          });
          out.addState = { playlist: add.playlist, profile: add.profile, error: "" };
          out.addError = add.error;
          out.onRunSelfTest = function () {
            setDiag({ running: true, result: diag.result });
            Promise.resolve()
              .then(function () {
                return pwt.telemetry ? pwt.telemetry.runSelfTest({ db: pwt.db, store: pwt.store, bus: pwt.bus }) : null;
              })
              .then(function (res) {
                setDiag({ running: false, result: res });
              })
              .catch(function (e) {
                setDiag({
                  running: false,
                  result: {
                    at: Date.now(),
                    pass: 0,
                    fail: 1,
                    total: 1,
                    totalMs: 0,
                    checks: [{ name: "self-test crashed", ok: false, ms: 0, detail: String((e && e.message) || e) }],
                  },
                });
              });
          };
          out.onCopyDiagnostics = function () {
            var report = pwt.telemetry ? pwt.telemetry.report() : { note: "telemetry missing" };
            var text = JSON.stringify(report, null, 2);
            var said = false;
            var done = function () {
              if (said) return;
              said = true;
              if (pwt.notify && pwt.notify.toast) pwt.notify.toast("Diagnostics copied to clipboard");
            };
            try {
              if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
                root.navigator.clipboard.writeText(text).then(done, done);
              } else {
                root.console.log("[Spotispy] diagnostics report\n" + text);
                done();
              }
            } catch (e) {
              root.console.log("[Spotispy] diagnostics report\n" + text);
              done();
            }
          };
        }
        if (pwt.telemetry) pwt.telemetry.record("load." + routeName, Date.now() - __tLoad, true);
        out.error = null;
        out.loading = false;
        setModel(function (m) {
          return Object.assign({}, m, out);
        });
      } catch (e) {
        console.error("[Spotispy] load failed for " + routeName + ":", e && e.message, e && e.stack);
        if (pwt.telemetry) {
          pwt.telemetry.record("load." + routeName, Date.now() - __tLoad, false, e && e.message);
          pwt.telemetry.captureError("load." + routeName, e);
        }
        var loadError = String((e && e.stack) || e);
        setModel(function (m) {
          // The stale payload goes with it: a failed load must not leave the
          // previous route's data on screen under an error banner.
          return Object.assign({}, m, {
            ready: true,
            route: routeName,
            error: loadError,
            loading: false,
            model: undefined,
            vm: undefined,
            rows: undefined,
            watches: undefined,
            liveNow: undefined,
          });
        });
      }
    }

    /** Add a watch from the settings inputs. */
    async function addWatch(kind) {
      var pwt = P;
      var u = pwt.util;
      var raw = add[kind];
      var ref = u.parseRef(raw, kind === "playlist" ? "playlist" : "user");
      if (!ref) {
        setAdd(function (a) {
          return Object.assign({}, a, { error: kind === "playlist" ? "That does not look like a playlist." : "That does not look like a profile." });
        });
        return;
      }
      await pwt.store.putWatch({ kind: kind, id: ref.id });
      // Scan the new target right away so the UI is not empty for an hour.
      if (pwt.boot.isBooted()) {
        try {
          await pwt.boot
            .instance()
            .scheduler.runNow({ scope: kind === "playlist" ? "playlists" : "profiles", force: true });
        } catch (e) {
          reportError("scan after add", e);
        }
      }
      setAdd(function (a) {
        var next = Object.assign({}, a);
        next[kind] = "";
        next.error = "";
        return next;
      });
      load("settings");
    }

    async function unwatch(kind, id) {
      await P.store.removeWatch(kind, id);
    }

    async function followerHistory(userId) {
      var changes = await P.store.changesFor(userId, 400);
      return changes
        .filter(function (c) {
          return c.kind === "profile.followers.count" && c.extra && c.extra.to != null;
        })
        .reverse()
        .map(function (c) {
          return { at: c.ts, value: Number(c.extra.to) || 0 };
        });
    }

    async function exportAll(format) {
      var rows = await P.store.recentChanges(5000);
      if (format === "csv") P.export.download(P.export.filename("spotispy", "csv"), "text/csv", P.export.toCsv(rows));
      else P.export.download(P.export.filename("spotispy", "json"), "application/json", P.export.toJson(rows));
    }

    async function confirmPurge(what) {
      var pwt = P;
      var answer = await pwt.popup.show({
        title: what === "all" ? "Purge everything?" : "Purge activity?",
        body: what === "all" ? "Every snapshot, change and watch is deleted. This cannot be undone." : "All plays, sessions and presence windows are deleted. Aggregates and change history stay.",
        actions: [
          { label: "Cancel", value: null },
          { label: "Purge", value: "purge", destructive: true, primary: true },        ],
      });
      if (!answer) return;
      if (what === "all") await pwt.db.purgeAll();
      else await pwt.db.purgeActivity();
      load("settings");
    }

    async function counts(db) {
      try {
        return { changes: await db.count("changes"), plays: await db.count("plays"), sessions: await db.count("sessions") };
      } catch (e) {
        return {};
      }
    }

    async function estimateSize() {
      try {
        if (root.navigator && root.navigator.storage && root.navigator.storage.estimate) {
          var est = await root.navigator.storage.estimate();
          return est.usage || 0;
        }
      } catch (e) {
        /* not supported */
      }
      return 0;
    }

    useEffect(function () {
      var H = root.Spicetify && root.Spicetify.Platform && root.Spicetify.Platform.History;
      if (!H || !H.listen) return undefined;
      // Seed the app's own stack with where we opened.
      try {
        var here = (H.location && H.location.pathname) || "/Spotispy/";
        if (navStackRef.current.index < 0) {
          navStackRef.current.entries = [here];
          navStackRef.current.index = 0;
        }
      } catch (e) {
        /* no location: the stack starts empty */
      }
      var un = H.listen(function (loc) {
        var r = initialFromHistory(loc);
        var st = loc && loc.state;
        if (loc && loc.pathname) navSync(loc.pathname);
        if (st && st.playlistId) {
          playlistIdRef.current = st.playlistId;
          setModel(function (m) {
            return Object.assign({}, m, { playlistId: st.playlistId });
          });
        }
        if (r && r !== routeRef.current) goRoute(r);
      });
      return function () {
        if (typeof un === "function") un();
      };
    }, []);

    useEffect(
      function () {
        load(route, { selected: selectedRef.current, playlistId: playlistIdRef.current });
        var unsub = null;
        if (P.boot && P.boot.isBooted()) {
          unsub = P.boot.instance().scheduler.on(function (bus) {
            try {
              setModel(function (m) {
                return Object.assign({}, m, { scan: busSnapshot(), liveNow: liveNowIds() });
              });
              // When a scan completes while the tab is open, every route
              // re-reads its data ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â not just the scan button's own .then().
              var seen = lastScanSeenRef.current;
              var cur = bus && bus.lastScanAt;
              var crash = bus && bus.crashAt;
              if (crash && crash !== lastCrashSeenRef.current) {
                lastCrashSeenRef.current = crash;
                // A crash writes lastScanResult without touching lastScanAt, so
                // it reloads even before the first successful scan (seen === 0).
                load(routeRef.current, { selected: selectedRef.current, playlistId: playlistIdRef.current });
              } else if (cur && cur !== seen) {
                // The first-ever completion reloads too: the initial mount's
                // load may have raced the scan's writes.
                load(routeRef.current, { selected: selectedRef.current, playlistId: playlistIdRef.current });
                lastScanSeenRef.current = cur;
              }
            } catch (e) {
              /* a broken bus listener must not break the scheduler */
            }
          });
        }
        return function () {
          if (unsub) unsub();
        };
      },
      [route, routeEpoch]
    );

    useEffect(function () {
      var handler = function () {
        if (root.document && root.document.visibilityState === "hidden") return;
        load(routeRef.current, { selected: selectedRef.current, playlistId: playlistIdRef.current });
      };
      if (root.document) root.document.addEventListener("visibilitychange", handler);
      return function () {
        if (root.document) root.document.removeEventListener("visibilitychange", handler);
      };
    }, []);

    /**
     * Run the self-test automatically on first mount and surface failures
     * inline. A watch-tapper who sees an empty page must know at a glance why.
     */
    var autoDiag = useRef(false);
    useEffect(
      function () {
        if (autoDiag.current) return;
        autoDiag.current = true;
        if (!P.telemetry || !P.telemetry.runSelfTest) return;
        P.telemetry
          .runSelfTest({ db: P.db, store: P.store, bus: P.bus })
          .then(function (res) {
            setDiag(function (d) {
              return { running: d.running, result: res };
            });
          })
          .catch(function () {
            /* diagnostics is best effort and must never crash the app */
          });
        void 0;
      },
      []
    );

    var uiProps = Object.assign({}, model, props, {
      route: route,
      filter: route === "playlist" ? playlistFilter : route === "activity" ? activityFilter : filter,
      addState: Object.assign({}, model.addState || {}, { playlist: add.playlist, profile: add.profile }),
      watches: model.watches || [],
      onNavigate: guard("navigate", function (next) {
        navigate(next);
      }),
      onRetry: function () {
        load(routeRef.current, { selected: selectedRef.current, playlistId: playlistIdRef.current });
      },
      onSelect: guard("select", function (id) {
        selectedRef.current = id;
        return load("profiles", { selected: id });
      }),
      onScan: guard("scan", function (scope) {
        if (!P.boot.isBooted()) {
          reportError("scan", new Error("the scheduler is not running (boot did not complete)"));
          return;
        }
        return P.boot
          .instance()
          .scheduler.runNow({ scope: scope, force: true })
          .then(function () {
            return load(routeRef.current, { selected: selectedRef.current });
          });
      }),
      onForceScan: guard("scan", function (id) {
        if (!P.boot.isBooted()) {
          reportError("scan", new Error("the scheduler is not running (boot did not complete)"));
          return;
        }
        return P.boot
          .instance()
          .scheduler.runNow({ scope: "playlists", force: true })
          .then(function () {
            return load("playlist", { playlistId: id });
          });
      }),
      onOpenTrack: function (uri) {
        try {
          if (root.Spicetify && root.Spicetify.Platform && root.Spicetify.Platform.PlaylistAPI && /^spotify:track:/.test(uri)) {
            root.Spicetify.Player.playUri(uri);
            return;
          }
        } catch (e) {
          /* fall through to navigation */
        }
        openExternal(uri);
      },
      onOpen: function (uri) {
        openExternal(uri);
      },
      onOpenProfile: function (id) {
        openExternal("spotify:user:" + id);
      },
      onOpenPlaylist: guard("open playlist", function (id) {
        navigate("playlist", { state: { playlistId: id } });
      }),
      onWatchPlaylist: guard("watch playlist", function (id) {
        return P.store.putWatch({ kind: "playlist", id: id }).then(function () {
          var reload = function () {
            return load(routeRef.current, { selected: selectedRef.current });
          };
          if (P.boot.isBooted()) {
            return P.boot
              .instance()
              .scheduler.runNow({ scope: "playlists", force: true })
              .then(reload, reload);
          }
          return reload();
        });
      }),
      onOpenRow: guard("open change", function (row) {
        if (row.level === "playlist") navigate("playlist", { state: { playlistId: row.target } });
      }),
      onToggleActivity: guard("toggle activity", async function (userId, enabled) {
        var p = await P.db.get("profiles", userId);
        await P.db.put("profiles", Object.assign({}, p || { id: userId }, { watchActivity: !!enabled }));
        if (routeRef.current === "profiles") {
          await load("profiles", { selected: userId });
        } else {
          await load(routeRef.current, { selected: selectedRef.current });
        }
      }),
      onUnwatch: guard("unwatch", async function (kind, id) {
        // Settings calls (kind, id); the route views call (id) only.
        if (id == null) {
          id = kind;
          kind = routeRef.current === "profiles" ? "profile" : "playlist";
        }
        await unwatch(kind, id);
        if (routeRef.current === "playlist") {
          await load("playlist", { playlistId: playlistIdRef.current });
        } else {
          await load(routeRef.current, { selected: selectedRef.current });
        }
      }),
      onFilter: function (next) {
        if (routeRef.current === "playlist") {
          playlistFilterRef.current = Object.assign({}, playlistFilterRef.current, next);
          setPlaylistFilter(playlistFilterRef.current);
          load("playlist", { playlistId: playlistIdRef.current });
          return;
        }
        if (routeRef.current === "activity") {
          // The activity view filters its own lists; no reload needed.
          activityFilterRef.current = Object.assign({}, activityFilterRef.current, next);
          setActivityFilter(activityFilterRef.current);
          return;
        }
        filterRef.current = Object.assign({}, filterRef.current, next);
        setFilter(filterRef.current);
        load(routeRef.current, { selected: selectedRef.current });
      },
      onExport: guard("export", function (format) {
        var rows = model.rows || (model.vm && model.vm.recent) || [];
        if (format === "csv") P.export.download(P.export.filename("spotispy-log", "csv"), "text/csv", P.export.toCsv(rows));
        else P.export.download(P.export.filename("spotispy-log", "json"), "application/json", P.export.toJson(rows));
      }),
      onSet: guard("settings", async function (patch) {
        if (props.onSettingsChange) props.onSettingsChange(patch);
        P.config.set(patch);
        if (P.boot.isBooted()) P.boot.instance().scheduler.reschedule();
        await load("settings");
      }),
      onAdd: guard("add watch", function (kind) {
        return addWatch(kind);
      }),
      onAddInput: function (kind, value) {
        setAdd(function (a) {
          var next = Object.assign({}, a);
          next[kind] = value;
          next.error = "";
          return next;
        });
      },
      onPurge: guard("purge", function (what) {
        return confirmPurge(what);
      }),
      onExportAll: guard("export all", function (format) {
        return exportAll(format);
      }),
      about: { version: "Spotispy " + VERSION, notes: "Local-only. Endpoints may change without notice." },
    });
    Object.assign(uiProps, hud());

    var diagSummary = P.telemetry ? P.telemetry.report() : null;
    uiProps.diag = {
      running: diag.running,
      result: diag.result || (diagSummary && diagSummary.lastSelfTest) || null,
      report: diagSummary,
    };
    return h(P.ui.App, uiProps);
  }

  /** Pathname -> route name; the History listener keeps state in sync either way. */
  function initialFromHistory(loc) {
    var pathname = "";
    try {
      var H = root.Spicetify && root.Spicetify.Platform && root.Spicetify.Platform.History;
      pathname = (loc && loc.pathname) || (H && H.location && H.location.pathname) || "";
    } catch (e) {
      pathname = "";
    }
    var m = /^\/(?:Spotispy|spotispy|playlist-watchtower)\/?([a-z-]*)/i.exec(pathname);
    if (!m) return null;
    var seg = m[1];
    if (!seg) return "overview";
    if (seg === "profiles" || seg === "playlist" || seg === "activity" || seg === "log" || seg === "settings") return seg;
    return "overview";
  }

  function openExternal(uri) {
    try {
      var H = root.Spicetify && root.Spicetify.Platform && root.Spicetify.Platform.History;
      var S = root.Spicetify;
      var m = /^spotify:(playlist|user|track|album|artist):([A-Za-z0-9]{22,40})$/.exec(uri || "");
      if (H && m) {
        var route = { playlist: "/playlist/", track: "/track/", album: "/album/", artist: "/artist/", user: "/user/" }[m[1]];
        H.push({ pathname: route + m[2] });
        return;
      }
      if (S && S.URI && S.URI.navigate) {
        S.URI.navigate(uri);
        return;
      }
    } catch (e) {
      /* fall through */
    }
    if (root.open) root.open(uri, "_blank", "noopener");
  }

  return Controller;
});
