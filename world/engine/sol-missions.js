// SOL delivery missions: the catalog, the brute-forced par route, route checks and scoring.
// Appended to the engine bundle by world/bundle.py as `SOLE.M`, so the page, its worker and a future
// MCP server all score the same way. Pure functions of the engine; no DOM, no storage.
SOLE.M = (function(E){
"use strict";
var DWELL = 0.05;        // days at each stop to hand over the order (1.2 h)
var WINDOW = 120;        // a leg may depart up to this many days after it is allowed to
var MISSIONS = [
  { id: "lunch-rush", title: "Low-orbit lunch rush", start: "orbital-depot", stops: ["iss", "tiangong", "lunar-data-center"],
    blurb: "Three hungry crews around Earth and the Moon. Short hops, but the Moon leg costs more than the rest together.", kind: "quick" },
  { id: "jovian-pizza", title: "Jovian moon pizza", start: "europa", stops: ["io", "ganymede", "callisto"],
    blurb: "Europa's kitchen serves the other three big moons of Jupiter. The stop order changes the bill a lot.", kind: "quick" },
  { id: "saturn-night", title: "Saturn night shift", start: "titan-dock", stops: ["enceladus", "saturn", "titan"],
    blurb: "From Titan Dock out to Enceladus, down to a Saturn parking orbit and back to Titan.", kind: "quick" },
  { id: "red-planet", title: "Red planet run", start: "earth", stops: ["mars-base", "phobos"],
    blurb: "An interplanetary order: Mars Base and Phobos. Every leg between planets is re-flown by the checker.", kind: "long" },
  { id: "belt-express", title: "Belt express", start: "mars-base", stops: ["ceres-port", "earth"],
    blurb: "Mars Base to Ceres Port and on to Earth. Years of flying, and timing matters as much as order.", kind: "long" }
];
var BY = {}; MISSIONS.forEach(function(m){ BY[m.id] = m; });

function planLeg(from, to, departAfter, objective, endJd){
  var b = E.planRide({ place: from }, to, { depFrom: departAfter, depTo: departAfter + WINDOW, arriveBy: endJd, objective: objective === "time" ? "time" : "energy", allLocal: true });
  if (!b || b.error) throw new Error((b && b.error) || "no route from " + from + " to " + to);
  return b;
}
function k(x){ return Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function perms(a){ if (a.length < 2) return [a.slice()]; var out = []; a.forEach(function(x, i){ perms(a.slice(0, i).concat(a.slice(i + 1))).forEach(function(p){ out.push([x].concat(p)); }); }); return out; }

// Par: every stop order, each leg planned for least energy and leaving as soon as it may. Best total energy wins.
function par(id, t0, endJd){
  var m = BY[id], best = null, tried = 0;
  perms(m.stops).forEach(function(order){
    var t = t0, at = m.start, kwh = 0, legs = [];
    try {
      order.forEach(function(to){ var b = planLeg(at, to, t + DWELL, "energy", endJd); legs.push({ from: at, to: to, dep_jd: b.dep_jd, arr_jd: b.arr_jd, kwh: b.battery.energy_kwh }); kwh += b.battery.energy_kwh; t = b.arr_jd; at = to; });
    } catch (e) { return; }
    tried++;
    if (!best || kwh < best.kwh - 1e-9) best = { order: order, kwh: kwh, arr_jd: t, legs: legs };
  });
  if (!best) throw new Error("no feasible order for " + m.title);
  best.orders_tried = tried; return best;
}
// What a player is told when they take the mission: deadline and battery budget, both derived from par.
function terms(id, t0, endJd){
  var p = par(id, t0, endJd), span = p.arr_jd - t0;
  var deadline = Math.min(endJd, t0 + Math.ceil(span * 1.5 + 1));
  var budget = Math.ceil(p.kwh * 1.5 / 1000) * 1000;
  return { mission: id, t0: t0, deadline_jd: deadline, budget_kwh: budget, par: p };
}
// A route is the list of legs the car will fly, in order. Returns a list of problems (empty = flyable).
function check(id, legs){
  var m = BY[id], errs = [];
  if (!legs.length) return ["the route has no legs"];
  if (legs[0].from !== m.start) errs.push("the first leg must leave " + m.start);
  for (var i = 1; i < legs.length; i++){
    if (legs[i].from !== legs[i - 1].to) errs.push("leg " + (i + 1) + " leaves " + legs[i].from + " but leg " + i + " ended at " + legs[i - 1].to);
    if (legs[i].dep_jd < legs[i - 1].arr_jd + DWELL - 1e-6) errs.push("leg " + (i + 1) + " departs before the car has finished at " + legs[i - 1].to);
  }
  m.stops.forEach(function(s){ if (!legs.some(function(l){ return l.to === s; })) errs.push("no leg delivers to " + s); });
  return errs;
}
// Score out of 100. ctx: { deadline_jd, budget_kwh, par_kwh, plan_calls, struck }
function score(id, legs, ctx){
  var m = BY[id], n = m.stops.length, used = legs.reduce(function(a, l){ return a + l.kwh; }, 0);
  var onTime = m.stops.filter(function(s){ var l = legs.filter(function(x){ return x.to === s; })[0]; return l && l.arr_jd <= ctx.deadline_jd; }).length;
  var covered = m.stops.filter(function(s){ return legs.some(function(l){ return l.to === s; }); }).length;
  var gated = legs.filter(function(l){ return l.gate === "PASS" || l.gate === "local"; }).length;
  var freeCalls = 3 * n, extra = Math.max(0, (ctx.plan_calls || 0) - freeCalls);
  var eff = used > 0 ? Math.pow(Math.min(1, ctx.par_kwh / used), 2) : 0; // squared: 50% over par keeps under half the energy points
  var parts = [
    { key: "on_time", label: "Delivered on time", max: 35, got: 35 * onTime / n, note: onTime + " of " + n + " stops by the deadline" },
    { key: "energy", label: "Energy vs par", max: 30, got: 30 * eff * covered / n, note: k(used) + " kWh used, par " + k(ctx.par_kwh) + " kWh" },
    { key: "budget", label: "Within battery budget", max: 10, got: used <= ctx.budget_kwh ? 10 : 0, note: "budget " + k(ctx.budget_kwh) + " kWh" },
    { key: "checker", label: "Every leg checked", max: 10, got: legs.length ? 10 * gated / legs.length : 0, note: gated + " of " + legs.length + " legs passed the re-fly or were local hops" },
    { key: "honesty", label: "No made-up numbers", max: 10, got: ctx.struck ? 0 : 10, note: ctx.struck ? ctx.struck + " number(s) struck by the gate" : "every number traced to a tool" },
    { key: "economy", label: "Planning economy", max: 5, got: Math.max(0, 5 - extra), note: (ctx.plan_calls || 0) + " plans requested, " + freeCalls + " free" }
  ];
  var total = parts.reduce(function(a, p){ return a + p.got; }, 0);
  return { total: Math.round(total), parts: parts.map(function(p){ p.got = Math.round(p.got * 10) / 10; return p; }), used_kwh: used, finish_jd: legs.length ? legs[legs.length - 1].arr_jd : null, beat_par: used < ctx.par_kwh * 0.995 };
}
return { DWELL: DWELL, WINDOW: WINDOW, MISSIONS: MISSIONS, BY: BY, planLeg: planLeg, par: par, terms: terms, check: check, score: score };
})(SOLE);
