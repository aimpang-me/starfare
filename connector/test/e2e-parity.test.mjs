import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { SEASON_END, isoJD } from "../src/game.js";

const E = createRequire(import.meta.url)("../src/engine/sol-page.cjs");
const source = readFileSync(new URL("./e2e.mjs", import.meta.url), "utf8");

test("the checkpoint parity oracle includes the simulated reply delay in its flown result", () => {
  const fixtures = JSON.parse(readFileSync(new URL("../../world/engine/fixtures/fly-baseline.json", import.meta.url), "utf8"));
  const fixture = fixtures.rides.find((r) => r.hail === "ceres-shift" && r.seed === "17" && r.kind === "par");
  const start = source.indexOf("function nodeScore("), end = source.indexOf("/** take_hail,", start);
  const nodeScore = runInNewContext(source.slice(start, end) + "\nnodeScore;", {
    E, R: E.R, SEASON_END, isoJD,
    jdOf: (s) => Date.parse(s.replace(" ", "T") + ":00Z") / 864e5 + 2440587.5,
    computeLeg: (_E, from, to) => fixture.legs.find((L) => L.from === from && L.to === to),
  });
  const actual = nodeScore(fixture.hail, isoJD(fixture.t0), fixture.seed, fixture.car, 2, "exact", "energy", { hindsight: true });
  let expected = E.R.start(fixture.hail, fixture.car, fixture.legs, fixture.t0, fixture.seed, { ask_after_hours: 0, end_jd: SEASON_END });
  while (expected.checkpoint) expected = E.R.step(expected.ride, expected.checkpoint.default);
  assert.ok(expected.done.incidents.some((i) => i.kind === "awaiting_answer"));
  assert.deepEqual(actual.F.incidents, expected.done.incidents);
  assert.equal(actual.F.used_kwh, expected.done.used_kwh);
  assert.equal(actual.F.arrive_jd, expected.done.arrive_jd);
});

function quickPicker(call) {
  const start = source.indexOf("async function takeBookableQuick("), end = source.indexOf("function assertSeasonPool", start);
  return runInNewContext(source.slice(start, end) + "\ntakeBookableQuick;", { call, assert });
}

test("the pool integration check tries another quick booking after a physical tank refusal", async () => {
  const tried = [], picker = quickPicker(async (_client, _tool, { hail_id }) => {
    tried.push(hail_id);
    return hail_id === "too-far" ? { isError: true, value: "RTG class xenon tank holds 1085 kg and this leg needs 1424.8 kg" }
      : { isError: false, value: { hail_id, run_id: "run_bookable" } };
  });
  const hails = [{ hail_id: "long", kind: "long haul" }, { hail_id: "too-far", kind: "quick" }, { hail_id: "bookable", kind: "quick" }];
  const picked = await picker({}, hails);
  assert.equal(picked.booking.hail_id, "bookable");
  assert.equal(picked.hail.run_id, "run_bookable");
  assert.deepEqual(tried, ["too-far", "bookable"]);
});

test("the pool integration check never hides an unexpected server error", async () => {
  const picker = quickPicker(async () => ({ isError: true, value: "Internal server error" }));
  await assert.rejects(picker({}, [{ hail_id: "a", kind: "quick" }]), /Unexpected take_hail error/);
});
