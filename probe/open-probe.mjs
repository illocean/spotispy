// Live probe of the public open.spotify.com GraphQL surface (no session): the
// persisted-query hashes it currently serves and whether the client-side
// playlist query answers without a user token. Read-only.
//
//   node probe/open-probe.mjs

const WEB = "https://open.spotify.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

async function main() {
  const home = await fetch(WEB + "/", { headers: { "user-agent": UA } });
  const html = await home.text();
  const scriptSrcs = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1]);
  console.log("home status:", home.status, "scripts:", scriptSrcs.length);

  const ops = ["fetchPlaylistContents", "fetchPlaylistMetadata", "getTrack"];
  const found = {};
  for (const src of scriptSrcs.slice(0, 40)) {
    const url = src.startsWith("http") ? src : WEB + src;
    let body;
    try {
      const r = await fetch(url, { headers: { "user-agent": UA } });
      if (!r.ok) continue;
      body = await r.text();
    } catch {
      continue;
    }
    for (const op of ops) {
      if (found[op]) continue;
      const re = new RegExp(op + '"(?:\\s*,\\s*"query"\\s*,\\s*"|\\s*:\\s*")([0-9a-f]{64})');
      const m = re.exec(body);
      if (m) found[op] = { hash: m[1], from: url };
      const re2 = new RegExp(op + '"\\s*,\\s*"query"\\s*,\\s*"([0-9a-f]{64})"');
      const m2 = re2.exec(body);
      if (!found[op] && m2) found[op] = { hash: m2[1], from: url };
    }
    if (Object.keys(found).length === ops.length) break;
  }
  console.log("hashes:", JSON.stringify(found, null, 2));

  // Anonymous client token, the same flow the public web player uses.
  let token = null;
  const ct = await fetch("https://open.spotify.com/get_access_token?reason=transport&productType=web_player", {
    headers: { "user-agent": UA },
  });
  if (ct.ok) {
    const j = await ct.json().catch(() => null);
    token = j && j.accessToken ? j.accessToken : null;
    console.log("anon token:", token ? "yes" : "no", j && j.isAnonymous);
  } else {
    console.log("anon token status:", ct.status);
  }

  if (token && found.fetchPlaylistMetadata) {
    const url =
      "https://api-partner.spotify.com/pathfinder/v2/query?operationName=fetchPlaylistMetadata" +
      "&variables=" + encodeURIComponent(JSON.stringify({ enableWatchFeedEntrypoint: false, uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M" })) +
      "&extensions=" + encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: found.fetchPlaylistMetadata.hash } }));
    const r = await fetch(url, { headers: { authorization: "Bearer " + token, "user-agent": UA } });
    const text = await r.text();
    console.log("pathfinder metadata:", r.status, text.slice(0, 400));
  }
}

main().catch((e) => {
  console.error("open probe failed:", e.message);
  process.exit(1);
});
