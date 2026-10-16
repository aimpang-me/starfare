// node world/engine/test-hazards.js : checks for the simulated hazard layer in sol-rides.js (via the bundle).
const assert = require("assert"), E = require("./sol-page.js"), R = E.R;
const END = 2461329.5 + 7000 - 1, t0 = 2461700.5;
let n = 0; const ok = (name, f) => { f(); n++; console.log("ok", name); };
ok("hazards are seeded: same seed same weather, other seed differs", () => {
  const a = R.hazards("7"), b = R.hazards("7"), c = R.hazards("8");
  assert.strictEqual(a, b);
  const days = [...Array(400).keys()].map((d) => t0 + d);
  const fa = days.map((d) => R.hazards("7").flareOdds(Math.floor(d))), fc = days.map((d) => c.flareOdds(Math.floor(d)));
  assert.notDeepStrictEqual(fa, fc);
});
ok("flare odds stay in their stated ranges and both spells happen", () => {
  const H = R.hazards("1"), o = [...Array(2000).keys()].map((d) => H.flareOdds(2461400 + d));
  assert(o.every((x) => x === 0.05 || (x >= 0.25 && x <= 0.6)));
  assert(o.some((x) => x === 0.05) && o.some((x) => x > 0.25));
});
ok("pad forecast never shows more than actually docks (unscheduled traffic is hidden)", () => {
  const H = R.hazards("1"); let hidden = 0;
  for (let h = 0; h < 2000; h++){ const n = Math.floor(t0 * 24) + h, all = H.docked("iss", n, null), sch = H.docked("iss", n, null, true);
    assert(sch <= all); hidden += all - sch; }
  assert(hidden > 0);
  const f = R.padForecast("iss", t0, 24, "iss-crew", t0, "1");
  assert.strictEqual(f.hours.length, 24); assert.strictEqual(f.berths, 2);
});
ok("fly: no hazards means the plan happens as planned; holds add 250 kWh an hour", () => {
  for (let i = 0; i < 40; i++){
    const s = String(i), T = R.terms("iss-crew", t0 + i * 3, END, s), legs = T.par.legs, F = R.fly("iss-crew", T.par.car, legs, t0 + i * 3, s);
    const holds = F.incidents.filter((x) => x.kind === "pad_busy").reduce((a, x) => a + x.kwh, 0);
    holds && assert(Math.abs(holds - Math.round(F.incidents.filter((x) => x.kind === "pad_busy").reduce((a, x) => a + x.hours, 0) * 250)) <= 2);
    if (!F.incidents.length){ assert.strictEqual(F.arrive_jd, legs[1].arr_jd); assert.strictEqual(F.extra_kwh, 0); }
    assert(F.arrive_jd >= legs[1].arr_jd - 1e-9);
  }
});
ok("flares hold only the ride (a car flies empty through one)", () => {
  const H = R.hazards("1"); let d = 2461400; while (!H.flareAt(d + 0.5, "iss")) d++;
  const f = H.flareAt(d + 0.5, "iss"), at = f.start + 0.01;
  const P = { from: "orbital-depot", to: "iss", dep_jd: at, arr_jd: at + 0.03, kwh: 400, fare: 80 }, Rr = { from: "iss", to: "lunar-data-center", dep_jd: at + 0.09, arr_jd: at + 5, kwh: 37000, fare: 8000 };
  const F = R.fly("iss-crew", "sf-01", [P, Rr], 0, "1");
  assert(!F.incidents.some((x) => x.kind === "flare" && x.leg === "pickup"));
  if (Rr.dep_jd < f.end) assert(F.incidents.some((x) => x.kind === "flare" && x.leg === "ride") && F.ride_depart_jd >= f.end - 1e-9);
});
ok("a flare's storm reaches a place at 1500 km/s, and fewer reach far out (1/r^2)", () => {
  assert(Math.abs(R.flareReach("earth", t0).travel_days * 24 - 27.2) < 0.6);
  const sat = R.flareReach("saturn", t0); assert(sat.travel_days * 24 > 250 && sat.travel_days * 24 < 270 && sat.share > 0.010 && sat.share < 0.013);
  assert.strictEqual(R.flareReach("mercury", t0).share, 1);
  const H = R.hazards("1"), storms = (place) => { const seen = new Set();
    for (let jd = t0; jd < t0 + 1500; jd += 1 / 12){ const f = H.flareAt(jd, place); if (f) seen.add(place == null ? f.start : f.erupted); } return seen; };
  const sun = storms(null), merc = storms("mercury"), earth = storms("earth"), saturn = storms("saturn");
  const m = [...merc].pop(); assert(sun.has(m)); assert(Math.abs(H.flareAt(m + R.flareReach("mercury", m).travel_days + 1e-6, "mercury").start - m - R.flareReach("mercury", m).travel_days) < 1e-9);
  assert(earth.size > 100 && Math.abs(merc.size - earth.size) <= 0.04 * earth.size);
  assert(saturn.size < earth.size * 0.05, saturn.size + " storms reached Saturn, " + earth.size + " Earth");
  const near = R.flareForecast(t0, 30, "1", "earth"), far = R.flareForecast(t0, 30, "1", "saturn");
  assert(near.some((x) => x.flare_odds >= 0.2) && far.every((x) => x.flare_odds <= 0.02));
});
ok("busy cars: check() refuses a pickup that leaves before the car is free", () => {
  let found = null;
  for (let i = 0; i < 200 && !found; i++){ const s = String(i), st = R.fleetState("iss-crew", t0, s).find((c) => c.car === "sf-01" && c.busy_until_jd); if (st) found = [s, st]; }
  assert(found, "no busy SF-01 in 200 seeds");
  const [s, st] = found, P = { from: "orbital-depot", to: "iss", dep_jd: t0, arr_jd: t0 + 0.03 }, Rr = { from: "iss", to: "lunar-data-center", dep_jd: t0 + 0.09, arr_jd: t0 + 5 };
  assert(R.check("iss-crew", "sf-01", [P, Rr], t0, s).some((e) => /busy/.test(e)));
  assert.strictEqual(R.check("iss-crew", "sf-01", [P, Rr]).length, 0); // no t0: old callers unchanged
  assert.strictEqual(R.pickupStart("iss-crew", "sf-01", t0, s), st.busy_until_jd);
});
ok("score: kept promise falls to 0 at 6 h late on a quick hail; early costs a quarter as much", () => {
  const legs = [{ arr_jd: t0 + 0.03, kwh: 400, gate: "PASS" }, { arr_jd: t0 + 5, kwh: 37000, fare: 8000, gate: "PASS" }];
  const ctx = (slipH, q) => ({ t0, arrive_by_jd: t0 + 9, par_kwh: 37400, best_wait_days: 0.03, plan_calls: 2, quote: { fare_usd: 8000, arrival: R.iso(t0 + 5 + (q || 0)) },
    flown: { pickup_jd: t0 + 0.03, arrive_jd: t0 + 5 + slipH / 24, used_kwh: 37400, extra_kwh: 0, incidents: [] } });
  const part = (sc) => sc.parts.find((p) => p.key === "promise").got;
  assert.strictEqual(R.score("iss-crew", legs, ctx(0)).total, 100);
  assert.strictEqual(part(R.score("iss-crew", legs, ctx(6))), 0);
  assert(Math.abs(part(R.score("iss-crew", legs, ctx(3))) - 7.5) < 0.2);
  assert(Math.abs(part(R.score("iss-crew", legs, ctx(-6))) - 11.2) < 0.2);
  const parts = R.score("iss-crew", legs, ctx(0)).parts; assert.strictEqual(parts.reduce((a, p) => a + p.max, 0), 100);
});
console.log(n, "passed");
