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
    best_wait_days: T.par.best_wait_days, calls: 0, lseq: 0, legs: {}, forecasts: [], started: false, score: null, abandoned: false, created_ms: nowMs,
  };
}

export function hailInfo(E, run, nowMs) {
  const R = E.R, h = R.BY[run.id], { placeName } = names(E), s = sky(nowMs);
  return {
    run_id: run.run_id, hail_id: run.id, title: h.title, rider: h.rider + " (simulated)", note: h.blurb,
    pickup_at: { id: h.from, name: placeName(h.from) }, destination: { id: h.to, name: placeName(h.to) },
    rider_ready: isoJD(run.t0), arrive_by: isoJD(run.arrive_by_jd), boarding_hours: +(R.DWELL * 24).toFixed(2), season: +seedOf(run),
    fleet: runFleet(E, run), sky_now: isoJD(s.jd), plans_used: run.calls, dispatched: run.started, ...(run.player_id ? { player_id: run.player_id } : {}),
    rules: RULES,
  };
}
export const RULES =
  "Pick a car from the fleet. A car with a busy_until time is finishing another (simulated) job and can't leave before then; \"free\" cars can leave when the rider is ready. " +
  "plan_pickup flies the car from where it is parked to the rider, leaving when the rider is ready or the car is free, whichever is later (or wait_days after that). " +
  "plan_ride flies the rider from the pickup to the destination, after boarding (or wait_days later). Then dispatch with the pickup leg, the ride leg, the fare you quote and the arrival you promise the rider. " +
  "Hazards (all simulated, the same for every player this season): you only see forecasts, and the dispatch result tells you what actually happened. " +
  "Pads have a few berths and other ships use them. check_pad shows the berths and how many are booked each hour, but about a quarter of the traffic is unscheduled and never shows in the forecast. " +
  "If every berth is taken when the car arrives, it holds in orbit until one frees up, and holding costs 250 kWh an hour. " +
  "Solar radiation storms (space_weather gives the odds per day) hold any launch with a rider aboard until the storm passes; an empty car on its pickup can fly through. " +
  "Mars dust storms (Mars, Mars Base) and Titan haze (Titan, Titan Dock) close those pads: the car waits on the ground, or holds in orbit if it is arriving. check_pad gives their odds. " +
  "A leg between planets that leaves late needs a correction burn (2% of its energy per hour late, up to 30%). " +
  "Score out of 100, from what actually happened: fast pickup 20 (versus the quickest nearby car), arrived on time 20 (falls to 0 at half the trip's allowed time late), " +
  "energy 20 (kWh actually flown, including holds and correction burns, versus par: the best nearby car flown through the same hazards), " +
  "kept the promise 15 (the arrival you quote is a promise: full marks for arriving when promised, 0 at 6 hours late on a quick hail or 1 day late on a long haul, arriving early costs a quarter as much), " +
  "every leg checked 10, honest fare 10 (within $1 of the ride leg's fare_usd), planning economy 5 (6 plans free, then a point each; check_pad and space_weather are free). " +
  "The sky clock runs 1 sky day per real second: if a leg flies between planets and its departure passes before dispatch, the hail goes cold.";

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

function guardRun(run) {
  if (run.abandoned) fail("this run was abandoned when a newer hail was taken");
  if (run.started) fail("this hail has already been dispatched");
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
function forecastFrom(run, inp) {
  if (inp.from == null || inp.from === "") return run.t0;
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
  if (run.started || run.abandoned) return;
  run.forecasts = run.forecasts || [];
  if (run.forecasts.length < MAX_FORECAST_LOG) run.forecasts.push(entry);
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

/** space_weather: odds of a solar radiation storm (flare) per sky day. */
export function spaceWeather(E, run, inp, nowMs) {
  const R = E.R, days = intIn(inp.days, 1, 60, 10, "days"), from = forecastFrom(run, inp);
  const f = R.flareForecast(from, days, seedOf(run));
  logForecast(run, { tool: "space_weather", from: isoJD(from), days, max_odds: Math.max(...f.map((d) => d.flare_odds)), sky_now: isoJD(sky(nowMs).jd) });
  return {
    run_id: run.run_id, from: isoJD(from),
    days: f.map((d) => Object.assign(dayPub(d.day_jd), { flare_odds: d.flare_odds })),
    note: "Forecast only (simulated). flare_odds is the chance a solar radiation storm starts in that sky day (noon to noon UTC). A storm lasts 4 to 48 hours, mostly short, and odds run in spells of about 27 days. " +
      "While a storm is on, no car launches with a rider aboard: the ride waits on the ground until it passes, and a ride between planets that leaves late needs a correction burn. An empty car on its pickup can fly through.",
  };
}

/** Page dispatch(): checks, the cold-hail rule, then the locked score. */
export function dispatch(E, run, inp, nowMs) {
  const R = E.R;
  if (run.abandoned) fail("this run was abandoned when a newer hail was taken");
  if (run.started) return Object.assign({ already_dispatched: true }, run.score);
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
    run.abandoned = true;
    fail("The hail went cold: " + firstFar.leg_id + " was due to depart " + isoJD(firstFar.dep_jd) + " and sky time is now " + isoJD(sky(nowMs).jd) + ". Take the hail again.");
  }
  // What actually happened: the season's hazards, flown once, after the legs are locked.
  const seed = seedOf(run), F = R.fly(run.id, p.car, [p, r], run.t0, seed);
  const quote = { fare_usd: inp.quoted_fare_usd, arrival: inp.quoted_arrival };
  const sc = R.score(run.id, [p, r], { t0: run.t0, arrive_by_jd: run.arrive_by_jd, par_kwh: run.par_kwh, best_wait_days: run.best_wait_days, plan_calls: run.calls,
    kind: R.BY[run.id].kind, quote, flown: F });
  // The promised arrival, read the way R.score reads it (date, then a space or T, then HH:MM).
  const qm = /^\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(inp.quoted_arrival || "")), qj0 = qm ? E.jdFromIso(qm[1] + "T" + qm[2]) : null;
  const qj = qj0 != null && isFinite(qj0) ? qj0 : null;
  const { placeName } = names(E), r1 = (x) => Math.round(x * 10) / 10 || 0; // no -0
  const incidents = sc.incidents.map((x) => ({ kind: x.kind, leg: x.leg, place: placeName(x.where), at: isoJD(x.at_jd), hours: r1(x.hours), kwh: x.kwh, note: x.note }));
  run.started = true;
  run.route = [p.leg_id, r.leg_id];
  run.car = p.car;
  run.pickup_jd = sc.pickup_jd; // actual, for the board's pickup wait
  run.score = {
    total: sc.total, out_of: 100, parts: sc.parts, car: R.CAR[p.car].name,
    pickup: isoJD(sc.pickup_jd), arrive: isoJD(sc.arrive_jd), planned_pickup: isoJD(p.arr_jd), planned_arrive: isoJD(sc.planned_arrive_jd),
    promised_arrival: qj == null ? null : isoJD(qj), arrive_by: isoJD(run.arrive_by_jd),
    delay_hours: r1(F.delay_hours), promise_slip_hours: qj == null ? null : r1((sc.arrive_jd - qj) * 24),
    fare_usd: sc.fare_usd, planned_kwh: F.planned_kwh, extra_kwh: sc.extra_kwh, used_kwh: sc.used_kwh, par_kwh: run.par_kwh, par_car: R.CAR[run.par_car].name, beat_par: sc.beat_par,
    incidents, season: +seed,
  };
  run.score.log = runLog(E, run, p, r, quote, incidents, sc);
  return Object.assign({ ok: true, run_id: run.run_id, hail_id: run.id, planned_by: "Grok bot (connector)" }, run.player_id ? { player_id: run.player_id } : {}, run.score);
}

/** The run log a bot can learn from: what it was asked, what it planned and checked, what happened, how it scored. */
function runLog(E, run, p, r, quote, incidents, sc) {
  const R = E.R, h = R.BY[run.id];
  return {
    hail: run.id, kind: kindOf(h), season: +seedOf(run), from: h.from, to: h.to, rider_ready: isoJD(run.t0), arrive_by: isoJD(run.arrive_by_jd),
    car: p.car, par_car: run.par_car, par_kwh: run.par_kwh,
    fleet: R.fleetState(run.id, run.t0, seedOf(run)).filter((c) => c.busy_until_jd).map((c) => ({ car: c.car, busy_until: isoJD(c.busy_until_jd) })),
    planned: Object.values(run.legs).map((L) => ({ leg: L.leg_id, kind: L.role, ...(L.car ? { car: L.car } : {}), ...(L.after ? { after: L.after } : {}),
      objective: L.objective, wait_days: L.wait_days, depart: isoJD(L.dep_jd), arrive: isoJD(L.arr_jd), kwh: L.kwh, gate: L.gate })),
    dispatched: [p.leg_id, r.leg_id], quote: { fare_usd: quote.fare_usd, arrival: quote.arrival },
    forecasts: run.forecasts || [],
    happened: { pickup: isoJD(sc.pickup_jd), arrive: isoJD(sc.arrive_jd), extra_kwh: sc.extra_kwh, used_kwh: sc.used_kwh },
    incidents: incidents.map((x) => ({ kind: x.kind, leg: x.leg, place: x.place, at: x.at, hours: x.hours, kwh: x.kwh })),
    parts: Object.fromEntries(sc.parts.map((x) => [x.key, x.got])), total: sc.total,
  };
}
