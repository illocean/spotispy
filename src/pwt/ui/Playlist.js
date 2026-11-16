/* eslint-disable */
/** Spotispy — Playlist detail (§5.3). */
(function (root, factory) {
  root.PWT = root.PWT || {};
  root.PWT.ui = root.PWT.ui || {};
  root.PWT.ui.Playlist = factory(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function Playlist(props) {
    var kit = root.PWT.uiKit;
    var charts = root.PWT.charts;
    var h = root.PWT.react.h;
    var u = root.PWT.util;
    var m = props.model;
    if (!m || !Array.isArray(m.changes)) {
      return h(
        "div",
        { class: "pwt-view" },
        props.loading
          ? h(kit.Empty, { title: "Loading…", hint: "Reading the playlist from local storage." })
          : h(kit.Empty, { title: "Playlist not watched", hint: "Right-click a playlist and choose “Watch playlist”, or add its URL in Settings." })
      );
    }

    var filter = props.filter || { kind: "", query: "" };
    var changes = m.changes.filter(function (c) {
      if (filter.kind === "added" && c.kind !== "playlist.item.added") return false;
      if (filter.kind === "removed" && c.kind !== "playlist.item.removed") return false;
      if (filter.kind === "edits" && c.kind.indexOf("playlist.item.") === 0) return false;
      if (filter.query) {
        var q = filter.query.toLowerCase();
        var hay = [c.detail, c.trackLabel, c.artist, c.album, c.uri, c.title].join(" ").toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var points = u.lastDays(30).map(function (day) {
      return { day: day, added: m.addedByDay[day] || 0, removed: 0 };
    });

    var healthNote = m.health === "failing" ? "3+ consecutive fetch failures" : m.health === "degraded" ? "a fetch failed recently" : "polling normally";

    return h(
      "div",
      { class: "pwt-view pwt-playlist" },
      h(
        "header",
        { class: "pwt-pl-head" },
        h(
          "div",
          { class: "pwt-pl-cover", title: m.coverHash || "" },
          h(kit.Cover, { id: m.id, name: m.name, src: m.coverUrl, alt: m.name, size: 72 })
        ),
        h(
          "div",
          { class: "pwt-pl-title" },
          h("span", { class: "pwt-wordmark" }, "playlist"),
          h("h1", { class: "pwt-h1" }, m.name),
          h(
            "span",
            { class: "pwt-muted pwt-tiny" },
            (m.trackCount != null ? m.trackCount + " tracks · " : "") +
              "watched since " + (m.watchedAt ? u.fmtDate(m.watchedAt) : "—") +
              (m.lastChangeAt ? " · last change " + u.fmtDate(m.lastChangeAt) : "")
          ),
          h(
            "span",
            { class: "pwt-pl-status" },
            h(kit.Health, { state: m.health, title: healthNote }),
            m.capped
              ? h(kit.Badge, { tone: "warning", title: "The source truncated the track list, so removals cannot be proven from it." }, "truncated source")
              : null,
            h("span", { class: "pwt-muted pwt-tiny", title: m.lastSyncedAt ? u.fmtDateTime(m.lastSyncedAt) : "" }, "scanned " + m.lastSyncLabel + " · " + (m.source || "—"))
          )
        ),
        h(
          "div",
          { class: "pwt-pl-actions" },
          h(kit.Btn, {
            label: "Scan now",
            primary: true,
            onClick: function () {
              if (props.onForceScan) props.onForceScan(m.id);
            },
          }),
          h(kit.Btn, {
            label: "Open in Spotify",
            onClick: function () {
              if (props.onOpen) props.onOpen("spotify:playlist:" + m.id);
            },
          }),
          h(kit.Btn, {
            label: "Unwatch",
            danger: true,
            ghost: true,
            onClick: function () {
              if (props.onUnwatch) props.onUnwatch("playlist", m.id);
            },
          })
        )
      ),
      m.pendingShrink
        ? h(
            "div",
            { class: "pwt-pl-pending" },
            h(kit.Badge, { tone: "warning", title: "A large shrink was held back until a second read confirms it" }, "holding a " + m.pendingShrink.confirmations + "/2 confirmed shrink")
          )
        : null,
      h(
        "div",
        { class: "pwt-kpis pwt-kpis-tight" },
        h(kit.Stat, { value: m.trackCount == null ? "—" : m.trackCount, label: "tracks" }),
        // Only shown when the client exposed a like counter and no follower
        // count: labelled "likes", never passed off as followers.
        m.followers == null && m.likes != null ? h(kit.Stat, { value: m.likes, label: "likes" }) : null,
        h(kit.Stat, { value: m.daysSinceUpdate == null ? "—" : m.daysSinceUpdate, label: "days quiet" }),
        h(kit.Stat, { value: changes.length, label: "changes" })
      ),
      h(kit.Section, { title: "Additions · 30 days" }, h(charts.StackedArea, { points: points, label: "additions per day" })),
      h(
        kit.Section,
        {
          title: "Change timeline",
          actions: h(
            "span",
            { class: "pwt-filter" },
            // kit.Select, not a native <select>: CEF often refuses to open the
            // native popup, which made this filter unusable in the client.
            h(kit.Select, {
              options: [
                { value: "", label: "all changes" },
                { value: "added", label: "added" },
                { value: "removed", label: "removed" },
                { value: "edits", label: "edits" },
              ],
              value: filter.kind,
              onChange: function (v) {
                if (props.onFilter) props.onFilter({ kind: v, query: filter.query });
              },
              "data-pwt": "filter-kind",
            }),
            h("input", {
              class: "pwt-input pwt-input-sm",
              type: "search",
              placeholder: "search title, artist…",
              value: filter.query,
              onInput: function (ev) {
                if (props.onFilter) props.onFilter({ kind: filter.kind, query: ev.target.value });
              },
              "data-pwt": "filter-search",
            })
          ),
        },
        changes.length
          ? h(
              "div",
              { class: "pwt-table-scroll" },
              h(
                "table",
                { class: "pwt-table pwt-table-changes" },
              h(
                "thead",
                null,
                h(
                  "tr",
                  null,
                  h("th", null, "When"),
                  h("th", null, "Change"),
                  h("th", null, "Track"),
                  h("th", null, "Artist"),
                  h("th", null, "Album"),
                  h("th", null, "Added by")
                )
              ),
              h(
                "tbody",
                null,
                changes.map(function (c, i) {
                  var observed = c.sourceDate == null;
                  var addedBy = c.addedBy || "";
                  return h(
                    "tr",
                    { key: "pl" + i, class: "pwt-row pwt-row-" + c.kind.replace(/\./g, "-"), "data-kind": c.kind },
                    h(
                      "td",
                      { class: "pwt-when", title: c.sourceDate ? "Spotify date: " + u.fmtDateTime(c.sourceDate) : "first seen" },
                      u.fmtDateTime(c.ts),
                      h(kit.ObsChip, { observed: observed })
                    ),
                    h("td", null, h(kit.Badge, { tone: c.kind === "playlist.item.added" ? "success" : c.kind === "playlist.item.removed" ? "warning" : "neutral" }, c.kind === "playlist.item.added" ? "added" : c.kind === "playlist.item.removed" ? "removed" : "edited")),
                    h(
                      "td",
                      { class: "pwt-track-cell" },
                      h(
                        "span",
                        { class: "pwt-track-line" },
                        c.art ? h(kit.Thumb, { src: c.art, alt: "", seed: c.uri }) : null,
                        h(
                          "span",
                          { class: "pwt-track-text" },
                          h("span", { class: "pwt-track-title" }, c.trackLabel || c.detail || "Unknown track"),
                          c.detail ? h("span", { class: "pwt-muted pwt-tiny" }, c.detail) : null
                        )
                      )
                    ),
                    h("td", null, c.artist || "—"),
                    h("td", null, c.album || "—"),
                    h("td", null, addedBy || "—")
                  );
                })
                )
              )
            )
          : h(kit.Empty, { title: "No changes match", hint: "Clear the filters or wait for the next scan." })
      )
    );
  }

  return Playlist;
});
