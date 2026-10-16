// The bench host: one task's run behind the same 11 tools a Grok bot sees. Every call counts against the suite's budget,
// session tools included; the run tools go through applyTool, the one reducer the live game uses.
// A hosted session (start_bench on the connector) plays a few tasks one after another; benchCall is its reducer and the
// StarfareBench Durable Object only stores what it returns. Worker-safe: bench/backend.mjs re-exports this for Node.
import { GameError, applyTool, hailInfo, isoJD, leaveRun, listHails, openRun, phaseOf, runFleet, spend } from "./game.js";
import { instanceFor, seedFor } from "./suite.js";

export const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const newRunId = () => "run_" + hex(10);

export const BENCH_NOTE =
  "\nBench mode (simulated): this session is one task. list_hails shows its one hail and its task_id. Sky time is paused for the whole task, " +
  "so no hail goes cold and you can take as long as you need; but every tool call counts against the task's budget, list_hails, take_hail, get_my_rides " +
  "and the forecasts included, and once the budget is used no more calls are answered. There is no ride history and no /board: the score goes to the bench results only.";

/** A run in planning for one attempt at a task. */
export const openTask = (E, suite, task, seed) => openRun(E, instanceFor(E, suite, task, seed), newRunId(), Date.now());

const SESSION_TOOLS = {
  list_hails(E, run) {
    const lead = listHails(E).find((h) => h.hail_id === run.id);
    return {
      task_id: run.tag,
      hails: [{ ...lead, ready: isoJD(run.t0), ...(run.hails ? { shared_flight: run.hails } : {}) }],
      fleet: runFleet(E, run),
      note: run.hails
        ? "One shared flight of " + run.hails.length + " bookings (simulated). take_hail with the first, " + run.id + ", to see them all."
        : "One hail (simulated). Take it with take_hail.",
    };
  },
  take_hail(E, run, input) {
    if (input.hail_id !== run.id) throw new GameError("this task's hail is " + run.id + "; take that one");
    return hailInfo(E, run, Date.now());
  },
  get_my_rides: () => ({ rides: [], note: "Bench mode: no ride history. Each task starts fresh." }),
};

export class BenchBackend {
  constructor(E, run) { this.E = E; this.run = run; this.over_budget = false; }

  async call(tool, input = {}) {
    if (this.run.budget != null && this.run.tool_calls >= this.run.budget) this.over_budget = true;
    if (Object.hasOwn(SESSION_TOOLS, tool)) {
      try { spend(this.run); return SESSION_TOOLS[tool](this.E, this.run, input); }
      catch (e) { if (e instanceof GameError) return { error: e.message }; throw e; }
    }
    if (input.run_id !== this.run.run_id) {
      try { spend(this.run); } catch (e) { return { error: e.message }; }
      return { error: "unknown run_id " + input.run_id + "; take_hail gives this task's run_id" };
    }
    const { run, result } = await applyTool(this.E, this.run, tool, input, { nowMs: Date.now() });
    if (run) this.run = run;
    return result;
  }

  /** Ends the attempt: a ride stopped at a checkpoint flies on with the default answers; a run still planning scores 0. */
  finish() {
    if (phaseOf(this.run) === "in_flight") {
      const from = this.run.ride.pending, run = structuredClone(this.run);
      leaveRun(this.E, run);
      run.score.note = "The task ended at checkpoint " + from + ", so the rest of this ride flew on the default answers.";
      this.run = run;
    }
    const phase = phaseOf(this.run), s = this.run.score;
    return {
      run: this.run,
      score: phase === "arrived" ? { phase, total: s.total, parts: Object.fromEntries(s.parts.map((p) => [p.key, p.got])) } : { phase, total: 0, parts: null },
      over_budget: this.over_budget,
    };
  }
}

export const BENCH_TASKS = 5;

/** A hosted session: n tasks drawn at random from the suite's public dev split, played in order. run is the open task's run
 *  (null until its first call); results holds one row per closed task, in task order. */
export function newSession(suite, benchId, player, nowMs, n = BENCH_TASKS) {
  const pool = [...suite.splits.dev], tasks = [];
  while (tasks.length < n && pool.length) tasks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return { bench_id: benchId, player, suite: suite.id, split: "dev", budget: suite.budget, tasks, i: 0, run: null, results: [], notice: null, started_ms: nowMs, done: false };
}

/** Scores the open task (a ride stopped at a checkpoint flies on with the defaults) and moves to the next. Changes s. */
function close(E, s, ended) {
  const task_id = s.tasks[s.i].id;
  let row = { task_id, phase: "not started", total: 0, parts: null, calls_used: 0 };
  if (s.run) {
    const f = new BenchBackend(E, s.run).finish();
    row = { task_id, phase: f.score.phase, total: f.score.total, parts: f.score.parts, calls_used: f.run.tool_calls, ...(f.run.score && f.run.score.note ? { note: f.run.score.note } : {}) };
  }
  s.results.push({ ...row, budget: s.budget, ended });
  s.i++;
  s.run = null;
  s.done = s.i >= s.tasks.length;
  return row;
}

const totalOf = (s) => s.results.reduce((a, r) => a + r.total, 0);

/** What a bot is told when a task closes: its score, then the next task or the session's results. */
function after(s, row, ended) {
  const n = s.tasks.length;
  return {
    ended: { why: ended, phase: row.phase, total: row.total },
    ...(s.done
      ? { done: true, results: s.results.map((r) => ({ task_id: r.task_id, phase: r.phase, total: r.total })), total: totalOf(s), out_of: 100 * n,
          note: "Bench over (simulated, practice). Tell the player their total and the watch link. Later calls play the normal game." }
      : { next: "Task " + (s.i + 1) + " of " + n + " is next. Call list_hails to open it; it has its own run_id." }),
  };
}

const why = (b) => (b.ended.why === "arrived" ? "the ride arrived" : b.ended.why === "budget" ? "its budget of tool calls is used" : b.ended.why);
const endText = (b) => " [Bench: task " + b.task + " ended (" + why(b) + "), scoring " + b.ended.total + ". " + (b.done ? "Bench over: total " + b.total + " of " + b.out_of + "." : b.next) + "]";

/** One tool call in a hosted session: { session, result, task }. The session passed in is never changed. The open task closes
 *  when its ride arrives or its budget is used; result.bench says where the session stands (also on an { error } result). */
export async function benchCall(E, suite, session, tool, input, nowMs) {
  const s = structuredClone(session);
  if (s.done) return { session: s, task: null, result: { error: "This bench session is over. start_bench starts a new one.", bench: { done: true } } };
  const k = s.i, t = s.tasks[k];
  if (!s.run) s.run = await openTask(E, suite, t, await seedFor(suite, s.split, t, 0));
  const b = new BenchBackend(E, s.run), result = await b.call(tool, input);
  s.run = b.run;
  const bench = { task: k + 1 + " of " + s.tasks.length, task_id: t.id, calls_used: s.run.tool_calls, budget: s.run.budget, ...(s.notice ? { notice: s.notice } : {}) };
  s.notice = null;
  const ended = phaseOf(s.run) === "arrived" ? "arrived" : s.run.tool_calls >= s.run.budget ? "budget" : null;
  if (ended) Object.assign(bench, after(s, close(E, s, ended), ended));
  const out = result && result.error ? { error: result.error + (bench.ended ? endText(bench) : ""), bench } : { ...result, bench };
  return { session: s, task: k, result: out };
}

/** The player ended the open task from the watch page. */
export function endTask(E, session) {
  const s = structuredClone(session);
  if (s.done) return { session: s, task: null, result: { error: "This bench session is over." } };
  const k = s.i, row = close(E, s, "ended on the watch page");
  if (!s.done) s.notice = "Task " + (k + 1) + " was ended on the watch page; this call is on task " + (s.i + 1) + " of " + s.tasks.length + ", with its own run_id from take_hail.";
  return { session: s, task: k, result: { task_id: row.task_id, phase: row.phase, total: row.total, ...(s.done ? { done: true, bench_total: totalOf(s) } : {}) } };
}

/** What the watch page shows: every task with its status and score, the open task's progress, and the total so far. */
export function benchView(s) {
  return {
    bench_id: s.bench_id, simulated: true, practice: true, suite: s.suite, split: s.split, budget: s.budget, started_ms: s.started_ms, done: s.done,
    tasks: s.tasks.map((t, k) => ({ task_id: t.id, hails: t.hails || [t.hail_id], status: k < s.i ? "done" : k === s.i && !s.done ? "current" : "waiting", ...(s.results[k] ? { result: s.results[k] } : {}) })),
    current: s.done ? null : { task: s.i + 1, task_id: s.tasks[s.i].id, title: s.run ? s.run.title : null, phase: s.run ? phaseOf(s.run) : "not opened", calls_used: s.run ? s.run.tool_calls : 0 },
    total: totalOf(s), out_of: 100 * s.tasks.length,
  };
}
