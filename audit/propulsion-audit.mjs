// Read-only audit of the existing model, not a finite-thrust trajectory solver.
// Only this report's optional --out file is written. No engine/suite rebuilds.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const E = createRequire(import.meta.url)("../world/engine/sol-page.js");
const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("world/engine/sol-page.js", root));
const copy = readFileSync(new URL("connector/src/engine/sol-page.cjs", root));
const sha = createHash("sha256").update(source).digest("hex");
const meta = JSON.parse(readFileSync(new URL("connector/src/engine/meta.json", root)));
const suite = JSON.parse(readFileSync(new URL("connector/src/suites/v1.json", root)));
if (!source.equals(copy) || sha !== meta.sha256 || sha !== suite.engine_sha256)
  throw new Error("Engine source, connector copy, metadata and suite must agree");

const DAY = 86400, AU = E.R.AU_KM;
const epochs = [2461700.5, 2464200.5, 2466700.5];
const endJd = 2468328.5;
// One car per distinct active propulsion class. This is a leg capability audit,
// not an assertion that these cars are near, free, or dispatched on these routes.
const ships = ["sf-01", "sf-03", "sf-07"];
const norm = (r) => Math.hypot(...r);
function spare(spec, r) {
  return spec.power_w_1au / (spec.power_mode === "constant" ? 1 : r * r) - spec.housekeeping_w;
}
function measure(from, to, ship, requestJd) {
  const spec = E.SHIP_CLASSES[E.R.CAR[ship].ship_class];
  const b = E.R.planLeg(from, to, requestJd, "energy", endJd, ship);
  const a = b.battery, burns = b.dv_total_kms > 1e-9, ve = a.isp_s * E.G0;
  const thrust = burns ? 2 * a.eff * a.set_point_w / ve : 0;
  const flow = burns ? thrust / ve : 0;
  const poweredDays = burns ? a.energy_kwh_exact * 3.6e6 / a.set_point_w / DAY : 0;
  const massFlowDays = burns ? a.propellant_kg_exact / flow / DAY : 0;
  if (![poweredDays, massFlowDays, a.energy_kwh_exact, a.propellant_kg_exact].every(Number.isFinite))
    throw new Error("Audit measurement is not finite");
  const arrivalR = norm(E.placeState(to, b.arr_jd).r) / AU;
  const arrivalPoint = E.thrustPoint(spec, arrivalR);
  return {
    from, to, ship, class_id: spec.id, request_jd: requestJd,
    dep_jd: b.dep_jd, arr_jd: b.arr_jd, local: b.local,
    flight_days: b.tof_days, wait_days: b.wait_days,
    dv_dep_kms: b.dv_dep_kms, dv_arr_kms: b.dv_arr_kms,
    dv_total_kms: b.dv_total_kms,
    energy_kwh: a.energy_kwh_exact, xenon_kg: a.propellant_kg_exact,
    selected_power_w: a.set_point_w, isp_s: a.isp_s ?? null, efficiency: a.eff ?? null,
    inferred_thrust_n: thrust, inferred_flow_kg_s: flow,
    powered_days_at_selected_point: poweredDays,
    powered_days_via_mass_flow: massFlowDays,
    burn_duration_calculations_agree: Math.abs(poweredDays - massFlowDays) < 1e-8,
    powered_to_flight_ratio: b.tof_days > 0 ? poweredDays / b.tof_days : 0,
    selected_point_firing_exceeds_flight: poweredDays > b.tof_days,
    departure_r_au: b.r_au, arrival_r_au: arrivalR,
    arrival_spare_w: spare(spec, arrivalR),
    arrival_supported_point_w: arrivalPoint?.power_w ?? null,
    arrival_cannot_supply_selected_point: spare(spec, arrivalR) < a.set_point_w,
  };
}
function refusal(error) {
  if (!/cannot thrust|xenon tank|no ride found|no route|arrival limit|would arrive|no time|no xenon/.test(error.message)) throw error;
  return error.message;
}

const rows = [];
for (const jd of epochs) for (const hail of E.R.HAILS) for (const ship of ships) {
  try { rows.push({ hail: hail.id, accepted: true, ...measure(hail.from, hail.to, ship, jd) }); }
  catch (error) { rows.push({ hail: hail.id, ship, request_jd: jd, accepted: false, reason: refusal(error) }); }
}

const manifests = E.R.HAILS.flatMap((hail) => E.R.FLEET.map((car) => [hail.id, car.id])).map(([id, ship]) => {
  const hail = E.R.BY[id], car = E.R.CAR[ship], spec = E.SHIP_CLASSES[car.ship_class];
  try {
    const pickup = measure(car.at, hail.from, ship, epochs[0]);
    const ride = measure(hail.from, hail.to, ship, pickup.arr_jd + E.R.DWELL);
    let mass = spec.dry_kg;
    const backwardLegs = [ride, pickup].map((leg) => {
      const fuel = leg.dv_total_kms > 1e-9 ? mass * Math.expm1(leg.dv_total_kms * 1000 / (leg.isp_s * E.G0)) : 0;
      mass += fuel;
      return { from: leg.from, to: leg.to, xenon_kg: fuel };
    }).reverse();
    const quoted = pickup.xenon_kg + ride.xenon_kg, carried = mass - spec.dry_kg;
    return { hail: id, ship, accepted: true,
      assumption: "Minimum starting fuel, fixed per-leg Isp, no refuel, dry final mass; excludes passenger/habitat/hydrazine/reserve mass",
      plan_check_without_busy_time: E.R.check(id, ship, [pickup, ride]),
      quoted_sum_xenon_kg: quoted, carried_fuel_xenon_kg: carried,
      undercount_kg: carried - quoted, tank_capacity_kg: spec.xenon_kg,
      quoted_fits_tank: quoted <= spec.xenon_kg, carried_fuel_fits_tank: carried <= spec.xenon_kg,
      backward_legs: backwardLegs,
    };
  } catch (error) { return { hail: id, ship, accepted: false, reason: refusal(error) }; }
});

const endpointPowerProbes = ["ceres-port", "titan"].map((to) => measure("iss", to, "sf-01", epochs[0]));
const reflyCandidate = E.R.planLeg("iss", "ceres-port", epochs[0], "energy", endJd, "sf-01");
const { seconds: ignoredTiming, ...gravityCheck } = E.refly(reflyCandidate);

// Published Table 1 of NASA/CR-1999-209162, PDF p26 (printed p18).
const publishedPoints = [
  { power_w: 2310, isp_s: 3280, efficiency: 0.64, thrust_mn: 92 },
  { power_w: 2060, isp_s: 3190, efficiency: 0.63, thrust_mn: 83 },
  { power_w: 1480, isp_s: 3180, efficiency: 0.61, thrust_mn: 58 },
  { power_w: 1000, isp_s: 2700, efficiency: 0.53, thrust_mn: 40 },
  { power_w: 490, isp_s: 1950, efficiency: 0.38, thrust_mn: 19.5 },
];
const accepted = rows.filter((row) => row.accepted);
const report = {
  format: "starfare.propulsion-audit/1", baseline_commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(),
  engine_sha256: sha, score_version: suite.score_version,
  method: "45 deterministic single-leg probes: five canonical passenger routes, three distinct active hull classes, three request epochs; energy objective, same arrival limit. Existing power/tank refusals are retained. No hazard runs, hidden tasks or benchmarks.",
  limitations: [
    "E/P and propellant/mass-flow measure firing duration for the quoted fixed operating point and impulsive delta-v, not an optimized low-thrust flight.",
    "Firing within the flight time would be necessary under that model, not sufficient for the scheduled endpoint maneuvers or rendezvous.",
    "A different trajectory or throttle history can have different delta-v, power and travel time. Refused rows have not been assigned a firing duration.",
    "Backward mass accounting is a comparison calculation only; no runtime pricing or dispatch checks are changed.",
  ],
  epochs: epochs.map((jd) => ({ jd, date: E.isoFromJd(jd) })), end_jd: endJd,
  summary: { probes: rows.length, accepted: accepted.length, refused: rows.length - accepted.length,
    firing_exceeds_flight: accepted.filter((row) => row.selected_point_firing_exceeds_flight).length,
    duration_calculations_agree: accepted.every((row) => row.burn_duration_calculations_agree),
    minimum_firing_to_flight_ratio: Math.min(...accepted.map((row) => row.powered_to_flight_ratio)),
    maximum_firing_to_flight_ratio: Math.max(...accepted.map((row) => row.powered_to_flight_ratio)),
    arrival_point_unsupported: accepted.filter((row) => row.arrival_cannot_supply_selected_point).length,
  },
  rows, manifests, endpoint_power_probes: endpointPowerProbes,
  gravity_check: { from: "iss", to: "ceres-port", ship: "sf-01", result: gravityCheck,
    limitation: "This is the existing gravitational re-flight; it has no thrust/power/propellant control inputs and is not a propulsion certificate" },
  throttle_table: { source: "https://ntrs.nasa.gov/api/citations/20000003023/downloads/20000003023.pdf#page=26", publishedPoints,
    ds1_at_1au: { available_w: spare(E.SHIP_CLASSES.ds1, 1), engine_selected_w: E.thrustPoint(E.SHIP_CLASSES.ds1, 1).power_w, published_supported_w: 2060 } },
  hold_budget: { simulated_hold_kwh_per_hour: E.R.HOLD_KWH, implied_w: E.R.HOLD_KWH * 1000,
    rtg_generator_w: E.SHIP_CLASSES.rtg.power_w_1au,
    one_hour_hold_generator_days: E.R.HOLD_KWH / (E.SHIP_CLASSES.rtg.power_w_1au / 1000) / 24,
    interpretation: "Gameplay energy penalty; no storage model, physical maneuver or resource budget establishes this supply" },
};
const outIndex = process.argv.indexOf("--out");
if (outIndex >= 0) {
  if (!process.argv[outIndex + 1]) throw new Error("--out requires a filename");
  writeFileSync(process.argv[outIndex + 1], JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ ...report.summary,
    manifest_probes: manifests.length,
    manifest_legs_accepted: manifests.filter((m) => m.accepted).length,
    tank_false_acceptances: manifests.filter((m) => m.accepted && m.quoted_fits_tank && !m.carried_fuel_fits_tank),
    endpoint_power_probes: endpointPowerProbes, gravity_check: report.gravity_check,
    throttle_table: report.throttle_table.ds1_at_1au, hold_budget: report.hold_budget }, null, 2) + "\n");
} else process.stdout.write(JSON.stringify(report, null, 2) + "\n");
