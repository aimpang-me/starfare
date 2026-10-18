// Required heat along a controlled path, not a prediction of unchosen hardware.
import {assessThermalHardware} from "./option-b-thermal-hardware.mjs";
const SUM = values => values.reduce((a, b) => a + b, 0);
const R = 8.31446261815324;
const SIGMA = 5.670374419e-8;

export function validateThermalProposal(p, properties) {
  if (p.format !== "starfare.option-b-thermal-proposal/1" || p.status !== "controlled_path_requirements_only"
    || properties.format !== "starfare.option-b-thermal-properties/1") throw new Error("Unknown thermal format/status");
  const scalarKeys = "liquid_target_k tracking_tolerance_k hp_reference_k tank_total_pressure_bar residual_fraction_of_loaded_liquid pmd_liquid_residual_allowance_kg_each_fluid liquid_reference_density_temperature_k liquid_expansion_fraction_per_k time_step_s gas_wall_allowable_approach_k liquid_heater_approach_k thermal_filled_fixed_kg pad_initial_hot_liquid_k".split(" ");
  for (const key of scalarKeys) if (!Number.isFinite(p[key]) || p[key] <= 0) throw new Error("Invalid thermal input: " + key);
  for (const section of [p.electrical, p.radiator]) for (const [key, value] of Object.entries(section))
    if (key !== "basis" && (!Number.isFinite(value) || value <= 0)) throw new Error("Invalid thermal sizing input: " + key);
  for (const key of ["vapor_scale_factors", "insulated_heat_flux_cases_w_m2", "engine_heat_cases_w"])
    if (!p[key]?.length || !p[key].every(Number.isFinite)) throw new Error("Invalid thermal scenarios: " + key);
  if (p.residual_fraction_of_loaded_liquid >= 1 || p.radiator.skin_temperature_k >= p.liquid_target_k - p.tracking_tolerance_k
    || !p.engine_heat_cases_w.includes(p.sizing_engine_heat_w) || p.time_step_s > 10)
    throw new Error("Inconsistent thermal requirements");
  for (const value of [p.electrical.heater_efficiency, p.electrical.distribution_efficiency,
    p.electrical.battery_depth_of_discharge, p.electrical.battery_eol_capacity_fraction,
    p.radiator.emissivity, p.radiator.solar_absorptivity, p.radiator.planet_view_factor_max, p.radiator.planet_albedo_bound])
    if (value > 1) throw new Error("Thermal fraction exceeds one");
  if (!p.vapor_scale_factors.every(v => v > 0) || !p.engine_heat_cases_w.every(v => v >= 0)
    || !p.engine_heat_cases_w.includes(0) || p.pad_initial_hot_liquid_k < p.liquid_target_k
    || !Object.values(p.fixed_tanks_each_fluid).length
    || !Object.values(p.fixed_tanks_each_fluid).every(n => Number.isInteger(n) && n > 0)
    || !Object.values(p.cargo_targets_kg).every(roles => Object.values(roles).every(n => Number.isFinite(n) && n >= 0)))
    throw new Error("Invalid thermal configuration");
  for (const t of properties.helium_isotherms) if (t.rows.length < 2 || !t.rows.every((row, i) => row.length === 4 && row.every(Number.isFinite)
    && (!i || row[0] > t.rows[i - 1][0] && row[1] > t.rows[i - 1][1]))) throw new Error("Invalid helium property table");
}

function interpolate(table, value, column) {
  const rows = table.rows;
  if (value < rows[0][column] - 1e-8 || value > rows.at(-1)[column] + 1e-8) throw new Error("Thermal helium state outside sourced table");
  const high = rows.findIndex(row => row[column] >= value - 1e-10);
  if (high <= 0) return rows[0];
  const a = rows[high - 1], b = rows[high], f = (value - a[column]) / (b[column] - a[column]);
  return a.map((v, i) => v + f * (b[i] - v));
}

export function sizeThermal(context, p, properties, feed, hardware, installed = null) {
  const {mission, liquids, tanks, helium, allocation, chemical} = context;
  const table = temperature => {
    const result = properties.helium_isotherms.find(t => Math.abs(t.temperature_k - temperature) < 1e-7);
    if (!result) throw new Error("Thermal temperature lacks sourced helium isotherm");
    return result;
  };
  const hpTable = table(p.hp_reference_k), lpTable = table(p.liquid_target_k);
  const lpCold = table(p.liquid_target_k - p.tracking_tolerance_k), lpHot = table(p.liquid_target_k + p.tracking_tolerance_k);
  const phases = ["lift", "departure", "coast", "arrival"].map(name => ({name, seconds: mission.burn_schedule_seconds?.[name], firing: name !== "coast"}));
  if (phases.length !== 4 || !phases.every(s => Number.isFinite(s.seconds) && s.seconds > 0)
    || Math.abs(SUM(phases.map(s => s.seconds)) - mission.flight_seconds) > 1e-5) throw new Error("Invalid thermal burn timeline");
  const propellantRate = chemical.total_thrust_n / (9.80665 * chemical.isp_s);
  if (Math.abs(SUM(phases.filter(s => s.firing).map(s => s.seconds)) * propellantRate - mission.consumed_propellant_kg) > 1e-5)
    throw new Error("Thermal burn schedule changed the saved fuel consumption");
  if (installed) phases.push({name: "post_capture", seconds: installed.engine.post_capture_conditioning_s, firing: false});
  const wetM3 = allocation.wet_volume_l_each_fluid / 1000;
  const hpM3 = helium.volume_l / 1000 + feed.hydraulics.additional_high_pressure_helium_volume_l / 1000;
  const hpMass0 = interpolate(hpTable, hardware.helium_eos.charge.pressure_bar, 0)[1] * hpM3;
  const lpLineMass = interpolate(lpTable, p.tank_total_pressure_bar, 0)[1] * feed.hydraulics.additional_low_pressure_helium_volume_l / 1000;
  const areas = tanks.map(t => t.equivalent_area_m2);
  const hpArea = helium.count * 1.2 * Math.cbrt(36 * Math.PI * (hardware.pressurant_bottle.volume_l / 1000) ** 2);
  const rad = p.radiator, elec = {...p.electrical, ...(installed?.electrical ?? {})};
  const installedParts = installed?.components.map(c => ({name: c.name,
    kg: c.kg_each * ({ship: 1, helium_bottle: helium.count, propellant_tank: SUM(tanks.map(t => t.count)), coolant_fill: installed.loop.transport_coolant_l}[c.quantity_basis]),
    basis: c.basis}));
  const radiatorEmission = rad.emissivity * SIGMA * rad.skin_temperature_k ** 4;
  const radiatorIncoming = rad.solar_absorptivity * rad.solar_flux_bound_w_m2
    + rad.planet_view_factor_max * (rad.emissivity * rad.planet_ir_bound_w_m2 + rad.solar_absorptivity * rad.planet_albedo_bound * rad.solar_flux_bound_w_m2);
  const radiatorNet = radiatorEmission - radiatorIncoming;
  if (radiatorNet <= 0) throw new Error("Radiator cannot reject heat in proposed environment");
  const vaporPressure = (fluid, t, factor) => {
    const v = properties.vapor[fluid];
    if (t < v.valid_temperature_k[0] || t > v.valid_temperature_k[1]) throw new Error("Vapor curve temperature outside source range");
    const c = v.log10_pa_coefficients ?? v.log10_mmhg_coefficients;
    return 10 ** (c[0] + c[1] / t + c[2] / t ** 2) * (v.log10_pa_coefficients ? 1 : 133.322387415) * factor;
  };
  function state(i, totalFluid, temperature, factor) {
    const liquid = liquids[i], v = properties.vapor[liquid.fluid];
    const density = liquid.density_kg_l * 1000 / (1 + p.liquid_expansion_fraction_per_k * (temperature - p.liquid_reference_density_temperature_k));
    const vaporPa = vaporPressure(liquid.fluid, temperature, factor);
    const vaporDensity = vaporPa * v.vapor_molar_mass_kg_mol / (R * temperature);
    const volume = (tanks[i].volume_l / 1000 - totalFluid / density + wetM3) / (1 - vaporDensity / density);
    if (volume <= 0 || volume >= tanks[i].volume_l / 1000) throw new Error("Thermal phase inventory does not fit tank");
    const gas = interpolate(table(temperature), p.tank_total_pressure_bar - vaporPa / 1e5, 0);
    return {volume, vaporPa, vaporMass: vaporDensity * volume, heMass: gas[1] * volume, gas, density};
  }
  const cases = [];
  for (const vaporScale of p.vapor_scale_factors) for (const heatFlux of p.insulated_heat_flux_cases_w_m2) for (const engineHeat of p.engine_heat_cases_w) {
    const initial = liquids.map((l, i) => state(i, l.loaded_kg, p.liquid_target_k, vaporScale));
    const retainedHe = hpMass0 + lpLineMass + SUM(initial.map(s => s.heMass));
    let burned = 0, hpMass = hpMass0, energyResidual = 0, peakElectric = 0, peakHeat = 0, peakReject = 0, electricalWh = 0;
    let hpPeakHeat = 0, gasConditioningPeak = 0, liquidHeatPeak = 0, liquidCoolPeak = 0;
    const phaseResults = [];
    for (const phase of phases) {
      const steps = phase.firing || installed ? Math.ceil(phase.seconds / p.time_step_s) : 1;
      const dt = phase.seconds / steps;
      const summary = {name: phase.name, seconds: phase.seconds, heater_peak_w: 0, electrical_peak_w: 0, electrical_wh: 0, rejection_peak_w: 0,
        start_hp_pressure_bar: interpolate(hpTable, hpMass / hpM3, 1)[0]};
      for (let j = 0; j < steps; j++) {
        // Left-endpoint cooldown heat is conservative for this decreasing
        // sensitivity. A new cutoff starts at the full declared firing load.
        const engineToLiquid = phase.firing ? engineHeat : installed
          ? engineHeat * Math.exp(-j * dt / installed.engine.cooldown_time_constant_s) : 0;
        const nextBurned = burned + (phase.firing ? propellantRate * dt : 0);
        const current = liquids.map((l, i) => state(i, l.loaded_kg - burned * l.burned_kg / mission.consumed_propellant_kg, p.liquid_target_k, vaporScale));
        const next = liquids.map((l, i) => state(i, l.loaded_kg - nextBurned * l.burned_kg / mission.consumed_propellant_kg, p.liquid_target_k, vaporScale));
        const gasDelta = next.map((s, i) => s.heMass - current[i].heMass);
        const delivered = SUM(gasDelta), nextHpMass = hpMass - delivered;
        const a = interpolate(hpTable, hpMass / hpM3, 1), b = interpolate(hpTable, nextHpMass / hpM3, 1);
        const enthalpyFlow = delivered * (a[3] + b[3]) / 2;
        const gasHeatJ = nextHpMass * b[2] - hpMass * a[2] + enthalpyFlow;
        const hpDemand = gasHeatJ / dt - heatFlux * hpArea;
        const conditioning = gasDelta.map((dm, i) => dm / dt * ((a[3] + b[3]) / 2 - current[i].gas[3]));
        // At fixed T/P in the rigid tank, helium enthalpy accumulation equals
        // its conditioned inflow. Liquid outflow cancels its inventory loss;
        // the remaining phase-change demand is h_fg * dm_vapor (not u_fg).
        // This uses additive partial-fluid enthalpies, neglecting mixture effects.
        const liquidDemand = next.map((s, i) => (s.vaporMass - current[i].vaporMass) / dt * properties.vapor[liquids[i].fluid].latent_heat_design_j_kg
          - heatFlux * areas[i] - engineToLiquid / 2);
        // Separate interfaces: no credit for transferring heat between nodes.
        const heat = Math.max(0, hpDemand) + SUM(conditioning.map(q => Math.max(0, -q))) + SUM(liquidDemand.map(q => Math.max(0, q)));
        const electric = (heat / elec.heater_efficiency + elec.pump_w + elec.controls_w) / elec.distribution_efficiency;
        const rejection = Math.max(0, -hpDemand) + SUM(conditioning.map(q => Math.max(0, q)))
          + SUM(liquidDemand.map(q => Math.max(0, -q))) + electric - heat;
        energyResidual = Math.max(energyResidual, Math.abs(gasHeatJ - enthalpyFlow - (nextHpMass * b[2] - hpMass * a[2])));
        peakElectric = Math.max(peakElectric, electric); peakHeat = Math.max(peakHeat, heat); peakReject = Math.max(peakReject, rejection);
        hpPeakHeat = Math.max(hpPeakHeat, Math.max(0, hpDemand)); gasConditioningPeak = Math.max(gasConditioningPeak, ...conditioning.map(Math.abs));
        liquidHeatPeak = Math.max(liquidHeatPeak, ...liquidDemand.map(q => Math.max(0, q))); liquidCoolPeak = Math.max(liquidCoolPeak, ...liquidDemand.map(q => Math.max(0, -q)));
        electricalWh += electric * dt / 3600;
        summary.heater_peak_w = Math.max(summary.heater_peak_w, heat); summary.electrical_peak_w = Math.max(summary.electrical_peak_w, electric);
        summary.rejection_peak_w = Math.max(summary.rejection_peak_w, rejection); summary.electrical_wh += electric * dt / 3600;
        burned = nextBurned; hpMass = nextHpMass;
      }
      summary.end_hp_pressure_bar = interpolate(hpTable, hpMass / hpM3, 1)[0]; phaseResults.push(summary);
    }
    const pressureBounds = [], inventory = [];
    for (let i = 0; i < liquids.length; i++) {
      const l = liquids[i];
      for (const fraction of [0, .25, .5, .75, 1]) {
        const fluidLeft = l.loaded_kg - l.burned_kg * fraction;
        const nominal = state(i, fluidLeft, p.liquid_target_k, vaporScale);
        for (const t of [lpCold.temperature_k, lpHot.temperature_k]) {
          const shifted = state(i, fluidLeft, t, vaporScale);
          const heliumPressure = interpolate(table(t), nominal.heMass / shifted.volume, 1)[0];
          pressureBounds.push(heliumPressure + shifted.vaporPa / 1e5);
        }
      }
      const postReserve = state(i, l.unusable_residual_kg, p.liquid_target_k + p.tracking_tolerance_k, vaporScale);
      const wetMass = wetM3 * l.density_kg_l * 1000;
      inventory.push({fluid: l.fluid, initial_vapor_kg: initial[i].vaporMass, post_usable_reserves_vapor_kg: postReserve.vaporMass,
        wet_hold_up_kg: wetMass, pmd_liquid_allowance_kg: p.pmd_liquid_residual_allowance_kg_each_fluid,
        unused_residual_kg: l.unusable_residual_kg,
        allocation_fits: postReserve.vaporMass + wetMass + p.pmd_liquid_residual_allowance_kg_each_fluid <= l.unusable_residual_kg});
    }
    cases.push({vapor_scale: vaporScale, heat_flux_w_m2: heatFlux, engine_heat_w: engineHeat,
      peak_electrical_w: peakElectric, electrical_wh: electricalWh, peak_heater_thermal_w: peakHeat, peak_rejection_w: peakReject,
      hp_gas_peak_heat_w: hpPeakHeat, gas_conditioner_peak_w_each: gasConditioningPeak,
      liquid_heater_peak_w_each: liquidHeatPeak, liquid_cooler_peak_w_each: liquidCoolPeak,
      reference_pressure_min_bar: Math.min(...pressureBounds), reference_pressure_max_bar: Math.max(...pressureBounds),
      total_retained_helium_kg: retainedHe, initial_tank_helium_kg: SUM(initial.map(s => s.heMass)), initial_ullage_l: SUM(initial.map(s => s.volume)) * 1000,
      high_pressure_helium_kg: hpMass0, low_pressure_line_helium_kg: lpLineMass,
      delivered_helium_kg: hpMass0 - hpMass, final_hp_pressure_bar: interpolate(hpTable, hpMass / hpM3, 1)[0],
      hp_energy_identity_residual_j: energyResidual, phases: phaseResults, inventory});
  }
  function hardwareFor(engineHeat) {
    const selected = cases.filter(c => c.engine_heat_w <= engineHeat);
    const peak = Math.max(...selected.map(c => c.peak_electrical_w));
    const wh = Math.max(...selected.map(c => c.electrical_wh));
    const rejection = Math.max(...selected.map(c => c.peak_rejection_w));
    const area = rejection * (1 + rad.capacity_margin_fraction) / radiatorNet;
    const ratedPower = peak * (1 + elec.power_and_energy_margin_fraction);
    const ratedWh = wh * (1 + elec.power_and_energy_margin_fraction) / (elec.battery_depth_of_discharge * elec.battery_eol_capacity_fraction);
    const batteryEnergyKg = ratedWh / elec.battery_pack_wh_kg, batteryPowerKg = ratedPower / elec.battery_deliverable_w_kg;
    const batteryKg = Math.ceil(Math.max(batteryEnergyKg, batteryPowerKg) / elec.battery_mass_rounding_kg) * elec.battery_mass_rounding_kg;
    const conditionerKg = Math.max(elec.power_conditioner_min_kg, ratedPower / 1000 * elec.power_conditioner_kg_kw);
    return {engine_heat_limit_w: engineHeat, required_peak_electrical_w: peak, required_energy_wh: wh,
      design_electrical_rating_w: ratedPower, battery_nameplate_wh_required: ratedWh, battery_kg: batteryKg,
      battery_energy_limited_kg: batteryEnergyKg, battery_power_limited_kg: batteryPowerKg,
      design_radiator_rejection_w: rejection * (1 + rad.capacity_margin_fraction), radiator_area_m2: area,
      components: [
        ...(installedParts ?? [{name: "thermal_heaters_exchangers_pump_transport_filled", kg: p.thermal_filled_fixed_kg, basis: p.thermal_fixed_basis}]),
        {name: "dedicated_thermal_radiator_filled", kg: area * rad.assembly_kg_m2, basis: "estimated filled panel mass; unverified radiator environment/geometry"},
        {name: "dedicated_thermal_battery", kg: batteryKg, basis: "pack specific energy/rate/derating assumptions; no shared bus credit"},
        {name: "dedicated_thermal_power_conditioner", kg: conditionerKg, basis: "estimate"}]
    };
  }
  const sizing = hardwareFor(p.sizing_engine_heat_w);
  const selectedCases = cases.filter(c => c.engine_heat_w <= p.sizing_engine_heat_w);
  // Fixed retained mass uses the highest initial He among vapor-curve variants;
  // lower actual He loads require equivalent real trim, not a changed trajectory.
  const retainedCase = selectedCases.reduce((a, b) => a.total_retained_helium_kg > b.total_retained_helium_kg ? a : b);
  const padEnergy = SUM(liquids.map(l => {
    const cp = properties.vapor[l.fluid].cp_j_kg_k_coefficients;
    return l.loaded_kg * (cp[0] * (p.pad_initial_hot_liquid_k - p.liquid_target_k)
      + cp[1] / 2 * (p.pad_initial_hot_liquid_k ** 2 - p.liquid_target_k ** 2));
  }));
  const result = {status: "controlled_path_requirements_only", operational_thermal_continuity_established: false,
    model: "phase-resolved controlled isothermal energy demand; not a transient wall/gas/actuator simulation",
    electrical_energy_scope: installed ? "saved flight plus explicit post-capture conditioning; external service required thereafter" : "saved flight only",
    aggregate_ua_scope: installed ? "inherited direct-to-radiator reference lower bounds only; use installed_hardware.loop for finite coolant-interface requirements" : "direct-to-radiator reference requirements",
    external_pad_conditioning_required: true,
    release_condition: "external pad service establishes liquid/tank equilibrium at LP target and helium at HP reference, and charges dedicated battery before lift; pad plant not carried or qualified",
    target_lp_k: p.liquid_target_k, target_hp_k: p.hp_reference_k, cases, sizing,
    alternatives: p.engine_heat_cases_w.map(hardwareFor),
    retained_helium_kg: retainedCase.total_retained_helium_kg, initial_tank_helium_kg: retainedCase.initial_tank_helium_kg,
    initial_ullage_l: retainedCase.initial_ullage_l,
    low_pressure_line_helium_kg: lpLineMass, high_pressure_helium_kg: hpMass0,
    maximum_reference_pressure_bar: Math.max(...cases.map(c => c.reference_pressure_max_bar)),
    minimum_reference_pressure_bar: Math.min(...cases.map(c => c.reference_pressure_min_bar)),
    residual_allocation_valid: cases.every(c => c.inventory.every(i => i.allocation_fits)),
    required_hp_gas_wall_ua_w_k: Math.max(...cases.map(c => c.hp_gas_peak_heat_w)) / p.gas_wall_allowable_approach_k,
    required_liquid_heating_ua_w_k_each: Math.max(...cases.map(c => c.liquid_heater_peak_w_each)) / p.liquid_heater_approach_k,
    required_gas_conditioner_ua_w_k_each: Math.max(...cases.map(c => c.gas_conditioner_peak_w_each)) / (p.liquid_target_k - p.tracking_tolerance_k - rad.skin_temperature_k),
    required_cooling_ua_w_k: Math.max(...cases.map(c => c.peak_rejection_w)) / (p.liquid_target_k - p.tracking_tolerance_k - rad.skin_temperature_k),
    radiator_net_w_m2: radiatorNet,
    radiator_planet_view_zero_capacity: (radiatorEmission - rad.solar_absorptivity * rad.solar_flux_bound_w_m2)
      / (rad.emissivity * rad.planet_ir_bound_w_m2 + rad.solar_absorptivity * rad.planet_albedo_bound * rad.solar_flux_bound_w_m2),
    pad_liquid_only_cooldown_energy_wh: padEnergy / 3600,
    pad_liquid_only_average_cooling_w_over_alignment: padEnergy / mission.launch_wait_seconds,
    unresolved: p.unresolved};
  if (installed) result.installed_hardware = assessThermalHardware(context, result, installed, p);
  return result;
}
