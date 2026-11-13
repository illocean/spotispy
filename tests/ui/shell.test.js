"use strict";
/**
 * Spotispy — shell tests: the navigation bar, failure ribbons and live presence,
 * driven through the real controller against the jsdom fixture.
 *
 *   npm run test:ui
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, stubSpicetify, fixtures, stubHandlers, seed, PLAYLIST_ID, USER_ID } = require("../support/harness.js");

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
  state.controllers = [];
});

test.after(async () => {
  if (state.controllers) {
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
  if (state.booted) await state.booted.stop();
  if (state.P && state.P.db) state.P.db.close();
});

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

function mountController(route) {
  const { P, win } = state;
  const el = win.document.createElement("div");
  win.document.body.appendChild(el);
  P.react.mount(el, P.ui.AppController, { route: route });
  state.controllers.push(el);
  return el;
}

test("the shell renders a navigation bar with every route and back/forward", async () => {
  const { P, win } = state;
  const el = win.document.createElement("div");
  win.document.body.appendChild(el);
  P.react.mount(el, P.ui.App, {
    route: "overview",
    model: {},
    onNavigate: function () {},
    onBack: function () {},
    onForward: function () {},
    canGoBack: true,
    canGoForward: true,
  });
  await new Promise(function (r) { setTimeout(r, 120); });
  const nav = el.querySelector(".pwt-navbar");
  assert.ok(nav, "the navigation bar is rendered");
  const tabs = Array.from(el.querySelectorAll(".pwt-nav-tab")).map(function (b) { return b.getAttribute("data-pwt-nav"); });
  assert.deepEqual(tabs, ["overview", "profiles", "activity", "log", "settings"], "every route has a tab");
  const active = el.querySelector(".pwt-nav-tab.is-active");
  assert.ok(active, "the active tab is marked");
  assert.equal(active.getAttribute("data-pwt-nav"), "overview");
  assert.equal(active.getAttribute("aria-current"), "page");
  const buttons = Array.from(el.querySelectorAll(".pwt-nav-btn"));
  assert.equal(buttons.length, 2, "back and forward buttons");
  assert.ok(buttons.every(function (b) { return !b.disabled; }), "both buttons are enabled when history is available");
  try { el._pwtRoot.unmount(); } catch (e) { /* already gone */ }
  el.remove();
});

test("the scan summary says what the scan did, even when nothing changed", async () => {
  const { P, win } = state;
  const el = win.document.createElement("div");
  win.document.body.appendChild(el);
  const dashboard = {
    profiles: [],
    playlists: [],
    watches: [],
    recent: [],
    daily: {},
    lastScanAt: Date.now() - 1000,
    nextScanAt: Date.now() + 600000,
    lastScanResult: { scope: "all", totals: { added: 0, removed: 0, edits: 0, failed: 0 } },
    scan: { lastScanAt: Date.now() - 1000 },
  };
  P.react.mount(el, P.ui.Overview, {
    vm: { dashboard: dashboard },
    scan: {},
    onScan: function () {},
    onNavigate: function () {},
  });
  await new Promise(function (r) { setTimeout(r, 200); });
  const summary = el.querySelector('[data-pwt="scan-summary"]');
  assert.ok(summary, "the scan summary is rendered");
  assert.ok(/no changes/i.test(summary.textContent), "a scan with no changes says so: " + summary.textContent);

  // And a failing source is named.
  const el2 = win.document.createElement("div");
  win.document.body.appendChild(el2);
  dashboard.lastScanResult = { scope: "all", totals: { added: 1, removed: 0, edits: 0, failed: 3 } };
  P.react.mount(el2, P.ui.Overview, { vm: { dashboard: dashboard }, scan: {}, onScan: function () {}, onNavigate: function () {} });
  await new Promise(function (r) { setTimeout(r, 200); });
  const summary2 = el2.querySelector('[data-pwt="scan-summary"]');
  assert.ok(summary2, "the scan summary is rendered again");
  assert.ok(/3 sources failed/i.test(summary2.textContent), "a failing scan names the failures: " + summary2.textContent);
  try { el._pwtRoot.unmount(); } catch (e) { /* already gone */ }
  el.remove();

  // A failing scan carries the reason, not just the count.
  const el3 = win.document.createElement("div");
  win.document.body.appendChild(el3);
  dashboard.lastScanResult = { scope: "all", totals: { added: 0, removed: 0, edits: 0, failed: 2, errors: [{ name: "Night Drive", error: "web api 429: rate limit" }] } };
  P.react.mount(el3, P.ui.Overview, { vm: { dashboard: dashboard }, scan: {}, onScan: function () {}, onNavigate: function () {} });
  await new Promise(function (r) { setTimeout(r, 200); });
  const summary3 = el3.querySelector('[data-pwt="scan-summary"]');
  assert.ok(summary3, "the scan summary is rendered with a reason");
  assert.ok(/2 sources failed/i.test(summary3.textContent), "the count is honest: " + summary3.textContent);
  assert.ok(summary3.textContent.indexOf("429") >= 0, "the reason is shown inline: " + summary3.textContent);
  try { el3._pwtRoot.unmount(); } catch (e) { /* already gone */ }
  el3.remove();

  // A fully crashed run still says why (the scan never completed at all).
  const el4 = win.document.createElement("div");
  win.document.body.appendChild(el4);
  dashboard.lastScanResult = { scope: "all", totals: { added: 0, removed: 0, edits: 0, failed: 0, errors: [] }, error: "IndexedDB open failed: SchemaError" };
  P.react.mount(el4, P.ui.Overview, { vm: { dashboard: dashboard }, scan: {}, onScan: function () {}, onNavigate: function () {} });
  await new Promise(function (r) { setTimeout(r, 200); });
  const summary4 = el4.querySelector('[data-pwt="scan-summary"]');
  assert.ok(summary4, "a crashed run renders a summary, not silence");
  assert.ok(summary4.textContent.indexOf("IndexedDB open failed") >= 0, "the crash carries its reason: " + summary4.textContent);
  try { el4._pwtRoot.unmount(); } catch (e) { /* already gone */ }
  el4.remove();

  // A pre-fix stored row whose name IS the raw user code must not leak it:
  // the scan summary path itself never shows names, but the Overview rows do,
  // and the scan reporting test pins parseProfile; here we pin that a crash
  // row with a code-shaped name is rendered through the level fallback.
  const el5 = win.document.createElement("div");
  win.document.body.appendChild(el5);
  dashboard.lastScanResult = { scope: "profiles", totals: { added: 0, removed: 0, edits: 0, failed: 1, errors: [{ name: "4444444444444444444444444444", error: "profile endpoint -1: Resolver not found!" }] }, error: "" };
  P.react.mount(el5, P.ui.Overview, { vm: { dashboard: dashboard }, scan: {}, onScan: function () {}, onNavigate: function () {} });
  await new Promise(function (r) { setTimeout(r, 200); });
  const summary5 = el5.querySelector('[data-pwt="scan-summary"]');
  assert.ok(summary5, "a failing source renders a summary");
  assert.ok(summary5.textContent.indexOf("4444444444444444444444444444") < 0, "a code-shaped name is never rendered: " + summary5.textContent);
  assert.ok(/1 source failed/i.test(summary5.textContent), "the failure count is honest: " + summary5.textContent);
  try { el5._pwtRoot.unmount(); } catch (e) { /* already gone */ }
  el5.remove();

  // reset for other tests
  dashboard.lastScanResult = { scope: "all", totals: { added: 0, removed: 0, edits: 0, failed: 0 } };
  try { el2._pwtRoot.unmount(); } catch (e) { /* already gone */ }
  el2.remove();
});

test("back and forward buttons call into XPUI history; disabled without it", async () => {
  const { P, win } = state;
  let backs = 0, forwards = 0;
  const el = win.document.createElement("div");
  win.document.body.appendChild(el);
  P.react.mount(el, P.ui.App, {
    route: "log",
    model: {},
    onNavigate: function () {},
    onBack: function () { backs++; },
    onForward: function () { forwards++; },
    canGoBack: true,
    canGoForward: true,
  });
  await new Promise(function (r) { setTimeout(r, 80); });
  const buttons = Array.from(el.querySelectorAll(".pwt-nav-btn"));
  buttons[0].click();
  buttons[1].click();
  assert.equal(backs, 1, "back called through");
  assert.equal(forwards, 1, "forward called through");
  try { el._pwtRoot.unmount(); } catch (e) { /* already gone */ }
  el.remove();

  const disabled = win.document.createElement("div");
  win.document.body.appendChild(disabled);
  P.react.mount(disabled, P.ui.App, { route: "log", model: {}, onNavigate: function () {} });
  await new Promise(function (r) { setTimeout(r, 80); });
  assert.ok(
    Array.from(disabled.querySelectorAll(".pwt-nav-btn")).every(function (b) { return b.disabled; }),
    "without history the buttons are disabled, never silently wrong"
  );
  try { disabled._pwtRoot.unmount(); } catch (e) { /* already gone */ }
  disabled.remove();
});

test("a failed route load is surfaced in a ribbon; retry reloads", async () => {
  const { P, win } = state;
  let retries = 0;
  const el = win.document.createElement("div");
  win.document.body.appendChild(el);
  P.react.mount(el, P.ui.App, {
    route: "overview",
    model: {},
    error: "IndexedDB open failed: SchemaError — nope\n    at db.js:100",
    onNavigate: function () {},
    onRetry: function () { retries++; },
  });
  await new Promise(function (r) { setTimeout(r, 80); });
  const ribbon = el.querySelector(".pwt-ribbon-load");
  assert.ok(ribbon, "the load-error ribbon is rendered");
  assert.ok(ribbon.textContent.indexOf("IndexedDB open failed") >= 0, "the first line of the error is shown");
  assert.ok(ribbon.textContent.indexOf("db.js") < 0, "the stack trace stays out of the ribbon");
  const retry = Array.from(ribbon.querySelectorAll("button")).find(function (b) { return b.textContent === "retry"; });
  retry.click();
  assert.equal(retries, 1, "retry calls back into the controller");
  try { el._pwtRoot.unmount(); } catch (e) { /* already gone */ }
  el.remove();
});

test("clicking the Activity tab routes to the activity view", async () => {
  const { P, win } = state;
  win.Spicetify.Platform.History.reset();
  const el = mountController("overview");
  await waitFor(function () { return el.querySelector(".pwt-overview"); }, "the overview view");
  const tab = Array.from(el.querySelectorAll(".pwt-nav-tab")).find(function (b) {
    return b.getAttribute("data-pwt-nav") === "activity";
  });
  assert.ok(tab, "the activity tab exists");
  tab.click();
  await waitFor(function () { return el.querySelector(".pwt-activity"); }, "the activity view");
  // The route shows a loading state first; the loaded page has its own heading.
  await waitFor(function () { return el.innerHTML.indexOf("Listening") >= 0; }, "the loaded activity page");
  assert.ok(el.innerHTML.indexOf("Listening") >= 0, "the activity page rendered");
  assert.equal(win.Spicetify.Platform.History.location.pathname, "/Spotispy/activity", "the navigation landed in XPUI history");
});

test("revisiting the current route reloads it instead of stuck on Loading", async () => {
  const { P, win } = state;
  win.Spicetify.Platform.History.reset();
  const el = mountController("overview");
  await waitFor(function () { return el.querySelector(".pwt-overview"); }, "the overview view");
  await waitFor(function () { return !/Loading…/.test(el.textContent); }, "the overview to finish loading");
  // Click the tab of the route we are already on.
  const tab = Array.from(el.querySelectorAll(".pwt-nav-tab")).find(function (b) {
    return b.getAttribute("data-pwt-nav") === "overview";
  });
  tab.click();
  await new Promise(function (r) { setTimeout(r, 300); });
  await waitFor(function () { return !/Loading…/.test(el.textContent); }, "the overview to reload");
  assert.ok(el.querySelector(".pwt-overview"), "the overview is back");
});

test("the selection survives navigating away and back", async () => {
  const { P, win } = state;
  win.Spicetify.Platform.History.reset();
  // A second person, so "the selection was lost" is visible (the fallback
  // would pick the first row instead).
  const second = "bbbbbbbbbbbbbbbbbbbbbb";
  await P.db.put("profiles", { id: second, name: "Bea", avatarUrl: "", playlists: [], plays: [], followers: 7, watchActivity: false, health: "ok" });
  // The roster is the watch list: the fixture must watch this person too.
  await P.store.putWatch({ kind: "profile", id: second });
  const el = mountController("profiles");
  await waitFor(function () { return el.querySelector(".pwt-roster-row"); }, "the roster");
  const rows = Array.from(el.querySelectorAll(".pwt-roster-row"));
  assert.ok(rows.length >= 2, "both people are in the roster");
  const target = rows.find(function (r) { return r.getAttribute("data-user") === second; });
  assert.ok(target, "the second person is listed");
  target.click();
  await waitFor(function () {
    const active = el.querySelector(".pwt-roster-row.is-active");
    return active && active.getAttribute("data-user") === second;
  }, "the second person to be selected");
  const tab = Array.from(el.querySelectorAll(".pwt-nav-tab")).find(function (b) {
    return b.getAttribute("data-pwt-nav") === "overview";
  });
  tab.click();
  await waitFor(function () { return el.querySelector(".pwt-overview"); }, "the overview view");
  const backTab = Array.from(el.querySelectorAll(".pwt-nav-tab")).find(function (b) {
    return b.getAttribute("data-pwt-nav") === "profiles";
  });
  backTab.click();
  await waitFor(function () { return el.querySelector(".pwt-roster-row"); }, "the profiles view again");
  const active = el.querySelector(".pwt-roster-row.is-active");
  assert.ok(active, "a person is still selected");
  assert.equal(active.getAttribute("data-user"), second, "the same person is still selected");
  await P.store.removeWatch("profile", second);
  await P.db.del("profiles", second);
});

test("back and forward walk the app routes through XPUI history", async () => {
  const { P, win, calls } = state;
  win.Spicetify.Platform.History.reset();
  const el = mountController("overview");
  await waitFor(function () { return el.querySelector(".pwt-overview"); }, "the overview view");
  const clickTab = function (name) {
    const tab = Array.from(el.querySelectorAll(".pwt-nav-tab")).find(function (b) {
      return b.getAttribute("data-pwt-nav") === name;
    });
    tab.click();
  };
  // Wait for the history stack itself, not just the DOM: a route change is
  // "done" once its entry is on the stack, and back() only works then.
  const waitDepth = function (n, label) {
    return waitFor(function () {
      return win.Spicetify.Platform.History._stack.length >= n;
    }, label);
  };
  const historyButtons = function () {
    const bs = Array.from(el.querySelectorAll(".pwt-nav-btn"));
    return { back: bs[0], forward: bs[1] };
  };
  clickTab("profiles");
  await waitFor(function () { return el.querySelector(".pwt-profiles"); }, "the profiles view");
  await waitDepth(2, "the profiles history entry");
  clickTab("activity");
  await waitFor(function () { return el.querySelector(".pwt-activity"); }, "the activity view");
  await waitDepth(3, "the activity history entry");
  historyButtons().back.click();
  await waitFor(function () { return el.querySelector(".pwt-profiles"); }, "back to profiles");
  historyButtons().back.click();
  await waitFor(function () { return el.querySelector(".pwt-overview"); }, "back to overview");
  historyButtons().forward.click();
  await waitFor(function () { return el.querySelector(".pwt-profiles"); }, "forward to profiles");
  assert.ok(calls.nav.some(function (n) { return n.op === "goBack"; }), "back went through the history stack");
});

test("the overview offers a Watch activity toggle and a listening-now chip", async () => {
  const { P, win, fx } = state;
  const view = P.view;
  const profiles = (await P.db.getAll("profiles")) || [];
  const playlists = (await P.db.getAll("playlists")) || [];
  const recent = (await P.store.recentChanges(20)) || [];
  const dashboard = {
    profiles: profiles,
    playlists: playlists,
    watches: [
      { kind: "playlist", id: PLAYLIST_ID, addedAt: fx.T0 },
      { kind: "profile", id: USER_ID, addedAt: fx.T0 },
    ],
    recent: recent,
    daily: {},
    lastScanAt: Date.now() - 1000,
    nextScanAt: Date.now() + 600000,
    scan: {},
  };
  let toggled = null;
  const el = win.document.createElement("div");
  win.document.body.appendChild(el);
  P.react.mount(el, P.ui.Overview, {
    vm: { dashboard: dashboard },
    scan: {},
    liveNow: [USER_ID],
    onScan: function () {},
    onOpenPlaylist: function () {},
    onWatchPlaylist: function () {},
    onNavigate: function () {},
    onOpenProfile: function () {},
    onToggleActivity: function (id, enabled) { toggled = { id: id, enabled: enabled }; },
  });
  await new Promise(function (r) { setTimeout(r, 150); });
  const html = el.innerHTML;
  assert.ok(html.indexOf("listening now") >= 0, "the live chip is shown for a friend that is playing");
  const toggle = Array.from(el.querySelectorAll("button")).find(function (b) {
    return /Watch activity|Unwatch activity/.test(b.textContent);
  });
  assert.ok(toggle, "the activity toggle is rendered on the main screen");
  toggle.click();
  assert.deepEqual(toggled, { id: USER_ID, enabled: true }, "the toggle flips the profile flag");
  try { el._pwtRoot.unmount(); } catch (e) { /* already gone */ }
  el.remove();
});
