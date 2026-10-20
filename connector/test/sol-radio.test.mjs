// The ship radio (design/assets/sol-radio.js): which stock line fits which event, and that the phrasebook stays number-free,
// labelled and complete, with a clip for every line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";

const require = createRequire(import.meta.url), Radio = require("../../design/assets/sol-radio.js");
const DIR = new URL("../../design/assets/audio/radio/", import.meta.url);
const book = JSON.parse(readFileSync(new URL("lines.json", DIR), "utf8"));

test("flight events and agent actions map to the right stock line", () => {
  const k = (e) => Radio.keyFor(e);
  assert.match(k({ kind: "depart", pickup: true }), /^depart-[12]$/);
  assert.equal(k({ kind: "depart", pickup: false }), "pickup");
  assert.equal(k({ kind: "arrive", pickup: true }), null);
  assert.match(k({ kind: "arrive", pickup: false }), /^arrive-[12]$/);
  assert.equal(k({ kind: "checkpoint", cp: { kind: "launch_hold" } }), "cp-launch-hold");
  assert.equal(k({ kind: "checkpoint", cp: { kind: "pad_closed" } }), "cp-pad-closed");
  assert.deepEqual(["dust_storm", "titan_haze", "flare", "solar_flare", "correction_burn"].map((x) => k({ kind: "incident", incident: x })),
    ["dust-storm", "titan-haze", "flare", "flare", "correction"]);
  assert.equal(k({ kind: "incident", cause: "dust_storm" }), "dust-storm"); // the flight page names it cause
  assert.equal(k({ kind: "incident", incident: "something_new" }), null);
  assert.equal(k({ kind: "note" }), null);
  assert.deepEqual(["hold", "divert", "replan", "wait"].map((a) => k({ tool: "decide", decision: { action: a } })), ["hold", "divert", "replan", "wait"]);
  assert.match(k({ tool: "take_hail" }), /^take-[12]$/);
  assert.equal(k({ tool: "dispatch", error: "no ship" }), "refused");
  assert.equal(k({ tool: "check_pad" }), null);
});

test("every key the mapper can return has a line, and every line is number-free with a clip", () => {
  const keys = ["depart-1", "depart-2", "pickup", "arrive-1", "arrive-2", "cp-launch-hold", "cp-pad-closed", "dust-storm", "titan-haze", "flare", "correction",
    "hold", "divert", "replan", "wait", "take-1", "take-2"];
  for (const key of keys) assert.ok(Radio.lineFor(key, book.lines), key);
  assert.match(book.note, /ElevenLabs/); assert.match(book.note, /simulated/);
  for (const [key, L] of Object.entries(book.lines)) {
    assert.doesNotMatch(L.text, /\d/, key + " speaks a number");
    assert.ok(["routine", "reroute", "emergency"].includes(L.level), key);
    assert.ok(["ship", "hq"].includes(L.src), key);
    assert.ok(existsSync(new URL(key + ".mp3", DIR)), key + ".mp3 missing");
  }
});

test("the radio is silent until turned on, and say() needs an entry with a radio line", () => {
  assert.equal(Radio.enabled(), false);
  assert.equal(Radio.say({ id: 1, radio: { key: "hold", level: "reroute" } }), null);
  assert.equal(Radio.lineFor("nope", book.lines), null);
  assert.equal(Radio.lineFor("refused", book.lines), null); // an HQ line with no clip yet stays silent
});
