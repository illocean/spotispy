/* eslint-disable */
/**
 * Spotispy — app routes.
 *
 * Presentation-only router: it renders from the live data model and calls back
 * into the controller. The controller (index.js) owns navigation, scanning and
 * data loading, so each route is a thin, testable surface.
 *
 * The shell adds two things on top of the routes:
 *  - a persistent navigation bar: back/forward (XPUI history) and one tab per
 *    route, so every page of the app is reachable by mouse or keyboard;
 *  - failure ribbons: a failing self-test, and a failed route load, are always
 *    surfaced above the content — an empty screen must always say WHY.
 */
(function (root, factory) {
  root.PWT = root.PWT || {};
  root.PWT.ui = root.PWT.ui || {};
  root.PWT.ui.App = factory(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  // Inline SVG icons, stroke = currentColor, viewBox 0 0 24 24 (same language as kit.js).
  var ICONS = {
    overview: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />',
    profiles: '<circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 20v-1c0-2.2 1.8-4 4-4h3c2.2 0 4 1.8 4 4v1" /><path d="M16 6.4a3.2 3.2 0 0 1 0 4.3" /><path d="M19.5 20v-1c0-1.5-.8-2.8-2-3.4" />',
    activity: '<path d="M3 14h4l2-8 3 16 3-12 2 4h4" />',
    log: '<path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" />',
    settings: '<circle cx="12" cy="12" r="3.1" /><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.4 5.6l-1.9 1.9M7.5 16.5l-1.9 1.9M18.4 18.4l-1.9-1.9M7.5 7.5 5.6 5.6" />',
    back: '<path d="M15 6l-6 6 6 6" />',
    forward: '<path d="M9 6l6 6-6 6" />',
  };

  var TABS = [
    { id: "overview", label: "Overview" },
    { id: "profiles", label: "Profiles" },
    { id: "activity", label: "Activity" },
    { id: "log", label: "Log" },
    { id: "settings", label: "Settings" },
  ];

  /**
   * One crashing view must never take the whole app down. The boundary is the
   * last resort; views are expected to degrade on their own first. Resets itself
   * on route change, so navigating away and back is a real recovery.
   */
  var boundaryClass = null;
  function errorBoundary() {
    if (boundaryClass) return boundaryClass;
    var R = root.Spicetify && root.Spicetify.React;
    if (!R || !R.Component) return null;
    boundaryClass = class ErrorBoundary extends R.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error: error };
      }
      componentDidUpdate(prevProps) {
        if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
          this.setState({ error: null });
        }
      }
      render() {
        if (!this.state.error) return this.props.children;
        var h = root.PWT.react.h;
        var message = String((this.state.error && (this.state.error.message || this.state.error)) || "unknown error");
        var reset = function () {
          this.setState({ error: null });
          if (this.props.onReload) this.props.onReload();
        }.bind(this);
        var goOverview = function () {
          this.setState({ error: null });
          if (this.props.onOverview) this.props.onOverview("overview");
        }.bind(this);
        return h(
          "div",
          { class: "pwt-view pwt-crash-inline", role: "alert" },
          h("h1", { class: "pwt-h1" }, "This view hit a snag"),
          h("p", { class: "pwt-crash-msg" }, message),
          h("p", { class: "pwt-crash-hint" }, "The rest of Spotispy is unaffected. Reload the view, or jump back to the overview."),
          h(
            "div",
            { class: "pwt-crash-actions" },
            h(
              "button",
              { type: "button", class: "pwt-btn pwt-btn-primary", onClick: reset },
              "reload view"
            ),
            h(
              "button",
              { type: "button", class: "pwt-btn", onClick: goOverview },
              "go to overview"
            )
          )
        );
      }
    };
    return boundaryClass;
  }

  function icon(h, name) {
    return h("span", {
      class: "pwt-nav-icon",
      "aria-hidden": "true",
      dangerouslySetInnerHTML: {
        __html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + "</svg>",
      },
    });
  }

  function NavBar(props) {
    var h = root.PWT.react.h;
    var route = props.route || "overview";
    var canBack = props.canGoBack !== false && typeof props.onBack === "function";
    var canFwd = props.canGoForward !== false && typeof props.onForward === "function";
    return h(
      "nav",
      { class: "pwt-navbar", "aria-label": "Spotispy navigation" },
      h(
        "div",
        { class: "pwt-nav-history" },
        h(
          "button",
          {
            type: "button",
            class: "pwt-nav-btn",
            "aria-label": "Back",
            title: "Back",
            disabled: !canBack,
            onClick: function () {
              if (props.onBack) props.onBack();
            },
          },
          icon(h, "back")
        ),
        h(
          "button",
          {
            type: "button",
            class: "pwt-nav-btn",
            "aria-label": "Forward",
            title: "Forward",
            disabled: !canFwd,
            onClick: function () {
              if (props.onForward) props.onForward();
            },
          },
          icon(h, "forward")
        )
      ),
      h(
        "div",
        { class: "pwt-nav-tabs", role: "tablist", "aria-label": "Views" },
        TABS.map(function (t) {
          var active = t.id === route;
          return h(
            "button",
            {
              key: t.id,
              type: "button",
              role: "tab",
              "aria-selected": active ? "true" : "false",
              "aria-current": active ? "page" : undefined,
              class: "pwt-nav-tab" + (active ? " is-active" : ""),
              "data-pwt-nav": t.id,
              onClick: function () {
                if (props.onNavigate) props.onNavigate(t.id);
              },
            },
            icon(h, t.id),
            h("span", { class: "pwt-nav-tab-label" }, t.label)
          );
        })
      ),
      h("span", { class: "pwt-nav-brand", "aria-hidden": "true" }, "spotispy")
    );
  }

  function App(props) {
    var ui = root.PWT.ui;
    var h = root.PWT.react.h;
    var model = props.model || {};
    var route = props.route || "overview";
    var diag = props.diag || null;
    var failing = diag && diag.result && diag.result.fail ? diag.result : null;
    var loadError = props.error ? String(props.error).split("\n")[0] : "";

    var body = route === "profiles" ? h(ui.Profiles, props)
      : route === "playlist" ? h(ui.Playlist, props)
      : route === "activity" ? h(ui.Activity, props)
      : route === "log" ? h(ui.Log, props)
      : route === "settings" ? h(ui.Settings, props)
      : h(ui.Overview, props);

    var ribbons = [];

    if (failing) {
      var names = (failing.checks || [])
        .filter(function (c) {
          return !c.ok;
        })
        .map(function (c) {
          return c.name;
        })
        .slice(0, 3);
      ribbons.push(
        h(
          "div",
          { class: "pwt-ribbon", role: "alert", key: "diag" },
          h("span", { class: "pwt-ribbon-label" }, "Spotispy hit a wall"),
          h(
            "span",
            { class: "pwt-ribbon-text", title: names.join(" · ") },
            names.length ? names.join(" · ") : "unknown failure — see Diagnostics"
          ),
          h(
            "button",
            {
              type: "button",
              class: "pwt-ribbon-retry",
              onClick: function () {
                if (props.onRunSelfTest) props.onRunSelfTest();
              },
            },
            "retry"
          ),
          h(
            "button",
            {
              type: "button",
              class: "pwt-ribbon-retry",
              onClick: function () {
                if (props.onNavigate) props.onNavigate("settings");
              },
            },
            "details"
          )
        )
      );
    }

    if (loadError) {
      ribbons.push(
        h(
          "div",
          { class: "pwt-ribbon pwt-ribbon-load", role: "alert", key: "load" },
          h("span", { class: "pwt-ribbon-label" }, "Spotispy couldn't load"),
          h("span", { class: "pwt-ribbon-text", title: loadError }, loadError),
          h(
            "button",
            {
              type: "button",
              class: "pwt-ribbon-retry",
              onClick: function () {
                if (props.onRetry) props.onRetry();
                else if (props.onNavigate) props.onNavigate(route);
              },
            },
            "retry"
          )
        )
      );
    }

    var Boundary = errorBoundary();
    var safeBody = Boundary
      ? h(
          Boundary,
          {
            resetKey: route,
            onReload: props.onRetry,
            onOverview: props.onNavigate,
          },
          body
        )
      : body;

    return h(
      "div",
      { class: "pwt-app" },
      h(NavBar, props),
      ribbons.length ? ribbons : null,
      safeBody
    );
  }

  return App;
});
