// The sandbox world (game-design/SANDBOX-BUILD-PLAN-2026-10-20.md, step 2), as pure functions over a plain world object.
// One private copy of the solar system per player: its own hazard seed, a sky clock that only moves in ticks, the 11 ships
// where they last landed (the engine's ships map, step 1), the desks that hold them, and the market (a seeded hail pool).
// The clock ticks when every joined seat has called wait, or once a seat has kept the others waiting for cap_ms of real
// time. A job (step 3) is one taken market hail, played as today's run on the world's ships: several fly at once on
// different ships, and a dispatched job parks its ship where the flight lands, busy until it lands. Seats hold codes (step 4)
// and call the executor's and dispatchers' tools (step 5); each seat has an inbox of what happened for it (step 6), which its
// wait call returns. StarfareWorld (world.js) only stores what these functions return. No Worker imports, so the tests load
// it in plain Node.
import { POOL_TIERS, SEASON_END, SKY, hailPage, hailView, isoJD, leaveRun, names, openRun, phaseOf, seasonStandings, worldInstance } from "./game.js";

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
    seats: Object.fromEntries(SEATS.map((s) => [s, { joined_ms: null, waiting: false, stalls: 0, code_hash: null, agent: null }])),
    market: { size: MARKET_SIZE, closed: {} },
    jobs: {}, job_seq: 0,
    reports: [],
    events: [],
    inbox: Object.fromEntries(SEATS.map((s) => [s, []])), messages: [],
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

/** A seat takes part in ticks from now on. The first seat to join opens the tick window, so the cap starts counting.
 *  agent is what the agent said about itself when it joined (self-reported, unverified), or null. */
export function joinSeat(w, seat, nowMs, agent = null) {
  const s = seatOf(w, seat);
  if (s.joined_ms == null) s.joined_ms = nowMs;
  if (agent) s.agent = agent;
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
  post(w, joined(w), { kind: "tick", at_ms: nowMs, why, stalled });
  landings(w, nowMs);
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
      joined: w.seats[s].joined_ms != null, waiting: w.seats[s].waiting, stalls: w.seats[s].stalls, ...(w.seats[s].agent ? { agent: w.seats[s].agent } : {}) })),
    desks: Object.keys(w.desks).map((d) => ({ desk: d, name: w.desks[d].name, ships: w.desks[d].ships.map(ship) })),
    market: { size: w.market.size, open: w.market.size - Object.keys(w.market.closed).length },
    jobs: jobs.slice(-JOBS_SHOWN).map((j) => jobPub(E, j)),
    scores: scoresView(E, w),
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
// An arrived job's ride is flown and scored at once, but in the world's time its ship lands at lands_jd: the tick that
// passes it posts the landing to the desk and the executor, and marks the job landed.
const jobRow = (run, w) => ({ job_id: run.world.job_id, run_id: run.run_id, hail_id: run.id, title: run.title, phase: phaseOf(run), car: run.car || null,
  taken_tick: w.clock.tick, ...(phaseOf(run) === "arrived" ? { total: run.score.total, lands_jd: run.ride.arrive_jd } : {}), ...(run.abandoned_reason ? { reason: run.abandoned_reason } : {}) });
/** A job's row as the views show it: its ship's name, and for an arrived job when its ship lands in the world's time. */
function jobPub(E, j) {
  const { lands_jd, landed, ...row } = j;
  return { ...row, ...(j.car ? { ship: E.R.CAR[j.car].name } : {}), ...(lands_jd != null ? { lands: isoJD(lands_jd), landed: !!landed } : {}) };
}

/** Takes market hail hailId as a new job: { run, job }. The hail leaves the market. Fails (WorldError) on a closed world,
 *  a hail that is not open, or a trip that can't land before the world's clock ends (GameError from openRun). */
export async function takeJob(E, w, hailId, nowMs, runId, desk = null) {
  if (w.clock.done) fail("this world's clock has reached the end of its span");
  E.R.admit(openRow(E, w, hailId));
  const jobId = "j" + (w.job_seq + 1);
  const inst = worldInstance(E, hailId, { seed: w.seed, clockJd: w.clock.jd, endJd: w.clock.end_jd, ships: w.ships, worldId: w.world_id, jobId });
  const run = await openRun(E, inst, runId, nowMs);
  w.job_seq++;
  w.market.closed[hailId] = jobId;
  w.jobs[jobId] = { ...jobRow(run, w), desk };
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
  w.jobs[id] = { ...jobRow(run, w), taken_tick: was ? was.taken_tick : w.clock.tick, desk: was ? was.desk : null, ...(was && was.landed ? { landed: true } : {}) };
  if ((phase === "in_flight" || phase === "arrived") && run.ride) {
    const at = run.ride.stops[run.ride.stops.length - 1].at;
    w.ships[run.car] = { at, free_jd: phase === "arrived" ? run.ride.arrive_jd : w.clock.end_jd };
  }
  landings(w, null);
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

// ---- seats and codes (plan step 4) ----
// Grok opens a new MCP session for every tool call (the step 0 spike), so no session is bound to a seat: every sandbox tool
// takes the seat's code. A code names its seat and its world, so it routes itself, and carries a secret whose SHA-256 the
// world keeps: "D1-0123456789abcdef0123-K7QMXP4R2ZHT". The world's page shows the codes to its owner; the view never does.
const CODE_ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", SECRET_LEN = 12;
export const SEAT_CODE = new RegExp("^(" + SEATS.join("|") + ")-([0-9a-f]{20})-([" + CODE_ABC + "]{" + SECRET_LEN + "})$");
/** A fresh seat code's secret: 12 letters and digits that read unambiguously (about 59 bits). */
export const newSecret = (bytes = crypto.getRandomValues(new Uint8Array(SECRET_LEN))) => [...bytes].map((b) => CODE_ABC[b % CODE_ABC.length]).join("");
export const seatCode = (worldId, seat, secret) => seat + "-" + worldId.slice(2) + "-" + secret;
/** { seat, world_id, secret } from a code as an agent typed it (spaces and case forgiven), or null. */
export function parseCode(code) {
  const m = SEAT_CODE.exec(String(code ?? "").trim().toUpperCase().replace(/^(EX|D\d)-([0-9A-F]{20})-/, (all, seat, hex) => seat + "-" + hex.toLowerCase() + "-"));
  return m ? { seat: m[1], world_id: "w_" + m[2], secret: m[3] } : null;
}
export async function codeHash(secret) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("starfare-seat|" + secret));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Which tools each role may call. The executor runs the company: the market, which desk gets a job, the ships between desks,
// the messages and the reports. A dispatcher flies its desk's jobs with today's planning tools. Both call join and wait.
// Tools named here before the step that builds them are refused as not built yet, not as out of scope.
const BOTH = ["join", "wait", "message"];
export const SCOPES = {
  executor: [...BOTH, "company", "market", "assign", "decline", "transfer_ship", "reports"],
  dispatcher: [...BOTH, "queue", "get_hail", "plan_pickup", "plan_ride", "plan_leg", "check_pad", "space_weather", "dispatch", "decide", "report"],
};
export const roleOf = (seat) => (seat === "EX" ? "executor" : "dispatcher");
/** Why seat may not call tool, or null when it may. */
export function scopeRefusal(w, seat, tool) {
  const role = roleOf(seat);
  if (SCOPES[role].includes(tool)) return null;
  const other = role === "executor" ? "dispatcher" : "executor";
  const who = role === "executor" ? "the executor (EX)" : "dispatcher " + seat + " (" + w.desks[seat].name + ")";
  return SCOPES[other].includes(tool)
    ? tool + " is " + (other === "executor" ? "the executor's tool" : "a dispatcher's tool") + "; this code is " + who + ". Ask " + (other === "executor" ? "the executor" : "a dispatcher") + " with message."
    : "unknown sandbox tool " + tool + "; " + who + " can call " + SCOPES[role].join(", ");
}

/** What a seat is told when it joins: its role, its desk and ships, the clock, what it may call, and how a tick works. */
export function seatBrief(E, w, seat, nowMs) {
  const v = worldView(E, w, nowMs), role = roleOf(seat), desk = role === "dispatcher" ? v.desks.find((d) => d.desk === seat) : null;
  return {
    simulated: true, joined: seat, role, world_id: w.world_id, ...(desk ? { desk: { name: desk.name, ships: desk.ships } } : { desks: v.desks }),
    clock: v.clock, seats: v.seats, tools: SCOPES[role],
    note: role === "executor"
      ? "You are the executor of a simulated Starseeker company: you pick jobs from the market, give each to a dispatcher's desk, move ships between desks and read their reports. You fly nothing yourself."
      : "You are a dispatcher of a simulated Starseeker company: you fly the jobs the executor gives your desk, with your desk's ships, using the planning tools.",
    codes: "Pass this same code to every sandbox tool: each call is checked against it.",
    wait: "When you have nothing to do, call wait with your code. It returns what happened for your seat, or after up to " + WAIT_MAX_S + " s with nothing new; call it again. " +
      "The clock ticks once every joined seat is waiting, or " + w.clock.cap_ms / 1000 + " s after the tick opened. Every result's inbox counts what your next wait returns.",
  };
}

// ---- the executor's and dispatchers' tools (plan step 5) ----
const REPORTS_KEPT = 50, REPORT_MAX = 600;
const deskOf = (w, d) => (Object.hasOwn(w.desks, d) ? w.desks[d] : fail("unknown desk " + d + "; this world's desks are " + Object.keys(w.desks).map((k) => k + " (" + w.desks[k].name + ")").join(", ")));
/** The desk a ship is on. */
export const shipDesk = (w, car) => Object.keys(w.desks).find((d) => w.desks[d].ships.includes(car)) || null;

/** market: the open market a page at a time, filtered by kind and place like list_hails, each hail marked with the region
 *  (inner or outer, as the desks split) it picks up in. */
export function marketPage(E, w, q = {}) {
  const hails = marketHails(E, w).map((h) => ({ ...h, region: OUTER.has(E.R.system(h.from.id)) ? "outer" : "inner" }));
  const page = hailPage({ simulated: true, pool_size: w.market.size, hails }, q);
  if (page.error) return page;
  return { ...page, sky_now: isoJD(w.clock.jd), note: "The world's market (simulated). assign gives a hail to a desk as a job; decline takes it off the market. " +
    "region says where it picks up: the inner desk's ships fly inside Jupiter's orbit, the outer desk's at Jupiter and Saturn." };
}

/** decline: a market hail leaves the market without becoming a job. */
export function declineHail(E, w, hailId, nowMs) {
  openRow(E, w, hailId);
  w.market.closed[hailId] = "declined";
  w.active_ms = nowMs;
  return { ok: true, hail_id: hailId, status: "declined", market_open: w.market.size - Object.keys(w.market.closed).length };
}

/** transfer_ship: a ship moves to another desk. Where it is parked and when it is free don't change; a job the old desk
 *  is still planning on it can't dispatch it any more. */
export function transferShip(E, w, car, desk, nowMs) {
  const id = String(car || "").toLowerCase().trim(), to = deskOf(w, desk);
  if (!Object.hasOwn(w.ships, id)) fail("unknown ship " + car + "; the fleet is in company");
  const from = shipDesk(w, id);
  if (from === desk) fail(E.R.CAR[id].name + " is already on the " + to.name);
  w.desks[from].ships = w.desks[from].ships.filter((x) => x !== id);
  to.ships.push(id);
  w.active_ms = nowMs;
  post(w, [from], { kind: "ship_left", car: id, to: desk });
  post(w, [desk], { kind: "ship_joined", car: id, from });
  return { ok: true, car: id, name: E.R.CAR[id].name, from: from + " (" + w.desks[from].name + ")", to: desk + " (" + to.name + ")" };
}

/** report: a dispatcher's few lines to the executor, kept with the sky time and tick it was written at. */
export function addReport(w, seat, text, jobId, nowMs) {
  const t = String(text ?? "").trim();
  if (!t) fail("a report needs text");
  if (jobId != null && !Object.hasOwn(w.jobs, jobId)) fail("unknown job_id " + jobId);
  const r = { tick: w.clock.tick, sky: isoJD(w.clock.jd), at_ms: nowMs, seat, ...(jobId != null ? { job_id: jobId } : {}), text: t.slice(0, REPORT_MAX) };
  w.reports = [...(w.reports || []), r].slice(-REPORTS_KEPT);
  w.active_ms = nowMs;
  post(w, ["EX"], { kind: "report", from: seat, at_ms: nowMs, ...(jobId != null ? { job_id: jobId } : {}), text: r.text });
  return { ok: true, reported: r };
}

/** reports: the dispatchers' reports, newest last, and every job's outcome so far. */
export function reportsView(E, w) {
  const jobs = Object.values(w.jobs || {});
  const scored = jobs.filter((j) => j.phase === "arrived");
  return {
    simulated: true, sky_now: isoJD(w.clock.jd), tick: w.clock.tick, reports: w.reports || [],
    jobs: jobs.map((j) => jobPub(E, j)),
    counts: { taken: jobs.length, arrived: scored.length, live: jobs.filter((j) => LIVE.has(j.phase)).length, abandoned: jobs.filter((j) => j.phase === "abandoned").length,
      declined: Object.values(w.market.closed).filter((x) => x === "declined").length },
    scores: scoresView(E, w),
    note: "Totals are each arrived job's own score (out of 100000), copied from its ride. scores says how each desk and the company are judged.",
  };
}

/** queue: a dispatcher's desk: its ships and the jobs the executor gave it, open ones first. */
export function queueView(E, w, desk, nowMs) {
  const v = worldView(E, w, nowMs), d = v.desks.find((x) => x.desk === desk), mine = Object.values(w.jobs || {}).filter((j) => j.desk === desk);
  const order = (j) => (LIVE.has(j.phase) ? 0 : 1);
  return {
    simulated: true, desk, name: d.name, sky_now: v.clock.sky_now, tick: v.clock.tick, ships: d.ships, score: v.scores.desks.find((x) => x.desk === desk),
    jobs: mine.sort((a, b) => order(a) - order(b)).map((j) => jobPub(E, j)),
    note: "Plan and fly each open job with get_hail, plan_pickup, plan_ride (or plan_leg), check_pad, space_weather, dispatch and decide, passing your code and its job_id. " +
      "Only your desk's ships can fly your jobs.",
  };
}

/** Why dispatcher seat may not make this call on a job, or null. The job must be on the seat's desk, and a ship it names (or
 *  the ship of the legs it dispatches) must be on the desk now. */
export function jobRefusal(E, w, seat, run, tool, input) {
  const job = w.jobs[run.world.job_id], desk = w.desks[seat];
  if (job.desk !== seat) return "job " + job.job_id + " is " + (job.desk ? "on the " + w.desks[job.desk].name + "'s queue" : "not on a desk") + ", not yours (" + desk.name + ")";
  let car = null;
  if ((tool === "plan_pickup" || tool === "plan_leg") && input.car) car = String(input.car).toLowerCase().trim();
  if (tool === "dispatch") {
    const first = input.pickup_leg != null ? input.pickup_leg : Array.isArray(input.legs) ? input.legs[0] : null;
    const L = first != null && Object.hasOwn(run.legs, first) ? run.legs[first] : null;
    car = L ? L.car : null;
  }
  const byName = car && E.R.FLEET.find((c) => c.name.toLowerCase() === car);
  if (byName) car = byName.id;
  if (car && Object.hasOwn(w.ships, car) && !desk.ships.includes(car))
    return E.R.CAR[car].name + " is on the " + w.desks[shipDesk(w, car)].name + ", not yours; your desk's ships are " + desk.ships.map((c) => E.R.CAR[c].name).join(", ");
  return null;
}

// ---- the inbox, wait and message (plan step 6) ----
// Each seat's inbox holds what happened for it since its last wait: a tick (the newest only), a job assigned to its desk, a
// ship joining or leaving its desk, a landing (its desk's, or any for the executor), a report (the executor) and a message.
// wait returns the inbox and empties it. A seat's wait marks it done for the tick; any other call it makes means it is at
// work again, so the clock waits for it (or the cap).
const INBOX_KEPT = 50, MESSAGE_MAX = 600, MESSAGES_KEPT = 100;
export const WAIT_MAX_S = 45; // Grok gives up on a tool call after about 60 s (the step 0 spike)
const boxOf = (w, seat) => ((w.inbox = w.inbox || {})[seat] = w.inbox[seat] || []);

/** Puts an event in each seat's inbox, stamped with the tick and sky time. A new tick replaces an unread older one. */
export function post(w, seats, ev) {
  const e = { kind: ev.kind, tick: w.clock.tick, sky: isoJD(w.clock.jd), ...ev };
  for (const s of new Set(seats)) {
    const box = boxOf(w, s);
    if (e.kind === "tick") { const i = box.findIndex((x) => x.kind === "tick"); if (i >= 0) box.splice(i, 1); }
    box.push(e);
    if (box.length > INBOX_KEPT) box.splice(0, box.length - INBOX_KEPT);
  }
}
export const inboxCount = (w, seat) => boxOf(w, seat).length;

/** Each arrived job whose ship's landing the world's clock has now passed: posted to its desk and the executor. */
function landings(w, nowMs) {
  for (const j of Object.values(w.jobs || {})) {
    if (j.phase !== "arrived" || j.landed || j.lands_jd == null || j.lands_jd > w.clock.jd) continue;
    j.landed = true;
    post(w, [...(j.desk ? [j.desk] : []), "EX"], { kind: "landed", ...(nowMs != null ? { at_ms: nowMs } : {}), job_id: j.job_id, car: j.car, at: w.ships[j.car].at, total: j.total });
  }
}

/** A seat that calls anything but wait is at work, so the tick waits for it again. */
export function busySeat(w, seat) {
  seatOf(w, seat).waiting = false;
  return w;
}

/** message: a note from one seat to another ("EX", "D1", "D2") or to "all" the others, into their inboxes. */
export function sendMessage(w, seat, to, text, nowMs) {
  const t = String(text ?? "").trim(), dest = String(to ?? "").trim().toUpperCase();
  if (!t) fail("a message needs text");
  const seats = dest === "ALL" ? SEATS.filter((s) => s !== seat) : [dest];
  if (dest !== "ALL" && !SEATS.includes(dest)) fail("to must be " + SEATS.join(", ") + " or all");
  if (dest === seat) fail("that is your own seat");
  const m = { tick: w.clock.tick, sky: isoJD(w.clock.jd), at_ms: nowMs, from: seat, to: seats, text: t.slice(0, MESSAGE_MAX) };
  w.messages = [...(w.messages || []), m].slice(-MESSAGES_KEPT);
  post(w, seats, { kind: "message", from: seat, at_ms: nowMs, text: m.text });
  w.active_ms = nowMs;
  return { ok: true, sent_to: seats, text: m.text };
}

/** The seat's inbox as wait returns it (names beside the ids), emptied. */
export function takeInbox(E, w, seat) {
  const { placeName } = names(E), box = boxOf(w, seat), out = box.map((e) => ({
    ...e, ...(e.car ? { ship: E.R.CAR[e.car].name } : {}), ...(e.at ? { at: { id: e.at, name: placeName(e.at) } } : {}),
    ...(e.from && e.kind.startsWith("ship_") ? { from: e.from + " (" + w.desks[e.from].name + ")" } : {}), ...(e.to && e.kind === "ship_left" ? { to: e.to + " (" + w.desks[e.to].name + ")" } : {}),
  }));
  w.inbox[seat] = [];
  return out;
}

/** wait's answer: the events, the clock and who is waiting, and for a dispatcher the rides held at a checkpoint for it. */
export function waitView(E, w, seat, events, waitedMs, nowMs) {
  const v = worldView(E, w, nowMs);
  const held = roleOf(seat) === "dispatcher" ? Object.values(w.jobs || {}).filter((j) => j.desk === seat && j.phase === "in_flight").map((j) => j.job_id) : [];
  return {
    simulated: true, seat, events, waited_s: Math.round(waitedMs / 100) / 10, clock: v.clock, seats: v.seats.map(({ seat: s, joined: j, waiting, stalls }) => ({ seat: s, joined: j, waiting, stalls })),
    ...(held.length ? { at_checkpoint: held } : {}),
    note: w.clock.done ? "The world's clock has reached the end of its span: no more ticks." : events.length
      ? "Act on these, then call wait again with your code. The clock ticks when every joined seat is waiting, or " + w.clock.cap_ms / 1000 + " s after the tick opened."
      : "Nothing new yet. Call wait again with your code: the clock ticks when every joined seat is waiting, or " + w.clock.cap_ms / 1000 + " s after the tick opened." +
        (held.length ? " Your rides at a checkpoint wait for decide: " + held.join(", ") + "." : ""),
  };
}

// ---- layer scores (plan step 7) ----
// Each flight keeps its own score (the ride's parts, unchanged). A desk is judged by the mean total over every job it was
// given that has ended, an abandoned one (dropped, or gone cold) counting 0: the season board's rule (seasonStandings), so
// keeping only the easy jobs does not pay. The company (the executor) is judged by the share of the market's person-trips it
// flew times the mean over every ended job. Jobs still open are counted beside the means, not in them.
const ended = (j) => j.phase === "arrived" || j.phase === "abandoned";
const meanOf = (jobs) => {
  const st = seasonStandings(jobs.filter(ended).map((j) => ({ player_id: "j:all", phase: j.phase, total: j.total, plans_used: 1, forecasts_used: 0 })), 1);
  return st.ranked.length ? st.ranked[0].mean : null;
};
const partyOf = (E, w, hailId) => { const m = MARKET_HAIL.exec(hailId); return m ? marketRow(E, w, Number(m[2])).party : 0; };
export function scoresView(E, w) {
  const jobs = Object.values(w.jobs || {});
  const desks = Object.keys(w.desks).map((d) => {
    const mine = jobs.filter((j) => j.desk === d);
    return { desk: d, name: w.desks[d].name, mean: meanOf(mine), ended: mine.filter(ended).length, arrived: mine.filter((j) => j.phase === "arrived").length,
      abandoned: mine.filter((j) => j.phase === "abandoned").length, open: mine.filter((j) => LIVE.has(j.phase)).length };
  });
  let offered = 0;
  for (let i = 0; i < w.market.size; i++) offered += marketRow(E, w, i).party;
  const served = jobs.filter((j) => j.phase === "arrived").reduce((a, j) => a + partyOf(E, w, j.hail_id), 0), mean = meanOf(jobs);
  const share = offered ? served / offered : 0;
  return {
    simulated: true, desks,
    company: { offered_person_trips: offered, served_person_trips: served, served_share: Math.round(share * 10000) / 10000, mean, ended: jobs.filter(ended).length,
      score: mean == null ? null : Math.round(share * mean * 10) / 10 },
    note: "Points only (simulated). A desk's mean is over every job it was given that has ended, an abandoned job counting 0, out of 100000. " +
      "The company's score is the share of the market's person-trips flown times the mean over every ended job. Open jobs are not counted yet.",
  };
}
