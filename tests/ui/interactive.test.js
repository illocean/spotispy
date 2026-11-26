"use strict";
/**
 * Spotispy — interactive UI tests.
 * Track titles open Spotify (never play); images open an enlarged preview.
 *   npm run test:ui
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { boot, stubSpicetify, fixtures, render, ART, ROOT } = require("../support/harness.js");

const state = {};
const TRACK_URI = "spotify:track:1111111111111111111111";

test.before(async () => {
  const { win, P } = boot();
  const calls = { toasts: [], nav: [], get: [], post: [], handlers: [], playlistApi: { getContents: [], getMetadata: [] } };
  stubSpicetify(win, calls);
  state.win = win;
  state.P = P;
  state.calls = calls;
  state.fx = fixtures();
});

test.after(() => {
  if (state.P && state.P.db) state.P.db.close();
});

function click(el) {
  el.dispatchEvent(new state.win.MouseEvent("click", { bubbles: true }));
}

/** Let React flush a batched state update + re-render. */
function flush() {
  return new Promise(function (r) { setTimeout(r, 40); });
}

test("kit.Img is a clickable button that opens an enlarged preview overlay", async () => {
  const P = state.P;
  const win = state.win;
  const html = await render(P, win, P.uiKit.Img, {
    class: "pwt-cover",
    src: ART.cover,
    alt: "Cover",
    "data-pwt": "preview-target",
  });
  assert.match(html, /pwt-preview-trigger/, "image must be clickable (preview trigger)");
  const trigger = win.document.querySelector('[data-pwt="preview-target"]');
  assert.ok(trigger, "trigger rendered");
  click(trigger);
  await flush();
  const overlay = win.document.querySelector(".pwt-preview-overlay");
  assert.ok(overlay, "click opens the enlarged preview overlay");
  assert.match(overlay.innerHTML, /pwt-preview-image/, "overlay shows the enlarged image");
  click(overlay);
  await flush();
  assert.equal(win.document.querySelector(".pwt-preview-overlay"), null, "clicking the backdrop closes it");
});

test("Escape closes the enlarged preview", async () => {
  const P = state.P;
  const win = state.win;
  await render(P, win, P.uiKit.Img, { src: ART.art1, alt: "Art", "data-pwt": "preview-esc" });
  const trigger = win.document.querySelector('[data-pwt="preview-esc"]');
  click(trigger);
  await flush();
  assert.ok(win.document.querySelector(".pwt-preview-overlay"), "overlay opened");
  win.document.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await flush();
  assert.equal(win.document.querySelector(".pwt-preview-overlay"), null, "Escape closes it");
});

test("kit.ChangeRow track title is a button wired to onOpen", async () => {
  const P = state.P;
  const win = state.win;
  let opened = null;
  await render(P, win, P.uiKit.ChangeRow, {
    row: {
      kind: "playlist.item.added",
      level: "playlist",
      ts: Date.now(),
      uri: TRACK_URI,
      trackTitle: "First Light",
      title: "Night Drive",
      detail: "First Light",
    },
    linkUri: TRACK_URI,
    onOpen: function (uri) { opened = uri; },
  });
  const btn = win.document.querySelector(".pwt-change-detail .pwt-title-btn");
  assert.ok(btn, "track title in the detail line is a button");
  assert.match(btn.textContent, /First Light/);
  click(btn);
  assert.equal(opened, TRACK_URI, "click opens the track");
});

test("Log renders a playlist.item track title as a button wired to onOpenTrack", async () => {
  const P = state.P;
  const win = state.win;
  let opened = null;
  await render(P, win, P.ui.Log, {
    rows: [
      {
        kind: "playlist.item.added",
        level: "playlist",
        ts: Date.now(),
        uri: TRACK_URI,
        trackTitle: "First Light",
        detail: "First Light",
        display: "Night Drive",
      },
    ],
    filter: { query: "", kind: "", level: "" },
    onOpenTrack: function (uri) { opened = uri; },
  });
  const btn = win.document.querySelector(".pwt-log-detail .pwt-title-btn");
  assert.ok(btn, "log track title is a button");
  assert.match(btn.textContent, /First Light/);
  click(btn);
  assert.equal(opened, TRACK_URI, "click opens the track");
});

test("onOpenTrack navigates instead of starting playback", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/pwt/ui/controller.js"), "utf8");
  const fn = src.slice(src.indexOf("onOpenTrack:"), src.indexOf("onOpen:", src.indexOf("onOpenTrack:")));
  assert.doesNotMatch(fn, /Player\.playUri/, "opening a track must never play it");
  assert.match(fn, /openExternal\(uri\)/, "opening a track must navigate via the Spotify URI");
});
