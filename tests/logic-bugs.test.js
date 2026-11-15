"use strict";
/**
 * Spotispy — regression suite for logical defects found by audit.
 *
 * Every test here corresponds to a concrete defect: it fails against the
 * pre-fix code and passes once the defect is fixed. Each is a specification of
 * the intended behaviour, not of the current behaviour.
 *
 *   npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { boot, stubSpicetify, fixtures, stubHandlers } = require("./support/harness.js");

const diff = require("../src/pwt/diff.js");
const events = require("../src/pwt/events.js");
const sources = require("../src/pwt/core/sources.js");

globalThis.PWT_ART_DISABLED = true;

function freshBoot() {
  const { win, P } = boot();
  const calls = { toasts: [], nav: [], get: [], post: [], handlers: [] };
  stubSpicetify(win, calls);
  return { win, P, calls };
}

/**
 * Wipe the activity/change stores before a test that writes rows. The harness
 * and the source modules share one fake-indexeddb across this file, so a test
 * must not inherit another test's plays/changes or a read looks filtered when
 * it is not.
 */
async function clean(P) {
  await P.net.reset();
  if (P.activity && P.activity.reset) P.activity.reset();
  await P.db.purgeAll();
}

// ---------------------------------------------------------------------------
// 1. diffTracks: duplicates removed one key per copy (strict multiset)
// ---------------------------------------------------------------------------

test("diffTracks: removing one of two duplicate copies emits one removal per copy", () => {
  // prev has two copies of "a"; next has one. One copy was removed.
  const r = diff.diffTracks(["a", "a"], ["a"]);
  assert.deepEqual(r.added, []);
  assert.equal(r.removed.length, 1, "one copy removed => exactly one removal key");
});

test("diffTracks: removing all duplicate copies emits one removal per copy", () => {
  // prev has three copies of "a"; next has none. Three copies were removed.
  const r = diff.diffTracks(["a", "a", "a"], []);
  assert.equal(r.removed.length, 3, "three copies removed => three removal keys, not one");
});

test("diffTracks: adding duplicate copies emits one addition per copy", () => {
  const r = diff.diffTracks(["a"], ["a", "a", "a"]);
  assert.equal(r.added.length, 2, "two extra copies added => two addition keys, not one");
});

test("diffTracks: mixed multiset counts both sides per copy", () => {
  // prev: a x2, b x1 ; next: a x1, b x3, c x1
  const r = diff.diffTracks(["a", "a", "b"], ["a", "b", "b", "b", "c"]);
  assert.equal(r.removed.length, 1, "one 'a' removed");
  assert.deepEqual(r.removed, ["a"]);
  assert.equal(r.added.length, 3, "two 'b' + one 'c' added");
  assert.deepEqual(r.added.slice().sort(), ["b", "b", "c"]);
});

// ---------------------------------------------------------------------------
// 2. playlist.meta.changed is a playlist-level kind
// ---------------------------------------------------------------------------

test("playlist.meta.changed is a registered playlist kind", () => {
  assert.equal(events.levelOf("playlist.meta.changed"), "playlist");
});

test("playlist.meta.changed aggregates into the playlist bucket, not profile", () => {
  assert.equal(events.aggregateLevel("playlist.meta.changed"), "playlist");
});

test("playlist.item.added still aggregates as playlist / added", () => {
  assert.equal(events.aggregateLevel("playlist.item.added"), "playlist");
  assert.equal(events.aggregateField("playlist.item.added"), "added");
});

// ---------------------------------------------------------------------------
// 13. embed.parse: total counts the list actually used
// ---------------------------------------------------------------------------

test("embed.parse: total reflects trackListFull when trackList is absent", () => {
  const html =
    '<script id="__NEXT_DATA__" type="application/json">' +
    JSON.stringify({
      props: {
        pageProps: {
          state: {
            data: {
              entity: {
                name: "Only Full",
                trackListFull: [{ uri: "spotify:track:a" }, { uri: "spotify:track:b" }],
              },
            },
          },
        },
      },
    }) +
    "</script>";
  const parsed = sources.SOURCES.embed.parse(html);
  assert.ok(parsed, "the embed payload parses");
  assert.equal(parsed.uris.length, 2, "two URIs read from trackListFull");
  assert.equal(parsed.total, 2, "total counts the list actually used (trackListFull), not the absent trackList");
});

// ---------------------------------------------------------------------------
// 3. fetchContents: API pagination advances by returned item count
// ---------------------------------------------------------------------------

test("fetchContents: paginated Web API with non-track items yields unique URIs and is not capped", async () => {
  const { win, P, calls } = freshBoot();
  try {
    await clean(P);
    const PAGE = 100;
    // 150 items total; every 50th item is an episode (filtered out by parse).
    const items = [];
    for (let i = 0; i < 150; i++) {
      if (i % 50 === 50 - 1) {
        items.push({ track: { uri: "spotify:episode:e" + i } });
      } else {
        items.push({ track: { uri: "spotify:track:" + String(i).padStart(22, "0") } });
      }
    }
    calls.handlers.length = 0;
    calls.handlers.push({
      test: function (u) { return /api\.spotify\.com\/v1\/playlists\/.*\/tracks/.test(u); },
      value: function (u) {
        const offset = Number(/offset=(\d+)/.exec(u)[1]);
        return { items: items.slice(offset, offset + PAGE), total: items.length };
      },
    });

    const res = await P.playlists.fetchContents("37i9dQZF1DXcBWIGoYBM5M");
    assert.equal(res.source, "api");
    const uris = res.uris;
    assert.equal(new Set(uris).size, uris.length, "no duplicate URIs across pages: " + JSON.stringify(uris.slice(0, 5)));
    // 150 items, 3 episodes filtered => 147 tracks.
    assert.equal(uris.length, 147, "every track item is fetched exactly once (147)");
    assert.equal(res.capped, false, "a fully-paged read is not capped");
    void win;
  } finally {
    P.db.close();
  }
});

// ---------------------------------------------------------------------------
// 4. fetchContents: pathfinder metadata-only answer is not a successful empty read
// ---------------------------------------------------------------------------

test("fetchContents: a metadata-only pathfinder answer throws instead of an empty success", async () => {
  const { win, P, calls } = freshBoot();
  try {
    await clean(P);
    calls.handlers.length = 0;
    // Web API and embed both fail; pathfinder answers metadata with no content.
    calls.handlers.push({
      test: function (u) { return /api\.spotify\.com\/v1\/playlists\/.*\/tracks/.test(u); },
      value: { code: 429, message: "rate limited" },
    });
    calls.handlers.push({
      test: function (u) { return u.indexOf("/embed/playlist/") >= 0; },
      value: "<html>no data</html>",
    });
    calls.handlers.push({
      test: function (u) { return u.indexOf("/pathfinder/v2/query") >= 0; },
      value: function (u, body) {
        if (body && body.operationName === "fetchPlaylistMetadata") {
          return { data: { playlistV2: { name: "Ghost", content: null } } };
        }
        return { data: { playlistV2: { content: { totalCount: 3, items: [] } } } };
      },
    });
    // core resolver is unreachable, so the chain ends at pathfinder.
    calls.handlers.push({
      test: function (u) { return /core-playlist\/v1\/playlist\/.*\/rows/.test(u); },
      value: { code: -1, message: "Resolver not found!" },
    });

    await assert.rejects(
      function () { return P.playlists.fetchContents("37i9dQZF1DXcBWIGoYBM5M"); },
      "a metadata-only pathfinder answer must not resolve as a 0-track playlist"
    );
    void win;
  } finally {
    P.db.close();
  }
});

// ---------------------------------------------------------------------------
// 5. scanPlaylists: a held (unconfirmed shrink) reports nothing as written
// ---------------------------------------------------------------------------

test("scanPlaylists: a held shrink reports nothing as written, and counts as held", async () => {
  const { win, P, calls } = freshBoot();
  try {
    await clean(P);
    const fx = fixtures();
    // A playlist id no other test file uses, so a shared-process leftover
    // snapshot cannot seed or mask this scan.
    const PID = "zzHoldTestPlaylist000000001";
    stubHandlers(fx, calls);
    let read = 0;
    const full = [];
    for (let i = 0; i < 100; i++) full.push({ track: { uri: "spotify:track:" + String(i).padStart(22, "0") }, added_at: new Date(Date.now() - 86400000).toISOString() });
    const shrunk = [
      { track: { uri: "spotify:track:new1" + "0".repeat(15) }, added_at: new Date().toISOString() },
      { track: { uri: "spotify:track:new2" + "0".repeat(15) }, added_at: new Date().toISOString() },
    ];
    // Drop every api-tracks handler left by earlier tests in this process:
    // stubSpicetify dispatches to the FIRST matching handler, so a stale handler
    // would answer before this one. Identify them by probing each handler's own
    // predicate against a real api-tracks URL (its boolean answer is what says
    // "this handler serves api tracks"), not by the URL itself.
    var API_TRACKS_URL = "https://api.spotify.com/v1/playlists/probe/tracks";
    calls.handlers = calls.handlers.filter(function (h) {
      var servesApiTracks = false;
      try {
        servesApiTracks = h.test(API_TRACKS_URL) === true;
      } catch (e) {
        servesApiTracks = false;
      }
      return !servesApiTracks;
    });
    calls.handlers.push({
      test: function (u) { return /api\.spotify\.com\/v1\/playlists\/.*\/tracks/.test(u); },
      value: function () {
        read++;
        return { items: read === 1 ? full : shrunk, total: read === 1 ? 100 : shrunk.length };
      },
    });

    await P.net.reset();
    await P.store.putWatch({ kind: "playlist", id: PID });

    const deps = { net: P.net, db: P.db, store: P.store, config: P.config };
    // Scan 1 seeds the 100-track baseline.
    await P.playlists.scanPlaylists(deps, { force: true });
    const seeded = await P.db.get("snapshots", PID);
    assert.ok(seeded && seeded.uris.length === 100, "the first scan stored a 100-track baseline: " + (seeded && seeded.uris.length));
    assert.equal(seeded.source, "api", "the baseline came from the Web API");

    // Scan 2 sees a suspicious shrink (100 -> 2) and must hold the REMOVALS.
    const second = await P.playlists.scanPlaylists(deps, { force: true });
    assert.equal(second.totals.held, 1, "the shrink is held, not applied: " + JSON.stringify(second.totals));
    // A hold suppresses removals only. The additions are proven by the same
    // read, so they are still written (and still counted): dropping them made a
    // genuinely new track invisible for a cycle.
    assert.equal(second.totals.removed, 0, "a held shrink reports no removals: " + JSON.stringify(second.totals));
    assert.ok(second.totals.added > 0, "a held shrink still reports the additions it proved: " + JSON.stringify(second.totals));
    assert.ok(second.totals.edits >= 0, "edits never goes negative for changes that were not written: " + JSON.stringify(second.totals));
    assert.ok(second.results[0].added > 0, "the per-playlist result reports those additions either");

    // And the events really are on disk: the new tracks are visible in the log.
    const addedRows = await P.store.recentChanges(50, PID, "playlist.item.added");
    const addedUris = addedRows.map(function (c) { return c.uri; });
    assert.ok(addedUris.indexOf("spotify:track:new1" + "0".repeat(15)) >= 0, "a new track is logged while the shrink is held: " + JSON.stringify(addedUris));
  } finally {
    P.net.reset();
    P.db.close();
  }
});

// ---------------------------------------------------------------------------
// 6. activity tick: a cached avatar is not clobbered with an empty string
// ---------------------------------------------------------------------------

test("activity tick: a cached avatar survives a feed record that has none", async () => {
  const { win, P, calls } = freshBoot();
  try {
    await clean(P);
    const fx = fixtures();
    stubHandlers(fx, calls);
    const USER = "aaaaaaaaaaaaaaaaaaaaaa";
    const CACHED = "https://img.example/ari.jpg";
    await P.store.setMeta("activityName:" + USER, { name: "Ari", avatar: CACHED, uri: "spotify:user:" + USER });
    // Feed record carries no avatar this tick.
    calls.handlers = calls.handlers.filter(function (h) {
      return h.test("https://spclient.wg.spotify.com/listening-activity/v1/feed") === false;
    });
    calls.handlers.push({
      test: function (u) { return u.indexOf("/listening-activity/v1/feed") >= 0; },
      value: function () {
        return {
          entities: [
            {
              userEntity: {
                uri: "spotify:user:" + USER,
                name: "Ari",
                activity: {
                  entityUri: fx.tracks[0].uri,
                  timestamp: new Date().toISOString(),
                  isPlaying: true,
                  contextUri: "",
                },
              },
            },
          ],
        };
      },
    });
    const deps = { net: P.net, db: P.db, store: P.store, config: P.config };
    await P.activity.tick(deps, { force: true });
    const after = await P.store.getMeta("activityName:" + USER, null);
    assert.ok(after, "the cache row still exists");
    assert.equal(after.avatar, CACHED, "an avatar resolved earlier is not destroyed by an avatar-less feed record");
    void win;
  } finally {
    P.net.reset();
    P.activity.reset();
    P.db.close();
  }
});

// ---------------------------------------------------------------------------
// 7. activity tick: the per-profile Watch activity flag is honoured for online friends
// ---------------------------------------------------------------------------

test("activity tick: a profile with watchActivity=false records no plays while online", async () => {
  const { win, P, calls } = freshBoot();
  try {
    await clean(P);
    const fx = fixtures();
    stubHandlers(fx, calls);
    const USER = "aaaaaaaaaaaaaaaaaaaaaa";
    await P.db.put("profiles", { id: USER, name: "Ari", watchActivity: false });

    const before = (await P.store.playsFor(null, 0, 5000)) || [];
    const deps = { net: P.net, db: P.db, store: P.store, config: P.config };
    const res = await P.activity.tick(deps, { force: true });
    const after = (await P.store.playsFor(null, 0, 5000)) || [];
    assert.equal(res.plays, 0, "no play is produced for an unwatched person");
    assert.equal(after.length, before.length, "nothing new written to the plays store");
    void win;
  } finally {
    P.net.reset();
    P.activity.reset();
    P.db.close();
  }
});

// ---------------------------------------------------------------------------
// 10c. recentChanges: filters apply before the limit on the no-target path
// ---------------------------------------------------------------------------

test("recentChanges: a kind filter is applied before the limit (no rows lost behind newer other-kind rows)", async () => {
  const { win, P } = freshBoot();
  try {
    await clean(P);
    const now = Date.now();
    var changes = [];
    // 5 newer rows of another kind, then 3 older rows of the wanted kind. Each
    // carries a distinct uri: rowKey() collapses same-level/target/kind/uri/day
    // rows into one logical change, so identical rows would be deduped.
    for (var i = 0; i < 5; i++) {
      changes.push({ level: "playlist", target: "plK", kind: "playlist.item.removed", title: "other" + i, detail: "", ts: now - 1000 - i, observedAt: now - 1000 - i, uri: "spotify:track:other" + i });
    }
    for (var j = 0; j < 3; j++) {
      changes.push({ level: "playlist", target: "plK", kind: "playlist.item.added", title: "wanted" + j, detail: "", ts: now - 10000 - j, observedAt: now - 10000 - j, uri: "spotify:track:wanted" + j });
    }
    await P.store.commitScan({ changes: changes });

    const added = await P.store.recentChanges(3, null, "playlist.item.added");
    assert.equal(added.length, 3, "the limit applies to the wanted kind, not to the raw row count: " + added.length);
    assert.ok(added.every(function (r) { return r.kind === "playlist.item.added"; }), "only the wanted kind");
    assert.equal(added[0].title, "wanted0", "newest of the wanted kind first");
  } finally {
    P.db.close();
  }
});

// ---------------------------------------------------------------------------
// 7b. an unwatched friend is not counted as an absence (no phantom missed/hidden)
// ---------------------------------------------------------------------------

test("activity tick: an unwatched online friend accrues no missed ticks and no hidden transition", async () => {
  const { win, P, calls } = freshBoot();
  try {
    await clean(P);
    const fx = fixtures();
    stubHandlers(fx, calls);
    const USER = "aaaaaaaaaaaaaaaaaaaaaa";
    // A stored state row, as if the friend had been watched before being turned
    // off — this is the case that used to accrue a phantom miss every tick.
    await P.db.put("activityState", Object.assign({ userId: USER }, P.session.snapshot(P.session.restore(null))));
    await P.db.put("profiles", { id: USER, name: "Ari", watchActivity: false });

    const deps = { net: P.net, db: P.db, store: P.store, config: P.config };
    for (let n = 0; n < 3; n++) {
      const res = await P.activity.tick(deps, { force: true });
      assert.equal(res.hidden || 0, 0, "an unwatched friend never reports 'hidden' (tick " + n + ")");
      assert.equal((res.transitions || []).filter(function (t) { return t.kind === "activity.hidden"; }).length, 0, "no phantom hidden transition");
    }
    const st = await P.db.get("activityState", USER);
    assert.ok(st, "the stored state row still exists");
    assert.ok((st.missed || 0) === 0, "an unwatched friend accrues no missed ticks: " + st.missed);
  } finally {
    P.net.reset();
    P.activity.reset();
    P.db.close();
  }
});

// ---------------------------------------------------------------------------
// 10b. recentChanges: the bucket filter is applied before toRow strips it
// ---------------------------------------------------------------------------

test("recentChanges: a bucket filter is honoured (bucket is read before it is stripped)", async () => {
  const { win, P } = freshBoot();
  try {
    await clean(P);
    const now = Date.now();
    await P.store.commitScan({ changes: [{ level: "playlist", target: "plB", kind: "playlist.item.added", title: "b", detail: "", ts: now, observedAt: now }] });
    // Every logged row is bucket "log"; a filter for that bucket must return it.
    const logged = await P.store.recentChanges(50, null, null, "log");
    assert.ok(logged.length >= 1, "the 'log' bucket filter returns the logged rows");
    assert.ok(logged.every(function (r) { return r.title === "b"; }), "only the logged row");
    const none = await P.store.recentChanges(50, null, null, "day");
    assert.equal(none.length, 0, "an unknown bucket returns nothing");
  } finally {
    P.db.close();
  }
});

// ---------------------------------------------------------------------------
// 9. profile scan totals: edits excludes playlist added/removed
// ---------------------------------------------------------------------------

test("profile scan: edits counts only scalar changes, not playlist additions", async () => {
  const { win, P, calls } = freshBoot();
  try {
    await clean(P);
    const fx = fixtures();
    stubHandlers(fx, calls);
    const USER = "aaaaaaaaaaaaaaaaaaaaaa";
    await P.store.putWatch({ kind: "profile", id: USER });
    const deps = { net: P.net, db: P.db, store: P.store, config: P.config };

    // First scan seeds the profile (2 playlists, no priors) — not a failure.
    const first = await P.profiles.scanProfiles(deps, { force: true });
    assert.equal(first.totals.failed || 0, 0, "the first profile scan seeds cleanly");
    const seedEdits = first.totals.edits;
    const seedAdded = first.totals.added;

    // Second scan: nothing changes, so every counter must be zero. Before the
    // fix, `edits` re-counts the still-present playlist additions every scan.
    const second = await P.profiles.scanProfiles(deps, { force: true });
    assert.equal(second.totals.added, 0, "no new playlist on the second scan: " + JSON.stringify(second.totals));
    assert.equal(second.totals.edits, 0, "an unchanged profile records no edits: " + JSON.stringify(second.totals));

    // And on a scan that does add a playlist, edits must not include it.
    calls.handlers = calls.handlers.filter(function (h) {
      return h.test("https://spclient.wg.spotify.com/user-profile-view/v3/profile/x") === false;
    });
    calls.handlers.push({
      test: function (u) { return u.indexOf("/user-profile-view/v3/profile/") >= 0 && u.indexOf("/followers") < 0 && u.indexOf("/following") < 0; },
      value: function () {
        return {
          uri: "spotify:user:" + USER,
          name: "Ari",
          image: fx.art.avatarUser,
          followers_count: 128,
          public_playlists: [
            { uri: "spotify:playlist:" + fx.playlistId, name: "Night Drive", images: [{ url: fx.art.cover }] },
            { uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM6M", name: "Day Drive", images: [{ url: fx.art.art1 }] },
            { uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM9X", name: "New Mix", images: [] },
          ],
        };
      },
    });
    const third = await P.profiles.scanProfiles(deps, { force: true });
    assert.equal(third.totals.added, 1, "exactly one playlist added");
    assert.equal(third.totals.edits, 0, "the playlist addition is counted as added, never also as an edit: " + JSON.stringify(third.totals));
    assert.ok(seedEdits >= 0 && seedAdded >= 0, "seed scan produced sane counts");
    void win;
  } finally {
    P.net.reset();
    P.db.close();
  }
});

// ---------------------------------------------------------------------------
// 10. profile scan marks a notfound profile negative
// ---------------------------------------------------------------------------

test("profile scan: a transport-failure body is reported unreachable, never a 429", async () => {
  const { win, P, calls } = freshBoot();
  try {
    await clean(P);
    const USER = "cccccccccccccccccccccc";
    await P.store.putWatch({ kind: "profile", id: USER });
    calls.handlers = calls.handlers.filter(function (h) {
      return h.test("https://spclient.wg.spotify.com/user-profile-view/v3/profile/x") === false;
    });
    // The live client's unreachable shape: a resolved body with a bogus 429 code
    // and the renderer's transport-failure message.
    calls.handlers.push({
      test: function (u) { return u.indexOf("/user-profile-view/v3/profile/") >= 0 && u.indexOf("/followers") < 0 && u.indexOf("/following") < 0; },
      value: { code: 429, message: "Failed to fetch" },
    });
    // The followers/following routes are irrelevant to the profile scan itself.
    calls.handlers.push({ test: function (u) { return u.indexOf("/followers") >= 0; }, value: { profiles: [] } });
    calls.handlers.push({ test: function (u) { return u.indexOf("/following") >= 0; }, value: { profiles: [] } });
    const deps = { net: P.net, db: P.db, store: P.store, config: P.config };
    await P.profiles.scanProfiles(deps, { force: true });
    const row = await P.db.get("profiles", USER);
    assert.ok(row && row.lastError, "the failure is recorded");
    assert.ok(!/429/.test(row.lastError), "no fabricated 429 in the profile error: " + row.lastError);
    assert.ok(/unreachable|failed to fetch/i.test(row.lastError), "the profile error says unreachable: " + row.lastError);
    assert.equal(P.net.isNegative("profile:" + USER), false, "a transport failure must not be marked as a permanent notfound");
  } finally {
    P.net.reset();
    P.db.close();
  }
});

test("profile scan: a 404 profile backs off via the negative cache", async () => {
  const { win, P, calls } = freshBoot();
  try {
    await clean(P);
    const USER = "bbbbbbbbbbbbbbbbbbbbbb";
    await P.store.putWatch({ kind: "profile", id: USER });
    calls.handlers = calls.handlers.filter(function (h) {
      return h.test("https://spclient.wg.spotify.com/user-profile-view/v3/profile/x") === false;
    });
    calls.handlers.push({
      test: function (u) { return u.indexOf("/user-profile-view/v3/profile/") >= 0 && u.indexOf("/followers") < 0 && u.indexOf("/following") < 0; },
      value: { code: -1, message: "Resolver not found!" },
    });
    const deps = { net: P.net, db: P.db, store: P.store, config: P.config };
    await P.profiles.scanProfiles(deps, { force: true });
    assert.equal(P.net.isNegative("profile:" + USER), true, "a resolver-not-found profile is marked negative");

    // A non-forced scan skips it; a forced scan still tries.
    let attempted = 0;
    calls.handlers = calls.handlers.filter(function (h) {
      return h.test("https://spclient.wg.spotify.com/user-profile-view/v3/profile/x") === false;
    });
    calls.handlers.push({
      test: function (u) { return u.indexOf("/user-profile-view/v3/profile/") >= 0 && u.indexOf("/followers") < 0 && u.indexOf("/following") < 0; },
      value: function () {
        attempted++;
        return { code: -1, message: "Resolver not found!" };
      },
    });
    await P.profiles.scanProfiles(deps, {});
    assert.equal(attempted, 0, "a backed-off profile is not requested again without force");
    void win;
  } finally {
    P.net.reset();
    P.db.close();
  }
});

// ---------------------------------------------------------------------------
// 11. recentChanges(limit, target) returns the newest rows, not the oldest
// ---------------------------------------------------------------------------

test("recentChanges: with a target it still returns rows newest-first and honours the limit after filtering", async () => {
  const { win, P } = freshBoot();
  try {
    await clean(P);
    const now = Date.now();
    const rows = [
      { level: "playlist", target: "pl1", kind: "playlist.item.added", title: "old", detail: "", ts: now - 9000, observedAt: now - 9000, uri: "spotify:track:old" },
      { level: "playlist", target: "pl1", kind: "playlist.item.added", title: "new", detail: "", ts: now - 1000, observedAt: now - 1000, uri: "spotify:track:new" },
      { level: "playlist", target: "other", kind: "playlist.item.added", title: "other", detail: "", ts: now - 500, observedAt: now - 500, uri: "spotify:track:other" },
    ];
    await P.store.commitScan({ changes: rows });

    const forPl1 = await P.store.recentChanges(1, "pl1");
    assert.equal(forPl1.length, 1, "the limit applies to the target's rows, not the whole log");
    assert.equal(forPl1[0].title, "new", "the newest row for that target wins, not the oldest");

    const all = await P.store.recentChanges(10);
    assert.equal(all[0].title, "other", "without a target the log is still newest-first");
  } finally {
    P.db.close();
  }
});

// ---------------------------------------------------------------------------
// 12. playsFor filters by user
// ---------------------------------------------------------------------------

test("playsFor: only returns plays belonging to the given user", async () => {
  const { win, P } = freshBoot();
  try {
    await clean(P);
    await P.store.addPlays([
      { userId: "u1", ts: 1000, trackUri: "spotify:track:a", durationMs: 1000 },
      { userId: "u1", ts: 2000, trackUri: "spotify:track:b", durationMs: 1000 },
      { userId: "u2", ts: 1500, trackUri: "spotify:track:c", durationMs: 1000 },
    ]);
    const u1 = await P.store.playsFor("u1", 0, 500);
    assert.equal(u1.length, 2, "only u1's plays: " + JSON.stringify(u1.map((p) => p.trackUri)));
    assert.ok(u1.every(function (p) { return p.userId === "u1"; }), "no other user's play leaks through");
    assert.equal(u1[0].ts, 2000, "newest first");

    const all = await P.store.playsFor(null, 0, 500);
    assert.equal(all.length, 3, "a null user still returns every play (existing caller)");
  } finally {
    P.db.close();
  }
});

// ---------------------------------------------------------------------------
// 8. scheduler re-arms the activity back-off when it is in an error state
// ---------------------------------------------------------------------------

test("scheduler: after activity failures, reschedule() re-arms the activity timer at the back-off", async () => {
  const { win, P, calls } = freshBoot();
  const realSetInterval = global.setInterval;
  const realClearInterval = global.clearInterval;
  const intervals = [];
  try {
    await clean(P);
    // A calendar that only ever reports "now", so any recorded delay is exact.
    const realNow = Date.now;
    Date.now = function () { return 1000000; };
    try {
      global.setInterval = function (fn, ms) {
        intervals.push(ms);
        return { _ms: ms, fake: true };
      };
      global.clearInterval = function () {};

      // Every request fails: the activity tick will throw and accrue an error.
      calls.handlers.length = 0;
      calls.handlers.push({
        test: function () { return true; },
        value: function () { throw new TypeError("Failed to fetch"); },
      });

      const sched = P.scheduler.create({
        store: P.store,
        db: P.db,
        config: P.config,
      });
      await sched.activityTick();
      assert.equal(sched._state().activityErrors, 1, "the failing tick accrued an error");

      sched.reschedule();
      const activityIntervals = intervals.filter(function (m) { return m !== 3600000; });
      assert.ok(activityIntervals.length >= 1, "the activity timer is armed: " + JSON.stringify(intervals));
      assert.ok(
        activityIntervals[activityIntervals.length - 1] >= 180000,
        "after an activity failure the timer is re-armed at the 180s back-off, not 60s: " + JSON.stringify(intervals)
      );
      await sched.stop();
    } finally {
      Date.now = realNow;
    }
  } finally {
    global.setInterval = realSetInterval;
    global.clearInterval = realClearInterval;
    P.db.close();
    void win;
  }
});

void path;
// ---------------------------------------------------------------------------
// 15. commitScan: the aggregate read-modify-write is serialised
// ---------------------------------------------------------------------------

test("commitScan: concurrent commits do not lose each other's aggregate counts", async () => {
  const { win, P } = freshBoot();
  try {
    await clean(P);
    const now = Date.now();
    // Each row is its own logical change (distinct uri), and every commit is a
    // separate read-modify-write of the aggregates store. Unserialised, the
    // last writer wins and the day bucket counts 1 instead of 5.
    const plans = [];
    for (let i = 0; i < 5; i++) {
      plans.push({
        changes: [
          {
            level: "playlist",
            target: "plAgg",
            kind: "playlist.item.added",
            title: "c" + i,
            detail: "",
            ts: now - 1000 - i,
            observedAt: now - 1000 - i,
            uri: "spotify:track:agg" + i,
          },
        ],
      });
    }
    await Promise.all(plans.map(function (p) { return P.store.commitScan(p); }));

    const rows = await P.db.getAll("changes");
    assert.equal(rows.length, 5, "every change row was written: " + rows.length);
    const aggs = await P.db.getAll("aggregates");
    assert.equal(aggs.length, 1, "one day bucket: " + JSON.stringify(aggs));
    assert.equal(aggs[0].added, 5, "all five increments survived: " + aggs[0].added);
  } finally {
    await P.db.close();
  }
});

test("commitScan: re-emitting an already-logged row does not count it twice", async () => {
  const { win, P } = freshBoot();
  try {
    await clean(P);
    const now = Date.now();
    const row = {
      level: "playlist",
      target: "plDup",
      kind: "playlist.item.added",
      title: "same",
      detail: "",
      ts: now - 5000,
      observedAt: now - 5000,
      uri: "spotify:track:dup1",
    };
    await P.store.commitScan({ changes: [row] });
    await P.store.commitScan({ changes: [row] });

    const rows = await P.db.getAll("changes");
    assert.equal(rows.length, 1, "the row is idempotent: " + rows.length);
    const aggs = await P.db.getAll("aggregates");
    assert.equal(aggs.length, 1, "one bucket: " + JSON.stringify(aggs));
    assert.equal(aggs[0].added, 1, "the replayed row is not counted again: " + aggs[0].added);
  } finally {
    await P.db.close();
  }
});

// ---------------------------------------------------------------------------
// 10d. recentChanges: with a target AND a kind, the kind filters before the limit
// ---------------------------------------------------------------------------

test("recentChanges: a target + kind applies both before the limit", async () => {
  const { win, P } = freshBoot();
  try {
    await clean(P);
    const now = Date.now();
    const changes = [];
    // 5 newer removals and 3 older additions on the same target. Each row needs
    // a distinct uri or rowKey() collapses them into one logical change.
    for (let i = 0; i < 5; i++) {
      changes.push({ level: "playlist", target: "plTK", kind: "playlist.item.removed", title: "other" + i, detail: "", ts: now - 1000 - i, observedAt: now - 1000 - i, uri: "spotify:track:tother" + i });
    }
    for (let j = 0; j < 3; j++) {
      changes.push({ level: "playlist", target: "plTK", kind: "playlist.item.added", title: "wanted" + j, detail: "", ts: now - 10000 - j, observedAt: now - 10000 - j, uri: "spotify:track:twanted" + j });
    }
    await P.store.commitScan({ changes: changes });

    const added = await P.store.recentChanges(3, "plTK", "playlist.item.added");
    assert.equal(added.length, 3, "the limit applies to the wanted kind, not to the raw row count: " + added.length);
    assert.ok(added.every(function (r) { return r.kind === "playlist.item.added"; }), "only the wanted kind");
    assert.equal(added[0].title, "wanted0", "newest of the wanted kind first");

    const removed = await P.store.recentChanges(2, "plTK", "playlist.item.removed");
    assert.equal(removed.length, 2, "the other kind is still reachable: " + removed.length);
    assert.ok(removed.every(function (r) { return r.kind === "playlist.item.removed"; }), "only removals");

    const any = await P.store.recentChanges(4, "plTK");
    assert.equal(any.length, 4, "no kind returns the newest rows of any kind: " + any.length);
  } finally {
    await P.db.close();
  }
});

// ---------------------------------------------------------------------------
// 14. trimLog: the log cap must drop the OLDEST OBSERVATION, never the newest
// ---------------------------------------------------------------------------

test("trimLog drops the oldest observation, not a back-dated row just seen", async () => {
  const { win, P } = freshBoot();
  try {
    await clean(P);
    const now = Date.now();
    const DAY = 86400000;

    // makeEvent sets ts = sourceDate when Spotify supplied one, so a track
    // added 3 years ago and first seen a minute ago sorts as the OLDEST row.
    const seenNow = P.events.makeEvent(
      {
        level: "playlist",
        target: "plTRIM",
        kind: "playlist.item.added",
        uri: "spotify:track:ttrim000000000000001",
        title: "seen a minute ago",
        sourceDate: now - 1095 * DAY,
      },
      now
    );
    const seen60d = P.events.makeEvent({ level: "profile", target: "uTRIM1", kind: "profile.name.changed", title: "seen 60 days ago" }, now - 60 * DAY);
    const seen30d = P.events.makeEvent({ level: "profile", target: "uTRIM2", kind: "profile.name.changed", title: "seen 30 days ago" }, now - 30 * DAY);

    // Precondition: the back-dated row really is the oldest by ts.
    assert.ok(seenNow.ts < seen60d.ts && seen60d.ts < seen30d.ts, "fixture ordering: ts follows the source date, not the observation");

    await P.store.commitScan({ changes: [seenNow, seen60d, seen30d] });
    P.config.set({ logCap: 2 });
    // A commit runs trimLog in its chain.
    await P.store.commitScan({ puts: [["playlists", { id: "plTRIM", name: "P", health: "ok" }]] });

    const left = await P.store.recentChanges(10);
    const titles = left.map(function (r) { return r.title; });
    assert.ok(titles.indexOf("seen a minute ago") >= 0, "the row just observed survives even though its ts is the oldest: " + titles.join(", "));
    assert.ok(titles.indexOf("seen 30 days ago") >= 0, "a genuinely newer observation survives: " + titles.join(", "));
    assert.equal(titles.indexOf("seen 60 days ago"), -1, "the genuinely oldest OBSERVATION is the one trimmed: " + titles.join(", "));
    assert.equal(left.length, 2, "the cap holds: " + left.length);
  } finally {
    await P.db.close();
  }
});

test("changesRecord stamps observedAt so every stored row is trimmable", async () => {
  const { win, P } = freshBoot();
  try {
    await clean(P);
    const now = Date.now();
    // A row with no observedAt of its own: the record must still be indexed.
    await P.store.commitScan({
      changes: [{ level: "profile", target: "uSTAMP", kind: "profile.name.changed", title: "no observedAt", ts: now }],
    });
    const stored = (await P.db.getAll("changes")).filter(function (r) { return r.target === "uSTAMP"; });
    assert.equal(stored.length, 1, "the row was written");
    assert.equal(typeof stored[0].observedAt, "number", "observedAt is on the record, so the trim index sees it");
    assert.ok(isFinite(stored[0].observedAt) && stored[0].observedAt > 0, "and it is a real timestamp: " + stored[0].observedAt);
  } finally {
    await P.db.close();
  }
});

// ---------------------------------------------------------------------------
// 16. cover selection is scored, never a guess at the array's order
// ---------------------------------------------------------------------------

test("bestCover picks the largest image by width, whatever order the array is in", () => {
  // Spotify does not document the order of an `images` array, so a fixed end
  // (first or last) is a guess. Score by declared width, then by label.
  const small = { url: "small", width: 64 };
  const large = { url: "large", width: 640 };
  assert.equal(sources.bestCover([small, large]), "large", "ascending order");
  assert.equal(sources.bestCover([large, small]), "large", "descending order");
  assert.equal(sources.bestCover([]), "", "no images is an honest empty string");
  assert.equal(sources.bestCover(null), "", "null is safe too");
});

test("bestCover falls back to label when no width is declared", () => {
  // The client sends label + url and no width, so label is the only signal.
  const s = { url: "s", label: "standard" };
  const xl = { url: "xl", label: "extra-large" };
  assert.equal(sources.bestCover([s, xl]), "xl", "a bigger label wins");
  assert.equal(sources.bestCover([xl, s]), "xl", "and still wins when it comes first");
});

test("clientMeta picks the largest cover instead of a fixed array end", () => {
  // The route used to take images[images.length - 1]. With images ordered
  // largest-first (as the Web API does) that picked the SMALLEST cover.
  const parsed = sources.SOURCES.clientMeta.parse({
    name: "Night Drive",
    owner: { username: "ari" },
    images: [
      { url: "big", width: 640 },
      { url: "small", width: 64 },
    ],
  });
  assert.equal(parsed.coverUrl, "big", "the largest image wins regardless of order");
});

test("pathfinder.parseMetadata survives an image entry with no sources", () => {
  // A valid metadata payload whose first image carries no `sources` used to
  // throw a TypeError here and fail the whole route for that playlist.
  const parsed = sources.SOURCES.pathfinder.parseMetadata({
    data: {
      playlistV2: {
        name: "Night Drive",
        ownerV2: { data: { username: "ari" } },
        images: { items: [{ /* no sources */ }] },
        content: { totalCount: 3 },
      },
    },
  });
  assert.ok(parsed, "the metadata still parses");
  assert.equal(parsed.name, "Night Drive", "the name survives");
  assert.equal(parsed.coverUrl, "", "a missing sources array is an empty cover, not a crash");
  assert.equal(parsed.total, 3, "and the total survives");

  // With sources present, the largest still wins.
  const withSources = sources.SOURCES.pathfinder.parseMetadata({
    data: { playlistV2: { name: "P", images: { items: [{ sources: [{ url: "a", width: 64 }, { url: "b", width: 640 }] }] } } },
  });
  assert.equal(withSources.coverUrl, "b", "the largest source wins");
});

// ---------------------------------------------------------------------------
// 17. backoff escalates across an unrelated success
// ---------------------------------------------------------------------------

test("backoff step keeps escalating when other requests keep succeeding", async () => {
  const { win, P, calls } = freshBoot();
  try {
    calls.handlers = calls.handlers.filter(function (h) {
      return h.test("https://api.spotify.com/v1/x") === false && h.test("https://api.spotify.com/v1/ok") === false;
    });
    let xCalls = 0;
    // Every request to /x is rate limited; /ok always succeeds.
    calls.handlers.push({
      test: function (u) { return u.indexOf("https://api.spotify.com/v1/x") >= 0; },
      value: function () {
        xCalls++;
        throw Object.assign(new Error("rate limited"), { status: 429 });
      },
    });
    calls.handlers.push({
      test: function (u) { return u.indexOf("https://api.spotify.com/v1/ok") >= 0; },
      value: { ok: true },
    });

    // First rate limit: the window opens and step becomes 1.
    await assert.rejects(function () { return P.net.call({ method: "get", url: "https://api.spotify.com/v1/x" }); });
    const first = P.net._backoff();
    assert.ok(first.until > 0, "the first 429 opened a backoff window");
    assert.equal(first.step, 1, "the first 429 sets step 1: " + first.step);

    // A successful unrelated request must not clear the escalation.
    await P.net.call({ method: "get", url: "https://api.spotify.com/v1/ok" });
    const stepAfterOtherSuccess = P.net._backoff().step;
    assert.equal(stepAfterOtherSuccess, 1, "an unrelated success did not reset the step: " + stepAfterOtherSuccess);

    // A second rate limit escalates from the previous step, not from zero.
    await assert.rejects(function () { return P.net.call({ method: "get", url: "https://api.spotify.com/v1/x" }); });
    const second = P.net._backoff();
    // The delay is 2000 * 2^step, so a step that kept growing must at least
    // double the delay rather than fall back to the first one.
    assert.equal(second.step, 2, "the second 429 escalates: " + second.step);
    assert.ok(second.until >= first.until, "and the window did not shrink: " + first.until + " -> " + second.until);
    assert.equal(xCalls, 2, "both attempts reached the endpoint: " + xCalls);
  } finally {
    await P.db.close();
  }
});

// ---------------------------------------------------------------------------
// 19. the self-test profile probe does not invent a user id
// ---------------------------------------------------------------------------

test("the self-test skips the profile probe honestly when nothing is watched", async () => {
  const { win, P } = freshBoot();
  try {
    await clean(P);
    const result = await P.telemetry.runSelfTest({ probeNetwork: true });
    const api = result.checks.filter(function (c) { return /Profile route/.test(c.name); })[0];
    assert.ok(api, "the profile-route check ran");
    assert.ok(/skipped/i.test(api.detail), "no watched profile means an honest skip, not a fabricated failure: " + api.detail);
    assert.ok(!/spotify\/profile/.test(api.detail), "and the detail never names a guessed id: " + api.detail);
  } finally {
    await P.db.close();
  }
});

// ---------------------------------------------------------------------------
// 20. adaptive activity polling: the boost interval engages only while live
// ---------------------------------------------------------------------------

test("activity boost: an online listener arms the shorter interval", async () => {
  const { win, P, calls } = freshBoot();
  const realSetInterval = global.setInterval;
  const realClearInterval = global.clearInterval;
  const intervals = [];
  try {
    await clean(P);
    await P.config.set({ activityBoost: true, activityBoostMs: 30000, activityMs: 60000 });
    global.setInterval = function (fn, ms) { intervals.push(ms); return { _ms: ms, fake: true }; };
    global.clearInterval = function () {};

    // One friend actually listening, so the tick reports online > 0.
    const now = Date.now();
    calls.handlers = calls.handlers.filter(function (h) {
      return h.test("https://guc-spclient.spotify.com/presence-view/v1/buddylist") === false;
    });
    calls.handlers.push({
      test: function (u) { return u.indexOf("/presence-view/v1/buddylist") >= 0; },
      value: {
        friends: [
          {
            user: { uri: "spotify:user:ffffffffffffffffffffff", name: "Bea" },
            track: { uri: "spotify:track:live0000000000000001", artist: { uri: "spotify:artist:x" } },
            timestamp: now,
          },
        ],
      },
    });

    const sched = P.scheduler.create({ store: P.store, db: P.db, config: P.config, net: P.net });
    const tick = await sched.activityTick();
    assert.ok((tick.online || 0) > 0, "the feed reports a live listener: " + tick.online);

    const activityIntervals = intervals.filter(function (m) { return m !== 3600000; });
    assert.ok(activityIntervals.length >= 1, "the activity timer is armed: " + JSON.stringify(intervals));
    assert.equal(
      activityIntervals[activityIntervals.length - 1],
      30000,
      "a live listener arms the 30s boost, not the 60s normal cadence: " + JSON.stringify(intervals)
    );

    // No listener left: the next tick returns to the normal cadence.
    calls.handlers = calls.handlers.filter(function (h) {
      return h.test("https://guc-spclient.spotify.com/presence-view/v1/buddylist") === false;
    });
    calls.handlers.push({
      test: function (u) { return u.indexOf("/presence-view/v1/buddylist") >= 0; },
      value: { friends: [] },
    });
    await sched.activityTick();
    const after = intervals.filter(function (m) { return m !== 3600000; });
    assert.equal(after[after.length - 1], 60000, "with nobody listening the timer returns to 60s: " + JSON.stringify(intervals));

    await sched.stop();
  } finally {
    global.setInterval = realSetInterval;
    global.clearInterval = realClearInterval;
    await P.db.close();
    void win;
  }
});

test("activity boost: an error back-off wins over the boost", async () => {
  const { win, P, calls } = freshBoot();
  const realSetInterval = global.setInterval;
  const realClearInterval = global.clearInterval;
  const intervals = [];
  try {
    await clean(P);
    await P.config.set({ activityBoost: true, activityBoostMs: 30000, activityMs: 60000 });
    global.setInterval = function (fn, ms) { intervals.push(ms); return { _ms: ms, fake: true }; };
    global.clearInterval = function () {};

    // Every request fails: the tick accrues an error and the back-off engages.
    calls.handlers.length = 0;
    calls.handlers.push({ test: function () { return true; }, value: function () { throw new TypeError("Failed to fetch"); } });

    const sched = P.scheduler.create({ store: P.store, db: P.db, config: P.config });
    await sched.activityTick();
    assert.equal(sched._state().activityErrors, 1, "the failing tick accrued an error");
    sched.reschedule();
    const activityIntervals = intervals.filter(function (m) { return m !== 3600000; });
    const last = activityIntervals[activityIntervals.length - 1];
    assert.ok(last >= 180000, "a failed feed backs off to 180s, never the 30s boost: " + JSON.stringify(intervals));
    await sched.stop();
  } finally {
    global.setInterval = realSetInterval;
    global.clearInterval = realClearInterval;
    await P.db.close();
    void win;
  }
});

// ---------------------------------------------------------------------------
// 21. retention: activity history past the window is deleted, nothing else
// ---------------------------------------------------------------------------

test("pruneOlderThan removes stale plays/sessions/days and keeps recent rows and aggregates", async () => {
  const { win, P } = freshBoot();
  try {
    await clean(P);
    const now = Date.now();
    const day = 86400000;
    const dayKey = require("../src/pwt/diff.js").dayKey;

    // Two plays: one 10 days old, one now. Two day ticks. One session each.
    await P.store.addPlays([
      { userId: "u1", ts: now - 10 * day, trackUri: "spotify:track:old", durationMs: 1000 },
      { userId: "u1", ts: now, trackUri: "spotify:track:new", durationMs: 1000 },
    ]);
    await P.db.batch([
      ["dayTicks", "put", { key: dayKey(now - 10 * day), day: dayKey(now - 10 * day), onlineMs: 100 }],
      ["dayTicks", "put", { key: dayKey(now), day: dayKey(now), onlineMs: 100 }],
      ["sessions", "put", { id: "u1:old", userId: "u1", startedAt: now - 10 * day, endedAt: now - 10 * day }],
      ["sessions", "put", { id: "u1:new", userId: "u1", startedAt: now, endedAt: now }],
    ]);
    // An aggregate and a change must never be pruned.
    await P.db.put("aggregates", { key: "playsTotal", value: 42 });
    await P.store.commitScan({ changes: [{ level: "profile", target: "u1", kind: "profile.name.changed", title: "keep", ts: now - 10 * day }] });

    const deleted = await P.db.pruneOlderThan(now - 3 * day);
    assert.ok(deleted >= 3, "the stale rows were counted: " + deleted);

    const plays = await P.store.playsFor(null, 0, 500);
    assert.equal(plays.length, 1, "only the recent play survives: " + plays.length);
    assert.equal(plays[0].trackUri, "spotify:track:new", "and it is the recent one");

    const days = (await P.db.getAll("dayTicks")) || [];
    assert.equal(days.length, 1, "only the recent day tick survives: " + days.length);
    assert.equal(days[0].day, dayKey(now), "and it is the recent day");

    const sessions = (await P.db.getAll("sessions")) || [];
    assert.equal(sessions.length, 1, "only the recent session survives: " + sessions.length);
    assert.equal(sessions[0].id, "u1:new", "and it is the recent one");

    const agg = await P.db.get("aggregates", "playsTotal");
    assert.ok(agg, "aggregates survive retention: " + JSON.stringify(agg));
    const changes = (await P.db.getAll("changes")) || [];
    assert.equal(changes.filter(function (c) { return c.target === "u1"; }).length, 1, "change history survives retention");
  } finally {
    await P.db.close();
  }
});

test("pruneOlderThan does nothing without a cutoff", async () => {
  const { win, P } = freshBoot();
  try {
    await clean(P);
    assert.equal(await P.db.pruneOlderThan(0), 0, "zero is not a cutoff");
    assert.equal(await P.db.pruneOlderThan(NaN), 0, "NaN is not a cutoff");
    const plays = (await P.db.getAll("plays")) || [];
    assert.ok(plays.length >= 0, "nothing was deleted");
  } finally {
    await P.db.close();
  }
});

test("pruneOlderThan deletes in chunks, not one oversized transaction", async () => {
  const { win, P } = freshBoot();
  try {
    await clean(P);
    const now = Date.now();
    const day = 86400000;
    // Far more stale rows than one chunk: a single transaction over all of
    // them is what risks QuotaExceededError discarding every delete.
    const stale = [];
    for (let i = 0; i < 4500; i++) {
      stale.push({ userId: "bulk", ts: now - 20 * day + i, trackUri: "spotify:track:bulk" + i, durationMs: 1000 });
    }
    await P.store.addPlays(stale);
    await P.store.addPlays([{ userId: "bulk", ts: now, trackUri: "spotify:track:fresh", durationMs: 1000 }]);

    const deleted = await P.db.pruneOlderThan(now - 3 * day);
    assert.equal(deleted, 4500, "every stale row was deleted: " + deleted);

    const after = await P.store.playsFor("bulk", 0, 100000);
    assert.equal(after.length, 1, "only the fresh row remains: " + after.length);
    assert.equal(after[0].trackUri, "spotify:track:fresh", "and it is the fresh one");
  } finally {
    await P.db.close();
  }
});
