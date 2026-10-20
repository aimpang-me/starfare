import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { evalSlice, pageSF } from "./page-slice.mjs";
import { test } from "node:test";
import * as game from "../src/game.js";

const E = createRequire(import.meta.url)("../src/engine/sol-page.cjs");
const View = createRequire(import.meta.url)("../src/flight-view.cjs");
const AgentLog = createRequire(import.meta.url)("../src/agent-log.cjs");
const html = (name) => readFileSync(new URL(`../src/${name}.html`, import.meta.url), "utf8");
function browserApi(name, SITE) {
  return pageSF(html(name), name === "site", { SITE, SOLE: E });
}

test("the public booking desk admits seasonal rows and closes stale seasons until refreshed", async () => {
  const hails = game.seasonHails(E, 1, 3);
  for (const h of hails) delete E.R.BY[h.hail_id];
  const SITE = { sky: game.SKY, look: {}, season: 1, pool_size: 3, hails };
  const SF = browserApi("site", SITE);
  await SF.loadEngine();
  assert.deepEqual(Array.from(SF.desk(game.SKY.t0_ms + 1000), (h) => h.id), hails.map((h) => h.hail_id));
  assert.equal(SF.desk(game.SKY.t0_ms + game.SKY.len_days * 1000).length, 0);
});

const record = {
  hail_id: "a", score: { car: "SF-04", bookings: [{ hail_id: "a", parts: [{ key: "pickup", got: 12, max: 20 }] }, { hail_id: "b", parts: [{ key: "pickup", got: 3, max: 20 }] }] },
  manifest: { car: "sf-04", seats: 6,
    bookings: [{ hail_id: "a", rider: "Ana", party: 2, from: "ceres-port", to: "mars-base" }, { hail_id: "b", rider: "Ravi", party: 3, from: "phobos", to: "mars-base" }],
    stops: [{ at: "ceres" }, { at: "ceres-port", board: ["a"] }, { at: "mars-base", alight: ["a"] }, { at: "phobos", board: ["b"] }, { at: "mars-base", alight: ["b"] }] },
  log: { hail: "a", from: "ceres-port", to: "mars-base", flown: [
    { from: "ceres", to: "ceres-port", stop: 1, arrive: "2030-01-01 01:00" },
    { from: "ceres-port", to: "mars-base", stop: null, arrive: "2030-01-02 00:00" }, // orbit, then divert: no passengers alight
    { from: "mars-base", to: "phobos", stop: null, arrive: "2030-01-02 01:00" },
    { from: "phobos", to: "mars-base", stop: 2, arrive: "2030-01-02 02:00" },
    { from: "mars-base", to: "phobos", stop: 3, arrive: "2030-01-02 03:00" },
    { from: "phobos", to: "mars-base", stop: 4, arrive: "2030-01-02 04:00" },
  ] },
};

test("the flight passenger list follows recorded stops through diversions and repeated destinations", () => {
  const source = html("flight");
  const SF = { SHIP: "Starseeker", fmt: String };
  // A shared helper, if loaded by the page, is supplied exactly as the browser asset does.
  const ctx = { RIDE: { record, lg: record.log }, SF, window: { StarfareView: View }, hailOf: () => null };
  const P = evalSlice(source, "function passengerList(", "function renderPlist", "passengerList()", ctx);
  assert.equal(P.bookings.length, 2);
  assert.deepEqual(Array.from(P.bookings, (b) => [b.id, b.party, b.b, b.a]), [["a", 2, 1, 4], ["b", 3, 5, 6]]);
  assert.equal(P.stops[2].alight.length, 0, "reaching orbit must not drop passengers before landing");
  assert.equal(P.stops[3].board.length, 0, "a diversion to another booking's pickup must not board it early");
  assert.equal(P.seats, 6);
  assert.deepEqual(Array.from(P.bookings, (b) => b.score.parts[0].got), [12, 3]);
});

test("replay selects the dispatched arc even when an unused alternative is closer to the delayed departure", () => {
  const SF = browserApi("flight", { sky: game.SKY, look: {}, hails: [] });
  SF.init(E);
  const flown = { leg: "ride", leg_id: "leg2", from: "iss", to: "lunar-data-center", depart: "2030-01-01 00:00", arrive: "2030-01-06 00:00", gate: "PASS" };
  const t = SF.jdOf(flown.depart), arc = (dep, n) => ({ from: flown.from, to: flown.to, dep_jd: dep, arr_jd: dep + 5, arc_au: [[n, 0, 0], [n, 1, 0]] });
  const ride = { record: { log: { flown: [flown] }, score: { car: "SF-01", incidents: [] } }, legs: [], trail: [], arcs: { leg2: arc(t - 1, 1), unused: arc(t, 9) } };
  assert.equal(SF.replay(ride, null).legs[0].arc.arc_au[0][0], 1);
});

test("public flight records retain booking identity, cabin counts and segment stop mapping", async () => {
  const NOW = game.SKY.t0_ms + 100000;
  const run = await game.openRun(E, game.seasonInstance(E, "phobos-commute", NOW), "run_00000000000000000001", NOW);
  const p = (await game.planPickup(E, run, { car: "sf-03" })).leg;
  const r = (await game.planRideLeg(E, run, { after_leg: p.leg_id })).leg;
  game.dispatch(E, run, { pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare, quoted_arrival: game.isoJD(r.arr_jd), ask_after_hours: "never" }, NOW);
  game.flyLive(run, NOW);
  const rec = game.liveRecord(E, run, NOW);
  assert.equal(rec.manifest.bookings[0].hail_id, run.id);
  assert.equal(rec.manifest.bookings[0].party, 1);
  assert.equal(rec.manifest.seats, E.R.CAR[run.car].seats);
  assert.deepEqual(rec.live.flown.map((f) => f.stop), [1, 2]);
  assert.deepEqual(rec.live.flown.map((f) => f.leg_id), [p.leg_id, r.leg_id]);
  const row = game.liveRow(E, run).v;
  assert.equal(row.hail_id, run.id);
  assert.equal(row.legs[0].car, run.car);
  const seats = E.R.CAR[run.car].seats;
  try {
    E.R.CAR[run.car].seats = 999;
    assert.equal(game.liveRecord(E, run, NOW).manifest.seats, seats, "a stored flight's cabin must not change with the current engine");
  } finally { E.R.CAR[run.car].seats = seats; }
});

test("cabin occupancy counts every person, while legacy missing numbers remain unknown", () => {
  const P = View.passengerList(record, record.log, () => null);
  assert.equal(View.seatCount(View.aboardAt(P, 1)), 2);
  assert.equal(View.seatCount(View.aboardAt(P, 3)), 2);
  assert.equal(View.seatCount(View.aboardAt(P, 4)), 0);
  assert.equal(View.seatCount(View.aboardAt(P, 5)), 3);
  assert.equal(View.seatCount(View.aboardAt(P, 6)), 0);
  assert.match(View.seatsHtml(View.aboardAt(P, 5), P.seats), /<b>3<\/b> \/ <b>6<\/b>/);
  const old = View.passengerList({ score: {} }, { hail: "old", from: "ceres", to: "mars-base", flown: [{ from: "base", to: "ceres" }, { from: "ceres", to: "mars-base" }] }, () => null);
  assert.equal(old.seats, null);
  assert.equal(old.bookings[0].party, null);
  assert.equal(View.seatCount(View.aboardAt(old, 1)), null);
  assert.match(View.seatsHtml(View.aboardAt(old, 1), old.seats), /unknown.*not recorded/);
});

test("a live shared manifest shows future stops without boarding passengers at an open orbital hold", () => {
  const rec = structuredClone(record);
  rec.score = null;
  rec.live = { flown: [{ from: "ceres", to: "ceres-port", open: true, stop: null }],
    planned: [{ from: "ceres-port", to: "mars-base", stop: 2 }, { from: "mars-base", to: "phobos", stop: 3 }, { from: "phobos", to: "mars-base", stop: 4 }] };
  const P = View.passengerList(rec, { hail: "a" }, () => null);
  assert.equal(View.aboardAt(P, 0).length, 0);
  assert.equal(View.aboardAt(P, 1).length, 0);
  assert.equal(P.bookings[1].b, 3);
  assert.equal(P.stops[3].planned, true);
  assert.equal(P.bookings[0].score, null);
});

test("the home map uses stored flight arcs and explicit booking identity, never the generic route planner", () => {
  const source = html("site");
  const arc = { from: "ceres", to: "ceres-port", dep_jd: 2461700, arr_jd: 2461701, arc_au: [[1, 0, 0], [1, 1, 0]] };
  const f = { run_id: "run_0123456789abcdef0123", hail_id: "a", title: "Same title", ship: "SF-04", manifest: record.manifest,
    legs: [{ kind: "pickup", car: "sf-04", leg_id: "chosen", stop: 1, from: arc.from, to: arc.to, dep_jd: 2461700, arr_jd: 2461701 }],
    arcs: { chosen: arc }, track: [[0, 2461700], [1000, 2461701]] };
  const out = evalSlice(source, "function liveArc(", "function makeFlight", "liveRide(f).ride", { f, SF: {}, iso: String });
  assert.equal(out.record.log.hail, "a");
  assert.equal(out.record.log.flown[0].arc, arc);
  assert.equal(out.record.log.flown[0].leg, "pickup");
  assert.equal(out.record.manifest.bookings.length, 2);
});

test("the home scoreboard uses the fresh board catalog, including a winner absent from the old page snapshot", async () => {
  const source = html("site");
  const nodes = new Map(), $ = (s) => {
    if (!nodes.has(s)) nodes.set(s, { innerHTML: "", insertAdjacentHTML(_where, text) { this.innerHTML += text; } });
    return nodes.get(s);
  };
  const j = { season: 2, pool_size: 1, hails: [{ hail_id: "s2-0", title: "Seasonal winner" }], legacy_hails: [],
    best: { "s2-0": { points: 12, car: "sf-03", run_id: "run_0123456789abcdef0123", run_tag: "012345" } }, stats: { runs_scored: 1 } };
  evalSlice(source, "function openBoard()", "function closeBoard()", "openBoard()", { $, $$: () => [], PILOT: {}, document: {}, setTimeout() {},
    fetch: async () => ({ ok: true, json: async () => j }), SF: { SITE: { hails: [], fleet: [] }, SCORE_PARTS: [["pickup", "Pickup", 100]] },
    fmt: String, esc: String, RUN_ID: /^run_[0-9a-f]{20}$/ });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match($("#boardRows").innerHTML, /Seasonal winner/);
  assert.match($("#boardRows").innerHTML, /href="\/flight\/run_0123456789abcdef0123"/);
});

test("shared dispatch feed shows each booking's quote and escapes agent-controlled content", () => {
  const source = html("flight");
  const t = { tool: "dispatch", route: ["leg1"], car: "SF-04", status: "arrived", at_ms: 0, note: "why <b>", quotes: {
    "a<script>": { fare_usd: 20, arrival: "2030-01-01 00:00" }, b: { fare_usd: 30, arrival: "2030-01-02 00:00" } } };
  const L = AgentLog.line(t);
  assert.match(L.text, /a<script>: fare \$20/);
  assert.match(L.text, /b: fare \$30, promised 2030-01-02 00:00/);
  assert.equal(L.why, "why <b>");
  // The flight page renders it with AgentLog.row, which escapes every word of it before it reaches the page.
  assert.match(source, /AgentLog\.row\(L, \{ ms: t\.at_ms, words: shipWords/);
  const row = AgentLog.row(L);
  assert.match(row, /a&lt;script&gt;: fare/);
  assert.match(row, /Why: <q>why &lt;b&gt;<\/q>/);
  assert.doesNotMatch(row, /<script>|<b>/);
});

test("recorded time conflicts are detected without retiming the flight", () => {
  const rec = { live: { flown: [
    { depart: "2030-01-01 00:00", arrive: "2030-01-01 02:00" },
    { depart: "2030-01-01 01:00", arrive: "2030-01-01 03:00" },
  ] } };
  const before = JSON.stringify(rec);
  assert.deepEqual(View.timingConflicts(rec, {}), [2]);
  assert.equal(JSON.stringify(rec), before);
  assert.deepEqual(View.timingConflicts({}, { flown: [{ depart: "2030-01-01 00:00", arrive: "2030-01-01 01:00" }, { depart: "2030-01-01 01:01" }] }), []);
});

test("replay timeline dates round-trip the recorded minute without slipping into the previous minute", () => {
  const SF = browserApi("flight", { sky: game.SKY, look: {}, hails: [] });
  for (const s of ["2030-07-23 01:00", "2030-07-23 03:48", "2030-07-23 06:02"]) assert.equal(SF.iso(SF.jdOf(s)), s);
});

test("the home map keeps a flight visible before launch and labels a held checkpoint as awaiting its agent", () => {
  const source = html("site");
  const f = { run_id: "run_0123456789abcdef0123", home: "ceres", legs: [], track: [[0, 2461700]], hold: { kind: "launch_hold", place: "ceres" } };
  const SF = { place: () => ({ id: "ceres" }) };
  const cleaned = evalSlice(source, "function liveArc(", "function makeFlight", "liveClean(f)", { f, SF });
  assert.equal(cleaned.legs[0].idle, true);
  assert.equal(cleaned.legs[0].from, "ceres");
  const flight = { f, rp: { at: () => ({ phase: "arrived" }), record: { score: { incidents: [] } }, legs: [{ arr: 2461700 }] } };
  const result = evalSlice(source, "function statusOf(", "/* ---------- passenger list", "[statusOf(flight, 2461700).k, etaOf(flight, 2461700), arrOf(flight)]", { flight, SF });
  assert.deepEqual(Array.from(result), ["hold", "awaiting agent", "Pending agent decision"]);
});

test("a completed replay is arrived at its exact final track time on both pages", async () => {
  const SITE = { sky: game.SKY, look: {}, hails: [] };
  for (const name of ["site", "flight"]) {
    const SF = browserApi(name, SITE);
    if (name === "site") await SF.loadEngine(); else SF.init(E);
    const f = { leg: "ride", from: "iss", to: "lunar-data-center", depart: "2030-01-01 00:00", arrive: "2030-01-06 00:00" };
    const ride = { record: { log: { flown: [f] }, score: { car: "SF-01", incidents: [] } }, legs: [], trail: [], arcs: {} };
    const replay = SF.replay(ride, null);
    assert.equal(replay.at(replay.end).phase, "arrived", name);
  }
});

test("a thousand-booking desk renders twenty cards, searches all rows, and keeps card nodes while its clock updates", () => {
  const source = html("site");
  const nodes = new Map(), ready = []; let writes = 0, markup = "";
  const list = { get innerHTML() { return markup; }, set innerHTML(s) {
    writes++; markup = s; ready.length = 0;
    for (const m of s.matchAll(/data-ready="([^"]+)"/g)) ready.push({ dataset: { ready: m[1] }, textContent: "" });
  } };
  const $ = (s) => s === "#bkList" ? list : nodes.get(s) || (nodes.set(s, { value: "" }), nodes.get(s));
  const DESK = Array.from({ length: 1000 }, (_, i) => ({ id: `s1-${i}`, title: "Booking", kind: "quick", rider: "Passenger", party: 1, from: "a", to: "b", open: true, ready_jd: 100 }));
  const ctx = { $, $$: () => ready, DESK, BK: {}, BOOKING_PAGE: 0, BOOKING_PAGE_SIZE: 20, SEL: { t: "n" }, SF: { name: String },
    esc: String, W: String, ic: () => "", placeH: String, iso: String, loreOf: () => null, FICT: "" };
  // Keep the same function object, as in the page, including its cached last markup.
  const render = evalSlice(source, "function renderBookings()", "function startPlan(", "renderBookings", ctx);
  render(); assert.equal(ready.length, 20); assert.equal($("#bkPage").textContent, "1–20 of 1000");
  DESK.forEach((d) => d.ready_jd++); render();
  assert.equal(writes, 1, "clock updates must not replace buttons and discard keyboard focus or click targets");
  assert.match(ready[0].textContent, /101/);
  ctx.BOOKING_PAGE = 49; render(); assert.equal(ready[0].dataset.ready, "s1-980"); assert.equal(ready.length, 20);
  $("#bkSearch").value = "s1-999"; render();
  assert.equal(ready.length, 1); assert.equal(ready[0].dataset.ready, "s1-999");
});
