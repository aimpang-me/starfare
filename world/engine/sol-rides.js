// Starfare ride hails: simulated riders (NPCs) hail a robotaxi; the dispatcher picks a car from the simulated fleet,
// plans the pickup and the ride, quotes the fare and arrival, and is scored. Appended to the engine bundle by
// world/bundle.py as `SOLE.R`, so the page, its worker and the Grok connector all score the same way.
// Pure functions of the engine; no DOM, no storage.
SOLE.R = (function(E){
"use strict";
var DWELL = 0.05;        // days at the pickup for the rider to board (1.2 h)
var WINDOW = 120;        // a leg may depart up to this many days after it is allowed to
var LEAD = 150;          // long-haul hails are booked this many sky days ahead (quick hails: 1 day)
// Seats per car: a placeholder until Alvin sets it (docs/SHARED-FLIGHTS.md, open number 1).
var SEATS = 4;
// The simulated robotaxi fleet: flying roadsters parked at stations and moons. Same in every season.
var FLEET = [
  { id: "sf-01", name: "SF-01", at: "orbital-depot", seats: SEATS },
  { id: "sf-02", name: "SF-02", at: "lunar-data-center", seats: SEATS },
  { id: "sf-03", name: "SF-03", at: "mars-base", seats: SEATS },
  { id: "sf-04", name: "SF-04", at: "ceres", seats: SEATS },
  { id: "sf-05", name: "SF-05", at: "europa", seats: SEATS },
  { id: "sf-06", name: "SF-06", at: "callisto", seats: SEATS },
  { id: "sf-07", name: "SF-07", at: "titan-dock", seats: SEATS }
];
var CAR = {}; FLEET.forEach(function(c){ CAR[c.id] = c; });
// Simulated riders. Names are made up; every number comes from the engine. party: how many travel on the booking.
var HAILS = [
  { id: "iss-crew", title: "ISS crew change", rider: "Dana, a station engineer", party: 1, from: "iss", to: "lunar-data-center", kind: "quick", rush: { at: "iss", x: 2 },
    blurb: "Dana finishes a shift on the ISS and needs a ride to the Lunar Data Center." },
  { id: "phobos-commute", title: "Phobos commute", rider: "Ravi, a survey pilot", party: 1, from: "phobos", to: "mars-base", kind: "quick",
    blurb: "Ravi is done surveying Phobos and wants a lift down to Mars Base." },
  { id: "jovian-hop", title: "Jovian hop", rider: "Mei, a volcanologist", party: 1, from: "io", to: "ganymede", kind: "quick",
    blurb: "Mei is leaving Io for a conference on Ganymede. Two cars work Jupiter's moons.", rush: { at: "ganymede", x: 3, after: 2 } },
  { id: "titan-home", title: "Stranded at Titan", rider: "Sam, a stranded tourist", party: 1, from: "titan", to: "earth", kind: "long",
    blurb: "Sam's tour left without them. It's a long way home from Titan to Earth." },
  { id: "ceres-shift", title: "Belt shift change", rider: "Ana, a miner", party: 1, from: "ceres-port", to: "mars-base", kind: "long", rush: { at: "ceres-port", x: 3 },
    blurb: "Ana's shift on Ceres is over and she's heading to Mars Base. One car is parked at Ceres, one at Mars." }
];
var BY = {}; HAILS.forEach(function(h){ BY[h.id] = h; });

/* ---------- a flight plan: one car, several bookings, several stops ----------
   { stops, legs }: stops[0] = { at: where the car is parked }, then { at, board: [hail ids], alight: [hail ids] };
   legs[i] flies stops[i].at to stops[i + 1].at. Today's dispatch [pickup, ride] is the plan with stops
   [base, { at: h.from, board: [h] }, { at: h.to, alight: [h] }], and planOf rewrites it so old callers keep working. */
function planOf(id, car, legs){
  if (!Array.isArray(legs)) return legs;
  var h = BY[id], c = CAR[car];
  return { stops: [{ at: c ? c.at : legs[0].from }, { at: h.from, board: [id], alight: [] }, { at: h.to, board: [], alight: [id] }], legs: legs };
}
// Who rides what: the bookings (boarders first, in boarding order), each leg's role (pickup with an empty cabin, ride
// with anyone aboard), passengers aboard after each stop, and each booking's board and alight stop numbers.
function manifest(plan){
  var aboard = [], roles = [], party = [], stop = {}, hails = [];
  function row(id){ return stop[id] || (stop[id] = { board: [], alight: [] }); }
  plan.stops.forEach(function(s, n){
    (s.alight || []).forEach(function(id){ aboard = aboard.filter(function(x){ return x !== id; }); row(id).alight.push(n); });
    (s.board || []).forEach(function(id){ if (hails.indexOf(id) < 0) hails.push(id); aboard.push(id); row(id).board.push(n); });
    party.push(aboard.reduce(function(a, id){ return a + (BY[id] ? BY[id].party : 1); }, 0));
    if (n < plan.legs.length) roles.push(aboard.length ? "ride" : "pickup");
  });
  Object.keys(stop).forEach(function(id){ if (hails.indexOf(id) < 0) hails.push(id); });
  return { hails: hails, roles: roles, party: party, stop: stop };
}

var PID = {}; E.PLACES.forEach(function(p){ PID[p.id] = p; });
// Which planet's neighbourhood a place is in (stations and moons belong to their planet; Ceres to itself).
function system(id){ var p = PID[id]; while (p && p.parent && p.parent !== "sun") p = PID[p.parent]; return p ? p.id : id; }
// Par and the best pickup only look at cars in the rider's or the destination's neighbourhood.
function nearCars(h){ // rider's neighbourhood first, then the destination's
  var s = [system(h.from), system(h.to)], rank = function(c){ return s.indexOf(system(c.at)); };
  return FLEET.filter(function(c){ return rank(c) >= 0 && c.at !== h.from; }).sort(function(a, b){ return rank(a) - rank(b) || FLEET.indexOf(a) - FLEET.indexOf(b); }); }


/* ---------- the hard layer: simulated hazards ----------
   Everything here is made up for the game and seeded, so a season's weather and traffic are the same for every
   player and every replay. Dispatchers only see forecasts (odds and booked berths); fly() decides what happened. */
var HOUR = 1 / 24, HOLD_KWH = 250, MAX_HOLD_H = 120;
var BERTHS = { station: 2, moon: 3, planet: 4, small: 1 };
// Simulated other traffic: chance an NPC ship docks in a given hour, by place (default by kind). Each stays 2-6 h.
var TRAFFIC = { iss: 0.25, "orbital-depot": 0.25, "lunar-data-center": 0.25, "mars-base": 0.22, earth: 0.5, tiangong: 0.15, "ceres-port": 0.12, "titan-dock": 0.1 };
var TRAFFIC_KIND = { station: 0.15, moon: 0.2, planet: 0.3, small: 0.05 };
var UNSCHEDULED = 0.25; // share of NPC dockings that never appear in the pad forecast
var LOCAL = { mars: "dust", "mars-base": "dust", titan: "haze", "titan-dock": "haze" };
function fmix(h){ h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; }
// Bench seeds look like "k1:<32 hex chars>": a 128-bit key, and every draw is SipHash-2-4(key, label) in full, so no
// 32-bit state can be recovered from forecasts. Any other seed keeps the FNV-1a draw, so live seasons never change.
var K1 = /^k1:([0-9a-fA-F]{32})$/;
function keyOf(seed){ var m = K1.exec(seed); if (!m) return null;
  var b = [], w = []; for (var i = 0; i < 16; i++) b.push(parseInt(m[1].substr(2 * i, 2), 16));
  for (var j = 0; j < 16; j += 4) w.push((b[j] | b[j + 1] << 8 | b[j + 2] << 16 | b[j + 3] << 24) >>> 0);
  return w; } // [k0 low, k0 high, k1 low, k1 high], little-endian as the SipHash reference reads the key
// SipHash-2-4 of a string's UTF-8 bytes under key K, as [high, low] 32-bit words of the 64-bit output.
function sip24(K, s){
  for (var q = 0; q < s.length; q++) if (s.charCodeAt(q) > 127){ s = unescape(encodeURIComponent(s)); break; }
  var n = s.length, t,
    v0l = K[0] ^ 0x70736575, v0h = K[1] ^ 0x736f6d65, v1l = K[2] ^ 0x6e646f6d, v1h = K[3] ^ 0x646f7261,
    v2l = K[0] ^ 0x6e657261, v2h = K[1] ^ 0x6c796765, v3l = K[2] ^ 0x79746573, v3h = K[3] ^ 0x74656462;
  function round(){
    t = (v0l >>> 0) + (v1l >>> 0); v0h = (v0h + v1h + (t >= 4294967296 ? 1 : 0)) | 0; v0l = t | 0;
    t = (v1h << 13) | (v1l >>> 19); v1l = (v1l << 13) | (v1h >>> 19); v1h = t;
    v1l ^= v0l; v1h ^= v0h;
    t = v0l; v0l = v0h; v0h = t;
    t = (v2l >>> 0) + (v3l >>> 0); v2h = (v2h + v3h + (t >= 4294967296 ? 1 : 0)) | 0; v2l = t | 0;
    t = (v3h << 16) | (v3l >>> 16); v3l = (v3l << 16) | (v3h >>> 16); v3h = t;
    v3l ^= v2l; v3h ^= v2h;
    t = (v0l >>> 0) + (v3l >>> 0); v0h = (v0h + v3h + (t >= 4294967296 ? 1 : 0)) | 0; v0l = t | 0;
    t = (v3h << 21) | (v3l >>> 11); v3l = (v3l << 21) | (v3h >>> 11); v3h = t;
    v3l ^= v0l; v3h ^= v0h;
    t = (v2l >>> 0) + (v1l >>> 0); v2h = (v2h + v1h + (t >= 4294967296 ? 1 : 0)) | 0; v2l = t | 0;
    t = (v1h << 17) | (v1l >>> 15); v1l = (v1l << 17) | (v1h >>> 15); v1h = t;
    v1l ^= v2l; v1h ^= v2h;
    t = v2l; v2l = v2h; v2h = t;
  }
  var ml, mh, i = 0;
  for (; i + 8 <= n; i += 8){
    ml = s.charCodeAt(i) | s.charCodeAt(i + 1) << 8 | s.charCodeAt(i + 2) << 16 | s.charCodeAt(i + 3) << 24;
    mh = s.charCodeAt(i + 4) | s.charCodeAt(i + 5) << 8 | s.charCodeAt(i + 6) << 16 | s.charCodeAt(i + 7) << 24;
    v3l ^= ml; v3h ^= mh; round(); round(); v0l ^= ml; v0h ^= mh;
  }
  ml = 0; mh = (n & 0xff) << 24;
  for (var j = 0; i + j < n; j++){ var c = s.charCodeAt(i + j); if (j < 4) ml |= c << (8 * j); else mh |= c << (8 * (j - 4)); }
  v3l ^= ml; v3h ^= mh; round(); round(); v0l ^= ml; v0h ^= mh;
  v2l ^= 0xff; round(); round(); round(); round();
  return [(v0h ^ v1h ^ v2h ^ v3h) >>> 0, (v0l ^ v1l ^ v2l ^ v3l) >>> 0];
}
// The reference's view of it: key and output as hex strings of their bytes in order (the output little-endian).
function siphash24(keyHex, msg){ var K = keyOf("k1:" + keyHex); if (!K) throw new Error("the key is 32 hex chars");
  var r = sip24(K, msg), out = "";
  [r[1], r[0]].forEach(function(w){ for (var i = 0; i < 4; i++) out += ("0" + ((w >>> (8 * i)) & 0xff).toString(16)).slice(-2); });
  return out; }
function hazards(seed){
  seed = String(seed == null ? "1" : seed);
  if (HZ[seed]) return HZ[seed];
  var K = keyOf(seed);
  // Each draw is a number in [0, 1) from the seed and a label; the top 53 bits of SipHash, or the mixed FNV-1a state.
  var u = K ? function(key){ var r = sip24(K, key); return (r[0] * 2097152 + (r[1] >>> 11)) / 9007199254740992; }
    : function(key){ var s = seed + "|" + key, h = 2166136261; for (var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return fmix(h) / 4294967296; };
  // Solar flares (radiation storms): odds per sky day come from a 27-day spell (one solar rotation); a storm lasts 4-48 h, mostly short.
  function flareOdds(day){ var a = u("spell|" + Math.floor(day / 27)); return a < 0.55 ? 0.05 : 0.25 + (a - 0.55) / 0.45 * 0.35; }
  function flareOn(day){ if (u("flare|" + day) >= flareOdds(day)) return null; var st = day + u("flare-at|" + day); return { start: st, end: st + (4 + 44 * Math.pow(u("flare-h|" + day), 2)) * HOUR }; }
  function flareAt(jd){ var d = Math.floor(jd); for (var k = 0; k < 3; k++){ var f = flareOn(d - k); if (f && jd >= f.start && jd < f.end) return f; } return null; }
  // Local weather. Mars dust storms: odds per 10-day block, a storm lasts 1-4 days. Titan haze: odds per day, 3-9 h.
  function wxOdds(place, jd){ var w = LOCAL[place]; if (!w) return 0;
    return w === "dust" ? 0.1 + 0.5 * u("dust-odds|" + Math.floor(jd / 10)) : 0.15 + 0.3 * u("haze-odds|" + Math.floor(jd)); }
  function wxOn(w, n){
    if (w === "dust"){ var o = 0.1 + 0.5 * u("dust-odds|" + n); if (u("dust|" + n) >= o) return null; var st = n * 10 + 9 * u("dust-at|" + n); return { kind: "dust_storm", start: st, end: st + 1 + 3 * u("dust-d|" + n) }; }
    var oh = 0.15 + 0.3 * u("haze-odds|" + n); if (u("haze|" + n) >= oh) return null; var sh = n + u("haze-at|" + n); return { kind: "titan_haze", start: sh, end: sh + (3 + 6 * u("haze-h|" + n)) * HOUR }; }
  function weatherAt(place, jd){ var w = LOCAL[place]; if (!w) return null; var n = Math.floor(w === "dust" ? jd / 10 : jd);
    for (var k = 0; k < 2; k++){ var x = wxOn(w, n - k); if (x && jd >= x.start && jd < x.end) return x; } return null; }
  // Pads: berths by kind; NPC dockings per hour (busier around a rush hail's ready time). rush: one rush, a list of
  // them (every booking on a flight), or null; overlapping rushes at a place count as the strongest, not multiplied.
  function berths(place){ var p = PID[place]; return BERTHS[p && p.kind] || 2; }
  function rate(place, n, rush){ var p = PID[place], r = TRAFFIC[place] != null ? TRAFFIC[place] : TRAFFIC_KIND[p && p.kind] || 0.1, x = null;
    [].concat(rush || []).forEach(function(q){ if (place === q.at && n >= q.from && n < q.to) x = x == null ? q.x : Math.max(x, q.x); });
    return x == null ? r : Math.min(0.9, r * x); }
  function docked(place, n, rush, scheduledOnly){ var c = 0;
    for (var m = n - 5; m <= n; m++){
      if (u("pad|" + place + "|" + m) >= rate(place, m, rush)) continue;
      if (m + 2 + Math.floor(5 * u("stay|" + place + "|" + m)) <= n) continue;
      if (scheduledOnly && u("sched|" + place + "|" + m) < UNSCHEDULED) continue;
      c++; }
    return c; }
  // Fleet competition: a car may still be finishing another (simulated) job when the hail comes in.
  function busyUntil(id, car, t0){ var h = BY[id], key = id + "|" + car + "|" + Math.round(t0 * 24);
    if (u("busy|" + key) >= 0.35) return null; var q = h.kind === "quick";
    return t0 + (q ? (2 + 22 * u("busy-h|" + key)) * HOUR : 5 + 55 * u("busy-d|" + key)); }
  function pickupStart(id, car, t0){ var b = busyUntil(id, car, t0); return b && b > t0 ? b : t0; }
  return HZ[seed] = { u: u, flareOdds: flareOdds, flareAt: flareAt, wxOdds: wxOdds, weatherAt: weatherAt, berths: berths, docked: docked, rate: rate, busyUntil: busyUntil, pickupStart: pickupStart };
}
var HZ = {}, PAR_WAITS = [];
[0, 3, 6, 12].forEach(function(a){ [0, 3, 6, 12].forEach(function(b){ PAR_WAITS.push([a, b]); }); });
// A rush: one place is busier for a while (a crew change, a conference). Hours from t0 - 12 h, for 24 h (or from `after` days).
function rushOf(h, t0){ if (!h.rush) return null; var a = Math.floor((t0 + (h.rush.after || 0)) * 24) - 12; return { at: h.rush.at, x: h.rush.x, from: a, to: a + 24 + (h.rush.after ? 72 : 0) }; }
// A flight sees the rush of every booking on it.
function rushes(ride){ return ride.hails.map(function(id){ return rushOf(BY[id], ride.t0); }).filter(Boolean); }
/* ---------- a ride in flight: a stepper that stops at checkpoints ----------
   A ride is plain JSON (the connector keeps it in a Durable Object between calls):
     legs, stops the dispatched plan (the fare and the plan are judged against these); hails: its bookings
     segs        what the car flies, in order. Each: role pickup|ride, kind planned|replan|divert|return, from, to,
                 dep_jd, arr_jd, kwh, gate, target (where this role must end up), stop (the stop it lands at),
                 and once flown flew: { dep_jd, orbit_jd, land_jd | left_jd }
     at          the cursor: { seg, phase: "depart"|"arrive"|"done", jd, waived?, hold? }
     pickups, arrivals   when each booking boarded and landed, by hail id; pickup_jd, ride_depart_jd and arrive_jd
                 are the flight's: first boarding, first departure with anyone aboard, last landing
     checkpoints every event that stopped the car, with its decision once made; pending is the open one's n
   start() and step() both return { ride, checkpoint } or { ride, done }. A decision is one of
   { action: "wait" } | { action: "replan", leg } | { action: "hold", hours? } | { action: "divert", place, wait_hours? }.
   The caller plans a replan leg, so the engine never re-flies anything here. */
var MAX_CHECKPOINTS = 8, ORACLE_DEPTH = 3;
var CAUSE = { dust_storm: "a dust storm closed the pad", titan_haze: "Titan haze closed the pad", solar_flare: "a solar flare grounded launches with a rider aboard", car_late: "the car reached the pad after the planned departure", pad_full: "every berth was taken" };
var EVENTS = {
  // An interplanetary leg can't leave on time. Local legs just wait, as they always have.
  launch_hold: { options: ["wait", "replan"], dflt: { action: "wait" }, apply: applyLaunch },
  // The pad at the end of a leg is closed or full once the car has held ask_after_hours in orbit.
  pad_closed: { options: ["hold", "divert"], dflt: { action: "hold" }, apply: applyPad }
};
function nameOf(id){ return PID[id] ? PID[id].name : id; }
function between(S){ return system(S.from) !== system(S.to); }
function seg(role, kind, L, target, stop){ return { role: role, kind: kind, from: L.from, to: L.to, dep_jd: L.dep_jd, arr_jd: L.arr_jd, kwh: L.kwh, gate: L.gate || null, target: target, stop: stop }; }
function asking(ride){ return ride.ask_after_hours != null && !ride.auto; }
function holdNote(why, cap){ return why === "pad_busy" ? "All " + cap + " berths were taken; the car held in orbit" : why === "dust_storm" ? "Dust storm closed the pad; the car held in orbit" : "Haze closed the pad; the car held in orbit"; }
function start(id, car, legs, t0, seed, opts){
  opts = opts || {};
  var after = opts.ask_after_hours === undefined ? 1 : opts.ask_after_hours === "never" ? null : opts.ask_after_hours;
  if (after != null && !(after >= 0 && after <= 24)) throw new Error("ask_after_hours must be 0 to 24 hours, or \"never\"");
  var plan = JSON.parse(JSON.stringify(planOf(id, car, legs))), M = manifest(plan);
  var ride = { v: 2, id: id, car: car, t0: t0, seed: String(seed == null ? "1" : seed), ask_after_hours: after, end_jd: opts.end_jd || E.EPHEM_RANGE[1] - 1,
    legs: plan.legs, stops: plan.stops, hails: M.hails, segs: plan.legs.map(function(L, i){ return seg(M.roles[i], "planned", L, L.to, i + 1); }),
    at: { seg: 0, phase: "depart", jd: plan.legs[0].dep_jd }, extra_kwh: 0, incidents: [], pickup_jd: null, ride_depart_jd: null, arrive_jd: null, pickups: {}, arrivals: {},
    checkpoints: [], pending: null, auto: false, capped: false };
  return advance(ride);
}
// A v1 ride (stored before stops existed) is a one-booking flight: pickup segs land at stop 1, ride segs at stop 2.
function upgrade(ride){
  if (ride.v >= 2) return ride;
  var plan = planOf(ride.id, ride.car, ride.legs);
  ride.v = 2; ride.stops = plan.stops; ride.hails = [ride.id]; ride.pickups = {}; ride.arrivals = {};
  if (ride.pickup_jd != null) ride.pickups[ride.id] = ride.pickup_jd;
  if (ride.arrive_jd != null) ride.arrivals[ride.id] = ride.arrive_jd;
  ride.segs.forEach(function(S){ S.stop = S.role === "pickup" ? 1 : 2; });
  return ride;
}
function step(ride, decision){
  ride = upgrade(JSON.parse(JSON.stringify(ride)));
  if (!ride.pending) throw new Error("this ride has no open checkpoint");
  var cp = ride.checkpoints[ride.pending - 1], ev = EVENTS[cp.kind];
  decision = decision || ev.dflt;
  if (ev.options.indexOf(decision.action) < 0) throw new Error("a " + cp.kind + " checkpoint takes " + ev.options.join(" or ") + ", not " + decision.action);
  cp.decision = ev.apply(ride, cp, decision);
  ride.pending = null;
  return advance(ride);
}
function advance(ride){
  for (var guard = 0; guard < 500; guard++){
    var cp = ride.at.phase === "depart" ? departPhase(ride) : arrivePhase(ride);
    if (cp){ ride.checkpoints.push(cp); ride.pending = cp.n; return { ride: ride, checkpoint: cp }; }
    if (ride.at.phase === "done") return { ride: ride, done: outcome(ride) };
  }
  throw new Error("the ride did not finish");
}
// Fires a checkpoint, or past the cap applies the default and says so. Returns the checkpoint or null.
function ask(ride, kind, cause, place, T){
  if (ride.checkpoints.length < MAX_CHECKPOINTS) return checkpoint(ride, kind, cause, place, T);
  var S = ride.segs[ride.at.seg];
  if (!ride.capped) ride.incidents.push({ kind: "checkpoint_cap", leg: S.role, where: place, at_jd: T, hours: 0, kwh: 0,
    note: "This ride reached " + MAX_CHECKPOINTS + " checkpoints, so from here the car followed the defaults: wait for a launch, hold for a pad" });
  ride.capped = true;
  return null;
}
function departPhase(ride){
  var H = hazards(ride.seed), at = ride.at, S = ride.segs[at.seg], jd = at.jd;
  if (S.kind === "divert"){ S.flew = { dep_jd: jd }; return toOrbit(ride, S.arr_jd + (jd - S.dep_jd)); } // leaves from orbit at once
  if (between(S) && asking(ride) && !ride.capped && !at.waived){
    var w = H.weatherAt(S.from, jd), f = S.role === "ride" ? H.flareAt(jd) : null;
    if (w || f || jd - S.dep_jd > 1e-6){
      var cp = ask(ride, "launch_hold", w ? w.kind : f ? "solar_flare" : "car_late", S.from, jd);
      if (cp) return cp;
    }
  }
  // Hold on the ground (no extra energy) until the pad's weather opens and, with a rider aboard, until any flare ends.
  for (var i = 0; i < 400; i++){
    var w2 = H.weatherAt(S.from, jd), f2 = S.role === "ride" ? H.flareAt(jd) : null;
    if (!w2 && !f2) break;
    var until = Math.max(w2 ? w2.end : 0, f2 ? f2.end : 0);
    ride.incidents.push({ kind: w2 ? w2.kind : "flare", leg: S.role, where: S.from, at_jd: jd, hours: (until - jd) * 24,
      kwh: 0, note: w2 ? (w2.kind === "dust_storm" ? "Dust storm closed the pad; the car waited on the ground" : "Haze closed the pad; the car waited on the ground")
        : "Solar flare: no launches with a rider aboard until it passed" });
    jd = until; }
  // Delays to a leg between planets mean a correction burn: 2% of the leg's energy per hour late, up to 30%.
  var shift = jd - S.dep_jd;
  if (shift > 1e-6 && between(S)){
    var kwh = Math.round(S.kwh * Math.min(0.3, 0.02 * shift * 24));
    if (kwh > 0) ride.incidents.push({ kind: "correction_burn", leg: S.role, where: S.from, at_jd: S.dep_jd + shift, hours: 0, kwh: kwh, note: "Left " + (shift * 24).toFixed(1) + " h late, so the car burned extra to correct the transfer" });
    ride.extra_kwh += kwh; }
  S.flew = { dep_jd: jd };
  if (S.role === "ride" && (S.kind === "planned" || S.kind === "replan") && ride.ride_depart_jd == null) ride.ride_depart_jd = jd;
  return toOrbit(ride, S.arr_jd + shift);
}
function toOrbit(ride, jd){
  ride.segs[ride.at.seg].flew.orbit_jd = jd;
  ride.at = { seg: ride.at.seg, phase: "arrive", jd: jd, hold: { start: jd, booked: jd, jd: jd, iter: 0, why: null, stop: asking(ride) ? jd + ride.ask_after_hours * HOUR : null } };
  return null;
}
// Book the orbit hold since the last booking (250 kWh an hour) as one incident.
function bookHold(ride, S, T){
  var hd = ride.at.hold, place = S.to;
  if (T > hd.booked + 1e-9){ var hrs = (T - hd.booked) * 24, kwh = Math.round(hrs * HOLD_KWH); ride.extra_kwh += kwh;
    ride.incidents.push({ kind: hd.why, leg: S.role, where: place, at_jd: hd.booked, hours: hrs, kwh: kwh, note: holdNote(hd.why, hazards(ride.seed).berths(place)) }); }
  hd.booked = T;
}
function closedAt(ride, place, T){
  var H = hazards(ride.seed), w = H.weatherAt(place, T);
  return w ? w.kind : H.docked(place, Math.floor(T * 24), rushes(ride)) >= H.berths(place) ? "pad_full" : null;
}
// On arrival, hold in orbit until a berth is free and the weather is open, asking once the car has held ask_after_hours.
function arrivePhase(ride){
  var H = hazards(ride.seed), rush = rushes(ride), at = ride.at, S = ride.segs[at.seg], hd = at.hold, place = S.to, cap = H.berths(place);
  for (; hd.iter < MAX_HOLD_H; hd.iter++){
    var jd = hd.jd, w = H.weatherAt(place, jd), full = H.docked(place, Math.floor(jd * 24), rush) >= cap;
    if (!w && !full) break;
    hd.why = hd.why || (w ? w.kind : "pad_busy");
    var next = w ? Math.max(jd + HOUR, Math.min(w.end, jd + MAX_HOLD_H * HOUR)) : (Math.floor(jd * 24) + 1) / 24, capped = (next - hd.start) * 24 >= MAX_HOLD_H;
    if (capped) next = hd.start + MAX_HOLD_H * HOUR;
    if (hd.stop != null && next > hd.stop + 1e-9 && asking(ride) && !ride.capped){
      var cause = closedAt(ride, place, hd.stop);
      if (!cause) hd.stop = next; // open at the ask time but the car is mid-step: ask at its next look if still closed
      else { var T = hd.stop; bookHold(ride, S, T); var cp = ask(ride, "pad_closed", cause, place, T); if (cp) return cp; hd.stop = null; }
    }
    hd.jd = next;
    if (capped){ hd.iter++; break; }
  }
  var land = hd.jd;
  bookHold(ride, S, land);
  S.flew.land_jd = land;
  // At its stop (not a divert's alternate): everyone named there boards or alights now.
  var stop = S.to === S.target ? ride.stops[S.stop] : null, boarding = !!(stop && stop.board && stop.board.length);
  if (stop){
    (stop.board || []).forEach(function(id){ ride.pickups[id] = land; });
    (stop.alight || []).forEach(function(id){ ride.arrivals[id] = land; });
    if (boarding && ride.pickup_jd == null) ride.pickup_jd = land;
  }
  var nx = at.seg + 1, N = ride.segs[nx];
  if (!N){ ride.arrive_jd = land; ride.at = { seg: at.seg, phase: "done", jd: land }; return null; }
  var ready = N.dep_jd;
  if (N.kind === "return"){
    ready = land + N.wait_hours * HOUR;
    var b = planned(N.from, N.to, ready, "energy", ride.end_jd);
    N.dep_jd = b.dep_jd; N.arr_jd = b.arr_jd; N.kwh = b.battery.energy_kwh;
    ready = N.dep_jd;
  } else if (boarding) ready = Math.max(N.dep_jd, land + DWELL);
  ride.at = { seg: nx, phase: "depart", jd: ready };
  return null;
}
function usedSoFar(ride){ return ride.segs.reduce(function(a, s){ return a + (s.flew ? s.kwh : 0); }, 0) + ride.extra_kwh; }
// Local alternates for a closed pad: other stations and moons in the same neighbourhood, priced as a hop from orbit.
function alternates(ride, place, target, T){
  var H = hazards(ride.seed), rush = rushes(ride), out = [];
  E.PLACES.forEach(function(p){
    if (p.id === place || p.id === target || (p.kind !== "moon" && p.kind !== "station") || system(p.id) !== system(place)) return;
    try { var b = planned(place, p.id, T, "energy", ride.end_jd);
      out.push({ place: p.id, name: p.name, hop_kwh: b.battery.energy_kwh, hop_hours: Math.round((b.arr_jd - b.dep_jd) * 240) / 10, berths: H.berths(p.id), booked_now: H.docked(p.id, Math.floor(T * 24), rush, true) });
    } catch (e) {}
  });
  return out.sort(function(a, b){ return a.hop_kwh - b.hop_kwh || (a.name < b.name ? -1 : 1); }).slice(0, 5);
}
function checkpoint(ride, kind, cause, place, T){
  var S = ride.segs[ride.at.seg], ref = ride.legs[S.stop - 1], launch = kind === "launch_hold";
  var held = launch ? 0 : (T - ride.at.hold.start) * 24, options;
  if (launch){
    var late = Math.max(0, T - S.dep_jd);
    options = [
      { action: "wait", leg_kwh: S.kwh, correction_pct_per_hour_late: 2, correction_cap_pct: 30, correction_kwh_if_it_left_now: Math.round(S.kwh * Math.min(0.3, 0.02 * late * 24)),
        note: "Wait until the launch is clear, then fly this leg late; the correction burn grows with every hour late" },
      { action: "replan", note: "Plan a fresh leg from " + nameOf(S.from) + " to " + nameOf(S.to) + " departing at or after " + iso(T) + "; it counts as a plan" }];
  } else {
    options = [{ action: "hold", kwh_per_hour: HOLD_KWH, held_hours: held, max_hold_hours_left: Math.max(0, MAX_HOLD_H - held),
      note: "Hold in orbit until the pad opens (or for the hours you give, then ask again)" }];
    var alts = alternates(ride, place, S.target, T);
    if (alts.length) options.push({ action: "divert", alternates: alts,
      note: "Hop to another pad, land, wait on the ground for free for wait_hours, then hop back" + (S.kind !== "divert" && between(S) ? "; priced as a local hop from " + nameOf(place) + "'s orbit" : "") });
  }
  return { n: ride.checkpoints.length + 1, kind: kind, cause: cause, why: CAUSE[cause], place: place, place_name: nameOf(place), leg: S.role, sky_at: T,
    held_hours: held, car: (launch ? "on the pad at " : "holding in orbit at ") + nameOf(place), rider_aboard: S.role === "ride",
    extra_kwh: ride.extra_kwh, used_kwh: usedSoFar(ride), behind_plan_hours: (T - (launch ? ref.dep_jd : ref.arr_jd)) * 24,
    options: options, default: EVENTS[kind].dflt, decision: null };
}
function applyLaunch(ride, cp, d){
  if (d.action === "wait"){ ride.at.waived = true; return { action: "wait" }; }
  var S = ride.segs[ride.at.seg], L = d.leg;
  if (!L || L.from !== S.from || L.to !== S.to) throw new Error("a replan must go from " + nameOf(S.from) + " to " + nameOf(S.to));
  if (!(L.dep_jd >= cp.sky_at - 1e-9) || !(L.arr_jd > L.dep_jd) || !isFinite(L.kwh)) throw new Error("a replan must depart at or after " + iso(cp.sky_at));
  if (L.dep_jd > cp.sky_at + 1e-9) ride.incidents.push({ kind: "replanned", leg: S.role, where: S.from, at_jd: cp.sky_at, hours: (L.dep_jd - cp.sky_at) * 24, kwh: 0,
    note: "Because " + CAUSE[cp.cause] + ", the car waited on the ground and left on a new plan" });
  var leg = { from: L.from, to: L.to, dep_jd: L.dep_jd, arr_jd: L.arr_jd, kwh: L.kwh, fare: L.fare, gate: L.gate || null };
  ride.segs[ride.at.seg] = seg(S.role, "replan", leg, S.target, S.stop);
  ride.at = { seg: ride.at.seg, phase: "depart", jd: leg.dep_jd };
  return { action: "replan", leg: leg };
}
function applyPad(ride, cp, d){
  var hd = ride.at.hold;
  if (d.action === "hold"){
    if (d.hours == null){ hd.stop = null; return { action: "hold" }; }
    var hrs = +d.hours;
    if (!(hrs > 0 && hrs <= MAX_HOLD_H)) throw new Error("hold hours must be more than 0 and at most " + MAX_HOLD_H);
    hd.stop = cp.sky_at + hrs * HOUR; return { action: "hold", hours: hrs };
  }
  var div = cp.options.filter(function(o){ return o.action === "divert"; })[0], alt = div && div.alternates.filter(function(a){ return a.place === d.place; })[0];
  if (!alt) throw new Error("divert to one of: " + (div ? div.alternates.map(function(a){ return a.place; }).join(", ") : "nowhere (no local alternates)"));
  var wait = d.wait_hours == null ? 0 : +d.wait_hours;
  if (!(wait >= 0 && wait <= MAX_HOLD_H)) throw new Error("wait_hours must be 0 to " + MAX_HOLD_H);
  var S = ride.segs[ride.at.seg], T = cp.sky_at, b = planned(S.to, alt.place, T, "energy", ride.end_jd);
  S.flew.left_jd = T;
  var hop = seg(S.role, "divert", { from: S.to, to: alt.place, dep_jd: b.dep_jd, arr_jd: b.arr_jd, kwh: b.battery.energy_kwh, gate: "local" }, S.target, S.stop);
  var back = { role: S.role, kind: "return", from: alt.place, to: S.target, dep_jd: null, arr_jd: null, kwh: 0, gate: "local", target: S.target, stop: S.stop, wait_hours: wait };
  var nx = ride.at.seg + 1, N = ride.segs[nx];
  ride.segs.splice(nx, N && N.kind === "return" && N.from === S.to ? 1 : 0, hop, back);
  ride.incidents.push({ kind: "divert", leg: S.role, where: S.to, at_jd: T, hours: 0, kwh: 0,
    note: "Because " + CAUSE[cp.cause] + ", the car diverted to " + alt.name + " (" + k(hop.kwh) + " kWh hop), to wait " + (Math.round(wait * 10) / 10) + " h on the ground and hop back" });
  ride.at = { seg: nx, phase: "depart", jd: T };
  return { action: "divert", place: alt.place, wait_hours: wait };
}
function outcome(ride){
  var r = ride.legs[ride.legs.length - 1], flown = ride.segs.filter(function(s){ return s.flew; });
  return { pickup_jd: ride.pickup_jd, ride_depart_jd: ride.ride_depart_jd, arrive_jd: ride.arrive_jd, planned_kwh: ride.legs.reduce(function(a, l){ return a + l.kwh; }, 0),
    extra_kwh: ride.extra_kwh, used_kwh: usedSoFar(ride), incidents: ride.incidents, delay_hours: (ride.arrive_jd - r.arr_jd) * 24,
    divert_kwh: flown.reduce(function(a, s){ return a + (s.kind === "divert" || s.kind === "return" ? s.kwh : 0); }, 0),
    segments: flown.map(function(s){ return { role: s.role, kind: s.kind, from: s.from, to: s.to, dep_jd: s.flew.dep_jd, arr_jd: s.flew.land_jd != null ? s.flew.land_jd : s.flew.left_jd, kwh: s.kwh, gate: s.gate }; }),
    checkpoints: ride.checkpoints, bookings: bookingsOf(ride) };
}
function bookingsOf(ride){ var out = {};
  ride.hails.forEach(function(id){ out[id] = { pickup_jd: ride.pickups[id] == null ? null : ride.pickups[id], arrive_jd: ride.arrivals[id] == null ? null : ride.arrivals[id] }; });
  return out; }
// What actually happens when a dispatch flies with nobody to ask: every checkpoint takes its default.
// A one-booking flight keeps these eight keys (fixtures/fly-baseline.json pins them); a shared one adds bookings.
function fly(id, car, legs, t0, seed){
  var o = start(id, car, legs, t0, seed, { ask_after_hours: null }).done;
  var F = { pickup_jd: o.pickup_jd, ride_depart_jd: o.ride_depart_jd, arrive_jd: o.arrive_jd, planned_kwh: o.planned_kwh, extra_kwh: o.extra_kwh, used_kwh: o.used_kwh, incidents: o.incidents,
    delay_hours: o.delay_hours };
  if (Object.keys(o.bookings).length > 1) F.bookings = o.bookings;
  return F;
}
// With hindsight: what each choice at a checkpoint could be. A replan leaves when the hold really ends;
// a divert waits at the alternate so it lands back as the closed pad reopens (at once if the pad was only full).
function hindsight(ride, cp){
  var H = hazards(ride.seed), S = ride.segs[ride.at.seg], out = [];
  if (cp.kind === "launch_hold"){
    out.push({ action: "wait" });
    var jd = cp.sky_at;
    for (var i = 0; i < 400; i++){ var w = H.weatherAt(S.from, jd), f = S.role === "ride" ? H.flareAt(jd) : null; if (!w && !f) break; jd = Math.max(w ? w.end : 0, f ? f.end : 0); }
    try { var b = planned(S.from, S.to, jd, "energy", ride.end_jd); out.push({ action: "replan", depart_after: jd, leg: slim(b, S.from, S.to) }); } catch (e) {}
    return out;
  }
  out.push({ action: "hold" });
  var open = cp.sky_at;
  for (var j = 0; j < 50; j++){ var x = H.weatherAt(cp.place, open); if (!x) break; open = x.end; }
  var div = cp.options.filter(function(o){ return o.action === "divert"; })[0];
  (div ? div.alternates : []).forEach(function(a){
    out.push({ action: "divert", place: a.place, wait_hours: Math.max(0, Math.round(((open - cp.sky_at) * 24 - 2 * a.hop_hours) * 100) / 100) }); });
  return out;
}
function label(d){
  return d.action === "wait" ? "wait" : d.action === "replan" ? "replan, leaving " + iso(d.leg.dep_jd) : d.action === "hold" ? (d.hours != null ? "hold " + d.hours + " h" : "hold until open")
    : "divert to " + nameOf(d.place) + ", wait " + (Math.round(d.wait_hours * 10) / 10) + " h"; }
function better(a, b){ return !b || a.used_kwh < b.used_kwh - 1e-9 || (Math.abs(a.used_kwh - b.used_kwh) <= 1e-9 && a.arrive_jd < b.arrive_jd); }
// Fly the rest of the ride on defaults, with no more checkpoints.
function finish(st){ while (!st.done){ st.ride.auto = true; st = step(st.ride, null); } return st.done; }
// Par's flyer: tries every hindsight choice at the first ORACLE_DEPTH checkpoints (defaults after), and flying with
// no checkpoints at all; keeps the least energy, then the earliest arrival.
function oracle(id, car, legs, t0, seed, endJd){
  var best = null;
  function keep(o, path, decisions){ if (better(o, best)) best = { used_kwh: o.used_kwh, planned_kwh: o.planned_kwh, arrive_jd: o.arrive_jd, path: path, decisions: decisions, outcome: o }; }
  keep(start(id, car, legs, t0, seed, { ask_after_hours: null, end_jd: endJd }).done, [], []);
  (function explore(st, depth, path, decisions){
    if (st.done) return keep(st.done, path, decisions);
    if (depth >= ORACLE_DEPTH) return keep(finish(st), path, decisions);
    hindsight(st.ride, st.checkpoint).forEach(function(d){
      try { explore(step(st.ride, d), depth + 1, path.concat([label(d)]), decisions.concat([d])); } catch (e) {} });
  })(start(id, car, legs, t0, seed, { ask_after_hours: 0, end_jd: endJd }), 0, [], []);
  return best;
}
// For a finished (or stopped) ride: at each decided checkpoint, what every hindsight choice would have led to
// (defaults after it), and the best of them.
function regret(ride){
  var plan = ride.stops ? { stops: ride.stops, legs: ride.legs } : ride.legs;
  var out = [], st = start(ride.id, ride.car, plan, ride.t0, ride.seed, { ask_after_hours: ride.ask_after_hours, end_jd: ride.end_jd });
  for (var i = 0; i < ride.checkpoints.length && st.checkpoint && ride.checkpoints[i].decision; i++){
    var cp = st.checkpoint, rows = [];
    hindsight(st.ride, cp).forEach(function(d){
      try { var o = finish(step(st.ride, d)); rows.push({ option: label(d), decision: d, used_kwh: o.used_kwh, arrive_jd: o.arrive_jd }); } catch (e) {} });
    var best = rows.reduce(function(b, r){ return better(r, b) ? r : b; }, null);
    out.push({ n: cp.n, options: rows, best: best ? best.option : null });
    st = step(st.ride, ride.checkpoints[i].decision);
  }
  return out;
}
// Forecasts, which is all a dispatcher sees: booked berths per hour (unscheduled traffic is not shown), weather odds.
function padForecast(place, fromJd, hours, id, t0, seed){
  var H = hazards(seed), h = id && BY[id], rush = h ? rushOf(h, t0) : null, n0 = Math.floor(fromJd * 24), out = [];
  hours = Math.max(1, Math.min(72, Math.round(hours || 24)));
  for (var n = n0; n < n0 + hours; n++) out.push({ hour_jd: n / 24, booked: H.docked(place, n, rush, true) });
  return { place: place, berths: H.berths(place), hours: out, unscheduled_share: UNSCHEDULED, local_weather: LOCAL[place] || null }; }
function flareForecast(fromJd, days, seed){ var H = hazards(seed), d0 = Math.floor(fromJd), out = [];
  days = Math.max(1, Math.min(60, Math.round(days || 10)));
  for (var d = d0; d < d0 + days; d++) out.push({ day_jd: d, flare_odds: Math.round(H.flareOdds(d) * 100) / 100 }); return out; }
function weatherForecast(place, fromJd, days, seed){ var H = hazards(seed), w = LOCAL[place], out = [];
  if (!w) return { place: place, kind: null, days: [] }; days = Math.max(1, Math.min(60, Math.round(days || 10)));
  for (var d = Math.floor(fromJd); d < Math.floor(fromJd) + days; d++) out.push({ day_jd: d, odds: Math.round(H.wxOdds(place, d) * 100) / 100 });
  return { place: place, kind: w === "dust" ? "dust_storm" : "titan_haze", odds_are: w === "dust" ? "chance a storm starts somewhere in this 10-day block" : "chance of a haze spell that day", days: out }; }
function fleetState(id, t0, seed){ var H = hazards(seed);
  return FLEET.map(function(c){ var b = H.busyUntil(id, c.id, t0); return { car: c.id, name: c.name, at: c.at, busy_until_jd: b }; }); }
function pickupStart(id, car, t0, seed){ return hazards(seed).pickupStart(id, car, t0); }

function planLeg(from, to, departAfter, objective, endJd){
  if (from === to) throw new Error("that leg would start and end at the same place");
  var b = E.planRide({ place: from }, to, { depFrom: departAfter, depTo: departAfter + WINDOW, arriveBy: endJd, objective: objective === "time" ? "time" : "energy", allLocal: true });
  if (!b || b.error) throw new Error((b && b.error) || "no route from " + from + " to " + to);
  return b;
}
// The same plan, remembered: par's hindsight search asks for the same hops and replans many times. Read-only results.
var MEMO = new Map();
function planned(from, to, departAfter, objective, endJd){
  var key = from + "|" + to + "|" + departAfter + "|" + objective + "|" + endJd;
  if (MEMO.has(key)){ var hit = MEMO.get(key); if (hit instanceof Error) throw hit; return hit; }
  if (MEMO.size > 4000) MEMO.clear();
  try { var b = planLeg(from, to, departAfter, objective, endJd); MEMO.set(key, b); return b; } catch (e) { MEMO.set(key, e); throw e; }
}
function slim(b, from, to){ return { from: from, to: to, dep_jd: b.dep_jd, arr_jd: b.arr_jd, kwh: b.battery.energy_kwh, fare: b.fare.total_usd }; }

// Par: for every nearby car, pickup and ride each planned for least energy, leaving as soon as the car is free,
// flown through the season's hazards, and with hindsight at the first checkpoints (oracle).
// best_wait: the earliest any nearby car actually reaches the rider (pickup planned for time).
function par(id, t0, endJd, seed){
  var h = BY[id], H = hazards(seed), best = null, wait = null;
  nearCars(h).forEach(function(c){
    var st = H.pickupStart(id, c.id, t0);
    // Quick hails: par may also wait on the ground (pickup and ride each 0-12 h) to dodge forecast trouble.
    (h.kind === "quick" ? PAR_WAITS : [[0, 0]]).forEach(function(w){
      try {
        var p = planned(c.at, h.from, st + w[0] * HOUR, "energy", endJd), P = slim(p, c.at, h.from);
        var pk = fly(id, c.id, [P, { from: h.from, to: h.from, dep_jd: p.arr_jd + DWELL, arr_jd: p.arr_jd + DWELL, kwh: 0 }], t0, seed).pickup_jd;
        var r = planned(h.from, h.to, Math.max(p.arr_jd, pk) + DWELL + w[1] * HOUR, "energy", endJd), Rr = slim(r, h.from, h.to), legs = [P, Rr], F = fly(id, c.id, legs, t0, seed);
        if (!best || F.used_kwh < best.kwh - 1e-9) best = { car: c.id, kwh: F.used_kwh, planned_kwh: F.planned_kwh, arr_jd: F.arrive_jd, planned_arr_jd: r.arr_jd, legs: legs, wait_h: w, path: [] };
        // Holds and corrections only add energy, so a local ride planned above the best can't win; a replan or divert might.
        if (legs.some(function(L){ return system(L.from) !== system(L.to); }) || F.planned_kwh < best.kwh - 1e-9){
          var O = oracle(id, c.id, legs, t0, seed, endJd);
          if (O.used_kwh < best.kwh - 1e-9) best = { car: c.id, kwh: O.used_kwh, planned_kwh: O.planned_kwh, arr_jd: O.arrive_jd, planned_arr_jd: r.arr_jd, legs: legs, wait_h: w, path: O.path };
        }
      } catch (e) {}
    });
    try {
      var q = planLeg(c.at, h.from, st, "time", endJd), Q = slim(q, c.at, h.from);
      // a stub ride leg (no time cost) to fly the pickup alone
      var G = fly(id, c.id, [Q, { from: h.from, to: h.from, dep_jd: q.arr_jd + DWELL, arr_jd: q.arr_jd + DWELL, kwh: 0 }], t0, seed);
      if (!wait || G.pickup_jd < wait.arr_jd) wait = { car: c.id, arr_jd: G.pickup_jd };
    } catch (e) {}
  });
  if (!best) throw new Error("no car can serve " + h.title);
  return { car: best.car, kwh: best.kwh, planned_kwh: best.planned_kwh, arr_jd: best.arr_jd, planned_arr_jd: best.planned_arr_jd, legs: best.legs, wait_hours: best.wait_h || [0, 0],
    choices: best.path, best_wait_days: wait ? Math.max(1e-6, wait.arr_jd - t0) : 1e-6, best_wait_car: wait ? wait.car : best.car };
}
// What the dispatcher is told when it takes the hail: when the rider is ready and when they must arrive.
function terms(id, t0, endJd, seed){
  var p = par(id, t0, endJd, seed);
  return { hail: id, t0: t0, arrive_by_jd: arriveBy(p, t0, endJd), par: p };
}
function arriveBy(p, t0, endJd){ return Math.min(endJd, t0 + Math.ceil((p.planned_arr_jd - t0) * 1.5 + 1)); }

/* ---------- par for a set of bookings (docs/SHARED-FLIGHTS.md, build-order item 2) ----------
   Most bookings in one set: a placeholder until Alvin sets it (open number 3); 3 bookings give 90 stop orders. */
var MAX_BOOKINGS = 3;
// Every order of stops that boards each booking before it lands it; events at the same place in a row are one stop.
function stopOrders(ids){
  var out = [], seen = {};
  (function walk(seq, aboard, done){
    if (done.length === ids.length){
      var stops = [];
      seq.forEach(function(e){ var at = e.board ? BY[e.id].from : BY[e.id].to, s = stops[stops.length - 1];
        if (!s || s.at !== at) stops.push(s = { at: at, board: [], alight: [] });
        s[e.board ? "board" : "alight"].push(e.id); });
      var key = JSON.stringify(stops.map(function(s){ return [s.at, s.board.slice().sort(), s.alight.slice().sort()]; }));
      if (!seen[key]){ seen[key] = 1; out.push(stops); }
      return;
    }
    ids.forEach(function(id){
      if (aboard.indexOf(id) < 0 && done.indexOf(id) < 0) walk(seq.concat([{ id: id, board: true }]), aboard.concat([id]), done);
      else if (aboard.indexOf(id) >= 0) walk(seq.concat([{ id: id, board: false }]), aboard.filter(function(x){ return x !== id; }), done.concat([id]));
    });
  })([], [], []);
  return out;
}
// Par for a set: the best pooled flight and the split baseline, each booking on its own ship.
// Pooled: for every ship near any booking with enough seats and every stop order, each leg planned for least energy
// once the car has really landed at the stop before it (and DWELL after a boarding), flown through the season's
// hazards, with hindsight (oracle) as in par. No ground waits, unlike a quick hail's par.
// Split: the sum of each booking's own par, even when two of them want the same ship, so it is a floor the pool has to beat.
// The first id is the lead booking: it keys every ship's busy time, as the id a dispatcher passes to check does.
function parSet(ids, t0, endJd, seed){
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_BOOKINGS) throw new Error("a set is 1 to " + MAX_BOOKINGS + " bookings");
  ids.forEach(function(id, i){ if (!BY[id]) throw new Error("unknown hail " + id); if (ids.indexOf(id) !== i) throw new Error(id + " is in the set twice"); });
  var lead = ids[0], H = hazards(seed), orders = stopOrders(ids), best = null, cars = [];
  ids.forEach(function(id){ nearCars(BY[id]).forEach(function(c){ if (cars.indexOf(c) < 0) cars.push(c); }); });
  cars.forEach(function(c){
    var st = H.pickupStart(lead, c.id, t0);
    orders.forEach(function(order){
      var stops = [{ at: c.at }].concat(order), plan = { stops: stops, legs: [] }, M = manifest({ stops: stops, legs: [] }), F = null;
      if (Math.max.apply(null, M.party) > c.seats) return;
      try {
        for (var i = 0, after = st; i < order.length; i++){
          var b = planned(stops[i].at, stops[i + 1].at, after, "energy", endJd);
          plan.legs.push(slim(b, stops[i].at, stops[i + 1].at));
          F = fly(lead, c.id, { stops: stops.slice(0, i + 2), legs: plan.legs }, t0, seed);
          after = Math.max(b.arr_jd, F.arrive_jd) + (stops[i + 1].board.length ? DWELL : 0);
        }
      } catch (e) { return; }
      var row = function(o, path){ return { car: c.id, kwh: o.used_kwh, planned_kwh: o.planned_kwh, arr_jd: o.arrive_jd, plan: plan, choices: path,
        arrivals: ids.reduce(function(a, id){ a[id] = (o.bookings || {})[id] ? o.bookings[id].arrive_jd : o.arrive_jd; return a; }, {}) }; };
      if (!best || F.used_kwh < best.kwh - 1e-9) best = row(F, []);
      // Holds and corrections only add energy, so a local plan planned above the best can't win; a replan or divert might.
      if (plan.legs.some(function(L){ return system(L.from) !== system(L.to); }) || F.planned_kwh < best.kwh - 1e-9){
        var O = oracle(lead, c.id, plan, t0, seed, endJd);
        if (O.used_kwh < best.kwh - 1e-9) best = row(O.outcome, O.path);
      }
    });
  });
  var solo = {}; ids.forEach(function(id){ solo[id] = par(id, t0, endJd, seed); });
  var split = { kwh: ids.reduce(function(a, id){ return a + solo[id].kwh; }, 0), bookings: solo };
  return { hails: ids, kwh: best ? Math.min(best.kwh, split.kwh) : split.kwh, pool_wins: !!best && best.kwh < split.kwh - 1e-9, pooled: best, split: split };
}
// Terms for a set: each booking keeps the terms it would have alone (ready at t0, its own arrive-by and best wait),
// so pooling never loosens a deadline; a detour shows up in the on-time part (open number 6: no detour limit).
// The rows are score's ctx.bookings; par_kwh for a pooled flight is par.pooled.kwh.
function termsSet(ids, t0, endJd, seed){
  var p = parSet(ids, t0, endJd, seed), bookings = {};
  ids.forEach(function(id){ var s = p.split.bookings[id]; bookings[id] = { t0: t0, arrive_by_jd: arriveBy(s, t0, endJd), best_wait_days: s.best_wait_days }; });
  return { hails: ids, t0: t0, bookings: bookings, par: p };
}
// A dispatch is a car plus a flight plan: today's two legs [pickup, ride], or { stops, legs } for a shared flight.
// id is the booking the dispatcher took (it keys the car's busy time) and must be on the plan.
// Returns a list of problems (empty = flyable). A one-booking plan gets the wording riders have always seen.
function check(id, car, legs, t0, seed){
  var c = CAR[car], errs = [];
  if (!c) return ["unknown car " + car];
  if (Array.isArray(legs) && legs.length !== 2) return ["a dispatch is two legs: the pickup, then the ride"];
  if (!legs || (!Array.isArray(legs) && !(Array.isArray(legs.stops) && Array.isArray(legs.legs)))) return ["a dispatch is two legs [pickup, ride] or a plan { stops, legs }"];
  var plan = planOf(id, car, legs), S = plan.stops, L = plan.legs, M = manifest(plan), one = M.hails.length === 1 && L.length === 2;
  if (L.length !== S.length - 1) return ["a plan with " + S.length + " stops has " + (S.length - 1) + " legs, not " + L.length];
  function legName(i){ return one ? (i ? "the ride" : "the pickup") : "leg " + (i + 1) + " (" + M.roles[i] + ")"; }
  function who(ids){ return one ? "the rider" : ids.join(" and "); }
  if (S[0].at !== c.at) errs.push("the plan must start where " + c.name + " is parked, " + nameOf(c.at));
  L.forEach(function(x, i){
    var badFrom = x.from !== S[i].at, badTo = x.to !== S[i + 1].at;
    if (one && i === 1){ if (badFrom || badTo) errs.push("the ride must go from the rider to their destination"); return; }
    if (badFrom) errs.push(i ? legName(i) + " must leave from " + nameOf(S[i].at) + ", where " + legName(i - 1) + " lands" : "the pickup must leave where " + c.name + " is parked");
    if (badTo) errs.push(one ? "the pickup must end where the rider is" : legName(i) + " must end at " + nameOf(S[i + 1].at) + ", stop " + (i + 1));
  });
  M.hails.forEach(function(b){
    var h = BY[b], at = M.stop[b];
    if (!h){ errs.push("unknown hail " + b); return; }
    if (at.board.length !== 1) errs.push(b + (at.board.length ? " boards " + at.board.length + " times" : " never boards"));
    if (at.alight.length !== 1) errs.push(b + (at.alight.length ? " alights " + at.alight.length + " times" : " never alights"));
    if (at.board.length && at.alight.length && at.alight[0] <= at.board[0]) errs.push(b + " alights before boarding");
    at.board.forEach(function(n){ if (S[n].at !== h.from) errs.push(b + " must board at " + nameOf(h.from) + ", not " + nameOf(S[n].at)); });
    at.alight.forEach(function(n){ if (S[n].at !== h.to) errs.push(b + " must alight at " + nameOf(h.to) + ", not " + nameOf(S[n].at)); });
  });
  if (M.hails.indexOf(id) < 0) errs.push(id + " is not on this plan");
  S.forEach(function(s, n){
    if (n && !(s.board || []).length && !(s.alight || []).length) errs.push("stop " + n + " (" + nameOf(s.at) + ") has nobody boarding or alighting");
    if (M.party[n] > c.seats) errs.push(M.party[n] + " aboard after stop " + n + " (" + nameOf(s.at) + "), but " + c.name + " seats " + c.seats);
    if (n && n < L.length && (s.board || []).length && L[n].dep_jd < L[n - 1].arr_jd + DWELL - 1e-6)
      errs.push(legName(n) + " leaves before " + who(s.board) + (one || s.board.length === 1 ? " has" : " have") + " boarded");
  });
  if (t0 != null){ var st = hazards(seed).pickupStart(id, car, t0); if (L[0].dep_jd < st - 1e-6) errs.push(c.name + " is busy on another ride until " + iso(st) + ", so its pickup can't leave before then"); }
  return errs;
}
function quotedJd(s){ var m = /^\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(s || "")); return m ? E.jdFromIso(m[1] + "T" + m[2]) : null; }
function k(x){ return Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function iso(jd){ return E.isoFromJd(jd, true).replace("T", " ").slice(0, 16); }
// Score out of 100, from what actually happened (fly) rather than the plan. legs: today's [pickup, ride] or a plan.
// ctx: { t0, arrive_by_jd, par_kwh, best_wait_days, plan_calls, kind, quote: { fare_usd, arrival }, flown: fly(...) }
// A shared flight adds ctx.bookings: { hail id: { t0, arrive_by_jd, best_wait_days, quote } } (a booking without a
// row reads the top level), and flown carries its per-booking pickup and arrival (fly, or a finished ride's done).
// Passenger parts (pickup, on_time, promise, fare) are scored per booking; ship parts (energy, checker, economy) per
// flight. The flight's parts are the mean over bookings weighted by party size, plus the ship parts: a placeholder
// until Alvin sets the rule (docs/SHARED-FLIGHTS.md, open number 5). Each booking's fare is the sum of its own legs'
// fares as the planner priced them (open number 4). With one booking all of this is today's seven parts and total.
function score(id, legs, ctx){
  var plan = planOf(id, null, legs), L = plan.legs, M = manifest(plan), one = M.hails.length === 1;
  function ridden(b){ var s = M.stop[b]; return L.slice(s.board[0], s.alight[0]); }
  var F = ctx.flown;
  if (!F){ F = { used_kwh: L.reduce(function(a, l){ return a + l.kwh; }, 0), extra_kwh: 0, incidents: [], bookings: {} };
    M.hails.forEach(function(b){ var r = ridden(b); F.bookings[b] = { pickup_jd: L[M.stop[b].board[0] - 1].arr_jd, arrive_jd: r[r.length - 1].arr_jd }; });
    F.pickup_jd = F.bookings[id].pickup_jd; F.arrive_jd = F.bookings[id].arrive_jd; }
  var used = F.used_kwh, flown = F.segments || L, gated = flown.filter(function(l){ return l.gate === "PASS" || l.gate === "local"; }).length;
  var extra = Math.max(0, (ctx.plan_calls || 0) - 6);
  function dur(d){ return Math.abs(d) < 2 ? (Math.abs(d) * 24).toFixed(1) + " h" : Math.abs(d).toFixed(1) + " days"; }
  // The parts about one booking's passengers.
  function booking(b){
    var B = ctx.bookings && ctx.bookings[b] || ctx, Fb = F.bookings && F.bookings[b] || F, mine = ridden(b), last = mine[mine.length - 1];
    var fare = mine.map(function(l){ return l.fare; }).reduce(function(a, f){ return a + f; });
    var wait = Math.max(1e-6, Fb.pickup_jd - B.t0), late = Math.max(0, Fb.arrive_jd - B.arrive_by_jd), span = Math.max(1, B.arrive_by_jd - B.t0);
    var q = B.quote || {}, fareOk = isFinite(+q.fare_usd) && Math.abs(+q.fare_usd - fare) <= 1, qj = quotedJd(q.arrival);
    var tol = (BY[b].kind === "quick" ? 0.25 : 1), slip = qj == null ? null : Fb.arrive_jd - qj; // days; > 0 = later than promised
    var kept = slip == null ? 0 : Math.max(0, 1 - Math.max(0, slip) / tol - Math.max(0, -slip) / (4 * tol));
    return { party: BY[b].party, wait_days: wait, late_days: late, pickup_jd: Fb.pickup_jd, arrive_jd: Fb.arrive_jd, planned_arrive_jd: last.arr_jd, fare_usd: fare, parts: [
      { key: "pickup", label: "Fast pickup", max: 20, got: 20 * Math.min(1, B.best_wait_days / wait), note: "rider waited " + dur(wait) + ", best possible " + dur(B.best_wait_days) },
      { key: "on_time", label: "Arrived on time", max: 20, got: 20 * Math.max(0, 1 - late / (0.5 * span)), note: late > 0 ? "arrived " + dur(late) + " late, score falls to 0 at " + (0.5 * span).toFixed(0) + " days late" : "arrived by " + iso(B.arrive_by_jd) },
      { key: "promise", label: "Kept the promise", max: 15, got: 15 * kept, note: qj == null ? "no arrival time was quoted" : slip > 1 / 1440 ? "arrived " + dur(slip) + " after the quoted " + iso(qj) + "; 0 at " + dur(tol) + " late" : slip < -1 / 1440 ? "arrived " + dur(-slip) + " before the quoted " + iso(qj) : "arrived when promised, " + iso(qj) },
      { key: "fare", label: "Honest fare", max: 10, got: fareOk ? 10 : 0, note: "fare " + (fareOk ? "matches" : "doesn't match") + " the ride leg's $" + k(fare) }
    ] };
  }
  var bookings = {}; M.hails.forEach(function(b){ bookings[b] = booking(b); });
  var people = M.hails.reduce(function(a, b){ return a + bookings[b].party; }, 0);
  function mean(key){ var rows = M.hails.map(function(b){ return [b, bookings[b].parts.filter(function(p){ return p.key === key; })[0]]; }), p = rows[0][1];
    return { key: p.key, label: p.label, max: p.max, got: rows.reduce(function(a, r){ return a + r[1].got * bookings[r[0]].party; }, 0) / people,
      note: one ? p.note : rows.map(function(r){ return r[0] + ": " + r[1].note; }).join("; ") }; }
  var parts = [
    mean("pickup"),
    mean("on_time"),
    { key: "energy", label: "Energy vs par", max: 20, got: 20 * Math.pow(Math.min(1, ctx.par_kwh / used), 2), note: k(used) + " kWh flown" + (F.extra_kwh || F.divert_kwh ? " (" + [F.extra_kwh ? k(F.extra_kwh) + " from holds and corrections" : "", F.divert_kwh ? k(F.divert_kwh) + " on divert hops" : ""].filter(Boolean).join(", ") + ")" : "") + ", par " + k(ctx.par_kwh) + " kWh" },
    mean("promise"),
    { key: "checker", label: "Every leg checked", max: 10, got: 10 * gated / flown.length, note: gated + " of " + flown.length + " legs passed the re-fly or were local hops" },
    mean("fare"),
    { key: "economy", label: "Planning economy", max: 5, got: Math.max(0, 5 - extra), note: (ctx.plan_calls || 0) + " plans, 6 free" }
  ];
  var total = parts.reduce(function(a, p){ return a + p.got; }, 0), lead = bookings[id];
  function round(p){ p.got = Math.round(p.got * 10) / 10; return p; }
  var out = { total: Math.round(total), parts: parts.map(round), used_kwh: used, extra_kwh: F.extra_kwh || 0, wait_days: lead.wait_days, late_days: lead.late_days,
    pickup_jd: lead.pickup_jd, arrive_jd: lead.arrive_jd, planned_arrive_jd: lead.planned_arrive_jd, fare_usd: lead.fare_usd, beat_par: used < ctx.par_kwh * 0.995, incidents: F.incidents || [] };
  if (!one){ out.bookings = {}; M.hails.forEach(function(b){ var r = bookings[b]; r.parts = r.parts.map(round); out.bookings[b] = r; }); }
  return out;
}
return { DWELL: DWELL, WINDOW: WINDOW, LEAD: LEAD, FLEET: FLEET, CAR: CAR, HAILS: HAILS, BY: BY, system: system, nearCars: nearCars,
  planLeg: planLeg, par: par, terms: terms, check: check, score: score, planOf: planOf, manifest: manifest, iso: iso,
  MAX_BOOKINGS: MAX_BOOKINGS, stopOrders: stopOrders, parSet: parSet, termsSet: termsSet,
  HOLD_KWH: HOLD_KWH, BERTHS: BERTHS, hazards: hazards, siphash24: siphash24, fly: fly, pickupStart: pickupStart, fleetState: fleetState,
  padForecast: padForecast, flareForecast: flareForecast, weatherForecast: weatherForecast,
  start: start, step: step, regret: regret, oracle: oracle, hindsight: hindsight, ORACLE_DEPTH: ORACLE_DEPTH, EVENTS: EVENTS, MAX_CHECKPOINTS: MAX_CHECKPOINTS };
})(SOLE);
