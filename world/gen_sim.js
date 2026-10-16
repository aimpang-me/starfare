// Bake the simulated fleet: real planner rides (no re-fly) between random places, spread over one season.
// Same calendar every season, so every viewer sees the same simulated traffic. Seeded; rerun gives the same file.
const S = require('./engine/sol-page.js'), fs = require('fs');
let seed = 20261016; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const ids = S.PLACES.map(p => p.id), JD0 = 2461329.5, LEN = 7000, out = [];
let k = 0, tries = 0;
while (out.length < 36 && tries++ < 400) {
  const from = ids[Math.floor(rnd() * ids.length)], to = ids[Math.floor(rnd() * ids.length)]; if (from === to) continue;
  const dep = JD0 + rnd() * (LEN - 200);
  const b = S.planRide({ place: from }, to, { depFrom: dep, depTo: dep + 60, arriveBy: JD0 + LEN - 1, objective: rnd() < 0.7 ? 'energy' : 'time', allLocal: true });
  if (b.error || b.local) continue;
  out.push({ name: 'Fleet ' + String(++k).padStart(2, '0'), from, to, dep: +b.dep_jd.toFixed(3), arr: +b.arr_jd.toFixed(3), arc: b.arc_au.map(p => p.map(x => +x.toFixed(4))) });
}
fs.writeFileSync(__dirname + '/sim_rides.json', JSON.stringify(out));
console.log(out.length, 'sim rides', fs.statSync(__dirname + '/sim_rides.json').size, 'bytes');
