import { pathToFileURL } from "node:url";
import { z } from "zod";
import { engine } from "./src/engine.js";
import {
  applyTool,
  suiteInstance,
  openRun,
  listHails,
  fleet,
  hailInfo,
  rideRecord,
  rideSummary,
  rideStats,
  phaseOf,
  SCORE_VERSION,
  SKY,
} from "./src/game.js";
import { TOOLS } from "./src/tools.js";

export const POLICY_NAMES = Object.freeze(["naive", "careful", "random", "bad"]);

const SIMULATED_SKILL = Object.freeze({
  weak: Object.freeze({ noise: 0.5, lookDepth: 0 }),
  mid: Object.freeze({ noise: 0.25, lookDepth: 1 }),
  strong: Object.freeze({ noise: 0.1, lookDepth: 2 }),
  top: Object.freeze({ noise: 0, lookDepth: 3 }),
});

const DEFAULT_SEEDS = Object.freeze(["1", "2", "3", "4"]);

const REPORT_LABEL =
  "Simulated. Report label, not an engine status: arrived is landed; abandoned, and any run that does not arrive, is stranded. " +
  "The hazard seed is the string on the run, not a live sky season, and sky time is frozen. ";

const PARTS = Object.freeze([
  Object.freeze({ key: "pickup", max: 20 }),
  Object.freeze({ key: "on_time", max: 20 }),
  Object.freeze({ key: "energy", max: 20 }),
  Object.freeze({ key: "promise", max: 15 }),
  Object.freeze({ key: "checker", max: 10 }),
  Object.freeze({ key: "fare", max: 10 }),
  Object.freeze({ key: "economy", max: 5 }),
]);

const PUBLISHED_V2_PARTS = Object.freeze([
  Object.freeze({ key: "pickup", unit: "min" }),
  Object.freeze({ key: "on_time", unit: "min" }),
  Object.freeze({ key: "energy", unit: "kWh" }),
  Object.freeze({ key: "promise", unit: "min" }),
  Object.freeze({ key: "checker", unit: "legs" }),
  Object.freeze({ key: "fare", unit: "USD" }),
  Object.freeze({ key: "economy", unit: "plans" }),
  Object.freeze({ key: "tank", unit: "kg" }),
  Object.freeze({ key: "throttle", unit: "kWh" }),
  Object.freeze({ key: "window", unit: "kWh" }),
  Object.freeze({ key: "recovery", unit: "kWh" }),
  Object.freeze({ key: "dose", unit: "mSv" }),
]);

const LEAD_COLUMNS = Object.freeze([
  "policy", "seed", "hail_id", "phase", "terminal", "total", "plans", "checkpoints", "errors",
]);

const CAREFUL_HOT_ODDS = 0.5;
const CAREFUL_MAX_WAIT_DAYS = 3;
const CAREFUL_PATIENCE_HOURS = 4;
const RANDOM_ASK_MAX = 4;
const BAD_DECOYS = 2;
const BAD_DIVERT_WAIT_HOURS = 24;
const MAX_DECIDES = 8;

const LOOKS = Object.freeze({
  naive: Object.freeze([]),
  careful: Object.freeze([
    Object.freeze({ kind: "weather", at: "pickup" }),
    Object.freeze({ kind: "pad", at: "pickup" }),
    Object.freeze({ kind: "pad", at: "destination" }),
  ]),
  random: Object.freeze([]),
  bad: Object.freeze([]),
});

const COPY_SCAN = /\b(?:car|tesla|roadster)\b/i;

export class SimCheckError extends Error {
  constructor(message, report = null) {
    super(message);
    this.name = "SimCheckError";
    this.report = report;
  }
}

export async function simulate(spec = {}) {
  const E = await engine();
  const catalogIds = catalogOf(E).map((hail) => hail.hail_id);
  const clockJd = spec.clockJd == null ? SKY.jd0 + 1 : spec.clockJd;
  const nowMs = spec.nowMs == null ? SKY.t0_ms : spec.nowMs;
  const resolved = resolveSpec({ ...spec, clockJd, nowMs }, catalogIds);
  if (!keysMatch(POLICIES, POLICY_NAMES) || !keysMatch(LOOKS, POLICY_NAMES)) {
    throw new SimCheckError("policy table drifted");
  }
  const env = {
    E,
    nowMs: resolved.nowMs,
    clockJd: resolved.clockJd,
    noise: resolved.noise,
    lookDepth: resolved.lookDepth,
  };
  const trials = [];
  for (const policy of resolved.policies) {
    for (const seed of resolved.seeds) {
      for (const hailId of resolved.hails) {
        const cell = { policy, seed, hailId };
        const first = await playTrial(env, cell);
        const second = await playTrial(env, cell);
        if (JSON.stringify(first) !== JSON.stringify(second)) {
          throw new SimCheckError(`Simulated check failed. Nondeterministic cell ${policy} ${seed} ${hailId}.`);
        }
        checkTrial(first);
        trials.push(first);
      }
    }
  }
  if (trials.every((trial) => !trial.audit.opened)) throw new SimCheckError("the clock cannot host a ride");
  const rows = trials.map((trial) => trial.row);
  const means = resolved.policies.map((policy) => tally(rows, policy));
  let finding = null;
  if (resolved.policies.includes("naive") && resolved.policies.includes("careful")) {
    const careful = tally(rows, "careful").mean;
    const naive = tally(rows, "naive").mean;
    if (careful != null && naive != null && careful < naive) {
      finding = {
        careful,
        naive,
        text: `Finding: careful landed mean ${careful.toFixed(2)} is below naive landed mean ${naive.toFixed(2)}.`,
      };
    }
  }
  const report = {
    simulated: true,
    header: "",
    clockJd: resolved.clockJd,
    seeds: resolved.seeds,
    hails: resolved.hails,
    policies: resolved.policies,
    skill: resolved.skill,
    noise: resolved.noise,
    lookDepth: resolved.lookDepth,
    outOf: sharedOutOf(rows) ?? engineOutOf(E),
    scoreVersion: SCORE_VERSION,
    rows,
    means,
    finding,
  };
  report.header = headerFor(report);
  checkReport(report, formatReport(report));
  return report;
}

function engineOutOf(E) {
  const total = E && E.R && E.R.SCORE_TOTAL;
  return typeof total === "number" && total > 0 ? total : 100;
}

function headerFor(report) {
  const v2 = report.scoreVersion === 2 || report.rows.some((row) => row.parts && (row.outOf !== 100 || row.parts.some((part) => part.unit)));
  if (v2) {
    return REPORT_LABEL + "Score parts keep the engine units. The total is the sum of the part scores, out of the engine out_of.";
  }
  return REPORT_LABEL + "Part scores are rounded to 0.1 after the total is rounded, so printed parts need not sum to the total.";
}

function skillLine(report) {
  return `Skills: tier ${report.skill}, noise ${report.noise}, look depth ${report.lookDepth}. Simulated assumptions, not real model benchmark numbers.`;
}

function sharedOutOf(rows) {
  let outOf = null;
  for (const row of rows) {
    if (row.outOf == null) continue;
    if (outOf == null) outOf = row.outOf;
    else if (outOf !== row.outOf) throw new SimCheckError("Simulated report check failed. out_of differs across rides.");
  }
  return outOf;
}

function partColumns(report) {
  const landed = report.rows.find((row) => row.parts);
  if (landed) return landed.parts.map((part) => ({ key: part.key, unit: part.unit || null }));
  if (report.scoreVersion === 2) return PUBLISHED_V2_PARTS.map((part) => ({ key: part.key, unit: part.unit }));
  return PARTS.map((part) => ({ key: part.key, unit: null }));
}

function partLabel(part) {
  return part.unit ? `${part.key} (${part.unit})` : part.key;
}

export function formatReport(report) {
  const columns = partColumns(report);
  const headers = [...LEAD_COLUMNS, ...columns.map(partLabel)];
  const lines = [report.header, skillLine(report)];
  if (report.outOf != null) lines.push(`Score out of ${report.outOf}.`);
  lines.push(headers.join("\t"));
  for (const row of report.rows) {
    const parts = row.parts ? row.parts.map((part) => String(part.got)) : columns.map(() => "");
    lines.push([
      row.policy,
      row.seed,
      row.hailId,
      row.enginePhase,
      row.terminal,
      row.total == null ? "" : String(row.total),
      String(row.plansUsed),
      String(row.checkpointsHit),
      String(row.toolErrors),
      ...parts,
    ].join("\t"));
  }
  for (const mean of report.means) {
    lines.push(meanLine(mean));
  }
  if (report.finding) lines.push(report.finding.text);
  return lines.join("\n") + "\n";
}

function keysMatch(record, names) {
  const keys = Object.keys(record);
  return keys.length === names.length && names.every((name, index) => keys[index] === name);
}

function resolveSpec(spec, catalogIds) {
  const policies = spec.policies == null ? [...POLICY_NAMES] : namesOf(spec.policies, "policies");
  if (policies.length === 0) throw new SimCheckError("policies is empty");
  for (const policy of policies) {
    if (!POLICY_NAMES.includes(policy)) throw new SimCheckError("unknown policy");
  }
  const seeds = spec.seeds == null ? [...DEFAULT_SEEDS] : namesOf(spec.seeds, "seeds");
  if (seeds.length === 0) throw new SimCheckError("seeds is empty");
  for (const seed of seeds) {
    if (typeof seed !== "string") throw new SimCheckError("a seed must be a string of digits");
    if (/^k1:/.test(seed)) throw new SimCheckError("refusing a bench-shaped seed");
    if (!/^\d{1,6}$/.test(seed)) throw new SimCheckError("a seed must be a string of digits, length 1 to 6");
  }
  const hails = spec.hails == null ? [...catalogIds] : namesOf(spec.hails, "hails");
  if (hails.length === 0) throw new SimCheckError("hails is empty");
  for (const hailId of hails) {
    if (!catalogIds.includes(hailId)) throw new SimCheckError("unknown hail");
  }
  if (typeof spec.clockJd !== "number" || !Number.isFinite(spec.clockJd)) throw new SimCheckError("clockJd must be a number");
  if (typeof spec.nowMs !== "number" || !Number.isFinite(spec.nowMs)) throw new SimCheckError("nowMs must be a number");
  const skill = spec.skill == null || spec.skill === "" ? "top" : String(spec.skill).trim();
  if (!Object.hasOwn(SIMULATED_SKILL, skill)) throw new SimCheckError("unknown skill");
  const tier = SIMULATED_SKILL[skill];
  let noise = tier.noise;
  if (spec.noise != null && spec.noise !== "") {
    noise = typeof spec.noise === "number" ? spec.noise : Number(spec.noise);
    if (!Number.isFinite(noise) || noise < 0 || noise > 1) throw new SimCheckError("noise must be a number from 0 to 1");
  }
  return {
    policies,
    seeds,
    hails,
    clockJd: spec.clockJd,
    nowMs: spec.nowMs,
    skill,
    noise,
    lookDepth: tier.lookDepth,
  };
}

function namesOf(value, label) {
  if (!Array.isArray(value)) throw new SimCheckError(`${label} must be a list`);
  return value.map((item) => (typeof item === "string" ? item.trim() : item));
}

function rngOf(s) {
  let a = 2166136261;
  for (const ch of String(s)) a = Math.imul(a ^ ch.charCodeAt(0), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runIdFor(cell) {
  const text = cell.policy + "\0" + cell.seed + "\0" + cell.hailId;
  let state = 2166136261;
  for (const ch of text) state = Math.imul(state ^ ch.charCodeAt(0), 16777619);
  let hex = "";
  while (hex.length < 20) {
    const unsigned = state >>> 0;
    hex += unsigned.toString(16).padStart(8, "0");
    state = Math.imul(unsigned ^ (unsigned & 0xff), 16777619);
  }
  const id = "run_" + hex.slice(0, 20);
  if (!/^run_[0-9a-f]{20}$/.test(id)) throw new SimCheckError("Simulated run id is not valid.");
  return id;
}

function terminalClass(phase) {
  if (phase === "arrived") return "landed";
  if (phase === "planning" || phase === "in_flight" || phase === "abandoned") return "stranded";
  throw new SimCheckError("Simulated trial check failed. The phase is unknown.");
}

function legalShips(hail) {
  return hail.fleet.filter((ship) => ship.parkedAt !== hail.from);
}

function firstShip(hail) {
  return legalShips(hail)[0];
}

function quoteOf(kind, ride, pickup) {
  if (kind === "ride") return { quoted_fare_usd: ride.fareUsd, quoted_arrival: ride.arrive };
  if (kind === "pickup") {
    const quoted = {};
    if (Math.abs(pickup.fareUsd - ride.fareUsd) > 1) quoted.quoted_fare_usd = pickup.fareUsd;
    return quoted;
  }
  throw new SimCheckError("Simulated quote is not a known kind.");
}

function tally(rows, policy) {
  const mine = rows.filter((row) => row.policy === policy);
  const landedRows = mine.filter((row) => row.total != null);
  const landed = landedRows.length;
  const stranded = mine.length - landed;
  const mean = landed === 0 ? null : Math.round((landedRows.reduce((sum, row) => sum + row.total, 0) / landed) * 100) / 100;
  return { policy, mean, landed, stranded, rides: mine.length };
}

function meanLine(mean) {
  const shown = mean.mean == null ? "none" : mean.mean.toFixed(2);
  return `${mean.policy} landed mean ${shown} over ${mean.landed} landed, ${mean.stranded} stranded`;
}

function catalogOf(E) {
  return listHails(E);
}

function askHoursOk(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 24;
}

function knownKind(call, kinds) {
  if (!kinds.includes(call.kind)) throw new Error("unknown kind");
}

async function playTrial(env, cell) {
  const session = {
    E: env.E,
    nowMs: env.nowMs,
    clockJd: env.clockJd,
    run: null,
    trace: [],
    toolErrors: 0,
    cell,
    forecastsFree: true,
    sentDepartAfter: false,
    askAfterHours: null,
    quote: null,
    answers: [],
    lookTools: [],
    opened: false,
  };
  const rng = rngOf([cell.policy, cell.seed, cell.hailId].join("\0"));
  const policy = POLICIES[cell.policy];
  let score = null;

  const listed = await callTool(session, "list_hails", {});
  knownKind(listed, ["list"]);
  if (!listed.listed.includes(cell.hailId)) throw new SimCheckError("unknown hail");

  const taken = await callTool(session, "take_hail", { hailId: cell.hailId });
  if (taken.kind === "error") return finishTrial(session, score);
  knownKind(taken, ["hail"]);

  const planning = await callTool(session, "get_my_rides", {});
  knownKind(planning, ["history"]);
  const hail = taken.hail;
  if (legalShips(hail).length === 0) return finishTrial(session, score);

  const forecasts = [];
  const looks = policy.looks.slice(0, env.lookDepth);
  session.lookTools = looks.map((look) => (look.kind === "weather" ? "space_weather" : "check_pad"));
  for (const look of looks) {
    const place = look.at === "pickup" ? hail.from : hail.to;
    const got = await callTool(session, "forecast", { kind: look.kind, at: look.at, place });
    if (got.kind === "error") continue;
    knownKind(got, ["forecast"]);
    if (got.forecast.days.length > 0 && got.forecast.start !== hail.riderReady) {
      throw new SimCheckError("Simulated forecast check failed. The forecast start does not match the rider ready time.");
    }
    forecasts.push(got.forecast);
  }

  const plan = applyNoise(policy.plan(hail, forecasts, rng), hail, rng, env.noise);
  if (!askHoursOk(plan.askAfterHours)) throw new SimCheckError("askAfterHours must be a number from 0 to 24");

  const pair = plan.comparePickups
    ? await bestPickup(session, hail, plan, rng, env.noise)
    : await onePair(session, hail, plan);
  if (pair) score = await flyPlan(session, policy, rng, plan, pair.pickup, pair.ride, env.noise);
  return finishTrial(session, score);
}

async function finishTrial(session, score) {
  const history = await callTool(session, "get_my_rides", {});
  knownKind(history, ["history"]);
  return trialOf(session, history, score);
}

async function flyPlan(session, policy, rng, plan, pickup, ride, noise) {
  let step = await callTool(session, "dispatch", {
    quote: plan.quote,
    pickup,
    ride,
    askAfterHours: plan.askAfterHours,
  });
  let score = step.kind === "arrived" ? step.score : null;
  knownKind(step, ["launch", "pad", "arrived", "error", "problems"]);
  let decides = 0;
  while ((step.kind === "launch" || step.kind === "pad") && decides < MAX_DECIDES) {
    let choice;
    if (step.kind === "launch") choice = applyLaunchNoise(policy.onLaunch(step.launch, rng), rng, noise);
    else if (step.kind === "pad") choice = applyPadNoise(policy.onPad(step.pad, rng), step.pad, rng, noise);
    else throw new Error("unknown kind");
    const cpKind = step.kind === "launch" ? "launch_hold" : "pad_closed";
    const checkpoint = step.checkpointN;
    const fallback = step.defaultAction;
    session.answers.push({ kind: cpKind, action: choice.action });
    decides += 1;
    step = await callTool(session, "decide", { checkpoint, choice });
    if (step.kind === "arrived") score = step.score;
    if (step.kind === "error") {
      if (fallback !== "wait" && fallback !== "hold") throw new Error("unknown kind");
      session.answers.push({ kind: cpKind, action: fallback });
      decides += 1;
      step = await callTool(session, "decide", { checkpoint, choice: { action: fallback } });
      if (step.kind === "arrived") score = step.score;
      if (step.kind === "error") break;
    }
    knownKind(step, ["launch", "pad", "arrived", "error", "problems"]);
  }
  return score;
}

function trialOf(session, last, score) {
  const enginePhase = last.enginePhase;
  const terminal = terminalClass(enginePhase);
  const landed = enginePhase === "arrived";
  if (landed) {
    if (!score) throw new SimCheckError("Simulated trial check failed. The ride arrived without a score.");
    if (last.checkpointsHit !== score.checkpoints) {
      throw new SimCheckError("Simulated trial check failed. The checkpoint count does not match the score.");
    }
  }
  return {
    row: {
      policy: session.cell.policy,
      seed: session.cell.seed,
      hailId: session.cell.hailId,
      enginePhase,
      terminal,
      total: landed ? score.total : null,
      outOf: landed ? score.outOf : null,
      parts: landed ? score.parts.map((part) => ({ key: part.key, max: part.max, got: part.got, unit: part.unit })) : null,
      plansUsed: last.plansUsed,
      checkpointsHit: last.checkpointsHit,
      toolErrors: session.toolErrors,
    },
    audit: {
      opened: session.opened,
      askAfterHours: session.askAfterHours,
      quote: session.quote,
      forecastsFree: session.forecastsFree,
      sentDepartAfter: session.sentDepartAfter,
      answers: session.answers.map((answer) => ({ kind: answer.kind, action: answer.action })),
      lookTools: session.lookTools.slice(),
      trace: session.trace.slice(),
      recordSimulated: last.recordSimulated,
      recordTotal: last.recordTotal,
      recordGots: last.recordGots ? last.recordGots.slice() : null,
    },
  };
}

function snapshot(session) {
  const run = session.run;
  if (!run) return { enginePhase: "planning", plansUsed: 0, checkpointsHit: 0 };
  const enginePhase = phaseOf(run);
  let checkpointsHit = 0;
  if (enginePhase === "arrived" && run.score) checkpointsHit = run.score.checkpoints;
  else if (enginePhase === "in_flight" && run.ride && run.ride.checkpoints) checkpointsHit = run.ride.checkpoints.length;
  return { enginePhase, plansUsed: run.calls, checkpointsHit };
}

async function callTool(session, name, input) {
  function buildWire() {
    const runId = session.run ? session.run.run_id : undefined;
    if (name === "list_hails") return { name: "list_hails", input: {} };
    if (name === "take_hail") return { name: "take_hail", input: { hail_id: input.hailId } };
    if (name === "get_my_rides") {
      return { name: "get_my_rides", input: runId ? { run_id: runId, include: "all" } : {} };
    }
    if (name === "forecast") {
      const tool = input.kind === "weather" ? "space_weather" : input.kind === "pad" ? "check_pad" : null;
      if (!tool) throw new SimCheckError("Simulated look is not a forecast.");
      return { name: tool, input: { run_id: runId, place: input.place }, kind: input.kind, at: input.at };
    }
    if (name === "plan_pickup") {
      return {
        name: "plan_pickup",
        input: {
          run_id: runId,
          car: input.ship,
          objective: input.objective,
          wait_days: input.waitDays,
        },
      };
    }
    if (name === "plan_ride") {
      return {
        name: "plan_ride",
        input: { run_id: runId, after_leg: input.afterLeg, objective: input.objective },
      };
    }
    if (name === "dispatch") {
      return {
        name: "dispatch",
        input: {
          run_id: runId,
          pickup_leg: input.pickup.legId,
          ride_leg: input.ride.legId,
          ask_after_hours: input.askAfterHours,
          ...quoteOf(input.quote, input.ride, input.pickup),
        },
      };
    }
    if (name === "decide") {
      const choice = input.choice;
      const body = { run_id: runId, checkpoint: input.checkpoint, action: choice.action };
      if (choice.action === "hold" && choice.hours != null) body.hours = choice.hours;
      if (choice.action === "replan") body.objective = choice.objective;
      if (choice.action === "divert") {
        body.place = choice.place;
        body.wait_hours = choice.waitHours;
      }
      return { name: "decide", input: body };
    }
    throw new SimCheckError("Simulated tool name is unknown.");
  }

  const wire = buildWire();
  session.trace.push(wire.name);
  let parsed;
  try {
    parsed = z.object(TOOLS[wire.name].inputSchema).parse(wire.input);
  } catch {
    throw new SimCheckError("Simulated tool input failed to parse.");
  }
  if (wire.name === "dispatch") {
    session.quote = input.quote;
    session.askAfterHours = input.askAfterHours;
  }
  if (wire.name === "decide" && Object.hasOwn(parsed, "depart_after")) session.sentDepartAfter = true;

  if (wire.name === "list_hails") {
    fleet(session.E);
    return { kind: "list", listed: listHails(session.E).map((hail) => hail.hail_id), ...snapshot(session) };
  }
  if (wire.name === "take_hail") {
    const opened = await openTaken(session, parsed);
    if (opened.failed) return { kind: "error", error: "take failed", ...snapshot(session) };
    const info = opened.info;
    return {
      kind: "hail",
      hail: {
        runId: info.run_id,
        hailId: info.hail_id,
        from: info.pickup_at.id,
        to: info.destination.id,
        riderReady: info.rider_ready,
        arriveBy: info.arrive_by,
        fleet: info.fleet.map((row) => {
          const ship = {
            id: row.car,
            name: row.name,
            parkedAt: row.parked_at.id,
            busyUntil: row.busy_until,
          };
          if (typeof row.xenon_kg === "number") ship.xenonKg = row.xenon_kg;
          return ship;
        }),
      },
      ...snapshot(session),
    };
  }
  if (wire.name === "get_my_rides") return historyCall(session);

  const forecast = wire.name === "space_weather" || wire.name === "check_pad";
  const callsBefore = session.run ? session.run.calls : 0;
  let out;
  try {
    out = await applyTool(session.E, session.run, wire.name, parsed, { nowMs: session.nowMs });
  } catch (err) {
    if (err instanceof SimCheckError) throw err;
    session.toolErrors += 1;
    return { kind: "error", error: "tool failed", ...snapshot(session) };
  }
  if (out.run) session.run = out.run;
  if (forecast && session.run && session.run.calls !== callsBefore) session.forecastsFree = false;
  return domainOf(session, wire, out.result);
}

async function openTaken(session, parsed) {
  try {
    const inst = suiteInstance(session.E, { hail_id: parsed.hail_id }, {
      seed: session.cell.seed,
      clockJd: session.clockJd,
      tag: null,
      budget: null,
    });
    const run = await openRun(session.E, inst, runIdFor(session.cell), session.nowMs);
    session.run = run;
    session.opened = true;
    return { info: hailInfo(session.E, run, session.nowMs) };
  } catch (err) {
    if (err instanceof SimCheckError) throw err;
    session.run = null;
    session.opened = false;
    session.toolErrors += 1;
    return { failed: true };
  }
}

function historyCall(session) {
  if (!session.run) {
    return { kind: "history", recordSimulated: null, recordTotal: null, recordGots: null, ...snapshot(session) };
  }
  const summary = rideSummary(session.E, session.run);
  const record = rideRecord(session.E, session.run);
  if (summary.phase === "arrived") rideStats([summary]);
  if (record.simulated !== true) throw new SimCheckError("Simulated record missing.");
  const score = record.score;
  return {
    kind: "history",
    recordSimulated: record.simulated,
    recordTotal: score ? score.total : null,
    recordGots: score ? score.parts.map((part) => part.got) : null,
    ...snapshot(session),
  };
}

function domainOf(session, wire, result) {
  if (result && result.error) {
    session.toolErrors += 1;
    return { kind: "error", error: "tool failed", ...snapshot(session) };
  }
  if (wire.name === "space_weather" || wire.name === "check_pad") {
    return { kind: "forecast", forecast: forecastOf(wire.kind, wire.at, result), ...snapshot(session) };
  }
  if (wire.name === "plan_pickup" || wire.name === "plan_ride") {
    return { kind: "leg", leg: legOf(result), ...snapshot(session) };
  }
  if (result && result.problems) return { kind: "problems", ...snapshot(session) };
  if (result && result.status === "checkpoint") return checkpointOf(session, result);
  if (result && result.status === "arrived") {
    return { kind: "arrived", score: scoreOf(result), ...snapshot(session) };
  }
  throw new Error("unknown kind");
}

function forecastOf(kind, at, result) {
  const days = kind === "weather"
    ? (result.days || []).map((day) => dayView(day, day.flare_odds))
    : (result.local_weather ? result.local_weather.days.map((day) => dayView(day, day.odds)) : []);
  return { kind, at, start: days.length ? result.from : null, days };
}

function dayView(day, odds) {
  return { from: day.from, to: day.to, odds };
}

function minuteOf(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(String(text || ""));
  if (!match) return null;
  const minute = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]) / 60000;
  return Number.isFinite(minute) ? minute : null;
}

function dayCovers(day, at) {
  const from = minuteOf(day.from);
  if (from == null) return false;
  const to = minuteOf(day.to);
  const end = to == null ? from + 1440 : to;
  return at >= from && at < end;
}

function legOf(result) {
  const refly = result.refly || {};
  const gate = refly.result === "PASS" ? "PASS" : refly.result === "FAIL" ? "FAIL" : "local";
  const xenonKg = typeof result.xenon_kg === "number" ? result.xenon_kg : null;
  return {
    legId: result.leg_id,
    role: result.kind === "ride" ? "ride" : "pickup",
    fareUsd: result.fare_usd,
    arrive: result.arrive,
    gate,
    plansUsed: result.plans_used,
    xenonKg,
  };
}

function scoreOf(result) {
  if (result.out_of == null) throw new SimCheckError("Simulated score is missing out_of.");
  return {
    total: result.total,
    outOf: result.out_of,
    parts: result.parts.map((part) => ({
      key: part.key,
      max: part.max,
      got: part.got,
      unit: part.unit == null || part.unit === "" ? null : String(part.unit),
    })),
    checkpoints: result.checkpoints,
  };
}

function checkpointOf(session, result) {
  const situation = result.situation;
  if (situation.kind === "launch_hold") {
    return {
      kind: "launch",
      launch: { kind: "launch_hold", cause: situation.cause },
      checkpointN: situation.checkpoint,
      defaultAction: situation.default.action,
      ...snapshot(session),
    };
  }
  if (situation.kind === "pad_closed") {
    const hold = situation.options.find((option) => option.action === "hold");
    const divert = situation.options.find((option) => option.action === "divert");
    const alternates = (divert && divert.alternates ? divert.alternates : [])
      .map((alt) => ({ place: alt.place, hopKwh: alt.hop_kwh }))
      .sort((a, b) => a.hopKwh - b.hopKwh);
    return {
      kind: "pad",
      pad: {
        kind: "pad_closed",
        cause: situation.cause,
        holdKwhPerHour: hold.kwh_per_hour,
        alternates,
      },
      checkpointN: situation.checkpoint,
      defaultAction: situation.default.action,
      ...snapshot(session),
    };
  }
  throw new Error("unknown kind");
}

const POLICIES = Object.freeze({
  naive: Object.freeze({ looks: LOOKS.naive, plan: naivePlan, onLaunch: naiveLaunch, onPad: naivePad }),
  careful: Object.freeze({ looks: LOOKS.careful, plan: carefulPlan, onLaunch: carefulLaunch, onPad: carefulPad }),
  random: Object.freeze({ looks: LOOKS.random, plan: randomPlan, onLaunch: randomLaunch, onPad: randomPad }),
  bad: Object.freeze({ looks: LOOKS.bad, plan: badPlan, onLaunch: badLaunch, onPad: badPad }),
});

function naivePlan(hail) {
  return {
    ship: firstShip(hail).id,
    pickupObjective: "energy",
    rideObjective: "energy",
    waitDays: 0,
    askAfterHours: 0,
    quote: "ride",
    decoys: 0,
  };
}

function naiveLaunch() {
  return { action: "wait" };
}

function naivePad() {
  return { action: "hold" };
}

function carefulWaitDays(forecasts, riderReady) {
  const ready = minuteOf(riderReady);
  const pickup = forecasts.filter((forecast) => forecast.at === "pickup");
  if (ready == null) return 0;
  for (let wait = 0; wait <= CAREFUL_MAX_WAIT_DAYS; wait += 1) {
    const at = ready + wait * 1440;
    const hot = pickup.some((forecast) => forecast.days.some((day) => dayCovers(day, at) && day.odds >= CAREFUL_HOT_ODDS));
    if (!hot) return wait;
  }
  return 0;
}

function carefulPlan(hail, forecasts) {
  return {
    ship: firstShip(hail).id,
    comparePickups: true,
    pickupObjective: "energy",
    rideObjective: "energy",
    waitDays: carefulWaitDays(forecasts, hail.riderReady),
    askAfterHours: 0,
    quote: "ride",
    decoys: 0,
  };
}

function carefulLaunch() {
  return { action: "wait" };
}

function carefulPad(cp) {
  const cheap = cp.alternates[0];
  const weather = cp.cause === "dust_storm" || cp.cause === "titan_haze";
  if (weather && cheap && cheap.hopKwh < CAREFUL_PATIENCE_HOURS * cp.holdKwhPerHour) {
    return { action: "divert", place: cheap.place, waitHours: 0 };
  }
  return { action: "hold" };
}

function randomPlan(hail, _forecasts, rng) {
  const legal = legalShips(hail);
  const ship = legal[Math.floor(rng() * legal.length)];
  const objective = () => (rng() < 0.5 ? "energy" : "time");
  return {
    ship: ship.id,
    pickupObjective: objective(),
    rideObjective: objective(),
    waitDays: 0,
    askAfterHours: Math.floor(rng() * (RANDOM_ASK_MAX + 1)),
    quote: "ride",
    decoys: 0,
  };
}

function randomLaunch(_cp, rng) {
  if (rng() < 0.5) return { action: "wait" };
  return { action: "replan", objective: rng() < 0.5 ? "energy" : "time" };
}

function randomPad(cp, rng) {
  if (cp.alternates.length === 0 || rng() >= 0.5) return { action: "hold" };
  const alt = cp.alternates[Math.floor(rng() * cp.alternates.length)];
  return { action: "divert", place: alt.place, waitHours: 0 };
}

function badPlan(hail) {
  return {
    ship: firstShip(hail).id,
    pickupObjective: "time",
    rideObjective: "time",
    waitDays: 0,
    askAfterHours: 0,
    quote: "pickup",
    decoys: BAD_DECOYS,
  };
}

function badLaunch() {
  return { action: "replan", objective: "time" };
}

function badPad(cp) {
  if (cp.alternates.length === 0) return { action: "hold", hours: 1 };
  const last = cp.alternates[cp.alternates.length - 1];
  return { action: "divert", place: last.place, waitHours: BAD_DIVERT_WAIT_HOURS };
}

async function onePair(session, hail, plan) {
  const pickup = await onePickup(session, hail, plan);
  if (!pickup || pickup.gate === "FAIL") return null;
  const ride = await planRide(session, pickup, plan);
  return ride ? { pickup, ride } : null;
}

async function onePickup(session, hail, plan) {
  const legal = legalShips(hail);
  const index = legal.findIndex((ship) => ship.id === plan.ship);
  const decoys = index < 0 ? [] : legal.slice(index + 1, index + 1 + plan.decoys);
  for (const ship of decoys) {
    const decoy = await callTool(session, "plan_pickup", {
      ship: ship.id,
      objective: plan.pickupObjective,
      waitDays: 0,
    });
    knownKind(decoy, ["leg", "error"]);
  }
  const pickup = await callTool(session, "plan_pickup", {
    ship: plan.ship,
    objective: plan.pickupObjective,
    waitDays: plan.waitDays,
  });
  knownKind(pickup, ["leg", "error"]);
  return pickup.kind === "leg" ? pickup.leg : null;
}

async function planRide(session, pickup, plan) {
  const ride = await callTool(session, "plan_ride", {
    afterLeg: pickup.legId,
    objective: plan.rideObjective,
  });
  knownKind(ride, ["leg", "error"]);
  return ride.kind === "leg" && ride.leg.gate !== "FAIL" ? ride.leg : null;
}

function tankHolds(ship, pickup, ride) {
  if (typeof ship.xenonKg !== "number") return true;
  const used = (pickup.xenonKg || 0) + (ride.xenonKg || 0);
  return used <= ship.xenonKg + 1e-6;
}

async function bestPickup(session, hail, plan, rng, noise) {
  const pickups = [];
  for (const ship of legalShips(hail)) {
    const pickup = await callTool(session, "plan_pickup", {
      ship: ship.id,
      objective: plan.pickupObjective,
      waitDays: plan.waitDays,
    });
    knownKind(pickup, ["leg", "error"]);
    if (pickup.kind === "leg" && pickup.leg.gate !== "FAIL") pickups.push({ ship, leg: pickup.leg });
  }
  pickups.sort((a, b) => waitMinutes(a.leg) - waitMinutes(b.leg));
  const flyable = [];
  const need = noise > 0 ? 2 : 1;
  for (const item of pickups) {
    const ride = await planRide(session, item.leg, plan);
    if (!ride || !tankHolds(item.ship, item.leg, ride)) continue;
    flyable.push({ pickup: item.leg, ride });
    if (flyable.length >= need) break;
  }
  if (flyable.length === 0) return null;
  let index = 0;
  if (noise > 0 && flyable.length > 1 && rng() < noise) index = 1;
  return flyable[index];
}

function waitMinutes(leg) {
  const at = minuteOf(leg.arrive);
  return at == null ? Number.POSITIVE_INFINITY : at;
}

function applyNoise(plan, hail, rng, noise) {
  if (!(noise > 0)) return plan;
  const next = {
    ship: plan.ship,
    comparePickups: plan.comparePickups === true,
    pickupObjective: plan.pickupObjective,
    rideObjective: plan.rideObjective,
    waitDays: plan.waitDays,
    askAfterHours: plan.askAfterHours,
    quote: plan.quote,
    decoys: plan.decoys,
  };
  const legal = legalShips(hail);
  if (!next.comparePickups && rng() < noise && legal.length > 1) {
    const index = legal.findIndex((ship) => ship.id === next.ship);
    const at = index < 0 ? 0 : (index + 1) % legal.length;
    next.ship = legal[at].id;
  }
  if (rng() < noise) next.pickupObjective = next.pickupObjective === "energy" ? "time" : "energy";
  if (rng() < noise) next.rideObjective = next.rideObjective === "energy" ? "time" : "energy";
  if (rng() < noise) next.waitDays = (next.waitDays + 1) % (CAREFUL_MAX_WAIT_DAYS + 1);
  if (rng() < noise) next.askAfterHours = Math.min(24, next.askAfterHours + 1);
  if (rng() < noise) next.quote = next.quote === "ride" ? "pickup" : "ride";
  if (rng() < noise) next.decoys = next.decoys > 0 ? 0 : 1;
  return next;
}

function applyLaunchNoise(choice, rng, noise) {
  if (!(noise > 0) || rng() >= noise) return choice;
  if (choice.action === "wait") return { action: "replan", objective: "time" };
  return { action: "wait" };
}

function applyPadNoise(choice, cp, rng, noise) {
  if (!(noise > 0) || rng() >= noise) return choice;
  if (choice.action === "hold") {
    const cheap = cp.alternates[0];
    if (!cheap) return choice;
    return { action: "divert", place: cheap.place, waitHours: 0 };
  }
  return { action: "hold" };
}

function scoreIsV2(row) {
  return row.outOf !== 100 || row.parts.some((part) => part.unit);
}

function checkTrial(trial) {
  const row = trial.row;
  const audit = trial.audit;
  const fail = (reason) => {
    throw new SimCheckError(`Simulated trial check failed. ${reason}`);
  };
  if (row.terminal !== terminalClass(row.enginePhase)) fail("The terminal does not match the phase.");
  if ((row.enginePhase === "arrived") !== (row.terminal === "landed")) fail("Landed does not match arrived.");
  if (row.enginePhase === "arrived") {
    if (!row.parts || row.parts.length === 0) fail("The part list is empty.");
    if (!(row.outOf > 0)) fail("out_of is missing.");
    row.parts.forEach((part) => {
      if (typeof part.key !== "string" || part.key === "") fail("A part key is missing.");
      if (!(typeof part.max === "number" && part.max >= 0)) fail("A part max is missing.");
      if (!(typeof part.got === "number" && part.got >= 0 && part.got <= part.max + 1e-6)) {
        fail("A part score is outside its max.");
      }
    });
    if (!(typeof row.total === "number" && row.total >= 0 && row.total <= row.outOf + 1e-6)) {
      fail("The total is outside out_of.");
    }
    if (scoreIsV2(row)) {
      const sum = row.parts.reduce((acc, part) => acc + part.got, 0);
      if (Math.abs(sum - row.total) > 1e-4) fail("The total is not the sum of the part scores.");
    } else if (!Number.isInteger(row.total)) {
      fail("The total is not an integer.");
    }
    if (row.total !== audit.recordTotal) fail("The total does not match the ride record.");
    if (JSON.stringify(row.parts.map((part) => part.got)) !== JSON.stringify(audit.recordGots)) {
      fail("The part scores do not match the ride record.");
    }
    if (!Number.isInteger(row.checkpointsHit) || row.checkpointsHit < 0) fail("The checkpoint count is missing.");
  } else if (row.total !== null || row.outOf !== null || row.parts !== null) {
    fail("A stranded row has a total.");
  }
  if (audit.forecastsFree !== true) fail("A forecast counted as a plan.");
  if (audit.sentDepartAfter !== false) fail("A replan sent a departure time.");
  const dispatched = audit.trace.includes("dispatch");
  if (dispatched) {
    if (!askHoursOk(audit.askAfterHours)) fail("The ask hours are not a number from 0 to 24.");
    if (audit.quote !== "ride" && audit.quote !== "pickup") fail("The quote is not a known kind.");
  } else if (audit.quote != null || audit.askAfterHours != null) {
    fail("A quote was recorded without a dispatch.");
  }
  if (!Array.isArray(audit.lookTools)) fail("The look list is missing.");
  const expectedForecasts = audit.lookTools;
  const actualForecasts = audit.trace.filter((tool) => tool === "space_weather" || tool === "check_pad");
  const reached = actualForecasts.length > 0 || audit.trace.includes("plan_pickup") || dispatched;
  if (expectedForecasts.length === 0 && actualForecasts.length !== 0) fail("The trace has a forecast the policy did not ask for.");
  if (expectedForecasts.length > 0 && reached && JSON.stringify(actualForecasts) !== JSON.stringify(expectedForecasts)) {
    fail("The forecasts are not the looks that were asked for.");
  }
  if (audit.trace.includes("plan_leg")) fail("The trace includes plan_leg.");
  const histories = audit.trace.filter((tool) => tool === "get_my_rides");
  const historyCount = audit.opened ? 2 : 1;
  if (histories.length !== historyCount || audit.trace[audit.trace.length - 1] !== "get_my_rides") {
    fail("The ride history calls do not match the open.");
  }
  for (const answer of audit.answers) {
    if (answer.kind !== "launch_hold" && answer.kind !== "pad_closed") fail("A checkpoint kind is unknown.");
    if (answer.action !== "wait" && answer.action !== "replan" && answer.action !== "hold" && answer.action !== "divert") {
      fail("A checkpoint action is unknown.");
    }
  }
  if (audit.recordSimulated != null && audit.recordSimulated !== true) fail("The ride record is not simulated.");
  if (audit.opened && audit.recordSimulated !== true) fail("The ride record is not simulated.");
}

function checkReport(report, printed) {
  const fail = (reason) => {
    throw new SimCheckError(`Simulated report check failed. ${reason}`, report);
  };
  if (report.simulated !== true || report.header !== headerFor(report)) fail("The header is missing.");
  if (!printed.startsWith(report.header) || !printed.includes("Simulated")) fail("The header is missing.");
  if (!printed.includes(skillLine(report))) fail("The skill line is missing.");
  if (!Object.hasOwn(SIMULATED_SKILL, report.skill)) fail("The skill tier is unknown.");
  if (report.lookDepth !== SIMULATED_SKILL[report.skill].lookDepth) fail("The look depth does not match the skill tier.");
  if (typeof report.noise !== "number" || report.noise < 0 || report.noise > 1) fail("The noise is outside 0 to 1.");
  if (report.outOf == null) {
    if (printed.includes("Score out of ")) fail("An out_of line was printed without a score.");
  } else if (!printed.includes(`Score out of ${report.outOf}.`)) {
    fail("The out_of line is missing.");
  }
  const columns = partColumns(report);
  for (const row of report.rows) {
    if (!row.parts) continue;
    if (row.outOf !== report.outOf) fail("out_of differs across rides.");
    if (row.parts.length !== columns.length) fail("The part list length differs across rides.");
    row.parts.forEach((part, index) => {
      if (part.key !== columns[index].key || (part.unit || null) !== columns[index].unit) {
        fail("A part key or unit differs across rides.");
      }
    });
  }
  if (COPY_SCAN.test(printed) || printed.includes("\u2013") || printed.includes("\u2014")) {
    throw new SimCheckError("copy scan failed", report);
  }
  if (report.means.length !== report.policies.length) fail("The means do not match the policies.");
  report.policies.forEach((policy, index) => {
    const line = report.means[index];
    const mean = tally(report.rows, policy);
    if (!line || line.policy !== policy || line.mean !== mean.mean || line.landed !== mean.landed || line.stranded !== mean.stranded) {
      fail("A mean does not match the rows.");
    }
    if (!printed.includes(meanLine(mean))) fail("A mean line is missing.");
  });
  const both = report.policies.includes("naive") && report.policies.includes("careful");
  if (!both) {
    if (report.finding != null) fail("A finding was set without both policies.");
  } else {
    const careful = tally(report.rows, "careful").mean;
    const naive = tally(report.rows, "naive").mean;
    if (careful != null && naive != null && careful < naive) {
      const text = `Finding: careful landed mean ${careful.toFixed(2)} is below naive landed mean ${naive.toFixed(2)}.`;
      if (!report.finding || report.finding.careful !== careful || report.finding.naive !== naive || report.finding.text !== text) {
        fail("The finding does not match the means.");
      }
    } else if (report.finding != null) {
      fail("A finding was set when careful is not below naive.");
    }
  }
  let index = 0;
  for (const policy of report.policies) {
    for (const seed of report.seeds) {
      for (const hailId of report.hails) {
        const row = report.rows[index];
        index += 1;
        if (!row || row.policy !== policy || row.seed !== seed || row.hailId !== hailId) fail("Row order drifted.");
      }
    }
  }
  if (index !== report.rows.length) fail("Row order drifted.");
}

function parseArgs(argv) {
  const spec = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value == null || value.startsWith("-")) throw new SimCheckError("Simulated run needs a value after the flag.");
    if (flag === "--policies") spec.policies = value.split(",").map((item) => item.trim());
    else if (flag === "--seeds") spec.seeds = value.split(",").map((item) => item.trim());
    else if (flag === "--hails") spec.hails = value.split(",").map((item) => item.trim());
    else if (flag === "--skill") spec.skill = value.trim();
    else if (flag === "--noise") spec.noise = value.trim();
    else throw new SimCheckError("Simulated run rejected an unknown flag.");
    i += 1;
  }
  return spec;
}

async function main(argv) {
  try {
    const report = await simulate(parseArgs(argv));
    process.stdout.write(formatReport(report));
    return 0;
  } catch (err) {
    if (err instanceof SimCheckError) {
      if (err.message === "copy scan failed") {
        process.stdout.write("Simulated report withheld because the copy scan failed.\n");
        return 1;
      }
      if (err.report) process.stdout.write(formatReport(err.report));
      process.stdout.write(`${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  main(process.argv.slice(2)).then((code) => {
    process.exit(code);
  }).catch((err) => {
    const text = err && err.stack ? err.stack : String(err);
    process.stderr.write(`${text}\n`);
    process.exit(1);
  });
}
