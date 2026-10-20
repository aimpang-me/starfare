import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { assessItinerary } from "../../world/engine/propulsion-ledger.mjs";
import { adaptFullPlans } from "../../world/engine/propulsion-adapter.mjs";

// Synthetic arithmetic fixtures, not proposed fleet parameters. ve = 1000 m/s,
// thrust = 1 N, flow = 0.001 kg/s. Each nonzero demand halves total mass.
const G0 = 9.80665, DAY = 86400, HALF = 1000 * Math.LN2;
const known = (value) => ({ kind: "known", value, source: "explicit arithmetic fixture" });
const missing = () => ({ kind: "missing", source: "not measured in this scenario" });
const point = () => ({ power_w: 1000, isp_s: 1000 / G0, efficiency: 0.5, source: "synthetic exact-ratio engine" });
function fixture(count = 1) {
  const stops = Array.from({ length: count + 1 }, (_, i) => ({ at: "p" + i, board: [], alight: [], refuel_kg: 0 }));
  const legs = Array.from({ length: count }, (_, i) => ({ id: "leg" + i, from: "p" + i, to: "p" + (i + 1),
    depart_jd: 1000 + i * 200, arrive_jd: 1100 + i * 200,
    burns: ["departure", "capture"].map((phase, j) => ({ phase, dv_mps: j ? 0 : HALF,
      radius_au: 1, point: j ? null : point(), extra_load_w: known(0) })) }));
  return { id: "arithmetic", vehicle: { id: "synthetic", dry_kg: 100, additional_mass_kg: known(0), xenon_capacity_kg: 10000,
    power: { kind: "constant", output_w: 1000, housekeeping_w: 0 } },
    initial_xenon_kg: missing(), reserve_kg: known(0), initial_payloads: [], stops, legs,
    context: { source: "synthetic hand-solvable fixture; not a fleet change", limitations: [] } };
}
function close(actual, expected, label = "quantity") {
  assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${label}: ${actual} != ${expected}`);
}
function burns(projection) { return projection.rows.filter((r) => r.kind === "burn"); }
function failure(report, code) { return report.findings.find((f) => f.code === code && f.certainty === "necessary"); }
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function finiteJson(value) {
  JSON.stringify(value, (_key, item) => {
    if (typeof item === "number") assert.ok(Number.isFinite(item), "nonfinite report number");
    return item;
  });
}

test("one half-mass burn: 100 kg xenon, 1 N, 100000 seconds and 27.7778 kWh", () => {
  const r = assessItinerary(fixture()), b = burns(r.minimum_loading)[0];
  close(r.minimum_initial_xenon_kg.value, 100);
  close(b.thrust_n, 1); close(b.mass_flow_kg_s, 0.001);
  close(b.xenon_used_kg.value, 100); close(b.firing_seconds.value, 100000);
  close(b.thruster_energy_kwh.value, 1000 / 36);
  close(r.minimum_loading.totals.final_xenon_kg.value, 0);
  assert.equal(r.status, "unverified"); assert.equal(r.declared_loading, null);
});

test("departure carries capture fuel: two half-mass burns need 300 kg, not 200", () => {
  const input = fixture(); input.legs[0].burns[1] = { ...input.legs[0].burns[0], phase: "capture" };
  const r = assessItinerary(input), b = burns(r.minimum_loading);
  close(r.minimum_initial_xenon_kg.value, 300);
  close(b[0].xenon_used_kg.value, 200); close(b[1].xenon_used_kg.value, 100);
  close(r.minimum_loading.totals.firing_seconds.value, 300000);
});

test("a 20 kg protected reserve is carried, rather than added twice", () => {
  const input = fixture(); input.reserve_kg = known(20);
  input.legs[0].burns[1] = { ...input.legs[0].burns[0], phase: "capture" };
  const r = assessItinerary(input);
  close(r.minimum_initial_xenon_kg.value, 380);
  close(r.minimum_loading.totals.xenon_used_kg.value, 360);
  close(r.minimum_loading.totals.final_xenon_kg.value, 20);
});

test("boarding and alighting change the inert mass before the next leg", () => {
  const input = fixture(2); input.vehicle.additional_mass_kg = known(20); input.reserve_kg = known(10);
  input.stops[0].board = [{ id: "A", mass_kg: known(80) }];
  input.stops[1].alight = ["A"]; input.stops[1].board = [{ id: "B", mass_kg: known(40) }]; input.stops[2].alight = ["B"];
  const r = assessItinerary(input), b = burns(r.minimum_loading);
  close(r.minimum_initial_xenon_kg.value, 560);
  close(b[0].non_xenon_mass_kg.value, 200); close(b[2].non_xenon_mass_kg.value, 160);
  close(b[0].xenon_used_kg.value, 380); close(b[2].xenon_used_kg.value, 170);
  close(r.minimum_loading.totals.final_xenon_kg.value, 10);
});

test("explicitly initially boarded payload contributes mass until alighting", () => {
  const input = fixture(); input.initial_payloads = [{ id: "cargo", mass_kg: known(50) }]; input.stops[1].alight = ["cargo"];
  close(assessItinerary(input).minimum_initial_xenon_kg.value, 150);
});

test("a 100 kg stop refill is added to 20 kg remaining, not a fuel reset", () => {
  const input = fixture(2); input.reserve_kg = known(10); input.stops[1].refuel_kg = 100;
  const r = assessItinerary(input), stop = r.minimum_loading.rows.find((s) => s.kind === "stop" && s.stop === 1);
  close(r.minimum_initial_xenon_kg.value, 140); close(stop.xenon_before_kg.value, 20); close(stop.xenon_after_kg.value, 120);
  close(r.minimum_loading.totals.xenon_used_kg.value, 230); close(r.minimum_loading.totals.final_xenon_kg.value, 10);
});

test("oversupplied refill is carried into the following burn", () => {
  const input = fixture(2); input.reserve_kg = known(10); input.stops[1].refuel_kg = 200;
  const r = assessItinerary(input);
  close(r.minimum_initial_xenon_kg.value, 120);
  close(burns(r.minimum_loading)[2].xenon_used_kg.value, 155);
  close(r.minimum_loading.totals.final_xenon_kg.value, 55);
  close(r.minimum_loading.totals.xenon_used_kg.value, 265);
});

test("capacity is checked after a refill even when future cabin mass is unknown", () => {
  const input = fixture(); input.initial_xenon_kg = known(50); input.stops[0].refuel_kg = 100;
  input.vehicle.xenon_capacity_kg = 120; input.vehicle.additional_mass_kg = missing();
  const r = assessItinerary(input);
  assert.equal(r.status, "infeasible");
  assert.ok(r.findings.some((f) => f.code === "tank_capacity" && f.mode === "declared_loaded" && f.certainty === "necessary" && f.at === "stop:0"));
});

test("known minimum tank overflow and a delivered quantity above capacity are necessary failures", () => {
  const input = fixture(); input.vehicle.xenon_capacity_kg = 90;
  assert.ok(failure(assessItinerary(input), "minimum_tank_capacity"));
  input.stops[0].refuel_kg = 100;
  assert.ok(failure(assessItinerary(input), "refuel_exceeds_capacity"));
});

test("a final-pad refill cannot satisfy the preceding protected arrival reserve", () => {
  const input = fixture(); input.reserve_kg = known(10); input.stops[1].refuel_kg = 100;
  const r = assessItinerary(input);
  close(r.minimum_initial_xenon_kg.value, 120); close(r.minimum_loading.totals.final_xenon_kg.value, 110);
});

test("actual loaded fuel has a distinct mass and energy projection", () => {
  const input = fixture(); input.initial_xenon_kg = known(300);
  const r = assessItinerary(input);
  close(r.minimum_loading.totals.xenon_used_kg.value, 100);
  close(r.declared_loading.totals.xenon_used_kg.value, 200);
  close(r.declared_loading.totals.final_xenon_kg.value, 100);
});

test("depletion terminates a projection without negative fuel or made-up complete totals", () => {
  const input = fixture(2); input.initial_xenon_kg = known(10);
  const r = assessItinerary(input);
  assert.ok(failure(r, "initial_fuel_shortfall")); assert.equal(r.declared_loading.complete, false);
  assert.equal(r.declared_loading.totals.xenon_used_kg, null);
  assert.equal(r.declared_loading.totals.final_xenon_kg, null);
  assert.equal(burns(r.declared_loading)[0].xenon_after_kg, null);
  assert.equal(burns(r.declared_loading)[2].state, "not_evaluated_after_fuel_depletion"); finiteJson(r);
});

test("solar generation is sampled independently at departure and capture", () => {
  const input = fixture(); input.vehicle.power = { kind: "solar", output_w: 4000, housekeeping_w: 100 };
  input.legs[0].burns[0].extra_load_w = known(200);
  input.legs[0].burns[1] = { ...input.legs[0].burns[0], phase: "capture", radius_au: 2 };
  const r = assessItinerary(input), b = burns(r.minimum_loading);
  close(b[0].power.available_thruster_w.value, 3700); close(b[1].power.available_thruster_w.value, 700);
  const f = failure(r, "thruster_power"); assert.equal(f.phase, "capture"); close(f.shortfall_w, 300);
});

test("constant generator power does not fall with heliocentric distance", () => {
  const input = fixture(); input.legs[0].burns[0].radius_au = 10;
  close(burns(assessItinerary(input).minimum_loading)[0].power.generator_w, 1000);
});

test("power below the quoted point fails even with unknown additional loads", () => {
  const input = fixture(); input.vehicle.power.output_w = 900; input.legs[0].burns[0].extra_load_w = missing();
  const r = assessItinerary(input), f = failure(r, "thruster_power");
  assert.equal(f.available_thruster_w.basis, "upper_bound"); close(f.shortfall_w, 100);
});

test("unknown extra electrical loads never become declared zeroes or verified power", () => {
  const input = fixture(); input.legs[0].burns[0].extra_load_w = missing();
  const r = assessItinerary(input), p = burns(r.minimum_loading)[0].power;
  assert.equal(p.additional_load_w, null); assert.equal(p.available_thruster_w.basis, "upper_bound");
  assert.ok(r.missing_inputs.some((m) => m.path === "legs.0.burns.0.extra_load_w")); assert.equal(r.status, "unverified");
});

for (const [power, isp, eff, publishedThrust] of [[2310, 3280, .64, .092], [2060, 3190, .63, .083],
  [1480, 3180, .61, .058], [1000, 2700, .53, .040], [490, 1950, .38, .0195]]) {
  test(`published NSTAR ${power} W point agrees with its rounded thrust and energy/mass-flow identities`, () => {
    const input = fixture(); input.vehicle.power.output_w = power;
    input.legs[0].burns[0].point = { power_w: power, isp_s: isp, efficiency: eff, source: "NASA/CR-1999-209162 Table 1" };
    const b = burns(assessItinerary(input).minimum_loading)[0];
    assert.ok(Math.abs(b.thrust_n - publishedThrust) < 0.0002);
    close(b.firing_seconds.value * b.mass_flow_kg_s, b.xenon_used_kg.value);
    close(b.thruster_energy_kwh.value * 3.6e6, power * b.firing_seconds.value);
    close(b.mass_flow_kg_s * isp * G0, b.thrust_n);
  });
}

test("firing equal to the generous flight interval passes the bound; one second short fails", () => {
  const input = fixture(); input.legs[0].depart_jd = 0; input.legs[0].arrive_jd = 100000 / DAY;
  assert.equal(assessItinerary(input).status, "unverified");
  input.legs[0].arrive_jd = 99999 / DAY;
  assert.ok(failure(assessItinerary(input), "minimum_firing_exceeds_flight"));
});
test("Julian-date representation does not turn an equal firing budget into a false timing failure", () => {
  for (const jd of [2461700.5, 2464200.5, 2466700.5]) {
    const input = fixture(); input.legs[0].depart_jd = jd; input.legs[0].arrive_jd = jd + 100000 / DAY;
    assert.equal(assessItinerary(input).status, "unverified", "equal interval near JD " + jd);
    input.legs[0].arrive_jd = jd + 99999 / DAY;
    assert.ok(failure(assessItinerary(input), "minimum_firing_exceeds_flight"));
  }
});

test("zero burns need no operating point, fuel, duration or energy", () => {
  const input = fixture(); input.legs[0].burns[0].dv_mps = 0; input.legs[0].burns[0].point = null;
  input.legs[0].arrive_jd = input.legs[0].depart_jd;
  const r = assessItinerary(input);
  close(r.minimum_initial_xenon_kg.value, 0); close(r.minimum_loading.totals.firing_seconds.value, 0);
  close(r.minimum_loading.totals.thruster_energy_kwh.value, 0); assert.equal(r.status, "unverified"); finiteJson(r);
});

test("missing fixed mass and reserve produce labelled lower bounds, not filled-in measurements", () => {
  const input = fixture(); input.vehicle.additional_mass_kg = missing(); input.reserve_kg = missing();
  const r = assessItinerary(input);
  assert.equal(r.minimum_initial_xenon_kg.basis, "lower_bound");
  assert.deepEqual(new Set(r.minimum_initial_xenon_kg.missing), new Set(["reserve_kg", "vehicle.additional_mass_kg"]));
  assert.equal(burns(r.minimum_loading)[0].xenon_after_kg.basis, "optimistic_projection");
  assert.equal(input.vehicle.additional_mass_kg.kind, "missing");
});

test("unknown earlier payload cannot make a conditional later duration a necessary failure", () => {
  const input = fixture(2); input.vehicle.additional_mass_kg = known(20); input.initial_xenon_kg = known(600); input.reserve_kg = known(10);
  input.stops[0].board = [{ id: "A", mass_kg: missing() }]; input.stops[1].alight = ["A"];
  input.stops[1].board = [{ id: "B", mass_kg: known(40) }];
  input.legs[1].arrive_jd = input.legs[1].depart_jd + 190000 / DAY;
  const r = assessItinerary(input);
  assert.equal(r.status, "unverified");
  assert.ok(r.findings.some((f) => f.code === "firing_exceeds_flight" && f.leg === "leg1" && f.certainty === "conditional"));
  input.stops[0].board[0].mass_kg = known(80);
  close(assessItinerary(input).declared_loading.legs[1].firing_seconds.value, 180000);
});

test("unknown future boarding cannot weaken a fully known early loaded-duration failure", () => {
  const input = fixture(2); input.initial_xenon_kg = known(300);
  input.legs[0].arrive_jd = input.legs[0].depart_jd + 180000 / DAY;
  input.legs[1].burns[0].dv_mps = 0; input.legs[1].burns[0].point = null;
  input.stops[1].board = [{ id: "future", mass_kg: missing() }];
  const r = assessItinerary(input);
  assert.ok(r.findings.some((f) => f.mode === "declared_loaded" && f.leg === "leg0" && f.code === "firing_exceeds_flight" && f.certainty === "necessary"));
  assert.equal(r.status, "infeasible");
});

test("unknown payload can relieve a refill overflow; the optimistic overflow stays conditional", () => {
  const input = fixture(2); input.vehicle.xenon_capacity_kg = 200; input.initial_xenon_kg = known(0);
  input.stops[0].refuel_kg = 150; input.stops[1].refuel_kg = 180;
  input.stops[0].board = [{ id: "A", mass_kg: missing() }]; input.stops[1].alight = ["A"];
  assert.equal(assessItinerary(input).status, "unverified");
  input.stops[0].board[0].mass_kg = known(20);
  const r = assessItinerary(input); assert.equal(r.status, "unverified");
  close(r.declared_loading.rows.find((s) => s.kind === "stop" && s.stop === 1).xenon_after_kg.value, 195);
});

test("assessment is deterministic, does not mutate frozen inputs, and never certifies a trajectory", () => {
  const input = freeze(fixture(2)), a = assessItinerary(input), b = assessItinerary(input);
  assert.deepEqual(a, b); assert.equal(a.diagnostic_only, true); assert.notEqual(a.status, "verified"); finiteJson(a);
});

test("120 deterministic multi-leg cases agree with independent integer-ratio arithmetic", () => {
  for (let sample = 0; sample < 120; sample++) {
    const input = fixture(1 + sample % 4); input.reserve_kg = known(sample % 11);
    input.vehicle.additional_mass_kg = known(sample % 17);
    const ratios = [], masses = [];
    input.legs.forEach((leg, i) => {
      const factor = 1 + (sample + i) % 3, payload = (sample * 7 + i * 13) % 91;
      ratios.push(2 ** factor); masses.push(100 + sample % 17 + payload);
      input.stops[i].board.push({ id: "load" + i, mass_kg: known(payload) });
      input.stops[i + 1].alight.push("load" + i);
      leg.burns[0].dv_mps = HALF * factor;
      if (i) input.stops[i].refuel_kg = (sample + i) % 3 ? 0 : 200;
    });
    let fuel = sample % 11;
    for (let i = ratios.length - 1; i >= 0; i--) fuel = Math.max(sample % 11, (masses[i] + fuel) * ratios[i] - masses[i] - input.stops[i].refuel_kg);
    const r = assessItinerary(input); close(r.minimum_initial_xenon_kg.value, fuel, "initial fuel, sample " + sample);
    let consumed = 0;
    for (let i = 0; i < ratios.length; i++) {
      fuel += input.stops[i].refuel_kg;
      const spent = (masses[i] + fuel) * (1 - 1 / ratios[i]);
      consumed += spent; fuel -= spent;
    }
    close(r.minimum_loading.totals.final_xenon_kg.value, fuel, "final fuel, sample " + sample);
    close(r.minimum_loading.totals.xenon_used_kg.value, consumed, "consumed, sample " + sample);
    close(r.minimum_loading.totals.firing_seconds.value, consumed * 1000, "duration, sample " + sample); finiteJson(r);
  }
});

const invalid = [
  ["negative dry mass", (x) => { x.vehicle.dry_kg = -1; }],
  ["NaN loaded fuel", (x) => { x.initial_xenon_kg = known(NaN); }],
  ["infinite extra load", (x) => { x.legs[0].burns[0].extra_load_w = known(Infinity); }],
  ["negative payload", (x) => { x.stops[0].board = [{ id: "A", mass_kg: known(-1) }]; }],
  ["zero Isp", (x) => { x.legs[0].burns[0].point.isp_s = 0; }],
  ["efficiency above one", (x) => { x.legs[0].burns[0].point.efficiency = 1.1; }],
  ["zero solar radius", (x) => { x.legs[0].burns[0].radius_au = 0; }],
  ["negative refill", (x) => { x.stops[0].refuel_kg = -1; }],
  ["arrival before departure", (x) => { x.legs[0].arrive_jd = 999; }],
  ["wrong endpoint", (x) => { x.stops[1].at = "elsewhere"; }],
  ["missing stop", (x) => { x.stops.pop(); }],
  ["unloading absent payload", (x) => { x.stops[0].alight = ["absent"]; }],
  ["duplicate boarding", (x) => { x.stops[0].board = [{ id: "A", mass_kg: known(1) }, { id: "A", mass_kg: known(1) }]; }],
  ["unmarked zero-burn point", (x) => { x.legs[0].burns[1].point = point(); }],
  ["missing operating point", (x) => { x.legs[0].burns[0].point = null; }],
];
for (const [name, change] of invalid) test("rejects " + name, () => {
  const input = fixture(); change(input); assert.throws(() => assessItinerary(input), TypeError);
});
test("rejects overlapping legs and duplicate leg identities", () => {
  const input = fixture(2); input.legs[1].depart_jd = input.legs[0].arrive_jd - 1;
  assert.throws(() => assessItinerary(input), /overlaps/);
  input.legs[1].depart_jd = 1200; input.legs[1].id = input.legs[0].id;
  assert.throws(() => assessItinerary(input), /duplicate leg/);
});
test("unrepresentable exponential or aggregate budgets throw instead of returning Infinity/null", () => {
  const input = fixture(); input.legs[0].burns[0].dv_mps = 1e308;
  assert.throws(() => assessItinerary(input), RangeError);
  const flight = fixture(); flight.legs[0].arrive_jd = 1e308;
  assert.throws(() => assessItinerary(flight), RangeError);
});

const E = createRequire(import.meta.url)("../../world/engine/sol-page.js");
function realCase(from = "iss", to = "ceres-port", ship = "sf-01") {
  return { id: "real-plan", ship, stops: [{ at: from }, { at: to }],
    plans: [E.R.planLeg(from, to, 2461700.5, "energy", 2468328.5, ship)] };
}
test("real SF-01 Ceres plan preserves exact delta-v and detects unsupported arrival power", () => {
  const request = realCase(), input = adaptFullPlans(E, request), r = assessItinerary(input);
  close(input.legs[0].burns[0].dv_mps, request.plans[0].dv_dep_kms * 1000);
  close(input.legs[0].burns[1].dv_mps, request.plans[0].dv_arr_kms * 1000);
  const f = failure(r, "thruster_power"); assert.equal(f.phase, "capture");
  close(f.generator_w, 1189.8987169547763); assert.equal(f.selected_thruster_w, 2310);
});
test("real SF-01 Titan case fails power even though its minimum firing fits flight time", () => {
  const r = assessItinerary(adaptFullPlans(E, realCase("iss", "titan")));
  assert.ok(failure(r, "thruster_power")); assert.ok(!failure(r, "minimum_firing_exceeds_flight"));
});
test("real multi-leg SF-04 ISS booking catches fuel carried for the second leg", () => {
  const pickup = E.R.planLeg("ceres", "iss", 2461700.5, "energy", 2468328.5, "sf-04");
  const ride = E.R.planLeg("iss", "lunar-data-center", pickup.arr_jd + E.R.DWELL, "energy", 2468328.5, "sf-04");
  const r = assessItinerary(adaptFullPlans(E, { id: "real-shared-mass", ship: "sf-04",
    stops: [{ at: "ceres" }, { at: "iss", board: ["iss-crew"] }, { at: "lunar-data-center", alight: ["iss-crew"] }], plans: [pickup, ride] }));
  close(r.minimum_initial_xenon_kg.value, 1100.2059420302357);
  assert.ok(failure(r, "minimum_tank_capacity"));
});
test("adapter keeps all five reference throttle points informational and never changes the quote", () => {
  const request = realCase(); request.declarations = { power_loads_w: [{ departure: known(0), capture: known(0) }] };
  const original = structuredClone(request), input = adaptFullPlans(E, freeze(request)), r = assessItinerary(input);
  assert.deepEqual(r.operating_point_alternatives[0].supported_points.map((p) => p.power_w), [2310, 2060, 1480, 1000, 490]);
  assert.deepEqual(r.operating_point_alternatives[1].supported_points.map((p) => p.power_w), [1000, 490]);
  assert.equal(input.legs[0].burns[1].point.power_w, 2310); assert.deepEqual(request, original);
});
test("adapter rejects slim records, class mismatch and rounded or inconsistent burn totals", () => {
  assert.throws(() => adaptFullPlans(E, { id: "slim", ship: "sf-01", stops: [{ at: "iss" }, { at: "ceres-port" }], plans: [{ from: "iss", to: "ceres-port", dv: 12.61 }] }), /full place endpoints/);
  const mismatch = realCase(); mismatch.ship = "sf-03"; assert.throws(() => adaptFullPlans(E, mismatch), /ship class/);
  const rounded = structuredClone(realCase()); rounded.plans[0].dv_total_kms = 12.61;
  assert.throws(() => adaptFullPlans(E, rounded), /total delta-v/);
});
test("adapter rejects unknown declaration keys and out-of-range refuelling stops", () => {
  const request = realCase(); request.declarations = { passenger_kilos: known(80) };
  assert.throws(() => adaptFullPlans(E, request), /unknown declaration/);
  request.declarations = { refuel_kg_by_stop: { 4: 1 } };
  assert.throws(() => adaptFullPlans(E, request), /invalid refuelling stop/);
});
test("adapter never mistakes malformed or mistyped load declarations for an empty declaration", () => {
  const request = realCase(); request.declarations = { power_loads_w: [{ arrival: known(0) }] };
  assert.throws(() => adaptFullPlans(E, request), /unknown burn phase/);
  request.declarations = { power_loads_w: [] };
  assert.throws(() => adaptFullPlans(E, request), /one entry per full plan/);
  request.declarations = { payload_mass_kg: [] };
  assert.throws(() => adaptFullPlans(E, request), /must be an object/);
});
test("fleet capacity never supplies a fictitious initial loaded inventory", () => {
  const input = adaptFullPlans(E, realCase());
  assert.equal(input.initial_xenon_kg.kind, "missing");
  assert.equal(assessItinerary(input).declared_loading, null);
});
test("no-capture plans retain an explicit unpriced-arrival limitation", () => {
  const request = realCase(); request.plans[0] = E.planRide({ place: "iss" }, "ceres-port", {
    depFrom: 2461700.5, depTo: 2461820.5, arriveBy: 2468328.5, arrive: "none", ship: E.SHIP_CLASSES.dawn });
  const r = assessItinerary(adaptFullPlans(E, request));
  assert.ok(r.limitations.some((s) => s.includes("arrival capture is unpriced")));
});
test("diagnostic verification leaves the runtime engine source, copy and suite contract unchanged", () => {
  const src = readFileSync(new URL("../../world/engine/sol-page.js", import.meta.url));
  const copy = readFileSync(new URL("../src/engine/sol-page.cjs", import.meta.url));
  const meta = JSON.parse(readFileSync(new URL("../src/engine/meta.json", import.meta.url)));
  const suite = JSON.parse(readFileSync(new URL("../src/suites/v1.json", import.meta.url)));
  assert.ok(src.equals(copy)); const sha = createHash("sha256").update(src).digest("hex");
  assert.equal(sha, "e4e52be7107a804187fc95560d294bd4b4f7d8a16f3c82b368e8e5c7d33dc938");
  assert.equal(sha, meta.sha256); assert.equal(sha, suite.engine_sha256); assert.equal(suite.score_version, 4);
});
