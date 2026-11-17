"use strict";
/**
 * Spotispy — UI tests.
 *
 * These render the real views against synthetic data in jsdom, so the dashboard
 * can be checked (images, dates, honesty chips, diagnostics) without Spotify.
 *
 *   npm run test:ui
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { boot, stubSpicetify, fixtures, stubHandlers, seed, render, ART, PLAYLIST_ID, PLAYLIST_ID_2, USER_ID, ROOT } = require("../support/harness.js");
const pa = require("../support/playlist-api.js");

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
  const store = P.store;
  state.profiles = (await db.getAll("profiles")) || [];
  state.playlists = (await db.getAll("playlists")) || [];
  state.recent = (await store.recentChanges(60)) || [];
  state.changes = (await store.changesFor(PLAYLIST_ID, 200)) || [];
  state.sessions = (await store.sessionsFor(null, 10)) || [];
  state.tracks = {};
  const trackRows = (await db.getAll("tracks")) || [];
  trackRows.forEach(function (t) {
    state.tracks[t.uri] = t;
  });
  state.snapshot = await db.get("snapshots", PLAYLIST_ID);
  state.controllers = [];
  state.names = { [USER_ID]: { name: "Ari", avatar: ART.avatarFriend } };

  // Image map, exactly as the controller builds it.
  const imageOf = {};
  state.profiles.forEach(function (p) { imageOf[p.id] = p.avatarUrl || ""; });
  state.playlists.forEach(function (pl) { imageOf[pl.id] = pl.coverUrl || ""; });
  state.recent.forEach(function (r) {
    r.display = r.target === PLAYLIST_ID ? "Night Drive" : "Ari";
    r.image = imageOf[r.target] || (r.uri && state.tracks[r.uri] && state.tracks[r.uri].art) || "";
  });
});

test.after(async () => {
  if (state.controllers) unmountControllers();
  if (state.booted) await state.booted.stop();
  // The bundle-boot test runs render() in a second realm, which now arms the
  // shared scheduler; stop that too, or the intervals keep the process alive.
  if (globalThis.__PWT_BOOT__ && globalThis.__PWT_BOOT__ !== state.booted) {
    try { await globalThis.__PWT_BOOT__.stop(); } catch (e) { /* already stopped */ }
  }
  if (state.win && state.win.__PWT_BOOT__ && state.win.__PWT_BOOT__ !== state.booted) {
    try { await state.win.__PWT_BOOT__.stop(); } catch (e) { /* already stopped */ }
  }
  if (state.P && state.P.db) state.P.db.close();
});

function models(P) {
  const view = P.view;
  const daily = {};
  const recent = state.recent.slice(0, 20);
  const dashboard = {
    profiles: state.profiles,
    playlists: state.playlists,
    watches: [
      { kind: "playlist", id: PLAYLIST_ID, addedAt: state.fx.T0 },
      { kind: "profile", id: USER_ID, addedAt: state.fx.T0 },
    ],
    recent: recent,
    daily: daily,
    lastScanAt: Date.now() - 1000,
    nextScanAt: Date.now() + 600000,
    scan: {},
  };
  const overviewModel = { dashboard: dashboard };
  const profileRowModel = Object.assign(
    view.profileRow(Object.assign({ watchedAt: state.fx.T0 }, state.profiles[0] || { id: USER_ID }), state.playlists, state.recent, Date.now()),
    { followerHistory: [{ at: state.fx.T0, value: 120 }, { at: Date.now(), value: 128 }] }
  );
  const playlistModel = view.playlistDetail(state.playlists[0] || { id: PLAYLIST_ID, name: "Night Drive" }, state.snapshot, state.tracks, state.changes);
  return {
    overviewModel: overviewModel,
    profileRowModel: profileRowModel,
    playlistModel: playlistModel,
    sessions: view.sessionCards(state.sessions, state.tracks, state.names),
    live: view.liveStrip(
      [{ userUri: "spotify:user:" + USER_ID, userName: "Ari", avatar: ART.avatarFriend, trackUri: state.fx.tracks[0].uri, contextUri: "spotify:playlist:" + PLAYLIST_ID, isPlaying: true, timestamp: Date.now() - 60000 }],
      {},
      Date.now(),
      state.tracks
    ),
  };
}

test("the dashboard opens on the first watched user with playlists and updates", async () => {
  const { P, win } = state;
  const m = models(P);
  const html = await render(P, win, P.ui.Overview, {
    vm: m.overviewModel,
    scan: {},
    onScan: function () {},
    onOpenPlaylist: function () {},
    onWatchPlaylist: function () {},
    onNavigate: function () {},
    onOpenProfile: function () {},
  });
  assert.ok(html.length > 200, "dashboard rendered");
  assert.ok(!/(^|>)\s*undefined\s*(<|$)/.test(html), "no literal undefined");
  assert.ok(!/\[object Object\]/.test(html), "no [object Object]");
  assert.ok(html.indexOf("field notes · spotispy") >= 0 || html.indexOf("pwt-wordmark") >= 0, "the wordmark is rendered");
  assert.ok(html.indexOf("pwt-user-chips") >= 0, "user chips are rendered");
  assert.ok(html.indexOf("pwt-chip") >= 0, "a chip per watched user");
  assert.ok(html.indexOf("Ari") >= 0, "the first watched user is selected");
  assert.ok(html.indexOf("Night Drive") >= 0, "their playlist is listed");
  assert.ok(html.indexOf("pwt-user-card") >= 0, "playlist cards are rendered");
  assert.ok(html.indexOf("pwt-cover") >= 0, "playlist covers are rendered");
  assert.ok(html.indexOf("Updates") >= 0, "the updates list is rendered");
  assert.ok(/\d{1,2} \w{3} \d{4}|first seen/.test(html), "dates are rendered");
});

async function mountOverview(props) {
  const { P, win } = state;
  const el = win.document.createElement("div");
  win.document.body.appendChild(el);
  P.react.mount(el, P.ui.Overview, props);
  await new Promise(function (r) { setTimeout(r, 120); });
  return el;
}

test("the Everyone chip brings back the aggregate KPIs", async () => {
  const { P, win } = state;
  const m = models(P);
  const el = await mountOverview({
    vm: m.overviewModel,
    scan: {},
    onScan: function () {},
    onNavigate: function () {},
  });
  const button = Array.from(el.querySelectorAll(".pwt-chip")).find(function (b) { return b.textContent.indexOf("Everyone") >= 0; });
  assert.ok(button, "the Everyone chip exists");
  button.click();
  await new Promise(function (r) { setTimeout(r, 120); });
  const html = el.innerHTML;
  assert.ok(html.indexOf("pwt-kpis") >= 0, "KPIs render");
  assert.ok(html.indexOf("Additions vs removals") >= 0, "the chart section renders");
  assert.ok(html.indexOf("pwt-change-thumb") >= 0, "the feed leads with images");
});

test("clicking Watch on an unwatched playlist adds the watch", async () => {
  const { P, win } = state;
  const second = PLAYLIST_ID_2;
  // Pre-condition: the seeded fixture only watches the first playlist.
  assert.equal(await P.db.get("watches", "playlist:" + second), undefined, "Day Drive not watched yet");
  const el = await mountOverview({
    vm: models(P).overviewModel,
    scan: {},
    onScan: function () {},
    onOpenPlaylist: function () {},
    onWatchPlaylist: function (id) {
      return P.store.putWatch({ kind: "playlist", id: id });
    },
    onNavigate: function () {},
  });
  const card = el.querySelector('[data-playlist="' + second + '"]');
  assert.ok(card, "the unwatched playlist card is rendered");
  const button = Array.from(card.querySelectorAll("button")).pop();
  assert.ok(button, "the Watch button is rendered");
  button.click();
  const watch = await waitFor(async function () {
    return P.db.get("watches", "playlist:" + second);
  }, "the playlist watch to appear");
  assert.equal(watch.kind, "playlist");
  assert.equal(watch.id, second);
  // tidy up so existing tests are unaffected
  await P.store.removeWatch("playlist", second);
});

test("the watched playlist card opens the playlist detail", async () => {
  const { P, win } = state;
  const m = models(P);
  const opened = [];
  const el = await mountOverview({
    vm: m.overviewModel,
    scan: {},
    onScan: function () {},
    onWatchPlaylist: function () {},
    onOpenPlaylist: function (id) { opened.push(id); },
  });
  const card = el.querySelector('[data-playlist="' + PLAYLIST_ID + '"]');
  assert.ok(card, "the playlist card is rendered");
  const open = Array.from(card.querySelectorAll("button")).pop();
  open.click();
  assert.deepEqual(opened, [PLAYLIST_ID], "opening the playlist detail");
});

test("the playlist detail shows its cover, track art and dates", async () => {
  const { P, win } = state;
  const m = models(P);
  const html = await render(P, win, P.ui.Playlist, { model: m.playlistModel, filter: { kind: "", query: "" }, onFilter: function () {} });
  assert.ok(html.indexOf("pwt-cover") >= 0, "cover element");
  assert.ok(html.indexOf("Night Drive") >= 0, "playlist name");
  assert.ok(/\d{1,2} \w{3} \d{4}/.test(html), "a date is rendered");
  assert.ok(!/(^|>)\s*undefined\s*(<|$)/.test(html), "no literal undefined");
});

test("profiles render the user picture and the watching date", async () => {
  const { P, win } = state;
  const m = models(P);
  const html = await render(P, win, P.ui.Profiles, { model: { rows: [m.profileRowModel], selected: USER_ID }, onSelect: function () {} });
  assert.ok(html.indexOf("Ari") >= 0, "profile name");
  assert.ok(html.indexOf("pwt-avatar") >= 0, "avatar element");
  assert.ok(html.indexOf("watching since") >= 0 || html.indexOf("never scanned") >= 0, "watch date");
});

test("activity renders user pictures and track art", async () => {
  const { P, win } = state;
  const m = models(P);
  const html = await render(P, win, P.ui.Activity, {
    model: {
      state: "ok",
      source: "listening-activity",
      lastTick: Date.now(),
      live: m.live,
      sessions: m.sessions,
      heat: P.view.heatmap([{ ts: Date.now(), contextUri: "spotify:playlist:" + PLAYLIST_ID }], Date.now()),
      contexts: P.view.topContexts([{ contextUri: "spotify:playlist:" + PLAYLIST_ID }]),
      presence: P.view.presenceBars([], P.diff.dayKey(Date.now()), Date.now(), state.names),
    },
  });
  assert.ok(html.indexOf("Live now") >= 0, "live section");
  assert.ok(html.indexOf("pwt-avatar") >= 0, "user picture");
  assert.ok(html.indexOf("pwt-thumb") >= 0, "track art");
});

test("activity renders sessions as grouped, filterable rows and no Top contexts", async () => {
  const { P, win } = state;
  const now = Date.now();
  const mkCard = (id, userId, userName, startedAt) => ({
    id: id,
    userId: userId,
    userName: userName,
    avatar: "",
    startedAt: startedAt,
    endedAt: startedAt + 30 * 60000,
    durationLabel: "30m",
    trackCount: 4,
    loops: id === "sess-a",
    skips: false,
    unclean: false,
    tracks: [{ uri: "spotify:track:" + id, title: "Track " + id, artist: "Artist", art: "" }],
  });
  const cards = [
    mkCard("sess-a", "fixture-aaa", "Ari", now),
    mkCard("sess-b", "fixture-bbb", "Bo", now - 2 * 86400000),
    mkCard("sess-c", "fixture-aaa", "Ari", now - 2 * 86400000 - 3600000),
  ];
  const base = {
    state: "ok",
    source: "listening-activity",
    lastTick: now,
    live: [],
    sessions: cards,
    heat: P.view.heatmap([], now),
    presence: [],
  };
  const html = await render(P, win, P.ui.Activity, { model: base, filter: { query: "" }, onFilter: function () {} });
  assert.ok(html.indexOf("Top contexts") < 0, "the Top contexts section is gone");
  assert.ok(html.indexOf("pwt-sess-list") >= 0, "the grouped session list renders");
  assert.equal((html.match(/pwt-sess-group"/g) || []).length, 2, "two day groups (today and two days ago)");
  assert.equal((html.match(/pwt-sess-row[ "]/g) || []).length, 3, "one row per session");
  assert.ok(html.indexOf('aria-expanded="true"') >= 0, "session rows render expanded by default");
  assert.ok(html.indexOf('data-pwt="sess-user"') >= 0, "the user filter renders");
  assert.ok(html.indexOf('data-pwt="sess-days"') >= 0, "the date preset filter renders");
  // The "today" preset keeps only the session that started today.
  const todayHtml = await render(P, win, P.ui.Activity, { model: base, filter: { query: "", days: "today" }, onFilter: function () {} });
  assert.equal((todayHtml.match(/pwt-sess-row[ "]/g) || []).length, 1, "the today preset filters by local day");
  assert.ok(todayHtml.indexOf("Bo") < 0, "the two-day-old session is filtered out");
  // The user filter keeps only the chosen friend.
  const userHtml = await render(P, win, P.ui.Activity, { model: base, filter: { query: "", user: "fixture-bbb" }, onFilter: function () {} });
  assert.equal((userHtml.match(/pwt-sess-row[ "]/g) || []).length, 1, "the user filter selects one friend");
  assert.ok(userHtml.indexOf("Bo") >= 0, "the kept session belongs to Bo");
});

test("the change log renders images and dates", async () => {
  const { P, win } = state;
  const html = await render(P, win, P.ui.Log, { rows: state.recent, filter: { query: "", kind: "", level: "" }, onFilter: function () {} });
  assert.ok(html.indexOf("Change log") >= 0, "heading");
  assert.ok(html.indexOf("pwt-log-thumb") >= 0, "image column");
  assert.ok(/\d{1,2} \w{3} \d{4}/.test(html), "dates");
});

test("settings renders the diagnostics panel", async () => {
  const { P, win } = state;
  const html = await render(P, win, P.ui.Settings, {
    model: P.view.settingsModel(P.config.get(), { os: P.notify.osState(), cacheBytes: 1234567, counts: {} }),
    watches: [{ kind: "playlist", id: PLAYLIST_ID, label: "Night Drive", image: ART.cover, addedAt: state.fx.T0 }],
    addState: {},
    diag: { running: false, result: null, report: P.telemetry ? P.telemetry.report() : null },
    onSet: function () {},
  });
  assert.ok(html.indexOf("Diagnostics") >= 0, "diagnostics section");
  assert.ok(html.indexOf("Run self-test") >= 0, "self-test button");
});

test("settings renders a control for every cadence and retention option", async () => {
  const { P, win } = state;
  const html = await render(P, win, P.ui.Settings, {
    model: P.view.settingsModel(P.config.get(), { os: P.notify.osState(), cacheBytes: 1, counts: {} }),
    watches: [],
    addState: {},
    diag: {},
    onSet: function () {},
  });
  // Every setting the scheduler enforces must be reachable from the UI,
  // otherwise the value can only be changed by editing LocalStorage by hand.
  assert.ok(html.indexOf('data-pwt="poll-ms"') >= 0, "the scan interval control");
  assert.ok(html.indexOf('data-pwt="activity-ms"') >= 0, "the activity interval control");
  assert.ok(html.indexOf('data-pwt="activity-boost-ms"') >= 0, "the boost interval control");
  assert.ok(html.indexOf('data-pwt="retain-days"') >= 0, "the retention control");
  // The boost options must all be sub-minute: a "faster" cadence that is not
  // faster would never engage. The default is now 2 s.
  assert.ok(html.indexOf("2 s") >= 0, "the boost interval renders in seconds, not '0 min'");
});

test("the self-test runs every check and reports no failure", async () => {
  const { P } = state;
  const result = await P.telemetry.runSelfTest({ db: P.db, store: P.store, bus: P.bus, probeNetwork: true });
  assert.ok(result.total >= 8, "checks ran: " + result.total);
  assert.equal(result.fail, 0, "no failing check: " + JSON.stringify(result.checks.filter(function (c) { return !c.ok; })));
  assert.ok(result.pass >= 8);
  const names = result.checks.map(function (c) { return c.name; });
  assert.ok(names.indexOf("IndexedDB opens and counts rows") >= 0, "db check");
  assert.ok(names.some(function (n) { return /client playlist API/.test(n); }), "the client playlist-route check");
});

test("the self-test reports a failing check instead of throwing", async () => {
  const { P } = state;
  const brokenStore = {
    recentChanges: function () { return Promise.reject(new Error("boom")); },
    listWatches: function () { return Promise.reject(new Error("boom")); },
    setMeta: function () { return Promise.resolve(); },
  };
  const result = await P.telemetry.runSelfTest({ db: P.db, store: brokenStore, bus: P.bus, probeNetwork: false });
  assert.ok(result.fail >= 1, "the broken store check failed");
  assert.ok(result.checks.every(function (c) { return typeof c.name === "string" && typeof c.ok === "boolean"; }));
  assert.ok(result.checks.some(function (c) { return c.state === "fail" && /boom/.test(c.detail); }), "the failure detail is kept");
});

test("route loads are timed so bottlenecks show up", async () => {
  const { P } = state;
  const entries = P.telemetry._entries();
  assert.ok(entries.length > 0, "telemetry captured something");
  assert.ok(P.telemetry.slowest(5).length > 0, "slowest list");
});

test("a profile-level log row offers no dead open button", async () => {
  const { P, win } = state;
  // "open" on a row with no playlist target did nothing at all — a silent
  // failure. Only playlist rows get the button.
  const el = win.document.createElement("div");
  win.document.body.appendChild(el);
  try {
    P.react.mount(el, P.ui.Log, {
      loading: false,
      filter: { query: "", kind: "", level: "" },
      rows: [
        { level: "profile", kind: "profile.name.changed", target: "u1", targetName: "Ari", title: "renamed", ts: Date.now() },
        { level: "playlist", kind: "playlist.added", target: "pl1", targetName: "Road Trip", title: "added", ts: Date.now(), uri: "spotify:playlist:pl1" },
      ],
      onOpenRow: function () {},
    });
    await waitFor(function () { return el.querySelectorAll("tbody tr").length === 2; }, "both rows render");
    const opens = Array.from(el.querySelectorAll("tbody tr")).map(function (tr) {
      return !!tr.querySelector("button");
    });
    assert.deepEqual(opens, [false, true], "only the playlist row has an open button: " + JSON.stringify(opens));
  } finally {
    try { if (el._pwtRoot) el._pwtRoot.unmount(); } catch (e) { /* already gone */ }
    if (el.parentNode) el.parentNode.removeChild(el);
  }
});

test("a slow load that finishes after a route change cannot repopulate the old route", async () => {
  const { P, win } = state;
  // `goRoute` drops the previous route's payload so the new route cannot render
  // the old one's data — but a load still in flight used to publish its result
  // afterwards, pushing the abandoned route's rows into the current route's
  // props. App renders from the live `route`, so this is only visible in the
  // props a view is handed.
  const el = win.document.createElement("div");
  win.document.body.appendChild(el);
  const RealApp = P.ui.App;
  let lastProps = null;
  P.ui.App = function (props) {
    lastProps = props;
    return RealApp(props);
  };
  const realChanges = P.store.recentChanges;
  let release;
  const gate = new Promise(function (r) { release = r; });
  try {
    P.store.recentChanges = function () {
      const args = arguments;
      return gate.then(function () { return realChanges.apply(P.store, args); });
    };

    P.react.mount(el, P.ui.AppController, { route: "log" });
    await waitFor(function () { return el.querySelector('[data-pwt-nav="overview"]'); }, "the nav bar");
    el.querySelector('[data-pwt-nav="overview"]').click();
    await waitFor(function () { return lastProps && lastProps.route === "overview"; }, "the overview route");
    const rowsBefore = lastProps.rows;

    release();
    await new Promise(function (r) { setTimeout(r, 200); });

    assert.equal(lastProps.route, "overview", "the route is still the overview");
    assert.deepEqual(lastProps.rows, rowsBefore, "the abandoned load published nothing");
  } finally {
    P.store.recentChanges = realChanges;
    P.ui.App = RealApp;
    try { if (el._pwtRoot) el._pwtRoot.unmount(); } catch (e) { /* already gone */ }
    if (el.parentNode) el.parentNode.removeChild(el);
  }
});

test("a database read failure is reported, never rendered as zero rows", async () => {
  const { P, win } = state;
  // `counts()` used to swallow the error and return {}, and Settings printed
  // "0 change rows" — a read failure indistinguishable from an empty log.
  const el = win.document.createElement("div");
  win.document.body.appendChild(el);
  const realCount = P.db.count;
  P.db.count = async function () { throw new Error("database is sealed"); };
  try {
    P.react.mount(el, P.ui.AppController, { route: "settings" });
    const shown = await waitFor(function () { return el.querySelector(".pwt-error"); }, "the read failure");
    assert.ok(/could not read the local database/i.test(shown.textContent), "the failure is named: " + shown.textContent);
    assert.ok(!/0\s*change rows/.test(el.textContent), "no fabricated zero counts");
  } finally {
    P.db.count = realCount;
    try { if (el._pwtRoot) el._pwtRoot.unmount(); } catch (e) { /* already gone */ }
    if (el.parentNode) el.parentNode.removeChild(el);
  }
});

test("the built bundle boots as a custom app and renders the overview", async () => {
  const { P, win } = state;
  const bundle = fs.readFileSync(path.join(ROOT, "dist", "CustomApps", "Spotispy", "index.js"), "utf8");
  new Function("window", "document", "self", "globalThis", bundle + "; if (typeof render === 'function') window.__render = render;")(win, win.document, win, win);
  const rootEl = win.document.getElementById("root");
  const element = win.__render();
  const client = win.Spicetify.ReactDOM.createRoot(rootEl);
  client.render(element);
  // Wait for the overview to actually paint instead of a fixed sleep: the
  // controller loads from IndexedDB, and a fixed budget is flaky on slow CI
  // runners. Poll for the wordmark and the route-load telemetry entry.
  await waitFor(function () {
    const html = rootEl.innerHTML;
    const names = win.PWT.telemetry._entries().map(function (e) { return e.name; });
    return html.indexOf("spotispy") >= 0 && names.indexOf("load.overview") >= 0 ? true : null;
  }, "bundle overview render", 10000);
  const html = rootEl.innerHTML;
  assert.ok(html.length > 200, "app shell rendered");
  assert.ok(html.indexOf("spotispy") >= 0, "overview wordmark");
  assert.ok(!(/(^|>)\s*undefined\s*(<|$)/.test(html)), "no literal undefined");
  assert.ok(html.indexOf("This view hit a snag") < 0, "no view crashed into the error boundary");
  const names = win.PWT.telemetry._entries().map(function (e) { return e.name; });
  assert.ok(names.indexOf("load.overview") >= 0, "the controller timed its route load");
});

// ---------------------------------------------------------------------------
// The controller, driven through the real UI (not through props).

/** Poll until the condition holds; the controller loads from IndexedDB. */
async function waitFor(fn, label, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 8000);
  for (;;) {
    let value;
    try {
      value = await fn();
    } catch (e) {
      value = null;
    }
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for " + (label || "condition"));
    await new Promise(function (r) { setTimeout(r, 40); });
  }
}

async function mountController(route) {
  const { P, win } = state;
  const el = win.document.createElement("div");
  win.document.body.appendChild(el);
  P.react.mount(el, P.ui.AppController, { route: route });
  if (route === "settings") {
    // A watch row only exists once the controller's settings load finished —
    // before that, the route handlers (self-test, unwatch) are not wired yet.
    await waitFor(function () { return el.querySelector("[data-watch]"); }, "the settings watch list");
  } else if (route === "log") {
    await waitFor(function () { return el.querySelector("tbody tr"); }, "the log rows");
  }
  state.controllers.push(el);
  return el;
}

function unmountControllers() {
  while (state.controllers.length) {
    const el = state.controllers.pop();
    try {
      if (el._pwtRoot) el._pwtRoot.unmount();
    } catch (e) {
      /* already gone */
    }
    if (el.parentNode) el.parentNode.removeChild(el);
  }
}

test("clicking Run self-test shows the check results", async () => {
  const { P, win } = state;
  // Forget any earlier result. The mount-time auto-diag may or may not have
  // rendered the table already; clicking Run self-test must (re)produce it.
  P.telemetry.reset();
  const el = await mountController("settings");
  const button = Array.from(el.querySelectorAll("button")).find((b) => b.textContent.indexOf("Run self-test") >= 0);
  assert.ok(button, "the self-test button is rendered");
  button.click();
  await waitFor(function () { return el.querySelector(".pwt-diag-table"); }, "the results table");
  await waitFor(function () { return el.querySelector(".pwt-badge-success"); }, "a passing check");
  const html = el.innerHTML;
  assert.ok(html.indexOf("IndexedDB opens and counts rows") >= 0, "a named check is listed");
  assert.ok(!(/(^|>)\s*undefined\s*(<|$)/.test(html)), "no literal undefined");
  unmountControllers();
});

test("clicking Run self-test never crashes on an undefined pwt (regression)", async () => {
  const { P } = state;
  const el = await mountController("settings");
  // Let the mount-time auto-diag FULLY settle first (a success badge proves a
  // real completed run), so the click's result is the only writer afterwards.
  // Without this, the passing auto-diag result can mask the click's crash.
  await waitFor(function () { return el.querySelector(".pwt-badge-success"); }, "auto-diag settled");
  await new Promise(function (r) { setTimeout(r, 250); });
  const button = Array.from(el.querySelectorAll("button")).find((b) => b.textContent.indexOf("Run self-test") >= 0);
  assert.ok(button, "the self-test button is rendered");
  button.click();
  // The crash was a synchronous ReferenceError (pwt.telemetry on an undeclared
  // var), so a short settle is enough for the click's result to be final.
  await new Promise(function (r) { setTimeout(r, 500); });
  const html = el.innerHTML;
  assert.ok(html.indexOf("pwt is not defined") < 0, "the self-test never references an undefined pwt");
  assert.ok(html.indexOf("self-test crashed") < 0, "no 'self-test crashed' row is produced");
  assert.ok(html.indexOf("IndexedDB opens and counts rows") >= 0, "the real checks ran: " + html.slice(0, 200));
  unmountControllers();
});

test("unwatching from Settings removes exactly that watch", async () => {
  const { P, win } = state;
  const el = await mountController("settings");
  const row = await waitFor(function () { return el.querySelector('[data-watch="playlist:' + PLAYLIST_ID + '"]'); }, "the watched playlist row");
  const button = Array.from(row.querySelectorAll("button")).find((b) => b.textContent.indexOf("Unwatch") >= 0);
  assert.ok(button, "the unwatch button is rendered");
  button.click();
  await waitFor(async function () { return !(await P.db.get("watches", "playlist:" + PLAYLIST_ID)); }, "the watch to disappear");
  const profileWatch = await P.db.get("watches", "profile:" + USER_ID);
  assert.ok(profileWatch, "the profile watch is untouched");
  unmountControllers();
  // put it back so later tests see the same fixture
  await P.store.putWatch({ kind: "playlist", id: PLAYLIST_ID });
});

test("unwatching from the Profiles view removes the PROFILE watch, not a playlist of the same id", async () => {
  const { P, win } = state;
  // The controller used to guess the kind from the current route, so an id-only
  // call could delete the wrong kind's row (and then the route reloaded as if
  // it had worked). The view knows its kind and must say so.
  const calls = [];
  const el = win.document.createElement("div");
  win.document.body.appendChild(el);
  const row = { id: USER_ID, name: "Ari", avatarUrl: ART.avatarFriend, playlists: [], changes: [], followerHistory: [], watchedAt: state.fx.T0 };
  try {
    P.react.mount(el, P.ui.Profiles, {
      model: { rows: [row], selected: USER_ID },
      loading: false,
      onUnwatch: function (kind, id) {
        calls.push({ kind: kind, id: id });
      },
    });
    await waitFor(function () { return el.querySelector("button"); }, "the profiles detail");
    const button = Array.from(el.querySelectorAll("button")).find((b) => b.textContent.indexOf("Unwatch") >= 0);
    assert.ok(button, "the unwatch button is rendered");
    button.click();
    assert.equal(calls.length, 1, "the handler ran");
    assert.equal(calls[0].kind, "profile", "the view names the kind it is unwatching: " + calls[0].kind);
    assert.equal(calls[0].id, USER_ID, "and the right id");
  } finally {
    try { el._pwtRoot.unmount(); } catch (e) { /* already gone */ }
    if (el.parentNode) el.parentNode.removeChild(el);
  }
});

test("a rejected watch shows the reason instead of failing silently", async () => {
  const { P, win } = state;
  const el = await mountController("settings");
  await waitFor(function () { return el.querySelector('[data-pwt="add-playlist"]'); }, "the add inputs");
  const input = el.querySelector('[data-pwt="add-playlist"]');
  const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value").set;
  setter.call(input, "not-a-playlist");
  input.dispatchEvent(new win.Event("input", { bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 60); });
  const button = Array.from(el.querySelectorAll("button")).find((b) => b.textContent.indexOf("Watch playlist") >= 0);
  assert.ok(button, "the watch button is rendered");
  button.click();
  // The controller sets add.error; the view must render it.
  const shown = await waitFor(function () { return el.querySelector(".pwt-error"); }, "the rejection message");
  assert.ok(/does not look like a playlist/i.test(shown.textContent), "the user is told why: " + shown.textContent);
  unmountControllers();
});

test("the activity search filters the live list in place", async () => {
  const { P, win } = state;
  const html = await render(P, win, P.ui.Activity, {
    model: {
      state: "ok",
      source: "listening-activity",
      lastTick: Date.now(),
      live: P.view.liveStrip(
        [{ userUri: "spotify:user:" + USER_ID, userName: "Ari", avatar: ART.avatarFriend, trackUri: state.fx.tracks[0].uri, contextUri: "spotify:playlist:" + PLAYLIST_ID, isPlaying: true, timestamp: Date.now() - 60000 }],
        {},
        Date.now(),
        state.tracks
      ),
      sessions: [],
      heat: P.view.heatmap([], Date.now()),
      contexts: [],
      presence: [],
    },
    filter: { query: "nobody" },
  });
  assert.ok(html.indexOf("No friend matches the filter") >= 0, "the filtered state is honest");
  assert.ok(html.indexOf("pwt-live-card") < 0, "the live card is filtered out");
});

test("a log filter never blanks the playlist view", async () => {
  const { P, win } = state;
  // The client route reads playlists, so the seeded first scan records a
  // baseline and emits no track change. Seed a different stored snapshot so the
  // next scan is a real diff, which is what gives the log a playlist change to
  // offer and to show.
  if (!state.playlistBaseline) {
    const stored = await P.db.get("snapshots", PLAYLIST_ID);
    if (stored) {
      stored.uris = [pa.trackUri(7), pa.trackUri(8)];
      await P.db.put("snapshots", stored);
    }
    await P.store.putWatch({ kind: "playlist", id: PLAYLIST_ID });
    const booted = P.boot.instance();
    if (booted) await booted.scheduler.runNow({ scope: "playlists", force: true });
    state.playlistBaseline = true;
  }
  const el = await mountController("log");
  // Filter the log by a change kind, then open a playlist from the log.
  const select = el.querySelector('[data-pwt="log-kind"]');
  assert.ok(select, "the log kind filter is rendered");
  const option = Array.from(select.options).find((o) => o.value.indexOf("playlist.") === 0);
  assert.ok(option, "a playlist change kind is offered");
  select.value = option.value;
  select.dispatchEvent(new win.Event("change", { bubbles: true }));
  await waitFor(function () { return el.querySelectorAll("tbody tr").length; }, "the filtered log");
  const row = await waitFor(function () {
    const rows = Array.from(el.querySelectorAll("tbody tr"));
    for (const r of rows) {
      const cells = r.querySelectorAll("td");
      if (cells.length > 2 && cells[2].textContent.indexOf("Night Drive") >= 0) return r;
    }
    return null;
  }, "the playlist row");
  const open = Array.from(row.querySelectorAll("button")).find((b) => b.textContent.indexOf("open") >= 0);
  open.click();
  await waitFor(function () { return el.querySelector(".pwt-playlist"); }, "the playlist view");
  await waitFor(function () { return el.querySelectorAll(".pwt-table-changes tbody tr").length; }, "the playlist rows");
  unmountControllers();
});

test("opening a playlist from the change log opens that playlist", async () => {
  const { P, win } = state;
  const second = PLAYLIST_ID_2;
  await P.store.putWatch({ kind: "playlist", id: second });
  await state.booted.scheduler.runNow({ scope: "playlists", force: true });
  const el = await mountController("log");
  // Pick the row of the SECOND watched playlist: the fallback would open the first.
  const row = await waitFor(function () {
    const rows = Array.from(el.querySelectorAll("tbody tr"));
    for (const r of rows) {
      const cells = r.querySelectorAll("td");
      if (cells.length > 2 && cells[2].textContent.indexOf("Day Drive") >= 0) return r;
    }
    return null;
  }, "the row of the second playlist");
  const open = Array.from(row.querySelectorAll("button")).find((b) => b.textContent.indexOf("open") >= 0);
  assert.ok(open, "the open button is rendered");
  open.click();
  await waitFor(function () { return el.querySelector(".pwt-playlist"); }, "the playlist view");
  const html = el.innerHTML;
  assert.ok(html.indexOf("Day Drive") >= 0, "the opened playlist is the one from the log");
  assert.ok(html.indexOf("Night Drive") < 0, "not the first watched playlist");
  unmountControllers();
  await P.store.removeWatch("playlist", second);
});

test("a playlist being scanned is marked inline while the scan is current on it", async () => {
  const { P, win } = state;
  const m = models(P);
  const dashboard = Object.assign({}, m.overviewModel.dashboard, {
    scan: { scanning: true, stage: "playlists", done: 1, total: 2, current: PLAYLIST_ID, totals: { added: 0 } },
  });
  const html = await render(P, win, P.ui.Overview, {
    vm: { dashboard: dashboard },
    scan: {},
    onScan: function () {},
    onOpenPlaylist: function () {},
    onWatchPlaylist: function () {},
    onNavigate: function () {},
    onOpenProfile: function () {},
  });
  assert.ok(html.indexOf("scanning…") >= 0, "the scan-in-progress marker is rendered");
  const re = new RegExp('class="pwt-user-card is-scanning"[^>]*data-playlist="' + PLAYLIST_ID + '"');
  assert.ok(re.test(html), "the watched playlist card is marked is-scanning");
});

test("no view renders a raw Spotify id or URI as visible text", async () => {
  const { P, win } = state;
  const m = models(P);
  const rendered = [
    await render(P, win, P.ui.Overview, {
      vm: m.overviewModel,
      scan: {},
      onScan: function () {},
      onOpenPlaylist: function () {},
      onWatchPlaylist: function () {},
      onNavigate: function () {},
      onOpenProfile: function () {},
    }),
    await render(P, win, P.ui.Profiles, { model: { rows: [m.profileRowModel], selected: USER_ID }, onSelect: function () {} }),
    await render(P, win, P.ui.Playlist, { model: m.playlistModel, filter: { kind: "", query: "" }, onFilter: function () {} }),
    await render(P, win, P.ui.Activity, {
      model: {
        state: "ok",
        source: "listening-activity",
        lastTick: Date.now(),
        live: m.live,
        sessions: m.sessions,
        heat: P.view.heatmap([{ ts: Date.now(), contextUri: "spotify:playlist:" + PLAYLIST_ID }], Date.now()),
        contexts: P.view.topContexts([{ contextUri: "spotify:playlist:" + PLAYLIST_ID }]),
        presence: P.view.presenceBars([], P.diff.dayKey(Date.now()), Date.now(), state.names),
      },
    }),
    await render(P, win, P.ui.Log, { rows: state.recent, filter: { query: "", kind: "", level: "" }, onFilter: function () {} }),
    await render(P, win, P.ui.Settings, {
      model: P.view.settingsModel(P.config.get(), { os: P.notify.osState(), cacheBytes: 1234567, counts: {} }),
      watches: [
        { kind: "playlist", id: PLAYLIST_ID, label: "Night Drive", image: ART.cover, addedAt: state.fx.T0 },
        { kind: "profile", id: USER_ID, label: "Ari", image: ART.avatarFriend, addedAt: state.fx.T0 },
      ],
      addState: {},
      diag: { running: false, result: null, report: null },
      onSet: function () {},
    }),
  ];
  const stripped = rendered.map(function (html) {
    // Attributes (data-*, title) are stripped; only visible text remains.
    return html.replace(/<[^>]*>/g, " ");
  });
  stripped.forEach(function (text, i) {
    assert.ok(text.indexOf(USER_ID) < 0, "route " + i + " shows the raw user id");
    assert.ok(text.indexOf(PLAYLIST_ID) < 0, "route " + i + " shows the raw playlist id");
    assert.ok(!/spotify:(user|playlist|track|album|artist):/.test(text), "route " + i + " shows a raw spotify uri");
  });
  // Attributes that a user can hover over or that a screen reader reads out
  // must not leak ids either. Placeholders are instructional ("or
  // spotify:playlist:…") and are only checked for literal fixture ids, never
  // for the scheme; data-* attributes (invisible) may carry ids.
  const hoverAttrs = rendered.map(function (html) {
    return html.replace(/<[^>]*>/g, function (tag) {
      const kept = [];
      const m = tag.match(/\s(title|alt|aria-label)="([^"]*)"/g) || [];
      for (const a of m) kept.push(a);
      return " " + kept.join(" ") + " ";
    });
  });
  hoverAttrs.forEach(function (text, i) {
    assert.ok(text.indexOf(USER_ID) < 0, "route " + i + " leaks the raw user id in a hover attribute");
    assert.ok(text.indexOf(PLAYLIST_ID) < 0, "route " + i + " leaks the raw playlist id in a hover attribute");
    assert.ok(!/spotify:(user|playlist|track|album|artist):/.test(text), "route " + i + " leaks a raw spotify uri in a hover attribute");
  });
  const placeholderAttrs = rendered.map(function (html) {
    return html.replace(/<[^>]*>/g, function (tag) {
      const kept = [];
      const m = tag.match(/\s(placeholder|value)="([^"]*)"/g) || [];
      for (const a of m) kept.push(a);
      return " " + kept.join(" ") + " ";
    });
  });
  placeholderAttrs.forEach(function (text, i) {
    assert.ok(text.indexOf(USER_ID) < 0, "route " + i + " leaks the raw user id in a field hint");
    assert.ok(text.indexOf(PLAYLIST_ID) < 0, "route " + i + " leaks the raw playlist id in a field hint");
  });
});

test("a mosaic cover is composited as four 2x2 layers, not one tile", async () => {
  const { P, win } = state;
  const ref = "spotify:mosaic:deadbeef22222222222222222222222222222222:deadbeef33333333333333333333333333333333:deadbeef44444444444444444444444444444444:deadbeef55555555555555555555555555555555";
  const html = await render(P, win, P.uiKit.Img, { src: ref, alt: "Evening Tide", seed: "x", fallbackText: "S" });
  assert.ok(html.indexOf("background-image") >= 0, "composite layers rendered");
  const matches = html.match(/i\.scdn\.co\/image\//g) || [];
  assert.equal(matches.length, 4, "all four mosaic tiles are in the background");
  assert.ok(html.indexOf("50% 50%") >= 0, "each tile sized to a quarter of the cover");
});

test("opening an unwatched playlist shows an honest empty state", async () => {
  const { P, win } = state;
  // A playlist the user never watched has no stored row. Opening one used to
  // render "Untitled playlist" over a table with no columns — a phantom page for
  // data that does not exist.
  //
  // The fixture always watches a playlist, so the controller would render that
  // real one instead. Drop the watch for the duration and put it back.
  const seeded = ((await P.db.getAll("watches")) || []).filter(function (w) {
    return w.kind === "playlist";
  });
  unmountControllers();
  for (const w of seeded) await P.store.removeWatch("playlist", w.id);
  const el = win.document.createElement("div");
  win.document.body.appendChild(el);
  try {
    P.react.mount(el, P.ui.AppController, {
      route: "playlist",
      initial: { playlistId: "neverWatched1234567" },
    });
    const shown = await waitFor(function () {
      const t = el.textContent;
      return /Playlist not watched/i.test(t) ? t : null;
    }, "the not-watched empty state");
    assert.ok(/not watched/i.test(shown), "the view says it is not watched: " + shown.slice(0, 120));
    assert.ok(!/Untitled playlist/.test(shown), "no phantom title: " + shown.slice(0, 120));
  } finally {
    try { if (el._pwtRoot) el._pwtRoot.unmount(); } catch (e) { /* already gone */ }
    if (el.parentNode) el.parentNode.removeChild(el);
    for (const w of seeded) await P.store.putWatch(w);
  }
});
