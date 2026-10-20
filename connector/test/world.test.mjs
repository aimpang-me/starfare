// The sandbox world (plan step 2): world-state.js's reducer, and StarfareWorld (world.js) over an in-memory storage with
// its Worker imports stripped, as storage-plumbing.test.mjs does for StarfareRun.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
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
function worldDO(env = {}) {
  const deps = { DurableObject: class { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }, engine, worldSeed, ...W };
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
