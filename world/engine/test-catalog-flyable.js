// node world/engine/test-catalog-flyable.js
// Every catalog hail is flyable by at least one fleet ship, for several hazard seeds.
// A wrong ship is refused, or it scores below the ship that fits.
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
  let xe = 0;
  for (const leg of terms.par.legs) {
    assert.ok(leg.kwh >= 0, hail.id);
    xe += +leg.xenon_kg || 0;
  }
  assert.ok(xe <= spec.xenon_kg + 1e-6, hail.id + " " + xe + " > " + spec.xenon_kg);
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

ok("the same hails stay flyable at a later clock where Dawn's Ceres tank used to fail", () => {
  for (const seed of ["1", "5", "8"]) {
    for (const hail of R.HAILS) flyable(hail, HARD_CLOCK, seed);
  }
});

ok("each fleet class is the par ship for some catalog hail, and the Shuttle class is not parked", () => {
  const won = {};
  for (const hail of R.HAILS) {
    const terms = R.terms(hail.id, t0Of(hail, SIM_CLOCK), END, "1");
    won[cls(terms.par.car)] = hail.id;
  }
  assert.strictEqual(won.dawn, "iss-crew");
  assert.strictEqual(won.ds1, "phobos-commute");
  assert.ok(["jovian-hop", "titan-home", "ceres-shift"].includes(won.rtg) || won.rtg);
  for (const id of ["jovian-hop", "titan-home", "ceres-shift"]) {
    const terms = R.terms(id, t0Of(R.BY[id], SIM_CLOCK), END, "1");
    assert.strictEqual(cls(terms.par.car), "rtg", id + " " + terms.par.car);
  }
  assert.ok(R.FLEET.every((c) => c.ship_class !== "shuttle"));
  assert.deepStrictEqual(Object.keys(won).sort(), ["dawn", "ds1", "rtg"]);
});

ok("late in the season Titan cannot finish, and the refusal is not a tank figure from a short burn", () => {
  const clock = 2461329.5 + 6200;
  const t0 = t0Of(R.BY["titan-home"], clock);
  assert.throws(() => R.terms("titan-home", t0, END, "1"), /no ship can serve Stranded at Titan/);
  const ephEnd = E.EPHEM_RANGE[1] - 1;
  const leg = R.planLeg("titan", "earth", t0, "energy", ephEnd, "sf-07");
  assert.ok(leg.battery.propellant_kg <= E.SHIP_CLASSES.rtg.xenon_kg, String(leg.battery.propellant_kg));
  assert.ok(leg.arr_jd > END);
});

ok("a wrong ship is refused when the tank or the thruster cannot do the leg", () => {
  const t0 = t0Of(R.BY["iss-crew"], SIM_CLOCK);
  assert.throws(() => R.planLeg("lunar-data-center", "iss", t0, "energy", END, "sf-02"), /xenon tank holds 82 kg/);
  const ceresT0 = t0Of(R.BY["ceres-shift"], SIM_CLOCK);
  assert.throws(() => R.planLeg("orbital-depot", "ceres-port", ceresT0, "energy", END, "sf-01"), /xenon tank holds 425 kg/);
  const titanT0 = t0Of(R.BY["titan-home"], SIM_CLOCK);
  assert.throws(() => R.planLeg("titan-dock", "earth", titanT0, "energy", END, "sf-01"), /490 W/);
  const shuttle = E.planRide({ place: "callisto" }, "io", { depFrom: t0, depTo: t0 + 5, arriveBy: END, allLocal: true, ship: E.SHIP_CLASSES.shuttle });
  assert.match(shuttle.error, /no xenon ion thruster/);
  const hard = Math.floor(HARD_CLOCK + R.LEAD) + 0.5;
  const dawn = E.planRide({ place: "ceres-port" }, "mars-base", { depFrom: hard, depTo: hard + 120, arriveBy: END, ship: E.SHIP_CLASSES.dawn });
  const rtg = E.planRide({ place: "ceres-port" }, "mars-base", { depFrom: hard, depTo: hard + 120, arriveBy: END, ship: E.SHIP_CLASSES.rtg });
  assert.match(dawn.error, /xenon tank holds 425 kg/);
  assert.ok(!rtg.error, rtg.error);
  assert.ok(rtg.battery.propellant_kg <= 1085);
});

ok("a Dawn ship can fly the Mars hop and scores below the Deep Space 1 ship on energy", () => {
  const hail = R.BY["phobos-commute"], t0 = t0Of(hail, SIM_CLOCK);
  const fit = R.planLeg("mars-base", "phobos", t0, "energy", END, "sf-03");
  const back = R.planLeg("phobos", "mars-base", fit.arr_jd + R.DWELL, "energy", END, "sf-03");
  const wrong = R.planLeg("orbital-depot", "phobos", t0, "energy", END, "sf-01");
  const wrongBack = R.planLeg("phobos", "mars-base", wrong.arr_jd + R.DWELL, "energy", END, "sf-01");
  const fitK = fit.battery.energy_kwh + back.battery.energy_kwh;
  const wrongK = wrong.battery.energy_kwh + wrongBack.battery.energy_kwh;
  assert.ok(wrongK > fitK * 2, wrongK + " vs " + fitK);
  const legs = [
    { from: "orbital-depot", to: "phobos", arr_jd: wrong.arr_jd, kwh: wrong.battery.energy_kwh, fare: wrong.fare.total_usd, xenon_kg: wrong.battery.propellant_kg, gate: "PASS" },
    { from: "phobos", to: "mars-base", arr_jd: wrongBack.arr_jd, kwh: wrongBack.battery.energy_kwh, fare: wrongBack.fare.total_usd, xenon_kg: wrongBack.battery.propellant_kg, gate: "PASS" },
  ];
  const sc = R.score("phobos-commute", legs, {
    t0, arrive_by_jd: t0 + 9, par_kwh: fitK, best_wait_days: 0.1, plan_calls: 2, ship: "sf-01",
    quote: { fare_usd: wrongBack.fare.total_usd, arrival: R.iso(wrongBack.arr_jd) },
    flown: { pickup_jd: wrong.arr_jd, arrive_jd: wrongBack.arr_jd, used_kwh: wrongK, extra_kwh: 0, incidents: [] },
  });
  const energy = sc.parts.find((p) => p.key === "energy");
  assert.ok(energy.got < energy.max, energy.got);
  assert.ok(sc.total < sc.out_of, sc.total);
  assert.strictEqual(sc.total, sc.parts.reduce((s, p) => s + p.got, 0));
});

console.log(n, "passed");
