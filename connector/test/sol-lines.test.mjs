import test from 'node:test';
import assert from 'node:assert/strict';
import Lines from '../../design/assets/sol-lines.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
const deg = d => ({ x: Math.cos(d * Math.PI / 180), y: Math.sin(d * Math.PI / 180), z: 0 });
const ring = step => Array.from({ length: 13 }, (_, k) => deg(k * step));

test('an orbit is full brightness just behind its body and fades to 40% just ahead', () => {
  assert.equal(Lines.trail(0, Lines.AHEAD), 1);
  near(Lines.trail(0.5, Lines.AHEAD), 0.7);
  near(Lines.trail(1, Lines.AHEAD), 0.4);
});

test('the ring normal points along the motion', () => {
  assert.deepEqual(Lines.normal(ring(30)), { x: 0, y: 0, z: 1 });
  assert.deepEqual(Lines.normal(ring(-30)), { x: 0, y: 0, z: -1 });
});

test('points the body has passed are behind it, whichever way it orbits', () => {
  const body = deg(90), prograde = Lines.normal(ring(30)), retrograde = Lines.normal(ring(-30));
  near(Lines.phase(deg(80), body, prograde), 10 / 360);
  near(Lines.phase(deg(100), body, prograde), 350 / 360);
  near(Lines.phase(deg(100), body, retrograde), 10 / 360);
  near(Lines.phase(deg(270), body, prograde), 0.5);
});

test('the phase ignores distance from the centre, so log-scaled rings fade the same way', () => {
  const p = deg(45), far = { x: p.x * 7, y: p.y * 7, z: 0 }, n = Lines.normal(ring(30));
  near(Lines.phase(far, deg(90), n), Lines.phase(p, deg(90), n));
});

test('a line is hidden out to 2 px past the body and whole by 10 px past it', () => {
  assert.equal(Lines.gap(0, 12), 0);
  assert.equal(Lines.gap(14, 12), 0);
  assert.equal(Lines.gap(18, 12), 0.5);
  assert.equal(Lines.gap(22, 12), 1);
  assert.equal(Lines.gap(400, 12), 1);
});

test('a moon ring is resampled once the map moves more than 5 sky days from its epoch', () => {
  assert.equal(Lines.stale(null, 2461330), true);
  assert.equal(Lines.stale(2461330, 2461335), false);
  assert.equal(Lines.stale(2461330, 2461335.5), true);
  assert.equal(Lines.stale(2461330, 2461324.5), true);
});
