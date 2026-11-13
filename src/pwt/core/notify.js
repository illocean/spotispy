/* eslint-disable */
/**
 * Spotispy — notifications.
 *
 * In-app toast via Spicetify.showNotification. An OS notification is used only
 * when Spotify is not focused AND the renderer exposes a working `Notification`;
 * otherwise the toast is the only channel and a diagnostic says so.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.notify = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var permissionAsked = null;
  var lastPresence = 0;

  function canOs() {
    return typeof root.Notification === "function";
  }

  /** Whether the OS channel is actually usable on this client. */
  function osState() {
    if (!canOs()) return { supported: false, state: "unavailable" };
    return { supported: true, state: root.Notification.permission || "default" };
  }

  function ensurePermission() {
    if (!canOs() || root.Notification.permission !== "default") return Promise.resolve(osState());
    if (!permissionAsked) {
      try {
        permissionAsked = root.Notification.requestPermission().then(function () {
          return osState();
        });
      } catch (e) {
        permissionAsked = Promise.resolve({ supported: true, state: "denied" });
      }
    }
    return permissionAsked;
  }

  function toast(message) {
    try {
      if (root.Spicetify && root.Spicetify.showNotification) {
        root.Spicetify.showNotification(message, false);
        return true;
      }
    } catch (e) {
      /* fall through */
    }
    if (typeof root.console !== "undefined") root.console.info("[Spotispy] " + message);
    return false;
  }
  function focused() {
    try {
      return !!(root.document && root.document.hasFocus && root.document.hasFocus());
    } catch (e) {
      return true;
    }
  }

  function osNotify(title, body) {
    var s = osState();
    if (!s.supported || s.state !== "granted") return false;
    try {
      new root.Notification(title, { body: body, tag: "spotispy" });
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Single channel used by the pollers: toast when focused, OS otherwise. */
  function emit(title, body, settings) {
    settings = settings || {};
    var sent = false;
    if (!focused()) sent = osNotify(title, body);
    if (!sent) return toast(body ? title + " — " + body : title);
    return true;
  }

  /** Rate-limited "friend is now playing" toast: at most once a minute (§5.7). */
  function presence(title, body, now) {
    var t = now == null ? Date.now() : now;
    if (t - lastPresence < 60000) return false;
    lastPresence = t;
    toast(title + " — " + body);
    return true;
  }

  /** Format one digest line for a scan. */
  function digest(counts) {
    var added = counts.added || 0;
    var removed = counts.removed || 0;
    var edits = counts.edits || 0;
    if (!added && !removed && !edits) return "";
    var parts = [];
    if (added) parts.push("+" + added + " track" + (added === 1 ? "" : "s"));
    if (removed) parts.push("−" + removed + " track" + (removed === 1 ? "" : "s"));
    if (edits) parts.push(edits + " change" + (edits === 1 ? "" : "s"));
    return parts.join(", ");
  }

  return {
    canOs: canOs,
    osState: osState,
    ensurePermission: ensurePermission,
    toast: toast,
    osNotify: osNotify,
    emit: emit,
    presence: presence,
    digest: digest,
    _resetPresence: function () {
      lastPresence = 0;
    },
  };
});
