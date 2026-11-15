/* eslint-disable */
/**
 * Spotispy — app boot (element factory, no DOM mounting).
 *
 * Spicetify mounts `render()`'s returned element into the app container; this
 * file only wires the shared scheduler (the extension usually boots it first)
 * and hands back createElement calls.
 */
(function (root) {
  "use strict";
  var P = root.PWT;
  if (!P || !P.boot) return;

  /**
   * Shared toast helpers, keyed on the message so two genuinely different
   * failures both show, while the same failure (fired by both bundles' hooks)
   * shows once. The timestamp is stamped only when a toast actually goes out:
   * the senders return whether the send landed (notify returns booleans), so a
   * toast suppressed by settings or a degraded client never swallows the next
   * real one.
   */
  function dedupeToast(key, windowMs, send) {
    try {
      var seen = root.__pwtToastSeen || (root.__pwtToastSeen = {});
      var now = Date.now();
      if (seen[key] && now - seen[key] < windowMs) return false;
      if (send() !== true) return false; // settings off, notify missing: not stamped
      seen[key] = now;
      return true;
    } catch (e) {
      return false; /* a toast is never worth a crash */
    }
  }

  if (!root.__pwtScanErrorToast) {
    root.__pwtScanErrorToast = function (e) {
      var message = String((e && (e.message || e)) || "scan failed").split("\n")[0].slice(0, 200);
      dedupeToast("err:" + message, 30000, function () {
        var s = P.config.get();
        if (!s.notifyToast || !P.notify || !P.notify.toast) return false;
        // toast() returns whether a toast actually went out; a degraded client
        // (console.info fallback) must not get the dedupe key stamped.
        return P.notify.toast("Spotispy scan failed — " + message) === true;
      });
    };
  }

  if (!root.__pwtScanDoneToast) {
    root.__pwtScanDoneToast = function (totals) {
      var settings = P.config.get();
      var line = (P.notify && P.notify.digest && P.notify.digest(totals)) || "";
      if (!line) {
        // A scan that found nothing worth listing still says what failed.
        var failed = totals && (totals.failed || 0);
        if (!failed) return;
        line = failed + " source" + (failed === 1 ? "" : "s") + " failed — open Overview for the reason";
      }
      // The channel is chosen BEFORE the dedupe key, so a notification the user
      // switched off never stamps the key and never swallows a later real one.
      if (!settings.notifyToast) return;
      var send = P.notify && P.notify.emit ? function () { return P.notify.emit("Spotispy scan", line); } : null;
      if (!send) return;
      dedupeToast("done:" + line, 45000, send);
    };
  }

  if (!root.__pwtPresenceToast) {
    // One presence digest per burst: the same friend going online/offline twice
    // in a minute is one announcement, not two toasts.
    root.__pwtPresenceToast = function (line) {
      var dedupeKey = "presence:" + String(line || "");
      dedupeToast(dedupeKey, 30000, function () {
        if (!P.popup || !P.popup.toast) return false;
        P.popup.toast(line);
        return true;
      });
    };
  }

  var defaultHooksCache = null;

  /** Shared bootstrap: the extension may already have won; ensure() is idempotent. */
  P.app = {
    Boot: function (hooks) {
      // The default hooks are built once and cached: `render()` runs on every
      // app mount, and defaultHooks() builds new closures each time. The app
      // may boot first (extension still waiting for Spicetify), so isBooted()
      // alone must not skip registration — ensure() merges idempotently.
      if (!hooks && !defaultHooksCache) defaultHooksCache = defaultHooks();
      return P.boot.ensure(hooks || defaultHooksCache);
    },

    /** Element Spicetify mounts. Bookmarks/empty state live in the controller. */
    element: function (props) {
      var R = (root.Spicetify && root.Spicetify.React) || null;
      if (!R) throw new Error("Spicetify.React is unavailable");
      return R.createElement(P.ui.AppController, props || {});
    },
  };

  function defaultHooks() {
    return {
      onScanDone: function (out, totals) {
        root.__pwtScanDoneToast && root.__pwtScanDoneToast(totals);
      },
      onScanError: function (e) {
        root.__pwtScanErrorToast && root.__pwtScanErrorToast(e);
      },
      onActivity: function (r) {
        // Presence toasts are an in-app channel like any other: the toast
        // toggle gates them too, and they go through the same dedupe so a
        // change cannot be announced twice.
        if (!r || !r.transitions || !P.config.get().notifyPresence) return;
        var s = P.config.get();
        if (!s.notifyToast) return;
        var names = r.transitions.map(function (t) {
          var n = t.name && !/^[A-Za-z0-9]{22,}$/.test(String(t.name).trim()) ? t.name : "Unknown listener";
          return n + (t.kind === "activity.online" ? " is online" : " went out of view");
        });
        if (!names.length) return;
        var line = names.slice(0, 2).join(" · ");
        if (root.__pwtPresenceToast) {
          root.__pwtPresenceToast(line);
          return;
        }
        if (P.popup && P.popup.toast) P.popup.toast(line);
      },
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
