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
  // And the detail carries both values, not just the new one.
  assert.equal(renames[0].detail, "name: Bob → Robert", "a name change keeps before → after in the detail");
});

test("an avatar change logs no before/after hash in the detail", () => {
  // A profile picture is an image: the detail names the change, not the hashes.
  const { win, P } = h.boot();
  const calls = { toasts: [], nav: [], get: [], post: [], handlers: [] };
  h.stubSpicetify(win, calls);

  const prev = { id: "u1", name: "Bob", avatarHash: "hash-old", followers: 10, plays: [], playlists: [] };
  const next = { id: "u1", name: "Bob", avatarHash: "hash-new", followers: 10, plays: [], playlists: [] };

  const d = P.profiles.diffProfile(prev, next, 1000);
  const avatars = (d.events || []).filter(function (e) { return e.kind === "profile.avatar.changed"; });
  assert.equal(avatars.length, 1, "the avatar change is logged: " + JSON.stringify(avatars));
  assert.ok(avatars[0].detail.indexOf("hash-old") < 0, "no before hash in the detail: " + avatars[0].detail);
  assert.ok(avatars[0].detail.indexOf("hash-new") < 0, "no after hash in the detail: " + avatars[0].detail);
  // The structured before/after still rides in extra for the export.
  assert.equal(avatars[0].extra.from, "hash-old");
  assert.equal(avatars[0].extra.to, "hash-new");
});
