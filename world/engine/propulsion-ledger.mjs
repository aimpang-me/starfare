// Diagnostic resource accounting. No trajectory integration or live game imports.
const G0 = 9.80665, DAY = 86400, EPS = 1e-8;

/** @typedef {{kind:'known', value:number, source:string} |
 * {kind:'missing', source:string}} Measurement */
/** @typedef {{id:string, mass_kg:Measurement}} Payload */
/** @typedef {{power_w:number, isp_s:number, efficiency:number, source:string}} Point */
/** @typedef {{phase:'departure'|'capture', dv_mps:number, radius_au:number,
 * point:Point|null, extra_load_w:Measurement}} Burn */
/** @typedef {{id:string, from:string, to:string, depart_jd:number,
 * arrive_jd:number, burns:[Burn,Burn]}} Leg */
/** @typedef {{at:string, board:Payload[], alight:string[], refuel_kg:number}} Stop */
/** @typedef {{id:string, vehicle:{id:string, dry_kg:number,
 * additional_mass_kg:Measurement, xenon_capacity_kg:number,
 * power:{kind:'solar'|'constant', output_w:number, housekeeping_w:number}},
 * initial_xenon_kg:Measurement, reserve_kg:Measurement,
 * initial_payloads:Payload[], stops:Stop[], legs:Leg[],
 * context:{source:string, limitations:string[]}} Itinerary */

function number(value, path, minimum = 0) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum)
    throw new TypeError(path + " must be a finite number >= " + minimum);
  return value;
}
function text(value, path) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(path + " must be a nonempty string");
  return value;
}
function array(value, path) {
  if (!Array.isArray(value)) throw new TypeError(path + " must be an array");
  return value;
}
function finite(value, operation) {
  if (!Number.isFinite(value)) throw new RangeError(operation + " exceeds the numeric range of the ledger");
  return value;
}
function unionPaths(...groups) { return [...new Set(groups.flat())]; }
function quantity(value, missing = []) {
  return { value: finite(value, "ledger quantity"), basis: missing.length ? "lower_bound" : "model_value", missing };
}

function alternativePoints(context, legIds) {
  return array(context.operating_point_alternatives ?? [], "context.operating_point_alternatives").map((row) => {
    if (!legIds.has(row.leg) || !["departure", "capture"].includes(row.phase)) throw new TypeError("operating point observation has an unknown burn");
    const base = { leg: row.leg, phase: row.phase, source: text(row.source, "operating point observation source") };
    if (row.supported_points === null) return { ...base, supported_points: null, reason: text(row.reason, "missing point observation reason") };
    const available = row.available_thruster_w;
    if (typeof available !== "number" || !Number.isFinite(available)) throw new TypeError("observed available power must be finite");
    return { ...base, available_thruster_w: available, supported_points: array(row.supported_points, "supported_points").map((point) => {
      number(point.power_w, "reference power", Number.MIN_VALUE); number(point.isp_s, "reference Isp", Number.MIN_VALUE);
      number(point.efficiency, "reference efficiency", Number.MIN_VALUE);
      if (point.efficiency > 1) throw new TypeError("reference efficiency cannot exceed 1");
      return { power_w: point.power_w, isp_s: point.isp_s, efficiency: point.efficiency };
    }) };
  });
}

// Validation makes fresh records; no caller-owned object is modified.
function normalize(input) {
  const missing = [], measurement = (m, path) => {
    if (m?.kind === "known") return { value: number(m.value, path), missing: [], source: text(m.source, path + ".source") };
    if (m?.kind === "missing") {
      const source = text(m.source, path + ".source");
      missing.push({ path, source });
      // Zero is the mathematical lower bound of an undeclared nonnegative load,
      // never a declared input value or an observed mass.
      return { value: 0, missing: [path], source };
    }
    throw new TypeError(path + " must explicitly be known or missing");
  };
  text(input?.id, "id");
  const v = input.vehicle, p = v?.power;
  text(v?.id, "vehicle.id");
  number(v.dry_kg, "vehicle.dry_kg", Number.MIN_VALUE);
  number(v.xenon_capacity_kg, "vehicle.xenon_capacity_kg");
  if (p?.kind !== "solar" && p?.kind !== "constant") throw new TypeError("vehicle.power.kind must be solar or constant");
  number(p.output_w, "vehicle.power.output_w");
  number(p.housekeeping_w, "vehicle.power.housekeeping_w");
  const fixed = measurement(v.additional_mass_kg, "vehicle.additional_mass_kg");
  const initial = measurement(input.initial_xenon_kg, "initial_xenon_kg");
  const reserve = measurement(input.reserve_kg, "reserve_kg");
  const payload = (load, path) => ({ id: text(load?.id, path + ".id"), mass: measurement(load.mass_kg, path + ".mass_kg") });
  const initialPayloads = array(input.initial_payloads, "initial_payloads").map((load, i) => payload(load, "initial_payloads." + i));
  const stops = array(input.stops, "stops").map((s, i) => ({
    at: text(s?.at, "stops." + i + ".at"),
    board: array(s.board, "stops." + i + ".board").map((load, j) => payload(load, "stops." + i + ".board." + j)),
    alight: array(s.alight, "stops." + i + ".alight").map((id) => text(id, "alight payload id")),
    refuel_kg: number(s.refuel_kg, "stops." + i + ".refuel_kg"),
  }));
  const ids = new Set();
  const legs = array(input.legs, "legs").map((leg, i) => {
    const path = "legs." + i, id = text(leg?.id, path + ".id");
    if (ids.has(id)) throw new TypeError("duplicate leg id " + id);
    ids.add(id);
    text(leg.from, path + ".from"); text(leg.to, path + ".to");
    number(leg.depart_jd, path + ".depart_jd"); number(leg.arrive_jd, path + ".arrive_jd");
    if (leg.arrive_jd < leg.depart_jd) throw new TypeError(path + " arrives before departure");
    if (i && leg.depart_jd < input.legs[i - 1].arrive_jd) throw new TypeError(path + " overlaps the previous flight");
    const burns = array(leg.burns, path + ".burns");
    if (burns.length !== 2) throw new TypeError(path + " needs departure and capture burn slots");
    return { id, from: leg.from, to: leg.to, depart_jd: leg.depart_jd, arrive_jd: leg.arrive_jd,
      burns: burns.map((burn, j) => {
        const bp = path + ".burns." + j, phase = j ? "capture" : "departure";
        if (burn.phase !== phase) throw new TypeError(bp + " must be " + phase);
        number(burn.dv_mps, bp + ".dv_mps"); number(burn.radius_au, bp + ".radius_au", Number.MIN_VALUE);
        let point = null;
        if (burn.dv_mps > 0) {
          const pt = burn.point;
          number(pt?.power_w, bp + ".point.power_w", Number.MIN_VALUE);
          number(pt.isp_s, bp + ".point.isp_s", Number.MIN_VALUE);
          number(pt.efficiency, bp + ".point.efficiency", Number.MIN_VALUE);
          if (pt.efficiency > 1) throw new TypeError(bp + " efficiency cannot exceed 1");
          point = { power_w: pt.power_w, isp_s: pt.isp_s, efficiency: pt.efficiency, source: text(pt.source, bp + ".point.source") };
        } else if (burn.point !== null) throw new TypeError(bp + " zero burn must have point null");
        return { phase, dv_mps: burn.dv_mps, radius_au: burn.radius_au, point,
          extra: measurement(burn.extra_load_w, bp + ".extra_load_w") };
      }),
    };
  });
  if (!legs.length || stops.length !== legs.length + 1) throw new TypeError("one more stop than legs is required");
  legs.forEach((leg, i) => {
    if (leg.from !== stops[i].at || leg.to !== stops[i + 1].at) throw new TypeError("leg " + leg.id + " does not connect its stops");
  });
  const context = input.context;
  text(context?.source, "context.source");
  const limitations = array(context.limitations, "context.limitations").map((s) => text(s, "context limitation"));
  return { id: input.id, vehicle: { id: v.id, dry_kg: v.dry_kg, xenon_capacity_kg: v.xenon_capacity_kg, power: { ...p } },
    fixed, initial, reserve, initialPayloads, stops, legs, missing,
    context: { source: context.source, limitations, alternatives: alternativePoints(context, ids) } };
}

function loadStates(plan) {
  const aboard = new Map(), seen = new Set(), states = [];
  function board(load) {
    if (seen.has(load.id)) throw new TypeError("payload " + load.id + " is loaded more than once");
    seen.add(load.id); aboard.set(load.id, load.mass);
  }
  plan.initialPayloads.forEach(board);
  plan.stops.forEach((stop, i) => {
    stop.alight.forEach((id) => {
      if (!aboard.delete(id)) throw new TypeError("payload " + id + " cannot alight when not aboard at stop " + i);
    });
    stop.board.forEach(board);
    const loads = [...aboard.values()];
    states.push({ payload_ids: [...aboard.keys()], mass: finite(loads.reduce((n, m) => n + m.value, 0), "payload sum"),
      missing: unionPaths(...loads.map((m) => m.missing)) });
  });
  return states;
}

function inertMass(plan, state) {
  return { value: finite(plan.vehicle.dry_kg + plan.fixed.value + state.mass, "inert mass"),
    missing: unionPaths(plan.fixed.missing, state.missing) };
}
function engine(burn) {
  if (!burn.point) return { ve: 0, thrust_n: 0, mass_flow_kg_s: 0 };
  const ve = finite(burn.point.isp_s * G0, "exhaust velocity");
  const thrust = finite(2 * burn.point.efficiency * burn.point.power_w / ve, "thrust");
  return { ve, thrust_n: thrust, mass_flow_kg_s: finite(thrust / ve, "mass flow") };
}

function requiredFuel(plan, states) {
  let fuel = plan.reserve.value, paths = [...plan.reserve.missing];
  const beforeStops = new Array(plan.stops.length);
  const departureFuel = new Array(plan.legs.length), burnsByLeg = new Array(plan.legs.length);
  // The reserve is protected through the flight; a final-pad refill cannot
  // retroactively satisfy an arrival reserve or power a preceding capture.
  beforeStops[plan.legs.length] = quantity(fuel, paths);
  for (let i = plan.legs.length - 1; i >= 0; i--) {
    const inert = inertMass(plan, states[i]);
    const burns = [];
    for (const burn of [...plan.legs[i].burns].reverse()) {
      const performance = engine(burn);
      const spent = burn.dv_mps === 0 ? 0 : finite((inert.value + fuel) * Math.expm1(burn.dv_mps / performance.ve), "required burn xenon");
      const burnPaths = spent === 0 ? [] : unionPaths(paths, inert.missing);
      const seconds = spent === 0 ? 0 : finite(spent / performance.mass_flow_kg_s, "minimum firing time");
      burns.unshift({ phase: burn.phase, xenon_kg: quantity(spent, burnPaths), firing_seconds: quantity(seconds, burnPaths) });
      fuel = finite(fuel + spent, "required xenon");
      if (spent > 0) paths = unionPaths(paths, inert.missing);
    }
    burnsByLeg[i] = burns;
    departureFuel[i] = quantity(fuel, [...paths]);
    fuel = Math.max(plan.reserve.value, fuel - plan.stops[i].refuel_kg);
    beforeStops[i] = quantity(fuel, [...paths]);
  }
  return { minimum: beforeStops[0], beforeStops, departureFuel, burnsByLeg };
}

function powerAt(plan, burn) {
  const p = plan.vehicle.power;
  const generated = finite(p.output_w / (p.kind === "solar" ? burn.radius_au ** 2 : 1), "generated power");
  const spare = finite(generated - p.housekeeping_w - burn.extra.value, "available thruster power");
  return { generator_w: generated, housekeeping_w: p.housekeeping_w,
    additional_load_w: burn.extra.missing.length ? null : burn.extra.value,
    available_thruster_w: { value: spare, basis: burn.extra.missing.length ? "upper_bound" : "model_value", missing: burn.extra.missing },
    selected_thruster_w: burn.point?.power_w ?? 0,
    shortfall_w: burn.point ? finite(Math.max(0, burn.point.power_w - spare), "thruster power shortfall") : 0,
    scope: "nominal_endpoint_only" };
}

function forward(plan, states, start, mode) {
  let fuel = start.value, paths = [...start.missing], stopped = false;
  const rows = [], findings = [], perLeg = [];
  // Unknown carried masses can reduce remaining fuel after an unloading stop.
  // Track only dependencies that have reached this row; a future unknown load
  // cannot weaken an already known failure on an earlier leg.
  const q = (value, missing = []) => ({ value: finite(value, "projected quantity"), basis: missing.length ? "optimistic_projection" : "model_value", missing });
  const certainty = (missing) => missing.length ? "conditional" : "necessary";
  const fail = (code, detail) => findings.push({ code, mode, ...detail });
  const capacity = (at, amount, missing) => {
    if (amount > plan.vehicle.xenon_capacity_kg + EPS)
      fail("tank_capacity", { certainty: missing.length ? "conditional" : "necessary", at,
        required_kg: amount, capacity_kg: plan.vehicle.xenon_capacity_kg, basis: missing.length ? "optimistic_projection" : "model_value" });
  };
  capacity("initial", fuel, paths);
  plan.stops.forEach((stop, i) => {
    const inert = inertMass(plan, states[i]);
    if (stop.refuel_kg > plan.vehicle.xenon_capacity_kg + EPS)
      fail("refuel_exceeds_capacity", { certainty: "necessary", stop: i, delivered_kg: stop.refuel_kg, capacity_kg: plan.vehicle.xenon_capacity_kg });
    if (!stopped) {
      const before = fuel;
      fuel = finite(fuel + stop.refuel_kg, "refuel inventory");
      capacity("stop:" + i, fuel, paths);
      rows.push({ kind: "stop", stop: i, at: stop.at, payload_ids: states[i].payload_ids,
        non_xenon_mass_kg: q(inert.value, inert.missing), xenon_before_kg: q(before, paths),
        xenon_added_kg: stop.refuel_kg, xenon_after_kg: q(fuel, paths) });
    } else rows.push({ kind: "stop", stop: i, at: stop.at, state: "not_evaluated_after_fuel_depletion" });
    if (i === plan.legs.length) return;
    const leg = plan.legs[i];
    let seconds = 0, energy = 0, consumed = 0, legMissing = [], complete = !stopped;
    for (const burn of leg.burns) {
      const power = powerAt(plan, burn), performance = engine(burn);
      if (power.shortfall_w > EPS) fail("thruster_power", { certainty: "necessary", leg: leg.id, phase: burn.phase, ...power });
      if (stopped) {
        rows.push({ kind: "burn", leg: leg.id, phase: burn.phase, state: "not_evaluated_after_fuel_depletion", power });
        complete = false; continue;
      }
      const before = fuel, mass = finite(inert.value + fuel, "pre-burn mass");
      const spent = burn.dv_mps === 0 ? 0 : finite(mass * -Math.expm1(-burn.dv_mps / performance.ve), "burn xenon");
      const after = fuel - spent, burnPaths = spent === 0 ? [] : unionPaths(paths, inert.missing);
      const duration = spent === 0 ? 0 : finite(spent / performance.mass_flow_kg_s, "burn duration");
      const kwh = finite((burn.point?.power_w ?? 0) * duration / 3.6e6, "burn energy");
      rows.push({ kind: "burn", leg: leg.id, phase: burn.phase,
        state: after < -EPS ? "fuel_depleted_in_projection" : "modelled", dv_mps: burn.dv_mps,
        nominal_jd: burn.phase === "departure" ? leg.depart_jd : leg.arrive_jd,
        non_xenon_mass_kg: q(inert.value, inert.missing),
        total_mass_before_kg: q(mass, unionPaths(paths, inert.missing)),
        xenon_before_kg: q(before, paths), xenon_used_kg: q(spent, burnPaths),
        xenon_after_kg: after < -EPS ? null : q(Math.max(0, after), unionPaths(paths, burnPaths)),
        point: burn.point, thrust_n: performance.thrust_n, mass_flow_kg_s: performance.mass_flow_kg_s,
        firing_seconds: q(duration, burnPaths), thruster_energy_kwh: q(kwh, burnPaths), power });
      if (after < -EPS) {
        fail("fuel_depletion", { certainty: certainty(burnPaths), leg: leg.id, phase: burn.phase, available_kg: before, requested_burn_kg: spent });
        stopped = true; complete = false; continue;
      }
      fuel = Math.max(0, after);
      paths = unionPaths(paths, burnPaths);
      if (fuel + EPS < plan.reserve.value) fail("protected_reserve", { certainty: certainty(unionPaths(paths, plan.reserve.missing)),
        leg: leg.id, phase: burn.phase, remaining_kg: fuel, reserve_kg: plan.reserve.value });
      seconds += duration; energy += kwh; consumed += spent; legMissing = unionPaths(legMissing, burnPaths);
    }
    const available = finite((leg.arrive_jd - leg.depart_jd) * DAY, "flight time");
    if (complete && seconds > available + EPS) fail("firing_exceeds_flight", { certainty: certainty(legMissing),
      leg: leg.id, firing_seconds: seconds, flight_seconds: available, basis: legMissing.length ? "optimistic_projection" : "model_value" });
    perLeg.push({ leg: leg.id, complete, flight_seconds: available,
      firing_seconds: complete ? q(seconds, legMissing) : null,
      thruster_energy_kwh: complete ? q(energy, legMissing) : null,
      xenon_used_kg: complete ? q(consumed, legMissing) : null });
  });
  const complete = !stopped, totalPaths = unionPaths(...perLeg.filter((l) => l.complete).map((l) => l.firing_seconds.missing));
  return { mode, start_xenon_kg: start, complete, rows, legs: perLeg, findings,
    totals: { declared_refuel_kg: finite(plan.stops.reduce((n, s) => n + s.refuel_kg, 0), "declared xenon sum"),
      xenon_added_kg: complete ? finite(plan.stops.reduce((n, s) => n + s.refuel_kg, 0), "delivered xenon sum") : null,
      xenon_used_kg: complete ? q(perLeg.reduce((n, l) => n + l.xenon_used_kg.value, 0), totalPaths) : null,
      thruster_energy_kwh: complete ? q(perLeg.reduce((n, l) => n + l.thruster_energy_kwh.value, 0), totalPaths) : null,
      firing_seconds: complete ? q(perLeg.reduce((n, l) => n + l.firing_seconds.value, 0), totalPaths) : null,
      final_xenon_kg: complete ? q(fuel, paths) : null } };
}

/** Whole-itinerary xenon accounting at fixed quoted operating points.
 * Missing nonnegative loads permit labelled optimistic bounds, not certification.
 * @param {Itinerary} input
 * @returns {object} New JSON-safe diagnostic report, never `verified`.
 */
export function assessItinerary(input) {
  const plan = normalize(input), states = loadStates(plan), required = requiredFuel(plan, states);
  const minimum = forward(plan, states, required.minimum, "minimum_required");
  const loaded = plan.initial.missing.length ? null : forward(plan, states, quantity(plan.initial.value), "declared_loaded");
  const findings = [...minimum.findings, ...(loaded?.findings ?? [])];
  const requirements = plan.legs.map((leg, i) => {
    const burns = required.burnsByLeg[i], seconds = burns.reduce((n, b) => n + b.firing_seconds.value, 0);
    const paths = unionPaths(...burns.map((b) => b.firing_seconds.missing));
    const available = finite((leg.arrive_jd - leg.depart_jd) * DAY, "flight time"), fuel = required.departureFuel[i];
    if (seconds > available + EPS) findings.push({ code: "minimum_firing_exceeds_flight", certainty: "necessary",
      leg: leg.id, minimum_firing_seconds: seconds, flight_seconds: available, basis: paths.length ? "lower_bound" : "model_value" });
    if (fuel.value > plan.vehicle.xenon_capacity_kg + EPS) findings.push({ code: "minimum_tank_capacity", certainty: "necessary",
      leg: leg.id, minimum_required_kg: fuel.value, capacity_kg: plan.vehicle.xenon_capacity_kg, basis: fuel.basis });
    return { leg: leg.id, xenon_at_departure_kg: fuel, burns, minimum_firing_seconds: quantity(seconds, paths), flight_seconds: available };
  });
  if (!plan.initial.missing.length && plan.initial.value + EPS < required.minimum.value)
    findings.push({ code: "initial_fuel_shortfall", certainty: "necessary", available_kg: plan.initial.value, minimum_required_kg: required.minimum.value,
      basis: required.minimum.basis });
  if (!plan.initial.missing.length && plan.initial.value + EPS < plan.reserve.value)
    findings.push({ code: "protected_reserve", certainty: "necessary", at: "initial", remaining_kg: plan.initial.value, reserve_kg: plan.reserve.value });
  if (!plan.initial.missing.length && plan.initial.value > plan.vehicle.xenon_capacity_kg + EPS)
    findings.push({ code: "loaded_tank_capacity", certainty: "necessary", available_kg: plan.initial.value, capacity_kg: plan.vehicle.xenon_capacity_kg });
  return { format: "starfare.propulsion-ledger/1", id: plan.id,
    status: findings.some((f) => f.certainty === "necessary") ? "infeasible" : "unverified", diagnostic_only: true,
    vehicle: plan.vehicle.id, source: plan.context.source,
    operating_point_alternatives: plan.context.alternatives,
    minimum_initial_xenon_kg: required.minimum, required_before_stops_kg: required.beforeStops, requirements,
    minimum_loading: minimum, declared_loading: loaded,
    missing_inputs: plan.missing, findings,
    limitations: [...plan.context.limitations,
      "Fixed quoted-point impulse budget; finite-thrust trajectory and maneuver placement are not solved.",
      "Power is sampled at nominal departure/capture only; continuous solar power, storage, eclipses and coast loads are not integrated.",
      "Additional nonnegative mass/load and reserve values remain missing until explicitly declared.",
      "This ledger consumes xenon only; other carried propellants must be included in additional mass."] };
}
