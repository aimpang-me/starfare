import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { evalSlice, pageSF } from "./page-slice.mjs";
import { test } from "node:test";
import { computeLeg, SEASON_END, SKY } from "../src/game.js";

const require = createRequire(import.meta.url), E = require("../src/engine/sol-page.cjs"), View = require("../src/flight-view.cjs");
const AU = 149597870.7, dep = 2465874.4472131357;
const source = (page) => readFileSync(new URL(`../src/${page}.html`, import.meta.url), "utf8");
async function api(page) {
  const home = page === "site";
  const window = { SITE: { sky: SKY, hails: [], look: {} }, SOLE: E, StarfareView: View };
  const SF = pageSF(source(page), home, window);
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
// The home map's route lines for a replay: each drawn leg's point positions, with legBase passing the replayed point
// through and a place standing in for its own position.
function routeLines(rp) {
  return JSON.parse(evalSlice(source("site"), "function routeOf(", "function dropRoute(", "JSON.stringify(routeOf(rp, 0).children.map((m) => m.pts.map((q) => q.v)))", {
    rp, legBase: (_L, p) => p, SF: { pos: (id) => id }, SolLines: { leg: (pts) => ({ pts, userData: {} }) },
    THREE: { Group: function () { this.children = []; this.add = (m) => this.children.push(m); } },
  }));
}

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
  const legs = [{ dep: 10, orb: 11, arr: 100, sys: "earth" }, { dep: 110, orb: 110, arr: 200, idle: true }];
  const lines = routeLines({ start: 10, legs, at: (j) => ({ leg: legs[0], phase: "flight", p: j }) });
  assert.equal(lines.length, 1, "an idle leg draws no line");
  assert.ok(lines[0].length > 1);
  assert.ok(lines[0].every((j) => j >= 10 && j <= 11), "only flight time belongs in the route; sampled station orbits make false zigzags");
  assert.deepEqual([lines[0][0], lines[0].at(-1)], [10, 11]);
});

for (const page of ["site", "flight"]) test(`${page}: compressed local positions remain continuous at a body centre`, () => {
  const off = evalSlice(source(page), "function localOff(", "function d3(", "localOff([1e-12, 0, 0], 'ceres')", {
    AU, SF: { place: () => ({ radius_km: 469.7 }) }, dispR: () => 0.4, axes: (p, k) => p.map((x) => x * k), V: () => [0, 0, 0],
  });
  assert.ok(Math.hypot(...off) < 0.000001, "a tiny displacement must not jump to a full planet radius");
});

for (const page of ["site", "flight"]) test(`${page}: the local scale has no sharp bend at the surface radius`, () => {
  const off = evalSlice(source(page), "function localOff(", "function d3(", "localOff", {
    AU, SF: { place: () => ({ radius_km: 469.7 }) }, dispR: () => 0.4, axes: (p, k) => p.map((x) => x * k), V: () => [0, 0, 0],
  });
  const r = 469.7 / AU, h = 0.00001, at = (t) => off([r * t, 0, 0], "ceres")[0];
  assert.ok(Math.abs((at(1) - at(1 - h)) / h - (at(1 + h) - at(1)) / h) < 0.0001);
});

test("main map draws an arrival hold at the destination", () => {
  const result = evalSlice(source("site"), "function shipC(", "function routeOf(", "shipC(rp, 11, 20).v", {
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
  const last = arc.arc_au.length - 1, k = f * last, i = Math.floor(k), t = k - i, dt = (arc.arr_jd - arc.dep_jd) / last;
  const [a, p, c, d] = [Math.max(0, i - 1), i, i + 1, Math.min(last, i + 2)].map((n) => relative(arc.arc_au[n], arc.dep_jd + dt * n));
  const cr = (a, v, c, d) => 0.5 * (2 * v + (c - a) * t + (2 * a - 5 * v + 4 * c - d) * t * t + (3 * v - a - 3 * c + d) * t * t * t);
  let local = p.map((v, x) => cr(a[x], v, c[x], d[x]));
  if (page === "flight") { // the flight page turns about the planet: slerped direction, spline distance never below the nearer sample's
    const len = (q) => Math.hypot(...q), [ra, rp, rc, rd] = [a, p, c, d].map(len), w = Math.acos(p.reduce((s, v, x) => s + (v / rp) * (c[x] / rc), 0));
    const r = Math.max(Math.min(rp, rc), cr(ra, rp, rc, rd)), s0 = Math.sin((1 - t) * w) / Math.sin(w), s1 = Math.sin(t * w) / Math.sin(w);
    local = p.map((v, x) => r * ((v / rp) * s0 + (c[x] / rc) * s1));
  }
  const corrections = [[arc.from, L.dep, 0, arc.dep_jd], [arc.to, L.orb, arc.arc_au.length - 1, arc.arr_jd]].map(([id, t, n, tPlan]) => {
    const target = relative(SF.pos(id, t), t), stored = relative(arc.arc_au[n], tPlan);
    return target.map((v, axis) => v - stored[axis]);
  });
  const fix = blend(...corrections, f), expected = local.map((v, axis) => v + fix[axis]);
  assert.ok(distanceKm(relative(rp.at(j).p, j), expected) < 0.001, "the parent's curved solar orbit must not distort the local transfer chord");
});

test("flight: a local hop is never drawn under its planet's surface", async () => {
  // The ISS crew change as flown live: a pickup hop to the ISS, then out to the Moon. Its samples are hours apart while
  // the ship circles Earth every 90 minutes, and a spline through them, with the stations' slowed orbits blended in at
  // the ends, went thousands of km under the surface.
  const SF = await api("flight"), iso = (jd) => new Date((jd - 2440587.5) * 864e5).toISOString().slice(0, 16).replace("T", " ");
  const a = E.R.planLeg("orbital-depot", "iss", dep, "energy", SEASON_END, "sf-01"), b = E.R.planLeg("iss", "lunar-data-center", a.arr_jd + 0.05, "energy", SEASON_END, "sf-01");
  const arcs = {}, flown = [[a, "orbital-depot", "iss", "pickup"], [b, "iss", "lunar-data-center", "ride"]].map(([L, from, to, leg], i) => {
    arcs["leg" + i] = { from, to, dep_jd: L.dep_jd, arr_jd: L.arr_jd, arc_au: L.arc_au };
    return { leg, leg_id: "leg" + i, from, to, depart: iso(L.dep_jd), arrive: iso(L.arr_jd) };
  });
  const rp = SF.replay({ arcs, legs: [{ car: "sf-01" }], record: { score: { car: "SF-01", incidents: [] }, log: { flown } } });
  let low = Infinity;
  for (const L of rp.legs) for (let i = 0; i <= 2000; i++) { const j = L.dep + (L.orb - L.dep) * i / 2000; low = Math.min(low, distanceKm(rp.at(j).p, SF.pos("earth", j))); }
  assert.ok(low >= 6378.137 * 1.02 - 1, "lowest drawn point " + Math.round(low) + " km from Earth's centre");
});

test("route geometry never connects separate legs or a holding ship", () => {
  // At a leg's ends at() reports the ship holding at a pad; at the second leg's start, on the leg before it.
  const legs = [{ dep: 1, orb: 2, from: "a", to: "b" }, { dep: 5, orb: 6, from: "b", to: "c" }];
  const at = (j) => (j >= 1 && j < 2 ? { leg: legs[0], phase: "flight", p: j } : j > 5 && j < 6 ? { leg: legs[1], phase: "flight", p: j }
    : { leg: j <= 5 ? legs[0] : legs[1], phase: "orbit", p: "ship" });
  const lines = routeLines({ start: 1, legs, at });
  assert.equal(lines.length, 2, "each cruise leg is its own line");
  assert.deepEqual([lines[0][0], lines[0].at(-1), lines[1][0], lines[1].at(-1)], [1, "b", "b", "c"], "leg ends sit on their places, never on a holding ship");
  assert.ok(lines[0].slice(1, -1).every((j) => j > 1 && j < 2) && lines[1].slice(1, -1).every((j) => j > 5 && j < 6), "no point from another leg");
});
