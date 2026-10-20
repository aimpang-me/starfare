// Season hazard seeds. Without STARFARE_SEASON_KEY a season's seed is its number, as it always was, so anyone holding
// /engine.js can compute that season's weather and traffic. With the key (a Wrangler secret of 32+ characters) the seed is
// "k1:" and 128 bits of HMAC-SHA-256 under it: nobody can compute the season until it ends, when /seasons/<n>.json
// publishes its seed so its rides can be replayed and checked. The pages then read conditions from /sky.json.
// WebCrypto only; no Worker imports, so the tests load it in plain Node.
import { BENCH_KEY_MIN } from "./suite.js";

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const utf8 = (s) => new TextEncoder().encode(s);

/** The key, or null when there is none or it is too short to keep the seasons hidden (then seasons stay public). */
export function seasonKey(env) {
  const key = env && env.STARFARE_SEASON_KEY;
  if (!key) return null;
  if (String(key).length < BENCH_KEY_MIN) { warnOnce("STARFARE_SEASON_KEY is shorter than " + BENCH_KEY_MIN + " characters, so seasons stay public. Make one with: openssl rand -hex 32"); return null; }
  return String(key);
}
let warned = false;
function warnOnce(msg) { if (!warned) { warned = true; console.error(msg); } }

async function hmacSeed(msg, key) {
  const k = await crypto.subtle.importKey("raw", utf8(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "k1:" + hex(await crypto.subtle.sign("HMAC", k, utf8(msg))).slice(0, 32);
}
/** A season's seed under key: "k1:" + 32 hex. */
export const keyedSeed = (season, key) => hmacSeed("starfare-season|" + Number(season), key);

/** A sandbox world's hazard seed (world.js): under the key when the server has one, so the operator can recompute it,
 *  otherwise 128 random bits. Either way it stays in the world's Durable Object and is never shown. */
export async function worldSeed(env, worldId) {
  const key = seasonKey(env);
  if (key) return hmacSeed("starfare-world|" + worldId, key);
  return "k1:" + hex(crypto.getRandomValues(new Uint8Array(16)));
}

const memo = new Map(); // key|season -> seed, per isolate
/** The hazard seed every run taken in this season flies. */
export async function seasonSeed(env, season) {
  const key = seasonKey(env);
  if (!key) return String(season);
  const m = key + "|" + season;
  if (!memo.has(m)) { if (memo.size > 16) memo.clear(); memo.set(m, await keyedSeed(season, key)); }
  return memo.get(m);
}

/** What /seasons/<n>.json says: a season's seed once it has ended, or now when seasons are public. */
export async function seasonRelease(env, season, current) {
  const n = Number(season);
  if (!Number.isInteger(n) || n < 1 || n > current) return null;
  const keyed = !!seasonKey(env);
  if (keyed && n === current) return { season: n, keyed, released: false, seed: null, note: "This season's seed is published after it resets." };
  return { season: n, keyed, released: true, seed: await seasonSeed(env, n) };
}
