import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const View = createRequire(import.meta.url)("../src/flight-view.cjs");

// A circular orbit of 7000 km in the xy plane, 10.75 laps a day.
const R = 7000, LAPS = 10.75;
const state = (jd) => {
  const th = 2 * Math.PI * LAPS * jd, w = 2 * Math.PI * LAPS / 86400;
  return { r: [R * Math.cos(th), R * Math.sin(th), 0], v: [-R * w * Math.sin(th), R * w * Math.cos(th), 0] };
};
const close = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-6);
const keys = [0, 1, 1.05];

test("a fast orbit is exact at every key", () => {
  for (const k of keys) assert.ok(close(View.slowOrbit(state, keys, k), state(k).r), String(k));
});

test("between keys a day apart it turns forward the 0.75 lap it gained, at an even rate", () => {
  const s = Math.SQRT1_2 * R;
  assert.ok(close(View.slowOrbit(state, keys, 0.5), [-s, s, 0]), "half way is 0.375 lap on");
  assert.ok(close(View.slowOrbit(state, keys, 0.25), [R * Math.cos(0.375 * Math.PI), R * Math.sin(0.375 * Math.PI), 0]), "a quarter way is 0.1875 lap on");
});

test("keys under one lap apart, and times outside the keys, keep the true motion", () => {
  assert.ok(close(View.slowOrbit(state, keys, 1.02), state(1.02).r));
  assert.ok(close(View.slowOrbit(state, keys, 1.3), state(1.3).r));
  assert.ok(close(View.slowOrbit(state, keys, -0.2), state(-0.2).r));
});
