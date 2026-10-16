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
function fmix(h){ h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; }
function hazards(seed){
  seed = String(seed == null ? "1" : seed);
  if (HZ[seed]) return HZ[seed];
  function u(key){ var s = seed + "|" + key, h = 2166136261; for (var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return fmix(h) / 4294967296; }
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
// What actually happens when a dispatch flies. legs: [pickup, ride] as planned. Returns actual times, extra kWh and incidents.
function fly(id, car, legs, t0, seed){
  var H = hazards(seed), h = BY[id], rush = rushOf(h, t0), inc = [], extra = 0;
  function closedAt(place, jd){ return H.weatherAt(place, jd); }
  // Hold on the ground (no extra energy) until the pad's weather opens and, with a rider aboard, until any flare ends.
  function depart(L, jd, role){
    for (var i = 0; i < 400; i++){
      var w = closedAt(L.from, jd), f = role === "ride" ? H.flareAt(jd) : null;
      if (!w && !f) break;
      var until = Math.max(w ? w.end : 0, f ? f.end : 0), x = w || f;
      inc.push({ kind: w ? w.kind : "flare", leg: role, where: L.from, at_jd: jd, hours: (until - jd) * 24,
        kwh: 0, note: w ? (w.kind === "dust_storm" ? "Dust storm closed the pad; the car waited on the ground" : "Haze closed the pad; the car waited on the ground")
          : "Solar flare: no launches with a rider aboard until it passed" });
      jd = until; }
    return jd; }
  // Delays to a leg between planets mean a correction burn: 2% of the leg's energy per hour late, up to 30%.
  function correction(L, shift, role){
    if (shift <= 1e-6 || system(L.from) === system(L.to)) return 0;
    var kwh = Math.round(L.kwh * Math.min(0.3, 0.02 * shift * 24));
    if (kwh > 0) inc.push({ kind: "correction_burn", leg: role, where: L.from, at_jd: L.dep_jd + shift, hours: 0, kwh: kwh, note: "Left " + (shift * 24).toFixed(1) + " h late, so the car burned extra to correct the transfer" });
    return kwh; }
  // On arrival, hold in orbit (250 kWh an hour) until a berth is free and the weather is open.
  function arrive(place, jd, role){
    var start = jd, cap = H.berths(place), why = null;
    for (var i = 0; i < MAX_HOLD_H; i++){
      var w = closedAt(place, jd), full = H.docked(place, Math.floor(jd * 24), rush) >= cap;
      if (!w && !full) break;
      why = why || (w ? w.kind : "pad_busy");
      jd = w ? Math.max(jd + HOUR, Math.min(w.end, jd + MAX_HOLD_H * HOUR)) : (Math.floor(jd * 24) + 1) / 24;
      if ((jd - start) * 24 >= MAX_HOLD_H){ jd = start + MAX_HOLD_H * HOUR; break; } }
    if (jd > start + 1e-9){ var hrs = (jd - start) * 24, kwh = Math.round(hrs * HOLD_KWH); extra += kwh;
      inc.push({ kind: why, leg: role, where: place, at_jd: start, hours: hrs, kwh: kwh,
        note: why === "pad_busy" ? "All " + cap + " berths were taken; the car held in orbit" : why === "dust_storm" ? "Dust storm closed the pad; the car held in orbit" : "Haze closed the pad; the car held in orbit" }); }
    return jd; }
  var p = legs[0], r = legs[1];
  var pd = depart(p, p.dep_jd, "pickup"), pShift = pd - p.dep_jd; extra += correction(p, pShift, "pickup");
  var pickup = arrive(h.from, p.arr_jd + pShift, "pickup");
  var rd = depart(r, Math.max(r.dep_jd, pickup + DWELL), "ride"), rShift = rd - r.dep_jd; extra += correction(r, rShift, "ride");
  var arr = arrive(h.to, r.arr_jd + rShift, "ride");
  return { pickup_jd: pickup, ride_depart_jd: rd, arrive_jd: arr, planned_kwh: p.kwh + r.kwh, extra_kwh: extra, used_kwh: p.kwh + r.kwh + extra, incidents: inc,
    delay_hours: (arr - r.arr_jd) * 24 };
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
function slim(b, from, to){ return { from: from, to: to, dep_jd: b.dep_jd, arr_jd: b.arr_jd, kwh: b.battery.energy_kwh, fare: b.fare.total_usd }; }

// Par: for every nearby car, pickup and ride each planned for least energy, leaving as soon as the car is free,
// flown through the season's hazards. best_wait: the earliest any nearby car actually reaches the rider (pickup planned for time).
function par(id, t0, endJd, seed){
  var h = BY[id], H = hazards(seed), best = null, wait = null;
  nearCars(h).forEach(function(c){
    var st = H.pickupStart(id, c.id, t0);
    // Quick hails: par may also wait on the ground (pickup and ride each 0-12 h) to dodge forecast trouble.
    (h.kind === "quick" ? PAR_WAITS : [[0, 0]]).forEach(function(w){
      try {
        var p = planLeg(c.at, h.from, st + w[0] * HOUR, "energy", endJd), P = slim(p, c.at, h.from);
        var pk = fly(id, c.id, [P, { from: h.from, to: h.from, dep_jd: p.arr_jd + DWELL, arr_jd: p.arr_jd + DWELL, kwh: 0 }], t0, seed).pickup_jd;
        var r = planLeg(h.from, h.to, Math.max(p.arr_jd, pk) + DWELL + w[1] * HOUR, "energy", endJd), Rr = slim(r, h.from, h.to), F = fly(id, c.id, [P, Rr], t0, seed);
        if (!best || F.used_kwh < best.kwh - 1e-9) best = { car: c.id, kwh: F.used_kwh, planned_kwh: F.planned_kwh, arr_jd: F.arrive_jd, planned_arr_jd: r.arr_jd, legs: [P, Rr], wait_h: w };
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
    best_wait_days: wait ? Math.max(1e-6, wait.arr_jd - t0) : 1e-6, best_wait_car: wait ? wait.car : best.car };
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
  var gated = legs.filter(function(l){ return l.gate === "PASS" || l.gate === "local"; }).length;
  var q = ctx.quote || {}, fareOk = isFinite(+q.fare_usd) && Math.abs(+q.fare_usd - ride.fare) <= 1, qj = quotedJd(q.arrival);
  var tol = (BY[id].kind === "quick" ? 0.25 : 1), slip = qj == null ? null : F.arrive_jd - qj; // days; > 0 = later than promised
  var kept = slip == null ? 0 : Math.max(0, 1 - Math.max(0, slip) / tol - Math.max(0, -slip) / (4 * tol));
  var extra = Math.max(0, (ctx.plan_calls || 0) - 6);
  function dur(d){ return Math.abs(d) < 2 ? (Math.abs(d) * 24).toFixed(1) + " h" : Math.abs(d).toFixed(1) + " days"; }
  var parts = [
    { key: "pickup", label: "Fast pickup", max: 20, got: 20 * Math.min(1, ctx.best_wait_days / wait), note: "rider waited " + dur(wait) + ", best possible " + dur(ctx.best_wait_days) },
    { key: "on_time", label: "Arrived on time", max: 20, got: 20 * Math.max(0, 1 - late / (0.5 * span)), note: late > 0 ? "arrived " + dur(late) + " late, score falls to 0 at " + (0.5 * span).toFixed(0) + " days late" : "arrived by " + iso(ctx.arrive_by_jd) },
    { key: "energy", label: "Energy vs par", max: 20, got: 20 * Math.pow(Math.min(1, ctx.par_kwh / used), 2), note: k(used) + " kWh flown" + (F.extra_kwh ? " (" + k(F.extra_kwh) + " from holds and corrections)" : "") + ", par " + k(ctx.par_kwh) + " kWh" },
    { key: "promise", label: "Kept the promise", max: 15, got: 15 * kept, note: qj == null ? "no arrival time was quoted" : slip > 1 / 1440 ? "arrived " + dur(slip) + " after the quoted " + iso(qj) + "; 0 at " + dur(tol) + " late" : slip < -1 / 1440 ? "arrived " + dur(-slip) + " before the quoted " + iso(qj) : "arrived when promised, " + iso(qj) },
    { key: "checker", label: "Every leg checked", max: 10, got: 10 * gated / legs.length, note: gated + " of " + legs.length + " legs passed the re-fly or were local hops" },
    { key: "fare", label: "Honest fare", max: 10, got: fareOk ? 10 : 0, note: "fare " + (fareOk ? "matches" : "doesn't match") + " the ride leg's $" + k(ride.fare) },
    { key: "economy", label: "Planning economy", max: 5, got: Math.max(0, 5 - extra), note: (ctx.plan_calls || 0) + " plans, 6 free" }
  ];
  var total = parts.reduce(function(a, p){ return a + p.got; }, 0);
  return { total: Math.round(total), parts: parts.map(function(p){ p.got = Math.round(p.got * 10) / 10; return p; }), used_kwh: used, extra_kwh: F.extra_kwh || 0, wait_days: wait, late_days: late,
    pickup_jd: F.pickup_jd, arrive_jd: F.arrive_jd, planned_arrive_jd: ride.arr_jd, fare_usd: ride.fare, beat_par: used < ctx.par_kwh * 0.995, incidents: F.incidents || [] };
}
return { DWELL: DWELL, WINDOW: WINDOW, LEAD: LEAD, FLEET: FLEET, CAR: CAR, HAILS: HAILS, BY: BY, system: system, nearCars: nearCars,
  planLeg: planLeg, par: par, terms: terms, check: check, score: score, iso: iso,
  HOLD_KWH: HOLD_KWH, BERTHS: BERTHS, hazards: hazards, fly: fly, pickupStart: pickupStart, fleetState: fleetState,
  padForecast: padForecast, flareForecast: flareForecast, weatherForecast: weatherForecast };
})(SOLE);
