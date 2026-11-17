"use strict";
/**
 * Spotispy — 12-hour time-format tests.
 *
 * The user's rule: user-facing time of day (UI text, tooltips, exported
 * filenames) is 12-hour; only internal bucketing/computation stays 0-23.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");

const Ex = require("../src/pwt/core/export.js");

/** A timestamp built from local components, so these assertions are timezone-safe. */
function at(hours, minutes) {
  return new Date(2026, 10, 14, hours, minutes).getTime();
}

test("export.filename uses a 12-hour, filesystem-safe time portion", () => {
  assert.equal(Ex.filename("spotispy", "csv", at(14, 5)), "spotispy-20261114-2-05PM.csv");
  assert.equal(Ex.filename("spotispy", "csv", at(0, 30)), "spotispy-20261114-12-30AM.csv");
  assert.equal(Ex.filename("spotispy", "csv", at(12, 0)), "spotispy-20261114-12-00PM.csv");
  assert.equal(Ex.filename("spotispy", "csv", at(9, 5)), "spotispy-20261114-9-05AM.csv");
  assert.equal(Ex.filename("spotispy", "csv", at(23, 45)), "spotispy-20261114-11-45PM.csv");
  // No ':' or space may leak into a filename (both are legal in a filename but
  // awkward for shells/tools), and the YYYYMMDD date part is unchanged.
  [0, 9, 12, 14, 23].forEach(function (h) {
    const name = Ex.filename("spotispy", "json", at(h, 7));
    assert.doesNotMatch(name, /[:\s]/, "filename stays filesystem-safe: " + name);
    assert.match(name, /^spotispy-20261114-/);
  });
});

test("heatmap tooltip labels hours in 12-hour time", () => {
  // Load the real chart module into a controlled global. Its `h` needs React,
  // which react.js reads from Spicetify at call time.
  globalThis.Spicetify = { React: require("react") };
  require("../src/pwt/ui/react.js"); // installs PWT.react
  const Charts = require("../src/pwt/ui/charts.js");

  const buckets = new Array(24).fill(0);
  [0, 9, 12, 13, 23].forEach(function (h) { buckets[h] = 1; });
  const el = Charts.Heatmap({ days: [{ day: "2026-11-14" }], data: { "2026-11-14": buckets } });

  // Walk the returned React element tree and collect every `title` attribute.
  const titles = [];
  (function walk(node) {
    if (node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.props && typeof node.props === "object") {
      if (typeof node.props.title === "string") titles.push(node.props.title);
      if (node.props.children != null) walk(node.props.children);
    }
  })(el);

  assert.equal(titles.length, 24, "one tooltip per hour bucket");
  assert.ok(titles.includes("2026-11-14 12:00 AM · 1 play"), JSON.stringify(titles.slice(0, 3)));
  assert.ok(titles.includes("2026-11-14 9:00 AM · 1 play"));
  assert.ok(titles.includes("2026-11-14 12:00 PM · 1 play"));
  assert.ok(titles.includes("2026-11-14 1:00 PM · 1 play"));
  assert.ok(titles.includes("2026-11-14 11:00 PM · 1 play"));
  // Every tooltip is a strict 12-hour label: hour 1-12 (no leading zero),
  // ":00", an AM/PM suffix, then the preserved play count. A 24-hour hour such
  // as "00:00", "09:00" or "13:00" cannot satisfy this.
  assert.ok(
    titles.every(function (t) { return /^2026-11-14 (12|[1-9]|1[0-2]):00 (AM|PM) · (0 plays|1 play)$/.test(t); }),
    "all tooltips use 12-hour time: " + JSON.stringify(titles)
  );
});
