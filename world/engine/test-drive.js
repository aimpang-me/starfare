// node world/engine/test-drive.js
// The fictional Starseeker drive (docs/DRIVE-SPEC.md): real equations on fictional figures, people and supplies in the
// mass, burns throttled at 1 g, and tanks that hold every bookable route on the plans Alvin chose.
const assert = require("assert"), path = require("path"), E = require("./sol-page.js");
const C = E.SHIP_CLASSES, D = E.DRIVE, G0 = E.G0;
let n = 0; const ok = (name, f) => { f(); n++; console.log("ok", name); };
const close = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, what + ": " + a + " vs " + b);

ok("the three classes carry the decided seats, drive figures and Fictional flag, beside the real reference hulls", () => {
  assert.deepStrictEqual(["star-taxi", "star-shuttle", "star-liner"].map((id) => [C[id].seats, C[id].ve_kms, C[id].fictional]), [[6, 30, true], [20, 30, true], [100, 60, true]]);
  for (const id of ["dawn", "ds1", "rtg", "shuttle"]) assert.ok(!C[id].fictional, id);
  assert.deepStrictEqual([D.PAX_KG, D.SUPPLY_KG_DAY, D.COMFORT_G], [100, 2.5, 1]);
});

ok("a leg is the rocket equation on hull + people + supplies, and its energy is half m_p ve^2 over efficiency", () => {
  const b = E.driveLeg(20.408, C["star-taxi"], { aboard: 6, days: 3.13 });
  const mf = 6000 + 6 * 100 + 6 * 2.5 * 3.13, mp = mf * (Math.exp(20.408 / 30) - 1);
  close(b.final_kg, mf, 0.1, "final mass"); close(b.propellant_kg_exact, mp, 1e-6, "propellant");
  close(b.energy_kwh_exact, 0.5 * mp * 30000 ** 2 / 0.64 / 3.6e6, 1e-6, "energy");
  assert.strictEqual(b.isp_s, Math.round(30000 / G0));
  const empty = E.driveLeg(20.408, C["star-taxi"]);
  assert.ok(empty.propellant_kg < b.propellant_kg && empty.aboard === 0, "an empty cabin burns less");
});

ok("splitting a leg into its burns keeps the propellant, and the first burn carries the second burn's propellant", () => {
  const one = E.driveLeg(20, C["star-taxi"], { aboard: 3, days: 2 }), two = E.driveLeg(20, C["star-taxi"], { aboard: 3, days: 2, burns: [15, 5] });
  close(two.propellant_kg_exact, one.propellant_kg_exact, 1e-6, "same propellant");
  assert.strictEqual(two.burns.length, 2);
  const m1 = two.final_kg * Math.exp(5 / 30);
  close(two.start_kg, m1 * Math.exp(15 / 30), 0.1, "start mass");
});

ok("burns throttle at 1 g: full thrust until 1 g, then held there, so nobody aboard feels more", () => {
  // Jupiter's low parking orbit to Callisto, the longest taxi burn (docs/DRIVE-SPEC.md): 15.72 km/s then 4.69 km/s.
  const b = E.driveLeg(20.41, C["star-taxi"], { aboard: 6, days: 3.13, burns: [15.72, 4.69] });
  assert.ok(b.peak_g <= D.COMFORT_G + 1e-9, String(b.peak_g));
  const unthrottled = (b.start_kg - b.start_kg / Math.exp(15.72 / 30)) / (99000 / 30000) / 60;
  assert.ok(b.burns[0].minutes > unthrottled && b.burns[0].minutes < unthrottled + 3, b.burns[0].minutes + " vs " + unthrottled);
  close(b.burns[0].minutes, 28.6, 0.6, "throttled departure burn");
  for (const [id, dv, days] of [["star-shuttle", 15, 600], ["star-liner", 45, 467]]) {
    const L = E.driveLeg(dv, C[id], { aboard: C[id].seats, days, burns: [dv / 2, dv / 2] });
    assert.ok(L.peak_g < 0.2 && L.peak_g > 0, id + " " + L.peak_g);
  }
});

ok("a leg over the seats or the tank is refused with the reason, and a real hull ignores the cabin load", () => {
  assert.match(E.driveLeg(5, C["star-taxi"], { aboard: 7 }).refused, /seats 6/);
  assert.match(E.driveLeg(40, C["star-taxi"]).refused, /tank holds 7000 kg/);
  assert.ok(!E.driveLeg(20.4, C["star-taxi"], { aboard: 6, days: 6 }).refused);
  assert.deepStrictEqual(E.battery(4, "dawn", 1, { aboard: 4, days: 300 }), E.battery(4, "dawn", 1));
});

ok("every bookable route fits its class's tank on the plan Alvin chose, with every seat full", () => {
  const D2 = path.join(__dirname, "..", "drive");
  const rows = require(path.join(D2, "route-dv-2026-10-19.json"));
  for (const f of require(path.join(D2, "route-dv-fast-2026-10-19.json"))) Object.assign(rows.find((r) => r.from === f.from && r.to === f.to), f);
  const OUTER = new Set(["jupiter", "saturn", "uranus", "neptune", "io", "europa", "ganymede", "callisto", "enceladus", "titan", "titan-dock", "triton"]);
  const worst = (r) => r.energy.filter(Array.isArray).reduce((a, x) => (!a || x[0] > a[0] ? x : a), null);
  let count = 0;
  for (const r of rows) {
    const outer = OUTER.has(r.from) || OUTER.has(r.to);
    const [id, plan] = r.kind === "quick" ? ["star-taxi", worst(r)] : outer ? ["star-liner", r.fast45] : ["star-shuttle", r.fast15];
    assert.ok(Array.isArray(plan), r.from + " to " + r.to + " has no plan");
    const b = E.driveLeg(plan[0], C[id], { aboard: C[id].seats, days: plan[1] });
    assert.ok(!b.refused, r.from + " to " + r.to + ": " + b.refused);
    count++;
  }
  assert.strictEqual(count, 374);
});

ok("the planner flies a fictional class with its cabin, and says the drive is fictional and supplies are priced", () => {
  const t0 = 2461329.5 + 10;
  const b = E.planRide({ place: "io" }, "ganymede", { depFrom: t0, depTo: t0 + 5, arriveBy: t0 + 400, allLocal: true, ship: C["star-taxi"], aboard: 3 });
  assert.ok(!b.error, b.error);
  assert.strictEqual(b.battery.aboard, 3); assert.ok(b.battery.supplies_kg > 0 && b.battery.burns.length === 2);
  assert.ok(b.assumptions.some((a) => /declared fictional drive/.test(a)));
  assert.ok(!b.not_priced.some((a) => /life support|NSTAR/.test(a)), b.not_priced.join("; "));
  const none = E.planRide({ place: "io" }, "ganymede", { depFrom: t0, depTo: t0 + 5, arriveBy: t0 + 400, allLocal: true, ship: C["star-taxi"] });
  assert.ok(none.battery.energy_kwh < b.battery.energy_kwh, "an empty pickup leg costs less than a full ride");
});

ok("who is aboard: a drive leg is planned for its cabin, dispatch refuses one planned for others, and real hulls ignore it", () => {
  const R = E.R, END = 2461329.5 + 7000 - 1, t0 = 2461329.5 + 10;
  // No Starseeker is parked yet (the fleet switch waits on review), so this check parks one for itself.
  R.CAR["test-taxi"] = { id: "test-taxi", name: "Test Taxi", at: "callisto", ship_class: "star-taxi", seats: 6 };
  try {
    const leg = (from, to, t, on) => { const b = R.planLeg(from, to, t, "energy", END, "test-taxi", on);
      return { from, to, dep_jd: b.dep_jd, arr_jd: b.arr_jd, kwh: b.battery.energy_kwh, fare: b.fare.total_usd, aboard: b.battery.aboard }; };
    const p = leg("callisto", "io", t0, 0), r = leg("io", "ganymede", p.arr_jd + R.DWELL, 1), six = leg("io", "ganymede", p.arr_jd + R.DWELL, 6);
    assert.deepStrictEqual([p.aboard, r.aboard, six.aboard], [0, 1, 6]);
    assert.ok(six.kwh > r.kwh, "six aboard burn more than one: " + six.kwh + " vs " + r.kwh);
    assert.deepStrictEqual(R.check("jovian-hop", "test-taxi", [p, r]), []);
    assert.deepStrictEqual(R.check("jovian-hop", "test-taxi", [p, six]), ["the ride was planned for 6 aboard, but 1 ride it"]);
  } finally { delete R.CAR["test-taxi"]; }
  const a = R.planLeg("io", "ganymede", t0, "energy", END, "sf-05", 0), b = R.planLeg("io", "ganymede", t0, "energy", END, "sf-05", 6);
  assert.strictEqual(a.battery.energy_kwh, b.battery.energy_kwh); assert.strictEqual(b.battery.aboard, undefined);
});

console.log(n + " passed");
