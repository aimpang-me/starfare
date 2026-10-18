// Offline catalog sizing and mass allocation. Never imported by the fleet.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { OPTION_B } from "./option-b-spec.mjs";
import { validateFeedProposal, feedAllocation, assessFeed } from "./option-b-feed.mjs";

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const hardware = read("./option-b-hardware.json");
const assumptions = read("./option-b-ship-assumptions.json");
const missions = read("./option-b-ship-missions.json");
const lunarCases = read("./option-b-lunar-cases.json");
const sum = xs => xs.reduce((a, b) => a + b, 0);
const sourceHash = createHash("sha256").update(readFileSync(new URL("../world/engine/sol-page.js", import.meta.url))).digest("hex");
const provenance = [];
const gas = hardware.helium_eos;
if (gas.tank_gas.temperature_k !== assumptions.policy.propellant_cold_temperature_k
  || gas.tank_gas.pressure_bar !== assumptions.policy.tank_pressure_bar + assumptions.policy.regulator_pressure_tolerance_bar
  || gas.hot_propellant_tank_gas.temperature_k !== assumptions.policy.propellant_hot_temperature_k)
  throw new Error("Pressure/temperature policy differs from pinned helium EOS states; obtain new property data");
if (sourceHash !== missions.source_engine_sha256 || ["total_thrust_n", "isp_s", "oxidizer_to_fuel_mass_ratio", "bare_engine_mass_kg"].some(k => OPTION_B[k] !== missions.chemical[k]))
  throw new Error("Mission engine/specification changed; recompute source trajectories");
for (const m of missions.missions) {
  if (!["verified_numerical_rendezvous", "accepted_within_model"].includes(m.verification_status)
    || ![m.arrival_mass_kg, m.consumed_propellant_kg, m.flight_seconds].every(n => Number.isFinite(n) && n > 0)
    || Math.abs(m.departure_mass_kg - m.arrival_mass_kg - m.consumed_propellant_kg) > 1e-6)
    throw new Error("Invalid verified mission envelope: " + m.id);
  if (m.id.startsWith("lunar-")) {
    const ref = lunarCases.cases[m.id.slice(6)]?.reference;
    if (!ref || Math.abs(ref.chemical_propellant_kg - m.consumed_propellant_kg) > 1e-5
      || Math.abs(ref.departure_mass_kg - m.departure_mass_kg) > 1e-5 || Math.abs(ref.flight_seconds - m.flight_seconds) > 1e-5)
      throw new Error("Lunar mission snapshot differs from saved trajectory: " + m.id);
  }
  const reportPath = new URL("../" + m.source_report, import.meta.url);
  if (!existsSync(reportPath)) {
    provenance.push({mission_id: m.id, status: "reviewed_snapshot_only", source_report: m.source_report});
    continue;
  }
  const raw = readFileSync(reportPath), report = JSON.parse(raw);
  const spec = report.chemical ?? report.input?.chemical;
  const row = m.id.startsWith("lunar-")
    ? report.attempts?.find(r => r.status === m.verification_status && r.final_nonburned_mass_kg === m.arrival_mass_kg)
    : report.rows?.find(r => r.source.kind === "proposed_surface_pad" && r.final_nonburned_mass_kg === m.arrival_mass_kg);
  const copied = row && [row.final_nonburned_mass_kg, row.chemical_propellant_kg ?? row.propellant_kg,
    row.departure_mass_kg ?? row.minimum_starting_mass_kg, row.flight_seconds, row.launch_wait_seconds];
  const expected = [m.arrival_mass_kg, m.consumed_propellant_kg, m.departure_mass_kg, m.flight_seconds, m.launch_wait_seconds];
  if (report.source_engine_sha256 !== sourceHash || !spec
    || ["total_thrust_n", "isp_s", "oxidizer_to_fuel_mass_ratio", "bare_engine_mass_kg"].some(k => spec[k] !== OPTION_B[k])
    || row?.status !== m.verification_status || !copied?.every((v, i) => Number.isFinite(v) && Math.abs(v - expected[i]) < 1e-5))
    throw new Error("Mission snapshot differs from accepted local report: " + m.id);
  const hash = createHash("sha256").update(raw).digest("hex");
  provenance.push({mission_id: m.id, status: "matched_accepted_local_report", source_report: m.source_report,
    current_report_sha256: hash, original_report_hash_matches: hash === m.source_report_sha256});
}

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!["--out", "--mission", "--role", "--feed-proposal"].includes(args[i]) || !args[i + 1]) throw new Error("Use --out <json>, --mission <id>, --role <cargo|passenger>, --feed-proposal <json>");
  options[args[i]] = args[i + 1];
}
if (options["--mission"] && !missions.missions.some(m => m.id === options["--mission"])) throw new Error("Unknown mission");
if (options["--role"] && !Object.hasOwn(assumptions.roles, options["--role"])) throw new Error("Unknown role");
const feedProposalRaw = options["--feed-proposal"] ? readFileSync(options["--feed-proposal"], "utf8") : null;
const feedProposal = feedProposalRaw ? JSON.parse(feedProposalRaw) : null;
if (feedProposal) validateFeedProposal(feedProposal);

function liquidInventory(mission, policy) {
  const burned = mission.consumed_propellant_kg, mf = mission.arrival_mass_kg;
  const contingency = burned * policy.contingency_fraction_of_nominal_burn;
  const docking = mf * -Math.expm1(-policy.rcs_reserve_delta_v_m_s / (9.80665 * hardware.rcs_thruster.isp_s));
  const loaded = (burned + contingency + docking) / (1 - policy.residual_fraction_of_loaded_liquid);
  const fractions = [1 / (1 + OPTION_B.oxidizer_to_fuel_mass_ratio), OPTION_B.oxidizer_to_fuel_mass_ratio / (1 + OPTION_B.oxidizer_to_fuel_mass_ratio)];
  return ["mmh", "oxidizer"].map((fluid, i) => ({ fluid, burned_kg: burned * fractions[i],
    contingency_kg: contingency * fractions[i], docking_reserve_kg: docking * fractions[i],
    unusable_residual_kg: loaded * policy.residual_fraction_of_loaded_liquid * fractions[i],
    loaded_kg: loaded * fractions[i], density_kg_l: fluid === "mmh" ? policy.mmh_design_density_kg_l : policy.oxidizer_design_density_kg_l,
    volume_l: loaded * fractions[i] / (fluid === "mmh" ? policy.mmh_design_density_kg_l : policy.oxidizer_design_density_kg_l) }));
}

function tankBanks(liquid, policy) {
  const requiredPressure = policy.tank_pressure_bar + policy.regulator_pressure_tolerance_bar + policy.allocated_transient_headroom_bar;
  const catalog = hardware.propellant_tanks.filter(t => t.meop_bar >= requiredPressure);
  const choices = [];
  function enumerate(index, remaining, items) {
    if (index === catalog.length) {
      const count = sum(items.map(x => x.count));
      if (!count) return;
      const volume_l = sum(items.map(x => x.count * x.volume_l));
      const hot_liquid_volume_l = liquid.volume_l * (1 + policy.maximum_liquid_volume_expansion_fraction);
      if (volume_l * (1 - policy.minimum_ullage_fraction) < hot_liquid_volume_l) return;
      const cold_gas_volume_l = volume_l - liquid.volume_l;
      const hot_gas_volume_l = volume_l - hot_liquid_volume_l;
      const hot_gas_density_kg_m3 = hardware.helium_eos.tank_gas.density_kg_m3 * cold_gas_volume_l / hot_gas_volume_l;
      const hot_gas_pressure_upper_bar = hardware.helium_eos.hot_propellant_tank_gas.table
        .find(r => r.density_kg_m3 >= hot_gas_density_kg_m3)?.pressure_bar;
      const minimum_meop_bar = Math.min(...items.map(x => x.meop_bar));
      const hot_total_pressure_screen_bar = hot_gas_pressure_upper_bar + policy.propellant_vapor_pressure_allowance_bar;
      if (!hot_gas_pressure_upper_bar
        || hot_total_pressure_screen_bar + policy.allocated_transient_headroom_bar > minimum_meop_bar) return;
      const shells = sum(items.map(x => x.count * x.dry_kg));
      const area = sum(items.map(x => x.count * Math.cbrt(36 * Math.PI * (x.volume_l / 1000) ** 2))) * policy.tank_area_shape_factor;
      const mounts = count * policy.mount_kg_per_propellant_tank;
      const branches = count * policy.branch_feed_kg_per_propellant_tank;
      const thermal = area * policy.thermal_kg_per_equivalent_tank_m2;
      const filledItems = items.map(t => ({...t, loaded_liquid_l_each: liquid.volume_l * t.volume_l / volume_l,
        hot_liquid_l_each: hot_liquid_volume_l * t.volume_l / volume_l}));
      choices.push({ items: filledItems, count, volume_l, hot_liquid_volume_l, cold_gas_volume_l, hot_gas_volume_l,
        hot_gas_density_kg_m3, hot_gas_pressure_upper_bar, hot_total_pressure_screen_bar, minimum_meop_bar,
        fill_allocation: "liquid divided proportional to individual tank internal volume; same fill fraction in each tank",
        shells_kg: shells, mounts_kg: mounts, branch_feed_kg: branches,
        equivalent_area_m2: area, thermal_kg: thermal, ranked_dry_kg: shells + mounts + branches + thermal });
      return;
    }
    for (let n = 0; n <= remaining; n++) enumerate(index + 1, remaining - n, n ? [...items, { ...catalog[index], count: n }] : items);
  }
  enumerate(0, policy.maximum_tanks_per_fluid, []);
  // More dry mass AND more ullage volume cannot improve helium or mass closure.
  const sorted = choices.sort((a, b) => a.ranked_dry_kg - b.ranked_dry_kg || a.volume_l - b.volume_l);
  let smallestVolume = Infinity;
  return sorted.filter(x => { if (x.volume_l >= smallestVolume) return false; smallestVolume = x.volume_l; return true; });
}

function heliumInventory(banks, liquids, policy) {
  const eos = hardware.helium_eos, bottle = hardware.pressurant_bottle;
  const bottleM3 = bottle.volume_l / 1000;
  const usablePerBottle = (eos.charge.density_kg_m3 - eos.cutoff.density_kg_m3) * bottleM3;
  const initialUllage = sum(banks.map(x => x.volume_l)) - sum(liquids.map(x => x.volume_l));
  const displacedM3 = sum(liquids.map(x => (x.burned_kg + x.contingency_kg + x.docking_reserve_kg) / x.density_kg_l)) / 1000;
  const requiredTransfer = eos.tank_gas.density_kg_m3 * displacedM3 * (1 + policy.pressurant_delivery_margin_fraction);
  const count = Math.max(1, Math.ceil(requiredTransfer / usablePerBottle));
  const precharge = initialUllage / 1000 * eos.tank_gas.density_kg_m3;
  const storage = count * bottleM3 * eos.charge.density_kg_m3;
  return { id: bottle.id, count, volume_l: count * bottle.volume_l, shell_kg: count * bottle.dry_kg,
    mount_kg: count * policy.mount_kg_per_helium_bottle, branch_feed_kg: count * policy.branch_feed_kg_per_helium_bottle,
    initial_ullage_l: initialUllage, precharged_ullage_kg: precharge, stored_kg: storage, total_retained_kg: precharge + storage,
    required_transfer_including_margin_kg: requiredTransfer, usable_transfer_capacity_kg: count * usablePerBottle,
    cold_cutoff_storage_kg: count * bottleM3 * eos.cutoff.density_kg_m3,
    hot_storage_pressure_bar: eos.hot_charge.pressure_bar, storage_meop_bar: bottle.meop_bar };
}

function sizeShip(mission, role, policy, fixedCargo) {
  const liquids = liquidInventory(mission, policy);
  const feedHardware = {...hardware, rcs_count: policy.rcs_engine_count};
  const allocation = feedProposal ? feedAllocation(role, feedProposal, feedHardware, OPTION_B) : null;
  const fixed = Object.entries(assumptions.roles[role].fixed_hardware_estimates_kg)
    .filter(([name]) => !allocation || name !== "regulators_isolation_valves_common_feed")
    .map(([name, kg]) => ({name, kg, basis: "concept estimate"}));
  if (allocation) fixed.push(...allocation.components);
  fixed.push({name: "four_main_engines_with_valves", kg: OPTION_B.bare_engine_mass_kg, basis: "manufacturer"},
    {name: "twelve_rcs_engines_with_dual_seat_valves", kg: policy.rcs_engine_count * hardware.rcs_thruster.dry_kg, basis: "manufacturer mass; proposed count/layout"});
  const crewCount = role === "passenger" ? policy.crew_count : 0;
  const provisionDays = crewCount ? Math.max(policy.minimum_provision_days, Math.ceil(mission.flight_seconds / 86400) + policy.extra_provision_days_after_rounded_flight) : 0;
  const consumables = Object.fromEntries(["oxygen", "water", "dry_food", "lioh_packaging"].map(name => [name + "_kg", crewCount * provisionDays * policy[name + "_kg_per_person_day"]]));
  consumables.cabin_air_kg = crewCount ? policy.cabin_air_kg : 0;
  const retainedCrewMass = crewCount * policy.occupant_and_suit_kg_each + sum(Object.values(consumables));
  const retainedLiquids = sum(liquids.map(x => x.contingency_kg + x.docking_reserve_kg + x.unusable_residual_kg));
  const banks = liquids.map(x => tankBanks(x, policy));
  let best;
  for (const fuel of banks[0]) for (const oxidizer of banks[1]) {
    const selected = [fuel, oxidizer], helium = heliumInventory(selected, liquids, policy);
    if (allocation) {
      helium.additional_retained_feed_and_ullage_kg = allocation.additional_retained_helium_kg;
      helium.total_retained_kg += allocation.additional_retained_helium_kg;
    }
    if (helium.count > policy.maximum_helium_bottles) continue;
    const dynamic = [
      { name: "propellant_tank_shells_and_pmd", kg: sum(selected.map(x => x.shells_kg)), basis: "manufacturer catalog/upper bounds" },
      { name: "propellant_tank_mounts", kg: sum(selected.map(x => x.mounts_kg)), basis: "estimate" },
      { name: "propellant_branch_lines_and_isolation", kg: sum(selected.map(x => x.branch_feed_kg)), basis: "estimate" },
      { name: "tank_insulation_heaters_integration", kg: sum(selected.map(x => x.thermal_kg)), basis: "area estimate" },
      { name: "helium_bottle_shells", kg: helium.shell_kg, basis: "manufacturer" },
      { name: "helium_bottle_mounts_and_branch_feed", kg: helium.mount_kg + helium.branch_feed_kg, basis: "estimate" }
    ];
    const dryParts = [...fixed, ...dynamic], baseDry = sum(dryParts.map(x => x.kg));
    const growth = baseDry * policy.dry_hardware_growth_fraction;
    const beforeCargo = baseDry + growth + retainedLiquids + helium.total_retained_kg + retainedCrewMass;
    if (!best || beforeCargo < best.required_arrival_before_cargo_kg) best = { dryParts, baseDry, growth, beforeCargo,
      required_arrival_before_cargo_kg: beforeCargo, tanks: selected, helium };
  }
  if (!best) return { mission_id: mission.id, role, status: "no_catalog_assembly" };
  const available = mission.arrival_mass_kg - best.beforeCargo;
  const cargo = fixedCargo ?? feedProposal?.cargo_targets_kg[mission.id]?.[role]
    ?? assumptions.proposal_targets[mission.id]?.[role] ?? Math.max(0, Math.floor(available));
  const fits = available >= cargo;
  const trim = fits ? available - cargo : 0;
  const arrivalSum = sum(best.dryParts.map(x => x.kg)) + best.growth + retainedLiquids + best.helium.total_retained_kg + retainedCrewMass + cargo + trim;
  const departureSum = sum(best.dryParts.map(x => x.kg)) + best.growth + sum(liquids.map(x => x.loaded_kg)) + best.helium.total_retained_kg + retainedCrewMass + cargo + trim;
  const nominalPressureLow = policy.tank_pressure_bar - policy.regulator_pressure_tolerance_bar - policy.maximum_feed_loss_bar;
  const nominalPressureHigh = Math.max(...best.tanks.map(t => t.hot_total_pressure_screen_bar));
  const rcsReserve = sum(liquids.map(x => x.docking_reserve_kg));
  const checks = {
    allocated_engine_inlet_within_catalog: nominalPressureLow >= hardware.main_engine_inlet.minimum_bar && nominalPressureHigh <= hardware.main_engine_inlet.maximum_bar
      && nominalPressureLow >= hardware.rcs_thruster.inlet_min_bar && nominalPressureHigh <= hardware.rcs_thruster.inlet_max_bar,
    hot_storage_pressure_within_meop: best.helium.hot_storage_pressure_bar <= hardware.pressurant_bottle.meop_bar,
    helium_delivery_capacity: best.helium.usable_transfer_capacity_kg >= best.helium.required_transfer_including_margin_kg,
    hot_tank_pressure_within_assumed_screen: best.tanks.every(t => t.hot_total_pressure_screen_bar + policy.allocated_transient_headroom_bar <= t.minimum_meop_bar),
    separate_tank_volume: best.tanks.every(t => t.hot_liquid_volume_l <= t.volume_l * (1 - policy.minimum_ullage_fraction)),
    inventory_closure_kg: sum(liquids.map(x => x.loaded_kg - x.burned_kg - x.contingency_kg - x.docking_reserve_kg - x.unusable_residual_kg)),
    arrival_closure_error_kg: arrivalSum - mission.arrival_mass_kg,
    departure_closure_error_kg: departureSum - mission.departure_mass_kg,
    reserve_ideal_delta_v_m_s: -9.80665 * hardware.rcs_thruster.isp_s * Math.log1p(-rcsReserve / mission.arrival_mass_kg)
  };
  if (!checks.hot_tank_pressure_within_assumed_screen || !checks.hot_storage_pressure_within_meop || !checks.helium_delivery_capacity || !checks.separate_tank_volume
    || Math.abs(checks.inventory_closure_kg) > 1e-6 || (fits && (Math.abs(checks.arrival_closure_error_kg) > 1e-6 || Math.abs(checks.departure_closure_error_kg) > 1e-6)))
    throw new Error("Internal sizing invariant failed: " + mission.id + "/" + role);
  const result = { mission_id: mission.id, role, status: fits ? "conditional_mass_budget_closes" : "mass_deficit",
    pressure_status: feedProposal ? "requirements_only_regulator_thermal_performance_unverified" : "unclosed_engine_feed_and_propellant_properties",
    pressure_limit: "MEOP screen assumes <=2 bar propellant vapor contribution, <=4% expansion and proportional fill. Feed/regulator/thermal/performance requirements remain unverified; no operational pressure closure claimed.",
    cold_inlet_pressure_lower_screen_bar: nominalPressureLow, hot_unregulated_inlet_pressure_upper_screen_bar: nominalPressureHigh,
    mission, occupants: crewCount, provision_days: provisionDays, consumables, occupant_and_suit_kg: crewCount * policy.occupant_and_suit_kg_each,
    cargo_mass_capacity_kg: Math.max(0, Math.floor(available)), cargo_allocation_kg: cargo,
    trim_ballast_kg: trim, mass_deficit_kg: Math.max(0, cargo - available),
    required_arrival_before_cargo_kg: best.beforeCargo, dry_hardware_before_growth_kg: best.baseDry,
    dry_hardware_growth_kg: best.growth, dry_hardware_design_kg: best.baseDry + best.growth,
    retained_liquids_kg: retainedLiquids, loaded_propellant_kg: sum(liquids.map(x => x.loaded_kg)),
    nominal_departure_mass_kg: mission.departure_mass_kg, nominal_arrival_mass_kg: mission.arrival_mass_kg,
    component_ledger: [...best.dryParts, {name: "dry_hardware_growth_allocation", kg: best.growth, basis: "policy"}],
    liquids, tanks: best.tanks, helium: best.helium, checks };
  if (feedProposal) {
    result.feed = assessFeed(result, feedProposal, feedHardware, OPTION_B, policy);
    if (!result.feed.conditional_inventory_allocation_valid) result.status = "feed_inventory_allocation_invalid";
  }
  return result;
}

const selectedMissions = missions.missions.filter(m => !options["--mission"] || m.id === options["--mission"]);
const roles = options["--role"] ? [options["--role"]] : Object.keys(assumptions.roles);
const scenarios = { baseline: {}, conservative_hardware: {dry_hardware_growth_fraction: .4}, extra_contingency: {contingency_fraction_of_nominal_burn: .1},
  combined_conservative: {dry_hardware_growth_fraction: .4, contingency_fraction_of_nominal_burn: .1} };
const rows = [];
const targets = new Map();
for (const [scenario, changes] of Object.entries(scenarios)) for (const mission of selectedMissions) for (const role of roles) {
  const key = mission.id + "/" + role;
  const result = sizeShip(mission, role, {...assumptions.policy, ...changes}, targets.get(key));
  if (scenario === "baseline") targets.set(key, result.cargo_allocation_kg ?? 0);
  rows.push({scenario, ...result});
}
const report = {format: "starfare.option-b-ship-budget/1", diagnostic_only: true, source_engine_sha256: sourceHash,
  completed_utc: new Date().toISOString(), chemical: OPTION_B, hardware, assumptions, feed_proposal: feedProposal,
  feed_proposal_sha256: feedProposalRaw ? createHash("sha256").update(feedProposalRaw).digest("hex") : null,
  provenance, scenarios, rows,
  scope: "conditional conceptual mass budgets; no qualification, fleet update or reserve/docking trajectory claim",
  source_hashes: Object.fromEntries(["option-b-ship-budget.mjs", "option-b-feed.mjs", "option-b-hardware.json", "option-b-ship-assumptions.json", "option-b-ship-missions.json"].map(p =>
    [p, createHash("sha256").update(readFileSync(new URL(p, import.meta.url))).digest("hex")]))};
if (options["--out"]) writeFileSync(options["--out"], JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(rows.filter(r => ["baseline", "combined_conservative"].includes(r.scenario)).map(r => ({scenario: r.scenario, mission: r.mission_id, role: r.role,
  status: r.status, pressure_status: r.pressure_status, occupants: r.occupants, cargo_kg: r.cargo_allocation_kg, mass_deficit_kg: r.mass_deficit_kg,
  loaded_propellant_kg: r.loaded_propellant_kg, dry_design_kg: r.dry_hardware_design_kg, helium_bottles: r.helium?.count})), null, 2));
