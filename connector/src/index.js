// starfare Worker: Starfare's game, a simulated Starseeker passenger company that a player runs with three AI agents in seats
// (an executor and two dispatchers), each connected through this MCP server with the seat code the player gives it.
// "/" is the page that starts a company (src/world.html); /world/<world_id> is the company's page. /mcp is rate limited per
// address; STARFARE_OAUTH = "on" puts it behind OAuth (src/oauth.js): one-click consent, an anonymous player id per grant.
import { hex } from "./bench-host.js";
import META from "./engine/meta.json" with { type: "json" };
import engineSrc from "./engine/sol-page.txt";
import { mcpHandler } from "./mcp.js";
import { oauthFetch, oauthOn } from "./oauth.js";
import { ownerGate, ownerGateOn } from "./owner.js";
import worldHtml from "./world.html";
import { allowed, busy, clientKey, rateLimit, rpcCount, SHARED_IP, tooMany } from "./limit.js";
import { hub } from "./store.js";
import { WORLD_ID, worldStub } from "./world.js";

// Durable Object classes stay exported while their storage exists (wrangler migrations). StarfareRun, StarfareBench and
// most of StarfareHub served the older single-agent game, which is gone; the hub still keeps the rate limits.
export { StarfareBench } from "./bench.js";
export { StarfareMcp } from "./mcp.js";
export { StarfareAuth } from "./oauth.js";
export { StarfareHub, StarfareRun } from "./store.js";
export { StarfareWorld } from "./world.js";

const isMcpPath = (p) => p === "/mcp" || p.startsWith("/mcp/");
// The engine bundle for browsers. ?v= changes with every engine build, so that URL can be cached for good.
const ENGINE_PATH = "/engine.js", ENGINE_V = META.sha256.slice(0, 16);
const isWorldPath = (p) => p === "/world" || p.startsWith("/world/");
const isPublicPage = (p) => p === "/" || p === ENGINE_PATH || isWorldPath(p);

/** The game (simulated). GET / and GET /world are the page that starts a company; POST /world/new makes a world and returns
 *  its world_id and, this once, its three seat codes (the player gives one to each agent, which calls join with it).
 *  GET /world/<world_id> is the world's page and GET /world/<world_id>.json its view, which never shows a code.
 *  POST /world/<world_id>/codes issues new codes (returned once), and the old ones stop working. The world_id is the capability. */
const WORLD_RE = WORLD_ID.source.slice(1, -1);
const WORLD_PATH = new RegExp("^/world/(" + WORLD_RE + ")(\\.json|/codes)?$");
const worldPage = (id) => new Response(worldHtml.replace("__WORLD__", () => JSON.stringify(id)).replace("__ENGINE_URL__", () => JSON.stringify(ENGINE_PATH + "?v=" + ENGINE_V)), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
async function world(req, url, env) {
  const json = (v, status = 200) => Response.json(v, { status, headers: { "cache-control": "no-store" } });
  const m = WORLD_PATH.exec(url.pathname), make = url.pathname === "/world/new", page = url.pathname === "/" || url.pathname === "/world" || (m && !m[2]);
  if (!make && !m && !page) return new Response("Not found", { status: 404 });
  const method = make || (m && m[2] === "/codes") ? "POST" : "GET";
  if (req.method !== method) return new Response("Method not allowed", { status: 405, headers: { allow: method } });
  if (page) return worldPage(m ? m[1] : null);
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
  "referrer-policy": "no-referrer", // /world/<world_id> carries a capability in the URL
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
    if (!ownerGateOn(env)) return harden(await route(req, env, ctx));
    // A private deployment (wrangler.private.jsonc): only the owner's browser sees the pages, and nothing is indexed.
    const url = new URL(req.url);
    const res = harden((await ownerGate(req, url, env, (r) => allowed(hub(env), "owner:" + clientKey(r), 10))) || (await route(req, env, ctx)));
    if (res.status === 101 || res.webSocket) return res;
    const headers = new Headers(res.headers);
    headers.set("x-robots-tag", "noindex, nofollow");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
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
  if (url.pathname === "/" || isWorldPath(url.pathname)) return world(req, url, env);
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  if (url.pathname === ENGINE_PATH) {
    const cache = url.searchParams.get("v") === ENGINE_V ? "public, max-age=31536000, immutable" : "no-cache";
    return new Response(engineSrc, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": cache } });
  }
  return new Response("Not found", { status: 404 });
}
