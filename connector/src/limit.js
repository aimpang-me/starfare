// Rate limits. Counts live in the one StarfareHub (hit), per clock minute; this module picks what a request counts against
// and how many calls it carries, and answers a client the hub already refused this minute without asking the hub again.
// No Worker imports, so the tests load it in plain Node.
export function tooMany(limit, who = "this address") {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: `Rate limit: more than ${limit} requests a minute from ${who}. Try again in a minute.` } }), {
    status: 429, headers: { "content-type": "application/json", "retry-after": "60" },
  });
}
export const busy = (msg = "Too many requests. Try again in a minute.") => new Response(msg, { status: 429, headers: { "retry-after": "60" } });

/** What the rate limit counts a request against: its IPv4 address, or the /64 of its IPv6 address (one host usually holds
 *  a whole /64, so counting single IPv6 addresses would give it billions of budgets). */
export function clientKey(req) {
  const ip = (req.headers.get("cf-connecting-ip") || "unknown").trim().toLowerCase();
  if (!ip.includes(":")) return ip;
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1); // IPv4-mapped, ::ffff:a.b.c.d
  const [head, tail] = ip.split("::"), h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const full = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return full.slice(0, 4).map((x) => (parseInt(x, 16) || 0).toString(16)).join(":") + "::/64";
}

// Keys the hub already refused this minute, so a limited client's next requests are answered here and never reach the one
// hub Durable Object. Per isolate and best effort; the hub's count stays the rule.
const refused = new Set();
let refusedWin = -1;
/** Counts n calls against key (a prefix plus clientKey, or a player) on the hub h and says whether they fit this minute's budget. */
export async function allowed(h, key, limit, n = 1) {
  const win = Math.floor(Date.now() / 60000);
  if (refusedWin !== win) { refused.clear(); refusedWin = win; }
  if (refused.has(key)) return false;
  if ((await h.hit(key, limit, n)).ok) return true;
  if (refused.size < 20000) refused.add(key);
  return false;
}
export const rateLimit = (env) => Number(env.RATE_PER_MIN) || 120;

const RPC_BATCH_MAX = 10;
export const SHARED_IP = 5; // a signed-in /mcp call's address gets this many times the budget; its player gets the budget itself
/** How many JSON-RPC messages a POST to /mcp carries (1 unless it is a batch), or a Response refusing an oversized batch.
 *  Each message in a batch is a tool call, so each counts against the rate limit. */
export async function rpcCount(req) {
  if (req.method !== "POST") return 1;
  let body;
  try { body = JSON.parse(await req.clone().text()); } catch { return 1; } // the MCP transport answers malformed bodies itself
  if (!Array.isArray(body)) return 1;
  if (body.length > RPC_BATCH_MAX) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `A batch may carry at most ${RPC_BATCH_MAX} messages; send the rest in another request.` } }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }
  return Math.max(1, body.length);
}
