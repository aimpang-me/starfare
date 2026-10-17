import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { formatReport, simulate } from "../sim.mjs";

test("careful does not score below naive on phobos-commute seeds 2 and 7", async () => {
  const report = await simulate({
    policies: ["naive", "careful"],
    seeds: ["2", "7"],
    hails: ["phobos-commute"],
  });
  for (const seed of ["2", "7"]) {
    const naive = report.rows.find((row) => row.policy === "naive" && row.seed === seed);
    const careful = report.rows.find((row) => row.policy === "careful" && row.seed === seed);
    assert.equal(naive.terminal, "landed");
    assert.equal(careful.terminal, "landed");
    assert.ok(
      careful.total >= naive.total,
      `seed ${seed} careful ${careful.total} naive ${naive.total}`,
    );
  }
});

test("careful does not score below naive on ceres-shift seeds 2 and 7", async () => {
  const report = await simulate({
    policies: ["naive", "careful"],
    seeds: ["2", "7"],
    hails: ["ceres-shift"],
  });
  for (const seed of ["2", "7"]) {
    const naive = report.rows.find((row) => row.policy === "naive" && row.seed === seed);
    const careful = report.rows.find((row) => row.policy === "careful" && row.seed === seed);
    assert.equal(naive.terminal, "landed");
    assert.equal(careful.terminal, "landed");
    assert.ok(
      careful.total >= naive.total,
      `seed ${seed} careful ${careful.total} naive ${naive.total}`,
    );
  }
});

test("score v2 parts sum to the total and keep their units", async () => {
  const report = await simulate({
    policies: ["naive"],
    seeds: ["1"],
    hails: ["iss-crew"],
  });
  const row = report.rows[0];
  assert.equal(row.terminal, "landed");
  assert.equal(row.outOf, 100000);
  assert.equal(row.total, row.parts.reduce((acc, part) => acc + part.got, 0));
  assert.ok(row.total > 0 && row.total < row.outOf / 2, row.total);
  for (const part of row.parts) assert.ok(part.got < part.max || part.max === 0, part.key);
  const printed = formatReport(report);
  assert.match(printed, /Score out of 100000\./);
  assert.match(printed, /pickup \(min\)/);
  assert.match(printed, /Skills: tier top, noise 0, look depth 3\. Simulated assumptions, not real model benchmark numbers\./);
});

test("noise 0 matches a run that omits the skill flags", async () => {
  const spec = { policies: ["random"], seeds: ["1"], hails: ["iss-crew"] };
  const plain = await simulate(spec);
  const named = await simulate({ ...spec, skill: "top", noise: 0 });
  assert.deepEqual(named.rows, plain.rows);
});

test("noise can replace a checkpoint answer and a quote", async () => {
  const flipped = await simulate({
    policies: ["naive", "bad"],
    seeds: ["7"],
    hails: ["ceres-shift", "iss-crew"],
    skill: "top",
    noise: 1,
  });
  assert.equal(flipped.rows.length, 4);
  assert.equal(flipped.skill, "top");
  assert.equal(flipped.noise, 1);
  assert.equal(flipped.lookDepth, 3);
});

const SEEDS_1_TO_8 = ["1", "2", "3", "4", "5", "6", "7", "8"];

function partMean(report, key) {
  const landed = report.rows.filter((row) => row.parts);
  return landed.reduce((sum, row) => sum + row.parts.find((part) => part.key === key).got, 0) / landed.length;
}

test("careful lands a hail when another ship can fly and the earliest pickup cannot", async () => {
  const report = await simulate({
    policies: ["careful"],
    seeds: SEEDS_1_TO_8,
    hails: ["jovian-hop", "titan-home", "ceres-shift"],
    skill: "weak",
  });
  assert.equal(report.rows.length, 24);
  for (const row of report.rows) {
    assert.equal(row.terminal, "landed", `${row.hailId} seed ${row.seed} ${row.terminal}`);
  }
});

test("careful landed mean beats naive over seeds 1 to 8", async () => {
  const report = await simulate({ policies: ["naive", "careful"], seeds: SEEDS_1_TO_8 });
  const careful = report.means.find((mean) => mean.policy === "careful");
  const naive = report.means.find((mean) => mean.policy === "naive");
  assert.equal(careful.landed + careful.stranded, 40);
  assert.equal(naive.landed + naive.stranded, 40);
  assert.ok(careful.mean > naive.mean, `careful ${careful.mean} naive ${naive.mean}`);
});

test("bad noise raises fare and promise because the other quote is the ride quote", async () => {
  const top = await simulate({ policies: ["bad"], seeds: SEEDS_1_TO_8, skill: "top" });
  const weak = await simulate({ policies: ["bad"], seeds: SEEDS_1_TO_8, skill: "weak" });
  assert.equal(partMean(top, "fare"), 0);
  assert.equal(partMean(top, "promise"), 0);
  assert.ok(partMean(weak, "fare") > 0);
  assert.ok(partMean(weak, "promise") > 0);
  const topMean = top.means[0].mean;
  const weakMean = weak.means[0].mean;
  assert.ok(weakMean > topMean, `weak ${weakMean} top ${topMean}`);
});

test("parseArgs reads skill and noise", () => {
  const run = spawnSync(process.execPath, [
    "sim.mjs",
    "--skill", "mid",
    "--noise", "0",
    "--policies", "naive",
    "--seeds", "1",
    "--hails", "iss-crew",
  ], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /Skills: tier mid, noise 0, look depth 1\. Simulated assumptions, not real model benchmark numbers\./);
  assert.match(run.stdout, /Score out of 100000\./);
  const unknown = spawnSync(process.execPath, [
    "sim.mjs",
    "--skill", "genius",
    "--policies", "naive",
    "--seeds", "1",
    "--hails", "iss-crew",
  ], { encoding: "utf8" });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stdout, /unknown skill/);
});
