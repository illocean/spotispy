/* eslint-disable */
/** Spotispy — Profiles view (§5.2). */
(function (root, factory) {
  root.PWT = root.PWT || {};
  root.PWT.ui = root.PWT.ui || {};
  root.PWT.ui.Profiles = factory(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function Profiles(props) {
    var kit = root.PWT.uiKit;
    var view = root.PWT.view;
    var charts = root.PWT.charts;
    var h = root.PWT.react.h;
    var u = root.PWT.util;
    var model = props.model || { rows: [], selected: null };
    var selected = model.selected || (model.rows[0] && model.rows[0].id) || null;
    var row = model.rows.filter(function (r) {
      return r.id === selected;
    })[0];

    // While the route loads, say so — "No profiles watched" would be a lie
    // about a list that is merely not loaded yet.
    if (props.loading && !model.rows.length) {
      return h(
        "div",
        { class: "pwt-view pwt-profiles" },
        h(
          "header",
          { class: "pwt-view-head" },
          h("div", { class: "pwt-hero-brand" }, h("span", { class: "pwt-wordmark" }, "roster"), h("h1", { class: "pwt-h1" }, "Profiles"))
        ),
        h(kit.Empty, { title: "Loading…", hint: "Reading the roster from local storage." })
      );
    }

    var roster = model.rows.length
      ? h(
          "div",
          { class: "pwt-roster" },
          model.rows.map(function (r) {
            return h(
              "button",
              {
                key: r.id,
                type: "button",
                class: "pwt-roster-row" + (r.id === selected ? " is-active" : ""),
                onClick: function () {
                  if (props.onSelect) props.onSelect(r.id);
                },
                "data-user": r.id,
              },
              h(kit.Avatar, { id: r.id, name: r.name, src: r.avatarUrl, alt: r.name }),
              h(
                "span",
                { class: "pwt-roster-main" },
                h("span", { class: "pwt-roster-name" }, r.name),
                h(
                  "span",
                  { class: "pwt-roster-meta" },
                  (r.followers == null ? "—" : String(r.followers)) + " followers · " + r.playlistCount + (r.playlistCount === 1 ? " playlist" : " playlists") + (r.activity ? " · live" : "")
                )
              ),
              h(
                "span",
                { class: "pwt-roster-side" },
                h(kit.Health, { state: r.health }),
                h(
                  "span",
                  { class: "pwt-muted pwt-tiny", title: r.lastChangeAt ? u.fmtDateTime(r.lastChangeAt) : "no change yet" },
                  r.lastChangeAt ? u.ago(r.lastChangeAt) : "no change"
                )
              )
            );
          })
        )
      : h(kit.Empty, { title: "No profiles watched", hint: "Add one in Settings." });

    var detail = null;
    if (row) {
      var groups = view.timeline(row.changes);
      var followerProbe = row.probe && row.probe.followersList;
      detail = h(
        "div",
        { class: "pwt-profile-detail" },
        h(
          "header",
          { class: "pwt-profile-head" },
          h(kit.Avatar, { id: row.id, name: row.name, src: row.avatarUrl, alt: row.name }),
          h(
            "div",
            { class: "pwt-profile-title" },
            h("h2", { class: "pwt-h2" }, row.name),
            h(
              "span",
              { class: "pwt-muted pwt-tiny", title: row.name },
              row.watchedAt ? "watching since " + u.fmtDate(row.watchedAt) : "watching"
            ),
            h(
              "span",
              { class: "pwt-muted pwt-tiny" },
              row.lastSyncedAt ? "scanned " + u.ago(row.lastSyncedAt) + " · " + u.fmtDateTime(row.lastSyncedAt) : "never scanned"
            )
          ),
          h(
            "div",
            { class: "pwt-profile-actions" },
            h(kit.Btn, {
              label: "Watch activity",
              primary: !row.activity,
              onClick: function () {
                if (props.onToggleActivity) props.onToggleActivity(row.id, !row.activity);
              },
            }),
            h(kit.Btn, {
              label: "Open profile",
              onClick: function () {
                if (props.onOpenProfile) props.onOpenProfile(row.id);
              },
            }),
            h(kit.Btn, {
              label: "Unwatch",
              danger: true,
              ghost: true,
              onClick: function () {
                if (props.onUnwatch) props.onUnwatch(row.id);
              },
            })
          )
        ),
        h(
          "div",
          { class: "pwt-kpis pwt-kpis-tight" },
          h(kit.Stat, { value: row.followers == null ? "—" : row.followers, label: "followers" }),
          h(kit.Stat, { value: row.playlistCount, label: "playlists" }),
          h(kit.Stat, { value: row.changes.length, label: "changes" })
        ),
        h(
          kit.Section,
          { title: "Followers", hint: followerProbe && followerProbe !== "ok" ? followerProbe : "capability-gated" },
          followerProbe === "unavailable"
            ? h(kit.Unavailable, { title: "Follower list unavailable on this client", detail: row.probeError || "Spotify did not return the follower list for this session." })
            : followerProbe === "degraded"
              ? h(kit.Unavailable, { title: "Follower list degraded", detail: "The endpoint answered, but not with a usable list." })
              : h(
                  "div",
                  { class: "pwt-followers" },
                  h(charts.Sparkline, {
                    values: (row.followerHistory || []).map(function (x) {
                      return x.value;
                    }),
                    label: "follower count",
                  }),
                  h(kit.Stat, { value: row.followers == null ? "—" : row.followers, label: "current" }),
                  h(
                    "span",
                    { class: "pwt-muted pwt-tiny" },
                    (row.followerHistory || []).length
                      ? "from " + u.fmtDate(row.followerHistory[0].at) + " to " + u.fmtDateTime(row.followerHistory[row.followerHistory.length - 1].at)
                      : "no history yet"
                  )
                )
        ),
        h(
          kit.Section,
          { title: "Timeline", hint: groups.length + (groups.length === 1 ? " day" : " days") },
          groups.length
            ? h(
                "div",
                { class: "pwt-timeline" },
                groups.map(function (g) {
                  return h(
                    "div",
                    { class: "pwt-timeline-day", key: g.day },
                    h("div", { class: "pwt-timeline-date" }, g.label),
                    h(
                      "div",
                      { class: "pwt-timeline-rows" },
                      g.rows.map(function (c, i) {
                        return h(kit.ChangeRow, {
                          key: g.day + i,
                          row: c,
                          secondary: row.name,
                          onOpen: props.onOpenTrack,
                        });
                      })
                    )
                  );
                })
              )
            : h(kit.Empty, { title: "No profile changes yet", hint: "The next scan records the first baseline." })
        )
      );
    }

    return h(
      "div",
      { class: "pwt-view pwt-profiles" },
      h(
        "header",
        { class: "pwt-view-head pwt-view-head-split" },
        h(
          "div",
          { class: "pwt-hero-brand" },
          h("span", { class: "pwt-wordmark" }, "roster"),
          h("h1", { class: "pwt-h1" }, "Profiles")
        )
      ),
      h("div", { class: "pwt-split" }, h("div", { class: "pwt-split-left" }, roster), h("div", { class: "pwt-split-right" }, detail))
    );
  }

  return Profiles;
});
