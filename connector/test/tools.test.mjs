// The tool table (tools.js) registered against an in-process backend over applyTool, with no Durable Objects: the shape a
// Node harness uses. A bench run's call budget stops it; a season run has none.
// Run: node build.mjs && node --test test/tools.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { z } from "zod";
import { applyTool, fleet, hailInfo, listHails, openRun, seasonInstance, suiteInstance } from "../src/game.js";
import { registerTools } from "../src/tools.js";

const E = createRequire(import.meta.url)("../src/engine/sol-page.cjs");
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);
const SEED = "k1:7f3c9a2e5b10d84f00"; // stops iss-crew on the par car at a pad_closed checkpoint
const bench = (budget) => (hailId) => suiteInstance(E, { hail_id: hailId }, { seed: SEED, clockJd: 2462529.5, tag: "iss-crew/pad-closed-01", budget });
const season = (hailId) => seasonInstance(E, hailId, NOW);

/** Records registrations and calls a tool the way the MCP SDK does: input parsed by the tool's schema first. */
function fakeServer() {
  const tools = new Map();
  return {
    tools,
    registerTool(name, def, cb) { tools.set(name, { def, cb }); },
    call: (name, input = {}) => { const t = tools.get(name); return t.cb(z.object(t.def.inputSchema).parse(input)); },
  };
}

/** One session's runs in a Map; run tools go through applyTool and a changed run replaces the stored one. */
function localBackend(instanceOf) {
  const runs = new Map();
  return {
    runs,
    async call(tool, input) {
      if (tool === "list_hails") return { hails: listHails(E), fleet: fleet(E), board: "/board" };
      if (tool === "take_hail") {
        const id = "run_" + String(runs.size + 1).padStart(20, "0"), run = await openRun(E, instanceOf(input.hail_id), id, NOW);
        runs.set(id, run);
        return hailInfo(E, run, NOW);
      }
      const { run_id, ...inp } = input, before = runs.get(run_id);
      if (!before) return { error: "unknown run_id. Call take_hail to get one." };
      const { run, result } = await applyTool(E, before, tool, inp, { nowMs: NOW });
      if (run) runs.set(run_id, run);
      return result;
    },
  };
}

function session(instanceOf) {
  const server = fakeServer(), backend = localBackend(instanceOf);
  registerTools(server, backend);
  return { server, backend, call: async (name, input) => server.call(name, input) };
}
const data = (r) => { assert.equal(r.isError, undefined, r.content[0].text); return JSON.parse(r.content[0].text); };

test("registerTools registers the eleven tools in order and answers each through backend.call", async () => {
  const server = fakeServer(), seen = [];
  registerTools(server, { call: async (tool, input) => { seen.push([tool, input]); return tool === "get_hail" ? { error: "no such run" } : { ok: 1 }; } });
  assert.deepEqual([...server.tools.keys()],
    ["list_hails", "take_hail", "get_hail", "plan_pickup", "plan_ride", "plan_leg", "check_pad", "space_weather", "dispatch", "decide", "get_my_rides"]);
  assert.deepEqual(Object.keys(server.tools.get("plan_pickup").def.inputSchema), ["run_id", "car", "objective", "wait_days"]);

  const id = "run_" + "0".repeat(20);
  assert.deepEqual(await server.call("plan_pickup", { run_id: id, car: "sf-01" }), { content: [{ type: "text", text: "{\"ok\":1}" }] });
  assert.deepEqual(await server.call("get_hail", { run_id: id }), { content: [{ type: "text", text: "no such run" }], isError: true });
  assert.deepEqual(seen, [["plan_pickup", { run_id: id, car: "sf-01" }], ["get_hail", { run_id: id }]]);
});

test("a bench run answers its budget of 6 calls, through a checkpoint to arrival, then refuses the 7th", async () => {
  const s = session(bench(6));
  const { run_id } = data(await s.call("take_hail", { hail_id: "iss-crew" }));
  const car = s.backend.runs.get(run_id).par_car;
  assert.equal(data(await s.call("get_hail", { run_id })).task_id, "iss-crew/pad-closed-01");
  assert.equal(data(await s.call("check_pad", { run_id, place: "iss" })).place.id, "iss");
  const p = data(await s.call("plan_pickup", { run_id, car }));
  const r = data(await s.call("plan_ride", { run_id, after_leg: p.leg_id }));
  assert.deepEqual([p.leg_id, r.leg_id, r.plans_used], ["leg1", "leg2", 2]);
  const d = data(await s.call("dispatch", { run_id, pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare_usd, quoted_arrival: r.arrive }));
  assert.deepEqual([d.status, d.situation.kind, d.situation.checkpoint], ["checkpoint", "pad_closed", 1]);
  assert.equal(data(await s.call("decide", { run_id, checkpoint: 1, action: "hold" })).status, "arrived");
  assert.equal(s.backend.runs.get(run_id).tool_calls, 6);

  assert.deepEqual(await s.call("get_hail", { run_id }),
    { content: [{ type: "text", text: "this task has used its budget of 6 tool calls; no more calls are answered" }], isError: true });
  assert.equal(s.backend.runs.get(run_id).tool_calls, 6);
});

test("a call that fails still spends the budget; the refusal spends none and changes nothing", async () => {
  const s = session(bench(2));
  const { run_id } = data(await s.call("take_hail", { hail_id: "iss-crew" }));
  assert.deepEqual(await s.call("plan_pickup", { run_id, car: "sf-99" }),
    { content: [{ type: "text", text: "unknown ship sf-99. The fleet is in get_hail." }], isError: true });
  assert.equal(data(await s.call("get_hail", { run_id })).plans_used, 0);
  const spent = s.backend.runs.get(run_id);
  assert.equal(spent.tool_calls, 2);

  const out = await applyTool(E, spent, "plan_pickup", { car: spent.par_car }, { nowMs: NOW });
  assert.deepEqual(out, { run: null, result: { error: "this task has used its budget of 2 tool calls; no more calls are answered" } });
  assert.equal(spent.calls, 0);
});

test("a season run has no budget: it never counts calls, and a read leaves nothing to save", async () => {
  const s = session(season);
  const { run_id } = data(await s.call("take_hail", { hail_id: "iss-crew" }));
  for (let i = 0; i < 8; i++) assert.equal(data(await s.call("get_hail", { run_id })).season, 7);
  const run = s.backend.runs.get(run_id);
  assert.deepEqual([run.budget, "tool_calls" in run], [null, false]);

  const snapshot = JSON.stringify(run);
  assert.equal((await applyTool(E, run, "get_hail", {}, { nowMs: NOW })).run, null);
  const planned = await applyTool(E, run, "plan_pickup", { car: run.par_car }, { nowMs: NOW });
  assert.deepEqual([planned.result.plans_used, planned.run.calls, run.calls], [1, 1, 0]);
  assert.equal(JSON.stringify(run), snapshot);
});
