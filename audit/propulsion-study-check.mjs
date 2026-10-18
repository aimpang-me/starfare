// Replays public offline sizing evidence. No server, key, fleet mutation or app tests.
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const load = p => JSON.parse(readFileSync(resolve(root, p), "utf8"));
const hash = p => createHash("sha256").update(readFileSync(resolve(root, p))).digest("hex");
const baseline = load("audit/propulsion-study-baselines.json");
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--out")) throw new Error("Use --out <summary.json>");
const output = args[1];
const started = new Date();
const evidenceDir = "connector/.wrangler/propulsion-handoff-check/" + started.toISOString().replace(/[:.]/g, "-");
mkdirSync(resolve(root, evidenceDir), {recursive: true});
const commands = [];
const requireCheck = (ok, label) => { if (!ok) throw new Error("Offline numerical check failed: " + label); };
function run(name, options) {
  const out = evidenceDir + "/" + name + ".json";
  const command = ["audit/option-b-ship-budget.mjs", ...options, "--out", out];
  const begin = performance.now();
  execFileSync(process.execPath, command, {cwd: root, stdio: ["ignore", "pipe", "pipe"], timeout: 120000});
  commands.push({command: ["node", ...command], exit_code: 0, elapsed_ms: performance.now() - begin});
  return load(out);
}
function numericRows(value, path = "", entries = []) {
  if (typeof value === "number") entries.push([path, value]);
  else if (value && typeof value === "object") for (const key of Object.keys(value).sort()) {
    // Original mission snapshots predate phase metadata. Their mass/engine
    // invariants are checked separately by the owning sizing command.
    if (key !== "mission") numericRows(value[key], path + "." + key, entries);
  }
  return entries;
}
const compatibility = [];
const feedArgs = ["--feed-proposal", "audit/option-b-feed-proposal.json"];
const thermalArgs = [...feedArgs, "--thermal-proposal", "audit/option-b-thermal-proposal.json"];
for (const [name, options] of [["original", []], ["feed", feedArgs], ["thermal", thermalArgs]]) {
  const report = run(name, options), entries = numericRows(report.rows);
  const sha = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  const expected = baseline.modes[name];
  requireCheck(entries.length === expected.numeric_fields && sha === expected.sha256, name + " numeric fingerprint");
  compatibility.push({mode: name, numeric_fields: entries.length, sha256: sha, unchanged: true});
}

const installedArgs = [...thermalArgs, "--thermal-hardware", "audit/option-b-thermal-hardware.json"];
const installed = run("installed", installedArgs);
const proposal = load("audit/option-b-thermal-proposal.json");
const stepPath = evidenceDir + "/step1-proposal.json";
writeFileSync(resolve(root, stepPath), JSON.stringify({...proposal, time_step_s: 1}, null, 2) + "\n");
const refined = run("installed-step1", [...feedArgs, "--thermal-proposal", stepPath,
  "--thermal-hardware", "audit/option-b-thermal-hardware.json"]);

let arithmeticMax = 0;
const sum = xs => xs.reduce((a, b) => a + b, 0);
for (const row of installed.rows) {
  const errors = [sum(row.component_ledger.map(c => c.kg)) - row.dry_hardware_design_kg,
    sum(row.liquids.map(l => l.loaded_kg - l.burned_kg - l.contingency_kg - l.docking_reserve_kg - l.unusable_residual_kg)),
    row.dry_hardware_design_kg + row.loaded_propellant_kg + row.helium.total_retained_kg + row.occupant_and_suit_kg
      + sum(Object.values(row.consumables)) + row.cargo_allocation_kg + row.trim_ballast_kg - row.nominal_departure_mass_kg - row.mass_deficit_kg];
  arithmeticMax = Math.max(arithmeticMax, ...errors.map(Math.abs));
  requireCheck(!row.thermal.operational_thermal_continuity_established
    && !row.thermal.installed_hardware.operational_continuity_established, "unproven continuity status");
}
requireCheck(arithmeticMax < 1e-6, "mass arithmetic");
const selection = row => row.scenario === "combined_conservative"
  && (row.role === "cargo" && row.nominal_arrival_mass_kg < 2000 || row.role === "passenger" && row.nominal_arrival_mass_kg === 2000);
const selected = installed.rows.filter(selection);
requireCheck(selected.length === 3, "selected public proposal count");
const refinement = selected.map(row => {
  const fine = refined.rows.find(r => r.mission_id === row.mission_id && r.role === row.role && r.scenario === row.scenario);
  const a = row.thermal, b = fine.thermal;
  const differences = {peak_electrical_w: Math.abs(b.sizing.required_peak_electrical_w - a.sizing.required_peak_electrical_w),
    duty_energy_wh: Math.abs(b.sizing.required_energy_wh - a.sizing.required_energy_wh),
    radiator_rating_w: Math.abs(b.sizing.design_radiator_rejection_w - a.sizing.design_radiator_rejection_w),
    installed_design_kg: Math.abs(fine.dry_hardware_design_kg - row.dry_hardware_design_kg),
    maximum_phase_case_energy_wh: Math.max(...a.cases.flatMap((c, i) => c.phases.map((p, j) => Math.abs(p.electrical_wh - b.cases[i].phases[j].electrical_wh))))};
  requireCheck(differences.peak_electrical_w < .04 && differences.duty_energy_wh < 1e-6 && differences.radiator_rating_w < .06
    && differences.installed_design_kg < .003 && differences.maximum_phase_case_energy_wh < .015, "step refinement " + row.mission_id);
  return {mission_id: row.mission_id, role: row.role, absolute_difference: differences};
});
const sourceHashes = Object.fromEntries(["world/engine/sol-page.js", "connector/src/engine/sol-page.cjs", "connector/src/suites/v1.json",
  "audit/option-b-ship-budget.mjs", "audit/option-b-thermal.mjs", "audit/option-b-thermal-hardware.mjs",
  "audit/option-b-thermal-hardware.json", "audit/option-b-thermal-properties.json", "audit/option-b-thermal-proposal.json",
  "audit/option-b-feed-proposal.json", "audit/option-b-ship-assumptions.json", "audit/option-b-ship-missions.json",
  "audit/option-b-hardware.json", "audit/propulsion-study-baselines.json", "audit/propulsion-study-check.mjs"].map(p => [p, hash(p)]));
requireCheck(sourceHashes["world/engine/sol-page.js"] === baseline.engine_bundle_sha256
  && sourceHashes["connector/src/engine/sol-page.cjs"] === baseline.engine_bundle_sha256
  && sourceHashes["connector/src/suites/v1.json"] === baseline.suite_sha256, "unchanged engine copies and production suite");
const evidence = {format: "starfare.propulsion-study-check/1", completed_utc: new Date().toISOString(),
  kind: "public offline numerical evaluation; not application tests or hardware validation", status: "passed", commands,
  compatibility, arithmetic_max_absolute_error_kg: arithmeticMax, refinement, source_hashes: sourceHashes,
  selected: selected.map(r => ({mission_id: r.mission_id, role: r.role, mass_status: r.status,
    pressure_status: r.pressure_status, installed_design_kg: r.dry_hardware_design_kg,
    cargo_kg: r.cargo_allocation_kg, occupants: r.occupants, trim_kg: r.trim_ballast_kg, deficit_kg: r.mass_deficit_kg,
    thermal_rating_w: r.thermal.sizing.design_electrical_rating_w, duty_energy_wh: r.thermal.sizing.required_energy_wh})),
  application_tests_run: false, external_processes_left_running: 0,
  process_scope: "only this runner's synchronous sizing children, all returned exit 0; unrelated workers are not inspected or stopped",
  limit: "Conditional reference-path arithmetic only. Installed exposure, gas/wall/coolant/actuator transients and selected component ratings remain unproven."};
writeFileSync(resolve(root, evidenceDir, "summary.json"), JSON.stringify(evidence, null, 2) + "\n");
if (output) writeFileSync(resolve(root, output), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({status: evidence.status, compatibility, arithmetic_max_absolute_error_kg: arithmeticMax,
  refined_selected_proposals: refinement.length, application_tests_run: false, evidence_directory: evidenceDir}));
