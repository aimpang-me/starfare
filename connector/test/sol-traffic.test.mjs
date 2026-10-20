import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Traffic from '../../design/assets/sol-traffic.js';

const places = JSON.parse(readFileSync(new URL('../../world/engine/places.json', import.meta.url), 'utf8'));
const list = Array.isArray(places) ? places : places.places || Object.values(places);
const AU = 1.495978707e11;
// A stand-in sky: planets on circles, moons and stations on small circles round their parent.
const R = { mercury: 0.39, venus: 0.72, earth: 1, mars: 1.52, ceres: 2.77, bennu: 1.13, jupiter: 5.2, saturn: 9.54, uranus: 19.2, neptune: 30.1 };
const by = Object.fromEntries(list.map(p => [p.id, p]));
function pos(id, jd) {
  const p = by[id];
  if (p.parent === 'sun') { const r = R[id], a = jd / (365.25 * Math.pow(r, 1.5)) * 2 * Math.PI; return [r * Math.cos(a), r * Math.sin(a), 0]; }
  const q = pos(p.parent, jd), r = (p.orbit_km || (p.radius_km || 0) + 6800) * 1000 / AU, a = jd / (p.period_days || 0.07) * 2 * Math.PI + id.length; // stations on one shell sit apart
  return [q[0] + r * Math.cos(a), q[1] + r * Math.sin(a), q[2]];
}
const dist = (a, b, jd) => { const p = pos(a, jd), q = pos(b, jd); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * AU; };
const reach = (id) => { let m = 0; for (let k = 0; k < 64; k++) { const j = k * 300, p = pos(id, j), q = by[id].parent === 'sun' ? [0, 0, 0] : pos(by[id].parent, j); m = Math.max(m, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])); } return m * 1.05 * AU; };
const JD0 = 2460000.5;

test('every lane joins two places the engine knows', () => {
  for (const [a, b, w] of Traffic.LANES) { assert.ok(by[a] && by[b], `${a}-${b}`); assert.ok(w > 0); }
  assert.equal(Traffic.fleet(list, reach, 50, JD0, 1).every(s => by[s.lane.from] && by[s.lane.to]), true);
});

test('burn-flip-burn timing follows 2 sqrt(d / a) and the distance curve is symmetric', () => {
  const d = 384400e3, a = Traffic.ACCEL.local;
  assert.ok(Math.abs(Traffic.burnTime(d, a) - 2 * Math.sqrt(d / a)) < 1e-6);
  assert.ok(Math.abs(Traffic.accelFor(d, Traffic.burnTime(d, a)) - a) < 1e-12);
  assert.equal(Traffic.along(0), 0); assert.equal(Traffic.along(1), 1); assert.equal(Traffic.along(0.5), 0.5);
  assert.ok(Math.abs(Traffic.along(0.25) + Traffic.along(0.75) - 1) < 1e-12);
  assert.equal(Traffic.along(-1), 0); assert.equal(Traffic.along(2), 1);
});

test('the schedule depends only on the date: two viewers see the same ships', () => {
  const a = Traffic.fleet(list, reach, 300, JD0, 1), b = Traffic.fleet(list, reach, 300, JD0, 1);
  for (const jd of [JD0 + 3.25, JD0 + 410.7, JD0 + 2000]) {
    // b is asked in reverse, out of step with a, and must still agree
    const sb = b.slice().reverse().map(s => Traffic.state(s, jd, dist)).reverse();
    assert.deepEqual(a.map(s => Traffic.state(s, jd, dist)), sb);
  }
});

test('a trip stays inside its slot, moves forward, and the next trip flies back', () => {
  for (const s of Traffic.fleet(list, reach, 200, JD0, 3)) {
    let last = -1, seen = null;
    for (let x = 0.005; x < 1; x += 0.01) {
      const jd = s.t0 + 4 * s.slot + x * s.slot, st = Traffic.state(s, jd, dist);
      assert.ok(s.T > 0 && s.T <= s.slot * 0.9 + 1e-9, JSON.stringify([s.lane.from, s.lane.to, s.T, s.slot]));
      if (!st) { assert.ok(x * s.slot >= s.T - 1e-9); continue; }
      assert.ok(st.f >= last && st.f >= 0 && st.f <= 1 && st.ft <= st.f); last = st.f; seen = st;
    }
    assert.ok(seen, 'flew during the slot');
    const back = Traffic.state(s, s.t0 + 5 * s.slot + 1e-6, dist);
    assert.deepEqual(back && [back.from, back.to], [seen.to, seen.from]);
  }
});

test('density and quality tier set the count; a lighter setting keeps the same first ships', () => {
  assert.equal(Traffic.count('off', 'high'), 0);
  assert.equal(Traffic.count('busy', 'high'), Traffic.CAP.high);
  assert.ok(Traffic.count('busy', 'medium') < Traffic.count('busy', 'high'));
  assert.ok(Traffic.count('light', 'low') > 0 && Traffic.count('light', 'low') < Traffic.count('busy', 'low'));
  assert.equal(Traffic.count('nonsense', 'high'), 0);
  const big = Traffic.fleet(list, reach, 100, JD0, 1), small = Traffic.fleet(list, reach, 25, JD0, 1);
  assert.deepEqual(small.map(s => [s.lane.from, s.lane.to, s.slot, s.t0]), big.slice(0, 25).map(s => [s.lane.from, s.lane.to, s.slot, s.t0]));
});

test('lanes inside one planet system are local and centred on that planet', () => {
  const f = Traffic.fleet(list, reach, 600, JD0, 1), em = f.find(s => s.lane.from === 'earth' && s.lane.to === 'moon');
  const mars = f.find(s => s.lane.from === 'earth' && s.lane.to === 'mars');
  assert.equal(em.lane.local, true); assert.equal(em.lane.hub, 'earth');
  assert.equal(mars.lane.local, false); assert.equal(mars.lane.hub, 'sun');
  // Earth to the Moon at 0.003 g takes about 2.6 days, Earth to Mars at closest (0.52 AU) at 0.01 g about a month
  const tm = Traffic.burnTime(384400e3, Traffic.ACCEL.local) / 86400, tr = Traffic.burnTime(0.52 * AU, Traffic.ACCEL.helio) / 86400;
  assert.ok(tm > 2 && tm < 4, String(tm)); assert.ok(tr > 20 && tr < 40, String(tr));
});
