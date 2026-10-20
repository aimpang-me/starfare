import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SX = require('../../design/assets/sky-effects.js');
const E = require('../../world/engine/sol-page.js'), R = E.R;

test('a CME front moves at the engine speed: 1500 km/s, about 0.87 AU a day', () => {
  assert.ok(Math.abs(SX.AU_PER_DAY - 1500 * 86400 / 149597870.7) < 1e-12);
  assert.equal(SX.frontRadius(10, 9), 0);
  assert.ok(Math.abs(SX.frontRadius(10, 11) - SX.AU_PER_DAY) < 1e-12);
  // Reaches Earth in about 1.15 days and passes 40 AU, where it stops being drawn, in about 46.
  assert.ok(Math.abs(1 / SX.AU_PER_DAY - 1.154) < 0.01);
  assert.ok(Math.abs(SX.FRONT_DAYS - 46.2) < 0.2);
});

test('front brightness is zero before launch and beyond 40 AU, and never above 1', () => {
  assert.equal(SX.frontStrength(0), 0);
  assert.equal(SX.frontStrength(41), 0);
  for (let r = 0.01; r < 40; r += 0.37) { const k = SX.frontStrength(r); assert.ok(k >= 0 && k <= 1, `${r}: ${k}`); }
  assert.ok(SX.frontStrength(1) > SX.frontStrength(5));
});

test('eruptions are exactly the engine flare windows at the Sun, each found once', () => {
  const H = R.hazards('7'), from = 2462000, to = from + 120, list = SX.eruptions(H, from, to, {});
  assert.ok(list.length > 3);
  for (let i = 1; i < list.length; i++) assert.ok(list[i].start > list[i - 1].start);
  list.forEach((e) => {
    assert.ok(e.start >= from && e.start < to && e.end > e.start);
    const f = H.flareAt(e.start + 1e-6);
    assert.ok(f && Math.abs(f.start - e.start) < 1e-9, 'flareAt sees the eruption it was found from');
  });
  // Every hour the engine says a flare is on belongs to a listed eruption (or one that started before the range).
  for (let jd = from + 3; jd < to; jd += 1 / 24) {
    const f = H.flareAt(jd); if (!f) continue;
    assert.ok(list.some((e) => e.start === f.start) || f.start < from, `missed eruption at ${f.start}`);
  }
});

test('eruptions use the cache and agree with a cold run', () => {
  const H = R.hazards('11'), cache = {};
  const a = SX.eruptions(H, 2463000, 2463030, cache), b = SX.eruptions(H, 2463010, 2463030, cache), c = SX.eruptions(H, 2463010, 2463030);
  assert.deepEqual(b, c);
  assert.deepEqual(a.filter((e) => e.start >= 2463010), b);
});

test('ramp eases in and out over an hour and is zero outside the window', () => {
  const w = { start: 10, end: 12 };
  assert.equal(SX.ramp(null, 11), 0);
  assert.equal(SX.ramp(w, 9.99), 0);
  assert.equal(SX.ramp(w, 12), 0);
  assert.equal(SX.ramp(w, 11), 1);
  assert.ok(Math.abs(SX.ramp(w, 10 + 1 / 48) - 0.5) < 1e-9);
  // A 2 h window ramps over its first and last half hour.
  const s = { start: 0, end: 2 / 24 };
  assert.ok(Math.abs(SX.ramp(s, 0.25 / 24) - 0.5) < 1e-9);
});

test('belt orbits are seeded, in the main belt and thin at the Kirkwood gaps', () => {
  const a = SX.beltOrbits(4000, 1801), b = SX.beltOrbits(4000, 1801);
  assert.deepEqual(a, b);
  assert.ok(a.every((o) => o.a >= 2.1 && o.a <= 3.3 && o.e >= 0 && o.e < 0.12 && Math.abs(o.inc) <= 0.125));
  const near = (g) => a.filter((o) => Math.abs(o.a - g) < 0.025).length, flat = 4000 * 0.05 / 1.2;
  SX.GAPS.forEach((g) => assert.ok(near(g) < flat * 0.3, `gap at ${g} holds ${near(g)}`));
});
