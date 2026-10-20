// starfare Worker: the "bring your own Grok bot" robotaxi-dispatcher MCP server for Starfare. By default no auth (the tools expose no
// private data); each run is addressed by an unguessable run_id, and /mcp is rate limited per IP.
// STARFARE_OAUTH = "on" puts /mcp behind OAuth (src/oauth.js): one-click consent, an anonymous player id per grant.
import { BENCH_ID, benchStub } from "./bench.js";
import benchHtml from "./bench.html";
import { boardHtml } from "./board.js";
import { engine } from "./engine.js";
import META from "./engine/meta.json" with { type: "json" };
import engineSrc from "./engine/sol-page.txt";
import { EPISODE_PATH } from "./episode.js";
import { listHails, poolView, sky } from "./game.js";
import { mcpHandler } from "./mcp.js";
import { oauthFetch, oauthOn } from "./oauth.js";
import agentHtml from "./agent.html";
import flightHtml from "./flight.html";
import { methodPage } from "./method.js";
import siteHtml from "./site.html";
import { hub, runStub } from "./store.js";
import { RUN_ID } from "./tools.js";

export { StarfareBench } from "./bench.js";
export { StarfareMcp } from "./mcp.js";
export { StarfareAuth } from "./oauth.js";
export { StarfareHub, StarfareRun } from "./store.js";

const isMcpPath = (p) => p === "/mcp" || p.startsWith("/mcp/");
// The landing page runs the engine in the browser. ?v= changes with every engine build, so that URL can be cached for good.
const ENGINE_PATH = "/engine.js", ENGINE_V = META.sha256.slice(0, 16);
const isBenchPath = (p) => p === "/bench" || p.startsWith("/bench/");
const isPublicPage = (p) => p === "/" || p === "/method" || p === ENGINE_PATH || p === "/hails.json" || p === "/board" || p === "/board.json" || p === "/live.json" || p.startsWith("/rides/") || p.startsWith("/flight/") || p.startsWith("/agent/") || p.startsWith("/comms/") || isBenchPath(p);
const RIDE_PATH = new RegExp("^/rides/(" + RUN_ID.source.slice(1, -1) + ")\\.json$"), FLIGHT_PATH = new RegExp("^/flight/(" + RUN_ID.source.slice(1, -1) + ")(\\.json)?$"), EXPORT_PATH = /^\/rides\/export\/([0-9a-f]{32})\.jsonl$/;

function tooMany(limit) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: `Rate limit: more than ${limit} requests a minute from this address. Try again in a minute.` } }), {
    status: 429, headers: { "content-type": "application/json", "retry-after": "60" },
  });
}

/** Ride downloads (simulated rides). /rides/<run_id>.json: one arrived ride or season flight in the air, public like the board
 *  (the run_id is the capability).
 *  /rides/export/<token>.jsonl: a player's newest arrived rides, one record per line, for 24 hours after get_my_rides minted the token. */
async function rides(req, path, env) {
  const limit = Number(env.RATE_PER_MIN) || 120;
  if (!(await hub(env).hit("rides:" + (req.headers.get("cf-connecting-ip") || "unknown"), limit)).ok) return new Response("Too many downloads. Try again in a minute.", { status: 429, headers: { "retry-after": "60" } });
  const one = RIDE_PATH.exec(path), all = EXPORT_PATH.exec(path);
  const file = (body, type, name) => new Response(body, { headers: { "content-type": type, "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
  if (one) {
    const rec = await runStub(env, one[1]).record();
    return rec ? file(JSON.stringify(rec), "application/json", one[1] + ".json") : new Response("Not found: no dispatched flight with that run_id", { status: 404 });
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

/** The agent page (simulated). /agent/<token>: one signed-in player's newest bookings, each with where it stands and the
 *  agent's log in words, live; the page polls /agent/<token>.json. The consent page shows the link and take_hail returns it;
 *  the token is the capability, as the run_id is for /flight. */
const AGENT_PATH = /^\/agent\/([0-9a-f]{32})(\.json)?$/;
async function agentPage(req, url, env) {
  const m = AGENT_PATH.exec(url.pathname);
  if (!m) return new Response("Not found", { status: 404 });
  const limit = Number(env.RATE_PER_MIN) || 120;
  if (!(await hub(env).hit("rides:" + (req.headers.get("cf-connecting-ip") || "unknown"), limit)).ok) return new Response("Too many requests. Try again in a minute.", { status: 429, headers: { "retry-after": "60" } });
  if (!m[2]) {
    const places = JSON.stringify(Object.fromEntries((await engine()).PLACES.map((p) => [p.id, p.name]))).replace(/</g, "\\u003c");
    return new Response(agentHtml.replaceAll("__TOKEN__", m[1]).replace("__PLACES__", () => places), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
  const ids = await hub(env).followRuns(m[1]);
  if (!ids) return Response.json({ error: "unknown follow link" }, { status: 404, headers: { "cache-control": "no-store" } });
  const runs = (await Promise.all(ids.map((id) => runStub(env, id).follow()))).filter(Boolean);
  return Response.json({ simulated: true, now_ms: Date.now(), runs }, { headers: { "cache-control": "no-store" } });
}

/** The home page's Comms channel (simulated). POST /comms/new opens one and returns its secret channel id and a check-in code;
 *  POST /comms/<channel>/code mints a fresh code; GET /comms/<channel>.json?after=<seq> is what the panel polls: new events
 *  (the agent connected and checked in), the code still waiting, and the agent's newest bookings as the follow page shows them. */
const COMMS_PATH = /^\/comms\/([0-9a-f]{32})(\.json|\/code)$/;
async function comms(req, url, env) {
  const limit = Number(env.RATE_PER_MIN) || 120, h = hub(env), json = (v, status = 200) => Response.json(v, { status, headers: { "cache-control": "no-store" } });
  if (!(await h.hit("rides:" + (req.headers.get("cf-connecting-ip") || "unknown"), limit)).ok) return new Response("Too many requests. Try again in a minute.", { status: 429, headers: { "retry-after": "60" } });
  if (url.pathname === "/comms/new") return req.method === "POST" ? json({ simulated: true, ...(await h.commsOpen()) }) : new Response("Method not allowed", { status: 405 });
  const m = COMMS_PATH.exec(url.pathname);
  if (!m) return new Response("Not found", { status: 404 });
  if (m[2] === "/code") {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const r = await h.commsCode(m[1]);
    return r.error ? json(r, 404) : json(r);
  }
  const v = await h.commsView(m[1], url.searchParams.get("after"));
  if (!v) return json({ error: "unknown channel" }, 404);
  const runs = (await Promise.all(v.run_ids.map((id) => runStub(env, id).follow()))).filter(Boolean);
  return json({ simulated: true, now_ms: Date.now(), linked: v.linked, code: v.code, events: v.events, runs });
}

/** The bench watch pages. /bench: how to start one from Grok. /bench/<bench_id>: one session's tasks and tool calls, live
 *  (simulated); the page polls /bench/<bench_id>.json?after=<seq> and POSTs /bench/<bench_id>/end to end the open task.
 *  /bench/<bench_id>/trace.json: the finished session's calls, to replay with bench/verify.mjs.
 *  The bench_id is the capability, as the run_id is for /rides. */
const BENCH_PATH = new RegExp("^/bench/(" + BENCH_ID.source.slice(1, -1) + ")(\\.json|/end|/trace\\.json)?$");
async function bench(req, url, env) {
  const page = (id) => new Response(benchHtml.replaceAll("__ORIGIN__", url.origin).replace("__BENCH__", JSON.stringify(id)),
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  const m = BENCH_PATH.exec(url.pathname), method = m && m[2] === "/end" ? "POST" : "GET";
  if (url.pathname !== "/bench" && !m) return new Response("Not found", { status: 404 });
  if (req.method !== method) return new Response("Method not allowed", { status: 405, headers: { allow: method } });
  if (!m) return page(null);
  if (!m[2]) return page(m[1]);
  const limit = Number(env.RATE_PER_MIN) || 120;
  if (!(await hub(env).hit("bench:" + (req.headers.get("cf-connecting-ip") || "unknown"), limit)).ok) return new Response("Too many requests. Try again in a minute.", { status: 429, headers: { "retry-after": "60" } });
  const stub = benchStub(env, m[1]);
  if (m[2] === "/end") {
    const r = await stub.end();
    return Response.json(r, { status: r.error ? 409 : 200 });
  }
  if (m[2] === "/trace.json") {
    const t = await stub.trace();
    if (!t) return new Response("Not found: no bench session with that id", { status: 404 });
    return Response.json(t, t.error ? { status: 409 } : { headers: { "content-disposition": 'attachment; filename="starfare-' + m[1] + '-trace.json"' } });
  }
  const v = await stub.view(Math.max(0, Number(url.searchParams.get("after")) || 0));
  return v ? Response.json(v, { headers: { "cache-control": "no-store" } }) : new Response("Not found: no bench session with that id", { status: 404 });
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
      ctx.props = { origin: url.origin };
      return mcpHandler.fetch(req, env, ctx);
    }
    if (isBenchPath(url.pathname)) return bench(req, url, env);
    if (url.pathname.startsWith("/comms/")) return comms(req, url, env);
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
    if (url.pathname === "/board" || url.pathname === "/board.json") {
      const E = await engine(), season = sky(Date.now()).season, cap = await hub(env).ensurePool(season);
      const raw = await hub(env).board(), pool = poolView(E, season, cap);
      const legacy_hails = listHails(E).filter((h) => raw.best[h.hail_id]);
      const hails = [...pool.hails, ...legacy_hails];
      const data = { ...raw, season, pool_size: cap, hails: pool.hails, legacy_hails,
        best: Object.fromEntries(hails.filter((h) => raw.best[h.hail_id]).map((h) => [h.hail_id, raw.best[h.hail_id]])) };
      if (url.pathname === "/board.json") return Response.json({ label: "planned by Grok bot", ...data }, { headers: { "cache-control": "no-store" } });
      return new Response(boardHtml(hails, data), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    if (url.pathname.startsWith("/rides/")) return rides(req, url.pathname, env);
    if (url.pathname === ENGINE_PATH) {
      const cache = url.searchParams.get("v") === ENGINE_V ? "public, max-age=31536000, immutable" : "no-cache";
      return new Response(engineSrc, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": cache } });
    }
    if (url.pathname === "/method") {
      return new Response(methodPage(await engine(), META.sky), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" } });
    }
    if (url.pathname === "/" || url.pathname === "/hails.json") {
      const E = await engine(), season = sky(Date.now()).season, cap = await hub(env).ensurePool(season);
      const pool = poolView(E, season, cap);
      if (url.pathname === "/hails.json") return Response.json(pool, { headers: { "cache-control": "no-store" } });
      const site = { sky: META.sky, look: META.look, ...pool };
      const html = siteHtml.replaceAll("__ORIGIN__", url.origin).replace("__ENGINE_URL__", `${ENGINE_PATH}?v=${ENGINE_V}`)
        .replace("__SITE__", () => JSON.stringify(site).replace(/</g, "\\u003c"));
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    if (url.pathname.startsWith("/agent/")) return agentPage(req, url, env);
    // Home map flights (simulated), including the newest landed one.
    if (url.pathname === "/live.json") return Response.json({ simulated: true, ...(await hub(env).live()) }, { headers: { "cache-control": "no-store" } });
    const episode = EPISODE_PATH.exec(url.pathname);
    if (episode) {
      const limit = Number(env.RATE_PER_MIN) || 120;
      if (!(await hub(env).hit("rides:" + (req.headers.get("cf-connecting-ip") || "unknown"), limit)).ok) return new Response("Too many requests. Try again in a minute.", { status: 429, headers: { "retry-after": "60" } });
      const body = await runStub(env, episode[1]).episode();
      if (!body) return new Response("Not found: no arrived flight with that run_id", { status: 404 });
      return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "content-disposition": `attachment; filename="${episode[1]}.episode.jsonl"`, "cache-control": "public, max-age=60" } });
    }
    // The flight page: live playback of a season flight in the air, then its replay and receipt. The page polls
    // /rides/<run_id>.json itself; the drawn arcs ride in the page so the download stays the starfare.ride/1 record.
    const flight = FLIGHT_PATH.exec(url.pathname);
    if (flight) {
      const limit = Number(env.RATE_PER_MIN) || 120;
      if (!(await hub(env).hit("rides:" + (req.headers.get("cf-connecting-ip") || "unknown"), limit)).ok) return new Response("Too many requests. Try again in a minute.", { status: 429, headers: { "retry-after": "60" } });
      const fl = await runStub(env, flight[1]).flight(), cache = fl && !fl.in_flight ? "public, max-age=60" : "no-store";
      // The page refetches its legs and arcs here when a decide re-planned a leg or the flight landed.
      if (flight[2]) return Response.json(fl || { error: "no dispatched flight with that run_id" }, { status: fl ? 200 : 404, headers: { "cache-control": cache } });
      const site = { sky: META.sky, look: META.look, hails: listHails(await engine()) };
      const json = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
      const html = flightHtml.replace("__ENGINE_URL__", `${ENGINE_PATH}?v=${ENGINE_V}`)
        .replace("__SITE__", () => json(site)).replace("__RUN__", () => json({ run_id: flight[1], ...(fl || { legs: [], arcs: {} }) }));
      return new Response(html, { status: fl ? 200 : 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": cache } });
    }
    return new Response("Not found", { status: 404 });
  },
};
