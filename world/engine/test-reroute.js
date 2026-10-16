// node world/engine/test-reroute.js : checks for mid-ride checkpoints (launch_hold, pad_closed) in sol-rides.js, via the bundle.
// The fixture is what fly() and par returned before checkpoints existed (capture-fly-fixture.js).
const assert = require("assert"), R = require("./sol-page.js").R, FX = require("./fixtures/fly-baseline.json");
const END = FX.end_jd;
let n = 0; const ok = (name, f) => { const a = Date.now(); f(); n++; console.log("ok", name, "(" + (Date.now() - a) + " ms)"); };
const FLY_KEYS = ["pickup_jd", "ride_depart_jd", "arrive_jd", "planned_kwh", "extra_kwh", "used_kwh", "incidents", "delay_hours"];
const finish = (st, d) => { while (st.checkpoint) st = R.step(st.ride, d || null); return st.done; };

// A Phobos commute that lands into a 93.8 h Mars Base dust storm (seed 1), found by find-reroute-cases.js.
const DUST = { seed: "1", t0: 2462173.5, legs: [
  { from: "mars-base", to: "phobos", dep_jd: 2462174.529253031, arr_jd: 2462174.6220957525, kwh: 11027, fare: 1811.11, gate: "local" },
  { from: "phobos", to: "mars-base", dep_jd: 2462175.529253031, arr_jd: 2462175.6220957525, kwh: 11027, fare: 1811.11, gate: "local" }] };
const dust = (opts) => R.start("phobos-commute", "sf-03", DUST.legs, DUST.t0, DUST.seed, Object.assign({ end_jd: END }, opts));

ok("fly() with no checkpoints is exactly what it was for 298 fixture rides", () => {
  for (const r of FX.rides) assert.deepStrictEqual(R.fly(r.hail, r.car, r.legs, r.t0, r.seed), r.flown, r.hail + " seed " + r.seed + " " + r.car);
});

ok("ask_after_hours \"never\" is fly(); answering every checkpoint with its default flies the same ride", () => {
  for (const r of FX.rides.filter((x) => x.kind === "par")) {
    const never = R.start(r.hail, r.car, r.legs, r.t0, r.seed, { ask_after_hours: "never", end_jd: END });
    assert.deepStrictEqual(Object.fromEntries(FLY_KEYS.map((k) => [k, never.done[k]])), r.flown);
    const asked = finish(R.start(r.hail, r.car, r.legs, r.t0, r.seed, { ask_after_hours: 1, end_jd: END }));
    assert.strictEqual(asked.used_kwh, r.flown.used_kwh, r.hail + " seed " + r.seed);
    assert.strictEqual(asked.arrive_jd, r.flown.arrive_jd);
  }
});

ok("pad_closed at Mars Base: diverting to Phobos beats holding through the storm", () => {
  const st = dust({ ask_after_hours: 1 }), cp = st.checkpoint;
  assert.deepStrictEqual([cp.n, cp.kind, cp.cause, cp.place, cp.leg, cp.rider_aboard, cp.car], [1, "pad_closed", "dust_storm", "mars-base", "ride", true, "holding in orbit at Mars Base"]);
  assert.strictEqual(R.iso(cp.sky_at), "2029-02-08 03:56");
  assert.deepStrictEqual(cp.options.find((o) => o.action === "divert").alternates, [{ place: "phobos", name: "Phobos", hop_kwh: 11027, hop_hours: 2.2, berths: 3, booked_now: 2 }]);
  const hold = finish(R.step(st.ride, { action: "hold" }));
  const div = finish(R.step(st.ride, { action: "divert", place: "phobos", wait_hours: 88.4 }));
  assert.deepStrictEqual([hold.used_kwh, R.iso(hold.arrive_jd)], [45505, "2029-02-12 00:44"]);
  assert.deepStrictEqual([div.used_kwh, div.divert_kwh, R.iso(div.arrive_jd)], [44358, 22054, "2029-02-12 00:47"]);
  assert.deepStrictEqual(div.segments.map((s) => s.kind + " " + s.from + ">" + s.to), ["planned mars-base>phobos", "planned phobos>mars-base", "divert mars-base>phobos", "return phobos>mars-base"]);
  assert.throws(() => R.step(st.ride, { action: "divert", place: "mars-base" }), /divert to one of: phobos/);
});

ok("launch_hold for a solar flare at Ceres Port: a replan beats waiting out the correction burn", () => {
  const r = FX.rides.find((x) => x.hail === "ceres-shift" && x.seed === "1" && x.kind === "par");
  const st = R.start(r.hail, r.car, r.legs, r.t0, r.seed, { ask_after_hours: 1, end_jd: END }), cp = st.checkpoint;
  assert.deepStrictEqual([cp.n, cp.kind, cp.cause, cp.place, cp.leg, R.iso(cp.sky_at)], [1, "launch_hold", "solar_flare", "ceres-port", "ride", "2028-01-09 21:34"]);
  const wait = finish(R.step(st.ride, { action: "wait" }));
  assert.deepStrictEqual([wait.used_kwh, wait.incidents.find((x) => x.kind === "correction_burn").kwh], [110481, 25418]);
  const b = R.planLeg("ceres-port", "mars-base", 2461781.4565570117, "energy", END);
  const leg = { from: "ceres-port", to: "mars-base", dep_jd: b.dep_jd, arr_jd: b.arr_jd, kwh: b.battery.energy_kwh, fare: b.fare.total_usd, gate: "PASS" };
  const rp = finish(R.step(st.ride, { action: "replan", leg }));
  assert.deepStrictEqual([leg.kwh, rp.used_kwh, R.iso(rp.arrive_jd)], [64696, 71609, "2030-08-07 09:00"]);
  assert.throws(() => R.step(st.ride, { action: "replan", leg: Object.assign({}, leg, { dep_jd: cp.sky_at - 1 }) }), /depart at or after 2028-01-09 21:34/);
  assert.throws(() => R.step(st.ride, { action: "hold" }), /takes wait or replan/);
});

ok("a ride asks at most 8 times, then follows the defaults and says so", () => {
  let st = dust({ ask_after_hours: 1 }), asked = 0;
  while (st.checkpoint) { asked++; st = R.step(st.ride, { action: "hold", hours: 1 }); }
  assert.strictEqual(asked, 8);
  assert.deepStrictEqual([st.done.used_kwh, R.iso(st.done.arrive_jd)], [45505, "2029-02-12 00:44"]);
  assert.deepStrictEqual(st.done.incidents.filter((x) => x.kind === "checkpoint_cap").map((x) => x.where), ["mars-base"]);
});

ok("a ride is plain JSON: stepping a stored copy gives the same ride, twice", () => {
  const a = dust({ ask_after_hours: 0 }), b = dust({ ask_after_hours: 0 });
  assert.deepStrictEqual(a, b);
  const d = { action: "divert", place: "phobos", wait_hours: 40 };
  assert.deepStrictEqual(R.step(JSON.parse(JSON.stringify(a.ride)), d), R.step(a.ride, d));
  assert.strictEqual(a.ride.pending, 1);
});

ok("regret: each decided checkpoint lists what every choice would have used", () => {
  const st = dust({ ask_after_hours: 1 }), done = R.step(st.ride, { action: "hold" });
  const rows = R.regret(done.ride);
  assert.deepStrictEqual(rows.map((x) => [x.n, x.best, x.options.map((o) => [o.option, o.used_kwh])]),
    [[1, "divert to Phobos, wait 88.4 h", [["hold until open", 45505], ["divert to Phobos, wait 88.4 h", 44358]]]]);
});

ok("par with hindsight never needs more energy than par without it (100 fixture hails)", () => {
  let lower = 0;
  for (const T of FX.terms) {
    const p = R.terms(T.hail, T.t0, END, T.seed).par;
    assert(p.kwh <= T.par.kwh, T.hail + " seed " + T.seed + ": " + p.kwh + " > " + T.par.kwh);
    if (p.kwh < T.par.kwh) lower++;
  }
  console.log("   par fell on", lower, "of", FX.terms.length, "hails");
  assert.strictEqual(R.terms("ceres-shift", 2461647.5, END, "1").par.kwh, 56183);
});
console.log(n, "passed");
