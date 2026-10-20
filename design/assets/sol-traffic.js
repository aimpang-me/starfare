/* Background traffic for the sky map: many fictional ships on the lanes between real places, so the solar system
   looks lived in. Illustrative only. These ships take no bookings, never reach the engine, the scoreboard or the
   benchmark, and every viewer sees the same ones at the same sky date (the schedule is a pure function of the date).

   The model, and its approximations:
   - Each ship works one lane (two places) out and back. Trip k starts at t0 + k * slot; the ship flies, then waits
     docked for the rest of the slot.
   - A trip is a burn-flip-burn at constant thrust: accelerate to the midpoint, turn over, brake to a stop. From rest
     to rest over a distance d at acceleration a that takes 2 * sqrt(d / a) (the brachistochrone; no gravity, no
     orbital speeds matched, d measured at departure).
   - Lanes between two planet systems use 0.01 g; lanes inside one planet's system use 0.003 g, so short hops stay
     visible at one sky day a second. When a long lane's distance at departure would not fit the slot, that trip
     burns harder, just enough to arrive with a little time docked.
   The map draws where along the trip a ship is; the path shape (a gentle bow between the two ends as they are now)
   is the page's job. Pure, so it runs in node for tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SolTraffic = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var G0 = 9.80665, DAY = 86400;
  var ACCEL = { helio: 0.01 * G0, local: 0.003 * G0 };
  // [from, to, weight]. Weights favour the busy near-Earth and Earth-Mars lanes; every place the engine knows gets some.
  var LANES = [
    ['earth', 'moon', 22], ['earth', 'orbital-depot', 10], ['earth', 'iss', 9], ['earth', 'tiangong', 7], ['orbital-depot', 'moon', 10],
    ['moon', 'lunar-data-center', 6], ['iss', 'tiangong', 3], ['orbital-depot', 'lunar-data-center', 4],
    ['earth', 'mars', 18], ['orbital-depot', 'mars-base', 10], ['mars', 'phobos', 8], ['mars', 'mars-base', 6], ['phobos', 'mars-base', 3],
    ['mars', 'ceres-port', 8], ['earth', 'ceres-port', 6], ['ceres', 'ceres-port', 3], ['earth', 'venus', 5], ['earth', 'mercury', 2],
    ['venus', 'mars', 2], ['earth', 'bennu', 1], ['mars', 'bennu', 1],
    ['earth', 'ganymede', 5], ['mars', 'ganymede', 4], ['ceres-port', 'callisto', 3], ['ganymede', 'callisto', 4], ['europa', 'ganymede', 4],
    ['io', 'europa', 2], ['jupiter', 'callisto', 2],
    ['earth', 'titan-dock', 3], ['ganymede', 'titan-dock', 3], ['titan', 'titan-dock', 3], ['titan', 'enceladus', 3], ['saturn', 'titan', 2],
    ['earth', 'uranus', 1], ['titan-dock', 'uranus', 1], ['earth', 'triton', 1], ['neptune', 'triton', 1]
  ];
  // How many ships each density shows, per quality tier of the page (phones run medium, Save-Data and slow pages low).
  var DENSITY = { off: 0, light: 0.25, busy: 1 };
  var CAP = { high: 1200, medium: 600, low: 300 };
  var TAIL = 0.05; // a trail covers the last 5 % of the trip's time

  function count(density, tier) { return Math.round((DENSITY[density] || 0) * (CAP[tier] || CAP.medium)); }
  // Seconds to fly d metres from rest to rest at a m/s^2, and the acceleration that does it in t seconds.
  function burnTime(d, a) { return 2 * Math.sqrt(Math.max(0, d) / a); }
  function accelFor(d, t) { return 4 * d / (t * t); }
  // Share of the distance covered at share u of the trip's time: speeding up for the first half, braking for the second.
  function along(u) { u = u < 0 ? 0 : u > 1 ? 1 : u; return u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u); }
  // A small integer hash, so a ship's lane and timing depend only on its number and the seed.
  function hash(n) {
    n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15;
    return (n >>> 0) / 4294967296;
  }

  /* The fleet: n ships, each with its lane and schedule. places: the engine's places ({id, parent}). reach(id) gives
     a place's greatest distance in metres from what it circles: from the Sun for a planet or small body, from its
     planet for a moon or station. jd0: any fixed date, so the schedule is the same for every viewer. */
  function fleet(places, reach, n, jd0, seed) {
    var by = {}; places.forEach(function (p) { by[p.id] = p; });
    var top = function (id) { var p = by[id]; while (p && p.parent && p.parent !== 'sun') p = by[p.parent]; return p && p.id; };
    var lanes = LANES.filter(function (L) { return by[L[0]] && by[L[1]]; }).map(function (L) {
      var local = top(L[0]) === top(L[1]);
      var span = local ? off(L[0]) + off(L[1]) : reach(top(L[0])) + reach(top(L[1]));
      var accel = local ? ACCEL.local : ACCEL.helio;
      return { from: L[0], to: L[1], w: L[2], local: local, hub: local ? top(L[0]) : 'sun', accel: accel, fly: burnTime(span, accel) / DAY };
    });
    function off(id) { return by[id].parent === 'sun' ? 0 : reach(id) + (by[by[id].parent].parent === 'sun' ? 0 : off(by[id].parent)); }
    var total = lanes.reduce(function (a, L) { return a + L.w; }, 0), ships = [];
    for (var i = 0; i < n && total; i++) {
      var h = hash(i * 4 + 1 + (seed | 0) * 7919), pick = h * total, L = lanes[0];
      for (var j = 0; j < lanes.length; j++) { pick -= lanes[j].w; if (pick < 0) { L = lanes[j]; break; } }
      // A slot is the longest flight on the lane plus 10 to 70 % again for time docked, so ships on a lane drift out of step.
      var slot = L.fly * (1.1 + 0.6 * hash(i * 4 + 2 + (seed | 0) * 7919)) + 0.5;
      ships.push({ i: i, lane: L, slot: slot, t0: jd0 - hash(i * 4 + 3 + (seed | 0) * 7919) * 2 * slot,
        side: hash(i * 4 + 4 + (seed | 0) * 7919) * 2 - 1, k: null, T: 0, from: null, to: null });
    }
    return ships;
  }

  /* Where ship s is at sky date jd: null while docked, else { from, to, f, ft } with f the share of the way flown and
     ft the share at the start of its trail. dist(a, b, jd) gives metres between two places at a date. The trip's
     duration is worked out once per trip, from the distance at departure. */
  function state(s, jd, dist) {
    var x = (jd - s.t0) / s.slot, k = Math.floor(x), into = (x - k) * s.slot;
    if (s.k !== k) {
      var out = (k & 1) === 0, L = s.lane, j0 = s.t0 + k * s.slot;
      s.k = k; s.from = out ? L.from : L.to; s.to = out ? L.to : L.from;
      var d = dist(s.from, s.to, j0), T = burnTime(d, L.accel) / DAY, most = s.slot * 0.9;
      s.T = T > most ? most : T; // a long trip burns harder (accelFor) to fit, still arriving with time docked
    }
    if (!(s.T > 0) || into >= s.T) return null;
    var u = into / s.T;
    return { from: s.from, to: s.to, f: along(u), ft: along(u - TAIL) };
  }

  return { G0: G0, ACCEL: ACCEL, LANES: LANES, DENSITY: DENSITY, CAP: CAP, TAIL: TAIL, count: count, burnTime: burnTime,
    accelFor: accelFor, along: along, hash: hash, fleet: fleet, state: state };
});
