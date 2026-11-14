"use strict";
/**
 * Spec: the self-test probes the routes this client can actually answer.
 *
 * Live check (Spotify 1.3.9.2055 / Spicetify 2.46.4): the renderer cannot reach
 * api.spotify.com — CosmosAsync resolves {code:429,message:"Failed to fetch"} and
 * a direct fetch() gets 401 — while `Platform.PlaylistAPI.getContents/getMetadata`
 * answer in-process. A self-test that only probes api.spotify.com therefore
 * reports "unreachable" on a perfectly healthy client, which is a lie by
 * omission: nothing in the report distinguishes "no network" from "this client
 * has no route to that host".
 *
 *   npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { boot, stubSpicetify } = require("./support/harness.js");
const pa = require("./support/playlist-api.js");

const ID = "37i9dQZF1DXcBWIGoYBM5M";

function fresh() {
  const { win, P } = boot();
  const calls = { toasts: [], nav: [], get: [], post: [], handlers: [] };
  stubSpicetify(win, calls);
  return { P: P, calls: calls };
}

function check(result, re) {
  return result.checks.filter(function (c) { return re.test(c.name); })[0];
}

test("the self-test reports the client's playlist route as the Web API check", async () => {
  const { P, calls } = fresh();
  try {
    pa.addPlaylist(calls, { id: ID, name: "Night Drive", tracks: [{ uri: pa.trackUri(1) }] });
    const result = await P.telemetry.runSelfTest({ probeNetwork: true });
    const api = check(result, /playlist route|PlaylistAPI/i);
    assert.ok(api, "a playlist-route check exists: " + result.checks.map(function (c) { return c.name; }).join(" | "));
    assert.equal(api.ok, true, "a route that answers is reported ok: " + api.detail);
    assert.ok(/track/i.test(api.detail), "the detail says what it read: " + api.detail);
    assert.ok(calls.playlistApi.getContents.length >= 1, "and it really called the client route");
  } finally {
    await P.db.close();
  }
});

test("the self-test reports a client with no PlaylistAPI as degraded, not as a broken network", async () => {
  const { P } = fresh();
  try {
    const stub = globalThis.Spicetify;
    const saved = stub.Platform.PlaylistAPI;
    delete stub.Platform.PlaylistAPI;
    const result = await P.telemetry.runSelfTest({ probeNetwork: true });
    const api = check(result, /playlist route|PlaylistAPI/i);
    assert.ok(api, "the check still runs when the route is missing");
    assert.equal(api.ok, false, "without the route nothing could be read");
    assert.ok(/unsupported|missing|no playlist route/i.test(api.detail), "the reason names the route, not a transport failure: " + api.detail);
    assert.ok(!/unreachable/i.test(api.detail), "a missing API is not an unreachable host: " + api.detail);
    stub.Platform.PlaylistAPI = saved;
  } finally {
    await P.db.close();
  }
});

test("the self-test no longer diagnoses api.spotify.com as a transport failure", async () => {
  const { P } = fresh();
  try {
    const result = await P.telemetry.runSelfTest({ probeNetwork: true });
    const names = result.checks.map(function (c) { return c.name; }).join(" | ");
    assert.ok(!/api\.spotify\.com/i.test(names), "no check probes a host this client cannot reach: " + names);
    assert.ok(!/Web API reachable/i.test(names), "the misleading check is gone: " + names);
    assert.ok(!result.checks.some(function (c) { return /unreachable —/.test(c.detail); }), "no check reports a transport failure: " + JSON.stringify(result.checks.map(function (c) { return c.detail; })));
  } finally {
    await P.db.close();
  }
});