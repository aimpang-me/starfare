// node world/engine/test-reroute.js : checks for mid-ride checkpoints (launch_hold, pad_closed) in sol-rides.js, via the bundle.
// The fixture is what fly() and par return (capture-fly-fixture.js); recapture it when the hazards' physics change.
const assert = require("assert"), R = require("./sol-page.js").R, FX = require("./fixtures/fly-baseline.json");
const END = FX.end_jd;
let n = 0; const ok = (name, f) => { const a = Date.now(); f(); n++; console.log("ok", name, "(" + (Date.now() - a) + " ms)"); };
const FLY_KEYS = ["pickup_jd", "ride_depart_jd", "arrive_jd", "planned_kwh", "extra_kwh", "used_kwh", "incidents", "delay_hours", "rider_dose_msv"];
const finish = (st, d) => { while (st.checkpoint) st = R.step(st.ride, d || null); return st.done; };

// A Phobos commute that lands into a 93.8 h Mars Base dust storm (seed 1), found by find-reroute-cases.js.
const DUST = { seed: "1", t0: 2462173.5, legs: [
  { from: "mars-base", to: "phobos", dep_jd: 2462174.529253031, arr_jd: 2462174.6220957525, kwh: 11027, fare: 1811.11, gate: "local" },
  { from: "phobos", to: "mars-base", dep_jd: 2462175.529253031, arr_jd: 2462175.6220957525, kwh: 11027, fare: 1811.11, gate: "local" }] };
const dust = (opts) => R.start("phobos-commute", "sf-03", DUST.legs, DUST.t0, DUST.seed, Object.assign({ end_jd: END }, opts));

ok("fly() with no checkpoints is exactly what it was for 298 fixture rides", () => {
  for (const r of FX.rides) assert.deepStrictEqual(R.fly(r.hail, r.car, r.legs, r.t0, r.seed), r.flown, r.hail + " seed " + r.seed + " " + r.car);
});

ok("ask_after_hours \"never\" is fly(); answering with defaults flies the same ride unless the car waited on the pad for the answer", () => {
  const waited = [];
  for (const r of FX.rides.filter((x) => x.kind === "par")) {
    const never = R.start(r.hail, r.car, r.legs, r.t0, r.seed, { ask_after_hours: "never", end_jd: END });
    assert.deepStrictEqual(Object.fromEntries(FLY_KEYS.map((k) => [k, never.done[k]])), r.flown);
    const asked = finish(R.start(r.hail, r.car, r.legs, r.t0, r.seed, { ask_after_hours: 1, end_jd: END }));
    if (asked.incidents.some((x) => x.kind === "awaiting_answer")) {
      waited.push([r.hail, r.seed, asked.used_kwh, R.iso(asked.arrive_jd)]);
      assert(asked.used_kwh >= r.flown.used_kwh && asked.arrive_jd >= r.flown.arrive_jd, r.hail + " seed " + r.seed);
      continue;
    }
    assert.strictEqual(asked.used_kwh, r.flown.used_kwh, r.hail + " seed " + r.seed);
    assert.strictEqual(asked.arrive_jd, r.flown.arrive_jd);
  }
  assert.deepStrictEqual(waited, [["titan-home", "10", 134731, "2035-05-02 05:29"], ["ceres-shift", "17", 115313, "2034-02-04 22:46"]]);
});

ok("pad_closed at Mars Base: diverting to Phobos beats holding through the storm", () => {
  const st = dust({ ask_after_hours: 1 }), cp = st.checkpoint;
  assert.deepStrictEqual([cp.n, cp.kind, cp.cause, cp.place, cp.leg, cp.rider_aboard, cp.car], [1, "pad_closed", "dust_storm", "mars-base", "ride", true, "holding in orbit at Mars Base"]);
  assert.deepStrictEqual([R.iso(cp.sky_at), cp.signal_delay_minutes, R.iso(cp.reply_jd)], ["2029-02-08 03:56", 7.3, "2029-02-08 04:10"]);
  assert.deepStrictEqual(cp.options.find((o) => o.action === "divert").alternates, [{ place: "phobos", name: "Phobos", hop_kwh: 11027, hop_hours: 2.2, berths: 3, booked_now: 1 }]);
  const hold = finish(R.step(st.ride, { action: "hold" }));
  const div = finish(R.step(st.ride, { action: "divert", place: "phobos", wait_hours: 88.4 }));
  assert.deepStrictEqual([hold.used_kwh, R.iso(hold.arrive_jd)], [45505, "2029-02-12 00:44"]);
  assert.deepStrictEqual([div.used_kwh, div.divert_kwh, R.iso(div.arrive_jd)], [44419, 22054, "2029-02-12 01:02"]);
  assert.strictEqual(div.incidents.find((x) => x.kind === "divert").at_jd, cp.reply_jd);
  assert.deepStrictEqual(div.segments.map((s) => s.kind + " " + s.from + ">" + s.to), ["planned mars-base>phobos", "planned phobos>mars-base", "divert mars-base>phobos", "return phobos>mars-base"]);
  assert.throws(() => R.step(st.ride, { action: "divert", place: "mars-base" }), /divert to one of: phobos/);
});

ok("launch_hold for a solar flare at Ceres Port: a replan beats waiting out the correction burn", () => {
  const r = FX.rides.find((x) => x.hail === "ceres-shift" && x.seed === "17" && x.kind === "par");
  const st = R.start(r.hail, r.car, r.legs, r.t0, r.seed, { ask_after_hours: 1, end_jd: END }), cp = st.checkpoint;
  assert.deepStrictEqual([cp.n, cp.kind, cp.cause, cp.place, cp.leg, R.iso(cp.sky_at)], [1, "launch_hold", "solar_flare", "ceres-port", "ride", "2032-03-28 04:12"]);
  assert.deepStrictEqual([cp.signal_delay_minutes, R.iso(cp.reply_jd), cp.options[0].correction_kwh_if_it_left_on_reply], [14.2, "2032-03-28 04:40", 838]);
  const wait = finish(R.step(st.ride, { action: "wait" }));
  assert.deepStrictEqual([wait.used_kwh, wait.incidents.find((x) => x.kind === "correction_burn").kwh], [115313, 26496]);
  const b = R.planLeg("ceres-port", "mars-base", 2463322.571546903, "energy", END);
  const leg = { from: "ceres-port", to: "mars-base", dep_jd: b.dep_jd, arr_jd: b.arr_jd, kwh: b.battery.energy_kwh, fare: b.fare.total_usd, gate: "PASS" };
  const rp = finish(R.step(st.ride, { action: "replan", leg }));
  assert.deepStrictEqual([leg.kwh, rp.used_kwh, R.iso(rp.arrive_jd)], [81995, 82493, "2034-03-10 05:11"]);
  assert.throws(() => R.step(st.ride, { action: "replan", leg: Object.assign({}, leg, { dep_jd: cp.sky_at }) }), /depart at or after 2032-03-28 04:40, when the answer reaches the car/);
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
    [[1, "divert to Phobos, wait 88.2 h", [["hold until open", 45505], ["divert to Phobos, wait 88.2 h", 44419]]]]);
});

ok("par is what the fixture says, and hindsight never needs more energy than flying its legs on defaults (100 fixture hails)", () => {
  let lower = 0;
  for (const T of FX.terms) {
    const p = R.terms(T.hail, T.t0, END, T.seed).par, plain = R.fly(T.hail, p.car, p.legs, T.t0, T.seed).used_kwh;
    assert.strictEqual(p.kwh, T.par.kwh, T.hail + " seed " + T.seed);
    assert(p.kwh <= plain, T.hail + " seed " + T.seed + ": " + p.kwh + " > " + plain);
    if (p.kwh < plain) lower++;
  }
  console.log("   hindsight lowered par on", lower, "of", FX.terms.length, "hails");
  assert.strictEqual(R.terms("ceres-shift", 2461647.5, END, "1").par.kwh, 85063);
});
console.log(n, "passed");
