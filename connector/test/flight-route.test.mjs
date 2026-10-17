// The flight page is /flight/<run_id>, and a run id is run_ plus 20 hex digits. The scoreboard
// publishes a 6-character tag, which is not that id.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
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

test("the scoreboard does not tell you to open the tag as a flight", () => {
  const site = readFileSync(new URL("src/site.html", root), "utf8");
  const board = readFileSync(new URL("src/board.js", root), "utf8");
  assert.equal(site.includes("/rides/&lt;run_id&gt;.json"), false);
  assert.equal(site.includes(">Run</th>"), false);
  assert.equal(board.includes("run ${esc(b.run_tag)}"), false);
});

test("the credits line does not name Tesla or SpaceX", () => {
  const credits = readFileSync(new URL("../design/assets/CREDITS.md", root), "utf8");
  assert.equal(/tesla|spacex/i.test(credits), false);
  assert.equal(credits.includes("not affiliated with any real company"), true);
});
