import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { candidates } from "../bench/make-suite.mjs";

const E = createRequire(import.meta.url)("../src/engine/sol-page.cjs");
const R = E.R;

test("make-suite samples only the five catalog hail ids", () => {
  let x = 1;
  const rng = () => (x = Math.imul(x, 1664525) + 1013904223 >>> 0) / 4294967296;
  const catalog = new Set(R.HAILS.map((h) => h.id));
  assert.equal(catalog.size, 5);
  const tasks = candidates(E, rng, 40);
  assert.equal(tasks.length, 40);
  for (const task of tasks) {
    const ids = task.hails || [task.hail_id];
    assert.ok(ids.length === 1 || ids.length === 2);
    for (const id of ids) {
      assert.equal(catalog.has(id), true, id);
      assert.equal(/^s\d+-\d+$/.test(id), false);
    }
  }
});
