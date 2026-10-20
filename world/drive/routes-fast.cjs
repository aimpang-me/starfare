// node routes-fast.cjs <part> <parts> : faster plans (total delta-v capped at 45, 60 and 90 km/s) for the long hauls that
// touch the outer system, the liner's routes. Same probe ship and departure window as routes.cjs; output rows merge into
// route-dv-2026-10-19.json by from/to.
const E = require("../engine/sol-page.js");
const R = E.R;
const [part, parts] = process.argv.slice(2).map(Number);
const SHIP = { id: "probe", name: "Probe", dry_kg: 1000, xenon_kg: 1e15, hydrazine_kg: 0, seats: 4, power_w_1au: 1e9, housekeeping_w: 0, ion: true, power_mode: "constant" };
const OUTER = new Set(["jupiter", "saturn", "uranus", "neptune", "io", "europa", "ganymede", "callisto", "enceladus", "titan", "titan-dock", "triton"]);
const rows = require("./route-dv-2026-10-19.json").filter((r) => r.kind === "long" && (OUTER.has(r.from) || OUTER.has(r.to)));
const J = 2461700.5, out = [];
rows.forEach((r, idx) => {
  if (idx % parts !== part) return;
  const row = { from: r.from, to: r.to };
  for (const cap of [45, 60, 90]) {
    const b = E.planRide({ place: r.from }, r.to, { depFrom: J, depTo: J + R.WINDOW, arriveBy: J + 6000, objective: "time", maxBurnKms: cap, allLocal: true, ship: SHIP });
    row["fast" + cap] = b && !b.error ? [+b.dv_total_kms.toFixed(3), +b.tof_days.toFixed(2)] : (b && b.error);
  }
  out.push(row);
});
console.log(JSON.stringify(out));
