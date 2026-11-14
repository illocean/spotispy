/* eslint-disable */
/**
 * Spotispy — React binding.
 *
 * In Spotify, `Spicetify.React` and `Spicetify.ReactDOM` are the real libraries;
 * the app runs unmodified with them. The harness installs the same pair from
 * npm. `hooks()` exists so one component file serves both Node (unit tests,
 * which never render) and the browser; it is not a renderer.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.react = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function react() {
    var S = root.Spicetify;
    return S && S.React ? S.React : null;
  }

  function dom() {
    var S = root.Spicetify;
    if (S && S.ReactDOM) return S.ReactDOM;
    return null;
  }

  /**
   * createElement bound to whichever React is installed.
   *
   * `class` is normalised to `className` only for DOM elements: React DOM wants
   * `className`, but a component must receive its props untouched (a component
   * that forwards `props.class` to the DOM would otherwise lose it).
   */
  function h(type, config) {
    var R = react();
    var args = Array.prototype.slice.call(arguments);
    if (config && typeof config === "object" && typeof type === "string") {
      var fixed = {};
      for (var k in config) {
        if (!Object.prototype.hasOwnProperty.call(config, k)) continue;
        if (k === "class") fixed.className = config[k];
        else if (k === "for") fixed.htmlFor = config[k];
        else fixed[k] = config[k];
      }
      args[1] = fixed;
    }
    args[0] = type;
    if (R && R.createElement) return R.createElement.apply(R, args);
    throw new Error("React is unavailable");
  }

  /** Hook grabbers; each falls back to a no-op so a UI glitch never hard-crashes. */
  function hooks() {
    var R = react() || {};
    // The lite fallback keeps its hooks under .hooks; the real React exposes them flat.
    var flat = R.hooks && typeof R.hooks === "object" ? R.hooks : R;
    var f = function (name, fallback) {
      return typeof flat[name] === "function" ? flat[name] : fallback;
    };
    return {
      useState: f("useState", function (v) {
        return [v, function () {}];
      }),
      useRef: f("useRef", function (v) {
        return { current: v };
      }),
      useMemo: f("useMemo", function (fn) {
        return fn();
      }),
      useCallback: f("useCallback", function (fn) {
        return fn;
      }),
      useEffect: f("useEffect", function () {}),
      useReducer: f("useReducer", function (s) {
        return [s, function () {}];
      }),
      useLayoutEffect: f("useLayoutEffect", function () {}),
    };
  }

  /** Mount a component outside React: used only by popups and the harness. */
  function mount(el, component, props) {
    var D = dom();
    if (D && D.createRoot) {
      if (!el._pwtRoot) el._pwtRoot = D.createRoot(el);
      el._pwtRoot.render(h(component, props));
      return el._pwtRoot;
    }
    throw new Error("Spicetify.ReactDOM is unavailable");
  }

  return { h: h, hooks: hooks, react: react, dom: dom, mount: mount };
});
