// node world/engine/test-catalog-flyable.js
// Every catalog hail is flyable by at least one fleet ship, for several hazard seeds.
// A ship of the wrong class is refused, and a far ship of the right class scores below the near one.
const assert = require("assert"), E = require("./sol-page.js"), R = E.R;
const END = 2461329.5 + 7000 - 1;
const SIM_CLOCK = 2461329.5 + 1;
const HARD_CLOCK = 2462529.5;
const SEEDS = ["1", "2", "3", "4", "5", "6", "7", "8"];
let n = 0; const ok = (name, f) => { f(); n++; console.log("ok", name); };
const t0Of = (h, clock) => Math.floor(clock + (h.kind === "quick" ? 1 : R.LEAD)) + 0.5;
const cls = (car) => R.CAR[car].ship_class;

function flyable(hail, clock, seed) {
  const t0 = t0Of(hail, clock);
  const terms = R.terms(hail.id, t0, END, seed);
  const again = R.terms(hail.id, t0, END, seed);
  assert.strictEqual(again.par.car, terms.par.car);
  assert.strictEqual(again.par.kwh, terms.par.kwh);
  const car = terms.par.car;
  const spec = E.SHIP_CLASSES[cls(car)];
  assert.ok(spec.fictional, car);
  // A Starseeker refuels at every stop, so each leg fits the tank on its own, planned for the people aboard it.
  terms.par.legs.forEach((leg, i) => {
    assert.ok(leg.kwh >= 0, hail.id);
    assert.ok(leg.xenon_kg <= spec.propellant_kg + 1e-6, hail.id + " " + leg.xenon_kg + " > " + spec.propellant_kg);
    assert.strictEqual(leg.aboard, i ? hail.party : 0, hail.id);
  });
  assert.deepStrictEqual(R.check(hail.id, car, terms.par.legs, t0, seed), []);
  return terms;
}

ok("every catalog hail is flyable for seeds 1 to 8 at the simulator clock", () => {
  for (const seed of SEEDS) {
    for (const hail of R.HAILS) {
      const terms = flyable(hail, SIM_CLOCK, seed);
      assert.ok(R.FLEET.some((c) => c.id === terms.par.car), hail.id);
    }
  }
});

ok("the same hails stay flyable at a later clock", () => {
  for (const seed of ["1", "5", "8"]) {
    for (const hail of R.HAILS) flyable(hail, HARD_CLOCK, seed);
  }
});

ok("Taxis par the quick hops, a Shuttle the inner long haul and a Liner the outer one; no real hull is parked", () => {
  const won = {};
  for (const hail of R.HAILS) won[hail.id] = cls(R.terms(hail.id, t0Of(hail, SIM_CLOCK), END, "1").par.car);
  assert.deepStrictEqual(won, { "iss-crew": "star-taxi", "phobos-commute": "star-taxi", "jovian-hop": "star-taxi", "titan-home": "star-liner", "ceres-shift": "star-shuttle" });
  assert.deepStrictEqual(R.FLEET.map((c) => c.ship_class).reduce((a, k) => (a[k] = (a[k] || 0) + 1, a), {}), { "star-taxi": 7, "star-shuttle": 2, "star-liner": 2 });
});

ok("late in the season Titan cannot finish, and the refusal is not a tank figure from a short burn", () => {
  const clock = 2461329.5 + 6500;
  const t0 = t0Of(R.BY["titan-home"], clock);
  assert.throws(() => R.terms("titan-home", t0, END, "1"), /no ship can serve Stranded at Titan/);
  const ephEnd = E.EPHEM_RANGE[1] - 1;
  const leg = R.planLeg("titan", "earth", t0, "energy", ephEnd, "sf-11", 1);
  assert.ok(leg.battery.propellant_kg <= E.SHIP_CLASSES["star-liner"].propellant_kg, String(leg.battery.propellant_kg));
  assert.ok(leg.arr_jd > END);
});

ok("a ship of the wrong class is refused at dispatch, and the real hulls still refuse what their tank or power can't do", () => {
  const t0 = t0Of(R.BY["titan-home"], SIM_CLOCK);
  assert.deepStrictEqual(R.check("titan-home", "sf-07", [{ from: "titan-dock", to: "titan", dep_jd: t0, arr_jd: t0 + 0.1, aboard: 0 }, { from: "titan", to: "earth", dep_jd: t0 + 1, arr_jd: t0 + 600, aboard: 1 }]),
    ["SF-07 is a Starseeker Taxi, which flies quick hops inside one planet's neighbourhood, and titan-home is one of the long hauls to or from the outer planets"]);
  assert.deepStrictEqual(R.check("iss-crew", "sf-10", [{ from: "orbital-depot", to: "iss", dep_jd: t0, arr_jd: t0 + 0.1, aboard: 0 }, { from: "iss", to: "lunar-data-center", dep_jd: t0 + 1, arr_jd: t0 + 6, aboard: 1 }]),
    ["SF-10 is a Starseeker Liner, which flies long hauls to or from the outer planets, and iss-crew is one of the quick hops inside one planet's neighbourhood"]);
  assert.deepStrictEqual(R.nearCars(R.BY["ceres-shift"]).map((c) => c.id), ["sf-09", "sf-08"]);
  const iss = t0Of(R.BY["iss-crew"], SIM_CLOCK);
  const shuttle = E.planRide({ place: "callisto" }, "io", { depFrom: iss, depTo: iss + 5, arriveBy: END, allLocal: true, ship: E.SHIP_CLASSES.shuttle });
  assert.match(shuttle.error, /no xenon ion thruster/);
  const hard = Math.floor(HARD_CLOCK + R.LEAD) + 0.5;
  const dawn = E.planRide({ place: "ceres-port" }, "mars-base", { depFrom: hard, depTo: hard + 120, arriveBy: END, ship: E.SHIP_CLASSES.dawn });
  const rtg = E.planRide({ place: "ceres-port" }, "mars-base", { depFrom: hard, depTo: hard + 120, arriveBy: END, ship: E.SHIP_CLASSES.rtg });
  assert.match(dawn.error, /xenon tank holds 425 kg/);
  assert.ok(!rtg.error, rtg.error);
  assert.ok(rtg.battery.propellant_kg <= 1085);
});

ok("a far Taxi can fly the Mars hop and scores below the near one on energy", () => {
  const hail = R.BY["phobos-commute"], t0 = t0Of(hail, SIM_CLOCK);
  const fit = R.planLeg("mars-base", "phobos", t0, "energy", END, "sf-03", 0);
  const back = R.planLeg("phobos", "mars-base", fit.arr_jd + R.DWELL, "energy", END, "sf-03", 1);
  const wrong = R.planLeg("lunar-data-center", "phobos", t0, "energy", END, "sf-02", 0);
  const wrongBack = R.planLeg("phobos", "mars-base", wrong.arr_jd + R.DWELL, "energy", END, "sf-02", 1);
  const fitK = fit.battery.energy_kwh + back.battery.energy_kwh;
  const wrongK = wrong.battery.energy_kwh + wrongBack.battery.energy_kwh;
  assert.ok(wrongK > fitK * 2, wrongK + " vs " + fitK);
  const legs = [
    { from: "lunar-data-center", to: "phobos", arr_jd: wrong.arr_jd, kwh: wrong.battery.energy_kwh, fare: wrong.fare.total_usd, xenon_kg: wrong.battery.propellant_kg, gate: "PASS", aboard: 0 },
    { from: "phobos", to: "mars-base", arr_jd: wrongBack.arr_jd, kwh: wrongBack.battery.energy_kwh, fare: wrongBack.fare.total_usd, xenon_kg: wrongBack.battery.propellant_kg, gate: "PASS", aboard: 1 },
  ];
  const sc = R.score("phobos-commute", legs, {
    t0, arrive_by_jd: t0 + 9, par_kwh: fitK, best_wait_days: 0.1, plan_calls: 2, ship: "sf-02",
    quote: { fare_usd: wrongBack.fare.total_usd, arrival: R.iso(wrongBack.arr_jd) },
    flown: { pickup_jd: wrong.arr_jd, arrive_jd: wrongBack.arr_jd, used_kwh: wrongK, extra_kwh: 0, incidents: [] },
  });
  const energy = sc.parts.find((p) => p.key === "energy");
  assert.ok(energy.got < energy.max, energy.got);
  assert.ok(sc.total < sc.out_of, sc.total);
  assert.strictEqual(sc.total, sc.parts.reduce((s, p) => s + p.got, 0));
});

console.log(n, "passed");
