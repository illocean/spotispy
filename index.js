/* eslint-disable */
/**
 * Spotispy — app entry point (Spicetify custom app).
 *
 * Spicetify loads the single-file bundle produced by `node tools/build.js`
 * (core + app + this file). The module exports `render()` as its default
 * export; XPUI mounts the component it returns.
 *
 * The app can NEVER come up blank: any failure at boot, at render, or at
 * mount is turned into a visible screen that says exactly what broke.
 * For Node-side tooling this file also exports the build's file list, so the
 * harness can load the exact same sources.
 */
"use strict";

var FILES = [
  "src/pwt/events.js",
  "src/pwt/diff.js",
  "src/pwt/session.js",
  "src/pwt/util/util.js",
  "src/pwt/util/popup.js",
  "src/pwt/core/config.js",
  "src/pwt/core/telemetry.js",
  "src/pwt/core/db.js",
  "src/pwt/core/store.js",
  "src/pwt/core/sources.js",
  "src/pwt/core/net.js",
  "src/pwt/core/notify.js",
  "src/pwt/core/playlists.js",
  "src/pwt/core/profiles.js",
  "src/pwt/core/activity.js",
  "src/pwt/core/art.js",
  "src/pwt/core/scheduler.js",
  "src/pwt/core/export.js",
  "src/pwt/boot.js",
  "src/pwt/app.js",
  "src/pwt/ui/react.js",
  "src/pwt/ui/charts.js",
  "src/pwt/ui/kit.js",
  "src/pwt/ui/view.js",
  "src/pwt/ui/Overview.js",
  "src/pwt/ui/Profiles.js",
  "src/pwt/ui/Playlist.js",
  "src/pwt/ui/Activity.js",
  "src/pwt/ui/Log.js",
  "src/pwt/ui/Settings.js",
  "src/pwt/ui/App.js",
  "src/pwt/ui/controller.js",
];

function render() {
  var root = typeof globalThis !== "undefined" ? globalThis : window;
  try {
    if (root.PWT && root.PWT.app && typeof root.PWT.app.element === "function") {
      var booted = root.PWT.app.Boot();
      // Idempotent: the extension normally got here first. When it did not
      // (extension disabled or broken), the app arms the shared scheduler
      // itself so polling works.
      if (booted && typeof booted.start === "function") {
        Promise.resolve(booted.start()).catch(function (e) {
          root.console && root.console.error && root.console.error("[Spotispy] scheduler start failed", e);
        });
      }
      return root.PWT.app.element();
    }
    throw new Error("PWT.app is missing — the Spotispy bundle did not evaluate (see console for the thrown module error)");
  } catch (e) {
    return failureScreen(root, e);
  }
}

/** A visible screen for boot/render failures. Never throws. */
function failureScreen(root, e) {
  var message = String((e && (e.message || e)) || e);
  var stack = String((e && e.stack) || "").slice(0, 4000);
  if (root.console && root.console.error) {
    root.console.error("[Spotispy] boot/render failed:", e);
  }
  try {
    if (root.PWT && root.PWT.telemetry) root.PWT.telemetry.captureError("render.fallback", e);
  } catch (e2) {
    /* diagnostics is best effort */
  }
  var R = root.Spicetify && root.Spicetify.React;
  if (R && R.createElement) {
    return R.createElement(
      "div",
      { className: "pwt-crash" },
      R.createElement("h1", { className: "pwt-crash-title" }, "Spotispy crashed on start-up"),
      R.createElement("p", { className: "pwt-crash-msg" }, message),
      R.createElement("pre", { className: "pwt-crash-stack" }, stack),
      R.createElement(
        "p",
        { className: "pwt-crash-hint" },
        "Reload the app (Ctrl+Shift+I → reload), or click the “Run self-test” button in Settings. If this persists, copy this screen into a report."
      )
    );
  }
  // Last resort: vanilla DOM, no React.
  var doc = root.document;
  if (!doc) return null;
  var el = doc.createElement("div");
  el.className = "pwt-crash";
  el.innerHTML =
    '<h1 class="pwt-crash-title">Spotispy crashed on start-up</h1>' +
    '<p class="pwt-crash-msg"></p>' +
    '<pre class="pwt-crash-stack"></pre>';
  el.querySelector(".pwt-crash-msg").textContent = message;
  el.querySelector(".pwt-crash-stack").textContent = stack;
  return el;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = FILES;
}
