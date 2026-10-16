// Finds the rides test-reroute.js pins: a Phobos commute landing into a long Mars Base dust storm, where diverting
// to Phobos beats holding. Run from the repo root: node world/engine/find-reroute-cases.js [seeds]
"use strict";
const R = require("./sol-page.js").R;
const END = 2461329.5 + 7000 - 1, SEEDS = +process.argv[2] || 20;
const fin = (st) => { while (st.checkpoint) st = R.step(st.ride, null); return st.done; };
for (let s = 1; s <= SEEDS; s++) {
  const seed = String(s), H = R.hazards(seed);
  let seen = null;
  for (let jd = 2461400; jd < 2462400; jd += 0.25) {
    const w = H.weatherAt("mars-base", jd);
    if (!w || (seen && seen.start === w.start) || w.end - w.start < 3.6) continue;
    seen = w;
    const r = R.planLeg("phobos", "mars-base", w.start - 2.23 / 24, "energy", END), p = R.planLeg("mars-base", "phobos", r.dep_jd - 1, "energy", END);
    const leg = (b, from, to) => ({ from, to, dep_jd: b.dep_jd, arr_jd: b.arr_jd, kwh: b.battery.energy_kwh, fare: b.fare.total_usd, gate: "local" });
    const legs = [leg(p, "mars-base", "phobos"), leg(r, "phobos", "mars-base")], t0 = Math.floor(p.dep_jd) - 0.5;
    const st = R.start("phobos-commute", "sf-03", legs, t0, seed, { ask_after_hours: 1, end_jd: END }), cp = st.checkpoint;
    if (!cp || cp.kind !== "pad_closed" || cp.place !== "mars-base") continue;
    const row = R.regret(R.step(st.ride, { action: "hold" }).ride)[0];
    const hold = row.options[0], div = row.options.find((o) => o.decision.action === "divert");
    if (div && div.used_kwh < hold.used_kwh) console.log(JSON.stringify({ seed, t0, legs, storm_hours: +((w.end - w.start) * 24).toFixed(1), hold: hold.used_kwh, divert: [div.option, div.used_kwh] }));
  }
}
