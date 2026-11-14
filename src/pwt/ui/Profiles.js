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
    // Hooks first — the loading and empty early-returns below must never
    // change the hook order.
    var hook = root.PWT.react.hooks();
    var queryState = hook.useState("");
    var watchQuery = queryState[0] || "";
    var setWatchQuery = queryState[1];
    var model = props.model || { rows: [], selected: null };
    var rows = model.rows || [];
    // A selected id that names no row falls back to the first row — the
    // picker must never show a selection the detail cannot render.
    var selected = rows.some(function (r) {
      return r.id === model.selected;
    })
      ? model.selected
      : rows.length
        ? rows[0].id
        : null;
    var row = rows.filter(function (r) {
      return r.id === selected;
    })[0];

    // While the route loads, say so — "No profiles watched" would be a lie
    // about a list that is merely not loaded yet.
    if (props.loading && !rows.length) {
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

    // Selection lives in a dropdown in the view head, so the detail below can
    // run the full width of the page. The search box typeaheads into the same
    // roster: it filters the options, it never commits a selection by itself —
    // only picking an option or pressing Enter does.
    var filterQuery = String(watchQuery).trim().toLowerCase();
    var filteredRows = !filterQuery
      ? rows
      : rows.filter(function (r) {
          return String(r.name || r.id || "").toLowerCase().indexOf(filterQuery) >= 0;
        });
    var picker = rows.length
      ? h(
          "div",
          { class: "pwt-profiles-picker" },
          h(kit.Select, {
            options: filteredRows.map(function (r) {
              var label = r.name || String(r.id);
              if (r.followers != null) label += " · " + r.followers + " followers";
              return { value: r.id, label: label };
            }),
            value: selected,
            onChange: function (id) {
              if (props.onSelect) props.onSelect(id);
            },
            "data-pwt": "profiles-picker",
          })
        )
      : null;
    var search = rows.length
      ? h("input", {
          class: "pwt-input pwt-input-sm pwt-profiles-search",
          type: "search",
          placeholder: "search watched…",
          value: watchQuery,
          onInput: function (ev) {
            setWatchQuery(ev.target.value);
          },
          onKeyDown: function (ev) {
            if (ev.key === "Escape") {
              setWatchQuery("");
              return;
            }
            if (ev.key === "Enter" && filteredRows.length && props.onSelect) {
              ev.preventDefault();
              props.onSelect(filteredRows[0].id);
            }
          },
          "data-pwt": "profiles-search",
        })
      : null;
    var headControls = rows.length
      ? h("div", { class: "pwt-profiles-controls" }, picker, search)
      : null;

    var detail = null;
    if (row) {
      var groups = view.timeline(row.changes);
      var followerProbe = row.probe && row.probe.followersList;
      // Compact followers block, folded into the hero: sparkline + current
      // value + honesty caption when the probe allows it, a muted one-liner
      // when Spotify cannot supply the list. Never a fabricated flat line.
      var followerHistory = row.followerHistory || [];
      var followerBlock;
      if (followerProbe === "unavailable") {
        followerBlock = h(
          "div",
          { class: "pwt-profile-followers" },
          h("span", { class: "pwt-muted pwt-tiny" }, "Follower list unavailable on this client"),
          row.probeError ? h("span", { class: "pwt-profile-followers-detail" }, row.probeError) : null
        );
      } else if (followerProbe === "degraded") {
        followerBlock = h(
          "div",
          { class: "pwt-profile-followers" },
          h("span", { class: "pwt-muted pwt-tiny" }, "Follower list degraded"),
          h("span", { class: "pwt-profile-followers-detail" }, "The endpoint answered, but not with a usable list.")
        );
      } else {
        followerBlock = h(
          "div",
          { class: "pwt-profile-followers" },
          h(
            "div",
            { class: "pwt-profile-followers-row" },
            h(charts.Sparkline, {
              values: followerHistory.map(function (x) {
                return x.value;
              }),
              label: "follower count",
              width: 200,
              height: 48,
            }),
            h(kit.Stat, { value: row.followers == null ? "—" : row.followers, label: "current", tone: "tight" })
          ),
          h(
            "span",
            { class: "pwt-muted pwt-tiny pwt-followers-range" },
            followerHistory.length
              ? "from " + u.fmtDate(followerHistory[0].at) + " to " + u.fmtDateTime(followerHistory[followerHistory.length - 1].at)
              : "no history yet"
          ),
          !followerProbe ? h("span", { class: "pwt-profile-followers-hint" }, "capability-gated") : null
        );
      }
      detail = h(
        "div",
        { class: "pwt-profile-detail" },
        h(
          "header",
          { class: "pwt-profile-head pwt-profile-hero" },
          h(kit.Avatar, { id: row.id, name: row.name, src: row.avatarUrl, alt: row.name, class: "pwt-hero-avatar" }),
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
            ),
            h(
              "div",
              { class: "pwt-profile-stats" },
              h(kit.Stat, { value: row.followers == null ? "—" : row.followers, label: "followers", tone: "tight" }),
              h(kit.Stat, { value: row.playlistCount, label: "playlists", tone: "tight" }),
              h(kit.Stat, { value: row.changes.length, label: "changes", tone: "tight" })
            ),
            followerBlock
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
        ),
        headControls
      ),
      detail || h(kit.Empty, { title: "No profiles watched", hint: "Add one in Settings." })
    );
  }

  return Profiles;
});
