// The reference company (plan step 7): a greedy executor and naive dispatchers playing a world on its own seed, with no
// hindsight, so a player's company has a baseline to beat. Pure, over world-state.js and game.js's applyTool, so it runs in
// plain Node (bench/world-ref.mjs) as well as anywhere a world lives.
// Each tick, the executor walks the open market in order and gives a hail to the desk of the nearest free ship that can fly
// it (the engine's nearCars over the world's ships). That desk's dispatcher plans each of its free near ships for least energy,
// pickup then ride, and dispatches the least kWh with the planned fare and arrival, never asking at a checkpoint. A job none
// of them can fly is dropped (it counts 0). Then the clock ticks.
// StarfareWorld keeps a reference world beside each player's world, on the same id, seed and market, and lets it catch up
// to the player's tick on its alarm, so both are compared at the same sky time. Only its scores are shown: its jobs fly the
// world's hidden weather.
import { GameError, applyTool, phaseOf } from "./game.js";
import { WorldError, dropJob, jobMoved, marketRow, newWorld, scoresView, shipDesk, syncJob, takeJob, tickNow } from "./world-state.js";

const flies = (L) => L && !L.error && L.gate !== "FAIL" && !(L.refly && L.refly.result === "FAIL");
export const REF_TRIES = 3; // near ships a reference dispatcher plans per job

/** One reference dispatcher's whole job: { run } after it, the job dispatched or dropped. */
async function fly(E, w, run, desk, ctx) {
  const R = E.R, h = R.BY[run.id], rows = [];
  const call = async (tool, input) => {
    const { run: next, result } = await applyTool(E, syncJob(w, run), tool, input, ctx);
    if (next) { run = next; jobMoved(w, run); }
    return result;
  };
  const free = (c) => w.ships[c.id].free_jd <= w.clock.jd && w.desks[desk].ships.includes(c.id);
  for (const c of R.nearCars(h, w.ships).filter(free).slice(0, REF_TRIES)) {
    const p = await call("plan_pickup", { car: c.id, objective: "energy" });
    if (!flies(p)) continue;
    const r = await call("plan_ride", { after_leg: p.leg_id, objective: "energy" });
    if (flies(r)) rows.push({ kwh: p.battery_kwh + r.battery_kwh, p, r });
  }
  for (const { p, r } of rows.sort((a, b) => a.kwh - b.kwh)) {
    const d = await call("dispatch", { pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare_usd, quoted_arrival: r.arrive, ask_after_hours: "never" });
    if (!d.error && d.ok !== false) break;
  }
  if (phaseOf(run) === "planning" || phaseOf(run) === "in_flight") run = dropJob(E, w, run).run || run;
  return run;
}

const ROWS = new Map(); // world_id -> its market rows, drawn once per process
const rowsOf = (E, w) => ROWS.get(w.world_id) || (ROWS.set(w.world_id, Array.from({ length: w.market.size }, (_, i) => marketRow(E, w, i))), ROWS.get(w.world_id));

/** One reference tick: assign and fly what the free ships can take, then advance the clock. st.skip holds the hails it
 *  found it can't take (the trip can't land before the world ends), which stay skipped; st.runs, when given, collects each
 *  job's finished run. maxJobs bounds the work of one call: when it is reached the tick is left open, and the next call
 *  goes on from where the market and the ships now stand. Returns the jobs taken by this call. */
export async function refTick(E, w, st, { nowMs = 0, legFn = null, newRunId, maxJobs = Infinity } = {}) {
  const R = E.R, taken = [], ctx = { nowMs, legFn }, free = (c) => w.ships[c.id].free_jd <= w.clock.jd, rows = rowsOf(E, w);
  for (let i = 0; i < w.market.size && R.FLEET.some(free); i++) {
    const row = rows[i];
    if (Object.hasOwn(w.market.closed, row.id) || st.skip.has(row.id)) continue;
    const near = R.nearCars(row, w.ships).find(free);
    if (!near) continue;
    const desk = shipDesk(w, near.id);
    let got;
    try { got = await takeJob(E, w, row.id, nowMs, newRunId(), desk); }
    catch (e) { if (!(e instanceof WorldError || e instanceof GameError)) throw e; st.skip.add(row.id); continue; }
    const run = await fly(E, w, got.run, desk, ctx);
    if (st.runs) st.runs[got.job.job_id] = run;
    taken.push(got.job.job_id);
    if (taken.length >= maxJobs) return taken;
  }
  if (!w.clock.done) tickNow(w, nowMs, "reference");
  return taken;
}

/** A reference company for world w: a fresh world on w's id, seed and market. Stored beside w (StarfareWorld's "ref" key). */
export function newRef(E, w, nowMs) {
  return { world: newWorld(E, { worldId: w.world_id, seed: w.seed, nowMs, capMs: w.clock.cap_ms }), skip: [] };
}

/** Plays ref forward until its tick reaches toTick, its world ends, maxJobs jobs are taken, or budgetMs of real time has
 *  gone. Changes ref; returns whether it caught up. Each job's run is finished when it is taken, so only the world and the
 *  skipped hails are kept. */
export async function refCatchUp(E, ref, toTick, { nowMs = 0, legFn = null, newRunId, budgetMs = 10000, maxJobs = Infinity, now = () => Date.now() } = {}) {
  const w = ref.world, st = { skip: new Set(ref.skip) }, t0 = now();
  let jobs = 0;
  while (w.clock.tick < toTick && !w.clock.done && jobs < maxJobs && now() - t0 < budgetMs)
    jobs += (await refTick(E, w, st, { nowMs, legFn, newRunId, maxJobs: maxJobs - jobs })).length;
  ref.skip = [...st.skip];
  return w.clock.tick >= toTick || w.clock.done;
}

/** The reference company's scores as the player sees them: its company and desk scores, at its tick. */
export function refScores(E, ref) {
  const s = scoresView(E, ref.world);
  return { tick: ref.world.clock.tick, company: s.company, desks: s.desks,
    note: "The reference company (simulated): a greedy executor and naive dispatchers playing this world's market and weather, scored the same way, at the tick shown." };
}
