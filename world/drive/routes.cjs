// node routes.cjs <part> <parts> : delta-v and transit time for every bookable route (the first 400 hails of seeds 1 to 8),
// planned by the engine with a probe ship that never runs short of power or propellant, so only the orbital geometry
// limits it. Prints JSON rows. "0 1" plans every route in one process; route-dv-2026-10-19.json joins four parts.
const E = require("../engine/sol-page.js");
const R = E.R;
const [part, parts] = process.argv.slice(2).map(Number);
const SHIP = { id: "probe", name: "Probe", dry_kg: 1000, xenon_kg: 1e15, hydrazine_kg: 0, seats: 4, power_w_1au: 1e9, housekeeping_w: 0, ion: true, power_mode: "constant" };
const routes = [], seen = new Set();
for (let s = 1; s <= 8; s++) for (let i = 0; i < 400; i++) { const h = R.hailRow(String(s), i); const k = h.from + ">" + h.to; if (!seen.has(k)) { seen.add(k); routes.push([h.from, h.to, h.kind]); } }
routes.sort();
const J = 2461700.5, deps = [J, J + 500, J + 1000];
const out = [];
routes.forEach(([from, to, kind], idx) => {
  if (idx % parts !== part) return;
  const row = { from, to, kind, energy: [], fast15: null, fast30: null };
  for (const d of deps) {
    const b = E.planRide({ place: from }, to, { depFrom: d, depTo: d + R.WINDOW, arriveBy: d + 6000, objective: "energy", allLocal: true, ship: SHIP });
    if (b && !b.error) row.energy.push([+b.dv_total_kms.toFixed(3), +b.tof_days.toFixed(2), b.dv_dep_kms, b.dv_arr_kms]);
    else row.energy.push(b && b.error);
  }
  for (const [k, cap] of [["fast15", 15], ["fast30", 30]]) {
    const b = E.planRide({ place: from }, to, { depFrom: J, depTo: J + R.WINDOW, arriveBy: J + 6000, objective: "time", maxBurnKms: cap, allLocal: true, ship: SHIP });
    row[k] = b && !b.error ? [+b.dv_total_kms.toFixed(3), +b.tof_days.toFixed(2)] : (b && b.error);
  }
  out.push(row);
});
console.log(JSON.stringify(out));
