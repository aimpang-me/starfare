// The agent log in words (src/agent-log.cjs), the hail list pages an agent can read, and the agent's name on its run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { HAIL_PAGE, agentOf, hailPage, poolView } from "../src/game.js";

const require = createRequire(import.meta.url), AgentLog = require("../src/agent-log.cjs"), E = require("../src/engine/sol-page.cjs");

test("each logged tool call reads as what the agent did, with the numbers from the log and its own note", () => {
  const name = (p) => ({ iss: "ISS", tiangong: "Tiangong" })[p] || p;
  const plan = AgentLog.line({ tool: "plan_pickup", leg_id: "leg1", kind: "pickup", from: "Orbital Depot", to: "ISS", depart: "2040-06-28 00:00", arrive: "2040-06-28 00:47", kwh: 233, fare_usd: 53.69, gate: "local" });
  assert.deepEqual([plan.act, plan.tone, plan.at], ["Planned the pickup", "plan", "2040-06-28 00:00"]);
  assert.equal(plan.text, "Orbital Depot → ISS, leaves 2040-06-28 00:00, lands 2040-06-28 00:47 · 233 kWh · $53.69 · local hop, not re-flown");
  const d = AgentLog.line({ tool: "decide", checkpoint: 1, kind: "pad_closed", checkpoint_at: "2040-06-28 01:47", decision: { action: "divert", place: "tiangong", wait_hours: 2 }, status: "checkpoint", note: "cheaper than holding" }, name);
  assert.deepEqual([d.act, d.text, d.why, d.at], ["Decided at checkpoint 1", "pad closed at 2040-06-28 01:47: divert to Tiangong and wait 2 h on the ground · stopped at a checkpoint", "cheaper than holding", "2040-06-28 01:47"]);
  assert.equal(AgentLog.line({ tool: "decide", checkpoint: 4, kind: "pad_closed", decision: { action: "hold" }, status: "arrived" }).text, "pad closed: hold in orbit until the pad opens · landed");
  const sent = AgentLog.line({ tool: "dispatch", route: ["leg1", "leg2"], car: "SF-01", fare_usd: 5968.77, arrival: "2040-07-03 01:33", status: "checkpoint", note: "closest free ship" });
  assert.deepEqual([sent.act, sent.text, sent.why], ["Dispatched SF-01", "fare $5,968.77, promised arrival 2040-07-03 01:33 · stopped at a checkpoint", "closest free ship"]);
  assert.equal(AgentLog.line({ tool: "check_pad", place: "ISS", berths: 2, max_booked: 4 }).text, "ISS: 2 berths, up to 4 booked in an hour");
  assert.equal(AgentLog.line({ tool: "space_weather", place: "ISS", max_flare_odds: 0.05 }).text, "ISS: flare odds up to 5% a day");
  assert.deepEqual(AgentLog.line({ tool: "plan_ride", error: "tank too small" }), { tool: "plan_ride", act: "Planned the ride: refused", text: "tank too small", why: "", at: null, tone: "error" });
  assert.deepEqual(AgentLog.line({ tool: "dispatch", problems: ["leg2 failed re-fly"] }).tone, "error");
  assert.equal(AgentLog.line({ tool: "take_hail", hail_id: "s50-3", title: "ISS crew change" }).text, "ISS crew change (s50-3)");
});

test("a bench call maps to the same words as the run's log", () => {
  const e = AgentLog.fromCall("plan_ride", { run_id: "x", after_leg: "leg1" }, { leg_id: "leg2", kind: "ride", car: "sf-01", from: "ISS", to: "Lunar Data Center", depart: "a", arrive: "b", battery_kwh: 21611, fare_usd: 5968.77, refly: { result: "PASS" } });
  assert.equal(AgentLog.line(e).text, "SF-01 ISS → Lunar Data Center, leaves a, lands b · 21,611 kWh · $5,968.77 · n-body re-fly passed");
  const d = AgentLog.fromCall("decide", { checkpoint: 2, action: "hold", hours: 1, note: "berth frees at 12:00" }, { status: "arrived" });
  assert.deepEqual([AgentLog.line(d).text, AgentLog.line(d).why], ["hold in orbit, ask again in 1 h · landed", "berth frees at 12:00"]);
  assert.equal(AgentLog.line(AgentLog.fromCall("check_pad", {}, { place: { name: "ISS" }, berths: 2, hours: [{ booked: 1 }, { booked: 3 }] })).text, "ISS: 2 berths, up to 3 booked in an hour");
  assert.equal(AgentLog.line(AgentLog.fromCall("plan_pickup", {}, { error: "busy" })).tone, "error");
});

test("the agent's name is what its MCP client reported, cleaned, and the log names it", () => {
  assert.deepEqual(agentOf({ name: "claude-code", version: "2.1.304" }), { name: "claude-code", version: "2.1.304" });
  assert.deepEqual(agentOf({ name: "<img src=x onerror=1>grok" }), { name: "img srcx onerror1grok" });
  assert.equal(agentOf({ name: "" }), null);
  assert.equal(agentOf(null), null);
  assert.equal(AgentLog.agentName([{ tool: "take_hail", agent: { name: "grok" } }, { tool: "dispatch" }]), "grok");
  assert.equal(AgentLog.agentName([{ tool: "dispatch" }]), "");
});

test("list_hails pages the pool so an agent can read it, filtered by kind and place", () => {
  const view = poolView(E, "50", 200);
  const first = hailPage(view, {});
  assert.equal(first.hails.length, HAIL_PAGE);
  assert.equal(first.matching, 200);
  assert.equal(first.next_cursor, "25");
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < 16000, "a default page fits an agent's tool-result limit");
  const all = [];
  for (let q = {}; ; ) { const p = hailPage(view, q); all.push(...p.hails); if (!p.next_cursor) break; q = { cursor: p.next_cursor }; }
  assert.deepEqual(all, view.hails);
  const longs = hailPage(view, { kind: "long haul", limit: 200 });
  assert.ok(longs.hails.length > 0 && longs.hails.every((h) => h.kind === "long haul"));
  const from = view.hails[0].from;
  assert.ok(hailPage(view, { from: from.name.toUpperCase(), limit: 200 }).hails.every((h) => h.from.id === from.id));
  assert.equal(hailPage(view, { to: "nowhere" }).matching, 0);
  assert.match(hailPage(view, { cursor: "x" }).error, /cursor/);
  assert.deepEqual(hailPage(view, { limit: 200 }).hails, view.hails);
});

test("list_hails says when the season is too late to take a long haul", async () => {
  const { seasonClock } = await import("../src/game.js");
  const META = require("../src/engine/meta.json"), { t0_ms, len_days } = META.sky;
  const early = seasonClock(E, t0_ms + 10 * 1000);
  assert.deepEqual([early.quick_open, early.long_haul_open], [true, true]);
  const late = seasonClock(E, t0_ms + (len_days - 40) * 1000);
  assert.deepEqual([late.quick_open, late.long_haul_open], [true, false]);
  assert.match(late.note, /Long hauls can't be taken/);
  assert.equal(late.real_seconds_left, 39);
});

test("log rows are message style B: a worded chip, escaped words, the reason as Why, no coloured strip", () => {
  const chip = (e) => AgentLog.chip(AgentLog.line(e));
  assert.deepEqual(chip({ tool: "plan_ride", leg_id: "l" }), ["Plan", "plan"]);
  assert.deepEqual(chip({ tool: "check_pad", place: "ISS" }), ["Plan", "plan"]);
  assert.deepEqual(chip({ tool: "dispatch", car: "SF-01" }), ["Dispatch", "dispatch"]);
  assert.deepEqual(chip({ tool: "decide", checkpoint: 1 }), ["Checkpoint", "checkpoint"]);
  assert.deepEqual(chip({ tool: "dispatch", problems: ["late"] }), ["Refused", "refused"]);
  assert.deepEqual(chip({ tool: "take_hail" }), ["Take", "neutral"]);
  assert.deepEqual(chip({ tool: "get_my_rides" }), ["System", "neutral"]);
  const ms = new Date(2026, 9, 20, 9, 5).getTime();
  const html = AgentLog.row(AgentLog.line({ tool: "dispatch", car: "SF-01", fare_usd: 10, arrival: "x", note: "<b>closest</b>" }), { ms, attrs: 'data-i="0"' });
  assert.match(html, /^<li class="mb" data-i="0"><span class="mb-t" title="[^"]+">09:05<\/span><span class="mb-c dispatch">Dispatch<\/span>/);
  assert.match(html, /<span class="mb-w">Why: <q>&lt;b&gt;closest&lt;\/b&gt;<\/q><\/span>/);
  assert.doesNotMatch(html, /border-left|style=/);
  assert.doesNotMatch(AgentLog.row(AgentLog.line({ tool: "take_hail" }), { inner: true }), /<li/);
  const css = readFileSync(new URL("../../design/assets/message-b.css", import.meta.url), "utf8");
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /border-left|inset \d/);
});
