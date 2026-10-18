import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { computeLeg, SEASON_END, SKY } from "../src/game.js";

const require = createRequire(import.meta.url), E = require("../src/engine/sol-page.cjs"), View = require("../src/flight-view.cjs");
const AU = 149597870.7, dep = 2465874.4472131357;
const source = (page) => readFileSync(new URL(`../src/${page}.html`, import.meta.url), "utf8");
async function api(page) {
  const html = source(page), home = page === "site";
  const start = html.indexOf(home ? "(function (root) {" : "var SF = (function () {");
  const end = home ? html.indexOf("</script>", start) : html.indexOf("})();", start) + 5;
  const window = { SITE: { sky: SKY, hails: [], look: {} }, SOLE: E, StarfareView: View };
  const SF = runInNewContext(html.slice(start, end) + (home ? "\nwindow.SF;" : "\nSF;"), { window });
  if (home) await SF.loadEngine(); else SF.init(E);
  return SF;
}
function ride(arc) {
  return { arcs: { leg1: arc }, legs: [{ car: "sf-04" }], record: { score: { car: "SF-04", incidents: [] }, log: { flown: [{
    leg: "pickup", leg_id: "leg1", from: arc.from, to: arc.to,
    dep_jd: arc.dep_jd, arr_jd: arc.arr_jd, depart: new Date((arc.dep_jd - 2440587.5) * 864e5).toISOString().slice(0, 16).replace("T", " "),
    arrive: new Date((arc.arr_jd - 2440587.5) * 864e5).toISOString().slice(0, 16).replace("T", " "), arc,
  }] } } };
}
function localArc() {
  const b = E.R.planLeg("ceres", "ceres-port", dep, "energy", SEASON_END, "sf-04");
  return { from: "ceres", to: "ceres-port", dep_jd: b.dep_jd, arr_jd: b.arr_jd, arc_au: b.arc_au };
}
const distanceKm = (a, b) => Math.hypot(...a.map((n, i) => n - b[i])) * AU;

test("stored Ceres pickup arcs retain sub-metre coordinate precision", () => {
  const expected = localArc(), saved = computeLeg(E, "ceres", "ceres-port", dep, "energy", SEASON_END, "sf-04");
  const error = Math.max(...saved.arc_au.map((p, i) => distanceKm(p, expected.arc_au[i])));
  assert.ok(error < 0.001, `serialization displaced a local waypoint by ${error.toFixed(3)} km`);
});

for (const page of ["site", "flight"]) test(`${page}: archived six-decimal local arcs recover only the identical recorded transfer`, async () => {
  const SF = await api(page), arc = localArc();
  const rounded = { ...arc, arc_au: arc.arc_au.map((p) => p.map((n) => +n.toFixed(6))) };
  const full = SF.replay(ride(arc)), old = SF.replay(ride(rounded));
  let error = 0;
  for (let i = 0; i <= 96; i++) {
    const j = full.legs[0].dep + (full.legs[0].orb - full.legs[0].dep) * i / 96;
    error = Math.max(error, distanceKm(full.at(j).p, old.at(j).p));
  }
  assert.ok(error < 0.001, `archived local path jitters by up to ${error.toFixed(3)} km`);
  const changed = { ...rounded, arc_au: rounded.arc_au.map((p) => p.slice()) };
  changed.arc_au[20][0] += 0.000003;
  assert.equal(SF.replay(ride(changed)).legs[0].arc, changed, "a different recorded arc must never be replaced by a new plan");
});

test("main-map routes exclude orbit holds and idle legs", () => {
  const html = source("site"), start = html.indexOf("function sampleRoute("), end = html.indexOf("/* ---------- labels", start);
  const rp = { legs: [{ dep: 10, orb: 11, arr: 100, sys: "earth" }, { dep: 110, orb: 110, arr: 200, idle: true }] };
  const samples = runInNewContext(html.slice(start, end) + "\nsampleRoute(rp, 100);", { rp, shipC: (_rp, j) => ({ v: j }) });
  assert.ok(samples.length > 1);
  assert.ok(samples.every((s) => s.j >= 10 && s.j <= 11), "only flight time belongs in the route; sampled station orbits make false zigzags");
  assert.equal(samples.at(-1).j, 11);
});

for (const page of ["site", "flight"]) test(`${page}: compressed local positions remain continuous at a body centre`, () => {
  const html = source(page), start = html.indexOf("function localOff("), end = html.indexOf("function d3(", start);
  const off = runInNewContext(html.slice(start, end) + "\nlocalOff([1e-12, 0, 0], 'ceres');", {
    AU, SF: { place: () => ({ radius_km: 469.7 }) }, dispR: () => 0.4, axes: (p, k) => p.map((x) => x * k), V: () => [0, 0, 0],
  });
  assert.ok(Math.hypot(...off) < 0.000001, "a tiny displacement must not jump to a full planet radius");
});

for (const page of ["site", "flight"]) test(`${page}: the local scale has no sharp bend at the surface radius`, () => {
  const html = source(page), start = html.indexOf("function localOff("), end = html.indexOf("function d3(", start);
  const off = runInNewContext(html.slice(start, end) + "\nlocalOff;", {
    AU, SF: { place: () => ({ radius_km: 469.7 }) }, dispR: () => 0.4, axes: (p, k) => p.map((x) => x * k), V: () => [0, 0, 0],
  });
  const r = 469.7 / AU, h = 0.00001, at = (t) => off([r * t, 0, 0], "ceres")[0];
  assert.ok(Math.abs((at(1) - at(1 - h)) / h - (at(1 + h) - at(1)) / h) < 0.0001);
});

test("main map draws an arrival hold at the destination", () => {
  const html = source("site"), start = html.indexOf("function shipC("), end = html.indexOf("function sampleRoute(", start);
  const result = runInNewContext(html.slice(start, end) + "\nshipC(rp, 11, 20).v;", {
    rp: { at: () => ({ phase: "orbit", f: 1, leg: { from: "earth", to: "iss" } }) }, marker: (id) => ({ clone: () => id }),
  });
  assert.equal(result, "iss");
});

for (const page of ["site", "flight"]) test(`${page}: interpolation stays in the local frame between stored waypoints`, async () => {
  const SF = await api(page), b = E.R.planLeg("iss", "lunar-data-center", dep, "energy", SEASON_END, "sf-01");
  const arc = { from: "iss", to: "lunar-data-center", dep_jd: b.dep_jd, arr_jd: b.arr_jd, arc_au: b.arc_au };
  const rp = SF.replay(ride(arc)), L = rp.legs[0], f = 0.431, j = L.dep + (L.orb - L.dep) * f;
  const relative = (p, time) => p.map((n, axis) => n - SF.pos("earth", time)[axis]);
  const blend = (a, z, frac) => a.map((n, axis) => n + (z[axis] - n) * frac);
  const k = f * (arc.arc_au.length - 1), i = Math.floor(k), dt = (arc.arr_jd - arc.dep_jd) / (arc.arc_au.length - 1);
  const local = blend(relative(arc.arc_au[i], arc.dep_jd + dt * i), relative(arc.arc_au[i + 1], arc.dep_jd + dt * (i + 1)), k - i);
  const corrections = [[arc.from, L.dep, 0, arc.dep_jd], [arc.to, L.orb, arc.arc_au.length - 1, arc.arr_jd]].map(([id, t, n, tPlan]) => {
    const target = relative(SF.pos(id, t), t), stored = relative(arc.arc_au[n], tPlan);
    return target.map((v, axis) => v - stored[axis]);
  });
  const fix = blend(...corrections, f), expected = local.map((v, axis) => v + fix[axis]);
  assert.ok(distanceKm(relative(rp.at(j).p, j), expected) < 0.001, "the parent's curved solar orbit must not distort the local transfer chord");
});

test("route geometry never connects separate legs or a holding ship", () => {
  const html = source("site"), start = html.indexOf("function sampleRoute("), end = html.indexOf("/* ---------- labels", start);
  const samples = [{ j: 1, leg: 0, v: "a" }, { j: 2, leg: 0, v: "b" }, { j: 5, leg: 1, v: "c" }, { j: 6, leg: 1, v: "d" }];
  const context = { samples, active: { v: "ship", s: { i: 1, phase: "flight" } }, held: { v: "pad", s: { i: 1, phase: "orbit" } } };
  const result = runInNewContext(html.slice(start, end) + "\n[routePoints(samples), routePoints(samples, 5.5, active), routePoints(samples, 7, held)];", context);
  assert.deepEqual(Array.from(result[0]), ["a", "b", "c", "d"]);
  assert.deepEqual(Array.from(result[1]), ["a", "b", "c", "ship"]);
  assert.deepEqual(Array.from(result[2]), ["a", "b", "c", "d"]);
});
