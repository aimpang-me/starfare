// Offline three-dimensional lunar study. No production fleet or planner edits.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { OPTION_B } from "./option-b-spec.mjs";
const options = {}, args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  if (!["--out", "--python", "--mass", "--flight-days", "--budget-seconds", "--candidates", "--mode", "--resume", "--case"].includes(args[i]) || !args[i + 1]) throw new Error("Unknown or incomplete study option");
  options[args[i]] = args[i + 1];
}
const E = createRequire(import.meta.url)("../world/engine/sol-page.js");
const epoch = 2461700.5, sub = (a, b) => a.map((x, i) => x - b[i]);
let selectedCase, fixture;
if (options["--case"]) {
  fixture = JSON.parse(readFileSync(new URL("./option-b-lunar-cases.json", import.meta.url), "utf8"));
  selectedCase = fixture.cases[options["--case"]];
  if (!selectedCase || options["--resume"]) throw new Error("Unknown case or conflicting resume source");
  for (const [flag, value] of [["--mass", selectedCase.final_nonburned_mass_kg], ["--flight-days", selectedCase.search_center_days]]) {
    if (options[flag] && Number(options[flag]) !== value) throw new Error("Case boundary mismatch: " + flag);
    options[flag] = String(value);
  }
}
const places = Object.fromEntries(E.PLACES.map((p) => [p.id, p]));
function orbit(id) {
  const p = places[id], body = places[p.parent], a = body.radius_km + p.park_alt_km, n = Math.sqrt(body.mu / a ** 3);
  const s = E.placeState(id, epoch), b = E.placeState(p.parent, epoch), r = sub(s.r, b.r), v = sub(s.v, b.v);
  const ru = r.map((x) => x / Math.hypot(...r)), vu = v.map((x) => x / Math.hypot(...v));
  const angle = (n * ((epoch - 2451545) * 86400)) % (2 * Math.PI), c = Math.cos(angle), z = Math.sin(angle);
  return { id, radius_km: a, n, phase_at_epoch: angle, P: ru.map((x, i) => x * c - vu[i] * z), Q: ru.map((x, i) => x * z + vu[i] * c) };
}
const input = { chemical: OPTION_B, epoch_jd: epoch, source: orbit("iss"), target: orbit("lunar-data-center"),
  earth: places.earth, moon: places.moon, mu_sun: 1.32712440041279419e11,
  ephemeris: JSON.parse(readFileSync(new URL("../world/engine/ephem.json", import.meta.url), "utf8")),
  mass_kg: Number(options["--mass"] ?? 500), flight_days: Number(options["--flight-days"] ?? 5),
  budget_seconds: Number(options["--budget-seconds"] ?? 240), retained_candidates: Number(options["--candidates"] ?? 3),
  mode: options["--mode"] ?? "study",
  launch_window_days: 30, launch_grid_seconds: 1800, launch_correction_limit_seconds: 21600,
  source_engine_sha256: createHash("sha256").update(readFileSync(new URL("../world/engine/sol-page.js", import.meta.url))).digest("hex") };
input.evaluation_sources = Object.fromEntries(["option-b-lunar.mjs", "option-b-lunar.py", "lunar_ephemeris.py", "option-b-spec.mjs", "../world/engine/ephem.json"].map(path =>
  [path, createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex")]));
for (const [key, value] of Object.entries(input).filter(([, v]) => typeof v === "number")) if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid " + key);
if (![500, 1000, 2000].includes(input.mass_kg) || ![3, 5, 7].includes(input.flight_days)
    || !Number.isInteger(input.retained_candidates) || input.retained_candidates > 4 || !["study", "ephemeris", "rank"].includes(input.mode))
  throw new Error("Unsupported study grid or mode");
if (selectedCase) {
  if (fixture.source_engine_sha256 !== input.source_engine_sha256 || fixture.epoch_jd !== epoch
    || ["total_thrust_n", "isp_s", "oxidizer_to_fuel_mass_ratio"].some(k => fixture.chemical[k] !== OPTION_B[k]))
    throw new Error("Saved case model boundary mismatch");
  input.resume = { controls: selectedCase.controls, mass_kg: input.mass_kg, perturbation_factor: 1,
    nominal_wait_seconds: selectedCase.nominal_wait_seconds, case: options["--case"] };
}
if (options["--resume"]) {
  const bytes = readFileSync(options["--resume"]), previous = JSON.parse(bytes);
  if (previous.source_engine_sha256 !== input.source_engine_sha256 || previous.requested_flight_days !== input.flight_days || previous.epoch_jd !== epoch)
    throw new Error("Resume study boundary mismatch");
  const matched = s => s.mass_kg <= input.mass_kg && s.max_scaled_match_residual < 1e-6 && s.controls;
  const attempt = previous.attempts.find(a => a.history?.some(matched));
  const stage = attempt?.history.filter(matched).sort((a,b)=>b.perturbation_factor-a.perturbation_factor || b.mass_kg-a.mass_kg)[0];
  if (!stage) throw new Error("No numerically matched continuation checkpoint");
  input.resume = { controls: stage.controls, mass_kg: stage.mass_kg, perturbation_factor: stage.perturbation_factor,
    nominal_wait_seconds: attempt.nominal_wait_seconds ?? attempt.launch_wait_seconds, source_sha256: createHash("sha256").update(bytes).digest("hex") };
}
const started = new Date().toISOString();
if (options["--out"]) writeFileSync(options["--out"] + ".progress.log", "");
console.error(JSON.stringify({ event: "owner", owner: "Engineering", purpose: "Option B lunar evaluation", node_pid: process.pid, started_utc: started }));
const child = spawn(options["--python"] ?? process.env.STARFARE_EVAL_PYTHON ?? "python",
  [fileURLToPath(new URL("./option-b-lunar.py", import.meta.url))],
  { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
const childStarted = new Date().toISOString();
console.error(JSON.stringify({ event: "child", owner: "Engineering", python_pid: child.pid, started_utc: childStarted }));
const chunks = [];
child.stdout.on("data", (c) => chunks.push(c));
child.stderr.pipe(process.stderr);
if (options["--out"]) child.stderr.on("data", (c) => appendFileSync(options["--out"] + ".progress.log", c));
child.stdin.end(JSON.stringify(input));
const watchdog = setTimeout(() => {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else child.kill("SIGTERM");
}, (input.budget_seconds + 90) * 1000);
const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(watchdog));
if (code !== 0) throw new Error("Numerical evaluator exited " + code);
const report = JSON.parse(Buffer.concat(chunks).toString("utf8"));
let maxPosition = 0, maxVelocity = 0, maxMoon = 0, maxSun = 0;
for (const p of report.ephemeris_probes) {
  const jd = epoch + p.offset_seconds / 86400, earth = E.placeState("earth", jd), moon = E.placeState("moon", jd);
  maxMoon = Math.max(maxMoon, Math.hypot(...sub(p.moon_r, sub(moon.r, earth.r))));
  maxSun = Math.max(maxSun, Math.hypot(...p.sun_r.map((x, i) => x + earth.r[i])));
  maxPosition = Math.max(maxMoon, maxSun);
  maxVelocity = Math.max(maxVelocity, Math.hypot(...sub(p.moon_v, sub(moon.v, earth.v))), Math.hypot(...p.sun_v.map((x, i) => x + earth.v[i])));
}
report.engine_ephemeris_parity = { probes: report.ephemeris_probes.length, max_position_error_m: maxPosition * 1000,
  max_moon_position_error_m: maxMoon * 1000, max_sun_position_error_m: maxSun * 1000, max_velocity_error_m_s: maxVelocity * 1000 };
if (maxPosition > .001 || maxVelocity > .00001) {
  report.status = "unresolved_ephemeris_parity";
  for (const attempt of report.attempts.filter(a=>a.status === "verified_numerical_rendezvous")) attempt.status = "unresolved_ephemeris_parity";
}
for (const attempt of report.attempts.filter(a => a.status === "verified_numerical_rendezvous")) {
  const launchJD = epoch + attempt.launch_wait_seconds / 86400, arrivalJD = launchJD + attempt.flight_seconds / 86400;
  const relative = (id, jd) => { const s = E.placeState(id, jd), e = E.placeState("earth", jd); return [...sub(s.r, e.r), ...sub(s.v, e.v)]; };
  const error = (a,b) => ({ position_m: Math.hypot(...sub(a.slice(0,3),b.slice(0,3))) * 1000, velocity_m_s: Math.hypot(...sub(a.slice(3,6),b.slice(3,6))) * 1000 });
  const source = error(attempt.source_state, relative("iss",launchJD)), target = error(attempt.arrival_target_state, relative("lunar-data-center",arrivalJD));
  const arrival = error(attempt.arrival_state, relative("lunar-data-center",arrivalJD));
  attempt.engine_endpoint_gate = { launch_jd: launchJD, arrival_jd: arrivalJD, source_reconstruction: source, target_reconstruction: target, forward_arrival: arrival };
  if (source.position_m > 1 || target.position_m > 1 || source.velocity_m_s > .01 || target.velocity_m_s > .01 || arrival.position_m > 10 || arrival.velocity_m_s > .01) {
    attempt.status = "unresolved_engine_endpoint_gate";
    report.status = "unresolved_engine_endpoint_gate";
  }
}
report.process = { node_pid: process.pid, python_pid: child.pid, child_started_utc: childStarted, child_exit_code: code, completed_utc: new Date().toISOString() };
if (options["--out"]) writeFileSync(options["--out"], JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ status: report.status, final_mass_kg: input.mass_kg, flight_days: input.flight_days,
  attempts: report.attempts.map(a=>({status:a.status, launch_wait_seconds:a.launch_wait_seconds,
    flight_seconds:a.flight_seconds, chemical_propellant_kg:a.chemical_propellant_kg,
    forward_replays:a.forward_replays, engine_endpoint_gate:a.engine_endpoint_gate,
    last_stage:a.history?.at(-1)})), engine_ephemeris_parity: report.engine_ephemeris_parity, process: report.process }, null, 2));
