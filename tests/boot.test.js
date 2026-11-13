"use strict";
/**
 * Spotispy — boot singleton.
 *
 * The extension bundle and the custom-app bundle each carry their own copy of
 * PWT in the same window. `ensure()` must hand both the same scheduler, or the
 * app reads a bus that never ticks and polls run twice per interval.
 *
 *   npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, stubSpicetify } = require("./support/harness.js");

test("ensure() hands out one shared scheduler and one shared bus", async () => {
  const { win, P } = boot();
  stubSpicetify(win, { toasts: [], nav: [], get: [], post: [], handlers: [] });

  assert.equal(P.boot.isBooted(), false, "nothing is booted before the first ensure()");

  const first = P.boot.ensure({ onScanDone: function () {} });
  const second = P.boot.ensure({ onActivity: function () {} });
  assert.equal(first, second, "the second call returns the shared instance");
  assert.equal(P.boot.instance(), first, "instance() returns the shared instance");
  assert.equal(P.boot.isBooted(), true, "isBooted() is true after the first ensure()");
  assert.ok(globalThis.__PWT_BOOT__, "the window-level singleton is recorded");
  assert.equal(globalThis.__PWT_BOOT__, first, "the singleton is the shared instance");
  assert.equal(P.bus, first.scheduler.bus, "pwt.bus points at the shared scheduler bus");

  // Hooks registered by later callers are merged, never dropped.
  let scanDone = 0;
  const a = P.boot.ensure({ onScanDone: function () { scanDone++; } });
  const b = P.boot.ensure({ onActivity: function () {} });
  assert.equal(a, b, "still the same instance");
  await a.scheduler.runNow({ scope: "playlists", force: true });
  assert.equal(scanDone, 1, "a hook registered by a later ensure() still fires");

  await a.stop();
  await P.db.close();
});
