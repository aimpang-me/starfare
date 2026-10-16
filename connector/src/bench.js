// StarfareBench: one per hosted bench session (bench_id). Holds the session (bench-host.js) and a trace of every tool call,
// which the watch page at /bench/<bench_id> polls. Calls run one at a time, so the page's End button never lands mid-call.
import { DurableObject } from "cloudflare:workers";
import { benchCall, benchView, endTask, newSession } from "./bench-host.js";
import { engine } from "./engine.js";
import { loadSuite } from "./suite.js";
import V1 from "./suites/v1.json" with { type: "json" };

export const BENCH_ID = /^b_[0-9a-f]{20}$/;
export const benchStub = (env, id) => env.STARFARE_BENCH.get(env.STARFARE_BENCH.idFromName(id));

let suite = null;
const suiteOf = () => (suite ??= loadSuite(V1));

const RESULT_MAX = 64 * 1024, TRACE_PAGE = 50;

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

  /** split "dev" (practice) or "test" (held out). The key stays in env: it is never stored, logged or returned. */
  create(id, player, split = "dev") {
    return this.#serial(async () => {
      if (await this.#session()) return { error: "bench " + id + " already exists" };
      const s = newSession(suiteOf(), id, player, Date.now(), { split, key: this.env.STARFARE_BENCH_KEY });
      if (s.error) return s;
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS trace (seq INTEGER PRIMARY KEY, at INTEGER, task INTEGER, tool TEXT, input TEXT, result TEXT)");
      await this.ctx.storage.put("session", s);
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
      return r.result;
    });
  }

  end() {
    return this.#serial(async () => {
      const s = await this.#session();
      if (!s) return { error: "unknown bench session" };
      const r = endTask(await engine(), s);
      await this.ctx.storage.put("session", r.session);
      if (r.task != null) this.#log(r.task, "end task (watch page)", {}, r.result);
      return r.result;
    });
  }

  /** The page's view: the session and up to 50 trace rows after seq. null for an unknown bench_id. */
  async view(after) {
    const s = await this.#session();
    if (!s) return null;
    const rows = this.ctx.storage.sql.exec("SELECT seq, at, task, tool, input, result FROM trace WHERE seq > ? ORDER BY seq LIMIT ?", after, TRACE_PAGE).toArray();
    return { ...benchView(s), trace: rows.map((r) => ({ ...r, input: JSON.parse(r.input), result: JSON.parse(r.result) })) };
  }
}
