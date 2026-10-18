import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const View = createRequire(import.meta.url)("../src/flight-view.cjs");
const dot = (a, b) => a.reduce((s, n, i) => s + n * b[i], 0);
const unit = (a) => a.map((n) => n / Math.hypot(...a));

test("a short pickup's heading samples only its own flight, even when the run and landing hold span years", () => {
  const leg = { dep: 10, orb: 10.1, arr: 150, arc: { arc_au: Array(49) } }, times = [];
  const rp = { end: 1000, at: () => ({ phase: "flight", leg }) };
  const d = View.flightDirection(rp, 10.05, (t) => { times.push(t); return [Math.cos(t), 0, Math.sin(t)]; });
  assert.ok(times.every((t) => t > leg.dep && t < leg.orb), `heading crossed a flight boundary: ${times}`);
  assert.ok(dot(unit(d), [-Math.sin(10.05), 0, Math.cos(10.05)]) > 0.999999);
});

test("departure and arrival headings remain within the active leg", () => {
  const leg = { dep: 10, orb: 10.1, arr: 10.1 }, rp = { at: () => ({ phase: "flight", leg }) };
  for (const jd of [10, 10.000001, 10.099999, 10.1]) {
    const times = [];
    assert.ok(View.flightDirection(rp, jd, (t) => { times.push(t); return [t, 2 * t, -t]; }));
    assert.ok(times.every((t) => t > 10 && t < 10.1));
  }
});

test("parked, held and arrived ships do not borrow the next flight's heading", () => {
  for (const phase of ["parked", "dwell", "holding", "orbit", "arrived"]) {
    assert.equal(View.flightDirection({ at: () => ({ phase, leg: { dep: 0, orb: 1 } }) }, 0.5, () => assert.fail("must not sample a flight")), null);
  }
});

test("a zero-length or idle leg has no flight tangent", () => {
  for (const leg of [{ dep: 1, orb: 1 }, { dep: 1, orb: 2, idle: true }]) {
    assert.equal(View.flightDirection({ at: () => ({ phase: "flight", leg }) }, 1, () => assert.fail("must not sample an idle leg")), null);
  }
});

test("parked orientation follows its destination's displayed orbital tangent", () => {
  const t = 0.73, d = View.orbitDirection(t, (j) => [Math.cos(j), Math.sin(j), 0]);
  assert.ok(dot(unit(d), [-Math.sin(t), Math.cos(t), 0]) > 0.999999);
  assert.equal(View.orbitDirection(t, () => [0, 0, 0]), null);
});

test("the nose follows arbitrary three-dimensional headings without axis snapping", () => {
  for (const direction of [[1, 2, 3], [-4, 2, -1], [0.57, 0, -0.83], [0, 1, 0], [0, -1, 0]]) {
    const frame = View.headingFrame(direction, [0, 1, 0], [0, 0, 1]);
    assert.ok(dot(frame.forward, unit(direction)) > 1 - 1e-12);
    assert.ok(Math.abs(dot(frame.forward, frame.up)) < 1e-12);
    assert.ok(Math.abs(Math.hypot(...frame.up) - 1) < 1e-12);
  }
});

test("crossing a vertical heading keeps the same roll instead of flipping 180 degrees", () => {
  const first = View.headingFrame([0.000001, 1, 0], [0, 1, 0], [0, 0, 1]);
  const second = View.headingFrame([-0.000001, 1, 0], [0, 1, 0], first.up);
  assert.ok(dot(first.up, second.up) > 0.99999);
});

test("zero motion preserves the existing pose rather than producing an invalid attitude", () => {
  assert.equal(View.headingFrame([0, 0, 0], [0, 1, 0]), null);
  assert.equal(View.headingFrame([NaN, 1, 0], [0, 1, 0]), null);
});

test("applying a frame points the model's +Z nose at the tangent, with its dorsal +Y kept upright", () => {
  // The shared art and both fallback models are built nose +Z, dorsal +Y. Three.Object3D.lookAt aims +Z.
  const frame = View.headingFrame([3, 0, 4], [0, 1, 0]);
  let target;
  const vector = (x, y, z) => ({ x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; },
    clone() { return vector(this.x, this.y, this.z); }, add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; } });
  const ship = { position: vector(10, 20, 30), up: vector(0, 0, 1), lookAt(v) { target = [v.x, v.y, v.z]; } };
  View.orientShip(ship, frame);
  assert.deepEqual(target, [10.6, 20, 30.8]);
  assert.deepEqual([ship.up.x, ship.up.y, ship.up.z], [0, 1, 0]);
});
