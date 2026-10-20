// StarfareWorld: one per sandbox world (world_id). Holds the world (world-state.js) and runs its clock's capped ticks on
// the Durable Object's alarm. Calls run one at a time, so a seat's wait, a capped tick and two jobs dispatching the same
// ship never interleave. Each job's run is stored under its own key ("job:<job_id>"), beside the world's index of jobs.
// Behind STARFARE_SANDBOX ("on" opens /world/new and /world/<world_id>.json; anything else answers 404). Nothing links it yet.
import { DurableObject } from "cloudflare:workers";
import META from "./engine/meta.json" with { type: "json" };
import { newRunId } from "./bench-host.js";
import { engine } from "./engine.js";
import { GameError, RUN_TOOL_NAMES, applyTool, computeLeg, hailInfo, legKey, restoreRunBookings } from "./game.js";
import { worldSeed } from "./season-seed.js";
import { hub } from "./store.js";
import { JOB_ID, TICK_CAP_MS, WorldError, capDueMs, capTick, dropJob, jobMoved, joinSeat, newWorld, syncJob, takeJob, waitSeat, worldView } from "./world-state.js";

export { WORLD_ID } from "./world-state.js";
export const sandboxOn = (env) => env.STARFARE_SANDBOX === "on";
export const worldStub = (env, id) => env.STARFARE_WORLD.get(env.STARFARE_WORLD.idFromName(id));
/** The real-time cap on a tick: WORLD_TICK_CAP_S when set (tests shorten it), else TICK_CAP_MS. */
export const capMsOf = (env) => (Number(env.WORLD_TICK_CAP_S) > 0 ? Number(env.WORLD_TICK_CAP_S) * 1000 : TICK_CAP_MS);
const KEEP_MS = 30 * 24 * 3600 * 1000; // a world nobody joined, waited in or looked at for this long is deleted

export class StarfareWorld extends DurableObject {
  #queue = Promise.resolve();

  #serial(fn) {
    const p = this.#queue.then(fn);
    this.#queue = p.catch(() => {});
    return p;
  }

  async #world() { return (await this.ctx.storage.get("world")) ?? null; }

  /** Saves the world and sets the alarm for whichever comes first: the open tick's cap, or deleting the idle world. */
  async #save(w) {
    await this.ctx.storage.put("world", w);
    const due = capDueMs(w), gone = w.active_ms + KEEP_MS;
    await this.ctx.storage.setAlarm(due == null ? gone : Math.min(due, gone));
  }

  async #guard(fn) {
    try { return await fn(); }
    catch (e) { if (e instanceof WorldError || e instanceof GameError) return { error: e.message }; throw e; }
  }

  async #job(E, jobId) {
    const run = JOB_ID.test(String(jobId)) ? await this.ctx.storage.get("job:" + jobId) : null;
    return run ? restoreRunBookings(E, run) : null;
  }

  /** Plans go through the hub's leg cache, as a season run's do (StarfareRun); without a hub (tests) they are planned here. */
  #legFn(E) {
    if (!this.env.STARFARE_HUB) return null;
    const h = hub(this.env);
    return async (from, to, t, obj, end, ship, aboard) => {
      const key = META.sha256 + "|" + legKey(from, to, t, obj, end, ship, aboard), hit = await h.legGet(key);
      if (hit && hit.arc_au) return { leg: hit, cached: true };
      const leg = computeLeg(E, from, to, t, obj, end, ship, aboard);
      await h.legPut(key, leg);
      return { leg, cached: false };
    };
  }

  create(worldId, owner = null) {
    return this.#serial(() => this.#guard(async () => {
      if (await this.#world()) return { error: "world " + worldId + " already exists" };
      const now = Date.now(), E = await engine();
      const w = newWorld(E, { worldId, seed: await worldSeed(this.env, worldId), owner, nowMs: now, capMs: capMsOf(this.env) });
      await this.#save(w);
      return worldView(E, w, now);
    }));
  }

  /** The world's page view, or null for an unknown world_id. Looking counts as activity, so a watched world is kept. */
  view() {
    return this.#serial(async () => {
      const w = await this.#world();
      if (!w) return null;
      const now = Date.now();
      w.active_ms = now;
      await this.#save(w);
      return worldView(await engine(), w, now);
    });
  }

  /** A seat takes part in ticks (the seat codes and join tool come in plan step 4). */
  join(seat) {
    return this.#serial(() => this.#guard(async () => {
      const w = await this.#world();
      if (!w) return { error: "unknown world" };
      const now = Date.now();
      joinSeat(w, seat, now);
      await this.#save(w);
      return { joined: seat, clock: worldView(await engine(), w, now).clock };
    }));
  }

  /** A seat is done for this tick; the last joined seat to wait runs it (the wait tool comes in plan step 6). */
  wait(seat) {
    return this.#serial(() => this.#guard(async () => {
      const w = await this.#world();
      if (!w) return { error: "unknown world" };
      const now = Date.now(), tick = waitSeat(w, seat, now);
      await this.#save(w);
      return { waiting: seat, tick, clock: worldView(await engine(), w, now).clock };
    }));
  }

  /** Takes a market hail as a new job (plan step 3; the executor's assign tool comes in step 5). Returns the job's hail
   *  as get_hail shows it, with its job_id. */
  take(hailId) {
    return this.#serial(() => this.#guard(async () => {
      const w = await this.#world();
      if (!w) return { error: "unknown world" };
      const E = await engine(), now = Date.now(), { run, job } = await takeJob(E, w, hailId, now, newRunId());
      await this.ctx.storage.put("job:" + job.job_id, run);
      await this.#save(w);
      return hailInfo(E, run, now);
    }));
  }

  /** One run tool call on a job (get_hail, plan_pickup, plan_ride, plan_leg, check_pad, space_weather, dispatch, decide),
   *  answered by applyTool on the world's sky time and ships. A dispatch or a landing moves the job's ship. */
  act(jobId, tool, input = {}) {
    return this.#serial(() => this.#guard(async () => {
      const w = await this.#world();
      if (!w) return { error: "unknown world" };
      if (!RUN_TOOL_NAMES.includes(tool)) return { error: "not a job tool: " + tool };
      const E = await engine(), before = await this.#job(E, jobId);
      if (!before) return { error: "unknown job_id " + jobId };
      const now = Date.now(), synced = syncJob(w, structuredClone(before));
      const { run, result } = await applyTool(E, synced, tool, input, { nowMs: now, legFn: this.#legFn(E) });
      const after = run || synced;
      if (JSON.stringify(after) !== JSON.stringify(before)) {
        jobMoved(w, after);
        await this.ctx.storage.put("job:" + jobId, after);
      }
      w.active_ms = now;
      await this.#save(w);
      return result;
    }));
  }

  /** Drops a job: planning is abandoned; a ride at a checkpoint flies on with the defaults and is scored. */
  drop(jobId) {
    return this.#serial(() => this.#guard(async () => {
      const w = await this.#world();
      if (!w) return { error: "unknown world" };
      const E = await engine(), before = await this.#job(E, jobId);
      if (!before) return { error: "unknown job_id " + jobId };
      const { run, result } = dropJob(E, w, before);
      if (run) await this.ctx.storage.put("job:" + jobId, run);
      w.active_ms = Date.now();
      await this.#save(w);
      return result;
    }));
  }

  /** The open tick's cap has passed (it runs, and the seats that had not waited count a stall), or the world sat idle for
   *  KEEP_MS and is deleted. A capped tick is not activity, so a world whose agents went away still expires. */
  alarm() {
    return this.#serial(async () => {
      const w = await this.#world();
      if (!w) return;
      const now = Date.now();
      if (now >= w.active_ms + KEEP_MS) { await this.ctx.storage.deleteAll(); return; }
      capTick(w, now);
      await this.#save(w);
    });
  }
}
