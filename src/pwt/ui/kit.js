/* eslint-disable */
/**
 * Spotispy — shared UI kit.
 *
 * Small, data-driven components. They take props and call callbacks, so the UI
 * is testable by rendering to a string / real DOM from synthetic fixtures with
 * no live Spotify behind it.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.uiKit = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function h() {
    return root.PWT.react.h.apply(null, arguments);
  }

  function util() {
    return root.PWT.util;
  }

  // Inline SVG icons: stroke = currentColor, viewBox 0 0 24 24.
  var SVG = {
    user: '<path d="M16 21v-1.2c0-1.7-1.3-3-3-3H7c-1.7 0-3 1.3-3 3V21" /><circle cx="10" cy="8" r="3.4" />',
    image: '<rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="9" cy="10.5" r="1.6" /><path d="M4 17l5-5 4 4 3.5-3.5L21 17" />',
    playlistPlus: '<path d="M9 6h11" /><path d="M9 12h11" /><path d="M9 18h6" /><path d="M4 10v6" /><path d="M1 13h6" />',
    playlistMinus: '<path d="M9 6h11" /><path d="M9 12h11" /><path d="M9 18h6" /><path d="M3 13h6" />',
    pencil: '<path d="M14.5 5.5l4 4L9 19H5v-4l9.5-9.5z" /><path d="M12 8l4 4" />',
    eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="3.2" />',
    users: '<circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 20v-1c0-2.2 1.8-4 4-4h3c2.2 0 4 1.8 4 4v1" /><path d="M16 6.4a3.2 3.2 0 0 1 0 4.3" /><path d="M19.5 20v-1c0-1.5-.8-2.8-2-3.4" />',
    userPlus: '<circle cx="10" cy="8" r="3.4" /><path d="M4.5 20v-1c0-2.2 1.8-4 4-4h3c2.2 0 4 1.8 4 4v1" /><path d="M19 9v6" /><path d="M16 12h6" />',
    userMinus: '<circle cx="10" cy="8" r="3.4" /><path d="M4.5 20v-1c0-2.2 1.8-4 4-4h3c2.2 0 4 1.8 4 4v1" /><path d="M16 12h6" />',
    plusCircle: '<circle cx="12" cy="12" r="9" /><path d="M12 8v8" /><path d="M8 12h8" />',
    minusCircle: '<circle cx="12" cy="12" r="9" /><path d="M8 12h8" />',
    list: '<path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" />',
    spark: '<path d="M12 2l2.6 5.8 6.3.5-4.8 4.1 1.5 6.1L12 15.8 6.4 18.5l1.5-6.1-4.8-4.1 6.3-.5L12 2z" />',
  };

  var ICON = {
    "profile.name.changed": "user",
    "profile.avatar.changed": "image",
    "profile.playlist.added": "playlistPlus",
    "profile.playlist.removed": "playlistMinus",
    "profile.playlist.renamed": "pencil",
    "profile.playlist.cover.changed": "image",
    "profile.playlist.visibility.changed": "eye",
    "profile.playlist.meta.changed": "pencil",
    "playlist.meta.changed": "pencil",
    "profile.followers.count": "users",
    "profile.follower.appear": "userPlus",
    "profile.follower.disappear": "userMinus",
    "playlist.item.added": "plusCircle",
    "playlist.item.removed": "minusCircle",
    "playlist.item.count": "list",
  };

  /** Returns a raw SVG string for the kind, or null. */
  function iconSvg(kind) {
    var id = ICON[kind];
    if (!id) return null;
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + SVG[id] + "</svg>";
  }
  function icon(kind) {
    var s = iconSvg(kind);
    return s || "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"2\" /></svg>";
  }

  /** Short, human labels for a change kind ("playlist renamed", not "profile.playlist.renamed"). */
  var KIND_LABEL = {
    "profile.name.changed": "name changed",
    "profile.avatar.changed": "picture changed",
    "profile.followers.count": "followers",
    "profile.follower.appear": "follower appeared",
    "profile.follower.disappear": "follower left",
    "profile.playlist.added": "playlist added",
    "profile.playlist.removed": "playlist removed",
    "profile.playlist.renamed": "playlist renamed",
    "profile.playlist.cover.changed": "cover changed",
    "profile.playlist.visibility.changed": "visibility",
    "profile.playlist.meta.changed": "playlist edited",
    "playlist.meta.changed": "playlist edited",
    "playlist.item.added": "track added",
    "playlist.item.removed": "track removed",
    "playlist.item.count": "track count",
  };

  function kindLabel(kind) {
    return KIND_LABEL[kind] || String(kind || "").replace(/\./g, " ");
  }

  /**
   * One short phrase for a change row: what happened, and the values that
   * changed. Keeps the feed short instead of repeating raw field diffs.
   */
  /** A bare base62 token of 22+ chars is an id, never a label. */
  var ID_SHAPED = /^[A-Za-z0-9]{22,}$/;

  function idShaped(s) {
    return ID_SHAPED.test(String(s || ""));
  }

  /** A stored detail from before the id fixes may carry a raw token; never print it. */
  function safeDetail(d) {
    var s = String(d == null ? "" : d);
    if (!s) return "";
    if (idShaped(s) || s.indexOf("spotify:") === 0) return "";
    return s;
  }

  function humanDetail(row) {
    var r = row || {};
    var extra = r.extra || {};
    var from = extra.from;
    var to = extra.to;
    switch (r.kind) {
      case "profile.name.changed":
      case "profile.playlist.renamed":
        return to ? "now called “" + to + "”" : "name changed";
      case "profile.avatar.changed":
        return "new picture";
      case "profile.playlist.cover.changed":
        return "new cover";
      case "profile.followers.count":
        if (to == null) return "followers changed";
        return from == null ? String(to) + " followers" : String(from) + " → " + String(to);
      case "profile.playlist.added":
        return safeDetail(r.detail) || "playlist added";
      case "profile.playlist.removed":
        return safeDetail(r.detail) || "playlist removed";
      case "profile.follower.appear":
      case "profile.follower.disappear":
        return safeDetail(r.detail) || kindLabel(r.kind);
      case "playlist.item.added":
        return "added";
      case "playlist.item.removed":
        return "removed";
      default:
        return safeDetail(r.detail) || kindLabel(r.kind);
    }
  }

  /**
   * Square cover image (playlist art / album art) with the same deterministic
   * gradient fallback as Avatar. `size` is px for width/height.
   */
  function Cover(props) {
    var h = root.PWT.react.h;
    var size = props.size || 48;
    var cls = "pwt-cover" + (props.small ? " pwt-cover-sm" : "");
    var style = { width: size + "px", height: size + "px" };
    if (props.src) {
      return h(Img, {
        class: cls,
        src: props.src,
        alt: props.alt || "",
        style: style,
        seed: props.id || props.name,
        fallbackText: (props.name || "?").slice(0, 1).toUpperCase(),
      });
    }
    return h(
      "span",
      {
        class: cls + " pwt-cover-fallback",
        style: Object.assign(gradientStyle(props.id || props.name || "?"), style),
        title: props.alt || "",
        role: "img",
        "aria-label": props.alt || "cover",
      },
      (props.name || "?").slice(0, 1).toUpperCase()
    );
  }

  function Badge(props) {
    var tone = props.tone || "neutral";
    return h("span", { class: "pwt-badge pwt-badge-" + tone, title: props.title || props.tone }, props.children);
  }

  /** The honesty chip: a date that is observation-only, not Spotify's own. */
  function ObsChip(props) {
    if (!props.observed) return null;
    return h("span", { class: "pwt-obs", title: "Spotify supplied no date for this change; shown when we first observed it" }, "obs");
  }

  function Btn(props) {
    var attrs = {
      class: "pwt-btn" + (props.primary ? " pwt-btn-primary" : "") + (props.danger ? " pwt-btn-danger" : "") + (props.ghost ? " pwt-btn-ghost" : ""),
      type: "button",
      onClick: props.onClick || function () {},
      disabled: props.disabled ? true : undefined,
      title: props.title || undefined,
    };
    return h("button", attrs, props.label || props.children);
  }

  /** Deterministic gradient from an id hash (used when no image URL, or when one fails). */
  function gradientStyle(seed) {
    return { background: gradientCss(seed) };
  }

  function gradientCss(seed) {
    var u = util();
    var rand = u.seedRandom(seed || "?");
    var a = Math.floor(rand() * 360);
    var b = (a + 140) % 360;
    return "linear-gradient(140deg, hsl(" + a + " 52% 32%), hsl(" + b + " 48% 24%))";
  }

  /** A URL is safe to inline in CSS once quotes and backslashes are escaped. */
  function cssUrl(url) {
    return 'url("' + String(url).replace(/\\/g, "/").replace(/"/g, "%22") + '")';
  }

  /**
   * An image tile that cannot break: the photo is one background layer and the
   * deterministic gradient sits underneath, so a failed or slow image shows a
   * coloured tile instead of a broken-image icon. A spotify:mosaic: ref is a
   * 2x2 of tiles — composited here as four 50% layers, the exact cover.
   */
  function Img(props) {
    var h = root.PWT.react.h;
    // Spotify hands back spotify:image:/spotify:mosaic: refs on current builds;
    // resolve them here so no surface can fall back to a gradient for artwork
    // that actually exists.
    var utilApi = root.PWT.util;
    var tiles = utilApi && utilApi.mosaicTiles ? utilApi.mosaicTiles(props.src) : null;
    var gradient = gradientCss(props.seed || props.alt || "?");
    if (tiles && tiles.length >= 4) {
      var tileLayers = tiles.slice(0, 4).map(cssUrl);
      // The composite owns these four properties; keep this component's props.style for size/shape only.
      var compositeExtra = Object.assign({}, props.style);
      delete compositeExtra.backgroundImage;
      delete compositeExtra.backgroundSize;
      delete compositeExtra.backgroundPosition;
      delete compositeExtra.backgroundRepeat;
      var composite = Object.assign(
        {
          backgroundImage: tileLayers.join(", ") + ", " + gradient,
          backgroundSize: "50% 50%, 50% 50%, 50% 50%, 50% 50%, cover",
          backgroundPosition: "0% 0%, 100% 0%, 0% 100%, 100% 100%, center",
          backgroundRepeat: "no-repeat, no-repeat, no-repeat, no-repeat, no-repeat",
        },
        compositeExtra
      );
      return h(
        "span",
        {
          class: (props.class || "") + " pwt-img-fallback",
          style: composite,
          title: props.title || props.alt || "",
          role: "img",
          "aria-label": props.alt || "image",
        },
        props.fallbackText || ""
      );
    }
    var single = props.src;
    if (tiles && tiles.length) single = tiles[0]; // a short mosaic is its first tile
    var resolved = single && utilApi && utilApi.imageUrl ? utilApi.imageUrl(single) : single;
    var url = resolved ? cssUrl(resolved) : "";
    var style = Object.assign(
      {
        backgroundImage: url ? url + ", " + gradient : gradient,
        backgroundSize: "cover",
        backgroundPosition: "center",
      },
      props.style
    );
    return h(
      "span",
      {
        class: (props.class || "") + " pwt-img-fallback",
        style: style,
        title: props.title || props.alt || "",
        role: "img",
        "aria-label": props.alt || "image",
      },
      props.fallbackText || ""
    );
  }

  /** Small square thumbnail (album art, playlist cover). */
  function Thumb(props) {
    var h = root.PWT.react.h;
    var cls = "pwt-thumb" + (props.large ? " pwt-thumb-lg" : props.small ? " pwt-thumb-sm" : "");
    return h(Img, {
      class: cls,
      src: props.src,
      alt: props.alt || "",
      seed: props.seed || props.alt,
      fallbackText: props.fallbackText || "",
    });
  }

  /** Deterministic gradient avatar from an id hash (used when no image URL). */
  function Avatar(props) {
    if (props.src) {
      return h(Img, {
        class: "pwt-avatar" + (props.small ? " pwt-avatar-sm" : props.large ? " pwt-avatar-lg" : ""),
        src: props.src,
        alt: props.alt || "",
        seed: props.id || props.name,
        fallbackText: (props.name || "?").slice(0, 1).toUpperCase(),
      });
    }
    return h(
      "span",
      {
        class: "pwt-avatar pwt-avatar-fallback" + (props.small ? " pwt-avatar-sm" : props.large ? " pwt-avatar-lg" : ""),
        style: gradientStyle(props.id || props.name || "?"),
        title: props.alt || "",
        role: "img",
        "aria-label": props.alt || "avatar",
      },
      (props.name || "?").slice(0, 1).toUpperCase()
    );
  }

  function Stat(props) {
    return h(
      "div",
      { class: "pwt-stat" + (props.tone ? " pwt-stat-" + props.tone : "") },
      h("span", { class: "pwt-stat-value" }, props.value),
      h("span", { class: "pwt-stat-label" }, props.label)
    );
  }

  function Empty(props) {
    return h(
      "div",
      { class: "pwt-empty" },
      h("div", { class: "pwt-empty-title" }, props.title || "Nothing here yet"),
      props.hint ? h("div", { class: "pwt-empty-hint" }, props.hint) : null,
      props.action || null
    );
  }

  function Section(props) {
    return h(
      "section",
      { class: "pwt-section" + (props.class ? " " + props.class : "") },
      props.title
        ? h(
            "div",
            { class: "pwt-section-head" },
            h("h3", { class: "pwt-section-title" }, props.title),
            props.hint ? h("span", { class: "pwt-muted pwt-tiny" }, props.hint) : null,
            props.actions ? h("span", { class: "pwt-section-actions" }, props.actions) : null
          )
        : null,
      props.children
    );
  }

  function Health(props) {
    var map = { ok: ["ok", "success"], degraded: ["degraded", "warning"], failing: ["failing", "error"], new: ["new", "neutral"] };
    var m = map[props.state] || ["unknown", "neutral"];
    return h("span", { class: "pwt-health pwt-health-" + m[1], title: props.title || m[0] }, m[0]);
  }

  function Progress(props) {
    var pct = props.total ? Math.min(100, Math.round((props.done / props.total) * 100)) : 0;
    return h(
      "span",
      { class: "pwt-progress", title: props.done + "/" + props.total },
      h("span", { class: "pwt-progress-track" }, h("span", { class: "pwt-progress-fill", style: { width: pct + "%" } })),
      h("span", { class: "pwt-progress-text" }, props.done + "/" + props.total + (props.suffix ? " · " + props.suffix : ""))
    );
  }

  /**
   * One change-log row. Shared by Overview, Profiles, Playlist detail and the
   * global Change log so a date renders the same way everywhere.
   */
  function ChangeRow(props) {
    var u = util();
    var row = props.row || {};
    var observed = row.sourceDate == null;
    // A name we resolved, else whatever the row itself says about its subject.
    // Never a raw id: an id-shaped candidate is rejected, and an unresolvable
    // target shows an honest dash.
    var displayCandidate = props.secondary || row.display || row.targetName || "";
    var titleCandidate = row.title && String(row.title).length <= 40 ? String(row.title) : "";
    var levelFallback = row.level === "profile" ? "Unknown listener" : row.level === "playlist" ? "Untitled playlist" : "—";
    var secondary = displayCandidate && !idShaped(displayCandidate) ? displayCandidate : titleCandidate && !idShaped(titleCandidate) ? titleCandidate : levelFallback;
    var image = props.image || row.image || "";
    var isItem = row.kind && row.kind.indexOf("playlist.item.") === 0;
    // The target (playlist / profile) stays the headline; the track, when we
    // know it, rides along in the detail line so the row never flips shape.
    var title = secondary;
    var detail = humanDetail(row);
    if (isItem && row.trackTitle) detail = row.trackTitle + " · " + detail;
    var iconTone =
      row.kind === "playlist.item.added" || row.kind === "profile.playlist.added"
        ? " pwt-change-icon-add"
        : row.kind === "playlist.item.removed" || row.kind === "profile.playlist.removed"
          ? " pwt-change-icon-remove"
          : " pwt-change-icon-neutral";
    return h(
      "div",
      { class: "pwt-change pwt-change-" + row.level, "data-kind": row.kind, "data-key": props.rowKey || undefined },
      image
        ? h(Img, { class: "pwt-change-thumb", src: image, alt: secondary || "", seed: row.target })
        : h("span", { class: "pwt-change-icon" + iconTone, title: row.kind, dangerouslySetInnerHTML: { __html: icon(row.kind) } }),
      h(
        "span",
        { class: "pwt-change-main" },
        h("span", { class: "pwt-change-title" }, title),
        h("span", { class: "pwt-change-detail" }, detail)
      ),
      h(
        "span",
        { class: "pwt-change-when", title: observed ? "Observed at " + u.fmtDateTime(row.observedAt) : "Spotify date" },
        observed ? "first seen " + u.fmtDateTime(row.ts) : u.fmtDateTime(row.ts),
        h(ObsChip, { observed: observed })
      ),
      props.linkUri ? h("button", { type: "button", class: "pwt-link-btn", onClick: function () { if (props.onOpen) props.onOpen(props.linkUri); } }, "open") : null
    );
  }

  /** Straight answer when Spotify cannot supply a signal: never a fake zero. */
  function Unavailable(props) {
    return h(
      "div",
      { class: "pwt-unavailable" },
      h("span", { class: "pwt-unavailable-title" }, props.title || "unavailable on this client"),
      props.detail ? h("span", { class: "pwt-muted pwt-tiny" }, props.detail) : null
    );
  }

  /** Single-line inline countdown chip. */
  function Countdown(props) {
    var u = util();
    var from = props.from || Date.now();
    var to = props.to || 0;
    if (!to) return h("span", { class: "pwt-muted pwt-tiny" }, "not scheduled");
    if (to <= from) return h("span", { class: "pwt-muted pwt-tiny" }, "due now");
    return h("span", { class: "pwt-muted pwt-tiny" }, u.fmtDuration(to - from));
  }

  return {
    ID_SHAPED: ID_SHAPED,
    idShaped: idShaped,
    icon: icon,
    kindLabel: kindLabel,
    humanDetail: humanDetail,
    Badge: Badge,
    ObsChip: ObsChip,
    Btn: Btn,
    Avatar: Avatar,
    Cover: Cover,
    Img: Img,
    Thumb: Thumb,
    Stat: Stat,
    Empty: Empty,
    Section: Section,
    Health: Health,
    Progress: Progress,
    ChangeRow: ChangeRow,
    Unavailable: Unavailable,
    Countdown: Countdown,
  };
});
