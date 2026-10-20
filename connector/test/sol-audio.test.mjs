import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Audio from '../../design/assets/sol-audio.js';

const require = createRequire(import.meta.url);
const { PLACES } = require('../src/engine/sol-page.cjs');
const AU = Audio.AU_KM;
const memory = (init) => { const m = new Map(init ? [[Audio.KEY, init]] : []); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, v) }; };

// A body at `at` AU, and the camera `km` from its centre along +x.
const EARTH = { id: 'earth', kind: 'planet', rKm: 6378.137, p: [1, 0, 0] };
const SATURN = { id: 'saturn', kind: 'planet', rKm: 60268, p: [9.5, 0, 0] };
const off = (body, km, dir = [1, 0, 0]) => body.p.map((v, i) => v + dir[i] * km / AU);
const level = (list, id) => (list.find(v => v.id === id) || { level: 0 }).level;

test('sound is off unless saved on, and a broken storage stays off without throwing', () => {
  assert.equal(Audio.load(memory()), false);
  const store = memory();
  Audio.save(store, true);
  assert.equal(Audio.load(store), true);
  assert.equal(Audio.load(memory('{junk')), false);
  assert.equal(Audio.load(memory('"yes"')), false);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(Audio.load(broken), false);
  assert.equal(Audio.load(null), false);
  assert.doesNotThrow(() => Audio.save(broken, true));
});

test('open space far from everything is the bed alone', () => {
  const m = Audio.mix({ eye: [1.5, 0, 0.8], bodies: [EARTH, SATURN] });
  assert.equal(m.space, 1);
  assert.equal(m.debris, 0);
  assert.deepEqual(m.bodies, []);
  assert.deepEqual(m.stations, []);
});

test('a planet fades in as the true-scale camera closes: full at the jump distance, gone past 40 radii', () => {
  const at = r => level(Audio.mix({ eye: off(EARTH, r * EARTH.rKm, [0, 0, 1]), bodies: [EARTH] }).bodies, 'earth');
  assert.equal(at(8), 1); // the map's default jump frame
  assert.equal(at(Audio.BODY_FULL), 1);
  assert.equal(at(Audio.BODY_NONE), 0);
  assert.equal(at(100), 0);
  const mid = at(22);
  assert.ok(mid > 0.2 && mid < 0.9, `half way fades, got ${mid}`);
  assert.ok(at(16) > at(22) && at(22) > at(30), 'closer is louder');
  assert.ok(Audio.mix({ eye: off(EARTH, 8 * EARTH.rKm, [0, 0, 1]), bodies: [EARTH] }).space < 1, 'the space bed ducks under a planet');
});

test('low Earth orbit has debris and a station; the planet ducks under the station', () => {
  const iss = { id: 'iss', kind: 'station', rKm: 0, p: off(EARTH, EARTH.rKm + 420) };
  const m = Audio.mix({ eye: off(EARTH, EARTH.rKm + 450), bodies: [EARTH, iss] });
  assert.equal(m.debris, 1);
  assert.equal(level(m.stations, 'iss'), 1);
  assert.ok(level(m.bodies, 'earth') < 1 && level(m.bodies, 'earth') > 0.5);
  // Far from the station, its comms are gone.
  const far = Audio.mix({ eye: off(EARTH, EARTH.rKm + 450, [0, 0, 1]), bodies: [EARTH, iss] });
  assert.equal(level(far.stations, 'iss'), 0);
  // Above low orbit, below geostationary: little debris; in the geostationary belt: some.
  assert.equal(Audio.mix({ eye: off(EARTH, EARTH.rKm + 15000), bodies: [EARTH] }).debris, 0);
  assert.equal(Audio.mix({ eye: off(EARTH, EARTH.rKm + 35786), bodies: [EARTH] }).debris, 0.6);
});

test("Saturn's rings, small bodies and the asteroid belt carry debris", () => {
  assert.equal(Audio.mix({ eye: off(SATURN, 1.8 * SATURN.rKm), bodies: [SATURN] }).debris, 0.9);
  assert.equal(Audio.mix({ eye: off(SATURN, 3 * SATURN.rKm), bodies: [SATURN] }).debris, 0);
  const bennu = { id: 'bennu', kind: 'small', rKm: 0.245, p: [1.1, 0.2, 0] };
  const m = Audio.mix({ eye: off(bennu, 3), bodies: [bennu] });
  assert.equal(m.debris, 0.7);
  assert.deepEqual(m.bodies, [], 'Bennu is debris only, no voice of its own');
  assert.equal(Audio.mix({ eye: [2.7, 0, 0], bodies: [] }).debris, 0.35);
  assert.equal(Audio.mix({ eye: [2.7, 0, 0.6], bodies: [] }).debris, 0, 'far off the ecliptic the belt is gone');
});

test('a moon close to its planet wins over the planet at equal level, and at most two of each play', () => {
  const mars = { id: 'mars', kind: 'planet', rKm: 3396.19, p: [1.5, 0, 0] };
  const phobos = { id: 'phobos', kind: 'moon', rKm: 11.1, p: off(mars, 9376) };
  const m = Audio.mix({ eye: off(phobos, 60), bodies: [mars, phobos] });
  assert.equal(m.bodies[0].id, 'phobos');
  assert.equal(m.bodies.length, 2);
  const crowd = ['iss', 'tiangong', 'orbital-depot'].map(id => ({ id, kind: 'station', rKm: 0, p: off(EARTH, EARTH.rKm + 450) }));
  assert.equal(Audio.mix({ eye: off(EARTH, EARTH.rKm + 450), bodies: crowd }).stations.length, 2);
});

test('every planet, moon, the Sun, Ceres and every station in the engine has a voice', () => {
  const want = PLACES.filter(p => p.kind === 'planet' || p.kind === 'moon' || p.id === 'ceres').map(p => p.id).concat('sun');
  for (const id of want) assert.ok(Audio.BODIES[id], `${id} has a body voice`);
  for (const p of PLACES.filter(p => p.kind === 'station')) assert.ok(Audio.STATIONS[p.id], `${p.id} has a station voice`);
  for (const [id, v] of Object.entries({ ...Audio.BODIES, ...Audio.STATIONS, space: Audio.SPACE, debris: Audio.DEBRIS })) {
    assert.ok(v.vol > 0 && v.vol <= 0.6, `${id} volume`);
    for (const e of v.ev || []) assert.ok(e.rate > 0 && e.g > 0 && e.g <= 0.25, `${id} ${e.k} event`);
  }
});

test('the player degrades quietly where the Web Audio API is missing', () => {
  const p = Audio.create({ AudioContext: null });
  assert.equal(p.supported, false);
  assert.equal(p.setOn(true), false);
  assert.doesNotThrow(() => { p.update(Audio.mix({ eye: [1, 0, 0], bodies: [] })); p.pause(true); p.unlock(); });
});
