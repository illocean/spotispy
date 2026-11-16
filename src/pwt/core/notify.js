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

  function canOs() {
    return typeof root.Notification === "function";
  }

  /** Whether the OS channel is actually usable on this client. */
  function osState() {
    if (!canOs()) return { supported: false, state: "unavailable" };
    return { supported: true, state: root.Notification.permission || "default" };
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

  /** Live settings, read through the shared config so a toggle takes effect now. */
  function settings() {
    var pwt = root.PWT;
    try {
      return (pwt && pwt.config && pwt.config.get()) || {};
    } catch (e) {
      return {};
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

  /**
   * Single channel used by the pollers: toast when focused, OS otherwise.
   * The OS channel is off by preference, not by capability: `notifyOs: false`
   * with Spotify unfocused leaves no channel, so this returns false and the
   * caller's dedupe key is not stamped (a later real notification still gets
   * through). It defaults to true — a notification needs the OS channel exactly
   * when Spotify is minimised, which is when the user is not watching.
   */
  function emit(title, body) {
    var s = settings();
    var sent = false;
    if (!focused() && s.notifyOs !== false) sent = osNotify(title, body);
    if (!sent) {
      // Focused, or OS notifications declined: the in-app toast is the channel.
      // `notifyToast: false` turns that channel off, so honour it here too —
      // gating it on `!focused()` made the toggle work only while Spotify was
      // in the background, which is the opposite of what the setting says.
      if (s.notifyToast === false) return false;
      return toast(body ? title + " — " + body : title);
    }
    return true;
  }

  /**
   * Format one digest line for a scan. Each class of change has its own toggle,
   * so a user who only cares about additions does not get the rest.
   */
  function digest(counts) {
    var s = settings();
    var added = counts.added || 0;
    var removed = counts.removed || 0;
    var edits = counts.edits || 0;
    var parts = [];
    if (added && s.notifyAdditions !== false) parts.push("+" + added + " track" + (added === 1 ? "" : "s"));
    if (removed && s.notifyRemovals !== false) parts.push("−" + removed + " track" + (removed === 1 ? "" : "s"));
    if (edits && s.notifyProfile !== false) parts.push(edits + " change" + (edits === 1 ? "" : "s"));
    return parts.join(", ");
  }

  return {
    canOs: canOs,
    osState: osState,
    toast: toast,
    osNotify: osNotify,
    emit: emit,
    digest: digest,
  };
});
