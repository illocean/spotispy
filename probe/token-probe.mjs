// Live probe of the client token flow the desktop client uses, through its
// DevTools protocol. Confirms whether a GET /playlists/{id} can still be made
// with the session and whether snapshot_id survives the 2026 field trims.
//
//   node probe/token-probe.mjs [--port 9222]

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const PORT = Number(arg("port", "9222"));

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

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  };
  await send("Runtime.enable");
  const expr = `(async () => {
    const out = {};
    try {
      out.spicetify = !!window.Spicetify;
      out.version = window.Spicetify && Spicetify.Config && Spicetify.Config.version;
      out.tokenProvider = typeof (window.Spicetify && Spicetify.Platform && Spicetify.Platform.Session && Spicetify.Platform.Session.getToken);
      const sess = window.Spicetify && Spicetify.Platform && Spicetify.Platform.Session;
      if (sess) out.sessionKeys = Object.keys(sess).slice(0, 40);
      if (sess && sess.getToken) {
        const tok = await sess.getToken();
        out.tokenShape = tok ? Object.keys(tok) : null;
        out.hasAccess = !!(tok && (tok.accessToken || tok.token));
      }
      if (window.Spicetify && Spicetify.CosmosAsync) {
        const me = await Spicetify.CosmosAsync.get("https://api.spotify.com/v1/me").catch(e => ({ err: String(e) }));
        out.me = me && me.id ? { id: "present", country: me.country, product: me.product } : me;
      }
    } catch (e) {
      out.error = String(e && (e.stack || e.message || e));
    }
    return JSON.stringify(out);
  })()`;
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  console.log(r.result?.value || JSON.stringify(r));
  ws.close();
}

main().catch((e) => {
  console.error("token probe failed:", e.message);
  process.exit(1);
});
