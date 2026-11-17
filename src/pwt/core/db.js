/* eslint-disable */
/**
 * Spotispy — L1 cache: one IndexedDB database, versioned schema,
 * promise-based helpers. Every store is declared here, so a schema bump is one
 * place and old rows are migrated rather than dropped (proposal §6.1, §6.4).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.db = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Historical name, kept on purpose so existing local data survives the rename.
  var DB_NAME = "playlist-watchtower";
  // v2 added the `observedAt` index (see SCHEMA.changes): the log is trimmed by
  // when a change was OBSERVED, not by the date Spotify attached to it, so a
  // back-dated add is never the first row deleted.
  var DB_VERSION = 2;

  // store -> { keyPath, indexes: [[name, keyPath, unique]] }
  // Only stores something actually reads or writes are declared, and only
  // indexes a `range()` call actually uses: an index nobody queries is dead
  // weight written on every put. `presence` and `metaLog` were never written or
  // read (only cleared), and `errors` was never touched at all.
  var SCHEMA = {
    profiles: { keyPath: "id", indexes: [] },
    playlists: { keyPath: "id", indexes: [] },
    snapshots: { keyPath: "playlistId", indexes: [] },
    tracks: { keyPath: "uri", indexes: [] },
    changes: {
      keyPath: "key",
      indexes: [
        ["ts", "ts", false],
        // Trim order: when the row was seen, never when Spotify says the fact
        // happened. A track added in 2022 and first seen today must not be the
        // first row the log cap deletes.
        ["observedAt", "observedAt", false],
        ["target", "target", false],
      ],
    },
    aggregates: { keyPath: "key", indexes: [] },
    profileSets: { keyPath: "key", indexes: [] },
    watches: { keyPath: "key", indexes: [] },
    plays: {
      keyPath: "key",
      indexes: [
        ["userTs", ["userId", "ts"], false],
        ["ts", "ts", false],
      ],
    },
    sessions: { keyPath: "id", indexes: [] },
    dayTicks: { keyPath: "key", indexes: [] },
    activityState: { keyPath: "userId", indexes: [] },
    meta: { keyPath: "key", indexes: [] },
  };

  var db = null;
  var opening = null;

  function open() {
    if (db) return Promise.resolve(db);
    if (opening) return opening;
    if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is unavailable"));
    opening = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (ev) {
        var database = req.result;
        var from = ev.oldVersion || 0;
        for (var name in SCHEMA) {
          if (!Object.prototype.hasOwnProperty.call(SCHEMA, name)) continue;
          var def = SCHEMA[name];
          var store;
          if (!database.objectStoreNames.contains(name)) {
            store = database.createObjectStore(name, { keyPath: def.keyPath });
          } else if (from > 0) {
            store = req.transaction.objectStore(name);
          } else {
            continue;
          }
          // An existing store may be missing indexes added since it was created.
          for (var i = 0; i < def.indexes.length; i++) {
            var ix = def.indexes[i];
            if (!store.indexNames.contains(ix[0])) store.createIndex(ix[0], ix[1], { unique: !!ix[2] });
          }
        }
        if (from > 0 && from < DB_VERSION) migrate(database, req.transaction, from, DB_VERSION);
      };
      req.onsuccess = function () {
        db = req.result;
        opening = null;
        db.onversionchange = function () {
          db.close();
          db = null;
        };
        resolve(db);
      };
      req.onerror = function () {
        opening = null;
        reject(req.error || new Error("IndexedDB open failed"));
      };
      req.onblocked = function () {
        /* another tab holds the old version; nothing to do */
      };
    });
    return opening;
  }

  /**
   * Schema migrations. `from`/`to` are the old and new DB versions; the upgrade
   * transaction is passed so a backfill can write in the same transaction that
   * created the index (a cursor over a store the transaction owns).
   */
  function migrate(database, tx, from, to) {
    if (from < 1) return; // fresh install: nothing to migrate
    // v1 -> v2: the `observedAt` index was added, but rows written before it
    // existed would be missing from that index and so could never be trimmed.
    // Every row written by this app carries observedAt (makeEvent stamps it),
    // so this normally copies nothing; it is here so a row that predates the
    // field is given one instead of silently becoming un-trimmable.
    if (from < 2 && database.objectStoreNames.contains("changes")) {
      try {
        var changes = tx.objectStore("changes");
        if (changes.indexNames.contains("observedAt")) {
          changes.openCursor().onsuccess = function (ev) {
            var cur = ev.target.result;
            if (!cur) return;
            var row = cur.value;
            if (row && (row.observedAt == null || !isFinite(row.observedAt))) {
              row.observedAt = isFinite(row.ts) ? row.ts : Date.now();
              cur.update(row);
            }
            cur.continue();
          };
        }
      } catch (e) {
        /* a backfill that cannot run leaves the old rows as they were */
      }
    }
  }

  function tx(stores, mode, fn) {
    return open().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(stores, mode);
        var result;
        var settled = false;
        transaction.oncomplete = function () {
          if (settled) return;
          settled = true;
          resolve(result);
        };
        transaction.onerror = function () {
          if (settled) return;
          settled = true;
          reject(transaction.error || new Error("IndexedDB transaction failed"));
        };
        transaction.onabort = function () {
          if (settled) return;
          settled = true;
          reject(transaction.error || new Error("IndexedDB transaction aborted"));
        };
        try {
          result = fn(transaction);
          // A callback that returns a promise (e.g. a cursor walk) supplies the
          // result itself; the transaction's completion must not resolve early
          // with the promise object.
          if (result && typeof result.then === "function") {
            result.then(function (v) {
              if (settled) return;
              settled = true;
              resolve(v);
            }, function (e) {
              if (settled) return;
              settled = true;
              reject(e);
            });
          }
        } catch (e) {
          try {
            transaction.abort();
          } catch (e2) {
            /* already aborted */
          }
          if (!settled) {
            settled = true;
            reject(e);
          }
        }
      });
    });
  }

  function req(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () {
        resolve(r.result);
      };
      r.onerror = function () {
        reject(r.error);
      };
    });
  }

  function get(store, key) {
    return tx(store, "readonly", function (t) {
      return req(t.objectStore(store).get(key));
    });
  }

  function getAll(store) {
    return tx(store, "readonly", function (t) {
      return req(t.objectStore(store).getAll());
    });
  }

  function put(store, value) {
    return tx(store, "readwrite", function (t) {
      return req(t.objectStore(store).put(value));
    });
  }

  function del(store, key) {
    return tx(store, "readwrite", function (t) {
      return req(t.objectStore(store).delete(key));
    });
  }

  function count(store) {
    return tx(store, "readonly", function (t) {
      return req(t.objectStore(store).count());
    });
  }

  /**
   * Count the records in an index equal to `key` (an exact-match count, not a
   * sample). Used for the honest "N newest of TOTAL" disclosures in the UI: the
   * feeds stay capped for rendering, but the number they claim to be a subset
   * of must be the real total. A failed count rejects — the caller renders an
   * unknown marker rather than a misleading zero.
   */
  function countIndex(store, index, key) {
    var KeyRange = (typeof globalThis !== "undefined" && globalThis.IDBKeyRange) || (typeof IDBKeyRange !== "undefined" ? IDBKeyRange : null);
    var range = KeyRange ? KeyRange.only(key) : key;
    return tx(store, "readonly", function (t) {
      return req(t.objectStore(store).index(index).count(range));
    });
  }

  /**
   * Read one index range in a single transaction.
   * @param {string} store
   * @param {string} index
   * @param {any} range IDBKeyRange or undefined
   * @param {object} opts { direction: 'next'|'prev', limit: number }
   */
  function range(store, index, r, opts) {
    opts = opts || {};
    return tx(store, "readonly", function (t) {
      var src = index ? t.objectStore(store).index(index) : t.objectStore(store);
      var cur = src.openCursor(r, opts.direction || "next");
      var out = [];
      var limit = opts.limit || Infinity;
      return new Promise(function (resolve) {
        cur.onsuccess = function () {
          var cursor = cur.result;
          if (!cursor || out.length >= limit) {
            resolve(out);
            return;
          }
          // Callers that delete by key (retention pruning) need the row's
          // PRIMARY key, which a keyPath store does not put on the value — and
          // on an index cursor that is `cursor.primaryKey`, not `cursor.key`
          // (which is the index's own key).
          out.push(opts.withKeys ? { key: cursor.primaryKey, value: cursor.value } : cursor.value);
          cursor.continue();
        };
      });
    });
  }

  /** Write many rows of several stores in ONE transaction (atomic commit). */
  function batch(ops) {
    var stores = [];
    var seen = {};
    for (var i = 0; i < ops.length; i++) {
      if (!seen[ops[i][0]]) {
        seen[ops[i][0]] = true;
        stores.push(ops[i][0]);
      }
    }
    if (!stores.length) return Promise.resolve();
    return tx(stores, "readwrite", function (t) {
      for (var j = 0; j < ops.length; j++) {
        var op = ops[j];
        var store = t.objectStore(op[0]);
        if (op[1] === "put") store.put(op[2]);
        else if (op[1] === "putAll") for (var k = 0; k < op[2].length; k++) store.put(op[2][k]);
        else if (op[1] === "del") store.delete(op[2]);
        else if (op[1] === "clear") store.clear();
      }
    });
  }

  /** Delete the heavy activity stores, used by "purge activity". */
  function purgeActivity() {
    return batch([
      ["plays", "clear"],
      ["sessions", "clear"],
      ["dayTicks", "clear"],
      ["activityState", "clear"],
    ]);
  }

  /**
   * Delete activity history older than `cutoffMs` (the user's retention setting).
   * Plays are indexed by `ts` and day ticks are keyed `YYYY-MM-DD`, so both can
   * be read in order and deleted from the front; sessions carry `startedAt`.
   * Aggregates, changes and watches are deliberately untouched: this is history
   * hygiene, not a purge. Returns the number of rows deleted.
   *
   * Deletes run in bounded chunks. A first run can easily hold tens of
   * thousands of rows; putting them all in ONE IndexedDB transaction risks a
   * QuotaExceededError that discards every delete, so nothing is freed and the
   * same oversized delete is retried forever. Chunking means partial progress
   * is real progress.
   */
  async function pruneOlderThan(cutoffMs) {
    if (!cutoffMs || !isFinite(cutoffMs)) return 0;
    var KeyRange = (typeof globalThis !== "undefined" && globalThis.IDBKeyRange) || (typeof IDBKeyRange !== "undefined" ? IDBKeyRange : null);
    if (!KeyRange) return 0;
    await open();

    var CHUNK = 2000;
    var dayKeyOf = function (ts) {
      var d = new Date(ts == null ? Date.now() : ts);
      var m = d.getMonth() + 1;
      var day = d.getDate();
      return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
    };
    var dayCutoff = dayKeyOf(cutoffMs);
    var count = 0;

    // Delete one store's key list in chunks.
    var deleteInChunks = async function (store, keys) {
      // No stale rows is the common case (a fresh install, or a window that
      // covers everything): skip the transaction entirely rather than opening
      // an empty one.
      if (!keys.length) return;
      for (var i = 0; i < keys.length; i += CHUNK) {
        var slice = keys.slice(i, i + CHUNK).map(function (k) {
          return [store, "del", k];
        });
        await batch(slice);
        count += slice.length;
      }
    };

    // plays: index `ts` is ascending, so everything before the cutoff is a prefix.
    try {
      var stalePlays = await range("plays", "ts", KeyRange.upperBound(cutoffMs, true), { withKeys: true });
      await deleteInChunks(
        "plays",
        stalePlays.map(function (r) {
          return r.key;
        })
      );
    } catch (e) {
      /* a store with no index still leaves the rest to run */
    }

    // sessions: no index, so filter on startedAt.
    try {
      var allSessions = (await getAll("sessions")) || [];
      var staleSessions = [];
      for (var s = 0; s < allSessions.length; s++) {
        var row = allSessions[s];
        var when = row && typeof row.startedAt === "number" ? row.startedAt : 0;
        if (when && when < cutoffMs) staleSessions.push(row.id);
      }
      await deleteInChunks("sessions", staleSessions);
    } catch (e2) {
      /* ignore */
    }

    // dayTicks: keys are YYYY-MM-DD, so a lexical bound is the date bound.
    try {
      var staleDays = await range("dayTicks", null, KeyRange.upperBound(dayCutoff, true), { withKeys: true });
      await deleteInChunks(
        "dayTicks",
        staleDays.map(function (r) {
          return r.key;
        })
      );
    } catch (e3) {
      /* ignore */
    }

    return count;
  }

  /**
   * Erase every user-data store.
   *
   * `meta` is deliberately kept: it holds the settings mirror, the scan clock
   * and the generation counters, none of which describe the user's data and all
   * of which the app needs to boot. But three families of rows ARE user data
   * wearing a `meta` key — resolved artwork (one row per track, playlist and
   * profile ever seen), remembered friend names, and the per-playlist "seen
   * track" sets. They have no eviction of their own, so a purge that left them
   * would both break the promise on the button and grow without bound. Drop
   * exactly those, keep the rest.
   */
  var PURGE_META_PREFIXES = ["art:", "activityName:", "seenTracks:"];

  function purgeAll() {
    return open().then(function () {
      var ops = Object.keys(SCHEMA)
        .filter(function (s) {
          return s !== "meta";
        })
        .map(function (s) {
          return [s, "clear"];
        });
      return getAll("meta").then(function (rows) {
          for (var i = 0; i < (rows || []).length; i++) {
            var key = String(rows[i].key || "");
            for (var p = 0; p < PURGE_META_PREFIXES.length; p++) {
              if (key.indexOf(PURGE_META_PREFIXES[p]) === 0) {
                ops.push(["meta", "del", key]);
                break;
              }
            }
          }
          return batch(ops);
        });
    });
  }

  function close() {
    if (db) {
      try {
        db.close();
      } catch (e) {
        /* already closed */
      }
    }
    db = null;
    opening = null;
  }

  return {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    SCHEMA: SCHEMA,
    open: open,
    close: close,
    get: get,
    getAll: getAll,
    put: put,
    del: del,
    count: count,
    countIndex: countIndex,
    range: range,
    batch: batch,
    pruneOlderThan: pruneOlderThan,
    purgeActivity: purgeActivity,
    purgeAll: purgeAll,
  };
});
