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

      h(
        kit.Section,
        { title: "Polling", hint: "profiles and playlists only; activity has its own cadence" },
        h(
          "div",
          { class: "pwt-grid-2" },
          field(
            "Change scan interval",
            h(
              "select",
              {
                class: "pwt-input",
                value: String(m.pollMs),
                onChange: function (ev) {
                  onSet({ pollMs: Number(ev.target.value) });
                },
                "data-pwt": "poll-ms",
              },
              [900000, 1800000, 3600000, 10800000].map(function (ms) {
                return h("option", { value: String(ms), key: ms }, view_ml(ms) + (ms === 3600000 ? " (default)" : ""));
              })
            ),
            "manual scans are never blocked by this"
          ),
          field(
            "Activity interval",
            h(
              "select",
              {
                class: "pwt-input",
                value: String(m.activityMs),
                onChange: function (ev) {
                  onSet({ activityMs: Number(ev.target.value) });
                },
                "data-pwt": "activity-ms",
              },
              [30000, 60000, 120000, 0].map(function (ms) {
                return h("option", { value: String(ms), key: ms }, ms ? view_ml(ms) : "off");
              })
            ),
            "one request covers every friend each tick"
          )
        )
      ),

      h(
        kit.Section,
        { title: "Notifications" },
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

      h(
        kit.Section,
        { title: "Watch list" },
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

      h(
        kit.Section,
        { title: "Data", hint: "local only; nothing leaves this machine except an export you start" },
        h(
          "div",
          { class: "pwt-kpis pwt-kpis-tight" },
          h(kit.Stat, { value: m.cacheLabel, label: "cache size" }),
          h(kit.Stat, { value: (m.counts && m.counts.changes) || 0, label: "change rows" }),
          h(kit.Stat, { value: (m.counts && m.counts.plays) || 0, label: "play rows" }),
          h(kit.Stat, { value: m.retainDays, label: "activity retention (days)" })
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

      h(
        kit.Section,
        { title: "Diagnostics", hint: "the app watching itself" },
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
                    return h(
                      "tr",
                      { key: "d" + i, class: c.ok ? "pwt-row" : "pwt-row pwt-row-fail" },
                      h("td", null, c.name),
                      h("td", { class: "pwt-when" }, c.ms),
                      h("td", null, h(kit.Badge, { tone: c.ok ? "success" : "error" }, c.ok ? "ok" : "fail")),
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

      h(
        kit.Section,
        { title: "About" },
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
    var m = Math.round(ms / 60000);
    return m + " min";
  }

  return Settings;
});
