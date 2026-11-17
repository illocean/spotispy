"use strict";
/**
 * Spotispy — grouped watch list in Settings (UI).
 *
 * Mounts the real Settings view against synthetic watches; no network, no
 * controller, no scheduler. Run with `npm run test:ui`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, stubSpicetify } = require("../support/harness.js");

const state = {};

test.before(() => {
  const { win, P } = boot();
  stubSpicetify(win, { toasts: [], nav: [], get: [], post: [], handlers: [] });
  state.win = win;
  state.P = P;
  state.mounted = [];
});

test.after(() => {
  while (state.mounted && state.mounted.length) {
    const el = state.mounted.pop();
    try { if (el._pwtRoot) el._pwtRoot.unmount(); } catch (e) { /* already gone */ }
    if (el.parentNode) el.parentNode.removeChild(el);
  }
  if (state.P && state.P.db) state.P.db.close();
});

function watchesWithOrphan() {
  return [
    { kind: "profile", id: "u1", label: "Ari One", image: "", addedAt: 1700000000000 },
    { kind: "playlist", id: "p1", label: "Alpha", image: "", addedAt: 1700000000001, ownerId: "u1" },
    { kind: "playlist", id: "p2", label: "Beta", image: "", addedAt: 1700000000002, ownerId: "u1" },
    { kind: "profile", id: "u2", label: "Bea Two", image: "", addedAt: 1700000000003 },
    // u3 is watched by nobody: this playlist must stay visible under "None".
    { kind: "playlist", id: "p3", label: "Orphan", image: "", addedAt: 1700000000004, ownerId: "u3" },
  ];
}

function mountSettings(watches, calls) {
  const { P, win } = state;
  const el = win.document.createElement("div");
  win.document.body.appendChild(el);
  state.mounted.push(el);
  P.react.mount(el, P.ui.Settings, {
    model: P.view.settingsModel(P.config.get(), { os: P.notify.osState(), cacheBytes: 1, counts: {} }),
    watches: watches,
    addState: {},
    diag: {},
    onSet: function () {},
    onUnwatch: function (kind, id) { calls.push({ kind: kind, id: id }); },
  });
  return el;
}

function settle() {
  return new Promise(function (r) { setTimeout(r, 120); });
}

function watchIds(root) {
  return Array.from(root.querySelectorAll("[data-watch]")).map((el) => el.getAttribute("data-watch"));
}

function unwatchButton(root) {
  return Array.from(root.querySelectorAll("button")).find((b) => b.textContent.indexOf("Unwatch") >= 0);
}

test("the watch list nests playlists under their owner and isolates orphans in None", async () => {
  const calls = [];
  const el = mountSettings(watchesWithOrphan(), calls);
  await settle();

  const groups = el.querySelectorAll(".pwt-watch-group");
  assert.equal(groups.length, 3, "two profiles plus the None group");

  const first = groups[0];
  assert.deepEqual(watchIds(first.querySelector(".pwt-watch-group-head")), ["profile:u1"], "the first group head is Ari's row");
  assert.deepEqual(watchIds(first.querySelector(".pwt-watch-children")), ["playlist:p1", "playlist:p2"], "both playlists are nested under Ari");
  assert.ok(first.textContent.indexOf("2 playlists") >= 0, "the child count is shown");

  const second = groups[1];
  assert.deepEqual(watchIds(second.querySelector(".pwt-watch-group-head")), ["profile:u2"], "the empty profile still heads a group");
  assert.equal(second.querySelector(".pwt-watch-children"), null, "no nested list is rendered for a profile with no playlists");

  const none = groups[2];
  assert.ok(none.querySelector(".pwt-watch-group-none"), "the None group is present");
  assert.equal(none.querySelector(".pwt-watch-group-none").textContent, "None");
  assert.deepEqual(watchIds(none.querySelector(".pwt-watch-children")), ["playlist:p3"], "the orphan stays visible");

  // Every row, in every group, keeps its data-watch and its Unwatch button.
  const allRows = el.querySelectorAll(".pwt-watch-row");
  assert.equal(allRows.length, 5, "no watch disappeared");
  Array.from(allRows).forEach((row) => {
    assert.ok(/^(profile|playlist):\S+$/.test(row.getAttribute("data-watch") || ""), "row has data-watch: " + row.outerHTML.slice(0, 120));
    assert.ok(unwatchButton(row), "row has an Unwatch button: " + row.getAttribute("data-watch"));
  });

  const beta = first.querySelector('[data-watch="playlist:p2"]');
  unwatchButton(beta).click();
  assert.deepEqual(calls, [{ kind: "playlist", id: "p2" }], "Unwatch passes kind and id from the nested row");
});

test("the None group is absent when every playlist has a watched owner", async () => {
  const el = mountSettings(watchesWithOrphan().filter((w) => w.id !== "p3"), []);
  await settle();
  const groups = el.querySelectorAll(".pwt-watch-group");
  assert.equal(groups.length, 2, "only the two profile groups");
  assert.equal(el.querySelector(".pwt-watch-group-none"), null, "no None heading");
  assert.deepEqual(watchIds(el.querySelector(".pwt-watch-children")), ["playlist:p1", "playlist:p2"]);
});

test("zero watches keeps the original empty state", async () => {
  const el = mountSettings([], []);
  await settle();
  const empty = el.querySelector(".pwt-watch-list .pwt-empty");
  assert.ok(empty, "the empty state is rendered");
  assert.ok(empty.textContent.indexOf("Nothing watched yet") >= 0);
  assert.equal(el.querySelector(".pwt-watch-group"), null, "no groups");
});
