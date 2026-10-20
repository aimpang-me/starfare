// Plays the reference company (src/world-ref.js) on a fresh sandbox world and prints its scores and timing.
//   node bench/world-ref.mjs [--seed <seed>] [--world <w_ + 20 hex>] [--ticks <n>]
// A world's seed on the server is keyed with STARFARE_SEASON_KEY, so this replays a live world only when given its seed.
import { createRequire } from "node:module";
import { computeLeg, legKey } from "../src/game.js";
import { refTick } from "../src/world-ref.js";
import { newWorld, scoresView } from "../src/world-state.js";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const E = createRequire(import.meta.url)("../src/engine/sol-page.cjs");
const worldId = arg("world", "w_0123456789abcdef0123"), seed = arg("seed", "ref-seed"), maxTicks = Number(arg("ticks", 1e9));
const w = newWorld(E, { worldId, seed, nowMs: 0 }), st = { runs: {}, skip: new Set() }, memo = new Map();
let seq = 0, legs = 0, legMs = 0;
const legFn = async (from, to, t, obj, end, ship, aboard) => {
  const k = legKey(from, to, t, obj, end, ship, aboard);
  if (memo.has(k)) return { leg: memo.get(k), cached: true };
  const t0 = Date.now(), leg = computeLeg(E, from, to, t, obj, end, ship, aboard);
  legs++; legMs += Date.now() - t0;
  memo.set(k, leg);
  return { leg, cached: false };
};
const started = Date.now();
let tick = 0, jobs = 0;
while (!w.clock.done && tick < maxTicks) {
  const t = Date.now(), taken = await refTick(E, w, st, { legFn, newRunId: () => "run_" + String(++seq).padStart(20, "0") });
  jobs += taken.length; tick++;
  if (taken.length) console.log("tick " + tick + " (" + w.events.at(-1).sky + "): took " + taken.join(", ") + " in " + (Date.now() - t) + " ms");
  if (Object.keys(w.market.closed).length + st.skip.size >= w.market.size) break;
}
const s = scoresView(E, w);
console.log(JSON.stringify({ ticks: tick, sky_now: w.events.at(-1)?.sky, jobs, skipped: st.skip.size, legs_planned: legs, leg_ms: legMs, total_ms: Date.now() - started,
  desks: s.desks, company: s.company }, null, 2));
