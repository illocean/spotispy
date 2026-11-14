"use strict";
/**
 * Fixture: the client's own `Platform.PlaylistAPI`, in the exact shape the live
 * build (Spotify 1.3.9.2055 / Spicetify 2.46.4) answers with. Verified live with
 * the repo's own probe; see docs/notes in the commit that added this file.
 *
 * Read-only from Spotispy's point of view: only getContents/getMetadata are
 * used, and neither touches the network.
 */
const TRACK_PREFIX = "spotify:track:";

function trackUri(n) {
  return TRACK_PREFIX + String(n).padStart(22, "0");
}

/**
 * @param {object} opts {
 *   id, name, cover, total,
 *   tracks: [{ uri, addedAt, addedBy, name, artist, album, cover, durationMs }]
 * }
 *   `total` overrides the reported totalLength (to fake a capped read).
 *
 *   Every item carries the full metadata the live client sends (title, artists,
 *   album with cover images, duration), because that is what Spotispy reads to
 *   fill the track cache in the same pass.
 */
function contents(opts) {
  const items = (opts && opts.tracks) || [];
  return {
    items: items.map(function (t, i) {
      const albumName = t.album || "Album " + i;
      const artist = t.artist || "Artist " + i;
      const cover = t.cover || "spotify:image:ab67616d00001e02" + String(100000000000000 + i).slice(-12);
      return {
        type: "track",
        uri: t.uri,
        name: t.name || "Track " + i,
        album: {
          type: "album",
          uri: "spotify:album:" + String(900000000000000000000 + i).slice(-22),
          name: albumName,
          artist: { type: "artist", uri: "spotify:artist:" + String(800000000000000000000 + i).slice(-22), name: artist },
          images: [
            { url: cover, label: "standard" },
            { url: cover, label: "large" },
          ],
        },
        artists: [{ type: "artist", uri: "spotify:artist:" + String(800000000000000000000 + i).slice(-22), name: artist }],
        duration: { milliseconds: t.durationMs || 200000 },
        addedAt: t.addedAt || new Date(Date.now() - (items.length - i) * 1000).toISOString(),
        addedBy: t.addedBy
          ? { type: "user", uri: "spotify:user:" + t.addedBy, username: t.addedBy }
          : undefined,
      };
    }),
    offset: 0,
    limit: 100,
    totalLength: opts && opts.total != null ? opts.total : items.length,
  };
}

function metadata(opts) {
  const o = opts || {};
  const images = o.cover ? [{ url: o.cover, label: "standard" }] : [];
  return {
    type: "playlist",
    uri: "spotify:playlist:" + o.id,
    name: o.name || "Playlist " + o.id,
    description: o.description || "",
    images: images,
    owner: o.owner ? { type: "user", uri: "spotify:user:" + o.owner, username: o.owner } : undefined,
    totalLength: o.total != null ? o.total : (o.tracks || []).length,
    totalLikes: o.followers != null ? o.followers : undefined,
  };
}

/**
 * Register a handler on a harness `calls` object.
 * @param {object} calls harness calls ({handlers: []})
 * @param {object} playlist { id, name, cover, tracks, total, followers, owner }
 */
function addPlaylist(calls, playlist) {
  const p = playlist || {};
  const entry = {
    test: function (u) { return String(u).indexOf("spotify:playlist:" + p.id) >= 0; },
    contents: function () { return contents(p); },
    meta: function () { return metadata(p); },
  };
  // Keep the entry first in the list: a catch-all HTTP handler must not shadow
  // the client route (Array.find returns the first match).
  calls.handlers.unshift(entry);
  return p;
}

module.exports = { TRACK_PREFIX: TRACK_PREFIX, trackUri: trackUri, contents: contents, metadata: metadata, addPlaylist: addPlaylist };