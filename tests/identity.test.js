"use strict";
/**
 * Spotispy — identity tests: names, avatars and artwork.
 *
 * Two rules the user stated, and that current desktop builds make easy to
 * break: the UI shows a person's display name (never their 22-character id),
 * and artwork is the real cover from Spotify (never a gradient placeholder
 * standing in for an image Spotify actually returned).
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");

const U = require("../src/pwt/util/util.js");
globalThis.PWT = { util: U };
const Profiles = require("../src/pwt/core/profiles.js");

test("imageUrl converts the image refs current clients return", () => {
  assert.equal(U.imageUrl("spotify:image:deadbeef11111111111111111111111111111111"), "https://i.scdn.co/image/deadbeef11111111111111111111111111111111");
  assert.equal(
    U.imageUrl("spotify:mosaic:deadbeef22222222222222222222222222222222:deadbeef33333333333333333333333333333333"),
    "spotify:mosaic:deadbeef22222222222222222222222222222222:deadbeef33333333333333333333333333333333",
    "a mosaic ref passes through so the UI can composite the 2x2 cover"
  );
  assert.deepEqual(
    U.mosaicTiles("spotify:mosaic:deadbeef22222222222222222222222222222222:deadbeef33333333333333333333333333333333"),
    ["https://i.scdn.co/image/deadbeef22222222222222222222222222222222", "https://i.scdn.co/image/deadbeef33333333333333333333333333333333"],
    "a mosaic ref splits into its tiles in order"
  );
  assert.equal(U.mosaicTiles("spotify:image:abc"), null);
  assert.equal(U.mosaicTiles(""), null);
  assert.equal(U.imageUrl("https://i.scdn.co/image/abc"), "https://i.scdn.co/image/abc", "a URL passes through");
  assert.equal(U.imageUrl(""), "");
  assert.equal(U.imageUrl(null), "");
  assert.equal(U.imageUrl("nonsense"), "");
  assert.deepEqual(U.mosaicTiles("spotify:image:abc"), null);
  assert.equal(U.mosaicTiles(""), null);
});

test("parseProfile reads the name and avatar from the profile-view payload", () => {
  // The exact shape the current client answers with.
  var parsed = Profiles.parseProfile({
    uri: "spotify:user:4444444444444444444444444444",
    name: "Night Owl",
    image_url: "https://i.scdn.co/image/deadbeef11111111111111111111111111111111",
    followers_count: 8,
    public_playlists: [
      {
        uri: "spotify:playlist:5555555555555555555555",
        name: "Evening Tide",
        image_url: "spotify:mosaic:deadbeef22222222222222222222222222222222:deadbeef33333333333333333333333333333333",
      },
    ],
  });
  assert.equal(parsed.id, "4444444444444444444444444444");
  assert.equal(parsed.name, "Night Owl", "the display name, not the id");
  assert.equal(parsed.avatarUrl, "https://i.scdn.co/image/deadbeef11111111111111111111111111111111");
  assert.ok(parsed.avatarHash && parsed.avatarHash !== U.hash(""), "the avatar hash is real");
  assert.equal(parsed.plays.length, 1);
  assert.equal(parsed.plays[0].name, "Evening Tide");
  assert.equal(parsed.plays[0].cover, "spotify:mosaic:deadbeef22222222222222222222222222222222:deadbeef33333333333333333333333333333333", "a mosaic cover keeps its tiles so the UI can composite it");
});

test("parseProfile still reads the older image/images shapes", () => {
  var a = Profiles.parseProfile({ uri: "spotify:user:" + "a".repeat(22), name: "Ari", image: "spotify:image:xyz" });
  assert.equal(a.avatarUrl, "https://i.scdn.co/image/xyz");
  var b = Profiles.parseProfile({ uri: "spotify:user:" + "b".repeat(22), images: [{ url: "https://i.scdn.co/image/def" }] });
  assert.equal(b.avatarUrl, "https://i.scdn.co/image/def");
  var c = Profiles.parseProfile({ uri: "spotify:user:" + "c".repeat(22), avatar: "https://i.scdn.co/image/ghi" });
  assert.equal(c.avatarUrl, "https://i.scdn.co/image/ghi");
});

test("a profile with no image parses to an empty avatar, not a fake one", () => {
  var p = Profiles.parseProfile({ uri: "spotify:user:" + "d".repeat(22), name: "Dee" });
  assert.equal(p.name, "Dee");
  assert.equal(p.avatarUrl, "");
});

test("28-character user ids (current desktop builds) round-trip", () => {
  var id = "4444444444444444444444444444"; // shaped like what the client hands out
  assert.equal(id.length, 28);
  assert.equal(U.userId("spotify:user:" + id), id);
  assert.deepEqual(U.parseRef("https://open.spotify.com/user/" + id, "user"), { type: "user", id: id });
  assert.deepEqual(U.parseRef("spotify:user:" + id), { type: "user", id: id });
  var p = Profiles.parseProfile({ uri: "spotify:user:" + id, name: "Night Owl" });
  assert.equal(p.id, id);
  assert.equal(p.name, "Night Owl");
});
