// StarfareWorld: one per sandbox world (world_id). Holds the world (world-state.js) and runs its clock's capped ticks on
// the Durable Object's alarm. Calls run one at a time, so a seat's wait, a capped tick and two jobs dispatching the same
// ship never interleave. Each job's run is stored under its own key ("job:<job_id>"), beside the world's index of jobs.
// A wait with an empty inbox holds outside that queue, for up to its seconds, until a save puts something in its inbox.
// Behind STARFARE_SANDBOX ("on" opens /world/new and /world/<world_id>.json; anything else answers 404). Nothing links it yet.
import { DurableObject } from "cloudflare:workers";
import META from "./engine/meta.json" with { type: "json" };
import { newRunId } from "./bench-host.js";
import { engine } from "./engine.js";
import { GameError, RUN_TOOL_NAMES, applyTool, computeLeg, hailInfo, legKey, restoreRunBookings } from "./game.js";
import { worldSeed } from "./season-seed.js";
import { hub } from "./store.js";
import {
  JOB_ID, SEATS, TICK_CAP_MS, WAIT_MAX_S, WorldError, addReport, busySeat, capDueMs, capTick, codeHash, declineHail, dropJob, inboxCount, jobMoved, jobRefusal, joinSeat,
  marketPage, newSecret, newWorld, parseCode, post, queueView, reportsView, scopeRefusal, seatBrief, seatCode, sendMessage, syncJob, takeInbox, takeJob, transferShip,
  waitSeat, waitView, worldView,
} from "./world-state.js";

export { WORLD_ID, parseCode } from "./world-state.js";
export const sandboxOn = (env) => env.STARFARE_SANDBOX === "on";
export const worldStub = (env, id) => env.STARFARE_WORLD.get(env.STARFARE_WORLD.idFromName(id));
/** The real-time cap on a tick: WORLD_TICK_CAP_S when set (tests shorten it), else TICK_CAP_MS. */
export const capMsOf = (env) => (Number(env.WORLD_TICK_CAP_S) > 0 ? Number(env.WORLD_TICK_CAP_S) * 1000 : TICK_CAP_MS);
const KEEP_MS = 30 * 24 * 3600 * 1000; // a world nobody joined, waited in or looked at for this long is deleted

export class StarfareWorld extends DurableObject {
  #queue = Promise.resolve();
  #waiters = new Map(); // seat -> the wake functions of its held waits

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
    for (const seat of SEATS) if (inboxCount(w, seat) > 0) for (const wake of [...(this.#waiters.get(seat) || [])]) wake();
  }

  /** Resolves when a save puts something in seat's inbox, or after ms. */
  #hold(seat, ms) {
    return new Promise((resolve) => {
      const set = this.#waiters.get(seat) || new Set(), wake = () => { clearTimeout(timer); set.delete(wake); resolve(); };
      const timer = setTimeout(wake, ms);
      set.add(wake);
      this.#waiters.set(seat, set);
    });
  }

  /** The world and the seat a code names, or { error } when the code is not this world's. */
  async #seatOf(code) {
    const c = parseCode(code), w = await this.#world();
    if (!c || !w || c.world_id !== w.world_id || w.seats[c.seat].code_hash !== (await codeHash(c.secret)))
      return { error: "That seat code is not valid. Ask the player for the code their world's page shows for your seat." };
    return { w, seat: c.seat };
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

  /** A new world, and its seat codes: returned here once (for the owner's page) and kept only as hashes. */
  create(worldId, owner = null) {
    return this.#serial(() => this.#guard(async () => {
      if (await this.#world()) return { error: "world " + worldId + " already exists" };
      const now = Date.now(), E = await engine();
      const w = newWorld(E, { worldId, seed: await worldSeed(this.env, worldId), owner, nowMs: now, capMs: capMsOf(this.env) }), codes = {};
      for (const seat of SEATS) {
        const secret = newSecret();
        codes[seat] = seatCode(worldId, seat, secret);
        w.seats[seat].code_hash = await codeHash(secret);
      }
      await this.#save(w);
      return { ...worldView(E, w, now), codes };
    }));
  }

  /** Every sandbox tool call from an agent: the seat's code is checked, then the tool against the seat's role. Every answer
   *  carries inbox, the count of events waiting for the seat's next wait. */
  async seat(code, tool, input = {}) {
    if (tool === "wait") return this.#wait(code, input);
    return this.#serial(() => this.#guard(async () => {
      const at = await this.#seatOf(code);
      if (at.error) return at;
      const { w, seat } = at, refused = scopeRefusal(w, seat, tool);
      if (refused) return { error: refused };
      const E = await engine(), now = Date.now();
      busySeat(w, seat);
      const r = await this.#tool(E, w, seat, tool, input, now);
      await this.#save(w);
      return r && typeof r === "object" && !Array.isArray(r) ? { ...r, inbox: inboxCount(w, seat) } : r;
    }));
  }

  async #tool(E, w, seat, tool, input, now) {
    switch (tool) {
      case "join":
        joinSeat(w, seat, now, input.agent || null);
        return seatBrief(E, w, seat, now);
      case "company": return worldView(E, w, now);
      case "market": return marketPage(E, w, input);
      case "assign": {
        const desk = String(input.desk || "").toUpperCase();
        if (!Object.hasOwn(w.desks, desk)) return { error: "desk must be one of " + Object.keys(w.desks).map((d) => d + " (" + w.desks[d].name + ")").join(", ") };
        const h = await this.#take(E, w, input.hail_id, now, desk);
        post(w, [desk], { kind: "assigned", at_ms: now, job_id: h.job_id, hail_id: h.hail_id, title: h.title, pickup_at: h.pickup_at, destination: h.destination,
          rider_ready: h.rider_ready, arrive_by: h.arrive_by });
        return { assigned: h.job_id, desk: desk + " (" + w.desks[desk].name + ")", hail: h };
      }
      case "decline": return declineHail(E, w, input.hail_id, now);
      case "transfer_ship": return transferShip(E, w, input.car, String(input.desk || "").toUpperCase(), now);
      case "reports": return reportsView(E, w);
      case "queue": return queueView(E, w, seat, now);
      case "report": return addReport(w, seat, input.text, input.job_id ?? null, now);
      case "message": return sendMessage(w, seat, input.to, input.text, now);
      default:
        if (RUN_TOOL_NAMES.includes(tool)) return this.#act(E, w, input.job_id, tool, input, now, seat);
    }
    return { error: tool + " is not built yet in this sandbox." };
  }

  /** wait: the seat is done for this tick (the last joined seat to wait runs it). Its inbox comes back at once when it holds
   *  anything; otherwise the call holds up to seconds (WAIT_MAX_S at most) for a tick, a job, a landing or a message. */
  async #wait(code, input) {
    const secs = Math.max(0, Math.min(WAIT_MAX_S, input.seconds == null || !isFinite(Number(input.seconds)) ? WAIT_MAX_S : Number(input.seconds)));
    const t0 = Date.now();
    let held = null;
    const first = await this.#serial(() => this.#guard(async () => {
      const at = await this.#seatOf(code);
      if (at.error) return at;
      const { w, seat } = at;
      if (w.seats[seat].joined_ms == null) return { error: "join first with this code; then wait." };
      if (!w.clock.done) waitSeat(w, seat, Date.now());
      await this.#save(w);
      // Registered inside the queue, so an event saved right after this cannot slip past the hold.
      if (inboxCount(w, seat) === 0 && secs > 0 && !w.clock.done) held = this.#hold(seat, secs * 1000);
      return { seat };
    }));
    if (first.error) return first;
    if (held) await held;
    return this.#serial(() => this.#guard(async () => {
      const w = await this.#world();
      if (!w) return { error: "unknown world" };
      const E = await engine(), now = Date.now(), events = takeInbox(E, w, first.seat);
      await this.#save(w);
      return { ...waitView(E, w, first.seat, events, now - t0, now), inbox: 0 };
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
      return this.#take(await engine(), w, hailId, Date.now(), null);
    }));
  }

  async #take(E, w, hailId, now, desk) {
    const { run, job } = await takeJob(E, w, hailId, now, newRunId(), desk);
    await this.ctx.storage.put("job:" + job.job_id, run);
    await this.#save(w);
    return hailInfo(E, run, now);
  }

  /** One run tool call on a job (get_hail, plan_pickup, plan_ride, plan_leg, check_pad, space_weather, dispatch, decide),
   *  answered by applyTool on the world's sky time and ships. A dispatch or a landing moves the job's ship. */
  act(jobId, tool, input = {}) {
    return this.#serial(() => this.#guard(async () => {
      const w = await this.#world();
      if (!w) return { error: "unknown world" };
      return this.#act(await engine(), w, jobId, tool, input, Date.now(), null);
    }));
  }

  /** A run tool on a job. From a dispatcher's seat, only on its desk's jobs and ships, and get_hail's fleet is its desk's. */
  async #act(E, w, jobId, tool, input, now, seat) {
    if (!RUN_TOOL_NAMES.includes(tool)) return { error: "not a job tool: " + tool };
    const before = await this.#job(E, jobId);
    if (!before) return { error: "unknown job_id " + jobId + (seat ? "; queue lists your desk's jobs" : "") };
    if (seat) { const no = jobRefusal(E, w, seat, before, tool, input); if (no) return { error: no }; }
    const inp = { ...input }, synced = syncJob(w, structuredClone(before));
    delete inp.job_id; delete inp.code;
    const { run, result } = await applyTool(E, synced, tool, inp, { nowMs: now, legFn: this.#legFn(E) });
    const after = run || synced;
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      jobMoved(w, after);
      await this.ctx.storage.put("job:" + jobId, after);
    }
    w.active_ms = now;
    await this.#save(w);
    if (seat && result && Array.isArray(result.fleet)) result.fleet = result.fleet.filter((c) => w.desks[seat].ships.includes(c.car));
    return result;
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
