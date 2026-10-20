// node world/engine/test-score-v2.js
// Ship classes, tank cap, distance throttle, unranked departures, score version 3.
const assert = require("assert"), E = require("./sol-page.js"), R = E.R;
const END = 2461329.5 + 7000 - 1, t0 = 2461700.5;
let n = 0; const ok = (name, f) => { f(); n++; console.log("ok", name); };
const BAD = /car|roadster|—|–/i;

ok("same inputs plan the same departures", () => {
  const a = R.planLeg("orbital-depot", "iss", t0, "energy", END, "sf-01");
  const b = R.planLeg("orbital-depot", "iss", t0, "energy", END, "sf-01");
  assert.deepStrictEqual(a.departures, b.departures);
  assert(a.departures.length >= 1);
  for (const d of a.departures) {
    for (const key of Object.keys(d)) assert(!/best|optimum|cheapest|rank/i.test(key), key);
    assert.strictEqual(BAD.test(JSON.stringify(d)), false);
  }
});

ok("Dawn at Earth can thrust and Deep Space 1 stays under its tank on the lunar hop", () => {
  const dawn = R.planLeg("orbital-depot", "iss", t0, "energy", END, "sf-01");
  assert.strictEqual(dawn.battery.class_id, "dawn");
  assert.strictEqual(dawn.battery.set_point_w, 2310);
  assert(dawn.battery.propellant_kg <= 425);
  const ds1 = R.planLeg("orbital-depot", "iss", t0, "energy", END, "sf-02");
  assert.strictEqual(ds1.battery.class_id, "ds1");
  assert(ds1.battery.propellant_kg <= 82);
});

ok("a far Dawn cannot use a published set point, and the Shuttle class has no ion thruster", () => {
  const far = E.battery(5, "dawn", 9.5);
  assert.match(far.refused, /490 W/);
  assert.throws(() => R.planLeg("titan-dock", "earth", t0, "energy", END, "sf-01"), /490 W/);
  const shuttle = E.planRide({ place: "callisto" }, "ganymede", { depFrom: t0, depTo: t0 + 5, arriveBy: END, allLocal: true, ship: E.SHIP_CLASSES.shuttle });
  assert.match(shuttle.error, /no xenon ion thruster/);
  const rtg = E.battery(5, "rtg", 9.5);
  assert.strictEqual(rtg.refused, undefined);
  assert.strictEqual(rtg.set_point_w, 490);
  assert.ok(rtg.propellant_kg <= 1085);
});

ok("the tank check refuses a plan that names more xenon than the hull holds", () => {
  const legs = [
    { from: "orbital-depot", to: "iss", dep_jd: t0, arr_jd: t0 + 0.03, kwh: 400, fare: 80, xenon_kg: 10, gate: "PASS" },
    { from: "iss", to: "lunar-data-center", dep_jd: t0 + 0.1, arr_jd: t0 + 5, kwh: 37000, fare: 8000, xenon_kg: 500, gate: "PASS" },
  ];
  assert(R.check("iss-crew", "sf-01", legs).some((e) => /xenon tank holds 425 kg/.test(e)));
});

ok("score parts sum to the total, and a second call matches", () => {
  const legs = [
    { from: "orbital-depot", to: "iss", arr_jd: t0 + 0.03, kwh: 400, fare: 80, gate: "PASS", xenon_kg: 1 },
    { from: "iss", to: "lunar-data-center", arr_jd: t0 + 5, kwh: 37000, fare: 8000, gate: "PASS", xenon_kg: 90 },
  ];
  const ctx = { t0, arrive_by_jd: t0 + 9, par_kwh: 37400, best_wait_days: 0.03, plan_calls: 2, ship: "sf-01",
    quote: { fare_usd: 8000, arrival: R.iso(t0 + 5) },
    flown: { pickup_jd: t0 + 0.03, arrive_jd: t0 + 5, used_kwh: 37400, extra_kwh: 0, incidents: [] } };
  const a = R.score("iss-crew", legs, ctx), b = R.score("iss-crew", legs, ctx);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.out_of, 100000);
  assert.strictEqual(a.score_version, 4);
  assert.strictEqual(a.total, a.parts.reduce((s, p) => s + p.got, 0));
  assert.strictEqual(a.parts.reduce((s, p) => s + p.max, 0), 100000);
  for (const p of a.parts) {
    assert.strictEqual(typeof p.unit, "string");
    assert.strictEqual(BAD.test(p.label + " " + p.note + " " + p.unit), false, p.note);
  }
});

function partGot(sc, key){ return sc.parts.find((p) => p.key === key).got; }

ok("a ride at every stated reference earns every part's full weight, and moving off a reference costs points", () => {
  const legs = [
    { from: "orbital-depot", to: "iss", arr_jd: t0 + 0.03, kwh: 400, fare: 80, gate: "PASS", xenon_kg: 1 },
    { from: "iss", to: "lunar-data-center", arr_jd: t0 + 5, kwh: 37000, fare: 8000, gate: "PASS", xenon_kg: 90 },
  ];
  const flown = (over) => ({ pickup_jd: t0 + 0.03, arrive_jd: t0 + 5, used_kwh: 37400 * over, extra_kwh: 0, incidents: [] });
  const ctx = {
    t0, arrive_by_jd: t0 + 9, par_kwh: 37400, best_wait_days: 0.03, plan_calls: 2, ship: "sf-01",
    window_kwh: 37400, throttled_kwh: 37400, hindsight_kwh: 37400,
    quote: { fare_usd: 8000, arrival: R.iso(t0 + 5) }, flown: flown(1),
  };
  const at = R.score("iss-crew", legs, ctx);
  assert.strictEqual(at.out_of, 100000);
  assert.strictEqual(at.total, at.parts.reduce((s, p) => s + p.got, 0));
  // Score version 4 (Alvin, 2026-10-20): the reference earns the full weight, so this ride reads 100000.
  assert.strictEqual(at.total, at.out_of);
  assert.strictEqual(at.score_version, 4);
  for (const p of at.parts) assert.strictEqual(p.got, p.max, p.key + " " + p.got + " of " + p.max);
  const overEnergy = R.score("iss-crew", legs, Object.assign({}, ctx, { flown: flown(1.1) }));
  assert.ok(partGot(overEnergy, "energy") <= partGot(at, "energy") * 0.7, partGot(overEnergy, "energy"));
  const underEnergy = R.score("iss-crew", legs, Object.assign({}, ctx, { flown: flown(0.5) }));
  assert.ok(partGot(underEnergy, "energy") <= partGot(at, "energy"));
  const late = R.score("iss-crew", legs, Object.assign({}, ctx, {
    flown: { pickup_jd: t0 + 0.03, arrive_jd: t0 + 9 + 60 / 1440, used_kwh: 37400, extra_kwh: 0, incidents: [] },
  }));
  assert.ok(partGot(late, "on_time") < partGot(at, "on_time") * 0.5, partGot(late, "on_time"));
  assert.ok(partGot(late, "on_time") > 0);
  const slow = R.score("iss-crew", legs, Object.assign({}, ctx, {
    flown: { pickup_jd: t0 + 0.06, arrive_jd: t0 + 5, used_kwh: 37400, extra_kwh: 0, incidents: [] },
  }));
  assert.ok(partGot(slow, "pickup") < partGot(at, "pickup") * 0.25, partGot(slow, "pickup"));
  const slipped = R.score("iss-crew", legs, Object.assign({}, ctx, {
    quote: { fare_usd: 8000, arrival: R.iso(t0 + 5 - 30 / 1440) },
  }));
  assert.ok(partGot(slipped, "promise") < partGot(at, "promise") * 0.5, partGot(slipped, "promise"));
  assert.ok(partGot(slipped, "promise") > 0);
  const minute = R.score("iss-crew", legs, Object.assign({}, ctx, {
    flown: { pickup_jd: t0 + 0.03, arrive_jd: t0 + 9 + 1 / 1440, used_kwh: 37400, extra_kwh: 0, incidents: [] },
  }));
  const onTime = partGot(minute, "on_time");
  assert.notStrictEqual(onTime, Math.round(onTime * 10) / 10);
});

ok("a copied leg that ignores the tank, the throttle and the window scores far under the max", () => {
  const legs = [
    { from: "orbital-depot", to: "iss", arr_jd: t0 + 0.03, kwh: 400, fare: 80, gate: "PASS", xenon_kg: 10 },
    { from: "iss", to: "lunar-data-center", arr_jd: t0 + 5, kwh: 80000, fare: 8000, gate: "PASS", xenon_kg: 900 },
  ];
  const ctx = { t0, arrive_by_jd: t0 + 9, par_kwh: 37400, best_wait_days: 0.03, plan_calls: 2, ship: "sf-01",
    window_kwh: 20000, throttled_kwh: 30000, hindsight_kwh: 20000,
    quote: { fare_usd: 8000, arrival: R.iso(t0 + 5) },
    flown: { pickup_jd: t0 + 0.03, arrive_jd: t0 + 5, used_kwh: 80400, extra_kwh: 0, incidents: [] } };
  const sc = R.score("iss-crew", legs, ctx);
  assert.strictEqual(sc.total, sc.parts.reduce((s, p) => s + p.got, 0));
  assert.strictEqual(sc.parts.find((p) => p.key === "tank").got, 0);
  // The tank, throttle, window, recovery and energy parts lose most of their 37000 points.
  assert(sc.total < 70000, sc.total);
});

console.log(n, "passed");
