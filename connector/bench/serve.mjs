#!/usr/bin/env node
// The bench's MCP server over stdio: the same 11 tools a Grok bot sees, for one task. run.mjs starts it for an agent and sets
// STARFARE_BENCH_URL and STARFARE_BENCH_TOKEN, so every call goes to the runner, which holds the run and counts the calls.
// By hand (dev split only): node bench/serve.mjs --suite src/suites/v1.json --split dev --task iss-crew/0012 [--repeat 0]
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { INSTRUCTIONS, registerTools } from "../src/tools.js";
import { PUBLIC_SPLITS, seedFor, tasksOf } from "../src/suite.js";
import { BENCH_NOTE, BenchBackend, flags, loadEngine, openTask, readSuite } from "./backend.mjs";

async function backend() {
  const url = process.env.STARFARE_BENCH_URL, token = process.env.STARFARE_BENCH_TOKEN;
  if (url && token) {
    return {
      async call(tool, input) {
        const r = await fetch(url + "/call", { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify({ tool, input }) });
        return r.ok ? r.json() : { error: "the bench runner answered " + r.status + ": " + (await r.text()) };
      },
    };
  }
  const a = flags(process.argv.slice(2), ["suite", "split", "task", "repeat"]);
  if (!a.suite || !a.task) throw new Error("usage: node bench/serve.mjs --suite <file> --split dev --task <task_id> [--repeat n]");
  const split = a.split || "dev";
  if (!PUBLIC_SPLITS.includes(split)) throw new Error("serve.mjs by hand runs the public splits only (" + PUBLIC_SPLITS.join(", ") + "); run.mjs runs the test split");
  const suite = readSuite(a.suite), task = tasksOf(suite, split).find((t) => t.id === a.task);
  if (!task) throw new Error("no task " + a.task + " in the " + split + " split");
  const E = loadEngine();
  return new BenchBackend(E, await openTask(E, suite, task, await seedFor(suite, split, task, +(a.repeat || 0))));
}

const server = new McpServer({ name: "starfare", version: "0.1.0" }, { instructions: INSTRUCTIONS + BENCH_NOTE });
registerTools(server, await backend());
await server.connect(new StdioServerTransport());
