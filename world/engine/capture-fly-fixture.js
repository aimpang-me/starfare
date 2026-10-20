// Captures what R.fly and R.terms return today, for 5 hails x 20 seasons, so a rewrite of the ride engine can be
// checked against it (test-reroute.js). Run from the repo root: node world/engine/capture-fly-fixture.js
// Prints R.terms wall time over the 100 rides. Pass --time to time without rewriting the fixture.
"use strict";
const fs = require("fs"), path = require("path");
const R = require("./sol-page.js").R;
const END = 2461329.5 + 7000 - 1, SEEDS = 20;
const t0Of = (h, s) => Math.floor(2461400 + s * 97 + (h.kind === "quick" ? 1 : R.LEAD)) + 0.5;

const rides = [], terms = [];
let termsMs = 0;
for (let s = 1; s <= SEEDS; s++) {
  const seed = String(s);
  for (const h of R.HAILS) {
    const t0 = t0Of(h, s), a = process.hrtime.bigint();
    let T;
    try { T = R.terms(h.id, t0, END, seed); }
    catch (e) {
      termsMs += Number(process.hrtime.bigint() - a) / 1e6;
      terms.push({ hail: h.id, seed, t0, error: String(e && e.message || e) });
      continue;
    }
    termsMs += Number(process.hrtime.bigint() - a) / 1e6;
    terms.push({ hail: h.id, seed, t0, arrive_by_jd: T.arrive_by_jd, par: T.par });
    rides.push({ hail: h.id, seed, t0, car: T.par.car, kind: "par", legs: T.par.legs, flown: R.fly(h.id, T.par.car, T.par.legs, t0, seed) });
    for (const c of R.nearCars(h)) {
      try {
        const st = R.pickupStart(h.id, c.id, t0, seed);
        // Planned on the ship itself, for the people aboard each leg (an empty pickup, then the party).
        const p = R.planLeg(c.at, h.from, st, "energy", END, c.id, 0), r = R.planLeg(h.from, h.to, p.arr_jd + R.DWELL, "energy", END, c.id, h.party);
        const legs = [
          { from: c.at, to: h.from, dep_jd: p.dep_jd, arr_jd: p.arr_jd, kwh: p.battery.energy_kwh, fare: p.fare.total_usd, aboard: p.battery.aboard },
          { from: h.from, to: h.to, dep_jd: r.dep_jd, arr_jd: r.arr_jd, kwh: r.battery.energy_kwh, fare: r.fare.total_usd, aboard: r.battery.aboard }];
        rides.push({ hail: h.id, seed, t0, car: c.id, kind: "energy", legs, flown: R.fly(h.id, c.id, legs, t0, seed) });
      } catch (e) {}
    }
  }
}
console.log(`R.terms: ${terms.length} rides in ${termsMs.toFixed(0)} ms (${(termsMs / terms.length).toFixed(1)} ms each)`);
if (!process.argv.includes("--time")) {
  const out = path.join(__dirname, "fixtures", "fly-baseline.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ end_jd: END, rides, terms }) + "\n");
  console.log(`wrote ${rides.length} flown rides and ${terms.length} par terms to ${path.relative(process.cwd(), out)}`);
}
