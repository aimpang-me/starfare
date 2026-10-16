// The bench harness: suite seeds, the suite file check, the in-process host, the baselines and serve.mjs over MCP stdio.
// Run: node build.mjs && node --test test/bench-harness.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import META from "../src/engine/meta.json" with { type: "json" };
import { SCORE_VERSION } from "../src/game.js";
import { SUITE_FORMAT, loadSuite, seedFor } from "../src/suite.js";
import { BenchBackend, loadEngine, openTask } from "../bench/backend.mjs";
import { naive, random, reference, rngOf } from "../bench/agents.mjs";
import { runSuite } from "../bench/run.mjs";
import { benchCall, benchView, endTask, newSession } from "../src/bench-host.js";

const E = loadEngine();
const SOLO = { id: "iss-crew/fixture", hail_id: "iss-crew", clock_jd: 2461550.0 };
const SHARED = { id: "ceres-shift+phobos-commute/fixture", hails: ["ceres-shift", "phobos-commute"], clock_jd: 2461550.0 };
const SUITE = { format: SUITE_FORMAT, id: "fixture", engine_sha256: META.sha256, score_version: SCORE_VERSION, budget: 60, world: "per_task", margin: 5, splits: { dev: [SOLO] } };

async function play(task, agent, budget = 60) {
  const b = new BenchBackend(E, await openTask(E, { ...SUITE, budget }, task, "2"));
  await agent((tool, input) => b.call(tool, input));
  return b.finish();
}

test("seeds are k1 and 32 hex, the same every time, one world per task unless per_repeat; test seeds need the key", async () => {
  const a = await seedFor(SUITE, "dev", SOLO, 0), b = await seedFor(SUITE, "dev", SOLO, 3);
  assert.match(a, /^k1:[0-9a-f]{32}$/);
  assert.equal(a, b);
  assert.notEqual(a, await seedFor(SUITE, "dev", SHARED, 0));
  const perRepeat = { ...SUITE, world: "per_repeat" };
  assert.notEqual(await seedFor(perRepeat, "dev", SOLO, 0), await seedFor(perRepeat, "dev", SOLO, 1));
  await assert.rejects(seedFor(SUITE, "test", SOLO, 0), { message: "the test split needs STARFARE_BENCH_KEY" });
  const k1 = await seedFor(SUITE, "test", SOLO, 0, "key-one"), k2 = await seedFor(SUITE, "test", SOLO, 0, "key-two");
  assert.match(k1, /^k1:[0-9a-f]{32}$/);
  assert.notEqual(k1, k2);
  assert.notEqual(k1, a);
});

test("loadSuite refuses a suite cut for another engine, another score version, or with no budget", () => {
  assert.equal(loadSuite(JSON.stringify(SUITE)).id, "fixture");
  assert.throws(() => loadSuite({ ...SUITE, engine_sha256: "abc" }), { message: "suite fixture was cut for engine abc; this bundle is " + META.sha256 });
  assert.throws(() => loadSuite({ ...SUITE, score_version: 0 }), { message: "suite fixture was cut for score version 0; this game scores version " + SCORE_VERSION });
  assert.throws(() => loadSuite({ ...SUITE, budget: 0 }), { message: "suite fixture has no tool-call budget" });
  assert.throws(() => loadSuite({ ...SUITE, format: "x" }), { message: "not a " + SUITE_FORMAT + " file" });
});

test("the host shows one hail and its task_id, refuses another hail, and counts every call against the budget", async () => {
  const b = new BenchBackend(E, await openTask(E, { ...SUITE, budget: 3 }, SOLO, "2"));
  const list = await b.call("list_hails", {});
  assert.equal(list.task_id, "iss-crew/fixture");
  assert.deepEqual(list.hails.map((h) => h.hail_id), ["iss-crew"]);
  assert.equal((await b.call("take_hail", { hail_id: "titan-home" })).error, "this task's hail is iss-crew; take that one");
  assert.deepEqual(await b.call("get_my_rides", {}), { rides: [], note: "Bench mode: no ride history. Each task starts fresh." });
  assert.equal((await b.call("list_hails", {})).error, "this task has used its budget of 3 tool calls; no more calls are answered");
  const f = b.finish();
  assert.deepEqual([f.run.tool_calls, f.over_budget, f.score], [3, true, { phase: "planning", total: 0, parts: null }]);
});

test("naive, random and the reference on one hail", async () => {
  const n = await play(SOLO, (call) => naive(call, E));
  assert.deepEqual([n.score.total, n.run.tool_calls, n.run.calls], [90, 7, 4]);
  const r = await play(SOLO, (call) => random(call, E, rngOf(SOLO.id + "|0")));
  assert.deepEqual([r.score.total, r.run.tool_calls], [41, 5]);
  const ref = reference(E, await openTask(E, SUITE, SOLO, "2"));
  assert.deepEqual([ref.total, ref.car, ref.label], [100, "sf-01", "energy/energy"]);
});

test("naive, random and the reference on a shared flight of two bookings", async () => {
  const n = await play(SHARED, (call) => naive(call, E));
  assert.deepEqual([n.score.phase, n.score.total, n.run.calls], ["arrived", 56, 12]);
  const r = await play(SHARED, (call) => random(call, E, rngOf(SHARED.id + "|0")));
  assert.equal(r.score.phase, "arrived");
  const ref = reference(E, await openTask(E, SUITE, SHARED, "2"));
  assert.deepEqual([ref.total, ref.car], [80, "sf-04"]);
  assert.ok(ref.total >= n.score.total);
});

test("run.mjs runs naive over a split and writes one row and one ride record per attempt", async () => {
  const records = [];
  const res = await runSuite({ suite: SUITE, split: "dev", agent: "naive", labels: { agent: "naive", model: "none" }, repeats: 2, records });
  assert.equal(res.format, "starfare.results/1");
  assert.deepEqual(res.rows.map((r) => [r.task_id, r.repeat, r.score.phase, r.meta.over_budget]), [["iss-crew/fixture", 0, "arrived", false], ["iss-crew/fixture", 1, "arrived", false]]);
  assert.equal(res.rows[0].score.total, res.rows[1].score.total);
  assert.deepEqual(records.map((r) => [r.task_id, r.phase, "seed" in r]), [["iss-crew/fixture", "arrived", false], ["iss-crew/fixture", "arrived", false]]);
});

test("hosted session: tasks in order, each closed on arrival or from the watch page, then the session refuses calls", async () => {
  const tasks = [SOLO, { ...SOLO, id: "iss-crew/fixture-2" }, { ...SOLO, id: "iss-crew/fixture-3" }];
  const suite = { ...SUITE, splits: { dev: tasks } };
  let s = { ...newSession(suite, "b_test", null, 0), tasks };
  const results = [];
  const call = async (tool, input) => {
    const r = await benchCall(E, suite, s, tool, input, 0);
    s = r.session;
    results.push(r.result);
    return r.result;
  };
  await naive(call, E);
  const last = results.at(-1);
  assert.equal(last.status, "arrived");
  assert.deepEqual(last.bench, { task: "1 of 3", task_id: "iss-crew/fixture", calls_used: 7, budget: 60, ended: { why: "arrived", phase: "arrived", total: 93 },
    next: "Task 2 of 3 is next. Call list_hails to open it; it has its own run_id." });

  let e = endTask(E, s);
  s = e.session;
  assert.deepEqual(e.result, { task_id: "iss-crew/fixture-2", phase: "not started", total: 0 });
  assert.equal((await call("list_hails", {})).bench.notice, "Task 2 was ended on the watch page; this call is on task 3 of 3, with its own run_id from take_hail.");
  assert.equal(benchView(s).current.calls_used, 1);

  e = endTask(E, s);
  s = e.session;
  assert.deepEqual(e.result, { task_id: "iss-crew/fixture-3", phase: "planning", total: 0, done: true, bench_total: 93 });
  assert.deepEqual(await call("list_hails", {}), { error: "This bench session is over. start_bench starts a new one.", bench: { done: true } });
  const v = benchView(s);
  assert.deepEqual([v.done, v.current, v.total, v.out_of], [true, null, 93, 300]);
  assert.deepEqual(v.tasks.map((t) => [t.task_id, t.status, t.result.phase, t.result.ended]), [
    ["iss-crew/fixture", "done", "arrived", "arrived"],
    ["iss-crew/fixture-2", "done", "not started", "ended on the watch page"],
    ["iss-crew/fixture-3", "done", "planning", "ended on the watch page"],
  ]);
});

test("serve.mjs over MCP stdio: an agent plays a dev task to arrival", async () => {
  const dir = mkdtempSync(join(tmpdir(), "starfare-harness-")), file = join(dir, "suite.json");
  writeFileSync(file, JSON.stringify(SUITE));
  const client = new Client({ name: "harness-test", version: "0.1.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL("../bench/serve.mjs", import.meta.url)), "--suite", file, "--task", SOLO.id] }));
  try {
    assert.equal((await client.listTools()).tools.length, 11);
    assert.match(client.getInstructions(), /Bench mode \(simulated\)/);
    let last;
    await naive(async (tool, input) => {
      const r = await client.callTool({ name: tool, arguments: input });
      return (last = r.isError ? { error: r.content[0].text } : JSON.parse(r.content[0].text));
    }, E);
    assert.equal(last.status, "arrived");
    assert.equal(last.task_id, "iss-crew/fixture");
  } finally {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
