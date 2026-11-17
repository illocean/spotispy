"use strict";
/**
 * The honesty count API: a count-by-index in db, and the two store helpers the
 * controller uses to disclose "showing X newest of Y". Uses the same real db +
 * fake-indexeddb the UI harness uses, so this exercises the actual IDBKeyRange
 * path rather than a mock that could drift from it.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const idb = require("fake-indexeddb");

globalThis.indexedDB = idb.indexedDB;
globalThis.IDBKeyRange = idb.IDBKeyRange;
globalThis.PWT = {};
const db = require("../src/pwt/core/db.js");
globalThis.PWT.db = db;
const store = require("../src/pwt/core/store.js");

test("db.countIndex and the store count helpers report true totals by target", async () => {
  await db.batch([
    ["changes", "put", { key: "a", target: "userA", ts: 1, observedAt: 1 }],
    ["changes", "put", { key: "b", target: "userA", ts: 2, observedAt: 2 }],
    ["changes", "put", { key: "c", target: "userB", ts: 3, observedAt: 3 }],
    ["changes", "put", { key: "d", target: "userB", ts: 4, observedAt: 4 }],
    ["changes", "put", { key: "e", target: "userB", ts: 5, observedAt: 5 }],
  ]);

  // Exact-match count on the named index, not a sample and not another store.
  assert.equal(await db.countIndex("changes", "target", "userA"), 2);
  assert.equal(await db.countIndex("changes", "target", "userB"), 3);
  assert.equal(await db.countIndex("changes", "target", "userZ"), 0);

  // Store façade delegates to the same helpers.
  assert.equal(await store.countChangesFor("userA"), 2, "countChangesFor counts only that target's rows");
  assert.equal(await store.countChangesFor("userB"), 3);
  assert.equal(await store.countChanges(), 5, "countChanges counts every change row");

  db.close();
});
