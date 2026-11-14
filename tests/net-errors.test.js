"use strict";
/**
 * Spotispy — honest network-error reporting.
 *
 * The self-test used to render any failed Web API request as
 * "web api 429: Failed to fetch". There was no 429: the renderer's transport
 * failed before Spotify ever answered. Two things were wrong:
 *
 *  1. asError() read the status out of the message text, so a bare
 *     "Failed to fetch" got no status and no code — the 429 backoff never
 *     engaged and the probe retried the endpoint on every run;
 *  2. the message claimed a status the request never received.
 *
 *   npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot } = require("./support/harness.js");

function fresh() {
  const { win, P } = boot();
  const calls = { toasts: [], nav: [], get: [], post: [], handlers: [] };
  const stub = {
    showNotification: function (m) { calls.toasts.push(m); },
    CosmosAsync: {
      get: async function (url) { return {}; },
      post: async function () { return {}; },
      put: async function () { return {}; },
      del: async function () { return {}; },
    },
    LocalStorage: { get: function () { return null; }, set: function () {} },
  };
  win.Spicetify = stub;
  globalThis.Spicetify = stub;
  return { win, P, calls, stub };
}

test("a transport failure is a network error, never a fabricated status", async () => {
  const { P, stub } = fresh();
  try {
    // Exactly what the renderer throws when it cannot reach the host.
    stub.CosmosAsync.get = async function () {
      throw new TypeError("Failed to fetch");
    };
    await assert.rejects(
      function () { return P.net.call({ method: "get", url: "https://api.spotify.com/v1/me" }); },
      function (e) {
        assert.equal(e.code, "network", "no status was received, so no rate-limit code: " + e.code);
        assert.equal(e.status, undefined, "a transport failure carries no HTTP status: " + e.status);
        return true;
      }
    );
  } finally {
    P.db.close();
  }
});

test("a status on the error alone classifies, even with no digits in the message", async () => {
  const { P, stub } = fresh();
  try {
    // The renderer can attach a status without repeating it in the text. The
    // old code read only the message, so this fell through as "network".
    var boom = new Error("request failed");
    boom.status = 429;
    stub.CosmosAsync.get = async function () { throw boom; };
    P.net.reset();
    await assert.rejects(
      function () { return P.net.call({ method: "get", url: "https://api.spotify.com/v1/x" }); },
      function (e) {
        assert.equal(e.code, "rate", "a status-only 429 is a rate limit: " + e.code);
        assert.equal(e.status, 429, "the status is kept");
        return true;
      }
    );
    assert.ok(P.net._backoff().until > Date.now(), "the backoff engaged so the probe stops hammering");
  } finally {
    P.net.reset();
    P.db.close();
  }
});

test("a real 429 still trips the backoff and keeps its status", async () => {
  const { P, stub } = fresh();
  try {
    var boom = new Error("HTTP 429 Too Many Requests");
    boom.status = 429;
    stub.CosmosAsync.get = async function () { throw boom; };
    P.net.reset();
    await assert.rejects(
      function () { return P.net.call({ method: "get", url: "https://api.spotify.com/v1/x" }); },
      function (e) {
        assert.equal(e.code, "rate", "a genuine 429 is a rate limit: " + e.code);
        assert.equal(e.status, 429, "the status survives classification");
        return true;
      }
    );
    assert.ok(P.net._backoff().until > Date.now(), "the backoff engaged so the probe stops hammering");
  } finally {
    P.net.reset();
    P.db.close();
  }
});

test("the transport's status outranks digits that merely appear in the message", async () => {
  const { P, stub } = fresh();
  try {
    var boom = new Error("upstream said HTTP 429 in a body");
    boom.status = 403;
    stub.CosmosAsync.get = async function () { throw boom; };
    P.net.reset();
    await assert.rejects(
      function () { return P.net.call({ method: "get", url: "https://api.spotify.com/v1/x" }); },
      function (e) {
        assert.equal(e.status, 403, "the transport's own status wins: " + e.status);
        assert.equal(e.code, "forbidden", "so the code follows 403, not the stray 429: " + e.code);
        return true;
      }
    );
    assert.equal(P.net._backoff().until, 0, "a 403 must not engage the rate backoff");
  } finally {
    P.net.reset();
    P.db.close();
  }
});

test("describeError never calls an unreachable endpoint a 429", () => {
  const { P } = fresh();
  try {
    var e = new Error("Failed to fetch");
    e.code = "network";
    var text = P.net.describeError(e);
    assert.ok(!/429/.test(text), "no fabricated rate limit: " + text);
    assert.ok(/no response from the endpoint/i.test(text), "it says what actually happened: " + text);

    var rate = new Error("HTTP 429 Too Many Requests");
    rate.status = 429;
    rate.code = "rate";
    var text2 = P.net.describeError(rate);
    assert.ok(/429/.test(text2), "a real 429 is reported with its status: " + text2);

    var offline = new Error("Spicetify.CosmosAsync is unavailable");
    offline.code = "nosession";
    assert.ok(/no client session/i.test(P.net.describeError(offline)), "a missing session is named as such");
  } finally {
    P.db.close();
  }
});

test("an error body is an answer from Spotify, never 'unreachable'", () => {
  const { P } = fresh();
  try {
    // Cosmos resolves {code,message} for a dead endpoint. That is a reply.
    var body = { code: -1, message: "Resolver not found!" };
    var text = P.net.describeError(body);
    assert.ok(!/unreachable/i.test(text), "a resolved body is not an unreachable host: " + text);
    assert.ok(/Resolver not found/.test(text), "the body's own words are shown: " + text);

    var rate = { code: 429, message: "Too many requests" };
    var text2 = P.net.describeError(rate);
    assert.ok(!/unreachable/i.test(text2), "a 429 body is not unreachable: " + text2);
    assert.ok(/429/.test(text2), "the rate limit is named: " + text2);
  } finally {
    P.db.close();
  }
});

test("a word-only rate limit still backs off, an unreachable host never does", async () => {
  const { P, stub } = fresh();
  try {
    var boom = new Error("rate limit exceeded");
    boom.status = 429;
    stub.CosmosAsync.get = async function () { throw boom; };
    P.net.reset();
    await assert.rejects(
      function () { return P.net.call({ method: "get", url: "https://api.spotify.com/v1/x" }); },
      function (e) { return e.code === "rate"; }
    );
    assert.ok(P.net._backoff().until > Date.now(), "a rate limit backs the poller off");

    P.net.reset();
    stub.CosmosAsync.get = async function () { throw new TypeError("Failed to fetch"); };
    await assert.rejects(
      function () { return P.net.call({ method: "get", url: "https://api.spotify.com/v1/y" }); },
      function (e) { return e.code === "network"; }
    );
    assert.equal(P.net._backoff().until, 0, "an unreachable host must not be treated as a rate limit");
  } finally {
    P.net.reset();
    P.db.close();
  }
});

test("a resolved body that is network-ish keeps its answer, and an empty body stays honest", () => {
  const { P } = fresh();
  try {
    // A body whose code is the local "network" default is not a server answer:
    // it must be described as a transport failure, never as "web api network".
    var netish = { code: "network", message: "socket closed" };
    var t = P.net.describeError(netish);
    assert.ok(!/web api network/.test(t), "a local code is not a server answer: " + t);
    assert.ok(/no response from the endpoint/.test(t), "it says the endpoint did not answer: " + t);

    // An empty object must not be dressed up as a server error.
    var empty = P.net.describeError({});
    assert.ok(!/web api undefined/.test(empty), "no fabricated 'web api undefined': " + empty);
    assert.ok(/no response/.test(empty), "an empty failure says only what is known: " + empty);
  } finally {
    P.db.close();
  }
});

test("a nested error body's status classifies and is described honestly", () => {
  const { P, stub } = fresh();
  try {
    var boom = new Error("request failed");
    boom.error = { status: 429, message: "Too Many Requests" };
    stub.CosmosAsync.get = async function () { throw boom; };
    P.net.reset();
    return assert.rejects(
      function () { return P.net.call({ method: "get", url: "https://api.spotify.com/v1/x" }); },
      function (e) {
        assert.equal(e.status, 429, "the nested status is read: " + e.status);
        assert.equal(e.code, "rate", "and classified: " + e.code);
        return true;
      }
    ).then(function () {
      assert.ok(P.net._backoff().until > Date.now(), "the nested 429 backs off");
    });
  } finally {
    P.net.reset();
    P.db.close();
  }
});

test("prose never outranks a meaningful code, but fills in a generic one", async () => {
  const { P, stub } = fresh();
  try {
    // A real code is stronger evidence than a word in the message.
    var named = new Error("rate limit");
    named.code = "nosession";
    stub.CosmosAsync.get = async function () { throw named; };
    P.net.reset();
    await assert.rejects(
      function () { return P.net.call({ method: "get", url: "https://api.spotify.com/v1/x" }); },
      function (e) {
        assert.equal(e.code, "nosession", "a meaningful code survives the prose: " + e.code);
        return true;
      }
    );

    // A generic code is filled in by the prose.
    var generic = new Error("rate limit exceeded");
    generic.code = "network";
    stub.CosmosAsync.get = async function () { throw generic; };
    P.net.reset();
    await assert.rejects(
      function () { return P.net.call({ method: "get", url: "https://api.spotify.com/v1/y" }); },
      function (e) {
        assert.equal(e.code, "rate", "prose classifies an otherwise generic code: " + e.code);
        return true;
      }
    );
    assert.ok(P.net._backoff().until > Date.now(), "and it backs off");

    // Prose saying "rate limit" must not turn a real 401 into a rate limit.
    var unauthorized = new Error("rate limit exceeded but really unauthorized");
    unauthorized.status = 401;
    stub.CosmosAsync.get = async function () { throw unauthorized; };
    P.net.reset();
    await assert.rejects(
      function () { return P.net.call({ method: "get", url: "https://api.spotify.com/v1/z" }); },
      function (e) {
        assert.equal(e.code, "unauthorized", "a status outranks prose: " + e.code);
        return true;
      }
    );
  } finally {
    P.net.reset();
    P.db.close();
  }
});

test("a nested body object never leaks '[object Object]' into a message", () => {
  const { P } = fresh();
  try {
    // The renderer can throw with a structured body and no message.
    var e = P.net.describeError({ error: { status: 503 } });
    assert.ok(!/\[object Object\]/.test(e), "no [object Object] in the wording: " + e);
    assert.ok(/503/.test(e), "the real status is shown: " + e);
  } finally {
    P.db.close();
  }
});

test("the self-test reports a failing client playlist route, without a fake 429", async () => {
  const { P, stub } = fresh();
  try {
    // The client's playlist route is present but throws, as it does for a
    // playlist this account cannot read. (This file's stub has no Platform, so
    // add the one object the probe needs.)
    stub.Platform = stub.Platform || {};
    stub.Platform.PlaylistAPI = {
      getContents: async function () {
        throw new TypeError("Failed to fetch");
      },
      getMetadata: async function () {
        throw new TypeError("Failed to fetch");
      },
    };
    var result = await P.telemetry.runSelfTest({ probeNetwork: true });
    var pl = result.checks.filter(function (c) { return /Playlist route/.test(c.name); })[0];
    assert.ok(pl, "the playlist-route check ran");
    assert.equal(pl.ok, false, "the route genuinely did not answer");
    assert.ok(!/429/.test(pl.detail), "the detail never invents a rate limit: " + pl.detail);
    assert.ok(/failed/i.test(pl.detail), "the detail says the route failed: " + pl.detail);
  } finally {
    P.db.close();
  }
});

test("a resolved {code:429,message:'Failed to fetch'} body is unreachable, not a 429 (the live client shape)", async () => {
  const { P, stub } = fresh();
  try {
    // Exactly what the live client resolves for an unreachable Web API: an
    // error body whose message is the renderer's transport-failure signature,
    // with a bogus 429 code attached. It must never read as a rate limit.
    stub.CosmosAsync.get = async function () { return { code: 429, message: "Failed to fetch" }; };
    var text = P.net.describeError({ code: 429, message: "Failed to fetch" });
    assert.ok(!/429/.test(text), "describeError never invents a 429 for a transport failure: " + text);
    assert.ok(/no response from the endpoint/i.test(text), "it says the endpoint did not answer: " + text);

    // And the live shape through the self-test: the client route is present but
    // answers an error body, which must be reported as an error, not a rate limit.
    var result = await P.telemetry.runSelfTest({ probeNetwork: true });
    var pl = result.checks.filter(function (c) { return /Playlist route/.test(c.name); })[0];
    assert.ok(pl, "the playlist-route check ran");
    assert.equal(pl.ok, false, "the route genuinely did not answer");
    assert.ok(!/429/.test(pl.detail), "the selftest never invents a rate limit: " + pl.detail);
  } finally {
    P.db.close();
  }
});

test("a genuine 429 error body is still reported as a rate limit", () => {
  const { P } = fresh();
  try {
    var text = P.net.describeError({ code: 429, message: "Too many requests" });
    assert.ok(/429/.test(text), "a real rate-limit body keeps its status: " + text);
    assert.ok(!/no response from the endpoint/i.test(text), "it is not called unreachable: " + text);
  } finally {
    P.db.close();
  }
});

test("a nested transport error body is unreachable, never a http 429", async () => {
  const { P, stub } = fresh();
  try {
    // A client that nests the real transport failure under `error` with a bogus
    // status on the outer body: the nested "Failed to fetch" must win.
    stub.CosmosAsync.get = async function () {
      throw { message: "request failed", error: { status: 429, message: "Failed to fetch" } };
    };
    P.net.reset();
    var caught;
    await P.net.call({ method: "get", url: "https://api.spotify.com/v1/x" }).then(
      function () { throw new Error("should have rejected"); },
      function (e) { caught = e; }
    );
    assert.equal(caught.code, "network", "a nested transport failure is network: " + caught.code);
    assert.ok(!/429|http/i.test(P.net.describeError(caught)), "describeError never invents a 429: " + P.net.describeError(caught));
    assert.ok(/no response from the endpoint/i.test(P.net.describeError(caught)), "it says no response: " + P.net.describeError(caught));
    assert.equal(P.net._backoff().until, 0, "an unreachable host must not engage the rate backoff");
  } finally {
    P.net.reset();
    P.db.close();
  }
});

test("a nested genuine 429 body still reports http 429 (no regression)", async () => {
  const { P, stub } = fresh();
  try {
    stub.CosmosAsync.get = async function () {
      throw { message: "request failed", error: { status: 429, message: "Too Many Requests" } };
    };
    P.net.reset();
    var caught;
    await P.net.call({ method: "get", url: "https://api.spotify.com/v1/x" }).then(
      function () { throw new Error("should have rejected"); },
      function (e) { caught = e; }
    );
    assert.equal(caught.code, "rate", "a nested real 429 is a rate limit: " + caught.code);
    assert.ok(/429/.test(P.net.describeError(caught)), "the status is named: " + P.net.describeError(caught));
    assert.ok(P.net._backoff().until > 0, "a real 429 still engages the backoff");
  } finally {
    P.net.reset();
    P.db.close();
  }
});

test("a resolved nested transport body is unreachable, never a 429 (bodyError path)", () => {
  const { P } = fresh();
  try {
    var be = P.net.bodyError({ message: "request failed", error: { status: 429, message: "Failed to fetch" } });
    assert.ok(be && be.transport, "the resolved nested transport body is flagged transport");
    assert.equal(P.net.bodyErrorCode(be, "network"), "network", "classified network, never rate");
    var text = P.net.describeError({ message: "request failed", error: { status: 429, message: "Failed to fetch" } });
    assert.ok(!/429/.test(text), "describeError never invents a 429 for a resolved nested transport body: " + text);
    assert.ok(/no response from the endpoint/i.test(text), "it says no response: " + text);
    // A resolved nested genuine 429 stays a rate limit.
    var rate = P.net.bodyError({ message: "request failed", error: { status: 429, message: "Too Many Requests" } });
    assert.equal(rate.transport, false, "a nested real 429 is not a transport failure");
    assert.ok(/429/.test(P.net.describeError({ message: "request failed", error: { status: 429, message: "Too Many Requests" } })), "a nested real 429 keeps its status");
  } finally {
    P.db.close();
  }
});

test("the self-test reports a message-only transport body as a failure, not a lost session", async () => {
  const { P, stub } = fresh();
  try {
    // A body with only a transport-failure message (no code): the profile probe
    // must report the body's own words rather than a fabricated status.
    stub.CosmosAsync.get = async function () { return { message: "Failed to fetch" }; };
    var result = await P.telemetry.runSelfTest({ probeNetwork: true });
    var api = result.checks.filter(function (c) { return /Profile route/.test(c.name); })[0];
    assert.ok(api, "the profile-route check ran");
    assert.equal(api.ok, false, "the route did not answer");
    assert.ok(/failed to fetch/i.test(api.detail), "the body's own reason is shown: " + api.detail);
    assert.ok(!/429/.test(api.detail), "no fabricated 429: " + api.detail);
  } finally {
    P.db.close();
  }
});

test("a transport body thrown (not resolved) keeps the honest network code, never a 429", async () => {
  const { P, stub } = fresh();
  try {
    // A client that rejects with the body instead of resolving it: the code
    // stamped on the Error must still not be a fabricated rate limit.
    stub.CosmosAsync.get = async function () {
      throw { code: 429, message: "Failed to fetch" };
    };
    P.net.reset();
    await assert.rejects(
      function () { return P.net.call({ method: "get", url: "https://api.spotify.com/v1/x" }); },
      function (e) {
        assert.equal(e.code, "network", "a transport failure is network, not a 429: " + e.code);
        assert.equal(e.status, undefined, "no status was received: " + e.status);
        return true;
      }
    );
    assert.equal(P.net._backoff().until, 0, "an unreachable host must not engage the rate backoff");
  } finally {
    P.net.reset();
    P.db.close();
  }
});

test("a thrown transport error carrying a bogus status is never reported as http 429", async () => {
  const { P, stub } = fresh();
  try {
    // A renderer that throws an Error with "Failed to fetch" AND a bogus
    // status attached: the status must not win over the transport signature.
    stub.CosmosAsync.get = async function () {
      var e = new Error("Failed to fetch");
      e.status = 429;
      throw e;
    };
    P.net.reset();
    var caught;
    await P.net.call({ method: "get", url: "https://api.spotify.com/v1/x" }).then(
      function () { throw new Error("should have rejected"); },
      function (e) { caught = e; }
    );
    assert.equal(caught.code, "network", "the code is network, not rate: " + caught.code);
    assert.equal(caught.status, undefined, "the fabricated status is dropped: " + caught.status);
    assert.ok(!/429/.test(P.net.describeError(caught)), "describeError never says http 429: " + P.net.describeError(caught));
    assert.ok(/no response from the endpoint/i.test(P.net.describeError(caught)), "it says no response: " + P.net.describeError(caught));
    assert.equal(P.net._backoff().until, 0, "an unreachable host must not engage the rate backoff");
  } finally {
    P.net.reset();
    P.db.close();
  }
});

test("isTransportFailure recognises the renderer's transport-failure messages only", () => {
  const U = require("../src/pwt/util/util.js");
  for (const m of ["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource.", "The network connection was lost"]) {
    assert.equal(U.isTransportFailure(m), true, "transport signature: " + m);
  }
  for (const m of ["Too many requests", "Resolver not found!", "HTTP 429 Too Many Requests", "Network error", "upstream network error, retry", "", null, undefined]) {
    assert.equal(U.isTransportFailure(m), false, "not a transport signature: " + m);
  }
});

test("the shared bodyError helper flags transport failures and classifies them network", () => {
  const { P } = fresh();
  try {
    // The live client shape: a transport failure resolved as a body with a bogus 429.
    var be = P.net.bodyError({ code: 429, message: "Failed to fetch" });
    assert.ok(be, "a body with code+message is an error body");
    assert.equal(be.transport, true, "a transport-failure message is flagged");
    assert.equal(P.net.bodyErrorCode(be, "network"), "network", "classified network, never rate");
    assert.ok(!/429/.test(P.net.bodyErrorMessage("profile endpoint", be)), "wording never invents a 429: " + P.net.bodyErrorMessage("profile endpoint", be));
    assert.ok(/unreachable/i.test(P.net.bodyErrorMessage("profile endpoint", be)), "wording says unreachable: " + P.net.bodyErrorMessage("profile endpoint", be));

    // A genuine rate limit stays a rate limit.
    var rate = P.net.bodyError({ code: 429, message: "Too many requests" });
    assert.equal(rate.transport, false, "a real 429 body is not a transport failure");
    assert.equal(P.net.bodyErrorCode(rate, "network"), "rate", "classified rate");
    assert.ok(/429/.test(P.net.bodyErrorMessage("web api", rate)), "wording keeps the 429: " + P.net.bodyErrorMessage("web api", rate));

    // A real payload is not an error body.
    assert.equal(P.net.bodyError({ items: [], total: 0 }), null, "a real payload is not an error body");
    assert.equal(P.net.bodyError({ name: "x", uri: "spotify:playlist:abc" }), null, "a parsed entity is not an error body");
    assert.equal(P.net.bodyError(null), null, "null is not an error body");
    assert.equal(P.net.bodyError([]), null, "an array is not an error body");
  } finally {
    P.db.close();
  }
});