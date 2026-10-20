// The sandbox world (plan step 2): world-state.js's reducer, and StarfareWorld (world.js) over an in-memory storage with
// its Worker imports stripped, as storage-plumbing.test.mjs does for StarfareRun.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import * as G from "../src/game.js";
import { SEASON_END, SKY, hailView, isoJD, seasonHail } from "../src/game.js";
import { engine } from "../src/engine.js";
import { keyedSeed, worldSeed } from "../src/season-seed.js";
import * as W from "../src/world-state.js";

const E = createRequire(import.meta.url)("../src/engine/sol-page.cjs");
const ID = "w_0123456789abcdef0123", T0 = 1_000_000;
const fresh = (o = {}) => W.newWorld(E, { worldId: ID, seed: "k1:" + "ab".repeat(16), nowMs: T0, ...o });

test("a new world: every ship at its home berth and free at the start, desks by region, the clock stopped", () => {
  const w = fresh();
  assert.equal(w.clock.jd, SKY.jd0);
  assert.equal(w.clock.end_jd, SEASON_END);
  assert.equal(w.clock.tick, 0);
  assert.equal(w.clock.window_ms, null, "no seat joined, so no tick is open");
  assert.deepEqual(Object.keys(w.ships), E.R.FLEET.map((c) => c.id));
  for (const c of E.R.FLEET) assert.deepEqual(w.ships[c.id], { at: c.at, free_jd: SKY.jd0 });
  assert.deepEqual(E.R.shipsProblems(w.ships), [], "the engine takes the world's ships as its ships map (plan step 1)");
  // The sketch's slice 1: the inner desk has the Earth, Moon, Mars and Ceres ships; the outer desk the Jovian and Titan ones.
  assert.deepEqual(w.desks.D1.ships, ["sf-01", "sf-02", "sf-03", "sf-04", "sf-08", "sf-09", "sf-10"]);
  assert.deepEqual(w.desks.D2.ships, ["sf-05", "sf-06", "sf-07", "sf-11"]);
  assert.throws(() => fresh({ worldId: "w_nothex" }), /world_id/);
});

test("the market is the season pool's rows drawn for this world, with ids no other world or season shares", () => {
  const w = fresh(), other = fresh({ worldId: "w_fedcba98765432100123" });
  const hails = W.marketHails(E, w);
  assert.equal(hails.length, W.MARKET_SIZE);
  assert.equal(new Set(hails.map((h) => h.hail_id)).size, hails.length);
  for (const h of hails) assert.match(h.hail_id, W.MARKET_HAIL);
  assert.equal(hails[0].hail_id, "w0123456789ab-0");
  // Same rows as the pool draw for the tag, under the world's own id.
  const row = E.R.hailRow("0123456789ab", 7);
  assert.deepEqual(hails[7], hailView(E, { ...row, id: "w0123456789ab-7" }));
  assert.deepEqual(W.marketHails(E, fresh()), hails, "a world's market is the same every time it is drawn");
  assert.notDeepEqual(W.marketHails(E, other).map((h) => h.title), hails.map((h) => h.title));
  assert.notEqual(hails[0].hail_id, seasonHail(E, 1, 0).hail_id);
  w.market.closed[hails[3].hail_id] = "declined";
  assert.equal(W.marketHails(E, w).length, W.MARKET_SIZE - 1);
  assert.ok(!W.marketHails(E, w).some((h) => h.hail_id === hails[3].hail_id));
});

test("the clock ticks once every joined seat has waited, by one sky day", () => {
  const w = fresh();
  assert.throws(() => W.waitSeat(w, "EX", T0), /has not joined/);
  assert.throws(() => W.joinSeat(w, "D9", T0), /unknown seat D9/);
  W.joinSeat(w, "EX", T0 + 10);
  W.joinSeat(w, "D1", T0 + 20);
  assert.equal(w.clock.window_ms, T0 + 10, "the first seat to join opens the tick");
  assert.equal(W.waitSeat(w, "EX", T0 + 30), null, "D1 has not waited yet");
  assert.equal(w.clock.tick, 0);
  const ev = W.waitSeat(w, "D1", T0 + 40);
  assert.deepEqual(ev, { tick: 1, sky: isoJD(SKY.jd0 + 1), at_ms: T0 + 40, why: "every seat waited", stalled: [] });
  assert.equal(w.clock.jd, SKY.jd0 + 1);
  assert.equal(w.clock.window_ms, T0 + 40);
  assert.ok(Object.values(w.seats).every((s) => !s.waiting), "a new tick starts with nobody waiting");
  // D2 never joined, so it never holds the clock.
  W.waitSeat(w, "D1", T0 + 50);
  assert.equal(W.waitSeat(w, "EX", T0 + 60).tick, 2);
  assert.equal(w.seats.D2.stalls, 0);
});

test("a seat that keeps the others waiting past the cap stalls, and the tick runs without it", () => {
  const w = fresh({ capMs: 5000 });
  assert.equal(W.capDueMs(w), null);
  assert.equal(W.capTick(w, T0 + 1e9), null, "no seat joined: the clock stays stopped however long it waits");
  for (const s of W.SEATS) W.joinSeat(w, s, T0);
  W.waitSeat(w, "EX", T0 + 1000);
  assert.equal(W.capDueMs(w), T0 + 5000);
  assert.equal(W.capTick(w, T0 + 4999), null);
  const ev = W.capTick(w, T0 + 5000);
  assert.equal(ev.why, "cap");
  assert.deepEqual(ev.stalled, ["D1", "D2"]);
  assert.deepEqual([w.seats.EX.stalls, w.seats.D1.stalls, w.seats.D2.stalls], [0, 1, 1]);
  assert.equal(W.capDueMs(w), T0 + 10000, "the next tick's cap counts from this one");
});

test("the clock stops at the end of the span", () => {
  const w = fresh();
  W.joinSeat(w, "EX", T0);
  w.clock.jd = w.clock.end_jd - 0.5;
  W.waitSeat(w, "EX", T0 + 1);
  assert.equal(w.clock.jd, w.clock.end_jd);
  assert.equal(w.clock.done, true);
  assert.equal(W.capDueMs(w), null);
  assert.throws(() => W.waitSeat(w, "EX", T0 + 2), /end of its span/);
});

test("the view shows the clock, seats, desks and market, and never the seed", () => {
  const w = fresh({ capMs: 60000 });
  W.joinSeat(w, "D2", T0);
  w.ships["sf-05"] = { at: "ganymede", free_jd: SKY.jd0 + 3 };
  const v = W.worldView(E, w, T0 + 15000);
  assert.equal(v.simulated, true);
  assert.equal(v.clock.tick, 0);
  assert.equal(v.clock.cap_tick_in_s, 45);
  assert.deepEqual(v.seats.map((s) => [s.seat, s.role, s.joined]), [["EX", "executor", false], ["D1", "dispatcher", false], ["D2", "dispatcher", true]]);
  const sf05 = v.desks[1].ships.find((s) => s.car === "sf-05");
  assert.equal(sf05.at.id, "ganymede");
  assert.match(sf05.free, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(v.desks[0].ships[0].free, "free");
  assert.deepEqual(v.market, { size: W.MARKET_SIZE, open: W.MARKET_SIZE });
  assert.ok(!JSON.stringify(v).includes(w.seed), "the seed stays on the server");
});

test("a world's seed is keyed when the server has a key, random otherwise, and never a season's seed", async () => {
  const key = "w".repeat(40), env = { STARFARE_SEASON_KEY: key };
  const a = await worldSeed(env, ID), b = await worldSeed(env, ID), c = await worldSeed(env, "w_fedcba98765432100123");
  assert.match(a, /^k1:[0-9a-f]{32}$/);
  assert.equal(a, b, "the operator can recompute a keyed world's seed");
  assert.notEqual(a, c);
  assert.notEqual(a, await keyedSeed(1, key));
  const r1 = await worldSeed({}, ID), r2 = await worldSeed({}, ID);
  assert.match(r1, /^k1:[0-9a-f]{32}$/);
  assert.notEqual(r1, r2, "without a key each world gets 128 random bits");
  assert.notEqual(await worldSeed({ STARFARE_SEASON_KEY: "short" }, ID), await worldSeed({ STARFARE_SEASON_KEY: "short" }, ID), "a too-short key is not used");
});

// StarfareWorld with the Worker base class and engine wiring replaced, over a Map and a fake alarm.
let runSeq = 0;
function worldDO(env = {}) {
  const deps = { DurableObject: class { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }, engine, worldSeed, ...W, ...G,
    META: { sha256: "a".repeat(64) }, newRunId: () => "run_" + String(++runSeq).padStart(20, "0"), hub: () => { throw new Error("no hub in tests"); } };
  const source = readFileSync(new URL("../src/world.js", import.meta.url), "utf8")
    .replace(/^import\s[\s\S]*?;\r?\n/gm, "").replace(/^export \{[^}]*\} from [^;]*;\r?\n/gm, "")
    .replace(/\bexport (?=const |class )/g, "");
  const { StarfareWorld } = new Function(...Object.keys(deps), source + "\nreturn { StarfareWorld };")(...Object.values(deps));
  const saved = new Map(), clock = { alarm: null };
  const ctx = { storage: {
    async get(k) { return structuredClone(saved.get(k)); },
    async put(k, v) { saved.set(k, structuredClone(v)); },
    async setAlarm(t) { clock.alarm = t; },
    async deleteAll() { saved.clear(); clock.alarm = null; },
  } };
  return { obj: new StarfareWorld(ctx, env), saved, clock };
}

test("StarfareWorld: create once, join, wait, a capped tick on the alarm, and an idle world deleted", async (t) => {
  const realNow = Date.now;
  let now = 5_000_000;
  Date.now = () => now;
  t.after(() => { Date.now = realNow; });
  const { obj, saved, clock } = worldDO({ WORLD_TICK_CAP_S: "2" });
  assert.equal(await obj.view(), null);
  const v = await obj.create(ID);
  assert.equal(v.world_id, ID);
  assert.equal(v.clock.cap_s, 2);
  assert.match((await obj.create(ID)).error, /already exists/);
  assert.equal(clock.alarm, now + 30 * 24 * 3600 * 1000, "nobody joined: the alarm only deletes the world if it sits idle");
  assert.match((await obj.join("D7")).error, /unknown seat/);
  assert.equal((await obj.join("EX")).joined, "EX");
  await obj.join("D1");
  assert.equal(clock.alarm, now + 2000, "a joined seat opens the tick, so the alarm is its cap");
  assert.equal((await obj.wait("EX")).tick, null);
  now += 2000;
  await obj.alarm();
  assert.equal(saved.get("world").clock.tick, 1);
  assert.deepEqual(saved.get("world").events.at(-1).stalled, ["D1"]);
  assert.equal(clock.alarm, now + 2000);
  await obj.wait("D1");
  const r = await obj.wait("EX");
  assert.equal(r.tick.tick, 2);
  assert.equal(r.tick.why, "every seat waited");
  // Capped ticks alone do not keep a world: 30 days after the last wait it is deleted.
  now += 30 * 24 * 3600 * 1000;
  await obj.alarm();
  assert.equal(saved.size, 0);
  assert.equal(await obj.view(), null);
});

// ---- jobs (plan step 3): several runs at once on the world's ships ----
const jobs = (o = {}) => {
  const w = fresh(o);
  let seq = 0;
  const take = async (hailId) => (await W.takeJob(E, w, hailId, T0, "run_" + String(++seq).padStart(20, "0"))).run;
  // What StarfareWorld.act does: sync the run to the world, one applyTool call, then move the job's ship.
  const act = async (run, tool, input = {}) => {
    const { run: next, result } = await G.applyTool(E, W.syncJob(w, structuredClone(run)), tool, input, { nowMs: T0 });
    const after = next || W.syncJob(w, structuredClone(run));
    W.jobMoved(w, after);
    return { run: after, result };
  };
  // Plans the par ship's pickup and ride, and dispatches them with the planned arrival as the promise.
  const fly = async (run, car = run.par_car, ask = "never") => {
    let o = await act(run, "plan_pickup", { car });
    assert.ok(!o.result.error, o.result.error);
    const pickup = o.result.leg_id;
    o = await act(o.run, "plan_ride", { after_leg: pickup });
    const ride = o.result.leg_id;
    o = await act(o.run, "dispatch", { pickup_leg: pickup, ride_leg: ride, quoted_fare_usd: 100, quoted_arrival: o.result.arrive, ask_after_hours: ask });
    return o;
  };
  return { w, take, act, fly };
};

test("a market hail taken is a job: today's run on the world's seed, sky time and ships, and it leaves the market", async () => {
  const { w, take } = jobs(), id = "w0123456789ab-0";
  const run = await take(id);
  assert.deepEqual(w.jobs.j1, { job_id: "j1", run_id: run.run_id, hail_id: id, title: run.title, phase: "planning", car: null, taken_tick: 0, desk: null });
  assert.equal(run.seed, w.seed);
  assert.deepEqual(run.clock, { kind: "frozen", jd: w.clock.jd });
  assert.deepEqual(run.ships, w.ships);
  assert.deepEqual(run.world, { world_id: ID, job_id: "j1" });
  assert.equal(w.market.closed[id], "j1");
  assert.equal(W.marketHails(E, w).length, W.MARKET_SIZE - 1);
  await assert.rejects(take(id), /off the market: it is job j1/);
  await assert.rejects(take("w0123456789ab-" + W.MARKET_SIZE), /unknown hail_id/);
  await assert.rejects(take("wfedcba987654-3"), /unknown hail_id/, "another world's hail");
  await assert.rejects(take(seasonHail(E, 1, 0).hail_id), /unknown hail_id/);
  const info = G.hailInfo(E, run, T0);
  assert.equal(info.job_id, "j1");
  assert.equal(info.season, undefined, "a job names its job, not a season");
  assert.ok(!JSON.stringify(info).includes(w.seed));
  // A fresh isolate has no market rows: the run brings its own.
  delete E.R.BY[id];
  G.restoreRunBookings(E, run);
  assert.equal(E.R.BY[id].title, run.title);
});

test("two jobs fly at once on different ships, and each landing parks its ship where it landed, busy until then", async () => {
  const { w, take, fly } = jobs();
  const a = await take("w0123456789ab-0"), b = await take("w0123456789ab-4"); // Titan to Saturn; Jupiter to Io
  assert.notEqual(a.par_car, b.par_car);
  const A = await fly(a), B = await fly(b);
  assert.equal(A.result.status, "arrived");
  assert.equal(B.result.status, "arrived");
  assert.deepEqual([A.result.job_id, B.result.job_id, A.result.season], ["j1", "j2", undefined], "a score names its job, not a season");
  assert.deepEqual(w.ships[a.par_car], { at: "saturn", free_jd: A.run.ride.arrive_jd });
  assert.deepEqual(w.ships[b.par_car], { at: "io", free_jd: B.run.ride.arrive_jd });
  assert.deepEqual([w.jobs.j1.phase, w.jobs.j1.car, w.jobs.j2.phase, w.jobs.j2.car], ["arrived", a.par_car, "arrived", b.par_car]);
  assert.equal(w.jobs.j1.total, A.run.score.total);
  const v = W.worldView(E, w, T0), ship = v.desks[1].ships.find((s) => s.car === a.par_car);
  assert.deepEqual([ship.at.id, ship.free, ship.job], ["saturn", isoJD(A.run.ride.arrive_jd), "j1"]);
  assert.deepEqual(v.jobs.map((j) => [j.job_id, j.phase, j.ship]), [["j1", "arrived", E.R.CAR[a.par_car].name], ["j2", "arrived", E.R.CAR[b.par_car].name]]);
  assert.deepEqual(W.liveJobs(w), []);
});

test("a ship another job dispatched is refused, and a new pickup leaves from where it lands once it is free", async () => {
  const { w, take, act, fly } = jobs();
  const a = await take("w0123456789ab-4"), b = await take("w0123456789ab-9"); // Jupiter to Io; Jupiter to Europa
  const car = a.par_car;
  // b plans on the same ship while it is still at home, then a dispatches it first.
  let o = await act(b, "plan_pickup", { car });
  o = await act(o.run, "plan_ride", { after_leg: "leg1" });
  const bPlanned = o.run, arrive = o.result.arrive;
  const A = await fly(a, car);
  assert.equal(A.result.status, "arrived");
  o = await act(bPlanned, "dispatch", { pickup_leg: "leg1", ride_leg: "leg2", quoted_fare_usd: 100, quoted_arrival: arrive, ask_after_hours: "never" });
  assert.ok(o.result.problems.some((p) => /must leave where .* is parked/.test(p)), o.result.problems);
  assert.ok(o.result.problems.some((p) => /is busy on another ride until/.test(p)));
  assert.equal(w.jobs.j2.phase, "planning");
  // Planned again, the pickup leaves Io when a's ride has landed there.
  o = await act(o.run, "plan_pickup", { car });
  assert.equal(o.result.from, "Io");
  assert.equal(o.result.depart, isoJD(w.ships[car].free_jd));
  const listed = (await act(o.run, "get_hail")).result.fleet.find((c) => c.car === car);
  assert.deepEqual([listed.parked_at.id, listed.busy_until], ["io", isoJD(w.ships[car].free_jd)]);
});

test("the world's ticks are the job's sky time: a plan whose departure passes goes cold", async () => {
  const { w, take, act } = jobs();
  let o = await act(await take("w0123456789ab-0"), "plan_pickup", { car: "sf-07" });
  o = await act(o.run, "plan_ride", { after_leg: "leg1" });
  W.joinSeat(w, "EX", T0);
  for (let t = 1; w.clock.jd <= o.run.legs.leg1.dep_jd + 1; t++) W.waitSeat(w, "EX", T0 + t);
  // Titan to Saturn is a quick hop inside one neighbourhood, so it never goes cold; a long haul's first far leg does.
  const r = await act(o.run, "get_hail");
  assert.equal(r.result.sky_now, isoJD(w.clock.jd));
  const { w: w2, take: take2, act: act2 } = jobs();
  const long = W.marketHails(E, w2).find((h) => h.kind === "long haul");
  let L = await take2(long.hail_id);
  L = (await act2(L, "plan_pickup", { car: L.par_car })).run;
  const ride = await act2(L, "plan_ride", { after_leg: "leg1" });
  W.joinSeat(w2, "EX", T0);
  for (let t = 1; w2.clock.jd <= ride.run.legs.leg2.dep_jd; t++) W.waitSeat(w2, "EX", T0 + t);
  const cold = await act2(ride.run, "dispatch", { pickup_leg: "leg1", ride_leg: "leg2", quoted_fare_usd: 100, quoted_arrival: ride.result.arrive });
  assert.match(cold.result.error, /went cold/);
  assert.deepEqual([w2.jobs.j1.phase, w2.jobs.j1.reason], ["abandoned", "cold"]);
  assert.equal(w2.market.closed[long.hail_id], "j1", "a cold job's hail stays off the market");
});

test("a ride held at a checkpoint keeps its ship busy until it lands; dropping the job flies the defaults and frees it", async () => {
  const { w, take, fly } = jobs();
  const run = await take("w0123456789ab-12"); // Ceres Port to Ceres: the pad is closed when it arrives
  const o = await fly(run, run.par_car, 0);
  assert.equal(o.result.status, "checkpoint");
  assert.deepEqual(w.ships[run.par_car], { at: "ceres", free_jd: w.clock.end_jd });
  assert.equal(w.jobs.j1.phase, "in_flight");
  assert.equal(W.worldView(E, w, T0).desks[0].ships.find((s) => s.car === run.par_car).free, "when its ride lands");
  assert.deepEqual(W.liveJobs(w).map((j) => j.job_id), ["j1"]);
  const d = W.dropJob(E, w, o.run);
  assert.equal(d.result.status, "arrived");
  assert.match(d.result.note, /dropped at checkpoint 1/);
  assert.deepEqual(w.ships[run.par_car], { at: "ceres", free_jd: d.run.ride.arrive_jd });
  assert.equal(w.jobs.j1.phase, "arrived");
  assert.match(W.dropJob(E, w, d.run).result.error, /already arrived/);
  // A job still planning is abandoned, and its hail stays off the market.
  const p = await take("w0123456789ab-5");
  const q = W.dropJob(E, w, p);
  assert.deepEqual(q.result, { ok: true, job_id: "j2", status: "abandoned" });
  assert.deepEqual([w.jobs.j2.phase, w.jobs.j2.reason], ["abandoned", "dropped"]);
});

test("StarfareWorld: take, act and drop a job, each run under its own key", async () => {
  const { obj, saved } = worldDO();
  assert.equal((await obj.take("w0123456789ab-0")).error, "unknown world");
  await obj.create(ID);
  const h = await obj.take("w0123456789ab-0");
  assert.equal(h.job_id, "j1");
  assert.match((await obj.take("w0123456789ab-0")).error, /off the market/);
  assert.equal(saved.get("job:j1").run_id, h.run_id);
  assert.match((await obj.act("j9", "get_hail")).error, /unknown job_id j9/);
  assert.match((await obj.act("j1", "take_hail")).error, /not a job tool/);
  const p = await obj.act("j1", "plan_pickup", { car: "sf-07" });
  const r = await obj.act("j1", "plan_ride", { after_leg: p.leg_id });
  const d = await obj.act("j1", "dispatch", { pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: 100, quoted_arrival: r.arrive, ask_after_hours: "never" });
  assert.equal(d.status, "arrived");
  const v = await obj.view();
  assert.deepEqual([v.jobs[0].phase, v.desks[1].ships.find((s) => s.car === "sf-07").at.id], ["arrived", "saturn"]);
  assert.equal(saved.get("world").ships["sf-07"].at, "saturn");
  assert.match((await obj.drop("j1")).error, /already arrived/);
  await obj.take("w0123456789ab-5");
  assert.equal((await obj.drop("j2")).status, "abandoned");
  assert.equal(saved.get("job:j2").abandoned_reason, "dropped");
});

// ---- seats and codes (plan step 4) ----
test("a seat code names its seat and world, reads forgivingly, and carries a secret the world keeps only as a hash", async () => {
  const code = W.seatCode(ID, "D2", "K7QMXP4R2ZHT");
  assert.equal(code, "D2-0123456789abcdef0123-K7QMXP4R2ZHT");
  const want = { seat: "D2", world_id: ID, secret: "K7QMXP4R2ZHT" };
  assert.deepEqual(W.parseCode(code), want);
  assert.deepEqual(W.parseCode("  d2-0123456789ABCDEF0123-k7qmxp4r2zht "), want, "an agent may retype case and spaces");
  for (const bad of [null, "", "D3-0123456789abcdef0123-K7QMXP4R2ZHT", "D2-0123456789abcdef012-K7QMXP4R2ZHT", "D2-0123456789abcdef0123-K7QMXP4R2ZH", "D2-0123456789abcdef0123-K7QMXP4R2ZH0"])
    assert.equal(W.parseCode(bad), null, String(bad));
  assert.match(W.newSecret(), /^[A-HJ-NP-Z2-9]{12}$/);
  assert.notEqual(W.newSecret(), W.newSecret());
  assert.match(await W.codeHash("K7QMXP4R2ZHT"), /^[0-9a-f]{64}$/);
  assert.notEqual(await W.codeHash("K7QMXP4R2ZHT"), await W.codeHash("K7QMXP4R2ZHU"));
});

test("each role has its own tools, and a call outside them is refused with the reason", () => {
  const w = fresh();
  assert.equal(W.scopeRefusal(w, "EX", "assign"), null);
  assert.equal(W.scopeRefusal(w, "D1", "dispatch"), null);
  for (const s of W.SEATS) assert.equal(W.scopeRefusal(w, s, "join"), null);
  assert.match(W.scopeRefusal(w, "D1", "assign"), /^assign is the executor's tool; this code is dispatcher D1 \(Inner desk\)/);
  assert.match(W.scopeRefusal(w, "EX", "dispatch"), /^dispatch is a dispatcher's tool; this code is the executor \(EX\)/);
  assert.match(W.scopeRefusal(w, "D2", "take_hail"), /^unknown sandbox tool take_hail; dispatcher D2 \(Outer desk\) can call join, wait/);
  assert.deepEqual(W.SCOPES.executor.filter((t) => W.SCOPES.dispatcher.includes(t)), ["join", "wait", "message"]);
});

test("StarfareWorld: three codes once at creation, join with a code, forged codes and out-of-scope calls refused", async () => {
  const { obj, saved } = worldDO();
  const made = await obj.create(ID);
  assert.deepEqual(Object.keys(made.codes), W.SEATS);
  const stored = saved.get("world");
  for (const s of W.SEATS) {
    assert.equal(W.parseCode(made.codes[s]).seat, s);
    assert.equal(stored.seats[s].code_hash, await W.codeHash(W.parseCode(made.codes[s]).secret));
  }
  const view = await obj.view();
  assert.equal(view.codes, undefined);
  for (const s of W.SEATS) assert.ok(!JSON.stringify(view).includes(W.parseCode(made.codes[s]).secret), "the view never shows a code");
  assert.doesNotMatch(JSON.stringify(view), /code_hash/);
  const agent = { name: "Grok", model: null, thinking: null, skills: [], client: null };
  const j = await obj.seat(made.codes.D1, "join", { agent });
  assert.deepEqual([j.joined, j.role, j.desk.name, j.tools], ["D1", "dispatcher", "Inner desk", W.SCOPES.dispatcher]);
  assert.deepEqual(j.desk.ships.map((s) => s.car), ["sf-01", "sf-02", "sf-03", "sf-04", "sf-08", "sf-09", "sf-10"]);
  assert.deepEqual(saved.get("world").seats.D1.agent, agent);
  assert.equal((await obj.view()).seats[1].agent.name, "Grok");
  assert.equal((await obj.view()).clock.cap_tick_in_s != null, true, "a joined seat opens the tick");
  const ex = await obj.seat(made.codes.EX, "join");
  assert.deepEqual([ex.role, ex.desks.map((d) => d.name)], ["executor", ["Inner desk", "Outer desk"]]);
  // Another seat's secret, another world's code, a mangled code: all read the same, so none tells a guesser anything.
  const d2 = W.parseCode(made.codes.D2), d1 = W.parseCode(made.codes.D1);
  for (const bad of [W.seatCode(ID, "D2", d1.secret), W.seatCode("w_fedcba98765432100123", "D2", d2.secret), "nonsense"])
    assert.match((await obj.seat(bad, "join")).error, /seat code is not valid/, bad);
  assert.match((await obj.seat(made.codes.D1, "assign")).error, /executor's tool/);
  assert.match((await obj.seat(made.codes.EX, "message")).error, /not built yet/);
});

// ---- the executor's and dispatchers' tools (plan step 5) ----
test("market, decline and transfer_ship as pure functions", () => {
  const w = fresh();
  const p = W.marketPage(E, w, { kind: "quick", limit: 5 });
  assert.equal(p.hails.length, 5);
  assert.ok(p.hails.every((h) => h.kind === "quick" && /^(inner|outer)$/.test(h.region)));
  assert.equal(p.hails[0].hail_id, "w0123456789ab-0");
  assert.equal(p.hails[0].region, "outer", "Titan picks up in the outer region");
  assert.equal(p.next_cursor, "5");
  assert.match(W.marketPage(E, w, { cursor: "x" }).error, /cursor/);
  assert.deepEqual(W.declineHail(E, w, "w0123456789ab-1", T0), { ok: true, hail_id: "w0123456789ab-1", status: "declined", market_open: W.MARKET_SIZE - 1 });
  assert.throws(() => W.declineHail(E, w, "w0123456789ab-1", T0), /off the market: declined/);
  const t = W.transferShip(E, w, "SF-05", "D1", T0);
  assert.deepEqual([t.car, t.from, t.to], ["sf-05", "D2 (Outer desk)", "D1 (Inner desk)"]);
  assert.ok(w.desks.D1.ships.includes("sf-05") && !w.desks.D2.ships.includes("sf-05"));
  assert.equal(W.shipDesk(w, "sf-05"), "D1");
  assert.throws(() => W.transferShip(E, w, "sf-05", "D1", T0), /already on the Inner desk/);
  assert.throws(() => W.transferShip(E, w, "sf-99", "D2", T0), /unknown ship/);
  assert.throws(() => W.transferShip(E, w, "sf-05", "D7", T0), /unknown desk D7/);
  assert.throws(() => W.addReport(w, "D1", "  ", null, T0), /needs text/);
  assert.equal(W.addReport(w, "D1", "x".repeat(700), null, T0).reported.text.length, 600);
});

test("StarfareWorld: the executor assigns a job to a desk and its dispatcher flies it with the desk's ships only", async () => {
  const { obj } = worldDO();
  const { codes } = await obj.create(ID);
  const EX = codes.EX, D1 = codes.D1, D2 = codes.D2;
  assert.equal((await obj.seat(EX, "company")).world_id, ID);
  assert.equal((await obj.seat(EX, "market", { limit: 3 })).hails.length, 3);
  assert.match((await obj.seat(D2, "market")).error, /market is the executor's tool/);
  assert.match((await obj.seat(EX, "assign", { hail_id: "w0123456789ab-0", desk: "D9" })).error, /desk must be one of D1 \(Inner desk\), D2 \(Outer desk\)/);
  // Titan to Saturn goes to the outer desk; Jupiter to Io too; the inner desk gets ISS to Tiangong.
  const a = await obj.seat(EX, "assign", { hail_id: "w0123456789ab-0", desk: "D2" });
  assert.deepEqual([a.assigned, a.desk, a.hail.job_id], ["j1", "D2 (Outer desk)", "j1"]);
  await obj.seat(EX, "assign", { hail_id: "w0123456789ab-5", desk: "D1" });
  assert.match((await obj.seat(EX, "assign", { hail_id: "w0123456789ab-0", desk: "D1" })).error, /off the market: it is job j1/);
  const q = await obj.seat(D2, "queue");
  assert.deepEqual([q.desk, q.name, q.jobs.map((j) => j.job_id), q.ships.map((s) => s.car)], ["D2", "Outer desk", ["j1"], ["sf-05", "sf-06", "sf-07", "sf-11"]]);
  // The job's own tools, from its desk only, and get_hail's fleet is the desk's.
  assert.match((await obj.seat(D1, "get_hail", { job_id: "j1" })).error, /job j1 is on the Outer desk's queue, not yours \(Inner desk\)/);
  assert.match((await obj.seat(D2, "get_hail", { job_id: "j9" })).error, /unknown job_id j9; queue lists your desk's jobs/);
  const h = await obj.seat(D2, "get_hail", { job_id: "j1" });
  assert.deepEqual(h.fleet.map((c) => c.car), ["sf-05", "sf-06", "sf-07", "sf-11"]);
  assert.match((await obj.seat(D2, "plan_pickup", { job_id: "j1", car: "sf-01" })).error, /SF-01 is on the Inner desk, not yours/);
  const p = await obj.seat(D2, "plan_pickup", { job_id: "j1", car: "SF-07" });
  const r = await obj.seat(D2, "plan_ride", { job_id: "j1", after_leg: p.leg_id });
  // The executor moves sf-07 to the inner desk before the outer desk dispatches: the dispatch is refused.
  await obj.seat(EX, "transfer_ship", { car: "sf-07", desk: "D1" });
  const go = { job_id: "j1", pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: 100, quoted_arrival: r.arrive, ask_after_hours: "never" };
  assert.match((await obj.seat(D2, "dispatch", go)).error, /SF-07 is on the Inner desk, not yours/);
  await obj.seat(EX, "transfer_ship", { car: "sf-07", desk: "D2" });
  const d = await obj.seat(D2, "dispatch", go);
  assert.deepEqual([d.status, d.job_id], ["arrived", "j1"]);
  assert.match((await obj.seat(EX, "dispatch", go)).error, /dispatch is a dispatcher's tool/);
  const rep = await obj.seat(D2, "report", { text: "j1 arrived on SF-07.", job_id: "j1" });
  assert.deepEqual([rep.reported.seat, rep.reported.job_id, rep.reported.text], ["D2", "j1", "j1 arrived on SF-07."]);
  assert.match((await obj.seat(D2, "report", { text: "x", job_id: "j7" })).error, /unknown job_id j7/);
  const all = await obj.seat(EX, "reports");
  assert.deepEqual(all.reports.map((x) => x.text), ["j1 arrived on SF-07."]);
  assert.deepEqual(all.jobs.map((j) => [j.job_id, j.desk, j.phase]), [["j1", "D2", "arrived"], ["j2", "D1", "planning"]]);
  assert.deepEqual(all.counts, { taken: 2, arrived: 1, live: 1, abandoned: 0, declined: 0 });
  assert.equal(all.jobs[0].total, d.total);
  assert.equal((await obj.seat(EX, "decline", { hail_id: "w0123456789ab-2" })).status, "declined");
  assert.equal((await obj.seat(EX, "reports")).counts.declined, 1);
  assert.match((await obj.seat(EX, "wait")).error, /not built yet/);
});
