// starfare Worker: the "bring your own Grok bot" robotaxi-dispatcher MCP server for Starfare. By default no auth (the tools expose no
// private data); each run is addressed by an unguessable run_id, and /mcp is rate limited per IP.
// STARFARE_OAUTH = "on" puts /mcp behind OAuth (src/oauth.js): one-click consent, an anonymous player id per grant.
import { boardHtml } from "./board.js";
import { engine } from "./engine.js";
import META from "./engine/meta.json" with { type: "json" };
import engineSrc from "./engine/sol-page.txt";
import { fleet, listHails } from "./game.js";
import { mcpHandler } from "./mcp.js";
import { oauthFetch, oauthOn } from "./oauth.js";
import flightHtml from "./flight.html";
import siteHtml from "./site.html";
import { RUN_ID, hub, runStub } from "./store.js";

export { StarfareMcp } from "./mcp.js";
export { StarfareAuth } from "./oauth.js";
export { StarfareHub, StarfareRun } from "./store.js";

const isMcpPath = (p) => p === "/mcp" || p.startsWith("/mcp/");
// The landing page runs the engine in the browser. ?v= changes with every engine build, so that URL can be cached for good.
const ENGINE_PATH = "/engine.js", ENGINE_V = META.sha256.slice(0, 16);
const isPublicPage = (p) => p === "/" || p === ENGINE_PATH || p === "/board" || p === "/board.json" || p.startsWith("/rides/") || p.startsWith("/flight/");
const RIDE_PATH = new RegExp("^/rides/(" + RUN_ID.source.slice(1, -1) + ")\\.json$"), FLIGHT_PATH = new RegExp("^/flight/(" + RUN_ID.source.slice(1, -1) + ")$"), EXPORT_PATH = /^\/rides\/export\/([0-9a-f]{32})\.jsonl$/;

function tooMany(limit) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: `Rate limit: more than ${limit} requests a minute from this address. Try again in a minute.` } }), {
    status: 429, headers: { "content-type": "application/json", "retry-after": "60" },
  });
}

/** Ride downloads (simulated rides). /rides/<run_id>.json: one arrived ride, public like the board (the run_id is the capability).
 *  /rides/export/<token>.jsonl: a player's newest arrived rides, one record per line, for 24 hours after get_my_rides minted the token. */
async function rides(req, path, env) {
  const limit = Number(env.RATE_PER_MIN) || 120;
  if (!(await hub(env).hit("rides:" + (req.headers.get("cf-connecting-ip") || "unknown"), limit)).ok) return new Response("Too many downloads. Try again in a minute.", { status: 429, headers: { "retry-after": "60" } });
  const one = RIDE_PATH.exec(path), all = EXPORT_PATH.exec(path);
  const file = (body, type, name) => new Response(body, { headers: { "content-type": type, "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
  if (one) {
    const rec = await runStub(env, one[1]).record();
    return rec ? file(JSON.stringify(rec), "application/json", one[1] + ".json") : new Response("Not found: no arrived ride with that run_id", { status: 404 });
  }
  if (all) {
    const ids = await hub(env).exportRuns(all[1]);
    if (!ids) return new Response("Not found: unknown or expired export link. Call get_my_rides for a new one.", { status: 404 });
    const recs = [];
    for (let i = 0; i < ids.length; i += 25) recs.push(...(await Promise.all(ids.slice(i, i + 25).map((id) => runStub(env, id).record()))));
    return file(recs.filter(Boolean).map((r) => JSON.stringify(r) + "\n").join(""), "application/x-ndjson", "starfare-rides.jsonl");
  }
  return new Response("Not found", { status: 404 });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (oauthOn(env) && !isPublicPage(url.pathname)) {
      // /mcp, OAuth metadata, /register, /authorize, /token. The same per-IP budget covers all of them.
      const limit = Number(env.RATE_PER_MIN) || 120;
      const r = await hub(env).hit(req.headers.get("cf-connecting-ip") || "unknown", limit);
      if (!r.ok) return tooMany(limit);
      return oauthFetch(req, env, ctx);
    }
    if (isMcpPath(url.pathname)) {
      const limit = Number(env.RATE_PER_MIN) || 120;
      const ip = req.headers.get("cf-connecting-ip") || "unknown";
      const r = await hub(env).hit(ip, limit);
      if (!r.ok) return tooMany(limit);
      return mcpHandler.fetch(req, env, ctx);
    }
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
    if (url.pathname === "/board" || url.pathname === "/board.json") {
      const raw = await hub(env).board(), hails = listHails(await engine());
      // Only current hails: best rows from the old delivery missions stay in storage but are not shown.
      const data = { ...raw, best: Object.fromEntries(hails.filter((h) => raw.best[h.hail_id]).map((h) => [h.hail_id, raw.best[h.hail_id]])) };
      if (url.pathname === "/board.json") return Response.json({ label: "planned by Grok bot", ...data });
      return new Response(boardHtml(hails, data), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    if (url.pathname.startsWith("/rides/")) return rides(req, url.pathname, env);
    if (url.pathname === ENGINE_PATH) {
      const cache = url.searchParams.get("v") === ENGINE_V ? "public, max-age=31536000, immutable" : "no-cache";
      return new Response(engineSrc, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": cache } });
    }
    if (url.pathname === "/") {
      const E = await engine();
      const site = { sky: META.sky, look: META.look, hails: listHails(E), fleet: fleet(E) };
      const html = siteHtml.replaceAll("__ORIGIN__", url.origin).replace("__ENGINE_URL__", `${ENGINE_PATH}?v=${ENGINE_V}`)
        .replace("__SITE__", () => JSON.stringify(site).replace(/</g, "\\u003c"));
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" } });
    }
    // The flight page: replay and receipt of one arrived ride. The page fetches /rides/<run_id>.json itself; the drawn
    // arcs ride in the page so the download stays the starfare.ride/1 record get_my_rides returns.
    const flight = FLIGHT_PATH.exec(url.pathname);
    if (flight) {
      const limit = Number(env.RATE_PER_MIN) || 120;
      if (!(await hub(env).hit("rides:" + (req.headers.get("cf-connecting-ip") || "unknown"), limit)).ok) return new Response("Too many requests. Try again in a minute.", { status: 429, headers: { "retry-after": "60" } });
      const fl = await runStub(env, flight[1]).flight();
      const site = { sky: META.sky, look: META.look, hails: listHails(await engine()) };
      const json = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
      const html = flightHtml.replace("__ENGINE_URL__", `${ENGINE_PATH}?v=${ENGINE_V}`)
        .replace("__SITE__", () => json(site)).replace("__RUN__", () => json({ run_id: flight[1], ...(fl || { legs: [], arcs: {} }) }));
      return new Response(html, { status: fl ? 200 : 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": fl ? "public, max-age=60" : "no-store" } });
    }
    return new Response("Not found", { status: 404 });
  },
};
