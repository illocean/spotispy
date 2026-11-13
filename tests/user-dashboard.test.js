"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const U = require("../src/pwt/util/util.js");
const D = require("../src/pwt/diff.js");
const S = require("../src/pwt/session.js");
globalThis.PWT = { util: U, diff: D, session: S, events: require("../src/pwt/events.js") };
const V = require("../src/pwt/ui/view.js");

test("userDashboard selects the first watched user and maps playlists and updates", () => {
  const now = Date.now();
  const data = {
    profiles: [
      {
        id: "user00000000000000000001",
        name: "Ari",
        avatarUrl: "https://img/avatar1",
        followers: 128,
        watchActivity: true,
        plays: [
          { uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M", name: "Night Drive", cover: "https://img/cover", total: 42 },
          { uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM6M", name: "Day Drive", cover: "https://img/cover2", total: 7 },
        ],
        health: "ok",
        lastSyncedAt: now - 1000,
      },
    ],
    playlists: [
      { id: "37i9dQZF1DXcBWIGoYBM5M", name: "Night Drive", trackCount: 40, coverUrl: "https://img/cover", ownerId: "user00000000000000000001", lastChangeAt: now - 60000, lastSyncedAt: now - 1000, watchedAt: now - 100000, health: "ok" },
    ],
    watches: [
      { kind: "playlist", id: "37i9dQZF1DXcBWIGoYBM5M", addedAt: now - 100000 },
      { kind: "profile", id: "user00000000000000000001", addedAt: now - 120000 },
    ],
    recent: [
      { kind: "profile.name.changed", level: "profile", target: "user00000000000000000001", detail: "Ari", ts: now - 2000, image: "https://img/avatar1" },
      { kind: "playlist.item.added", level: "playlist", target: "37i9dQZF1DXcBWIGoYBM5M", uri: "spotify:track:t", detail: "New Song", ts: now - 1500, image: "https://img/art", trackTitle: "New Song" },
      { kind: "profile.followers.count", level: "profile", target: "other000000000000000000", detail: "100 → 101", ts: now - 1000, image: "" },
    ],
    daily: {},
    lastScanAt: now - 1000,
    nextScanAt: now + 60000,
    scan: {},
  };

  const dash = V.userDashboard(data, null, now);
  assert.equal(dash.users.length, 1);
  assert.equal(dash.selectedId, "user00000000000000000001");
  assert.equal(dash.detail.id, "user00000000000000000001");
  assert.equal(dash.detail.playlists.length, 2);
  assert.equal(dash.detail.playlists[0].watched, true);
  assert.equal(dash.detail.playlists[0].coverUrl, "https://img/cover");
  assert.equal(dash.detail.playlists[1].watched, false);
  assert.equal(dash.detail.playlists[1].coverUrl, "https://img/cover2");
  // Both the profile change and the watched-playlist change belong to the user.
  assert.equal(dash.detail.updates.length, 2);
  assert.ok(dash.detail.updates.some((c) => c.kind === "profile.name.changed"));
  assert.ok(dash.detail.updates.some((c) => c.kind === "playlist.item.added"));
  // Change count on the chip: same set.
  assert.equal(dash.users[0].changes, 2);
  assert.equal(dash.users[0].watchedPlaylists, 1);
});

test("userDashboard honours the explicit everyone selection", () => {
  const now = Date.now();
  const data = {
    profiles: [{ id: "user00000000000000000001", name: "Ari", plays: [], health: "ok" }],
    playlists: [],
    watches: [],
    recent: [],
    daily: {},
    lastScanAt: 0,
    nextScanAt: 0,
    scan: {},
  };
  const dash = V.userDashboard(data, "everyone", now);
  assert.equal(dash.detail, null);
  assert.equal(dash.selectedId, null);
  assert.ok(Array.isArray(dash.series));
});
