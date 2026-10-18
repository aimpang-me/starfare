// Numeric checks against saved real local Worker/MCP payloads. No fixtures or browser mutations.
const fs = require('node:fs'), path = require('node:path'), {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '../../../..');
const E = require(path.join(root, 'connector/src/engine/sol-page.cjs'));
const View = require(path.join(root, 'connector/src/flight-view.cjs'));
const meta = require(path.join(root, 'connector/src/engine/meta.json'));
const read = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
const end = meta.sky.jd0 + meta.sky.len_days - 1;
const maxError = (a, b) => Math.max(...a.map((p, i) => Math.hypot(...p.map((n, k) => n - b[i][k])) * 149597870.7));
(async function () {
  const saved = read('route-local-flight.json'), id = saved.attempts.at(-1).runId, arc = saved.flight.arcs.leg1;
  const fresh = E.R.planLeg(arc.from, arc.to, arc.dep_jd, 'energy', end, 'sf-04');
  const before = read('route-reproduction.json'), old = before.flight.arcs.leg1, original = JSON.stringify(old);
  const restored = View.preciseLocalArc(E, old, 'sf-04', end);
  const expected = E.R.planLeg(old.from, old.to, old.dep_jd, 'energy', end, 'sf-04');
  const archiveId = before.live.flights[0].run_id;
  const response = await fetch('http://127.0.0.1:8796/flight/' + archiveId + '.json');
  if (!response.ok) throw new Error('Archived local Worker response: ' + response.status);
  const current = await response.json();
  const result = {
    capturedAt: new Date().toISOString(), origin: 'Actual local Worker and MCP', archivedRun: archiveId, newRun: id,
    waypoints: arc.arc_au.length, newArcMaxErrorKm: maxError(arc.arc_au, fresh.arc_au),
    archiveBeforeMaxErrorKm: maxError(old.arc_au, expected.arc_au), archiveRestoredMaxErrorKm: maxError(restored.arc_au, expected.arc_au),
    archiveInputUnchanged: JSON.stringify(old) === original, archiveStorageUnchanged: JSON.stringify(current.arcs.leg1) === original,
    engineSha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'world/engine/sol-page.js'))).digest('hex'),
  };
  result.pass = result.newArcMaxErrorKm < 0.001 && result.archiveRestoredMaxErrorKm === 0 && result.archiveInputUnchanged && result.archiveStorageUnchanged;
  fs.writeFileSync(path.join(__dirname, 'route-numeric-verification.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (!result.pass) process.exitCode = 1;
})();
