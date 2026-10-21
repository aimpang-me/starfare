// Durable Objects that hold the connector's state.
//   StarfareRun: one per run_id. Holds the run and answers its tool calls through applyTool, so one run's calls are
//           serialized and different players plan in parallel.
//   StarfareHub: one global instance. Plan+re-fly cache, hail-terms cache (keyed by hail, t0, season end, hazard seed and engine),
//           best score per hail, per-IP rate limit, and each signed-in player's ride history (an index row and summary per run;
//           the full log stays in the run's StarfareRun) plus 24-hour export tokens and follow tokens (/agent/<token>), and
//           Comms channels: a home page's HQ log, linked to an agent by a one-time check-in code (check_in).
//           (The best table's key column is still called mission_id; it holds the hail id.)
// Every RPC method returns plain data; game errors come back as { error } instead of throwing across RPC.
import { DurableObject } from "cloudflare:workers";
import { engine } from "./engine.js";
import META from "./engine/meta.json" with { type: "json" };
import { episodeText } from "./episode.js";
import {
  GameError, applyTool, computeLeg, engaged, flyLive, followView, hailInfo, leaveRun, legKey, legPub, liveRecord, liveRow, logTake, openRun, phaseOf, rideCursor, rideCursorOf, rideRecord,
  rideStats, rideSummary, resolveHail, restoreRunBookings, seasonInstance, seasonSpan, seasonStandings, sky,
} from "./game.js";
import { liveIdsToDrop } from "./live.js";
import { seasonSeed } from "./season-seed.js";
import { distinctPlayers as playersIn, ensurePool as freezePool, poolSize as storedPool, recordBest } from "./hub-pool.js";

export const hub = (env) => env.STARFARE_HUB.get(env.STARFARE_HUB.idFromName("hub"));
/** A legFn (game.js) that plans through the hub's leg cache, or null without a hub (tests plan each leg themselves). */
export const hubLegFn = (env, E) => {
  if (!env.STARFARE_HUB) return null;
  const h = hub(env);
  return async (from, to, t, obj, end, ship, aboard) => {
    const key = META.sha256 + "|" + legKey(from, to, t, obj, end, ship, aboard), hit = await h.legGet(key);
    if (hit && hit.arc_au) return { leg: hit, cached: true };
    const leg = computeLeg(E, from, to, t, obj, end, ship, aboard);
    await h.legPut(key, leg);
    return { leg, cached: false };
  };
};
export const runStub = (env, runId) => env.STARFARE_RUN.get(env.STARFARE_RUN.idFromName(runId));

const CACHE_MAX = 5000;
const HITS_MAX = 20000; // rate-limit keys tracked in one minute
const termsKey = (id, t0, end, seed) => `${id}|${t0}|${end}|s${seed}|e${META.sha256.slice(0, 16)}`;
const RIDES_MAX = 1000; // index rows kept per player, newest first
const EXPORT_MAX = 500; // newest arrived rides in one export file (each is one RPC to its run)
const EXPORT_MS = 24 * 3600 * 1000;
const FOLLOW_RUNS = 10; // newest bookings the agent page shows
export const FOLLOW_TOKEN = /^[0-9a-f]{32}$/;
// Comms: a channel is the browser's secret (it reads /comms/<channel>.json); the code is what the player gives the agent.
export const COMMS_CHANNEL = /^[0-9a-f]{32}$/;
const CODE_ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", CODE_MS = 10 * 60 * 1000, COMMS_EVENTS = 50;
export const COMMS_CODE = /^[A-HJ-NP-Z2-9]{2}-[A-HJ-NP-Z2-9]{4}$/;
const newCode = () => { const b = crypto.getRandomValues(new Uint8Array(6)), c = [...b].map((x) => CODE_ABC[x % CODE_ABC.length]).join(""); return c.slice(0, 2) + "-" + c.slice(2); };
const newToken = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
/** Where a ride stands for its history row: its phase, the checkpoints answered, and whether it counts as an attempt yet
 *  (the first plan or forecast). Later plans and forecasts leave it where it was. */
const rideMark = (run) => phaseOf(run) + "/" + (run.decisions ? run.decisions.length : 0) + (engaged(run) ? "/a" : "");
const LIVE_HELD_MS = 6 * 3600 * 1000; // a flight held at a checkpoint leaves the home map after this long without an answer
const LIVE_AFTER_MS = 60 * 1000; // landed rows older than this leave, except the newest
const RUN_KEEP_MS = 3 * 24 * 3600 * 1000; // a run that never flew is deleted this long after it was taken (StarfareRun.alarm)
// Comms channels nobody checked in on are dropped after a day, every channel after 30; the page opens a new one on a 404.
const COMMS_IDLE_MS = 24 * 3600 * 1000, COMMS_KEEP_MS = 30 * 24 * 3600 * 1000, COMMS_SWEEP = 200;

export class StarfareRun extends DurableObject {
  #queue = Promise.resolve();
  #serial(fn) {
    const pending = this.#queue.then(fn);
    this.#queue = pending.catch(() => {});
    return pending;
  }
  async #run() {
    const run = (await this.ctx.storage.get("run")) ?? null;
    return run ? restoreRunBookings(await engine(), run) : null;
  }
  async #save(run) { await this.ctx.storage.put("run", run); }
  /** Plans go through the hub's leg cache; plan_pickup, plan_ride_leg and a replan at a checkpoint share it. */
  #legFn(E) {
    const h = hub(this.env);
    return async (from, to, t, obj, end, ship, aboard) => {
      const key = META.sha256 + "|" + legKey(from, to, t, obj, end, ship, aboard), hit = await h.legGet(key);
      if (hit && hit.arc_au) return { leg: hit, cached: true }; // rows cached before arcs were kept are planned again
      const leg = computeLeg(E, from, to, t, obj, end, ship, aboard);
      await h.legPut(key, leg);
      return { leg, cached: false };
    };
  }
  /** The board holds arrived runs only. */
  async #record(run) {
    const s = run.score;
    await hub(this.env).record({ hail_id: run.id, title: run.title, run_tag: run.run_id.slice(4, 10), run_id: run.run_id, points: s.total, car: s.car,
      wait_h: Math.round((run.pickup_jd - run.t0) * 240) / 10, kwh: Math.round(s.used_kwh), par: Math.round(s.par_kwh), plans: run.calls, at: Date.now(),
      score_version: s.score_version, engine_sha256: META.sha256,
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

  async create(runId, hailId, playerId = null, client = null) {
    return this.#serial(() => this.#guard(async () => {
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
      const now = Date.now(), season = sky(now).season, cap = await h.ensurePool(season);
      resolveHail(E, hailId, season, cap);
      const run = await openRun(E, seasonInstance(E, hailId, now, await seasonSeed(this.env, season)), runId, now, termsFn);
      if (playerId) run.player_id = playerId; // STARFARE_OAUTH on only; a label, the run_id rules do not change
      logTake(E, run, now, client);
      await this.#save(run);
      await this.ctx.storage.setAlarm(now + RUN_KEEP_MS);
      await this.#index(E, run);
      return hailInfo(E, run, Date.now());
    }));
  }

  /** Every run-scoped tool call (get_hail, plan_pickup, plan_ride, check_pad, space_weather, dispatch, decide). */
  async act(tool, input, playerId = null) {
    return this.#serial(async () => {
      const before = await this.#run();
      // A signed-in player's run answers only them: its run_id is public on the watch page and the home map.
      if (!before || (before.player_id && before.player_id !== playerId)) return { error: "unknown run_id. Call take_hail to get one." };
      const E = await engine();
      const { run, result } = await applyTool(E, before, tool, input, { nowMs: Date.now(), legFn: this.#legFn(E) });
      if (run) await this.#commit(E, before, run);
      return result;
    });
  }

  /** One bot holds one run at a time. Taking a new hail in the same MCP session abandons the open run if it is still planning,
   *  or flies it on the defaults to arrive if it is at a checkpoint, scored and on the board. */
  async leave() {
    return this.#serial(async () => {
      const before = await this.#run();
      if (!before) return null;
      const E = await engine(), run = structuredClone(before), r = leaveRun(E, run);
      if (!r) return null;
      if (run.live && phaseOf(run) === "arrived") flyLive(run, Date.now());
      await this.#commit(E, before, run);
      return { run_id: r.run_id, status: r.status, ...(r.status === "arrived" ? { total: r.total, note: r.note } : {}) };
    });
  }

  /** RUN_KEEP_MS after take_hail: a run that never flew (still planning, or abandoned) is deleted, since its hail went cold
   *  with its season. Arrived runs stay for the board, replays and history; one still flying looks again later. */
  async alarm() {
    return this.#serial(async () => {
      const run = (await this.ctx.storage.get("run")) ?? null, phase = run ? phaseOf(run) : null;
      if (phase === "arrived") return;
      if (phase === "in_flight") { await this.ctx.storage.setAlarm(Date.now() + RUN_KEEP_MS); return; }
      await this.ctx.storage.deleteAll();
    });
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
  /** The agent page's view of this run (followView), or null. */
  async follow() {
    const run = await this.#run();
    return run && run.tag == null ? followView(run) : null;
  }
  async episode() {
    const run = await this.#run();
    if (!run) return null;
    return episodeText(await engine(), run, null);
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
    this.sql.exec("CREATE INDEX IF NOT EXISTS rides_by_created ON rides (created_ms)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS exports (token TEXT PRIMARY KEY, player_id TEXT NOT NULL, expires_ms INTEGER NOT NULL)");
    // A follow token opens /agent/<token>: one signed-in player's bookings and log, live. Shown on the consent page and by take_hail.
    this.sql.exec("CREATE TABLE IF NOT EXISTS follows (token TEXT PRIMARY KEY, player_id TEXT NOT NULL, created_ms INTEGER NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS follows_by_player ON follows (player_id, created_ms DESC)");
    // Comms channels (simulated game data only): the one-time code an agent checks in with, the player it turned out to be, its events and runs.
    this.sql.exec("CREATE TABLE IF NOT EXISTS comms (channel TEXT PRIMARY KEY, code TEXT, code_expires_ms INTEGER, player_id TEXT, created_ms INTEGER NOT NULL)");
    this.sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS comms_by_code ON comms (code)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS comms_by_created ON comms (created_ms)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS comms_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL, at_ms INTEGER NOT NULL, v TEXT NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS comms_events_by_channel ON comms_events (channel, seq)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS comms_runs (channel TEXT NOT NULL, run_id TEXT NOT NULL, created_ms INTEGER NOT NULL, PRIMARY KEY (channel, run_id))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS live (run_id TEXT PRIMARY KEY, v TEXT NOT NULL, land_ms INTEGER, updated_ms INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS hubkv (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    // Held-out test sessions started per player (or address, without sign-in) on one UTC day (StarfareBench.create).
    this.sql.exec("CREATE TABLE IF NOT EXISTS bench_quota (k TEXT PRIMARY KEY, day INTEGER NOT NULL, n INTEGER NOT NULL)");
    this.hits = new Map(); // key -> calls this minute; in memory on purpose: losing it on eviction only resets a minute's count
    this.hitsWin = -1;
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

  /** Fixed one-minute window per key (an address, a /64 or a player). n is how many calls this request carries (a JSON-RPC
   *  batch counts each message). The map starts empty each minute, so nothing is ever scanned; past HITS_MAX keys in one
   *  minute, new keys share one bucket, so a flood from many addresses cannot grow it. Returns { ok, n, limit }. */
  hit(key, limit, n = 1) {
    const win = Math.floor(Date.now() / 60000);
    if (this.hitsWin !== win) { this.hits = new Map(); this.hitsWin = win; }
    const k = this.hits.has(key) || this.hits.size < HITS_MAX ? key : "overflow";
    const count = (this.hits.get(k) || 0) + Math.max(1, n | 0);
    this.hits.set(k, count);
    return { ok: count <= limit, n: count, limit };
  }

  record(e) {
    return recordBest(this.sql, e);
  }

  /** Counts one held-out test session for key today (UTC), or refuses it once key has started limit today: { ok, n, limit }.
   *  Rows from earlier days are dropped as it goes, so the table holds one day's keys. */
  benchQuota(key, limit) {
    const day = Math.floor(Date.now() / 864e5);
    this.sql.exec("DELETE FROM bench_quota WHERE day < ?", day);
    const n = (this.sql.exec("SELECT n FROM bench_quota WHERE k = ?", key).toArray()[0] || { n: 0 }).n;
    if (n >= limit) return { ok: false, n, limit };
    this.sql.exec("INSERT INTO bench_quota (k, day, n) VALUES (?, ?, 1) ON CONFLICT(k) DO UPDATE SET n = n + 1", key, day);
    return { ok: true, n: n + 1, limit };
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

  /** Ties the token the consent page showed to the player Allow just made. A token already taken stays with its player. */
  followClaim(token, player) {
    if (!FOLLOW_TOKEN.test(String(token))) return false;
    this.sql.exec("INSERT OR IGNORE INTO follows (token, player_id, created_ms) VALUES (?, ?, ?)", token, player, Date.now());
    return this.sql.exec("SELECT player_id FROM follows WHERE token = ?", token).one().player_id === player;
  }
  /** The player's follow token, minted on first use (a player who connected before follow links existed gets one here). */
  followFor(player) {
    const row = this.sql.exec("SELECT token FROM follows WHERE player_id = ? ORDER BY created_ms DESC LIMIT 1", player).toArray()[0];
    if (row) return row.token;
    const token = newToken();
    this.sql.exec("INSERT INTO follows (token, player_id, created_ms) VALUES (?, ?, ?)", token, player, Date.now());
    return token;
  }
  /** The run_ids of a follow token's newest bookings, newest first, or null for an unknown token. */
  followRuns(token) {
    const row = this.sql.exec("SELECT player_id FROM follows WHERE token = ?", String(token)).toArray()[0];
    if (!row) return null;
    return this.sql.exec("SELECT run_id FROM rides WHERE player_id = ? ORDER BY created_ms DESC, run_id DESC LIMIT ?", row.player_id, FOLLOW_RUNS)
      .toArray().map((x) => x.run_id);
  }

  /** A new Comms channel and its first check-in code. The channel stays secret in the browser; the code goes to the agent. */
  commsOpen() {
    const channel = newToken(), now = Date.now();
    this.#commsSweep(now);
    this.sql.exec("INSERT INTO comms (channel, code, code_expires_ms, player_id, created_ms) VALUES (?, NULL, NULL, NULL, ?)", channel, now);
    return { channel, ...this.commsCode(channel) };
  }
  /** A fresh code for a channel (the old one stops working), or { error } for an unknown channel. */
  commsCode(channel) {
    if (!this.sql.exec("SELECT 1 FROM comms WHERE channel = ?", String(channel)).toArray().length) return { error: "unknown channel" };
    const expires_ms = Date.now() + CODE_MS;
    for (;;) {
      const code = newCode();
      if (this.sql.exec("SELECT 1 FROM comms WHERE code = ?", code).toArray().length) continue;
      this.sql.exec("UPDATE comms SET code = ?, code_expires_ms = ? WHERE channel = ?", code, expires_ms, channel);
      return { code, expires_ms };
    }
  }
  /** An agent checks in with a code: the code is spent, the channel learns the player (when signed in) and gets the two events. */
  commsCheckIn(code, info, player) {
    const c = String(code || "").trim().toUpperCase();
    const row = COMMS_CODE.test(c) ? this.sql.exec("SELECT channel, code_expires_ms FROM comms WHERE code = ?", c).toArray()[0] : null;
    if (!row || row.code_expires_ms < Date.now()) return { error: "That HQ code is unknown or expired. Ask the player for the code their Comms panel shows now (it lasts 10 minutes and works once)." };
    this.sql.exec("UPDATE comms SET code = NULL, code_expires_ms = NULL" + (player ? ", player_id = ?" : "") + " WHERE channel = ?", ...(player ? [player, row.channel] : [row.channel]));
    const now = Date.now();
    this.#commsEvent(row.channel, now, { kind: "connected", client: info.client || null });
    this.#commsEvent(row.channel, now, { kind: "check_in", ...info, signed_in: !!player });
    return { channel: row.channel };
  }
  /** Drops up to COMMS_SWEEP expired channels with their events and runs. Runs whenever a channel opens, so the table
   *  cannot outgrow what was opened in the last 30 days. */
  #commsSweep(now) {
    const old = this.sql.exec("SELECT channel FROM comms WHERE created_ms < ? AND (created_ms < ? OR (player_id IS NULL AND NOT EXISTS " +
      "(SELECT 1 FROM comms_events e WHERE e.channel = comms.channel))) ORDER BY created_ms LIMIT ?", now - COMMS_IDLE_MS, now - COMMS_KEEP_MS, COMMS_SWEEP)
      .toArray().map((x) => x.channel);
    for (const c of old) {
      this.sql.exec("DELETE FROM comms_events WHERE channel = ?", c);
      this.sql.exec("DELETE FROM comms_runs WHERE channel = ?", c);
      this.sql.exec("DELETE FROM comms WHERE channel = ?", c);
    }
    return old.length;
  }
  #commsEvent(channel, at, v) {
    this.sql.exec("INSERT INTO comms_events (channel, at_ms, v) VALUES (?, ?, ?)", channel, at, JSON.stringify(v));
    this.sql.exec("DELETE FROM comms_events WHERE channel = ? AND seq NOT IN (SELECT seq FROM comms_events WHERE channel = ? ORDER BY seq DESC LIMIT ?)", channel, channel, COMMS_EVENTS);
  }
  /** A booking taken in a session that checked in (needed when the server runs without sign-in). */
  commsRun(channel, runId) {
    if (!COMMS_CHANNEL.test(String(channel))) return false;
    this.sql.exec("INSERT OR IGNORE INTO comms_runs (channel, run_id, created_ms) VALUES (?, ?, ?)", channel, runId, Date.now());
    return true;
  }
  /** What a channel's page reads: its events after seq, whether a code is waiting, and the run_ids of its agent's newest bookings. */
  commsView(channel, after = 0) {
    const ch = this.sql.exec("SELECT * FROM comms WHERE channel = ?", String(channel)).toArray()[0];
    if (!ch) return null;
    const events = this.sql.exec("SELECT seq, at_ms, v FROM comms_events WHERE channel = ? AND seq > ? ORDER BY seq", ch.channel, Number(after) || 0)
      .toArray().map((x) => ({ seq: x.seq, at_ms: x.at_ms, ...JSON.parse(x.v) }));
    const runs = this.sql.exec("SELECT run_id, created_ms FROM comms_runs WHERE channel = ?", ch.channel).toArray();
    if (ch.player_id) runs.push(...this.sql.exec("SELECT run_id, created_ms FROM rides WHERE player_id = ? ORDER BY created_ms DESC LIMIT ?", ch.player_id, FOLLOW_RUNS).toArray());
    const seen = new Set(), run_ids = runs.sort((a, b) => b.created_ms - a.created_ms).map((r) => r.run_id).filter((id) => !seen.has(id) && seen.add(id)).slice(0, FOLLOW_RUNS);
    const code = ch.code && ch.code_expires_ms > Date.now() ? { code: ch.code, expires_ms: ch.code_expires_ms } : null;
    const linked = !!ch.player_id || this.sql.exec("SELECT 1 FROM comms_events WHERE channel = ? LIMIT 1", ch.channel).toArray().length > 0;
    return { linked, code, events, run_ids };
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

  poolSize(season) { return storedPool(this.sql, season); }
  distinctPlayers(season) { return playersIn(this.sql, season); }
  ensurePool(season) { return freezePool(this.sql, season); }

  /** The board's season ranking, from the history rows of the season's signed-in players (seasonStandings). */
  standings(season) {
    const span = seasonSpan(season);
    const rows = this.sql.exec("SELECT player_id, phase, json_extract(summary, '$.total') AS total, json_extract(summary, '$.plans_used') AS plans_used, " +
      "json_extract(summary, '$.forecasts_used') AS forecasts_used FROM rides WHERE created_ms >= ? AND created_ms < ?", span.start, span.end).toArray();
    return seasonStandings(rows);
  }

  board(season = null) {
    const best = {};
    for (const row of this.sql.exec("SELECT mission_id, v FROM best").toArray()) best[row.mission_id] = JSON.parse(row.v);
    const stats = {};
    for (const row of this.sql.exec("SELECT k, n FROM stats").toArray()) stats[row.k] = row.n;
    return { best, stats, ...(season != null ? { standings: this.standings(season) } : {}) };
  }
}
