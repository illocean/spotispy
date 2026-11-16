"use strict";
// Spotispy — popup. Drives the real keydown handler popup.show installs.
// The module reads `root.document`, so the test installs a stub global.

const { test } = require("node:test");
const assert = require("node:assert/strict");

function makeEl(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    className: "",
    textContent: "",
    value: "",
    placeholder: "",
    type: "",
    dataset: {},
    style: {},
    children: [],
    handlers: {},
    attrs: {},
    appendChild: function (c) { this.children.push(c); return c; },
    setAttribute: function (k, v) { this.attrs[k] = v; },
    addEventListener: function (k, fn) { this.handlers[k] = fn; },
    removeEventListener: function (k) { delete this.handlers[k]; },
    remove: function () { this.removed = true; },
    focus: function () {},
  };
}

function installDoc(captured) {
  const doc = {
    createElement: function (tag) {
      const el = makeEl(tag);
      captured.push(el);
      return el;
    },
    getElementById: function () { return null; },
    body: { appendChild: function () {} },
    handlers: {},
    addEventListener: function (k, fn) { doc.handlers[k] = fn; },
    removeEventListener: function (k) { delete doc.handlers[k]; },
  };
  globalThis.document = doc;
  return doc;
}

test("Enter in a textarea field does not submit the popup", async (t) => {
  // The guard read `ev.target.dataset.pwtEnter !== "multiline"`, but nothing
  // ever wrote that attribute, so the check was always true: Enter inside a
  // multiline field submitted the primary action instead of adding a newline.
  const captured = [];
  installDoc(captured);
  // Always remove the stub, even if an assertion below throws: a leaked
  // `globalThis.document` hangs every other suite in the same process.
  t.after(function () { delete globalThis.document; });

  // popup.js resolves `root` at load time, so load it after the stub exists.
  delete require.cache[require.resolve("../src/pwt/util/popup.js")];
  const popup = require("../src/pwt/util/popup.js");
  const p = popup.show({
    title: "Edit note",
    fields: [{ name: "note", label: "Note", multiline: true }],
    actions: [{ label: "Save", value: "save", primary: true }, { label: "Cancel", value: null }],
  });

  const overlay = captured.filter(function (e) {
    return e.className === "pwt-popup-overlay";
  })[0];
  assert.ok(overlay, "an overlay was created: got " + captured.length + " elements");

  const doc = globalThis.document;
  assert.equal(typeof doc.handlers.keydown, "function", "a keydown handler is installed on the document");

  // A textarea: Enter is a newline, not a submit.
  let prevented = false;
  doc.handlers.keydown({
    key: "Enter",
    shiftKey: false,
    target: { tagName: "TEXTAREA", dataset: {} },
    stopPropagation: function () {},
    preventDefault: function () { prevented = true; },
  });
  assert.equal(prevented, false, "Enter in a textarea must not be prevented as a submit");

  // An ordinary input still submits on Enter.
  let inputPrevented = false;
  doc.handlers.keydown({
    key: "Enter",
    shiftKey: false,
    target: { tagName: "INPUT", dataset: {} },
    stopPropagation: function () {},
    preventDefault: function () { inputPrevented = true; },
  });
  assert.equal(inputPrevented, true, "Enter in an input still submits");

  const result = await p;
  // show() resolves the action object, not its value.
  assert.ok(result && result.value === "save", "the primary action ran: " + JSON.stringify(result));
});