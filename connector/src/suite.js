// A bench suite: a fixed list of tasks (a hail, or a shared flight of up to R.MAX_BOOKINGS bookings, at a frozen sky time),
// tied to one engine bundle and one score version. The file holds no seeds: each task's world is derived here, from a public
// string for the public splits and from STARFARE_BENCH_KEY for the test split. WebCrypto only, so it runs in Node and on Workers.
import META from "./engine/meta.json" with { type: "json" };
import { SCORE_VERSION, suiteInstance } from "./game.js";

export const SUITE_FORMAT = "starfare.suite/1";
export const PUBLIC_SPLITS = ["dev"];

/** The suite, or a thrown Error when it was cut for another engine or another score. */
export function loadSuite(obj) {
  const s = typeof obj === "string" ? JSON.parse(obj) : obj;
  if (!s || s.format !== SUITE_FORMAT) throw new Error("not a " + SUITE_FORMAT + " file");
  if (s.engine_sha256 !== META.sha256) throw new Error("suite " + s.id + " was cut for engine " + s.engine_sha256 + "; this bundle is " + META.sha256);
  if (s.score_version !== SCORE_VERSION) throw new Error("suite " + s.id + " was cut for score version " + s.score_version + "; this game scores version " + SCORE_VERSION);
  if (!(s.budget > 0)) throw new Error("suite " + s.id + " has no tool-call budget");
  return s;
}
export function tasksOf(suite, split) {
  const t = suite.splits && Object.hasOwn(suite.splits, split) ? suite.splits[split] : null;
  if (!t) throw new Error("suite " + suite.id + " has no " + split + " split; it has " + Object.keys(suite.splits || {}).join(", "));
  return t;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const utf8 = (s) => new TextEncoder().encode(s);
/** A task's hazard seed, "k1:" and 128 bits of hex. Public splits: SHA-256 of a public string. Test: HMAC-SHA-256 under key.
 *  One world per task unless the suite says world "per_repeat", which mixes the repeat in. */
export async function seedFor(suite, split, task, repeat, key) {
  const msg = utf8(["starfare-bench", suite.id, split, task.id, ...(suite.world === "per_repeat" ? [String(repeat)] : [])].join("|"));
  if (PUBLIC_SPLITS.includes(split)) return "k1:" + hex(await crypto.subtle.digest("SHA-256", msg)).slice(0, 32);
  if (!key) throw new Error("the " + split + " split needs STARFARE_BENCH_KEY");
  const k = await crypto.subtle.importKey("raw", utf8(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "k1:" + hex(await crypto.subtle.sign("HMAC", k, msg)).slice(0, 32);
}
/** The Instance for one attempt at a task. */
export const instanceFor = (E, suite, task, seed) =>
  suiteInstance(E, task.hails ? { hails: task.hails } : { hail_id: task.hail_id }, { seed, clockJd: task.clock_jd, tag: task.id, budget: suite.budget });
