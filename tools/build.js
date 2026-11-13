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
  icon: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"currentColor\" d=\"M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm6.9 3c0 .35.04.69.11 1.02l-1.6 1.24a7.9 7.9 0 0 1-1.76-1.02l.46-1.94A6.2 6.2 0 0 0 18.9 13Zm-1 3.3 1.6 1.24a9.8 9.8 0 0 1-3.9 2.4l-.63-1.86c.9-.42 1.7-.94 2.93-1.78Zm-3.7 1.7-.05-2a8 8 0 0 0-2.4 0l-.24 2a10 10 0 0 1 2.7 0ZM9 17l-.6 1.85a11 11 0 0 1-3.9-2.4l1.6-1.24a7.9 7.9 0 0 0 2.93 1.78ZM5.1 13c0-.35-.04-.68-.11-1.02l1.6-1.24a7.9 7.9 0 0 1 1.76 1.02l-.46 1.94A6.2 6.2 0 0 0 5.1 13Zm1 1.3-1.6-1.24a9.8 9.8 0 0 1 3.9-2.4l.63 1.86c-.9.42-1.7.94-2.93 1.78ZM12 3a9 9 0 0 0-9 9 9 9 0 0 0 9 9 9 9 0 0 0 9-9 9 9 0 0 0-9-9Zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z\"/></svg>",
  "active-icon": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"currentColor\" d=\"M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0-7a9 9 0 0 0-9 9 9 9 0 0 0 9 9 9 9 0 0 0 9-9 9 9 0 0 0-9-9Zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z\"/></svg>",
  subfiles: [],
};
fs.writeFileSync(path.join(appDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
console.log("wrote", path.join(appDir, "manifest.json"));

// 4. style.css
build(path.join(appDir, "style.css"), [], readSrc("src/pwt/ui/style.css"));
