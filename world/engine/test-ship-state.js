// node world/engine/test-ship-state.js
// Ships that remember (sandbox build plan, step 1): planning and flying take an optional map of where each ship is and
// when it is free. Without the map, every result is what it was; with it, a ship starts its next job where it landed.
const assert = require("assert"), E = require("./sol-page.js"), R = E.R;
let n = 0; const ok = (name, f) => { f(); n++; console.log("ok", name); };
const SEED = "7", T0 = Math.floor(E.EPHEM_RANGE[0]) + 400, END = T0 + 3000;
const quick = R.HAILS.find((h) => h.id === "phobos-commute"); // Phobos -> Mars Base: SF-03 (taxi at Mars Base) flies it today

ok("no map and an empty map give the same par, fleet, pickup start and checks as before", () => {
  const a = R.par(quick.id, T0, END, SEED), b = R.par(quick.id, T0, END, SEED, {}), c = R.par(quick.id, T0, END, SEED, undefined);
  assert.deepStrictEqual(b, a); assert.deepStrictEqual(c, a);
  assert.deepStrictEqual(R.fleetState(quick.id, T0, SEED, {}), R.fleetState(quick.id, T0, SEED));
  for (const car of ["sf-03", "sf-08"]) assert.strictEqual(R.pickupStart(quick.id, car, T0, SEED, {}), R.pickupStart(quick.id, car, T0, SEED));
  assert.deepStrictEqual(R.check(quick.id, a.car, a.legs, T0, SEED, {}), R.check(quick.id, a.car, a.legs, T0, SEED));
  assert.deepStrictEqual(R.check(quick.id, a.car, a.legs, T0, SEED), []);
});

ok("a ship in the map is where it landed and free when its last job ends, not busy by the season's draw", () => {
  const ships = { "sf-03": { at: "mars", free_jd: T0 + 0.5 } };
  const row = R.fleetState(quick.id, T0, SEED, ships).find((c) => c.car === "sf-03");
  assert.strictEqual(row.at, "mars"); assert.strictEqual(row.busy_until_jd, T0 + 0.5);
  assert.strictEqual(R.pickupStart(quick.id, "sf-03", T0, SEED, ships), T0 + 0.5);
  assert.strictEqual(R.pickupStart(quick.id, "sf-03", T0, SEED, { "sf-03": { at: "mars", free_jd: T0 - 3 } }), T0, "free before the hail: leaves from t0");
  // The other ships keep the season's draw.
  assert.strictEqual(R.pickupStart(quick.id, "sf-08", T0, SEED, ships), R.pickupStart(quick.id, "sf-08", T0, SEED));
});

ok("par plans the pickup from where the ship is, and check holds a dispatch to that place and time", () => {
  const ships = { "sf-03": { at: "mars", free_jd: T0 + 0.5 } };
  const p = R.par(quick.id, T0, END, SEED, ships);
  assert.strictEqual(p.car, "sf-03"); assert.strictEqual(p.legs[0].from, "mars");
  assert.ok(p.legs[0].dep_jd >= T0 + 0.5 - 1e-9, "leaves once free");
  assert.deepStrictEqual(R.check(quick.id, "sf-03", p.legs, T0, SEED, ships), []);
  const home = R.par(quick.id, T0, END, SEED);
  const fromHome = R.check(quick.id, "sf-03", home.legs, T0, SEED, ships);
  assert.ok(fromHome.some((e) => /the pickup must leave where SF-03 is parked/.test(e)), fromHome.join("; "));
  const early = JSON.parse(JSON.stringify(p.legs)); early[0].dep_jd = T0 + 0.1;
  assert.ok(R.check(quick.id, "sf-03", early, T0, SEED, ships).some((e) => /busy on another ride until/.test(e)));
});

ok("a ship moved out of the neighbourhood is no longer offered for its hails", () => {
  const away = { "sf-03": { at: "orbital-depot", free_jd: T0 }, "sf-08": { at: "orbital-depot", free_jd: T0 } };
  assert.ok(!R.nearCars(quick, away).some((c) => c.id === "sf-03"));
  assert.throws(() => R.par(quick.id, T0, END, SEED, away), /no ship can serve/);
});

ok("a ship parked at the rider's own place is not offered (known gap: a pickup can't be a zero-length leg)", () => {
  assert.ok(!R.nearCars(quick, { "sf-03": { at: "phobos", free_jd: T0 } }).some((c) => c.id === "sf-03"));
});

ok("landed gives the next job's start: the last stop and the landing time", () => {
  const p = R.par(quick.id, T0, END, SEED), F = R.fly(quick.id, p.car, p.legs, T0, SEED);
  const next = R.landed(quick.id, p.car, p.legs, F);
  assert.deepStrictEqual(next, { at: "mars-base", free_jd: F.arrive_jd });
  // Two jobs in a row: the second plans from Mars Base and leaves after the first lands.
  const ships = { [p.car]: next }, back = R.HAILS.find((h) => h.id === "ceres-shift"); // Ceres Port -> Mars Base, a shuttle's job
  assert.ok(R.nearCars(back, ships).length >= 1);
  assert.strictEqual(R.pickupStart(quick.id, p.car, T0, SEED, ships), F.arrive_jd);
});

ok("a shared-flight par starts every ship from the map too", () => {
  const ships = { "sf-03": { at: "mars", free_jd: T0 + 0.5 } };
  const ps = R.parSet([quick.id], T0, END, SEED, ships);
  assert.strictEqual(ps.split.bookings[quick.id].legs[0].from, "mars");
  if (ps.pooled && ps.pooled.car === "sf-03") assert.strictEqual(ps.pooled.plan.stops[0].at, "mars");
});

ok("a bad map is refused with the reason", () => {
  assert.deepStrictEqual(R.shipsProblems({ "sf-99": { at: "mars" } }), ["unknown ship sf-99"]);
  assert.deepStrictEqual(R.shipsProblems({ "sf-03": { at: "narnia" } }), ["sf-03 is at an unknown place narnia"]);
  assert.deepStrictEqual(R.shipsProblems({ "sf-03": { at: "mars", free_jd: "soon" } }), ["sf-03 has a free_jd that is not a number"]);
  assert.deepStrictEqual(R.shipsProblems([]), ["ships is a map of ship id to { at, free_jd }"]);
  assert.throws(() => R.par(quick.id, T0, END, SEED, { "sf-99": {} }), /unknown ship sf-99/);
  const p = R.par(quick.id, T0, END, SEED);
  assert.deepStrictEqual(R.check(quick.id, p.car, p.legs, T0, SEED, { "sf-03": { at: "narnia" } }), ["sf-03 is at an unknown place narnia"]);
});

console.log(n + " checks passed");
