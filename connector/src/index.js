// starfare Worker: the "bring your own Grok bot" robotaxi-dispatcher MCP server for Starfare. By default no auth (the tools expose no
// private data); each run is addressed by an unguessable run_id, and /mcp is rate limited per IP.
// STARFARE_OAUTH = "on" puts /mcp behind OAuth (src/oauth.js): one-click consent, an anonymous player id per grant.
import { BENCH_ID, benchStub } from "./bench.js";
import { hex } from "./bench-host.js";
import benchHtml from "./bench.html";
import { boardHtml } from "./board.js";
import { engine } from "./engine.js";
import META from "./engine/meta.json" with { type: "json" };
import engineSrc from "./engine/sol-page.txt";
import { EPISODE_PATH } from "./episode.js";
import { SCORE_VERSION, SKY, listHails, poolView, sky } from "./game.js";
import conditions from "./conditions.cjs";
import { seasonKey, seasonRelease, seasonSeed } from "./season-seed.js";
import { mcpHandler } from "./mcp.js";
import { oauthFetch, oauthOn } from "./oauth.js";
import agentHtml from "./agent.html";
import worldHtml from "./world.html";
import flightHtml from "./flight.html";
import { methodPage } from "./method.js";
import siteHtml from "./site.html";
import { allowed, busy, clientKey, rateLimit, rpcCount, SHARED_IP, tooMany } from "./limit.js";
import { hub, runStub } from "./store.js";
import { RUN_ID } from "./tools.js";
import { WORLD_ID, sandboxOn, worldStub } from "./world.js";

export { StarfareBench } from "./bench.js";
export { StarfareMcp } from "./mcp.js";
export { StarfareAuth } from "./oauth.js";
export { StarfareHub, StarfareRun } from "./store.js";
export { StarfareWorld } from "./world.js";

const isMcpPath = (p) => p === "/mcp" || p.startsWith("/mcp/");
// The landing page runs the engine in the browser. ?v= changes with every engine build, so that URL can be cached for good.
const ENGINE_PATH = "/engine.js", ENGINE_V = META.sha256.slice(0, 16);
const isBenchPath = (p) => p === "/bench" || p.startsWith("/bench/");
const isWorldPath = (p) => p === "/world" || p.startsWith("/world/");
const isPublicPage = (p) => p === "/" || p === "/method" || p === ENGINE_PATH || p === "/hails.json" || p === "/board" || p === "/board.json" || p === "/live.json" || p === "/sky.json" || p.startsWith("/seasons/") || p.startsWith("/rides/") || p.startsWith("/flight/") || p.startsWith("/agent/") || p.startsWith("/comms/") || isBenchPath(p) || isWorldPath(p);
const RIDE_PATH = new RegExp("^/rides/(" + RUN_ID.source.slice(1, -1) + ")\\.json$"), FLIGHT_PATH = new RegExp("^/flight/(" + RUN_ID.source.slice(1, -1) + ")(\\.json)?$"), EXPORT_PATH = /^\/rides\/export\/([0-9a-f]{32})\.jsonl$/;

const SEASON_PATH = /^\/seasons\/(\d{1,9})\.json$/;
// /sky.json: the season's hazards as the public pages may show them. With a keyed season seed the pages can't compute them,
// so this reports conditions up to the sky time now and no further (src/conditions.cjs); without one it says so and gives
// the seed, and the pages compute everything themselves as before. ?at=<sky JD> asks for an earlier moment of this season
// (a paused or slowed map). Reports are kept per isolate by sky hour, with each seed's past eruption days.
const reports = new Map(), eruptionDays = new Map();
async function skyReport(env, url) {
  const now = sky(Date.now()), seed = await seasonSeed(env, now.season), keyed = !!seasonKey(env);
  if (!keyed) return { simulated: true, season: now.season, keyed, seed, now_jd: now.jd };
  const start = SKY.jd0, q = url.searchParams.get("at"), asked = q ? Number(q) : NaN, at = Number.isFinite(asked) ? Math.max(start, Math.min(asked, now.jd)) : now.jd;
  const hour = Math.floor(at * 24), k = seed + "|" + hour + "|" + Math.floor(now.jd * 24);
  if (!reports.has(k)) {
    if (reports.size > 64) reports.clear();
    if (!eruptionDays.has(seed)) { if (eruptionDays.size > 4) eruptionDays.clear(); eruptionDays.set(seed, {}); }
    const E = await engine();
    reports.set(k, conditions.reportOf(E.R.hazards(seed), at, now.jd, eruptionDays.get(seed)));
  }
  return { simulated: true, season: now.season, keyed, now_jd: now.jd, report: reports.get(k),
    note: "Simulated hazards reported up to the sky time now. A storm or haze still going has no end time: nobody is told when it ends." };
}

// A season's pool size is frozen the first time the hub is asked (hub-pool.js ensurePool), so each isolate keeps the answer
// and the home page and /hails.json stop costing a call to the one hub Durable Object.
const caps = new Map();
async function poolCap(env, season) {
  if (!caps.has(season)) {
    caps.set(season, await hub(env).ensurePool(season));
    if (caps.size > 4) caps.delete(caps.keys().next().value);
  }
  return caps.get(season);
}

/** Ride downloads (simulated rides). /rides/<run_id>.json: one arrived ride or season flight in the air, public like the board
 *  (the run_id is the capability).
 *  /rides/export/<token>.jsonl: a player's newest arrived rides, one record per line, for 24 hours after get_my_rides minted the token. */
async function rides(req, path, env) {
  if (!(await allowed(hub(env), "rides:" + clientKey(req), rateLimit(env)))) return busy("Too many downloads. Try again in a minute.");
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
  if (!(await allowed(hub(env), "rides:" + clientKey(req), rateLimit(env)))) return busy();
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
  const h = hub(env), json = (v, status = 200) => Response.json(v, { status, headers: { "cache-control": "no-store" } });
  if (!(await allowed(h, "rides:" + clientKey(req), rateLimit(env)))) return busy();
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
  if (!(await allowed(hub(env), "bench:" + clientKey(req), rateLimit(env)))) return busy();
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

/** The sandbox world (simulated), only while STARFARE_SANDBOX is "on" and linked from nowhere yet.
 *  GET /world is the page that starts a company; POST /world/new makes a world and returns its world_id and, this once, its
 *  three seat codes (the player gives one to each agent, which calls join with it). GET /world/<world_id> is the world's
 *  page and GET /world/<world_id>.json its view, which never shows a code. POST /world/<world_id>/codes issues new codes
 *  (returned once), and the old ones stop working. The world_id is the capability, as the bench_id is for /bench. */
const WORLD_RE = WORLD_ID.source.slice(1, -1);
const WORLD_PATH = new RegExp("^/world/(" + WORLD_RE + ")(\\.json|/codes)?$");
async function world(req, url, env) {
  if (!sandboxOn(env)) return new Response("Not found", { status: 404 });
  const json = (v, status = 200) => Response.json(v, { status, headers: { "cache-control": "no-store" } });
  const m = WORLD_PATH.exec(url.pathname), make = url.pathname === "/world/new", page = url.pathname === "/world" || (m && !m[2]);
  if (!make && !m && !page) return new Response("Not found", { status: 404 });
  const method = make || (m && m[2] === "/codes") ? "POST" : "GET";
  if (req.method !== method) return new Response("Method not allowed", { status: 405, headers: { allow: method } });
  if (page) return new Response(worldHtml.replace("__WORLD__", () => JSON.stringify(m ? m[1] : null)), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  if (!(await allowed(hub(env), "world:" + clientKey(req), rateLimit(env)))) return busy();
  if (make) {
    const id = "w_" + hex(10), v = await worldStub(env, id).create(id);
    return v.error ? json(v, 409) : json({ ...v, view: url.origin + "/world/" + id + ".json", page: url.origin + "/world/" + id }, 201);
  }
  const v = m[2] === "/codes" ? await worldStub(env, m[1]).reissue() : await worldStub(env, m[1]).view();
  return v ? json(v) : json({ error: "no world with that world_id" }, 404);
}

// Every response the Worker builds gets these (the consent page's own frame headers are kept). The CSP leaves scripts alone
// for now: the pages run inline scripts, so a script-src needs nonces first.
const HARDEN = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer", // /agent/<token>, /bench/<id> and ?follow= carry a capability in the URL
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
};
function harden(res) {
  if (res.status === 101 || res.webSocket) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(HARDEN)) if (!headers.has(k)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(req, env, ctx) {
    return harden(await route(req, env, ctx));
  },
};

async function route(req, env, ctx) {
  const url = new URL(req.url);
  if (oauthOn(env) && !isPublicPage(url.pathname)) {
    // /mcp, OAuth metadata, /register, /authorize, /token share one per-address budget. A signed-in /mcp call also counts
    // against its player (src/oauth.js), so its address gets SHARED_IP times the budget: a hosted agent such as grok.com
    // calls from a few shared addresses on behalf of many players.
    const limit = rateLimit(env), n = isMcpPath(url.pathname) ? await rpcCount(req) : 1;
    if (n instanceof Response) return n;
    const signedIn = isMcpPath(url.pathname) && /^bearer /i.test(req.headers.get("authorization") || "");
    if (!(await allowed(hub(env), (signedIn ? "mcp:" : "") + clientKey(req), signedIn ? limit * SHARED_IP : limit, n))) return tooMany(signedIn ? limit * SHARED_IP : limit);
    return oauthFetch(req, env, ctx);
  }
  if (isMcpPath(url.pathname)) {
    const limit = rateLimit(env), n = await rpcCount(req);
    if (n instanceof Response) return n;
    if (!(await allowed(hub(env), clientKey(req), limit, n))) return tooMany(limit);
    ctx.props = { origin: url.origin, client: clientKey(req) };
    return mcpHandler.fetch(req, env, ctx);
  }
  if (isBenchPath(url.pathname)) return bench(req, url, env);
  if (url.pathname.startsWith("/comms/")) return comms(req, url, env);
  if (isWorldPath(url.pathname)) return world(req, url, env);
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  if (url.pathname === "/board" || url.pathname === "/board.json") {
    const E = await engine(), season = sky(Date.now()).season, cap = await poolCap(env, season);
    const raw = await hub(env).board(season), pool = poolView(E, season, cap);
    const legacy_hails = listHails(E).filter((h) => raw.best[h.hail_id]);
    const hails = [...pool.hails, ...legacy_hails];
    const data = { ...raw, score_version: SCORE_VERSION, season, pool_size: cap, hails: pool.hails, legacy_hails,
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
    const E = await engine(), season = sky(Date.now()).season, cap = await poolCap(env, season);
    const pool = poolView(E, season, cap);
    if (url.pathname === "/hails.json") return Response.json(pool, { headers: { "cache-control": "no-store" } });
    // Seasons keyed with STARFARE_SEASON_KEY: the page can't compute hazards, so it reads /sky.json (src/conditions.cjs).
    const site = { sky: META.sky, look: META.look, ...pool, hazards: seasonKey(env) ? "reported" : "computed" };
    const html = siteHtml.replaceAll("__ORIGIN__", url.origin).replace("__ENGINE_URL__", `${ENGINE_PATH}?v=${ENGINE_V}`)
      .replace("__SITE__", () => JSON.stringify(site).replace(/</g, "\\u003c"));
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
  if (url.pathname.startsWith("/agent/")) return agentPage(req, url, env);
  if (url.pathname === "/sky.json") return Response.json(await skyReport(env, url), { headers: { "cache-control": "no-store" } });
  const season = SEASON_PATH.exec(url.pathname);
  if (season) {
    const r = await seasonRelease(env, season[1], sky(Date.now()).season);
    return r ? Response.json({ simulated: true, ...r }, { headers: { "cache-control": r.released ? "public, max-age=3600" : "no-store" } })
      : new Response("Not found: no season with that number yet", { status: 404 });
  }
  // Home map flights (simulated), including the newest landed one.
  if (url.pathname === "/live.json") return Response.json({ simulated: true, ...(await hub(env).live()) }, { headers: { "cache-control": "no-store" } });
  const episode = EPISODE_PATH.exec(url.pathname);
  if (episode) {
    if (!(await allowed(hub(env), "rides:" + clientKey(req), rateLimit(env)))) return busy();
    const body = await runStub(env, episode[1]).episode();
    if (!body) return new Response("Not found: no arrived flight with that run_id, or its season is keyed and its seed is published after the reset", { status: 404 });
    return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "content-disposition": `attachment; filename="${episode[1]}.episode.jsonl"`, "cache-control": "public, max-age=60" } });
  }
  // The flight page: live playback of a season flight in the air, then its replay and receipt. The page polls
  // /rides/<run_id>.json itself; the drawn arcs ride in the page so the download stays the starfare.ride/1 record.
  const flight = FLIGHT_PATH.exec(url.pathname);
  if (flight) {
    if (!(await allowed(hub(env), "rides:" + clientKey(req), rateLimit(env)))) return busy();
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
}
