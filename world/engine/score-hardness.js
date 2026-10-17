// node world/engine/score-hardness.js
// Prints the score of one ride at the stated references, and of the same ride moved off each reference.
// error_count is 1 when a case throws. work_count is the number of cases printed.
const R = require("./sol-page.js").R;
const t0 = 2461700.5;
const legs = [
  { from: "orbital-depot", to: "iss", arr_jd: t0 + 0.03, kwh: 400, fare: 80, gate: "PASS", xenon_kg: 1 },
  { from: "iss", to: "lunar-data-center", arr_jd: t0 + 5, kwh: 37000, fare: 8000, gate: "PASS", xenon_kg: 90 },
];
function ctx(flown, extra) {
  return Object.assign({
    t0, arrive_by_jd: t0 + 9, par_kwh: 37400, best_wait_days: 0.03, plan_calls: 2, ship: "sf-01",
    window_kwh: 37400, throttled_kwh: 37400, hindsight_kwh: 37400,
    quote: { fare_usd: 8000, arrival: R.iso(t0 + 5) },
    flown: flown,
  }, extra || {});
}
const at = { pickup_jd: t0 + 0.03, arrive_jd: t0 + 5, used_kwh: 37400, extra_kwh: 0, incidents: [] };
const cases = [
  ["at_reference", ctx(at)],
  ["energy_10pct_over", ctx(Object.assign({}, at, { used_kwh: 37400 * 1.1 }))],
  ["energy_half", ctx(Object.assign({}, at, { used_kwh: 37400 * 0.5 }))],
  ["on_time_60min", ctx(Object.assign({}, at, { arrive_jd: t0 + 9 + 60 / 1440 }))],
  ["pickup_double", ctx(Object.assign({}, at, { pickup_jd: t0 + 0.06 }))],
  ["promise_30min", ctx(at, { quote: { fare_usd: 8000, arrival: R.iso(t0 + 5 - 30 / 1440) } })],
];
let errors = 0;
const rows = [];
for (const [name, c] of cases) {
  try {
    const sc = R.score("iss-crew", legs, c);
    const energy = sc.parts.find((p) => p.key === "energy").got;
    const maxRatio = sc.parts.reduce((m, p) => p.max > 0 ? Math.max(m, p.got / p.max) : m, 0);
    rows.push([name, sc.score_version, sc.total, sc.out_of, maxRatio, energy].join("\t"));
  } catch (e) {
    errors += 1;
    rows.push([name, "ERR", e.message, "", "", ""].join("\t"));
  }
}
console.log(["case", "score_version", "total", "out_of", "max_part_ratio", "energy_got"].join("\t"));
console.log(rows.join("\n"));
console.log("error_count\t" + errors);
console.log("work_count\t" + cases.length);
