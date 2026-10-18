// Numerical renderer check, using the exact Three r128 bytes pinned by the application (SRI verified).
// Runs geometry in Node, without opening or mutating a browser or altering any recorded flight.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../..'), E = require(path.join(root, 'connector/src/engine/sol-page.cjs'));
const View = require(path.join(root, 'connector/src/flight-view.cjs')), meta = require(path.join(root, 'connector/src/engine/meta.json'));
(async function () {
  const html = fs.readFileSync(path.join(root, 'connector/src/site.html'), 'utf8');
  const tag = html.match(/<script src="([^"]*three\.min\.js)"[^>]*integrity="(sha384|sha512)-([^"]+)"[^>]*>/);
  if (!tag) throw new Error('Pinned Three script not found');
  const response = await fetch(tag[1]); if (!response.ok) throw new Error('Three download failed: ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (crypto.createHash(tag[2]).update(bytes).digest('base64') !== tag[3]) throw new Error('Three integrity mismatch');
  const module = { exports: {} };
  vm.runInNewContext(bytes.toString('utf8'), { module, exports: module.exports, console });
  const THREE = module.exports;
  const a = html.indexOf('(function (root) {'), b = html.indexOf('</script>', a);
  const window = { SITE: { sky: meta.sky, hails: [], look: {} }, SOLE: E, StarfareView: View };
  vm.runInNewContext(html.slice(a, b), { window }); await window.SF.loadEngine();
  const SF = window.SF, V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const mapStart = html.indexOf('var R0 = 0.25'), mapEnd = html.indexOf('/* ---------- labels', mapStart);
  const map = vm.runInNewContext(html.slice(mapStart, mapEnd) + '\n({shipC, marker});', { SF, THREE, AU: 149597870.7, V, LIVEMAP: false });
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'route-reproduction.json'), 'utf8'));
  const flight = data.live.flights[0], rp = SF.replay({ arcs: {}, record: { score: { car: flight.ship, incidents: [] }, log: {
    flown: flight.legs.map((L) => ({ ...L, leg: L.kind, arc: data.flight.arcs[L.leg_id] })),
  } } });
  const checks = [], samples = [];
  for (const [i, L] of rp.legs.entries()) {
    for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const jd = L.dep + (L.orb - L.dep) * fraction, times = [];
      const direction = View.flightDirection(rp, jd, (t) => { times.push(t); return map.shipC(rp, t, jd).v.toArray(); });
      const ship = new THREE.Group(), frame = View.headingFrame(direction, [0, 1, 0]);
      View.orientShip(ship, frame);
      const nose = V(0, 0, 1).applyQuaternion(ship.quaternion), tail = V(0, 0, -1).applyQuaternion(ship.quaternion);
      const travel = V(...direction).normalize();
      const row = { leg: i + 1, fraction, direction: travel.toArray(), noseDotTangent: nose.dot(travel), exhaustDotTangent: tail.dot(travel), samplesStayInsideLeg: times.every((t) => t > L.dep && t < L.orb) };
      samples.push(row);
      checks.push(row.noseDotTangent > 1 - 1e-12 && row.exhaustDotTangent < -1 + 1e-12 && row.samplesStayInsideLeg);
    }
  }
  const parked = ['iss', 'moon', 'ceres', 'mars-base', 'titan'].map((id) => {
    const jd = rp.legs[0].dep, d = View.orbitDirection(jd, (t) => map.marker(id, t).toArray());
    const ship = new THREE.Group(); View.orientShip(ship, View.headingFrame(d, [0, 1, 0]));
    const alignment = V(0, 0, 1).applyQuaternion(ship.quaternion).dot(V(...d).normalize());
    checks.push(alignment > 1 - 1e-12);
    return { id, noseDotOrbit: alignment, quaternion: ship.quaternion.toArray() };
  });
  const L = rp.legs[0], jd = L.dep + (L.orb - L.dep) * 0.5, oldStep = (rp.end - rp.start) / 900, oldState = rp.at(jd + oldStep);
  const report = { capturedAt: new Date().toISOString(), threeRevision: THREE.REVISION, threeIntegrityVerified: true,
    runId: flight.run_id, originalReplayDiagnostic: { pickupDurationDays: L.orb - L.dep, oldLookAheadDays: oldStep, sampledAfterPickup: jd + oldStep > L.orb, sampledPhase: oldState.phase, sampledLeg: oldState.i + 1 },
    samples, parked, passed: checks.filter(Boolean).length, failed: checks.filter((v) => !v).length,
    note: 'Actual application mapping and real archived Worker payload; model nose +Z and exhaust -Z transformed by actual Three quaternions. Positions and recorded times are unchanged.' };
  fs.writeFileSync(path.join(__dirname, 'ship-heading-numeric.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ revision: report.threeRevision, passed: report.passed, failed: report.failed, diagnostic: report.originalReplayDiagnostic }));
  if (report.failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
