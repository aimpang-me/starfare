// End-to-end check of the Starfare connector (ride hails). Starts `wrangler dev` (real workerd, local Durable Objects) and
// drives it with the MCP SDK v1 client, like a Grok bot would. Scores are cross-checked against the engine run directly
// in Node on the same legs: SOLE.R.fly through the season's simulated hazards (seed = the season number the run reports),
// then SOLE.R.score with ctx.flown. Two modes, both run by default:
//   off: --var STARFARE_OAUTH:off, no auth (wrangler.jsonc ships with "on").
//   on:  STARFARE_OAUTH=on. The SDK's own OAuth client does what grok.com did with Wingbot: follow the 401 to the
//        metadata, register itself (DCR), authorize with PKCE, press Allow on the consent page, exchange the
//        code, then play a hail with the access token.
// Run: node build.mjs && node test/e2e.mjs [--mode=off|on|both]
// The hazard seed is the season, so a run that straddles a season reset (the last ~minute of a 7000 s season) can fail; rerun.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { SEASON_END, computeLeg, isoJD } from "../src/game.js";

const DIR = fileURLToPath(new URL("..", import.meta.url));
const MODE = (process.argv.find((a) => a.startsWith("--mode=")) || "--mode=both").slice(7);
if (!["off", "on", "both"].includes(MODE)) throw new Error("--mode must be off, on or both");
const E = createRequire(import.meta.url)("../src/engine/sol-page.cjs");
const R = E.R;
const TOOLS = ["check_pad", "decide", "dispatch", "get_hail", "get_my_rides", "list_hails", "plan_pickup", "plan_ride", "space_weather", "take_hail"];

const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS  ${name}`); }
  catch (error) { results.push({ name, ok: false }); console.log(`FAIL  ${name}\n      ${String(error?.stack ?? error).split("\n").slice(0, 6).join("\n      ")}`); }
}
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const running = new Set();
process.on("exit", () => { for (const c of running) try { process.kill(-c.pid, "SIGKILL"); } catch {} });

async function startWorker(vars = {}) {
  const port = await freePort(), persist = mkdtempSync(join(tmpdir(), "sol-e2e-")), log = [];
  const args = [join(DIR, "node_modules", "wrangler", "bin", "wrangler.js"), "dev", "--port", String(port), "--ip", "127.0.0.1", "--persist-to", persist];
  for (const [k, v] of Object.entries(vars)) args.push("--var", `${k}:${v}`);
  const child = spawn(process.execPath, args, { cwd: DIR, detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" } });
  running.add(child);
  child.stdout.on("data", (c) => log.push(String(c))); child.stderr.on("data", (c) => log.push(String(c)));
  let exited = false; child.on("exit", () => { exited = true; });
  const base = `http://127.0.0.1:${port}`, deadline = Date.now() + 180_000;
  for (;;) {
    if (exited) throw new Error(`wrangler dev exited early:\n${log.join("").slice(-2000)}`);
    if (Date.now() > deadline) throw new Error(`wrangler dev not ready:\n${log.join("").slice(-2000)}`);
    try { await fetch(`${base}/`); break; } catch { await sleep(250); }
  }
  return { base, log, stop: async () => { try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} } running.delete(child); await sleep(300); try { rmSync(persist, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} } };
}

async function connect(base, kind = "streamable-http", opts) {
  const client = new Client({ name: "sol-e2e", version: "1" });
  const url = new URL(`${base}/mcp`);
  await client.connect(kind === "sse" ? new SSEClientTransport(url, opts) : new StreamableHTTPClientTransport(url, opts));
  return client;
}
async function call(client, name, args = {}) {
  const t = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return { isError: r.isError === true, value, ms: Date.now() - t };
}
let scored = 0; // dispatches that locked a score, for the board check
const timings = []; // wall time per tool call through wrangler dev (includes MCP + Durable Object hops)
async function ok(client, name, args) {
  const r = await call(client, name, args);
  timings.push({ tool: name, what: args?.hail_id ?? args?.car ?? args?.after_leg ?? "", ms: r.ms });
  assert.equal(r.isError, false, `${name} failed: ${JSON.stringify(r.value)}`);
  return r.value;
}

const jdOf = (s) => Date.parse(s.replace(" ", "T") + ":00Z") / 864e5 + 2440587.5;

/** Re-run the same hail in Node with the engine directly: same t0, season seed, car and legs (the pickup leaves when the
 *  car is free), then R.fly through the season's hazards and R.score with ctx.flown, as the connector does. */
function nodeScore(hailId, riderReady, season, carId, planCalls, quote, objective = "energy") {
  const t0 = jdOf(riderReady), h = R.BY[hailId], car = R.CAR[carId], seed = String(season);
  const T = R.terms(hailId, t0, SEASON_END, seed);
  const p = computeLeg(E, car.at, h.from, R.pickupStart(hailId, carId, t0, seed), objective, SEASON_END);
  const r = computeLeg(E, h.from, h.to, p.arr_jd + R.DWELL, objective, SEASON_END);
  const q = quote === "exact" ? { fare_usd: r.fare, arrival: isoJD(r.arr_jd) } : quote;
  const F = R.fly(hailId, carId, [p, r], t0, seed);
  const s = R.score(hailId, [p, r], { t0, arrive_by_jd: T.arrive_by_jd, par_kwh: T.par.kwh, best_wait_days: T.par.best_wait_days, plan_calls: planCalls, quote: q, flown: F });
  return { T, p, r, F, s };
}

/** take_hail, plan_pickup with one car, plan_ride after it, dispatch with the ride leg's own fare and arrival (or a given quote).
 *  ask "never" flies the default answer at every checkpoint, which is what R.fly does in Node. */
async function playHail(client, hailId, car, { quote = "exact", objective, ask = "never" } = {}) {
  timings.push({ tool: `--- ${hailId} ${car ?? "par car"}` });
  const hail = await ok(client, "take_hail", { hail_id: hailId });
  car ??= nodeParCar(hail);
  const pickup = await ok(client, "plan_pickup", { run_id: hail.run_id, car, ...(objective ? { objective } : {}) });
  const ride = await ok(client, "plan_ride", { run_id: hail.run_id, after_leg: pickup.leg_id, ...(objective ? { objective } : {}) });
  const q = quote === "exact" ? { quoted_fare_usd: ride.fare_usd, quoted_arrival: ride.arrive } : typeof quote === "function" ? quote(ride) : quote;
  const score = await ok(client, "dispatch", { run_id: hail.run_id, pickup_leg: pickup.leg_id, ride_leg: ride.leg_id, ...q, ask_after_hours: ask });
  if (score.ok && score.status !== "checkpoint") scored++;
  return { hail, car, pickup, ride, score };
}
/** The par car, as the engine computes it in Node for the hail's rider_ready time and season. */
function nodeParCar(hail) { return R.terms(hail.hail_id, jdOf(hail.rider_ready), SEASON_END, String(hail.season)).par.car; }

/** Score fields equal R.score on the same legs in Node, part by part. */
function assertMatchesNode(play, planCalls, quote = "exact") {
  const { T, s, r, F } = nodeScore(play.hail.hail_id, play.hail.rider_ready, play.hail.season, play.car, planCalls, quote);
  assert.equal(play.hail.arrive_by, isoJD(T.arrive_by_jd));
  assert.equal(play.score.season, play.hail.season);
  // what actually happened
  assert.equal(play.score.extra_kwh, F.extra_kwh); assert.equal(play.score.planned_kwh, F.planned_kwh);
  assert.equal(play.score.planned_arrive, isoJD(r.arr_jd)); assert.equal(play.score.delay_hours, Math.round(F.delay_hours * 10) / 10);
  assert.deepEqual(play.score.incidents.map((x) => [x.kind, x.leg, x.at, x.kwh]), F.incidents.map((x) => [x.kind, x.leg, isoJD(x.at_jd), x.kwh]));
  assert.equal(play.score.log.hail, play.hail.hail_id); assert.equal(play.score.log.total, s.total); assert.equal(play.score.log.incidents.length, F.incidents.length);
  assert.equal(play.score.total, s.total, `connector ${play.score.total} vs Node ${s.total}`);
  assert.equal(play.score.used_kwh, s.used_kwh);
  assert.equal(play.score.par_kwh, T.par.kwh);
  assert.equal(play.score.par_car, R.CAR[T.par.car].name);
  assert.equal(play.score.fare_usd, r.fare);
  assert.equal(play.score.arrive, isoJD(s.arrive_jd));
  assert.equal(play.score.pickup, isoJD(s.pickup_jd));
  assert.deepEqual(play.score.parts.map((p) => [p.key, p.got, p.max]), s.parts.map((p) => [p.key, p.got, p.max]));
  return s;
}
const partsStr = (score) => score.parts.map((p) => `${p.key} ${p.got}/${p.max}`);

async function phaseOff() {
  console.log("\n== STARFARE_OAUTH=off (default) ==");
  const report = {};
  const w = await startWorker({ STARFARE_OAUTH: "off" }); // wrangler.jsonc ships "on" (the live setting)
  console.log(`wrangler dev up at ${w.base}`);
  const client = await connect(w.base);

  await check("GET / is the landing page: the connector URL, the hails and fleet as data, and a cacheable engine script", async () => {
    const r = await fetch(`${w.base}/`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /^text\/html/);
    const html = await r.text();
    for (const s of ["Starfare", "Works with Grok", `${w.base}/mcp`, "grok.com/connectors", "/board.json", "/rides/&lt;run_id&gt;.json"]) assert.ok(html.includes(s), s);
    assert.doesNotMatch(html, /__(SITE|ORIGIN|ENGINE_URL)__/);
    const site = JSON.parse(/window\.SITE = (.*);<\/script>/.exec(html)[1]);
    assert.deepEqual(site.hails.map((h) => h.hail_id), R.HAILS.map((h) => h.id));
    assert.deepEqual(site.fleet.map((c) => [c.car, c.parked_at.id]), R.FLEET.map((c) => [c.id, c.at]));
    const src = /<script src="(\/engine\.js\?v=[0-9a-f]{16})"/.exec(html)[1];
    const js = await fetch(`${w.base}${src}`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type"), /^text\/javascript/);
    assert.match(js.headers.get("cache-control"), /immutable/);
    assert.ok((await js.text()).includes("module.exports = SOLE"));
  });
  await check("tools/list is exactly the ten ride-hail tools", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, TOOLS);
  });
  await check("list_hails returns the engine's hails (SOLE.R.HAILS) and the fleet", async () => {
    const r = await ok(client, "list_hails");
    assert.deepEqual(r.hails.map((h) => h.hail_id), R.HAILS.map((h) => h.id));
    for (const h of r.hails) { const e = R.BY[h.hail_id]; assert.equal(h.from.id, e.from); assert.equal(h.to.id, e.to); assert.equal(h.title, e.title); assert.match(h.rider, /\(simulated\)$/); }
    assert.deepEqual(r.fleet.map((c) => [c.car, c.parked_at.id]), R.FLEET.map((c) => [c.id, c.at]));
    assert.equal(r.board, "/board");
    report.list = r.hails.map((h) => `${h.hail_id} ${h.kind}: ${h.from.name} to ${h.to.name}`);
  });

  let good;
  const bestOf = {}; // best total per hail, for the board check
  const noteBest = (p) => { if (p.score.ok) bestOf[p.hail.hail_id] = Math.max(bestOf[p.hail.hail_id] ?? -1, p.score.total); return p; };
  await check("iss-crew: take_hail, plan_pickup (par car), plan_ride, dispatch with the leg's fare and arrival; the result says what actually happened", async () => {
    good = noteBest(await playHail(client, "iss-crew"));
    const { hail, pickup, ride, score } = good;
    assert.match(hail.run_id, /^run_[0-9a-f]{20}$/);
    assert.match(hail.rider_ready, / 00:00$/);
    assert.equal(hail.fleet.length, R.FLEET.length); assert.equal(hail.boarding_hours, 1.2); assert.equal(hail.dispatched, false);
    assert.equal(pickup.kind, "pickup"); assert.equal(pickup.car, good.car); assert.equal(ride.kind, "ride");
    assert.equal(ride.from, pickup.to); assert.equal(ride.to, hail.destination.name); assert.equal(pickup.to, hail.pickup_at.name);
    assert.ok(jdOf(ride.depart) >= jdOf(pickup.arrive) + R.DWELL - 1 / 1440, `${ride.depart} vs ${pickup.arrive}`);
    for (const L of [pickup, ride]) assert.ok(L.refly.result === "PASS" || /local/.test(L.refly.result), JSON.stringify(L.refly));
    assert.equal(score.ok, true); assert.equal(score.out_of, 100); assert.equal(score.parts.reduce((a, p) => a + p.max, 0), 100);
    assert.deepEqual(score.parts.map((p) => p.key), ["pickup", "on_time", "energy", "promise", "checker", "fare", "economy"]);
    assert.equal(score.planned_by, "Grok bot (connector)");
    assert.equal(score.promised_arrival, ride.arrive); assert.equal(score.planned_arrive, ride.arrive);
    assert.ok(jdOf(score.arrive) >= jdOf(ride.arrive) - 1 / 1440 && jdOf(score.pickup) >= jdOf(pickup.arrive) - 1 / 1440);
    assert.equal(score.used_kwh, score.planned_kwh + score.extra_kwh);
    for (const x of score.incidents) assert.deepEqual(Object.keys(x).sort(), ["at", "hours", "kind", "kwh", "leg", "note", "place"]);
    assert.ok(Number.isInteger(hail.season) && hail.season >= 1);
    report.good = { run_id: hail.run_id, season: hail.season, rider_ready: hail.rider_ready, arrive_by: hail.arrive_by, car: score.car, par_car: score.par_car,
      legs: [pickup, ride].map((L) => `${L.leg_id} ${L.kind} ${L.from} -> ${L.to} ${L.battery_kwh} kWh $${L.fare_usd} ${L.refly.result}`), total: score.total, parts: partsStr(score),
      happened: { pickup: score.pickup, arrive: score.arrive, delay_hours: score.delay_hours, extra_kwh: score.extra_kwh, incidents: score.incidents.map((x) => `${x.kind} ${x.leg} ${x.place} ${x.hours} h ${x.kwh} kWh`) } };
  });
  await check("iss-crew score matches SOLE.R.fly + SOLE.R.score run directly in Node on the same legs and season seed", async () => {
    const s = assertMatchesNode(good, 2);
    report.node = { total: s.total, used_kwh: s.used_kwh };
  });
  await check("after dispatch the run is locked; a second dispatch returns the same locked score", async () => {
    const again = await ok(client, "dispatch", { run_id: good.hail.run_id, pickup_leg: good.pickup.leg_id, ride_leg: good.ride.leg_id, quoted_fare_usd: 0, quoted_arrival: "" });
    assert.equal(again.already_dispatched, true); assert.equal(again.total, good.score.total);
    const p = await call(client, "plan_pickup", { run_id: good.hail.run_id, car: "sf-01" });
    assert.equal(p.isError, true); assert.match(p.value, /already been dispatched/);
    const info = await ok(client, "get_hail", { run_id: good.hail.run_id });
    assert.equal(info.dispatched, true); assert.equal(info.plans_used, 2); assert.equal(info.phase, "arrived");
    const late = await call(client, "decide", { run_id: good.hail.run_id, checkpoint: 1, action: "wait" });
    assert.equal(late.isError, true); assert.match(late.value, /checkpoint 1 has not happened; the ride arrived after 0 checkpoints/);
    const fresh = await ok(client, "take_hail", { hail_id: "iss-crew" });
    const early = await call(client, "decide", { run_id: fresh.run_id, checkpoint: 1, action: "wait" });
    assert.equal(early.isError, true); assert.match(early.value, /dispatch first/);
  });

  await check("a ride that stops at checkpoints (ask_after_hours 0), answered with decide's defaults, lands where R.fly does in Node; get_hail shows the open checkpoint", async () => {
    const tried = [];
    let stop = null;
    for (const hailId of ["iss-crew", "phobos-commute", "jovian-hop"]) { // titan-home stays unplayed for the board's empty-row check
      for (const car of R.FLEET.map((c) => c.id)) {
        const play = await playHail(client, hailId, car, { ask: 0 });
        tried.push(`${hailId} ${car} ${play.score.status ?? "refused"}`);
        if (play.score.status === "checkpoint") { stop = play; break; }
        noteBest(play);
      }
      if (stop) break;
    }
    assert.ok(stop, "no ride stopped in " + tried.join(", "));
    const seen = [];
    let out = stop.score;
    while (out.status === "checkpoint") {
      const s = out.situation, info = await ok(client, "get_hail", { run_id: stop.hail.run_id });
      assert.equal(info.phase, "in_flight"); assert.deepEqual(info.situation, s);
      assert.equal(s.ask_after_hours, 0); assert.match(s.note, /Simulated/);
      const pad = await ok(client, "check_pad", { run_id: stop.hail.run_id, place: s.place.id, hours: 1 });
      assert.equal(pad.from, s.sky_at);
      seen.push(`${s.checkpoint} ${s.kind} ${s.cause} ${s.place.id} ${s.sky_at} -> ${s.default.action}`);
      const answer = { run_id: stop.hail.run_id, checkpoint: s.checkpoint, ...s.default };
      out = await ok(client, "decide", answer);
      const again = await ok(client, "decide", answer);
      assert.equal(again.already_decided, true);
    }
    assert.equal(out.status, "arrived"); assert.equal(out.checkpoints, seen.length);
    stop.score = out; scored++; noteBest(stop);
    assertMatchesNode(stop, 2);
    assert.deepEqual(out.log.checkpoints.map((c) => c.n), seen.map((_, i) => i + 1));
    for (const c of out.log.checkpoints) assert.ok(c.options_hindsight.length >= 2 && typeof c.best === "string", JSON.stringify(c));
    report.checkpoints = { tried, hail: stop.hail.hail_id, car: stop.car, seen, total: out.total, used_kwh: out.used_kwh, hindsight: out.log.checkpoints.map((c) => [c.n, c.best]) };
  });

  let far;
  await check("iss-crew with a farther car (SF-02 from the Lunar Data Center) scores lower, and matches Node", async () => {
    far = noteBest(await playHail(client, "iss-crew", "sf-02"));
    assert.ok(far.score.total < good.score.total, `far ${far.score.total} vs par ${good.score.total}`);
    assertMatchesNode(far, 2);
    report.far = { car: far.score.car, total: far.score.total, used_kwh: Math.round(far.score.used_kwh), parts: partsStr(far.score) };
  });

  await check("a wrong quote (fare and an arrival years early) loses the fare 10 and the promise 15; a fare $5 off loses the fare 10; both match Node", async () => {
    const wrong = noteBest(await playHail(client, "iss-crew", undefined, { quote: { quoted_fare_usd: 1, quoted_arrival: "2020-01-01 00:00" } }));
    const got = (sc, k) => sc.parts.find((p) => p.key === k).got;
    assert.equal(got(wrong.score, "fare"), 0); assert.equal(got(wrong.score, "promise"), 0);
    assert.equal(wrong.score.promised_arrival, "2020-01-01 00:00"); assert.ok(wrong.score.promise_slip_hours > 24 * 365);
    assertMatchesNode(wrong, 2, { fare_usd: 1, arrival: "2020-01-01 00:00" });
    const half = noteBest(await playHail(client, "iss-crew", undefined, { quote: (ride) => ({ quoted_fare_usd: ride.fare_usd + 5, quoted_arrival: ride.arrive }) }));
    assert.equal(got(half.score, "fare"), 0);
    assertMatchesNode(half, 2, { fare_usd: half.ride.fare_usd + 5, arrival: half.ride.arrive });
    report.wrong_quote = { total: wrong.score.total, promise_note: wrong.score.parts.find((p) => p.key === "promise").note, fare_off_by_5_total: half.score.total };
  });

  await check("get_hail fleet: every car is free or busy_until, as SOLE.R.fleetState says for the run's season seed", async () => {
    const info = await ok(client, "get_hail", { run_id: good.hail.run_id });
    const st = R.fleetState("iss-crew", jdOf(info.rider_ready), String(info.season));
    assert.deepEqual(info.fleet.map((c) => [c.car, c.busy_until]), st.map((c) => [c.car, c.busy_until_jd ? isoJD(c.busy_until_jd) : "free"]));
    assert.match(info.rules, /unscheduled/); assert.match(info.rules, /250 kWh an hour/); assert.match(info.rules, /promise/); assert.match(info.rules, /rider aboard/);
    report.fleet = info.fleet.map((c) => `${c.car} ${c.busy_until}`);
  });

  await check("busy car: plan_pickup leaves no earlier than the car's busy_until and says so", async () => {
    let found = null;
    for (const hailId of ["iss-crew", "phobos-commute", "jovian-hop"]) {
      const h = await ok(client, "take_hail", { hail_id: hailId });
      const busy = h.fleet.find((c) => c.busy_until !== "free" && c.parked_at.id !== R.BY[hailId].from);
      if (busy) { found = { h, busy }; break; }
    }
    assert.ok(found, "no busy car in three hails");
    const p = await ok(client, "plan_pickup", { run_id: found.h.run_id, car: found.busy.car });
    assert.equal(p.car_busy_until, found.busy.busy_until); assert.match(p.note, /busy on another job/);
    assert.ok(jdOf(p.depart) >= jdOf(found.busy.busy_until) - 1 / 1440, `${p.depart} before ${found.busy.busy_until}`);
    assert.equal(p.plans_used, 1);
    report.busy = { hail: found.h.hail_id, car: found.busy.car, rider_ready: found.h.rider_ready, busy_until: found.busy.busy_until, depart: p.depart, note: p.note };
  });

  await check("check_pad and space_weather: free, the engine's forecasts for the run's seed, booked berths and odds only; bad input refused; noted in the dispatch log", async () => {
    const h = await ok(client, "take_hail", { hail_id: "iss-crew" }), seed = String(h.season), t0 = jdOf(h.rider_ready);
    const pad = await ok(client, "check_pad", { run_id: h.run_id, place: "ISS", hours: 72 });
    const f = R.padForecast("iss", t0, 72, "iss-crew", t0, seed);
    assert.deepEqual(pad.place, { id: "iss", name: h.pickup_at.name }); assert.equal(pad.berths, f.berths); assert.equal(pad.from, h.rider_ready);
    assert.deepEqual(pad.hours.map((x) => [x.hour, x.booked]), f.hours.map((x) => [isoJD(x.hour_jd), x.booked]));
    assert.match(pad.note, /unscheduled/); assert.equal(pad.local_weather, null);
    // a place with no rush: booked is exactly the scheduled ships, never the unscheduled ones
    const H = R.hazards(seed), ldc = await ok(client, "check_pad", { run_id: h.run_id, place: "lunar-data-center", hours: 72, from: h.rider_ready });
    let hidden = 0;
    ldc.hours.forEach((x) => { const n = Math.round(jdOf(x.hour) * 24), all = H.docked("lunar-data-center", n, null), sched = H.docked("lunar-data-center", n, null, true); assert.equal(x.booked, sched); assert.ok(x.booked <= all); hidden += all - sched; });
    const mars = await ok(client, "check_pad", { run_id: h.run_id, place: "Mars Base", hours: 48 });
    assert.equal(mars.local_weather.kind, "dust_storm");
    assert.deepEqual(mars.local_weather.days.map((d) => d.odds), R.weatherForecast("mars-base", t0, mars.local_weather.days.length, seed).days.map((d) => d.odds));
    const sw = await ok(client, "space_weather", { run_id: h.run_id, days: 30 });
    assert.deepEqual(sw.days.map((d) => [d.from, d.flare_odds]), R.flareForecast(t0, 30, seed).map((d) => [isoJD(d.day_jd), d.flare_odds]));
    for (const d of sw.days) assert.deepEqual(Object.keys(d).sort(), ["flare_odds", "from", "to"]);
    assert.equal((await ok(client, "space_weather", { run_id: h.run_id })).days.length, 10);
    for (const [tool, args, re] of [["check_pad", { place: "nowhere" }, /unknown place nowhere/], ["check_pad", { place: "constructor" }, /unknown place/], ["check_pad", { place: "iss", from: "2030-02-30 00:00" }, /from must be/]]) {
      const r = await call(client, tool, { run_id: h.run_id, ...args });
      assert.equal(r.isError, true, JSON.stringify(r.value)); assert.match(String(r.value), re);
    }
    for (const [tool, args] of [["check_pad", { place: "iss", hours: 73 }], ["check_pad", { place: "iss", from: "tomorrow" }], ["space_weather", { days: 61 }], ["space_weather", { days: 0 }]]) {
      const r = await call(client, tool, { run_id: h.run_id, ...args }).catch((e) => ({ isError: true, value: String(e.message) }));
      assert.equal(r.isError, true, `${tool} ${JSON.stringify(args)} was accepted`);
    }
    const info = await ok(client, "get_hail", { run_id: h.run_id });
    assert.equal(info.plans_used, 0);
    const p = await ok(client, "plan_pickup", { run_id: h.run_id, car: nodeParCar(h) }), r = await ok(client, "plan_ride", { run_id: h.run_id, after_leg: p.leg_id });
    const d = await ok(client, "dispatch", { run_id: h.run_id, pickup_leg: p.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare_usd, quoted_arrival: r.arrive, ask_after_hours: "never" });
    scored++; noteBest({ hail: h, score: d });
    assert.equal(d.parts.find((x) => x.key === "economy").note, "2 plans, 6 free");
    assert.deepEqual(d.log.forecasts.map((x) => x.tool), ["check_pad", "check_pad", "check_pad", "space_weather", "space_weather"]);
    assert.deepEqual(d.log.planned.map((x) => x.leg), [p.leg_id, r.leg_id]);
    report.forecasts = { pad_iss_first_hours: pad.hours.slice(0, 4), ldc_hidden_ship_hours: hidden, mars_weather: mars.local_weather.days.slice(0, 2), flare_odds: sw.days.slice(0, 3).map((x) => x.flare_odds), log_forecasts: d.log.forecasts };
  });

  await check("bad leg ids are refused (plan_ride after_leg, dispatch) and refusals are not counted as plans", async () => {
    const h = await ok(client, "take_hail", { hail_id: "iss-crew" });
    const u = await call(client, "plan_ride", { run_id: h.run_id, after_leg: "leg999" });
    assert.equal(u.isError, true); assert.match(u.value, /unknown leg_id leg999/);
    const proto = await call(client, "plan_ride", { run_id: h.run_id, after_leg: "constructor" });
    assert.equal(proto.isError, true); assert.match(proto.value, /unknown leg_id constructor/);
    const c = await call(client, "plan_pickup", { run_id: h.run_id, car: "sol-99" });
    assert.equal(c.isError, true); assert.match(c.value, /unknown car sol-99/);
    const p = await ok(client, "plan_pickup", { run_id: h.run_id, car: "sf-01" });
    assert.equal(p.plans_used, 1);
    const r = await ok(client, "plan_ride", { run_id: h.run_id, after_leg: p.leg_id });
    const rr = await call(client, "plan_ride", { run_id: h.run_id, after_leg: r.leg_id });
    assert.equal(rr.isError, true); assert.match(rr.value, /is a ride leg/);
    const d1 = await ok(client, "dispatch", { run_id: h.run_id, pickup_leg: "forged", ride_leg: r.leg_id, quoted_fare_usd: r.fare_usd, quoted_arrival: r.arrive });
    assert.equal(d1.ok, false); assert.ok(d1.problems.some((x) => /unknown pickup_leg forged/.test(x)), JSON.stringify(d1.problems));
    const d2 = await ok(client, "dispatch", { run_id: h.run_id, pickup_leg: r.leg_id, ride_leg: p.leg_id, quoted_fare_usd: r.fare_usd, quoted_arrival: r.arrive });
    assert.equal(d2.ok, false); assert.ok(d2.problems.some((x) => /is not a pickup leg/.test(x)) && d2.problems.some((x) => /is not a ride leg/.test(x)), JSON.stringify(d2.problems));
    // leg ids from another run are just as unknown here
    const d3 = await ok(client, "dispatch", { run_id: h.run_id, pickup_leg: "leg9", ride_leg: "leg10", quoted_fare_usd: 0, quoted_arrival: "" });
    assert.equal(d3.ok, false); assert.ok(d3.problems.every((x) => /unknown (pickup|ride)_leg/.test(x)));
    // a ride planned after SF-01's pickup, dispatched with SF-02's later pickup: the rider has not boarded yet
    const p2 = await ok(client, "plan_pickup", { run_id: h.run_id, car: "sf-02" });
    let mixed = null;
    if (jdOf(p2.arrive) + R.DWELL > jdOf(r.depart) + 1 / 1440) {
      mixed = await ok(client, "dispatch", { run_id: h.run_id, pickup_leg: p2.leg_id, ride_leg: r.leg_id, quoted_fare_usd: r.fare_usd, quoted_arrival: r.arrive });
      assert.equal(mixed.ok, false); assert.ok(mixed.problems.some((x) => /before the rider has boarded/.test(x)), JSON.stringify(mixed.problems));
    }
    const info = await ok(client, "get_hail", { run_id: h.run_id });
    assert.equal(info.plans_used, 3); assert.equal(info.dispatched, false);
    report.bad_legs = { plan_ride: u.value, ride_after_ride: rr.value, unknown_car: c.value, forged: d1.problems, swapped: d2.problems, other_run: d3.problems, mixed: mixed && mixed.problems };
  });
  await check("unknown or malformed run_id is rejected; unknown hail_id is refused", async () => {
    const r = await call(client, "get_hail", { run_id: "run_" + "0".repeat(20) });
    assert.equal(r.isError, true); assert.match(r.value, /unknown run_id/);
    const r2 = await call(client, "get_hail", { run_id: "../../etc" }).catch((e) => ({ isError: true, value: String(e.message) }));
    assert.equal(r2.isError, true);
    const r3 = await call(client, "plan_pickup", { run_id: "run_" + "f".repeat(20), car: "sf-01" });
    assert.equal(r3.isError, true); assert.match(r3.value, /unknown run_id/);
    const h1 = await call(client, "take_hail", { hail_id: "lunch-rush" });
    assert.equal(h1.isError, true); assert.match(h1.value, /unknown hail_id lunch-rush/);
    const h2 = await call(client, "take_hail", { hail_id: "constructor" });
    assert.equal(h2.isError, true); assert.match(h2.value, /unknown hail_id constructor/);
    report.bad_ids = { unknown_run: r.value, malformed_run: String(r2.value).slice(0, 160), unknown_hail: h1.value, proto_hail: h2.value };
  });

  let long;
  await check("ceres-shift (long haul): take_hail, plan_pickup (par car), plan_ride re-flown PASS, dispatch, matches Node", async () => {
    const t = Date.now();
    long = noteBest(await playHail(client, "ceres-shift"));
    assert.equal(long.ride.refly.result, "PASS", JSON.stringify(long.ride.refly));
    assert.equal(long.score.ok, true);
    const s = assertMatchesNode(long, 2);
    // rider_ready is LEAD sky days after take_hail began; sky_now is read when take_hail answers, after the terms (a few s)
    const lead = jdOf(long.hail.rider_ready) - jdOf(long.hail.sky_now);
    assert.ok(lead > R.LEAD - 15 && lead <= R.LEAD + 0.5, `${long.hail.rider_ready} vs now ${long.hail.sky_now}`);
    report.long = { rider_ready: long.hail.rider_ready, sky_now: long.hail.sky_now, arrive_by: long.hail.arrive_by, car: long.score.car,
      legs: [long.pickup, long.ride].map((L) => `${L.from} -> ${L.to} ${L.battery_kwh} kWh $${L.fare_usd} ${L.refly.result === "PASS" ? `PASS miss ${L.refly.final_miss_km} km` : L.refly.result}`),
      total: long.score.total, node_total: s.total, parts: partsStr(long.score), wall_ms: Date.now() - t };
  });

  await check("re-fly cache: the same pickup parameters are served from the cache", async () => {
    const h = await ok(client, "take_hail", { hail_id: "phobos-commute" });
    const a = await ok(client, "plan_pickup", { run_id: h.run_id, car: "sf-01" });
    const b = await ok(client, "plan_pickup", { run_id: h.run_id, car: "sf-01" });
    assert.equal(b.cached, true); assert.equal(b.battery_kwh, a.battery_kwh); assert.equal(b.plans_used, 2); assert.notEqual(b.leg_id, a.leg_id);
    const tA = Date.now(); await ok(client, "plan_pickup", { run_id: h.run_id, car: "sf-01" });
    report.cache = { first_cached: a.cached, second_cached: b.cached, first_ms: timings.at(-3).ms, cached_call_ms: Date.now() - tA };
  });
  await check("one run per session: a new take_hail abandons the open run and says so in previous_run", async () => {
    const h1 = await ok(client, "take_hail", { hail_id: "jovian-hop" });
    const h2 = await ok(client, "take_hail", { hail_id: "phobos-commute" });
    assert.deepEqual(h2.previous_run, { run_id: h1.run_id, status: "abandoned" });
    const p = await call(client, "plan_pickup", { run_id: h1.run_id, car: "sf-05" });
    assert.equal(p.isError, true); assert.match(p.value, /abandoned/);
    const d = await call(client, "dispatch", { run_id: h1.run_id, pickup_leg: "leg1", ride_leg: "leg2", quoted_fare_usd: 0, quoted_arrival: "" });
    assert.equal(d.isError, true); assert.match(d.value, /abandoned/);
  });
  await check("SSE transport also works (list_hails, take_hail, get_hail)", async () => {
    const sse = await connect(w.base, "sse");
    try {
      assert.equal((await ok(sse, "list_hails")).hails.length, R.HAILS.length);
      const h = await ok(sse, "take_hail", { hail_id: "iss-crew" });
      assert.equal((await ok(sse, "get_hail", { run_id: h.run_id })).hail_id, "iss-crew");
    } finally { await sse.close(); }
  });
  await check("GET /board and /board.json: best per hail with hail titles, labelled planned by Grok bot", async () => {
    const j = await (await fetch(`${w.base}/board.json`)).json();
    assert.equal(j.label, "planned by Grok bot");
    assert.equal(j.best["iss-crew"].points, bestOf["iss-crew"]); assert.equal(j.best["iss-crew"].hail_id, "iss-crew");
    assert.equal(j.best["ceres-shift"].points, long.score.total);
    const row = j.best["ceres-shift"];
    assert.equal(row.kwh, Math.round(long.score.used_kwh)); assert.ok(Math.abs(row.wait_h - (jdOf(long.score.pickup) - jdOf(long.hail.rider_ready)) * 24) <= 0.06, `${row.wait_h} h vs actual pickup ${long.score.pickup}`);
    assert.equal(j.stats.runs_scored, scored);
    const r = await fetch(`${w.base}/board`);
    assert.match(r.headers.get("content-type"), /text\/html/);
    const html = await r.text();
    for (const h of R.HAILS) assert.ok(html.includes(h.title), `board is missing ${h.title}`);
    assert.match(html, /planned by Grok bot/); assert.match(html, /Claude and human runs are on the in-page board/); assert.match(html, /kept the promised arrival 15/);
    assert.match(html, /no connector runs yet/); // titan-home etc. have no runs
    report.board = j;
  });
  await check("off: no OAuth: /mcp needs no token, OAuth endpoints are 404, runs carry no player_id, get_my_rides asks for the sign-in", async () => {
    const r = await fetch(`${w.base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "curl", version: "1" } } }) });
    assert.equal(r.status, 200); assert.equal(r.headers.get("www-authenticate"), null); await r.body?.cancel();
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server", "/authorize", "/token", "/register"]) {
      const g = await fetch(`${w.base}${path}`, { redirect: "manual" });
      assert.equal(g.status, 404, path); await g.body?.cancel();
    }
    assert.equal(good.hail.player_id, undefined); assert.equal(good.score.player_id, undefined);
    assert.equal(report.board.best["iss-crew"].player_tag, undefined);
    const h = await call(client, "get_my_rides", {});
    assert.equal(h.isError, true); assert.match(h.value, /sign-in \(OAuth\)/);
  });
  await client.close();
  await w.stop();

  await check("per-IP rate limit answers 429 past RATE_PER_MIN", async () => {
    const w2 = await startWorker({ STARFARE_OAUTH: "off", RATE_PER_MIN: "5" });
    try {
      const statuses = [];
      for (let i = 0; i < 7; i++) {
        const r = await fetch(`${w2.base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "curl", version: "1" } } }) });
        statuses.push(r.status); await r.body?.cancel();
      }
      assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
      const board = await fetch(`${w2.base}/board`); assert.equal(board.status, 200); await board.body?.cancel();
      report.rate = statuses;
    } finally { await w2.stop(); }
  });

  console.log("\n--- details ---\n" + JSON.stringify(report, null, 1));
  console.log("\n--- tool call wall times through wrangler dev ---");
  for (const t of timings) console.log(t.ms === undefined ? t.tool : `${t.tool.padEnd(12)} ${String(t.what).padEnd(15)} ${t.ms} ms`);
}

// ---- STARFARE_OAUTH=on ------------------------------------------------------------------------------------------------

const REDIRECT_URI = "http://127.0.0.1:9/callback";
const noFollow = { redirect: "manual" };

class CookieJar {
  jar = new Map();
  absorb(res) { for (const line of res.headers.getSetCookie()) { const [pair] = line.split(";"); const at = pair.indexOf("="); this.jar.set(pair.slice(0, at), pair.slice(at + 1)); } }
  header() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
}

/** GET the consent page the way a browser would, check it is one click (no code or password field), press a button. */
async function consent(authUrl, decision = "approve") {
  const jar = new CookieJar();
  const page = await fetch(authUrl, noFollow);
  const html = await page.text();
  assert.equal(page.status, 200, html);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  jar.absorb(page);
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1];
  assert.ok(handle, "consent page has no handle");
  assert.match(html, /<button name="decision" value="approve">Allow<\/button>/);
  assert.match(html, /<button name="decision" value="deny">Deny<\/button>/);
  assert.doesNotMatch(html, /type="password"|name="code"/, "consent page must not ask for a code");
  const posted = await fetch(authUrl, { ...noFollow, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header() }, body: new URLSearchParams({ handle, decision }) });
  assert.equal(posted.status, 302, await posted.clone().text());
  return { html, location: new URL(posted.headers.get("location")) };
}

/** The SDK's OAuthClientProvider, as an MCP client app implements it. redirectToAuthorization only records the URL. */
class SdkAuth {
  constructor(name) { this.name = name; this.authUrl = null; this.client = undefined; this.saved = undefined; this.verifier = undefined; }
  get redirectUrl() { return REDIRECT_URI; }
  get clientMetadata() { return { client_name: this.name, redirect_uris: [REDIRECT_URI], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }; }
  state() { return "st-" + randomBytes(6).toString("hex"); }
  clientInformation() { return this.client; }
  saveClientInformation(c) { this.client = c; }
  tokens() { return this.saved; }
  saveTokens(t) { this.saved = t; }
  redirectToAuthorization(url) { this.authUrl = url; }
  saveCodeVerifier(v) { this.verifier = v; }
  codeVerifier() { return this.verifier; }
}

/** Records every request the SDK sends, so the test can show the order grok.com would follow. */
function tracingFetch(trace) {
  return async (url, init) => { const u = new URL(url); const r = await fetch(url, init); trace.push(`${init?.method ?? "GET"} ${u.pathname} ${r.status}`); return r; };
}

/** The whole SDK OAuth flow: connect (401), discovery, DCR, authorize with PKCE, Allow, finishAuth (token), reconnect. */
async function sdkSignIn(base, name) {
  const auth = new SdkAuth(name), trace = [], url = new URL(`${base}/mcp`);
  const first = new StreamableHTTPClientTransport(url, { authProvider: auth, fetch: tracingFetch(trace) });
  await assert.rejects(new Client({ name, version: "1" }).connect(first), (e) => {
    if (!(e instanceof UnauthorizedError)) throw new Error(`expected UnauthorizedError, got ${e}\nrequests so far:\n${trace.join("\n")}`);
    return true;
  });
  assert.ok(auth.authUrl, "SDK did not ask to open the authorization page");
  const { html, location } = await consent(auth.authUrl);
  assert.equal(location.origin + location.pathname, REDIRECT_URI);
  assert.equal(location.searchParams.get("state"), auth.authUrl.searchParams.get("state"));
  await first.finishAuth(location.searchParams.get("code"));
  trace.push("-- reconnect with the access token --");
  const client = new Client({ name, version: "1" });
  await client.connect(new StreamableHTTPClientTransport(url, { authProvider: auth, fetch: tracingFetch(trace) }));
  return { auth, trace, client, html };
}

async function phaseOn() {
  console.log("\n== STARFARE_OAUTH=on ==");
  const report = {};
  const w = await startWorker({ STARFARE_OAUTH: "on", RATE_PER_MIN: "1000" });
  const { base } = w;
  console.log(`wrangler dev up at ${base}`);
  let asMeta, a, b;
  try {
    await check("on: /, /engine.js, /board and /board.json stay public; /mcp without a token is 401", async () => {
      for (const path of ["/", "/engine.js", "/board", "/board.json"]) { const r = await fetch(`${base}${path}`); assert.equal(r.status, 200, path); await r.body?.cancel(); }
      await assert.rejects(connect(base), (e) => { assert.equal(e.code, 401, e.message); return true; });
      await assert.rejects(connect(base, "sse"), (e) => { assert.equal(e.code, 401, e.message); return true; });
      await assert.rejects(connect(base, "streamable-http", { requestInit: { headers: { Authorization: "Bearer not-a-token" } } }), (e) => { assert.equal(e.code, 401, e.message); return true; });
    });
    await check("on: the 401 points at protected-resource metadata; authorization-server metadata has DCR, PKCE S256, scope play", async () => {
      const r = await fetch(`${base}/mcp`, { method: "POST" });
      assert.equal(r.status, 401);
      const challenge = r.headers.get("www-authenticate") ?? "";
      const metaUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
      assert.ok(metaUrl, `no resource_metadata in: ${challenge}`);
      const meta = await (await fetch(metaUrl)).json();
      assert.equal(meta.resource, `${base}/mcp`); assert.deepEqual(meta.authorization_servers, [base]);
      const bare = await fetch(`${base}/.well-known/oauth-protected-resource`);
      assert.equal(bare.status, 200); assert.equal((await bare.json()).resource, `${base}/mcp`);
      asMeta = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
      assert.equal(asMeta.issuer, base);
      assert.equal(asMeta.authorization_endpoint, `${base}/authorize`); assert.equal(asMeta.token_endpoint, `${base}/token`); assert.equal(asMeta.registration_endpoint, `${base}/register`);
      assert.ok(asMeta.code_challenge_methods_supported.includes("S256"));
      assert.deepEqual(asMeta.scopes_supported, ["play"]);
      report.www_authenticate = challenge; report.protected_resource = meta;
    });
    await check("on: SDK OAuth flow: 401, discovery, dynamic registration, PKCE S256, one-click Allow, token, then tools/list is the ten ride-hail tools", async () => {
      a = await sdkSignIn(base, "sol e2e player A");
      const q = a.auth.authUrl.searchParams;
      assert.equal(q.get("code_challenge_method"), "S256"); assert.ok(q.get("code_challenge"));
      assert.equal(q.get("client_id"), a.auth.client.client_id);
      assert.equal(q.get("resource"), `${base}/mcp`);
      assert.ok(a.auth.saved.access_token && a.auth.saved.refresh_token);
      assert.ok(a.trace.some((t) => t.startsWith("POST /register 201")), a.trace.join("\n"));
      assert.ok(a.trace.some((t) => t.startsWith("POST /token 200")), a.trace.join("\n"));
      assert.match(a.html, /take ride hails/);
      const names = (await a.client.listTools()).tools.map((t) => t.name).sort();
      assert.deepEqual(names, TOOLS);
      report.sdk_requests = a.trace;
      report.authorize_query = Object.fromEntries([...q].map(([k, v]) => [k, k === "code_challenge" || k === "client_id" ? v.slice(0, 8) + "…" : v]));
    });
    if (!a) return;
    let good;
    await check("on: iss-crew over OAuth: take_hail, plan_pickup, plan_ride, dispatch; the run carries the grant's player id; the score matches Node", async () => {
      good = await playHail(a.client, "iss-crew");
      assert.match(good.hail.player_id, /^p_[0-9a-f]{16}$/);
      assert.equal(good.score.player_id, good.hail.player_id);
      const s = assertMatchesNode(good, 2);
      report.play = { run_id: good.hail.run_id, player_id: good.hail.player_id, car: good.score.car, total: good.score.total, node_total: s.total };
    });
    await check("on: a second grant is a different anonymous player; run_id rules unchanged (any session can address a run by its id, unknown ids rejected)", async () => {
      b = await sdkSignIn(base, "sol e2e player B");
      const m = await ok(b.client, "take_hail", { hail_id: "jovian-hop" });
      assert.match(m.player_id, /^p_[0-9a-f]{16}$/); assert.notEqual(m.player_id, good.hail.player_id);
      const seen = await ok(b.client, "get_hail", { run_id: good.hail.run_id });
      assert.equal(seen.run_id, good.hail.run_id); assert.equal(seen.player_id, good.hail.player_id);
      const u = await call(b.client, "get_hail", { run_id: "run_" + "0".repeat(20) });
      assert.equal(u.isError, true); assert.match(u.value, /unknown run_id/);
      report.second_player = m.player_id;
    });
    await check("on: /board shows the best run with its player tag", async () => {
      const j = await (await fetch(`${base}/board.json`)).json();
      assert.equal(j.best["iss-crew"].player_tag, good.hail.player_id.slice(2, 8));
      const html = await (await fetch(`${base}/board`)).text();
      assert.ok(html.includes(`planned by Grok bot · player ${good.hail.player_id.slice(2, 8)}`));
      assert.ok(html.includes(R.BY["iss-crew"].title));
      report.board_row = j.best["iss-crew"];
    });
    await check("on: SSE transport with the access token works (list_hails)", async () => {
      const sse = await connect(base, "sse", { requestInit: { headers: { Authorization: `Bearer ${a.auth.saved.access_token}` } } });
      try { assert.equal((await ok(sse, "list_hails")).hails.length, R.HAILS.length); } finally { await sse.close(); }
    });
    await check("on: a refreshed access token works and keeps the same player id", async () => {
      const r = await fetch(asMeta.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: a.auth.saved.refresh_token, client_id: a.auth.client.client_id, resource: `${base}/mcp` }) });
      assert.equal(r.status, 200, await r.clone().text());
      const t = await r.json();
      assert.notEqual(t.access_token, a.auth.saved.access_token);
      const c = await connect(base, "streamable-http", { requestInit: { headers: { Authorization: `Bearer ${t.access_token}` } } });
      try { assert.equal((await ok(c, "take_hail", { hail_id: "phobos-commute" })).player_id, good.hail.player_id); } finally { await c.close(); }
    });
    // Hand-rolled client for the refusals the SDK never sends on purpose (same steps as Wingbot's e2e).
    const reg = async () => {
      const r = await fetch(asMeta.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "e2e hand client", redirect_uris: [REDIRECT_URI], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }) });
      assert.equal(r.status, 201, await r.clone().text());
      return (await r.json()).client_id;
    };
    const pkce = () => { const verifier = randomBytes(32).toString("base64url"); return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") }; };
    const authUrl = (clientId, challenge, state) => `${base}/authorize?` + new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT_URI, code_challenge: challenge, code_challenge_method: "S256", state, resource: `${base}/mcp` });
    await check("on: Deny redirects back with access_denied and the same state", async () => {
      const id = await reg();
      const { location } = await consent(authUrl(id, pkce().challenge, "deny-state"), "deny");
      assert.equal(location.searchParams.get("error"), "access_denied"); assert.equal(location.searchParams.get("state"), "deny-state");
      assert.equal(location.searchParams.get("code"), null);
    });
    await check("on: a wrong PKCE verifier is refused at /token", async () => {
      const id = await reg();
      const { location } = await consent(authUrl(id, pkce().challenge, "s1"));
      const r = await fetch(asMeta.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code: location.searchParams.get("code"), redirect_uri: REDIRECT_URI, client_id: id, code_verifier: pkce().verifier, resource: `${base}/mcp` }) });
      assert.equal(r.status, 400); assert.equal((await r.json()).error, "invalid_grant");
    });
    let mine, second;
    await check("on: get_my_rides lists player A's rides newest first, with totals, parts and stats copied from dispatch", async () => {
      const dropped = await ok(a.client, "take_hail", { hail_id: "jovian-hop" }); // abandoned by the next take_hail
      second = await playHail(a.client, "phobos-commute");
      assert.equal(second.score.ok, true);
      mine = await ok(a.client, "get_my_rides", {});
      assert.equal(mine.player_id, good.hail.player_id); assert.equal(mine.simulated, true); assert.match(mine.note, /Simulated/);
      assert.deepEqual(mine.rides.map((r) => r.run_id), [second.hail.run_id, good.hail.run_id]);
      assert.equal(mine.total_rides, 2); assert.equal(mine.next_cursor, null);
      for (const [row, play] of [[mine.rides[0], second], [mine.rides[1], good]]) {
        assert.equal(row.phase, "arrived"); assert.equal(row.hail_id, play.hail.hail_id); assert.equal(row.season, play.hail.season);
        assert.equal(row.total, play.score.total); assert.equal(row.used_kwh, play.score.used_kwh); assert.equal(row.par_kwh, play.score.par_kwh);
        assert.equal(row.arrive, play.score.arrive); assert.equal(row.car, play.score.car);
        assert.deepEqual(row.parts, Object.fromEntries(play.score.parts.map((x) => [x.key, { got: x.got, max: x.max }])));
      }
      const iss = mine.stats.find((x) => x.hail_id === "iss-crew");
      assert.equal(iss.rides, 1); assert.equal(iss.best_total, good.score.total); assert.equal(iss.last_total, good.score.total); assert.equal(iss.mean_total, good.score.total);
      assert.match(iss.note, /computed from your 1 arrived ride/);
      assert.match(mine.download.url, /^\/rides\/export\/[0-9a-f]{32}\.jsonl$/); assert.ok(Date.parse(mine.download.expires) > Date.now());
      const all = await ok(a.client, "get_my_rides", { include: "all" });
      const phases = Object.fromEntries(all.rides.map((r) => [r.run_id, r.phase]));
      assert.equal(phases[dropped.run_id], "abandoned"); assert.equal(all.rides.find((r) => r.run_id === dropped.run_id).reason, "newer_hail");
      assert.ok(all.rides.some((r) => r.phase === "planning" && r.hail_id === "phobos-commute"), JSON.stringify(phases)); // the refresh check's run
      assert.equal(all.total_rides, all.rides.length); assert.ok(all.total_rides >= 4);
      const only = await ok(a.client, "get_my_rides", { hail_id: "phobos-commute" });
      assert.deepEqual(only.rides.map((r) => r.run_id), [second.hail.run_id]); assert.deepEqual(only.stats.map((x) => x.hail_id), ["phobos-commute"]);
      report.my_rides = { rides: mine.rides.map((r) => [r.hail_id, r.total, r.out_of]), stats: mine.stats, all: all.rides.map((r) => [r.hail_id, r.phase, r.reason ?? ""]) };
    });
    await check("on: get_my_rides pages with limit and next_cursor; a bad cursor is refused", async () => {
      const p1 = await ok(a.client, "get_my_rides", { limit: 1 });
      assert.deepEqual(p1.rides.map((r) => r.run_id), [second.hail.run_id]); assert.ok(p1.next_cursor); assert.ok(p1.stats && p1.download);
      const p2 = await ok(a.client, "get_my_rides", { limit: 1, cursor: p1.next_cursor });
      assert.deepEqual(p2.rides.map((r) => r.run_id), [good.hail.run_id]); assert.equal(p2.next_cursor, null);
      assert.equal(p2.stats, undefined); assert.equal(p2.download, undefined);
      const bad = await call(a.client, "get_my_rides", { cursor: "not-a-cursor" });
      assert.equal(bad.isError, true); assert.match(bad.value, /cursor/);
    });
    let detail;
    await check("on: get_my_rides with a run_id returns the ride's record: dispatch's score and its whole log", async () => {
      detail = await ok(a.client, "get_my_rides", { run_id: good.hail.run_id });
      assert.equal(detail.format, "starfare.ride/1"); assert.equal(detail.simulated, true); assert.match(detail.note, /JPL DE421/);
      assert.equal(detail.run_id, good.hail.run_id); assert.equal(detail.player_tag, good.hail.player_id.slice(2, 8)); assert.equal(detail.phase, "arrived");
      assert.deepEqual(detail.log, good.score.log);
      assert.equal(detail.score.total, good.score.total); assert.deepEqual(detail.score.parts, good.score.parts); assert.equal(detail.score.log, undefined);
    });
    await check("on: player B sees none of A's rides and is refused A's run_id", async () => {
      const none = await ok(b.client, "get_my_rides", {});
      assert.equal(none.player_id, report.second_player); assert.deepEqual(none.rides, []); assert.equal(none.total_rides, 0); assert.deepEqual(none.stats, []);
      const all = await ok(b.client, "get_my_rides", { include: "all" });
      assert.ok(all.rides.every((r) => r.hail_id === "jovian-hop" && r.phase === "planning"), JSON.stringify(all.rides));
      assert.ok(!all.rides.some((r) => [good.hail.run_id, second.hail.run_id].includes(r.run_id)));
      const x = await call(b.client, "get_my_rides", { run_id: good.hail.run_id });
      assert.equal(x.isError, true); assert.match(x.value, /not one of your rides/);
    });
    await check("on: /rides/<run_id>.json downloads one arrived ride; the export JSONL holds A's arrived rides; other ids and tokens are 404", async () => {
      const r = await fetch(`${base}/rides/${good.hail.run_id}.json`);
      assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /application\/json/);
      assert.match(r.headers.get("content-disposition"), /attachment; filename="run_[0-9a-f]{20}\.json"/);
      assert.deepEqual(await r.json(), detail);
      const planning = (await ok(a.client, "get_my_rides", { include: "all" })).rides.find((x) => x.phase === "planning");
      for (const path of [`/rides/${planning.run_id}.json`, `/rides/run_${"0".repeat(20)}.json`, "/rides/nope.json", `/rides/export/${"0".repeat(32)}.jsonl`, "/rides/"]) {
        const g = await fetch(`${base}${path}`); assert.equal(g.status, 404, path); await g.body?.cancel();
      }
      const fl = await fetch(`${base}/flight/${good.hail.run_id}`), page = await fl.text();
      assert.equal(fl.status, 200); assert.match(fl.headers.get("content-type"), /text\/html/);
      const embedded = JSON.parse(/window\.FLIGHT = (.*?);<\/script>/.exec(page)[1]);
      assert.equal(embedded.run_id, good.hail.run_id); assert.ok(embedded.legs.length >= 2);
      assert.ok(Object.values(embedded.arcs).every((a) => a.arc_au.length > 1), "every stored leg keeps its drawn arc");
      for (const path of [`/flight/${planning.run_id}`, "/flight/nope"]) { const g = await fetch(`${base}${path}`); assert.equal(g.status, 404, path); await g.body?.cancel(); }
      const ex = await fetch(base + mine.download.url);
      assert.equal(ex.status, 200); assert.match(ex.headers.get("content-type"), /application\/x-ndjson/);
      assert.match(ex.headers.get("content-disposition"), /starfare-rides\.jsonl/);
      const lines = (await ex.text()).trim().split("\n").map((l) => JSON.parse(l));
      assert.deepEqual(lines.map((l) => l.run_id), [second.hail.run_id, good.hail.run_id]);
      assert.deepEqual(lines[1], detail); assert.ok(lines.every((l) => l.format === "starfare.ride/1" && l.simulated === true));
    });
    await a.client.close(); await b?.client.close();
  } finally { await w.stop(); }

  await check("on: the per-IP rate limit covers /mcp and the OAuth endpoints", async () => {
    const w2 = await startWorker({ STARFARE_OAUTH: "on", RATE_PER_MIN: "5" });
    try {
      const statuses = [];
      for (const path of ["/mcp", "/.well-known/oauth-authorization-server", "/register", "/mcp", "/token", "/authorize", "/mcp"]) {
        const r = await fetch(`${w2.base}${path}`, { method: path === "/mcp" || path === "/register" || path === "/token" ? "POST" : "GET", ...noFollow });
        statuses.push(`${path} ${r.status}`); await r.body?.cancel();
      }
      assert.deepEqual(statuses.slice(5).map((s) => s.split(" ")[1]), ["429", "429"], statuses.join(", "));
      assert.ok(statuses.slice(0, 5).every((s) => !s.endsWith(" 429")), statuses.join(", "));
      const board = await fetch(`${w2.base}/board`); assert.equal(board.status, 200); await board.body?.cancel();
      report.rate = statuses;
    } finally { await w2.stop(); }
  });
  console.log("\n--- details (on) ---\n" + JSON.stringify(report, null, 1));
}

try {
  if (MODE !== "on") await phaseOff();
  if (MODE !== "off") await phaseOn();
} catch (error) {
  console.log(`\nSETUP ERROR: ${error?.stack ?? error}`);
  results.push({ name: "setup", ok: false });
}
for (const mode of ["off", "on"]) {
  const rs = results.filter((r) => (mode === "on" ? r.name.startsWith("on: ") : !r.name.startsWith("on: ")));
  if (rs.length) console.log(`${mode}: ${rs.filter((r) => r.ok).length} of ${rs.length} checks passed`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
