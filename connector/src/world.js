// StarfareWorld: one per sandbox world (world_id). Holds the world (world-state.js) and runs its clock's capped ticks on
// the Durable Object's alarm. Calls run one at a time, so a seat's wait and a capped tick never interleave.
// Behind STARFARE_SANDBOX ("on" opens /world/new and /world/<world_id>.json; anything else answers 404). Nothing links it yet.
import { DurableObject } from "cloudflare:workers";
import { engine } from "./engine.js";
import { worldSeed } from "./season-seed.js";
import { TICK_CAP_MS, WorldError, capDueMs, capTick, joinSeat, newWorld, waitSeat, worldView } from "./world-state.js";

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
    catch (e) { if (e instanceof WorldError) return { error: e.message }; throw e; }
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
