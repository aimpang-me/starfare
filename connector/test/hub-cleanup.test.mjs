import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import * as game from "../src/game.js";
import { engine } from "../src/engine.js";
import { episodeText } from "../src/episode.js";
import { liveIdsToDrop } from "../src/live.js";
import { distinctPlayers, ensurePool, poolSize, recordBest } from "../src/hub-pool.js";

// store.js with its Worker imports stripped, as storage-plumbing.test.mjs does, over a real SQLite in memory.
function load() {
  const deps = {
    DurableObject: class { constructor(ctx, env) { this.ctx = ctx; this.env = env; } },
    engine, META: { sha256: "test" }, episodeText, ...game, liveIdsToDrop,
    playersIn: distinctPlayers, freezePool: ensurePool, storedPool: poolSize, recordBest, seasonSeed: async (env, s) => String(s),
  };
  const source = readFileSync(new URL("../src/store.js", import.meta.url), "utf8")
    .replace(/^import\s[\s\S]*?;\r?\n/gm, "")
    .replace(/\bexport (?=const |class )/g, "");
  return new Function(...Object.keys(deps), source + "\nreturn { StarfareHub, StarfareRun };")(...Object.values(deps));
}
const { StarfareHub, StarfareRun } = load();

function sqlite() {
  const db = new DatabaseSync(":memory:");
  return { exec(q, ...args) { const rows = db.prepare(q).all(...args); return { toArray: () => rows, one: () => rows[0] }; } };
}
const at = (ms, fn) => { const real = Date.now; Date.now = () => ms; try { return fn(); } finally { Date.now = real; } };
const DAY = 24 * 3600 * 1000, T = 1_800_000_000_000;

test("opening a Comms channel drops channels nobody checked in on after a day, and every channel after 30 days", () => {
  const sql = sqlite(), h = new StarfareHub({ storage: { sql } }, {});
  const quiet = at(T, () => h.commsOpen()).channel;
  const used = at(T, () => h.commsOpen());
  at(T + 1000, () => h.commsCheckIn(used.code, { client: "test" }, null));
  at(T + 1000, () => h.commsRun(used.channel, "run_x"));
  const fresh = at(T + DAY, () => h.commsOpen()).channel;

  at(T + DAY + 1000, () => h.commsOpen());
  assert.equal(h.commsView(quiet), null, "a day-old channel with no check-in is gone");
  assert.ok(h.commsView(used.channel).linked, "a channel an agent checked in on stays");
  assert.ok(h.commsView(fresh), "a newer quiet channel stays");

  at(T + 31 * DAY, () => h.commsOpen());
  assert.equal(h.commsView(used.channel), null, "every channel goes after 30 days");
  assert.equal(sql.exec("SELECT COUNT(*) AS n FROM comms_events WHERE channel = ?", used.channel).one().n, 0);
  assert.equal(sql.exec("SELECT COUNT(*) AS n FROM comms_runs WHERE channel = ?", used.channel).one().n, 0);
});

test("a run that never flew is deleted at its alarm; an arrived run stays; one still flying looks again later", async () => {
  const runAt = async (run) => {
    const saved = new Map(run ? [["run", run]] : []), alarms = [];
    const ctx = { storage: {
      async get(k) { return saved.get(k); }, async deleteAll() { saved.clear(); }, async setAlarm(t) { alarms.push(t); },
    } };
    await new StarfareRun(ctx, {}).alarm();
    return { kept: saved.has("run"), alarms };
  };
  assert.deepEqual(await runAt({ phase: "arrived" }), { kept: true, alarms: [] });
  assert.deepEqual(await runAt({ started: true }), { kept: true, alarms: [] }, "older runs mark arrival with started");
  assert.equal((await runAt({ phase: "planning" })).kept, false);
  assert.equal((await runAt({ abandoned: true })).kept, false);
  const flying = await runAt({ phase: "in_flight" });
  assert.equal(flying.kept, true);
  assert.equal(flying.alarms.length, 1);
});
