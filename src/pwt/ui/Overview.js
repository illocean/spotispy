/* eslint-disable */
/**
 * Spotispy — dashboard.
 *
 * The watched people are the index of the dashboard: pick a user, see their
 * public playlists (with covers) and their updates. The "Everyone" chip
 * switches back to the aggregate KPIs, the 30-day chart and the recent feed.
 */
(function (root, factory) {
  root.PWT = root.PWT || {};
  root.PWT.ui = root.PWT.ui || {};
  root.PWT.ui.Overview = factory(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  /** Group rows by day, preserving input order (rows arrive newest first). */
  function groupFeed(rows) {
    var groups = [];
    var byDay = {};
    (rows || []).forEach(function (r) {
      var label = root.PWT.view.dayLabel(r.ts, Date.now());
      if (!byDay[label]) {
        byDay[label] = { label: label, rows: [] };
        groups.push(byDay[label]);
      }
      byDay[label].rows.push(r);
    });
    return groups;
  }

  /** A day-separated change feed. Shared by the Updates and Everyone sections. */
  function DayFeed(props) {
    var kit = root.PWT.uiKit;
    var h = root.PWT.react.h;
    var rows = props.rows;
    var keyPrefix = props.keyPrefix || "fd";
    var onOpenTrack = props.onOpenTrack;
    var groups = groupFeed(rows);
    return h(
      "div",
      { class: "pwt-feed" },
      groups.map(function (g, gi) {
        return h(
          "div",
          { class: "pwt-timeline-day", key: keyPrefix + "d" + gi },
          h("div", { class: "pwt-timeline-date" }, g.label),
          h(
            "div",
            { class: "pwt-timeline-rows" },
            g.rows.map(function (r, i) {
              return h(kit.ChangeRow, {
                key: keyPrefix + gi + "-" + i,
                row: r,
                onOpen: function (uri) {
                  if (onOpenTrack) onOpenTrack(uri);
                },
              });
            })
          )
        );
      })
    );
  }

  function Overview(props) {
    var kit = root.PWT.uiKit;
    var charts = root.PWT.charts;
    var h = root.PWT.react.h;
    var hooks = root.PWT.react.hooks();
    var u = root.PWT.util;
    var vm = props.vm;
    var data = vm && vm.dashboard ? vm.dashboard : null;
    var scan = vm && vm.dashboard && vm.dashboard.scan ? vm.dashboard.scan : {};
    var onScan = props.onScan || function () {};
    var selState = hooks.useState(null);
    var selected = selState[0];
    var setSelected = selState[1];

    if (!data) {
      return h("div", { class: "pwt-view" }, h("h1", { class: "pwt-h1" }, "Spotispy"), h("p", { class: "pwt-muted" }, "Loading…"));
    }
    var dash = root.PWT.view.userDashboard(data, selected, Date.now());
    var scanState = dash.scan || scan || {};
    var everything = selected === "everyone";
    var detail = everything ? null : dash.detail;
    var liveNow = props.liveNow || [];
    var isLive = detail ? liveNow.indexOf(detail.id) >= 0 : false;

    var progress = scanState.scanning
      ? h(
          "div",
          { class: "pwt-scan-progress" },
          h(kit.Progress, {
            done: scanState.done || 0,
            total: scanState.total || 0,
            suffix: (scanState.totals && "+" + (scanState.totals.added || 0) + " new") || "",
          })
        )
      : null;

    // Honest scan outcome: a scan that wrote nothing still says what it did,
    // and what failed. Silence is the one thing that looks like a dead button.
    var scanSummary = null;
    var lastResult = dash.lastResult || (scanState && scanState.lastResult) || null;
    if (lastResult) {
      var r = lastResult;
      var t = (r && r.totals) || {};
      var changed = (t.added || 0) + (t.removed || 0) + (t.edits || 0);
      var crashed = !!(r && r.error);
      var failed = t.failed || 0;
      var detailLines = ["scope: " + (r.scope || "all"), "+" + (t.added || 0) + " added", "−" + (t.removed || 0) + " removed", (t.edits || 0) + " edits"];
      if (failed) detailLines.push(failed + " source(s) failed");
      if (t.held) detailLines.push(t.held + " held (unstable)");
      // Name the reason, not just the count: "3 sources failed" alone leaves the
      // reader unable to tell a rate limit from a signed-out session.
      var errList = t.errors || (r && r.errors) || [];
      var firstReason = "";
      // A whole-scan crash takes over the reason even when partial phase errors
      // exist: the crash is the bigger story, and the per-source list is long.
      if (crashed) {
        firstReason = String(r.error).slice(0, 160);
      } else if (errList.length) {
        var e0 = errList[0] || {};
        // A pre-fix stored row can carry the raw user code as the name; never
        // render it. Playlist names are exempt — only this error-row name is
        // id-shaped-checked, because only profile rows had the bug.
        var who = String(e0.name || "").trim();
        if (/^[A-Za-z0-9]{22,}$/.test(who)) who = "";
        firstReason = (who ? who + ": " : "") + String(e0.error || "").slice(0, 160);
      }
      if (firstReason) detailLines.push(firstReason);
      scanSummary = {
        failed: failed,
        detail: detailLines.join(" · "),
        reason: firstReason,
        label: crashed && !t.failed
          ? "scan failed"
          : failed
            ? failed + " source" + (failed === 1 ? "" : "s") + " failed"
            : changed
              ? "+" + changed + " change" + (changed === 1 ? "" : "s")
              : "no changes",
      };
    }

    var hero = h(
      "header",
      { class: "pwt-hero" },
      h(
        "div",
        { class: "pwt-hero-brand" },
        h("span", { class: "pwt-wordmark" }, "spotispy"),
        h("h1", { class: "pwt-h1" }, everything ? "Everyone, at a glance" : detail ? detail.name : "Spotispy")
      ),
      h(
        "div",
        { class: "pwt-hero-actions" },
        progress,
        h(kit.Btn, { primary: true, label: "Scan everything", onClick: function () { onScan("all"); }, disabled: !!scanState.scanning }),
        h(kit.Btn, { label: "Scan playlists", onClick: function () { onScan("playlists"); }, disabled: !!scanState.scanning }),
        scanState.lastScanAt || dash.lastScanAt
          ? h(
              "span",
              { class: "pwt-hero-meta", title: u.fmtDateTime(scanState.lastScanAt || dash.lastScanAt || 0) },
              "refreshed " + u.ago(scanState.lastScanAt || dash.lastScanAt || Date.now())
            )
          : null,
        !scanState.scanning && scanSummary
          ? h(
              "span",
              {
                class: "pwt-hero-meta" + (scanSummary.failed ? " is-warn" : ""),
                title: scanSummary.detail,
                "data-pwt": "scan-summary",
              },
              scanSummary.label,
              // A failing scan states the reason right here, not in a tooltip
              // nobody opens. Gated on the reason itself: a whole-scan crash
              // has failed === 0 but still owes the reader its reason.
              scanSummary.reason
                ? h("span", { class: "pwt-scan-reason", "data-pwt": "scan-reason" }, " — " + scanSummary.reason)
                : null
            )
          : null
      )
    );

    /** The avatar chips: everyone first, then one per watched user. */
    var chips = h(
      "div",
      { class: "pwt-user-chips", role: "tablist", "aria-label": "Pick a watched user" },
      h(
        "button",
        {
          key: "everyone",
          type: "button",
          role: "tab",
          "aria-selected": everything ? "true" : "false",
          class: "pwt-chip" + (everything ? " is-active" : ""),
          onClick: function () {
            setSelected("everyone");
          },
        },
        h("span", { class: "pwt-chip-avatar", role: "img", "aria-label": "everyone", dangerouslySetInnerHTML: { __html: kit.icon("profile.followers.count") } }),
        h("span", { class: "pwt-chip-name" }, "Everyone")
      ),
      dash.users.map(function (user) {
        var active = !everything && user.id === dash.selectedId;
        return h(
          "button",
          {
            key: user.id,
            type: "button",
            role: "tab",
            "aria-selected": active ? "true" : "false",
            class: "pwt-chip" + (active ? " is-active" : ""),
            "data-user": user.id,
            title: user.name + (user.lastChangeAt ? " · last seen " + u.ago(user.lastChangeAt) : ""),
            onClick: function () {
              setSelected(user.id);
            },
          },
          h(kit.Avatar, { id: user.id, name: user.name, src: user.avatarUrl, alt: user.name, small: true }),
          h("span", { class: "pwt-chip-name" }, user.name),
          user.changes ? h("span", { class: "pwt-chip-count", title: user.changes + " recent changes" }, String(user.changes)) : null
        );
      })
    );

    if (everything) {
      var kpis = h(
        "div",
        { class: "pwt-kpis pwt-kpi-strip" },
        h(kit.Stat, { value: dash.profiles, label: "profiles" }),
        h(kit.Stat, { value: dash.playlists, label: "playlists" }),
        h(kit.Stat, { value: "+" + dash.added7, label: "added 7d", tone: "success" }),
        h(kit.Stat, { value: "−" + dash.removed7, label: "removed 7d", tone: "warning" }),
        h(kit.Stat, { value: dash.edits7, label: "edits 7d" }),
        h(kit.Stat, { value: dash.lastScanAt ? u.ago(dash.lastScanAt) : "never", label: "last scan", tone: "tight" }),
        h(
          "div",
          { class: "pwt-stat" },
          h("span", { class: "pwt-stat-value", "data-pwt": "next-scan" }, h(kit.Countdown, { to: dash.nextScanAt, from: Date.now() })),
          h("span", { class: "pwt-stat-label" }, "next scan")
        )
      );
      var chart = h(
        kit.Section,
        { title: "Additions vs removals · 30 days" },
        h(charts.StackedArea, { points: dash.series, label: "additions and removals per day" }),
        h(
          "div",
          { class: "pwt-legend" },
          h("span", { class: "pwt-legend-item" }, h("span", { class: "pwt-dot pwt-dot-add" }), " additions"),
          h("span", { class: "pwt-legend-item" }, h("span", { class: "pwt-dot pwt-dot-remove" }), " removals")
        )
      );
      var feed = h(
        kit.Section,
        { title: "Recent changes · 20 newest of " + (dash.totalChanges != null ? dash.totalChanges : "—") },
        dash.recent.length
          ? h(DayFeed, { rows: dash.recent, keyPrefix: "ov", onOpenTrack: props.onOpenTrack })
          : h(kit.Empty, { title: "No changes yet", hint: "Watch something, then scan." })
      );
      return h(
        "div",
        { class: "pwt-view pwt-overview" },
        hero,
        chips,
        kpis,
        chart,
        feed
      );
    }

    if (!detail) {
      return h(
        "div",
        { class: "pwt-view pwt-overview" },
        hero,
        chips,
        h(kit.Empty, {
          title: "Nothing is being watched yet",
          hint: "Add a playlist or a profile from Settings, or right-click a playlist and choose “Watch playlist”.",
          action: h(kit.Btn, {
            primary: true,
            label: "Open Settings",
            onClick: function () {
              if (props.onNavigate) props.onNavigate("settings");
            },
          }),
        })
      );
    }

    var detailUser = detail;
    var header = h(
      "div",
      { class: "pwt-user-head" },
      h(kit.Avatar, { id: detailUser.id, name: detailUser.name, src: detailUser.avatarUrl, alt: detailUser.name, large: true, class: "pwt-hero-avatar" }),
      h(
        "div",
        { class: "pwt-user-title" },
        h(
          "div",
          { class: "pwt-user-name-row" },
          h("h2", { class: "pwt-h2" }, detailUser.name),
          detailUser.activity ? h(kit.Badge, { tone: "success" }, "activity") : null
        ),
        h(
          "div",
          { class: "pwt-user-meta" },
          h("span", null, h("b", null, (detailUser.followers == null ? "—" : detailUser.followers)), " followers"),
          detailUser.watchedAt ? h("span", null, "· watching since ", u.fmtDate(detailUser.watchedAt)) : null,
          detailUser.lastSyncedAt
            ? h("span", { title: u.fmtDateTime(detailUser.lastSyncedAt) }, "· scanned " + u.ago(detailUser.lastSyncedAt))
            : null
        )
      ),
      h(
        "div",
        { class: "pwt-profile-actions" },
        isLive
          ? h(
              "span",
              { class: "pwt-live-now", title: "Playing right now, per the listening-activity feed" },
              h("span", { class: "pwt-dot pwt-dot-live", "aria-hidden": "true" }),
              "listening now"
            )
          : null,
        h(kit.Btn, {
          label: detailUser.activity ? "Unwatch activity" : "Watch activity",
          primary: !detailUser.activity,
          title: detailUser.activity ? "Stop flagging this person's listening activity" : "Flag this person's listening activity",
          onClick: function () {
            if (props.onToggleActivity) props.onToggleActivity(detailUser.id, !detailUser.activity);
          },
        }),
        h(kit.Btn, {
          label: "Open profile",
          onClick: function () {
            if (props.onOpenProfile) props.onOpenProfile(detailUser.id);
          },
        }),
        h(kit.Btn, {
          label: "Open dashboard",
          ghost: true,
          onClick: function () {
            if (props.onNavigate) props.onNavigate("profiles");
          },
        })
      )
    );

    var stats = h(
      "div",
      { class: "pwt-kpis pwt-kpis-tight" },
      h(kit.Stat, { value: detail.playlists.length, label: "public playlists" }),
      h(kit.Stat, { value: detail.playlists.filter(function (p) { return p.watched; }).length, label: "watched" }),
      h(kit.Stat, { value: detail.updatesCount != null ? detail.updatesCount : "—", label: "recent updates" })
    );

    var playlistCards = detail.playlists.length
      ? h(
          "div",
          { class: "pwt-user-cards" },
          detail.playlists.map(function (pl) {
            var isScanning = scanState.scanning && scanState.current === pl.id;
            return h(
              "div",
              { class: "pwt-user-card" + (isScanning ? " is-scanning" : ""), key: pl.id || pl.uri, "data-playlist": pl.id },
              h(
                "button",
                {
                  type: "button",
                  class: "pwt-user-card-main",
                  title: pl.name,
                  onClick: function () {
                    if (pl.watched) {
                      if (props.onOpenPlaylist) props.onOpenPlaylist(pl.id);
                    } else if (props.onWatchPlaylist) {
                      props.onWatchPlaylist(pl.id);
                    }
                  },
                },
                h(kit.Cover, { id: pl.id, name: pl.name, src: pl.coverUrl, alt: pl.name, size: 64 }),
                h(
                  "span",
                  { class: "pwt-user-card-text" },
                  h("span", { class: "pwt-user-card-name" }, pl.name),
                  h(
                    "span",
                    { class: "pwt-user-card-meta" },
                    isScanning ? h("span", { class: "pwt-scanning" }, "scanning…") : null,
                    pl.watched ? h("span", { class: "pwt-watch-dot", "aria-hidden": "true" }) : null,
                    pl.trackCount == null ? "— tracks" : pl.trackCount + " tracks",
                    pl.watched ? " · watched" : null
                  ),
                  pl.lastChangeAt
                    ? h(
                        "span",
                        { class: "pwt-user-card-meta", title: u.fmtDateTime(pl.lastChangeAt) },
                        "last change " + u.ago(pl.lastChangeAt)
                      )
                    : h("span", { class: "pwt-user-card-meta" }, pl.watched ? "no changes yet" : "not watched")
                )
              ),
              pl.watched
                ? h(kit.Btn, { label: "Open", ghost: true, disabled: isScanning, onClick: function () { if (props.onOpenPlaylist) props.onOpenPlaylist(pl.id); } })
                : h(kit.Btn, { label: "Watch", primary: true, disabled: isScanning, onClick: function () { if (props.onWatchPlaylist) props.onWatchPlaylist(pl.id); } })
            );
          })
        )
      : h(kit.Empty, { title: "No public playlists found", hint: "The profile scan keeps this fresh." });

    var updates = detail.updates.length
      ? h(DayFeed, { rows: detail.updates, keyPrefix: "ud", onOpenTrack: props.onOpenTrack })
      : h(kit.Empty, { title: "No updates yet", hint: "The next scan records the first baseline." });

    return h(
      "div",
      { class: "pwt-view pwt-overview" },
      hero,
      chips,
      h(kit.Section, { title: "", class: "pwt-user-section" }, header, stats),
      h(kit.Section, { title: "Public playlists" }, playlistCards),
      h(kit.Section, { title: "Updates · showing " + detail.updates.length + " newest of " + (detail.updatesCount != null ? detail.updatesCount : "—") }, updates)
    );
  }

  return Overview;
});
