import assert from "node:assert/strict";
import test from "node:test";
import { engine } from "../src/engine.js";
import { formatReport, simulate } from "../sim.mjs";

test("a landed total stays inside the engine out_of and the score receives the ship inputs", async () => {
  const E = await engine();
  const score = E.R.score;
  const seen = [];
  E.R.score = (id, plan, ctx) => {
    seen.push(ctx);
    const sc = score.call(E.R, id, plan, ctx);
    return {
      ...sc,
      total: 90000,
      out_of: 100000,
      parts: [{ key: "pickup", label: "Fast pickup", max: 100000, got: 90000, unit: "min" }],
    };
  };
  try {
    const report = await simulate({ policies: ["naive"], seeds: ["1"], hails: ["iss-crew"] });
    const row = report.rows[0];
    assert.equal(row.terminal, "landed");
    assert.equal(row.outOf, 100000);
    assert.equal(row.total, 90000);
    assert.ok(row.total <= row.outOf);
    assert.equal(row.parts[0].unit, "min");
    const ctx = seen.at(-1);
    assert.equal(typeof ctx.ship, "string");
    assert.equal(typeof ctx.window_kwh, "number");
    assert.equal(typeof ctx.throttled_kwh, "number");
    assert.ok(Object.hasOwn(ctx, "hindsight_kwh"));
    const printed = formatReport(report);
    assert.match(printed, /Score parts keep the engine units/);
    assert.match(printed, /Score out of 100000\./);
    assert.match(printed, /pickup \(min\)/);
  } finally {
    E.R.score = score;
  }
});
