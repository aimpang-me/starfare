#!/usr/bin/env node
// Runs one agent over a suite split and writes results.json, one row per task and repeat.
//   node bench/run.mjs --suite src/suites/v1.json --split dev --agent naive --out runs/naive.json
//   node bench/run.mjs --suite src/suites/v1.json --split dev --agent '<cmd>' --label-agent <name> --label-model <name> --out runs/mine.json
// naive and random run in-process. Any other --agent is a shell command run once per attempt, with {mcp_config} replaced by
// the path of an MCP config naming bench/serve.mjs and {prompt_file} by the task prompt's path. The command also gets
// STARFARE_BENCH_PROMPT (the prompt) and STARFARE_BENCH_META (a path where it may write {"tokens": n}). The test split needs
// STARFARE_BENCH_KEY in the environment; it is never written anywhere.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import META from "../src/engine/meta.json" with { type: "json" };
import { SCORE_VERSION, rideRecord } from "../src/game.js";
import { RESULTS_FORMAT } from "../src/stats.js";
import { seedFor, tasksOf } from "../src/suite.js";
import { BenchBackend, flags, loadEngine, openTask, readSuite } from "./backend.mjs";
import { naive, random, rngOf } from "./agents.mjs";
const SERVE = fileURLToPath(new URL("./serve.mjs", import.meta.url));
const BUILTIN = { naive: (call, E) => naive(call, E), random: (call, E, at) => random(call, E, rngOf(at.task.id + "|" + at.repeat)) };

export const PROMPT =
  "You are the dispatcher for one Starfare bench task (simulated). Use the starfare MCP tools: list_hails shows the task's hail, " +
  "take_hail takes it, plan the legs, then dispatch with an honest fare and arrival. Answer any checkpoint with decide. " +
  "Every tool call counts against the task's budget. Stop when the ride has arrived or you have nothing better to do.";

/** One attempt by an external agent: the command runs while this process answers its tool calls for backend. */
async function external(cmd, backend, timeoutS) {
  const dir = mkdtempSync(join(tmpdir(), "starfare-bench-")), token = randomBytes(24).toString("hex");
  const http = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      if (req.method !== "POST" || req.url !== "/call" || req.headers.authorization !== "Bearer " + token) { res.writeHead(403).end("forbidden"); return; }
      try {
        const { tool, input } = JSON.parse(body);
        const out = await backend.call(tool, input || {});
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
      } catch (e) { res.writeHead(500).end(String(e && e.message)); }
    });
  });
  await new Promise((ok) => http.listen(0, "127.0.0.1", ok));
  const env = { STARFARE_BENCH_URL: "http://127.0.0.1:" + http.address().port, STARFARE_BENCH_TOKEN: token };
  const config = join(dir, "mcp.json"), prompt = join(dir, "prompt.txt"), meta = join(dir, "meta.json");
  writeFileSync(config, JSON.stringify({ mcpServers: { starfare: { command: process.execPath, args: [SERVE], env } } }, null, 2));
  writeFileSync(prompt, PROMPT);
  const line = cmd.replaceAll("{mcp_config}", config).replaceAll("{prompt_file}", prompt);
  try {
    await new Promise((ok) => {
      const child = spawn(line, { shell: true, stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, STARFARE_BENCH_PROMPT: PROMPT, STARFARE_BENCH_META: meta } });
      const timer = setTimeout(() => child.kill(), timeoutS * 1000);
      child.on("exit", () => { clearTimeout(timer); ok(); });
      child.on("error", () => { clearTimeout(timer); ok(); });
    });
    let tokens = null;
    try { tokens = JSON.parse(readFileSync(meta, "utf8")).tokens ?? null; } catch {}
    return { tokens };
  } finally {
    await new Promise((ok) => http.close(ok));
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every task of the split, repeats times each. Returns the results object; records gets one ride record per attempt. */
export async function runSuite({ suite, split, agent, labels, repeats = 1, timeoutS = 600, key = process.env.STARFARE_BENCH_KEY, records = [] }) {
  const E = loadEngine(), rows = [];
  for (const task of tasksOf(suite, split)) {
    for (let repeat = 0; repeat < repeats; repeat++) {
      const backend = new BenchBackend(E, await openTask(E, suite, task, await seedFor(suite, split, task, repeat, key)));
      const t = Date.now();
      let tokens = null;
      if (Object.hasOwn(BUILTIN, agent)) await BUILTIN[agent]((tool, input) => backend.call(tool, input), E, { task, repeat });
      else ({ tokens } = await external(agent, backend, timeoutS));
      const { run, score, over_budget } = backend.finish();
      records.push(rideRecord(E, run));
      rows.push({ task_id: task.id, repeat, score, meta: { tool_calls: run.tool_calls, plan_calls: run.calls, wall_ms: Date.now() - t, tokens, over_budget } });
    }
  }
  return { format: RESULTS_FORMAT, suite: suite.id, split, labels, engine_sha256: META.sha256, score_version: SCORE_VERSION, budget: suite.budget, repeats, rows };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = flags(process.argv.slice(2), ["suite", "split", "agent", "label-agent", "label-model", "out", "repeats", "timeout-s"]);
  if (!a.suite || !a.agent || !a.out) throw new Error("usage: node bench/run.mjs --suite <file> --split dev --agent naive|random|'<cmd>' --out <results.json> [--label-agent a --label-model m --repeats k --timeout-s s]");
  const builtin = Object.hasOwn(BUILTIN, a.agent);
  const labels = { agent: a["label-agent"] || (builtin ? a.agent : null), model: a["label-model"] || (builtin ? "none" : null) };
  if (!labels.agent || !labels.model) throw new Error("an external agent needs --label-agent and --label-model");
  const records = [];
  const results = await runSuite({ suite: readSuite(a.suite), split: a.split || "dev", agent: a.agent, labels, repeats: +(a.repeats || 1), timeoutS: +(a["timeout-s"] || 600), records });
  mkdirSync(dirname(resolve(a.out)), { recursive: true });
  writeFileSync(a.out, JSON.stringify(results, null, 2) + "\n");
  writeFileSync(a.out.replace(/\.json$/, "") + ".rides.jsonl", records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const mean = results.rows.reduce((s, r) => s + r.score.total, 0) / results.rows.length;
  console.log(results.rows.length + " attempts, mean total " + mean.toFixed(1) + " (simulated); wrote " + a.out);
}
