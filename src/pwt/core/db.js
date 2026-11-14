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
  var DB_VERSION = 1;

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
        if (from > 0 && from < DB_VERSION) migrate(database, from, DB_VERSION);
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
   * Schema migrations. Version 1 is the initial schema, so this only runs for
   * future versions; it is the extension point for §6.4 ("no data loss").
   */
  function migrate(database, from, to) {
    if (from < 1) return; // fresh install: nothing to migrate
    // v1 -> v2 (example): backfill a field on existing rows.
    // var tx = database.transaction;
    // ...
    void to;
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
          out.push(cursor.value);
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

  function purgeAll() {
    return open().then(function () {
      var ops = Object.keys(SCHEMA)
        .filter(function (s) {
          return s !== "meta";
        })
        .map(function (s) {
          return [s, "clear"];
        });
      return batch(ops);
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
    range: range,
    batch: batch,
    purgeActivity: purgeActivity,
    purgeAll: purgeAll,
  };
});
