/* eslint-disable */
/**
 * Spotispy — lightweight "popup" surfaces.
 *
 * Replacements for the screen-crowding overlays: request/confirm/fire prompts
 * and toasts that mount next to the app in a fixed corner. Every surface is a
 * singleton, closes on Esc or a click outside, and never steals focus from
 * playback. Everything is created lazily and removed when the last surface
 * closes, so nothing stays in the DOM when the app is idle.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.popup = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var current = null; // { el, resolve, dismiss }

  function doc() {
    return root.document || null;
  }

  function ensureHost() {
    var d = doc();
    if (!d) return null;
    var host = d.getElementById("pwt-popup-host");
    if (!host) {
      host = d.createElement("div");
      host.id = "pwt-popup-host";
      host.className = "pwt-popup-host";
      host.setAttribute("role", "presentation");
      d.body.appendChild(host);
    }
    return host;
  }

  function removeHostIfEmpty() {
    var d = doc();
    if (!d) return;
    var host = d.getElementById("pwt-popup-host");
    if (host && !host.childElementCount) host.remove();
  }

  /**
   * Show a modal surface.
   * @param {object} opts { title, body?, fields?: [{name,label,placeholder,value,type}],
   *                        actions: [{label, value, primary?, destructive?}], openInApp?: boolean }
   * @returns {Promise<object|null>} { value, values } or null when dismissed
   */
  function show(opts) {
    var d = doc();
    if (!d) return Promise.resolve(null);
    if (current) current.dismiss(true);
    var host = ensureHost();
    var overlay = d.createElement("div");
    overlay.className = "pwt-popup-overlay";
    overlay.setAttribute("data-pwt-popup", opts.title || "dialog");

    var panel = d.createElement("div");
    panel.className = "pwt-popup-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    if (opts.title) {
      var h = d.createElement("h3");
      h.className = "pwt-popup-title";
      h.textContent = opts.title;
      panel.appendChild(h);
    }
    if (opts.body) {
      var b = d.createElement("div");
      b.className = "pwt-popup-body";
      b.textContent = opts.body;
      panel.appendChild(b);
    }
    var fieldEls = {};
    (opts.fields || []).forEach(function (f) {
      var label = d.createElement("label");
      label.className = "pwt-popup-field";
      var span = d.createElement("span");
      span.textContent = f.label;
      label.appendChild(span);
      var input = d.createElement(f.multiline ? "textarea" : "input");
      if (f.type) input.type = f.type;
      if (f.placeholder) input.placeholder = f.placeholder;
      if (f.value != null) input.value = f.value;
      label.appendChild(input);
      panel.appendChild(label);
      fieldEls[f.name] = input;
    });
    var row = d.createElement("div");
    row.className = "pwt-popup-actions";
    panel.appendChild(row);
    overlay.appendChild(panel);

    var actions = opts.actions || [{ label: "Close", value: null }];

    var promise = new Promise(function (resolve) {
      var finished = false;
      function finish(value, source) {
        if (finished) return;
        finished = true;
        var values = {};
        for (var k in fieldEls) values[k] = fieldEls[k].value;
        var result = value === null || value === undefined ? null : { value: value, values: values };
        current = null;
        d.removeEventListener("keydown", onKey, true);
        overlay.removeEventListener("mousedown", onOutside);
        overlay.remove();
        removeHostIfEmpty();
        resolve(result);
      }
      function onKey(ev) {
        if (ev.key === "Escape") {
          ev.stopPropagation();
          finish(null);
        } else if (ev.key === "Enter" && ev.target && fieldEls && ev.target.dataset && ev.target.dataset.pwtEnter !== "multiline") {
          var primary = actions.filter(function (a) {
            return a.primary;
          })[0];
          if (primary && !ev.shiftKey) {
            ev.preventDefault();
            finish(primary.value);
          }
        }
      }
      function onOutside(ev) {
        if (!panel.contains(ev.target)) finish(null);
      }
      actions.forEach(function (a) {
        var btn = d.createElement("button");
        btn.type = "button";
        btn.className = "pwt-btn" + (a.primary ? " pwt-btn-primary" : "") + (a.destructive ? " pwt-btn-danger" : "");
        btn.setAttribute("data-pwt-action", a.value === null ? "dismiss" : String(a.label));
        btn.textContent = a.label;
        btn.addEventListener("click", function () {
          finish(a.value);
        });
        row.appendChild(btn);
      });
      d.addEventListener("keydown", onKey, true);
      overlay.addEventListener("mousedown", onOutside);
      current = {
        el: overlay,
        dismiss: function (silent) {
          finished = silent ? true : finished;
          if (silent) {
            overlay.remove();
            d.removeEventListener("keydown", onKey, true);
            overlay.removeEventListener("mousedown", onOutside);
            removeHostIfEmpty();
            resolve(null);
            current = null;
          } else finish(null);
        },
      };
    });
    host.appendChild(overlay);
    var first = Object.keys(fieldEls).length ? fieldEls[Object.keys(fieldEls)[0]] : row.querySelector("button");
    if (first && first.focus) {
      try {
        first.focus({ preventScroll: true });
      } catch (e) {
        first.focus();
      }
    }
    return promise;
  }

  /** transient toast, bottom-left, auto-dismiss */
  function toast(message, ms) {
    var d = doc();
    if (!d) return;
    var host = ensureHost();
    var t = d.createElement("div");
    t.className = "pwt-toast";
    t.setAttribute("role", "status");
    t.textContent = message;
    host.appendChild(t);
    setTimeout(function () {
      t.classList.add("pwt-toast-out");
      setTimeout(function () {
        t.remove();
        removeHostIfEmpty();
      }, 250);
    }, ms || 3200);
  }

  function dismiss() {
    if (current) current.dismiss(true);
  }

  return { show: show, toast: toast, dismiss: dismiss };
});
