/* eslint-disable */
/**
 * Spotispy — persistence façade.
 *
 * Everything the pollers and the UI write goes through here so that three
 * invariants hold:
 *  - a scan's snapshot, change rows and aggregates commit in ONE transaction;
 *  - a logged change is de-duplicated by a stable key (a re-scan cannot
 *    duplicate a row), and the log is capped while day buckets keep the total;
 *  - connection failures and quota errors surface as ordinary promise
 *    rejections, never as a half-written scan.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.store = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var shared = root.PWT || {};

  /**
   * Aggregate commits are serialised through this chain. `commitScan` reads the
   * `aggregates` store, mutates it in memory and writes it back in a later
   * transaction, and the scanners commit concurrently (net.pool), so two
   * overlapping read-modify-writes would lose each other's counts. Chaining
   * makes every commit observe the previous one's write. A rejection must not
   * poison the chain for later commits, so the tail is normalised to fulfilled.
   */
  var aggChain = Promise.resolve();

  function db() {
    var d = root.PWT && root.PWT.db;
    return d;
  }

  function events() {
    return (root.PWT && root.PWT.events) || shared.events;
  }

  function diff() {
    return (root.PWT && root.PWT.diff) || shared.diff;
  }

  function config() {
    return (root.PWT && root.PWT.config) || shared.config;
  }

  /** Key that makes a logged row idempotent. */
  function logKey(row) {
    var ev = events();
    return ev.rowKey(row);
  }

  /**
   * Stored shape of one change row. The indexed fields (ts, observedAt, kind,
   * target, bucket) sit at the top level, next to the row itself, because
   * IndexedDB indexes cannot reach into the `row` object.
   *
   * `observedAt` is written unconditionally (falling back to `ts`): the log is
   * trimmed by it, and a row missing from that index could never be trimmed.
   */
  function changesRecord(key, row) {
    var seen = row && row.observedAt != null && isFinite(row.observedAt) ? row.observedAt : row && row.ts;
    return Object.assign({}, row, { key: key, bucket: "log", observedAt: seen });
  }

  function logCap() {
    try {
      return config().get().logCap || 10000;
    } catch (e) {
      return 10000;
    }
  }

  /** Aggregate row key: bucket (level:target:day) keeps counts separate per target. */
  function aggKey(level, target, label, day) {
    return level + ":" + target + ":" + label + ":" + day;
  }

  /**
   * Persist a scan result atomically.
   * puts entries are [store, value] or the db three-tuple [store, "put", value];
   * the two forms are normalised here so callers never need the verb.
   */
  function putOps(puts) {
    var out = [];
    for (var i = 0; i < (puts || []).length; i++) {
      var p = puts[i];
      if (!p) continue;
      if (p.length === 2) out.push([p[0], "put", p[1]]);
      else out.push(p);
    }
    return out;
  }

  function delOps(dels) {
    var out = [];
    for (var i = 0; i < (dels || []).length; i++) {
      var d = dels[i];
      if (!d) continue;
      if (d.length === 2) out.push([d[0], "del", d[1]]);
      else out.push(d);
    }
    return out;
  }
  function commitScan(plan) {
    var __t0 = Date.now();
    var __changes = ((plan && plan.changes) || []).length;
    var __tels = root.PWT && root.PWT.telemetry;
    var __rec = function (ok, detail) {
      if (__tels) __tels.record("commitScan", Date.now() - __t0, ok, __changes + " changes" + (detail ? ", " + detail : ""));
    };
    var __wrap = function (pr) {
      return Promise.resolve(pr).then(
        function (v) { __rec(true); return v; },
        function (e) { __rec(false, e && e.message); throw e; }
      );
    };
    plan = plan || {};
    var rowsIn = plan.changes || [];
    var puts = plan.puts || [];
    var dels = plan.dels || [];
    var known = plan.knownKeys || {};
    var i;

    // The guard has to see what is already in the log, not just what this plan
    // declared: the scanners never pass knownKeys, so a re-emitted row would
    // write no duplicate (the store is keyed) yet still bump the day bucket.
    var logged = {};
    var ops = null;
    var touched = null;
    var keys = null;

    // One serialised step. The guard read, the aggregate read, both increments
    // and both writes all happen inside the chain: the guard must be inside it
    // too, or two concurrent commits both observe a row as unlogged and both
    // count it. See aggChain.
    var step = function () {
      return db()
        .getAll("changes")
        .then(function (existing) {
          for (var e = 0; e < existing.length; e++) logged[existing[e].key] = true;
        })
        .then(function () {
          // Rows sharing a key are one logical change: collapse them so a
          // re-scan neither duplicates the row nor double-counts the aggregate.
          var rows = [];
          for (i = 0; i < rowsIn.length; i++) {
            var key = logKey(rowsIn[i]);
            // A row already in the log is not counted again: the `changes` store
            // is keyed, so the write is idempotent, but the aggregate increment
            // is not. Re-emitting an identical row must not inflate the bucket.
            if (known[key] || logged[key]) continue;
            logged[key] = true;
            rows.push(rowsIn[i]);
          }

          ops = putOps(puts).concat(delOps(dels));
          touched = {};

          for (i = 0; i < rows.length; i++) {
            var row = rows[i];
            ops.push(["changes", "put", changesRecord(logKey(row), row)]);
            var day = diff().dayKey(row.ts);
            var level = events().aggregateLevel(row.kind);
            var field = events().aggregateField(row.kind);
            var aggK = aggKey(level, row.target, "day", day);
            touched[aggK] = touched[aggK] || { level: level, target: row.target, day: day };
            touched[aggK][field] = (touched[aggK][field] || 0) + 1;
          }

          keys = Object.keys(touched);
          if (!keys.length) return null; // nothing to increment

          return db()
            .getAll("aggregates")
            .then(function (existing) {
              var byKey = {};
              for (var j = 0; j < existing.length; j++) byKey[existing[j].key] = existing[j];
              for (var k = 0; k < keys.length; k++) {
                var t = touched[keys[k]];
                var agg = byKey[keys[k]];
                if (!agg) {
                  agg = { key: keys[k], level: t.level, target: t.target, label: "day", day: t.day, added: 0, removed: 0, edits: 0, plays: 0 };
                  byKey[keys[k]] = agg;
                }
                if (t.added) agg.added += t.added;
                if (t.removed) agg.removed += t.removed;
                if (t.edits) agg.edits += t.edits;
                if (t.plays) agg.plays += t.plays;
                ops.push(["aggregates", "put", agg]);
              }
            });
        })
        .then(function () {
          if (!ops || !ops.length) return null;
          return db().batch(ops);
        })
        .then(trimLog);
    };

    var chained = aggChain.then(step, step);
    // Keep the chain alive after a failure, but still surface the rejection.
    aggChain = chained.then(
      function () {},
      function () {}
    );
    return __wrap(chained);
  }

  /**
   * Keep the log under the cap; day aggregates are never trimmed.
   *
   * Trim order is `observedAt` — when the row was SEEN — never `ts`, which is
   * the date Spotify attached to the fact. A track added in 2022 and first seen
   * today has ts=2022, so trimming by ts deletes the newest observation while
   * genuinely older rows survive (and the aggregate still counts the row that
   * is gone). Day aggregates are written under the same key as the row, so they
   * are never trimmed: the bucket keeps the total.
   */
  function trimLog() {
    var cap = logCap();
    return db()
      .count("changes")
      .then(function (n) {
        if (n <= cap) return null;
        var excess = n - cap;
        return db().range("changes", "observedAt", undefined, { direction: "next", limit: excess }).then(function (rows) {
          if (!rows.length) return null;
          return db().batch(rows.map(function (r) {
            return ["changes", "del", r.key];
          }));
        });
      });
  }

  /**
   * Recent change rows, newest first.
   *
   * The target index is walked in key order, which is not `ts` order, so the
   * rows must be re-sorted by `ts` here; the limit is applied AFTER filtering,
   * or a target's rows are truncated by unrelated rows that merely share the
   * key order. Without a target the `ts` index already returns newest-first.
   */
  function recentChanges(limit, target, kind, bucket) {
    var take = limit || 200;
    if (target) {
      return db()
        .range("changes", "target", target, { limit: 50000 })
        .then(function (rows) {
          // Filter the bucket on the RECORD: toRow() strips `bucket`, so a
          // filter applied after toRow() could never match.
          var kept = bucket
            ? rows.filter(function (r) {
                return r.bucket === bucket;
              })
            : rows;
          // Filter the kind BEFORE slicing, for the same reason the `ts` branch
          // below does: a slice first would drop older matching rows behind
          // newer rows of another kind.
          return applyKind(kept.map(toRow), kind)
            .filter(function (x) {
              return x.target === target;
            })
            .sort(function (a, b) {
              return b.ts - a.ts;
            })
            .slice(0, take);
        });
    }
    // Read newest-first and apply the bucket/kind filters BEFORE slicing:
    // a cursor `limit` would otherwise truncate by row count and could drop
    // older matching rows behind newer rows of another bucket or kind.
    return db()
      .range("changes", "ts", undefined, { direction: "prev" })
      .then(function (rows) {
        var kept = bucket
          ? rows.filter(function (r) {
              return r.bucket === bucket;
            })
          : rows;
        return applyKind(kept.map(toRow), kind).slice(0, take);
      });
  }

  function applyKind(rows, kind) {
    if (!kind) return rows;
    return rows.filter(function (x) {
      return x.kind === kind;
    });
  }

  /** One stored change record -> the row its readers expect. */
  function toRow(record) {
    if (!record) return record;
    var row = Object.assign({}, record);
    delete row.key;
    delete row.bucket;
    return row;
  }

  function changesFor(target, limit) {
    return db()
      .range("changes", "target", target, { limit: 50000 })
      .then(function (rows) {
        return rows
          .map(toRow)
          .sort(function (a, b) {
            return b.ts - a.ts;
          })
          .slice(0, limit || 500);
      });
  }

  /** Day aggregates for a set of levels, as {day, added, removed, edits, plays}. */
  function dailyTotals(levels, fromDay) {
    return db()
      .getAll("aggregates")
      .then(function (rows) {
        var out = {};
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];
          if (r.label !== "day") continue;
          if (levels && levels.length && levels.indexOf(r.level) < 0) continue;
          if (fromDay && r.day < fromDay) continue;
          var d = (out[r.day] = out[r.day] || { day: r.day, added: 0, removed: 0, edits: 0, plays: 0 });
          d.added += r.added || 0;
          d.removed += r.removed || 0;
          d.edits += r.edits || 0;
          d.plays += r.plays || 0;
        }
        return out;
      });
  }

  // ------------------------------------------------------------- watches

  function listWatches(kind) {
    return db()
      .getAll("watches")
      .then(function (rows) {
        return rows.filter(function (w) {
          return !kind || w.kind === kind;
        });
      });
  }

  function putWatch(w) {
    return db().put("watches", {
      key: w.kind + ":" + w.id,
      kind: w.kind,
      id: String(w.id),
      addedAt: w.addedAt || Date.now(),
      note: w.note || "",
    });
  }

  function removeWatch(kind, id) {
    return db().del("watches", kind + ":" + id);
  }

  // -------------------------------------------------------- activity rows

  function addPlays(plays) {
    if (!plays || !plays.length) return Promise.resolve();
    var ops = plays.map(function (p) {
      return ["plays", "put", Object.assign({ key: p.userId + ":" + p.ts + ":" + p.trackUri }, p)];
    });
    return db().batch(ops);
  }

  function putSessions(sessions) {
    if (!sessions || !sessions.length) return Promise.resolve();
    return db().batch(sessions.map(function (s) {
      return ["sessions", "put", s];
    }));
  }

  /**
   * Plays for a user (or every user when `userId` is null), newest first.
   * Without a user the `ts` index is read; with a user the compound `userTs`
   * index is read, so one person's plays never include another's.
   */
  function playsFor(userId, fromTs, limit) {
    var take = limit || 500;
    if (userId) {
      return db()
        .range("plays", "userTs", IDBKeyRange.bound([userId, fromTs || 0], [userId, Infinity]), { direction: "prev", limit: take })
        .then(function (rows) {
          return rows.filter(function (p) {
            return p.userId === userId;
          });
        });
    }
    return db().range("plays", "ts", IDBKeyRange.lowerBound(fromTs || 0), { direction: "prev", limit: take });
  }

  function sessionsFor(userId, limit) {
    return db()
      .getAll("sessions")
      .then(function (rows) {
        return rows
          .filter(function (s) {
            return !userId || s.userId === userId;
          })
          .sort(function (a, b) {
            return b.startedAt - a.startedAt;
          })
          .slice(0, limit || 100);
      });
  }

  function setMeta(key, value) {
    return db().put("meta", { key: key, value: value });
  }

  function getMeta(key, fallback) {
    return db().get("meta", key).then(function (r) {
      return r && r.value !== undefined ? r.value : fallback;
    });
  }

  return {
    commitScan: commitScan,
    recentChanges: recentChanges,
    changesFor: changesFor,
    dailyTotals: dailyTotals,
    listWatches: listWatches,
    putWatch: putWatch,
    removeWatch: removeWatch,
    addPlays: addPlays,
    putSessions: putSessions,
    playsFor: playsFor,
    sessionsFor: sessionsFor,
    setMeta: setMeta,
    getMeta: getMeta,
  };
});
