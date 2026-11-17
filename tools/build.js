/* eslint-disable */
/**
 * Spotispy — build script.
 *
 * Two artifacts from one source, both written to `../dist/` (never applied):
 *   dist/spotispy.js                         extension for Spotify start-up
 *   dist/CustomApps/Spotispy/                index.js + style.css + manifest.json
 *
 * `index.js` exports the single source-of-truth file list; this script derives
 * the extension bundle from it (core subset + extension-main). The app bundle
 * is the same list with app UI included — index.js's `render()` is picked up by
 * Spicetify as the global entry, exactly like a hand-authored single file.
 *
 * Production install is a separate explicit command: `tools/install.ps1`.
 */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..");
const DIST = path.join(SRC, "dist");
const FILES = require("../index.js");
const CORE_FILES = FILES.filter((f) => !f.startsWith("src/pwt/ui/"));

function readSrc(f) {
  return fs.readFileSync(path.join(SRC, f), "utf8");
}

function build(target, files, extra) {
  const parts = [];
  for (const f of files) parts.push("\n// ==== " + f + " ====\n" + readSrc(f));
  if (extra) parts.push(extra);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, parts.join("\n"), "utf8");
  console.log("wrote", target, (fs.statSync(target).size / 1024).toFixed(1) + " KB");
}

// 1. extension
build(
  path.join(DIST, "spotispy.js"),
  [...CORE_FILES],
  "\n// ==== src/extension-main.js ====\n" + readSrc("src/extension-main.js")
);

// 1b. drop pre-rename build outputs so dist/ only holds the current names
for (const stale of ["playlist-watchtower.js", path.join("CustomApps", "PlaylistWatchtower")]) {
  const p = path.join(DIST, stale);
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
    console.log("removed stale", p);
  }
}

// 2. app
const appDir = path.join(DIST, "CustomApps", "Spotispy");
fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });
// 2a. src/ copy (kept for review/harness; the runtime bundle is index.js)
FILES.forEach((f) => {
  const dest = path.join(appDir, f);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(SRC, f), dest);
});
// 2b. single-file bundle (what Spotify loads; index.js defines render())
build(path.join(appDir, "index.js"), [...FILES, "index.js"]);

// 3. manifest.json (single-file bundle; no subfiles needed)
const manifest = {
  name: "Spotispy",
  icon: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M2 10.8c2-3.5 5.6-5.8 10-5.8s8 2.3 10 5.8c-2 3.5-5.6 5.8-10 5.8S4 14.3 2 10.8Z\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linejoin=\"round\"/><circle cx=\"12\" cy=\"10.8\" r=\"3\" stroke=\"#1ed760\" stroke-width=\"1.7\"/><circle cx=\"12\" cy=\"10.8\" r=\"1.2\" fill=\"currentColor\"/><path d=\"M8.6 18.6c2.2 1 4.6 1 6.8 0\" stroke=\"#1ed760\" stroke-width=\"1.7\" stroke-linecap=\"round\"/></svg>",
  "active-icon": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M2 10.8c2-3.5 5.6-5.8 10-5.8s8 2.3 10 5.8c-2 3.5-5.6 5.8-10 5.8S4 14.3 2 10.8Z\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linejoin=\"round\"/><circle cx=\"12\" cy=\"10.8\" r=\"3.1\" fill=\"#1ed760\"/><circle cx=\"12\" cy=\"10.8\" r=\"1.3\" fill=\"#121212\"/><path d=\"M8.6 18.6c2.2 1 4.6 1 6.8 0\" stroke=\"#1ed760\" stroke-width=\"1.7\" stroke-linecap=\"round\"/></svg>",
  subfiles: [],
};
fs.writeFileSync(path.join(appDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
console.log("wrote", path.join(appDir, "manifest.json"));

// 4. style.css
build(path.join(appDir, "style.css"), [], readSrc("src/pwt/ui/style.css"));
