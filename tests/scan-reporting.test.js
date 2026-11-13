"use strict";
/**
 * Spotispy — scan-failure reporting and display-name resolution.
 *
 * The UI can only be honest about a scan it actually hears about. Two things
 * used to vanish:
 *  - a profile scan that threw (or that every source failed) was never counted
 *    in `totals.failed`, so nothing anywhere said why the scan was dead;
 *  - the scan's failure list was dropped by the scheduler, so even a fully
 *    crashed run left the Overview with no explanation.
 *
 * And a person is shown by their real display name, never by the raw user
 * code current builds put under `username`/`name`.
 *
 *   npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, stubSpicetify, fixtures, stubHandlers, seed, USER_ID } = require("./support/harness.js");

globalThis.PWT_ART_DISABLED = true;

test("parseProfile prefers the display name and rejects the user code", () => {
  const Profiles = require("../src/pwt/core/profiles.js");
  const id = "4444444444444444444444444444"; // 28 chars, shaped like what the client hands out

  const a = Profiles.parseProfile({ uri: "spotify:user:" + id, name: id, display_name: "Night Owl" });
  assert.equal(a.name, "Night Owl", "the display name wins over the user code");

  const b = Profiles.parseProfile({ uri: "spotify:user:" + id, username: id });
  assert.equal(b.name, "", "an id-only payload resolves to an honest empty name, never the code");

  const c = Profiles.parseProfile({ uri: "spotify:user:" + id, name: "Aria" });
  assert.equal(c.name, "Aria");

  const d = Profiles.parseProfile({ uri: "spotify:user:" + id, name: "Ari", display_name: "" });
  assert.equal(d.name, "Ari", "an empty display_name falls through to the next candidate");
});

test("a failing profile scan is counted and written to lastScanResult with the reason", async () => {
  const { win, P } = boot();
  const calls = { toasts: [], nav: [], get: [], post: [], handlers: [] };
  stubSpicetify(win, calls);
  const fx = fixtures();
  stubHandlers(fx, calls);
  const booted = await seed(P, fx);

  // Sanity: the fixture scan succeeded and the result was recorded.
  const good = await P.db.get("meta", "lastScanResult");
  assert.ok(good, "the good scan recorded a result");

  // Force every profile request to answer with an error body, the way the
  // client does when an endpoint is unreachable or blocked.
  const bad = {
    test: function (u) { return u.indexOf("/user-profile-view/v3/profile/") >= 0 && u.indexOf("/followers") < 0 && u.indexOf("/following") < 0; },
    value: { code: -1, message: "Resolver not found!" },
  };
  calls.handlers.unshift(bad);
  await booted.scheduler.runNow({ scope: "profiles", force: true });
  calls.handlers.shift();

  const broken = await P.db.get("meta", "lastScanResult");
  assert.ok(broken, "the failed scan still recorded a result instead of nothing");
  assert.ok(broken.value.totals.failed >= 1, "the profile failure is counted: " + JSON.stringify(broken.value));
  assert.ok(Array.isArray(broken.value.totals.errors) && broken.value.totals.errors.length >= 1, "the reason is recorded: " + JSON.stringify(broken.value));
  assert.ok(broken.value.totals.errors.some(function (e) { return /Resolver/i.test(String(e.error || "")); }), "the recorded reason names the endpoint problem");

  // Restore the good handler; the next scan is healthy again.
  await booted.scheduler.runNow({ scope: "profiles", force: true });
  const repaired = await P.db.get("meta", "lastScanResult");
  assert.equal((repaired.value.totals || {}).failed || 0, 0, "once the endpoint answers, the tally is clean");

  await booted.stop();
  await P.db.close();
  void win;
  void USER_ID;
});
