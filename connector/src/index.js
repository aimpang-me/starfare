// sol-connector Worker: the "bring your own Grok bot" robotaxi-dispatcher MCP server for Starfare. By default no auth (the tools expose no
// private data); each run is addressed by an unguessable run_id, and /mcp is rate limited per IP.
// SOL_OAUTH = "on" puts /mcp behind OAuth (src/oauth.js): one-click consent, an anonymous player id per grant.
import { boardHtml } from "./board.js";
import { engine } from "./engine.js";
import { listHails } from "./game.js";
import { mcpHandler } from "./mcp.js";
import { oauthFetch, oauthOn } from "./oauth.js";
import { hub } from "./store.js";

export { SolMcp } from "./mcp.js";
export { SolAuth } from "./oauth.js";
export { SolHub, SolRun } from "./store.js";

const isMcpPath = (p) => p === "/mcp" || p.startsWith("/mcp/");
const isPublicPage = (p) => p === "/" || p === "/board" || p === "/board.json";

function tooMany(limit) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: `Rate limit: more than ${limit} requests a minute from this address. Try again in a minute.` } }), {
    status: 429, headers: { "content-type": "application/json", "retry-after": "60" },
  });
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
    if (url.pathname === "/") {
      return new Response(`Starfare connector. Add ${url.origin}/mcp as a custom connector at grok.com/connectors. Scores: ${url.origin}/board\n`, { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    return new Response("Not found", { status: 404 });
  },
};
