// Pure requirements assessment; the ship-budget CLI remains the only mass ledger.
export function validateFeedProposal(p) {
  if (p.format !== "starfare.option-b-feed-proposal/1" || p.status !== "requirements_only") throw new Error("Unknown feed proposal format/status");
  const required = {
    pressure_requirements: "measured_tank_burn_min_bar measured_tank_burn_max_bar sensor_error_bound_bar burn_transient_bound_bar helium_regulator_count helium_regulator_inlet_min_bar helium_regulator_inlet_max_bar helium_regulator_control_min_bar helium_regulator_control_max_bar helium_regulator_lockup_max_bar helium_regulator_outlet_meop_min_bar helium_regulator_required_flow_g_s_each helium_flow_margin_fraction helium_density_flow_bound_kg_m3 helium_flow_minimum_gas_temperature_k helium_flow_density_reference_pressure_bar helium_flow_density_reference_kg_m3 minimum_pressure_loss_bar",
    hydraulics: "header_length_m header_internal_diameter_m header_minor_loss_k main_branch_length_m main_branch_internal_diameter_m main_branch_minor_loss_k rcs_branch_length_m rcs_branch_internal_diameter_m rcs_branch_minor_loss_k darcy_friction_factor_bound dynamic_viscosity_bound_pa_s fixed_pmd_filter_loss_bound_bar maximum_acceleration_head_length_m other_wet_component_volume_l_each_fluid additional_low_pressure_helium_volume_l additional_high_pressure_helium_volume_l",
    flow_catalog: "main_max_kg_s_each main_max_thrust_n_each main_of_min main_of_max rcs_max_kg_s_each rcs_max_thrust_n_each rcs_of_min rcs_of_max"
  };
  for (const [group, keys] of Object.entries(required)) {
    for (const key of keys.split(" ")) if (!Number.isFinite(p[group]?.[key]) || p[group][key] < 0)
      throw new Error("Invalid numeric feed requirement: " + group + "." + key);
  }
  if (p.pressure_requirements.minimum_pressure_loss_bar !== 0 || p.pressure_requirements.helium_regulator_count !== 2
    || p.pressure_requirements.measured_tank_burn_min_bar >= p.pressure_requirements.measured_tank_burn_max_bar
    || p.hydraulics.header_internal_diameter_m <= 0 || p.hydraulics.main_branch_internal_diameter_m <= 0
    || p.hydraulics.rcs_branch_internal_diameter_m <= 0 || p.hydraulics.dynamic_viscosity_bound_pa_s <= 0
    || p.hydraulics.darcy_friction_factor_bound <= 0 || !p.missing_evidence?.length
    || !p.dry_additions?.every(x => typeof x.name === "string" && Number.isFinite(x.kg) && x.kg >= 0)
    || !["cargo", "passenger"].every(role => Number.isFinite(p.retained_common_feed_estimate_kg?.[role]) && p.retained_common_feed_estimate_kg[role] >= 0))
    throw new Error("Inconsistent feed requirements");
  for (const targets of Object.values(p.cargo_targets_kg)) for (const [role, kg] of Object.entries(targets))
    if (!["cargo", "passenger"].includes(role) || !Number.isFinite(kg) || kg < 0) throw new Error("Invalid feed proposal payload");
}

const pipeVolumeL = (length, diameter) => Math.PI * diameter ** 2 / 4 * length * 1000;
function wetVolumeL(p, hardware, chemical) {
  const h = p.hydraulics;
  return pipeVolumeL(h.header_length_m, h.header_internal_diameter_m)
    + chemical.engine_count * pipeVolumeL(h.main_branch_length_m, h.main_branch_internal_diameter_m)
    + hardware.rcs_count * pipeVolumeL(h.rcs_branch_length_m, h.rcs_branch_internal_diameter_m)
    + h.other_wet_component_volume_l_each_fluid;
}

export function feedAllocation(role, p, hardware, chemical) {
  const eos = hardware.helium_eos, wet = wetVolumeL(p, hardware, chemical);
  // Wet-line liquid is already in the loaded propellant. Moving it out of tanks
  // increases initial ullage; add its helium as well as new gas-line precharge.
  const lowGas = (2 * wet + p.hydraulics.additional_low_pressure_helium_volume_l) / 1000 * eos.tank_gas.density_kg_m3;
  const highGas = p.hydraulics.additional_high_pressure_helium_volume_l / 1000 * eos.charge.density_kg_m3;
  return {components: [
    {name: "isolation_filters_manifolds_common_feed_integration", kg: p.retained_common_feed_estimate_kg[role],
      basis: "original common-feed estimate retained with no regulator credit"}, ...p.dry_additions],
    wet_volume_l_each_fluid: wet, additional_retained_helium_kg: lowGas + highGas,
    low_pressure_and_extra_ullage_helium_kg: lowGas, high_pressure_line_helium_kg: highGas};
}

function pressureDrop(massFlow, density, length, diameter, k, h) {
  if (!massFlow) return {bar: 0, reynolds: 0, friction_factor: 0};
  const velocity = massFlow / density / (Math.PI * diameter ** 2 / 4);
  const reynolds = density * velocity * diameter / h.dynamic_viscosity_bound_pa_s;
  const friction = Math.max(h.darcy_friction_factor_bound, 64 / reynolds);
  return {bar: (friction * length / diameter + k) * density * velocity ** 2 / 2 / 1e5,
    reynolds, friction_factor: friction};
}

export function assessFeed(budget, p, hardware, chemical, policy) {
  const r = p.pressure_requirements, h = p.hydraulics, c = p.flow_catalog;
  const allocation = feedAllocation(budget.role, p, hardware, chemical);
  // Independent fluid extrema use the appropriate main/RCS mixture endpoints.
  // They are conservative component sizing bounds, not a common engine point.
  const split = (main, rcs, fluid, worst) => fluid === "mmh"
    ? main / (1 + (worst ? c.main_of_min : chemical.oxidizer_to_fuel_mass_ratio))
      + rcs / (1 + (worst ? c.rcs_of_min : chemical.oxidizer_to_fuel_mass_ratio))
    : main * (worst ? c.main_of_max : chemical.oxidizer_to_fuel_mass_ratio) / (1 + (worst ? c.main_of_max : chemical.oxidizer_to_fuel_mass_ratio))
      + rcs * (worst ? c.rcs_of_max : chemical.oxidizer_to_fuel_mass_ratio) / (1 + (worst ? c.rcs_of_max : chemical.oxidizer_to_fuel_mass_ratio));
  const nominalMainEach = chemical.total_thrust_n / chemical.engine_count / (9.80665 * chemical.isp_s);
  const cases = [
    {name: "zero_flow", main: 0, rcs: 0, worst: false},
    {name: "single_rcs_pulse_steady_bound", main: 0, rcs: 1, worst: true},
    {name: "all_rcs_max", main: 0, rcs: hardware.rcs_count, worst: true},
    {name: "nominal_main", main: chemical.engine_count, rcs: 0, worst: false},
    {name: "max_main", main: chemical.engine_count, rcs: 0, worst: true},
    {name: "max_main_and_all_rcs", main: chemical.engine_count, rcs: hardware.rcs_count, worst: true}
  ];
  const flowCases = cases.map(state => {
    const main = state.main * (state.worst ? c.main_max_kg_s_each : nominalMainEach);
    const rcs = state.rcs * c.rcs_max_kg_s_each;
    const fluids = budget.liquids.map(liquid => {
      const mass = split(main, rcs, liquid.fluid, state.worst);
      const density = liquid.density_kg_l * 1000 / (1 + policy.maximum_liquid_volume_expansion_fraction);
      const header = pressureDrop(mass, density, h.header_length_m, h.header_internal_diameter_m, h.header_minor_loss_k, h);
      const mainBranch = pressureDrop(split(state.main ? main / state.main : 0, 0, liquid.fluid, state.worst), density,
        h.main_branch_length_m, h.main_branch_internal_diameter_m, h.main_branch_minor_loss_k, h);
      const rcsBranch = pressureDrop(split(0, state.rcs ? rcs / state.rcs : 0, liquid.fluid, state.worst), density,
        h.rcs_branch_length_m, h.rcs_branch_internal_diameter_m, h.rcs_branch_minor_loss_k, h);
      const path = header.bar + Math.max(mainBranch.bar, rcsBranch.bar) + (mass ? h.fixed_pmd_filter_loss_bound_bar : 0);
      return {fluid: liquid.fluid, mass_flow_kg_s: mass, warm_volume_flow_l_s: mass / density * 1000,
        header, main_branch: mainBranch, rcs_branch: rcsBranch, maximum_path_loss_bar: path,
        required_helium_g_s_with_margin: mass / density * r.helium_density_flow_bound_kg_m3 * 1000 * (1 + r.helium_flow_margin_fraction)};
    });
    return {name: state.name, fluids};
  });
  const maximumLoss = Math.max(...flowCases.flatMap(s => s.fluids.map(f => f.maximum_path_loss_bar)));
  const minimumRetainedMass = budget.nominal_arrival_mass_kg - budget.liquids.reduce((total, l) => total + l.contingency_kg + l.docking_reserve_kg, 0);
  const acceleration = (chemical.engine_count * c.main_max_thrust_n_each + hardware.rcs_count * c.rcs_max_thrust_n_each) / minimumRetainedMass;
  const accelerationHead = Math.max(...budget.liquids.map(l => l.density_kg_l * 1000)) * acceleration * h.maximum_acceleration_head_length_m / 1e5;
  const inletMin = r.measured_tank_burn_min_bar - r.sensor_error_bound_bar - r.burn_transient_bound_bar - maximumLoss - accelerationHead;
  const inletMax = r.measured_tank_burn_max_bar + r.sensor_error_bound_bar + r.burn_transient_bound_bar - r.minimum_pressure_loss_bar + accelerationHead;
  const maximumHelium = Math.max(...flowCases.flatMap(s => s.fluids.map(f => f.required_helium_g_s_with_margin)));
  const trappedChecks = budget.liquids.map(l => ({fluid: l.fluid, wet_line_hold_up_kg: allocation.wet_volume_l_each_fluid * l.density_kg_l,
    residual_inventory_kg: l.unusable_residual_kg, residual_covers_wet_lines: l.unusable_residual_kg >= allocation.wet_volume_l_each_fluid * l.density_kg_l}));
  const referenceAtmosphereBar = 1.01325;
  const comparison = [0, referenceAtmosphereBar].map(offset => ({
    assumed_catalog_reference: offset ? "gauge_relative_to_standard_atmosphere" : "absolute",
    main_min_absolute_bar: hardware.main_engine_inlet.minimum_bar + offset,
    main_max_absolute_bar: hardware.main_engine_inlet.maximum_bar + offset,
    interval_inside: inletMin >= hardware.main_engine_inlet.minimum_bar + offset && inletMax <= hardware.main_engine_inlet.maximum_bar + offset
      && inletMin >= hardware.rcs_thruster.inlet_min_bar + offset && inletMax <= hardware.rcs_thruster.inlet_max_bar + offset}));
  return {status: "requirements_only", operational_feed_closed: false,
    performance_status: "425N_321s_map_unverified", trajectory_applicability: "continuous_scheduled_burns_not_established",
    proposed_architecture: "separate helium regulation, low-loss liquid feed, calibrated orifices, measured pressure/thermal firing envelope; no liquid regulator or vent",
    pressure_reference: "bar absolute", firing_inlet_lower_bound_bar: inletMin, firing_inlet_upper_bound_bar: inletMax,
    minimum_mass_after_usable_reserves_kg: minimumRetainedMass, acceleration_bound_m_s2: acceleration, acceleration_head_bound_bar: accelerationHead,
    maximum_modeled_path_loss_bar: maximumLoss, required_helium_g_s_each_max: maximumHelium,
    catalog_comparison_status: "provisional_primary_catalog_bar_reference_unspecified",
    catalog_reference_alternatives: comparison,
    conditional_pressure_interval_within_catalog: comparison.every(corner => corner.interval_inside),
    conditional_regulator_flow_requirement_sufficient: maximumHelium <= r.helium_regulator_required_flow_g_s_each,
    conditional_inventory_allocation_valid: trappedChecks.every(x => x.residual_covers_wet_lines),
    conditional_gas_density_bound_covers_pressure: r.helium_density_flow_bound_kg_m3 >= r.helium_flow_density_reference_kg_m3
      && r.measured_tank_burn_max_bar + r.sensor_error_bound_bar + r.burn_transient_bound_bar <= r.helium_flow_density_reference_pressure_bar,
    uncontrolled_hot_tanks_require_no_fire: budget.tanks.some(t => t.hot_total_pressure_screen_bar > r.measured_tank_burn_max_bar),
    allocation, trappedChecks, flowCases, missing_evidence: p.missing_evidence};
}
