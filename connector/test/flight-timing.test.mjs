import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { openRun, suiteInstance, applyTool, liveRecord } from "../src/game.js";

const E = createRequire(import.meta.url)("../src/engine/sol-page.cjs"), R = E.R;

function chronological(ride) {
  const flown = ride.segs.filter((s) => s.flew);
  for (let i = 1; i < flown.length; i++) {
    const before = flown[i - 1], after = flown[i];
    assert.ok(after.flew.dep_jd >= (before.flew.land_jd ?? before.flew.left_jd),
      `segment ${i + 1} departs before segment ${i} ends`);
  }
}

test("a delayed shared drop-off lands before the empty pickup departs", async () => {
  const ids = ["ceres-shift", "phobos-commute"];
  let run = await openRun(E, suiteInstance(E, { hails: ids }, { seed: "2", clockJd: 2461550, tag: "timing", budget: null }), "run_timing", 0);
  async function call(tool, input) {
    const out = await applyTool(E, run, tool, input, { nowMs: 0 });
    if (out.run) run = out.run;
    assert.equal(out.result.error, undefined);
    return out.result;
  }
  const legs = [];
  for (const to of ["ceres-port", "mars-base", "phobos", "mars-base"])
    legs.push(await call("plan_leg", { to, ...(legs.length ? { after_leg: legs.at(-1).leg_id } : { car: "sf-04" }) }));
  const out = await call("dispatch", { legs: legs.map((l) => l.leg_id), ask_after_hours: "never",
    stops: [{ board: [ids[0]] }, { alight: [ids[0]] }, { board: [ids[1]] }, { alight: [ids[1]] }],
    quotes: Object.fromEntries(ids.map((id, i) => [id, { fare_usd: legs[2 * i + 1].fare_usd, arrival: legs[2 * i + 1].arrive }])) });
  assert.equal(out.status, "arrived");
  chronological(run.ride);
  const [pickup, dropoff, empty, passenger] = run.ride.segs;
  assert.ok(dropoff.flew.land_jd > dropoff.arr_jd, "the fixture must include an actual landing delay");
  assert.equal(empty.flew.dep_jd, dropoff.flew.land_jd, "a drop-off needs no boarding dwell");
  assert.ok(passenger.flew.dep_jd >= empty.flew.land_jd + R.DWELL);
  assert.equal(empty.flew.orbit_jd - empty.flew.dep_jd, empty.arr_jd - empty.dep_jd, "propagating a delay preserves the local hop duration");
  assert.equal(pickup.flew.land_jd, run.ride.pickups[ids[0]]);
  const rec = liveRecord(E, run, 0);
  assert.equal(rec.log.flown[2].depart, rec.log.flown[1].arrive);
});

// Existing engine checkpoint fixture: the second leg reaches a closed Mars pad.
// Extra legs exercise continuation after a drop-off and after a stop without passenger events.
function dustPlan(lastTo = "phobos") {
  const legs = [
    { from: "mars-base", to: "phobos", dep_jd: 2462174.529253031, arr_jd: 2462174.6220957525, kwh: 11027, fare: 1811.11, gate: "local" },
    { from: "phobos", to: "mars-base", dep_jd: 2462175.529253031, arr_jd: 2462175.6220957525, kwh: 11027, fare: 1811.11, gate: "local" },
    { from: "mars-base", to: "phobos", dep_jd: 2462175.6220957525, arr_jd: 2462175.7220957526, kwh: 1000, fare: 1, gate: "local" },
    { from: "phobos", to: lastTo, dep_jd: 2462175.7220957526, arr_jd: 2462176.7220957526, kwh: 1000, fare: 1, gate: lastTo === "ceres-port" ? "PASS" : "local" },
  ];
  return { legs, stops: [{ at: "mars-base" }, { at: "phobos", board: ["phobos-commute"] },
    { at: "mars-base", alight: ["phobos-commute"] }, { at: "phobos" }, { at: lastTo }] };
}

test("delays propagate through drop-offs and stops without passenger events", () => {
  const { ride } = R.start("phobos-commute", "sf-03", dustPlan("mars-base"), 2462173.5, "1", { ask_after_hours: "never" });
  chronological(ride);
  assert.equal(ride.segs[2].flew.dep_jd, ride.segs[1].flew.land_jd);
  assert.equal(ride.segs[3].flew.dep_jd, ride.segs[2].flew.land_jd);
});

test("a late interplanetary continuation asks before launch and keeps its correction burn", () => {
  let st = R.start("phobos-commute", "sf-03", dustPlan("ceres-port"), 2462173.5, "1", { ask_after_hours: 1 });
  while (st.checkpoint && st.checkpoint.kind !== "launch_hold") st = R.step(st.ride, { action: "hold" });
  assert.equal(st.checkpoint?.kind, "launch_hold");
  assert.equal(st.checkpoint.cause, "car_late");
  assert.ok(st.checkpoint.sky_at >= st.ride.segs[2].flew.land_jd);
  while (st.checkpoint) st = R.step(st.ride);
  chronological(st.ride);
  assert.ok(st.done.incidents.some((i) => i.kind === "correction_burn" && i.where === "phobos"));
});

test("a diversion waits at its alternate and returns before the remaining stops continue", () => {
  let st = R.start("phobos-commute", "sf-03", dustPlan("mars-base"), 2462173.5, "1", { ask_after_hours: 1 });
  assert.equal(st.checkpoint.kind, "pad_closed");
  st = R.step(st.ride, { action: "divert", place: "phobos", wait_hours: 88.4 });
  while (st.checkpoint) st = R.step(st.ride);
  chronological(st.ride);
  const segments = st.ride.segs, returnAt = segments.findIndex((s) => s.kind === "return");
  assert.ok(returnAt > 0);
  assert.ok(segments[returnAt].flew.dep_jd >= segments[returnAt - 1].flew.land_jd + 88.4 / 24);
  assert.ok(segments[returnAt + 1].flew.dep_jd >= segments[returnAt].flew.land_jd);
});

test("a later scheduled departure is preserved after a delayed landing", () => {
  const plan = dustPlan("mars-base"), later = 2462200.5;
  plan.legs[2].dep_jd = later;
  plan.legs[2].arr_jd = later + 0.1;
  plan.legs[3].dep_jd = later + 0.1;
  plan.legs[3].arr_jd = later + 0.2;
  const { ride } = R.start("phobos-commute", "sf-03", plan, 2462173.5, "1", { ask_after_hours: "never" });
  chronological(ride);
  assert.ok(ride.segs[1].flew.land_jd < later);
  assert.equal(ride.segs[2].flew.dep_jd, later);
});
