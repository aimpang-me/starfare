// Durable Objects that hold the connector's state.
//   StarfareRun: one per run_id. Holds the run and does the planning, so one run's tool calls are serialized
//           and different players plan in parallel.
//   StarfareHub: one global instance. Plan+re-fly cache, hail-terms cache (keyed by hail, t0, season end and hazard seed),
//           best score per hail, per-IP rate limit, and each signed-in player's ride history (an index row and summary per run;
//           the full log stays in the run's StarfareRun) plus 24-hour export tokens.
//           (The best table's key column is still called mission_id; it holds the hail id.)
// Every RPC method returns plain data; game errors come back as { error } instead of throwing across RPC.
import { DurableObject } from "cloudflare:workers";
import { engine } from "./engine.js";
import {
  GameError, abandonRun, checkPad, computeLeg, decide, dispatch, hailInfo, legKey, legPub, newRun, phaseOf, planPickup, planRideLeg, rideCursor, rideCursorOf,
  rideRecord, rideStats, rideSummary, spaceWeather,
} from "./game.js";

export const RUN_ID = /^run_[0-9a-f]{20}$/;
export const hub = (env) => env.STARFARE_HUB.get(env.STARFARE_HUB.idFromName("hub"));
export const runStub = (env, runId) => env.STARFARE_RUN.get(env.STARFARE_RUN.idFromName(runId));

const CACHE_MAX = 5000;
const RIDES_MAX = 1000; // index rows kept per player, newest first
const EXPORT_MAX = 500; // newest arrived rides in one export file (each is one RPC to its run)
const EXPORT_MS = 24 * 3600 * 1000;

export class StarfareRun extends DurableObject {
  async #run() { return (await this.ctx.storage.get("run")) ?? null; }
  async #save(run) { await this.ctx.storage.put("run", run); }
  /** Plans go through the hub's leg cache; plan_pickup, plan_ride_leg and a replan at a checkpoint share it. */
  #legFn(E) {
    const h = hub(this.env);
    return async (from, to, t, obj, end) => {
      const key = legKey(from, to, t, obj, end), hit = await h.legGet(key);
      if (hit) return { leg: hit, cached: true };
      const leg = computeLeg(E, from, to, t, obj, end);
      await h.legPut(key, leg);
      return { leg, cached: false };
    };
  }
  /** The board holds arrived runs only. */
  async #record(run, r) {
    await hub(this.env).record({ hail_id: run.id, title: run.title, run_tag: run.run_id.slice(4, 10), points: r.total, car: r.car,
      wait_h: Math.round((run.pickup_jd - run.t0) * 240) / 10, kwh: Math.round(r.used_kwh), par: Math.round(r.par_kwh), plans: run.calls, at: Date.now(),
      ...(run.player_id ? { player_tag: run.player_id.slice(2, 8) } : {}) });
  }
  /** A signed-in player's history row: written on every phase change (taken, in flight, arrived, abandoned). */
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
      const run = await newRun(E, hailId, Date.now(), runId, termsFn);
      if (playerId) run.player_id = playerId; // STARFARE_OAUTH on only; a label, the run_id rules do not change
      await this.#save(run);
      await this.#index(E, run);
      return hailInfo(E, run, Date.now());
    });
  }

  async info() {
    return this.#guard(async () => {
      const run = await this.#run();
      if (!run) return { error: "unknown run_id. Call take_hail to get one." };
      return hailInfo(await engine(), run, Date.now());
    });
  }

  async plan(role, inp) {
    return this.#guard(async () => {
      const run = await this.#run();
      if (!run) return { error: "unknown run_id. Call take_hail to get one." };
      const E = await engine();
      try {
        const { leg, cached } = await (role === "pickup" ? planPickup : planRideLeg)(E, run, inp, this.#legFn(E));
        await this.#save(run);
        return Object.assign(legPub(E, leg), { plans_used: run.calls, cached });
      } catch (e) {
        if (e && e.counted) await this.#save(run); // the page counts a plan even when planning fails
        throw e;
      }
    });
  }

  /** check_pad and space_weather: read-only forecasts, not plans. The call is noted in the run's log. */
  async forecast(kind, inp) {
    return this.#guard(async () => {
      const run = await this.#run();
      if (!run) return { error: "unknown run_id. Call take_hail to get one." };
      const n = (run.forecasts || []).length;
      const r = (kind === "pad" ? checkPad : spaceWeather)(await engine(), run, inp, Date.now());
      if ((run.forecasts || []).length !== n) await this.#save(run);
      return r;
    });
  }

  async dispatch(inp) {
    return this.#guard(async () => {
      const run = await this.#run();
      if (!run) return { error: "unknown run_id. Call take_hail to get one." };
      const E = await engine(), before = phaseOf(run);
      let r;
      try { r = dispatch(E, run, inp, Date.now()); }
      catch (e) { if (phaseOf(run) !== before) { await this.#save(run); await this.#index(E, run); } throw e; } // a cold hail is abandoned
      if (r.ok && !r.already_dispatched) {
        await this.#save(run);
        if (phaseOf(run) === "arrived") await this.#record(run, r);
        await this.#index(E, run);
      }
      return r;
    });
  }

  /** An answer at a checkpoint. A replan is a plan, so it is saved even when the checker rejects the new leg. */
  async decide(inp) {
    return this.#guard(async () => {
      const run = await this.#run();
      if (!run) return { error: "unknown run_id. Call take_hail to get one." };
      const E = await engine(), before = phaseOf(run);
      let r;
      try { r = await decide(E, run, inp, this.#legFn(E)); }
      catch (e) { if (e && e.counted) await this.#save(run); throw e; }
      if (!r.already_decided) {
        await this.#save(run);
        if (before === "in_flight" && phaseOf(run) === "arrived") await this.#record(run, r);
        await this.#index(E, run);
      }
      return r;
    });
  }

  /** One bot holds one run at a time: taking a new hail in the same MCP session abandons the open one if it is still planning. */
  async abandon() {
    const run = await this.#run();
    if (run && abandonRun(run)) { await this.#save(run); await this.#index(await engine(), run); }
    return { ok: true };
  }

  /** The full ride record, for its owner only (get_my_rides detail mode). Another player's run reads as not found. */
  async ride(playerId) {
    const run = await this.#run();
    if (!run || !playerId || run.player_id !== playerId) return { error: "not one of your rides. get_my_rides lists yours." };
    return rideRecord(await engine(), run);
  }
  /** The record of an arrived ride, or null: the public /rides/<run_id>.json download (the run_id is the capability). */
  async record() {
    const run = await this.#run();
    return run && phaseOf(run) === "arrived" ? rideRecord(await engine(), run) : null;
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
  // Terms depend on the hazard seed (par flies the season's hazards), so the seed is part of the key.
  // p2: par now answers each checkpoint with hindsight, so terms cached before that are stale.
  termsGet(id, t0, end, seed) { const v = this.#get("termscache", `${id}|${t0}|${end}|s${seed}|p2`); this.#bump(v ? "terms_hit" : "terms_miss"); return v; }
  termsPut(id, t0, end, seed, v) { this.#put("termscache", `${id}|${t0}|${end}|s${seed}|p2`, v); }

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

  board() {
    const best = {};
    for (const row of this.sql.exec("SELECT mission_id, v FROM best").toArray()) best[row.mission_id] = JSON.parse(row.v);
    const stats = {};
    for (const row of this.sql.exec("SELECT k, n FROM stats").toArray()) stats[row.k] = row.n;
    return { best, stats };
  }
}
