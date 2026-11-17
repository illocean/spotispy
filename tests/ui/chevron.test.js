"use strict";
/**
 * Spotispy — chevron regression tests.
 *
 * Guards the alignment/animation fix. The Select and accordion chevrons used to
 * be a text glyph (U+2304 "⌄"); its font metrics and baseline made the control
 * jump whenever `is-open` toggled. They are now fixed-size, block-level inline
 * SVGs that rotate about their centre. If either chevron regresses to a text
 * glyph, or its wrapper stops reporting `is-open`, these tests fail.
 *
 *   node --test tests/ui/chevron.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, stubSpicetify, fixtures, stubHandlers, seed } = require("../support/harness.js");

const state = {};

test.before(async () => {
  const { win, P } = boot();
  const calls = { toasts: [], nav: [], get: [], post: [], handlers: [] };
  stubSpicetify(win, calls);
  const fx = fixtures();
  stubHandlers(fx, calls);
  state.win = win;
  state.P = P;
  state.fx = fx;
  state.calls = calls;
  state.booted = await seed(P, fx);
  state.controllers = [];
});

test.after(async () => {
  if (state.controllers) {
    while (state.controllers.length) {
      const el = state.controllers.pop();
      try {
        if (el._pwtRoot) el._pwtRoot.unmount();
      } catch (e) {
        /* already gone */
      }
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  }
  if (state.booted) await state.booted.stop();
  if (state.P && state.P.db) state.P.db.close();
});

async function waitFor(fn, label, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 8000);
  for (;;) {
    let value;
    try {
      value = await fn();
    } catch (e) {
      value = null;
    }
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for " + (label || "condition"));
    await new Promise(function (r) { setTimeout(r, 40); });
  }
}

function mount(component, props) {
  const { win, P } = state;
  const el = win.document.createElement("div");
  win.document.body.appendChild(el);
  P.react.mount(el, component, props || {});
  state.controllers.push(el);
  return el;
}

function settingsModel() {
  const { P } = state;
  return P.view.settingsModel(P.config.get(), { os: P.notify.osState(), cacheBytes: 1234567, counts: {} });
}

/** The chevron is a fixed-size span wrapping a real SVG path, never a glyph. */
function assertSvgChevron(chevron, label) {
  assert.ok(chevron, label + " exists");
  const svg = chevron.querySelector("svg");
  assert.ok(svg, label + " contains an <svg> (not a text glyph)");
  assert.equal(svg.getAttribute("viewBox"), "0 0 24 24", label + " has the fixed viewBox");
  const path = svg.querySelector("path");
  assert.ok(path, label + " svg has a path");
  assert.equal(path.getAttribute("d"), "M6 9l6 6 6-6", label + " path is the chevron stroke");
  assert.ok(!/⌄/.test(chevron.textContent), label + " no longer renders the U+2304 glyph");
}

test("Settings accordion chevrons are inline SVGs, not a text glyph", async () => {
  const el = mount(state.P.ui.Settings, { model: settingsModel() });
  const chevrons = await waitFor(function () {
    const list = el.querySelectorAll(".pwt-acc-chevron");
    return list.length ? list : null;
  }, "the accordion chevrons");
  assert.ok(chevrons.length >= 1, "at least one accordion section renders a chevron");
  Array.prototype.forEach.call(chevrons, function (chevron, i) {
    assertSvgChevron(chevron, "accordion chevron #" + (i + 1));
  });
});

test("the generic Select chevron is an inline SVG, not a text glyph", async () => {
  const el = mount(state.P.uiKit.Select, {
    options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }],
    value: "a",
    onChange: function () {},
  });
  const chevron = await waitFor(function () {
    return el.querySelector(".pwt-select-chevron");
  }, "the select chevron");
  assertSvgChevron(chevron, "select chevron");
});

test("toggling a Settings accordion updates is-open on its section wrapper", async () => {
  const el = mount(state.P.ui.Settings, { model: settingsModel() });
  await waitFor(function () { return el.querySelector(".pwt-acc-head"); }, "an accordion header");
  const key = el.querySelector(".pwt-acc-head").getAttribute("data-pwt-acc");
  const headOf = function () { return el.querySelector('.pwt-acc-head[data-pwt-acc="' + key + '"]'); };
  const sectionOf = function () { return headOf().parentNode; };

  assert.ok(sectionOf().classList.contains("is-open"), "sections start open");
  headOf().click();
  await waitFor(function () { return !sectionOf().classList.contains("is-open") ? true : null; }, "the section to close");
  assert.ok(!sectionOf().classList.contains("is-open"), "clicking the header removes is-open");
  assertSvgChevron(sectionOf().querySelector(".pwt-acc-chevron"), "accordion chevron after close");

  headOf().click();
  await waitFor(function () { return sectionOf().classList.contains("is-open") ? true : null; }, "the section to reopen");
  assert.ok(sectionOf().classList.contains("is-open"), "clicking again restores is-open");
  assertSvgChevron(sectionOf().querySelector(".pwt-acc-chevron"), "accordion chevron after reopen");
});

test("toggling a Select updates is-open on its wrapper and keeps the SVG", async () => {
  const el = mount(state.P.uiKit.Select, {
    options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }],
    value: "a",
    onChange: function () {},
  });
  const wrapOf = function () { return el.querySelector(".pwt-select"); };
  const triggerOf = function () { return el.querySelector(".pwt-select-trigger"); };
  await waitFor(function () { return wrapOf(); }, "the select wrapper");

  assert.ok(!wrapOf().classList.contains("is-open"), "closed initially");
  triggerOf().click();
  await waitFor(function () { return wrapOf().classList.contains("is-open") ? true : null; }, "the select to open");
  assert.ok(wrapOf().classList.contains("is-open"), "clicking the trigger adds is-open to .pwt-select");
  assertSvgChevron(wrapOf().querySelector(".pwt-select-chevron"), "select chevron after open");

  triggerOf().click();
  await waitFor(function () { return !wrapOf().classList.contains("is-open") ? true : null; }, "the select to close");
  assert.ok(!wrapOf().classList.contains("is-open"), "clicking again removes is-open");
  assertSvgChevron(wrapOf().querySelector(".pwt-select-chevron"), "select chevron after close");
});
