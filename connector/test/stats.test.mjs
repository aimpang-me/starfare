// Bench statistics: per-task means, the cluster and paired bootstraps, tau-bench's pass^k, the ranked table and the CLI.
// Run: node --test test/stats.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { meanInterval, pairedInterval, passK, rankTable, successRule } from "../src/stats.js";

const row = (task_id, repeat, total, phase = "arrived") => ({ task_id, repeat, score: { phase, total, parts: null } });
const ALPHA = [row("t1", 0, 80), row("t1", 1, 90), row("t1", 2, 100), row("t2", 0, 50), row("t2", 1, 0, "planning"), row("t2", 2, 70)];
const NAIVE = [row("t1", 0, 85), row("t2", 0, 60)];
const BETA = [row("t1", 0, 100), row("t1", 1, 100), row("t1", 2, 100)];
const file = (agent, repeats, rows) => ({ format: "starfare.results/1", suite: "fixture", split: "dev", labels: { agent, model: agent === "naive" ? "none" : "m-" + agent },
  engine_sha256: "2e77512f1a34c7d2aa", score_version: 3, budget: 60, repeats, rows });
const r4 = (x) => (x == null ? x : Math.round(x * 1e4) / 1e4);

test("pass^k is tau-bench's C(c,k)/C(n,k) per task, averaged, not 'the first k all succeed'", () => {
  const beatNaive = successRule(NAIVE).test;
  // t1: 80 < 85, 90, 100 -> c=2 of 3. t2: 50 < 60, not landed, 70 -> c=1 of 3.
  assert.deepEqual([1, 2, 3].map((k) => r4(passK(ALPHA, k, beatNaive))), [0.5, 0.1667, 0]);
  // Landed only: t1 c=3, t2 c=2. pass^2 = (1 + 1/3) / 2. The first two attempts at t2 do not both land, yet pass^2 at t2 is 1/3.
  const landed = successRule(null).test;
  assert.deepEqual([1, 2, 3].map((k) => r4(passK(ALPHA, k, landed))), [0.8333, 0.6667, 0.5]);
  assert.equal(passK(NAIVE, 2, landed), null);
});

test("the success rule is a labelled placeholder, and naive must cover every task it judges", () => {
  assert.deepEqual([successRule(NAIVE).placeholder, successRule(NAIVE).text], [true, "the flight landed and scored at least naive's score on that task"]);
  assert.equal(successRule(null).text, "the flight landed");
  assert.throws(() => successRule([row("t1", 0, 85)]).test(row("t2", 0, 90)), { message: "the naive results have no row for task t2" });
});

test("the mean is over per-task means, and the interval resamples tasks with their repeats", () => {
  // Tasks t1 = 90 and t2 = 40. A resample is both t1 (90), both t2 (40) or one each (65), each tail 25%.
  assert.deepEqual(meanInterval(ALPHA), { tasks: 2, mean: 65, lo: 40, hi: 90 });
  // One attempt at 100 and three at 0: the row mean would be 25; the task mean is 50.
  assert.deepEqual(meanInterval([row("a", 0, 100), row("b", 0, 0), row("b", 1, 0), row("b", 2, 0)]), { tasks: 2, mean: 50, lo: 0, hi: 100 });
  assert.deepEqual(meanInterval([]), { tasks: 0, mean: null, lo: null, hi: null });
});

test("the bootstrap interval is reproducible from its seed", () => {
  const seven = [12.5, 33.3, 41, 58.9, 64.2, 77.7, 91.4].map((t, i) => row("t" + i, 0, t));
  const at = (opts) => { const m = meanInterval(seven, opts); return [m.tasks, r4(m.mean), r4(m.lo), r4(m.hi)]; };
  assert.deepEqual(at(), [7, 54.1429, 34.8857, 71.4189]);
  assert.deepEqual(at({ seed: 1 }), [7, 54.1429, 34.8857, 71.4189]);
  assert.deepEqual(at({ seed: 2 }), [7, 54.1429, 35.4843, 72.3857]);
  assert.deepEqual(at({ seed: 1, draws: 200 }), [7, 54.1429, 33.5571, 71.0618]);
  const shuffled = [...seven].reverse();
  assert.deepEqual(meanInterval(shuffled), meanInterval(seven));
});

test("the paired bootstrap differences two agents on the tasks both played", () => {
  // Per task: t1 90 - 85 = 5, t2 40 - 60 = -20. naive's t3 has no partner and is left out.
  assert.deepEqual(pairedInterval(ALPHA, [...NAIVE, row("t3", 0, 99)]), { tasks: 2, diff: -7.5, lo: -20, hi: 5 });
  assert.deepEqual(pairedInterval(ALPHA, [row("t9", 0, 1)]), { tasks: 0, diff: null, lo: null, hi: null });
});

test("rankTable ranks complete rows by mean with the gap to the next, and lists rows missing tasks apart", () => {
  const t = rankTable([file("alpha", 3, ALPHA), file("naive", 1, NAIVE), file("beta", 3, BETA)], { naive: file("naive", 1, NAIVE) });
  assert.deepEqual([t.suite, t.split, t.k, t.draws, t.seed, t.rule], ["fixture", "dev", 3, 2000, 1, { placeholder: true, text: "the flight landed and scored at least naive's score on that task" }]);
  assert.deepEqual(t.ranked.map((r) => [r.rank, r.agent, r.model, r.tasks_played, r.tasks_total, r.mean, r.lo, r.hi, r.pass.map(r4), r.gap_to_next]), [
    [1, "naive", "none", 2, 2, 72.5, 60, 85, [1], { tasks: 2, diff: 7.5, lo: -5, hi: 20 }],
    [2, "alpha", "m-alpha", 2, 2, 65, 40, 90, [0.5, 0.1667, 0], null],
  ]);
  assert.deepEqual(t.unranked.map((r) => [r.agent, r.tasks_played, r.tasks_total, r.missing, r.mean, r.pass]), [["beta", 1, 2, ["t2"], 100, [1, 1, 1]]]);
  const bySuite = rankTable([file("alpha", 3, ALPHA)], { tasks: ["t1", "t2", "t3"] });
  assert.deepEqual([bySuite.ranked.length, bySuite.unranked[0].missing], [0, ["t3"]]);
});

test("rankTable refuses files from different runs or of another format", () => {
  assert.throws(() => rankTable([file("alpha", 3, ALPHA), { ...file("naive", 1, NAIVE), suite: "other" }]), {
    message: "results from different runs cannot share a table: suite fixture, split dev, engine_sha256 2e77512f1a34c7d2aa, score_version 3 vs suite other, split dev, engine_sha256 2e77512f1a34c7d2aa, score_version 3",
  });
  assert.throws(() => rankTable([{ ...file("alpha", 3, ALPHA), format: "x" }]), { message: "not a starfare.results/1 file" });
});

test("stats.mjs prints the ranked table and writes the Markdown table", () => {
  const dir = mkdtempSync(join(tmpdir(), "starfare-stats-"));
  try {
    const paths = [["alpha", 3, ALPHA], ["naive", 1, NAIVE], ["beta", 3, BETA]].map(([a, k, rows]) => {
      const p = join(dir, a + ".json");
      writeFileSync(p, JSON.stringify(file(a, k, rows)));
      return p;
    });
    const md = join(dir, "table.md");
    const out = spawnSync(process.execPath, [fileURLToPath(new URL("../bench/stats.mjs", import.meta.url)), ...paths, "--md", md], { encoding: "utf8" });
    assert.equal(out.stderr, "");
    assert.equal(out.stdout, [
      "Starfare bench, suite fixture, dev split, score version 3, engine 2e77512f1a34",
      "",
      "rank      agent  model    tasks  mean   95% interval    pass^1  pass^2  pass^3  gap to next",
      "1         naive  none     2/2    72.5   [60.0, 85.0]    1.00    -       -       +7.5 [-5.0, 20.0]",
      "2         alpha  m-alpha  2/2    65.0   [40.0, 90.0]    0.50    0.17    0.00    -",
      "unranked  beta   m-beta   1/2    100.0  [100.0, 100.0]  1.00    1.00    1.00    -",
      "",
      "Scores are simulated. Agent and model labels are self-reported.",
      "mean: the mean over tasks of each task's mean score. 95% interval: cluster bootstrap over tasks (repeats kept together), 2000 draws, seed 1.",
      "pass^k: the chance that k fresh attempts at a task all succeed (tau-bench's unbiased estimator), averaged over tasks.",
      "Success (placeholder rule, waiting on Alvin): the flight landed and scored at least naive's score on that task.",
      "gap to next: this row minus the next ranked row, paired bootstrap over the tasks both played. An interval that spans 0 does not separate them.",
      "Unranked rows are missing tasks or attempts and are not ranked:",
      "  beta / m-beta lacks 3 attempts at 1 of 2 tasks: t2",
      "",
      "wrote " + md,
      "",
    ].join("\n"));
    assert.equal(readFileSync(md, "utf8"), [
      "## Starfare bench, suite fixture, dev split, score version 3, engine 2e77512f1a34",
      "",
      "| rank | agent | model | tasks | mean | 95% interval | pass^1 | pass^2 | pass^3 | gap to next |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| 1 | naive | none | 2/2 | 72.5 | [60.0, 85.0] | 1.00 | - | - | +7.5 [-5.0, 20.0] |",
      "| 2 | alpha | m-alpha | 2/2 | 65.0 | [40.0, 90.0] | 0.50 | 0.17 | 0.00 | - |",
      "| unranked | beta | m-beta | 1/2 | 100.0 | [100.0, 100.0] | 1.00 | 1.00 | 1.00 | - |",
      "",
      "Scores are simulated. Agent and model labels are self-reported.",
      "",
      "mean: the mean over tasks of each task's mean score. 95% interval: cluster bootstrap over tasks (repeats kept together), 2000 draws, seed 1.",
      "",
      "pass^k: the chance that k fresh attempts at a task all succeed (tau-bench's unbiased estimator), averaged over tasks.",
      "",
      "Success (placeholder rule, waiting on Alvin): the flight landed and scored at least naive's score on that task.",
      "",
      "gap to next: this row minus the next ranked row, paired bootstrap over the tasks both played. An interval that spans 0 does not separate them.",
      "",
      "Unranked rows are missing tasks or attempts and are not ranked:",
      "",
      "- beta / m-beta lacks 3 attempts at 1 of 2 tasks: t2",
      "",
    ].join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
