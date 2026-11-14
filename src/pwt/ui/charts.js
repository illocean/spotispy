/* eslint-disable */
/** Spotispy — inline SVG charts, no chart library (§7). */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.charts = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function R() {
    return root.PWT.react;
  }

  function safe(v) {
    return isFinite(v) ? v : 0;
  }

  /**
   * Stacked area for additions vs removals over days.
   * @param {Array} points [{day:'2026-11-10', added:3, removed:1}]
   */
  function StackedArea(props) {
    var h = R().h;
    var points = props.points || [];
    var width = props.width || 700;
    var height = props.height || 110;
    var pad = { l: 26, r: 8, t: 10, b: 18 };
    var w = width - pad.l - pad.r;
    var hgt = height - pad.t - pad.b;
    var max = 1;
    for (var i = 0; i < points.length; i++) {
      max = Math.max(max, safe(points[i].added) + safe(points[i].removed));
    }
    var step = points.length > 1 ? w / (points.length - 1) : w;
    function y(v) {
      return pad.t + hgt - (safe(v) / max) * hgt;
    }
    function x(i) {
      return pad.l + i * step;
    }
    var addedPts = points.map(function (p, i) {
      return { x: x(i), y: y(p.added) };
    });
    var totalPts = points.map(function (p, i) {
      return { x: x(i), y: y(safe(p.added) + safe(p.removed)) };
    });
    function areaPath(top, bottom) {
      if (!top.length) return "";
      var d = "M" + top[0].x + "," + (bottom ? bottom[0].y : pad.t + hgt);
      for (var j = 0; j < top.length; j++) d += " L" + top[j].x + "," + top[j].y;
      if (bottom) {
        for (var k = bottom.length - 1; k >= 0; k--) d += " L" + bottom[k].x + "," + bottom[k].y;
      } else {
        d += " L" + top[top.length - 1].x + "," + (pad.t + hgt) + " L" + top[0].x + "," + (pad.t + hgt);
      }
      return d + " Z";
    }
    var gridLines = [];
    for (var g = 0; g <= 2; g++) {
      var gy = pad.t + (hgt * g) / 2;
      gridLines.push(h("line", { key: "g" + g, x1: pad.l, x2: width - pad.r, y1: gy, y2: gy, class: "pwt-grid" }));
    }
    gridLines.push(h("line", { key: "base", x1: pad.l, x2: width - pad.r, y1: pad.t + hgt, y2: pad.t + hgt, class: "pwt-grid pwt-baseline" }));
    var labels = [];
    if (points.length) {
      labels.push(h("text", { key: "l0", x: pad.l, y: height - 4, class: "pwt-axis" }, points[0].day.slice(5)));
      labels.push(h("text", { key: "l1", x: width - pad.r, y: height - 4, class: "pwt-axis pwt-axis-end" }, points[points.length - 1].day.slice(5)));
      labels.push(h("text", { key: "max", x: 2, y: pad.t + 8, class: "pwt-axis" }, String(max)));
    }
    return h(
      "svg",
      {
        width: "100%",
        height: props.height || 120,
        viewBox: "0 0 " + width + " " + height,
        preserveAspectRatio: "none",
        class: "pwt-chart",
        role: "img",
        "aria-label": props.label || "additions and removals per day",
      },
      gridLines,
      h("path", { d: areaPath(addedPts, null), class: "pwt-area-add" }),
      h("path", { d: areaPath(totalPts, addedPts), class: "pwt-area-remove" }),
      labels
    );
  }

  /** Small sparkline for follower counts. */
  function Sparkline(props) {
    var h = R().h;
    var values = props.values || [];
    var width = props.width || 120;
    var height = props.height || 28;
    if (values.length < 2) return h("div", { class: "pwt-muted pwt-tiny" }, "—");
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var span = max - min || 1;
    var step = width / (values.length - 1);
    var d = values
      .map(function (v, i) {
        return (i ? "L" : "M") + (i * step).toFixed(1) + "," + (height - 2 - ((v - min) / span) * (height - 4)).toFixed(1);
      })
      .join(" ");
    return h(
      "svg",
      { width: width, height: height, class: "pwt-spark", role: "img", "aria-label": (props.label || "trend") + ": " + values.join(" → ") },
      h("path", { d: d, fill: "none", class: "pwt-spark-line" })
    );
  }

  /** Horizontal bar list, used for top contexts. */
  function Bars(props) {
    var h = R().h;
    var items = props.items || [];
    var max = items.reduce(function (m, it) {
      return Math.max(m, it.value);
    }, 1);
    return h(
      "div",
      { class: "pwt-bars" },
      items.map(function (it, i) {
        return h(
          "div",
          { class: "pwt-bar-row", key: "b" + i },
          h("span", { class: "pwt-bar-label", title: it.label }, it.label),
          h("span", { class: "pwt-bar-track" }, h("span", { class: "pwt-bar-fill", style: { width: Math.round((it.value / max) * 100) + "%" } })),
          h("span", { class: "pwt-bar-value" }, String(it.value))
        );
      })
    );
  }

  /** Hour x day heatmap. data: { 'YYYY-MM-DD': number[24] } */
  function Heatmap(props) {
    var h = R().h;
    var days = props.days || [];
    var data = props.data || {};
    var max = 1;
    days.forEach(function (d) {
      (data[d.day] || []).forEach(function (v) {
        max = Math.max(max, v);
      });
    });
    return h(
      "div",
      { class: "pwt-heatmap", role: "img", "aria-label": props.label || "listening heatmap" },
      days.map(function (d) {
        return h(
          "div",
          { class: "pwt-heat-row", key: d.day },
          h("span", { class: "pwt-heat-day" }, d.day.slice(5)),
          h(
            "span",
            { class: "pwt-heat-cells" },
            Array.from({ length: 24 }, function (_, hour) {
              var v = (data[d.day] || [])[hour] || 0;
              // Translucent green keeps the dark background visible through the
              // tile: empty cells read as faint outlines, full cells stay legible.
              var style = v
                ? { backgroundColor: "rgba(30, 215, 96, " + (0.25 + (v / max) * 0.75) + ")" }
                : undefined;
              return h("span", {
                key: hour,
                class: "pwt-heat-cell",
                style: style,
                title: d.day + " " + (hour < 10 ? "0" + hour : hour) + ":00 · " + v + (v === 1 ? " play" : " plays"),
              });
            })
          )
        );
      })
    );
  }

  return { StackedArea: StackedArea, Sparkline: Sparkline, Bars: Bars, Heatmap: Heatmap };
});
