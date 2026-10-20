// node size-drive.cjs : sizes the proposed fictional Starseeker drive classes against every bookable route.
// Input: route-dv-2026-10-19.json (made by routes.cjs from the engine's own planner, impulsive Lambert legs).
// Physics is real (rocket equation, constant thrust and exhaust speed, jet power). The class figures are proposals
// labelled Fictional. Nothing here changes the engine.
const fs = require("fs"), path = require("path");
const rows = JSON.parse(fs.readFileSync(path.join(__dirname, "route-dv-2026-10-19.json"), "utf8"));
// Faster plans for the liner's routes (routes-fast.cjs), merged in by from/to when present.
const fastFile = path.join(__dirname, "route-dv-fast-2026-10-19.json");
if (fs.existsSync(fastFile)) for (const f of JSON.parse(fs.readFileSync(fastFile, "utf8"))) Object.assign(rows.find((r) => r.from === f.from && r.to === f.to), f);
const G0 = 9.80665, DAY = 86400;
const OUTER = new Set(["jupiter", "saturn", "uranus", "neptune", "io", "europa", "ganymede", "callisto", "enceladus", "titan", "titan-dock", "triton"]);
const outer = (r) => OUTER.has(r.from) || OUTER.has(r.to);
// Assumptions (stated in the spec): 100 kg per passenger with luggage; 2.5 kg of consumables per person per sky day.
const PAX_KG = 100, LIFE_KG_DAY = 2.5;
// Fictional classes. ve_kms: exhaust speed; thrust_n: constant thrust; eta: jet power / input power; dry_kg: hull, cabin,
// tanks, drive and crew allowance; seats: placeholder until Alvin sets the ladder; cap_kms: the most delta-v one leg may
// use (the "fast" plan's burn cap); serves: which bookings the class flies.
const CLASSES = JSON.parse(process.argv[2] || "null") || [
  { id: "taxi", seats: 6, dry_kg: 6000, ve_kms: 30, thrust_n: 33000, eta: 0.64, serves: "quick" },
  { id: "shuttle", seats: 20, dry_kg: 25000, ve_kms: 30, thrust_n: 60000, eta: 0.64, serves: "inner long" },
  { id: "liner", seats: 100, dry_kg: 200000, ve_kms: 60, thrust_n: 250000, eta: 0.64, serves: "outer long" },
];
const pick = (c) => rows.filter((r) => c.serves === "quick" ? r.kind === "quick" : r.kind === "long" && (c.serves === "outer long") === outer(r));
const energyPlan = (r) => r.energy.filter(Array.isArray).reduce((a, x) => (!a || x[0] > a[0] ? x : a), null); // worst of the sampled dates
function leg(c, dv_kms, tof_days) {
  const mf = c.dry_kg + c.seats * PAX_KG + c.seats * LIFE_KG_DAY * tof_days; // full cabin, consumables for the trip
  const mr = Math.exp(dv_kms / c.ve_kms), mp = mf * (mr - 1), m0 = mf + mp;
  const mdot = c.thrust_n / (c.ve_kms * 1000);
  return { mf, mp, m0, mr, burn_h: mp / mdot / 3600, a0_g: c.thrust_n / m0 / G0, a1_g: c.thrust_n / mf / G0,
    energy_gwh: 0.5 * mp * (c.ve_kms * 1000) ** 2 / c.eta / 3.6e12, life_kg: c.seats * LIFE_KG_DAY * tof_days };
}
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const out = [];
for (const c of CLASSES) {
  const rs = pick(c), jet_w = 0.5 * c.thrust_n * c.ve_kms * 1000;
  const plans = { cheapest: rs.map((r) => energyPlan(r)).filter(Boolean) };
  for (const k of [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => /^fast\d+$/.test(k))) plans[k] = rs.map((r) => Array.isArray(r[k]) ? r[k] : null).filter(Boolean);
  const row = { class: c.id, routes: rs.length, isp_s: Math.round(c.ve_kms * 1000 / G0), jet_mw: jet_w / 1e6, input_mw: jet_w / c.eta / 1e6, waste_mw: jet_w * (1 / c.eta - 1) / 1e6, plans: {} };
  for (const [name, list] of Object.entries(plans)) {
    if (!list.length) continue;
    const L = list.map((x) => leg(c, x[0], x[1]));
    row.plans[name] = { n: list.length, dv_max: Math.max(...list.map((x) => x[0])), tof_p50_d: pct(list.map((x) => x[1]), 0.5), tof_max_d: Math.max(...list.map((x) => x[1])),
      mr_max: Math.max(...L.map((x) => x.mr)), mp_max_t: Math.max(...L.map((x) => x.mp)) / 1000, m0_max_t: Math.max(...L.map((x) => x.m0)) / 1000,
      life_max_t: Math.max(...L.map((x) => x.life_kg)) / 1000, burn_max_h: Math.max(...L.map((x) => x.burn_h)), a0_min_g: Math.min(...L.map((x) => x.a0_g)), a1_max_g: Math.max(...L.map((x) => x.a1_g)),
      energy_max_gwh: Math.max(...L.map((x) => x.energy_gwh)) };
  }
  out.push(row);
}
console.log(JSON.stringify({ assumptions: { PAX_KG, LIFE_KG_DAY }, classes: CLASSES, results: out }, null, 1));
