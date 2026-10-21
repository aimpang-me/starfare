// The owner gate for a private deployment (wrangler.private.jsonc). With STARFARE_OWNER_GATE "on", every page and JSON view
// needs the owner cookie, which /owner sets once the owner types the STARFARE_OWNER_KEY secret. The paths a hosted agent
// calls without a browser stay open: /mcp (behind OAuth, whose grants need the consent page, which is gated), /token,
// /register and /.well-known/*. A missing or short key closes everything rather than opening it. No Worker imports, so the
// tests load it in plain Node.
export const OWNER_COOKIE = "sf_owner";
export const OWNER_KEY_MIN = 32;
const MAX_AGE_S = 90 * 86400;

export const ownerGateOn = (env) => env.STARFARE_OWNER_GATE === "on";
// Trimmed, so a key piped in from a file with its line ending still matches what the owner types.
const ownerKey = (env) => (typeof env.STARFARE_OWNER_KEY === "string" ? env.STARFARE_OWNER_KEY.trim() : "");
const keyOk = (env) => ownerKey(env).length >= OWNER_KEY_MIN;
/** Paths that stay open behind the gate: the agent's MCP and OAuth plumbing, the sign-in page and robots.txt. */
export const ownerOpen = (p) => p === "/mcp" || p.startsWith("/mcp/") || p === "/token" || p === "/register" || p.startsWith("/.well-known/") || p === "/owner" || p === "/robots.txt";

async function sha256(s) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}
function same(a, b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
// The cookie holds a hash of the key under its own label, so the key itself never sits in the browser.
const cookieValue = (env) => sha256("starfare-owner-cookie:" + ownerKey(env));
function cookie(req, name) {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}
export async function isOwner(req, env) {
  return keyOk(env) && same(cookie(req, OWNER_COOKIE), await cookieValue(env));
}
// Only a path on this site: "/x", never "//host" or "/\host".
const safeNext = (n) => (typeof n === "string" && /^\/(?![/\\])/.test(n) ? n : "/world");
const esc = (s) => s.replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");

function signInPage(next, msg, status) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Starfare (private)</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#05070c;color:#d8e2f0;font:16px/1.5 system-ui,sans-serif}
form{width:min(360px,calc(100vw - 32px));display:grid;gap:12px}input,button{font:inherit;padding:10px 12px;border-radius:6px;border:1px solid #2a3850;background:#0c1220;color:inherit}
button{background:#1d3a66;cursor:pointer}p{margin:0;color:#8ea0b8;font-size:14px}</style></head><body>
<form method="post" action="/owner"><h1 style="margin:0;font-size:20px">Starfare (private)</h1><p>${esc(msg)}</p>
<input type="hidden" name="next" value="${esc(next)}"><input type="password" name="key" autocomplete="current-password" placeholder="Owner key" required autofocus>
<button type="submit">Sign in</button></form></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/** The gate. Returns a Response that answers the request (sign-in, refusal, robots.txt), or null to let it through.
 *  attempts(req) counts a sign-in attempt against the caller's rate limit and says whether it fits. */
export async function ownerGate(req, url, env, attempts) {
  if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain" } });
  if (!keyOk(env)) return new Response(`Private deployment: the STARFARE_OWNER_KEY secret is not set (it must be ${OWNER_KEY_MIN}+ characters).`, { status: 503 });
  if (url.pathname === "/owner") {
    if (req.method === "GET") return signInPage(safeNext(url.searchParams.get("next")), "Type the owner key to open this private deployment.", 200);
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, POST" } });
    if (!(await attempts(req))) return new Response("Too many sign-in attempts. Try again in a minute.", { status: 429, headers: { "retry-after": "60" } });
    let form;
    try { form = await req.formData(); } catch { form = new FormData(); }
    const next = safeNext(form.get("next")), key = String(form.get("key") || "").trim();
    if (!same(await sha256(key), await sha256(ownerKey(env)))) return signInPage(next, "That key is not right.", 401);
    return new Response(null, {
      status: 303,
      headers: { location: next, "set-cookie": `${OWNER_COOKIE}=${await cookieValue(env)}; Path=/; Max-Age=${MAX_AGE_S}; HttpOnly; Secure; SameSite=Lax` },
    });
  }
  if (ownerOpen(url.pathname) || (await isOwner(req, env))) return null;
  if (req.method === "GET" && (req.headers.get("accept") || "").includes("text/html")) return signInPage(url.pathname + url.search, "Type the owner key to open this private deployment.", 401);
  return new Response("Private deployment: sign in at /owner first.", { status: 401 });
}
