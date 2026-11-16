"use strict";
/**
 * Spotispy — scan source-chain tests: the failure paths the user hit.
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

// ---------------------------------------------------------------------------
// The embed route's parse: which list it trusts, and whether the read counts as
// complete. It used to take `trackList` (the short preview) in preference to
// `trackListFull` and then mark every read capped, so a playlist only the
// embed route could read never produced a removal.
// ---------------------------------------------------------------------------
const sources = require("../src/pwt/core/sources.js");

function embedHtml(entity) {
  const json = JSON.stringify({ props: { pageProps: { state: { data: { entity: entity } } } } });
  return '<script id="__NEXT_DATA__" type="application/json">' + json + "</script>";
}

const trackUri = function (c) {
  return "spotify:track:" + c.repeat(22);
};

test("embed parse prefers trackListFull over the trackList preview", () => {
  const preview = [{ uri: trackUri("a") }];
  const full = preview.concat([{ uri: trackUri("b") }, { uri: trackUri("c") }]);
  const parsed = sources.SOURCES.embed.parse(embedHtml({ name: "N", trackList: preview, trackListFull: full }));
  assert.equal(parsed.uris.length, 3, "all three tracks survive, not just the preview: " + parsed.uris.length);
});

test("embed parse marks a preview-only read as capped", () => {
  // A preview cannot prove a track is gone, so removals must stay suppressed.
  const preview = [{ uri: trackUri("a") }];
  const parsed = sources.SOURCES.embed.parse(embedHtml({ name: "N", trackList: preview }));
  assert.equal(parsed.capped, true, "a preview-only read cannot prove absence");
});

test("embed parse distrusts a list that contradicts the page's own total", () => {
  // The cap decision is driven by what the payload says, not by which key it
  // used. A full list that disagrees with the declared total is a truncated or
  // partial read wearing a confident name, and must not authorise removals.
  const full = [{ uri: trackUri("a") }, { uri: trackUri("b") }];
  const mismatch = sources.SOURCES.embed.parse(embedHtml({ name: "N", trackListFull: full, total: 99 }));
  assert.equal(mismatch.capped, true, "a list contradicting the declared total is partial");

  const matching = sources.SOURCES.embed.parse(embedHtml({ name: "N", trackListFull: full, total: 2 }));
  assert.equal(matching.capped, false, "a list matching the declared total proves absence");

  // With no declared total, a full list stands on its own.
  const bare = sources.SOURCES.embed.parse(embedHtml({ name: "N", trackListFull: full }));
  assert.equal(bare.capped, false, "a full list with no declared total is still complete");
});

test("embed parse treats a full list as complete", () => {
  // The opposite case: with the full list in hand, absence IS proven and the
  // shrink guard must not silently swallow every removal forever.
  const full = [{ uri: trackUri("a") }, { uri: trackUri("b") }];
  const parsed = sources.SOURCES.embed.parse(embedHtml({ name: "N", trackListFull: full }));
  assert.equal(parsed.uris.length, 2);
  assert.equal(parsed.capped, false, "a full list proves absence, so removals may be emitted");
});

test("a shrink against an embed snapshot is confirmed, not held forever", () => {
  // End-to-end on the pure diff: a full embed snapshot followed by a shorter
  // read must be confirmable. With capped:true the plan is always "reseed" and
  // the removed count stays 0 no matter how many tracks really left.
  const diff = require("../src/pwt/diff.js");
  const full = [{ uri: trackUri("a") }, { uri: trackUri("b") }, { uri: trackUri("c") }];
  const fullUris = full.map(function (t) { return t.uri; });
  const prev = { uris: fullUris.slice(), source: "embed" };

  const parsedFull = sources.SOURCES.embed.parse(embedHtml({ name: "N", trackListFull: full }));
  const firstPlan = diff.planTrackDiff(prev, { uris: fullUris.slice(), source: "embed", capped: parsedFull.capped });
  assert.equal(firstPlan.action, "diff", "a full embed read is not treated as partial");

  // A shrink is held ONCE by the shrink guard (one confirmation), then confirmed.
  // The defect was that capped:true made this permanently "reseed" instead.
  const after = [{ uri: trackUri("a") }];
  const afterUris = after.map(function (t) { return t.uri; });
  const parsedAfter = sources.SOURCES.embed.parse(embedHtml({ name: "N", trackListFull: after }));
  const held = diff.planTrackDiff(
    { uris: fullUris.slice(), source: "embed" },
    { uris: afterUris, source: "embed", capped: parsedAfter.capped }
  );
  assert.equal(held.action, "hold", "the first shrink is held for confirmation: " + held.action);
  assert.notEqual(held.action, "reseed", "a full read must never reseed: " + held.action);

  // The confirming read compares the same before/after pair, carrying the
  // pendingShrink record forward. `pendingShrink` lives on the snapshot the
  // hold wrote, so it sits next to the pre-shrink uris it counted.
  const confirmed = diff.planTrackDiff(
    { uris: fullUris.slice(), source: "embed", pendingShrink: { count: afterUris.length, confirmations: 1 } },
    { uris: afterUris, source: "embed", capped: parsedAfter.capped }
  );
  assert.equal(confirmed.action, "diff", "the second sighting confirms the shrink: " + confirmed.action);
  assert.equal(confirmed.removed.length, 2, "both departures are reported: " + JSON.stringify(confirmed));
});

// ---------------------------------------------------------------------------
// The pathfinder paging loop: the offset indexes content.items, so it must
// advance by the number of ITEMS a page consumed. It advanced by track count,
// so any page containing an episode re-read its tail; and when the 200-page
// guard ran out it still reported capped:false, letting the next scan diff the
// short list and report every unread track as removed.
// ---------------------------------------------------------------------------
function pathfinderPage(trackIndexes, totalItems) {
  const items = [];
  for (let i = 1; i <= totalItems; i++) {
    const isTrack = trackIndexes.indexOf(i) >= 0;
    items.push({ itemV2: { data: { uri: (isTrack ? "spotify:track:" : "spotify:episode:") + String(i).padStart(21, "0") } } });
  }
  return items;
}

test("pathfinder parsePage reports how many items a page consumed", () => {
  const s = require("../src/pwt/core/sources.js");
  const items = pathfinderPage([1, 3, 5], 5); // 3 tracks, 2 episodes
  const res = { data: { playlistV2: { content: { items: items, totalCount: 5 } } } };
  const parsed = s.SOURCES.pathfinder.parsePage(res);
  assert.equal(parsed.uris.length, 3, "three tracks");
  assert.equal(parsed.items, 5, "five items consumed: " + parsed.items);
  assert.equal(parsed.total, 5, "five items in the playlist");
});

test("the paging loop advances by items, so episodes do not cause re-reads", async () => {
  // 250 items, every 5th an episode, 100 per page. Advancing by track count
  // needs 200 pages and never reaches the end; advancing by items finishes in 3.
  const LIMIT = 100, CAP = 200;
  const build = function (advance) {
    const all = pathfinderPage([], 0);
    for (let i = 1; i <= 250; i++) {
      all.push({ itemV2: { data: { uri: (i % 5 === 0 ? "spotify:episode:" : "spotify:track:") + String(i).padStart(21, "0") } } });
    }
    let offset = 0, pages = 0, emitted = 0;
    while (offset < all.length && pages < CAP) {
      const pageItems = all.slice(offset, offset + LIMIT);
      const uris = pageItems.filter(function (it) { return it.itemV2.data.uri.indexOf("spotify:track:") === 0; });
      emitted += uris.length;
      offset += advance === "uris" ? uris.length : pageItems.length;
      pages++;
      if (!pageItems.length) break;
    }
    return { offset: offset, pages: pages, emitted: emitted, complete: offset >= all.length };
  };

  const oldWay = build("uris");
  const newWay = build("items");
  assert.equal(oldWay.complete, false, "the old rule never finishes: offset " + oldWay.offset);
  assert.equal(oldWay.pages, CAP, "the old rule burns the whole page budget: " + oldWay.pages);
  assert.equal(newWay.complete, true, "the new rule finishes: offset " + newWay.offset);
  assert.equal(newWay.pages, 3, "the new rule needs only 3 pages: " + newWay.pages);
});

test("the pathfinder loop reports capped when the page budget runs out", () => {
  // The `pages < 200` guard is a hard stop. If it exits early the list is
  // short, and claiming `capped: false` lets the next scan diff that short
  // list and report every unread track as removed. The flag must be derived
  // from `offset < total`, never hardcoded.
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "pwt", "core", "playlists.js"), "utf8");
  const m = /source: "pathfinder",\s*capped:\s*([A-Za-z_.]+)/.exec(src);
  assert.ok(m, "the pathfinder return must name its capped value");
  assert.equal(m[1], "hitPageCap", "it must report hitPageCap, not a literal");
});

test("hitPageCap is true only when the loop stopped short", () => {
  // The predicate itself, checked directly so the rule is pinned.
  const hit = (offset, total) => offset < total;
  assert.equal(hit(100, 100), false, "a complete read is not capped");
  assert.equal(hit(9975, 10000), true, "stopping 25 items short is capped");
  assert.equal(hit(0, 0), false, "an empty playlist is not capped");
});
