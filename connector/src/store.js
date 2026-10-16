// Durable Objects that hold the connector's state.
//   SolRun: one per run_id. Holds the run and does the planning, so one run's tool calls are serialized
//           and different players plan in parallel.
//   SolHub: one global instance. Plan+re-fly cache, hail-terms cache (keyed by hail, t0, season end and hazard seed),
//           best score per hail, per-IP rate limit.
//           (The best table's key column is still called mission_id; it holds the hail id.)
// Every RPC method returns plain data; game errors come back as { error } instead of throwing across RPC.
import { DurableObject } from "cloudflare:workers";
import { engine } from "./engine.js";
import { GameError, checkPad, computeLeg, dispatch, hailInfo, legKey, legPub, newRun, planPickup, planRideLeg, spaceWeather } from "./game.js";

export const RUN_ID = /^run_[0-9a-f]{20}$/;
export const hub = (env) => env.SOL_HUB.get(env.SOL_HUB.idFromName("hub"));
export const runStub = (env, runId) => env.SOL_RUN.get(env.SOL_RUN.idFromName(runId));

const CACHE_MAX = 5000;

export class SolRun extends DurableObject {
  async #run() { return (await this.ctx.storage.get("run")) ?? null; }
  async #save(run) { await this.ctx.storage.put("run", run); }
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
      if (playerId) run.player_id = playerId; // SOL_OAUTH on only; a label, the run_id rules do not change
      await this.#save(run);
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
      const E = await engine(), h = hub(this.env);
      const legFn = async (from, to, t, obj, end) => {
        const key = legKey(from, to, t, obj, end), hit = await h.legGet(key);
        if (hit) return { leg: hit, cached: true };
        const leg = computeLeg(E, from, to, t, obj, end);
        await h.legPut(key, leg);
        return { leg, cached: false };
      };
      try {
        const { leg, cached } = await (role === "pickup" ? planPickup : planRideLeg)(E, run, inp, legFn);
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
      const E = await engine();
      let r;
      try { r = dispatch(E, run, inp, Date.now()); }
      catch (e) { if (run.abandoned) await this.#save(run); throw e; }
      if (r.ok && !r.already_dispatched) {
        await this.#save(run);
        await hub(this.env).record({ hail_id: run.id, title: run.title, run_tag: run.run_id.slice(4, 10), points: r.total, car: r.car,
          wait_h: Math.round((run.pickup_jd - run.t0) * 240) / 10, kwh: Math.round(r.used_kwh), par: Math.round(r.par_kwh), plans: run.calls, at: Date.now(),
          ...(run.player_id ? { player_tag: run.player_id.slice(2, 8) } : {}) });
      }
      return r;
    });
  }

  /** One bot holds one run at a time: taking a new hail in the same MCP session abandons the open one. */
  async abandon() {
    const run = await this.#run();
    if (run && !run.started && !run.abandoned) { run.abandoned = true; await this.#save(run); }
    return { ok: true };
  }
}

export class SolHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS legcache (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS termscache (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS best (mission_id TEXT PRIMARY KEY, v TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS stats (k TEXT PRIMARY KEY, n INTEGER NOT NULL)");
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
  termsGet(id, t0, end, seed) { const v = this.#get("termscache", `${id}|${t0}|${end}|s${seed}`); this.#bump(v ? "terms_hit" : "terms_miss"); return v; }
  termsPut(id, t0, end, seed, v) { this.#put("termscache", `${id}|${t0}|${end}|s${seed}`, v); }

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

  board() {
    const best = {};
    for (const row of this.sql.exec("SELECT mission_id, v FROM best").toArray()) best[row.mission_id] = JSON.parse(row.v);
    const stats = {};
    for (const row of this.sql.exec("SELECT k, n FROM stats").toArray()) stats[row.k] = row.n;
    return { best, stats };
  }
}
