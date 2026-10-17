// The episode report is a pure read of an arrived run. These tests name the contract:
// schema fields, the same text twice, no player id, a hidden test seed never exported,
// and neither the old ship slang nor the removed place name in the export.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import {
  SKY, checkPad, dispatch, isoJD, leaveRun, openRun, phaseOf, planPickup, planRideLeg, seasonInstance,
} from "../src/game.js";
import { seedFor } from "../src/suite.js";
import { EPISODE_PATH, EPISODE_SCHEMA, episodeText } from "../src/episode.js";

const E = createRequire(import.meta.url)("../src/engine/sol-page.cjs");
const R = E.R;
const RUN = "run_0123456789abcdef0123";
const PLAYER = "p_0123456789abcdef";
const skyAt = (jd) => SKY.t0_ms + Math.round((jd - SKY.jd0) * 1000);
const DUST_NOW = skyAt(2462172.6);
const LINE_KEYS = ["schema", "simulated", "run_id", "index", "steps", "kind", "observation", "action", "events", "checkpoint", "options", "reward", "outcome"];
const PART_KEYS = ["pickup", "on_time", "energy", "promise", "checker", "fare", "economy", "tank", "throttle", "window", "recovery", "dose"];
const slang = ["c", "ar"].join("");
const removed = ["Road", "ster"].join("");
const banned = new RegExp("\\b" + slang + "\\b|" + removed, "i");

function linesOf(text) {
  const rows = text.trim().split("\n").map((s) => JSON.parse(s));
  assert.equal(text.endsWith("\n"), true);
  assert.equal(rows.length, text.trim().split("\n").length);
  return rows;
}
function hasKey(v, key) {
  if (Array.isArray(v)) return v.some((x) => hasKey(x, key));
  if (v && typeof v === "object") return Object.keys(v).some((k) => k === key || hasKey(v[k], key));
  return false;
}

async function dustArrived() {
  const run = await openRun(E, seasonInstance(E, "phobos-commute", DUST_NOW), RUN, DUST_NOW);
  run.player_id = PLAYER;
  await checkPad(E, run, { place: "mars-base", hours: 6 }, DUST_NOW);
  const start = R.pickupStart(run.id, "sf-03", run.t0, run.seed);
  const p = (await planPickup(E, run, { car: "sf-03", wait_days: 2462174.529253031 - start })).leg;
  const r = (await planRideLeg(E, run, { after_leg: p.leg_id, wait_days: 2462175.529253031 - p.arr_jd - R.DWELL })).leg;
  const out = dispatch(E, run, { pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare, quoted_arrival: isoJD(r.arr_jd) }, DUST_NOW);
  assert.equal(out.status, "checkpoint");
  leaveRun(E, run);
  assert.equal(phaseOf(run), "arrived");
  return run;
}

test("an arrived ride exports one JSONL episode with the schema fields and the stored score parts", async () => {
  const run = await dustArrived();
  const text = await episodeText(E, run, null);
  const rows = linesOf(text);
  assert.ok(rows.length >= 3);
  rows.forEach((row, i) => {
    assert.deepEqual(Object.keys(row), LINE_KEYS);
    assert.equal(row.schema, EPISODE_SCHEMA);
    assert.equal(row.simulated, true);
    assert.equal(row.run_id, RUN);
    assert.equal(row.index, i);
    assert.equal(row.steps, rows.length);
  });
  const last = rows.at(-1);
  assert.equal(last.kind, "outcome");
  assert.equal(last.outcome.status, "arrived");
  assert.equal(last.outcome.phase, "arrived");
  assert.equal(last.outcome.simulated, true);
  assert.match(last.outcome.note, /Simulated/);
  assert.equal(last.reward.total, run.score.total);
  assert.equal(last.reward.out_of, run.score.out_of);
  assert.equal(last.reward.score_version, run.score.score_version);
  assert.deepEqual(last.reward.parts.map((p) => p.key), PART_KEYS);
  assert.deepEqual(last.reward.parts.map((p) => p.key), run.score.parts.map((p) => p.key));
  for (const part of last.reward.parts) {
    const src = run.score.parts.find((p) => p.key === part.key);
    assert.equal(part.got, src.got);
    assert.equal(part.max, src.max);
    assert.equal(part.label, src.label);
    assert.equal(part.unit, src.unit);
    assert.equal(part.measure, src.measure);
    assert.equal(part.note, src.note);
  }
  for (const row of last.reward.measures) assert.equal(row.value, run.score[row.key]);
  assert.deepEqual(last.reward.measures.map((row) => row.unit), ["hours", "hours", "usd", "kwh", "kwh", "kwh", "kwh", "kwh", "msv"]);
  const cps = rows.filter((row) => row.kind === "checkpoint");
  assert.ok(cps.length >= 1);
  cps.forEach((row, i) => {
    assert.deepEqual(row.options.map((o) => o.action), run.ride.checkpoints[i].options.map((o) => o.action));
    assert.equal(row.action.tool, "decide");
    assert.ok(row.checkpoint && row.checkpoint.n === run.ride.checkpoints[i].n);
  });
  assert.equal(rows.some((row) => row.kind === "forecast" && row.action.tool === "check_pad"), true);
  assert.equal(rows.some((row) => row.kind === "plan"), true);
  const weather = rows.flatMap((row) => row.events).filter((e) => e.weather);
  assert.ok(weather.some((e) => e.kind === "dust_storm" && e.seed === run.seed));
  rows.slice(0, -1).forEach((row) => {
    assert.equal(row.reward, null);
    assert.equal(row.outcome, null);
  });
});

test("the same arrived run exports the same text twice", async () => {
  const run = await dustArrived();
  assert.equal(await episodeText(E, run, null), await episodeText(E, run, null));
});

test("the export leaves out the player id, a best mark, and the removed words", async () => {
  const run = await dustArrived();
  const text = await episodeText(E, run, null);
  const rows = linesOf(text);
  assert.equal(text.includes(PLAYER), false);
  assert.equal(text.includes("player_id"), false);
  assert.equal(text.includes("player_tag"), false);
  assert.equal(rows.some((row) => hasKey(row, "best")), false);
  assert.equal(text.includes("options_hindsight"), false);
  assert.equal(banned.test(text), false);
  const src = readFileSync(new URL("../src/episode.js", import.meta.url), "utf8");
  assert.equal(banned.test(src), false);
});

test("a hidden test seed exports nothing and a public dev seed does", async () => {
  const run = await dustArrived();
  const suite = { id: "episode", world: "per_task" };
  const task = { id: "t-hidden" };
  const hidden = await seedFor(suite, "test", task, 0, "hidden-split-key");
  const dev = await seedFor(suite, "dev", task, 0);
  assert.notEqual(hidden, dev);
  assert.equal(await episodeText(E, { ...run, tag: task.id, seed: hidden }, suite), null);
  assert.equal(await episodeText(E, { ...run, tag: null, seed: hidden }, suite), null);
  const text = await episodeText(E, { ...run, tag: task.id, seed: dev, player_id: PLAYER }, suite);
  assert.equal(typeof text, "string");
  assert.equal(text.includes(dev), true);
  assert.equal(text.includes(hidden), false);
  assert.equal(text.includes(PLAYER), false);
  assert.equal(banned.test(text), false);
  const live = await episodeText(E, run, null);
  assert.equal(live.includes(run.seed), true);
});

test("a ride that has not arrived exports nothing", async () => {
  const run = await openRun(E, seasonInstance(E, "iss-crew", DUST_NOW), RUN, DUST_NOW);
  assert.equal(await episodeText(E, run, null), null);
});

test("the episode path is the flight id plus episode.jsonl", () => {
  assert.equal(EPISODE_PATH.test("/flight/" + RUN + "/episode.jsonl"), true);
  assert.equal(EPISODE_PATH.exec("/flight/" + RUN + "/episode.jsonl")[1], RUN);
  assert.equal(EPISODE_PATH.test("/flight/" + RUN), false);
  assert.equal(EPISODE_PATH.test("/flight/" + RUN + ".json"), false);
  assert.equal(EPISODE_PATH.test("/flight/433f24/episode.jsonl"), false);
});
