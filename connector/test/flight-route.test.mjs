// The flight page is /flight/<run_id>, and a run id is run_ plus 20 hex digits. The scoreboard
// publishes a 6-character tag, which is not that id.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { boardHtml } from "../src/board.js";
import { RUN_ID } from "../src/tools.js";

const flightPath = new RegExp("^/flight/(" + RUN_ID.source.slice(1, -1) + ")(\\.json)?$");
const root = new URL("..", import.meta.url);

test("a scoreboard tag is not a flight path", () => {
  assert.equal(flightPath.test("/flight/433f24"), false);
  assert.equal(flightPath.test("/flight/b12273"), false);
  assert.equal(flightPath.test("/flight"), false);
  assert.equal(flightPath.test("/flight/run_0123456789abcdef0123"), true);
  assert.equal(flightPath.test("/flight/run_0123456789abcdef0123.json"), true);
});

const hail = { hail_id: "iss-crew", title: "ISS crew rotation", from: { name: "Earth Orbit" }, to: { name: "ISS" }, kind: "quick" };

test("a scored row links to its flight when the row has a run id", () => {
  const runId = "run_0123456789abcdef0123";
  const html = boardHtml([hail], { best: { "iss-crew": { points: 80, car: "Starseeker", wait_h: 1.5, kwh: 40, par: 42, plans: 2, run_tag: "012345", run_id: runId, player_tag: "abcdef", at: Date.UTC(2026, 9, 17) } }, stats: { runs_scored: 1 } });
  assert.ok(html.includes(`href="/flight/${runId}"`), html);
  assert.ok(html.includes(">tag 012345</a>"));
  assert.equal(html.includes("p_"), false);
  assert.equal(html.includes("player_id"), false);
});

test("a scored row without a run id shows the tag as text", () => {
  const html = boardHtml([hail], { best: { "iss-crew": { points: 80, car: "Starseeker", wait_h: 1.5, kwh: 40, par: 42, plans: 2, run_tag: "012345", at: Date.UTC(2026, 9, 17) } }, stats: {} });
  assert.equal(html.includes('href="/flight/'), false);
  assert.ok(html.includes("tag 012345"));
  assert.equal(html.includes("/flight/012345"), false);
});

test("the home scoreboard publishes the flight address and keeps the six-character tag", () => {
  const site = readFileSync(new URL("src/site.html", root), "utf8");
  assert.equal(site.includes("/rides/&lt;run_id&gt;.json"), true);
  assert.equal(site.includes("A scored row with a flight address opens that flight."), true);
  assert.equal(site.includes("It is not a flight address."), false);
  assert.equal(site.includes(">Run</th>"), false);
  assert.equal(site.includes(">Tag</th>"), true);
  assert.equal(site.includes('\'<a href="/flight/\' + esc(b.run_id)'), true);
});

test("the credits line does not name Tesla or SpaceX", () => {
  const credits = readFileSync(new URL("../design/assets/CREDITS.md", root), "utf8");
  assert.equal(/tesla|spacex/i.test(credits), false);
  assert.equal(credits.includes("not affiliated with any real company"), true);
});
