// A bench run (suiteInstance: frozen sky clock, secret string seed, task_id tag) through the same tools a season run uses.
// Run: node build.mjs && node --test test/bench-seam.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { SKY, sky, isoJD, openRun, seasonInstance, suiteInstance, hailInfo, planPickup, planRideLeg, dispatch, decide, checkPad, spaceWeather, leaveRun, rideSummary, rideRecord } from "../src/game.js";

const E = createRequire(import.meta.url)("../src/engine/sol-page.cjs");
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);
const YEAR_MS = 365 * 86400 * 1000;
const SKY_CERES = SKY.t0_ms + Math.round((2463049.6 - SKY.jd0) * 1000) + 16 * SKY.len_days * 1000;
const CLOCK = 2462529.5; // sky(NOW).jd, so a bench take and a live take at NOW get the same t0
const SEED = "k1:7f3c9a2e5b10d84f00"; // stops iss-crew on the par car at a pad_closed checkpoint
const TAG = "iss-crew/pad-closed-01";

const benchRun = (hail, runId, tag = TAG) => openRun(E, suiteInstance(E, { hail_id: hail }, { seed: SEED, clockJd: CLOCK, tag, budget: 12 }), runId, NOW);
const seasonRun = (hail, runId) => openRun(E, seasonInstance(E, hail, NOW), runId, NOW);
const quoteOf = (p, r, extra) => ({ pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare, quoted_arrival: isoJD(r.arr_jd), ...extra });
async function legs(run, car = run.par_car) {
  const p = (await planPickup(E, run, { car })).leg;
  return [p, (await planRideLeg(E, run, { after_leg: p.leg_id })).leg];
}

test("a frozen clock never goes cold: a long haul dispatched 400 sky days or a year later still flies", async () => {
  const ceresNow = SKY_CERES, clock = sky(ceresNow).jd;
  const live = await openRun(E, seasonInstance(E, "ceres-shift", ceresNow), "run_live", ceresNow);
  const [lp, lr] = await legs(live, "sf-09");
  const late = ceresNow + (lr.dep_jd - clock + 2) * 1000;
  assert.throws(() => dispatch(E, live, quoteOf(lp, lr), late), { message: "The hail went cold: leg2 was due to depart 2032-03-28 03:33 and sky time is now 2032-03-30 03:33. Take the hail again." });

  for (const later of [400 * 1000, YEAR_MS]) {
    const run = await openRun(E, suiteInstance(E, { hail_id: "ceres-shift" }, { seed: SEED, clockJd: clock, tag: "ceres-shift/frozen-01", budget: 12 }), "run_frozen", ceresNow);
    assert.equal(run.t0, live.t0);
    const [p, r] = await legs(run, "sf-09");
    const out = dispatch(E, run, quoteOf(p, r, { ask_after_hours: "never" }), ceresNow + later);
    assert.equal(out.status, "arrived");
    assert.equal(out.task_id, "ceres-shift/frozen-01");
    assert.equal(hailInfo(E, run, ceresNow + later).sky_now, isoJD(clock));
  }
});

test("a bench get_hail names its task_id, never a season or its seed", async () => {
  const live = hailInfo(E, await seasonRun("iss-crew", "run_live"), NOW);
  assert.equal(live.season, 7);
  assert.equal("task_id" in live, false);

  const out = hailInfo(E, await benchRun("iss-crew", "run_bench"), NOW);
  assert.equal(out.task_id, TAG);
  assert.equal("season" in out, false);
  assert.equal(JSON.stringify(out).includes(SEED), false);
  assert.equal(out.sky_now, "2030-01-28 00:00");
  assert.equal(out.rider_ready, live.rider_ready);
});

/** Every tool result of one ride through a checkpoint, answered by decide (hold) or left; keyed by tool and phase. */
async function play(run, how) {
  const out = {}, h = E.R.BY[run.id];
  out.get_hail = hailInfo(E, run, NOW);
  out.check_pad = checkPad(E, run, { place: h.to }, NOW);
  out.space_weather = spaceWeather(E, run, { days: 3 }, NOW);
  const [p, r] = await legs(run);
  out.plan_pickup = p; out.plan_ride = r;
  out.summary_planning = rideSummary(E, run); out.record_planning = rideRecord(E, run);
  out.dispatch = dispatch(E, run, quoteOf(p, r), NOW);
  out.get_hail_in_flight = hailInfo(E, run, NOW);
  out.summary_in_flight = rideSummary(E, run); out.record_in_flight = rideRecord(E, run);
  out.land = how === "decide" ? await decide(E, run, { checkpoint: 1, action: "hold" }) : leaveRun(E, run);
  out.get_hail_arrived = hailInfo(E, run, NOW);
  out.summary_arrived = rideSummary(E, run); out.record_arrived = rideRecord(E, run);
  return out;
}
const keysDeep = (v, acc = new Set()) => {
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (!Array.isArray(v)) acc.add(k); keysDeep(x, acc); }
  return acc;
};
const nanDeep = (v) => (typeof v === "number" ? Number.isNaN(v) : v && typeof v === "object" ? Object.values(v).some(nanDeep) : false);

test("no tool result of a bench run prints its seed, a season or planned_by; a season run prints its season", async () => {
  for (const how of ["decide", "leave"]) {
    const bench = await play(await benchRun("iss-crew", "run_bench_" + how), how);
    assert.equal(Object.keys(bench).length, 15);
    assert.equal(bench.dispatch.status, "checkpoint");
    assert.equal(bench.dispatch.situation.kind, "pad_closed");
    assert.equal(bench.land.status, "arrived");
    assert.equal(bench.land.task_id, TAG);
    assert.equal(bench.record_arrived.log.task_id, TAG);
    for (const [tool, v] of Object.entries(bench)) {
      const json = JSON.stringify(v);
      assert.equal(json.includes(SEED), false, tool + " prints the seed");
      assert.equal(nanDeep(v), false, tool + " has NaN");
      const keys = keysDeep(v);
      assert.equal(keys.has("season") || keys.has("planned_by"), false, tool + " names a season or planned_by");
    }

    const live = await play(await seasonRun("iss-crew", "run_live_" + how), how);
    assert.equal(live.get_hail.season, 7);
    assert.equal(live.summary_arrived.season, 7);
    assert.equal(live.record_arrived.log.season, 7);
    assert.equal(live.land.planned_by, "Grok bot (connector)");
  }
});
