/* eslint-disable */
/**
 * Spotispy — the single network door.
 *
 * Every request goes through `net.get/post` on top of `Spicetify.CosmosAsync`
 * so the client's session is attached automatically. Some routes are not HTTP at
 * all (the client's own PlaylistAPI and GraphQL helpers) and are run in-process
 * through the same door. On top of that door:
 *  - in-flight de-duplication (UI and scheduler share one promise);
 *  - a negative cache (deleted/private/unreachable targets back off 6 h);
 *  - 429 handling with exponential backoff, and a concurrency-capped queue;
 *  - capability probes that report ok / degraded / unavailable instead of
 *    guessing, so the UI can be honest about what this client can read.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.net = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var NEGATIVE_TTL = 6 * 3600000;
  var inflight = Object.create(null);
  var negative = Object.create(null);
  var backoff = { until: 0, step: 0 };

  function cosmos() {
    // Read through the live object: Spicetify is installed by the host after the
    // app's scripts load, so a captured reference would go stale.
    var S = root.Spicetify || (root.window && root.window !== root && root.window.Spicetify);
    return S && S.CosmosAsync ? S.CosmosAsync : null;
  }

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  function fail(message, code, status) {
    var e = new Error(message);
    e.code = code || "error";
    if (status) e.status = status;
    return e;
  }

  function asError(err) {
    var src = err || {};
    // Some clients nest the real body under `error`
    // (`{message:"request failed", error:{status,message}}`); consult the
    // nested message too, so a transport signature there is not missed.
    var nestedMsg = src.error && typeof src.error === "object" && src.error.message != null ? String(src.error.message) : "";
    var topMsg = src.message != null ? src.message : src.error != null ? src.error : err;
    // A nested body stringifies to "[object Object]"; say so honestly instead
    // of printing that into the UI and the telemetry.
    var msg = topMsg && typeof topMsg === "object" ? "the endpoint returned an error" : String(topMsg || "request failed");
    var e = fail(msg, "network");
    // The transport's own status outranks the message text: the renderer throws
    // a bare TypeError ("Failed to fetch") for an unreachable host, and a
    // message that happens to contain digits must not invent a status the
    // request never received. Some clients nest the body under `error`.
    var status = src.status != null ? Number(src.status) : src.error && src.error.status != null ? Number(src.error.status) : NaN;
    if (isFinite(status)) e.status = status;
    else {
      var m = /(\b4\d\d\b|\b5\d\d\b)/.exec(msg);
      if (m) e.status = Number(m[1]);
    }
    // Prose is a hint for a code that means nothing ("network", "error") — an
    // actual code ("nosession", "notfound", "forbidden") is stronger evidence
    // than a word in a message, so prose never overwrites it.
    var genericCode = !err || !err.code || err.code === "network" || err.code === "error";
    var rateProse = /\brate[- ]?limit|\btoo many requests\b/i.test(msg);
    var authProse = /401|unauthor/i.test(msg);
    var forbProse = /403|forbidden/i.test(msg);
    var notFoundProse = /404|not found/i.test(msg);
    // A transport failure is never a status: keep the honest "network" code even
    // if the client stamped a bogus status (a 429) on it, so no consumer of
    // `e.code` is misled into a rate-limit decision. The signature may live in
    // either the top-level or the nested message.
    var util = root.PWT && root.PWT.util;
    var transport = !!(util && util.isTransportFailure && (util.isTransportFailure(msg) || util.isTransportFailure(nestedMsg)));
    if (transport) {
      // A transport failure is never a status: drop any bogus status the client
      // stamped on it, and keep the honest "network" code, so no consumer of
      // `e.status` / `e.code` is misled into a rate-limit decision.
      e.code = "network";
      delete e.status;
    }
    else if (e.status === 429) e.code = "rate";
    else if (e.status === 401 || (genericCode && authProse)) e.code = "unauthorized";
    else if (e.status === 403 || (genericCode && forbProse)) e.code = "forbidden";
    else if (e.status === 404 || (genericCode && notFoundProse)) e.code = "notfound";
    else if (genericCode && rateProse) e.code = "rate";
    else if (!genericCode) e.code = String(err.code);
    return e;
  }

  /**
   * Detect a resolved error body (how Cosmos reports a dead, blocked or
   * rate-limited endpoint): a plain object carrying a `code`/`error`/`message`
   * but none of the real payload keys. Returns { code, message, transport } or
   * null. `transport` is true when the message is the renderer's transport-
   * failure signature ("Failed to fetch") — the request never reached Spotify,
   * so `code` is not a status it returned.
   */
  function bodyError(res) {
    if (!res || typeof res !== "object" || Array.isArray(res)) return null;
    if (res.items || res.rows || res.data) return null;
    var code = res.code != null ? res.code : res.error && res.error.status != null ? res.error.status : null;
    var msg = res.message != null ? String(res.message) : res.error && res.error.message ? String(res.error.message) : typeof res.error === "string" ? res.error : "";
    if (code == null && !msg) return null;
    // The transport signature may live in the top-level or the nested message
    // (e.g. {message:"request failed", error:{status:429, message:"Failed to fetch"}}).
    var nestedMsg = res.error && typeof res.error === "object" && res.error.message != null ? String(res.error.message) : "";
    var util = root.PWT && root.PWT.util;
    var transport = !!(util && util.isTransportFailure && (util.isTransportFailure(String(msg)) || util.isTransportFailure(nestedMsg)));
    return { code: code, message: String(msg || "error").slice(0, 160), transport: transport };
  }

  /** Classify a body error. A transport failure is always "network". */
  function bodyErrorCode(be, fallback) {
    if (be && be.transport) return "network";
    var n = Number(be && be.code);
    if (n === 429) return "rate";
    if (n === 401) return "unauthorized";
    if (n === 403) return "forbidden";
    if (n === 404 || n === -1) return "notfound";
    return fallback || "network";
  }

  /** One-line reason for a body error, honest about transport failures. */
  function bodyErrorMessage(prefix, be) {
    if (!be) return "error";
    if (be.transport) return "unreachable: " + be.message;
    return prefix + " " + (be.code != null ? be.code : "") + ": " + be.message;
  }

  /**
   * What a failed request actually was, as a message an honest UI can show.
   *
   * A transport failure ("Failed to fetch") means the request never reached
   * Spotify, so it must never be reported as a status Spotify returned —
   * "web api 429" for an unreachable host is a wrong diagnosis that sends the
   * reader hunting for a rate limit that does not exist. A resolved error body
   * ({code,message}) is the opposite: Spotify answered, so it is never called
   * unreachable.
   */
  function describeError(e) {
    // A resolved error body is an answer from the server, not a failed
    // connection — unless its message is a transport-failure signature, in
    // which case it is a request that never got there and must fall through to
    // the honest "no response" wording instead of "web api <code>".
    if (e && typeof e === "object" && !(e instanceof Error) && e.status == null) {
      var be = bodyError(e);
      if (be && !be.transport && e.code !== "network") return "web api " + be.code + ": " + be.message;
    }
    // Classify the same way a request would, so the wording can never disagree
    // with what the rest of the code believes happened.
    var c = e instanceof Error ? e : asError(e);
    // A transport failure is never a status, even if a status was attached to
    // the error object: report "no response", never "http 429".
    var util = root.PWT && root.PWT.util;
    var thrownTransport = util && util.isTransportFailure && util.isTransportFailure(String(c.message || ""));
    if (!thrownTransport && c.status) return "http " + c.status + (c.code && c.code !== "network" ? " (" + c.code + ")" : "") + ": " + (c.message || "");
    if (c.code === "nosession") return "no client session: " + (c.message || "");
    if (c.code === "rate") return "rate limited: " + (c.message || "");
    return "request failed: " + ((c.message && c.message !== "[object Object]") ? c.message : "the request failed") + " (no response from the endpoint)";
  }

  /**
   * Core request. `spec` is { method, url, body?, format? }.
   * @returns {Promise<any>} parsed JSON, or text when format === "text"
   */
  function request(spec) {
    var C = cosmos();
    if (!C) return Promise.reject(fail("Spicetify.CosmosAsync is unavailable", "nosession"));
    var url = spec.url;
    var key = spec.method + " " + url;
    if (inflight[key]) return inflight[key];
    var wait = backoff.until - Date.now();
    var p = (wait > 0 ? sleep(wait) : Promise.resolve())
      .then(function () {
        if (spec.mock) return spec.mock(spec);
        if (spec.format === "text") {
          return C.request ? C.request(spec.method.toUpperCase(), url, spec.body) : null;
        }
        if (spec.method === "post") return C.post(url, spec.body || {});
        if (spec.method === "put") return C.put(url, spec.body || {});
        if (spec.method === "del") return C.del(url, spec.body || {});
        return C.get(url, spec.body);
      })
      .catch(function (err) {
        var e = asError(err);
        if (e.code === "rate") {
          backoff.step = Math.min(backoff.step + 1, 5);
          backoff.until = Date.now() + Math.min(60000, 2000 * Math.pow(2, backoff.step));
          e.retryAt = backoff.until;
        }
        throw e;
      })
      .then(
        function (v) {
          backoff.step = 0;
          return v;
        },
        function (e) {
          throw e;
        }
      );
    inflight[key] = p;
    p.then(
      function () {
        delete inflight[key];
      },
      function () {
        delete inflight[key];
      }
    );
    return p;
  }

  /**
   * Fetch raw HTML through the renderer's fetch (CORS-safe for open.spotify.com
   * because the client is allowed there; failures fall back to CosmosAsync).
   */
  function fetchText(url) {
    var key = "fetch " + url;
    if (inflight[key]) return inflight[key];
    var p;
    if (typeof fetch === "function" && !(root.Spicetify && root.Spicetify.Config && root.Spicetify.Config.noNetwork)) {
      p = fetch(url, { credentials: "omit" }).then(function (r) {
        if (!r.ok) throw fail("HTTP " + r.status + " for " + url, r.status === 404 ? "notfound" : "network", r.status);
        return r.text();
      });
    } else {
      p = Promise.reject(fail("fetch is unavailable", "nosession"));
    }
    inflight[key] = p;
    p.then(
      function () {
        delete inflight[key];
      },
      function () {
        delete inflight[key];
      }
    );
    return p;
  }

  /** GET/POST a catalogue spec ({method,url,body,format}). */
  function call(spec) {
    if (!spec) return Promise.reject(fail("no request spec", "usage"));
    if (spec.method === "fetch") return fetchText(spec.url);
    // The client's own playlist API is not an HTTP spec; it answers in-process
    // and is the only route that can read a playlist on current builds.
    if (spec.client === "playlistapi") {
      try {
        return Promise.resolve(
          spec.kind === "metadata" ? spec.api.getMetadata("spotify:playlist:" + spec.id) : spec.api.getContents("spotify:playlist:" + spec.id)
        );
      } catch (e) {
        return Promise.reject(asError(e));
      }
    }
    // The client's own GraphQL helper is not an HTTP spec; it answers directly.
    if (spec.client === "graphql") {
      var S = null;
      try {
        S = (typeof globalThis !== "undefined" ? globalThis : window).Spicetify;
      } catch (e) {
        S = null;
      }
      if (!S || !S.GraphQL || typeof S.GraphQL.Request !== "function") {
        return Promise.reject(fail("this client has no GraphQL helper", "notfound"));
      }
      return S.GraphQL.Request(spec.def, spec.vars);
    }
    return request(spec);
  }

  // ------------------------------------------------------------- negative cache

  function isNegative(id) {
    var n = negative[id];
    return !!(n && n.until > Date.now());
  }

  function markNegative(id) {
    negative[id] = { until: Date.now() + NEGATIVE_TTL };
  }

  function clearNegative(id) {
    if (id) delete negative[id];
    else negative = Object.create(null);
  }

  /**
   * Run tasks with a concurrency cap and small random jitter between starts.
   * @param {Array} items
   * @param {number} limit
   * @param {function(item, index): Promise<any>} task
   * @param {function(done, total, item, result?, error?)} [onProgress]
   */
  function pool(items, limit, task, onProgress, jitter) {
    items = items || [];
    var results = new Array(items.length);
    var next = 0;
    var done = 0;
    var total = items.length;
    function run() {
      if (next >= total) return Promise.resolve();
      var i = next++;
      return sleep(jitter == null ? 0 : Math.floor(Math.random() * jitter))
        .then(function () {
          return task(items[i], i);
        })
        .then(
          function (r) {
            results[i] = { ok: true, value: r };
          },
          function (e) {
            results[i] = { ok: false, error: e };
          }
        )
        .then(function () {
          done++;
          if (onProgress) onProgress(done, total, items[i], results[i]);
          return run();
        });
    }
    var workers = [];
    for (var w = 0; w < Math.min(limit, total); w++) workers.push(run());
    return Promise.all(workers).then(function () {
      return { results: results };
    });
  }

  function reset() {
    inflight = Object.create(null);
    negative = Object.create(null);
    backoff = { until: 0, step: 0 };
  }

  return {
    NEGATIVE_TTL: NEGATIVE_TTL,
    request: request,
    call: call,
    isNegative: isNegative,
    markNegative: markNegative,
    clearNegative: clearNegative,
    pool: pool,
    describeError: describeError,
    bodyError: bodyError,
    bodyErrorCode: bodyErrorCode,
    bodyErrorMessage: bodyErrorMessage,
    reset: reset,
    _backoff: function () {
      return backoff;
    },
  };
});
