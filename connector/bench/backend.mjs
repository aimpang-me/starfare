// The bench host: one task's run behind the same 11 tools a Grok bot sees. Every call counts against the suite's budget,
// session tools included; the run tools go through applyTool, the one reducer the live game uses.
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { GameError, applyTool, hailInfo, isoJD, leaveRun, listHails, openRun, phaseOf, runFleet, spend } from "../src/game.js";
import { instanceFor, loadSuite } from "../src/suite.js";

export const loadEngine = () => createRequire(import.meta.url)("../src/engine/sol-page.cjs");
export const newRunId = () => "run_" + randomBytes(10).toString("hex");
export const readSuite = (path) => loadSuite(readFileSync(path, "utf8"));

/** --name value pairs from argv; a flag with no value is true. */
export function flags(argv, known) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)$/.exec(argv[i]);
    if (!m || !known.includes(m[1])) throw new Error("unknown argument " + argv[i] + "; known: " + known.map((k) => "--" + k).join(" "));
    o[m[1]] = argv[i + 1] != null && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return o;
}

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
