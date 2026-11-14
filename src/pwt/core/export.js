/* eslint-disable */
/** Spotispy — JSON / CSV export and downloads (§5.5, §5.6). */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PWT = root.PWT || {};
  root.PWT.export = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function toRows(rows) {
    return (rows || []).map(function (r) {
      return [
        r.ts ? new Date(r.ts).toISOString() : "",
        r.observedAt ? new Date(r.observedAt).toISOString() : "",
        r.level || "",
        r.target || "",
        r.kind || "",
        r.title || "",
        r.detail || "",
        r.uri || "",
      ];
    });
  }

  function toCsv(rows) {
    var pwt = root.PWT;
    return pwt.util.toCsv(["timestamp", "observed_at", "level", "target", "kind", "title", "detail", "uri"], toRows(rows));
  }

  function toJson(rows) {
    return JSON.stringify({ exportedAt: new Date().toISOString(), rows: rows || [] }, null, 2);
  }

  /** Trigger a browser download of a string. */
  function download(filename, mime, content) {
    var doc = root.document;
    if (!doc) return false;
    var blob = new root.Blob([content], { type: mime });
    var url = root.URL.createObjectURL(blob);
    var a = doc.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    doc.body.appendChild(a);
    a.click();
    setTimeout(function () {
      a.remove();
      root.URL.revokeObjectURL(url);
    }, 0);
    return true;
  }

  function filename(prefix, ext, now) {
    var d = new Date(now == null ? Date.now() : now);
    var pad = function (n) {
      return (n < 10 ? "0" : "") + n;
    };
    return prefix + "-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + "." + ext;
  }

  return { toRows: toRows, toCsv: toCsv, toJson: toJson, download: download, filename: filename };
});
