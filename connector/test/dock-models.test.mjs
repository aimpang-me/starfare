import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PLACES } from '../../world/engine/sol-engine.js';

const DIR = new URL('../../design/assets/models/', import.meta.url);
const man = JSON.parse(readFileSync(new URL('docks.json', DIR), 'utf8'));

// The JSON chunk of a GLB: its node names and the extensions it needs.
function gltf(file) {
  const b = readFileSync(new URL(file, DIR));
  assert.equal(b.toString('latin1', 0, 4), 'glTF', file);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.toString('utf8', 20, 20 + len));
}

test('every model in docks.json ships with the size and hash it records, and stays small', () => {
  for (const [name, m] of Object.entries(man.models)) {
    const b = readFileSync(new URL(m.file, DIR));
    assert.equal(b.length, m.bytes, name);
    assert.equal(createHash('sha256').update(b).digest('hex'), m.sha256, name);
    assert.ok(b.length < 300 * 1024, `${name} is ${b.length} bytes`);
  }
  assert.equal(man.productionApproved, false);
});

test('docks and stations carry berth_1 to berth_4, cabins one seat node per seat, and no textures', () => {
  for (const [name, m] of Object.entries(man.models)) {
    const g = gltf(m.file), names = g.nodes.map(n => n.name);
    assert.ok(!g.images && !g.textures, `${name} has textures`);
    for (const ext of g.extensionsRequired || []) assert.equal(ext, 'KHR_mesh_quantization', name); // three r128 reads it
    if (m.seats) {
      for (let i = 1; i <= m.seats; i++) assert.ok(names.includes('seat_' + i), `${name} seat_${i}`);
      assert.ok(!names.includes('seat_' + (m.seats + 1)), name);
    } else {
      for (let i = 1; i <= 4; i++) assert.ok(names.includes('berth_' + i), `${name} berth_${i}`);
    }
  }
});

test('each fictional station has its own model, and the default dock covers every other place', () => {
  assert.ok(man.models[man.default]);
  const stations = PLACES.filter(p => p.kind === 'station');
  assert.ok(stations.length >= 5);
  for (const p of stations) {
    if (p.real) assert.equal(man.places[p.id], undefined, `${p.id} is a real station; it gets the generic dock`);
    else assert.ok(man.models[man.places[p.id]], `${p.id} has no station model`);
  }
});
