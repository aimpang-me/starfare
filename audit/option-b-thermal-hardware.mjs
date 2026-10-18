// Installed interface requirements, not measured heat-transfer performance.
const SIGMA = 5.670374419e-8;
const lmtd = (a, b) => Math.abs(a - b) < 1e-9 ? a : (a - b) / Math.log(a / b);

export function validateThermalHardware(h, reference) {
  if (h.format !== "starfare.option-b-thermal-hardware/1" || h.status !== "proposed_hardware_requirements_only") throw new Error("Unknown thermal hardware format/status");
  for (const section of [h.electrical, h.engine, h.bottle, h.loop]) for (const [key, value] of Object.entries(section)) {
    if (key === "basis") continue;
    const values = Array.isArray(value) ? value : [value];
    if (!values.length || !values.every(v => Number.isFinite(v) && v > 0)) throw new Error("Invalid thermal hardware value: " + key);
  }
  const {loop: l, bottle: b, engine: e} = h;
  if (!(reference.radiator.skin_temperature_k < l.supply_k && l.supply_k < l.return_k
    && l.return_k < reference.liquid_target_k - reference.tracking_tolerance_k)
    || !(reference.hp_reference_k < b.inner_wall_k && b.inner_wall_k < b.heater_source_k && b.heater_source_k < b.catalog_maximum_k)
    || l.minimum_wire_to_fluid_efficiency > 1 || b.withdrawal_imbalance_factor < 1
    || e.radiation_allocation_w + e.solid_conduction_allocation_w + e.plume_penetration_other_allocation_w !== reference.sizing_engine_heat_w)
    throw new Error("Inconsistent installed thermal requirements");
  const names = new Set();
  if (!h.components?.length) throw new Error("No installed thermal components");
  for (const c of h.components) {
    if (!c.name || names.has(c.name) || !["ship", "helium_bottle", "propellant_tank", "coolant_fill"].includes(c.quantity_basis)
      || !Number.isFinite(c.kg_each) || c.kg_each <= 0 || !c.basis) throw new Error("Invalid or duplicate installed thermal component");
    names.add(c.name);
  }
  if (h.components.filter(c => c.quantity_basis === "coolant_fill").length !== 1
    || h.components.find(c => c.quantity_basis === "coolant_fill").kg_each !== l.coolant_fill_density_max_kg_l
    || !Object.values(h.cargo_targets_kg).every(roles => Object.values(roles).every(n => Number.isFinite(n) && n >= 0)))
    throw new Error("Invalid installed thermal mass allocation");
}

export function assessThermalHardware(context, thermal, h, reference) {
  const {helium, tanks, mission} = context, l = h.loop, b = h.bottle, e = h.engine;
  const sum = xs => xs.reduce((a, v) => a + v, 0);
  const massFlow = l.design_heat_transport_w / (l.coolant_cp_min_j_kg_k * (l.return_k - l.supply_k));
  const volumeFlow = massFlow / l.coolant_density_flow_kg_m3;
  const pipeArea = Math.PI * l.pipe_id_m ** 2 / 4;
  const speed = volumeFlow / pipeArea;
  const reynolds = l.coolant_density_flow_kg_m3 * speed * l.pipe_id_m / l.coolant_viscosity_design_pa_s;
  const friction = Math.max(l.darcy_factor_floor, 64 / reynolds);
  const pressure = (friction * l.pipe_length_m / l.pipe_id_m + l.minor_loss_k) * l.coolant_density_flow_kg_m3 * speed ** 2 / 2
    + l.all_nonpipe_pressure_allowance_pa;
  const pump = pressure * volumeFlow / l.minimum_wire_to_fluid_efficiency;
  const requiredVoidL = pipeArea * l.pipe_length_m * 1000 + l.nonpipe_transport_void_l;
  const radiatorDt = lmtd(l.return_k - reference.radiator.skin_temperature_k, l.supply_k - reference.radiator.skin_temperature_k);
  const liquidDt = lmtd(reference.liquid_target_k - reference.tracking_tolerance_k - l.supply_k,
    reference.liquid_target_k - reference.tracking_tolerance_k - l.return_k);
  const hpHeat = Math.max(...thermal.cases.map(c => c.hp_gas_peak_heat_w));
  const worstBottleHeat = hpHeat / helium.count * b.withdrawal_imbalance_factor;
  const gasUa = worstBottleHeat / (b.inner_wall_k - reference.hp_reference_k);
  const outsideUa = worstBottleHeat / (b.heater_source_k - b.inner_wall_k);
  const wholeUa = 1 / (1 / gasUa + 1 / outsideUa);
  const diameter = Math.cbrt(6 * (helium.volume_l / helium.count / 1000) / Math.PI), area = Math.PI * diameter ** 2;
  const gasK = b.helium_k_w_m_k_diagnostic;
  const radiationPerEffectiveM2 = SIGMA * (e.maximum_hot_surface_k ** 4 - reference.liquid_target_k ** 4);
  const solarCold = Math.min(reference.liquid_target_k, reference.hp_reference_k);
  const firingSeconds = sum(Object.entries(mission.burn_schedule_seconds).filter(([name]) => name !== "coast").map(([, s]) => s));
  const draw = Math.max(...thermal.cases.map(c => c.delivered_helium_kg));
  const mass0 = thermal.high_pressure_helium_kg;
  const ideal = count => {
    const initial = mass0 / helium.count * count;
    const fraction = 1 - draw * b.withdrawal_imbalance_factor / initial;
    return {bottles: count, temperature_k: fraction > 0 ? reference.hp_reference_k * fraction ** (2 / 3) : null};
  };
  return {
    status: "requirements_only_unproven_exposure_and_transfer", operational_continuity_established: false,
    installed_wall_coolant_actuator_transients_modeled: false,
    additional_wall_loop_startup_energy_j: null,
    loop: {flow_kg_s: massFlow, flow_l_min: volumeFlow * 60000, pipe_velocity_m_s: speed, reynolds,
      darcy_factor: friction, estimated_pressure_drop_pa: pressure, required_pump_electrical_w: pump,
      rated_pump_w: h.electrical.pump_w, required_external_filled_volume_l: requiredVoidL,
      transport_coolant_mass_kg: l.transport_coolant_l * l.coolant_fill_density_max_kg_l,
      hydraulic_design_screen_pass: pressure <= l.pressure_drop_ceiling_pa && pump <= h.electrical.pump_w && requiredVoidL <= l.transport_coolant_l,
      hydraulic_evidence_status: "arithmetic_within_declared_allowances_only; all nonpipe pressure losses and pump curve remain unmeasured",
      measured_total_pressure_drop_pa: null,
      heat_transport_capacity_screen_pass: thermal.sizing.design_radiator_rejection_w <= l.design_heat_transport_w,
      tank_to_coolant_lmtd_k: liquidDt, coolant_to_radiator_lmtd_k: radiatorDt,
      required_radiator_interface_ua_w_k_at_transport_screen: l.design_heat_transport_w / radiatorDt,
      required_liquid_jacket_ua_w_k_each_fluid: Math.max(...thermal.cases.map(c => c.liquid_cooler_peak_w_each))
        * (1 + reference.radiator.capacity_margin_fraction) / liquidDt,
      required_gas_conditioner_ua_w_k_each: Math.max(...thermal.cases.map(c => c.gas_conditioner_peak_w_each))
        * (1 + reference.radiator.capacity_margin_fraction) / (reference.liquid_target_k - reference.tracking_tolerance_k - l.return_k),
      gas_conditioner_ua_basis: "conservative minimum approach: gas >= LP minimum temperature, coolant <= return temperature everywhere; cooling cases only; actual gas/coolant branch temperatures and arrangement unverified",
      available_measured_jacket_ua_w_k: null, available_measured_radiator_ua_w_k: null},
    bottle: {peak_heat_w: hpHeat, worst_bottle_heat_w: worstBottleHeat,
      minimum_gas_side_ua_w_k_each: gasUa, minimum_source_contact_wall_ua_w_k_each: outsideUa,
      minimum_overall_source_to_gas_ua_w_k_each: wholeUa, effective_sphere_diameter_m: diameter,
      minimum_gas_side_nusselt_diagnostic: gasUa * diameter / (area * gasK),
      nusselt_diagnostics: b.gas_nu_diagnostic_cases.map(nu => ({nu, gas_side_ua_w_k_each: area * gasK * nu / diameter})),
      available_measured_gas_side_ua_w_k: null, available_measured_source_wall_ua_w_k: null,
      measured_wall_heat_capacity_j_k: null, startup_wall_gas_temperature_response: null,
      acceleration_m_s2: {departure: context.chemical.total_thrust_n / mission.departure_mass_kg, arrival: context.chemical.total_thrust_n / mission.arrival_mass_kg, coast: 0},
      ideal_adiabatic_diagnostic: Array.from({length: 8}, (_, i) => ideal(i + 1)),
      ideal_diagnostic_limit: "not an EOS/transient acceptance model; zero help from wall, +20% withdrawal case; external cooling can be worse; regulator inlet temperature and pressure/imbalance remain unverified"},
    exposure: {installed_engine_heat_upper_bound_w: null, plume_heating_upper_bound_w: null,
      hot_surface_temperature_assumption_k: e.maximum_hot_surface_k,
      required_sum_emissivity_area_view_m2: e.radiation_allocation_w / radiationPerEffectiveM2,
      required_total_solid_conductance_w_k: e.solid_conduction_allocation_w / (e.maximum_hot_surface_k - solarCold),
      combined_firing_heat_sensitivity_j: reference.sizing_engine_heat_w * firingSeconds,
      first_cutoff_coast_heat_sensitivity_j: reference.sizing_engine_heat_w * e.cooldown_time_constant_s * (1 - Math.exp(-mission.burn_schedule_seconds.coast / e.cooldown_time_constant_s)),
      capture_soak_heat_sensitivity_j: reference.sizing_engine_heat_w * e.cooldown_time_constant_s * (1 - Math.exp(-e.post_capture_conditioning_s / e.cooldown_time_constant_s)),
      heat_at_post_capture_handover_w: reference.sizing_engine_heat_w * Math.exp(-e.post_capture_conditioning_s / e.cooldown_time_constant_s),
      model: "all four engines combined; full sensitivity heat while firing, exp(-time_since_cutoff/tau) during coast and postcapture; no instantaneous cooldown, no qualified attenuation"}
  };
}
