import { keepsBest, poolCap, seasonSpan } from "./game.js";

export function poolSize(sql, season) {
  const row = sql.exec("SELECT v FROM hubkv WHERE k = ?", "pool:" + season).toArray()[0];
  return row ? JSON.parse(row.v) : null;
}

export function distinctPlayers(sql, season) {
  const span = seasonSpan(season);
  return sql.exec("SELECT COUNT(DISTINCT player_id) AS n FROM rides WHERE created_ms >= ? AND created_ms < ?", span.start, span.end).one().n;
}

export function ensurePool(sql, season) {
  const cur = poolSize(sql, season);
  if (cur != null) return cur;
  const n = Number(season);
  const cap = poolCap(n <= 1 ? 0 : distinctPlayers(sql, n - 1));
  sql.exec("INSERT OR IGNORE INTO hubkv (k, v) VALUES (?, ?)", "pool:" + season, JSON.stringify(cap));
  return poolSize(sql, season);
}

export function recordBest(sql, entry) {
  sql.exec("INSERT INTO stats (k, n) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET n = n + 1", "runs_scored");
  const row = sql.exec("SELECT v FROM best WHERE mission_id = ?", entry.hail_id).toArray()[0];
  const cur = row ? JSON.parse(row.v) : null;
  const win = keepsBest(cur, entry);
  if (win) sql.exec("INSERT OR REPLACE INTO best (mission_id, v) VALUES (?, ?)", entry.hail_id, JSON.stringify(entry));
  return { best: win };
}
