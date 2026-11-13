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
    // A foreign or partial model (e.g. from another route) must never crash the
    // tree: normalise everything the view touches.
    var src = props.model || {};
    var m = {
      state: src.state || "idle",
      live: Array.isArray(src.live) ? src.live : [],
      sessions: Array.isArray(src.sessions) ? src.sessions : [],
      presence: Array.isArray(src.presence) ? src.presence : [],
      contexts: Array.isArray(src.contexts) ? src.contexts : [],
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
    var query = ((props.filter && props.filter.query) || "").toLowerCase();
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
      return matches([s.userName, s.userId].concat(s.tracks.map(function (t) { return t.title + " " + t.artist; })));
    });
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

    var sessionList = visibleSessions.slice(0, 12);
    var sessions = h(
      kit.Section,
      { title: "Sessions", hint: sessionList.length + " recent" },
      sessionList.length
        ? h(
            "div",
            { class: "pwt-sessions" },
            sessionList.map(function (s) {
              return h(
                "div",
                { class: "pwt-session-card", key: s.id },
                h(
                  "div",
                  { class: "pwt-session-head" },
                  h(kit.Avatar, { id: s.userId, name: s.userName, src: s.avatar, alt: s.userName, small: true }),
                  h("strong", { title: s.userName }, s.userName),
                  h("span", { class: "pwt-muted pwt-tiny", title: s.endedAt ? "ended " + u.fmtDateTime(s.endedAt) : "still open" }, u.fmtDateTime(s.startedAt)),
                  s.loops ? h(kit.Badge, { tone: "info" }, "loop") : null,
                  s.skips ? h(kit.Badge, { tone: "warning" }, "skips") : null,
                  s.unclean ? h(kit.Badge, { tone: "warning", title: "Spotify closed before the session ended; it ends at the last observed play" }, "unclean") : null
                ),
                h(
                  "div",
                  { class: "pwt-session-stats" },
                  h(kit.Stat, { value: s.durationLabel, label: "duration", tone: "tight" }),
                  h(kit.Stat, { value: s.trackCount, label: "tracks", tone: "tight" })
                ),
                h(
                  "ol",
                  { class: "pwt-session-tracks" },
                  s.tracks.map(function (t, i) {
                    return h(
                      "li",
                      { key: i },
                      t.art ? h(kit.Thumb, { src: t.art, alt: "", small: true, seed: t.uri }) : null,
                      h("span", { class: "pwt-session-track" }, t.title),
                      t.artist ? h("span", { class: "pwt-muted pwt-tiny" }, " · " + t.artist) : null
                    );
                  })
                )
              );
            })
          )
        : h(kit.Empty, { title: "No sessions yet", hint: "Sessions appear after two or more plays from one friend." })
    );

    var visiblePresence = (m.presence || []).filter(function (p) {
      return matches([p.name, p.userId]);
    });
    var visibleContexts = (m.contexts || []).filter(function (c) {
      return matches([c.label, c.uri]);
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

    var contexts = h(
      kit.Section,
      { title: "Top contexts" },
      visibleContexts.length ? h(charts.Bars, { items: visibleContexts }) : h(kit.Empty, { title: query ? "No context matches the filter" : "No contexts recorded" })
    );

    var filters = h(
      "input",
      {
        class: "pwt-input pwt-input-sm pwt-activity-filter",
        type: "search",
        placeholder: "filter people or tracks…",
        value: (props.filter && props.filter.query) || "",
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
      liveStrip,
      sessions,
      presence,
      h("div", { class: "pwt-split" }, h("div", { class: "pwt-split-left" }, heat), h("div", { class: "pwt-split-right" }, contexts))
    );
  }

  return Activity;
});
