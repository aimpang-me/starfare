import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import * as game from "../src/game.js";
import { boardHtml } from "../src/board.js";
import { RUN_ID } from "../src/tools.js";

const E = createRequire(import.meta.url)("../src/engine/sol-page.cjs");
const NOW = game.SKY.t0_ms + 1000;
function worker() {
  const deps = { ...game, RUN_ID, BENCH_ID: /^b_[0-9a-f]{20}$/, EPISODE_PATH: /never/,
    engine: async () => E, META: { sky: game.SKY, look: {}, sha256: "a".repeat(64) },
    Date: class extends Date { static now() { return NOW; } },
    oauthOn: (env) => env.STARFARE_OAUTH === "on", oauthFetch() { throw new Error("public route incorrectly requires OAuth"); },
    siteHtml: "<script>window.SITE = __SITE__;</script>", boardHtml,
    hub: () => ({ ensurePool: async () => 3, board: async () => ({ best: {
      "s1-0": { points: 10, at: NOW }, "s1-3": { points: 99, at: NOW }, "s2-0": { points: 99, at: NOW }, "iss-crew": { points: 12, run_tag: "old", at: NOW },
    }, stats: { runs_scored: 4 } }) }),
  };
  const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8")
    .replace(/^import\s[\s\S]*?;\r?\n/gm, "")
    .replace(/^export \{.*\} from .*;\r?\n/gm, "")
    .replace("export default", "return");
  return new Function(...Object.keys(deps), source)(...Object.values(deps));
}
const get = (w, path) => w.fetch(new Request("http://localhost" + path), { STARFARE_OAUTH: "on" }, {});

test("home, public desk and board share the current seasonal pool and remain public under OAuth", async () => {
  const w = worker(), response = await get(w, "/"), html = await response.text();
  const site = JSON.parse(/window.SITE = (.*);<\/script>/.exec(html)[1]);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const desk = await get(w, "/hails.json"), pool = await desk.json();
  assert.equal(desk.headers.get("cache-control"), "no-store");
  assert.deepEqual(pool, game.poolView(E, 1, 3));
  assert.deepEqual(site.hails, pool.hails);
  const board = await (await get(w, "/board.json")).json();
  assert.deepEqual(board.hails, pool.hails);
  assert.equal(board.season, pool.season);
  assert.deepEqual(Object.keys(board.best), ["s1-0", "iss-crew"]);
  assert.deepEqual(board.legacy_hails.map((h) => h.hail_id), ["iss-crew"]);
  const page = await (await get(w, "/board")).text();
  for (const h of pool.hails) assert.ok(page.includes(h.hail_id));
  assert.match(page, /Catalog reference booking/);
  assert.doesNotMatch(page, /s2-0|s1-3/);
});
