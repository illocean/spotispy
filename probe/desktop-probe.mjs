// Live probe of Spotify desktop's own internal endpoints, through its DevTools
// protocol. Read-only: asks each endpoint once and prints status + a trimmed
// body. Nothing is written, followed, or stored.
//
//   node probe/desktop-probe.mjs [--port 9222] [--playlist <id>] [--user <id>]

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const PORT = Number(arg("port", "9222"));
const PLAYLIST_ID = arg("playlist", "37i9dQZF1DXcBWIGoYBM5M");
const USER_ID = arg("user", "");

let nextId = 0;
const pending = new Map();
let ws;

function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const res = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    allowUnsafeEvalBlockedByCSP: true,
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  }
  return res.result?.value;
}

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && /xpui|spotify/i.test(t.url)) || list.find((t) => t.type === "page");
  if (!page) throw new Error("no debuggable page on port " + PORT);
  console.log("target:", page.url);

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
  };
  await send("Runtime.enable");

  const script = `(async () => {
    const PL = ${JSON.stringify(PLAYLIST_ID)};
    const USER = ${JSON.stringify(USER_ID)};
    const out = [];
    const trim = (v) => {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return s == null ? "null" : s.length > 400 ? s.slice(0, 400) + "…" : s;
    };
    async function probe(label, fn) {
      const t0 = performance.now();
      try {
        const body = await fn();
        out.push({ label, ok: true, ms: Math.round(performance.now() - t0), body: trim(body) });
      } catch (e) {
        out.push({ label, ok: false, ms: Math.round(performance.now() - t0), error: String((e && e.message) || e) });
      }
    }
    const C = window.Spicetify && Spicetify.CosmosAsync;
    out.push({ label: "env", spicetify: !!(window.Spicetify), cosmos: !!C, version: window.Spicetify && Spicetify.Config && Spicetify.Config.version, listeners: typeof window.__pwt });
    if (!C) return out;
    await probe("sp://desktop/v1/version", () => C.get("sp://desktop/v1/version"));
    await probe("core-playlist metadata", () => C.get("sp://core-playlist/v1/playlist/spotify:playlist:" + PL + "/metadata"));
    await probe("core-playlist rows", () => C.get("sp://core-playlist/v1/playlist/spotify:playlist:" + PL + "/rows", { policy: { link: true } }));
    await probe("api.spotify playlist", () => C.get("https://api.spotify.com/v1/playlists/" + PL));
    await probe("api.spotify playlist tracks", () => C.get("https://api.spotify.com/v1/playlists/" + PL + "/tracks?limit=3"));
    if (USER) {
      await probe("spclient user-profile-view", () => C.get("https://spclient.wg.spotify.com/user-profile-view/v3/profile/" + USER + "?playlist_limit=20&artist_limit=0&episode_limit=0&market=from_token"));
      await probe("spclient followers", () => C.get("https://spclient.wg.spotify.com/user-profile-view/v3/profile/" + USER + "/followers?market=from_token"));
      await probe("spclient following", () => C.get("https://spclient.wg.spotify.com/user-profile-view/v3/profile/" + USER + "/following?market=from_token"));
    }
    return out;
  })()`;

  const rows = await evaluate(script);
  console.log(JSON.stringify(rows, null, 2));
  ws.close();
}

main().catch((e) => {
  console.error("probe failed:", e.message);
  process.exit(1);
});
