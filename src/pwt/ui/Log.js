/* eslint-disable */
/** Spotispy — global Change log (§5.5). */
(function (root, factory) {
  root.PWT = root.PWT || {};
  root.PWT.ui = root.PWT.ui || {};
  root.PWT.ui.Log = factory(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function Log(props) {
    var kit = root.PWT.uiKit;
    var h = root.PWT.react.h;
    var u = root.PWT.util;
    var rows = props.rows || [];
    var filter = props.filter || { query: "", kind: "", level: "" };
    // While the route loads, "0 events" would be a lie about an unread log.
    if (props.loading && !props.rows) {
      return h(
        "div",
        { class: "pwt-view pwt-log" },
        h(
          "header",
          { class: "pwt-view-head" },
          h("div", { class: "pwt-hero-brand" }, h("span", { class: "pwt-wordmark" }, "logbook"), h("h1", { class: "pwt-h1" }, "Change log"))
        ),
        h(kit.Empty, { title: "Loading…", hint: "Reading the change log." })
      );
    }
    var kinds = [];
    var dedupe = {};
    rows.forEach(function (r) {
      if (!dedupe[r.kind]) {
        dedupe[r.kind] = true;
        kinds.push(r.kind);
      }
    });
    kinds.sort();

    return h(
      "div",
      { class: "pwt-view pwt-log" },
      h(
        "header",
        { class: "pwt-view-head pwt-view-head-split" },
        h(
          "div",
          { class: "pwt-hero-brand" },
          h("span", { class: "pwt-wordmark" }, "logbook"),
          h("h1", { class: "pwt-h1" }, "Change log")
        ),
        h("span", { class: "pwt-sub" }, rows.length + " events")
      ),
      h(
        "div",
        { class: "pwt-toolbar pwt-toolbar-wrap" },
        h("input", {
          class: "pwt-input",
          type: "search",
          placeholder: "search everything…",
          value: filter.query,
          onInput: function (ev) {
            if (props.onFilter) props.onFilter({ query: ev.target.value, kind: filter.kind, level: filter.level });
          },
          "data-pwt": "log-search",
        }),
        // kit.Select, not a native <select>: Spotify's CEF renderer refuses to
        // open native select popups (see kit.Select). These two filters were the
        // last native selects in the app and did not open in the client.
        h(kit.Select, {
          "data-pwt": "log-level",
          value: filter.level,
          options: [
            { value: "", label: "all levels" },
            { value: "profile", label: "profile" },
            { value: "playlist", label: "playlist" },
          ],
          onChange: function (v) {
            if (props.onFilter) props.onFilter({ query: filter.query, kind: filter.kind, level: v });
          },
        }),
        h(kit.Select, {
          "data-pwt": "log-kind",
          value: filter.kind,
          options: [{ value: "", label: "all kinds" }].concat(
            kinds.map(function (k) {
              return { value: k, label: k };
            })
          ),
          onChange: function (v) {
            if (props.onFilter) props.onFilter({ query: filter.query, kind: v, level: filter.level });
          },
        }),
        h(
          "span",
          { class: "pwt-export" },
          h(kit.Btn, {
            label: "Export JSON",
            onClick: function () {
              if (props.onExport) props.onExport("json");
            },
          }),
          h(kit.Btn, {
            label: "Export CSV",
            onClick: function () {
              if (props.onExport) props.onExport("csv");
            },
          })
        )
      ),
      rows.length
        ? h(
            "div",
            { class: "pwt-table-scroll" },
            h(
              "table",
              { class: "pwt-table pwt-table-log" },
            h(
              "thead",
              null,
              h(
                "tr",
                null,
                h("th", null, "When"),
                h("th", null, ""),
                h("th", null, "Target"),
                h("th", null, "Kind"),
                h("th", null, "Detail"),
                h("th", null, "")
              )
            ),
            h(
              "tbody",
              null,
              rows.slice(0, 2000).map(function (r, i) {
                var observed = r.sourceDate == null;
                var targetLabel = r.display || r.targetName || "";
                if (!targetLabel || kit.idShaped(targetLabel)) targetLabel = "—";
                return h(
                  "tr",
                  { key: "log" + i, class: "pwt-row", "data-kind": r.kind },
                  h("td", { class: "pwt-when", title: observed ? "first seen (Spotify gave no date)" : "Spotify date: " + u.fmtDateTime(r.sourceDate) }, u.fmtDateTime(r.ts), h(kit.ObsChip, { observed: observed })),
                  h("td", { class: "pwt-log-thumb" }, r.image ? h(kit.Thumb, { src: r.image, alt: "", seed: r.target }) : null),
                  h("td", null, targetLabel),
                  h("td", null, kit.kindLabel(r.kind)),
                  h(
                    "td",
                    { class: "pwt-log-detail" },
                    r.kind && r.kind.indexOf("playlist.item.") === 0 && r.trackTitle
                      ? r.trackTitle + " · " + kit.humanDetail(r)
                      : kit.humanDetail(r)
                  ),
                  h(
                    "td",
                    null,
                    // Only a playlist row has somewhere to go. Rendering "open" on
                    // a profile row produced a button that did nothing at all —
                    // a silent failure, which this app does not allow.
                    r.level === "playlist"
                      ? h(
                          "button",
                          {
                            type: "button",
                            class: "pwt-link-btn",
                            onClick: function () {
                              if (props.onOpenRow) props.onOpenRow(r);
                            },
                          },
                          "open"
                        )
                      : null
                  )
                );
              })
            )
          )
          )
        : h(kit.Empty, { title: "The log is empty", hint: "Every profile and playlist change lands here once scanning starts." })
    );
  }

  return Log;
});
