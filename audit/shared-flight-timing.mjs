// Read-only diagnostic: report overlapping shared-flight segments without correcting their stored times.
// Run from the repository root: node audit/shared-flight-timing.mjs
import { createRequire } from "node:module";
import { openRun, suiteInstance, applyTool, liveRecord } from "../connector/src/game.js";
const E = createRequire(import.meta.url)("../connector/src/engine/sol-page.cjs");
let run = await openRun(E, suiteInstance(E, { hails: ["ceres-shift", "phobos-commute"] }, { seed: "2", clockJd: 2461550, tag: "timing-audit", budget: null }), "run_timing_audit", 0);
async function call(tool, input) {
  const out = await applyTool(E, run, tool, input, { nowMs: 0 });
  if (out.run) run = out.run;
  if (out.result.error) throw new Error(out.result.error);
  return out.result;
}
const legs = [];
for (const to of ["ceres-port", "mars-base", "phobos", "mars-base"]) legs.push(await call("plan_leg", { to, ...(legs.length ? { after_leg: legs.at(-1).leg_id } : { car: "sf-04" }) }));
await call("dispatch", { legs: legs.map((l) => l.leg_id), ask_after_hours: "never",
  stops: [{ board: ["ceres-shift"] }, { alight: ["ceres-shift"] }, { board: ["phobos-commute"] }, { alight: ["phobos-commute"] }],
  quotes: { "ceres-shift": { fare_usd: legs[1].fare_usd, arrival: legs[1].arrive }, "phobos-commute": { fare_usd: legs[3].fare_usd, arrival: legs[3].arrive } } });
const rec = liveRecord(E, run, 0);
const conflicts = run.ride.segs.flatMap((s, i, all) => i && s.flew.dep_jd < all[i - 1].flew.land_jd ? [{
  leg: i + 1, previous_landing: rec.log.flown[i - 1].arrive, departure: rec.log.flown[i].depart,
  overlap_minutes: Math.round((all[i - 1].flew.land_jd - s.flew.dep_jd) * 1440 * 10) / 10,
}] : []);
console.log(JSON.stringify({ ship: run.car, bookings: run.hails, conflicts, note: "Diagnostic only; an empty list for one case would not certify the engine." }, null, 2));
