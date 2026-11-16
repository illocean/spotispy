"use strict";
/**
 * Spotispy — notification settings must actually gate the channels.
 *
 * `notifyOs`, `notifyAdditions`, `notifyRemovals` and `notifyProfile` were
 * rendered as toggles but never read, so switching them off changed nothing.
 *
 *   npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");

/**
 * Load notify.js against a stub Spicetify on `globalThis`, with a controllable
 * config and a fake `Notification`, so each channel can be observed.
 */
function loadNotify(settings) {
  const toasts = [];
  const os = [];
  const prev = {
    Spicetify: globalThis.Spicetify,
    Notification: globalThis.Notification,
    PWT: globalThis.PWT,
    document: globalThis.document,
  };

  globalThis.Spicetify = {
    showNotification: function (m) {
      toasts.push(m);
    },
  };
  // A granted, constructible Notification so the OS channel is reachable.
  globalThis.Notification = function (title, opts) {
    os.push({ title: title, body: opts && opts.body });
  };
  globalThis.Notification.permission = "granted";
  // Unfocused, so emit() prefers the OS channel — the only way to see notifyOs
  // make a difference.
  globalThis.document = { hasFocus: function () { return false; } };

  const api = (function () {
    const src = require("fs").readFileSync(path.join(ROOT, "src", "pwt", "core", "notify.js"), "utf8");
    const m = { exports: {} };
    new Function("module", "exports", src + "\n//# sourceURL=notify-under-test.js")(m, m.exports);
    return m.exports;
  })();

  // Patch config.get for this load: notify reads it live.
  globalThis.PWT = { config: { get: function () { return settings; } } };

  return {
    api: api,
    toasts: toasts,
    os: os,
    restore: function () {
      if (prev.Spicetify === undefined) delete globalThis.Spicetify;
      else globalThis.Spicetify = prev.Spicetify;
      if (prev.Notification === undefined) delete globalThis.Notification;
      else globalThis.Notification = prev.Notification;
      if (prev.PWT === undefined) delete globalThis.PWT;
      else globalThis.PWT = prev.PWT;
      if (prev.document === undefined) delete globalThis.document;
      else globalThis.document = prev.document;
    },
  };
}

test("digest omits the classes of change the user switched off", () => {
  const base = { notifyAdditions: true, notifyRemovals: true, notifyProfile: true };
  const counts = { added: 2, removed: 1, edits: 3 };

  let n = loadNotify(Object.assign({}, base));
  try {
    assert.equal(n.api.digest(counts), "+2 tracks, −1 track, 3 changes");
  } finally {
    n.restore();
  }

  n = loadNotify(Object.assign({}, base, { notifyAdditions: false }));
  try {
    assert.equal(n.api.digest(counts), "−1 track, 3 changes", "additions are dropped");
  } finally {
    n.restore();
  }

  n = loadNotify(Object.assign({}, base, { notifyRemovals: false }));
  try {
    assert.equal(n.api.digest(counts), "+2 tracks, 3 changes", "removals are dropped");
  } finally {
    n.restore();
  }

  n = loadNotify(Object.assign({}, base, { notifyProfile: false }));
  try {
    assert.equal(n.api.digest(counts), "+2 tracks, −1 track", "profile edits are dropped");
  } finally {
    n.restore();
  }

  n = loadNotify(Object.assign({}, base, { notifyAdditions: false, notifyRemovals: false, notifyProfile: false }));
  try {
    assert.equal(n.api.digest(counts), "", "all three off leaves nothing to say");
  } finally {
    n.restore();
  }
});

test("notifyOs:false keeps the OS channel quiet while unfocused", () => {
  const on = loadNotify({ notifyOs: true, notifyToast: true });
  try {
    assert.equal(on.api.emit("Spotispy scan", "hello"), true, "it reports a send");
    assert.equal(on.os.length, 1, "the OS channel was used");
  } finally {
    on.restore();
  }

  const off = loadNotify({ notifyOs: false, notifyToast: true });
  try {
    off.api.emit("Spotispy scan", "hello");
    assert.equal(off.os.length, 0, "notifyOs:false means no OS notification");
  } finally {
    off.restore();
  }
});

test("notifyToast:false silences the in-app toast while FOCUSED", () => {
  // Focused, the toast is the only channel available (the OS one is for when
  // Spotify is in the background). The toggle has to gate it here too: it used
  // to be applied only when `!focused()`, so switching toasts off changed
  // nothing at all for someone actually looking at the client.
  const n = loadNotify({ notifyOs: true, notifyToast: false });
  try {
    globalThis.document = { hasFocus: function () { return true; } };
    const r = n.api.emit("Spotispy scan", "hello");
    assert.equal(n.toasts.length, 0, "the toast toggle gates the in-app channel");
    assert.equal(r, false, "and emit says nothing was sent");
  } finally {
    n.restore();
  }
});

test("notifyToast:false still allows the OS channel while unfocused", () => {
  // The OS channel is the one that works in the background, so "no toasts" must
  // not mean "no notifications at all" — that would silently drop every alert
  // for anyone who has Spotify minimised.
  const n = loadNotify({ notifyOs: true, notifyToast: false });
  try {
    globalThis.document = { hasFocus: function () { return false; } };
    const r = n.api.emit("Spotispy scan", "hello");
    assert.equal(n.os.length, 1, "the OS channel still carried it");
    assert.equal(n.toasts.length, 0, "and no in-app toast was raised");
    assert.equal(r, true, "emit reports a send");
  } finally {
    n.restore();
  }
});

test("notifyToast:true still toasts while focused", () => {
  // The default path, pinned so the fix above cannot over-gate it.
  const n = loadNotify({ notifyOs: true, notifyToast: true });
  try {
    globalThis.document = { hasFocus: function () { return true; } };
    const r = n.api.emit("Spotispy scan", "hello");
    assert.equal(n.toasts.length, 1, "a focused user gets the in-app toast");
    assert.equal(r, true, "and emit reports a send");
  } finally {
    n.restore();
  }
});