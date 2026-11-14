/* eslint-disable */
/** Spotispy — Activity (listening) view (§5.4). */
(function (root, factory) {
  root.PWT = root.PWT || {};
  root.PWT.ui = root.PWT.ui || {};
  root.PWT.ui.Activity = factory(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function Activity(props) {
    var kit = root.PWT.uiKit;
    var charts = root.PWT.charts;
    var h = root.PWT.react.h;
    var u = root.PWT.util;
    // Hooks first — the loading and unavailable early-returns below must never
    // change the hook order. Collapsed state as a set: a row is expanded iff
    // its id is NOT in the map, so every row starts expanded.
    var hook = root.PWT.react.hooks();
    var collapsedState = hook.useState({});
    var collapsed = collapsedState[0] || {};
    var setCollapsed = collapsedState[1];
    var filter = (props.filter && typeof props.filter === "object") ? props.filter : {};
    var filterUser = filter.user || "";
    var filterDays = filter.days || "";
    var dayKey =
      root.PWT.diff && typeof root.PWT.diff.dayKey === "function"
        ? root.PWT.diff.dayKey
        : function (ts) {
            var d = new Date(ts);
            return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
          };
    // Mirrors view.dayLabel: Today / Yesterday / full local date. Sessions are
    // grouped by the same local day, so the label matches the bucket.
    function dayGroupLabel(ts) {
      if (ts == null || !isFinite(ts)) return "—";
      var now = Date.now();
      var yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      var key = dayKey(ts);
      if (key === dayKey(now)) return "Today";
      if (key === dayKey(yesterday.getTime())) return "Yesterday";
      return u.fmtDate(ts);
    }
    // The date preset is local-day arithmetic, not raw millisecond subtraction,
    // so DST transitions cannot shift the bucket edges.
    function inDatePreset(ts) {
      if (!filterDays) return true;
      if (!isFinite(ts)) return false;
      var now = new Date();
      if (filterDays === "today") return dayKey(ts) === dayKey(now.getTime());
      var back = filterDays === "7d" ? 6 : filterDays === "30d" ? 29 : null;
      if (back == null) return true;
      var start = new Date(now);
      start.setDate(start.getDate() - back);
      start.setHours(0, 0, 0, 0);
      return ts >= start.getTime();
    }
    // A foreign or partial model (e.g. from another route) must never crash the
    // tree: normalise everything the view touches.
    var src = props.model || {};
    var m = {
      state: src.state || "idle",
      live: Array.isArray(src.live) ? src.live : [],
      sessions: Array.isArray(src.sessions) ? src.sessions : [],
      presence: Array.isArray(src.presence) ? src.presence : [],
      heat: src.heat && Array.isArray(src.heat.days) ? src.heat : { days: [], data: {} },
      errors: src.errors,
      source: src.source,
      lastTick: src.lastTick,
    };

    // While the route loads, say so — "Nobody is sharing listening activity"
    // would be a lie about a feed that is merely not loaded yet.
    if (props.loading && m.state === "idle") {
      return h(
        "div",
        { class: "pwt-view pwt-activity" },
        h("h1", { class: "pwt-h1" }, "Activity"),
        h(kit.Empty, { title: "Loading…", hint: "Reading the listening feed." })
      );
    }

    if (m.state === "unavailable" || m.state === "error") {
      return h(
        "div",
        { class: "pwt-view pwt-activity" },
        h("h1", { class: "pwt-h1" }, "Activity"),
        h(kit.Unavailable, {
          title: "Listening activity is unavailable on this client",
          detail: "Neither the activity feed nor the buddylist answered. Watching continues.",
        }),
        m.errors
          ? h(
              "ul",
              { class: "pwt-errors" },
              m.errors.map(function (e, i) {
                return h("li", { key: "e" + i }, e);
              })
            )
          : null
      );
    }

    var live = m.live || [];
    var query = String(filter.query || "").toLowerCase();
    function matches(fields) {
      if (!query) return true;
      for (var i = 0; i < fields.length; i++) {
        if (fields[i] && String(fields[i]).toLowerCase().indexOf(query) >= 0) return true;
      }
      return false;
    }
    var visibleLive = live.filter(function (x) {
      return matches([x.name, x.trackTitle, x.trackArtist, x.contextLabel]);
    });
    var visibleSessions = (m.sessions || []).filter(function (s) {
      if (filterUser && s.userId !== filterUser) return false;
      if (!inDatePreset(s.startedAt)) return false;
      // A session row can arrive without a track list (unclean or partial
      // snapshot); without the guard the whole route falls into the error
      // boundary instead of showing the rest of the feed.
      var trackHaystack = [].concat.apply([], (Array.isArray(s.tracks) ? s.tracks : []).map(function (t) {
        return [t.title, t.artist];
      }));
      return matches([s.userName, s.userId].concat(trackHaystack));
    });
    var sortedSessions = visibleSessions.slice().sort(function (a, b) {
      return (b.startedAt || 0) - (a.startedAt || 0);
    });
    // Only 50 rows render at a time; the model loads more than that so the
    // filters have room to work. The hint reports the filtered total.
    var displaySessions = sortedSessions.slice(0, 50);
    var sessionGroups = [];
    var groupByDay = {};
    displaySessions.forEach(function (s) {
      var key = dayKey(s.startedAt);
      var g = groupByDay[key];
      if (!g) {
        g = { day: key, label: dayGroupLabel(s.startedAt), rows: [] };
        groupByDay[key] = g;
        sessionGroups.push(g);
      }
      g.rows.push(s);
    });
    sessionGroups.sort(function (a, b) {
      return a.day < b.day ? 1 : a.day > b.day ? -1 : 0;
    });
    // Distinct friends present in the loaded sessions — the user filter is
    // built from what this route actually has, before any filter is applied.
    var seenUsers = {};
    var userOptions = [];
    m.sessions.forEach(function (s) {
      if (!s.userId || seenUsers[s.userId]) return;
      seenUsers[s.userId] = true;
      userOptions.push({ value: s.userId, label: s.userName || String(s.userId) });
    });
    userOptions.sort(function (a, b) {
      var la = String(a.label).toLowerCase();
      var lb = String(b.label).toLowerCase();
      return la < lb ? -1 : la > lb ? 1 : 0;
    });

    // The now-playing hero: the friend who is playing leads the page, so a feed
    // with one active listener reads as "someone is playing" instead of a bare
    // strip. Everything else (paused friends, the rest) stays in the strip.
    var playing = visibleLive.filter(function (x) { return x.isPlaying; });
    var hero = playing.length
      ? h(
          "section",
          { class: "pwt-now", "data-user": playing[0].userId },
          playing[0].trackArt
            ? h(kit.Thumb, { src: playing[0].trackArt, alt: "", large: true, seed: playing[0].trackUri })
            : h("span", { class: "pwt-now-art pwt-now-art-empty", role: "img", "aria-label": "no track art" }),
          h(
            "div",
            { class: "pwt-now-main" },
            h(
              "div",
              { class: "pwt-now-eyebrow" },
              h("span", { class: "pwt-dot pwt-dot-live" }),
              "now playing"
            ),
            h("div", { class: "pwt-now-track" }, playing[0].trackTitle || "Unknown track"),
            playing[0].trackArtist ? h("div", { class: "pwt-now-artist" }, playing[0].trackArtist) : null,
            h(
              "div",
              { class: "pwt-now-who" },
              h(kit.Avatar, { id: playing[0].userId, name: playing[0].name, src: playing[0].avatar, alt: playing[0].name, small: true }),
              h("span", { class: "pwt-now-name" }, playing[0].name),
              playing[0].contextLabel ? h("span", { class: "pwt-muted pwt-tiny" }, "· " + playing[0].contextLabel) : null,
              h("span", { class: "pwt-muted pwt-tiny", title: u.fmtDateTime(playing[0].since) }, "· for " + playing[0].forLabel)
            )
          )
        )
      : null;

    var liveStrip = h(
      kit.Section,
      { title: "Live now", hint: visibleLive.length + " friend" + (visibleLive.length === 1 ? "" : "s") },
      visibleLive.length
        ? h(
            "div",
            { class: "pwt-live-strip" },
            visibleLive.map(function (x) {
              return h(
                "div",
                { class: "pwt-live-card", key: x.userId, "data-user": x.userId },
                h(kit.Avatar, { id: x.userId, name: x.name, src: x.avatar, alt: x.name, small: true }),
                h(
                  "span",
                  { class: "pwt-live-main" },
                  h("span", { class: "pwt-live-name" }, x.name),
                  h("span", { class: "pwt-live-track" }, x.trackTitle ? h("span", { class: "pwt-live-track-title" }, x.trackTitle) : h("span", { class: "pwt-muted pwt-tiny" }, "Unknown track")),
                  h("span", { class: "pwt-muted pwt-tiny pwt-live-context" }, x.trackArtist ? x.trackArtist + " · " + x.contextLabel : x.contextLabel)
                ),
                x.trackArt ? h(kit.Thumb, { src: x.trackArt, alt: "", large: true, seed: x.trackUri }) : null,
                h("span", { class: "pwt-live-state" }, h("span", { class: "pwt-dot" + (x.isPlaying ? " pwt-dot-live" : "") }), x.isPlaying ? "playing" : "paused"),
                h("span", { class: "pwt-muted pwt-tiny", title: u.fmtDateTime(x.since) }, "for " + x.forLabel)
              );
            })
          )
        : h(kit.Empty, {
            title: query ? "No friend matches the filter" : "Nobody is sharing listening activity right now",
            hint: query ? "Clear the search box to see everyone." : "A friend appears here only while you follow them and they share listening activity. Absence is not an error.",
          })
    );

    var sessionsFiltering = !!(query || filterUser || filterDays);
    var sessionsHint =
      visibleSessions.length > 50
        ? "showing 50 of " + visibleSessions.length
        : visibleSessions.length + (sessionsFiltering ? " shown" : " recent");
    var sessionFilters = h(
      "span",
      { class: "pwt-sess-filters" },
      h(
        "span",
        { class: "pwt-sess-filter pwt-sess-filter-user" },
        h(kit.Select, {
          options: [{ value: "", label: "All users" }].concat(userOptions),
          value: filterUser,
          onChange: function (v) {
            if (props.onFilter) props.onFilter({ user: v });
          },
          "data-pwt": "sess-user",
        })
      ),
      h(
        "span",
        { class: "pwt-sess-filter pwt-sess-filter-days" },
        h(kit.Select, {
          options: [
            { value: "", label: "All time" },
            { value: "today", label: "Today" },
            { value: "7d", label: "Last 7 days" },
            { value: "30d", label: "Last 30 days" },
          ],
          value: filterDays,
          onChange: function (v) {
            if (props.onFilter) props.onFilter({ days: v });
          },
          "data-pwt": "sess-days",
        })
      )
    );
    var sessions = h(
      kit.Section,
      { title: "Sessions", hint: sessionsHint, actions: sessionFilters },
      m.sessions.length === 0
        ? h(kit.Empty, { title: "No sessions yet", hint: "Sessions appear after two or more plays from one friend." })
        : displaySessions.length === 0
          ? h(kit.Empty, { title: "No session matches the filters", hint: "Clear the search box and the filters in this section to widen the list." })
          : h(
              "div",
              { class: "pwt-sess-list" },
              sessionGroups.map(function (g) {
                return h(
                  "div",
                  { class: "pwt-sess-group", key: g.day },
                  h("div", { class: "pwt-sess-day" }, g.label),
                  g.rows.map(function (s) {
                    var open = !collapsed[s.id];
                    var tracks = Array.isArray(s.tracks) ? s.tracks : [];
                    var trackCount = s.trackCount == null ? "—" : s.trackCount + " track" + (s.trackCount === 1 ? "" : "s");
                    return h(
                      "div",
                      { class: "pwt-sess-entry" + (open ? " is-open" : ""), key: s.id },
                      h(
                        "button",
                        {
                          type: "button",
                          class: "pwt-sess-row" + (open ? " is-open" : ""),
                          "aria-expanded": open ? "true" : "false",
                          title: u.fmtDateTime(s.startedAt) + (s.endedAt ? " → " + u.fmtDateTime(s.endedAt) : " · still open"),
                          onClick: function () {
                            var next = Object.assign({}, collapsed);
                            if (next[s.id]) delete next[s.id];
                            else next[s.id] = true;
                            setCollapsed(next);
                          },
                        },
                        h(kit.Avatar, { id: s.userId, name: s.userName, src: s.avatar, alt: s.userName, small: true }),
                        h(
                          "span",
                          { class: "pwt-sess-main" },
                          h("span", { class: "pwt-sess-name", title: s.userName }, s.userName),
                          h(
                            "span",
                            { class: "pwt-muted pwt-tiny" },
                            u.fmtTime(s.startedAt) + (s.endedAt ? " – " + u.fmtTime(s.endedAt) : " · still open")
                          )
                        ),
                        h(
                          "span",
                          { class: "pwt-sess-meta" },
                          h("span", { class: "pwt-sess-stat", title: "duration" }, s.durationLabel),
                          h(
                            "span",
                            { class: "pwt-muted pwt-tiny pwt-sess-count" },
                            trackCount
                          ),
                          s.loops ? h(kit.Badge, { tone: "info" }, "loop") : null,
                          s.skips ? h(kit.Badge, { tone: "warning" }, "skips") : null,
                          s.unclean
                            ? h(
                                kit.Badge,
                                { tone: "warning", title: "Spotify closed before the session ended; it ends at the last observed play" },
                                "unclean"
                              )
                            : null,
                          h("span", { class: "pwt-sess-chevron", "aria-hidden": "true" }, open ? "−" : "+")
                        )
                      ),
                      open
                        ? h(
                            "ol",
                            { class: "pwt-session-tracks pwt-sess-tracks" },
                            tracks.map(function (t, i) {
                              return h(
                                "li",
                                { key: i },
                                t.art ? h(kit.Thumb, { src: t.art, alt: "", small: true, seed: t.uri }) : null,
                                h("span", { class: "pwt-session-track" }, t.title),
                                t.artist ? h("span", { class: "pwt-muted pwt-tiny" }, " · " + t.artist) : null
                              );
                            })
                          )
                        : null
                    );
                  })
                );
              })
            )
    );

    var visiblePresence = (m.presence || []).filter(function (p) {
      return matches([p.name, p.userId]);
    });
    var heat = h(kit.Section, { title: "When they listen, 14 days", hint: "hourly, local time" }, h(charts.Heatmap, { days: m.heat.days, data: m.heat.data, label: "listening heatmap" }));

    var presence = h(
      kit.Section,
      { title: "Presence, today", hint: "online vs out of view, per friend" },
      visiblePresence.length
        ? h(
            "div",
            { class: "pwt-presence-list" },
            visiblePresence.map(function (p) {
              return h(
                "div",
                { class: "pwt-presence-row", key: p.userId, "data-user": p.userId },
                h(
                  "span",
                  { class: "pwt-presence-who" },
                  p.avatar ? h(kit.Avatar, { id: p.userId, name: p.name, src: p.avatar, alt: "", small: true }) : null,
                  h("span", { class: "pwt-presence-name", title: p.name }, p.name)
                ),
                h(
                  "span",
                  { class: "pwt-presence-bar", role: "img", "aria-label": p.label },
                  p.segments.map(function (seg) {
                    return h("span", {
                      key: seg.from + "-" + seg.to,
                      class: "pwt-presence-seg" + (seg.hidden ? " is-hidden" : " is-online"),
                      style: { left: seg.left + "%", width: seg.width + "%" },
                      title: seg.title,
                    });
                  })
                ),
                h("span", { class: "pwt-muted pwt-tiny" }, p.label)
              );
            })
          )
        : h(kit.Empty, { title: query ? "No friend matches the filter" : "Nothing to place on the bar yet", hint: query ? "Clear the search box." : "The next tick after activity sharing is on draws this." })
    );

    var filters = h(
      "input",
      {
        class: "pwt-input pwt-input-sm pwt-activity-filter",
        type: "search",
        placeholder: "filter people or tracks…",
        value: filter.query || "",
        onInput: function (ev) {
          if (props.onFilter) props.onFilter({ query: ev.target.value });
        },
        "data-pwt": "activity-filter",
      }
    );

    return h(
      "div",
      { class: "pwt-view pwt-activity" },
      h(
        "header",
        { class: "pwt-view-head pwt-view-head-split" },
        h(
          "div",
          { class: "pwt-hero-brand" },
          h("span", { class: "pwt-wordmark" }, "activity"),
          h("h1", { class: "pwt-h1" }, "Listening")
        ),
        filters
      ),
      h(
        "div",
        { class: "pwt-activity-meta", title: m.lastTick ? u.fmtDateTime(m.lastTick) : "" },
        (m.source || "—") + " · tick " + (m.lastTick ? u.ago(m.lastTick) : "never")
      ),
      hero,
      liveStrip,
      // Full-width row: the heatmap reads left-to-right across the page, so it
      // must not be squeezed into one column of a two-column split.
      h("div", { class: "pwt-deck" }, h("div", { class: "pwt-deck-wide" }, heat)),
      // Sessions span the full width as a grouped list, like the heatmap.
      h("div", { class: "pwt-deck" }, h("div", { class: "pwt-deck-wide" }, sessions)),
      // Presence spans the full row; the old contexts partner is gone.
      h("div", { class: "pwt-deck" }, h("div", { class: "pwt-deck-wide" }, presence))
    );
  }

  return Activity;
});