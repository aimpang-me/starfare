// Offline geometry export + numerical evaluation. No fleet or runtime mutation.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { OPTION_B } from "./option-b-spec.mjs";
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!["--python", "--out"].includes(args[i]) || !args[i + 1]) throw new Error("Use --python <executable> and/or --out <json path>");
  options[args[i]] = args[i + 1];
}
const E = createRequire(import.meta.url)("../world/engine/sol-page.js");
const places = Object.fromEntries(E.PLACES.map((p) => [p.id, p]));
const pairs = [["earth", "orbital-depot"], ["mars", "mars-base"], ["ceres", "ceres-port"]].map(([body, station]) => {
  const p = places[body], s = places[station];
  if (s.parent !== body || s.incl_deg !== 0) throw new Error("This study only supports coplanar same-primary stations");
  return { primary: body, primary_name: p.name, station, station_name: s.name,
    mu_km3_s2: p.mu, body_radius_km: p.radius_km,
    parking_radius_km: p.radius_km + p.park_alt_km, station_radius_km: p.radius_km + s.park_alt_km };
});
const input = { chemical: OPTION_B, pairs, final_masses_kg: [500, 1000, 2000], epoch_jd: 2461700.5,
  source_engine_sha256: createHash("sha256").update(readFileSync(new URL("../world/engine/sol-page.js", import.meta.url))).digest("hex") };
const childStarted = new Date().toISOString();
const child = spawnSync(options["--python"] ?? process.env.STARFARE_EVAL_PYTHON ?? "python",
  [fileURLToPath(new URL("./option-b-local.py", import.meta.url))],
  { input: JSON.stringify(input), encoding: "utf8", windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
if (child.error || child.status !== 0) throw new Error(String(child.error ?? child.stderr ?? "Numerical evaluation failed"));
const report = JSON.parse(child.stdout);
// Compare the independent Cartesian terminal state against the engine's actual
// named station state at the rounded Julian arrival, including its plane/phase.
const subtract = (a, b) => a.map((x, i) => x - b[i]);
for (const row of report.rows.filter((r) => r.status === "accepted_within_model" && r.scope.startsWith("model_station"))) {
  const p = pairs.find((p) => p.primary === row.input.primary), epoch = input.epoch_jd;
  const station = E.placeState(p.station, epoch), primary = E.placeState(p.primary, epoch);
  const r = subtract(station.r, primary.r), v = subtract(station.v, primary.v);
  const ru = r.map((x) => x / Math.hypot(...r)), vu = v.map((x) => x / Math.hypot(...v));
  const n = Math.sqrt(p.mu_km3_s2 / p.station_radius_km ** 3);
  const theta = (n * ((epoch - 2451545) * 86400)) % (2 * Math.PI), c = Math.cos(theta), s = Math.sin(theta);
  const P = ru.map((x, i) => x * c - vu[i] * s), Q = ru.map((x, i) => x * s + vu[i] * c);
  const phi = row.departure_phase_rad, cp = Math.cos(phi), sp = Math.sin(phi), y = row.terminal_cartesian_unrotated;
  const global = (a, b) => P.map((x, i) => x * (cp * a - sp * b) + Q[i] * (sp * a + cp * b));
  const jd = epoch + row.flight_seconds / 86400, target = E.placeState(p.station, jd), body = E.placeState(p.primary, jd);
  row.evidence.engine_station_position_error_m = Math.hypot(...subtract(global(y[0], y[1]), subtract(target.r, body.r))) * 1000;
  row.evidence.engine_station_velocity_error_m_s = Math.hypot(...subtract(global(y[2], y[3]), subtract(target.v, body.v))) * 1000;
  if (row.evidence.engine_station_position_error_m > report.numerics.acceptance_limits.arrival_position_m
      || row.evidence.engine_station_velocity_error_m_s > report.numerics.acceptance_limits.arrival_velocity_m_s)
    row.status = "unresolved_engine_station_match";
}
report.summary.accepted = report.rows.filter((r) => r.status === "accepted_within_model").length;
report.process = { node_pid: process.pid, python_pid: child.pid, child_started_utc: childStarted,
  child_exit_code: child.status, completed_utc: new Date().toISOString() };
if (options["--out"]) writeFileSync(options["--out"], JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ summary: report.summary, rows: report.rows.filter((r) => r.final_nonburned_mass_kg === 1000)
  .map((r) => ({ route: r.route, scope: r.scope, status: r.status, flight_minutes: r.flight_seconds / 60,
    propellant_kg: r.propellant_kg, firing_minutes: r.firing_seconds / 60, evidence: r.evidence })), process: report.process }, null, 2));
if (report.summary.accepted !== report.summary.requested) process.exitCode = 1;
