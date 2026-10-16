// Baselines. naive and random play through the tools (call(tool, input)), so they pay the same costs as any agent: every
// plan counts, and a leg the checker rejects is never dispatched. reference is offline and engine-only: the best total any
// plan can reach with hindsight, the ceiling make-suite measures headroom against.
import { computeLeg, isoJD, legKey } from "../src/game.js";

const out = (x) => x && x.error && /used its/.test(x.error); // the task's budget or the run's plan cap is spent
const flies = (L) => L && !L.error && L.refly.result !== "FAIL";

/** Seeded PRNG (mulberry32) from a string, for the random agent. */
export function rngOf(s) {
  let a = 2166136261;
  for (const ch of String(s)) a = Math.imul(a ^ ch.charCodeAt(0), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, xs) => xs[Math.floor(rng() * xs.length)];

// ---- stop orders for a shared flight: lists of { at, board, alight }, consecutive events at one place merged ----
function merged(E, events) {
  const stops = [];
  for (const e of events) {
    const at = e.board ? E.R.BY[e.id].from : E.R.BY[e.id].to, s = stops[stops.length - 1];
    const cur = s && s.at === at ? s : (stops.push({ at, board: [], alight: [] }), stops[stops.length - 1]);
    cur[e.board ? "board" : "alight"].push(e.id);
  }
  return stops;
}
const maxAboard = (stops, party) => {
  let n = 0, top = 0;
  for (const s of stops) { n += s.board.reduce((a, id) => a + party[id], 0); top = Math.max(top, n); n -= s.alight.reduce((a, id) => a + party[id], 0); }
  return top;
};
/** Each booking's fare (the sum over the legs it rides) and its arrival (where its last leg lands), from legs as the tools print them. */
function quotesOf(stops, legs, ids) {
  const q = {};
  for (const id of ids) {
    const b = stops.findIndex((s) => s.board.includes(id)), a = stops.findIndex((s) => s.alight.includes(id));
    q[id] = { fare_usd: legs.slice(b + 1, a + 1).reduce((x, L) => x + L.fare_usd, 0), arrival: legs[a].arrive };
  }
  return q;
}
const dispatchShared = (call, run_id, legs, stops, ids) => call("dispatch", {
  run_id, legs: legs.map((L) => L.leg_id), stops: stops.map((s) => ({ board: s.board, alight: s.alight })), quotes: quotesOf(stops, legs, ids), ask_after_hours: "never",
});

/** Plans a shared flight's legs one by one; prefix shares the legs of routes already planned with this car. null if a leg fails or the calls run out. */
async function planRoute(call, run_id, car, stops, objective, prefix) {
  const legs = [];
  for (let i = 0; i < stops.length; i++) {
    const key = car + "|" + objective + "|" + JSON.stringify(stops.slice(0, i + 1));
    let L = prefix && prefix.get(key);
    if (!L) {
      L = await call("plan_leg", { run_id, to: stops[i].at, objective, ...(i ? { after_leg: legs[i - 1].leg_id } : { car }) });
      if (prefix) prefix.set(key, L);
    }
    if (!flies(L)) return out(L) ? "out" : null;
    legs.push(L);
  }
  return legs;
}

async function take(call) {
  const list = await call("list_hails", {});
  if (list.error) return null;
  const info = await call("take_hail", { hail_id: list.hails[0].hail_id });
  return info.error ? null : info;
}

/** naive: every car near the riders, every leg planned for least energy, leaving as soon as it can; dispatch the least planned kWh
 *  with the planned fare and arrival. A shared flight tries two stop orders: everyone boards in booking order then alights in that
 *  order, and one booking after another. Never asks at a checkpoint. */
export async function naive(call, E) {
  const R = E.R, info = await take(call);
  if (!info) return;
  const run_id = info.run_id, rows = [];
  if (!info.bookings) {
    for (const c of R.nearCars(R.BY[info.hail_id])) {
      const p = await call("plan_pickup", { run_id, car: c.id, objective: "energy" });
      if (out(p)) break;
      if (!flies(p)) continue;
      const r = await call("plan_ride", { run_id, after_leg: p.leg_id, objective: "energy" });
      if (out(r)) break;
      if (flies(r)) rows.push({ kwh: p.battery_kwh + r.battery_kwh, p, r });
    }
    for (const { p, r } of rows.sort((a, b) => a.kwh - b.kwh)) {
      const d = await call("dispatch", { run_id, pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare_usd, quoted_arrival: r.arrive, ask_after_hours: "never" });
      if (d.ok !== false) return d;
    }
    return;
  }
  const ids = info.bookings.map((b) => b.hail_id), party = Object.fromEntries(info.bookings.map((b) => [b.hail_id, b.party]));
  const orders = [
    merged(E, [...ids.map((id) => ({ id, board: true })), ...ids.map((id) => ({ id, board: false }))]),
    merged(E, ids.flatMap((id) => [{ id, board: true }, { id, board: false }])),
  ].filter((o, i, all) => all.findIndex((x) => JSON.stringify(x) === JSON.stringify(o)) === i);
  const cars = [...new Set(ids.flatMap((id) => R.nearCars(R.BY[id])))], prefix = new Map();
  plan: for (const c of cars) for (const stops of orders) {
    if (maxAboard(stops, party) > c.seats || stops[0].at === c.at) continue;
    const legs = await planRoute(call, run_id, c.id, stops, "energy", prefix);
    if (legs === "out") break plan;
    if (legs) rows.push({ kwh: legs.reduce((a, L) => a + L.battery_kwh, 0), legs, stops });
  }
  for (const { legs, stops } of rows.sort((a, b) => a.kwh - b.kwh)) {
    const d = await dispatchShared(call, run_id, legs, stops, ids);
    if (d.ok !== false) return d;
  }
}

/** random: a random car from the whole fleet (not one parked at the first stop), random objectives, and for a shared flight a
 *  random stop order the car has seats for; up to 5 tries, each dispatched with the planned fare and arrival. */
export async function random(call, E, rng) {
  const R = E.R, info = await take(call);
  if (!info) return;
  const run_id = info.run_id, obj = () => (rng() < 0.5 ? "energy" : "time");
  if (!info.bookings) {
    const cars = R.FLEET.filter((c) => c.at !== R.BY[info.hail_id].from);
    for (let i = 0; i < 5; i++) {
      const p = await call("plan_pickup", { run_id, car: pick(rng, cars).id, objective: obj() });
      if (out(p)) return;
      if (!flies(p)) continue;
      const r = await call("plan_ride", { run_id, after_leg: p.leg_id, objective: obj() });
      if (out(r)) return;
      if (!flies(r)) continue;
      const d = await call("dispatch", { run_id, pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare_usd, quoted_arrival: r.arrive, ask_after_hours: "never" });
      if (d.ok !== false) return d;
    }
    return;
  }
  const ids = info.bookings.map((b) => b.hail_id), party = Object.fromEntries(info.bookings.map((b) => [b.hail_id, b.party]));
  const orders = R.stopOrders(ids);
  for (let i = 0; i < 5; i++) {
    const stops = pick(rng, orders), cars = R.FLEET.filter((c) => c.at !== stops[0].at && c.seats >= maxAboard(stops, party));
    if (!cars.length) continue;
    const legs = await planRoute(call, run_id, pick(rng, cars).id, stops, obj(), null);
    if (legs === "out") return;
    if (!legs) continue;
    const d = await dispatchShared(call, run_id, legs, stops, ids);
    if (d.ok !== false) return d;
  }
}

/** reference: offline, engine only. Every candidate car and objective (wait 0), timed as the tools time them; candidates the
 *  checker gate or R.check reject are skipped. Each is flown on the default answers and with par's hindsight checkpoint choices
 *  (R.oracle), quoted the true arrival and the honest fare, and scored with the run's own terms. Returns the best { total, ... }. */
export function reference(E, run) {
  const R = E.R, seed = run.seed, t0 = run.t0, end = run.end_jd, memo = new Map();
  const leg = (from, to, t, obj) => {
    const k = legKey(from, to, t, obj, end);
    if (!memo.has(k)) { try { memo.set(k, computeLeg(E, from, to, t, obj, end)); } catch { memo.set(k, null); } }
    return memo.get(k);
  };
  const slim = (L) => ({ from: L.from, to: L.to, dep_jd: L.dep_jd, arr_jd: L.arr_jd, kwh: L.kwh, fare: L.fare, gate: L.gate });
  const ctx = { t0, arrive_by_jd: run.arrive_by_jd, par_kwh: run.par_kwh, best_wait_days: run.best_wait_days, kind: R.BY[run.id].kind };
  let best = null;
  const consider = (car, legs, stops, label) => {
    if (legs.some((L) => !L || L.gate === "FAIL")) return;
    const plan = stops ? { stops, legs: legs.map(slim) } : legs.map(slim);
    if (R.check(run.id, car, stops ? { stops, legs } : legs, t0, seed).length) return;
    const O = R.oracle(run.id, car, plan, t0, seed, end);
    const flown = [{ F: R.start(run.id, car, plan, t0, seed, { ask_after_hours: null, end_jd: end }).done, replans: 0, path: [] },
      { F: O.outcome, replans: O.decisions.filter((d) => d.action === "replan").length, path: O.path }];
    for (const { F, replans, path } of flown) {
      const fareOf = (id) => {
        if (!stops) return legs[1].fare;
        const M = R.manifest({ stops, legs }), s = M.stop[id];
        return legs.slice(s.board[0], s.alight[0]).reduce((a, L) => a + L.fare, 0);
      };
      const quoteOf = (id) => ({ fare_usd: fareOf(id), arrival: isoJD(stops ? F.bookings[id].arrive_jd : F.arrive_jd) });
      const sc = R.score(run.id, stops ? { stops, legs } : legs, {
        ...ctx, plan_calls: legs.length + replans, quote: quoteOf(run.id), flown: F,
        ...(stops ? { bookings: Object.fromEntries(run.hails.map((id) => [id, { ...run.bookings[id], quote: quoteOf(id) }])) } : {}),
      });
      if (!best || sc.total > best.total) best = { total: sc.total, parts: Object.fromEntries(sc.parts.map((p) => [p.key, p.got])), car, label, choices: path, used_kwh: sc.used_kwh };
    }
  };
  const OBJ = ["energy", "time"];
  if (!run.hails) {
    const h = R.BY[run.id];
    for (const c of R.nearCars(h)) {
      const start = R.pickupStart(run.id, c.id, t0, seed);
      for (const op of OBJ) {
        const p = leg(c.at, h.from, start, op);
        if (!p || p.gate === "FAIL") continue;
        for (const or of OBJ) consider(c.id, [p, leg(h.from, h.to, p.arr_jd + R.DWELL, or)], null, op + "/" + or);
      }
    }
    return best;
  }
  const ids = run.hails, party = Object.fromEntries(ids.map((id) => [id, R.BY[id].party]));
  const boards = new Set(ids.map((id) => R.BY[id].from));
  for (const c of [...new Set(ids.flatMap((id) => R.nearCars(R.BY[id])))]) {
    const start = R.pickupStart(run.id, c.id, t0, seed);
    for (const order of R.stopOrders(ids)) {
      if (maxAboard(order, party) > c.seats || order[0].at === c.at) continue;
      for (const o of OBJ) {
        const legs = [];
        for (let i = 0, from = c.at, t = start; i < order.length; i++) {
          const L = leg(from, order[i].at, t, o);
          legs.push(L);
          if (!L || L.gate === "FAIL") break;
          from = L.to; t = L.arr_jd + (boards.has(from) ? R.DWELL : 0);
        }
        if (legs.length === order.length) consider(c.id, legs, [{ at: c.at }, ...order], o);
      }
    }
  }
  return best;
}
