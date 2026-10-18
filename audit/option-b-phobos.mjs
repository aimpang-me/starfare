// Offline Mars–Phobos flight study. Does not alter the live place/fleet model.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { OPTION_B } from "./option-b-spec.mjs";
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!["--out", "--python", "--mass"].includes(args[i]) || !args[i + 1]) throw new Error("Use --out <json>, --python <executable>, --mass <500|1000|2000>");
  options[args[i]] = args[i + 1];
}
const E = createRequire(import.meta.url)("../world/engine/sol-page.js");
const place = (id) => E.PLACES.find((p) => p.id === id);
const mars = place("mars"), phobos = place("phobos"), base = place("mars-base");
if (base.parent !== mars.id || base.incl_deg !== 0 || phobos.parent !== mars.id) throw new Error("Study requires the existing coplanar Mars endpoints");
const masses = options["--mass"] ? [Number(options["--mass"])] : [500, 1000, 2000];
if (!masses.every((x) => [500, 1000, 2000].includes(x))) throw new Error("Unsupported comparison mass");
const input = { chemical: OPTION_B, mars, phobos, base, masses_kg: masses, epoch_jd: 2461700.5,
  collision_envelope_km: 13.5,
  shape_source: "https://www.jpl.nasa.gov/images/pia04589-phobos-over-the-martian-limb/",
  sources: [
    { kind: "instantaneous_staging_reference", radius_from_phobos_km: phobos.radius_km + phobos.park_alt_km,
      motion: "local_circular", lift_seconds: 0, wait_support: "state supplied at launch; access and holding not established" },
    { kind: "proposed_surface_pad", radius_from_phobos_km: 13.501, motion: "body_corotation", lift_seconds: 20,
      wait_support: "supported on a proposed synchronous anti-Mars facility; not a real landing-site design" },
  ], source_engine_sha256: createHash("sha256").update(readFileSync(new URL("../world/engine/sol-page.js", import.meta.url))).digest("hex") };
const started = new Date().toISOString();
const child = spawnSync(options["--python"] ?? process.env.STARFARE_EVAL_PYTHON ?? "python",
  [fileURLToPath(new URL("./option-b-phobos.py", import.meta.url))],
  { input: JSON.stringify(input), encoding: "utf8", windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
if (child.error || child.status !== 0) throw new Error(String(child.error ?? child.stderr));
const report = JSON.parse(child.stdout), sub = (a, b) => a.map((x, i) => x - b[i]);
const t0 = input.epoch_jd, b0 = E.placeState(base.id, t0), m0 = E.placeState(mars.id, t0);
const br = sub(b0.r, m0.r), bv = sub(b0.v, m0.v), ru = br.map((x) => x / Math.hypot(...br)), vu = bv.map((x) => x / Math.hypot(...bv));
const n = Math.sqrt(mars.mu / (mars.radius_km + base.park_alt_km) ** 3), theta = (n * ((t0 - 2451545) * 86400)) % (2 * Math.PI);
const P = ru.map((x, i) => x * Math.cos(theta) - vu[i] * Math.sin(theta));
const Q = ru.map((x, i) => x * Math.sin(theta) + vu[i] * Math.cos(theta));
const global = (xy) => P.map((x, i) => x * xy[0] + Q[i] * xy[1]);
for (const row of report.rows.filter((r) => r.status === "accepted_within_model")) {
  const jd = t0 + (row.launch_wait_seconds + row.flight_seconds) / 86400;
  const target = E.placeState(base.id, jd), primary = E.placeState(mars.id, jd), y = row.actual_epoch_terminal_state;
  row.evidence.engine_station_position_error_m = Math.hypot(...sub(global(y.slice(0, 2)), sub(target.r, primary.r))) * 1000;
  row.evidence.engine_station_velocity_error_m_s = Math.hypot(...sub(global(y.slice(2, 4)), sub(target.v, primary.v))) * 1000;
  if (row.evidence.engine_station_position_error_m > report.acceptance_limits.arrival_position_m
      || row.evidence.engine_station_velocity_error_m_s > report.acceptance_limits.arrival_velocity_m_s)
    row.status = "unresolved_engine_station_match";
}
report.summary.accepted = report.rows.filter((r) => r.status === "accepted_within_model").length;
report.process = { node_pid: process.pid, python_pid: child.pid, child_started_utc: started,
  child_exit_code: child.status, completed_utc: new Date().toISOString() };
if (options["--out"]) writeFileSync(options["--out"], JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ summary: report.summary, rows: report.rows.map((r) => ({ source: r.source.kind,
  final_mass_kg: r.final_nonburned_mass_kg, status: r.status, flight_minutes: r.flight_seconds / 60,
  launch_wait_minutes: r.launch_wait_seconds / 60, propellant_kg: r.propellant_kg,
  firing_minutes: r.firing_seconds / 60,
  station_position_error_m: r.evidence?.engine_station_position_error_m,
  minimum_phobos_envelope_clearance_km: r.evidence?.minimum_phobos_envelope_clearance_km })), process: report.process }, null, 2));
if (report.summary.accepted !== report.summary.requested) process.exitCode = 1;
