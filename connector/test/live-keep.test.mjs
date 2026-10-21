import assert from "node:assert/strict";
import { test } from "node:test";
import { extendTrack, liveIdsToDrop, pieces, startTrack } from "../src/live.js";

const AFTER = 60 * 1000;
const HELD = 6 * 3600 * 1000;
const now = 1_000_000_000;

test("the newest landed flight stays after the live map window", () => {
  const rows = [
    { run_id: "run_aaaaaaaaaaaaaaaaaaaa", land_ms: now - AFTER - 1, updated_ms: now },
    { run_id: "run_bbbbbbbbbbbbbbbbbbbb", land_ms: now - AFTER - 10, updated_ms: now },
    { run_id: "run_cccccccccccccccccccc", land_ms: null, updated_ms: now },
  ];
  assert.deepEqual(liveIdsToDrop(rows, now, AFTER, HELD), ["run_bbbbbbbbbbbbbbbbbbbb"]);
});

test("a landed flight inside the window stays, and an older one leaves", () => {
  const rows = [
    { run_id: "run_aaaaaaaaaaaaaaaaaaaa", land_ms: now - 1000, updated_ms: now },
    { run_id: "run_bbbbbbbbbbbbbbbbbbbb", land_ms: now - AFTER - 5, updated_ms: now },
  ];
  assert.deepEqual(liveIdsToDrop(rows, now, AFTER, HELD), ["run_bbbbbbbbbbbbbbbbbbbb"]);
});

test("a held flight leaves after the hold window", () => {
  const rows = [
    { run_id: "run_aaaaaaaaaaaaaaaaaaaa", land_ms: null, updated_ms: now - HELD - 1 },
    { run_id: "run_bbbbbbbbbbbbbbbbbbbb", land_ms: null, updated_ms: now },
  ];
  assert.deepEqual(liveIdsToDrop(rows, now, AFTER, HELD), ["run_aaaaaaaaaaaaaaaaaaaa"]);
});

test("equal landing times keep the greater run id", () => {
  const land = now - AFTER - 50;
  const rows = [
    { run_id: "run_aaaaaaaaaaaaaaaaaaaa", land_ms: land, updated_ms: now },
    { run_id: "run_bbbbbbbbbbbbbbbbbbbb", land_ms: land, updated_ms: now },
  ];
  assert.deepEqual(liveIdsToDrop(rows, now, AFTER, HELD), ["run_aaaaaaaaaaaaaaaaaaaa"]);
});

test("a second pass drops nothing once the older landed flight is gone", () => {
  const rows = [
    { run_id: "run_aaaaaaaaaaaaaaaaaaaa", land_ms: now - AFTER - 1, updated_ms: now },
    { run_id: "run_bbbbbbbbbbbbbbbbbbbb", land_ms: now - AFTER - 10, updated_ms: now },
  ];
  const drop = new Set(liveIdsToDrop(rows, now, AFTER, HELD));
  const left = rows.filter((r) => !drop.has(r.run_id));
  assert.deepEqual(liveIdsToDrop(left, now, AFTER, HELD), []);
});

test("a ride held at launch before any leg flew has a one-point track, and the answer extends it forward", () => {
  const ride = { segs: [{ role: "pickup", dep_jd: 100, arr_jd: 101 }] }, mpu = 1000;
  const tr = startTrack(ride, 100.5, mpu, now);
  assert.deepEqual(tr, [[now, 100.5]]);
  ride.segs[0].flew = { dep_jd: 100.6, orbit_jd: 101.6, land_jd: 101.6 };
  const next = extendTrack(tr, pieces(ride, 101.6), mpu, now + 5000);
  assert.deepEqual(next, [[now, 100.5], [now + 5000, 100.5], [now + 6000, 101.6]]);
});
