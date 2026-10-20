// Live output pinned byte for byte: every view a season run prints, for each hail at a fixed sky clock, against a golden
// file captured from the code before the Instance/openRun seam. Rewrite the golden only for an intended output change:
//   STARFARE_WRITE_GOLDEN=1 node --test test/live.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { SKY, sky, isoJD, openRun, seasonInstance, hailInfo, planPickup, planRideLeg, dispatch, decide, checkPad, spaceWeather, leaveRun, rideSummary, rideRecord } from "../src/game.js";

const E = createRequire(import.meta.url)("../src/engine/sol-page.cjs");
const R = E.R;
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);
const GOLDEN = new URL("./fixtures/live-golden.json", import.meta.url);
const take = (hail, nowMs, runId) => openRun(E, seasonInstance(E, hail, nowMs), runId, nowMs);
const skyAt = (jd) => SKY.t0_ms + Math.round((jd - SKY.jd0) * 1000);
const CERES_NOW = skyAt(2463049.6) + 16 * SKY.len_days * 1000;

async function views() {
  const out = {};
  const put = (k, v) => { out[k] = JSON.stringify(v); };
  for (const h of R.HAILS) {
    let run;
    try { run = await take(h.id, NOW, "run_" + h.id); }
    catch (e) { put(h.id + ".error", e.message); continue; }
    if (h.id === "iss-crew") run.player_id = "p_0123456789abcdef";
    put(h.id + ".get_hail", hailInfo(E, run, NOW));
    put(h.id + ".summary.planning", rideSummary(E, run));
    put(h.id + ".record.planning", rideRecord(E, run));
    put(h.id + ".check_pad", checkPad(E, run, { place: h.to }, NOW + 1000));
    put(h.id + ".space_weather", spaceWeather(E, run, { days: 3 }, NOW + 2000));
    const p = (await planPickup(E, run, { car: run.par_car })).leg, r = (await planRideLeg(E, run, { after_leg: p.leg_id })).leg;
    put(h.id + ".land", dispatch(E, run, { pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare, quoted_arrival: isoJD(r.arr_jd), ask_after_hours: "never" }, NOW));
    put(h.id + ".get_hail.arrived", hailInfo(E, run, NOW + 3000));
    put(h.id + ".summary.arrived", rideSummary(E, run));
    put(h.id + ".record.arrived", rideRecord(E, run));
  }
  // The engine's pinned dust-storm ride (test-reroute.js): stops at a checkpoint, then lands on hold or is left.
  const DUST_NOW = SKY.t0_ms + Math.round((2462172.6 - SKY.jd0) * 1000);
  for (const how of ["decide", "leave"]) {
    const run = await take("phobos-commute", DUST_NOW, "run_dust_" + how);
    const start = R.pickupStart(run.id, "sf-03", run.t0, run.seed);
    const p = (await planPickup(E, run, { car: "sf-03", wait_days: 2462174.529253031 - start })).leg;
    const r = (await planRideLeg(E, run, { after_leg: p.leg_id, wait_days: 2462175.529253031 - p.arr_jd - R.DWELL })).leg;
    put("dust." + how + ".dispatch", dispatch(E, run, { pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare, quoted_arrival: isoJD(r.arr_jd) }, DUST_NOW));
    put("dust." + how + ".get_hail.in_flight", hailInfo(E, run, DUST_NOW));
    put("dust." + how + ".summary.in_flight", rideSummary(E, run));
    put("dust." + how + ".record.in_flight", rideRecord(E, run));
    put("dust." + how + ".land", how === "decide" ? await decide(E, run, { checkpoint: 1, action: "hold" }) : leaveRun(E, run));
    put("dust." + how + ".summary.arrived", rideSummary(E, run));
    put("dust." + how + ".record.arrived", rideRecord(E, run));
  }
  const cold = await take("ceres-shift", CERES_NOW, "run_cold");
  const p = (await planPickup(E, cold, { car: "sf-09" })).leg, r = (await planRideLeg(E, cold, { after_leg: p.leg_id })).leg;
  let msg = null;
  try { dispatch(E, cold, { pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare, quoted_arrival: isoJD(r.arr_jd) }, CERES_NOW + (r.dep_jd - sky(CERES_NOW).jd + 2) * 1000); } catch (e) { msg = e.message; }
  put("cold.error", msg);
  put("cold.summary", rideSummary(E, cold));
  put("cold.record", rideRecord(E, cold));
  const left = await take("iss-crew", NOW, "run_left");
  put("newer_hail.leave", leaveRun(E, left));
  put("newer_hail.summary", rideSummary(E, left));
  return out;
}

test("live output is byte-identical to the golden capture", async () => {
  const got = await views();
  if (process.env.STARFARE_WRITE_GOLDEN) writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + "\n");
  const want = JSON.parse(readFileSync(GOLDEN, "utf8"));
  assert.deepEqual(Object.keys(got), Object.keys(want));
  for (const k of Object.keys(want)) assert.equal(got[k], want[k], k);
});
