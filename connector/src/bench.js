// StarfareBench: one per hosted bench session (bench_id). Holds the session (bench-host.js) and a trace of every tool call,
// which the watch page at /bench/<bench_id> polls. Calls run one at a time, so the page's End button never lands mid-call.
import { DurableObject } from "cloudflare:workers";
import { END_TOOL, benchCall, benchView, endTask, newSession, replayTrace, traceOf } from "./bench-host.js";
import { engine } from "./engine.js";
import { benchTestPerDay } from "./limit.js";
import { hub } from "./store.js";
import { PUBLIC_SPLITS, loadSuite } from "./suite.js";
import V1 from "./suites/v1.json" with { type: "json" };

export const BENCH_ID = /^b_[0-9a-f]{20}$/;
export const benchStub = (env, id) => env.STARFARE_BENCH.get(env.STARFARE_BENCH.idFromName(id));

let suite = null;
const suiteOf = () => (suite ??= loadSuite(V1));

const RESULT_MAX = 64 * 1024, TRACE_PAGE = 50;
const BENCH_KEEP_MS = 7 * 24 * 3600 * 1000;

export class StarfareBench extends DurableObject {
  #queue = Promise.resolve();

  #serial(fn) {
    const p = this.#queue.then(fn);
    this.#queue = p.catch(() => {});
    return p;
  }

  async #session() { return (await this.ctx.storage.get("session")) ?? null; }

  #log(task, tool, input, result) {
    let r = JSON.stringify(result);
    if (r.length > RESULT_MAX) r = JSON.stringify({ truncated: "this result was " + r.length + " characters; the first " + RESULT_MAX + " follow", head: r.slice(0, RESULT_MAX) });
    this.ctx.storage.sql.exec("INSERT INTO trace (at, task, tool, input, result) VALUES (?, ?, ?, ?, ?)", Date.now(), task, tool, JSON.stringify(input ?? {}), r);
  }

  /** split "dev" (practice) or "test" (held out). The key stays in env: it is never stored, logged or returned. who is what
   *  the held-out split's daily limit counts against: the player, or the address when the server runs without sign-in. */
  create(id, player, split = "dev", who = null) {
    return this.#serial(async () => {
      if (await this.#session()) return { error: "bench " + id + " already exists" };
      const s = newSession(suiteOf(), id, player, Date.now(), { split, key: this.env.STARFARE_BENCH_KEY });
      if (s.error) return s;
      if (!PUBLIC_SPLITS.includes(split)) {
        const q = await hub(this.env).benchQuota("bench-test:" + (who || "unknown"), benchTestPerDay(this.env));
        if (!q.ok) return { error: "The held-out test split allows " + q.limit + " sessions a day per player, and yours are used. It opens again at 00:00 UTC. " +
          "start_bench with split dev (practice) still works." };
      }
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS trace (seq INTEGER PRIMARY KEY, at INTEGER, task INTEGER, tool TEXT, input TEXT, result TEXT)");
      await this.ctx.storage.put("session", s);
      await this.ctx.storage.setAlarm(Date.now() + BENCH_KEEP_MS);
      const dev = split === "dev";
      const out = {
        bench_id: id, simulated: true, practice: dev, suite: s.suite + (dev ? " (public dev split)" : " (held-out test split)"), tasks: s.tasks.length, budget: s.budget,
        note: "Starfare bench (simulated, " + (dev ? "practice" : "held-out test split") + "). Give the player the watch link: it shows every tool call you make, live. " +
          "Then call list_hails to open task 1 of " + s.tasks.length + ". Each task is one hail or one shared flight with its own run_id and a budget of " + s.budget +
          " tool calls, list_hails and take_hail included; sky time is paused, so no hail goes cold. A task ends when its ride arrives or its budget is used; " +
          "every result's bench field says which task you are on and how many calls are used.",
      };
      this.#log(null, "start_bench", { split }, out);
      return out;
    });
  }

  call(tool, input) {
    return this.#serial(async () => {
      const s = await this.#session();
      if (!s) return { error: "unknown bench session", bench: { done: true } };
      const r = await benchCall(await engine(), suiteOf(), s, tool, input, Date.now(), this.env.STARFARE_BENCH_KEY);
      await this.ctx.storage.put("session", r.session);
      this.#log(r.task, tool, input, r.result);
      if (r.session.done) this.#verifyLater();
      return r.result;
    });
  }

  end() {
    return this.#serial(async () => {
      const s = await this.#session();
      if (!s) return { error: "unknown bench session" };
      const r = endTask(await engine(), s);
      await this.ctx.storage.put("session", r.session);
      if (r.task != null) this.#log(r.task, END_TOOL, {}, r.result);
      if (r.session.done) this.#verifyLater();
      return r.result;
    });
  }

  /** BENCH_KEEP_MS after start_bench: a session never played to the end is deleted with its trace. Finished ones stay,
   *  so their watch pages and trace downloads keep working. */
  alarm() {
    return this.#serial(async () => {
      const s = await this.#session();
      if (!s || !s.done) await this.ctx.storage.deleteAll();
    });
  }

  #calls() {
    return this.ctx.storage.sql.exec("SELECT seq, at, task, tool, input FROM trace WHERE tool != 'start_bench' ORDER BY seq").toArray().map((r) => ({ ...r, input: JSON.parse(r.input) }));
  }

  #verifying = null;

  /** Once a session is done, its stored trace is replayed through the same reducer and the session keeps verified: true or
   *  false. Queued after the call that finished it, so the bot's answer does not wait; a view retries it after an eviction. */
  #verifyLater() {
    this.#verifying ??= this.#serial(async () => {
      const s = await this.#session();
      if (!s || !s.done || s.verified != null) return;
      let verified = false;
      try { verified = (await replayTrace(await engine(), suiteOf(), traceOf(suiteOf(), s, this.#calls()), this.env.STARFARE_BENCH_KEY)).verified; }
      catch (e) { console.error("bench verify", s.bench_id, e); }
      await this.ctx.storage.put("session", { ...s, verified });
    }).finally(() => { this.#verifying = null; });
    if (this.ctx.waitUntil) this.ctx.waitUntil(this.#verifying);
  }

  /** The page's view: the session and up to 50 trace rows after seq. null for an unknown bench_id. */
  async view(after) {
    const s = await this.#session();
    if (!s) return null;
    if (s.done && s.verified == null) this.#verifyLater();
    const rows = this.ctx.storage.sql.exec("SELECT seq, at, task, tool, input, result FROM trace WHERE seq > ? ORDER BY seq LIMIT ?", after, TRACE_PAGE).toArray();
    return { ...benchView(s), trace: rows.map((r) => ({ ...r, input: JSON.parse(r.input), result: JSON.parse(r.result) })) };
  }

  /** The finished session as a replayable file (bench/verify.mjs). Withheld while it plays, so a test session stays sealed. */
  async trace() {
    const s = await this.#session();
    if (!s) return null;
    if (!s.done) return { error: "The trace is published once every task in this session is played." };
    return traceOf(suiteOf(), s, this.#calls());
  }
}
