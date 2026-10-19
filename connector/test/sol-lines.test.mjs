import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import Lines from '../../design/assets/sol-lines.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

test('an orbit is full brightness just behind its body and fades to 40% just ahead', () => {
  assert.equal(Lines.trail(0, Lines.AHEAD), 1);
  near(Lines.trail(0.5, Lines.AHEAD), 0.7);
  near(Lines.trail(1, Lines.AHEAD), 0.4);
});

test('a line is hidden out to 2 px past the body and whole by 10 px past it', () => {
  assert.equal(Lines.gap(0, 12), 0);
  assert.equal(Lines.gap(14, 12), 0);
  assert.equal(Lines.gap(18, 12), 0.5);
  assert.equal(Lines.gap(22, 12), 1);
  assert.equal(Lines.gap(400, 12), 1);
});

test('the dash period steps by octaves of zoom and blends toward the next', () => {
  for (const [pxw, period] of [[0.125, 1], [0.25, 2], [0.5, 4]]) {
    const d = Lines.dash(pxw);
    assert.equal(d.period, period);
    near(d.t, Math.log2(1.5), 1e-12);
  }
  for (const pxw of [0.003, 0.07, 0.4, 2.9]) {
    const d = Lines.dash(pxw);
    near(d.period * 2 ** d.t, 12 * pxw, 1e-12);
  }
});

test('the distance grid fades out as the camera closes on one system', () => {
  assert.equal(Lines.budget('grid', 142), 1);
  assert.equal(Lines.budget('grid', 60), 1);
  assert.equal(Lines.budget('grid', 47.5), 0.5);
  assert.equal(Lines.budget('grid', 35), 0);
  assert.equal(Lines.budget('grid', 9), 0);
});

test('a moon ring fades in between 12 and 40 px of ring radius', () => {
  assert.equal(Lines.budget('moonRing', 8), 0);
  assert.equal(Lines.budget('moonRing', 12), 0);
  assert.equal(Lines.budget('moonRing', 26), 0.5);
  assert.equal(Lines.budget('moonRing', 40), 1);
  assert.equal(Lines.budget('moonRing', 300), 1);
});

test('distance along a leg follows sky time between its points and holds at its ends', () => {
  const ss = [0, 2, 4], ds = [0, 10, 30];
  assert.equal(Lines.along(ss, ds, -1), 0);
  assert.equal(Lines.along(ss, ds, 1), 5);
  assert.equal(Lines.along(ss, ds, 3), 20);
  assert.equal(Lines.along(ss, ds, 9), 30);
});

test('a trail measures the ship from each leg start, along the whole route', () => {
  const leg = (ss, ds) => ({ userData: { ss, ds }, material: { uniforms: { tail: { value: { set(x, y) { Object.assign(this, { x, y }); } } } } } });
  const tail = (m) => { const { x, y } = m.material.uniforms.tail.value; return [x, y]; };
  const a = leg([0, 10], [0, 100]), b = leg([20, 30], [0, 50]);
  Lines.tails([a, b], 25, 8);
  assert.deepEqual([tail(a), tail(b)], [[125, 8], [25, 8]]);
  Lines.tails([a, b], 15, 8);
  assert.deepEqual([tail(a), tail(b)], [[100, 8], [0, 8]]);
  Lines.tails([a, b], -5, 0);
  assert.deepEqual([tail(a), tail(b)], [[0, 0], [-100, 0]]);
});

test('a planet orbit fades in between 6 and 24 px of radius', () => {
  assert.equal(Lines.budget('orbit', 3), 0);
  assert.equal(Lines.budget('orbit', 15), 0.5);
  assert.equal(Lines.budget('orbit', 24), 1);
});

test('the pages take line colours and opacities from the style table, never as literals', () => {
  const hex = /\b(color|opacity):\s*(0x[0-9a-f]{6}|0\.\d+)/i;
  for (const page of ['site.html', 'flight.html']) {
    const code = readFileSync(new URL(`../src/${page}`, import.meta.url), 'utf8');
    const bad = code.split('\n').filter(l => /SolLines\.(line|leg)\(/.test(l) && hex.test(l));
    assert.deepEqual(bad, [], `${page} passes a literal style to SolLines.line or leg`);
  }
});

const E = createRequire(import.meta.url)('../src/engine/sol-page.cjs');
const SF = { E, place: id => E.PLACES.find(p => p.id === id) };
const close = (a, b, rel) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= rel * Math.hypot(...b), `${a} is not ${b}`);
const JD = 2461330;

test('the conic passes through the body at its true anomaly, for a planet and for a moon', () => {
  for (const id of ['earth', 'mars', 'jupiter', 'neptune', 'moon', 'titan']) {
    const el = Lines.osculate(SF, id, JD, 1), P = SF.place(id), a = E.placeState(id, JD);
    let r = a.r;
    if (P.parent !== 'sun') { const b = E.placeState(P.parent, JD); r = r.map((x, i) => x - b.r[i]); }
    close(Lines.conicAt(el, el.nu), r, 1e-9);
  }
});

test('the conic follows the engine two-body propagation of the body round its orbit', () => {
  const a = E.placeState('mars', JD), el = Lines.osculate(SF, 'mars', JD, 1);
  const period = E.periodDays(a);
  for (const f of [0.1, 0.35, 0.5, 0.8]) {
    const r = E.propagate(a.r, a.v, period * 86400 * f).r;
    const nu = Math.atan2(r[0] * el.Q[0] + r[1] * el.Q[1] + r[2] * el.Q[2], r[0] * el.P[0] + r[1] * el.P[1] + r[2] * el.P[2]);
    close(Lines.conicAt(el, nu), r, 1e-7);
  }
});

test('segment ends crowd at the body on both sides and span exactly one revolution', () => {
  const u = Lines.crowd(1024);
  assert.equal(u[0], 0);
  assert.equal(u[1024], 1);
  assert.ok(u[1] < 1e-5 && 1 - u[1023] < 1e-5);
  const step = Math.max(...u.slice(1).map((x, i) => x - u[i]));
  assert.ok(step < 0.0016, `widest segment is ${step} of a revolution`);
});

test('an open or near-parabolic orbit has no conic to draw', () => {
  assert.equal(Lines.elements([1, 0, 0], [0, 1.6, 0], 1), null);
  assert.equal(Lines.elements([1, 0, 0], [0, 1.41, 0], 1), null);
  assert.equal(Lines.elements([1, 0, 0], [0, 1, 0], 0), null);
});

test('a circular orbit has radius p everywhere, so the line never sags in or out of it', () => {
  const el = Lines.elements([2, 0, 0], [0, 1 / Math.sqrt(2), 0], 1);
  near(el.e, 0, 1e-12);
  for (const nu of [0, 1, 2.5, -2]) near(Math.hypot(...Lines.conicAt(el, nu)), 2, 1e-12);
});

// The vertex shader's body-relative conic, with float32 rounding after each step (f) or none (identity).
function shaderOffset(el, u, f) {
  const c0 = Math.cos(el.nu), s0 = Math.sin(el.nu);
  const A = [0, 1, 2].map(i => f(c0 * el.P[i] + s0 * el.Q[i])), B = [0, 1, 2].map(i => f(c0 * el.Q[i] - s0 * el.P[i]));
  const p = f(el.p), e = f(el.e), nu0 = f(el.nu), dl = f(-2 * Math.PI * u), sh = f(Math.sin(f(dl / 2))), nu = f(nu0 + dl);
  const r = f(p / f(1 + f(e * f(Math.cos(nu)))));
  const dr = f(f(f(2 * p * e) * f(Math.sin(f(nu0 + f(dl / 2)))) * sh) / f(f(1 + f(e * f(Math.cos(nu)))) * f(1 + f(e * f(Math.cos(nu0))))));
  const along = f(dr - f(2 * r * sh * sh)), across = f(r * f(Math.sin(dl)));
  return [0, 1, 2].map(i => f(f(along * A[i]) + f(across * B[i])));
}

test('the body-relative conic equals the offset of the conic from its body', () => {
  for (const id of ['mars', 'neptune', 'moon']) {
    const el = Lines.osculate(SF, id, JD, 1), b = Lines.conicAt(el, el.nu);
    for (const u of [0.0003, 0.02, 0.3, 0.5, 0.77, 0.9995]) {
      const q = Lines.conicAt(el, el.nu - 2 * Math.PI * u), d = shaderOffset(el, u, x => x);
      close(d, [q[0] - b[0], q[1] - b[1], q[2] - b[2]], 1e-9);
    }
  }
});

test('a float32 orbit line is off in proportion to its distance from the body, not by the 1,400 km of a line drawn from the Sun', () => {
  const AU = 149597870.7, el = Lines.osculate(SF, 'neptune', JD, 1 / AU, Lines.axes), body = Lines.conicAt(el, el.nu);
  for (const u of [1e-6, 1e-5, 1e-4, 1e-3, 0.02, 0.3, 0.5]) {
    const q = Lines.conicAt(el, el.nu - 2 * Math.PI * u), d = shaderOffset(el, u, Math.fround), t = [q[0] - body[0], q[1] - body[1], q[2] - body[2]];
    const off = Math.hypot(d[0] - t[0], d[1] - t[1], d[2] - t[2]) * AU, dist = Math.hypot(...t) * AU;
    assert.ok(off < 4e-7 * dist, `${off} km off at ${dist} km from the body`);
  }
});

test('every disc, ship and dock on screen becomes a fade-out hole for orbit and route lines, in framebuffer pixels', () => {
  class V { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z === undefined ? this.z : z; return this; }
    copy(o) { return this.set(o.x, o.y, o.z); } applyMatrix4(m) { m.map(this); return this; } }
  globalThis.THREE = { Vector2: V, Vector3: V };
  const cam = { matrixWorldInverse: { map() {} }, projectionMatrix: { map(v) { v.x /= 10; v.y /= 10; v.z = v.z > 50 ? 2 : 0; } } };
  Lines.resize({ getDrawingBufferSize: v => v.set(200, 100), getPixelRatio: () => 1 });
  const holes = (list) => { Lines.setHoles(cam, list); const m = Lines.shared(); return m.holes.value.slice(0, m.nh.value).map(h => [h.x, h.y, h.z]); };
  assert.deepEqual(holes([{ p: new V(5, 0, 0), r: 7 }, { p: new V(-5, -5, 0), r: 3 }]), [[150, 50, 7], [50, 25, 3]]);
  assert.deepEqual(holes([{ p: new V(500, 0, 0), r: 9 }, { p: new V(0, 0, 60), r: 9 }, { p: new V(0, 0, 0), r: 9 }]), [[100, 50, 9]]);
});
