"use strict";
// Spotispy — the embed route must report `capped` from the parse result.
//
// `sources.js` computes it correctly (a read carrying `trackListFull` whose
// length matches the page's declared total is complete), but the caller in
// playlists.js hardcoded `capped: true` and discarded it. On a build where the
// client and Web API routes both fail, every playlist is served by embed, so
// every scan reseeded and not one track change was ever logged.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const s = require("../src/pwt/core/sources.js");

function embedPage(useFull, trackCount, declaredTotal) {
  const tracks = [];
  for (let i = 0; i < trackCount; i++) tracks.push({ uri: "spotify:track:" + String(i).padStart(22, "a"), title: "t" + i });
  const entity = { name: "Night Drive", coverArt: { sources: [] }, trackList: tracks.slice(0, 1) };
  if (useFull) entity.trackListFull = tracks;
  if (declaredTotal != null) entity.trackCount = declaredTotal;
  const data = { props: { pageProps: { state: { data: { entity: entity } } } } };
  return '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(data) + "</script>";
}

test("a complete embed read is not capped", () => {
  // trackListFull present and matching the declared total: a full read.
  const full = s.SOURCES.embed.parse(embedPage(true, 3, 3));
  assert.equal(full.uris.length, 3, "three tracks read");
  assert.equal(full.capped, false, "a complete read must not be capped: " + full.capped);

  const noTotal = s.SOURCES.embed.parse(embedPage(true, 3, null));
  assert.equal(noTotal.capped, false, "and not when no total is declared");
});

test("a partial embed read is still capped", () => {
  // The other direction, so the fix cannot simply disable the flag.
  const mismatch = s.SOURCES.embed.parse(embedPage(true, 3, 99));
  assert.equal(mismatch.capped, true, "3 read of 99 declared is partial");

  const preview = s.SOURCES.embed.parse(embedPage(false, 1, 1));
  assert.equal(preview.capped, true, "a preview-only read proves nothing");
});

test("the embed caller does not override the parse verdict", () => {
  // Read the source and assert the caller takes `entity.capped`. This is the
  // half of the fix that round 3 missed.
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "pwt", "core", "playlists.js"), "utf8");
  const m = /source: "embed",\s*capped:\s*([A-Za-z_.]+)/.exec(src);
  assert.ok(m, "the embed return must name its capped value");
  assert.equal(m[1], "entity.capped", "the caller must forward entity.capped, not hardcode true");
});
