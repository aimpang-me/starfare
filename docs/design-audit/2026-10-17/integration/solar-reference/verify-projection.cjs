// Project real points with the application's pinned Three build and camera class.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../../../..'), Map = require(path.join(root, 'design/assets/solar-map.js'));
(async () => {
  const html = fs.readFileSync(path.join(root, 'connector/src/site.html'), 'utf8');
  const tag = html.match(/<script src="([^"]*three\.min\.js)"[^>]*integrity="(sha384|sha512)-([^"]+)"/);
  const response = await fetch(tag[1]); assert.ok(response.ok);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(crypto.createHash(tag[2]).update(bytes).digest('base64'), tag[3]);
  const module = { exports: {} }; vm.runInNewContext(bytes.toString('utf8'), { module, exports: module.exports });
  const THREE = module.exports, cameraClass = html.match(/cam = new THREE\.(\w+Camera)\(/)[1];
  const cases = [];
  for (const [width, height] of [[1191, 903], [900, 690], [390, 742], [360, 638]]) {
    for (const state of [{}, { collapsed: true }, { panelsHidden: true }, { selection: true }]) {
      const frame = Map.frame(width, height, state), distance = Map.fitDistance(65, .62, width, height, frame);
      const p = Map.projection(distance, width, height, frame);
      const cam = new THREE[cameraClass](p.left, p.right, p.top, p.bottom, .005, 12000);
      cam.setViewOffset(width, height, p.offsetX, p.offsetY, width, height);
      cam.position.set(500 * Math.cos(.62) * Math.sin(.25), 500 * Math.sin(.62), 500 * Math.cos(.62) * Math.cos(.25));
      cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
      const project = (v) => { const n = v.clone().project(cam); return [(n.x + 1) * width / 2, (1 - n.y) * height / 2]; };
      const points = Array.from({ length: 361 }, (_, i) => project(new THREE.Vector3(65 * Math.cos(i * Math.PI / 180), 0, 65 * Math.sin(i * Math.PI / 180))));
      assert.ok(points.every(([x, y]) => x >= frame.x - .01 && x <= frame.x + frame.width + .01 && y >= frame.y - .01 && y <= frame.y + frame.height + .01));
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), depth = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2);
      const a = project(new THREE.Vector3()), b = project(right), c = project(depth.clone().multiplyScalar(100)), d = project(depth.clone().multiplyScalar(100).add(right));
      assert.ok(Math.abs((b[0] - a[0]) - (d[0] - c[0])) < 1e-9);
      cases.push({ width, height, state, orbitFitsSafeFrame: true, scaleUnaffectedByDepth: true });
    }
  }
  fs.writeFileSync(path.join(__dirname, 'projection-numeric.json'), JSON.stringify({ threeRevision: THREE.REVISION, integrityVerified: true, actualCameraClass: cameraClass, passed: cases.length, cases }, null, 2) + '\n');
  console.log(`Projection: ${cases.length} cases passed with Three ${THREE.REVISION}`);
})().catch(e => { console.error(e); process.exitCode = 1; });
