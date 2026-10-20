import assert from "node:assert/strict";
import test from "node:test";
import { forReaders, points, pointsText, tidyText } from "../src/display.js";
import { boardHtml } from "../src/board.js";

test("scores read as whole points and the stored value is untouched", () => {
  assert.equal(points(34993.98485825111), 34994);
  assert.equal(points(-0.2), 0);
  assert.equal(pointsText(60318.19051866), "60,318");
  const stored = { status: "arrived", total: 30003.217144792063, out_of: 100000, used_kwh: 412.37, fare_usd: 8123.45,
    parts: [{ key: "on_time", got: 7699.999999999999, max: 22000, measure: 0.123456 }] };
  const shown = forReaders(stored);
  assert.equal(shown.total, 30003);
  assert.deepEqual(shown.parts[0], { key: "on_time", got: 7700, max: 22000, measure: 0.123456 });
  assert.equal(shown.used_kwh, 412.37);
  assert.equal(shown.fare_usd, 8123.45);
  assert.equal(stored.total, 30003.217144792063);
});

test("part maps in logs and ride stats are rounded, other numbers are not", () => {
  const shown = forReaders({ log: { parts: { on_time: 7699.999999999999 }, total: 1.6, flown: [{ kwh: 12.3456789 }] },
    stats: [{ mean_parts: { on_time: 7700.4 }, lost_most: { part: "on_time", mean_lost: 14300.6, max: 22000 }, mean_total: 30003.2 }] });
  assert.deepEqual(shown.log, { parts: { on_time: 7700 }, total: 2, flown: [{ kwh: 12.3456789 }] });
  assert.deepEqual(shown.stats[0], { mean_parts: { on_time: 7700 }, lost_most: { part: "on_time", mean_lost: 14301, max: 22000 }, mean_total: 30003 });
});

test("float noise leaves engine text, real digits stay", () => {
  assert.equal(tidyText("this plan needs 678.0999999999999 kg"), "this plan needs 678.1 kg");
  assert.equal(tidyText("needs 2046.1 kg at 1.523679 AU"), "needs 2046.1 kg at 1.523679 AU");
  assert.equal(forReaders({ refused: "needs 7699.999999999999 kg" }).refused, "needs 7700 kg");
});

test("the board shows whole points", () => {
  const hail = { hail_id: "s1-1", title: "Hop", kind: "local", from: { name: "A" }, to: { name: "B" } };
  const html = boardHtml([hail], { best: { "s1-1": { points: 34993.98485825111, car: "SF-01", kwh: 10, par: 12, plans: 2, run_tag: "abc", at: 0 } },
    stats: { runs_scored: 1 } });
  assert.match(html, /<b>34,994<\/b>/);
  assert.doesNotMatch(html, /34993\.98/);
});
