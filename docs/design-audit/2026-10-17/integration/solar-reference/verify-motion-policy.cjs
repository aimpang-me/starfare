// Execute the actual motion controller in Node. No browser injection or clock changes.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const file = path.resolve(__dirname, '../../../../..', 'design/assets/mission-control.js');
const source = fs.readFileSync(file, 'utf8'), results = [];
for (const reduced of [true, false]) {
  let tweens = [], killed = 0;
  const media = { matches: reduced, addEventListener() {} };
  const gsap = { to(target, options) { tweens.push({ duration: options.duration, ease: options.ease }); return { progress() { return this; }, kill() { killed++; } }; } };
  const window = { matchMedia: () => media, gsap, addEventListener() {} };
  vm.runInNewContext(source, { window, gsap, document: { hidden: false, addEventListener() {} }, Set });
  const progress = { value: 0 }; window.StarfareMotion.camera(progress);
  assert.equal(tweens.length, reduced ? 0 : 1);
  if (reduced) assert.equal(progress.value, 1);
  else assert.equal(tweens[0].duration, .75);
  window.StarfareMotion.stopCamera();
  assert.equal(killed, reduced ? 0 : 1);
  results.push({ reducedMotion: reduced, tweenCount: tweens.length, snapsToTarget: progress.value === 1, killed });
}
fs.writeFileSync(path.join(__dirname, 'motion-policy.json'), JSON.stringify({ actualController: 'design/assets/mission-control.js', passed: 2, results }, null, 2) + '\n');
console.log('Motion policy: 2 cases passed');
