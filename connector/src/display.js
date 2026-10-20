// Rounding for what people and bots read. Stored scores, the board's best-run comparison, /board.json and bench traces
// keep exact values; tool results and pages show whole points, so a bot that repeats numbers says 34994, not 34993.98485825111.

/** A score in whole points (no -0). Anything that is not a number passes through. */
export const points = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) || 0 : n);

/** Whole points with thousands separators, for pages. */
export const pointsText = (n) => (typeof n === "number" && Number.isFinite(n) ? points(n).toLocaleString("en-US") : String(n));

/** Binary float noise in text the engine writes (678.0999999999999 kg -> 678.1 kg). Twelve significant digits keep every
 *  digit the engine means; only runs of nine or more decimals are touched. */
export const tidyText = (s) => s.replace(/\d+\.\d{9,}/g, (m) => String(+(+m).toPrecision(12)));

const SCORE_KEYS = new Set(["total", "got", "max", "best_total", "last_total", "mean_total", "bench_total", "mean_lost"]);
const SCORE_MAPS = new Set(["parts", "mean_parts"]); // { part key: points } in run logs and ride stats

/** A tool result as the bot gets it: score fields in whole points and float noise gone from text. Returns a copy. */
export function forReaders(v, key = null, inMap = false) {
  if (typeof v === "number") return inMap || SCORE_KEYS.has(key) ? points(v) : v;
  if (typeof v === "string") return tidyText(v);
  if (Array.isArray(v)) return v.map((x) => forReaders(x));
  if (v && typeof v === "object") {
    const map = SCORE_MAPS.has(key), out = {};
    for (const [k, x] of Object.entries(v)) out[k] = forReaders(x, k, map);
    return out;
  }
  return v;
}
