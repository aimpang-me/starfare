#!/usr/bin/env node
// Cuts a suite: samples candidate tasks (one hail, or a shared flight of 2 bookings, at a whole sky day), scores each with
// naive, random and the hindsight reference, and keeps the ones with headroom (reference - naive above the margin), the same
// number from each stratum (quick or long, by the lead hail; clear or hazard, by whether naive's ride met an incident),
// plus a few anchors naive already solves. Every candidate's scores go to the selection file, so the choice can be audited.
//   node bench/make-suite.mjs --id v1 --out src/suites/v1.json [--candidates 80 --per-stratum 5 --anchors 3]
//   STARFARE_BENCH_KEY=... node bench/make-suite.mjs --test-into src/suites/v1.json --test-selection <path outside the repo>
// The dev split's candidates come from a public seed, so anyone can rerun this and get the same file. The test split's
// candidates and worlds come from the key: --test-into adds its task list (id, hail or hails, sky day; no stratum or anchor,
// which say how naive fared in a hidden world) to the suite file, and its scores go only to --test-selection.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import META from "../src/engine/meta.json" with { type: "json" };
import { SCORE_VERSION, SEASON_END, SKY } from "../src/game.js";
import { SUITE_FORMAT, loadSuite, seedFor } from "../src/suite.js";
import { BenchBackend, flags, loadEngine, openTask } from "./backend.mjs";
import { naive, random, reference, rngOf } from "./agents.mjs";

export const SELECTION_FORMAT = "starfare.selection/1";
const LAST_DAY = SEASON_END - 400 - SKY.jd0; // a long ride still lands inside the season

export function candidates(E, rng, n) {
  const ids = E.R.HAILS.map((h) => h.id), out = new Map();
  while (out.size < n) {
    // Three bookings cost about 6 minutes per candidate (pooled par and the reference each plan 90 stop orders), so v1 stops at two.
    const k = rng() < 0.6 ? 1 : 2, pool = [...ids], hails = [];
    while (hails.length < k) hails.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    // Each Starseeker class flies its own bookings, so a pair no one class flies has no flight to score.
    if (!E.R.FLEET.some((c) => hails.every((h) => E.R.serves(c, E.R.BY[h])))) continue;
    const day = Math.floor(rng() * LAST_DAY), id = hails.join("+") + "/" + String(day).padStart(4, "0");
    out.set(id, { id, ...(k === 1 ? { hail_id: hails[0] } : { hails }), clock_jd: SKY.jd0 + day });
  }
  return [...out.values()];
}

async function attempt(E, run, agent) {
  const b = new BenchBackend(E, structuredClone(run));
  await agent((tool, input) => b.call(tool, input));
  const f = b.finish();
  return { total: f.score.total, parts: f.score.parts, incidents: f.run.score ? f.run.score.incidents.length : null };
}

/** Scores every candidate on split's worlds; one row each. */
async function scoreAll(E, suite, split, tasks, key, log) {
  const rows = [];
  for (const task of tasks) {
    const t = Date.now(), row = { task };
    try {
      const run = await openTask(E, suite, task, await seedFor(suite, split, task, 0, key));
      row.naive = await attempt(E, run, (call) => naive(call, E));
      row.random = await attempt(E, run, (call) => random(call, E, rngOf(task.id + "|0")));
      const ref = reference(E, run);
      row.reference = ref ? { total: ref.total, parts: ref.parts, car: ref.car, plan: ref.label, choices: ref.choices } : null;
      row.headroom = ref ? ref.total - row.naive.total : null;
      row.stratum = (E.R.BY[run.id].kind === "quick" ? "quick" : "long") + "/" + (row.naive.incidents ? "hazard" : "clear");
    } catch (e) {
      row.error = String(e && e.message);
    }
    rows.push(row);
    log(task.id + " " + (row.error ? "error: " + row.error : "naive " + row.naive.total + " random " + row.random.total + " ref " + (row.reference ? row.reference.total : "none") + " " + row.stratum) + " (" + (Date.now() - t) + " ms)");
  }
  return rows;
}

/** The rule, applied to scored rows: which tasks go in, and why each did or did not. */
function select(rows, rng, { margin, perStratum, anchors }) {
  const shuffled = rows.map((r) => [rng(), r]).sort((a, b) => a[0] - b[0]).map(([, r]) => r), taken = {};
  for (const r of shuffled) {
    if (r.error) r.reason = "could not be opened";
    else if (!r.reference) r.reason = "no plan flies";
    else if (r.headroom > margin) {
      taken[r.stratum] = (taken[r.stratum] || 0) + 1;
      if (taken[r.stratum] <= perStratum) { r.selected = true; r.reason = "headroom " + r.headroom + " > margin " + margin; }
      else r.reason = "stratum " + r.stratum + " already has " + perStratum;
    } else r.reason = "headroom " + r.headroom + " <= margin " + margin;
  }
  let n = 0;
  for (const r of shuffled) {
    if (n < anchors && !r.selected && r.reference && r.naive.total >= 95 && r.headroom <= 0) { r.selected = r.anchor = true; r.reason = "anchor: naive scores " + r.naive.total; n++; }
  }
  return rows.filter((r) => r.selected).map((r) => ({ ...r.task, stratum: r.stratum, ...(r.anchor ? { anchor: true } : {}) }));
}

async function cut({ id, split, n, key, rule, log }) {
  const E = loadEngine(), suite = { format: SUITE_FORMAT, id, engine_sha256: META.sha256, score_version: SCORE_VERSION, budget: rule.budget, world: "per_task", margin: rule.margin };
  const rng = rngOf("starfare-bench|" + id + "|" + split + "|" + (split === "dev" ? "candidates" : key));
  const rows = await scoreAll(E, suite, split, candidates(E, rng, n), key, log);
  const tasks = select(rows, rng, rule);
  const unselected = rows.filter((r) => !r.selected && !r.error);
  const sample = unselected.map((r) => [rng(), r.task.id]).sort((a, b) => a[0] - b[0]).slice(0, Math.ceil(tasks.length / 2)).map(([, t]) => t);
  const selection = {
    format: SELECTION_FORMAT, suite: id, split, simulated: true,
    rule: { headroom: "reference total - naive total", margin: rule.margin, per_stratum: rule.perStratum, anchors: rule.anchors, anchor_rule: "naive >= 95 and headroom <= 0", strata: "quick|long by the lead hail x clear|hazard by whether naive's ride met an incident" },
    counts: Object.fromEntries(["quick/clear", "quick/hazard", "long/clear", "long/hazard"].map((s) => [s, { candidates: rows.filter((r) => r.stratum === s).length, selected: tasks.filter((t) => t.stratum === s && !t.anchor).length }])),
    unselected_sample: sample,
    candidates: rows.map(({ task, ...r }) => ({ task_id: task.id, ...r, selected: !!r.selected })),
  };
  return { suite: { ...suite, splits: { [split]: tasks } }, selection };
}

/** What the suite file may say about a test task. */
export const publicTask = ({ id, hail_id, hails, clock_jd }) => ({ id, ...(hails ? { hails } : { hail_id }), clock_jd });
const REPO = fileURLToPath(new URL("../..", import.meta.url));
const inRepo = (path) => { const r = relative(REPO, resolve(path)); return !r.startsWith("..") && !isAbsolute(r); };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = flags(process.argv.slice(2), ["id", "out", "test-into", "test-selection", "candidates", "per-stratum", "anchors", "margin", "budget"]);
  const rule = { margin: +(a.margin ?? 5), perStratum: +(a["per-stratum"] ?? 5), anchors: +(a.anchors ?? 3), budget: +(a.budget ?? 60) };
  const id = a.id || "v1", n = +(a.candidates ?? 80), log = (s) => console.error(s);
  const write = (path, obj) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(obj, null, 2) + "\n"); };
  if (a.out) {
    const { suite, selection } = await cut({ id, split: "dev", n, rule, log });
    write(a.out, suite);
    write(a.out.replace(/\.json$/, "") + ".selection.json", selection);
    console.log("dev: " + suite.splits.dev.length + " tasks of " + n + " candidates; wrote " + a.out);
  }
  if (a["test-into"]) {
    const key = process.env.STARFARE_BENCH_KEY, sel = a["test-selection"];
    if (!key) throw new Error("--test-into needs STARFARE_BENCH_KEY in the environment");
    if (!sel || inRepo(sel)) throw new Error("--test-selection must be a path outside the repo: it holds the test split's scores");
    const into = loadSuite(readFileSync(a["test-into"], "utf8"));
    const { suite, selection } = await cut({ id: into.id, split: "test", n, key, rule: { ...rule, budget: into.budget, margin: into.margin }, log });
    write(a["test-into"], { ...into, splits: { ...into.splits, test: suite.splits.test.map(publicTask) } });
    write(sel, selection);
    console.log("test: " + suite.splits.test.length + " tasks of " + n + " candidates; added to " + a["test-into"] + ", scores in " + sel);
  }
}
