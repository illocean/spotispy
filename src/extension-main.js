/* eslint-disable */
/**
 * Spotispy — extension entry (runs at Spotify start, before the app).
 *
 * Boots the shared scheduler, and registers the context-menu watch actions:
 *   right-click a playlist -> Watch playlist / Unwatch playlist
 *   right-click a user     -> Watch profile / Watch activity
 * The app itself adds no UI; the sidebar entry lives in manifest.json.
 */
(function (root) {
  "use strict";
  var P = (root.PWT = root.PWT || {});

  // Wait for Spicetify to exist. Only the request API is required: some clients
  // no longer expose Spicetify.LocalStorage, and waiting for it would mean the
  // extension never boots at all (settings fall back to window.localStorage).
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (root.Spicetify && root.Spicetify.CosmosAsync) {
      clearInterval(timer);
      main();
    } else if (tries > 240) {
      clearInterval(timer); // ~2 min; Spotify probably wedged, don't loop forever
      console.error("[Spotispy] Spicetify.CosmosAsync never appeared; extension not started");
    }
  }, 500);

  function main() {
    var S = root.Spicetify;
    try {
      var booted = P.app.Boot({
        // The app registers the same hook once open; both go through one
        // shared, self-deduping window helper (src/pwt/app.js).
        onScanError: function (e) {
          if (root.__pwtScanErrorToast) root.__pwtScanErrorToast(e);
        },
      });
      booted.start();
      booted.scheduler.on(function (bus) {
        // §5.7: scan summary toast after each run, through the same shared
        // helper as the app's onScanDone so both bundles show one digest.
        if (!bus.scanning && bus.lastScanAt && bus.lastScanAt !== main._lastToast) {
          main._lastToast = bus.lastScanAt;
          if (root.__pwtScanDoneToast) root.__pwtScanDoneToast(bus.totals);
        }
      });
    } catch (e) {
      console.error("[Spotispy] boot failed", e);
      if (P.telemetry) P.telemetry.captureError("extension.boot", e);
    }

    registerContextMenus();
  }

  function registerContextMenus() {
    var S = root.Spicetify;
    if (!S.ContextMenu || !S.ContextMenu.Item) return;

    function uriType(uris) {
      var u = (uris && uris[0]) || "";
      var m = /^(spotify:[a-z-]+)(:|$)/.exec(u);
      return m ? m[1] : "";
    }

    /**
     * A context-menu action that writes must say so when the write fails.
     *
     * These handlers only toasted on success, so a rejected write (quota
     * exhausted, storage blocked, private-mode denial) left the user with no
     * feedback whatsoever: the menu item appeared to do nothing, and the
     * rejection surfaced only as an unhandled promise rejection in the console.
     */
    function reportFailure(where) {
      return function (e) {
        var message = String((e && (e.message || e)) || e).split("\n")[0];
        try {
          if (P.telemetry && P.telemetry.captureError) P.telemetry.captureError("extension." + where, e);
        } catch (e2) {
          /* telemetry is best effort */
        }
        try {
          if (P.notify && P.notify.toast) {
            P.notify.toast("Spotispy: " + where + " failed — " + message);
          }
        } catch (e3) {
          /* no toast channel; the console still carries the detail */
        }
        root.console && root.console.error && root.console.error("[Spotispy] " + where + " failed", e);
      };
    }

    new S.ContextMenu.Item(
      "Watch playlist",
      function (uris) {
        uris.forEach(function (u) {
          var id = P.util.playlistId(u);
          if (id) P.store.putWatch({ kind: "playlist", id: id }).then(function () {
            P.notify.toast("Watching this playlist — the next scan records its current state");
            var booted = P.boot.instance();
            if (booted) booted.scheduler.runNow({ scope: "playlists", force: true });
          }).catch(reportFailure("watch playlist"));
        });
      },
      function (uris) {
        return uriType(uris) === "spotify:playlist";
      },
      "<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"currentColor\"><path d=\"M4 5h16v2H4zM4 11h10v2H4zM4 17h7v2H4z\"/></svg>",
      false
    ).register();

    new S.ContextMenu.Item(
      "Unwatch playlist",
      function (uris) {
        uris.forEach(function (u) {
          var id = P.util.playlistId(u);
          if (id) P.store.removeWatch("playlist", id).then(function () {
            P.notify.toast("Unwatched playlist");
          }).catch(reportFailure("unwatch playlist"));
        });
      },
      function (uris) {
        return uriType(uris) === "spotify:playlist";
      },
      "<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"currentColor\"><path d=\"M5 5h14v14H5z\"/></svg>",
      false
    ).register();

    new S.ContextMenu.Item(
      "Watch profile",
      function (uris) {
        uris.forEach(function (u) {
          var id = P.util.userId(u);
          if (id) P.store.putWatch({ kind: "profile", id: id }).then(function () {
            P.notify.toast("Watching this profile — the next scan records its current state");
            var booted = P.boot.instance();
            if (booted) booted.scheduler.runNow({ scope: "profiles", force: true });
          }).catch(reportFailure("watch profile"));
        });
      },
      function (uris) {
        return uriType(uris) === "spotify:user";
      },
      "<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"currentColor\"><path d=\"M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.3 0-8 1.7-8 5v2h16v-2c0-3.3-4.7-5-8-5Z\"/></svg>",
      false
    ).register();

    new S.ContextMenu.Item(
      "Watch profile for listening activity",
      function (uris) {
        uris.forEach(function (u) {
          var id = P.util.userId(u);
          if (!id) return;
          // Returned, not just called: without `return` the chain resolved
          // before the write settled, so the success toast fired even when the
          // write rejected, and the rejection escaped the catch below.
          P.db.get("profiles", id).then(function (p) {
            return P.db.put("profiles", Object.assign({ id: id }, p || {}, { watchActivity: true }));
          }).then(function () {
            P.notify.toast("Activity watching on for this profile");
          }).catch(reportFailure("watch activity"));
        });
      },
      function (uris) {
        return uriType(uris) === "spotify:user";
      },
      "<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"currentColor\"><path d=\"M3 14h4l2-8 3 16 3-12 2 4h4\"/></svg>",
      false
    ).register();
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
