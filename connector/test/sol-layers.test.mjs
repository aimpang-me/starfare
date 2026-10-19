import test from 'node:test';
import assert from 'node:assert/strict';
import Layers from '../../design/assets/sol-layers.js';

const memory = (init) => { const m = new Map(init ? [[Layers.KEY, init]] : []); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, v) }; };

test('nothing saved gives the defaults, and a saved choice survives a reload', () => {
  assert.deepEqual(Layers.load(memory()), Layers.DEFAULTS);
  const store = memory();
  Layers.save(store, { ...Layers.DEFAULTS, shp: false, size: 'l' });
  const back = Layers.load(store);
  assert.equal(back.shp, false);
  assert.equal(back.size, 'l');
  assert.equal(back.pln, true);
});

test('saved junk, unknown keys and an old save without the newer keys fall back to defaults', () => {
  assert.deepEqual(Layers.load(memory('{not json')), Layers.DEFAULTS);
  const s = Layers.normalize({ pln: 'no', size: 'huge', nope: true, orb: false });
  assert.equal(s.pln, true);
  assert.equal(s.size, 'm');
  assert.equal(s.orb, false);
  assert.equal('nope' in s, false);
  assert.equal(Layers.normalize({ pln: false }).rsel, false);
});

test('a storage that throws leaves the page on defaults and does not throw', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(Layers.load(broken), Layers.DEFAULTS);
  assert.doesNotThrow(() => Layers.save(broken, Layers.DEFAULTS));
});

test('clean view hides every name and line, keeps the readout and size, and a second press restores', () => {
  const start = { ...Layers.DEFAULTS, ring: true, orb: false, hud: false, size: 's' };
  const a = Layers.toggleClean(start, null);
  assert.equal(Layers.isClean(a.state), true);
  assert.equal(a.state.hud, false);
  assert.equal(a.state.size, 's');
  const b = Layers.toggleClean(a.state, a.before);
  assert.deepEqual(b.state, start);
  assert.equal(b.before, null);
});

test('a second press with nothing remembered brings back the defaults without losing the readout or size', () => {
  const clean = { ...Layers.DEFAULTS, pln: false, plc: false, shp: false, orb: false, moon: false, rte: false, hud: false, size: 'l' };
  const r = Layers.toggleClean(clean, null).state;
  assert.equal(r.pln, true);
  assert.equal(r.hud, false);
  assert.equal(r.size, 'l');
});

test('path lines follow the selection only when the selected-only switch is on', () => {
  const s = { ...Layers.DEFAULTS };
  assert.equal(Layers.showPath(s, false), true);
  assert.equal(Layers.showPath({ ...s, rsel: true }, false), false);
  assert.equal(Layers.showPath({ ...s, rsel: true }, true), true);
  assert.equal(Layers.showPath({ ...s, rte: false, rsel: true }, true), false);
});
