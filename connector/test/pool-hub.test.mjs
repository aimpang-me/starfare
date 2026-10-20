import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { seasonSpan } from "../src/game.js";
import { distinctPlayers, ensurePool, poolSize, recordBest } from "../src/hub-pool.js";

function sqlOf(db) {
  return {
    exec(query, ...args) {
      const stmt = db.prepare(query);
      if (/^\s*(select|with)\b/i.test(query)) {
        const rows = stmt.all(...args);
        return { toArray: () => rows, one: () => rows[0] };
      }
      stmt.run(...args);
      return { toArray: () => [], one: () => undefined };
    },
  };
}

function memory() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE hubkv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE rides (run_id TEXT PRIMARY KEY, player_id TEXT NOT NULL, created_ms INTEGER NOT NULL, hail_id TEXT NOT NULL, phase TEXT NOT NULL, reason TEXT, summary TEXT);
    CREATE TABLE best (mission_id TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE stats (k TEXT PRIMARY KEY, n INTEGER NOT NULL);
  `);
  return sqlOf(db);
}

function addPlayers(sql, season, n, copies = 1, from = 0) {
  const span = seasonSpan(season);
  for (let i = from; i < from + n; i++) {
    for (let k = 0; k < copies; k++) {
      sql.exec(
        "INSERT INTO rides (run_id, player_id, created_ms, hail_id, phase, reason, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
        `run-${season}-${i}-${k}`, `player-${season}-${i}`, span.start + i + 1, "iss-crew", "arrived", null, "{}",
      );
    }
  }
}

test("a season pool freezes from the previous season's distinct signed-in players", () => {
  const first = memory();
  addPlayers(first, 1, 100);
  assert.equal(ensurePool(first, 1), 200);
  assert.equal(poolSize(first, 1), 200);

  const tiers = [
    [0, 200],
    [19, 200],
    [20, 500],
    [99, 500],
    [100, 1000],
  ];
  for (const [players, hails] of tiers) {
    const sql = memory();
    addPlayers(sql, 4, players, 2);
    assert.equal(distinctPlayers(sql, 4), players);
    assert.equal(ensurePool(sql, 5), hails);
    addPlayers(sql, 4, 50, 1, players);
    assert.equal(ensurePool(sql, 5), hails);
    assert.equal(poolSize(sql, 5), hails);
  }

  const edge = memory();
  const span = seasonSpan(4);
  edge.exec(
    "INSERT INTO rides (run_id, player_id, created_ms, hail_id, phase, reason, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
    "run-edge", "player-edge", span.end, "iss-crew", "arrived", null, "{}",
  );
  assert.equal(distinctPlayers(edge, 4), 0);
  assert.equal(distinctPlayers(edge, 5), 1);
});

test("two finished scores for one pool hail keep the higher points", () => {
  const sql = memory();
  const hail = "s5-0";
  assert.equal(recordBest(sql, { hail_id: hail, points: 40, title: "Phobos to Mars" }).best, true);
  assert.equal(recordBest(sql, { hail_id: hail, points: 40, title: "Phobos to Mars" }).best, false);
  assert.equal(recordBest(sql, { hail_id: hail, points: 12, title: "Phobos to Mars" }).best, false);
  assert.equal(JSON.parse(sql.exec("SELECT v FROM best WHERE mission_id = ?", hail).toArray()[0].v).points, 40);
  assert.equal(recordBest(sql, { hail_id: hail, points: 81, title: "Phobos to Mars" }).best, true);
  assert.equal(JSON.parse(sql.exec("SELECT v FROM best WHERE mission_id = ?", hail).toArray()[0].v).points, 81);
  assert.equal(sql.exec("SELECT n FROM stats WHERE k = ?", "runs_scored").one().n, 4);
  assert.equal(recordBest(sql, { hail_id: hail, points: 7, title: "Phobos to Mars", score_version: 4 }).best, true);
  assert.equal(recordBest(sql, { hail_id: hail, points: 99, title: "Phobos to Mars", score_version: 3 }).best, false);
  assert.equal(JSON.parse(sql.exec("SELECT v FROM best WHERE mission_id = ?", hail).toArray()[0].v).points, 7);
});
