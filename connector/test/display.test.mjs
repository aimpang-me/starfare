import assert from "node:assert/strict";
import test from "node:test";
import { points, pointsText, tidyText } from "../src/display.js";
import { boardHtml } from "../src/board.js";

test("scores read as whole points", () => {
  assert.equal(points(34993.98485825111), 34994);
  assert.equal(points(-0.2), 0);
  assert.equal(pointsText(60318.19051866), "60,318");
});

test("float noise leaves engine text, real digits stay", () => {
  assert.equal(tidyText("this plan needs 678.0999999999999 kg"), "this plan needs 678.1 kg");
  assert.equal(tidyText("needs 2046.1 kg at 1.523679 AU"), "needs 2046.1 kg at 1.523679 AU");
});

test("the board shows whole points", () => {
  const hail = { hail_id: "s1-1", title: "Hop", kind: "local", from: { name: "A" }, to: { name: "B" } };
  const html = boardHtml([hail], { best: { "s1-1": { points: 34993.98485825111, car: "SF-01", kwh: 10, par: 12, plans: 2, run_tag: "abc", at: 0 } },
    stats: { runs_scored: 1 } });
  assert.match(html, /<b>34,994<\/b>/);
  assert.doesNotMatch(html, /34993\.98/);
});
