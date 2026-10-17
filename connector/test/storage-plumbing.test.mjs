import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import * as game from "../src/game.js";
import { engine } from "../src/engine.js";
import { episodeText } from "../src/episode.js";
import { liveIdsToDrop } from "../src/live.js";
import { distinctPlayers, ensurePool, poolSize, recordBest } from "../src/hub-pool.js";

const E = createRequire(import.meta.url)("../src/engine/sol-page.cjs");
const RUN = "run_0123456789abcdef0123";
const NOW = game.SKY.t0_ms + 100 * 1000;

// Exercise the actual Durable Object methods with an in-memory storage/RPC boundary.
// Only Cloudflare's base class and the external hub are replaced.
function actor(run, { legGet = async () => null, version = "current-engine" } = {}) {
  const saved = new Map([["run", structuredClone(run)]]);
  const cache = new Map(), lookups = [];
  let computes = 0;
  const remote = {
    async legGet(key) { lookups.push(key); return cache.get(key) ?? await legGet(key); },
    async legPut(key, value) { cache.set(key, structuredClone(value)); },
    async record() {}, async ridePut() {}, async livePut() {},
  };
  const dependencies = {
    DurableObject: class { constructor(ctx, env) { this.ctx = ctx; this.env = env; } },
    engine, META: { sha256: version }, episodeText, ...game, liveIdsToDrop,
    playersIn: distinctPlayers, freezePool: ensurePool, storedPool: poolSize, recordBest,
    computeLeg(_E, from, to, t) {
      computes++;
      return { from, to, dep_jd: t, arr_jd: t + 0.1, tof_days: 0.1, dv: 1, kwh: 123, fare: 456,
        gate: "local", refly: { result: "not re-flown: local transfer" }, arc_au: [[0, 0, 0], [1, 0, 0]] };
    },
  };
  const source = readFileSync(new URL("../src/store.js", import.meta.url), "utf8")
    .replace(/^import\s[\s\S]*?;\r?\n/gm, "")
    .replace(/\bexport (?=const |class )/g, "");
  const { StarfareRun } = new Function(...Object.keys(dependencies), source + "\nreturn { StarfareRun };")(...Object.values(dependencies));
  const ctx = { storage: {
    async get(key) { return structuredClone(saved.get(key)); },
    async put(key, value) { saved.set(key, structuredClone(value)); },
  } };
  return { instance: new StarfareRun(ctx, { STARFARE_HUB: { idFromName: (x) => x, get: () => remote } }),
    saved, lookups, get computes() { return computes; } };
}

async function planning(id = "phobos-commute") {
  return game.openRun(E, game.seasonInstance(E, id, NOW), RUN, NOW, async () => ({
    arrive_by_jd: game.SKY.jd0 + 200, par: { kwh: 100, car: "sf-03", best_wait_days: 0.1 },
  }));
}

test("a stored seasonal booking can be read after its in-memory catalog is lost", async () => {
  const id = "s1-0", row = game.resolveHail(E, id, 1, 200);
  const run = await planning(id), a = actor(run);
  delete E.R.BY[id];
  try {
    const result = await a.instance.act("get_hail", {});
    assert.equal(result.hail_id, id);
    assert.equal(result.title, row.title);
    assert.equal(result.pickup_at.id, row.from);
    assert.equal(result.destination.id, row.to);
  } finally { E.R.admit(row); }
});

test("older seasonal runs without a booking snapshot recover their original season's booking", async () => {
  const id = "s1-1", row = game.resolveHail(E, id, 1, 200);
  const run = await planning(id);
  delete run.booking_rows;
  delete E.R.BY[id];
  try {
    const result = await actor(run).instance.act("get_hail", {});
    assert.equal(result.hail_id, id);
    assert.equal(result.title, row.title);
  } finally { E.R.admit(row); }
});

test("a new stored booking keeps its snapshot if the generator later changes", async () => {
  const id = "s1-2", row = game.resolveHail(E, id, 1, 200);
  const run = JSON.parse(JSON.stringify(await planning(id)));
  assert.equal(run.booking_rows[0].title, row.title);
  const generator = E.R.hailRow;
  delete E.R.BY[id];
  E.R.hailRow = (...args) => ({ ...generator(...args), title: "Changed generator" });
  try {
    const result = await actor(run).instance.act("get_hail", {});
    assert.equal(result.title, row.title);
  } finally { E.R.hailRow = generator; E.R.admit(row); }
});

test("overlapping plan calls preserve two different legs and both plan charges", async () => {
  let entered, release;
  const firstLookup = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const a = actor(await planning(), { legGet: async () => { entered(); await gate; return null; } });
  const one = a.instance.act("plan_pickup", { car: "sf-03" });
  await firstLookup;
  const two = a.instance.act("plan_pickup", { car: "sf-03", wait_days: 1 });
  await new Promise(setImmediate);
  release();
  const results = await Promise.all([one, two]);
  assert.ok(results.every((r) => !r.error), JSON.stringify(results));
  assert.equal(new Set(results.map((r) => r.leg_id)).size, 2);
  const saved = a.saved.get("run");
  assert.equal(saved.calls, 2);
  assert.equal(Object.keys(saved.legs).length, 2);
});

test("a persisted leg from a different engine is ignored and the current leg is cached", async () => {
  const old = { from: "mars-base", to: "phobos", dep_jd: 2461700, arr_jd: 2461701, tof_days: 1, dv: 1, kwh: 999, fare: 999,
    gate: "local", refly: { result: "not re-flown: local transfer" }, arc_au: [[0, 0, 0]] };
  const a = actor(await planning(), { legGet: async (key) => key.startsWith("current-engine|") ? null : old });
  const first = await a.instance.act("plan_pickup", { car: "sf-03" });
  const second = await a.instance.act("plan_pickup", { car: "sf-03" });
  assert.equal(first.battery_kwh, 123);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(a.computes, 1);
  assert.ok(a.lookups.every((key) => key.startsWith("current-engine|")));
});

test("a rejected operation does not block later calls in the run queue", async () => {
  const a = actor(await planning());
  await assert.rejects(a.instance.act("missing_tool", {}), /not a run tool/);
  const result = await a.instance.act("get_hail", {});
  assert.equal(result.hail_id, "phobos-commute");
});

test("leaving a run during a pending plan preserves that leg and the abandoned state", async () => {
  let entered, release;
  const firstLookup = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const a = actor(await planning(), { legGet: async () => { entered(); await gate; return null; } });
  const plan = a.instance.act("plan_pickup", { car: "sf-03" });
  await firstLookup;
  const leave = a.instance.leave();
  await new Promise(setImmediate);
  release();
  await Promise.all([plan, leave]);
  const saved = a.saved.get("run");
  assert.equal(saved.phase, "abandoned");
  assert.equal(saved.calls, 1);
  assert.equal(Object.keys(saved.legs).length, 1);
});
