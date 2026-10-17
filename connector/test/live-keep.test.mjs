import assert from "node:assert/strict";
import { test } from "node:test";
import { liveIdsToDrop } from "../src/live.js";

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
