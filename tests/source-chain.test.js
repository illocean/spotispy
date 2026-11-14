"use strict";
/**
 * Spotispy â€” scan source-chain tests: the failure paths the user hit.
 *
 * Every track-listing source is dead on the client being tested (verified
 * live: Web API transport failure surfaced as a resolved {code,message} body,
 * embed unreachable, pathfinder rejected, wg resolver missing). These tests pin
 * the behaviour that was broken and got fixed:
 *   - resolved error bodies are detected, never parsed as "empty playlist";
 *   - a transport-failure body ("Failed to fetch") is reported unreachable,
 *     never as a status (429) the endpoint never returned;
 *   - the chain falls through to the next source and records why each failed;
 *   - a truncated page limit marks the read capped (never a false mass-removal);
 *   - a failing scan still records failures AND the name/cover the profile route
 *     supplied (the second write used to clobber the first).
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");

const U = require("../src/pwt/util/util.js");
const Sources = require("../src/pwt/core/sources.js");
const RealNet = require("../src/pwt/core/net.js");
const Playlists = require("../src/pwt/core/playlists.js");

const TRACK = (c) => "spotify:track:" + c.repeat(22);
const PL = "5555555555555555555555";

function netReturning(router) {
  globalThis.PWT = {
    util: U,
    sources: Sources,
    net: {
      call: function (spec) {
        return new Promise(function (resolve, reject) {
          try {
            var v = router(spec);
            if (v instanceof Error) reject(v);
            else resolve(v);
          } catch (e) {
            reject(e);
          }
        });
      },
      // The body-error detector/classifier/wording is shared, so route to the
      // real implementations instead of re-implementing them here.
      bodyError: RealNet.bodyError,
      bodyErrorCode: RealNet.bodyErrorCode,
      bodyErrorMessage: RealNet.bodyErrorMessage,
      pool: function (items, limit, task) {
        var results = [];
        return (async function () {
          for (const item of items || []) {
            var value;
            var ok = true;
            try {
              value = await task(item);
            } catch (e) {
              ok = false;
              value = e;
            }
            results.push({ ok: ok, value: value });
          }
          return { results: results, errors: [] };
        })();
      },
    },
  };
  return router;
}

test("fetchContents: a resolved error body fails the source, never reads as empty", async () => {
  netReturning(function (spec) {
    var url = spec.url || "";
    if (url.indexOf("api.spotify.com") >= 0) return { code: 429, message: "Failed to fetch" };
    if (spec.method === "fetch") return Promise.reject(new Error("fetch failed"));
    if (url.indexOf("api-partner.spotify.com") >= 0) return { code: 401, message: "Failed to fetch" };
    if (url.indexOf("wg://core-playlist") >= 0) return Promise.reject(new Error("Resolver not found"));
    return Promise.reject(new Error("unexpected " + url));
  });
  // harness' fetch path is rejected synchronously in node; make it throw too
  const err = await Playlists.fetchContents(PL, {}).then(
    () => null,
    (e) => e
  );
  assert.ok(err, "the chain must throw when every source fails");
  assert.ok(!/web api 429/.test(err.message), "a transport failure is never reported as a 429: " + err.message);
  assert.ok(/unreachable|failed to fetch/i.test(err.message), "the reason says the host was unreachable: " + err.message);
  const attempts = (err.attempts || []).filter(function (a) { return !a.ok; });
  const sources = attempts.map(function (a) { return a.source; });
  for (const wanted of ["api", "pathfinder", "core"]) {
    assert.ok(sources.indexOf(wanted) >= 0, "the " + wanted + " failure is recorded: " + JSON.stringify(attempts));
  }
});

test("fetchContents: the ok-empty short-circuit still applies when the Web API answers cleanly", async () => {
  netReturning(function (spec) {
    if (spec.url && spec.url.indexOf("api.spotify.com") >= 0) {
      return { items: [], total: 0 };
    }
    return Promise.reject(new Error("no other source should be needed"));
  });
  const res = await Playlists.fetchContents(PL, {});
  assert.equal(res.total, 0);
  assert.equal(res.source, "api");
  assert.equal(res.capped, false);
});

test("fetchContents: the 20-page cap marks the read capped, never a complete snapshot", async () => {
  const totalTracks = 2500;
  netReturning(function (spec) {
    if (spec.url && spec.url.indexOf("api.spotify.com") >= 0) {
      var m = /offset=(\d+)/.exec(spec.url);
      var offset = m ? Number(m[1]) : 0;
      var items = [];
      for (var i = 0; i < 100 && offset + i < totalTracks; i++) {
        items.push({ track: { uri: TRACK(String.fromCharCode(97 + ((offset + i) % 26))) }, added_at: new Date(1700000000000 + offset + i).toISOString() });
      }
      return { items: items, total: totalTracks };
    }
    return Promise.reject(new Error("unexpected"));
  });
  const res = await Playlists.fetchContents(PL, {});
  assert.equal(res.capped, true, "a truncated read is capped so the differ re-seeds instead of removing");
  assert.equal(res.uris.length, 2000);
  assert.equal(res.total, 2500);
});

test("fetchMeta: an error body from the core resolver cannot erase a Web API cover", async () => {
  const cover = "https://image-cdn-ak.spotifycdn.com/image/ab67706c0000cover";
  globalThis.PWT = {
    util: U,
    sources: Sources,
    net: {
      call: function (spec) {
        var url = spec.url || "";
        if (url.indexOf("api.spotify.com/v1/playlists/") >= 0 && url.split("/tracks").length === 1) {
          // The Web API answers but the name field is absent in this build.
          return Promise.resolve({
            description: "",
            owner: { id: "u" },
            followers: { total: 7 },
            images: [{ url: cover }],
            snapshot_id: "snap",
          });
        }
        if (url.indexOf("wg://core-playlist") >= 0) {
          return Promise.resolve({ code: -1, message: "Resolver not found!" });
        }
        if (url.indexOf("user-profile-view") >= 0) {
          return Promise.reject(new Error("no owner resolve needed"));
        }
        return Promise.reject(new Error("unexpected " + url));
      },
    },
    db: { get: function () { return Promise.resolve(undefined); } },
    store: { listWatches: function () { return Promise.resolve([]); } },
  };
  const meta = await Playlists.fetchMeta(PL);
  assert.equal(meta.coverUrl, cover, "the Web API cover survives the core resolver error body");
});

const { boot, stubSpicetify, fixtures, PLAYLIST_ID, USER_ID } = require("./support/harness.js");

// The harness' net door uses Cosmos (stubbed), but the embed fallback in
// fetchContents goes through the renderer's global fetch — which is REAL
// network in node 24. Block it: tests never touch the network.
globalThis.fetch = function () {
  return Promise.reject(new TypeError("Failed to fetch"));
};

test("a failing playlists scan still records the failure AND the name/cover from the profile route", async () => {
  const { win, P } = boot();
  const calls = { toasts: [], nav: [], get: [], post: [], handlers: [] };
  stubSpicetify(win, calls);
  const fx = fixtures();
  // Every track-listing source answers the way the live client does: an error body, not data.
  calls.handlers.push({ test: function (u) { return /api\.spotify\.com\/v1\/playlists\/.*\/tracks/.test(u); }, value: { code: 429, message: "Failed to fetch" } });
  // The client's own playlist route is what runs first; on a build where it
  // cannot read this playlist it throws, and the HTTP chain takes over.
  calls.handlers.push({
    test: function (u) { return String(u).indexOf("spotify:playlist:" + fx.playlistId) >= 0; },
    contents: function () { throw new Error("playlist not readable through the client route"); },
  });
  calls.handlers.push({ test: function (u) { return u.indexOf("core-playlist/v1/playlist") >= 0 && /\/rows$/.test(u); }, value: { code: -1, message: "Resolver not found!" } });
  calls.handlers.push({ test: function (u) { return /api-partner/.test(u); }, value: { code: 401, message: "Failed to fetch" } });
  // The profile route works and knows the name and cover.
  calls.handlers.push({
    test: function (u) { return u.indexOf("/user-profile-view/v3/profile/") >= 0 && u.indexOf("/followers") < 0 && u.indexOf("/following") < 0; },
    value: function () {
      return {
        uri: "spotify:user:" + fx.userId,
        name: "Ari",
        image: "https://i.example/ari.jpg",
        followers_count: 128,
        public_playlists: [{ uri: "spotify:playlist:" + fx.playlistId, name: "Night Drive", images: [{ url: "https://i.example/night.jpg" }] }],
      };
    },
  });
  calls.handlers.push({ test: function (u) { return u.indexOf("/followers") >= 0; }, value: { profiles: [] } });
  calls.handlers.push({ test: function (u) { return u.indexOf("listening-activity") >= 0; }, value: { entities: [] } });
  await P.store.putWatch({ kind: "playlist", id: fx.playlistId });
  await P.store.putWatch({ kind: "profile", id: fx.userId });
  const booted = P.boot.ensure({ onScanDone: function () {} });
  await booted.scheduler.runNow({ scope: "playlists", force: true });
  const row = await P.db.get("playlists", fx.playlistId);
  assert.ok(row, "the playlist row exists");
  assert.equal(row.name, "Night Drive", "the profile route supplied the name");
  assert.equal(row.coverUrl, "https://i.example/night.jpg", "and the cover");
  assert.ok(row.failures >= 1, "the failure is counted");
  assert.ok(row.lastError && !/web api 429/.test(row.lastError), "no fabricated rate limit is stored: " + row.lastError);
  assert.ok(
    /unreachable|failed to fetch|client route/i.test(row.lastError),
    "the real reason is stored, whatever source produced it: " + row.lastError
  );
  // The scan summary must name the failure once per playlist, not twice.
  const meta = await P.store.getMeta("lastScanResult", null);
  assert.equal(meta && meta.errors && meta.errors.length, 1, "one error entry per failed playlist: " + JSON.stringify(meta && meta.errors));
  await booted.stop();
  await P.db.close();
});
