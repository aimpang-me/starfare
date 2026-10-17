// node world/engine/test-score-v2.js
// Ship classes, tank cap, distance throttle, unranked departures, score version 2.
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

ok("a far hull with the Dawn lower bound cannot use a published set point", () => {
  const far = E.battery(5, "dawn", 9.5);
  assert.match(far.refused, /490 W/);
  assert.throws(() => R.planLeg("europa", "io", t0, "energy", END, "sf-05"), /490 W/);
  assert.throws(() => R.planLeg("callisto", "ganymede", t0, "energy", END, "sf-06"), /no xenon ion thruster/);
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
  assert.strictEqual(a.score_version, 2);
  assert.strictEqual(a.total, a.parts.reduce((s, p) => s + p.got, 0));
  assert.strictEqual(a.parts.reduce((s, p) => s + p.max, 0), 100000);
  for (const p of a.parts) {
    assert.strictEqual(typeof p.unit, "string");
    assert.strictEqual(BAD.test(p.label + " " + p.note + " " + p.unit), false, p.note);
  }
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
  assert(sc.total < 40000, sc.total);
  assert(sc.total < sc.out_of / 2);
});

console.log(n, "passed");
