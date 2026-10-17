import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import {
  SKY, checkPad, dispatch, isoJD, jdOfIso, leaveRun, openRun, phaseOf, planPickup, planRideLeg, seasonInstance,
} from "../connector/src/game.js";
import { episodeText } from "../connector/src/episode.js";

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
  const frame = tape.frameAt(done, soleOf());
  const reward = rows.at(-1).reward;
  assert.equal(frame.score.total, reward.total);
  assert.equal(frame.score.outOf, reward.out_of);
  assert.deepEqual(frame.score.parts.map((p) => ({ key: p.key, label: p.label, got: p.got, max: p.max, note: p.note })), reward.parts);
  assert.deepEqual(frame.score.measures, reward.measures);
  assert.equal(frame.score.parShip, "SF-03");
  assert.equal(frame.minute, rows.at(-1).outcome.arrive);
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
  const again = tape.reduce(done, { type: "play" });
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
  for (const src of [tapeSrc, htmlSrc, testSrc]) {
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
  assert.ok(htmlSrc.includes('aria-label="Score"'));
  assert.ok(htmlSrc.includes('aria-label="Log"'));
  assert.ok(htmlSrc.includes("requestAnimationFrame"));
  assert.ok(htmlSrc.includes('type: "scrub"'));
  assert.ok(htmlSrc.includes('type: "tick"'));
  const three = htmlSrc.indexOf("three.min.js");
  const sole = htmlSrc.indexOf("sol-page.js");
  const page = htmlSrc.indexOf("tape.js");
  assert.ok(three >= 0 && three < sole && sole < page);
});
