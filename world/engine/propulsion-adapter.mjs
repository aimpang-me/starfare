// Translate full current-engine plans; never reconstruct burns from slim receipts.
const POINT_SOURCE = "NASA/CR-1999-209162 Table 1, https://ntrs.nasa.gov/api/citations/20000003023/downloads/20000003023.pdf#page=26";
const NSTAR_POINTS = [
  { power_w: 2310, isp_s: 3280, efficiency: 0.64 },
  { power_w: 2060, isp_s: 3190, efficiency: 0.63 },
  { power_w: 1480, isp_s: 3180, efficiency: 0.61 },
  { power_w: 1000, isp_s: 2700, efficiency: 0.53 },
  { power_w: 490, isp_s: 1950, efficiency: 0.38 },
];
const known = (value, source) => ({ kind: "known", value, source });
const missing = (source) => ({ kind: "missing", source });
const value = (n, path) => {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) throw new TypeError(path + " must be a finite nonnegative number from a full plan");
  return n;
};
function string(s, path) {
  if (typeof s !== "string" || !s.trim()) throw new TypeError(path + " must be a nonempty string");
  return s;
}
function ids(items, path) {
  if (!Array.isArray(items)) throw new TypeError(path + " must be an array");
  return items.map((id) => string(id, path));
}
function record(item, path) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError(path + " must be an object");
  return item;
}

/** Convert already computed, exact engine plans into the diagnostic ledger input.
 * The quoted operating point is retained even if unsupported at arrival.
 * Sourced alternative points are information, never selected or applied here.
 * @param {object} E Already loaded engine with R.CAR, SHIP_CLASSES and placeState.
 * @param {{id:string, ship:string, stops:object[], plans:object[], declarations?:object}} request
 */
export function adaptFullPlans(E, request) {
  const id = string(request?.id, "id"), ship = string(request.ship, "ship");
  const car = E?.R?.CAR?.[ship], spec = car && E.SHIP_CLASSES[car.ship_class];
  if (!spec || !spec.ion) throw new TypeError("a known current ion fleet ship is required");
  const plans = request.plans, stops = request.stops, declarations = record(request.declarations ?? {}, "declarations");
  if (!Array.isArray(plans) || !plans.length || !Array.isArray(stops) || stops.length !== plans.length + 1)
    throw new TypeError("provide full plans and one more stop than plans");
  const allowed = new Set(["additional_mass_kg", "initial_xenon_kg", "reserve_kg", "initial_payloads", "payload_mass_kg", "refuel_kg_by_stop", "power_loads_w"]);
  for (const key of Object.keys(declarations)) if (!allowed.has(key)) throw new TypeError("unknown declaration " + key);
  const payloadMass = record(declarations.payload_mass_kg ?? {}, "payload_mass_kg");
  const refuels = record(declarations.refuel_kg_by_stop ?? {}, "refuel_kg_by_stop");
  if (declarations.power_loads_w !== undefined) {
    if (!Array.isArray(declarations.power_loads_w) || declarations.power_loads_w.length !== plans.length)
      throw new TypeError("power_loads_w must have one entry per full plan");
    declarations.power_loads_w.forEach((loads, i) => {
      record(loads, "power_loads_w." + i);
      for (const key of Object.keys(loads)) if (key !== "departure" && key !== "capture") throw new TypeError("unknown burn phase " + key);
    });
  }
  for (const key of Object.keys(refuels)) {
    if (!/^(0|[1-9]\d*)$/.test(key) || +key >= stops.length) throw new TypeError("invalid refuelling stop " + key);
    value(refuels[key], "refuel_kg_by_stop." + key);
  }
  const limitations = [
    "Assessment of the original impulsive plans at their quoted operating points, not a newly planned flight.",
    "Class mass/power data retains its documented fictional and optimistic assumptions.",
    "No automatic station refuelling. Only explicitly supplied stop quantities are added.",
    "Carried hydrazine, cabin, equipment, tank additions and reserves not included in dry mass require declarations.",
    "Gameplay holding charges and percentage correction penalties have no physical maneuver budget here.",
    "PPU/conversion losses and life-support electrical demand belong in declared additional electrical loads.",
  ];
  const alternatives = [];
  const ledgerStops = stops.map((stop, i) => ({
    at: string(stop?.at, "stops." + i + ".at"),
    board: ids(stop.board ?? [], "stops." + i + ".board").map((booking) => ({ id: booking,
      mass_kg: payloadMass[booking] ?? missing("declared total passenger/luggage mass for booking " + booking) })),
    alight: ids(stop.alight ?? [], "stops." + i + ".alight"),
    refuel_kg: Object.hasOwn(refuels, i) ? refuels[i] : 0,
  }));
  const usedBookings = new Set(ledgerStops.flatMap((stop) => stop.board.map((load) => load.id)));
  for (const booking of Object.keys(payloadMass)) if (!usedBookings.has(booking)) throw new TypeError("payload mass provided for unboarded booking " + booking);
  const legs = plans.map((plan, i) => {
    const path = "plans." + i;
    if (!plan || plan.error) throw new TypeError(path + " must be a successful full plan");
    const from = plan.origin?.place, to = plan.dest?.place;
    if (!from || !to || plan.origin.ship || plan.dest.ship) throw new TypeError(path + " requires full place endpoints; slim/ship-relative records are unsupported");
    if (from !== ledgerStops[i].at || to !== ledgerStops[i + 1].at) throw new TypeError(path + " endpoints do not match stops");
    const depart = value(plan.dep_jd, path + ".dep_jd"), arrive = value(plan.arr_jd, path + ".arr_jd");
    const depDv = value(plan.dv_dep_kms, path + ".dv_dep_kms"), arrDv = value(plan.dv_arr_kms, path + ".dv_arr_kms");
    const total = value(plan.dv_total_kms, path + ".dv_total_kms");
    if (Math.abs(total - depDv - arrDv) > 1e-9 * Math.max(1, total)) throw new TypeError(path + " total delta-v does not equal its burns");
    if (plan.arrive_mode !== "capture" && plan.arrive_mode !== "none") throw new TypeError(path + " has no explicit arrival mode");
    if (plan.arrive_mode === "none") {
      if (arrDv !== 0) throw new TypeError(path + " has a capture burn despite no-capture arrival mode");
      limitations.push(path + ": arrival capture is unpriced; this is not a captured rendezvous.");
    }
    const bat = plan.battery;
    if (!bat || bat.refused || bat.class_id !== spec.id) throw new TypeError(path + " needs a full battery record for ship class " + spec.id);
    let point = null;
    if (total > 0) {
      const published = NSTAR_POINTS.find((p) => p.power_w === bat.set_point_w && p.isp_s === bat.isp_s && p.efficiency === bat.eff);
      if (!published) throw new TypeError(path + " has no recognized exact quoted NSTAR operating point");
      point = { ...published, source: POINT_SOURCE + "; quoted in " + path + ".battery" };
    }
    const burns = [["departure", from, depart, depDv], ["capture", to, arrive, arrDv]].map(([phase, place, jd, dv]) => {
      const position = E.placeState(place, jd)?.r;
      if (!Array.isArray(position) || position.length !== 3 || !position.every((n) => typeof n === "number" && Number.isFinite(n)))
        throw new TypeError(path + " has no finite endpoint position");
      const au = value(E.R.AU_KM, "E.R.AU_KM"), radius = Math.hypot(...position) / au;
      if (!(radius > 0) || !Number.isFinite(radius)) throw new TypeError(path + " has an invalid heliocentric distance");
      const generation = spec.power_w_1au / (spec.power_mode === "constant" ? 1 : radius ** 2);
      const declaredLoad = declarations.power_loads_w?.[i]?.[phase];
      const load = declaredLoad ?? missing("additional electrical load, including conversion loss, at " + path + "." + phase);
      if (declaredLoad?.kind === "known") {
        const extra = value(declaredLoad.value, "power_loads_w." + i + "." + phase);
        alternatives.push({ leg: "leg" + i, phase, available_thruster_w: generation - spec.housekeeping_w - extra,
          source: POINT_SOURCE,
          supported_points: NSTAR_POINTS.filter((p) => p.power_w <= generation - spec.housekeeping_w - extra).map((p) => ({ ...p })) });
      } else alternatives.push({ leg: "leg" + i, phase, source: POINT_SOURCE, supported_points: null,
        reason: "additional electrical loads not declared; no alternative point selected" });
      return { phase, dv_mps: dv * 1000, radius_au: radius, point: dv === 0 ? null : { ...point }, extra_load_w: load };
    });
    return { id: "leg" + i, from, to, depart_jd: depart, arrive_jd: arrive, burns };
  });
  return {
    id, vehicle: { id: ship, dry_kg: spec.dry_kg, xenon_capacity_kg: spec.xenon_kg,
      additional_mass_kg: declarations.additional_mass_kg ?? missing("additional cabin/equipment, carried hydrazine and tank mass beyond class dry mass"),
      power: { kind: spec.power_mode === "constant" ? "constant" : "solar", output_w: spec.power_w_1au, housekeeping_w: spec.housekeeping_w } },
    initial_xenon_kg: declarations.initial_xenon_kg ?? missing("actual starting xenon load; tank capacity is not a load measurement"),
    reserve_kg: declarations.reserve_kg ?? missing("protected xenon reserve policy, including explicit zero if intended"),
    initial_payloads: declarations.initial_payloads ?? [], stops: ledgerStops, legs,
    context: { source: "current full engine plans for " + ship + " / " + spec.id,
      limitations, operating_point_alternatives: alternatives,
      initial_manifest: declarations.initial_payloads ? "explicitly supplied initial loads" : "empty initial manifest of the current parked-ship flight model" },
  };
}
