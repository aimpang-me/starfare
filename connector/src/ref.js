// StarfareRef: the reference company beside each sandbox world (world-ref.js), one per world_id. It runs in its own Worker
// (starfare-ref, wrangler.ref.jsonc), so its planning, which takes seconds of CPU for an interplanetary job, never runs in the
// isolate that answers the player's agents. The world (StarfareWorld in the starfare Worker) calls follow with each new tick;
// the reference plays up to it, a job per alarm, and sends its scores back to the world's refReport after each one.
import { DurableObject } from "cloudflare:workers";
import { engine } from "./engine.js";
import { hubLegFn } from "./store.js";
import { newRef, refCatchUp, refScores } from "./world-ref.js";

const KEEP_MS = 30 * 24 * 3600 * 1000; // a reference its world has not followed for this long is deleted
// One alarm plays at most this many jobs; the next, set for now, goes on, so a world's follow never waits behind a long run.
const REF_JOBS_PER_ALARM = 1;
const newRunId = () => "run_" + [...crypto.getRandomValues(new Uint8Array(10))].map((b) => b.toString(16).padStart(2, "0")).join("");
const worldOf = (env, worldId) => env.STARFARE_WORLD.get(env.STARFARE_WORLD.idFromName(worldId));

export class StarfareRef extends DurableObject {
  #queue = Promise.resolve();

  #serial(fn) {
    const p = this.#queue.then(fn);
    this.#queue = p.catch(() => {});
    return p;
  }

  /** The world has reached tick toTick: play up to it. Creates the reference on the world's id, seed and market at first. */
  follow(worldId, seed, capMs, toTick) {
    return this.#serial(async () => {
      const E = await engine(), now = Date.now();
      const st = (await this.ctx.storage.get("ref")) || { world_id: worldId, ref: newRef(E, { world_id: worldId, seed, clock: { cap_ms: capMs } }, now), to_tick: 0 };
      st.to_tick = Math.max(st.to_tick, toTick);
      st.active_ms = now;
      await this.ctx.storage.put("ref", st);
      await this.ctx.storage.setAlarm(now);
    });
  }

  /** The world was deleted: so is its reference. */
  drop() {
    return this.#serial(() => this.ctx.storage.deleteAll());
  }

  /** One slice of catching up (REF_JOBS_PER_ALARM jobs, or the ticks between), then the scores go to the world, and the
   *  next alarm is now while the reference is still behind. A reference nobody follows for KEEP_MS is deleted. */
  alarm() {
    return this.#serial(async () => {
      const st = await this.ctx.storage.get("ref");
      if (!st) return;
      const now = Date.now();
      if (now >= st.active_ms + KEEP_MS) { await this.ctx.storage.deleteAll(); return; }
      const E = await engine();
      const caught = await refCatchUp(E, st.ref, st.to_tick, { nowMs: now, legFn: hubLegFn(this.env, E), newRunId, maxJobs: REF_JOBS_PER_ALARM });
      await this.ctx.storage.put("ref", st);
      await this.ctx.storage.setAlarm(caught ? st.active_ms + KEEP_MS : Date.now());
      if (this.env.STARFARE_WORLD) await worldOf(this.env, st.world_id).refReport(refScores(E, st.ref)).catch((e) => console.log("reference report failed", st.world_id, String(e)));
    });
  }
}
