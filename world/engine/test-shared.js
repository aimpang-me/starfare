// node world/engine/test-shared.js : shared flights in sol-rides.js (docs/SHARED-FLIGHTS.md, build-order item 1), via the bundle.
// A plan is { stops, legs }: stops[0] is where the car is parked, each later stop names who boards and alights there.
const assert = require("assert"), R = require("./sol-page.js").R;
const END = 2461329.5 + 7000 - 1, t0 = 2461700.5, DWELL = 0.05, SEED = "2"; // SF-09 is free at t0 on seed 2
let n = 0; const ok = (name, f) => { const a = Date.now(); f(); n++; console.log("ok", name, "(" + (Date.now() - a) + " ms)"); };
// Each leg is planned on the ship for the people aboard it, as plan_leg does.
const leg = (from, to, after, aboard, car) => { const b = R.planLeg(from, to, after, "energy", END, car || "sf-09", aboard);
  return { from, to, dep_jd: b.dep_jd, arr_jd: b.arr_jd, kwh: b.battery.energy_kwh, fare: b.fare.total_usd, gate: "PASS", aboard: b.battery.aboard }; };
// Both bookings are long hauls inside Jupiter's orbit, so a Shuttle flies them. SF-09 leaves Ceres, collects Ana and
// Mateo's party of 3 at Ceres Port, lands the party at Phobos and Ana at Mars Base.
const B = R.admit(R.hailRow("1", 74)) && "s1-74"; // a party of 3, Ceres Port to Phobos
const L1 = leg("ceres", "ceres-port", t0, 0), L2 = leg("ceres-port", "phobos", L1.arr_jd + DWELL, 4), L3 = leg("phobos", "mars-base", L2.arr_jd, 1);
const POOL = { stops: [{ at: "ceres" }, { at: "ceres-port", board: ["ceres-shift", B], alight: [] }, { at: "phobos", board: [], alight: [B] },
  { at: "mars-base", board: [], alight: ["ceres-shift"] }], legs: [L1, L2, L3] };

ok("a two-booking flight checks, flies with per-booking times, and scores passengers per booking and the ship per flight", () => {
  assert.deepStrictEqual([R.BY[B].from, R.BY[B].to, R.BY[B].party, R.reach(R.BY[B]), R.reach(R.BY["ceres-shift"])], ["ceres-port", "phobos", 3, "inner", "inner"]);
  assert.deepStrictEqual([L1.arr_jd, L2.dep_jd, L2.arr_jd, L3.arr_jd, L2.fare, L3.fare], [2461700.5981143885, 2461820.6481143883, 2462706.2877681972, 2462706.3806109186, 820797.1, 31984.39]);
  assert.deepStrictEqual([L1.aboard, L2.aboard, L3.aboard], [0, 4, 1]);
  assert.deepStrictEqual(R.check("ceres-shift", "sf-09", POOL, t0, SEED), []);
  const st = R.start("ceres-shift", "sf-09", POOL, t0, SEED, { ask_after_hours: null, end_jd: END });
  assert.deepStrictEqual(st.ride.hails, ["ceres-shift", B]);
  assert.deepStrictEqual(st.ride.segs.map((s) => s.role + " " + s.from + ">" + s.to + " stop " + s.stop), ["pickup ceres>ceres-port stop 1", "ride ceres-port>phobos stop 2", "ride phobos>mars-base stop 3"]);
  const F = R.fly("ceres-shift", "sf-09", POOL, t0, SEED);
  assert.deepStrictEqual(F, { pickup_jd: 2461700.5981143885, ride_depart_jd: 2461820.6481143883, arrive_jd: 2462710.0563098914, planned_kwh: 2167901, extra_kwh: 12305, used_kwh: 2180206,
    incidents: [{ kind: "flare", leg: "ride", where: "phobos", at_jd: 2462706.2877681972, hours: 38.99626085534692, kwh: 0, note: "Solar storm at Phobos: no launches with a rider aboard until it passed" },
      { kind: "dust_storm", leg: "ride", where: "mars-base", at_jd: 2462708.005455121, hours: 49.22051449120045, kwh: 12305, note: "Dust storm closed the pad; the car held in orbit" }],
    delay_hours: 88.21677534654737, rider_dose_msv: 1857.4,
    bookings: { "ceres-shift": { pickup_jd: 2461700.5981143885, arrive_jd: 2462710.0563098914 }, [B]: { pickup_jd: 2461700.5981143885, arrive_jd: 2462706.2877681972 } } });
  const ctx = { t0, arrive_by_jd: t0 + 1600, par_kwh: 2114837, best_wait_days: 0.1, plan_calls: 3, flown: F, bookings: {
    "ceres-shift": { t0, arrive_by_jd: t0 + 1600, best_wait_days: 0.1, quote: { fare_usd: 237184, arrival: "2030-07-27 13:21" } },
    [B]: { t0, arrive_by_jd: t0 + 1000, best_wait_days: 34, quote: { fare_usd: 615598, arrival: "2030-07-23 18:54" } } } };
  const sc = R.score("ceres-shift", POOL, ctx);
  assert.deepStrictEqual(sc.parts.map((p) => p.key), ["pickup", "on_time", "energy", "promise", "checker", "fare", "economy", "window", "recovery", "dose"]);
  const passenger = ["pickup", "on_time", "promise", "fare"];
  for (const key of passenger) {
    const weighted = ["ceres-shift", B].reduce((a, id) => a + sc.bookings[id].parts.find((p) => p.key === key).got * sc.bookings[id].party, 0);
    const people = ["ceres-shift", B].reduce((a, id) => a + sc.bookings[id].party, 0);
    assert.strictEqual(sc.parts.find((p) => p.key === key).got, weighted / people, key);
  }
  for (const p of sc.parts) assert.ok(p.got <= p.max, p.key);
  assert.ok(sc.total < sc.out_of, sc.total);
  assert.strictEqual(sc.total, sc.parts.reduce((a, p) => a + p.got, 0));
  assert.ok(sc.parts[0].note.includes("ceres-shift: rider waited 2.4 h") && sc.parts[0].note.includes(B + ": rider waited 2.4 h (141.3 min), quickest nearby ship 34.0 days"));
  // Fares per seat: the party of 3 and Ana share the Phobos leg 3:1; Ana alone pays the leg on to Mars Base.
  assert.ok(sc.parts[5].note.includes("ceres-shift: fare matches its seats' share of the legs it rides, $237,184") && sc.parts[5].note.includes(B + ": fare matches its seats' share of the legs it rides, $615,598"));
  assert.deepStrictEqual([sc.bookings["ceres-shift"].fare_usd, sc.bookings[B].fare_usd, sc.fare_usd], [237183.66, 615597.82, 237183.66]);
  assert.deepStrictEqual(R.fares("ceres-shift", "sf-09", POOL), { "ceres-shift": 237183.66, [B]: 615597.82 });
  assert.deepStrictEqual([sc.wait_days, sc.late_days, sc.beat_par], [0.09811438852921128, 0, false]);
});

ok("fares per seat: each leg splits by party among the bookings aboard, an empty leg is free, and a chain implies first-visit stops", () => {
  R.admit(R.hailRow("1", 93)); // a party of 2, Tiangong to Earth
  const big = "s1-93", legs = [["orbital-depot", "tiangong", 50], ["tiangong", "iss", 400], ["iss", "earth", 800], ["earth", "lunar-data-center", 200]]
    .map(([from, to, fare]) => ({ from, to, fare }));
  const stops = R.chainStops([big, "iss-crew"], "orbital-depot", legs);
  assert.deepStrictEqual(stops.map((s) => [s.at, s.board || [], s.alight || []]), [["orbital-depot", [], []], ["tiangong", [big], []], ["iss", ["iss-crew"], []], ["earth", [], [big]], ["lunar-data-center", [], ["iss-crew"]]]);
  // 400 alone; 800 shared 2:1; 200 alone; the empty first leg is not charged. Shares round to the cent.
  assert.deepStrictEqual([R.BY[big].from, R.BY[big].to, R.BY[big].party], ["tiangong", "earth", 2]);
  assert.deepStrictEqual(R.seatFares({ stops, legs }), { [big]: 933.33, "iss-crew": 466.67 });
  // A chain that passes a pickup only after the destination never boards that booking.
  assert.deepStrictEqual(R.chainStops(["iss-crew"], "earth", [{ to: "lunar-data-center" }, { to: "iss" }]).map((s) => [s.board || [], s.alight || []]), [[[], []], [[], []], [["iss-crew"], []]]);
});

ok("check: more passengers than seats is refused, and so is a ship of the wrong class", () => {
  // Four quick hops from ISS on a Taxi: 1 + 3 + 2 + 2 is 8 people for 6 seats.
  const four = ["iss-crew"].concat([8, 69, 119].map((i) => { const h = R.admit(R.hailRow("1", i)); return h.id || "s1-" + i; }));
  assert.deepStrictEqual(four.map((id) => [R.BY[id].from, R.BY[id].party, R.reach(R.BY[id])]), [["iss", 1, "quick"], ["iss", 3, "quick"], ["iss", 2, "quick"], ["iss", 2, "quick"]]);
  const stops = [{ at: "orbital-depot" }, { at: "iss", board: four, alight: [] }].concat(["earth", "lunar-data-center"].map((at) => ({ at, board: [], alight: four.filter((id) => R.BY[id].to === at) })));
  const legs = stops.slice(1).map((s, i) => ({ from: stops[i].at, to: s.at, aboard: [0, 8, 3][i] }));
  assert.deepStrictEqual(R.check("iss-crew", "sf-01", { stops, legs }), ["8 aboard after stop 1 (ISS), but SF-01 seats 6"]);
  // SF-04 is the Taxi parked at Ceres: it can't fly the Shuttle's pool, though it starts where the plan does.
  assert.deepStrictEqual(R.check("ceres-shift", "sf-04", POOL), ["ceres-shift", B].map((id) => R.servesWhy("sf-04", R.BY[id])));
  assert.match(R.servesWhy("sf-04", R.BY[B]), /^SF-04 is a Starseeker Taxi, which flies quick hops inside one planet's neighbourhood, and s1-74 is one of the long hauls inside Jupiter's orbit$/);
});

ok("check: alighting before boarding, leaving before boarding is done, and a hail not on the plan are refused", () => {
  const legs = [{ from: "ceres", to: "mars-base", aboard: 0 }, { from: "mars-base", to: "ceres-port", aboard: 0 }];
  const bad = { stops: [{ at: "ceres" }, { at: "mars-base", board: [], alight: ["ceres-shift"] }, { at: "ceres-port", board: ["ceres-shift"], alight: [] }], legs };
  assert.deepStrictEqual(R.check("ceres-shift", "sf-09", bad).filter((e) => !/planned for/.test(e)), ["ceres-shift alights before boarding"]);
  const rush = { stops: POOL.stops, legs: [L1, Object.assign({}, L2, { dep_jd: L1.arr_jd + 0.01 }), L3] };
  assert.deepStrictEqual(R.check("ceres-shift", "sf-09", rush), ["leg 2 (ride) leaves before ceres-shift and " + B + " have boarded"]);
  assert.deepStrictEqual(R.check("iss-crew", "sf-09", POOL), ["iss-crew is not on this plan"]);
  assert.deepStrictEqual(R.check("iss-crew", "sf-01", { stops: POOL.stops }), ["a dispatch is two legs [pickup, ride] or a plan { stops, legs }"]);
  const two = [{ from: "mars-base", to: "phobos", dep_jd: t0, arr_jd: t0 + 0.1, aboard: 0 }, { from: "phobos", to: "mars-base", dep_jd: t0 + 0.11, arr_jd: t0 + 0.2, aboard: 1 }];
  assert.deepStrictEqual(R.check("phobos-commute", "sf-03", two), ["the ride leaves before the rider has boarded"]); // one booking keeps today's wording
});

// Today's dispatch, as test-reroute's DUST case: a Phobos commute into a Mars Base dust storm.
const DUST = { seed: "1", t0: 2462173.5, legs: [
  { from: "mars-base", to: "phobos", dep_jd: 2462174.529253031, arr_jd: 2462174.6220957525, kwh: 11027, fare: 1811.11, gate: "local" },
  { from: "phobos", to: "mars-base", dep_jd: 2462175.529253031, arr_jd: 2462175.6220957525, kwh: 11027, fare: 1811.11, gate: "local" }] };

ok("a two-leg dispatch is its stops-plan rewrite: check, fly and score agree exactly, and a one-booking score has today's shape", () => {
  const plan = R.planOf("phobos-commute", "sf-03", DUST.legs);
  assert.deepStrictEqual(plan, { stops: [{ at: "mars-base" }, { at: "phobos", board: ["phobos-commute"], alight: [] }, { at: "mars-base", board: [], alight: ["phobos-commute"] }], legs: DUST.legs });
  assert.deepStrictEqual(R.check("phobos-commute", "sf-03", DUST.legs, DUST.t0, DUST.seed), R.check("phobos-commute", "sf-03", plan, DUST.t0, DUST.seed));
  const two = R.fly("phobos-commute", "sf-03", DUST.legs, DUST.t0, DUST.seed);
  assert.deepStrictEqual(two, R.fly("phobos-commute", "sf-03", plan, DUST.t0, DUST.seed));
  assert.deepStrictEqual(Object.keys(two), ["pickup_jd", "ride_depart_jd", "arrive_jd", "planned_kwh", "extra_kwh", "used_kwh", "incidents", "delay_hours", "rider_dose_msv"]);
  const ctx = { t0: DUST.t0, arrive_by_jd: DUST.t0 + 5, par_kwh: 22054, best_wait_days: 1.1, plan_calls: 2, quote: { fare_usd: 1811, arrival: R.iso(DUST.legs[1].arr_jd) }, flown: two };
  const sc = R.score("phobos-commute", DUST.legs, ctx);
  assert.deepStrictEqual(sc, R.score("phobos-commute", plan, ctx));
  assert.deepStrictEqual(Object.keys(sc), ["total", "out_of", "score_version", "parts", "used_kwh", "extra_kwh", "wait_days", "late_days", "pickup_jd", "arrive_jd", "planned_arrive_jd", "rider_dose_msv", "fare_usd", "beat_par", "incidents"]);
  assert.strictEqual(sc.parts.length, 10);
  assert.strictEqual(sc.total, sc.parts.reduce((a, p) => a + p.got, 0));
  assert.deepStrictEqual([two.used_kwh, two.delay_hours], [45505, 93.80377880483866]); // held 93.8 h in the storm
  assert.strictEqual(sc.score_version, 4);
  assert.ok(sc.total < sc.out_of, sc.total);
  for (const p of sc.parts) assert.ok(p.got <= p.max, p.key);
  const energy = sc.parts.find((p) => p.key === "energy");
  assert.ok(energy.measure > 0, energy.measure);
});

ok("a ride stored before stops existed steps the same as one started today", () => {
  const st = R.start("phobos-commute", "sf-03", DUST.legs, DUST.t0, DUST.seed, { end_jd: END, ask_after_hours: 1 });
  const v1 = JSON.parse(JSON.stringify(st.ride));
  delete v1.v; delete v1.stops; delete v1.hails; delete v1.pickups; delete v1.arrivals; v1.segs.forEach((s) => delete s.stop);
  const now = R.step(st.ride, { action: "divert", place: "phobos" }), old = R.step(v1, { action: "divert", place: "phobos" });
  assert.deepStrictEqual(old, now);
  assert.deepStrictEqual(now.ride.segs.map((s) => s.kind + " stop " + s.stop), ["planned stop 1", "planned stop 2", "divert stop 2", "return stop 2"]);
});
ok("stop orders: every booking boards before it lands, and events at the same place in a row are one stop", () => {
  assert.deepStrictEqual([R.stopOrders(["iss-crew", "phobos-commute"]).length, R.stopOrders(["iss-crew", "phobos-commute", "jovian-hop"]).length], [6, 90]);
  assert.deepStrictEqual(R.stopOrders(["ceres-shift", "phobos-commute"]).map((o) => o.map((s) => s.at).join(">")),
    ["ceres-port>mars-base>phobos>mars-base", "ceres-port>phobos>mars-base", "phobos>ceres-port>mars-base", "phobos>mars-base>ceres-port>mars-base"]);
  assert.deepStrictEqual(R.stopOrders(["ceres-shift", "phobos-commute"])[1][2], { at: "mars-base", board: [], alight: ["ceres-shift", "phobos-commute"] });
  assert.throws(() => R.parSet(["iss-crew", "phobos-commute", "jovian-hop", "titan-home"], t0, END, SEED), /1 to 3 bookings/);
  assert.throws(() => R.parSet(["iss-crew", "iss-crew"], t0, END, SEED), /in the set twice/);
});

ok("par for a set: the best pooled flight checks and flies to its par, the split baseline is each booking's own par, and terms stay each booking's own", () => {
  const T = R.termsSet(["ceres-shift", B], t0, END, SEED), p = T.par, P = p.pooled;
  assert.deepStrictEqual([P.car, P.plan.stops.map((s) => s.at), P.kwh, P.choices], ["sf-09", ["ceres", "ceres-port", "mars-base", "phobos"], 2114837, []]);
  assert.deepStrictEqual(R.check("ceres-shift", P.car, P.plan, t0, SEED), []);
  assert.strictEqual(R.fly("ceres-shift", P.car, P.plan, t0, SEED).used_kwh, P.kwh);
  const solo = ["ceres-shift", B].map((id) => R.terms(id, t0, END, SEED));
  assert.deepStrictEqual(solo.map((s) => [s.par.car, s.par.kwh]), [["sf-09", 1527320], ["sf-09", 1686606]]);
  assert.deepStrictEqual([p.split.kwh, p.kwh, p.pool_wins], [3213926, 2114837, true]); // one Shuttle carrying both beats flying each alone, so the pool is par
  assert.deepStrictEqual(T.bookings, {
    "ceres-shift": { t0, arrive_by_jd: solo[0].arrive_by_jd, best_wait_days: solo[0].par.best_wait_days },
    [B]: { t0, arrive_by_jd: solo[1].arrive_by_jd, best_wait_days: solo[1].par.best_wait_days } });
  assert.deepStrictEqual([T.bookings["ceres-shift"].arrive_by_jd, T.bookings[B].arrive_by_jd], [2463209.5, 2463221.5]);
  // No class flies both a quick hop and a long haul, so that set has no pooled flight and par is the split.
  const mixed = R.parSet(["ceres-shift", "phobos-commute"], t0, END, SEED);
  assert.deepStrictEqual([mixed.pooled, mixed.pool_wins, mixed.kwh], [null, false, mixed.split.kwh]);
});
console.log(n, "passed");
