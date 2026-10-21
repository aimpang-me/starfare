import assert from "node:assert/strict";
import test from "node:test";
import { points, pointsText, tidyText } from "../src/display.js";

test("scores read as whole points", () => {
  assert.equal(points(34993.98485825111), 34994);
  assert.equal(points(-0.2), 0);
  assert.equal(pointsText(60318.19051866), "60,318");
});

test("float noise leaves engine text, real digits stay", () => {
  assert.equal(tidyText("this plan needs 678.0999999999999 kg"), "this plan needs 678.1 kg");
  assert.equal(tidyText("needs 2046.1 kg at 1.523679 AU"), "needs 2046.1 kg at 1.523679 AU");
});
