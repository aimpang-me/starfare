// Durable Objects that hold the connector's state.
//   StarfareRun: one per run_id. Holds the run and answers its tool calls through applyTool, so one run's calls are
//           serialized and different players plan in parallel.
//   StarfareHub: one global instance. Plan+re-fly cache, hail-terms cache (keyed by hail, t0, season end, hazard seed and engine),
//           best score per hail, per-IP rate limit, and each signed-in player's ride history (an index row and summary per run;
//           the full log stays in the run's StarfareRun) plus 24-hour export tokens.
//           (The best table's key column is still called mission_id; it holds the hail id.)
// Every RPC method returns plain data; game errors come back as { error } instead of throwing across RPC.
import { DurableObject } from "cloudflare:workers";
import { engine } from "./engine.js";
import META from "./engine/meta.json" with { type: "json" };
import {
  GameError, applyTool, computeLeg, flyLive, hailInfo, leaveRun, legKey, legPub, liveRecord, liveRow, openRun, phaseOf, rideCursor, rideCursorOf, rideRecord,
  rideStats, rideSummary, seasonInstance,
} from "./game.js";
import { liveIdsToDrop } from "./live.js";

export const hub = (env) => env.STARFARE_HUB.get(env.STARFARE_HUB.idFromName("hub"));
export const runStub = (env, runId) => env.STARFARE_RUN.get(env.STARFARE_RUN.idFromName(runId));

const CACHE_MAX = 5000;
const termsKey = (id, t0, end, seed) => `${id}|${t0}|${end}|s${seed}|e${META.sha256.slice(0, 16)}`;
const RIDES_MAX = 1000; // index rows kept per player, newest first
const EXPORT_MAX = 500; // newest arrived rides in one export file (each is one RPC to its run)
const EXPORT_MS = 24 * 3600 * 1000;
/** Where a ride stands for its history row: its phase and the checkpoints answered. Plans and forecasts leave it where it was. */
const rideMark = (run) => phaseOf(run) + "/" + (run.decisions ? run.decisions.length : 0);
const LIVE_HELD_MS = 6 * 3600 * 1000; // a flight held at a checkpoint leaves the home map after this long without an answer
const LIVE_AFTER_MS = 60 * 1000; // landed rows older than this leave, except the newest

export class StarfareRun extends DurableObject {
  async #run() { return (await this.ctx.storage.get("run")) ?? null; }
  async #save(run) { await this.ctx.storage.put("run", run); }
  /** Plans go through the hub's leg cache; plan_pickup, plan_ride_leg and a replan at a checkpoint share it. */
  #legFn(E) {
    const h = hub(this.env);
    return async (from, to, t, obj, end) => {
      const key = legKey(from, to, t, obj, end), hit = await h.legGet(key);
      if (hit && hit.arc_au) return { leg: hit, cached: true }; // rows cached before arcs were kept are planned again
      const leg = computeLeg(E, from, to, t, obj, end);
      await h.legPut(key, leg);
      return { leg, cached: false };
    };
  }
  /** The board holds arrived runs only. */
  async #record(run) {
    const s = run.score;
    await hub(this.env).record({ hail_id: run.id, title: run.title, run_tag: run.run_id.slice(4, 10), run_id: run.run_id, points: s.total, car: s.car,
      wait_h: Math.round((run.pickup_jd - run.t0) * 240) / 10, kwh: Math.round(s.used_kwh), par: Math.round(s.par_kwh), plans: run.calls, at: Date.now(),
      ...(run.player_id ? { player_tag: run.player_id.slice(2, 8) } : {}) });
  }
  /** Save a changed run; put it on the board when it just arrived and in the player's history when its ride moved. */
  async #commit(E, before, run) {
    await this.#save(run);
    if (phaseOf(before) !== "arrived" && phaseOf(run) === "arrived") await this.#record(run);
    if (rideMark(before) !== rideMark(run)) await this.#index(E, run);
    if (run.live && JSON.stringify(before.live) !== JSON.stringify(run.live)) await hub(this.env).livePut(liveRow(E, run));
  }
  /** A signed-in player's history row: written when the ride is taken and whenever its rideMark moves. */
  async #index(E, run) {
    if (!run.player_id) return;
    await hub(this.env).ridePut({ run_id: run.run_id, player_id: run.player_id, created_ms: run.created_ms, hail_id: run.id, phase: phaseOf(run),
      reason: run.abandoned_reason || null, summary: rideSummary(E, run) });
  }
  async #guard(fn) {
    try { return await fn(); }
    catch (e) { if (e instanceof GameError) return { error: e.message }; throw e; }
  }

  async create(runId, hailId, playerId = null) {
    return this.#guard(async () => {
      if (await this.#run()) return { error: "run already exists" };
      const E = await engine(), h = hub(this.env);
      const termsFn = async (id, t0, end, seed) => {
        const hit = await h.termsGet(id, t0, end, seed);
        if (hit) return hit;
        const T = E.R.terms(id, t0, end, seed);
        const slim = { arrive_by_jd: T.arrive_by_jd, par: { kwh: T.par.kwh, car: T.par.car, best_wait_days: T.par.best_wait_days } };
        await h.termsPut(id, t0, end, seed, slim);
        return slim;
      };
      const now = Date.now(), run = await openRun(E, seasonInstance(E, hailId, now), runId, now, termsFn);
      if (playerId) run.player_id = playerId; // STARFARE_OAUTH on only; a label, the run_id rules do not change
      await this.#save(run);
      await this.#index(E, run);
      return hailInfo(E, run, Date.now());
    });
  }

  /** Every run-scoped tool call (get_hail, plan_pickup, plan_ride, check_pad, space_weather, dispatch, decide). */
  async act(tool, input, playerId = null) {
    const before = await this.#run();
    // A signed-in player's run answers only them: its run_id is public on the watch page and the home map.
    if (!before || (before.player_id && before.player_id !== playerId)) return { error: "unknown run_id. Call take_hail to get one." };
    const E = await engine();
    const { run, result } = await applyTool(E, before, tool, input, { nowMs: Date.now(), legFn: this.#legFn(E) });
    if (run) await this.#commit(E, before, run);
    return result;
  }

  /** One bot holds one run at a time. Taking a new hail in the same MCP session abandons the open run if it is still planning,
   *  or flies it on the defaults to arrive if it is at a checkpoint, scored and on the board. */
  async leave() {
    const before = await this.#run();
    if (!before) return null;
    const E = await engine(), run = structuredClone(before), r = leaveRun(E, run);
    if (!r) return null;
    if (run.live && phaseOf(run) === "arrived") flyLive(run, Date.now());
    await this.#commit(E, before, run);
    return { run_id: r.run_id, status: r.status, ...(r.status === "arrived" ? { total: r.total, note: r.note } : {}) };
  }

  /** The full ride record, for its owner only (get_my_rides detail mode). Another player's run reads as not found. */
  async ride(playerId) {
    const run = await this.#run();
    if (!run || !playerId || run.player_id !== playerId) return { error: "not one of your rides. get_my_rides lists yours." };
    return rideRecord(await engine(), run);
  }
  /** The public /rides/<run_id>.json record (the run_id is the capability), or null: an arrived ride, or a season flight
   *  still in the air with its live track and dispatcher log. */
  async record() {
    const run = await this.#run();
    return run && (phaseOf(run) === "arrived" || (phaseOf(run) === "in_flight" && run.live)) ? liveRecord(await engine(), run, Date.now()) : null;
  }
  /** What the /flight/<run_id> page draws beside the record: the planned legs and their stored arcs, or null when record() is. */
  async flight() {
    const run = await this.#run();
    if (!run || !(phaseOf(run) === "arrived" || (phaseOf(run) === "in_flight" && run.live))) return null;
    const E = await engine(), flown = Object.values(run.legs).filter((L) => run.route.includes(L.leg_id) || L.replan_of);
    return {
      in_flight: phaseOf(run) === "in_flight",
      legs: flown.map((L) => legPub(E, L)),
      arcs: Object.fromEntries(flown.filter((L) => L.arc_au).map((L) => [L.leg_id, { from: L.from, to: L.to, dep_jd: L.dep_jd, arr_jd: L.arr_jd, arc_au: L.arc_au }])),
    };
  }
}

export class StarfareHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS legcache (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS termscache (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS best (mission_id TEXT PRIMARY KEY, v TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS stats (k TEXT PRIMARY KEY, n INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS rides (run_id TEXT PRIMARY KEY, player_id TEXT NOT NULL, created_ms INTEGER NOT NULL, hail_id TEXT NOT NULL, phase TEXT NOT NULL, reason TEXT, summary TEXT)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS rides_by_player ON rides (player_id, created_ms DESC, run_id DESC)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS exports (token TEXT PRIMARY KEY, player_id TEXT NOT NULL, expires_ms INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS live (run_id TEXT PRIMARY KEY, v TEXT NOT NULL, land_ms INTEGER, updated_ms INTEGER NOT NULL)");
    this.hits = new Map(); // ip -> {win, n}; in memory on purpose: losing it on eviction only resets a minute's count
  }
  #get(table, k) { const row = this.sql.exec(`SELECT v FROM ${table} WHERE k = ?`, k).toArray()[0]; return row ? JSON.parse(row.v) : null; }
  #put(table, k, v) {
    this.sql.exec(`INSERT OR REPLACE INTO ${table} (k, v, at) VALUES (?, ?, ?)`, k, JSON.stringify(v), Date.now());
    const n = this.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one().n;
    if (n > CACHE_MAX) this.sql.exec(`DELETE FROM ${table} WHERE k IN (SELECT k FROM ${table} ORDER BY at ASC LIMIT ?)`, n - CACHE_MAX);
  }
  #bump(k) { this.sql.exec("INSERT INTO stats (k, n) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET n = n + 1", k); }

  legGet(k) { const v = this.#get("legcache", k); this.#bump(v ? "leg_hit" : "leg_miss"); return v; }
  legPut(k, v) { this.#put("legcache", k, v); }
  // Terms depend on the hazard seed (par flies the season's hazards) and on the engine that computed them,
  // so a new engine build never answers from terms an older one cached.
  termsGet(id, t0, end, seed) { const v = this.#get("termscache", termsKey(id, t0, end, seed)); this.#bump(v ? "terms_hit" : "terms_miss"); return v; }
  termsPut(id, t0, end, seed, v) { this.#put("termscache", termsKey(id, t0, end, seed), v); }

  /** Fixed one-minute window per IP. Returns { ok, n, limit }. */
  hit(ip, limit) {
    const win = Math.floor(Date.now() / 60000), cur = this.hits.get(ip);
    const n = cur && cur.win === win ? cur.n + 1 : 1;
    this.hits.set(ip, { win, n });
    if (this.hits.size > 10000) for (const [k, v] of this.hits) if (v.win !== win) this.hits.delete(k);
    return { ok: n <= limit, n, limit };
  }

  record(e) {
    this.#bump("runs_scored");
    const row = this.sql.exec("SELECT v FROM best WHERE mission_id = ?", e.hail_id).toArray()[0];
    const cur = row ? JSON.parse(row.v) : null;
    if (!cur || e.points > cur.points) this.sql.exec("INSERT OR REPLACE INTO best (mission_id, v) VALUES (?, ?)", e.hail_id, JSON.stringify(e));
    return { best: !cur || e.points > cur.points };
  }

  /** Insert or update a player's history row, then keep only their newest RIDES_MAX. */
  ridePut(e) {
    this.sql.exec("INSERT INTO rides (run_id, player_id, created_ms, hail_id, phase, reason, summary) VALUES (?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(run_id) DO UPDATE SET phase = excluded.phase, reason = excluded.reason, summary = excluded.summary",
      e.run_id, e.player_id, e.created_ms, e.hail_id, e.phase, e.reason, JSON.stringify(e.summary));
    const n = this.sql.exec("SELECT COUNT(*) AS n FROM rides WHERE player_id = ?", e.player_id).one().n;
    if (n > RIDES_MAX) this.sql.exec("DELETE FROM rides WHERE run_id IN (SELECT run_id FROM rides WHERE player_id = ? ORDER BY created_ms ASC, run_id ASC LIMIT ?)", e.player_id, n - RIDES_MAX);
  }

  /** A page of a player's rides, newest first. q: { limit, cursor, hail_id, include: "scored" | "all" }. Stats on the first page only. */
  rides(player, q) {
    try {
      const where = ["player_id = ?"], args = [player];
      if (q.hail_id) { where.push("hail_id = ?"); args.push(q.hail_id); }
      if (q.include !== "all") where.push("phase = 'arrived'");
      const total = this.sql.exec(`SELECT COUNT(*) AS n FROM rides WHERE ${where.join(" AND ")}`, ...args).one().n;
      const page = [...where], pargs = [...args];
      if (q.cursor) { const c = rideCursorOf(q.cursor); page.push("(created_ms < ? OR (created_ms = ? AND run_id < ?))"); pargs.push(c.created_ms, c.created_ms, c.run_id); }
      const limit = q.limit || 10;
      const rows = this.sql.exec(`SELECT run_id, created_ms, summary FROM rides WHERE ${page.join(" AND ")} ORDER BY created_ms DESC, run_id DESC LIMIT ?`, ...pargs, limit + 1).toArray();
      const more = rows.length > limit, shown = rows.slice(0, limit);
      const r = { rides: shown.map((x) => JSON.parse(x.summary)), next_cursor: more ? rideCursor(shown[shown.length - 1]) : null, total_rides: total };
      if (!q.cursor) {
        const hw = ["player_id = ?", "phase = 'arrived'"], hargs = [player];
        if (q.hail_id) { hw.push("hail_id = ?"); hargs.push(q.hail_id); }
        r.stats = rideStats(this.sql.exec(`SELECT summary FROM rides WHERE ${hw.join(" AND ")} ORDER BY created_ms DESC, run_id DESC`, ...hargs).toArray().map((x) => JSON.parse(x.summary)));
      }
      return r;
    } catch (e) { if (e instanceof GameError) return { error: e.message }; throw e; }
  }

  /** A 24-hour token for the player's whole-history download. */
  exportMint(player) {
    const now = Date.now(), token = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    this.sql.exec("DELETE FROM exports WHERE expires_ms < ?", now);
    this.sql.exec("INSERT INTO exports (token, player_id, expires_ms) VALUES (?, ?, ?)", token, player, now + EXPORT_MS);
    return { token, expires: new Date(now + EXPORT_MS).toISOString() };
  }
  /** The run_ids an export token covers (the player's newest EXPORT_MAX arrived rides), or null if it is unknown or expired. */
  exportRuns(token) {
    const row = this.sql.exec("SELECT player_id, expires_ms FROM exports WHERE token = ?", String(token)).toArray()[0];
    if (!row || row.expires_ms < Date.now()) return null;
    return this.sql.exec("SELECT run_id FROM rides WHERE player_id = ? AND phase = 'arrived' ORDER BY created_ms DESC, run_id DESC LIMIT ?", row.player_id, EXPORT_MAX)
      .toArray().map((x) => x.run_id);
  }

  /** A season flight's home-map row, written each time its playback track grows. */
  livePut(e) {
    this.sql.exec("INSERT OR REPLACE INTO live (run_id, v, land_ms, updated_ms) VALUES (?, ?, ?, ?)", e.run_id, JSON.stringify(e.v), e.land_ms, Date.now());
  }
  live() {
    const now = Date.now();
    const rows = this.sql.exec("SELECT run_id, land_ms, updated_ms FROM live").toArray();
    for (const id of liveIdsToDrop(rows, now, LIVE_AFTER_MS, LIVE_HELD_MS)) this.sql.exec("DELETE FROM live WHERE run_id = ?", id);
    return { now_ms: now, flights: this.sql.exec("SELECT v FROM live ORDER BY updated_ms DESC LIMIT 50").toArray().map((x) => JSON.parse(x.v)) };
  }

  board() {
    const best = {};
    for (const row of this.sql.exec("SELECT mission_id, v FROM best").toArray()) best[row.mission_id] = JSON.parse(row.v);
    const stats = {};
    for (const row of this.sql.exec("SELECT k, n FROM stats").toArray()) stats[row.k] = row.n;
    return { best, stats };
  }
}
