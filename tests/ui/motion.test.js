"use strict";
/**
 * Spotispy — motion test.
 *
 * Guards the motion system: the shared route "Loading…" hook, the scan focal
 * state (progress sheen + per-card sheen), and the reduced-motion coverage so
 * every newly animated selector has a gentle fallback. Rendered through the
 * same jsdom harness as the other UI suites (no hand-rolled DOM, no network).
 *
 *   npm run test:ui
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  boot,
  stubSpicetify,
  fixtures,
  stubHandlers,
  seed,
  render,
  ART,
  PLAYLIST_ID,
  USER_ID,
  ROOT,
} = require("../support/harness.js");

const state = {};

test.before(async () => {
  const { win, P } = boot();
  const calls = { toasts: [], nav: [], get: [], post: [], handlers: [] };
  stubSpicetify(win, calls);
  const fx = fixtures();
  stubHandlers(fx, calls);
  state.win = win;
  state.P = P;
  state.fx = fx;
  state.calls = calls;
  state.booted = await seed(P, fx);

  const db = P.db;
  state.profiles = (await db.getAll("profiles")) || [];
  state.playlists = (await db.getAll("playlists")) || [];
  const trackRows = (await db.getAll("tracks")) || [];
  state.tracks = {};
  trackRows.forEach(function (t) {
    state.tracks[t.uri] = t;
  });
});

test.after(async () => {
  if (state.booted) await state.booted.stop();
  if (state.P && state.P.db) state.P.db.close();
});

function overviewModel(scan) {
  return {
    dashboard: {
      profiles: state.profiles,
      playlists: state.playlists,
      watches: [
        { kind: "playlist", id: PLAYLIST_ID, addedAt: state.fx.T0 },
        { kind: "profile", id: USER_ID, addedAt: state.fx.T0 },
      ],
      recent: [],
      daily: {},
      lastScanAt: Date.now() - 1000,
      nextScanAt: Date.now() + 600000,
      scan: scan || {},
    },
  };
}

const css = fs.readFileSync(path.join(ROOT, "src/pwt/ui/style.css"), "utf8");

test("the CSS defines the motion tokens and a reduced-motion path for each new animation", () => {
  assert.ok(css.indexOf("--pwt-ease") >= 0, "shared easing token");
  assert.ok(css.indexOf("@keyframes pwt-sweep") >= 0, "progress/card sweep keyframes");
  assert.ok(css.indexOf("@keyframes pwt-loading-pulse") >= 0, "loading pulse keyframes");
  // The reduced-motion block must name every looping/entrance selector so no
  // animation is left running unguarded.
  const rm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(rm.length > 200, "a reduced-motion block exists");
  ["pwt-progress-sheen", "pwt-scan-sheen", "pwt-loading"].forEach(function (sel) {
    assert.ok(rm.indexOf(sel) >= 0, "reduced motion covers ." + sel);
  });
});

test("kit.Progress renders a sheen overlay", async () => {
  const { P, win } = state;
  const html = await render(P, win, P.uiKit.Progress, { done: 1, total: 4 });
  assert.ok(html.indexOf("pwt-progress-track") >= 0, "track present");
  assert.ok(html.indexOf("pwt-progress-sheen") >= 0, "sheen overlay present");
  assert.ok(html.indexOf("pwt-progress-fill") >= 0, "fill still present");
});

test("a route loading state renders the shared .pwt-loading hook", async () => {
  const { P, win } = state;
  // Overview with no data is the earliest loading state.
  const html = await render(P, win, P.ui.Overview, {
    vm: null,
    scan: {},
    onScan: function () {},
    onOpenPlaylist: function () {},
    onWatchPlaylist: function () {},
    onNavigate: function () {},
    onOpenProfile: function () {},
  });
  assert.ok(html.indexOf("pwt-loading") >= 0, "Overview loading uses the shared hook");
  assert.ok(/Loading…/.test(html), "copy is preserved");
});

test("a running scan renders the scan-progress and per-card sheen hooks", async () => {
  const { P, win } = state;
  const html = await render(P, win, P.ui.Overview, {
    vm: overviewModel({ scanning: true, stage: "playlists", done: 1, total: 2, current: PLAYLIST_ID, totals: { added: 0 } }),
    scan: {},
    onScan: function () {},
    onOpenPlaylist: function () {},
    onWatchPlaylist: function () {},
    onNavigate: function () {},
    onOpenProfile: function () {},
  });
  assert.ok(html.indexOf("pwt-scan-progress is-scanning") >= 0, "scan progress is flagged scanning");
  assert.ok(html.indexOf("pwt-scan-sheen") >= 0, "the active card carries a sheen layer");
  assert.ok(html.indexOf("scanning…") >= 0, "the inline scanning label is preserved");
});

test("the app shell wraps the route body in a keyed .pwt-route for navigation continuity", async () => {
  const { P, win } = state;
  const html = await render(P, win, P.ui.App, {
    route: "overview",
    model: {},
    scan: {},
    onNavigate: function () {},
    onScan: function () {},
    onOpenPlaylist: function () {},
    onWatchPlaylist: function () {},
    onOpenProfile: function () {},
    onBack: function () {},
    onForward: function () {},
    canGoBack: false,
    canGoForward: false,
  });
  assert.ok(/class="pwt-route"/.test(html), "the route body is wrapped in .pwt-route");
  // And the CSS plays one quiet entrance for it, with a reduced-motion fallback.
  assert.ok(css.indexOf(".pwt-route") >= 0 && css.indexOf("@keyframes pwt-route-in") >= 0, "route entrance defined");
  const rm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(rm.indexOf("pwt-route") >= 0, "reduced motion covers .pwt-route");
});

test("the boot splash is styled and has a reduced-motion path that keeps it perceptible", () => {
  // The splash markup ships (.pwt-boot + wordmark + sweeping bar + note) and the
  // CSS paints it: a sweeping green fill on a dark track, opacity/transform only.
  ["pwt-boot", "pwt-wordmark", "pwt-boot-bar", "pwt-boot-bar-fill", "pwt-boot-note"].forEach(function (sel) {
    assert.ok(css.indexOf("." + sel) >= 0, "." + sel + " is styled");
  });
  assert.ok(css.indexOf("@keyframes pwt-boot-sweep") >= 0, "the boot bar sweeps");
  // Reduced motion must not hide the splash: the sweep becomes a static underline
  // and the wordmark fades in (still visible).
  const rm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(rm.indexOf("pwt-boot-bar-fill") >= 0, "reduced motion covers the boot bar");
  assert.ok(rm.indexOf("pwt-boot") >= 0, "reduced motion covers the boot wordmark");
});