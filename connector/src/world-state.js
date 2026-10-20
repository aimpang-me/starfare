// The sandbox world (game-design/SANDBOX-BUILD-PLAN-2026-10-20.md, step 2), as pure functions over a plain world object.
// One private copy of the solar system per player: its own hazard seed, a sky clock that only moves in ticks, the 11 ships
// where they last landed (the engine's ships map, step 1), the desks that hold them, and the market (a seeded hail pool).
// The clock ticks when every joined seat has called wait, or once a seat has kept the others waiting for cap_ms of real
// time. A job (step 3) is one taken market hail, played as today's run on the world's ships: several fly at once on
// different ships, and a dispatched job parks its ship where the flight lands, busy until it lands. Seats' codes, the tools
// and the inbox come in later steps; StarfareWorld (world.js) only stores what these functions return. No Worker imports,
// so the tests load it in plain Node.
import { POOL_TIERS, SEASON_END, SKY, hailView, isoJD, leaveRun, names, openRun, phaseOf, worldInstance } from "./game.js";

export const WORLD_FORMAT = "starfare.world/1";
export const WORLD_ID = /^w_[0-9a-f]{20}$/;
// Slice 1: one executor and two dispatchers. Desks split by region (sketch, open question 7): the Jupiter and Saturn
// ships make the outer desk, every other ship the inner one. The executor can move ships between desks in a later step.
export const SEATS = ["EX", "D1", "D2"];
const DESKS = { D1: "Inner desk", D2: "Outer desk" };
const OUTER = new Set(["jupiter", "saturn"]);
export const TICK_DAYS = 1; // sky days per tick
export const TICK_CAP_MS = 60 * 1000; // a tick runs after this long even if a joined seat has not called wait
export const MARKET_SIZE = POOL_TIERS.rows[0].hails; // today's season pool size
const EVENTS_KEPT = 50;
const JOBS_SHOWN = 30; // newest jobs the view lists

export class WorldError extends Error {}
const fail = (msg) => { throw new WorldError(msg); };

/** A new world at the start of the sky's span: every ship at its home berth and free, no seat joined, the clock stopped.
 *  seed is the world's hazard seed (world.js keys it); it never leaves the server. */
export function newWorld(E, { worldId, seed, owner = null, nowMs, capMs = TICK_CAP_MS }) {
  if (!WORLD_ID.test(worldId)) fail("world_id must look like w_ and 20 hex digits");
  const start = SKY.jd0, desks = {};
  for (const d of Object.keys(DESKS)) desks[d] = { name: DESKS[d], ships: [] };
  for (const c of E.R.FLEET) desks[OUTER.has(E.R.system(c.at)) ? "D2" : "D1"].ships.push(c.id);
  return {
    format: WORLD_FORMAT, world_id: worldId, owner, seed: String(seed), created_ms: nowMs, active_ms: nowMs,
    clock: { jd: start, start_jd: start, end_jd: SEASON_END, tick: 0, tick_days: TICK_DAYS, cap_ms: capMs, window_ms: null, done: false },
    ships: Object.fromEntries(E.R.FLEET.map((c) => [c.id, { at: c.at, free_jd: start }])),
    desks,
    seats: Object.fromEntries(SEATS.map((s) => [s, { joined_ms: null, waiting: false, stalls: 0 }])),
    market: { size: MARKET_SIZE, closed: {} },
    jobs: {}, job_seq: 0,
    events: [],
  };
}

/** The market's hail ids carry the world's tag, so two worlds' bookings never share an id in the engine's registry. */
const tagOf = (w) => w.world_id.slice(2, 14);
export const MARKET_HAIL = /^w([0-9a-f]{12})-(\d+)$/;
/** Market hail i: the season pool's row drawn with the world's tag in place of a season number. */
export function marketRow(E, w, i) {
  const row = E.R.hailRow(tagOf(w), i);
  return { ...row, id: "w" + tagOf(w) + "-" + i };
}
/** Market hail i's row, or a WorldError when hailId is not one of this world's open market hails. */
function openRow(E, w, hailId) {
  const m = MARKET_HAIL.exec(String(hailId ?? "")), i = m ? Number(m[2]) : -1;
  if (!m || m[1] !== tagOf(w) || String(i) !== m[2] || i >= w.market.size) fail("unknown hail_id " + hailId + "; the market lists this world's hails");
  const closed = w.market.closed[hailId];
  if (closed) fail("hail " + hailId + " is off the market: " + (JOB_ID.test(closed) ? "it is job " + closed : closed));
  return marketRow(E, w, i);
}
/** The open market: every pool row not yet taken or declined, as list_hails shows a hail. */
export function marketHails(E, w) {
  const out = [];
  for (let i = 0; i < w.market.size; i++) {
    const row = marketRow(E, w, i);
    if (!Object.hasOwn(w.market.closed, row.id)) out.push(hailView(E, row));
  }
  return out;
}

const seatOf = (w, seat) => {
  if (!Object.hasOwn(w.seats, seat)) fail("unknown seat " + seat + "; this world's seats are " + SEATS.join(", "));
  return w.seats[seat];
};
const joined = (w) => SEATS.filter((s) => w.seats[s].joined_ms != null);

/** A seat takes part in ticks from now on. The first seat to join opens the tick window, so the cap starts counting. */
export function joinSeat(w, seat, nowMs) {
  const s = seatOf(w, seat);
  if (s.joined_ms == null) s.joined_ms = nowMs;
  if (w.clock.window_ms == null) w.clock.window_ms = nowMs;
  w.active_ms = nowMs;
  return w;
}

/** A joined seat is done for this tick. When it is the last joined seat to wait, the tick runs. Returns the tick's event or null. */
export function waitSeat(w, seat, nowMs) {
  const s = seatOf(w, seat);
  if (s.joined_ms == null) fail("seat " + seat + " has not joined this world");
  if (w.clock.done) fail("this world's clock has reached the end of its span");
  s.waiting = true;
  w.active_ms = nowMs;
  return joined(w).every((x) => w.seats[x].waiting) ? advance(w, nowMs, "every seat waited") : null;
}

/** When the open tick runs anyway (cap_ms after it opened), or null while no seat has joined or the clock has ended. */
export const capDueMs = (w) => (w.clock.done || w.clock.window_ms == null ? null : w.clock.window_ms + w.clock.cap_ms);

/** Runs the open tick if its cap has passed: the seats that had not waited are counted as stalled. Returns the event or null. */
export function capTick(w, nowMs) {
  const due = capDueMs(w);
  return due != null && nowMs >= due ? advance(w, nowMs, "cap") : null;
}

function advance(w, nowMs, why) {
  const c = w.clock, stalled = joined(w).filter((s) => !w.seats[s].waiting);
  for (const s of stalled) w.seats[s].stalls++;
  for (const s of SEATS) w.seats[s].waiting = false;
  c.jd = Math.min(c.end_jd, c.jd + c.tick_days);
  c.tick++;
  c.window_ms = nowMs;
  if (c.jd >= c.end_jd) c.done = true;
  const event = { tick: c.tick, sky: isoJD(c.jd), at_ms: nowMs, why, stalled };
  w.events.push(event);
  if (w.events.length > EVENTS_KEPT) w.events.splice(0, w.events.length - EVENTS_KEPT);
  return event;
}

/** What the world's page and its owner see. Never the seed: the world's weather and traffic stay hidden. */
export function worldView(E, w, nowMs) {
  const { placeName } = names(E), c = w.clock, due = capDueMs(w);
  const jobs = Object.values(w.jobs || {});
  // A busy ship's job: the newest dispatched job it flies.
  const busyWith = (id) => jobs.filter((j) => j.car === id && (j.phase === "in_flight" || j.phase === "arrived")).map((j) => j.job_id).pop() || null;
  const ship = (id) => {
    const car = E.R.CAR[id], st = w.ships[id], busy = st.free_jd > c.jd;
    return { car: id, name: car.name, ship_class: E.SHIP_CLASSES[car.ship_class].name, seats: car.seats, at: { id: st.at, name: placeName(st.at) },
      free: !busy ? "free" : st.free_jd >= c.end_jd ? "when its ride lands" : isoJD(st.free_jd), ...(busy && busyWith(id) ? { job: busyWith(id) } : {}) };
  };
  return {
    simulated: true, format: w.format, world_id: w.world_id, created_ms: w.created_ms,
    clock: { sky_now: isoJD(c.jd), tick: c.tick, tick_days: c.tick_days, span_ends: isoJD(c.end_jd), done: c.done, cap_s: c.cap_ms / 1000,
      ...(due != null ? { cap_tick_in_s: Math.max(0, Math.ceil((due - nowMs) / 1000)) } : {}) },
    seats: SEATS.map((s) => ({ seat: s, role: s === "EX" ? "executor" : "dispatcher", ...(s === "EX" ? {} : { desk: w.desks[s].name }),
      joined: w.seats[s].joined_ms != null, waiting: w.seats[s].waiting, stalls: w.seats[s].stalls })),
    desks: Object.keys(w.desks).map((d) => ({ desk: d, name: w.desks[d].name, ships: w.desks[d].ships.map(ship) })),
    market: { size: w.market.size, open: w.market.size - Object.keys(w.market.closed).length },
    jobs: jobs.slice(-JOBS_SHOWN).map((j) => ({ ...j, ...(j.car ? { ship: E.R.CAR[j.car].name } : {}) })),
    events: w.events.slice(-10),
    note: "A simulated private world: its own clock, weather and traffic. The clock moves one tick (" + c.tick_days + " sky day) when every joined seat has called wait, " +
      "or " + c.cap_ms / 1000 + " real seconds after the tick opened.",
  };
}

// ---- jobs (plan step 3) ----
// A job is a run (game.js openRun) kept by StarfareWorld under its own key, beside an index row in w.jobs. The run is today's
// run with the world's seed, the world's sky time as a frozen clock that the world moves on, and the world's ships map.
export const JOB_ID = /^j[1-9]\d{0,5}$/;
const LIVE = new Set(["planning", "in_flight"]);
const jobRow = (run, w) => ({ job_id: run.world.job_id, run_id: run.run_id, hail_id: run.id, title: run.title, phase: phaseOf(run), car: run.car || null,
  taken_tick: w.clock.tick, ...(phaseOf(run) === "arrived" ? { total: run.score.total } : {}), ...(run.abandoned_reason ? { reason: run.abandoned_reason } : {}) });

/** Takes market hail hailId as a new job: { run, job }. The hail leaves the market. Fails (WorldError) on a closed world,
 *  a hail that is not open, or a trip that can't land before the world's clock ends (GameError from openRun). */
export async function takeJob(E, w, hailId, nowMs, runId) {
  if (w.clock.done) fail("this world's clock has reached the end of its span");
  E.R.admit(openRow(E, w, hailId));
  const jobId = "j" + (w.job_seq + 1);
  const inst = worldInstance(E, hailId, { seed: w.seed, clockJd: w.clock.jd, endJd: w.clock.end_jd, ships: w.ships, worldId: w.world_id, jobId });
  const run = await openRun(E, inst, runId, nowMs);
  w.job_seq++;
  w.market.closed[hailId] = jobId;
  w.jobs[jobId] = jobRow(run, w);
  w.active_ms = nowMs;
  return { run, job: w.jobs[jobId] };
}

/** Before a job's call: the run reads the world's sky time, and while it is planning, where the world's ships are now (so a
 *  ship another job dispatched is busy, and parked where that flight lands). Changes run. */
export function syncJob(w, run) {
  run.clock = { kind: "frozen", jd: w.clock.jd };
  if (phaseOf(run) === "planning") run.ships = structuredClone(w.ships);
  return run;
}

/** After a job's call changed its run: its index row, and its ship. A dispatched ship is parked at the flight's last stop and
 *  busy until it lands there; while the ride waits at a checkpoint its landing is not known, so it is busy to the end of the
 *  world's span until the ride lands. Changes w. */
export function jobMoved(w, run) {
  const id = run.world.job_id, was = w.jobs[id], phase = phaseOf(run);
  w.jobs[id] = { ...jobRow(run, w), taken_tick: was ? was.taken_tick : w.clock.tick };
  if ((phase === "in_flight" || phase === "arrived") && run.ride) {
    const at = run.ride.stops[run.ride.stops.length - 1].at;
    w.ships[run.car] = { at, free_jd: phase === "arrived" ? run.ride.arrive_jd : w.clock.end_jd };
  }
  return w.jobs[id];
}

/** Drops a job: one still planning is abandoned (its hail stays off the market); a ride at a checkpoint flies on with the
 *  default answer at every checkpoint left and is scored. Returns { run, result }, run null when the job was already over. */
export function dropJob(E, w, run) {
  const phase = phaseOf(run);
  if (!LIVE.has(phase)) return { run: null, result: { error: "job " + run.world.job_id + " is already " + phase } };
  const next = structuredClone(run);
  if (phase === "planning") {
    next.phase = "abandoned";
    next.abandoned_reason = "dropped";
    jobMoved(w, next);
    return { run: next, result: { ok: true, job_id: run.world.job_id, status: "abandoned" } };
  }
  const from = next.ride.pending;
  leaveRun(E, next);
  next.score.left_at_checkpoint = from;
  next.score.note = "The job was dropped at checkpoint " + from + ", so the rest of this ride flew on the default answers.";
  jobMoved(w, next);
  return { run: next, result: { ok: true, job_id: run.world.job_id, status: "arrived", total: next.score.total, note: next.score.note } };
}

/** The jobs still open (planning, or held at a checkpoint), oldest first. */
export const liveJobs = (w) => Object.values(w.jobs || {}).filter((j) => LIVE.has(j.phase));
