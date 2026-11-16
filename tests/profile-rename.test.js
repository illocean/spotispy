"use strict";
// Spotispy — an unresolvable name must not log a rename to nothing.
//
// `displayNameOf` returns "" when no candidate resolves, and `diffScalars`
// ignores null but not "". The row kept the old name, so nothing was visible
// while the log asserted "name: Bob → ". `rowKey` includes the day, so it
// re-fired once per scan, forever.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const h = require("./support/harness.js");

test("a payload with no resolvable name logs no rename", () => {
  const { win, P } = h.boot();
  const calls = { toasts: [], nav: [], get: [], post: [], handlers: [] };
  h.stubSpicetify(win, calls);

  const prev = { id: "u1", name: "Bob", avatarHash: "h1", followers: 10, plays: [], playlists: [] };
  const next = { id: "u1", name: "", avatarHash: "h1", followers: 10, plays: [], playlists: [] };

  const d = P.profiles.diffProfile(prev, next, 1000);
  const renames = (d.events || []).filter(function (e) { return e.kind === "profile.name.changed"; });
  assert.equal(renames.length, 0, "a nameless payload must not log a rename: " + JSON.stringify(renames));
});

test("a real name change is still logged", () => {
  // The other direction, so the fix cannot simply drop every rename.
  const { win, P } = h.boot();
  const calls = { toasts: [], nav: [], get: [], post: [], handlers: [] };
  h.stubSpicetify(win, calls);

  const prev = { id: "u1", name: "Bob", avatarHash: "h1", followers: 10, plays: [], playlists: [] };
  const next = { id: "u1", name: "Robert", avatarHash: "h1", followers: 10, plays: [], playlists: [] };

  const d = P.profiles.diffProfile(prev, next, 1000);
  const renames = (d.events || []).filter(function (e) { return e.kind === "profile.name.changed"; });
  assert.equal(renames.length, 1, "a real rename is logged: " + JSON.stringify(renames));
  assert.equal(renames[0].extra.from, "Bob");
  assert.equal(renames[0].extra.to, "Robert");
});
