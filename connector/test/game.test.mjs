// Plain-Node tests of the ride-hail rules that need a fake clock (no wrangler needed).
// Run: node build.mjs && node --test test/game.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { SKY, SEASON_END, MAX_PLANS_PER_RUN, sky, isoJD, jdOfIso, openRun, seasonInstance, suiteInstance, applyTool, hailInfo, legPub, planPickup, planRideLeg, dispatch, decide, checkPad, spaceWeather, seedOf, phaseOf, leaveRun, computeLeg, GameError,
  RIDE_FORMAT, rideSummary, rideRecord, rideStats, rideCursor, rideCursorOf } from "../src/game.js";

const E = createRequire(import.meta.url)("../src/engine/sol-page.cjs");
const R = E.R;
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);
const DAY_MS = 1000; // 1 real second = 1 sky day
const seasonRun = async (E, hail, nowMs, runId) => openRun(E, seasonInstance(E, hail, nowMs), runId, nowMs);

async function play(hail, car, objective = "energy", nowMs = NOW, quote = "exact", runId = "run_" + hail) {
  const run = await seasonRun(E, hail, nowMs, runId);
  car ??= run.par_car;
  const p = (await planPickup(E, run, { car, objective })).leg, r = (await planRideLeg(E, run, { after_leg: p.leg_id })).leg;
  const q = quote === "exact" ? { quoted_fare_usd: r.fare, quoted_arrival: isoJD(r.arr_jd) } : typeof quote === "function" ? quote(r, run, p) : quote;
  return { run, p, r, out: dispatch(E, run, Object.assign({ pickup_leg: p.leg_id, ride_leg: r.leg_id, ask_after_hours: "never" }, q), nowMs) };
}
/** The engine's own verdict on the same legs: R.fly with the run's seed, then R.score with ctx.flown. */
function engineScore(run, p, r, quote) {
  const F = R.fly(run.id, p.car, [p, r], run.t0, run.seed);
  const s = R.score(run.id, [p, r], { t0: run.t0, arrive_by_jd: run.arrive_by_jd, par_kwh: run.par_kwh, best_wait_days: run.best_wait_days, plan_calls: run.calls, quote, flown: F });
  return { F, s };
}
/** First sky day (NOW + k days, k < n) for which pred returns something truthy. */
async function findDay(n, pred) {
  for (let k = 0; k < n; k++) { const v = await pred(NOW + k * DAY_MS, k); if (v) return v; }
  return null;
}
const part = (o, k) => o.parts.find((x) => x.key === k).got;

test("sky clock matches the page: 1 real second = 1 sky day, season resets", () => {
  assert.equal(sky(SKY.t0_ms).jd, SKY.jd0);
  assert.equal(sky(SKY.t0_ms + 1000).jd, SKY.jd0 + 1);
  const s = sky(SKY.t0_ms + SKY.len_days * 1000 + 5000);
  assert.equal(s.season, 2); assert.equal(s.jd, SKY.jd0 + 5);
});

test("isoJD rounds to the minute exactly like the engine; jdOfIso reads it back and rejects bad dates", () => {
  for (const jd of [2461400.25, 2461400.2501, 2461400.2499, 2462000.123456, 2463333.99999]) {
    assert.equal(isoJD(jd), E.isoFromJd(jd, true));
    assert.equal(isoJD(jdOfIso(isoJD(jd))), isoJD(jd));
  }
  for (const bad of ["2030-02-30 00:00", "2030-01-01", "2030-01-01T00:00", "2030-01-01 24:00", "", null, "constructor"]) assert.equal(jdOfIso(bad), null, String(bad));
});

test("t0: quick hails 1 sky day ahead, long-haul hails LEAD days ahead; the hazard seed is the season number", async () => {
  const q = await seasonRun(E, "iss-crew", NOW, "run_a");
  assert.equal(q.t0, Math.floor(sky(NOW).jd + 1) + 0.5);
  assert.equal(q.seed, String(sky(NOW).season));
  const l = await seasonRun(E, "ceres-shift", NOW, "run_b");
  assert.equal(l.t0, Math.floor(sky(NOW).jd + R.LEAD) + 0.5);
  const T = R.terms("ceres-shift", l.t0, SEASON_END, l.seed);
  assert.equal(l.par_kwh, T.par.kwh); assert.equal(l.arrive_by_jd, T.arrive_by_jd); assert.equal(l.best_wait_days, T.par.best_wait_days);
  const info = hailInfo(E, q, NOW);
  assert.equal(info.fleet.length, R.FLEET.length); assert.equal(info.season, sky(NOW).season);
});

test("get_hail: each car is free or busy_until the engine's fleetState; the rules explain the hazards and the promise", async () => {
  let busySeen = 0;
  for (const h of ["iss-crew", "phobos-commute", "jovian-hop"]) for (let k = 0; k < 5; k++) {
    const run = await seasonRun(E, h, NOW + k * DAY_MS, "run_f"), info = hailInfo(E, run, NOW);
    const st = R.fleetState(h, run.t0, run.seed);
    info.fleet.forEach((c, i) => {
      assert.equal(c.car, st[i].car);
      assert.equal(c.busy_until, st[i].busy_until_jd ? isoJD(st[i].busy_until_jd) : "free");
      if (c.busy_until !== "free") busySeen++;
    });
  }
  assert.ok(busySeen > 0, "no busy car in 15 hails");
  const rules = hailInfo(E, await seasonRun(E, "iss-crew", NOW, "run_r"), NOW).rules;
  for (const re of [/busy_until/, /booked/, /unscheduled/, /250 kWh an hour/, /rider aboard/, /dust/, /haze/, /promise/, /check_pad/, /space_weather/, /goes cold/, /decide/, /ask_after_hours/])
    assert.match(rules, re);
  assert.doesNotMatch(rules, /honest quote 10/); // the old score text is gone
});

test("dispatch scores from what actually happened: R.fly on the same legs, then R.score with ctx.flown", async () => {
  let hit = 0;
  for (const h of ["iss-crew", "phobos-commute", "jovian-hop"]) for (let k = 0; k < 6; k++) {
    const { run, p, r, out } = await play(h, undefined, "energy", NOW + k * DAY_MS);
    assert.equal(out.ok, true, JSON.stringify(out));
    const { F, s } = engineScore(run, p, r, { fare_usd: r.fare, arrival: isoJD(r.arr_jd) });
    assert.equal(out.total, s.total);
    assert.deepEqual(out.parts.map((x) => [x.key, x.got, x.max]), s.parts.map((x) => [x.key, x.got, x.max]));
    assert.equal(out.parts.reduce((a, x) => a + x.max, 0), 100);
    assert.equal(out.pickup, isoJD(F.pickup_jd)); assert.equal(out.arrive, isoJD(F.arrive_jd));
    assert.equal(out.planned_arrive, isoJD(r.arr_jd)); assert.equal(out.planned_pickup, isoJD(p.arr_jd));
    assert.equal(out.promised_arrival, isoJD(r.arr_jd));
    assert.equal(out.extra_kwh, F.extra_kwh); assert.equal(out.used_kwh, F.used_kwh); assert.equal(out.delay_hours, Math.round(F.delay_hours * 10) / 10);
    assert.equal(out.incidents.length, F.incidents.length);
    out.incidents.forEach((x, i) => {
      const f = F.incidents[i];
      assert.equal(x.kind, f.kind); assert.equal(x.leg, f.leg); assert.equal(x.kwh, f.kwh); assert.equal(x.at, isoJD(f.at_jd)); assert.equal(x.hours, Math.round(f.hours * 10) / 10);
      assert.equal(typeof x.place, "string"); assert.ok(x.note);
    });
    // the run log
    assert.equal(out.log.hail, h); assert.equal(out.log.season, +run.seed); assert.deepEqual(out.log.dispatched, [p.leg_id, r.leg_id]);
    assert.equal(out.log.planned.length, 2); assert.equal(out.log.total, out.total);
    assert.deepEqual(out.log.parts, Object.fromEntries(out.parts.map((x) => [x.key, x.got])));
    assert.equal(out.log.incidents.length, out.incidents.length);
    if (F.incidents.length) hit++;
  }
  assert.ok(hit > 0, "no hazard hit any of 18 dispatches");
});

test("with nothing in the way, the par car's plan with an exact quote scores 100", async () => {
  const clean = await findDay(200, async (nowMs) => {
    const { out } = await play("iss-crew", undefined, "energy", nowMs);
    return out.total === 100 && out.incidents.length === 0 ? out : null;
  });
  assert.ok(clean, "no clean 100 in 200 sky days");
  assert.equal(clean.promise_slip_hours, 0); assert.equal(clean.extra_kwh, 0);
});

test("a far car scores lower than the par car", async () => {
  const good = (await play("iss-crew", undefined)).out, far = (await play("iss-crew", "sf-02")).out;
  assert.ok(far.total < good.total, good.total + " vs " + far.total);
});

test("the quoted arrival is a promise scored against the actual arrival; a wrong fare loses the fare points", async () => {
  // a dispatch the hazards delayed, quoted at the plan's arrival
  const hit = await findDay(200, async (nowMs) => {
    const x = await play("iss-crew", undefined, "energy", nowMs);
    return x.out.delay_hours >= 1 && x.out.delay_hours < 5 ? Object.assign(x, { nowMs }) : null;
  });
  assert.ok(hit, "no 1-5 h delay in 200 sky days");
  const slipH = hit.out.promise_slip_hours;
  assert.ok(slipH > 0);
  assert.ok(Math.abs(part(hit.out, "promise") - 15 * (1 - slipH / 6)) <= 0.2, `${part(hit.out, "promise")} for ${slipH} h late`);
  assert.match(hit.out.parts.find((x) => x.key === "promise").note, /after the quoted/);
  // the same hail and car, quoting what actually happened, keeps the promise
  const kept = await play("iss-crew", undefined, "energy", hit.nowMs, (r) => ({ quoted_fare_usd: r.fare, quoted_arrival: hit.out.arrive }), "run_kept");
  assert.equal(part(kept.out, "promise"), 15); assert.equal(kept.out.arrive, hit.out.arrive);
  // early costs a quarter as much: quote 4 h after the actual arrival
  const early = await play("iss-crew", undefined, "energy", hit.nowMs, (r) => ({ quoted_fare_usd: r.fare, quoted_arrival: isoJD(jdOfIso(hit.out.arrive) + 4 / 24) }), "run_early");
  assert.ok(Math.abs(part(early.out, "promise") - 15 * (1 - 4 / 24)) <= 0.2, String(part(early.out, "promise")));
  // wrong fare and an arrival years off: no fare points, no promise points, everything else unchanged
  const wrong = await play("iss-crew", undefined, "energy", hit.nowMs, { quoted_fare_usd: 1, quoted_arrival: "2020-01-01 00:00" }, "run_wrong");
  assert.equal(part(wrong.out, "fare"), 0); assert.equal(part(wrong.out, "promise"), 0);
  for (const k of ["pickup", "on_time", "energy", "checker", "economy"]) assert.equal(part(wrong.out, k), part(kept.out, k), k);
  const off5 = await play("iss-crew", undefined, "energy", hit.nowMs, (r) => ({ quoted_fare_usd: r.fare + 5, quoted_arrival: hit.out.arrive }), "run_off5");
  assert.equal(part(off5.out, "fare"), 0); assert.equal(part(off5.out, "promise"), 15);
});

test("arriving late costs points on a sliding scale", async () => {
  const run = await seasonRun(E, "iss-crew", NOW, "run_late");
  const p = (await planPickup(E, run, { car: "sf-01" })).leg;
  const r = (await planRideLeg(E, run, { after_leg: p.leg_id, wait_days: 6 })).leg;
  const out = dispatch(E, run, { pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare, quoted_arrival: isoJD(r.arr_jd), ask_after_hours: "never" }, NOW);
  const ot = out.parts.find((x) => x.key === "on_time");
  assert.ok(ot.got < 20 && ot.got >= 0, JSON.stringify(ot));
});

test("busy cars: plan_pickup leaves no earlier than R.pickupStart + wait_days and says so; dispatch refuses an earlier pickup", async () => {
  const found = await findDay(100, async (nowMs) => {
    const run = await seasonRun(E, "iss-crew", nowMs, "run_busy");
    for (const car of ["sf-01", "sf-02"]) {
      const st = R.pickupStart(run.id, car, run.t0, run.seed);
      if (st > run.t0) return { run, car, st, nowMs };
    }
    return null;
  });
  assert.ok(found, "neither nearby car was busy in 100 sky days");
  const { run, car, st, nowMs } = found;
  assert.equal(hailInfo(E, run, nowMs).fleet.find((c) => c.car === car).busy_until, isoJD(st));
  const { leg } = await planPickup(E, run, { car });
  assert.ok(leg.dep_jd >= st - 1e-9, `${isoJD(leg.dep_jd)} before ${isoJD(st)}`);
  const pub = legPub(E, leg);
  assert.equal(pub.car_busy_until, isoJD(st)); assert.match(pub.note, /busy on another job/);
  const waited = (await planPickup(E, run, { car, wait_days: 0.5 })).leg;
  assert.ok(waited.dep_jd >= st + 0.5 - 1e-9);
  const r = (await planRideLeg(E, run, { after_leg: leg.leg_id })).leg;
  // a pickup leg that leaves at t0, as if the car were free: the engine's check refuses it at dispatch
  run.legs.forged = Object.assign({}, leg, { leg_id: "forged", dep_jd: run.t0, arr_jd: run.t0 + (leg.arr_jd - leg.dep_jd) });
  const bad = dispatch(E, run, { pickup_leg: "forged", ride_leg: r.leg_id, quoted_fare_usd: r.fare, quoted_arrival: isoJD(r.arr_jd) }, nowMs);
  assert.equal(bad.ok, false); assert.ok(bad.problems.some((x) => /busy on another ride until/.test(x)), JSON.stringify(bad.problems));
  // a free car's pickup carries no note
  const free = R.FLEET.find((c) => c.at !== R.BY["iss-crew"].from && R.pickupStart("iss-crew", c.id, run.t0, run.seed) === run.t0);
  if (free) assert.equal(legPub(E, (await planPickup(E, run, { car: free.id })).leg).note, undefined);
});

test("check_pad shows booked (scheduled) berths only, never the hidden unscheduled traffic", async () => {
  const run = await seasonRun(E, "iss-crew", NOW, "run_pad"), H = R.hazards(run.seed);
  let hidden = 0;
  // iss-crew's rush is at the ISS, so only the other places are compared with the raw pad counts
  for (const [place, k] of [["iss", 0], ["ISS", 1], ["Lunar Data Center", 2], ["orbital-depot", 3], ["mars-base", 4], ["Titan Dock", 5]]) {
    const from = jdOfIso(isoJD(run.t0 + k * 3 - 1));
    const out = checkPad(E, run, { place, hours: 72, from: isoJD(from) }, NOW);
    const f = R.padForecast(out.place.id, from, 72, run.id, run.t0, run.seed);
    assert.equal(out.berths, f.berths); assert.equal(out.hours.length, 72);
    out.hours.forEach((x, i) => {
      assert.deepEqual(Object.keys(x).sort(), ["booked", "free", "hour"]);
      assert.equal(x.hour, isoJD(f.hours[i].hour_jd)); assert.equal(x.booked, f.hours[i].booked);
      if (k >= 2) {
        const n = Math.round(f.hours[i].hour_jd * 24), all = H.docked(out.place.id, n, null), sched = H.docked(out.place.id, n, null, true);
        assert.equal(x.booked, sched); assert.ok(x.booked <= all);
        hidden += all - sched;
      }
    });
    assert.match(out.note, /unscheduled/); assert.match(out.note, /250 kWh an hour/);
    if (/mars|titan/.test(out.place.id)) {
      assert.ok(out.local_weather && out.local_weather.days.length >= 3, JSON.stringify(out.local_weather));
      const w = R.weatherForecast(out.place.id, from, out.local_weather.days.length, run.seed);
      assert.deepEqual(out.local_weather.days.map((d) => d.odds), w.days.map((d) => d.odds));
      for (const d of out.local_weather.days) assert.deepEqual(Object.keys(d).sort(), ["from", "odds", "to"]);
    } else assert.equal(out.local_weather, null);
  }
  assert.ok(hidden > 0, "no unscheduled traffic in 288 pad hours: the test proves nothing");
});

test("space_weather shows flare odds only, never the actual storms", async () => {
  const run = await seasonRun(E, "iss-crew", NOW, "run_sw"), H = R.hazards(run.seed);
  const out = spaceWeather(E, run, { days: 60 }, NOW);
  assert.equal(out.days.length, 60);
  const f = R.flareForecast(run.t0, 60, run.seed);
  out.days.forEach((d, i) => {
    assert.deepEqual(Object.keys(d).sort(), ["flare_odds", "from", "to"]);
    assert.equal(d.flare_odds, f[i].flare_odds); assert.equal(d.from, isoJD(f[i].day_jd)); assert.equal(d.flare_odds, Math.round(H.flareOdds(f[i].day_jd) * 100) / 100);
  });
  // a day with a storm and a day without, with the same odds, look the same in the forecast
  const stormy = (d) => [0.1, 0.3, 0.5, 0.7, 0.9].some((x) => H.flareAt(d + x));
  const pair = f.find((a) => stormy(a.day_jd) && f.some((b) => !stormy(b.day_jd) && b.flare_odds === a.flare_odds));
  assert.ok(pair, "no stormy and calm day with the same odds in 60 days");
  assert.equal(spaceWeather(E, run, {}, NOW).days.length, 10);
  assert.match(out.note, /rider aboard/); assert.match(out.note, /empty ship/);
});

test("forecast tools validate input, are free (not plans) and are noted in the dispatch log", async () => {
  const run = await seasonRun(E, "iss-crew", NOW, "run_fv");
  for (const inp of [{ place: "nowhere" }, { place: "constructor" }, { place: "__proto__" }, { place: "iss", hours: 0 }, { place: "iss", hours: 73 }, { place: "iss", hours: 1.5 },
    { place: "iss", from: "2030-02-30 00:00" }, { place: "iss", from: "tomorrow" }, { place: "iss", from: "1999-01-01 00:00" }])
    assert.throws(() => checkPad(E, run, inp, NOW), GameError, JSON.stringify(inp));
  for (const inp of [{ days: 0 }, { days: 61 }, { days: "x" }, { from: "2030-01-01T00:00" }]) assert.throws(() => spaceWeather(E, run, inp, NOW), GameError, JSON.stringify(inp));
  assert.equal(run.forecasts.length, 0); // refusals are not logged
  const pad = checkPad(E, run, { place: "iss" }, NOW);
  assert.equal(pad.hours.length, 24); assert.equal(pad.from, isoJD(run.t0)); assert.deepEqual(pad.place, { id: "iss", name: E.PLACES.find((p) => p.id === "iss").name });
  checkPad(E, run, { place: " ISS " }, NOW);
  spaceWeather(E, run, { days: 3 }, NOW);
  assert.equal(run.calls, 0);
  const p = (await planPickup(E, run, { car: run.par_car })).leg, r = (await planRideLeg(E, run, { after_leg: p.leg_id })).leg;
  const out = dispatch(E, run, { pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare, quoted_arrival: isoJD(r.arr_jd), ask_after_hours: "never" }, NOW);
  assert.equal(out.parts.find((x) => x.key === "economy").note, "2 plans, 6 free");
  assert.deepEqual(out.log.forecasts.map((x) => x.tool), ["check_pad", "check_pad", "space_weather"]);
  assert.equal(out.log.forecasts[0].place, "iss");
  // after dispatch, forecasts still answer, but the log is locked
  checkPad(E, run, { place: "iss" }, NOW);
  assert.equal(run.forecasts.length, 3);
});

test("hazards are deterministic per season: the same season replays the same, the next season differs", async () => {
  const a = await play("iss-crew", undefined, "energy", NOW, "exact", "run_d1"), b = await play("iss-crew", undefined, "energy", NOW, "exact", "run_d2");
  assert.equal(a.run.seed, b.run.seed);
  assert.equal(JSON.stringify({ ...a.out, run_id: null }), JSON.stringify({ ...b.out, run_id: null }));
  // the same sky date one season later: same t0, the next seed, different hazards
  const NEXT = NOW + SKY.len_days * 1000;
  assert.equal(sky(NEXT).jd, sky(NOW).jd); assert.equal(sky(NEXT).season, sky(NOW).season + 1);
  const c = await seasonRun(E, "iss-crew", NEXT, "run_d3");
  assert.equal(c.t0, a.run.t0); assert.equal(c.seed, String(+a.run.seed + 1));
  const sig = (run) => JSON.stringify([R.HAILS.map((h) => R.fleetState(h.id, run.t0, run.seed)), R.flareForecast(run.t0, 60, run.seed)]);
  assert.notEqual(sig(c), sig(a.run));
  // a run stored before seeds existed falls back to its own season
  const old = { ...a.run }; delete old.seed;
  assert.equal(seedOf(old), String(sky(old.created_ms).season));
});

test("long haul: the hail goes cold if the first interplanetary departure passes before dispatch", async () => {
  const run = await seasonRun(E, "ceres-shift", NOW, "run_cold");
  const p = (await planPickup(E, run, { car: "sf-04" })).leg, r = (await planRideLeg(E, run, { after_leg: p.leg_id })).leg;
  assert.equal(r.gate === "local", false);
  const late = NOW + (r.dep_jd - sky(NOW).jd + 2) * 1000;
  assert.throws(() => dispatch(E, run, { pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare, quoted_arrival: isoJD(r.arr_jd) }, late), /went cold/);
  assert.equal(run.phase, "abandoned");
});

test("wrong legs are refused; validation failures are not counted; the plan cap holds", async () => {
  const run = await seasonRun(E, "iss-crew", NOW, "run_v");
  await assert.rejects(planPickup(E, run, { car: "nope" }), /unknown ship/);
  await assert.rejects(planRideLeg(E, run, { after_leg: "leg9" }), /unknown leg_id/);
  assert.equal(run.calls, 0);
  const p = (await planPickup(E, run, { car: "sf-01" })).leg;
  const bad = dispatch(E, run, { pickup_leg: p.leg_id, ride_leg: p.leg_id, quoted_fare_usd: 0, quoted_arrival: "" }, NOW);
  assert.equal(bad.ok, false);
  run.calls = MAX_PLANS_PER_RUN;
  await assert.rejects(planPickup(E, run, { car: "sf-01" }), (e) => e instanceof GameError && /plans/.test(e.message));
});

// The engine's pinned rides (world/engine/test-reroute.js), taken through the connector: season 1, the sky clock set so t0 matches.
const skyAt = (jd) => SKY.t0_ms + Math.round((jd - SKY.jd0) * 1000);
const DUST_NOW = skyAt(2462172.6), CERES_NOW = skyAt(2461497.6);
/** A Phobos commute whose ride lands into a 93.8 h Mars Base dust storm. */
async function dustRide(runId, extra = {}) {
  const run = await seasonRun(E, "phobos-commute", DUST_NOW, runId);
  const start = R.pickupStart(run.id, "sf-03", run.t0, run.seed);
  const p = (await planPickup(E, run, { car: "sf-03", wait_days: 2462174.529253031 - start })).leg;
  const r = (await planRideLeg(E, run, { after_leg: p.leg_id, wait_days: 2462175.529253031 - p.arr_jd - R.DWELL })).leg;
  return { run, p, r, out: dispatch(E, run, Object.assign({ pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare, quoted_arrival: isoJD(r.arr_jd) }, extra), DUST_NOW) };
}
/** Ceres Shift on the par car, whose ride is grounded by a solar flare at launch. */
async function ceresRide(runId) {
  const run = await seasonRun(E, "ceres-shift", CERES_NOW, runId);
  const p = (await planPickup(E, run, { car: "sf-04" })).leg, r = (await planRideLeg(E, run, { after_leg: p.leg_id })).leg;
  return { run, p, r, out: dispatch(E, run, { pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare, quoted_arrival: isoJD(r.arr_jd) }, CERES_NOW) };
}

test("a pad closed on arrival stops the ride at a checkpoint; diverting to Phobos uses less than holding", async () => {
  const a = await dustRide("run_hold");
  assert.equal(a.out.status, "checkpoint"); assert.equal(phaseOf(a.run), "in_flight");
  const s = a.out.situation;
  assert.deepEqual([s.checkpoint, s.kind, s.cause, s.place.id, s.leg, s.sky_at, s.car, s.rider_aboard, s.held_hours, s.ask_after_hours, s.checkpoints_left],
    [1, "pad_closed", "dust_storm", "mars-base", "ride", "2029-02-08 03:56", "holding in orbit at Mars Base", true, 1, 1, 7]);
  assert.deepEqual(s.options.map((o) => o.action), ["hold", "divert"]);
  assert.deepEqual(s.options[1].alternates, [{ place: "phobos", name: "Phobos", hop_kwh: 11027, hop_hours: 2.2, berths: 3, booked_now: 2 }]);
  assert.deepEqual(s.default, { action: "hold" });
  assert.deepEqual(hailInfo(E, a.run, DUST_NOW).situation, s);
  await assert.rejects(planPickup(E, a.run, { car: "sf-03" }), /answer it with decide/);
  // forecasts in flight start at the checkpoint's sky time and are logged against it
  assert.equal(checkPad(E, a.run, { place: "mars-base" }, DUST_NOW).from, "2029-02-08 03:56");
  assert.deepEqual(a.run.forecasts.map((x) => [x.tool, x.from, x.checkpoint]), [["check_pad", "2029-02-08 03:56", 1]]);
  const hold = await decide(E, a.run, { checkpoint: 1, action: "hold" });
  assert.deepEqual([hold.status, hold.used_kwh, hold.arrive, hold.checkpoints], ["arrived", 45505, "2029-02-12 00:44", 1]);
  assert.equal(phaseOf(a.run), "arrived");
  assert.deepEqual(hold.log.checkpoints, [{ n: 1, kind: "pad_closed", cause: "dust_storm", leg: "ride", place: "mars-base", at: "2029-02-08 03:56", decision: { action: "hold" },
    options_hindsight: [{ option: "hold until open", used_kwh: 45505, arrive: "2029-02-12 00:44" }, { option: "divert to Phobos, wait 88.4 h", used_kwh: 44358, arrive: "2029-02-12 00:47" }],
    best: "divert to Phobos, wait 88.4 h" }]);
  assert.deepEqual(hold.log.forecasts.map((x) => x.checkpoint), [1]);
  const b = await dustRide("run_divert");
  const div = await decide(E, b.run, { checkpoint: 1, action: "divert", place: "Phobos", wait_hours: 88.4 });
  assert.deepEqual([div.status, div.used_kwh, div.divert_kwh, div.arrive], ["arrived", 44358, 22054, "2029-02-12 00:47"]);
  assert.deepEqual(div.log.flown.map((x) => x.kind + " " + x.from + ">" + x.to), ["planned mars-base>phobos", "planned phobos>mars-base", "divert mars-base>phobos", "return phobos>mars-base"]);
  assert.match(div.parts.find((x) => x.key === "energy").note, /22,054 on divert hops/);
  assert.ok(div.incidents.some((x) => x.kind === "divert"), JSON.stringify(div.incidents));
});

test("decide is idempotent: the same answer returns where the ride stands, a different one is refused", async () => {
  const { run } = await dustRide("run_idem");
  await assert.rejects(decide(E, run, { checkpoint: 2, action: "hold" }), /checkpoint 2 has not happened; the open checkpoint is 1/);
  await assert.rejects(decide(E, run, { checkpoint: 1, action: "wait" }), /a pad_closed checkpoint takes hold or divert, not wait/);
  await assert.rejects(decide(E, run, { checkpoint: 1, action: "divert", place: "mars-base" }), /divert to one of: phobos/);
  await assert.rejects(decide(E, run, { checkpoint: 1, action: "hold", hours: 0 }), /hold hours must be more than 0/);
  assert.equal(run.ride.pending, 1); assert.equal(run.calls, 2);
  const first = await decide(E, run, { checkpoint: 1, action: "divert", place: "phobos", wait_hours: 88.4 });
  const again = await decide(E, run, { checkpoint: 1, action: "divert", place: "Phobos", wait_hours: 88.4 });
  assert.equal(again.already_decided, true); assert.deepEqual({ ...again, already_decided: undefined }, { ...first, already_decided: undefined });
  await assert.rejects(decide(E, run, { checkpoint: 1, action: "hold" }), /checkpoint 1 was already decided: \{"action":"divert","place":"phobos","wait_hours":88.4\}/);
  await assert.rejects(decide(E, run, { checkpoint: 2, action: "hold" }), /checkpoint 2 has not happened; the ride arrived after 1 checkpoint$/);
  assert.equal(dispatch(E, run, {}, DUST_NOW).already_dispatched, true);
  const planning = await seasonRun(E, "iss-crew", NOW, "run_plan");
  await assert.rejects(decide(E, planning, { checkpoint: 1, action: "wait" }), /dispatch first/);
});

test("a flare at launch: replan is a plan and beats waiting; a leg the checker rejects leaves the checkpoint open", async () => {
  const w = await ceresRide("run_wait");
  assert.deepEqual([w.out.situation.kind, w.out.situation.cause, w.out.situation.sky_at], ["launch_hold", "solar_flare", "2028-01-09 21:34"]);
  const rp = w.out.situation.options.find((o) => o.action === "replan");
  assert.deepEqual([rp.depart_after_min, rp.plans_used, rp.plans_left, rp.free_plans_left], ["2028-01-09 21:34", 2, MAX_PLANS_PER_RUN - 2, 4]);
  const waited = await decide(E, w.run, { checkpoint: 1, action: "wait" });
  assert.deepEqual([waited.status, waited.used_kwh, waited.arrive], ["arrived", 110481, "2030-07-13 22:20"]);

  const { run } = await ceresRide("run_replan");
  await assert.rejects(decide(E, run, { checkpoint: 1, action: "hold" }), /a launch_hold checkpoint takes wait or replan, not hold/);
  await assert.rejects(decide(E, run, { checkpoint: 1, action: "replan", depart_after: "2028-01-09 20:00" }), /depart at or after 2028-01-09 21:34/);
  assert.equal(run.calls, 2);
  const rejecting = (from, to, t, obj, end) => ({ leg: Object.assign(computeLeg(E, from, to, t, obj, end), { gate: "FAIL" }), cached: false });
  await assert.rejects(decide(E, run, { checkpoint: 1, action: "replan" }, rejecting), (e) => e instanceof GameError && /rejected by the checker; checkpoint 1 is still open/.test(e.message));
  assert.deepEqual([run.calls, run.ride.pending, phaseOf(run)], [3, 1, "in_flight"]);
  let out = await decide(E, run, { checkpoint: 1, action: "replan", depart_after: "2028-01-10 22:57" });
  assert.equal(run.calls, 4);
  const seen = [];
  while (out.status === "checkpoint") {
    seen.push([out.situation.checkpoint, out.situation.kind, out.situation.sky_at]);
    out = await decide(E, run, { checkpoint: out.situation.checkpoint, action: out.situation.default.action });
  }
  assert.deepEqual(seen, [[2, "launch_hold", "2028-05-09 22:57"], [3, "pad_closed", "2030-08-07 05:01"]]);
  assert.deepEqual([out.used_kwh, out.arrive, out.parts.find((x) => x.key === "economy").note], [71619, "2030-08-07 09:00", "4 plans, 6 free"]);
  assert.deepEqual(out.log.checkpoints[0].decision, { action: "replan", depart: "2028-05-09 22:57", kwh: 64696 });
  assert.deepEqual(out.log.planned.filter((L) => L.replan_of).map((L) => [L.leg, L.replan_of, L.gate]), [["leg3", 1, "FAIL"], ["leg4", 1, "PASS"]]);
  const capped = await ceresRide("run_cap");
  capped.run.calls = MAX_PLANS_PER_RUN;
  await assert.rejects(decide(E, capped.run, { checkpoint: 1, action: "replan" }), /answer with wait instead/);
});

test("ask_after_hours is checked; \"never\" flies the defaults and arrives at once", async () => {
  await assert.rejects(dustRide("run_ask", { ask_after_hours: 25 }), /ask_after_hours must be 0 to 24 hours, or "never"/);
  const { out } = await dustRide("run_never", { ask_after_hours: "never" });
  assert.deepEqual([out.status, out.used_kwh, out.arrive, out.checkpoints], ["arrived", 45505, "2029-02-12 00:44", 0]);
  assert.equal(out.log.checkpoints, undefined);
});

test("leaving a ride at a checkpoint flies it on the defaults, so it still arrives and is scored", async () => {
  const { run } = await dustRide("run_leave");
  const out = leaveRun(E, run);
  assert.deepEqual([out.status, out.used_kwh, out.arrive, out.checkpoints, out.left_at_checkpoint, phaseOf(run)], ["arrived", 45505, "2029-02-12 00:44", 1, 1, "arrived"]);
  assert.equal(out.note, "A newer hail was taken at checkpoint 1, so the rest of this ride flew on the default answers.");
  assert.deepEqual(out.log.checkpoints.map((c) => c.decision), [{ action: "hold" }]);
  assert.equal(leaveRun(E, run), null);
  assert.equal(dispatch(E, run, {}, DUST_NOW).already_dispatched, true);
});

test("runs stored before phases existed keep working", async () => {
  const done = { ...(await play("iss-crew")).run };
  done.started = true; delete done.phase;
  assert.equal(phaseOf(done), "arrived");
  assert.equal(dispatch(E, done, {}, NOW).already_dispatched, true);
  await assert.rejects(decide(E, done, { checkpoint: 1, action: "wait" }), /the ride arrived after 0 checkpoints/);
  const old = await seasonRun(E, "iss-crew", NOW, "run_old");
  delete old.phase;
  assert.equal(hailInfo(E, old, NOW).phase, "planning");
  assert.deepEqual(leaveRun(E, old), { ok: true, status: "abandoned", run_id: "run_old" });
  assert.deepEqual([old.phase, "abandoned" in old, leaveRun(E, old)], ["abandoned", false, null]);
  assert.throws(() => dispatch(E, { ...old, phase: undefined, abandoned: true }, {}, NOW), /abandoned/);
});

test("SEASON_END is the page's", () => { assert.equal(SEASON_END, SKY.jd0 + SKY.len_days - 1); });

test("ride history: a summary copies the score and log, and names the checkpoint's hindsight best (the Phobos divert)", async () => {
  const { run } = await dustRide("run_hist0000000000000");
  const open = rideSummary(E, run);
  assert.deepEqual([open.phase, open.open_checkpoint, open.hail_id, open.kind, open.season, open.taken_at, open.plans_used, open.total],
    ["in_flight", 1, "phobos-commute", "quick", +run.seed, new Date(DUST_NOW).toISOString(), 2, undefined]);
  await decide(E, run, { checkpoint: 1, action: "hold" });
  const s = rideSummary(E, run), sc = run.score;
  assert.equal(s.phase, "arrived");
  for (const k of ["car", "par_car", "total", "out_of", "used_kwh", "par_kwh", "beat_par", "promised_arrival", "arrive", "promise_slip_hours", "delay_hours"]) assert.equal(s[k], sc[k], k);
  assert.deepEqual([s.rider_ready, s.arrive_by, s.title], [sc.log.rider_ready, sc.log.arrive_by, run.title]);
  assert.deepEqual(s.parts, Object.fromEntries(sc.parts.map((x) => [x.key, { got: x.got, max: x.max }])));
  assert.deepEqual(Object.fromEntries(Object.entries(s.parts).map(([k, v]) => [k, v.got])), sc.log.parts);
  assert.deepEqual(s.incidents, sc.incidents.map((x) => ({ kind: x.kind, place: x.place, hours: x.hours, kwh: x.kwh })));
  assert.deepEqual(s.checkpoints, [{ n: 1, kind: "pad_closed", cause: "dust_storm", decision: { action: "hold" },
    best: "divert to Phobos, wait 88.4 h", best_used_kwh: 44358, best_arrive: "2029-02-12 00:47" }]);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s); // stored as JSON in the hub
  const rec = rideRecord(E, run);
  assert.deepEqual([rec.format, rec.simulated, rec.run_id, rec.hail_id, rec.phase, rec.player_tag], [RIDE_FORMAT, true, run.run_id, "phobos-commute", "arrived", null]);
  assert.match(rec.note, /Simulated/);
  assert.equal(rec.score.log, undefined);
  assert.deepEqual(rec.log, sc.log);
  assert.equal(rec.score.total, sc.total);
  run.player_id = "p_0123456789abcdef";
  assert.equal(rideRecord(E, run).player_tag, "012345");
});

test("ride history: planning, abandoned (newer hail, cold) rows carry only what exists", async () => {
  const a = await seasonRun(E, "iss-crew", NOW, "run_plan");
  const s = rideSummary(E, a);
  assert.deepEqual([s.phase, s.total, s.parts, s.reason], ["planning", undefined, undefined, undefined]);
  assert.equal(leaveRun(E, a).status, "abandoned");
  assert.deepEqual([rideSummary(E, a).phase, rideSummary(E, a).reason, rideRecord(E, a).reason, rideRecord(E, a).score], ["abandoned", "newer_hail", "newer_hail", null]);
  const run = await seasonRun(E, "ceres-shift", NOW, "run_cold2");
  const p = (await planPickup(E, run, { car: "sf-04" })).leg, r = (await planRideLeg(E, run, { after_leg: p.leg_id })).leg;
  assert.throws(() => dispatch(E, run, { pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare, quoted_arrival: isoJD(r.arr_jd) }, NOW + (r.dep_jd - sky(NOW).jd + 2) * 1000), /went cold/);
  assert.deepEqual([rideSummary(E, run).reason, rideSummary(E, run).plans_used], ["cold", 2]);
});

test("ride history stats: per hail, sums and means over arrived rows (newest first), and the part lost most", () => {
  const row = (hail_id, total, x, y) => ({ phase: "arrived", hail_id, total, parts: { x: { got: x, max: 20 }, y: { got: y, max: 5 } } });
  const st = rideStats([row("a", 80, 10, 5), { phase: "abandoned", hail_id: "a" }, row("a", 61, 4, 3), row("b", 100, 20, 5)]);
  assert.deepEqual(st, [
    { hail_id: "a", rides: 2, best_total: 80, last_total: 80, mean_total: 70.5, mean_parts: { x: 7, y: 4 }, lost_most: { part: "x", mean_lost: 13, max: 20 }, note: "computed from your 2 arrived rides of a" },
    { hail_id: "b", rides: 1, best_total: 100, last_total: 100, mean_total: 100, mean_parts: { x: 20, y: 5 }, lost_most: null, note: "computed from your 1 arrived ride of b" },
  ]);
  assert.deepEqual(rideStats([]), []);
});

test("ride history cursor: base64url of created_ms and run_id, round trips, and rejects anything else", () => {
  const row = { created_ms: 1792152000123, run_id: "run_" + "0f".repeat(10) };
  const c = rideCursor(row);
  assert.match(c, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(rideCursorOf(c), row);
  for (const bad of ["", "nope", "%%%", rideCursor({ created_ms: 1, run_id: "constructor" }), btoa("12:run_short")])
    assert.throws(() => rideCursorOf(bad), (e) => e instanceof GameError && /cursor/.test(e.message), bad);
});

// A shared flight: ceres-shift (lead, Ceres Port to Mars Base) and phobos-commute (Phobos to Mars Base), at a frozen clock.
const SHARED = ["ceres-shift", "phobos-commute"];
async function sharedRun() {
  const inst = suiteInstance(E, { hails: SHARED }, { seed: "2", clockJd: 2461550.0, tag: "t", budget: null });
  let run = await openRun(E, inst, "run_00000000000000000001", 0);
  const call = async (tool, input) => { const o = await applyTool(E, run, tool, input, { nowMs: 0 }); if (o.run) run = o.run; return o.result; };
  return { call, get run() { return run; } };
}
async function sharedLegs(call) {
  const l1 = await call("plan_leg", { car: "sf-04", to: "ceres-port" });
  const l2 = await call("plan_leg", { after_leg: l1.leg_id, to: "Mars Base" });
  const l3 = await call("plan_leg", { after_leg: l2.leg_id, to: "phobos" });
  const l4 = await call("plan_leg", { after_leg: l3.leg_id, to: "mars-base" });
  return [l1, l2, l3, l4];
}

test("shared flight: the run carries every booking, par from the pooled flight, and get_hail lists the bookings and seats", async () => {
  const s = await sharedRun(), run = s.run;
  assert.deepEqual([run.id, run.hails, run.t0, run.par_kwh, run.par_car], ["ceres-shift", SHARED, 2461700.5, 99781, "sf-04"]);
  const info = await s.call("get_hail", {});
  assert.deepEqual(info.bookings.map((b) => [b.hail_id, b.party, b.pickup_at.id, b.destination.id, b.rider_ready, b.arrive_by]), [
    ["ceres-shift", 1, "ceres-port", "mars-base", "2027-10-22 00:00", "2031-12-09 00:00"],
    ["phobos-commute", 1, "phobos", "mars-base", "2027-10-22 00:00", "2027-10-25 00:00"]]);
  assert.ok(info.fleet.every((c) => c.seats === 4));
  assert.equal(info.passengers, undefined);
  assert.match(info.rules, /shared flight \(simulated\) with 2 bookings/);
});

test("shared flight: plan_leg chains one car's legs; the one-booking tools and stray legs are refused", async () => {
  const s = await sharedRun();
  assert.equal((await s.call("plan_pickup", { car: "sf-04" })).error, "this flight has 2 bookings; plan it with plan_leg");
  assert.match((await s.call("plan_leg", { car: "sf-04", to: "titan" })).error, /^to must be a booking's pickup or destination: Ceres Port, Mars Base, Phobos$/);
  const [l1, l2, , l4] = await sharedLegs(s.call);
  assert.deepEqual([l1, l2, l4].map((l) => [l.kind, l.car, l.from, l.to, l.depart, l.arrive]), [
    ["leg", "sf-04", "Ceres", "Ceres Port", "2027-10-22 00:00", "2027-10-22 02:21"],
    ["leg", "sf-04", "Ceres Port", "Mars Base", "2028-02-19 03:33", "2030-07-23 06:50"],
    ["leg", "sf-04", "Phobos", "Mars Base", "2030-07-23 10:16", "2030-07-23 12:30"]]);
  assert.equal((await s.call("plan_leg", { after_leg: l1.leg_id, car: "sf-01", to: "mars-base" })).error, "leg1 flies SF-04; a flight is one ship");
  assert.equal((await s.call("plan_leg", { after_leg: l1.leg_id, to: "ceres-port" })).error, "this leg would start and end at Ceres Port");
  const one = await openRun(E, suiteInstance(E, { hail_id: "iss-crew" }, { seed: "2", clockJd: 2461550.0, tag: "t", budget: null }), "run_00000000000000000002", 0);
  assert.equal((await applyTool(E, one, "plan_leg", { car: "sf-01", to: "iss" }, { nowMs: 0 })).result.error, "this flight has one booking; plan it with plan_pickup and plan_ride");
});

test("shared flight: dispatch with legs, stops and quotes scores each booking and lists the passengers stop by stop", async () => {
  const s = await sharedRun(), legs = await sharedLegs(s.call), [, l2, , l4] = legs;
  const out = await s.call("dispatch", {
    legs: legs.map((l) => l.leg_id), ask_after_hours: "never",
    stops: [{ board: ["ceres-shift"] }, { alight: ["ceres-shift"] }, { board: ["phobos-commute"] }, { alight: ["phobos-commute"] }],
    quotes: { "ceres-shift": { fare_usd: l2.fare_usd, arrival: l2.arrive }, "phobos-commute": { fare_usd: l4.fare_usd, arrival: l4.arrive } },
  });
  assert.deepEqual([out.status, out.total, out.car, out.used_kwh, out.par_kwh, out.planned_pickup, out.promised_arrival], ["arrived", 75, "SF-04", 99781, 99781, "2027-10-22 02:21", "2030-07-23 06:50"]);
  assert.deepEqual(out.bookings.map((b) => [b.hail_id, b.pickup, b.arrive, b.promise_slip_hours, b.fare_usd, b.parts.map((x) => x.got)]), [
    ["ceres-shift", "2027-10-22 02:21", "2030-07-23 06:50", 0, 518971.32, [20, 20, 15, 10]],
    ["phobos-commute", "2030-07-23 09:04", "2030-07-23 16:27", 4, 1811.11, [0, 0, 5.1, 10]]]);
  assert.deepEqual(out.passengers.map((p) => [p.place.id, p.board, p.alight, p.aboard, p.seats]), [
    ["ceres", [], [], 0, 4], ["ceres-port", ["ceres-shift"], [], 1, 4], ["mars-base", [], ["ceres-shift"], 0, 4],
    ["phobos", ["phobos-commute"], [], 1, 4], ["mars-base", [], ["phobos-commute"], 0, 4]]);
  assert.deepEqual([out.log.hails, out.log.dispatched, Object.keys(out.log.bookings)], [SHARED, ["leg1", "leg2", "leg3", "leg4"], SHARED]);
  assert.deepEqual(out.log.bookings["phobos-commute"].parts, { pickup: 0, on_time: 0, promise: 5.1, fare: 10 });
  assert.deepEqual((await s.call("get_hail", {})).passengers.map((p) => p.aboard), [0, 1, 0, 1, 0]);
});

test("shared flight: dispatch refuses the two-leg form, a booking left off the plan, a missing quote and a stranger", async () => {
  const s = await sharedRun(), ids = (await sharedLegs(s.call)).map((l) => l.leg_id);
  const q = { "ceres-shift": { fare_usd: 1, arrival: "2030-07-23 06:50" }, "phobos-commute": { fare_usd: 1, arrival: "2030-07-23 12:30" } };
  const probs = async (inp) => (await s.call("dispatch", inp)).problems;
  assert.match((await probs({ pickup_leg: ids[0], ride_leg: ids[1], quoted_fare_usd: 1, quoted_arrival: "2030-07-23 06:50" }))[0], /^this flight has 2 bookings: dispatch with legs/);
  assert.deepEqual(await probs({ legs: ids, stops: [{}, {}, {}], quotes: q }), ["stops has 3 entries; it needs one for each of the 4 legs"]);
  assert.deepEqual(await probs({ legs: ids, stops: [{ board: ["ceres-shift"] }, { alight: ["ceres-shift"] }, {}, {}], quotes: q }), ["phobos-commute is not on the plan: every booking boards and alights"]);
  assert.deepEqual(await probs({ legs: ids, stops: [{ board: ["ceres-shift"] }, { alight: ["ceres-shift"] }, { board: ["phobos-commute"] }, { alight: ["phobos-commute", "iss-crew"] }], quotes: { "ceres-shift": q["ceres-shift"] } }),
    ["iss-crew is not a booking on this flight; its bookings are ceres-shift, phobos-commute", "quotes needs a fare_usd and an arrival for phobos-commute"]);
  assert.equal(phaseOf(s.run), "planning");
});
