"use strict";
/**
 * Spotispy — the extension's context-menu actions must not fail silently.
 *
 * Every watch action wrote through `P.store.putWatch` / `removeWatch` /
 * `P.db.put` and only toasted inside `.then()`. A rejected write (quota
 * exhausted, storage blocked, private-mode denial) therefore produced no
 * feedback at all: the menu item appeared to do nothing and the rejection
 * escaped as an unhandled promise rejection. `AGENTS.md` requires every failing
 * action to raise a toast.
 *
 * The extension entry has no export, so each case loads the file against a stub
 * `Spicetify` and invokes the handlers it registered.
 *
 *   node --test tests/extension-menu.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "src", "extension-main.js"), "utf8");

/**
 * Load extension-main.js into a fresh context.
 * @param {object} opts { watchFails, unwatchFails, activityFails }
 */
function loadExtension(opts) {
  opts = opts || {};
  const toasts = [];
  const captured = [];
  const registered = [];
  const writes = [];

  const fail = function (what) {
    return function () {
      const e = new Error(what);
      e.code = "quota";
      return Promise.reject(e);
    };
  };

  const store = {
    putWatch: opts.watchFails
      ? fail(opts.watchFails)
      : function (w) {
          writes.push(["putWatch", w]);
          return Promise.resolve();
        },
    removeWatch: opts.unwatchFails
      ? fail(opts.unwatchFails)
      : function (kind, id) {
          writes.push(["removeWatch", kind, id]);
          return Promise.resolve();
        },
  };

  const db = {
    get: function () {
      return Promise.resolve({ id: "u1", name: "Ari" });
    },
    put: opts.activityFails
      ? fail(opts.activityFails)
      : function (s, row) {
          writes.push(["db.put", s, row]);
          return Promise.resolve();
        },
  };

  const PWT = {
    util: require(path.join(ROOT, "src", "pwt", "util", "util.js")),
    store: store,
    db: db,
    notify: { toast: function (m) { toasts.push(m); } },
    telemetry: { captureError: function (where, e) { captured.push({ where: where, message: String((e && e.message) || e) }); } },
    boot: { instance: function () { return { scheduler: { runNow: function () { return Promise.resolve(); } } }; } },
    // main() boots before the menus register; keep it inert.
    app: { Boot: function () { return { start: function () {}, scheduler: { on: function () {} } }; } },
    config: { get: function () { return {}; } },
  };

  const Spicetify = {
    CosmosAsync: function () {},
    LocalStorage: { get: function () { return null; }, set: function () {} },
    showNotification: function (m) { toasts.push(m); },
    ContextMenu: {
      Item: function (label, handler) {
        const item = { label: label, handler: handler, register: function () { registered.push(item); return item; } };
        return item;
      },
    },
  };

  const sandbox = {
    PWT: PWT,
    Spicetify: Spicetify,
    console: { log: function () {}, error: function () {}, info: function () {} },
    // main() runs off a 500ms poll; fire it synchronously so the menus exist.
    setInterval: function (fn) { fn(); return 0; },
    clearInterval: function () {},
    Promise: Promise,
    Date: Date,
    JSON: JSON,
    String: String,
    Object: Object,
    Array: Array,
    Math: Math,
    isFinite: isFinite,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: "extension-main.js" });

  return {
    registered: registered,
    toasts: toasts,
    captured: captured,
    writes: writes,
    find: function (label) {
      return registered.filter(function (r) { return r.label === label; })[0];
    },
  };
}

/** Let the rejected promise and its .catch run. */
function settle() {
  return new Promise(function (r) { setImmediate(r); });
}

test("a failed Watch playlist raises a toast instead of vanishing", async () => {
  const ext = loadExtension({ watchFails: "the database is sealed" });
  const item = ext.find("Watch playlist");
  assert.ok(item, "the Watch playlist menu item registered");
  item.handler(["spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"]);
  await settle();
  assert.ok(
    ext.toasts.some(function (t) { return /watch playlist failed/i.test(t); }),
    "the user is told the watch failed: " + JSON.stringify(ext.toasts)
  );
  assert.ok(
    ext.toasts.some(function (t) { return /database is sealed/i.test(t); }),
    "and the reason is carried through: " + JSON.stringify(ext.toasts)
  );
  assert.ok(ext.captured.length >= 1, "the failure reached telemetry");
});

test("a failed Unwatch playlist raises a toast instead of vanishing", async () => {
  const ext = loadExtension({ unwatchFails: "read-only" });
  const item = ext.find("Unwatch playlist");
  assert.ok(item, "the Unwatch playlist menu item registered");
  item.handler(["spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"]);
  await settle();
  assert.ok(
    ext.toasts.some(function (t) { return /unwatch playlist failed/i.test(t); }),
    "the user is told the unwatch failed: " + JSON.stringify(ext.toasts)
  );
});

test("a failed Watch profile raises a toast instead of vanishing", async () => {
  const ext = loadExtension({ watchFails: "quota exceeded" });
  const item = ext.find("Watch profile");
  assert.ok(item, "the Watch profile menu item registered");
  item.handler(["spotify:user:aaaaaaaaaaaaaaaaaaaaaa"]);
  await settle();
  assert.ok(
    ext.toasts.some(function (t) { return /watch profile failed/i.test(t); }),
    "the user is told the watch failed: " + JSON.stringify(ext.toasts)
  );
});

test("a failed Watch activity raises a toast instead of vanishing", async () => {
  const ext = loadExtension({ activityFails: "quota exceeded" });
  const item = ext.find("Watch profile for listening activity");
  assert.ok(item, "the Watch activity menu item registered");
  item.handler(["spotify:user:aaaaaaaaaaaaaaaaaaaaaa"]);
  await settle();
  assert.ok(
    ext.toasts.some(function (t) { return /watch activity failed/i.test(t); }),
    "the user is told the activity toggle failed: " + JSON.stringify(ext.toasts)
  );
});

test("a successful Watch playlist still toasts and writes once", async () => {
  // Pin the happy path so the failure handling cannot swallow the success case.
  const ext = loadExtension({});
  const item = ext.find("Watch playlist");
  item.handler(["spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"]);
  await settle();
  assert.equal(ext.writes.length, 1, "exactly one write: " + JSON.stringify(ext.writes));
  assert.equal(ext.writes[0][0], "putWatch", "it was a watch write");
  assert.ok(
    ext.toasts.some(function (t) { return /Watching this playlist/i.test(t); }),
    "the success toast still fires: " + JSON.stringify(ext.toasts)
  );
  assert.ok(
    !ext.toasts.some(function (t) { return /failed/i.test(t); }),
    "and no failure toast: " + JSON.stringify(ext.toasts)
  );
});

test("Watch activity does not claim success when the write rejects", async () => {
  // The write was not returned from its `.then`, so the chain resolved before
  // it settled: the success toast fired and the rejection escaped. Assert the
  // success message is absent, not merely that a failure one is present.
  const ext = loadExtension({ activityFails: "quota exceeded" });
  const item = ext.find("Watch profile for listening activity");
  item.handler(["spotify:user:aaaaaaaaaaaaaaaaaaaaaa"]);
  await settle();
  assert.ok(
    !ext.toasts.some(function (t) { return /Activity watching on/i.test(t); }),
    "no success toast for a write that failed: " + JSON.stringify(ext.toasts)
  );
  assert.ok(
    ext.toasts.some(function (t) { return /watch activity failed/i.test(t); }),
    "the failure is reported instead: " + JSON.stringify(ext.toasts)
  );
});