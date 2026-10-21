import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import * as game from "../src/game.js";
import { engine } from "../src/engine.js";
import { episodeText } from "../src/episode.js";
import { liveIdsToDrop } from "../src/live.js";
import { distinctPlayers, ensurePool, poolSize, recordBest } from "../src/hub-pool.js";

const { seasonSpan, seasonStandings } = game;

// store.js with its Worker imports stripped, as hub-cleanup.test.mjs does, over a real SQLite in memory.
function hub() {
  const deps = {
    DurableObject: class { constructor(ctx, env) { this.ctx = ctx; this.env = env; } },
    engine, META: { sha256: "test" }, episodeText, ...game, liveIdsToDrop,
    playersIn: distinctPlayers, freezePool: ensurePool, storedPool: poolSize, recordBest, seasonSeed: async (env, s) => String(s),
  };
  const source = readFileSync(new URL("../src/store.js", import.meta.url), "utf8")
    .replace(/^import\s[\s\S]*?;\r?\n/gm, "")
    .replace(/\bexport (?=const |class )/g, "");
  const { StarfareHub } = new Function(...Object.keys(deps), source + "\nreturn { StarfareHub };")(...Object.values(deps));
  const db = new DatabaseSync(":memory:");
  const sql = { exec(q, ...args) { const rows = db.prepare(q).all(...args); return { toArray: () => rows, one: () => rows[0] }; } };
  return new StarfareHub({ storage: { sql } }, {});
}

const P = (n) => "p_" + String(n).repeat(16).slice(0, 16);

test("the season rank is the mean over every attempt: a dropped or open booking counts 0, a booking never planned doesn't count", () => {
  const rows = [
    // a: three arrivals of 90, 80, 70 -> mean 80
    ...[90, 80, 70].map((t) => ({ player_id: P(1), phase: "arrived", total: t, plans_used: 3, forecasts_used: 0 })),
    // b: two arrivals of 100 and two drops after reading the weather -> mean 50, though its best is higher than a's
    ...[100, 100].map((t) => ({ player_id: P(2), phase: "arrived", total: t, plans_used: 2, forecasts_used: 1 })),
    { player_id: P(2), phase: "abandoned", total: null, plans_used: 0, forecasts_used: 2 },
    { player_id: P(2), phase: "planning", total: null, plans_used: 1, forecasts_used: 0 },
    // b also took ten bookings and dropped them unread: not attempts
    ...Array(10).fill({ player_id: P(2), phase: "abandoned", total: null, plans_used: 0, forecasts_used: 0 }),
    // c: two attempts only, so counted and not ranked
    ...[99, 99].map((t) => ({ player_id: P(3), phase: "arrived", total: t, plans_used: 1 })),
  ];
  const st = seasonStandings(rows);
  assert.equal(st.min_attempts, 3);
  assert.equal(st.players, 3);
  assert.equal(st.unranked, 1);
  assert.deepEqual(st.ranked, [
    { rank: 1, player_tag: "111111", attempts: 3, arrived: 3, mean: 80, best: 90 },
    { rank: 2, player_tag: "222222", attempts: 4, arrived: 2, mean: 50, best: 100 },
  ]);
});

test("the hub ranks the season's history rows only, and a summary from before forecasts_used counts plans", () => {
  const h = hub(), season = 7, { start, end } = seasonSpan(season);
  let n = 0;
  const put = (player, created_ms, phase, summary) => h.ridePut({ run_id: "run_" + String(n++).padStart(20, "0"), player_id: player, created_ms, hail_id: "s7-1", phase, reason: null, summary: { phase, ...summary } });
  for (const t of [60, 70, 80]) put(P(4), start + 1000, "arrived", { total: t, plans_used: 2, forecasts_used: 0 });
  put(P(4), start + 2000, "abandoned", { plans_used: 4 }); // written before forecasts_used: counts
  put(P(4), start - 1, "arrived", { total: 100000, plans_used: 1, forecasts_used: 0 }); // last season
  put(P(4), end, "arrived", { total: 100000, plans_used: 1, forecasts_used: 0 }); // next season
  const st = h.standings(season);
  assert.deepEqual(st.ranked, [{ rank: 1, player_tag: "444444", attempts: 4, arrived: 3, mean: 52.5, best: 80 }]);
  assert.deepEqual(h.board(season).standings, st);
  assert.equal(h.board().standings, undefined);
});
