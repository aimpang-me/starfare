// CPU cost of the engine calls the connector makes for ride hails, measured in plain Node on the copied engine.
// Run: node build.mjs && node test/bench.mjs
// Each figure is wall time of a synchronous, single-threaded call, which is what Workers bills as CPU.
//   take_hail   = R.terms (par: every nearby car's pickup and ride for energy, flown through the season's hazards,
//                 quick hails also with ground waits of 0-12 h; plus each one's pickup for time)
//   plan_pickup = R.planLeg + refly for one car, car's parking place to the rider (every car in the fleet tried;
//                 "nearby" = the cars R.nearCars counts for par, usually local hops)
//   plan_ride   = R.planLeg + refly for the ride, after that car's pickup and boarding
import { createRequire } from "node:module";
import { SEASON_END, sky } from "../src/game.js";

const require = createRequire(import.meta.url);
const ms = (f) => { const a = process.hrtime.bigint(); const r = f(); return [Number(process.hrtime.bigint() - a) / 1e6, r]; };
const [loadMs, E] = ms(() => require("../src/engine/sol-page.cjs"));
const R = E.R;
console.log(`engine load + ephemeris init: ${loadMs.toFixed(0)} ms (once per isolate, on first tool call)`);

const now = Date.now(), jd = sky(now).jd, seed = String(sky(now).season); // hazard seed = season, as the connector uses
const rows = [];
for (const h of R.HAILS) {
  const t0 = Math.floor(jd + (h.kind === "quick" ? 1 : R.LEAD)) + 0.5;
  const [termsMs] = ms(() => R.terms(h.id, t0, SEASON_END, seed));
  const [terms2Ms] = ms(() => R.terms(h.id, t0 + 1, SEASON_END, seed));
  const near = new Set(R.nearCars(h).map((c) => c.id));
  let nearMax = 0, pickMax = 0, pickPlanMax = 0, pickReflyMax = 0, rideMax = 0, ridePlanMax = 0, rideReflyMax = 0, failed = 0;
  for (const c of R.FLEET) {
    if (c.at === h.from) continue;
    try {
      const [pp, p] = ms(() => R.planLeg(c.at, h.from, t0, "energy", SEASON_END));
      const [pr] = ms(() => E.refly(p));
      pickMax = Math.max(pickMax, pp + pr); if (near.has(c.id)) nearMax = Math.max(nearMax, pp + pr); pickPlanMax = Math.max(pickPlanMax, pp); pickReflyMax = Math.max(pickReflyMax, pr);
      const [rp, r] = ms(() => R.planLeg(h.from, h.to, p.arr_jd + R.DWELL, "energy", SEASON_END));
      const [rr] = ms(() => E.refly(r));
      rideMax = Math.max(rideMax, rp + rr); ridePlanMax = Math.max(ridePlanMax, rp); rideReflyMax = Math.max(rideReflyMax, rr);
    } catch { failed++; }
  }
  rows.push({ hail: h.id, kind: h.kind, "take_hail (terms) ms": +termsMs.toFixed(1), "terms again ms": +terms2Ms.toFixed(1),
    "plan_pickup max ms": +pickMax.toFixed(1), "nearby cars max ms": +nearMax.toFixed(1), "pickup planLeg / refly max": `${pickPlanMax.toFixed(1)} / ${pickReflyMax.toFixed(1)}`,
    "plan_ride max ms": +rideMax.toFixed(1), "ride planLeg / refly max": `${ridePlanMax.toFixed(1)} / ${rideReflyMax.toFixed(1)}`,
    "cars with no route": failed });
}
console.table(rows);
console.log(`sky date now: JD ${jd.toFixed(2)} (${E.isoFromJd(jd, true).slice(0, 16).replace("T", " ")}), season end JD ${SEASON_END}`);
