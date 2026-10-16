// The bench host: one task's run behind the same 11 tools a Grok bot sees. Every call counts against the suite's budget,
// session tools included; the run tools go through applyTool, the one reducer the live game uses.
// A hosted session (start_bench on the connector) plays a few tasks one after another; benchCall is its reducer and the
// StarfareBench Durable Object only stores what it returns. Worker-safe: bench/backend.mjs re-exports this for Node.
import { GameError, applyTool, hailInfo, isoJD, leaveRun, listHails, openRun, phaseOf, runFleet, spend } from "./game.js";
import { PUBLIC_SPLITS, instanceFor, seedFor } from "./suite.js";

export const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const newRunId = () => "run_" + hex(10);

export const BENCH_NOTE =
  "\nBench mode (simulated): this session is one task. list_hails shows its one hail and its task_id. Sky time is paused for the whole task, " +
  "so no hail goes cold and you can take as long as you need; but every tool call counts against the task's budget, list_hails, take_hail, get_my_rides " +
  "and the forecasts included, and once the budget is used no more calls are answered. There is no ride history and no /board: the score goes to the bench results only.";

/** A run in planning for one attempt at a task. */
export const openTask = (E, suite, task, seed, runId = newRunId()) => openRun(E, instanceFor(E, suite, task, seed), runId, Date.now());

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

export const BENCH_SPLITS = ["dev", "test"];

/** A hosted session: n tasks drawn at random from one split, played in order. dev is practice; test is the held-out split,
 *  whose worlds come from key (STARFARE_BENCH_KEY), so the server refuses it without one. Each task's run_id is drawn here so
 *  a replay opens the same runs. run is the open task's run (null until its first call); results holds one row per closed
 *  task, in task order. An { error } when the split cannot be played. */
export function newSession(suite, benchId, player, nowMs, { split = "dev", key, n = BENCH_TASKS } = {}) {
  const dev = " start_bench with split dev (practice) still works.";
  if (!BENCH_SPLITS.includes(split)) return { error: "split is dev (practice) or test (held out), not " + split + "." };
  if (!PUBLIC_SPLITS.includes(split) && !key) return { error: "The " + split + " split needs STARFARE_BENCH_KEY on this server, and it has none." + dev };
  const pool = [...((suite.splits && suite.splits[split]) || [])], tasks = [];
  if (!pool.length) return { error: "Suite " + suite.id + " has no " + split + " split yet." + dev };
  while (tasks.length < n && pool.length) tasks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return { bench_id: benchId, player, suite: suite.id, split, budget: suite.budget, tasks, run_ids: tasks.map(() => newRunId()), i: 0, run: null, results: [], notice: null, started_ms: nowMs, done: false };
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
const practice = (s) => PUBLIC_SPLITS.includes(s.split);
const kind = (s) => (practice(s) ? "practice" : "held-out test split");
/** On the test split no score, part, incident or hindsight leaves the server until the session is done, so an agent cannot
 *  learn the scorer from its own early tasks. Checkpoints still show what the live game shows: they are part of the task. */
const sealed = (s) => !practice(s) && !s.done;
export const SEALED_NOTE = "Held-out test task (simulated): the ride flew, and its outcome and score stay sealed until every task in this session is played.";

/** What a bot is told when a task closes: its score (unless sealed), then the next task or the session's results. */
function after(s, row, ended) {
  const n = s.tasks.length;
  return {
    ended: { why: ended, phase: row.phase, ...(sealed(s) ? {} : { total: row.total }) },
    ...(s.done
      ? { done: true, results: s.results.map((r) => ({ task_id: r.task_id, phase: r.phase, total: r.total })), total: totalOf(s), out_of: 100 * n,
          note: "Bench over (simulated, " + kind(s) + "). Tell the player their total and the watch link. Later calls play the normal game." }
      : { next: "Task " + (s.i + 1) + " of " + n + " is next. Call list_hails to open it; it has its own run_id." }),
  };
}

const why = (b) => (b.ended.why === "arrived" ? "the ride arrived" : b.ended.why === "budget" ? "its budget of tool calls is used" : b.ended.why);
const endText = (b) => " [Bench: task " + b.task + " ended (" + why(b) + ")" + (b.ended.total == null ? "" : ", scoring " + b.ended.total) + ". " +
  (b.done ? "Bench over: total " + b.total + " of " + b.out_of + "." : b.next) + "]";

/** One tool call in a hosted session: { session, result, task }. The session passed in is never changed. The open task closes
 *  when its ride arrives or its budget is used; result.bench says where the session stands (also on an { error } result).
 *  A sealed task's arrival says only that the ride flew. */
export async function benchCall(E, suite, session, tool, input, nowMs, key) {
  const s = structuredClone(session);
  if (s.done) return { session: s, task: null, result: { error: "This bench session is over. start_bench starts a new one.", bench: { done: true } } };
  const k = s.i, t = s.tasks[k];
  if (!s.run) s.run = await openTask(E, suite, t, await seedFor(suite, s.split, t, 0, key), s.run_ids[k]);
  const b = new BenchBackend(E, s.run), result = await b.call(tool, input);
  s.run = b.run;
  const bench = { task: k + 1 + " of " + s.tasks.length, task_id: t.id, calls_used: s.run.tool_calls, budget: s.run.budget, ...(s.notice ? { notice: s.notice } : {}) };
  s.notice = null;
  const ended = phaseOf(s.run) === "arrived" ? "arrived" : s.run.tool_calls >= s.run.budget ? "budget" : null;
  if (ended) Object.assign(bench, after(s, close(E, s, ended), ended));
  const out = result && result.error ? { error: result.error + (bench.ended ? endText(bench) : ""), bench }
    : ended === "arrived" && sealed(s) ? { ok: true, status: "flown", run_id: result.run_id, hail_id: result.hail_id, note: SEALED_NOTE, bench }
    : { ...result, bench };
  return { session: s, task: k, result: out };
}

export const END_TOOL = "end task (watch page)";

/** The player ended the open task from the watch page. */
export function endTask(E, session) {
  const s = structuredClone(session);
  if (s.done) return { session: s, task: null, result: { error: "This bench session is over." } };
  const k = s.i, row = close(E, s, "ended on the watch page");
  if (!s.done) s.notice = "Task " + (k + 1) + " was ended on the watch page; this call is on task " + (s.i + 1) + " of " + s.tasks.length + ", with its own run_id from take_hail.";
  return { session: s, task: k, result: { task_id: row.task_id, phase: row.phase, ...(sealed(s) ? {} : { total: row.total }), ...(s.done ? { done: true, bench_total: totalOf(s) } : {}) } };
}

/** What the watch page shows: every task with its status and score, the open task's progress, and the total so far.
 *  While a test session is sealed, no task's score and no total. */
export function benchView(s) {
  const shut = sealed(s);
  return {
    bench_id: s.bench_id, simulated: true, practice: practice(s), sealed: shut, suite: s.suite, split: s.split, budget: s.budget, started_ms: s.started_ms, done: s.done,
    tasks: s.tasks.map((t, k) => ({ task_id: t.id, hails: t.hails || [t.hail_id], status: k < s.i ? "done" : k === s.i && !s.done ? "current" : "waiting", ...(s.results[k] && !shut ? { result: s.results[k] } : {}) })),
    current: s.done ? null : { task: s.i + 1, task_id: s.tasks[s.i].id, title: s.run ? s.run.title : null, phase: s.run ? phaseOf(s.run) : "not opened", calls_used: s.run ? s.run.tool_calls : 0 },
    total: shut ? null : totalOf(s), out_of: 100 * s.tasks.length, verified: s.verified ?? null,
  };
}

export const TRACE_FORMAT = "starfare.bench-trace/1";

/** A finished session as a file anyone can replay: how it started (tasks and run_ids, not the player), every call in order
 *  ({ seq, at, task, tool, input }, the End button as END_TOOL), and the results it stored. */
export function traceOf(suite, s, calls) {
  const { bench_id, split, budget, tasks, run_ids, started_ms } = s;
  return {
    format: TRACE_FORMAT, simulated: true, bench_id, suite: suite.id, engine_sha256: suite.engine_sha256, score_version: suite.score_version, split,
    start: { bench_id, suite: s.suite, split, budget, tasks, run_ids, started_ms }, results: s.results, total: totalOf(s), out_of: 100 * s.tasks.length,
    verified: s.verified ?? null, calls,
  };
}

/** Plays a trace's calls again through benchCall and endTask, the reducer that played them, and compares every task's stored
 *  result with the replayed one, byte for byte as JSON. The tasks and budget must be the suite's own, or a trace could bring its
 *  own easy tasks. A test split's trace needs the key its worlds came from. */
export async function replayTrace(E, suite, trace, key) {
  const split = (suite.splits && suite.splits[trace.start.split]) || [], own = new Set(split.map((t) => JSON.stringify(t)));
  const suite_tasks = trace.start.budget === suite.budget && trace.start.tasks.every((t) => own.has(JSON.stringify(t)));
  let s = { ...trace.start, player: null, i: 0, run: null, results: [], notice: null, done: false };
  for (const c of trace.calls) s = (c.tool === END_TOOL ? endTask(E, s) : await benchCall(E, suite, s, c.tool, c.input, 0, key)).session;
  const tasks = trace.results.map((r, k) => ({ task_id: r.task_id, stored: r.total, replayed: s.results[k] ? s.results[k].total : null, same: JSON.stringify(r) === JSON.stringify(s.results[k]) }));
  return { verified: suite_tasks && s.done && s.results.length === trace.results.length && tasks.every((t) => t.same), suite_tasks, tasks };
}
