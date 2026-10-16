// Starfare ride hails: simulated riders (NPCs) hail a robotaxi; the dispatcher picks a car from the simulated fleet,
// plans the pickup and the ride, quotes the fare and arrival, and is scored. Appended to the engine bundle by
// world/bundle.py as `SOLE.R`, so the page, its worker and the Grok connector all score the same way.
// Pure functions of the engine; no DOM, no storage.
SOLE.R = (function(E){
"use strict";
var DWELL = 0.05;        // days at the pickup for the rider to board (1.2 h)
var WINDOW = 120;        // a leg may depart up to this many days after it is allowed to
var LEAD = 150;          // long-haul hails are booked this many sky days ahead (quick hails: 1 day)
// The simulated robotaxi fleet: flying roadsters parked at stations and moons. Same in every season.
var FLEET = [
  { id: "sf-01", name: "SF-01", at: "orbital-depot" },
  { id: "sf-02", name: "SF-02", at: "lunar-data-center" },
  { id: "sf-03", name: "SF-03", at: "mars-base" },
  { id: "sf-04", name: "SF-04", at: "ceres" },
  { id: "sf-05", name: "SF-05", at: "europa" },
  { id: "sf-06", name: "SF-06", at: "callisto" },
  { id: "sf-07", name: "SF-07", at: "titan-dock" }
];
var CAR = {}; FLEET.forEach(function(c){ CAR[c.id] = c; });
// Simulated riders. Names are made up; every number comes from the engine.
var HAILS = [
  { id: "iss-crew", title: "ISS crew change", rider: "Dana, a station engineer", from: "iss", to: "lunar-data-center", kind: "quick", rush: { at: "iss", x: 2 },
    blurb: "Dana finishes a shift on the ISS and needs a ride to the Lunar Data Center." },
  { id: "phobos-commute", title: "Phobos commute", rider: "Ravi, a survey pilot", from: "phobos", to: "mars-base", kind: "quick",
    blurb: "Ravi is done surveying Phobos and wants a lift down to Mars Base." },
  { id: "jovian-hop", title: "Jovian hop", rider: "Mei, a volcanologist", from: "io", to: "ganymede", kind: "quick",
    blurb: "Mei is leaving Io for a conference on Ganymede. Two cars work Jupiter's moons.", rush: { at: "ganymede", x: 3, after: 2 } },
  { id: "titan-home", title: "Stranded at Titan", rider: "Sam, a stranded tourist", from: "titan", to: "earth", kind: "long",
    blurb: "Sam's tour left without them. It's a long way home from Titan to Earth." },
  { id: "ceres-shift", title: "Belt shift change", rider: "Ana, a miner", from: "ceres-port", to: "mars-base", kind: "long", rush: { at: "ceres-port", x: 3 },
    blurb: "Ana's shift on Ceres is over and she's heading to Mars Base. One car is parked at Ceres, one at Mars." }
];
var BY = {}; HAILS.forEach(function(h){ BY[h.id] = h; });

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
// Real constants (docs/SOLAR-VARIABLES.md, from the Solar System Environment Variables workbook).
var C_KMS = 299792.458;    // speed of light, exact (SI)
var AU_KM = 149597870.7;   // astronomical unit (IAU 2012)
var CME_KMS = 1500;        // a fast CME, held at constant speed (real CMEs slow down on the way out)
var CRUISE_MSV_DAY = 1.84; // dose inside a spacecraft in deep space (Curiosity RAD, cruise to Mars; Zeitlin et al. 2013)
// Dispatch HQ is on Earth and controls every station and Starseeker (a simulated assumption): every answer to a checkpoint
// crosses the real light time.
var DIST = new Map();
function helioAt(place, jd){ var R = E.EPHEM_RANGE; return E.placeState(place, Math.min(R[1], Math.max(R[0], jd))).r; }
function sunKm(place, day){ var key = place + "|" + day;
  if (!DIST.has(key)){ if (DIST.size > 20000) DIST.clear(); var r = helioAt(place, day); DIST.set(key, Math.hypot(r[0], r[1], r[2])); }
  return DIST.get(key); }
function lightDays(place, jd){ var a = helioAt(place, jd), b = helioAt("earth", jd); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / C_KMS / 86400; }
// How a flare's storm reaches a place: the fast CME's travel time from the Sun, and the share of storms still strong
// enough to ground launches there (intensity falls as 1/r^2, so every storm counts inside 1 AU).
function flareReach(place, jd){ var r = sunKm(place, Math.floor(jd));
  return { sun_au: r / AU_KM, travel_days: r / CME_KMS / 86400, share: Math.min(1, Math.pow(AU_KM / r, 2)) }; }
function fmix(h){ h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; }
function hazards(seed){
  seed = String(seed == null ? "1" : seed);
  if (HZ[seed]) return HZ[seed];
  function u(key){ var s = seed + "|" + key, h = 2166136261; for (var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return fmix(h) / 4294967296; }
  // Solar flares (radiation storms): odds per sky day come from a 27-day spell (one solar rotation); a storm lasts 4-48 h, mostly short.
  // flareOn is the eruption at the Sun. Its storm reaches a place flareReach().travel_days later, if strong enough there.
  function flareOdds(day){ var a = u("spell|" + Math.floor(day / 27)); return a < 0.55 ? 0.05 : 0.25 + (a - 0.55) / 0.45 * 0.35; }
  function flareOn(day){ if (u("flare|" + day) >= flareOdds(day)) return null; var st = day + u("flare-at|" + day); return { start: st, end: st + (4 + 44 * Math.pow(u("flare-h|" + day), 2)) * HOUR }; }
  function flareThere(place, day){ var f = flareOn(day); if (!f) return null; var x = flareReach(place, day);
    if (u("flare-s|" + day) >= x.share) return null; return { start: f.start + x.travel_days, end: f.end + x.travel_days, erupted: f.start }; }
  function flareAt(jd, place){ var d = Math.floor(jd), k, f, n;
    if (place == null){ for (k = 0; k < 3; k++){ f = flareOn(d - k); if (f && jd >= f.start && jd < f.end) return f; } return null; }
    for (k = 0, n = Math.ceil(flareReach(place, jd).travel_days) + 3; k < n; k++){ f = flareThere(place, d - k); if (f && jd >= f.start && jd < f.end) return f; }
    return null; }
  // Local weather. Mars dust storms: odds per 10-day block, a storm lasts 1-4 days. Titan haze: odds per day, 3-9 h.
  function wxOdds(place, jd){ var w = LOCAL[place]; if (!w) return 0;
    return w === "dust" ? 0.1 + 0.5 * u("dust-odds|" + Math.floor(jd / 10)) : 0.15 + 0.3 * u("haze-odds|" + Math.floor(jd)); }
  function wxOn(w, n){
    if (w === "dust"){ var o = 0.1 + 0.5 * u("dust-odds|" + n); if (u("dust|" + n) >= o) return null; var st = n * 10 + 9 * u("dust-at|" + n); return { kind: "dust_storm", start: st, end: st + 1 + 3 * u("dust-d|" + n) }; }
    var oh = 0.15 + 0.3 * u("haze-odds|" + n); if (u("haze|" + n) >= oh) return null; var sh = n + u("haze-at|" + n); return { kind: "titan_haze", start: sh, end: sh + (3 + 6 * u("haze-h|" + n)) * HOUR }; }
  function weatherAt(place, jd){ var w = LOCAL[place]; if (!w) return null; var n = Math.floor(w === "dust" ? jd / 10 : jd);
    for (var k = 0; k < 2; k++){ var x = wxOn(w, n - k); if (x && jd >= x.start && jd < x.end) return x; } return null; }
  // Pads: berths by kind; NPC dockings per hour (busier around a rush hail's ready time).
  function berths(place){ var p = PID[place]; return BERTHS[p && p.kind] || 2; }
  function rate(place, n, rush){ var p = PID[place], r = TRAFFIC[place] != null ? TRAFFIC[place] : TRAFFIC_KIND[p && p.kind] || 0.1;
    if (rush && place === rush.at && n >= rush.from && n < rush.to) r = Math.min(0.9, r * rush.x); return r; }
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
/* ---------- a ride in flight: a stepper that stops at checkpoints ----------
   A ride is plain JSON (the connector keeps it in a Durable Object between calls):
     legs        the dispatched [pickup, ride] (the fare and the plan are judged against these)
     segs        what the car flies, in order. Each: role pickup|ride, kind planned|replan|divert|return, from, to,
                 dep_jd, arr_jd, kwh, gate, target (where this role must end up), and once flown
                 flew: { dep_jd, orbit_jd, land_jd | left_jd }
     at          the cursor: { seg, phase: "depart"|"arrive"|"done", jd, waived?, hold? }
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
function seg(role, kind, L, target){ return { role: role, kind: kind, from: L.from, to: L.to, dep_jd: L.dep_jd, arr_jd: L.arr_jd, kwh: L.kwh, gate: L.gate || null, target: target }; }
function asking(ride){ return ride.ask_after_hours != null && !ride.auto; }
function holdNote(why, cap){ return why === "pad_busy" ? "All " + cap + " berths were taken; the car held in orbit" : why === "dust_storm" ? "Dust storm closed the pad; the car held in orbit" : "Haze closed the pad; the car held in orbit"; }
function start(id, car, legs, t0, seed, opts){
  opts = opts || {};
  var after = opts.ask_after_hours === undefined ? 1 : opts.ask_after_hours === "never" ? null : opts.ask_after_hours;
  if (after != null && !(after >= 0 && after <= 24)) throw new Error("ask_after_hours must be 0 to 24 hours, or \"never\"");
  var ride = { v: 1, id: id, car: car, t0: t0, seed: String(seed == null ? "1" : seed), ask_after_hours: after, end_jd: opts.end_jd || E.EPHEM_RANGE[1] - 1,
    legs: legs.map(function(L){ return JSON.parse(JSON.stringify(L)); }), segs: legs.map(function(L, i){ return seg(i ? "ride" : "pickup", "planned", L, L.to); }),
    at: { seg: 0, phase: "depart", jd: legs[0].dep_jd }, extra_kwh: 0, incidents: [], pickup_jd: null, ride_depart_jd: null, arrive_jd: null,
    checkpoints: [], pending: null, auto: false, capped: false };
  return advance(ride);
}
function step(ride, decision){
  ride = JSON.parse(JSON.stringify(ride));
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
    var w = H.weatherAt(S.from, jd), f = S.role === "ride" ? H.flareAt(jd, S.from) : null;
    if (w || f || jd - S.dep_jd > 1e-6){
      var cp = ask(ride, "launch_hold", w ? w.kind : f ? "solar_flare" : "car_late", S.from, jd);
      if (cp) return cp;
    }
  }
  // Hold on the ground (no extra energy) until the pad's weather opens and, with a rider aboard, until any flare ends.
  for (var i = 0; i < 400; i++){
    var w2 = H.weatherAt(S.from, jd), f2 = S.role === "ride" ? H.flareAt(jd, S.from) : null;
    if (!w2 && !f2) break;
    var until = Math.max(w2 ? w2.end : 0, f2 ? f2.end : 0);
    ride.incidents.push({ kind: w2 ? w2.kind : "flare", leg: S.role, where: S.from, at_jd: jd, hours: (until - jd) * 24,
      kwh: 0, note: w2 ? (w2.kind === "dust_storm" ? "Dust storm closed the pad; the car waited on the ground" : "Haze closed the pad; the car waited on the ground")
        : "Solar storm at " + nameOf(S.from) + ": no launches with a rider aboard until it passed" });
    jd = until; }
  // Delays to a leg between planets mean a correction burn: 2% of the leg's energy per hour late, up to 30%.
  var shift = jd - S.dep_jd;
  if (shift > 1e-6 && between(S)){
    var kwh = Math.round(S.kwh * Math.min(0.3, 0.02 * shift * 24));
    if (kwh > 0) ride.incidents.push({ kind: "correction_burn", leg: S.role, where: S.from, at_jd: S.dep_jd + shift, hours: 0, kwh: kwh, note: "Left " + (shift * 24).toFixed(1) + " h late, so the car burned extra to correct the transfer" });
    ride.extra_kwh += kwh; }
  S.flew = { dep_jd: jd };
  if (S.role === "ride" && (S.kind === "planned" || S.kind === "replan")) ride.ride_depart_jd = jd;
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
  return w ? w.kind : H.docked(place, Math.floor(T * 24), rushOf(BY[ride.id], ride.t0)) >= H.berths(place) ? "pad_full" : null;
}
// On arrival, hold in orbit until a berth is free and the weather is open, asking once the car has held ask_after_hours.
function arrivePhase(ride){
  var H = hazards(ride.seed), h = BY[ride.id], rush = rushOf(h, ride.t0), at = ride.at, S = ride.segs[at.seg], hd = at.hold, place = S.to, cap = H.berths(place);
  for (; hd.iter < MAX_HOLD_H; hd.iter++){
    var jd = hd.jd, w = H.weatherAt(place, jd), full = H.docked(place, Math.floor(jd * 24), rush) >= cap;
    if (!w && !full) break;
    hd.why = hd.why || (w ? w.kind : "pad_busy");
    var next = w ? Math.max(jd + HOUR, Math.min(w.end, jd + MAX_HOLD_H * HOUR)) : (Math.floor(jd * 24) + 1) / 24, capped = (next - hd.start) * 24 >= MAX_HOLD_H;
    if (capped) next = hd.start + MAX_HOLD_H * HOUR;
    if (hd.act && next > hd.act.at - 1e-9){ bookHold(ride, S, hd.act.at); divert(ride, hd.act); return null; }
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
  if (hd.act) ride.incidents.push({ kind: "divert_overtaken", leg: S.role, where: place, at_jd: land, hours: 0, kwh: 0,
    note: "The pad opened before the dispatcher's divert to " + hd.act.name + " reached the ship, so it landed at " + nameOf(place) });
  S.flew.land_jd = land;
  if (S.role === "pickup" && S.to === S.target) ride.pickup_jd = land;
  var nx = at.seg + 1, N = ride.segs[nx];
  if (!N){ ride.arrive_jd = land; ride.at = { seg: at.seg, phase: "done", jd: land }; return null; }
  var ready = N.dep_jd;
  if (N.kind === "return"){
    ready = land + N.wait_hours * HOUR;
    var b = planned(N.from, N.to, ready, "energy", ride.end_jd);
    N.dep_jd = b.dep_jd; N.arr_jd = b.arr_jd; N.kwh = b.battery.energy_kwh;
    ready = N.dep_jd;
  } else if (N.role === "ride" && S.role === "pickup") ready = Math.max(N.dep_jd, ride.pickup_jd + DWELL);
  ride.at = { seg: nx, phase: "depart", jd: ready };
  return null;
}
function usedSoFar(ride){ return ride.segs.reduce(function(a, s){ return a + (s.flew ? s.kwh : 0); }, 0) + ride.extra_kwh; }
// Local alternates for a closed pad: other stations and moons in the same neighbourhood, priced as a hop from orbit.
function alternates(ride, place, target, T){
  var H = hazards(ride.seed), rush = rushOf(BY[ride.id], ride.t0), out = [];
  E.PLACES.forEach(function(p){
    if (p.id === place || p.id === target || (p.kind !== "moon" && p.kind !== "station") || system(p.id) !== system(place)) return;
    try { var b = planned(place, p.id, T, "energy", ride.end_jd);
      out.push({ place: p.id, name: p.name, hop_kwh: b.battery.energy_kwh, hop_hours: Math.round((b.arr_jd - b.dep_jd) * 240) / 10, berths: H.berths(p.id), booked_now: H.docked(p.id, Math.floor(T * 24), rush, true) });
    } catch (e) {}
  });
  return out.sort(function(a, b){ return a.hop_kwh - b.hop_kwh || (a.name < b.name ? -1 : 1); }).slice(0, 5);
}
function checkpoint(ride, kind, cause, place, T){
  var S = ride.segs[ride.at.seg], ref = S.role === "pickup" ? ride.legs[0] : ride.legs[ride.legs.length - 1], launch = kind === "launch_hold";
  var held = launch ? 0 : (T - ride.at.hold.start) * 24, options, oneWay = lightDays(place, T), reply = T + 2 * oneWay;
  if (launch){
    var late = Math.max(0, reply - S.dep_jd);
    options = [
      { action: "wait", leg_kwh: S.kwh, correction_pct_per_hour_late: 2, correction_cap_pct: 30, correction_kwh_if_it_left_on_reply: Math.round(S.kwh * Math.min(0.3, 0.02 * late * 24)),
        note: "Wait until the launch is clear, then fly this leg late; the correction burn grows with every hour late" },
      { action: "replan", note: "Plan a fresh leg from " + nameOf(S.from) + " to " + nameOf(S.to) + " departing at or after " + iso(reply) + " (when the answer reaches the ship); it counts as a plan" }];
  } else {
    options = [{ action: "hold", kwh_per_hour: HOLD_KWH, held_hours: held, max_hold_hours_left: Math.max(0, MAX_HOLD_H - held),
      note: "Hold in orbit until the pad opens (or for the hours you give after the answer reaches the ship, then ask again)" }];
    var alts = alternates(ride, place, S.target, reply);
    if (alts.length) options.push({ action: "divert", alternates: alts,
      note: "When the answer reaches the ship, hop to another pad, land, wait on the ground for free for wait_hours, then hop back" + (S.kind !== "divert" && between(S) ? "; priced as a local hop from " + nameOf(place) + "'s orbit" : "") });
  }
  return { n: ride.checkpoints.length + 1, kind: kind, cause: cause, why: CAUSE[cause], place: place, place_name: nameOf(place), leg: S.role, sky_at: T,
    signal_delay_minutes: Math.round(oneWay * 14400) / 10, reply_jd: reply,
    held_hours: held, car: (launch ? "on the pad at " : "holding in orbit at ") + nameOf(place), rider_aboard: S.role === "ride",
    extra_kwh: ride.extra_kwh, used_kwh: usedSoFar(ride), behind_plan_hours: (T - (launch ? ref.dep_jd : ref.arr_jd)) * 24,
    options: options, default: EVENTS[kind].dflt, decision: null };
}
function applyLaunch(ride, cp, d){
  if (d.action === "wait"){ ride.at.waived = true;
    if (cp.reply_jd > ride.at.jd + 1e-9) ride.incidents.push({ kind: "awaiting_answer", leg: ride.segs[ride.at.seg].role, where: cp.place, at_jd: ride.at.jd, hours: (cp.reply_jd - ride.at.jd) * 24, kwh: 0,
      note: "The Starseeker waited on the pad for the dispatcher's answer from Earth (" + cp.signal_delay_minutes + " min each way)" });
    ride.at.jd = Math.max(ride.at.jd, cp.reply_jd); return { action: "wait" }; }
  var S = ride.segs[ride.at.seg], L = d.leg;
  if (!L || L.from !== S.from || L.to !== S.to) throw new Error("a replan must go from " + nameOf(S.from) + " to " + nameOf(S.to));
  if (!(L.dep_jd >= cp.reply_jd - 1e-9) || !(L.arr_jd > L.dep_jd) || !isFinite(L.kwh)) throw new Error("a replan must depart at or after " + iso(cp.reply_jd) + ", when the answer reaches the ship");
  if (L.dep_jd > cp.sky_at + 1e-9) ride.incidents.push({ kind: "replanned", leg: S.role, where: S.from, at_jd: cp.sky_at, hours: (L.dep_jd - cp.sky_at) * 24, kwh: 0,
    note: "Because " + CAUSE[cp.cause] + ", the car waited on the ground and left on a new plan" });
  var leg = { from: L.from, to: L.to, dep_jd: L.dep_jd, arr_jd: L.arr_jd, kwh: L.kwh, fare: L.fare, gate: L.gate || null };
  ride.segs[ride.at.seg] = seg(S.role, "replan", leg, S.target);
  ride.at = { seg: ride.at.seg, phase: "depart", jd: leg.dep_jd };
  return { action: "replan", leg: leg };
}
function applyPad(ride, cp, d){
  var hd = ride.at.hold;
  if (d.action === "hold"){
    if (d.hours == null){ hd.stop = null; return { action: "hold" }; }
    var hrs = +d.hours;
    if (!(hrs > 0 && hrs <= MAX_HOLD_H)) throw new Error("hold hours must be more than 0 and at most " + MAX_HOLD_H);
    hd.stop = cp.reply_jd + hrs * HOUR; return { action: "hold", hours: hrs };
  }
  var div = cp.options.filter(function(o){ return o.action === "divert"; })[0], alt = div && div.alternates.filter(function(a){ return a.place === d.place; })[0];
  if (!alt) throw new Error("divert to one of: " + (div ? div.alternates.map(function(a){ return a.place; }).join(", ") : "nowhere (no local alternates)"));
  var wait = d.wait_hours == null ? 0 : +d.wait_hours;
  if (!(wait >= 0 && wait <= MAX_HOLD_H)) throw new Error("wait_hours must be 0 to " + MAX_HOLD_H);
  hd.stop = null;
  hd.act = { place: alt.place, name: alt.name, wait: wait, at: cp.reply_jd, cause: cp.cause };
  return { action: "divert", place: alt.place, wait_hours: wait };
}
// The ship carries out a divert once the answer reaches it (arrivePhase calls this at act.at).
function divert(ride, act){
  var S = ride.segs[ride.at.seg], T = act.at, b = planned(S.to, act.place, T, "energy", ride.end_jd);
  S.flew.left_jd = T;
  var hop = seg(S.role, "divert", { from: S.to, to: act.place, dep_jd: b.dep_jd, arr_jd: b.arr_jd, kwh: b.battery.energy_kwh, gate: "local" }, S.target);
  var back = { role: S.role, kind: "return", from: act.place, to: S.target, dep_jd: null, arr_jd: null, kwh: 0, gate: "local", target: S.target, wait_hours: act.wait };
  var nx = ride.at.seg + 1, N = ride.segs[nx];
  ride.segs.splice(nx, N && N.kind === "return" && N.from === S.to ? 1 : 0, hop, back);
  ride.incidents.push({ kind: "divert", leg: S.role, where: S.to, at_jd: T, hours: 0, kwh: 0,
    note: "Because " + CAUSE[act.cause] + ", the ship diverted to " + act.name + " (" + k(hop.kwh) + " kWh hop), to wait " + (Math.round(act.wait * 10) / 10) + " h on the ground and hop back" });
  ride.at = { seg: nx, phase: "depart", jd: T };
}
function outcome(ride){
  var r = ride.legs[ride.legs.length - 1], flown = ride.segs.filter(function(s){ return s.flew; });
  return { pickup_jd: ride.pickup_jd, ride_depart_jd: ride.ride_depart_jd, arrive_jd: ride.arrive_jd, planned_kwh: ride.legs.reduce(function(a, l){ return a + l.kwh; }, 0),
    extra_kwh: ride.extra_kwh, used_kwh: usedSoFar(ride), incidents: ride.incidents, delay_hours: (ride.arrive_jd - r.arr_jd) * 24,
    rider_dose_msv: dose(ride.pickup_jd, ride.arrive_jd),
    divert_kwh: flown.reduce(function(a, s){ return a + (s.kind === "divert" || s.kind === "return" ? s.kwh : 0); }, 0),
    segments: flown.map(function(s){ return { role: s.role, kind: s.kind, from: s.from, to: s.to, dep_jd: s.flew.dep_jd, arr_jd: s.flew.land_jd != null ? s.flew.land_jd : s.flew.left_jd, kwh: s.kwh, gate: s.gate }; }),
    checkpoints: ride.checkpoints };
}
// Cosmic-ray dose for the rider's time aboard, at the deep-space cruise rate: a ceiling, since stations inside a
// magnetosphere get less. Solar storms and shielding are not modelled.
function dose(boarded, arrived){ return boarded == null || arrived == null ? null : Math.round(CRUISE_MSV_DAY * (arrived - boarded) * 100) / 100; }
// What actually happens when a dispatch flies with nobody to ask: every checkpoint takes its default.
function fly(id, car, legs, t0, seed){
  var o = start(id, car, legs, t0, seed, { ask_after_hours: null }).done;
  return { pickup_jd: o.pickup_jd, ride_depart_jd: o.ride_depart_jd, arrive_jd: o.arrive_jd, planned_kwh: o.planned_kwh, extra_kwh: o.extra_kwh, used_kwh: o.used_kwh, incidents: o.incidents,
    delay_hours: o.delay_hours, rider_dose_msv: o.rider_dose_msv };
}
// With hindsight: what each choice at a checkpoint could be. A replan leaves when the hold really ends (not before the
// answer reaches the ship); a divert waits at the alternate so it lands back as the closed pad reopens (at once if only full).
function hindsight(ride, cp){
  var H = hazards(ride.seed), S = ride.segs[ride.at.seg], out = [];
  if (cp.kind === "launch_hold"){
    out.push({ action: "wait" });
    var jd = cp.reply_jd;
    for (var i = 0; i < 400; i++){ var w = H.weatherAt(S.from, jd), f = S.role === "ride" ? H.flareAt(jd, S.from) : null; if (!w && !f) break; jd = Math.max(w ? w.end : 0, f ? f.end : 0); }
    try { var b = planned(S.from, S.to, jd, "energy", ride.end_jd); out.push({ action: "replan", depart_after: jd, leg: slim(b, S.from, S.to) }); } catch (e) {}
    return out;
  }
  out.push({ action: "hold" });
  var open = cp.sky_at;
  for (var j = 0; j < 50; j++){ var x = H.weatherAt(cp.place, open); if (!x) break; open = x.end; }
  var div = cp.options.filter(function(o){ return o.action === "divert"; })[0];
  (div ? div.alternates : []).forEach(function(a){
    out.push({ action: "divert", place: a.place, wait_hours: Math.max(0, Math.round(((open - cp.reply_jd) * 24 - 2 * a.hop_hours) * 100) / 100) }); });
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
  function keep(o, path){ if (better(o, best)) best = { used_kwh: o.used_kwh, planned_kwh: o.planned_kwh, arrive_jd: o.arrive_jd, path: path }; }
  keep(start(id, car, legs, t0, seed, { ask_after_hours: null, end_jd: endJd }).done, []);
  (function explore(st, depth, path){
    if (st.done) return keep(st.done, path);
    if (depth >= ORACLE_DEPTH) return keep(finish(st), path);
    hindsight(st.ride, st.checkpoint).forEach(function(d){
      try { explore(step(st.ride, d), depth + 1, path.concat([label(d)])); } catch (e) {} });
  })(start(id, car, legs, t0, seed, { ask_after_hours: 0, end_jd: endJd }), 0, []);
  return best;
}
// For a finished (or stopped) ride: at each decided checkpoint, what every hindsight choice would have led to
// (defaults after it), and the best of them.
function regret(ride){
  var out = [], st = start(ride.id, ride.car, ride.legs, ride.t0, ride.seed, { ask_after_hours: ride.ask_after_hours, end_jd: ride.end_jd });
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
// With a place: the chance a storm that reaches it starts there that sky day (eruptions travel_days earlier, times the
// share strong enough there). Without one: the chance an eruption starts at the Sun.
function flareForecast(fromJd, days, seed, place){ var H = hazards(seed), d0 = Math.floor(fromJd), out = [];
  days = Math.max(1, Math.min(60, Math.round(days || 10)));
  for (var d = d0; d < d0 + days; d++){ var o = H.flareOdds(d);
    if (place != null){ var x = flareReach(place, d), t = d - x.travel_days, e = Math.floor(t), fr = t - e;
      o = 1 - (1 - H.flareOdds(e) * (1 - fr) * x.share) * (1 - H.flareOdds(e + 1) * fr * x.share); }
    out.push({ day_jd: d, flare_odds: Math.round(o * 100) / 100 }); }
  return out; }
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
  var p = par(id, t0, endJd, seed), span = p.planned_arr_jd - t0;
  return { hail: id, t0: t0, arrive_by_jd: Math.min(endJd, t0 + Math.ceil(span * 1.5 + 1)), par: p };
}
// A dispatch is a car plus its legs in order: [pickup, ride]. Returns a list of problems (empty = flyable).
function check(id, car, legs, t0, seed){
  var h = BY[id], c = CAR[car], errs = [];
  if (!c) return ["unknown car " + car];
  if (legs.length !== 2) return ["a dispatch is two legs: the pickup, then the ride"];
  if (legs[0].from !== c.at) errs.push("the pickup must leave where " + c.name + " is parked");
  if (legs[0].to !== h.from) errs.push("the pickup must end where the rider is");
  if (legs[1].from !== h.from || legs[1].to !== h.to) errs.push("the ride must go from the rider to their destination");
  if (legs[1].dep_jd < legs[0].arr_jd + DWELL - 1e-6) errs.push("the ride leaves before the rider has boarded");
  if (t0 != null){ var st = hazards(seed).pickupStart(id, car, t0); if (legs[0].dep_jd < st - 1e-6) errs.push(c.name + " is busy on another ride until " + iso(st) + ", so its pickup can't leave before then"); }
  return errs;
}
function quotedJd(s){ var m = /^\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(s || "")); return m ? E.jdFromIso(m[1] + "T" + m[2]) : null; }
function k(x){ return Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function iso(jd){ return E.isoFromJd(jd, true).replace("T", " ").slice(0, 16); }
// Score out of 100, from what actually happened (fly) rather than the plan.
// ctx: { t0, arrive_by_jd, par_kwh, best_wait_days, plan_calls, kind, quote: { fare_usd, arrival }, flown: fly(...) }
function score(id, legs, ctx){
  var ride = legs[legs.length - 1], F = ctx.flown || { pickup_jd: legs[0].arr_jd, arrive_jd: ride.arr_jd, used_kwh: legs.reduce(function(a, l){ return a + l.kwh; }, 0), extra_kwh: 0, incidents: [] };
  var used = F.used_kwh, wait = Math.max(1e-6, F.pickup_jd - ctx.t0), late = Math.max(0, F.arrive_jd - ctx.arrive_by_jd), span = Math.max(1, ctx.arrive_by_jd - ctx.t0);
  var flown = F.segments || legs, gated = flown.filter(function(l){ return l.gate === "PASS" || l.gate === "local"; }).length;
  var q = ctx.quote || {}, fareOk = isFinite(+q.fare_usd) && Math.abs(+q.fare_usd - ride.fare) <= 1, qj = quotedJd(q.arrival);
  var tol = (BY[id].kind === "quick" ? 0.25 : 1), slip = qj == null ? null : F.arrive_jd - qj; // days; > 0 = later than promised
  var kept = slip == null ? 0 : Math.max(0, 1 - Math.max(0, slip) / tol - Math.max(0, -slip) / (4 * tol));
  var extra = Math.max(0, (ctx.plan_calls || 0) - 6);
  function dur(d){ return Math.abs(d) < 2 ? (Math.abs(d) * 24).toFixed(1) + " h" : Math.abs(d).toFixed(1) + " days"; }
  var parts = [
    { key: "pickup", label: "Fast pickup", max: 20, got: 20 * Math.min(1, ctx.best_wait_days / wait), note: "rider waited " + dur(wait) + ", best possible " + dur(ctx.best_wait_days) },
    { key: "on_time", label: "Arrived on time", max: 20, got: 20 * Math.max(0, 1 - late / (0.5 * span)), note: late > 0 ? "arrived " + dur(late) + " late, score falls to 0 at " + (0.5 * span).toFixed(0) + " days late" : "arrived by " + iso(ctx.arrive_by_jd) },
    { key: "energy", label: "Energy vs par", max: 20, got: 20 * Math.pow(Math.min(1, ctx.par_kwh / used), 2), note: k(used) + " kWh flown" + (F.extra_kwh || F.divert_kwh ? " (" + [F.extra_kwh ? k(F.extra_kwh) + " from holds and corrections" : "", F.divert_kwh ? k(F.divert_kwh) + " on divert hops" : ""].filter(Boolean).join(", ") + ")" : "") + ", par " + k(ctx.par_kwh) + " kWh" },
    { key: "promise", label: "Kept the promise", max: 15, got: 15 * kept, note: qj == null ? "no arrival time was quoted" : slip > 1 / 1440 ? "arrived " + dur(slip) + " after the quoted " + iso(qj) + "; 0 at " + dur(tol) + " late" : slip < -1 / 1440 ? "arrived " + dur(-slip) + " before the quoted " + iso(qj) : "arrived when promised, " + iso(qj) },
    { key: "checker", label: "Every leg checked", max: 10, got: 10 * gated / flown.length, note: gated + " of " + flown.length + " legs passed the re-fly or were local hops" },
    { key: "fare", label: "Honest fare", max: 10, got: fareOk ? 10 : 0, note: "fare " + (fareOk ? "matches" : "doesn't match") + " the ride leg's $" + k(ride.fare) },
    { key: "economy", label: "Planning economy", max: 5, got: Math.max(0, 5 - extra), note: (ctx.plan_calls || 0) + " plans, 6 free" }
  ];
  var total = parts.reduce(function(a, p){ return a + p.got; }, 0);
  return { total: Math.round(total), parts: parts.map(function(p){ p.got = Math.round(p.got * 10) / 10; return p; }), used_kwh: used, extra_kwh: F.extra_kwh || 0, wait_days: wait, late_days: late,
    pickup_jd: F.pickup_jd, arrive_jd: F.arrive_jd, planned_arrive_jd: ride.arr_jd, rider_dose_msv: dose(F.pickup_jd, F.arrive_jd), fare_usd: ride.fare, beat_par: used < ctx.par_kwh * 0.995, incidents: F.incidents || [] };
}
return { DWELL: DWELL, WINDOW: WINDOW, LEAD: LEAD, FLEET: FLEET, CAR: CAR, HAILS: HAILS, BY: BY, system: system, nearCars: nearCars,
  planLeg: planLeg, par: par, terms: terms, check: check, score: score, iso: iso,
  HOLD_KWH: HOLD_KWH, BERTHS: BERTHS, hazards: hazards, fly: fly, pickupStart: pickupStart, fleetState: fleetState,
  padForecast: padForecast, flareForecast: flareForecast, flareReach: flareReach, lightDays: lightDays, weatherForecast: weatherForecast,
  C_KMS: C_KMS, AU_KM: AU_KM, CME_KMS: CME_KMS, CRUISE_MSV_DAY: CRUISE_MSV_DAY,
  start: start, step: step, regret: regret, EVENTS: EVENTS, MAX_CHECKPOINTS: MAX_CHECKPOINTS };
})(SOLE);
