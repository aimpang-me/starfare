// Starfare ride hails over MCP: the same game as the in-page dispatcher in sol/world/template.html, as pure
// functions over a plain run object. A simulated rider hails a robotaxi; the bot picks a car from the simulated
// fleet, plans the pickup and the ride, quotes the fare and arrival, and dispatches. Rules and scoring live in the
// engine (SOLE.R, sol/world/engine/sol-rides.js). The engine's simulated hazards (busy pads, solar flares, Mars dust,
// Titan haze, busy cars) are seeded by the sky season number, so a season plays the same for everyone; the bot only
// ever sees forecasts (check_pad, space_weather), and R.fly decides what happened when it dispatches.
// No Workers APIs here, so it runs the same in a Durable Object and in plain Node.
import META from "./engine/meta.json" with { type: "json" };
import { extendTrack, msPerUnit, pieces, startTrack, unitsLeft } from "./live.js";

export const SKY = META.sky; // {t0_ms, jd0, len_days} from sol/world/build.py WORLD.sky
export const SEASON_END = SKY.jd0 + SKY.len_days - 1;
export const MAX_PLANS_PER_RUN = 40; // connector-only CPU guard; the page has no cap

/** 1 real second = 1 sky day; a season spans len_days, then resets. Same as the page's sky(). */
export function sky(nowMs) {
  const e = (nowMs - SKY.t0_ms) / 1000, n = Math.floor(e / SKY.len_days);
  return { season: n + 1, jd: SKY.jd0 + (e - n * SKY.len_days) };
}
/** "YYYY-MM-DD HH:MM", rounded to the nearest minute exactly like the engine's isoFromJd(jd, true). */
export function isoJD(jd) {
  const ms = Math.floor(((jd - 2440587.5) * 864e5 + 30000) / 60000) * 60000;
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

export class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };
// Own keys only: R.BY, R.CAR and run.legs are plain objects, so ids like "constructor" would otherwise hit Object.prototype.
const own = (o, k) => (typeof k === "string" && Object.hasOwn(o, k) ? o[k] : undefined);

export function names(E) {
  const PID = {};
  E.PLACES.forEach((p) => { PID[p.id] = p; });
  const placeName = (id) => (own(PID, id) ? PID[id].name : id);
  /** A place by id or by name (any case); own keys only. */
  const placeOf = (q) => {
    const k = String(q == null ? "" : q).trim().toLowerCase();
    return own(PID, k) || E.PLACES.filter((p) => p.name.toLowerCase() === k)[0] || null;
  };
  return { placeName, placeOf };
}
/** The hazard seed: the sky season number as a string. Runs from before seeds existed fall back to their season. */
export const seedOf = (run) => (run.seed != null ? run.seed : String(sky(run.created_ms || 0).season));
/** A sandbox job's ships map (engine step 1: where each ship is parked and when it is free), or null for a season or bench run,
 *  whose ships start at home and are busy as the season's draw says. */
export const shipsOf = (run) => run.ships || null;
/** "YYYY-MM-DD HH:MM" (UTC sky time) to JD, or null. Rejects dates that do not exist (2030-02-30). */
export function jdOfIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(String(s == null ? "" : s).trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (!isFinite(ms) || new Date(ms).toISOString().slice(0, 16).replace("T", " ") !== m.slice(1, 4).join("-") + " " + m[4] + ":" + m[5]) return null;
  return ms / 864e5 + 2440587.5;
}
const kindOf = (h) => (h.kind === "quick" ? "quick" : "long haul");

export function hailView(E, h) {
  const { placeName } = names(E);
  return {
    hail_id: h.id, title: h.title, kind: kindOf(h), party: h.party, rider: h.rider + " (simulated)", blurb: h.blurb,
    from: { id: h.from, name: placeName(h.from) }, to: { id: h.to, name: placeName(h.to) },
    ready: h.kind === "quick" ? "1 sky day after take_hail" : E.R.LEAD + " sky days after take_hail (a booked ride)",
  };
}
export function listHails(E) {
  return E.R.HAILS.map((h) => hailView(E, h));
}
export function seasonHail(E, season, index) {
  return hailView(E, E.R.hailRow(String(season), index));
}
export function seasonHails(E, season, cap) {
  const out = [];
  for (let i = 0; i < cap; i++) out.push(seasonHail(E, season, i));
  return out;
}
/** The same seasonal booking desk for MCP and public viewers. */
export function poolView(E, season, cap) {
  return { simulated: true, season, pool_size: cap, hails: seasonHails(E, season, cap), fleet: fleet(E), board: "/board" };
}
export const HAIL_PAGE = 25, HAIL_PAGE_MAX = 200;
/** list_hails for an agent: the pool filtered by kind and place, one page at a time. The whole pool (200+ rows, about 70 kB)
 *  is more than an agent's tool-result limit, so a page of 25 is the default and next_cursor gives the rest. */
export function hailPage(view, q = {}) {
  const place = (p, s) => !s || p.id === s.toLowerCase() || p.name.toLowerCase() === s.toLowerCase();
  const all = view.hails.filter((h) => (!q.kind || h.kind === q.kind) && place(h.from, q.from) && place(h.to, q.to));
  const at = q.cursor == null ? 0 : Number(q.cursor), limit = q.limit || HAIL_PAGE;
  if (!Number.isInteger(at) || at < 0 || at > all.length) return { error: "cursor must be a next_cursor from list_hails" };
  const page = all.slice(at, at + limit), next = at + page.length < all.length ? String(at + page.length) : null;
  return {
    ...view, matching: all.length, hails: page, ...(next ? { next_cursor: next } : {}),
    page_note: "Hails " + (all.length ? at + 1 : 0) + "-" + (at + page.length) + " of " + all.length + " matching (" + view.pool_size + " in the pool). " +
      (next ? "Pass cursor " + next + " for more, or filter with kind, from and to." : "That is every match."),
  };
}
export const POOL_TIERS = Object.freeze({
  placeholder: true,
  rows: Object.freeze([
    Object.freeze({ min_players: 0, hails: 200 }),
    Object.freeze({ min_players: 20, hails: 500 }),
    Object.freeze({ min_players: 100, hails: 1000 }),
  ]),
});
export function poolCap(distinctPlayers) {
  const rows = POOL_TIERS.rows;
  let cap = rows[0].hails;
  for (const row of rows) if (distinctPlayers >= row.min_players) cap = row.hails;
  return cap;
}
export function seasonSpan(season) {
  const start = SKY.t0_ms + (Number(season) - 1) * SKY.len_days * 1000;
  return { start, end: start + SKY.len_days * 1000 };
}
/** Board rows written before rows carried a score version were scored with version 3 (2026-10-20). */
export const rowVersion = (row) => row.score_version ?? 3;
/** A row from a newer score version replaces the hail's best whatever its points; within a version, the higher points win. */
export function keepsBest(cur, next) {
  if (!cur) return true;
  const a = rowVersion(cur), b = rowVersion(next);
  return b !== a ? b > a : next.points > cur.points;
}
const SEASON_HAIL = /^s(\d+)-(\d+)$/;
export function resolveHail(E, hailId, season, cap) {
  const cat = E.R.HAILS.find((h) => h.id === hailId);
  if (cat) return cat;
  const m = SEASON_HAIL.exec(String(hailId ?? ""));
  if (!m || String(Number(m[2])) !== m[2]) fail("unknown hail_id " + hailId + ". Call list_hails for the ids.");
  if (m[1] !== String(season)) fail("That hail is from season " + m[1] + ". This season is " + season + ". Call list_hails.");
  const index = Number(m[2]);
  if (!(cap > 0) || index >= cap) fail("That hail is outside this season's pool. Call list_hails.");
  return E.R.admit(E.R.hailRow(m[1], index));
}
/** Rebuild dynamic booking data when a stored run is loaded into a fresh engine isolate.
 * New runs retain their booking rows; older runs can regenerate them from their original season and index. */
export function restoreRunBookings(E, run) {
  const rows = new Map((run.booking_rows || []).map((h) => [h.id, h]));
  for (const id of run.hails || [run.id]) {
    if (own(E.R.BY, id)) continue;
    const m = SEASON_HAIL.exec(id);
    if (rows.has(id)) E.R.admit(rows.get(id));
    else if (m) E.R.admit(E.R.hailRow(m[1], Number(m[2])));
  }
  return run;
}
export function fleet(E, ships = null) {
  const { placeName } = names(E);
  return E.R.FLEET.map((c) => {
    const spec = E.SHIP_CLASSES[c.ship_class], flies = E.R.FLIES[c.ship_class];
    // A fictional Starseeker refuels at every stop, so its tank is per leg; a real hull carries one xenon load for the whole ride.
    const tank = spec.fictional ? { fictional: true, propellant_kg_per_leg: spec.propellant_kg, flies: E.R.FLIES_TEXT[flies] } : { xenon_kg: c.xenon_kg };
    return { car: c.id, name: c.name, ship_class: spec.name, seats: c.seats, ...tank, parked_at: { id: E.R.shipAt(c, ships), name: placeName(E.R.shipAt(c, ships)) } };
  });
}
/** The fleet as it stands for this run: each car is "free" or busy on another (simulated) job until busy_until. */
export function runFleet(E, run) {
  const st = {};
  E.R.fleetState(run.id, run.t0, seedOf(run), shipsOf(run)).forEach((c) => { st[c.car] = c.busy_until_jd; });
  return fleet(E, shipsOf(run)).map((c) => Object.assign(c, { busy_until: st[c.car] ? isoJD(st[c.car]) : "free" }));
}

// An Instance is the world of one attempt: { hail_id, t0, end_jd, seed, clock, tag, budget }, and for a sandbox job also
// { ships, world }.
//   clock: { kind: "wall" } reads the sky clock; { kind: "frozen", jd } holds sky time at jd (a bench run for the whole attempt;
//          a sandbox job until its world ticks, when the world moves jd on).
//   tag: null for a season run; a bench run's task_id, which is what it prints in place of the season; a sandbox job's job_id.
//   budget: null for a season run or a sandbox job; a bench run's call budget.
//   ships: a sandbox job's ships map (where its world's ships are parked and when they are free); world: { world_id, job_id }.
/** The hail and its t0 when taken at sky time jd: quick hails 1 sky day ahead, long hauls LEAD days ahead. */
function takeAt(E, hailId, jd) {
  const R = E.R, h = own(R.BY, hailId);
  if (!h) fail("unknown hail_id " + hailId + ". Call list_hails for the ids.");
  return Math.floor(jd + (h.kind === "quick" ? 1 : R.LEAD)) + 0.5;
}
const SEASON_TOO_SHORT = "The season ends too soon for a new hail. Wait for the reset.";
// R.par found no plan that lands before the season ends: the trip is too long for the time left, not short of ships.
const TRIP_TOO_LONG = "This trip would land after the season ends, so it can't be taken this late. Pick a shorter trip (quick hails, or a long haul " +
  "between nearer places) or wait for the reset.";
// The longest long haul in the 2026-10-20 gap review's sample took 2,401 sky days with its pickup; under this many sky days
// left, list_hails warns that some long hauls can't land in time.
const LONG_HAUL_WARN_DAYS = 2600;
/** Where the season stands for list_hails: a take needs its t0 plus 30 sky days before the season ends, so long hauls close
 *  first (about LEAD + 30 real seconds before the reset) and quick hails about 31 s before it. 1 sky day is 1 real second. */
export function seasonClock(E, nowMs) {
  const s = sky(nowMs), open = (kind) => Math.floor(s.jd + (kind === "quick" ? 1 : E.R.LEAD)) + 0.5 + 30 <= SEASON_END;
  const quick = open("quick"), long = open("long haul"), left = Math.max(0, Math.round(SEASON_END - s.jd));
  return { sky_now: isoJD(s.jd), season_ends: isoJD(SEASON_END), real_seconds_left: left, quick_open: quick, long_haul_open: long,
    note: long ? (left < LONG_HAUL_WARN_DAYS ? "Long hauls run for years of sky time, and " + left + " sky days are left this season, so some can't land before the reset: " +
      "take_hail refuses those and says so." : "Every kind of hail can be taken now.") : quick ? "Long hauls can't be taken this late in the season (take_hail refuses them); quick hails can. The season resets in about " + left + " real seconds."
      : "No hail can be taken until the season resets, in about " + left + " real seconds." };
}
/** Page takeHail(): t0 from the sky clock, and the season's hazard seed: its number, or a keyed seed (season-seed.js). */
export function seasonInstance(E, hailId, nowMs, seed = null) {
  const s = sky(nowMs), t0 = takeAt(E, hailId, s.jd);
  if (t0 + 30 > SEASON_END) fail(SEASON_TOO_SHORT);
  return { hail_id: hailId, t0, end_jd: SEASON_END, seed: seed ?? String(s.season), season: s.season, clock: { kind: "wall" }, tag: null, budget: null };
}
/** A sandbox job: a market hail taken at the world's sky time, planned on the world's ships and seed. */
export function worldInstance(E, hailId, { seed, clockJd, endJd, ships, worldId, jobId }) {
  const t0 = takeAt(E, hailId, clockJd);
  if (t0 + 30 > endJd) fail("This world's clock ends too soon for that hail.");
  return { hail_id: hailId, t0, end_jd: endJd, seed: String(seed), clock: { kind: "frozen", jd: clockJd }, tag: jobId, budget: null,
    ships: structuredClone(ships), world: { world_id: worldId, job_id: jobId } };
}
/** A bench task: sky time frozen at clockJd, where a live take would have read it, so t0 is after the clock.
 *  task is { hail_id } or a shared flight { hails: [ids] }, whose first booking is the lead: it sets t0 and is the run's hail. */
export function suiteInstance(E, task, { seed, clockJd, tag, budget }) {
  const hails = task.hails || [task.hail_id];
  return { hail_id: hails[0], ...(hails.length > 1 ? { hails } : {}), t0: takeAt(E, hails[0], clockJd), end_jd: SEASON_END, seed: String(seed), clock: { kind: "frozen", jd: clockJd }, tag, budget };
}
/** R.par throws "no ship can serve" when no flight leaving after t0 lands before end_jd: the trip is too long for the season left. */
async function seasonTerms(get) {
  try { return await get(); } catch (e) { throw /^no ship can serve /.test(e.message) ? new GameError(TRIP_TOO_LONG) : e; }
}
/** A new run in planning for an instance. termsFn lets the caller cache R.terms; its cache key must include the seed.
 *  A shared flight (inst.hails) takes R.termsSet: the lead's terms, par from the best pooled flight, and every booking's own terms. */
export async function openRun(E, inst, runId, nowMs, termsFn) {
  const R = E.R, { hail_id: hailId, t0, end_jd, seed } = inst;
  let terms, set = null;
  if (inst.hails) {
    set = await seasonTerms(() => R.termsSet(inst.hails, t0, end_jd, seed, inst.ships));
    const P = set.par.pooled, B = set.bookings[hailId];
    terms = { arrive_by_jd: B.arrive_by_jd, par_kwh: P ? P.kwh : set.par.kwh, par_car: P ? P.car : set.par.split.bookings[hailId].car, best_wait_days: B.best_wait_days };
  } else {
    // termsFn caches by hail, t0, end and seed, so a job planned on its world's ships (which move) skips it.
    const T = await seasonTerms(() => termsFn && !inst.ships ? termsFn(hailId, t0, end_jd, seed) : R.terms(hailId, t0, end_jd, seed, inst.ships));
    terms = { arrive_by_jd: T.arrive_by_jd, par_kwh: T.par.kwh, par_car: T.par.car, best_wait_days: T.par.best_wait_days };
  }
  return {
    run_id: runId, id: hailId, title: R.BY[hailId].title, t0, seed, ...(inst.season != null ? { season: inst.season } : {}), ...terms, calls: 0, lseq: 0, legs: {}, forecasts: [], phase: "planning", score: null, created_ms: nowMs,
    end_jd, clock: inst.clock, tag: inst.tag, budget: inst.budget, ...(inst.budget == null ? {} : { tool_calls: 0 }),
    ...((inst.hails || [hailId]).some((id) => SEASON_HAIL.test(id) || !R.HAILS.some((h) => h.id === id))
      ? { booking_rows: (inst.hails || [hailId]).map((id) => structuredClone(R.BY[id])) } : {}),
    ...(inst.ships ? { ships: structuredClone(inst.ships), world: inst.world } : {}),
    ...(set ? { hails: inst.hails, bookings: set.bookings } : {}),
  };
}
/** Sky time for a run: the only reader of the clock. Runs stored before clocks existed read the wall. */
export const skyNow = (run, nowMs) => (run.clock && run.clock.kind === "frozen" ? run.clock.jd : sky(nowMs).jd);
/** The world a run names in its output: its season, a bench run's task_id, or a sandbox job's job_id. Never the seed: bench
 *  and world seeds are secret. */
export const worldOf = (run) => (run.world ? { job_id: run.world.job_id } : run.tag == null ? { season: seasonOf(run) } : { task_id: run.tag });
/** A season run's season. Runs from before keyed seeds kept the season only as their seed. */
export const seasonOf = (run) => (run.season != null ? run.season : +seedOf(run));

// The fields each view may print. Anything else on a run, its seed above all, never reaches a tool result.
const VIEWS = Object.fromEntries(Object.entries({
  hail: "run_id hail_id title rider note pickup_at destination rider_ready arrive_by boarding_hours bookings season task_id job_id fleet sky_now plans_used phase dispatched passengers situation player_id rules",
  arrived: "ok run_id hail_id planned_by player_id",
  score: "status total out_of score_version parts car pickup arrive planned_pickup planned_arrive promised_arrival promised_earliest arrive_by delay_hours promise_slip_hours fare_usd planned_kwh extra_kwh divert_kwh used_kwh par_kwh par_car beat_par checkpoints rider_dose_msv incidents bookings passengers season task_id job_id",
  log: "hail kind season task_id job_id from to rider_ready arrive_by car par_car par_kwh fleet planned dispatched quote hails stops quotes forecasts checkpoints flown happened bookings incidents parts total",
  summary: "run_id hail_id hails title kind season task_id job_id phase taken_at rider_ready arrive_by plans_used forecasts_used reason open_checkpoint car par_car total out_of parts used_kwh par_kwh beat_par promised_arrival promised_earliest arrive promise_slip_hours delay_hours incidents checkpoints",
  record: "format simulated note run_id player_tag hail_id season task_id job_id phase taken_at reason open_checkpoint score log",
}).map(([k, v]) => [k, new Set(v.split(" "))]));
// A season run's own fields; a bench run never prints them (its season would be its seed, and no Grok bot planned it).
const SEASON_ONLY = new Set(["season", "planned_by"]);
/** o with only the fields view may print for this run, in o's order. */
export function project(run, view, o) {
  const keep = VIEWS[view], bench = run.tag != null;
  return Object.fromEntries(Object.entries(o).filter(([k]) => keep.has(k) && !(bench && SEASON_ONLY.has(k))));
}

// A run is planning, then in_flight (stopped at a checkpoint) or arrived (scored), or abandoned (a newer hail or a cold one).
// Runs stored before phases existed carry started and abandoned booleans instead.
export const phaseOf = (run) => run.phase || (run.started ? "arrived" : run.abandoned ? "abandoned" : "planning");
function setPhase(run, phase) { run.phase = phase; delete run.started; delete run.abandoned; }
/** Taking a newer hail leaves the old run. A run still planning is abandoned. A ride at a checkpoint flies on with the default
 *  answer at every checkpoint left, so the rider still arrives and the run is scored. Returns null when the run was already over. */
export function leaveRun(E, run) {
  const phase = phaseOf(run);
  if (phase === "planning") { setPhase(run, "abandoned"); run.abandoned_reason = "newer_hail"; return { ok: true, status: "abandoned", run_id: run.run_id }; }
  if (phase !== "in_flight") return null;
  const from = run.ride.pending;
  run.decisions = run.decisions || [];
  while (phaseOf(run) === "in_flight") {
    const cp = openCheckpoint(run), d = decisionOf(E, cp, cp.default);
    run.decisions[cp.n - 1] = d;
    next(E, run, E.R.step(run.ride, d));
  }
  run.score.left_at_checkpoint = from;
  run.score.note = "A newer hail was taken at checkpoint " + from + ", so the rest of this ride flew on the default answers.";
  return arrived(run);
}

export function hailInfo(E, run, nowMs) {
  const R = E.R, h = R.BY[run.id], { placeName } = names(E), phase = phaseOf(run);
  return project(run, "hail", {
    run_id: run.run_id, hail_id: run.id, title: h.title, rider: h.rider + " (simulated)", note: h.blurb,
    pickup_at: { id: h.from, name: placeName(h.from) }, destination: { id: h.to, name: placeName(h.to) },
    rider_ready: isoJD(run.t0), arrive_by: isoJD(run.arrive_by_jd), boarding_hours: +(R.DWELL * 24).toFixed(2), ...worldOf(run),
    ...(run.hails ? { bookings: run.hails.map((id) => bookingPub(E, run, id)) } : {}),
    fleet: run.hails ? runFleet(E, run).map((c) => Object.assign(c, { seats: R.CAR[c.car].seats })) : runFleet(E, run),
    sky_now: isoJD(skyNow(run, nowMs)), plans_used: run.calls, phase, dispatched: phase === "in_flight" || phase === "arrived",
    ...(run.plan ? { passengers: passengers(E, run) } : {}),
    ...(phase === "in_flight" ? { situation: situation(E, run) } : {}), ...(run.player_id ? { player_id: run.player_id } : {}),
    rules: rules(E) + (run.hails ? sharedRules(run) : ""),
  });
}
function bookingPub(E, run, id) {
  const h = E.R.BY[id], B = run.bookings[id], { placeName } = names(E);
  return { hail_id: id, title: h.title, rider: h.rider + " (simulated)", party: h.party, pickup_at: { id: h.from, name: placeName(h.from) },
    destination: { id: h.to, name: placeName(h.to) }, rider_ready: isoJD(B.t0), arrive_by: isoJD(B.arrive_by_jd) };
}
/** The dispatched plan stop by stop: who boards and alights there, passengers aboard as the car leaves, and the seats. */
function passengers(E, run) {
  const R = E.R, { placeName } = names(E), legs = run.route.map((id) => run.legs[id]), stops = run.plan.stops;
  const M = R.manifest({ stops, legs }), seats = R.CAR[run.car].seats;
  return stops.map((s, n) => ({ stop: n, place: { id: s.at, name: placeName(s.at) }, board: s.board || [], alight: s.alight || [], aboard: M.party[n], seats,
    ...(n ? { planned_arrive: isoJD(legs[n - 1].arr_jd) } : {}) }));
}
const sharedRules = (run) =>
  " This is a shared flight (simulated) with " + run.hails.length + " bookings, listed in bookings: one Starseeker carries them all, and passengers aboard can't exceed its seats. " +
  "Plan it with plan_leg, not plan_pickup and plan_ride: the first leg names a ship (its car field) and flies from where it is parked; each later leg names after_leg and flies on from where that one lands, " +
  "after boarding if a booking boards there. A leg's to is a booking's pickup or destination. Then dispatch with legs (the legs in order), stops (one per leg: the bookings that board and alight where it lands) " +
  "and quotes (a fare_usd and an arrival for each booking, or a window: earliest and latest). Fares are per seat: each leg's fare_usd is split by party size among the bookings aboard it, a booking pays its share of each leg it rides, " +
  "and a leg with nobody aboard is free. plan_leg's fares_so_far gives each booking's share on the stops the chain implies. Fast pickup, on time, kept promise and honest fare are scored per booking " +
  "and averaged by party size; energy is against par, the best nearby ship carrying every booking.";
const rules = (E) =>
  "Pick a Starseeker from the fleet (the car field takes its call sign). A ship with a busy_until time is finishing another (simulated) job and can't leave before then; \"free\" ships can leave when the rider is ready. " +
  "plan_pickup flies the ship from where it is parked to the rider, leaving when the rider is ready or the ship is free, whichever is later (or wait_days after that). " +
  "plan_ride flies the rider from the pickup to the destination, after boarding (or wait_days later). Then dispatch with the pickup leg, the ride leg, the fare you quote and the arrival you promise the rider. " +
  "Hazards (all simulated, the same for every player this season): you only see forecasts, and the dispatch result tells you what actually happened. " +
  "Pads have a few berths and other ships use them. check_pad shows the berths and how many are booked each hour, but about a quarter of the traffic is unscheduled and never shows in the forecast. " +
  "If every berth is taken when the ship arrives, it holds in orbit until one frees up, and holding costs 250 kWh an hour. " +
  "Solar radiation storms (space_weather gives the odds per day at a place) hold any launch with a rider aboard until the storm passes; an empty ship on its pickup can fly through. " +
  "A storm's particles leave the Sun at 1500 km/s (a fast CME), so a storm reaches Earth about a day after it erupts and Saturn about 11 days after, and fewer reach far out (1/r^2). " +
  "You dispatch from HQ on Earth, which controls every station and Starseeker: at a checkpoint the ship acts on your answer only when it arrives, after the light-time there and back (minutes at Mars, over two hours at Saturn). " +
  "Mars dust storms (Mars, Mars Base) and Titan haze (Titan, Titan Dock) close those pads: the ship waits on the ground, or holds in orbit if it is arriving. check_pad gives their odds. " +
  "A leg between planets that leaves late needs a correction burn (2% of its energy per hour late, up to 30%). " +
  "Score out of 100000, from what actually happened. The weights are placeholders. Parts are not rounded and the total is their sum. " +
  "Each part except cruise dose earns its full weight on the stated reference, and less as the ride moves off it. The falloff steepness of 6 is a simulated assumption. " +
  "fast pickup 22000 (minutes over the quickest nearby ship), arrived on time 16000 (minutes late, reference 0), " +
  "energy 31000 (kWh over par, including holds and correction burns), " +
  "kept the promise 14000 (score version 5: the arrival window you quote, earliest to latest, or the arrival alone as a window of no width, judged by its interval score: " +
  "its width in hours plus 10 times each hour the ship lands outside it. Full weight at 0, falling in a straight line to 0 at 60 h on a quick hail and 240 h on a long haul. " +
  "It is a proper score: your best window runs from the 10th to the 90th percentile of the arrival you expect, so a window costs its width and an honest one pays), " +
  "every leg checked 4000, honest fare 4000 (dollars off the ride fare), planning economy 3000 (plans past the 6 free ones; check_pad and space_weather are free), " +
  "departure window 3000 (kWh above the lowest energy departure in the search; the tool list does not mark that departure), " +
  "checkpoint recovery 3000 (kWh above a hindsight option at a checkpoint), cruise dose 0 (reported, not scored). " +
  "The fleet is Starseeker Taxis (6 seats), Shuttles (20) and Liners (100). They are fictional classes on a declared fictional drive: each leg is costed with the rocket equation on the hull, the people aboard and their supplies, and burns throttle so nobody aboard feels more than 1 g. " +
  "A Starseeker refuels at every stop, so a leg is refused when it carries more people than seats or needs more propellant than one tank holds. " +
  "Each class flies its own bookings, and the fleet's flies field says which: Taxis the quick hops inside one planet's neighbourhood, Shuttles the long hauls inside Jupiter's orbit, Liners the long hauls to or from the outer planets. A ship of the wrong class is refused. " +
  "A Liner flies one plan whatever the objective: the earliest arrival with a total burn of at most 45 km/s. " +
  "The sky clock runs 1 sky day per real second: if a leg flies between planets and its departure passes before dispatch, the hail goes cold. " +
  "In flight (simulated), the ship stops at checkpoints and asks you: a launch between planets that can't leave on time (wait for it to clear, or replan a fresh leg, which counts as a plan), " +
  "and a pad still closed or full after the ship has held ask_after_hours in orbit (hold, or divert to a nearby pad, wait on the ground and hop back). " +
  "dispatch then returns status checkpoint and a situation; answer it with decide, which returns the next situation or the score. The ride's clock waits for your answer, so nothing goes cold in flight. " +
  "You never see when a storm or haze ends, nor the unscheduled traffic; check_pad and space_weather forecast from the checkpoint's time. A ride asks at most " + E.R.MAX_CHECKPOINTS + " times, then takes the defaults. " +
  "dispatch with ask_after_hours \"never\" flies every checkpoint on its default (wait, hold) without asking.";

// A Starseeker's propellant is fictional and it has no NSTAR set point, so its legs report propellant_kg, not xenon_kg.
const tankPub = (fic, d) => (fic ? { propellant_kg: d.xenon_kg } : { xenon_kg: d.xenon_kg, set_point: d.set_point });
export function legPub(E, L) {
  const { placeName } = names(E), fic = !!(L.car && (E.SHIP_CLASSES[(E.R.CAR[L.car] || {}).ship_class] || {}).fictional);
  return {
    leg_id: L.leg_id, kind: L.role, ...(L.car ? { car: L.car } : {}), from: placeName(L.from), to: placeName(L.to), depart: isoJD(L.dep_jd), arrive: isoJD(L.arr_jd),
    tof_days: +L.tof_days.toFixed(2), burn_total_kms: L.dv, battery_kwh: L.kwh, ...tankPub(fic, L), r_au: L.r_au == null ? null : +(+L.r_au).toFixed(3),
    departures: (L.departures || []).map(({ xenon_kg, set_point, ...d }) => ({ ...d, ...tankPub(fic, { xenon_kg, set_point }) })),
    fare_usd: L.fare, refly: L.refly, ...(L.aboard != null ? { aboard: L.aboard } : {}),
    ...(L.busy_until_jd ? { car_busy_until: isoJD(L.busy_until_jd), note: "The ship was busy on another job until " + isoJD(L.busy_until_jd) + ", so this pickup leaves no earlier than then." } : {}),
  };
}

/** Key for the plan+re-fly cache: everything planLeg and refly depend on. */
export const legKey = (from, to, t, obj, endJd, ship, aboard) => ["arc12", from, to, t.toFixed(6), obj, endJd.toFixed(6), ship || "", +aboard || 0].join("|");

/** planLeg + refly, reduced to what a leg keeps (page planLegFor). arc_au is the drawn path, kept for the /flight replay.
 *  aboard: the people on the leg; a fictional-drive leg keeps it, since its burn depends on it. */
export function computeLeg(E, from, to, t, obj, endJd, ship, aboard) {
  const b = E.R.planLeg(from, to, t, obj, endJd, ship, aboard);
  const g = E.refly(b);
  const loc = !!(g && g.local);
  const departures = (b.departures || []).map((d) => ({
    depart: d.depart, arrive: d.arrive, tof_days: d.tof_days, dv_total_kms: d.dv_total_kms,
    battery_kwh: d.battery_kwh, xenon_kg: d.xenon_kg, set_point: d.set_point, r_au: d.r_au,
  }));
  return {
    from, to, dep_jd: b.dep_jd, arr_jd: b.arr_jd, tof_days: b.tof_days, dv: +b.dv_total_kms.toFixed(3), kwh: b.battery.energy_kwh, fare: b.fare.total_usd,
    xenon_kg: b.battery.propellant_kg, set_point: b.battery.set_point || null, r_au: b.r_au, window_kwh: b.window_kwh,
    throttled_kwh: b.battery.energy_kwh, departures, ...(b.battery.aboard != null ? { aboard: b.battery.aboard } : {}),
    gate: loc ? "local" : g && g.pass ? "PASS" : "FAIL",
    refly: loc ? { result: "not re-flown: local transfer" } : g && g.error ? { result: "FAIL", note: g.error }
      : { final_miss_km: +(+g.final_miss_km).toFixed(3), retarget_ms: +(+g.retarget_ms).toFixed(1), result: g.pass ? "PASS" : "FAIL" },
    // Six AU decimals lose up to 75 km per axis, enough to corrupt a local hop. Keep sub-metre waypoints.
    arc_au: (b.arc_au || []).map((p) => p.map((x) => +x.toFixed(12))),
  };
}

const ABANDONED = "this run was abandoned when a newer hail was taken";
function guardRun(run) {
  const phase = phaseOf(run);
  if (phase === "abandoned") fail(ABANDONED);
  if (phase === "in_flight") fail("this hail has already been dispatched and the ship is at a checkpoint; answer it with decide");
  if (phase === "arrived") fail("this hail has already been dispatched");
}
async function addLeg(run, role, car, from, to, t, obj, legFn, extra, aboard) {
  if (run.calls >= MAX_PLANS_PER_RUN) fail("this run has used its " + MAX_PLANS_PER_RUN + " plans; take the hail again");
  run.calls++;
  let got;
  try { got = await legFn(from, to, t, obj, SEASON_END, car || run.car, aboard || 0); }
  catch (e) { throw new GameError(String((e && e.message) || e)); }
  const id = "leg" + (++run.lseq);
  const L = Object.assign({ leg_id: id, role, ...(car ? { car } : {}) }, got.leg, extra);
  run.legs[id] = L;
  return { leg: L, cached: got.cached };
}
const defaultLegFn = (E) => (from, to, t, obj, end, ship, aboard) => ({ leg: computeLeg(E, from, to, t, obj, end, ship, aboard), cached: false });
const waitOf = (inp) => Math.max(0, Math.min(400, +inp.wait_days || 0));

/** Page planPickup(car, objective, wait). Mutates run. A plan counts even if planning then fails.
 *  The pickup leaves no earlier than R.pickupStart (the rider is ready and the car is free), plus wait_days. */
export async function planPickup(E, run, inp, legFn) {
  const R = E.R, h = R.BY[run.id];
  guardRun(run);
  if (run.hails) fail(useLegs(run));
  const car = carOf(E, inp.car);
  classFits(E, car, [h]);
  const at = R.shipAt(car, shipsOf(run));
  if (at === h.from) fail(car.name + " is already at the pickup");
  const obj = inp.objective === "time" ? "time" : "energy", wait = waitOf(inp), start = R.pickupStart(run.id, car.id, run.t0, seedOf(run), shipsOf(run));
  return addLeg(run, "pickup", car.id, at, h.from, start + wait, obj, legFn || defaultLegFn(E),
    { objective: obj, wait_days: wait, ...(start > run.t0 ? { busy_until_jd: start } : {}) });
}

/** Page planRideLeg(after, objective, wait). */
export async function planRideLeg(E, run, inp, legFn) {
  const R = E.R, h = R.BY[run.id];
  guardRun(run);
  if (run.hails) fail(useLegs(run));
  const prev = own(run.legs, inp.after_leg);
  if (!prev) fail("unknown leg_id " + inp.after_leg + ": pass the pickup leg this ride follows");
  if (prev.role !== "pickup") fail(inp.after_leg + " is a ride leg; pass the pickup leg");
  const obj = inp.objective === "time" ? "time" : "energy", wait = waitOf(inp);
  // The ride flies the pickup's ship. run.car is not set until dispatch, and a missing ship would plan this leg on the default hull.
  return addLeg(run, "ride", prev.car, h.from, h.to, prev.arr_jd + R.DWELL + wait, obj, legFn || defaultLegFn(E), { objective: obj, wait_days: wait, after: prev.leg_id }, h.party);
}

function carOf(E, q) {
  const R = E.R, key = String(q || "").toLowerCase().trim();
  return own(R.CAR, key) || R.FLEET.filter((c) => c.name.toLowerCase() === key)[0] || fail("unknown ship " + q + ". The fleet is in get_hail.");
}
// Refused before planning, so a ship of the wrong class costs no plan; dispatch refuses it too (R.check).
function classFits(E, car, hails) {
  const why = hails.map((h) => E.R.servesWhy(car, h)).filter(Boolean)[0];
  if (why) fail(why + ". Pick a ship whose flies field fits; the fleet is in get_hail.");
}
const useLegs = (run) => "this flight has " + run.hails.length + " bookings; plan it with plan_leg";

/** plan_leg, for a shared flight: one leg of the car's route. The first leaves where the car is parked once the lead
 *  booking is ready and the car is free; each later one leaves where after_leg lands, after boarding if a booking boards there. */
export async function planHop(E, run, inp, legFn) {
  const R = E.R, { placeOf, placeName } = names(E);
  guardRun(run);
  if (!run.hails) fail("this flight has one booking; plan it with plan_pickup and plan_ride");
  const ends = [...new Set(run.hails.flatMap((id) => [R.BY[id].from, R.BY[id].to]))], to = placeOf(inp.to);
  if (!to || !ends.includes(to.id)) fail("to must be a booking's pickup or destination: " + ends.map(placeName).join(", "));
  const obj = inp.objective === "time" ? "time" : "energy", wait = waitOf(inp);
  let car, from, t, extra, chain = [];
  if (inp.after_leg != null && inp.after_leg !== "") {
    const prev = own(run.legs, inp.after_leg);
    if (!prev || prev.role !== "leg") fail("unknown leg_id " + inp.after_leg + ": pass the plan_leg leg this one follows");
    if (inp.car && carOf(E, inp.car).id !== prev.car) fail(inp.after_leg + " flies " + R.CAR[prev.car].name + "; a flight is one ship");
    car = prev.car; from = prev.to;
    for (let x = prev; x; x = x.after ? own(run.legs, x.after) : null) chain.unshift(x);
    t = prev.arr_jd + (run.hails.some((id) => R.BY[id].from === from) ? R.DWELL : 0) + wait;
    extra = { after: prev.leg_id };
  } else {
    const c = carOf(E, inp.car), start = R.pickupStart(run.id, c.id, run.t0, seedOf(run), shipsOf(run));
    classFits(E, c, run.hails.map((id) => R.BY[id]));
    car = c.id; from = R.shipAt(c, shipsOf(run)); t = start + wait;
    extra = start > run.t0 ? { busy_until_jd: start } : {};
  }
  if (from === to.id) fail("this leg would start and end at " + to.name);
  // Planned for the people the chain implies aboard this leg (R.chainStops), as chainView reports and dispatch checks.
  chain.push({ from, to: to.id });
  const aboard = R.manifest({ stops: R.chainStops(run.hails, R.shipAt(R.CAR[car], shipsOf(run)), chain), legs: chain }).party[chain.length - 1];
  return addLeg(run, "leg", car, from, to.id, t, obj, legFn || defaultLegFn(E), { objective: obj, wait_days: wait, ...extra }, aboard);
}

// ---- forecasts: read-only, free (not plans). They only ever show what the engine forecasts (booked berths, odds). ----
const MAX_FORECAST_LOG = 60;
const openCheckpoint = (run) => (phaseOf(run) === "in_flight" ? run.ride.checkpoints[run.ride.pending - 1] : null);
function forecastFrom(run, inp) {
  if (inp.from == null || inp.from === "") { const cp = openCheckpoint(run); return cp ? cp.sky_at : run.t0; }
  const jd = jdOfIso(inp.from);
  if (jd == null) fail("from must be a sky time as YYYY-MM-DD HH:MM, e.g. " + isoJD(run.t0));
  if (jd < SKY.jd0 || jd > SEASON_END) fail("from must be inside this season, " + isoJD(SKY.jd0) + " to " + isoJD(SEASON_END));
  return jd;
}
function intIn(v, lo, hi, dflt, name) {
  if (v == null || v === "") return dflt;
  const n = +v;
  if (!Number.isInteger(n) || n < lo || n > hi) fail(name + " must be a whole number from " + lo + " to " + hi);
  return n;
}
function logForecast(run, entry) {
  const phase = phaseOf(run);
  if (phase !== "planning" && phase !== "in_flight") return;
  run.forecasts = run.forecasts || [];
  if (run.forecasts.length < MAX_FORECAST_LOG) run.forecasts.push(phase === "in_flight" ? Object.assign(entry, { checkpoint: run.ride.pending }) : entry);
}
const dayPub = (d) => ({ from: isoJD(d), to: isoJD(d + 1) }); // engine forecast days run noon to noon UTC (JD day_jd to day_jd + 1)

/** check_pad: berths and booked berths per hour at a place (scheduled traffic only), plus local weather odds there. */
export function checkPad(E, run, inp, nowMs) {
  const R = E.R, { placeOf } = names(E), seed = seedOf(run);
  const p = placeOf(inp.place);
  if (!p) fail("unknown place " + inp.place + ". Use a place id or name, e.g. " + R.BY[run.id].from + " or " + names(E).placeName(R.BY[run.id].to) + ".");
  const hours = intIn(inp.hours, 1, 72, 24, "hours"), from = forecastFrom(run, inp);
  const f = R.padForecast(p.id, from, hours, run.id, run.t0, seed);
  const wx = f.local_weather ? R.weatherForecast(p.id, from, Math.min(60, Math.ceil(hours / 24) + 1), seed) : null;
  logForecast(run, { tool: "check_pad", place: p.id, from: isoJD(from), hours, max_booked: Math.max(...f.hours.map((x) => x.booked)), berths: f.berths, sky_now: isoJD(skyNow(run, nowMs)) });
  return {
    run_id: run.run_id, place: { id: p.id, name: p.name }, berths: f.berths, from: isoJD(from),
    hours: f.hours.map((x) => ({ hour: isoJD(x.hour_jd), booked: x.booked, free: Math.max(0, f.berths - x.booked) })),
    local_weather: wx ? { kind: wx.kind, odds_are: wx.odds_are, days: wx.days.map((d) => Object.assign(dayPub(d.day_jd), { odds: d.odds })) } : null,
    note: "Forecast only (simulated). booked counts scheduled ships; about " + Math.round(f.unscheduled_share * 100) + "% of traffic is unscheduled and is not shown, so a pad can be full when the forecast says a berth is free. " +
      "A ship that arrives to a full pad holds in orbit at " + R.HOLD_KWH + " kWh an hour." +
      (wx ? " " + (wx.kind === "dust_storm" ? "Mars dust storms" : "Titan haze") + " can close this pad; odds are the " + wx.odds_are + "." : " No local weather closes this pad."),
  };
}

/** space_weather: odds per sky day that a solar radiation storm (flare) starts at a place (default: the open checkpoint's place, else the pickup). */
export function spaceWeather(E, run, inp, nowMs) {
  const R = E.R, { placeOf } = names(E), days = intIn(inp.days, 1, 60, 10, "days"), from = forecastFrom(run, inp);
  const cp = openCheckpoint(run), p = placeOf(inp.place == null || inp.place === "" ? (cp ? cp.place : R.BY[run.id].from) : inp.place);
  if (!p) fail("unknown place " + inp.place + ". Use a place id or name, e.g. " + R.BY[run.id].from + " or " + names(E).placeName(R.BY[run.id].to) + ".");
  const f = R.flareForecast(from, days, seedOf(run), p.id), reach = R.flareReach(p.id, from);
  logForecast(run, { tool: "space_weather", place: p.id, from: isoJD(from), days, max_odds: Math.max(...f.map((d) => d.flare_odds)), sky_now: isoJD(skyNow(run, nowMs)) });
  return {
    run_id: run.run_id, place: { id: p.id, name: p.name }, from: isoJD(from),
    storm_travel_hours: r1(reach.travel_days * 24), storm_share: Math.round(reach.share * 1000) / 1000,
    days: f.map((d) => Object.assign(dayPub(d.day_jd), { flare_odds: d.flare_odds })),
    note: "Forecast only (simulated). flare_odds is the chance a solar radiation storm starts at " + p.name + " in that sky day (noon to noon UTC). " +
      "Storms erupt at the Sun, last 4 to 48 hours (mostly short) and run in spells of about 27 days (the Sun's rotation); each reaches " + p.name + " storm_travel_hours later at 1500 km/s, " +
      "and storm_share is the share strong enough there (1/r^2 from the Sun, 1 inside Earth's orbit). " +
      "While a storm is on, no ship launches with a rider aboard: the ride waits on the ground until it passes, and a ride between planets that leaves late needs a correction burn. An empty ship on its pickup can fly through.",
  };
}

function askAfter(v) {
  if (v == null || v === "") return 1;
  if (v === "never") return "never";
  if (typeof v !== "number" || !(v >= 0 && v <= 24)) fail("ask_after_hours must be 0 to 24 hours, or \"never\"");
  return v;
}

/** Page dispatch(): checks, the cold-hail rule, then the ride flies until it arrives (scored) or stops at a checkpoint. */
export function dispatch(E, run, inp, nowMs) {
  const R = E.R, phase = phaseOf(run);
  if (phase === "abandoned") fail(ABANDONED);
  if (phase === "arrived") return Object.assign({ already_dispatched: true }, run.score);
  if (phase === "in_flight") return Object.assign(atCheckpoint(E, run), { already_dispatched: true });
  const after = askAfter(inp.ask_after_hours);
  const got = run.hails ? stopsPlan(E, run, inp) : twoLegs(E, run, inp);
  if (got.problems) return { ok: false, problems: got.problems };
  const legs = got.legs, firstFar = legs.filter((L) => L.gate !== "local")[0], now = skyNow(run, nowMs);
  if (firstFar && now > firstFar.dep_jd) {
    setPhase(run, "abandoned");
    run.abandoned_reason = "cold";
    fail("The hail went cold: " + firstFar.leg_id + " was due to depart " + isoJD(firstFar.dep_jd) + " and sky time is now " + isoJD(now) + ". Take the hail again.");
  }
  run.route = legs.map((L) => L.leg_id);
  run.car = legs[0].car;
  if (got.stops) { run.plan = { stops: got.stops }; run.quotes = got.quotes; }
  run.quote = got.quotes ? got.quotes[run.id] : got.quote;
  run.decisions = [];
  const slim = legs.map(slimLeg);
  return next(E, run, R.start(run.id, run.car, got.stops ? { stops: got.stops, legs: slim } : slim, run.t0, seedOf(run), { ask_after_hours: after, end_jd: SEASON_END, ships: shipsOf(run) }));
}
/** A one-booking dispatch: { legs: [pickup, ride] } or { problems }. */
function twoLegs(E, run, inp) {
  const p = own(run.legs, inp.pickup_leg), r = own(run.legs, inp.ride_leg);
  const probs = [];
  if (!p) probs.push("unknown pickup_leg " + inp.pickup_leg);
  if (!r) probs.push("unknown ride_leg " + inp.ride_leg);
  if (!probs.length) {
    if (p.role !== "pickup") probs.push(inp.pickup_leg + " is not a pickup leg");
    if (r.role !== "ride") probs.push(inp.ride_leg + " is not a ride leg");
    if (!probs.length) E.R.check(run.id, p.car, [p, r], run.t0, seedOf(run), shipsOf(run)).forEach((x) => probs.push(x));
    [p, r].forEach((L) => { if (L.gate === "FAIL") probs.push(L.leg_id + " was rejected by the checker"); });
  }
  const quote = quoteOf(E, { fare_usd: inp.quoted_fare_usd, arrival: inp.quoted_arrival, earliest: inp.quoted_earliest, latest: inp.quoted_latest }, "", probs);
  return probs.length ? { problems: probs } : { legs: [p, r], quote };
}
/** A booking's quote as dispatch stores it: fare_usd, arrival, and the window's earliest and latest when given. A window's
 *  ends must read as sky times and earliest can't be after latest (score v5 scores the promise as that window). */
function quoteOf(E, x, who, probs) {
  const q = { fare_usd: x.fare_usd, arrival: x.arrival };
  for (const k of ["earliest", "latest"]) if (x[k] != null) {
    q[k] = x[k];
    if (promisedJd(E, x[k]) == null) probs.push(who + k + " must be a sky time YYYY-MM-DD HH:MM");
  }
  if ((q.earliest != null || q.latest != null) && !probs.length && !E.R.quoteWindow(q)) probs.push(who + "the window runs backwards: earliest (or arrival) is after latest");
  return q;
}
/** A shared flight's dispatch: the plan_leg legs in order, a stop where each lands (who boards, who alights) and a quote per
 *  booking. Stop 0 is where the car is parked. Returns { legs, stops, quotes } or { problems }. */
function stopsPlan(E, run, inp) {
  const R = E.R, ids = run.hails;
  if (!Array.isArray(inp.legs) || !inp.legs.length || !Array.isArray(inp.stops))
    return { problems: ["this flight has " + ids.length + " bookings: dispatch with legs (the plan_leg legs in order), stops (one per leg: { board, alight }, the bookings that board and alight where it lands) and quotes ({ hail_id: { fare_usd, arrival } } for every booking)"] };
  const probs = [], legs = inp.legs.map((id) => own(run.legs, id));
  inp.legs.forEach((id, i) => { if (!legs[i]) probs.push("unknown leg " + id); else if (legs[i].role !== "leg") probs.push(id + " is not a plan_leg leg"); });
  if (inp.stops.length !== inp.legs.length) probs.push("stops has " + inp.stops.length + " entries; it needs one for each of the " + inp.legs.length + " legs");
  if (probs.length) return { problems: probs };
  const car = legs[0].car;
  if (legs.some((L) => L.car !== car)) return { problems: ["every leg must fly the same ship"] };
  const listOf = (v) => (v == null ? [] : (Array.isArray(v) ? v : [v]).map(String));
  const stops = [{ at: R.shipAt(R.CAR[car], shipsOf(run)) }, ...inp.stops.map((s, i) => ({ at: legs[i].to, board: listOf(s && s.board), alight: listOf(s && s.alight) }))];
  const on = new Set(stops.flatMap((s) => [...(s.board || []), ...(s.alight || [])])), quotes = {}, q = inp.quotes || {};
  on.forEach((id) => { if (!ids.includes(id)) probs.push(id + " is not a booking on this flight; its bookings are " + ids.join(", ")); });
  ids.forEach((id) => {
    if (!on.has(id)) probs.push(id + " is not on the plan: every booking boards and alights");
    const x = own(q, id);
    if (!x || x.fare_usd == null || (x.arrival == null && x.latest == null)) probs.push("quotes needs a fare_usd and an arrival (or a window, earliest and latest) for " + id);
    else quotes[id] = quoteOf(E, x, id + ": ", probs);
  });
  if (probs.length) return { problems: probs };
  R.check(run.id, car, { stops, legs }, run.t0, seedOf(run), shipsOf(run)).forEach((x) => probs.push(x));
  legs.forEach((L) => { if (L.gate === "FAIL") probs.push(L.leg_id + " was rejected by the checker"); });
  return probs.length ? { problems: probs } : { legs, stops, quotes };
}

const slimLeg = (L) => ({ from: L.from, to: L.to, dep_jd: L.dep_jd, arr_jd: L.arr_jd, kwh: L.kwh, fare: L.fare, gate: L.gate, ...(L.aboard != null ? { aboard: L.aboard } : {}) });
const r1 = (x) => Math.round(x * 10) / 10 || 0; // no -0
const incidentsPub = (E, list) => {
  const { placeName } = names(E);
  return list.map((x) => ({ kind: x.kind, leg: x.leg, place: placeName(x.where), at: isoJD(x.at_jd), hours: r1(x.hours), kwh: x.kwh, note: x.note }));
};

function next(E, run, st) {
  run.ride = st.ride;
  run.flight_manifest ||= { ...flightManifest(E, run), source: "recorded" };
  if (st.done) return land(E, run, st.done);
  setPhase(run, "in_flight");
  return atCheckpoint(E, run);
}
const atCheckpoint = (E, run) => ({ ok: true, status: "checkpoint", run_id: run.run_id, hail_id: run.id, situation: situation(E, run) });
const arrived = (run) => Object.assign(project(run, "arrived", { ok: true, run_id: run.run_id, hail_id: run.id, planned_by: "Grok bot (connector)", ...(run.player_id ? { player_id: run.player_id } : {}) }), run.score);

const FREE_PLANS = 6; // R.score's planning economy: 6 plans free, then a point each
/** What a ride scores beyond the engine (whose sha256 is in meta.json): bump it when land() changes what it hands R.score. */
export const SCORE_VERSION = 5;
/** The open checkpoint as a bot sees it: what stopped the car, where it stands, and what each answer costs so far. */
function situation(E, run) {
  const R = E.R, ride = run.ride, cp = openCheckpoint(run);
  const options = cp.options.map((o) =>
    o.action === "replan" ? Object.assign({}, o, { depart_after_min: isoJD(cp.reply_jd), plans_used: run.calls, plans_left: Math.max(0, MAX_PLANS_PER_RUN - run.calls), free_plans_left: Math.max(0, FREE_PLANS - run.calls) })
      : o.action === "hold" ? Object.assign({}, o, { held_hours: r1(o.held_hours), max_hold_hours_left: r1(o.max_hold_hours_left) }) : o);
  const how = cp.kind === "launch_hold"
    ? "decide with checkpoint " + cp.n + " and action \"wait\", or action \"replan\" with depart_after (at or after " + isoJD(cp.reply_jd) + ", when your answer reaches the ship; the default) and objective energy or time."
    : "decide with checkpoint " + cp.n + " and action \"hold\" (with hours to ask again after that many hours, or none to hold until the pad opens), " +
      "or action \"divert\" with place (one of the alternates) and wait_hours on the ground there (default 0).";
  return {
    checkpoint: cp.n, kind: cp.kind, cause: cp.cause, why: cp.why, place: { id: cp.place, name: cp.place_name }, leg: cp.leg, sky_at: isoJD(cp.sky_at),
    signal_delay_minutes: cp.signal_delay_minutes, reply_arrives: isoJD(cp.reply_jd), car: cp.car, rider_aboard: cp.rider_aboard, held_hours: r1(cp.held_hours), behind_plan_hours: r1(cp.behind_plan_hours), extra_kwh: cp.extra_kwh, used_kwh: cp.used_kwh,
    options, default: cp.default, checkpoints_left: R.MAX_CHECKPOINTS - ride.checkpoints.length, ask_after_hours: ride.ask_after_hours,
    incidents: incidentsPub(E, ride.incidents),
    hidden: "You never see when a storm or haze ends, nor the unscheduled traffic. check_pad and space_weather forecast from this checkpoint's sky time.",
    signal: "You dispatch from HQ on Earth, which controls every station and Starseeker. This checkpoint's news took signal_delay_minutes to reach you, and your answer takes as long back: the ship acts on it at reply_arrives, and holds or waits on the default until then.",
    note: "Simulated. The ride's clock is stopped here until you decide.",
    how_to_answer: how,
  };
}

// A quoted time, read the way R.score reads it (date, then a space or T, then HH:MM), or null.
function promisedJd(E, s) {
  const m = /^\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(s || "")), j = m ? E.jdFromIso(m[1] + "T" + m[2]) : null;
  return j != null && isFinite(j) ? j : null;
}
/** The promise as a score prints it: promised_arrival (the window's latest, or the arrival quoted alone), promised_earliest
 *  for a window, and promise_slip_hours (hours after the latest, or minus the hours before the earliest; 0 inside). */
function promiseOf(E, quote, arrive_jd, kind) {
  const w = E.R.quoteWindow(quote || {});
  if (!w) return { promised_arrival: null, promise_slip_hours: null };
  return { promised_arrival: isoJD(w.hi), ...(w.hi > w.lo ? { promised_earliest: isoJD(w.lo) } : {}), promise_slip_hours: r1(E.R.promiseScore(w, arrive_jd, kind).slip_hours) };
}
function hindsightKwh(E, run) {
  const ride = run.ride;
  if (!ride || !ride.checkpoints || !ride.checkpoints.some((cp) => cp.decision)) return null;
  let low = null;
  for (const row of E.R.regret(ride)) for (const o of row.options || []) if (low == null || o.used_kwh < low) low = o.used_kwh;
  return low;
}
function land(E, run, F) {
  const R = E.R, legs = run.route.map((id) => run.legs[id]), quote = run.quote;
  const plan = run.plan ? { stops: run.plan.stops, legs } : legs, M = R.manifest(R.planOf(run.id, run.car, plan, shipsOf(run)));
  const windowKwh = legs.reduce((a, l) => a + (l.window_kwh != null ? l.window_kwh : l.kwh), 0);
  const throttledKwh = legs.reduce((a, l) => a + (l.throttled_kwh != null ? l.throttled_kwh : l.kwh), 0);
  const sc = R.score(run.id, plan, { t0: run.t0, arrive_by_jd: run.arrive_by_jd, par_kwh: run.par_kwh, best_wait_days: run.best_wait_days, plan_calls: run.calls,
    kind: R.BY[run.id].kind, ship: run.car, window_kwh: windowKwh, throttled_kwh: throttledKwh, hindsight_kwh: hindsightKwh(E, run), quote, flown: F,
    ...(run.plan ? { bookings: Object.fromEntries(run.hails.map((id) => [id, { ...run.bookings[id], quote: run.quotes[id] }])) } : {}) });
  const P = promiseOf(E, quote, sc.arrive_jd, R.BY[run.id].kind);
  const incidents = incidentsPub(E, sc.incidents);
  setPhase(run, "arrived");
  run.pickup_jd = sc.pickup_jd; // actual, for the board's pickup wait
  run.score = project(run, "score", {
    status: "arrived", total: sc.total, out_of: sc.out_of, score_version: sc.score_version, parts: sc.parts, car: R.CAR[run.car].name,
    pickup: isoJD(sc.pickup_jd), arrive: isoJD(sc.arrive_jd), planned_pickup: isoJD(legs[M.stop[run.id].board[0] - 1].arr_jd), planned_arrive: isoJD(sc.planned_arrive_jd),
    promised_arrival: P.promised_arrival, ...(P.promised_earliest ? { promised_earliest: P.promised_earliest } : {}), arrive_by: isoJD(run.arrive_by_jd),
    delay_hours: r1(F.delay_hours), promise_slip_hours: P.promise_slip_hours,
    fare_usd: sc.fare_usd, planned_kwh: F.planned_kwh, extra_kwh: sc.extra_kwh, divert_kwh: F.divert_kwh, used_kwh: sc.used_kwh,
    par_kwh: run.par_kwh, par_car: R.CAR[run.par_car].name, beat_par: sc.beat_par, checkpoints: F.checkpoints.length,
    rider_dose_msv: sc.rider_dose_msv, incidents, ...(run.plan ? { bookings: run.hails.map((id) => bookingScore(E, run, id, sc.bookings[id])), passengers: passengers(E, run) } : {}), ...worldOf(run),
  });
  run.score.log = runLog(E, run, quote, incidents, sc, F);
  return arrived(run);
}
/** One booking's side of a shared flight's score: its times, its promise, its fare and its passenger parts. */
function bookingScore(E, run, id, b) {
  const P = promiseOf(E, run.quotes[id], b.arrive_jd, E.R.BY[id].kind);
  return { hail_id: id, title: E.R.BY[id].title, party: b.party, pickup: isoJD(b.pickup_jd), arrive: isoJD(b.arrive_jd), planned_arrive: isoJD(b.planned_arrive_jd),
    arrive_by: isoJD(run.bookings[id].arrive_by_jd), promised_arrival: P.promised_arrival, ...(P.promised_earliest ? { promised_earliest: P.promised_earliest } : {}), promise_slip_hours: P.promise_slip_hours,
    fare_usd: b.fare_usd, parts: b.parts };
}

const ACTIONS = "action must be wait, replan, hold or divert";
/** The decision as the bot asked for it, with defaults filled in, so a retry compares equal. */
function decisionOf(E, cp, inp) {
  const a = String(inp.action == null ? "" : inp.action).trim().toLowerCase(), given = (v) => v != null && v !== "";
  if (a === "wait") return { action: "wait" };
  if (a === "hold") return given(inp.hours) ? { action: "hold", hours: +inp.hours } : { action: "hold" };
  if (a === "divert") {
    const p = names(E).placeOf(inp.place);
    return { action: "divert", place: p ? p.id : String(inp.place == null ? "" : inp.place), wait_hours: given(inp.wait_hours) ? +inp.wait_hours : 0 };
  }
  if (a === "replan") return { action: "replan", depart_after: given(inp.depart_after) ? String(inp.depart_after).trim() : isoJD(cp.reply_jd), objective: inp.objective === "time" ? "time" : "energy" };
  fail(ACTIONS);
}

/** Answer the open checkpoint. The same answer again returns where the ride stands now; a different one is refused.
 *  A replan plans a fresh leg (it counts as a plan); a leg the checker rejects leaves the checkpoint open. */
export async function decide(E, run, inp, legFn) {
  const R = E.R, phase = phaseOf(run);
  if (phase === "abandoned") fail(ABANDONED);
  if (phase === "planning") fail("this hail has not been dispatched; dispatch first, then decide at its checkpoints");
  const ride = run.ride, seen = ride ? ride.checkpoints.length : 0, n = +inp.checkpoint;
  if (!Number.isInteger(n) || n < 1) fail("checkpoint must be a whole number, 1 or more");
  if (n > seen) fail("checkpoint " + n + " has not happened; " + (phase === "in_flight" ? "the open checkpoint is " + ride.pending : "the ride arrived after " + seen + " checkpoint" + (seen === 1 ? "" : "s")));
  const cp = ride.checkpoints[n - 1], input = decisionOf(E, cp, inp), prev = (run.decisions || [])[n - 1];
  if (prev) {
    if (JSON.stringify(prev) !== JSON.stringify(input)) fail("checkpoint " + n + " was already decided: " + JSON.stringify(prev));
    return Object.assign(phase === "in_flight" ? atCheckpoint(E, run) : arrived(run), { already_decided: true });
  }
  const ev = R.EVENTS[cp.kind];
  if (!ev.options.includes(input.action)) fail("a " + cp.kind + " checkpoint takes " + ev.options.join(" or ") + ", not " + input.action);
  let decision = input;
  if (input.action === "replan") {
    if (run.calls >= MAX_PLANS_PER_RUN) fail("this run has used its " + MAX_PLANS_PER_RUN + " plans; answer with wait instead");
    const jd = jdOfIso(input.depart_after), latest = Math.min(cp.reply_jd + 400, SEASON_END);
    if (jd == null) fail("depart_after must be a sky time as YYYY-MM-DD HH:MM, at or after " + isoJD(cp.reply_jd));
    if (jd < cp.reply_jd - 1 / 1440) fail("a replan must depart at or after " + isoJD(cp.reply_jd) + ", when your answer reaches the ship");
    if (jd > latest) fail("depart_after must be by " + isoJD(latest));
    const S = ride.segs[ride.at.seg], aboard = R.manifest({ stops: ride.stops, legs: ride.legs }).party[S.stop - 1];
    const { leg: L } = await addLeg(run, S.role, run.car, S.from, S.to, Math.max(jd, cp.reply_jd), input.objective, legFn || defaultLegFn(E),
      { objective: input.objective, wait_days: 0, replan_of: n }, aboard);
    if (L.gate === "FAIL") fail(L.leg_id + " was rejected by the checker; checkpoint " + n + " is still open (wait, or replan from another time)");
    decision = { action: "replan", leg: slimLeg(L) };
  }
  let st;
  try { st = R.step(ride, decision); }
  catch (e) { throw new GameError(String((e && e.message) || e)); }
  run.decisions = run.decisions || [];
  run.decisions[n - 1] = input;
  return next(E, run, st);
}

// ---- applyTool: every run-scoped tool call, the one way a run changes in the live game and in a bench run. ----
const planned = (E, run, { leg, cached }) => Object.assign(legPub(E, leg), leg.role === "leg" ? chainView(E, run, leg) : {}, { plans_used: run.calls, cached });
/** A plan_leg leg's chain back to the ship's first leg, priced on the stops it implies (R.chainStops): who is aboard this leg,
 *  and each booking's fare per seat for the legs so far. The dispatch prices the stops it is given. */
function chainView(E, run, L) {
  const R = E.R, chain = [];
  for (let x = L; x; x = x.after ? own(run.legs, x.after) : null) chain.unshift(x);
  const stops = R.chainStops(run.hails, R.shipAt(R.CAR[chain[0].car], shipsOf(run)), chain), M = R.manifest({ stops, legs: chain });
  return { aboard: M.party[chain.length - 1], fares_so_far: R.seatFares({ stops, legs: chain }) };
}
const RUN_TOOLS = {
  get_hail: (E, run, inp, ctx) => hailInfo(E, run, ctx.nowMs),
  plan_pickup: async (E, run, inp, ctx) => planned(E, run, await planPickup(E, run, inp, ctx.legFn)),
  plan_ride: async (E, run, inp, ctx) => planned(E, run, await planRideLeg(E, run, inp, ctx.legFn)),
  plan_leg: async (E, run, inp, ctx) => planned(E, run, await planHop(E, run, inp, ctx.legFn)),
  check_pad: (E, run, inp, ctx) => checkPad(E, run, inp, ctx.nowMs),
  space_weather: (E, run, inp, ctx) => spaceWeather(E, run, inp, ctx.nowMs),
  dispatch: (E, run, inp, ctx) => dispatch(E, run, inp, ctx.nowMs),
  decide: (E, run, inp, ctx) => decide(E, run, inp, ctx.legFn),
};
/** Counts one call on a bench run (budget set), or refuses it once the budget is used; a season run counts none.
 *  applyTool counts the run-scoped tools; a bench host counts list_hails, take_hail and get_my_rides with it too. */
export function spend(run) {
  if (run.budget == null) return;
  if (run.tool_calls >= run.budget) fail("this task has used its budget of " + run.budget + " tool calls; no more calls are answered");
  run.tool_calls++;
}
/** One tool call: { run, result }. The run passed in is never changed. run is the run after the call, or null when the call
 *  left it as it was, so a caller saves exactly when it is not null (a failed plan still counts, a cold hail is abandoned).
 *  result is the tool's answer, or { error } for a game error. ctx: { nowMs, legFn? }. */
/** The run-scoped tools, the ones applyTool answers. */
export const RUN_TOOL_NAMES = Object.keys(RUN_TOOLS);
export async function applyTool(E, run, tool, input, ctx) {
  const apply = own(RUN_TOOLS, tool);
  if (!apply) throw new Error("not a run tool: " + tool);
  const next = structuredClone(run);
  let result;
  try {
    spend(next);
    result = await apply(E, next, input, ctx);
  } catch (e) {
    if (!(e instanceof GameError)) throw e;
    result = { error: e.message };
  }
  if (run.tag == null && tool !== "get_hail" && (phaseOf(run) === "planning" || phaseOf(run) === "in_flight")) {
    if ((tool === "dispatch" || tool === "decide") && !result.error && !result.already_dispatched && !result.already_decided
      && (result.status === "checkpoint" || result.status === "arrived")) Object.assign(result, flyLive(next, ctx.nowMs));
    logTrail(E, next, tool, input, result, ctx.nowMs);
  }
  return { run: JSON.stringify(next) === JSON.stringify(run) ? null : next, result };
}

// ---- a season flight, live: its playback track (live.js) and the dispatcher log of the bot's calls, both public on /flight. ----
/** Puts the ride flown so far on the run's playback track, and says when the player sees it land: { lands_in_s, ... }. */
export function flyLive(run, nowMs) {
  const ride = run.ride, landed = phaseOf(run) === "arrived", end = landed ? ride.arrive_jd : openCheckpoint(run).sky_at;
  if (!run.live) { const mpu = msPerUnit(run.route.map((id) => run.legs[id])); run.live = { ms_per_unit: mpu, track: startTrack(ride, end, mpu, nowMs) }; }
  else run.live.track = extendTrack(run.live.track, pieces(ride, end), run.live.ms_per_unit, nowMs);
  const tr = run.live.track, reach = Math.max(0, Math.round((tr[tr.length - 1][0] - nowMs) / 1000));
  if (landed) return { lands_in_s: reach, playback: "Simulated playback: the Starseeker is flying this ride now on the watch page and lands there in lands_in_s seconds. The score in this result is final." };
  return { checkpoint_in_s: reach, lands_in_s: reach + Math.round((unitsLeft(ride) * run.live.ms_per_unit) / 1000),
    playback: "Simulated playback: the Starseeker is flying now on the watch page. It reaches this checkpoint there in checkpoint_in_s seconds and holds until you decide. Answered by then, it lands in about lands_in_s seconds if the rest flies as planned." };
}
const TRAIL_MAX = 80;
/** One dispatcher-log entry per run-tool call on a season run: when, the tool, what it asked and got, and the bot's note. */
function logTrail(E, run, tool, inp, result, nowMs) {
  const e = { at_ms: nowMs, sky: isoJD(skyNow(run, nowMs)), tool, ...(result.error ? { error: String(result.error).slice(0, 160) } : trailOf(E, run, tool, inp, result)) };
  const note = (tool === "dispatch" || tool === "decide") && typeof inp.note === "string" ? inp.note.trim().slice(0, 300) : "";
  if (note) e.note = note;
  const all = [...(run.trail || []), e], head = all[0].tool === "take_hail" ? 1 : 0; // the take_hail entry names the agent: keep it
  run.trail = all.length > TRAIL_MAX ? [...all.slice(0, head), ...all.slice(all.length - (TRAIL_MAX - head))] : all;
}
/** The agent's MCP client name and version as it reported them at initialize (self-reported), kept short and plain. */
export function agentOf(client) {
  const clean = (s, n) => (typeof s === "string" ? s.replace(/[^\w .@/+-]/g, "").trim().slice(0, n) : "");
  const name = clean(client && client.name, 48);
  return name ? { name, ...(clean(client.version, 24) ? { version: clean(client.version, 24) } : {}) } : null;
}
/** The dispatcher log's first entry on a season run: which booking the agent took, and which agent it said it was. */
export function logTake(E, run, nowMs, client) {
  if (run.tag != null) return;
  const agent = agentOf(client);
  run.trail = [{ at_ms: nowMs, sky: isoJD(skyNow(run, nowMs)), tool: "take_hail", hail_id: run.id, title: run.title, ...(agent ? { agent } : {}) }];
}
const maxOf = (xs) => (xs.length ? Math.max(...xs) : null);
function trailOf(E, run, tool, inp, r) {
  if (tool === "check_pad") {
    const w = r.local_weather;
    return { place: r.place.name, berths: r.berths, max_booked: maxOf(r.hours.map((h) => h.booked)), ...(w ? { weather: w.kind, max_odds: maxOf(w.days.map((d) => d.odds)) } : {}) };
  }
  if (tool === "space_weather") return { place: r.place.name, max_flare_odds: maxOf(r.days.map((d) => d.flare_odds)) };
  if (tool === "dispatch") {
    if (r.problems) return { problems: r.problems.slice(0, 3).map((p) => String(p).slice(0, 120)) };
    return { route: run.route.slice(), car: E.R.CAR[run.car].name, fare_usd: run.quote.fare_usd, arrival: run.quote.arrival,
      ...(run.quote.earliest != null ? { earliest: run.quote.earliest } : {}), ...(run.quote.latest != null ? { latest: run.quote.latest } : {}), status: r.status,
      ...(run.quotes ? { quotes: run.quotes } : {}) };
  }
  if (tool === "decide") {
    const d = run.decisions[inp.checkpoint - 1], cp = run.ride.checkpoints[inp.checkpoint - 1];
    return { checkpoint: cp.n, kind: cp.kind, checkpoint_at: isoJD(cp.sky_at), decision: d, status: r.status };
  }
  const L = run.legs[r.leg_id];
  return { leg_id: r.leg_id, kind: r.kind, from: r.from, to: r.to, depart: r.depart, arrive: r.arrive, kwh: r.battery_kwh, fare_usd: r.fare_usd, gate: L.gate };
}

/** The run log a bot can learn from: what it was asked, what it planned and checked, what happened, how it scored. */
function runLog(E, run, quote, incidents, sc, F) {
  const R = E.R, h = R.BY[run.id];
  return project(run, "log", {
    hail: run.id, kind: kindOf(h), ...worldOf(run), from: h.from, to: h.to, rider_ready: isoJD(run.t0), arrive_by: isoJD(run.arrive_by_jd),
    car: run.car, par_car: run.par_car, par_kwh: run.par_kwh,
    fleet: R.fleetState(run.id, run.t0, seedOf(run), shipsOf(run)).filter((c) => c.busy_until_jd).map((c) => ({ car: c.car, busy_until: isoJD(c.busy_until_jd) })),
    planned: Object.values(run.legs).map((L) => ({ leg: L.leg_id, kind: L.role, ...(L.car ? { car: L.car } : {}), ...(L.after ? { after: L.after } : {}), ...(L.replan_of ? { replan_of: L.replan_of } : {}),
      objective: L.objective, wait_days: L.wait_days, depart: isoJD(L.dep_jd), arrive: isoJD(L.arr_jd), kwh: L.kwh, gate: L.gate })),
    dispatched: run.route.slice(), quote: { fare_usd: quote.fare_usd, arrival: quote.arrival, ...(quote.earliest != null ? { earliest: quote.earliest } : {}), ...(quote.latest != null ? { latest: quote.latest } : {}) },
    ...(run.plan ? { hails: run.hails, stops: run.plan.stops, quotes: run.quotes } : {}),
    forecasts: run.forecasts || [],
    ...(F.checkpoints.length ? { checkpoints: checkpointLog(E, run) } : {}),
    flown: F.segments.map((s) => ({ kind: s.kind, leg: s.role, from: s.from, to: s.to, depart: isoJD(s.dep_jd), arrive: isoJD(s.arr_jd), kwh: s.kwh, gate: s.gate })),
    happened: { pickup: isoJD(sc.pickup_jd), arrive: isoJD(sc.arrive_jd), extra_kwh: sc.extra_kwh, divert_kwh: F.divert_kwh, used_kwh: sc.used_kwh },
    ...(run.plan ? { bookings: Object.fromEntries(run.hails.map((id) => { const b = sc.bookings[id];
      return [id, { pickup: isoJD(b.pickup_jd), arrive: isoJD(b.arrive_jd), parts: Object.fromEntries(b.parts.map((x) => [x.key, x.got])) }]; })) } : {}),
    incidents: incidents.map((x) => ({ kind: x.kind, leg: x.leg, place: x.place, at: x.at, hours: x.hours, kwh: x.kwh })),
    parts: Object.fromEntries(sc.parts.map((x) => [x.key, x.got])), total: sc.total,
  });
}
/** Each checkpoint, what was decided, and (with hindsight, simulated) what every choice there would have used. */
function checkpointLog(E, run) {
  const rows = E.R.regret(run.ride);
  return run.ride.checkpoints.map((cp, i) => {
    const d = cp.decision, row = rows[i];
    return {
      n: cp.n, kind: cp.kind, cause: cp.cause, leg: cp.leg, place: cp.place, at: isoJD(cp.sky_at),
      decision: d && d.action === "replan" ? { action: "replan", depart: isoJD(d.leg.dep_jd), kwh: d.leg.kwh } : d,
      ...(row ? { options_hindsight: row.options.map((o) => ({ option: o.option, used_kwh: o.used_kwh, arrive: isoJD(o.arrive_jd) })) } : {}),
    };
  });
}

// ---- ride history (get_my_rides): every number is copied from the run, its score and its log. ----
export const RIDE_FORMAT = "starfare.ride/1";
const SIM_NOTE = "Simulated riders, fleet and hazards; planet positions are real (JPL DE421).";
const takenAt = (run) => new Date(run.created_ms || 0).toISOString();
/** One row of a player's history: the ride's terms, and once it arrived, its score, incidents and each checkpoint's hindsight best. */
export function rideSummary(E, run) {
  const phase = phaseOf(run), h = own(E.R.BY, run.id);
  const base = { run_id: run.run_id, hail_id: run.id, ...(run.hails ? { hails: run.hails } : {}), title: run.title, kind: h ? kindOf(h) : null, ...worldOf(run), phase, taken_at: takenAt(run),
    rider_ready: isoJD(run.t0), arrive_by: isoJD(run.arrive_by_jd), plans_used: run.calls, forecasts_used: (run.forecasts || []).length };
  if (phase === "abandoned") return project(run, "summary", Object.assign(base, { reason: run.abandoned_reason || null }));
  if (phase === "in_flight") return project(run, "summary", Object.assign(base, { open_checkpoint: run.ride.pending }));
  if (phase !== "arrived") return project(run, "summary", base);
  const s = run.score, cps = (s.log && s.log.checkpoints) || [];
  return project(run, "summary", Object.assign(base, {
    car: s.car, par_car: s.par_car, total: s.total, out_of: s.out_of, parts: Object.fromEntries(s.parts.map((x) => [x.key, { got: x.got, max: x.max }])),
    used_kwh: s.used_kwh, par_kwh: s.par_kwh, beat_par: s.beat_par, promised_arrival: s.promised_arrival, ...(s.promised_earliest ? { promised_earliest: s.promised_earliest } : {}), arrive: s.arrive,
    promise_slip_hours: s.promise_slip_hours, delay_hours: s.delay_hours,
    incidents: s.incidents.map((x) => ({ kind: x.kind, place: x.place, hours: x.hours, kwh: x.kwh })),
    checkpoints: cps.map((c) => ({ n: c.n, kind: c.kind, cause: c.cause, decision: c.decision, options_hindsight: c.options_hindsight || [] })),
  }));
}
/** The full ride as get_my_rides' detail mode and the /rides downloads give it: the score and the whole run log. */
export function rideRecord(E, run) {
  const phase = phaseOf(run), arrivedRun = phase === "arrived";
  let score = null, log = null;
  if (arrivedRun) { const { log: l, ...rest } = run.score; score = rest; log = l || null; }
  return project(run, "record", {
    format: RIDE_FORMAT, simulated: true, note: SIM_NOTE, run_id: run.run_id, player_tag: run.player_id ? run.player_id.slice(2, 8) : null,
    hail_id: run.id, ...worldOf(run), phase, taken_at: takenAt(run),
    ...(phase === "abandoned" ? { reason: run.abandoned_reason || null } : {}), ...(phase === "in_flight" ? { open_checkpoint: run.ride.pending } : {}),
    score, log,
  });
}
/** One run as the agent page (/agent/<token>) shows it: the booking, where it stands and the agent's log from take_hail on.
 *  watch is set once the flight page has something to fly (dispatched and in the air, or arrived). Season runs only. */
export function followView(run) {
  const phase = phaseOf(run), cp = phase === "in_flight" && run.ride ? openCheckpoint(run) : null;
  return {
    run_id: run.run_id, hail_id: run.id, title: run.title, phase, created_ms: run.created_ms,
    watch: phase === "arrived" || (phase === "in_flight" && !!run.live),
    waiting: cp ? { n: cp.n, kind: cp.kind, place_name: cp.place_name || null, at: isoJD(cp.sky_at) } : null,
    total: phase === "arrived" && run.score ? run.score.total : null,
    // When the live playback lands (real ms): an arrived run's score is final at dispatch, but pages show it at landing.
    land_ms: run.live && run.live.track && run.live.track.length ? run.live.track[run.live.track.length - 1][0] : null,
    trail: run.trail || [],
  };
}
/** The public record of a season flight with live playback, arrived or still flying: rideRecord plus live (the track and the
 *  ride flown so far, no hindsight) and trail (the dispatcher log). Dispatched runs also carry a public manifest.
 *  Bench runs have no live track or dispatcher trail. */
export function liveRecord(E, run, nowMs) {
  const rec = rideRecord(E, run);
  if (run.ride) rec.manifest = { ...flightManifest(E, run),
    flown_stops: run.ride.segs.filter((S) => S.flew).map((S) => S.flew.land_jd != null && S.to === S.target ? segmentStop(S) : null),
  };
  if (run.tag != null || !run.live || !run.ride) return rec;
  const ride = run.ride, cp = openCheckpoint(run), { placeName } = names(E), iso = (jd) => (jd == null ? null : isoJD(jd)), tr = run.live.track;
  const flown = ride.segs.filter((S) => S.flew).map((S) => {
    const f = S.flew, done = f.land_jd ?? f.left_jd, end = done ?? (cp ? cp.sky_at : null);
    return { kind: S.kind, leg: S.role, leg_id: segmentLeg(run, S), stop: f.land_jd != null && S.to === S.target ? segmentStop(S) : null,
      from: S.from, to: S.to, depart: iso(f.dep_jd), orbit: iso(f.orbit_jd), arrive: iso(end), kwh: S.kwh, gate: S.gate, ...(done == null ? { open: true } : {}) };
  });
  const planned = ride.segs.filter((S) => !S.flew).map((S) => ({ kind: S.kind, leg: S.role, leg_id: segmentLeg(run, S), stop: S.to === S.target ? segmentStop(S) : null,
    from: S.from, to: S.to, depart: iso(S.dep_jd), arrive: iso(S.arr_jd), kwh: S.kwh, gate: S.gate }));
  const h = E.R.BY[run.id];
  return {
    ...rec,
    live: {
      simulated: true, now_ms: nowMs, track: tr, lands_at_ms: phaseOf(run) === "arrived" ? tr[tr.length - 1][0] : null,
      hold: cp ? { n: cp.n, kind: cp.kind, cause: cp.cause, place: cp.place, place_name: cp.place_name, at: isoJD(cp.sky_at) } : null,
      car: E.R.CAR[run.car].name, title: run.title, from: h.from, to: h.to, flown, planned,
      checkpoints: ride.checkpoints.map((c, i) => ({ n: c.n, kind: c.kind, cause: c.cause, leg: c.leg, place: c.place, place_name: placeName(c.place), at: isoJD(c.sky_at),
        decision: (run.decisions || [])[i] || null })),
      incidents: incidentsPub(E, ride.incidents),
    },
    trail: run.trail || [],
  };
}
/** New dispatches retain a manifest snapshot. Older runs explicitly label reconstruction from the current engine. */
export function flightManifest(E, run) {
  if (run.flight_manifest) return run.flight_manifest;
  const R = E.R, legs = run.route.map((id) => run.legs[id]);
  const plan = run.ride.stops ? run.ride : R.planOf(run.id, run.car, legs);
  return { source: "reconstructed", car: run.car, seats: R.CAR[run.car].seats,
    bookings: (run.hails || [run.id]).map((id) => {
      const h = (run.booking_rows || []).find((b) => b.id === id) || R.BY[id];
      return { hail_id: id, title: h.title, rider: h.rider, party: h.party, from: h.from, to: h.to };
    }),
    stops: plan.stops.map((s) => ({ at: s.at, board: s.board || [], alight: s.alight || [] })),
  };
}
/** A segment keeps its original stop number through diversions. Replans have their own stored leg and arc. */
const segmentStop = (S) => S.stop ?? (S.role === "pickup" ? 1 : 2);
function segmentLeg(run, S) {
  if (S.kind === "planned") return run.route[segmentStop(S) - 1] || null;
  if (S.kind === "replan") return Object.values(run.legs).find((L) => L.replan_of && L.from === S.from && L.to === S.to && L.dep_jd === S.dep_jd && L.arr_jd === S.arr_jd && L.kwh === S.kwh && L.gate === S.gate)?.leg_id || null;
  return null;
}
/** The home map's row for a season flight in playback: what it flew so far and its track; land_ms once it has landed. */
export function liveRow(E, run) {
  const tr = run.live.track, ride = run.ride, cp = openCheckpoint(run);
  return {
    run_id: run.run_id, land_ms: phaseOf(run) === "arrived" ? tr[tr.length - 1][0] : null,
    v: { run_id: run.run_id, hail_id: run.id, title: run.title, ship: E.R.CAR[run.car].name, home: ride.segs[0].from,
      hold: cp ? { kind: cp.kind, cause: cp.cause, place: cp.place } : null,
      manifest: flightManifest(E, run),
      legs: ride.segs.filter((S) => S.flew).map((S) => ({ kind: S.role, car: run.car, leg_id: segmentLeg(run, S),
        stop: S.flew.land_jd != null && S.to === S.target ? segmentStop(S) : null, from: S.from, to: S.to,
        dep_jd: S.flew.dep_jd, orbit_jd: S.flew.orbit_jd ?? null, arr_jd: S.flew.land_jd ?? S.flew.left_jd ?? openCheckpoint(run)?.sky_at ?? null })),
      track: tr },
  };
}
const mean1 = (xs) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
/** Per-hail sums and means over arrived summaries (newest first): rides, best, last and mean total, the mean of each part,
 *  and the part with the most points lost on average. */
export function rideStats(rows) {
  const by = new Map();
  for (const r of rows) if (r.phase === "arrived") { if (!by.has(r.hail_id)) by.set(r.hail_id, []); by.get(r.hail_id).push(r); }
  return [...by].map(([hail_id, rs]) => {
    const keys = Object.keys(rs[0].parts), parts = {};
    let lost = null;
    for (const k of keys) {
      const have = rs.filter((r) => r.parts[k]), m = mean1(have.map((r) => r.parts[k].got)), l = mean1(have.map((r) => r.parts[k].max - r.parts[k].got));
      parts[k] = m;
      if (l > 0 && (!lost || l > lost.mean_lost)) lost = { part: k, mean_lost: l, max: have[0].parts[k].max };
    }
    return { hail_id, rides: rs.length, best_total: Math.max(...rs.map((r) => r.total)), last_total: rs[0].total, mean_total: mean1(rs.map((r) => r.total)),
      mean_parts: parts, lost_most: lost, note: "computed from your " + rs.length + " arrived ride" + (rs.length === 1 ? "" : "s") + " of " + hail_id };
  });
}
/** A booking counts toward the season ranking once its bot planned or read a forecast for it: from then on, dropping it
 *  is a choice made with knowledge of the ride. Summaries written before forecasts_used existed count plans only. */
export const engaged = (run) => run.calls > 0 || !!(run.forecasts && run.forecasts.length);
export const isAttempt = (s) => s.plans_used > 0 || s.forecasts_used > 0;
export const RANK_MIN_ATTEMPTS = 3, RANK_ROWS = 20;
/** The season ranking (/board): per player, the mean total over every attempt, where a booking that has not arrived
 *  (abandoned, or still open) counts 0, so keeping only the good draws does not pay. rows: { player_id, phase, total,
 *  plans_used, forecasts_used }. A player with fewer than min attempts is counted but not ranked. */
export function seasonStandings(rows, min = RANK_MIN_ATTEMPTS) {
  const by = new Map();
  for (const r of rows) {
    if (!isAttempt(r)) continue;
    const p = by.get(r.player_id) || { attempts: 0, arrived: 0, sum: 0, best: null };
    p.attempts++;
    if (r.phase === "arrived" && typeof r.total === "number") { p.arrived++; p.sum += r.total; p.best = Math.max(p.best ?? r.total, r.total); }
    by.set(r.player_id, p);
  }
  const all = [...by].map(([id, p]) => ({ player_tag: id.slice(2, 8), attempts: p.attempts, arrived: p.arrived, mean: Math.round((p.sum / p.attempts) * 10) / 10, best: p.best }));
  const ranked = all.filter((p) => p.attempts >= min).sort((a, b) => b.mean - a.mean || b.attempts - a.attempts || (a.player_tag < b.player_tag ? -1 : 1));
  return { min_attempts: min, players: all.length, unranked: all.length - ranked.length, ranked: ranked.slice(0, RANK_ROWS).map((p, i) => ({ rank: i + 1, ...p })) };
}
/** get_my_rides paging: an opaque cursor for the last row of a page (newest first by created_ms, then run_id). */
export const rideCursor = (row) => btoa(row.created_ms + ":" + row.run_id).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function rideCursorOf(c) {
  let s = null;
  try { s = atob(String(c).replace(/-/g, "+").replace(/_/g, "/")); } catch { s = null; }
  const m = s && /^(\d{1,15}):(run_[0-9a-f]{20})$/.exec(s);
  if (!m) fail("cursor is not one get_my_rides gave; leave it out for the first page");
  return { created_ms: +m[1], run_id: m[2] };
}

/** check_in's fields as plain short text: what the agent says about itself, and the client name and version it reported at initialize. */
const clip = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n) : "");
export function checkInInfo(input, client) {
  const skills = Array.isArray(input.skills) ? input.skills.map((x) => clip(x, 40)).filter(Boolean).slice(0, 12) : [];
  return {
    name: clip(input.agent_name, 60) || null, model: clip(input.model, 60) || null, thinking: clip(input.thinking, 40) || null, skills,
    client: client && client.name ? { name: clip(client.name, 60), version: clip(client.version, 30) || null } : null,
  };
}
