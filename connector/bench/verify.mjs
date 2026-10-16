#!/usr/bin/env node
// Replays a hosted bench session from its trace (GET /bench/<bench_id>/trace.json) and checks that the stored calls reproduce
// every task's stored result byte for byte, through the same reducer the Worker ran. Exits 1 when they do not.
//   node bench/verify.mjs <trace.json> [--suite src/suites/v1.json]
// A test split's trace needs the server's STARFARE_BENCH_KEY in the environment, since its worlds come from that key.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TRACE_FORMAT, replayTrace } from "../src/bench-host.js";
import { PUBLIC_SPLITS } from "../src/suite.js";
import { flags, loadEngine, readSuite } from "./backend.mjs";

/** { verified, suite_tasks, tasks } for a parsed trace, or throws when the trace is for another suite or engine. */
export async function verifyTrace(trace, suite, key) {
  if (trace.format !== TRACE_FORMAT) throw new Error("not a " + TRACE_FORMAT + " file");
  if (trace.suite !== suite.id) throw new Error("trace is for suite " + trace.suite + ", not " + suite.id);
  if (trace.engine_sha256 !== suite.engine_sha256 || trace.score_version !== suite.score_version)
    throw new Error("trace was played on engine " + trace.engine_sha256.slice(0, 12) + " score v" + trace.score_version + "; this suite is engine " + suite.engine_sha256.slice(0, 12) + " score v" + suite.score_version);
  if (!PUBLIC_SPLITS.includes(trace.start.split) && !key) throw new Error("the " + trace.start.split + " split needs STARFARE_BENCH_KEY in the environment");
  return replayTrace(loadEngine(), suite, trace, key);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, ...rest] = process.argv.slice(2);
  if (!file || file.startsWith("--")) throw new Error("usage: node bench/verify.mjs <trace.json> [--suite src/suites/v1.json]");
  const a = flags(rest, ["suite"]);
  const trace = JSON.parse(readFileSync(file, "utf8"));
  const r = await verifyTrace(trace, readSuite(a.suite || fileURLToPath(new URL("../src/suites/" + trace.suite + ".json", import.meta.url))), process.env.STARFARE_BENCH_KEY);
  console.log("bench " + trace.bench_id + " (simulated), suite " + trace.suite + ", " + trace.start.split + " split, " + trace.calls.length + " calls");
  if (!r.suite_tasks) console.log("  the trace's tasks or budget are not this suite's");
  for (const t of r.tasks) console.log("  " + (t.same ? "same     " : "DIFFERENT") + " " + t.task_id + ": stored " + t.stored + ", replayed " + t.replayed);
  console.log(r.verified ? "verified: the calls reproduce every stored result" : "NOT verified");
  process.exitCode = r.verified ? 0 : 1;
}
