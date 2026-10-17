// crosscheck.mjs -- run routes through sol-engine.js and through the existing Python (sol/code, DE421) and
// compare.  usage: node crosscheck.mjs [--only id,id] [--no-python-refly] [--fresh]
// Python jobs run in separate processes (crosscheck_py.py), 4 at a time, cached in $SOL_CACHE (default
// os.tmpdir()/sol-crosscheck-cache) so a re-run only redoes what changed.  Writes crosscheck_results.json and the
// generated part of CHECK.md (between the GENERATED markers; the hand-written analysis above it is kept).
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import * as S from "./sol-engine.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = process.env.SOL_CACHE || path.join(os.tmpdir(), "sol-crosscheck-cache");
fs.mkdirSync(CACHE, { recursive: true });
const args = process.argv.slice(2);
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const FRESH = args.includes("--fresh");
const PYVER = "py-3";  // bump when crosscheck_py.py changes (cache key)
const loadedBodies = new Set(S.init(JSON.parse(fs.readFileSync(path.join(HERE, "ephem.json")))).bodies);
const jd = S.jdFromIso;
const EPH_END_QUOTE = 2471000.0;  // quote.py EPH_END
const TOFMAX = { mercury: 300, venus: 400, bennu: 1000, ceres: 1800, mars: 700, jupiter: 2600, saturn: 4800, uranus: 9000, neptune: 13000 };

// ------------------------------------------------------------------ routes
// quote: Earth -> body exactly as quote.py (its grid, objective, filters); Python reference = quote.py itself
const Q = (id, dest, from, to, o = {}) => ({ id, type: "quote", dest, from, to, ...o });
// trip: trip.py's searches; Python reference = trip.py itself
// gen: any origin/dest, Python reference = crosscheck_py.py grid (same grid, independent code + DE421)
const G = (id, origin, dest, from, to, o = {}) => ({ id, type: "gen", origin, dest, from, to, ...o });
const ROUTES = [
  Q("Q01 earth-mars c3", "mars", "2026-10-16", "2026-12-24"),
  Q("Q02 earth-mars tof c3<=15", "mars", "2026-10-16", "2027-03-31", { objective: "tof", maxC3: 15 }),
  Q("Q03 earth-mars 2028", "mars", "2028-01-01", "2028-12-31"),
  Q("Q04 earth-mercury", "mercury", "2027-01-01", "2027-02-14"),
  Q("Q05 earth-mercury c3<=20", "mercury", "2026-10-16", "2027-12-31", { maxC3: 20 }),
  Q("Q06 earth-venus", "venus", "2026-10-16", "2027-06-01", { arrBy: "2027-06-01" }),
  Q("Q07 earth-jupiter", "jupiter", "2027-01-01", "2027-12-31"),
  Q("Q08 earth-jupiter tof c3<=100", "jupiter", "2026-10-16", "2027-10-16", { objective: "tof", maxC3: 100 }),
  Q("Q09 earth-saturn", "saturn", "2028-01-01", "2028-12-31"),
  Q("Q10 earth-uranus", "uranus", "2029-01-01", "2029-12-31"),
  Q("Q11 earth-neptune", "neptune", "2033-01-01", "2033-12-31"),
  Q("Q13 earth-bennu 1-rev", "bennu", "2026-10-16", "2028-12-31"),
  Q("Q14 earth-bennu tof c3<=100", "bennu", "2026-10-16", "2027-01-16", { objective: "tof", maxC3: 100 }),
  Q("Q15 earth-ceres", "ceres", "2027-01-01", "2027-12-31", { arrBy: "2029-12-31" }),
  { id: "T1 titan-earth energy (trip fleet)", type: "trip", origin: "titan", dest: "earth", argv: ["trip.py", "--driver", "fleet", "--objective", "energy"], objective: "energy", tofMin: 1200 },
  { id: "T2 titan-earth time (trip fleet fast)", type: "trip", origin: "titan", dest: "earth", argv: ["trip.py", "--driver", "fleet", "--objective", "time"], objective: "time", tofMin: 300 },
  G("G01 mars-earth", "mars", "earth", "2027-01-01", "2028-12-31"),
  G("G02 saturn-earth (5,000 km Saturn orbit)", "saturn", "earth", "2026-10-16", "2029-10-16", { tof: [1200, 4400] }),
  G("G03 earth-saturn capture", "earth", "saturn", "2028-01-01", "2028-12-31", { tof: [1000, 4800] }),
  G("G04 jupiter-earth", "jupiter", "earth", "2027-01-01", "2028-06-30", { tof: [400, 2600] }),
  G("G05 venus-mars", "venus", "mars", "2027-01-01", "2028-06-30", { tof: [60, 700] }),
  G("G06 mars-jupiter", "mars", "jupiter", "2027-01-01", "2028-12-31", { tof: [300, 2600] }),
  G("G07 ceres-mars", "ceres", "mars", "2027-01-01", "2028-12-31", { tof: [100, 1500] }),
  G("G08 bennu-earth", "bennu", "earth", "2027-01-01", "2028-12-31", { tof: [60, 1000] }),
  G("G10 mercury-venus", "mercury", "venus", "2027-01-01", "2027-12-31", { tof: [30, 400] }),
  G("G11 iss-mars", "iss", "mars", "2026-10-16", "2026-12-24", { tof: [20, 700] }),
  G("G12 lunar-data-center-mars", "lunar-data-center", "mars", "2026-10-16", "2026-12-24", { tof: [20, 700] }),
  G("G13 mars-base-ceres-port", "mars-base", "ceres-port", "2026-10-16", "2027-10-16", { tof: [100, 1500] }),
  G("G14 titan-dock-earth", "titan-dock", "earth", "2026-10-16", "2027-10-16", { tof: [1000, 4400] }),
  G("G15 europa-earth", "europa", "earth", "2027-01-01", "2027-12-31", { tof: [400, 2600] }),
  G("G16 earth-triton", "earth", "triton", "2033-01-01", "2033-12-31", { tof: [4000, 7000] }),
  G("G17 ship-mars", { ship: { r: [1.2e8, 0.9e8, 0], v: [-18, 24, 0.5], jd: 2461329.5 } }, "mars", "2026-10-16", "2027-02-13", { tof: [20, 700] }),
  G("G18 uranus-earth", "uranus", "earth", "2030-01-01", "2030-12-31", { tof: [4000, 8000] }),
  // exact day-2 legs (refly only): the Uranus case the Python checker rejects, and the Saturn / Neptune legs
  { id: "D1 day-2 uranus leg (REJECT in Python)", type: "leg", origin: "earth", dest: "uranus", dep_jd: 2462387.899999995, tof_days: 8345.0, revs: 0, lowpath: true },
  { id: "D2 day-2 neptune leg", type: "leg", origin: "earth", dest: "neptune", dep_jd: 2463753.3500000145, tof_days: 6195.0, revs: 0, lowpath: true },
  { id: "D3 day-2 saturn leg", type: "leg", origin: "earth", dest: "saturn", dep_jd: 2461969.916666656, tof_days: 2156.0, revs: 0, lowpath: true },
  { id: "D4 titan ride home leg (receipts/titan_fleet)", type: "leg", origin: "titan", dest: "earth", dep_jd: jd("2026-10-21"), tof_days: 1970.0, revs: 0, lowpath: true, mode: "centre" },
  // local transfers (Hohmann around Earth; no Python planner exists: checked against the formula + quote.py moon)
  { id: "L1 iss-orbital-depot", type: "local", origin: "iss", dest: "orbital-depot", from: "2026-10-16" },
  { id: "L2 moon-earth", type: "local", origin: "moon", dest: "earth", from: "2026-10-16" },
  { id: "L3 earth-lunar-data-center", type: "local", origin: "earth", dest: "lunar-data-center", from: "2026-10-16" },
];
const pyName = (id) => { // the name refly_leg understands for a place's Sun-centred anchor
  const p = S.PLACES.find((x) => x.id === id);
  if (p.kind === "planet" || p.kind === "small") return p.id;
  if (p.kind === "moon") return p.parent;
  const par = S.PLACES.find((x) => x.id === p.parent);
  return par.kind === "moon" ? par.parent : par.id;
};

// ------------------------------------------------------------------ python job runner (parallel, cached)
function pyJob(job) {
  const key = crypto.createHash("sha1").update(JSON.stringify(job) + PYVER
    + (job.ephem === "cheb" ? fs.statSync(path.join(HERE, "ephem.json")).mtimeMs : "")).digest("hex");
  const f = path.join(CACHE, key + ".json");
  if (!FRESH && fs.existsSync(f)) return Promise.resolve(JSON.parse(fs.readFileSync(f))[0]);
  return new Promise((res) => queue.push({ job, f, res })) .then((r) => r);
}
const queue = []; let running = 0;
function pump() {
  while (running < 4 && queue.length) {
    const { job, f, res } = queue.shift(); running++;
    const jf = f.replace(/\.json$/, ".in.json");
    fs.writeFileSync(jf, JSON.stringify([job]));
    const p = spawn("python3", [path.join(HERE, "crosscheck_py.py"), jf, f], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", () => {
      running--; fs.rmSync(jf, { force: true });
      let r; try { r = JSON.parse(fs.readFileSync(f))[0]; } catch { r = { error: "python failed: " + err.slice(-500) }; }
      res(r); pump();
    });
  }
}
setInterval(() => pump(), 200).unref();

// ------------------------------------------------------------------ build the JS side
const strip = (o) => { if (!o || o.error) return o; const { arc_au, not_priced, alternatives, ...r } = o; return r; };
function quoteSetup(r) {
  const j0 = jd(r.from), j1 = jd(r.to), tmax = TOFMAX[r.dest];
  const arriveBy = Math.min(r.arrBy ? jd(r.arrBy) : Infinity, EPH_END_QUOTE);
  const base = { depFrom: j0, depTo: j1, arrive: "none", delayPenalty: 0, objective: r.objective === "tof" ? "tof" : "energy",
    maxBurnKms: Infinity, maxC3: r.maxC3 ?? Infinity, arriveBy, skip180: true, minTofDays: 20, maxTofDays: tmax };
  const grid = { depStep: Math.max(1, (j1 - j0) / 120), tofMin: 20, tofMax: tmax, tofStep: Math.max(2, tmax / 200), inclusive: true };
  const argv = ["quote.py", "--dest", r.dest, "--dep-from", r.from, "--dep-to", r.to, "--objective", r.objective === "tof" ? "tof" : "c3"];
  if (r.maxC3) argv.push("--max-c3", String(r.maxC3));
  if (r.arrBy) argv.push("--arr-by", r.arrBy);
  return { origin: "earth", dest: r.dest, base, grid, argv };
}
function tripSetup(r) {
  const now = jd("2026-10-16");
  const base = { depFrom: now, depTo: now + 3 * 365.25, requestJd: now, arrive: r.capture ? "capture" : "none", objective: r.objective,
    delayPenalty: 0.1, maxBurnKms: r.objective === "time" ? 15 : Infinity, skip180: false, minTofDays: r.tofMin, maxTofDays: 4400 };
  return { origin: r.origin, dest: r.dest, base, grid: { depStep: 5, tofMin: r.tofMin, tofMax: 4400, tofStep: 10, inclusive: false } };
}
function genSetup(r) {
  const j0 = jd(r.from), j1 = jd(r.to), [t0, t1] = r.tof || [20, 700];
  const base = { depFrom: j0, depTo: j1, arrive: "capture", objective: "energy", delayPenalty: 0.1, skip180: true, minTofDays: t0, maxTofDays: t1 };
  const nd = 120, nt = 200;
  return { origin: r.origin, dest: r.dest, base, grid: { depStep: (j1 - j0) / nd, tofMin: t0, tofMax: t1, tofStep: (t1 - t0) / nt, inclusive: false } };
}
const toEp = (x) => typeof x === "string" ? { place: x } : x;

const results = [];
const t00 = Date.now();
const sel = ROUTES.filter((r) => !ONLY || ONLY.some((o) => r.id.startsWith(o)));
// phase 1: all JS work, single-threaded and quiet, so the timings mean something
for (const r of sel) {
  const out = { id: r.id, type: r.type };
  results.push(out);
  if (r.type === "local") {
    const t = performance.now();
    out.js = S.planRide(r.origin, r.dest, { depFrom: jd(r.from) });
    out.js_ms = performance.now() - t;
    out.js_refly = S.refly(out.js);
    continue;
  }
  if (r.type === "leg") {
    out.leg = { origin: toEp(r.origin), dest: toEp(r.dest), dep_jd: r.dep_jd, tof_days: r.tof_days, revs: r.revs, lowpath: r.lowpath };
    out.mode = r.mode || (r.origin === "earth" ? "leo" : "centre");
    out.js_refly = S.refly(out.leg, { mode: out.mode, rtol: 1e-10 });
    out.js_refly12 = S.refly(out.leg, { mode: out.mode });
    continue;
  }
  const st = r.type === "quote" ? quoteSetup(r) : r.type === "trip" ? tripSetup(r) : genSetup(r);
  out.setup = { ...st, origin: toEp(st.origin), dest: toEp(st.dest) };
  let t = performance.now();
  out.js_grid = S.planRide(toEp(st.origin), toEp(st.dest), { ...st.base, grid: st.grid });
  out.js_grid_ms = performance.now() - t;
  t = performance.now();
  const ref = S.planRide(toEp(st.origin), toEp(st.dest), st.base);
  out.js_refined_ms = performance.now() - t;
  out.js_refined = strip(ref);
  out.js_grid = strip(out.js_grid);
  out.mode = r.type === "quote" ? "leo" : "centre";
  if (out.js_grid && !out.js_grid.error) {
    out.js_refly = S.refly(out.js_grid, { mode: out.mode, rtol: 1e-10 });   // parity with refly.py
    out.js_refly12 = S.refly(out.js_grid, { mode: out.mode });               // engine default rtol 1e-12
    if (st.origin !== "earth" && pyName(typeof st.origin === "string" ? st.origin : "earth") === "earth" && typeof st.origin === "string")
      out.js_refly_default = S.refly(out.js_grid);  // e.g. ISS: leo mode from the station's own altitude
  }
  if (ref && !ref.error) out.js_refly_refined = S.refly(ref, { mode: out.mode });
  process.stderr.write(`JS done ${r.id} (${((Date.now() - t00) / 1000).toFixed(0)} s)\n`);
}

// phase 2: Python
const pend = [];
for (const out of results) {
  const r = sel.find((x) => x.id === out.id);
  if (r.type === "local") {
    pend.push(pyJob({ kind: "cli", argv: ["quote.py", "--dest", "moon", "--dep-from", "2026-11-20", "--dep-to", "2026-11-20"] }).then((p) => { out.py_moon = p; }));
    continue;
  }
  const legOf = (o) => o && !o.error ? { dep_jd: o.dep_jd, tof_days: o.tof_days, revs: o.revs, lowpath: o.lowpath } : null;
  const reflyJob = (leg, ephem, rtol) => {
    if (!leg) return null;
    const x = rtol ? { rtol } : {};
    if (out.mode === "leo") return { kind: "refly", mode: "leo", dest: pyName(r.dest), ...leg, ephem, ...x };
    if (typeof r.origin !== "string") return null;  // ships: no Python re-fly exists
    return { kind: "refly", mode: "centre", src: pyName(r.origin), dst: pyName(r.dest), ...leg, ephem, ...x };
  };
  if (r.type === "leg") {
    const L = { dep_jd: r.dep_jd, tof_days: r.tof_days, revs: r.revs, lowpath: r.lowpath };
    pend.push(pyJob(reflyJob(L, "de421")).then((p) => { out.py_refly = p; }));
    pend.push(pyJob(reflyJob(L, "de421", 1e-12)).then((p) => { out.py_refly12 = p; }));
    pend.push(pyJob(reflyJob(L, "cheb")).then((p) => { out.py_refly_cheb = p; }));
    continue;
  }
  const st = out.setup;
  if (r.type === "quote" || r.type === "trip") pend.push(pyJob({ kind: "cli", argv: r.type === "quote" ? st.argv : r.argv }).then((p) => { out.py_cli = p; }));
  if (r.type !== "quote") pend.push(pyJob({ kind: "grid", origin: st.origin, dest: st.dest, grid: st.grid, ...st.base, maxBurnKms: st.base.maxBurnKms ?? undefined,
    arriveBy: st.base.arriveBy }).then((p) => { out.py_grid = p; }));
  // Python values at the JS points (grid and refined): ephemeris + Lambert + burn agreement at arbitrary times
  for (const [k, o] of [["py_eval_grid", out.js_grid], ["py_eval_refined", out.js_refined]])
    if (o && !o.error) pend.push(pyJob({ kind: "eval", origin: st.origin, dest: st.dest, arrive: st.base.arrive, ...legOf(o) }).then((p) => { out[k] = p; }));
  const rj = reflyJob(legOf(out.js_grid), "de421");
  if (rj) {
    pend.push(pyJob(rj).then((p) => { out.py_refly = p; }));
    pend.push(pyJob(reflyJob(legOf(out.js_grid), "de421", 1e-12)).then((p) => { out.py_refly12 = p; }));
    pend.push(pyJob(reflyJob(legOf(out.js_grid), "cheb")).then((p) => { out.py_refly_cheb = p; }));
    const rr = reflyJob(legOf(out.js_refined), "de421", 1e-12);
    if (rr) pend.push(pyJob(rr).then((p) => { out.py_refly_refined12 = p; }));
  }
}
// unit batch: random Lambert (0/1 rev, both branches) and Kepler cases, plus titan_burn vs trip.py's formula
const UNIT = (() => {
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const lam = [], kep = [], vinf = [];
  for (let i = 0; i < 3000; i++) lam.push({ r1: [(rnd() - 0.5) * 6e8, (rnd() - 0.5) * 6e8, (rnd() - 0.5) * 6e7], r2: [(rnd() - 0.5) * 3e9, (rnd() - 0.5) * 3e9, (rnd() - 0.5) * 3e8],
    tof: (20 + rnd() * 6000) * 86400, M: rnd() < 0.5 ? 0 : 1, low: rnd() < 0.5 });
  for (let i = 0; i < 2000; i++) {
    const r = [(rnd() - 0.5) * 6e8, (rnd() - 0.5) * 6e8, (rnd() - 0.5) * 6e7], sp = Math.sqrt(S.MU_SUN / Math.hypot(...r)) * (0.3 + rnd() * 1.6);
    kep.push({ r, v: [(rnd() - 0.5) * 2 * sp, (rnd() - 0.5) * 2 * sp, (rnd() - 0.5) * 0.4 * sp], dt: (rnd() - 0.3) * 4e8 });
  }
  for (let i = 0; i <= 40; i++) vinf.push(i * 0.5);
  return { kind: "unit", lambert: lam, kepler: kep, vinf };
})();
let unitRes = null;
pend.push(pyJob(UNIT).then((p) => { unitRes = p; }));
pump();
await Promise.all(pend);
const unit = (() => {
  if (!unitRes || unitRes.error) return { error: unitRes?.error || "no result" };
  let both = 0, dis = [], n = 0, mx = 0, mxa = 0;
  UNIT.lambert.forEach((c, i) => {
    let j; try { const L = S.lambert(c.r1, c.r2, c.tof, S.MU_SUN, c.M, c.low); j = [L.v1, L.v2, L.angle_deg]; } catch (e) { j = String(e.message); }
    const p = unitRes.lambert[i];
    if (typeof p === "string" || typeof j === "string") { if (typeof p === "string" && typeof j === "string") both++; else dis.push(i); return; }
    n++; for (let a = 0; a < 2; a++) for (let k = 0; k < 3; k++) mx = Math.max(mx, Math.abs(p[a][k] - j[a][k]));
    mxa = Math.max(mxa, Math.abs(p[2] - j[2]));
  });
  let kn = 0, kmx = 0, kdis = 0;
  UNIT.kepler.forEach((c, i) => {
    let j; try { const s = S.kepler(S.MU_SUN, c.r, c.v, c.dt); j = [s.r, s.v]; } catch (e) { j = String(e.message); }
    const p = unitRes.kepler[i];
    if (typeof p === "string" || typeof j === "string") { if (!(typeof p === "string" && typeof j === "string")) kdis++; return; }
    kn++; const sc = Math.max(...p[0].map(Math.abs)); for (let k = 0; k < 3; k++) kmx = Math.max(kmx, Math.abs(p[0][k] - j[0][k]) / sc);
  });
  const tb = Math.max(...UNIT.vinf.map((v, i) => Math.abs(S.titanBurn(v) - unitRes.titan_burn[i])));
  return { lambert_solved: n, lambert_both_raise: both, lambert_disagree: dis.length, lambert_max_dv_kms: mx, lambert_max_angle_deg: mxa,
           kepler_cases: kn, kepler_disagree: kdis, kepler_max_rel_dr: kmx, titan_burn_max_diff_kms: tb };
})();
results.forEach((o) => { if (o.setup) delete o.setup.base.grid; });
fs.writeFileSync(path.join(HERE, "crosscheck_results.json"), JSON.stringify({ generated: new Date().toISOString(), unit, routes: results }, null, 1));
writeReport(results, unit);
process.stderr.write(`all done in ${((Date.now() - t00) / 1000).toFixed(0)} s\n`);
process.exit(0);

// ------------------------------------------------------------------ report
function writeReport(R, unit) {
  const f = (x, d = 3) => x == null || !isFinite(x) ? "-" : Number(x).toFixed(d);
  const D = (a, b) => a == null || b == null ? "-" : (a - b === 0 ? "0" : (a - b).toExponential(1));
  const iso = (j) => j == null ? "-" : S.isoFromJd(j, true);
  const L = [];
  // 1. planner: same grid
  L.push("### A. Planner, same grid: JS grid mode vs Python", "",
    "Python reference: quote.py / trip.py themselves for Q/T rows; crosscheck_py.py grid (independent burn code, DE421, lambert_izzo, kepler) for G rows. 'same' = identical grid point and branch.", "",
    "| route | Python depart | Python TOF d | JS depart | JS TOF d | branch | same pt | C3 or v∞ dep: Py / JS (km²/s² or km/s) | dv dep JS-Py km/s | dv arr JS-Py km/s | cost JS-Py |",
    "|---|---|---|---|---|---|---|---|---|---|---|");
  const worst = {};
  const W = (k, v, id) => { if (v == null || !isFinite(v)) return; if (!worst[k] || Math.abs(v) > Math.abs(worst[k].v)) worst[k] = { v, id }; };
  for (const o of R) {
    if (!o.js_grid) continue;
    const g = o.js_grid;
    let py = null;
    if (o.type === "quote" && o.py_cli?.out) {
      const q = o.py_cli.out;
      py = q.ok === false && !q.dep_jd ? { error: q.error } : { dep_jd: q.dep_jd, tof_days: q.tof_days, revs: q.revs ?? 0, lowpath: q.lowpath ?? true, c3: q.c3_km2s2, va: q.vinf_arrival_kms };
    } else if (o.py_grid?.best) { const b = o.py_grid.best; py = { dep_jd: b.dep_jd, tof_days: b.tof_days, revs: b.revs, lowpath: b.lowpath, c3: b.c3, vd: b.vd, va: b.va, dvd: b.dvd, dva: b.dva, cost: b.cost }; }
    else if (o.py_grid) py = { error: o.py_grid.error || "Python grid: no feasible point" };
    if (o.type === "trip" && o.py_cli?.out) {
      const t = o.py_cli.out, lg = t.legs?.find((x) => o.id.startsWith("T3") ? x.leg === "pickup" : x.leg === "ride");
      o.trip_leg = lg;
    }
    if (!py || py.error || g.error) { L.push(`| ${o.id} | ${py?.error || "-"} | | ${g.error || iso(g.dep_jd)} | ${f(g.tof_days, 1)} | | | | | | |`); continue; }
    const same = Math.abs(py.dep_jd - g.dep_jd) < 1e-6 && Math.abs(py.tof_days - g.tof_days) < 0.051 && py.revs === g.revs && (py.revs === 0 || py.lowpath === g.lowpath);
    o.same_point = same;
    const e = o.py_eval_grid;
    const c3py = py.c3 ?? (e && e.c3);
    W("C3 (same point, km2/s2)", e && !e.error ? g.c3_dep_km2s2 - e.c3 : null, o.id);
    W("v_inf dep (km/s)", e && !e.error ? g.vinf_dep_kms - e.vd : null, o.id);
    W("v_inf arr (km/s)", e && !e.error ? g.vinf_arr_kms - e.va : null, o.id);
    W("dv dep (km/s)", e && !e.error ? g.dv_dep_kms - e.dvd : null, o.id);
    W("dv arr (km/s)", e && !e.error ? g.dv_arr_kms - e.dva : null, o.id);
    L.push(`| ${o.id} | ${iso(py.dep_jd)} | ${f(py.tof_days, 1)} | ${iso(g.dep_jd)} | ${f(g.tof_days, 1)} | ${g.revs}${g.revs ? (g.lowpath ? "L" : "H") : ""} | ${same ? "yes" : "**NO**"} | ${f(c3py, 3)} / ${f(g.c3_dep_km2s2, 3)} | ${e && !e.error ? D(g.dv_dep_kms, e.dvd) : "-"} | ${e && !e.error ? D(g.dv_arr_kms, e.dva) : "-"} | ${py.cost != null ? D(g.cost, py.cost) : "-"} |`);
  }
  // 2. refined
  L.push("", "### B. Planner, coarse-then-refine (the page's mode) vs the Python grid optimum", "",
    "Negative 'cost JS-Py' = the refined search found a cheaper (or earlier/shorter) ride than the Python grid; values at the JS point are re-evaluated in Python on DE421 ('Py@JS').", "",
    "| route | JS depart | JS TOF d | branch | dv dep / arr km/s | total km/s | cost JS | cost Py grid | JS-Py | Py@JS dv total - JS | search ms |",
    "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const o of R) {
    const g = o.js_refined; if (!g) continue;
    if (g.error) { L.push(`| ${o.id} | ${g.error} |||||||||${f(o.js_refined_ms, 0)}|`); continue; }
    let pc = null;
    if (o.py_grid?.best) pc = o.py_grid.best.cost;
    if (o.type === "quote" && o.py_cli?.out?.dep_jd) {
      // quote.py prints C3 to 2 decimals: use the exact DE421 value at its grid point (= the JS grid point when 'same')
      const q = o.py_cli.out, ev = o.same_point && o.py_eval_grid && !o.py_eval_grid.error ? o.py_eval_grid : null;
      pc = o.setup.base.objective === "tof" ? q.tof_days : (ev ? ev.dvd : Math.sqrt(q.c3_km2s2 + 2 * 398600.435507 / 6578.137) - Math.sqrt(398600.435507 / 6578.137));
    }
    if (o.type === "trip" && !o.py_grid?.best && o.trip_leg) {
      const t = o.trip_leg, now = jd("2026-10-16");
      const arr = jd(t.arrive_earth || t.arrive_titan);
      pc = o.setup.base.objective === "time" ? arr : t.dv_kms + 0.1 * (arr - now) / 365.25;
    }
    const e = o.py_eval_refined;
    const dvpy = e && !e.error ? e.dv : null;
    W("dv total at refined point (km/s)", dvpy != null ? g.dv_total_kms - dvpy : null, o.id);
    L.push(`| ${o.id} | ${iso(g.dep_jd)} | ${f(g.tof_days, 2)} | ${g.revs}${g.revs ? (g.lowpath ? "L" : "H") : ""} | ${f(g.dv_dep_kms)} / ${f(g.dv_arr_kms)} | ${f(g.dv_total_kms)} | ${f(g.cost, 4)} | ${f(pc, 4)} | ${pc != null ? f(g.cost - pc, 4) : "-"} | ${dvpy != null ? D(dvpy, g.dv_total_kms) : "-"} | ${f(o.js_refined_ms, 0)} |`);
  }
  // 3. refly
  L.push("", "### C. Re-fly gate: JS refly() vs Python refly.py on the same leg", "",
    "Py = refly.refly (mode leo, Earth 200 km) or refly.refly_leg (mode centre), unmodified, DE421 + its Hermite table, DOP853 rtol 1e-10. Py/cheb = the same Python functions fed the JS Chebyshev table (rtol 1e-10): JS ≈ Py/cheb but ≠ Py means the difference is the ephemeris table, not the port. The last columns repeat both at rtol 1e-12 (Python: the same functions with nbody.propagate's rtol swapped in; JS: the engine default). Python rounds its outputs (0.1 km / 0.1 m/s).", "",
    "| route | mode | raw miss km: Py / JS / Py-cheb | final km Py / JS | retarget m/s Py / JS | iters Py / JS | pass @1e-10 Py / JS | @1e-12: final km Py / JS, retarget m/s Py / JS, pass Py / JS | s @1e-10 Py / JS, @1e-12 JS |",
    "|---|---|---|---|---|---|---|---|---|");
  const P = (x) => x == null ? "-" : (x.error ? "error" : (x.pass ? "PASS" : "REJECT"));
  for (const o of R) {
    const j = o.js_refly; if (!j || o.type === "local") continue;
    const p = o.py_refly, c = o.py_refly_cheb, p12 = o.py_refly12, j12 = o.js_refly12;
    const ok = (x) => x && !x.error;
    if (ok(p) && ok(j)) {
      W("re-fly raw miss, rtol 1e-10 (km)", j.raw_miss_km - p.raw_miss_km, o.id);
      W("re-fly retarget, rtol 1e-10 (m/s)", j.retarget_ms - p.retarget_ms, o.id);
      if (ok(c)) W("re-fly raw miss JS vs Py/cheb (km)", j.raw_miss_km - c.raw_miss_km, o.id);
      if (p.pass !== j.pass) o.pass_disagree = true;
    }
    if (ok(p12) && ok(j12)) {
      W("re-fly raw miss, rtol 1e-12 (km)", j12.raw_miss_km - p12.raw_miss_km, o.id);
      W("re-fly retarget, rtol 1e-12 (m/s)", j12.retarget_ms - p12.retarget_ms, o.id);
      if (p12.pass !== j12.pass) o.pass_disagree12 = true;
    }
    L.push(`| ${o.id} | ${o.mode} | ${ok(p) ? f(p.raw_miss_km, 1) : (p?.error || "n/a")} / ${ok(j) ? f(j.raw_miss_km, 1) : j.error} / ${ok(c) ? f(c.raw_miss_km, 1) : "-"} | ${ok(p) ? f(p.final_miss_km, 3) : "-"} / ${f(j.final_miss_km, 3)} | ${ok(p) ? f(p.retarget_ms, 1) : "-"} / ${f(j.retarget_ms, 1)} | ${ok(p) ? p.iterations : "-"} / ${j.iterations ?? "-"} | ${P(p)} / ${P(j)}${o.pass_disagree ? " **DIFF**" : ""} | ${ok(p12) ? f(p12.final_miss_km, 3) : "-"} / ${ok(j12) ? f(j12.final_miss_km, 3) : "-"}, ${ok(p12) ? f(p12.retarget_ms, 1) : "-"} / ${ok(j12) ? f(j12.retarget_ms, 1) : "-"}, ${P(p12)} / ${P(j12)}${o.pass_disagree12 ? " **DIFF**" : ""} | ${ok(p) ? f(p.seconds, 1) : "-"} / ${f(j.seconds, 2)}, ${ok(j12) ? f(j12.seconds, 2) : "-"} |`);
    if (o.js_refly_default) L.push(`| ${o.id} (JS default mode) | ${o.js_refly_default.mode} | - / ${f(o.js_refly_default.raw_miss_km, 1)} / - | - / ${f(o.js_refly_default.final_miss_km, 3)} | - / ${f(o.js_refly_default.retarget_ms, 1)} | - / ${o.js_refly_default.iterations} | - / ${P(o.js_refly_default)} | | - / ${f(o.js_refly_default.seconds, 2)} |`);
  }
  L.push("", "Re-fly of the refined (page-mode) option at rtol 1e-12, JS vs Python on the same (non-grid) leg:", "",
    "| route | depart | TOF d | final km Py / JS | retarget m/s Py / JS | iters Py / JS | pass Py / JS | s Py / JS |", "|---|---|---|---|---|---|---|---|");
  for (const o of R) {
    const j = o.js_refly_refined; if (!j) continue;
    const p = o.py_refly_refined12, ok = p && !p.error;
    if (ok && !j.error) { W("re-fly retarget, refined legs, rtol 1e-12 (m/s)", j.retarget_ms - p.retarget_ms, o.id); if (p.pass !== j.pass) o.pass_disagree_ref = true; }
    L.push(`| ${o.id} | ${iso(o.js_refined.dep_jd)} | ${f(o.js_refined.tof_days, 2)} | ${ok ? f(p.final_miss_km, 3) : "-"} / ${f(j.final_miss_km, 3)} | ${ok ? f(p.retarget_ms, 1) : "-"} / ${f(j.retarget_ms, 1)} | ${ok ? p.iterations : "-"} / ${j.iterations} | ${ok ? P(p) : "-"} / ${P(j)}${o.pass_disagree_ref ? " **DIFF**" : ""} | ${ok ? f(p.seconds, 1) : "-"} / ${f(j.seconds, 2)} |`);
  }
  // 4. local
  L.push("", "### D. Local transfers (Hohmann around Earth)", "", "| route | depart | TOF d | dv dep km/s | dv arr km/s | refly |", "|---|---|---|---|---|---|");
  for (const o of R) if (o.type === "local") L.push(`| ${o.id} | ${o.js.error || iso(o.js.dep_jd)} | ${f(o.js.tof_days, 3)} | ${f(o.js.dv_dep_kms)} | ${f(o.js.dv_arr_kms)} | ${o.js_refly.note} |`);
  const pm = R.find((o) => o.py_moon)?.py_moon?.out;
  if (pm) L.push("", `quote.py --dest moon (geocentric Lambert from 200 km LEO, 2026-11-20): TLI ${pm.dv_tli_kms} km/s, TOF ${pm.tof_days} d; JS Hohmann LEO 200 km -> Moon distance (L3/L2 departure leg): ${f(R.find((o) => o.id.startsWith("L2"))?.js.dv_arr_kms)} km/s.`);
  if (unit) L.push("", "### F. Unit cross-check: random Lambert / Kepler / titan_burn cases, JS vs Python", "",
    unit.error ? unit.error : `Lambert (Izzo), 3000 random cases (r1 up to 3 AU, r2 up to 15 AU, TOF 20-6020 d, M 0/1, both branches): ${unit.lambert_solved} solved by both, ${unit.lambert_both_raise} infeasible in both, **${unit.lambert_disagree} disagree**; max |v| difference ${unit.lambert_max_dv_kms.toExponential(1)} km/s, transfer angle ${unit.lambert_max_angle_deg.toExponential(1)} deg. Kepler (universal variables), ${unit.kepler_cases} cases incl. hyperbolic and backward: max relative |r| difference ${unit.kepler_max_rel_dr.toExponential(1)}, ${unit.kepler_disagree} disagree. titan_burn (trip.py formula) vs JS wellBurn(Titan), v∞ 0-20 km/s: max ${unit.titan_burn_max_diff_kms.toExponential(1)} km/s.`);
  // ephemeris
  const er = JSON.parse(fs.readFileSync(path.join(HERE, "ephem_errors.json")));
  const tv = JSON.parse(fs.readFileSync(path.join(HERE, "ephem_testvectors.json")));
  L.push("", "### G. Ephemeris table vs DE421", "",
    `ephem.json: ${(er._total_json_bytes / 1024).toFixed(1)} KiB (${er._total_json_bytes} bytes), JD ${er._coverage[0]} (${S.isoFromJd(er._coverage[0])}) .. ${er._coverage[1]} (${S.isoFromJd(er._coverage[1])}). 'bake' = bake_ephem.py's check (40,000 random epochs + 8 per segment + both sides of every segment boundary, numpy evaluator); 'JS' = sol-engine.js's own decoder and evaluator vs DE421 states at 300 independent random epochs (ephem_testvectors.json). Small bodies are compared with their n-body orbits (the re-fly targets), not with DE421.`, "",
    "| body | segment d (base) | degree | segments | KiB | bake max \\|dr\\| m | bake rms m | bake max \\|dv\\| mm/s | JS max \\|dr\\| m | JS max \\|dv\\| mm/s |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const [b, e] of Object.entries(er)) {
    if (b.startsWith("_")) continue;
    if (b !== "earth" && b !== "moon" && !loadedBodies.has(b)) continue;
    let mp = null, mv = null;
    const vec = tv.bodies[b];
    if (vec) {
      mp = 0; mv = 0;
      const alias = S.PLACES.some((p) => p.id === b && p.kind === "small") ? b + "@nbody" : b;
      tv.jd.forEach((t, i) => {
        const s = S.ephState(alias, t);
        mp = Math.max(mp, Math.hypot(...s.r.map((x, k) => x - vec.r[i][k]))); mv = Math.max(mv, Math.hypot(...s.v.map((x, k) => x - vec.v[i][k])));
      });
      W(`ephemeris ${b} |dr| (km)`, mp, "JS vs DE421");
    }
    L.push(`| ${b}${e.derived ? " (derived)" : ""} | ${e.seg_days ?? "-"} | ${e.deg ?? "-"} | ${e.nseg ?? "-"} | ${e.chars ? (e.chars / 1024).toFixed(1) : "-"} | ${f(e.max_pos_err_km * 1000, 1)} | ${f(e.rms_pos_err_km * 1000, 1)} | ${f(e.max_vel_err_kms * 1e6, 2)} | ${mp == null ? "-" : f(mp * 1000, 1)} | ${mv == null ? "-" : f(mv * 1e6, 2)} |`);
  }
  // worst cases
  L.push("", "### E. Worst case per quantity (JS - Python)", "", "| quantity | worst difference | route |", "|---|---|---|");
  for (const [k, v] of Object.entries(worst)) L.push(`| ${k} | ${v.v.toExponential(2)} | ${v.id} |`);
  const md = path.join(HERE, "CHECK.md");
  const old = fs.existsSync(md) ? fs.readFileSync(md, "utf8") : "# CHECK\n\n<!-- GENERATED START -->\n<!-- GENERATED END -->\n";
  const a = old.indexOf("<!-- GENERATED START -->"), b = old.indexOf("<!-- GENERATED END -->");
  const gen = `<!-- GENERATED START -->\n## Generated tables (node crosscheck.mjs, ${new Date().toISOString().slice(0, 16)}Z)\n\n${L.join("\n")}\n`;
  fs.writeFileSync(md, a >= 0 && b > a ? old.slice(0, a) + gen + old.slice(b) : old + "\n" + gen + "<!-- GENERATED END -->\n");
}
