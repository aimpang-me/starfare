// Optional OAuth sign-in (STARFARE_OAUTH = "on"). Same setup as Wingbot's web/src/oauth/: @cloudflare/workers-oauth-provider
// with dynamic client registration, PKCE and a consent page. Starfare has no accounts and no private data, so the consent
// page is one click: Allow mints an anonymous player identity (a fresh random id per grant). Nothing else changes:
// tools, run_id rules and scoring are the same as with OAuth off; runs and the board just carry the player tag.
//
// Storage: the provider keeps clients, grants and tokens in env.OAUTH_KV. If a KV namespace is bound as OAUTH_KV
// (Wingbot's way) it is used. If not, StarfareAuth below stands in: a SQLite Durable Object with the small part of the KV
// API the provider calls, so turning OAuth on needs no namespace to create, only the var.
import { DurableObject } from "cloudflare:workers";
import { AuthorizationError, CimdFetchError, OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { mcpHandler } from "./mcp.js";

export const SCOPES = ["play"];
export const PLAYER_ID = /^p_[0-9a-f]{16}$/;
const PROTECTED_RESOURCE_ROOT = "/.well-known/oauth-protected-resource";

export const oauthOn = (env) => env.STARFARE_OAUTH === "on";
const newPlayerId = () => "p_" + [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");

// ---- KV stand-in -----------------------------------------------------------------------------------------------

/** One instance ("auth"). Rows expire like KV entries: expired rows are invisible and are swept on writes. */
export class StarfareAuth extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER, meta TEXT)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS kv_exp ON kv (exp)");
  }
  get(k) {
    const row = this.sql.exec("SELECT v FROM kv WHERE k = ? AND (exp IS NULL OR exp > ?)", k, Date.now()).toArray()[0];
    return row ? row.v : null;
  }
  put(k, v, exp, meta) {
    const now = Date.now();
    this.sql.exec("DELETE FROM kv WHERE k IN (SELECT k FROM kv WHERE exp IS NOT NULL AND exp <= ? LIMIT 50)", now);
    this.sql.exec("INSERT OR REPLACE INTO kv (k, v, exp, meta) VALUES (?, ?, ?, ?)", k, v, exp, meta);
  }
  delete(k) { this.sql.exec("DELETE FROM kv WHERE k = ?", k); }
  /** KV list(): keys in order, after the cursor (the last key of the previous page). */
  list(prefix, limit, cursor) {
    const rows = this.sql.exec(
      "SELECT k, exp, meta FROM kv WHERE k >= ? AND k < ? AND k > ? AND (exp IS NULL OR exp > ?) ORDER BY k LIMIT ?",
      prefix, prefix + "￿", cursor || "", Date.now(), limit + 1,
    ).toArray();
    const page = rows.slice(0, limit);
    const keys = page.map((r) => Object.assign({ name: r.k }, r.exp ? { expiration: Math.floor(r.exp / 1000) } : {}, r.meta ? { metadata: JSON.parse(r.meta) } : {}));
    const done = rows.length <= limit;
    return done ? { keys, list_complete: true } : { keys, list_complete: false, cursor: page[page.length - 1].k };
  }
}

/** The KV methods the provider uses (get text/json, put with expirationTtl/expiration/metadata, delete, list), over StarfareAuth. */
function doKv(ns) {
  const stub = ns.get(ns.idFromName("auth")); // per request: a stub is an I/O object and cannot cross requests
  return {
    async get(key, opt) {
      const type = typeof opt === "string" ? opt : opt && opt.type;
      const v = await stub.get(key);
      if (v === null) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(key, value, opt = {}) {
      const exp = opt.expirationTtl ? Date.now() + opt.expirationTtl * 1000 : opt.expiration ? opt.expiration * 1000 : null;
      await stub.put(key, String(value), exp, opt.metadata === undefined ? null : JSON.stringify(opt.metadata));
    },
    async delete(key) { await stub.delete(key); },
    async list(opt = {}) { return stub.list(opt.prefix || "", Math.min(opt.limit || 1000, 1000), opt.cursor || null); },
  };
}

/** env with OAUTH_KV filled in, built fresh for each request. The provider reads env.OAUTH_KV, so the stand-in has to live on env. */
function withKv(env) {
  return env.OAUTH_KV ? env : Object.assign(Object.create(env), { OAUTH_KV: doKv(env.STARFARE_AUTH) });
}

// ---- consent page ----------------------------------------------------------------------------------------------

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const text = (status, body) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const redirect = (location, headers) => { headers.set("Location", location); return new Response(null, { status: 302, headers }); };

function consentPage(d, handle) {
  const who = d.clientDomain ? `Published by <strong>${escape(d.clientDomain)}</strong>.` : "This app registered itself; its name is not verified.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect to Starfare</title><style>
:root{--bg:#f7f7f5;--fg:#16181d;--dim:#5d6470;--line:#d9dbe0;--card:#fff;--btn:#16181d;--btnfg:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0c0f16;--fg:#e8ebf2;--dim:#9aa3b2;--line:#283041;--card:#121726;--btn:#e8ebf2;--btnfg:#0c0f16}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:520px;margin:0 auto;padding:32px 16px}h1{font-size:22px;margin:0 0 12px}.dim{color:var(--dim);font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px;margin:16px 0}
button{font:inherit;padding:10px 18px;border-radius:6px;border:1px solid var(--line);cursor:pointer;margin-right:8px}
button[value=approve]{background:var(--btn);color:var(--btnfg);border-color:var(--btn)}
</style></head><body><main>
<h1>Allow ${escape(d.clientName)} to play Starfare?</h1>
<div class="card"><p>${who} Access will be sent to <strong>${escape(d.redirectHost)}</strong>.</p>
${d.redirectIsLoopback ? "<p><strong>This sends access to an app on your computer.</strong> Continue only if you just started connecting from it.</p>" : ""}
<p>Starfare has no accounts. Allow gives this connector a new anonymous player id. It can take ride hails, plan pickups and rides, and post scores to the public <a href="/board">board</a> under that id. Starfare learns nothing about you.</p></div>
<form method="post"><input type="hidden" name="handle" value="${escape(handle)}">
<button name="decision" value="approve">Allow</button><button name="decision" value="deny">Deny</button></form>
</main></body></html>`;
}

async function handleAuthorize(req, env) {
  const oauth = env.OAUTH_PROVIDER;
  if (!oauth) return text(404, "Not found");
  try {
    if (req.method === "GET") {
      const request = await oauth.parseAuthRequest(req);
      const details = await oauth.describeConsent(request);
      const consent = await oauth.beginConsent(request);
      consent.headers.set("content-type", "text/html; charset=utf-8");
      return new Response(consentPage(details, consent.handle), { status: 200, headers: consent.headers });
    }
    if (req.method !== "POST") return text(405, "Method not allowed");
    const form = await req.formData();
    const handle = String(form.get("handle"));
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(req, handle);
      return redirect(denied.redirectTo, denied.headers);
    }
    const approved = await oauth.approveConsent(req, handle, { scope: SCOPES });
    const player_id = newPlayerId();
    const { redirectTo } = await oauth.completeAuthorization({ request: approved.request, userId: player_id, metadata: {}, scope: SCOPES, props: { player_id } });
    return redirect(redirectTo, approved.headers);
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError) return text(400, error.description);
    if (error instanceof CimdFetchError) return text(400, "This app could not be verified.");
    throw error;
  }
}

// ---- provider --------------------------------------------------------------------------------------------------

/** The grant's props reach /mcp as ctx.props; only a well-formed player id gets through to the tools. */
const mcpApi = {
  fetch(req, env, ctx) {
    const player_id = ctx.props && ctx.props.player_id;
    if (typeof player_id !== "string" || !PLAYER_ID.test(player_id)) {
      return new Response("Grant is malformed; connect again.", { status: 401, headers: { "www-authenticate": 'Bearer error="invalid_token"' } });
    }
    ctx.props = { player_id };
    return mcpHandler.fetch(req, env, ctx);
  },
};
const consentPages = { fetch: (req, env) => (new URL(req.url).pathname === "/authorize" ? handleAuthorize(req, env) : text(404, "Not found")) };

/** Built per origin (workers.dev, a custom domain or localhost under wrangler dev), as in Wingbot: the resource URL must be absolute. */
const providers = new Map();
function providerFor(origin) {
  let p = providers.get(origin);
  if (!p) {
    p = new OAuthProvider({
      apiRoute: "/mcp",
      apiHandler: mcpApi,
      defaultHandler: consentPages,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/token",
      clientRegistrationEndpoint: "/register",
      scopesSupported: SCOPES,
      resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], resource_name: "Starfare" },
    });
    providers.set(origin, p);
  }
  return p;
}

/** Everything that is not /, /board or /board.json when OAuth is on: /mcp (bearer required), metadata, /register, /authorize, /token. */
export function oauthFetch(req, env, ctx) {
  const url = new URL(req.url);
  const forProvider = url.pathname === PROTECTED_RESOURCE_ROOT ? new Request(new URL(`${PROTECTED_RESOURCE_ROOT}/mcp`, url), req) : req;
  return providerFor(url.origin).fetch(forProvider, withKv(env), ctx);
}
