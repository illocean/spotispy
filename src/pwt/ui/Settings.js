/* eslint-disable */
/** Spotispy — Settings (§5.6). */
(function (root, factory) {
  root.PWT = root.PWT || {};
  root.PWT.ui = root.PWT.ui || {};
  root.PWT.ui.Settings = factory(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function Settings(props) {
    var kit = root.PWT.uiKit;
    var h = root.PWT.react.h;
    var m = props.model || {
      pollMs: 3600000,
      pollLabel: "60 min",
      activityMs: 60000,
      activityLabel: "60 s",
      activityBoostMs: 10000,
      toggles: [],
      retainDays: 90,
      logCap: 10000,
      os: { supported: false, state: "unknown" },
      cacheBytes: 0,
      cacheLabel: "—",
      counts: {},
    };
    var onSet = props.onSet || function () {};
    var util = root.PWT.util;
    var diag = props.diag || { running: false, result: null, report: null };

    // The two intervals are mirrored locally. onSet() re-loads the entire
    // settings model (IndexedDB counts, cache size, artwork) asynchronously, so
    // without this the control visibly snaps back to the old value while that
    // load is in flight -- which reads as "the dropdown did not respond".
    var choiceHook = root.PWT.react.hooks();
    var choiceState = choiceHook.useState(null);
    var chosen = choiceState[0] || {};
    var setChosen = choiceState[1] || function () {};
    var pollMs = chosen.pollMs != null ? chosen.pollMs : m.pollMs;
    var activityMs = chosen.activityMs != null ? chosen.activityMs : m.activityMs;
    // Same mirror for the boost interval and retention: without it the control
    // snaps back while onSet() re-loads the model asynchronously.
    var activityBoostMs = chosen.activityBoostMs != null ? chosen.activityBoostMs : m.activityBoostMs;
    var retainDays = chosen.retainDays != null ? chosen.retainDays : m.retainDays;
    function pick(key, value) {
      setChosen(function (prev) {
        var next = Object.assign({}, prev || {});
        next[key] = value;
        return next;
      });
      var patch = {};
      patch[key] = value;
      onSet(patch);
    }

    // Collapsible sections: each folds away to declutter. All start open so
    // nothing is hidden on first view and every control (self-test, unwatch,
    // filters) stays in the DOM; collapsing is opt-in.
    var hook = root.PWT.react.hooks();
    var openState = hook.useState(null);
    var open = openState[0] || {};
    var setOpen = openState[1] || function () {};
    function isOpen(key) {
      return open[key] !== false;
    }
    function toggle(key) {
      setOpen(function (prev) {
        var cur = prev || {};
        var next = Object.assign({}, cur);
        next[key] = cur[key] === false ? true : false;
        return next;
      });
    }
    function section(key, title, hint) {
      var expanded = isOpen(key);
      // Collect every child passed after the hint: a plain function would only
      // see the first one, silently dropping the rest.
      var children = Array.prototype.slice.call(arguments, 3);
      return h(
        "section",
        { class: "pwt-section pwt-acc" + (expanded ? " is-open" : "") },
        h(
          "button",
          {
            type: "button",
            class: "pwt-acc-head",
            "aria-expanded": expanded ? "true" : "false",
            onClick: function () { toggle(key); },
            "data-pwt-acc": key,
          },
          h("span", { class: "pwt-acc-title" }, title),
          hint ? h("span", { class: "pwt-muted pwt-tiny pwt-acc-hint" }, hint) : null,
          h("span", { class: "pwt-acc-chevron", "aria-hidden": "true" }, "⌄")
        ),
        h.apply(null, ["div", { class: "pwt-acc-body" }].concat(children))
      );
    }

    // While the route loads, the defaults above are NOT the user's values —
    // showing the form would invite editing the wrong numbers.
    if (props.loading && !props.model) {
      return h(
        "div",
        { class: "pwt-view pwt-settings" },
        h(
          "header",
          { class: "pwt-view-head" },
          h("div", { class: "pwt-hero-brand" }, h("span", { class: "pwt-wordmark" }, "knob"), h("h1", { class: "pwt-h1" }, "Settings"))
        ),
        h(kit.Empty, { title: "Loading…", hint: "Reading your settings." })
      );
    }

    function field(label, node, hint) {
      return h(
        "label",
        { class: "pwt-field" },
        h("span", { class: "pwt-field-label" }, label),
        node,
        hint ? h("span", { class: "pwt-muted pwt-tiny" }, hint) : null
      );
    }

    return h(
      "div",
      { class: "pwt-view pwt-settings" },
      h(
        "header",
        { class: "pwt-view-head pwt-view-head-split" },
        h(
          "div",
          { class: "pwt-hero-brand" },
          h("span", { class: "pwt-wordmark" }, "knob"),
          h("h1", { class: "pwt-h1" }, "Settings")
        )
      ),

      section(
        "polling",
        "Polling",
        "profiles & playlists only; activity has its own cadence",
        h(
          "div",
          { class: "pwt-grid-2" },
          field(
            "Change scan interval",
            h(kit.Select, {
              "data-pwt": "poll-ms",
              value: pollMs,
              options: [900000, 1800000, 3600000, 10800000].map(function (ms) {
                return { value: ms, label: view_ml(ms) + (ms === 3600000 ? " (default)" : "") };
              }),
              onChange: function (value) {
                pick("pollMs", Number(value));
              },
            }),
            "manual scans are never blocked by this"
          ),
          field(
            "Activity interval",
            h(kit.Select, {
              "data-pwt": "activity-ms",
              value: activityMs,
              options: [30000, 60000, 120000, 0].map(function (ms) {
                return { value: ms, label: ms ? view_ml(ms) : "off" };
              }),
              onChange: function (value) {
                pick("activityMs", Number(value));
              },
            }),
            "one request covers every friend each tick"
          ),
          field(
            "Boost interval (friends playing)",
            h(kit.Select, {
              "data-pwt": "activity-boost-ms",
              value: activityBoostMs,
              options: [5000, 10000, 30000].map(function (ms) {
                return { value: ms, label: view_ml(ms) };
              }),
              onChange: function (value) {
                pick("activityBoostMs", Number(value));
              },
            }),
            "only used while the boost toggle is on and a friend is listening"
          ),
          field(
            "Activity retention",
            h(kit.Select, {
              "data-pwt": "retain-days",
              value: retainDays,
              options: [0, 30, 90, 180, 365].map(function (d) {
                return { value: d, label: d ? d + " days" : "keep forever" };
              }),
              onChange: function (value) {
                pick("retainDays", Number(value));
              },
            }),
            "deletes older play history after a scan, at most once a day"
          )
        )
      ),

      section(
        "notifications",
        "Notifications",
        m.toggles.length + " options",
        h(
          "div",
          { class: "pwt-toggles" },
          m.toggles.map(function (t) {
            return h(
              "label",
              { class: "pwt-toggle", key: t.key },
              h("input", {
                type: "checkbox",
                checked: t.value,
                onChange: function (ev) {
                  var patch = {};
                  patch[t.key] = ev.target.checked;
                  onSet(patch);
                },
                "data-pwt": t.key,
              }),
              h("span", null, t.label)
            );
          })
        ),
        h(
          "div",
          { class: "pwt-hint-row" },
          m.os.supported
            ? h(
                "span",
                { class: "pwt-muted pwt-tiny" },
                "OS notifications: " + m.os.state + " · in-app toasts always work" + (m.os.state === "default" ? " " : "")
              )
            : h(kit.Unavailable, { title: "OS notifications unavailable on this client", detail: "The renderer does not expose the Notification API; toasts are used instead." })
        )
      ),

      section(
        "watch",
        "Watch list",
        (props.watches || []).length + " watched",
        h(
          "div",
          { class: "pwt-add" },
          h("input", {
            class: "pwt-input",
            placeholder: "Playlist URL or spotify:playlist:…",
            value: (props.addState && props.addState.playlist) || "",
            onInput: function (ev) {
              if (props.onAddInput) props.onAddInput("playlist", ev.target.value);
            },
            "data-pwt": "add-playlist",
          }),
          h(kit.Btn, {
            label: "Watch playlist",
            primary: true,
            onClick: function () {
              if (props.onAdd) props.onAdd("playlist");
            },
          }),
          h("input", {
            class: "pwt-input",
            placeholder: "Profile URL or spotify:user:…",
            value: (props.addState && props.addState.profile) || "",
            onInput: function (ev) {
              if (props.onAddInput) props.onAddInput("profile", ev.target.value);
            },
            "data-pwt": "add-profile",
          }),
          h(kit.Btn, {
            label: "Watch profile",
            primary: true,
            onClick: function () {
              if (props.onAdd) props.onAdd("profile");
            },
          })
        ),
        props.addError ? h("div", { class: "pwt-error", role: "alert" }, props.addError) : null,
        h(
          "div",
          { class: "pwt-watch-list" },
          (props.watches || []).length
            ? props.watches.map(function (w) {
                return h(
                  "div",
                  { class: "pwt-watch-row", key: w.kind + w.id, "data-watch": w.kind + ":" + w.id },
                  w.image
                    ? h(kit.Thumb, { src: w.image, alt: "", seed: w.id })
                    : h(kit.Badge, { tone: w.kind === "profile" ? "info" : "neutral" }, w.kind),
                  h(
                    "span",
                    { class: "pwt-watch-main" },
                    h("span", { class: "pwt-watch-name", title: w.label || undefined }, w.label || (w.kind === "profile" ? "Unknown listener" : "Untitled playlist")),
                    h(
                      "span",
                      { class: "pwt-muted pwt-tiny" },
                      w.kind + (w.addedAt ? " · since " + util.fmtDate(w.addedAt) : "")
                    )
                  ),
                  h(kit.Btn, {
                    label: "Unwatch",
                    ghost: true,
                    danger: true,
                    onClick: function () {
                      if (props.onUnwatch) props.onUnwatch(w.kind, w.id);
                    },
                  })
                );
              })
            : h(kit.Empty, { title: "Nothing watched yet", hint: "Add a playlist or profile above." })
        )
      ),

      section(
        "data",
        "Data",
        "local only",
        // A count that could not be read is not zero. Saying "0 change rows"
        // for a database that failed to open is a lie about the user's data.
        m.counts && m.counts.error
          ? h("p", { class: "pwt-error" }, "Could not read the local database: " + m.counts.error)
          : h(
              "div",
              { class: "pwt-kpis pwt-kpis-tight" },
              h(kit.Stat, { value: (m.counts && m.counts.changes) || 0, label: "change rows" }),
              h(kit.Stat, { value: (m.counts && m.counts.plays) || 0, label: "play rows" })
            ),
        h(
          "div",
          { class: "pwt-kpis pwt-kpis-tight" },
          h(kit.Stat, { value: m.cacheLabel, label: "cache size" }),
          h(kit.Stat, { value: m.retainDays, label: "activity retention (days, enforced on scan)" })
        ),
        h(
          "div",
          { class: "pwt-actions" },
          h(kit.Btn, {
            label: "Export all (JSON)",
            onClick: function () {
              if (props.onExportAll) props.onExportAll("json");
            },
          }),
          h(kit.Btn, {
            label: "Export all (CSV)",
            onClick: function () {
              if (props.onExportAll) props.onExportAll("csv");
            },
          }),
          h(kit.Btn, {
            label: "Purge activity",
            danger: true,
            onClick: function () {
              if (props.onPurge) props.onPurge("activity");
            },
          }),
          h(kit.Btn, {
            label: "Purge everything",
            danger: true,
            onClick: function () {
              if (props.onPurge) props.onPurge("all");
            },
          })
        ),
        h("p", { class: "pwt-muted pwt-tiny" }, "Watched data is personal data about other people. It stays in this browser profile; purge removes it for good.")
      ),

      section(
        "diagnostics",
        "Diagnostics",
        "the app watching itself",
        h(
          "div",
          { class: "pwt-actions" },
          h(kit.Btn, {
            primary: true,
            label: diag.running ? "Running…" : "Run self-test",
            disabled: !!diag.running,
            onClick: function () {
              if (props.onRunSelfTest) props.onRunSelfTest();
            },
          }),
          h(kit.Btn, {
            label: "Copy report",
            onClick: function () {
              if (props.onCopyDiagnostics) props.onCopyDiagnostics();
            },
          })
        ),
        diag.result
          ? h(
              "div",
              { class: "pwt-diag" },
              h(
                "div",
                { class: "pwt-kpis pwt-kpis-tight" },
                h(kit.Stat, { value: diag.result.pass + "/" + diag.result.total, label: "checks passed", tone: diag.result.fail ? "warning" : "success" }),
                h(kit.Stat, { value: Math.round(diag.result.totalMs || 0) + " ms", label: "total time" }),
                h(kit.Stat, { value: diag.report ? Math.round(diag.report.upMs / 1000) + "s" : "—", label: "uptime" }),
                h(kit.Stat, { value: diag.report ? (diag.report.errors || []).length : "—", label: "errors caught" })
              ),
              h(
                "div",
                { class: "pwt-table-scroll" },
                h(
                  "table",
                  { class: "pwt-table pwt-diag-table" },
                h(
                  "thead",
                  null,
                  h("tr", null, h("th", null, "Check"), h("th", null, "ms"), h("th", null, "Result"), h("th", null, "Detail"))
                ),
                h(
                  "tbody",
                  null,
                  (diag.result.checks || []).map(function (c, i) {
                    // A skipped check did not fail: it never ran, because there
                    // was nothing to probe. It must not read as a red row.
                    var skipped = c.state === "skipped";
                    var label = skipped ? "skipped" : c.ok ? "ok" : "fail";
                    var tone = skipped ? "neutral" : c.ok ? "success" : "error";
                    return h(
                      "tr",
                      { key: "d" + i, class: c.ok ? "pwt-row" : skipped ? "pwt-row" : "pwt-row pwt-row-fail" },
                      h("td", null, c.name),
                      h("td", { class: "pwt-when" }, c.ms),
                      h("td", null, h(kit.Badge, { tone: tone }, label)),
                      h("td", { class: "pwt-log-detail" }, c.detail || "")
                    );
                  })
                )
              )
            )
            )
          : h("p", { class: "pwt-muted pwt-tiny" }, "Run the self-test to see whether the client, the database and the endpoints answer."),
        diag.report && (diag.report.slowest || []).length
          ? h(
              "div",
              { class: "pwt-diag-slowest" },
              h("span", { class: "pwt-field-label" }, "slowest operations"),
              h(
                "ul",
                { class: "pwt-diag-list" },
                diag.report.slowest.slice(0, 6).map(function (s, i) {
                  return h(
                    "li",
                    { key: "s" + i },
                    h("span", { class: "pwt-diag-name" }, s.name),
                    h("span", { class: "pwt-muted pwt-tiny" }, s.ms + " ms" + (s.detail ? " · " + s.detail : ""))
                  );
                })
              )
            )
          : null,
        diag.report && (diag.report.errors || []).length
          ? h(
              "div",
              { class: "pwt-diag-errors" },
              h("span", { class: "pwt-field-label" }, "last errors"),
              h(
                "ul",
                { class: "pwt-diag-list" },
                diag.report.errors.slice(-5).map(function (e, i) {
                  return h(
                    "li",
                    { key: "e" + i, title: e.stack || "" },
                    h("span", { class: "pwt-diag-name" }, e.scope),
                    h("span", { class: "pwt-muted pwt-tiny" }, e.message)
                  );
                })
              )
            )
          : null
      ),

      section(
        "about",
        "About",
        (props.about && props.about.version) || "Spotispy",
        h(
          "div",
          { class: "pwt-about" },
          h("span", { class: "pwt-muted pwt-tiny" }, (props.about && props.about.version) || "Spotispy"),
          h("span", { class: "pwt-muted pwt-tiny" }, (props.about && props.about.notes) || "")
        )
      )
    );
  }

  function view_ml(ms) {
    // Sub-minute cadences are legal (the boost default is 10 s), so rounding to
    // "0 min" would misreport them.
    if (ms < 60000) return Math.round(ms / 1000) + " s";
    return Math.round(ms / 60000) + " min";
  }

  return Settings;
});