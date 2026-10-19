import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url), E = require("../src/engine/sol-page.cjs"), View = require("../src/flight-view.cjs");
const near = (a, b) => Math.abs(a - b) < 1e-6;

const incidents = [
  { kind: "dust_storm", place: "Mars Base", at: "2026-01-01 00:00", hours: 4 },
  { kind: "dust_storm", place: "Mars Base", at: "2026-01-01 04:00", hours: 2 },
  { kind: "pad_busy", place: "Mars Base", at: "2026-01-01 06:00", hours: 1 },
  { kind: "flare", place: "Earth", at: "2026-01-01 00:00", hours: 5 },
  { kind: "titan_haze", place: "Titan Dock", at: "2026-01-03 06:00", hours: 3 },
  { kind: "correction_burn", place: "Titan Dock", at: "2026-01-03 09:00", hours: 0 },
];

test("weather windows come from recorded storm and haze holds, joined across a checkpoint", () => {
  const w = View.weatherWindows(incidents, null, E.PLACES);
  assert.equal(w.length, 2);
  assert.deepEqual(w.map((x) => [x.kind, x.body]), [["dust_storm", "mars"], ["titan_haze", "titan"]]);
  assert.ok(near(w[0].from, 2461041.5) && near(w[0].to, 2461041.75), JSON.stringify(w[0]));
  assert.ok(near(w[1].from, 2461043.75) && near(w[1].to, 2461043.875), JSON.stringify(w[1]));
});

test("a live checkpoint held by weather keeps its window open, and other causes add none", () => {
  const live = View.weatherWindows(incidents.slice(4, 5), { cause: "titan_haze", place: "titan-dock", at: "2026-01-03 09:00" }, E.PLACES);
  assert.equal(live.length, 1);
  assert.ok(near(live[0].from, 2461043.75) && live[0].to === Infinity);
  assert.deepEqual(View.weatherWindows([], { cause: "pad_full", place: "mars-base", at: "2026-01-01 00:00" }, E.PLACES), []);
});

test("weather builds over the first hour, holds through the checkpoint and clears by the end", () => {
  const w = View.weatherWindows(incidents, null, E.PLACES), at = (body, jd) => View.weatherAt(w, body, jd);
  assert.equal(at("mars", 2461041.5), 0);
  assert.ok(near(at("mars", 2461041.5 + 0.5 / 24), 0.5));
  assert.equal(at("mars", 2461041.5 + 4 / 24), 1);
  assert.equal(at("mars", 2461041.75), 0);
  assert.equal(at("mars", 2461041.4), 0);
  assert.equal(at("titan", 2461041.5 + 2 / 24), 0);
  assert.equal(at("earth", 2461041.5 + 2 / 24), 0);
});
