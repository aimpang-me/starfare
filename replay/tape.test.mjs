import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import {
  SKY, checkPad, dispatch, isoJD, jdOfIso, leaveRun, openRun, phaseOf, planPickup, planRideLeg, seasonInstance,
} from "../connector/src/game.js";
import { episodeText } from "../connector/src/episode.js";
import { phobosExport } from "./mint-sample.mjs";

const require = createRequire(import.meta.url);
const E = require("../connector/src/engine/sol-page.cjs");
const tape = require("./tape.js");
const R = E.R;
const RUN = "run_0123456789abcdef0123";
const PLAYER = "p_0123456789abcdef";
const AU = 149597870.7;
const skyAt = (jd) => SKY.t0_ms + Math.round((jd - SKY.jd0) * 1000);
const DUST_NOW = skyAt(2462172.6);
const shipWord = ["c", "ar"].join("");
const removed = ["Road", "ster"].join("");
const playerId = ["player", "_id"].join("");
const playerTag = ["player", "_tag"].join("");
const hindsight = ["options", "_hindsight"].join("");
const seedHead = ["k", "1"].join("") + ":";
const taxi = ["robo", "taxi"].join("");
const banned = new RegExp("\\b" + shipWord + "\\b|" + removed, "i");
const seedRe = new RegExp(seedHead + "[0-9a-f]{32}", "i");
const em = "\u2014";
const en = "\u2013";

function soleOf() {
  return {
    PLACES: E.PLACES,
    EPHEM_RANGE: E.EPHEM_RANGE,
    placeState: function (id, jd) {
      assert.notEqual(id, "sun");
      return E.placeState(id, jd);
    },
  };
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function placeAu(id, jd) {
  const r = E.placeState(id, jd).r;
  return [r[0] / AU, r[1] / AU, r[2] / AU];
}

function lerp(a, b, f) {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function axes(v, s) {
  return [v[0] * s, v[2] * s, -v[1] * s];
}

async function dustArrived() {
  const run = await openRun(E, seasonInstance(E, "phobos-commute", DUST_NOW), RUN, DUST_NOW);
  run[playerId] = PLAYER;
  await checkPad(E, run, { place: "mars-base", hours: 6 }, DUST_NOW);
  const start = R.pickupStart(run.id, "sf-03", run.t0, run.seed);
  const p = (await planPickup(E, run, { [shipWord]: "sf-03", wait_days: 2462174.529253031 - start })).leg;
  const r = (await planRideLeg(E, run, { after_leg: p.leg_id, wait_days: 2462175.529253031 - p.arr_jd - R.DWELL })).leg;
  const out = dispatch(E, run, { pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare, quoted_arrival: isoJD(r.arr_jd) }, DUST_NOW);
  assert.equal(out.status, "checkpoint");
  leaveRun(E, run);
  assert.equal(phaseOf(run), "arrived");
  return run;
}

let ready;
function fixture() {
  if (!ready) {
    ready = dustArrived().then(async (run) => {
      const text = await episodeText(E, run, null);
      const arcsText = tape.projectArcs(run);
      return { run, text, arcsText, rows: text.trim().split("\n").map((s) => JSON.parse(s)) };
    });
  }
  return ready;
}

function load(text, arcsText) {
  return tape.loadReplay(text, arcsText, soleOf());
}

function assertRefusalClean(result, token) {
  assert.equal(result.ok, false);
  assert.equal(result.reason, "banned-document");
  assert.equal(result.text.includes(token), false);
  assert.equal(banned.test(result.text), false);
  assert.equal(result.text.toLowerCase().includes(playerId), false);
  assert.equal(result.text.toLowerCase().includes(playerTag), false);
  assert.equal(result.text.toLowerCase().includes(hindsight), false);
  assert.equal(seedRe.test(result.text), false);
  assert.equal("score" in result, false);
}

test("projectArcs copies the stored samples and repeats the same string", async () => {
  const { run, text, arcsText } = await fixture();
  assert.equal(typeof arcsText, "string");
  assert.equal(arcsText, tape.projectArcs(run));
  assert.equal(arcsText.endsWith("\n"), true);
  assert.equal(arcsText.includes("arc_au"), true);
  assert.equal(arcsText.includes(RUN), true);
  assert.equal(text.includes("arc_au"), false);
  const arcs = JSON.parse(arcsText);
  assert.equal(arcs.schema, "starfare.arcs/1");
  assert.equal(arcs.simulated, true);
  assert.equal(arcs.run_id, RUN);
  assert.deepEqual(arcs.legs.map((leg) => leg.leg_id), ["leg1", "leg2"]);
  assert.deepEqual(Object.keys(arcs.legs[0]), ["leg_id", "from", "to", "dep_jd", "arr_jd", "arc_au"]);
  assert.deepEqual(arcs.legs[0].arc_au, run.legs.leg1.arc_au.map((p) => [p[0], p[1], p[2]]));
  assert.deepEqual(arcs.legs[1].arc_au, run.legs.leg2.arc_au.map((p) => [p[0], p[1], p[2]]));
  assert.equal(JSON.stringify(arcs).includes('"' + shipWord + '"'), false);
  assert.equal(tape.projectArcs(null), null);
  assert.equal(tape.projectArcs({ run_id: RUN, legs: {} }), null);
  assert.equal(tape.projectArcs({
    run_id: RUN,
    legs: {
      leg1: { leg_id: "leg1", from: "mars-base", to: "phobos", dep_jd: 1, arr_jd: 2, arc_au: [[0, 0, 0]] },
    },
  }), null);
  assert.equal(tape.projectArcs({
    run_id: RUN,
    legs: {
      leg9: { leg_id: "leg9", from: removed, to: "phobos", dep_jd: 1, arr_jd: 2, arc_au: [[0, 0, 0], [1, 0, 0]] },
    },
  }), null);
});

test("a loaded flight hides the score until arrival and then copies the seven parts", async () => {
  const { text, arcsText, rows } = await fixture();
  const loaded = load(text, arcsText);
  assert.equal(loaded.ok, true);
  const clock = loaded.clock;
  assert.equal(clock.playing, false);
  assert.equal(clock.speed, 1);
  assert.equal(clock.runId, RUN);
  assert.equal(clock.shipName, "SF-03");
  assert.equal(clock.jd, clock.span.start);
  const early = tape.frameAt(clock, soleOf());
  assert.equal(early.ok, true);
  assert.equal(early.score, null);
  assert.equal(early.minute, "2029-02-06 23:42");
  assert.equal(early.phase, "before");
  assert.equal(early.shipText, "Starseeker SF-03");
  assert.equal(early.note, rows.at(-1).outcome.note);
  assert.equal(early.view.mode, "local");
  assert.equal(early.view.primary, "mars");
  assert.equal(early.view.bodies.some((b) => b.id === "sun"), false);
  assert.ok(early.recorded.some((m) => m.text.includes("Plan flight")));
  assert.ok(early.recorded.some((m) => m.text.includes("Recorded before departure. The file has no call time.")));
  assert.ok(early.arrived.some((m) => m.text === "Check pad"));
  assert.equal(early.arrived.some((m) => m.text.includes("Passengers aboard")), false);
  const mid = tape.reduce(clock, { type: "scrub", jd: (clock.span.start + clock.span.end) / 2 });
  assert.equal(tape.frameAt(mid, soleOf()).score, null);
  const done = tape.reduce(clock, { type: "scrub", jd: clock.span.end });
  const arrived = tape.frameAt(done, soleOf());
  const reward = rows.at(-1).reward;
  assert.equal(arrived.score, null);
  assert.equal(arrived.caption, "Arrived.");
  assert.equal(arrived.minute, rows.at(-1).outcome.arrive);
  let showing = tape.reduce(done, { type: "play" });
  showing = tape.reduce(showing, { type: "tick", seconds: 4 });
  assert.equal(tape.frameAt(showing, soleOf()).score, null);
  showing = tape.reduce(showing, { type: "tick", seconds: 2 });
  const first = tape.frameAt(showing, soleOf());
  assert.equal(first.score.parts.length, 1);
  assert.equal(first.score.total, null);
  assert.equal(first.score.parts[0].got, reward.parts[0].got);
  assert.equal(first.score.parts[0].max, reward.parts[0].max);
  showing = tape.reduce(showing, { type: "tick", seconds: 12 });
  const frame = tape.frameAt(showing, soleOf());
  assert.equal(frame.score.total, reward.total);
  assert.equal(frame.score.outOf, reward.out_of);
  assert.deepEqual(frame.score.parts.map((p) => ({ key: p.key, label: p.label, got: p.got, max: p.max, note: p.note })), reward.parts);
  assert.deepEqual(frame.score.measures, reward.measures);
  assert.equal(frame.score.parShip, "SF-03");
  assert.ok(frame.arrived.some((m) => m.text.includes("Booking phobos-commute")));
  assert.ok(frame.arrived.some((m) => m.text.includes("Starseeker SF-03")));
});

test("hold at the closed pad is the place, and the transfer stays on the recorded samples", async () => {
  const { text, arcsText, rows } = await fixture();
  const loaded = load(text, arcsText);
  const clock = loaded.clock;
  const cp = rows.find((row) => row.kind === "checkpoint");
  const cpJd = jdOfIso(cp.checkpoint.at);
  const heldClock = tape.reduce(clock, { type: "scrub", jd: cpJd });
  const held = tape.frameAt(heldClock, soleOf());
  assert.equal(held.phase, "hold");
  assert.ok(dist(held.au, placeAu(cp.checkpoint.place, cpJd)) < 1e-8);
  const mars = placeAu("mars", cpJd);
  const rel = [held.au[0] - mars[0], held.au[1] - mars[1], held.au[2] - mars[2]];
  const ship = axes(rel, AU / 1000);
  assert.ok(dist(held.view.ship, ship) < 1e-6);
  assert.equal(held.view.bodies.find((b) => b.id === "mars").kind, "planet");
  assert.equal(held.view.bodies.find((b) => b.id === "phobos").kind, "moon");
  assert.equal(held.view.bodies.find((b) => b.id === "mars-base").kind, "station");
  assert.ok(held.arrived.some((m) => m.text.includes("Passengers aboard")));
  assert.ok(held.arrived.some((m) => m.text.includes("Used " + cp.observation.used_kwh + " kWh at this checkpoint.")));
  assert.equal(held.arrived.some((m) => m.tool === "decide"), false);
  const reply = tape.frameAt(tape.reduce(clock, { type: "scrub", jd: jdOfIso(cp.observation.reply_arrives) }), soleOf());
  assert.ok(reply.arrived.some((m) => m.tool === "decide" && m.text === "Decision"));
  assert.equal(held.score, null);

  const hop = rows.at(-1).observation.flown[0];
  const arcs = JSON.parse(arcsText);
  const arc = arcs.legs.find((leg) => leg.from === hop.from && leg.to === hop.to);
  const depart = jdOfIso(hop.depart);
  const orbit = arc.arr_jd + (depart - arc.dep_jd);
  const midJd = depart + 0.5 * (orbit - depart);
  const frame = tape.frameAt(tape.reduce(clock, { type: "scrub", jd: midJd }), soleOf());
  assert.equal(frame.phase, "transfer");
  assert.equal(frame.score, null);
  const n = arc.arc_au.length;
  const k = 0.5 * (n - 1);
  const j = Math.min(n - 2, Math.floor(k));
  const sample = lerp(arc.arc_au[j], arc.arc_au[j + 1], k - j);
  const tp = arc.dep_jd + 0.5 * (arc.arr_jd - arc.dep_jd);
  const s0 = placeAu("mars", tp);
  const s1 = placeAu("mars", midJd);
  const rebased = [sample[0] - s0[0] + s1[0], sample[1] - s0[1] + s1[1], sample[2] - s0[2] + s1[2]];
  const step = dist(arc.arc_au[j], arc.arc_au[Math.min(n - 1, j + 1)]);
  const chord = lerp(placeAu(hop.from, midJd), placeAu(hop.to, midJd), 0.5);
  assert.ok(dist(frame.au, rebased) < 1e-9);
  assert.ok(dist(frame.au, rebased) < step);
  assert.ok(dist(frame.au, chord) > step);
});

function segmentGap(a, b, origin) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ao = [origin[0] - a[0], origin[1] - a[1], origin[2] - a[2]];
  const ab2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  let f = ab2 ? (ao[0] * ab[0] + ao[1] * ab[1] + ao[2] * ab[2]) / ab2 : 0;
  if (f < 0) f = 0;
  if (f > 1) f = 1;
  const p = [a[0] + ab[0] * f, a[1] + ab[1] * f, a[2] + ab[2] * f];
  return Math.hypot(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]);
}

test("the drawn arc stays outside the primary", async () => {
  const { text, arcsText } = await fixture();
  const clock = load(text, arcsText).clock;
  const frame = tape.frameAt(tape.reduce(clock, { type: "scrub", jd: (clock.span.start + clock.span.end) / 2 }), soleOf());
  const mars = frame.view.bodies.find((b) => b.id === "mars");
  const lines = Array.isArray(frame.view.trails) ? frame.view.trails : [frame.view.trail];
  let cuts = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      if (segmentGap(line[i - 1], line[i], mars.position) < mars.radius) cuts++;
    }
  }
  assert.equal(cuts, 0);
  assert.ok(lines.some((line) => line.length >= 2));
});

test("pause, a paused tick, and a scrub to the current date keep the same clock", async () => {
  const { text, arcsText } = await fixture();
  const clock = load(text, arcsText).clock;
  assert.equal(tape.reduce(clock, { type: "pause" }), clock);
  assert.equal(tape.reduce(clock, { type: "tick", seconds: 5 }), clock);
  assert.equal(tape.reduce(clock, { type: "scrub", jd: clock.jd }), clock);
  assert.equal(tape.reduce(clock, { type: "speed", speed: 1 }), clock);
  assert.equal(tape.reduce(clock, { type: "speed", speed: 3 }), clock);
  const playing = tape.reduce(clock, { type: "play" });
  assert.equal(playing.playing, true);
  assert.equal(playing.jd, clock.jd);
  assert.equal(tape.reduce(playing, { type: "play" }), playing);
  const fast = tape.reduce(playing, { type: "speed", speed: 2 });
  assert.equal(fast.speed, 2);
  assert.equal(tape.reduce(fast, { type: "speed", speed: 2 }), fast);
  const target = clock.span.start + (clock.span.end - clock.span.start) * 0.25;
  const scrubbed = tape.reduce(fast, { type: "scrub", jd: target });
  assert.equal(scrubbed.jd, target);
  assert.equal(scrubbed.playing, true);
  const later = tape.reduce(scrubbed, { type: "tick", seconds: 1 });
  assert.ok(later.jd > scrubbed.jd);
  assert.ok(later.jd <= scrubbed.span.end);
  const done = tape.reduce(clock, { type: "scrub", jd: clock.span.end });
  const paused = tape.reduce(done, { type: "pause" });
  assert.equal(tape.reduce(paused, { type: "tick", seconds: 5 }).jd, done.jd);
  const revealing = tape.reduce(done, { type: "play" });
  assert.equal(revealing.playing, true);
  assert.equal(revealing.jd, clock.span.end);
  const finished = tape.reduce(revealing, { type: "tick", seconds: 30 });
  assert.equal(finished.playing, false);
  assert.equal(finished.jd, clock.span.end);
  const again = tape.reduce(finished, { type: "play" });
  assert.equal(again.playing, true);
  assert.equal(again.jd, clock.span.start);
  const lost = tape.frameAt({ ...clock }, soleOf());
  assert.equal(lost.ok, false);
  assert.equal(lost.reason, "lost-clock");
  assert.equal(lost.score, undefined);
  assert.equal(lost.total, undefined);
  assert.deepEqual(Object.keys(tape).sort(), ["frameAt", "loadReplay", "projectArcs", "reduce"]);
});

test("a banned document is refused without quoting the token", async () => {
  const { text, arcsText } = await fixture();
  const tokens = [
    playerId,
    playerTag,
    hindsight,
    seedHead + "0123456789abcdef0123456789abcdef",
    " " + shipWord + " ",
    removed,
  ];
  for (const token of tokens) {
    assertRefusalClean(load(text.replace("JPL DE421", "JPL DE421 " + token), arcsText), token.trim());
    assertRefusalClean(load(text, arcsText.replace("starfare.arcs/1", "starfare.arcs/1 " + token)), token.trim());
  }
  const short = seedHead + "a".repeat(31);
  assert.equal(load(text.replace("JPL DE421", "JPL DE421 " + short), arcsText).ok, true);
  const escaped = playerId.split("").map((ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0")).join("");
  const hidden = '{"schema":"starfare.episode/1","note":"' + escaped + '"}\n';
  assert.equal(hidden.includes(playerId), false);
  assertRefusalClean(load(hidden, arcsText), playerId);
});

test("a flown hop with no stored samples refuses the file", async () => {
  const { text, arcsText, rows } = await fixture();
  const hop = rows.at(-1).observation.flown[0];
  const arcs = JSON.parse(arcsText);
  arcs.legs = arcs.legs.filter((leg) => !(leg.from === hop.from && leg.to === hop.to));
  const refused = load(text, JSON.stringify(arcs) + "\n");
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "missing-recorded-arc");
  assert.equal(refused.clock, undefined);
  assert.equal(refused.score, undefined);
});

test("the page sources omit the banned words and the dashes", () => {
  const tapeSrc = readFileSync(new URL("./tape.js", import.meta.url), "utf8");
  const htmlSrc = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const testSrc = readFileSync(new URL("./tape.test.mjs", import.meta.url), "utf8");
  for (const src of [tapeSrc, htmlSrc, testSrc, readFileSync(new URL("./mint-sample.mjs", import.meta.url), "utf8")]) {
    assert.equal(banned.test(src), false);
    assert.equal(src.includes(taxi), false);
    assert.equal(src.includes(em), false);
    assert.equal(src.includes(en), false);
  }
  assert.equal(htmlSrc.includes("planLeg"), false);
  assert.equal(htmlSrc.includes("placeState"), false);
  assert.equal(htmlSrc.includes("innerHTML"), false);
  assert.equal(htmlSrc.includes("sol-art"), false);
  assert.equal(tapeSrc.includes("planLeg"), false);
  assert.ok(htmlSrc.includes("Recorded flight"));
  assert.ok(htmlSrc.includes("Simulated"));
  assert.ok(htmlSrc.includes(">Play<"));
  assert.ok(htmlSrc.includes(">Pause<"));
  assert.ok(htmlSrc.includes("Sky time"));
  assert.ok(htmlSrc.includes("Episode file"));
  assert.ok(htmlSrc.includes("Arc file"));
  assert.ok(htmlSrc.includes("sample/phobos.episode.jsonl"));
  assert.ok(htmlSrc.includes("sample/phobos.arcs.json"));
  assert.ok(htmlSrc.includes('aria-label="Score"'));
  assert.ok(htmlSrc.includes('aria-label="Log"'));
  assert.ok(htmlSrc.includes("requestAnimationFrame"));
  assert.ok(htmlSrc.includes('type: "scrub"'));
  assert.ok(htmlSrc.includes('type: "tick"'));
  assert.ok(htmlSrc.includes("paintTrail(frame.view.trails)"));
  assert.equal(htmlSrc.includes("paintTrail(frame.view.trail)"), false);
  const three = htmlSrc.indexOf("three.min.js");
  const sole = htmlSrc.indexOf("sol-page.js");
  const page = htmlSrc.indexOf("tape.js");
  assert.ok(three >= 0 && three < sole && sole < page);
});

test("the checked-in Phobos sample matches a fresh export and loads", async () => {
  const { text, arcsText } = await fixture();
  const minted = await phobosExport();
  const episode = readFileSync(new URL("./sample/phobos.episode.jsonl", import.meta.url), "utf8");
  const arcs = readFileSync(new URL("./sample/phobos.arcs.json", import.meta.url), "utf8");
  assert.equal(episode, text);
  assert.equal(arcs, arcsText);
  assert.equal(minted.text, text);
  assert.equal(minted.arcsText, arcsText);
  const loaded = load(episode, arcs);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.clock.playing, false);
  assert.equal(JSON.parse(episode.trim().split("\n")[0]).simulated, true);
  assert.equal(JSON.parse(arcs).simulated, true);
  const held = tape.frameAt(loaded.clock, soleOf());
  assert.equal(held.ok, true);
  assert.equal(held.view.mode, "local");
  assert.equal(held.score, null);
});

test("an outer hail replays in the heliocentric view and hides the score until arrival", async () => {
  const runId = "run_0a11e7a11e7a11e7a11e";
  const run = await openRun(E, seasonInstance(E, "titan-home", DUST_NOW), runId, DUST_NOW);
  const ship = run.par_car;
  const p = (await planPickup(E, run, { [shipWord]: ship })).leg;
  const r = (await planRideLeg(E, run, { after_leg: p.leg_id })).leg;
  const out = dispatch(E, run, {
    pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare, quoted_arrival: isoJD(r.arr_jd),
  }, DUST_NOW);
  assert.equal(out.status, "checkpoint");
  leaveRun(E, run);
  assert.equal(phaseOf(run), "arrived");
  const text = await episodeText(E, run, null);
  const arcsText = tape.projectArcs(run);
  assert.equal(typeof text, "string");
  const loaded = load(text, arcsText);
  assert.equal(loaded.ok, true);
  const midJd = (loaded.clock.span.start + loaded.clock.span.end) / 2;
  const mid = tape.frameAt(tape.reduce(loaded.clock, { type: "scrub", jd: midJd }), soleOf());
  assert.equal(mid.ok, true);
  assert.equal(mid.view.mode, "helio");
  assert.equal(mid.phase, "transfer");
  assert.equal(mid.score, null);
  assert.equal(mid.view.bodies.some((b) => b.id === "sun"), true);
  const end = tape.frameAt(tape.reduce(loaded.clock, { type: "scrub", jd: loaded.clock.span.end }), soleOf());
  const reward = JSON.parse(text.trim().split("\n").at(-1)).reward;
  assert.equal(end.phase, "arrived");
  assert.equal(end.score, null);
  assert.equal(end.view.mode, "helio");
  let shown = tape.reduce(loaded.clock, { type: "scrub", jd: loaded.clock.span.end });
  shown = tape.reduce(shown, { type: "play" });
  shown = tape.reduce(shown, { type: "tick", seconds: 20 });
  const scored = tape.frameAt(shown, soleOf());
  assert.equal(scored.score.total, reward.total);
  assert.equal(scored.score.parts.length, 7);
  assert.equal(scored.view.mode, "helio");
});

test("a departure and a decision hold the sky clock while the caption stays", async () => {
  const { text, arcsText, rows } = await fixture();
  const clock = load(text, arcsText).clock;
  const hop = rows.at(-1).observation.flown[0];
  const depart = jdOfIso(hop.depart);
  let at = tape.reduce(clock, { type: "scrub", jd: depart });
  at = tape.reduce(at, { type: "play" });
  const held = tape.reduce(at, { type: "tick", seconds: 1 });
  const frame = tape.frameAt(held, soleOf());
  assert.equal(held.jd, depart);
  assert.equal(frame.caption, "Departure. Mars Base to Phobos.");
  assert.equal(frame.captions.filter((line) => line === frame.caption).length, 1);
  const moved = tape.reduce(held, { type: "tick", seconds: 4 });
  assert.ok(moved.jd > depart);
  const cp = rows.find((row) => row.kind === "checkpoint");
  const reply = tape.frameAt(tape.reduce(clock, { type: "scrub", jd: jdOfIso(cp.observation.reply_arrives) }), soleOf());
  assert.equal(reply.caption, "Decision. Hold.");
  const closed = tape.frameAt(tape.reduce(clock, { type: "scrub", jd: jdOfIso(cp.checkpoint.at) }), soleOf());
  assert.equal(closed.caption, "Checkpoint. Mars Base. A dust storm closed the pad.");
  const slow = tape.reduce(at, { type: "speed", speed: 1 });
  const fast = tape.reduce(at, { type: "speed", speed: 4 });
  const slowJd = tape.reduce(slow, { type: "tick", seconds: 4 }).jd;
  const fastJd = tape.reduce(fast, { type: "tick", seconds: 4 }).jd;
  assert.ok(fastJd > slowJd);
});

test("append accepts another recorded checkpoint and refuses a hidden seed", async () => {
  const { text, arcsText, rows } = await fixture();
  const clock = load(text, arcsText).clock;
  const row = rows.find((item) => item.kind === "checkpoint");
  assert.equal(tape.reduce(clock, { type: "append", row: row }), clock);
  const hidden = JSON.parse(JSON.stringify(row));
  hidden.observation = Object.assign({}, hidden.observation, { why: seedHead + "a".repeat(32) });
  assert.equal(tape.reduce(clock, { type: "append", row: hidden }), clock);
  const extra = JSON.parse(JSON.stringify(row));
  extra.checkpoint = Object.assign({}, extra.checkpoint, { at: "2029-02-09 12:00" });
  extra.observation = Object.assign({}, extra.observation, {
    why: row.observation.why,
    reply_arrives: "2029-02-09 12:14",
    place: row.observation.place
  });
  const next = tape.reduce(clock, { type: "append", row: extra });
  assert.notEqual(next, clock);
  const frame = tape.frameAt(tape.reduce(next, { type: "scrub", jd: jdOfIso("2029-02-09 12:00") }), soleOf());
  assert.equal(frame.caption, "Checkpoint. Mars Base. A dust storm closed the pad.");
  assert.equal(frame.score, null);
  assert.equal(JSON.stringify(frame).includes(seedHead), false);
});
