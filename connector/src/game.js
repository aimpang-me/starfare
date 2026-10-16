// Starfare ride hails over MCP: the same game as the in-page dispatcher in sol/world/template.html, as pure
// functions over a plain run object. A simulated rider hails a robotaxi; the bot picks a car from the simulated
// fleet, plans the pickup and the ride, quotes the fare and arrival, and dispatches. Rules and scoring live in the
// engine (SOLE.R, sol/world/engine/sol-rides.js). The engine's simulated hazards (busy pads, solar flares, Mars dust,
// Titan haze, busy cars) are seeded by the sky season number, so a season plays the same for everyone; the bot only
// ever sees forecasts (check_pad, space_weather), and R.fly decides what happened when it dispatches.
// No Workers APIs here, so it runs the same in a Durable Object and in plain Node.
import META from "./engine/meta.json" with { type: "json" };

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
/** "YYYY-MM-DD HH:MM" (UTC sky time) to JD, or null. Rejects dates that do not exist (2030-02-30). */
export function jdOfIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(String(s == null ? "" : s).trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (!isFinite(ms) || new Date(ms).toISOString().slice(0, 16).replace("T", " ") !== m.slice(1, 4).join("-") + " " + m[4] + ":" + m[5]) return null;
  return ms / 864e5 + 2440587.5;
}
const kindOf = (h) => (h.kind === "quick" ? "quick" : "long haul");

export function listHails(E) {
  const R = E.R, { placeName } = names(E);
  return R.HAILS.map((h) => ({
    hail_id: h.id, title: h.title, kind: kindOf(h), rider: h.rider + " (simulated)", blurb: h.blurb,
    from: { id: h.from, name: placeName(h.from) }, to: { id: h.to, name: placeName(h.to) },
    ready: h.kind === "quick" ? "1 sky day after take_hail" : R.LEAD + " sky days after take_hail (a booked ride)",
  }));
}
export function fleet(E) {
  const { placeName } = names(E);
  return E.R.FLEET.map((c) => ({ car: c.id, name: c.name, parked_at: { id: c.at, name: placeName(c.at) } }));
}
/** The fleet as it stands for this run: each car is "free" or busy on another (simulated) job until busy_until. */
export function runFleet(E, run) {
  const st = {};
  E.R.fleetState(run.id, run.t0, seedOf(run)).forEach((c) => { st[c.car] = c.busy_until_jd; });
  return fleet(E).map((c) => Object.assign(c, { busy_until: st[c.car] ? isoJD(st[c.car]) : "free" }));
}

/** Page takeHail(): t0 and the hazard seed (the season number) from the sky clock, then R.terms. termsFn lets the
 *  caller cache R.terms; its cache key must include the seed. */
export async function newRun(E, hailId, nowMs, runId, termsFn) {
  const R = E.R, h = own(R.BY, hailId);
  if (!h) fail("unknown hail_id " + hailId + ". Call list_hails for the ids.");
  const s = sky(nowMs), seed = String(s.season);
  const t0 = Math.floor(s.jd + (h.kind === "quick" ? 1 : R.LEAD)) + 0.5;
  if (t0 + 30 > SEASON_END) fail("The season ends too soon for a new hail. Wait for the reset.");
  const T = await (termsFn ? termsFn(hailId, t0, SEASON_END, seed) : R.terms(hailId, t0, SEASON_END, seed));
  return {
    run_id: runId, id: hailId, title: h.title, t0, seed, arrive_by_jd: T.arrive_by_jd, par_kwh: T.par.kwh, par_car: T.par.car,
    best_wait_days: T.par.best_wait_days, calls: 0, lseq: 0, legs: {}, forecasts: [], phase: "planning", score: null, created_ms: nowMs,
  };
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
  const R = E.R, h = R.BY[run.id], { placeName } = names(E), s = sky(nowMs), phase = phaseOf(run);
  return {
    run_id: run.run_id, hail_id: run.id, title: h.title, rider: h.rider + " (simulated)", note: h.blurb,
    pickup_at: { id: h.from, name: placeName(h.from) }, destination: { id: h.to, name: placeName(h.to) },
    rider_ready: isoJD(run.t0), arrive_by: isoJD(run.arrive_by_jd), boarding_hours: +(R.DWELL * 24).toFixed(2), season: +seedOf(run),
    fleet: runFleet(E, run), sky_now: isoJD(s.jd), plans_used: run.calls, phase, dispatched: phase === "in_flight" || phase === "arrived",
    ...(phase === "in_flight" ? { situation: situation(E, run) } : {}), ...(run.player_id ? { player_id: run.player_id } : {}),
    rules: rules(E),
  };
}
const rules = (E) =>
  "Pick a car from the fleet. A car with a busy_until time is finishing another (simulated) job and can't leave before then; \"free\" cars can leave when the rider is ready. " +
  "plan_pickup flies the car from where it is parked to the rider, leaving when the rider is ready or the car is free, whichever is later (or wait_days after that). " +
  "plan_ride flies the rider from the pickup to the destination, after boarding (or wait_days later). Then dispatch with the pickup leg, the ride leg, the fare you quote and the arrival you promise the rider. " +
  "Hazards (all simulated, the same for every player this season): you only see forecasts, and the dispatch result tells you what actually happened. " +
  "Pads have a few berths and other ships use them. check_pad shows the berths and how many are booked each hour, but about a quarter of the traffic is unscheduled and never shows in the forecast. " +
  "If every berth is taken when the car arrives, it holds in orbit until one frees up, and holding costs 250 kWh an hour. " +
  "Solar radiation storms (space_weather gives the odds per day at a place) hold any launch with a rider aboard until the storm passes; an empty car on its pickup can fly through. " +
  "A storm's particles leave the Sun at 1500 km/s (a fast CME), so a storm reaches Earth about a day after it erupts and Saturn about 11 days after, and fewer reach far out (1/r^2). " +
  "You dispatch from HQ on Earth, which controls every station and car: at a checkpoint the car acts on your answer only when it arrives, after the light-time there and back (minutes at Mars, over two hours at Saturn). " +
  "Mars dust storms (Mars, Mars Base) and Titan haze (Titan, Titan Dock) close those pads: the car waits on the ground, or holds in orbit if it is arriving. check_pad gives their odds. " +
  "A leg between planets that leaves late needs a correction burn (2% of its energy per hour late, up to 30%). " +
  "Score out of 100, from what actually happened: fast pickup 20 (versus the quickest nearby car), arrived on time 20 (falls to 0 at half the trip's allowed time late), " +
  "energy 20 (kWh actually flown, including holds and correction burns, versus par: the best nearby car flown through the same hazards), " +
  "kept the promise 15 (the arrival you quote is a promise: full marks for arriving when promised, 0 at 6 hours late on a quick hail or 1 day late on a long haul, arriving early costs a quarter as much), " +
  "every leg checked 10, honest fare 10 (within $1 of the ride leg's fare_usd), planning economy 5 (6 plans free, then a point each; check_pad and space_weather are free). " +
  "The sky clock runs 1 sky day per real second: if a leg flies between planets and its departure passes before dispatch, the hail goes cold. " +
  "In flight (simulated), the car stops at checkpoints and asks you: a launch between planets that can't leave on time (wait for it to clear, or replan a fresh leg, which counts as a plan), " +
  "and a pad still closed or full after the car has held ask_after_hours in orbit (hold, or divert to a nearby pad, wait on the ground and hop back). " +
  "dispatch then returns status checkpoint and a situation; answer it with decide, which returns the next situation or the score. The ride's clock waits for your answer, so nothing goes cold in flight. " +
  "You never see when a storm or haze ends, nor the unscheduled traffic; check_pad and space_weather forecast from the checkpoint's time. A ride asks at most " + E.R.MAX_CHECKPOINTS + " times, then takes the defaults. " +
  "dispatch with ask_after_hours \"never\" flies every checkpoint on its default (wait, hold) without asking.";

export function legPub(E, L) {
  const { placeName } = names(E);
  return {
    leg_id: L.leg_id, kind: L.role, ...(L.car ? { car: L.car } : {}), from: placeName(L.from), to: placeName(L.to), depart: isoJD(L.dep_jd), arrive: isoJD(L.arr_jd),
    tof_days: +L.tof_days.toFixed(2), burn_total_kms: L.dv, battery_kwh: L.kwh, fare_usd: L.fare, refly: L.refly,
    ...(L.busy_until_jd ? { car_busy_until: isoJD(L.busy_until_jd), note: "The car was busy on another job until " + isoJD(L.busy_until_jd) + ", so this pickup leaves no earlier than then." } : {}),
  };
}

/** Key for the plan+re-fly cache: everything planLeg and refly depend on. */
export const legKey = (from, to, t, obj, endJd) => [from, to, t.toFixed(6), obj, endJd.toFixed(6)].join("|");

/** planLeg + refly, reduced to what a leg keeps (page planLegFor, minus the drawing arc). */
export function computeLeg(E, from, to, t, obj, endJd) {
  const b = E.R.planLeg(from, to, t, obj, endJd);
  const g = E.refly(b);
  const loc = !!(g && g.local);
  return {
    from, to, dep_jd: b.dep_jd, arr_jd: b.arr_jd, tof_days: b.tof_days, dv: +b.dv_total_kms.toFixed(3), kwh: b.battery.energy_kwh, fare: b.fare.total_usd,
    gate: loc ? "local" : g && g.pass ? "PASS" : "FAIL",
    refly: loc ? { result: "not re-flown: local transfer" } : g && g.error ? { result: "FAIL", note: g.error }
      : { final_miss_km: +(+g.final_miss_km).toFixed(3), retarget_ms: +(+g.retarget_ms).toFixed(1), result: g.pass ? "PASS" : "FAIL" },
  };
}

const ABANDONED = "this run was abandoned when a newer hail was taken";
function guardRun(run) {
  const phase = phaseOf(run);
  if (phase === "abandoned") fail(ABANDONED);
  if (phase === "in_flight") fail("this hail has already been dispatched and the car is at a checkpoint; answer it with decide");
  if (phase === "arrived") fail("this hail has already been dispatched");
}
async function addLeg(run, role, car, from, to, t, obj, legFn, extra) {
  if (run.calls >= MAX_PLANS_PER_RUN) fail("this run has used its " + MAX_PLANS_PER_RUN + " plans; take the hail again");
  run.calls++;
  let got;
  try { got = await legFn(from, to, t, obj, SEASON_END); }
  catch (e) { const err = new GameError(String((e && e.message) || e)); err.counted = true; throw err; }
  const id = "leg" + (++run.lseq);
  const L = Object.assign({ leg_id: id, role, ...(car ? { car } : {}) }, got.leg, extra);
  run.legs[id] = L;
  return { leg: L, cached: got.cached };
}
const defaultLegFn = (E) => (from, to, t, obj, end) => ({ leg: computeLeg(E, from, to, t, obj, end), cached: false });
const waitOf = (inp) => Math.max(0, Math.min(400, +inp.wait_days || 0));

/** Page planPickup(car, objective, wait). Mutates run. A plan counts even if planning then fails.
 *  The pickup leaves no earlier than R.pickupStart (the rider is ready and the car is free), plus wait_days. */
export async function planPickup(E, run, inp, legFn) {
  const R = E.R, h = R.BY[run.id];
  guardRun(run);
  const key = String(inp.car || "").toLowerCase().trim();
  const car = own(R.CAR, key) || R.FLEET.filter((c) => c.name.toLowerCase() === key)[0];
  if (!car) fail("unknown car " + inp.car + ". The fleet is in get_hail.");
  if (car.at === h.from) fail(car.name + " is already at the pickup");
  const obj = inp.objective === "time" ? "time" : "energy", wait = waitOf(inp), start = R.pickupStart(run.id, car.id, run.t0, seedOf(run));
  return addLeg(run, "pickup", car.id, car.at, h.from, start + wait, obj, legFn || defaultLegFn(E),
    { objective: obj, wait_days: wait, ...(start > run.t0 ? { busy_until_jd: start } : {}) });
}

/** Page planRideLeg(after, objective, wait). */
export async function planRideLeg(E, run, inp, legFn) {
  const R = E.R, h = R.BY[run.id];
  guardRun(run);
  const prev = own(run.legs, inp.after_leg);
  if (!prev) fail("unknown leg_id " + inp.after_leg + ": pass the pickup leg this ride follows");
  if (prev.role !== "pickup") fail(inp.after_leg + " is a ride leg; pass the pickup leg");
  const obj = inp.objective === "time" ? "time" : "energy", wait = waitOf(inp);
  return addLeg(run, "ride", null, h.from, h.to, prev.arr_jd + R.DWELL + wait, obj, legFn || defaultLegFn(E), { objective: obj, wait_days: wait, after: prev.leg_id });
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
  logForecast(run, { tool: "check_pad", place: p.id, from: isoJD(from), hours, max_booked: Math.max(...f.hours.map((x) => x.booked)), berths: f.berths, sky_now: isoJD(sky(nowMs).jd) });
  return {
    run_id: run.run_id, place: { id: p.id, name: p.name }, berths: f.berths, from: isoJD(from),
    hours: f.hours.map((x) => ({ hour: isoJD(x.hour_jd), booked: x.booked, free: Math.max(0, f.berths - x.booked) })),
    local_weather: wx ? { kind: wx.kind, odds_are: wx.odds_are, days: wx.days.map((d) => Object.assign(dayPub(d.day_jd), { odds: d.odds })) } : null,
    note: "Forecast only (simulated). booked counts scheduled ships; about " + Math.round(f.unscheduled_share * 100) + "% of traffic is unscheduled and is not shown, so a pad can be full when the forecast says a berth is free. " +
      "A car that arrives to a full pad holds in orbit at " + R.HOLD_KWH + " kWh an hour." +
      (wx ? " " + (wx.kind === "dust_storm" ? "Mars dust storms" : "Titan haze") + " can close this pad; odds are the " + wx.odds_are + "." : " No local weather closes this pad."),
  };
}

/** space_weather: odds per sky day that a solar radiation storm (flare) starts at a place (default: the open checkpoint's place, else the pickup). */
export function spaceWeather(E, run, inp, nowMs) {
  const R = E.R, { placeOf } = names(E), days = intIn(inp.days, 1, 60, 10, "days"), from = forecastFrom(run, inp);
  const cp = openCheckpoint(run), p = placeOf(inp.place == null || inp.place === "" ? (cp ? cp.place : R.BY[run.id].from) : inp.place);
  if (!p) fail("unknown place " + inp.place + ". Use a place id or name, e.g. " + R.BY[run.id].from + " or " + names(E).placeName(R.BY[run.id].to) + ".");
  const f = R.flareForecast(from, days, seedOf(run), p.id), reach = R.flareReach(p.id, from);
  logForecast(run, { tool: "space_weather", place: p.id, from: isoJD(from), days, max_odds: Math.max(...f.map((d) => d.flare_odds)), sky_now: isoJD(sky(nowMs).jd) });
  return {
    run_id: run.run_id, place: { id: p.id, name: p.name }, from: isoJD(from),
    storm_travel_hours: r1(reach.travel_days * 24), storm_share: Math.round(reach.share * 1000) / 1000,
    days: f.map((d) => Object.assign(dayPub(d.day_jd), { flare_odds: d.flare_odds })),
    note: "Forecast only (simulated). flare_odds is the chance a solar radiation storm starts at " + p.name + " in that sky day (noon to noon UTC). " +
      "Storms erupt at the Sun, last 4 to 48 hours (mostly short) and run in spells of about 27 days (the Sun's rotation); each reaches " + p.name + " storm_travel_hours later at 1500 km/s, " +
      "and storm_share is the share strong enough there (1/r^2 from the Sun, 1 inside Earth's orbit). " +
      "While a storm is on, no car launches with a rider aboard: the ride waits on the ground until it passes, and a ride between planets that leaves late needs a correction burn. An empty car on its pickup can fly through.",
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
  const p = own(run.legs, inp.pickup_leg), r = own(run.legs, inp.ride_leg);
  const probs = [];
  if (!p) probs.push("unknown pickup_leg " + inp.pickup_leg);
  if (!r) probs.push("unknown ride_leg " + inp.ride_leg);
  if (!probs.length) {
    if (p.role !== "pickup") probs.push(inp.pickup_leg + " is not a pickup leg");
    if (r.role !== "ride") probs.push(inp.ride_leg + " is not a ride leg");
    if (!probs.length) R.check(run.id, p.car, [p, r], run.t0, seedOf(run)).forEach((x) => probs.push(x));
    [p, r].forEach((L) => { if (L.gate === "FAIL") probs.push(L.leg_id + " was rejected by the checker"); });
  }
  if (probs.length) return { ok: false, problems: probs };
  const firstFar = [p, r].filter((L) => L.gate !== "local")[0];
  if (firstFar && sky(nowMs).jd > firstFar.dep_jd) {
    setPhase(run, "abandoned");
    run.abandoned_reason = "cold";
    fail("The hail went cold: " + firstFar.leg_id + " was due to depart " + isoJD(firstFar.dep_jd) + " and sky time is now " + isoJD(sky(nowMs).jd) + ". Take the hail again.");
  }
  run.route = [p.leg_id, r.leg_id];
  run.car = p.car;
  run.quote = { fare_usd: inp.quoted_fare_usd, arrival: inp.quoted_arrival };
  run.decisions = [];
  return next(E, run, R.start(run.id, p.car, [p, r].map(slimLeg), run.t0, seedOf(run), { ask_after_hours: after, end_jd: SEASON_END }));
}

const slimLeg = (L) => ({ from: L.from, to: L.to, dep_jd: L.dep_jd, arr_jd: L.arr_jd, kwh: L.kwh, fare: L.fare, gate: L.gate });
const r1 = (x) => Math.round(x * 10) / 10 || 0; // no -0
const incidentsPub = (E, list) => {
  const { placeName } = names(E);
  return list.map((x) => ({ kind: x.kind, leg: x.leg, place: placeName(x.where), at: isoJD(x.at_jd), hours: r1(x.hours), kwh: x.kwh, note: x.note }));
};

function next(E, run, st) {
  run.ride = st.ride;
  if (st.done) return land(E, run, st.done);
  setPhase(run, "in_flight");
  return atCheckpoint(E, run);
}
const atCheckpoint = (E, run) => ({ ok: true, status: "checkpoint", run_id: run.run_id, hail_id: run.id, situation: situation(E, run) });
const arrived = (run) => Object.assign({ ok: true, run_id: run.run_id, hail_id: run.id, planned_by: "Grok bot (connector)" }, run.player_id ? { player_id: run.player_id } : {}, run.score);

const FREE_PLANS = 6; // R.score's planning economy: 6 plans free, then a point each
/** The open checkpoint as a bot sees it: what stopped the car, where it stands, and what each answer costs so far. */
function situation(E, run) {
  const R = E.R, ride = run.ride, cp = openCheckpoint(run);
  const options = cp.options.map((o) =>
    o.action === "replan" ? Object.assign({}, o, { depart_after_min: isoJD(cp.reply_jd), plans_used: run.calls, plans_left: Math.max(0, MAX_PLANS_PER_RUN - run.calls), free_plans_left: Math.max(0, FREE_PLANS - run.calls) })
      : o.action === "hold" ? Object.assign({}, o, { held_hours: r1(o.held_hours), max_hold_hours_left: r1(o.max_hold_hours_left) }) : o);
  const how = cp.kind === "launch_hold"
    ? "decide with checkpoint " + cp.n + " and action \"wait\", or action \"replan\" with depart_after (at or after " + isoJD(cp.reply_jd) + ", when your answer reaches the car; the default) and objective energy or time."
    : "decide with checkpoint " + cp.n + " and action \"hold\" (with hours to ask again after that many hours, or none to hold until the pad opens), " +
      "or action \"divert\" with place (one of the alternates) and wait_hours on the ground there (default 0).";
  return {
    checkpoint: cp.n, kind: cp.kind, cause: cp.cause, why: cp.why, place: { id: cp.place, name: cp.place_name }, leg: cp.leg, sky_at: isoJD(cp.sky_at),
    signal_delay_minutes: cp.signal_delay_minutes, reply_arrives: isoJD(cp.reply_jd), car: cp.car, rider_aboard: cp.rider_aboard, held_hours: r1(cp.held_hours), behind_plan_hours: r1(cp.behind_plan_hours), extra_kwh: cp.extra_kwh, used_kwh: cp.used_kwh,
    options, default: cp.default, checkpoints_left: R.MAX_CHECKPOINTS - ride.checkpoints.length, ask_after_hours: ride.ask_after_hours,
    incidents: incidentsPub(E, ride.incidents),
    hidden: "You never see when a storm or haze ends, nor the unscheduled traffic. check_pad and space_weather forecast from this checkpoint's sky time.",
    signal: "You dispatch from HQ on Earth, which controls every station and car. This checkpoint's news took signal_delay_minutes to reach you, and your answer takes as long back: the car acts on it at reply_arrives, and holds or waits on the default until then.",
    note: "Simulated. The ride's clock is stopped here until you decide.",
    how_to_answer: how,
  };
}

function land(E, run, F) {
  const R = E.R, p = run.legs[run.route[0]], r = run.legs[run.route[1]], quote = run.quote, seed = seedOf(run);
  const sc = R.score(run.id, [p, r], { t0: run.t0, arrive_by_jd: run.arrive_by_jd, par_kwh: run.par_kwh, best_wait_days: run.best_wait_days, plan_calls: run.calls,
    kind: R.BY[run.id].kind, quote, flown: F });
  // The promised arrival, read the way R.score reads it (date, then a space or T, then HH:MM).
  const qm = /^\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(quote.arrival || "")), qj0 = qm ? E.jdFromIso(qm[1] + "T" + qm[2]) : null;
  const qj = qj0 != null && isFinite(qj0) ? qj0 : null;
  const incidents = incidentsPub(E, sc.incidents);
  setPhase(run, "arrived");
  run.pickup_jd = sc.pickup_jd; // actual, for the board's pickup wait
  run.score = {
    status: "arrived", total: sc.total, out_of: 100, parts: sc.parts, car: R.CAR[p.car].name,
    pickup: isoJD(sc.pickup_jd), arrive: isoJD(sc.arrive_jd), planned_pickup: isoJD(p.arr_jd), planned_arrive: isoJD(sc.planned_arrive_jd),
    promised_arrival: qj == null ? null : isoJD(qj), arrive_by: isoJD(run.arrive_by_jd),
    delay_hours: r1(F.delay_hours), promise_slip_hours: qj == null ? null : r1((sc.arrive_jd - qj) * 24),
    fare_usd: sc.fare_usd, planned_kwh: F.planned_kwh, extra_kwh: sc.extra_kwh, divert_kwh: F.divert_kwh, used_kwh: sc.used_kwh,
    par_kwh: run.par_kwh, par_car: R.CAR[run.par_car].name, beat_par: sc.beat_par, checkpoints: F.checkpoints.length,
    rider_dose_msv: sc.rider_dose_msv, incidents, season: +seed,
  };
  run.score.log = runLog(E, run, p, r, quote, incidents, sc, F);
  return arrived(run);
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
const counted = (msg) => { const e = new GameError(msg); e.counted = true; return e; };

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
    if (jd < cp.reply_jd - 1 / 1440) fail("a replan must depart at or after " + isoJD(cp.reply_jd) + ", when your answer reaches the car");
    if (jd > latest) fail("depart_after must be by " + isoJD(latest));
    const S = ride.segs[ride.at.seg];
    const { leg: L } = await addLeg(run, S.role, S.role === "pickup" ? run.car : null, S.from, S.to, Math.max(jd, cp.reply_jd), input.objective, legFn || defaultLegFn(E),
      { objective: input.objective, wait_days: 0, replan_of: n });
    if (L.gate === "FAIL") throw counted(L.leg_id + " was rejected by the checker; checkpoint " + n + " is still open (wait, or replan from another time)");
    decision = { action: "replan", leg: slimLeg(L) };
  }
  let st;
  try { st = R.step(ride, decision); }
  catch (e) { const err = new GameError(String((e && e.message) || e)); err.counted = input.action === "replan"; throw err; }
  run.decisions = run.decisions || [];
  run.decisions[n - 1] = input;
  return next(E, run, st);
}

/** The run log a bot can learn from: what it was asked, what it planned and checked, what happened, how it scored. */
function runLog(E, run, p, r, quote, incidents, sc, F) {
  const R = E.R, h = R.BY[run.id];
  return {
    hail: run.id, kind: kindOf(h), season: +seedOf(run), from: h.from, to: h.to, rider_ready: isoJD(run.t0), arrive_by: isoJD(run.arrive_by_jd),
    car: p.car, par_car: run.par_car, par_kwh: run.par_kwh,
    fleet: R.fleetState(run.id, run.t0, seedOf(run)).filter((c) => c.busy_until_jd).map((c) => ({ car: c.car, busy_until: isoJD(c.busy_until_jd) })),
    planned: Object.values(run.legs).map((L) => ({ leg: L.leg_id, kind: L.role, ...(L.car ? { car: L.car } : {}), ...(L.after ? { after: L.after } : {}), ...(L.replan_of ? { replan_of: L.replan_of } : {}),
      objective: L.objective, wait_days: L.wait_days, depart: isoJD(L.dep_jd), arrive: isoJD(L.arr_jd), kwh: L.kwh, gate: L.gate })),
    dispatched: [p.leg_id, r.leg_id], quote: { fare_usd: quote.fare_usd, arrival: quote.arrival },
    forecasts: run.forecasts || [],
    ...(F.checkpoints.length ? { checkpoints: checkpointLog(E, run) } : {}),
    flown: F.segments.map((s) => ({ kind: s.kind, leg: s.role, from: s.from, to: s.to, depart: isoJD(s.dep_jd), arrive: isoJD(s.arr_jd), kwh: s.kwh, gate: s.gate })),
    happened: { pickup: isoJD(sc.pickup_jd), arrive: isoJD(sc.arrive_jd), extra_kwh: sc.extra_kwh, divert_kwh: F.divert_kwh, used_kwh: sc.used_kwh },
    incidents: incidents.map((x) => ({ kind: x.kind, leg: x.leg, place: x.place, at: x.at, hours: x.hours, kwh: x.kwh })),
    parts: Object.fromEntries(sc.parts.map((x) => [x.key, x.got])), total: sc.total,
  };
}
/** Each checkpoint, what was decided, and (with hindsight, simulated) what every choice there would have used. */
function checkpointLog(E, run) {
  const rows = E.R.regret(run.ride);
  return run.ride.checkpoints.map((cp, i) => {
    const d = cp.decision, row = rows[i];
    return {
      n: cp.n, kind: cp.kind, cause: cp.cause, leg: cp.leg, place: cp.place, at: isoJD(cp.sky_at),
      decision: d && d.action === "replan" ? { action: "replan", depart: isoJD(d.leg.dep_jd), kwh: d.leg.kwh } : d,
      ...(row ? { options_hindsight: row.options.map((o) => ({ option: o.option, used_kwh: o.used_kwh, arrive: isoJD(o.arrive_jd) })), best: row.best } : {}),
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
  const base = { run_id: run.run_id, hail_id: run.id, title: run.title, kind: h ? kindOf(h) : null, season: +seedOf(run), phase, taken_at: takenAt(run),
    rider_ready: isoJD(run.t0), arrive_by: isoJD(run.arrive_by_jd), plans_used: run.calls };
  if (phase === "abandoned") return Object.assign(base, { reason: run.abandoned_reason || null });
  if (phase === "in_flight") return Object.assign(base, { open_checkpoint: run.ride.pending });
  if (phase !== "arrived") return base;
  const s = run.score, cps = (s.log && s.log.checkpoints) || [];
  return Object.assign(base, {
    car: s.car, par_car: s.par_car, total: s.total, out_of: s.out_of, parts: Object.fromEntries(s.parts.map((x) => [x.key, { got: x.got, max: x.max }])),
    used_kwh: s.used_kwh, par_kwh: s.par_kwh, beat_par: s.beat_par, promised_arrival: s.promised_arrival, arrive: s.arrive,
    promise_slip_hours: s.promise_slip_hours, delay_hours: s.delay_hours,
    incidents: s.incidents.map((x) => ({ kind: x.kind, place: x.place, hours: x.hours, kwh: x.kwh })),
    checkpoints: cps.map((c) => {
      const b = (c.options_hindsight || []).filter((o) => o.option === c.best)[0];
      return { n: c.n, kind: c.kind, cause: c.cause, decision: c.decision, best: c.best == null ? null : c.best, best_used_kwh: b ? b.used_kwh : null, best_arrive: b ? b.arrive : null };
    }),
  });
}
/** The full ride as get_my_rides' detail mode and the /rides downloads give it: the score and the whole run log. */
export function rideRecord(E, run) {
  const phase = phaseOf(run), arrivedRun = phase === "arrived";
  let score = null, log = null;
  if (arrivedRun) { const { log: l, ...rest } = run.score; score = rest; log = l || null; }
  return {
    format: RIDE_FORMAT, simulated: true, note: SIM_NOTE, run_id: run.run_id, player_tag: run.player_id ? run.player_id.slice(2, 8) : null,
    hail_id: run.id, season: +seedOf(run), phase, taken_at: takenAt(run),
    ...(phase === "abandoned" ? { reason: run.abandoned_reason || null } : {}), ...(phase === "in_flight" ? { open_checkpoint: run.ride.pending } : {}),
    score, log,
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
/** get_my_rides paging: an opaque cursor for the last row of a page (newest first by created_ms, then run_id). */
export const rideCursor = (row) => btoa(row.created_ms + ":" + row.run_id).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function rideCursorOf(c) {
  let s = null;
  try { s = atob(String(c).replace(/-/g, "+").replace(/_/g, "/")); } catch { s = null; }
  const m = s && /^(\d{1,15}):(run_[0-9a-f]{20})$/.exec(s);
  if (!m) fail("cursor is not one get_my_rides gave; leave it out for the first page");
  return { created_ms: +m[1], run_id: m[2] };
}
