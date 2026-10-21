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
import { mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
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
import { SCORE_VERSION, SEASON_END, computeLeg, isoJD, sky } from "../src/game.js";
import { keyedSeed } from "../src/season-seed.js";
import { stopWorkerProcess } from "./worker-process.mjs";

const DIR = fileURLToPath(new URL("..", import.meta.url));
const MODE = (process.argv.find((a) => a.startsWith("--mode=")) || "--mode=both").slice(7);
if (!["off", "on", "both"].includes(MODE)) throw new Error("--mode must be off, on or both");
const E = createRequire(import.meta.url)("../src/engine/sol-page.cjs");
const R = E.R;
const META = JSON.parse(readFileSync(new URL("../src/engine/meta.json", import.meta.url), "utf8"));
const BENCH_KEY = "e2e-bench-key-0123456789abcdef01"; // a throwaway key for wrangler dev; the live one is a Wrangler secret
const SANDBOX_SEAT_TOOLS = ["join", "company", "market", "assign", "decline", "transfer_ship", "reports", "queue", "report", "hand_back", "wait", "message"];
const TOOLS = ["check_in", "check_pad", "decide", "dispatch", "get_hail", "get_my_rides", "list_hails", "plan_leg", "plan_pickup", "plan_ride", "space_weather", "start_bench", "take_hail"];

const results = [];
let workerLog = [];
async function check(name, fn) {
  const from = workerLog.length;
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS  ${name}`); }
  catch (error) {
    results.push({ name, ok: false }); console.log(`FAIL  ${name}\n      ${String(error?.stack ?? error).split("\n").slice(0, 6).join("\n      ")}`);
    const errs = workerLog.slice(from).join("").split("\n").filter((l) => /error|exception|uncaught/i.test(l)).slice(0, 12);
    if (errs.length) console.log(`      wrangler dev said:\n      ${errs.join("\n      ")}`);
  }
}
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The rate limiter counts per clock minute (Store.hit, src/store.js), so a burst that crosses the turn of a minute starts
// counting again. Rate checks wait for a fresh minute when fewer than `need` ms are left in this one.
const freshMinute = async (need = 20000) => { const left = 60000 - (Date.now() % 60000); if (left < need) await sleep(left + 50); };
const running = new Set();
process.on("exit", () => { for (const c of running) try { process.kill(-c.pid, "SIGKILL"); } catch {} });

// With the sandbox on, the reference company's Worker (wrangler.ref.jsonc) runs as a second wrangler dev beside the main one,
// in its own process as it has its own isolate in production, so its planning CPU can't stall the world's calls. The two
// find each other through a dev registry of their own.
async function startWorker(vars = {}, persistTo = null) {
  const port = await freePort(), persist = persistTo || mkdtempSync(join(tmpdir(), "sol-e2e-")), log = workerLog = [];
  const registry = mkdtempSync(join(tmpdir(), "sol-e2e-registry-")), env = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1", WRANGLER_REGISTRY_PATH: registry };
  const spawnDev = async (args, tag) => {
    const child = spawn(process.execPath, [join(DIR, "node_modules", "wrangler", "bin", "wrangler.js"), "dev", ...args, "--ip", "127.0.0.1", "--persist-to", persist], { cwd: DIR, detached: true, windowsHide: true, env });
    running.add(child);
    child.stdout.on("data", (c) => log.push(tag + String(c))); child.stderr.on("data", (c) => log.push(tag + String(c)));
    child.exited = false; child.on("exit", () => { child.exited = true; });
    return child;
  };
  const ready = async (child, base) => {
    const deadline = Date.now() + 180_000;
    for (;;) {
      if (child.exited) throw new Error(`wrangler dev exited early:\n${log.join("").slice(-2000)}`);
      if (Date.now() > deadline) throw new Error(`wrangler dev not ready:\n${log.join("").slice(-2000)}`);
      try { await (await fetch(`${base}/`)).body?.cancel(); break; } catch { await sleep(250); }
    }
  };
  const children = [];
  if (vars.STARFARE_SANDBOX === "on") {
    const refPort = await freePort(), ref = await spawnDev(["-c", "wrangler.ref.jsonc", "--port", String(refPort), "--inspector-port", String(await freePort())], "[ref] ");
    children.push(ref);
    await ready(ref, `http://127.0.0.1:${refPort}`);
  }
  const args = ["--port", String(port), "--inspector-port", String(await freePort())];
  for (const [k, v] of Object.entries(vars)) args.push("--var", `${k}:${v}`);
  const child = await spawnDev(args, "");
  children.unshift(child);
  const base = `http://127.0.0.1:${port}`;
  await ready(child, base);
  return { base, log, stop: async ({ keepStorage = false } = {}) => {
    for (const c of children) { await stopWorkerProcess(c); running.delete(c); }
    try { await rm(registry, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
    if (!keepStorage) try { await rm(persist, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  } };
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
// A keyed server's season seeds, which this test can compute because it set the key (the on phase).
const NODE_SEEDS = {};
function nodeScore(hailId, riderReady, season, carId, planCalls, quote, objective = "energy", opts = {}) {
  const t0 = jdOf(riderReady), h = R.BY[hailId], seed = NODE_SEEDS[season] ?? String(season);
  const T = R.terms(hailId, t0, SEASON_END, seed);
  const p = computeLeg(E, R.CAR[carId].at, h.from, R.pickupStart(hailId, carId, t0, seed), objective, SEASON_END, carId, 0);
  const r = computeLeg(E, h.from, h.to, p.arr_jd + R.DWELL, objective, SEASON_END, carId, h.party);
  const q = quote === "exact" ? { fare_usd: r.fare, arrival: isoJD(r.arr_jd) } : quote;
  let F = R.fly(hailId, carId, [p, r], t0, seed);
  // A ride that stopped and was answered has a recovery grade. fly() does not: it never asks.
  let hindsight_kwh = null;
  if (opts.hindsight) {
    let st = R.start(hailId, carId, [p, r], t0, seed, { ask_after_hours: 0, end_jd: SEASON_END });
    while (st.checkpoint) st = R.step(st.ride, st.checkpoint.default);
    F = st.done;
    let low = null;
    for (const row of R.regret(st.ride)) for (const o of row.options || []) if (low == null || o.used_kwh < low) low = o.used_kwh;
    hindsight_kwh = low;
  }
  const s = R.score(hailId, [p, r], { t0, arrive_by_jd: T.arrive_by_jd, par_kwh: T.par.kwh, best_wait_days: T.par.best_wait_days, plan_calls: planCalls, ship: carId,
    window_kwh: (p.window_kwh ?? p.kwh) + (r.window_kwh ?? r.kwh), throttled_kwh: (p.throttled_kwh ?? p.kwh) + (r.throttled_kwh ?? r.kwh), hindsight_kwh, quote: q, flown: F });
  return { T, p, r, F, s };
}

/** take_hail, plan_pickup with one car, plan_ride after it, dispatch with the ride leg's own fare and arrival (or a given quote).
 *  ask "never" flies the default answer at every checkpoint, which is what R.fly does in Node. */
async function playHail(client, hailId, car, { quote = "exact", objective, ask = "never", openedHail } = {}) {
  timings.push({ tool: `--- ${hailId} ${car ?? "par car"}` });
  const hail = openedHail || await ok(client, "take_hail", { hail_id: hailId });
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
function assertMatchesNode(play, planCalls, quote = "exact", opts = {}) {
  const { T, s, r, F } = nodeScore(play.hail.hail_id, play.hail.rider_ready, play.hail.season, play.car, planCalls, quote, "energy", opts);
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
async function takeBookableQuick(client, hails) {
  for (const booking of hails.filter((h) => h.kind === "quick")) {
    const result = await call(client, "take_hail", { hail_id: booking.hail_id });
    if (!result.isError) return { booking, hail: result.value };
    assert.match(String(result.value), /tank holds.*this (leg|plan) needs|season ends too soon|land after the season ends/i,
      "Unexpected take_hail error must fail the check");
  }
  assert.fail("This season has no bookable quick hail for the integration check");
}
function assertSeasonPool(hails) {
  const catalog = new Set(R.HAILS.map((h) => h.id));
  assert.equal(hails.length, 200);
  for (const h of hails) {
    const m = /^s(\d+)-(\d+)$/.exec(h.hail_id);
    assert.ok(m, h.hail_id);
    assert.equal(catalog.has(h.hail_id), false);
    const row = R.hailRow(m[1], Number(m[2]));
    assert.equal(h.from.id, row.from);
    assert.equal(h.to.id, row.to);
    assert.equal(h.title, row.title);
    assert.equal(h.party, row.party);
    assert.ok(h.party >= 1 && h.party <= 3);
    assert.match(h.rider, /\(simulated\)$/);
    assert.match(h.blurb, /simulated/);
    assert.doesNotMatch(`${h.title} ${h.blurb} ${h.rider}`, /\bcar\b|roadster/i);
    assert.doesNotMatch(`${h.title}${h.blurb}`, /[-–—]/);
  }
}

async function phaseOff() {
  console.log("\n== STARFARE_OAUTH=off (default) ==");
  const report = {};
  // wrangler.jsonc ships OAuth "on" (the live setting) and the sandbox "off"; this server turns the sandbox's world routes on.
  const w = await startWorker({ STARFARE_OAUTH: "off", STARFARE_BENCH_KEY: BENCH_KEY, RATE_PER_MIN: "1000", STARFARE_SANDBOX: "on" });
  console.log(`wrangler dev up at ${w.base}`);
  const client = await connect(w.base);

  await check("GET / is the landing page: the connector URL, the hails and fleet as data, and a cacheable engine script", async () => {
    const r = await fetch(`${w.base}/`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /^text\/html/);
    // Hardening headers on every page (src/index.js harden).
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    const html = await r.text();
    for (const s of ["Starfare", "Works with Grok", `${w.base}/mcp`, "grok.com/connectors", "/board.json", "/rides/&lt;run_id&gt;.json"]) assert.ok(html.includes(s), s);
    assert.doesNotMatch(html, /__(SITE|ORIGIN|ENGINE_URL)__/);
    const site = JSON.parse(/window\.SITE = (.*);<\/script>/.exec(html)[1]);
    assertSeasonPool(site.hails);
    assert.equal(site.pool_size, site.hails.length);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const desk = await fetch(`${w.base}/hails.json`), pool = await desk.json();
    assert.equal(desk.headers.get("cache-control"), "no-store");
    assert.deepEqual(pool.hails, site.hails);
    const view = await fetch(`${w.base}/assets/flight-view.js`);
    assert.equal(view.status, 200);
    assert.match(await view.text(), /root.StarfareView = api/);
    assert.deepEqual(site.fleet.map((c) => [c.car, c.parked_at.id]), R.FLEET.map((c) => [c.id, c.at]));
    const src = /<script src="(\/engine\.js\?v=[0-9a-f]{16})"/.exec(html)[1];
    const js = await fetch(`${w.base}${src}`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type"), /^text\/javascript/);
    assert.match(js.headers.get("cache-control"), /immutable/);
    assert.ok((await js.text()).includes("module.exports = SOLE"));
  });
  await check("tools/list is exactly the eleven ride-hail tools, start_bench, check_in and (this phase runs the sandbox) the sandbox's seat tools", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, [...TOOLS, ...SANDBOX_SEAT_TOOLS].sort());
  });
  await check("Comms: an agent checks in with the page's one-time code, and its bookings show on that channel", async () => {
    const opened = await fetch(`${w.base}/comms/new`, { method: "POST" });
    assert.equal(opened.status, 200);
    const { channel, code } = await opened.json();
    assert.match(channel, /^[0-9a-f]{32}$/); assert.match(code, /^[A-Z2-9]{2}-[A-Z2-9]{4}$/);
    const view = async () => (await fetch(`${w.base}/comms/${channel}.json`)).json();
    assert.equal((await view()).linked, false);
    const agent = await connect(w.base);
    try {
      const bad = await call(agent, "check_in", { code: "ZZ-ZZZZ" });
      assert.equal(bad.isError, true); assert.match(bad.value, /unknown or expired/);
      const r = await ok(agent, "check_in", { code: code.toLowerCase(), agent_name: "e2e", model: "none", skills: ["planning"] });
      assert.equal(r.checked_in, true);
      const again = await call(agent, "check_in", { code });
      assert.equal(again.isError, true, "a code works once");
      const v = await view();
      assert.equal(v.linked, true); assert.equal(v.code, null);
      assert.deepEqual(v.events.map((e) => e.kind), ["connected", "check_in"]);
      assert.deepEqual(v.events[1], { ...v.events[1], name: "e2e", model: "none", thinking: null, skills: ["planning"], client: { name: "sol-e2e", version: "1" }, signed_in: false });
      const pool = await ok(agent, "list_hails", { kind: "quick", limit: 200 });
      const { hail } = await takeBookableQuick(agent, pool.hails);
      const after = await view();
      assert.equal(after.runs[0].run_id, hail.run_id);
      assert.equal(after.runs[0].trail[0].tool, "take_hail");
      assert.equal((await fetch(`${w.base}/comms/${"0".repeat(32)}.json`)).status, 404);
    } finally { await agent.close(); }
  });
  await check("list_hails returns this season's pool, hides the catalog, and still lets two players take one hail", async () => {
    const r = await ok(client, "list_hails", { limit: 200 });
    assertSeasonPool(r.hails);
    const pool = await (await fetch(`${w.base}/hails.json`)).json();
    assert.deepEqual(pool.hails, r.hails);
    assert.equal(pool.season, r.season);
    assert.deepEqual(r.fleet.map((c) => [c.car, c.parked_at.id]), R.FLEET.map((c) => [c.id, c.at]));
    assert.equal(r.board, "/board");
    const season = /^s(\d+)-\d+$/.exec(r.hails[0].hail_id)[1];
    const outside = await call(client, "take_hail", { hail_id: "s" + season + "-" + r.hails.length });
    assert.equal(outside.isError, true); assert.match(outside.value, /outside this season's pool/);
    const other = await call(client, "take_hail", { hail_id: "s" + (Number(season) + 1) + "-0" });
    assert.equal(other.isError, true); assert.match(other.value, /from season/);
    const a = await connect(w.base), b = await connect(w.base);
    try {
      const { booking: quick, hail: t1 } = await takeBookableQuick(a, r.hails);
      const t2 = await ok(b, "take_hail", { hail_id: quick.hail_id });
      assert.notEqual(t1.run_id, t2.run_id);
      assert.equal(t1.hail_id, quick.hail_id); assert.equal(t2.hail_id, quick.hail_id);
    } finally { await a.close(); await b.close(); }
    report.list = r.hails.slice(0, 5).map((h) => `${h.hail_id} ${h.kind} party ${h.party}: ${h.from.name} to ${h.to.name}`);
  });

  let good;
  const bestOf = {}, bestPlay = {}; // best total per hail, for the board check. A tie keeps the first row, as the board does.
  const noteBest = (p) => {
    if (!p.score || !p.score.ok) return p;
    const prev = bestOf[p.hail.hail_id];
    if (prev == null || p.score.total > prev) {
      bestOf[p.hail.hail_id] = p.score.total;
      bestPlay[p.hail.hail_id] = p;
    }
    return p;
  };
  await check("a pool hail plans, dispatches and scores, and a worse finish does not replace the best", async () => {
    const listed = await ok(client, "list_hails", { limit: 200 });
    const { booking: quick, hail: openedHail } = await takeBookableQuick(client, listed.hails);
    const m = /^s(\d+)-(\d+)$/.exec(quick.hail_id);
    R.admit(R.hailRow(m[1], Number(m[2])));
    const exact = noteBest(await playHail(client, quick.hail_id, undefined, { openedHail }));
    assert.equal(exact.score.ok, true);
    assertMatchesNode(exact, 2);
    const worse = noteBest(await playHail(client, quick.hail_id, exact.car, { quote: { quoted_fare_usd: 1, quoted_arrival: "2020-01-01 00:00" } }));
    assert.equal(worse.score.ok, true);
    assert.ok(worse.score.total < exact.score.total, `worse ${worse.score.total} vs exact ${exact.score.total}`);
    assertMatchesNode(worse, 2, { fare_usd: 1, arrival: "2020-01-01 00:00" });
    const board = await (await fetch(`${w.base}/board.json`)).json();
    assert.equal(board.best[quick.hail_id].points, exact.score.total);
    assert.equal(board.best[quick.hail_id].hail_id, quick.hail_id);
    report.pool = { hail_id: quick.hail_id, exact: exact.score.total, worse: worse.score.total };
  });
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
    assert.equal(score.ok, true); assert.equal(score.out_of, 100000); assert.equal(score.parts.reduce((a, p) => a + p.max, 0), 100000);
    assert.equal(score.total, score.parts.reduce((a, p) => a + p.got, 0));
    assert.deepEqual(score.parts.map((p) => p.key), ["pickup", "on_time", "energy", "promise", "checker", "fare", "economy", "window", "recovery", "dose"]);
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

  await check("a ride that stops at checkpoints (ask_after_hours 0), answered with decide's defaults, matches R.start and R.step in Node; get_hail shows the open checkpoint", async () => {
    const tried = [];
    let stop = null;
    for (let day = 0; day < 25 && !stop; day++) {
      if (day) await sleep(1000); // one sky day; a checkpoint is not up every minute
      for (const hailId of ["iss-crew", "phobos-commute"]) { // the board row below only scores these two; the outer hails are checked on their own
        for (const car of R.FLEET.map((c) => c.id)) {
          let play;
          try { play = await playHail(client, hailId, car, { ask: 0 }); }
          catch (e) { tried.push(`${hailId} ${car} refused`); continue; }
          tried.push(`${hailId} ${car} ${play.score.status ?? "refused"}`);
          if (play.score.status === "checkpoint") { stop = play; break; }
          noteBest(play);
        }
        if (stop) break;
      }
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
    assertMatchesNode(stop, 2, "exact", { hindsight: true });
    assert.deepEqual(out.log.checkpoints.map((c) => c.n), seen.map((_, i) => i + 1));
    for (const c of out.log.checkpoints) {
      assert.equal("best" in c, false, JSON.stringify(c));
      assert.ok(c.options_hindsight.length >= 2 && c.options_hindsight.every((o) => typeof o.used_kwh === "number" && !/best|optimum/.test(o.option)), JSON.stringify(c));
    }
    report.checkpoints = { tried, hail: stop.hail.hail_id, car: stop.car, seen, total: out.total, used_kwh: out.used_kwh, hindsight: out.log.checkpoints.map((c) => [c.n, c.options_hindsight.map((o) => o.option)]) };
  });

  await check("live playback: dispatch returns watch_url and lands_in_s; /rides, /flight and /live.json show the flight held at its checkpoint; the notes join the dispatcher log", async () => {
    const tried = [], NOTE = "e2e: dispatching the par plan";
    let held = null;
    for (let day = 0; day < 25 && !held; day++) {
      if (day) await sleep(1000); // one sky day; a held flight is not up every minute
    for (const hailId of ["iss-crew", "phobos-commute"]) {
      for (const car of R.FLEET.map((c) => c.id)) {
        let hail, pickup, ride, d;
        try {
          hail = await ok(client, "take_hail", { hail_id: hailId });
          pickup = await ok(client, "plan_pickup", { run_id: hail.run_id, car });
          ride = await ok(client, "plan_ride", { run_id: hail.run_id, after_leg: pickup.leg_id });
          d = await ok(client, "dispatch", { run_id: hail.run_id, pickup_leg: pickup.leg_id, ride_leg: ride.leg_id, quoted_fare_usd: ride.fare_usd, quoted_arrival: ride.arrive, ask_after_hours: 0, note: NOTE });
        } catch (e) { tried.push(`${hailId} ${car} refused`); continue; }
        tried.push(`${hailId} ${car} ${d.status ?? "refused"}`);
        if (!d.ok) continue;
        assert.equal(d.watch_url, `${w.base}/flight/${hail.run_id}`);
        assert.ok(Number.isInteger(d.lands_in_s) && d.lands_in_s >= 0, String(d.lands_in_s));
        if (d.status === "checkpoint") { held = { hail, d }; break; }
        scored++; noteBest({ hail, score: d });
      }
      if (held) break;
    }
    }
    assert.ok(held, "no ride stopped in " + tried.join(", "));
    const id = held.hail.run_id, s = held.d.situation;
    assert.ok(Number.isInteger(held.d.checkpoint_in_s) && held.d.checkpoint_in_s <= held.d.lands_in_s, `${held.d.checkpoint_in_s} vs ${held.d.lands_in_s}`);

    const earlyEp = await fetch(`${w.base}/flight/${id}/episode.jsonl`);
    assert.equal(earlyEp.status, 404);
    assert.equal(await earlyEp.text(), "Not found: no arrived flight with that run_id, or its season is keyed and its seed is published after the reset");

    const r = await fetch(`${w.base}/rides/${id}.json`), text = await r.text(), rec = JSON.parse(text);
    assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(rec.phase, "in_flight"); assert.equal(rec.score, null); assert.equal(rec.log, null);
    assert.equal(rec.live.simulated, true); assert.equal(rec.live.lands_at_ms, null);
    assert.deepEqual([rec.live.hold.n, rec.live.hold.at], [s.checkpoint, s.sky_at]);
    assert.deepEqual(rec.live.checkpoints.map((c) => c.decision), [null]);
    // A ride held at launch before its first leg flies has a one-point track: the ship waits where it is parked.
    const tr = rec.live.track;
    assert.ok(tr.length >= 2 || (tr.length === 1 && rec.live.hold.kind === "launch_hold"), JSON.stringify({ hold: rec.live.hold, track: tr }));
    assert.ok(tr.every((p, k) => k === 0 || (p[0] >= tr[k - 1][0] && p[1] >= tr[k - 1][1])), "the track runs forward in wall and sky time: " + JSON.stringify(tr));
    assert.deepEqual(rec.trail.slice(-3).map((t) => t.tool), ["plan_pickup", "plan_ride", "dispatch"]);
    assert.equal(rec.trail.at(-1).note, NOTE);
    assert.doesNotMatch(text, /player_id|seed|hindsight/);

    const page = await fetch(`${w.base}/flight/${id}`), html = await page.text();
    assert.equal(page.status, 200); assert.equal(page.headers.get("cache-control"), "no-store");
    assert.equal(JSON.parse(/window\.FLIGHT = (.*?);<\/script>/.exec(html)[1]).in_flight, true);
    const fj = await fetch(`${w.base}/flight/${id}.json`), fl = await fj.json();
    assert.equal(fj.status, 200); assert.equal(fl.in_flight, true); assert.ok(fl.legs.length >= 1);
    const nf = await fetch(`${w.base}/flight/run_${"0".repeat(20)}.json`);
    assert.equal(nf.status, 404); assert.deepEqual(await nf.json(), { error: "no dispatched flight with that run_id" });

    const lj = await fetch(`${w.base}/live.json`), live = await lj.json();
    assert.equal(lj.status, 200); assert.equal(lj.headers.get("cache-control"), "no-store");
    assert.equal(live.simulated, true); assert.ok(Number.isInteger(live.now_ms));
    const row = live.flights.find((f) => f.run_id === id);
    assert.ok(row, "the held flight is on /live.json");
    assert.deepEqual(Object.keys(row).sort(), ["hail_id", "hold", "home", "legs", "manifest", "run_id", "ship", "title", "track"]);
    assert.equal(row.hold.kind, rec.live.hold.kind);
    assert.equal(row.hail_id, held.hail.hail_id);
    assert.equal(row.manifest.bookings[0].hail_id, held.hail.hail_id);
    assert.equal(row.ship, rec.live.car); assert.deepEqual(row.track, rec.live.track);

    let out = held.d, n = 0;
    while (out.status === "checkpoint") {
      out = await ok(client, "decide", { run_id: id, checkpoint: out.situation.checkpoint, ...out.situation.default, note: `e2e: default at ${++n}` });
      assert.equal(out.watch_url, `${w.base}/flight/${id}`); assert.ok(Number.isInteger(out.lands_in_s));
    }
    assert.equal(out.status, "arrived");
    scored++; noteBest({ hail: held.hail, score: out });
    const done = await (await fetch(`${w.base}/rides/${id}.json`)).json();
    assert.equal(done.phase, "arrived"); assert.equal(done.score.total, out.total);
    assert.equal(done.live.lands_at_ms, done.live.track.at(-1)[0]); assert.equal(done.live.hold, null);
    assert.deepEqual(done.trail.filter((t) => t.tool === "decide").map((t) => t.note), Array.from({ length: n }, (_, k) => `e2e: default at ${k + 1}`));
    const after = await fetch(`${w.base}/flight/${id}.json`);
    assert.equal(after.headers.get("cache-control"), "public, max-age=60"); assert.equal((await after.json()).in_flight, false);
    const ep = await fetch(`${w.base}/flight/${id}/episode.jsonl`), epText = await ep.text();
    assert.equal(ep.status, 200);
    assert.equal(ep.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
    const epRows = epText.trim().split("\n").map((s) => JSON.parse(s));
    assert.equal(epRows.at(-1).schema, "starfare.episode/1");
    assert.equal(epRows.at(-1).outcome.status, "arrived");
    assert.equal(epRows.at(-1).reward.total, out.total);
    assert.equal(epRows.at(-1).reward.score_version, out.score_version);
    assert.deepEqual(epRows.at(-1).reward.parts.map((p) => p.key), out.parts.map((p) => p.key));
    assert.equal(epRows.some((row) => JSON.stringify(row).includes('"best"')), false);
    assert.doesNotMatch(epText, /\bcar\b|roadster/i);
    assert.doesNotMatch(epText, /player_id|player_tag/);
    const missingEp = await fetch(`${w.base}/flight/run_${"0".repeat(20)}/episode.jsonl`);
    assert.equal(missingEp.status, 404);
    report.live = { tried, run_id: id, checkpoint_in_s: held.d.checkpoint_in_s, lands_in_s: held.d.lands_in_s, decides: n, landed_in_s: out.lands_in_s };
  });

  await check("iss-crew on SF-10 is refused: a Liner flies the outer long hauls, not quick hops", async () => {
    const hail = await ok(client, "take_hail", { hail_id: "iss-crew" });
    const p = await call(client, "plan_pickup", { run_id: hail.run_id, car: "sf-10" });
    assert.equal(p.isError, true);
    assert.equal(p.value, R.servesWhy("sf-10", R.BY["iss-crew"]) + ". Pick a ship whose flies field fits; the fleet is in get_hail.");
    assert.match(p.value, /^SF-10 is a Starseeker Liner, which flies long hauls to or from the outer planets/);
    assert.equal((await ok(client, "get_hail", { run_id: hail.run_id })).plans_used, 0);
    report.wrong_class = { refused: p.value };
  });

  await check("a wrong quote (fare and an arrival years early) drops the fare and the promise; a fare $5 off drops the fare a little; both match Node", async () => {
    const wrong = noteBest(await playHail(client, "iss-crew", undefined, { quote: { quoted_fare_usd: 1, quoted_arrival: "2020-01-01 00:00" } }));
    const got = (sc, k) => sc.parts.find((p) => p.key === k).got;
    const fareTop = wrong.score.parts.find((p) => p.key === "fare").max * R.SCORE_HEADROOM;
    assert.ok(got(wrong.score, "fare") < fareTop / 5, got(wrong.score, "fare"));
    assert.ok(got(wrong.score, "promise") < 1, got(wrong.score, "promise"));
    assert.equal(wrong.score.promised_arrival, "2020-01-01 00:00"); assert.ok(wrong.score.promise_slip_hours > 24 * 365);
    assertMatchesNode(wrong, 2, { fare_usd: 1, arrival: "2020-01-01 00:00" });
    const half = noteBest(await playHail(client, "iss-crew", undefined, { quote: (ride) => ({ quoted_fare_usd: ride.fare_usd + 5, quoted_arrival: ride.arrive }) }));
    const fareMax = half.score.parts.find((p) => p.key === "fare").max;
    assert.ok(got(half.score, "fare") < fareMax * R.SCORE_HEADROOM, got(half.score, "fare"));
    assert.ok(got(half.score, "fare") > fareMax * R.SCORE_HEADROOM * 0.9, got(half.score, "fare"));
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
    for (let day = 0; day < 40 && !found; day++) {
      if (day) await sleep(1000); // one sky day; a ship busy after the rider is ready is not up every minute
      for (const hailId of ["iss-crew", "phobos-commute"]) {
        const h = await ok(client, "take_hail", { hail_id: hailId });
        const later = h.fleet.filter((c) => c.busy_until !== "free" && jdOf(c.busy_until) > jdOf(h.rider_ready) + 1 / 1440 && c.parked_at.id !== R.BY[hailId].from);
        let attempts = 0;
        for (const busy of later) {
          attempts++;
          const p = await call(client, "plan_pickup", { run_id: h.run_id, car: busy.car });
          if (p.isError || p.value.car_busy_until !== busy.busy_until) continue;
          found = { h, busy, p: p.value, attempts };
          break;
        }
        if (found) break;
      }
    }
    assert.ok(found, "no flyable busy ship in 40 sky days");
    const p = found.p;
    assert.equal(p.car_busy_until, found.busy.busy_until); assert.match(p.note, /busy on another job/);
    assert.ok(jdOf(p.depart) >= jdOf(found.busy.busy_until) - 1 / 1440, `${p.depart} before ${found.busy.busy_until}`);
    assert.equal(p.plans_used, found.attempts);
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
    assert.equal(sw.place.id, R.BY[h.hail_id].from);
    assert.deepEqual(sw.days.map((d) => [d.from, d.flare_odds]), R.flareForecast(t0, 30, seed, sw.place.id).map((d) => [isoJD(d.day_jd), d.flare_odds]));
    for (const d of sw.days) assert.deepEqual(Object.keys(d).sort(), ["flare_odds", "from", "to"]);
    assert.equal((await ok(client, "space_weather", { run_id: h.run_id })).days.length, 10);
    for (const [tool, args, re] of [["check_pad", { place: "nowhere" }, /unknown place nowhere/], ["check_pad", { place: "constructor" }, /unknown place/], ["check_pad", { place: "iss", from: "2030-02-30 00:00" }, /from must be/], ["space_weather", { place: "nowhere" }, /unknown place nowhere/]]) {
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
    assert.equal(d.parts.find((x) => x.key === "economy").note, "2 plans, 6 free. 0 plans past that");
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
    assert.equal(c.isError, true); assert.match(c.value, /unknown ship sol-99/);
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
    const p2 = await call(client, "plan_pickup", { run_id: h.run_id, car: "sf-09" });
    assert.equal(p2.isError, true);
    assert.match(p2.value, /^SF-09 is a Starseeker Shuttle/);
    const info = await ok(client, "get_hail", { run_id: h.run_id });
    assert.equal(info.plans_used, 2); assert.equal(info.dispatched, false);
    report.bad_legs = { plan_ride: u.value, ride_after_ride: rr.value, unknown_car: c.value, forged: d1.problems, swapped: d2.problems, other_run: d3.problems, wrong_class: p2.value };
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

  await check("ceres-shift, jovian-hop and titan-home each open on a ship that can fly them, or the season ends too soon", async () => {
    const opened = [], held = [];
    for (const hailId of ["ceres-shift", "jovian-hop", "titan-home"]) {
      const h = await call(client, "take_hail", { hail_id: hailId });
      if (h.isError) {
        assert.match(h.value, /season ends too soon|land after the season ends/, hailId + " " + h.value);
        held.push(hailId);
      } else {
        assert.equal(h.value.hail_id, hailId);
        opened.push(hailId);
      }
    }
    report.long_hauls = { opened, held };
  });

  await check("re-fly cache: the same pickup parameters are served from the cache", async () => {
    const h = await ok(client, "take_hail", { hail_id: "phobos-commute" });
    const a = await ok(client, "plan_pickup", { run_id: h.run_id, car: "sf-03" });
    const b = await ok(client, "plan_pickup", { run_id: h.run_id, car: "sf-03" });
    assert.equal(b.cached, true); assert.equal(b.battery_kwh, a.battery_kwh); assert.equal(b.plans_used, 2); assert.notEqual(b.leg_id, a.leg_id);
    const tA = Date.now(); await ok(client, "plan_pickup", { run_id: h.run_id, car: "sf-03" });
    report.cache = { first_cached: a.cached, second_cached: b.cached, first_ms: timings.at(-3).ms, cached_call_ms: Date.now() - tA };
  });
  await check("one run per session: a new take_hail abandons the open run and says so in previous_run", async () => {
    const h1 = await ok(client, "take_hail", { hail_id: "iss-crew" });
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
      assertSeasonPool((await ok(sse, "list_hails", { limit: 200 })).hails);
      const h = await ok(sse, "take_hail", { hail_id: "iss-crew" });
      assert.equal((await ok(sse, "get_hail", { run_id: h.run_id })).hail_id, "iss-crew");
    } finally { await sse.close(); }
  });
  await check("GET /board and /board.json: best per hail with hail titles, labelled planned by Grok bot", async () => {
    const br = await fetch(`${w.base}/board.json`);
    assert.equal(br.headers.get("cache-control"), "no-store");
    const j = await br.json();
    assert.equal(j.label, "planned by Grok bot");
    assert.equal(j.best["iss-crew"].points, bestOf["iss-crew"]); assert.equal(j.best["iss-crew"].hail_id, "iss-crew");
    assert.equal(j.best["ceres-shift"], undefined);
    const row = j.best["iss-crew"], best = bestPlay["iss-crew"];
    assert.equal(row.run_id, best.hail.run_id);
    assert.equal(row.run_tag, best.hail.run_id.slice(4, 10));
    assert.equal(Object.hasOwn(row, "player_id"), false);
    assert.equal(j.score_version, SCORE_VERSION); assert.equal(row.score_version, SCORE_VERSION); assert.equal(row.engine_sha256, META.sha256);
    assert.equal(row.kwh, Math.round(best.score.used_kwh)); assert.ok(Math.abs(row.wait_h - (jdOf(best.score.pickup) - jdOf(best.hail.rider_ready)) * 24) <= 0.06, `${row.wait_h} h vs actual pickup ${best.score.pickup}`);
    assert.equal(j.stats.runs_scored, scored);
    assert.deepEqual(j.standings, { min_attempts: 3, players: 0, unranked: 0, ranked: [] }, "without sign-in no run has a player to rank");
    const r = await fetch(`${w.base}/board`);
    assert.match(r.headers.get("content-type"), /text\/html/);
    const html = await r.text();
    assertSeasonPool(j.hails);
    assert.deepEqual(j.hails, (await (await fetch(`${w.base}/hails.json`)).json()).hails);
    for (const h of [...j.hails, ...j.legacy_hails]) assert.ok(html.includes(h.title), `board is missing ${h.title}`);
    assert.match(html, /planned by Grok bot/); assert.match(html, /Catalog reference booking/); assert.match(html, /Scores are out of 100000/); assert.match(html, /kept the promised arrival 14000/);
    assert.match(html, /no connector runs yet/); // titan-home etc. have no runs
    assert.ok(html.includes(`href="/flight/${row.run_id}"`));
    const flight = await fetch(`${w.base}/flight/${row.run_id}`);
    assert.equal(flight.status, 200);
    await flight.body?.cancel();
    const rec = await (await fetch(`${w.base}/rides/${row.run_id}.json`)).json();
    assert.deepEqual(rec.score.parts.map((p) => p.key).sort(), ["checker", "dose", "economy", "energy", "fare", "on_time", "pickup", "promise", "recovery", "window"]);
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
  await check("start_bench opens suite v1 on the practice split", async () => {
    const bot = await connect(w.base);
    try {
      const start = await call(bot, "start_bench");
      assert.equal(start.isError, false);
      assert.equal(start.value.practice, true);
      assert.equal(start.value.simulated, true);
      assert.equal(start.value.tasks, 5);
      assert.match(start.value.bench_id, /^b_[0-9a-f]{20}$/);
    } finally { await bot.close(); }
  });
  // An engine or score change re-cuts the suite's dev split, and the held-out test split waits for Alvin's keyed cut.
  const hasTest = !!(JSON.parse(readFileSync(new URL("../src/suites/v1.json", import.meta.url), "utf8")).splits.test || []).length;
  if (!hasTest) await check("start_bench split test says the suite has no test split yet, and practice still opens", async () => {
    const bot = await connect(w.base);
    try {
      const start = await call(bot, "start_bench", { split: "test" });
      assert.equal(start.isError, true);
      assert.match(start.value, /has no test split yet\. start_bench with split dev \(practice\) still works\./);
      assert.equal((await call(bot, "start_bench", { split: "dev" })).isError, false);
    } finally { await bot.close(); }
  });
  else await check("start_bench split test opens a held-out session and the start result has no score", async () => {
    const bot = await connect(w.base);
    try {
      const start = await call(bot, "start_bench", { split: "test" });
      assert.equal(start.isError, false);
      assert.equal(start.value.practice, false);
      assert.match(start.value.suite, /held-out test split/);
      assert.equal(start.value.tasks, 5);
      assert.equal(start.value.score, undefined);
      assert.equal(start.value.total, undefined);
      // Three held-out sessions a day per player (here, per address: this server runs without sign-in), then a refusal.
      for (let i = 0; i < 2; i++) assert.equal((await call(bot, "start_bench", { split: "test" })).isError, false);
      const fourth = await call(bot, "start_bench", { split: "test" });
      assert.equal(fourth.isError, true);
      assert.match(fourth.value, /allows 3 sessions a day per player/);
      assert.equal((await call(bot, "start_bench", { split: "dev" })).isError, false, "practice is not limited");
    } finally { await bot.close(); }
  });
  await check("sandbox world: POST /world/new makes a private world (ships at home, desks by region, clock stopped) and its view never shows the seed", async () => {
    const made = await fetch(`${w.base}/world/new`, { method: "POST" });
    assert.equal(made.status, 201);
    const v = await made.json();
    assert.match(v.world_id, /^w_[0-9a-f]{20}$/);
    assert.equal(v.view, `${w.base}/world/${v.world_id}.json`);
    assert.equal(v.simulated, true);
    assert.equal(v.clock.tick, 0);
    assert.equal(v.clock.sky_now, isoJD(META.sky.jd0));
    assert.deepEqual(v.desks.map((d) => d.ships.map((s) => s.car)), [["sf-01", "sf-02", "sf-03", "sf-04", "sf-08", "sf-09", "sf-10"], ["sf-05", "sf-06", "sf-07", "sf-11"]]);
    for (const d of v.desks) for (const sh of d.ships) { assert.equal(sh.free, "free"); assert.equal(sh.at.id, R.CAR[sh.car].at); }
    assert.deepEqual(v.seats.map((x) => [x.seat, x.joined]), [["EX", false], ["D1", false], ["D2", false]]);
    assert.equal(v.market.open, v.market.size);
    assert.doesNotMatch(JSON.stringify(v), /k1:/, "the world's hazard seed stays in its Durable Object");
    const again = await (await fetch(v.view)).json();
    assert.equal(again.world_id, v.world_id);
    assert.equal(again.created_ms, v.created_ms, "the view reads the stored world");
    const other = await (await fetch(`${w.base}/world/new`, { method: "POST" })).json();
    assert.notEqual(other.world_id, v.world_id);
    report.world = { world_id: v.world_id, clock: v.clock, market: v.market };
  });

  await check("sandbox seats: /world/new gives three seat codes once; join checks the code and names the seat, and the view shows who joined, never a code", async () => {
    const v = await (await fetch(`${w.base}/world/new`, { method: "POST" })).json(), hex = v.world_id.slice(2);
    for (const seat of ["EX", "D1", "D2"]) assert.match(v.codes[seat], new RegExp(`^${seat}-${hex}-[A-HJ-NP-Z2-9]{12}$`));
    const d1 = await ok(client, "join", { code: v.codes.D1, agent_name: "e2e bot", model: "scripted" });
    assert.deepEqual([d1.joined, d1.role, d1.desk.name, d1.desk.ships.length], ["D1", "dispatcher", "Inner desk", 7]);
    assert.ok(d1.tools.includes("dispatch") && !d1.tools.includes("assign"));
    const ex = await ok(client, "join", { code: v.codes.EX.toLowerCase() });
    assert.deepEqual([ex.role, ex.desks.length], ["executor", 2]);
    const forged = await call(client, "join", { code: v.codes.D2.slice(0, -1) + (v.codes.D2.endsWith("A") ? "B" : "A") });
    assert.equal(forged.isError, true);
    assert.match(forged.value, /seat code is not valid/);
    const after = await (await fetch(v.view)).json(), text = JSON.stringify(after);
    assert.deepEqual(after.seats.map((x) => [x.seat, x.joined]), [["EX", true], ["D1", true], ["D2", false]]);
    assert.equal(after.seats[1].agent.name, "e2e bot");
    for (const seat of ["EX", "D1", "D2"]) assert.ok(!text.includes(v.codes[seat].slice(-12)), "the view never shows a code");
    assert.doesNotMatch(text, /code_hash/);
  });

  await check("sandbox tools: the executor assigns a market hail to a desk, and that desk's dispatcher plans it with its code and job_id", async () => {
    const v = await (await fetch(`${w.base}/world/new`, { method: "POST" })).json(), { EX, D1, D2 } = v.codes;
    const m = await ok(client, "market", { code: EX, kind: "quick", limit: 50 });
    const inner = m.hails.find((h) => h.region === "inner");
    const a = await ok(client, "assign", { code: EX, hail_id: inner.hail_id, desk: "D1" });
    assert.equal(a.assigned, "j1");
    const q = await ok(client, "queue", { code: D1 });
    assert.deepEqual(q.jobs.map((j) => j.job_id), ["j1"]);
    const h = await ok(client, "get_hail", { code: D1, job_id: "j1" });
    assert.equal(h.job_id, "j1");
    assert.ok(h.fleet.every((c) => q.ships.some((s) => s.car === c.car)), "get_hail lists the desk's ships only");
    const other = await call(client, "get_hail", { code: D2, job_id: "j1" });
    assert.equal(other.isError, true); assert.match(other.value, /not yours/);
    const wrongRole = await call(client, "assign", { code: D1, hail_id: inner.hail_id, desk: "D1" });
    assert.equal(wrongRole.isError, true); assert.match(wrongRole.value, /executor's tool/);
    const bare = await call(client, "get_hail", {});
    assert.equal(bare.isError, true); assert.match(bare.value, /run_id/);
    const r = await ok(client, "report", { code: D1, text: "j1 is planned next tick.", job_id: "j1" });
    assert.equal(r.ok, true);
    const rep = await ok(client, "reports", { code: EX });
    assert.deepEqual(rep.reports.map((x) => x.text), ["j1 is planned next tick."]);
    assert.deepEqual(rep.scores.desks.map((d) => [d.desk, d.mean, d.open]), [["D1", null, 1], ["D2", null, 0]], "an open job is not scored yet");
    assert.ok(rep.scores.company.offered_person_trips > 0);
    assert.equal((await ok(client, "queue", { code: D1 })).score.desk, "D1");
    // Handed back in the tick it was given (before its rider is ready): it counts neither way and its hail is on the market again.
    const back = await ok(client, "hand_back", { code: D1, job_id: "j1", text: "Handing j1 back to try the hand-back tool." });
    assert.deepEqual([back.reason, back.counts], ["handed_back", "neither"]);
    const after = await ok(client, "reports", { code: EX });
    assert.deepEqual(after.scores.desks.map((d) => [d.desk, d.mean, d.open, d.handed_back]), [["D1", null, 0, 1], ["D2", null, 0, 0]]);
    assert.ok((await ok(client, "market", { code: EX, limit: 200 })).hails.some((x) => x.hail_id === inner.hail_id), "the hail is back on the market");
  });

  await check("sandbox inbox: wait returns a message or a new job at once, a held wait wakes on a message, and the last seat's wait runs the tick", async () => {
    const v = await (await fetch(`${w.base}/world/new`, { method: "POST" })).json(), { EX, D1 } = v.codes;
    const notJoined = await call(client, "wait", { code: D1, seconds: 1 });
    assert.equal(notJoined.isError, true); assert.match(notJoined.value, /join first/);
    await ok(client, "join", { code: EX });
    await ok(client, "join", { code: D1 });
    const m = await ok(client, "market", { code: EX, kind: "quick", limit: 50 });
    const a = await ok(client, "assign", { code: EX, hail_id: m.hails.find((h) => h.region === "inner").hail_id, desk: "D1" });
    const got = await ok(client, "wait", { code: D1, seconds: 10 });
    assert.deepEqual(got.events.map((e) => [e.kind, e.job_id]), [["assigned", a.assigned]]);
    assert.ok(got.waited_s < 5, "a full inbox comes back at once");
    await ok(client, "queue", { code: D1 });
    const t0 = Date.now(), held = ok(client, "wait", { code: D1, seconds: 20 });
    await new Promise((r) => setTimeout(r, 500));
    assert.deepEqual((await ok(client, "message", { code: EX, to: "D1", text: "Take j1 first." })).sent_to, ["D1"]);
    const woke = await held;
    assert.deepEqual(woke.events.map((e) => [e.kind, e.from, e.text]), [["message", "EX", "Take j1 first."]]);
    assert.ok(Date.now() - t0 < 15000, "the message woke the held wait");
    // D1 is waiting, so the executor's wait is the last one: the tick runs and comes back to it.
    const t = await ok(client, "wait", { code: EX, seconds: 10 });
    assert.deepEqual(t.events.map((e) => [e.kind, e.tick]), [["tick", 1]]);
    assert.equal(t.clock.tick, 1);
    assert.equal((await ok(client, "queue", { code: D1 })).inbox, 1, "D1's next wait has the tick");
    // The reference company, in its own instance, plays up to tick 1 and sends its scores back; company shows them.
    let ref = null;
    for (let i = 0; i < 60 && ref?.tick !== 1; i++) { ref = (await ok(client, "company", { code: EX })).scores.reference; if (ref?.tick !== 1) await new Promise((r) => setTimeout(r, 500)); }
    assert.equal(ref?.tick, 1, "the reference reached the world's tick");
    assert.ok(ref.company.ended > 0, "the reference flew jobs in its first tick");
  });

  await check("sandbox page: GET /world and GET /world/<id> serve the page; POST /world/<id>/codes gives new codes once and the old ones stop working", async () => {
    for (const path of ["/world", "/world/w_00000000000000000000"]) {
      const r = await fetch(`${w.base}${path}`), html = await r.text();
      assert.equal(r.status, 200, path);
      assert.match(r.headers.get("content-type"), /text\/html/);
      assert.match(html, /simulated/i);
      assert.doesNotMatch(html, /__WORLD__/);
    }
    assert.match(await (await fetch(`${w.base}/world/w_00000000000000000000`)).text(), /"w_00000000000000000000"/);
    const v = await (await fetch(`${w.base}/world/new`, { method: "POST" })).json();
    assert.equal(v.page, `${w.base}/world/${v.world_id}`);
    await ok(client, "join", { code: v.codes.EX });
    const re = await fetch(`${w.base}/world/${v.world_id}/codes`, { method: "POST" });
    assert.equal(re.status, 200);
    const fresh = await re.json();
    for (const seat of ["EX", "D1", "D2"]) assert.notEqual(fresh.codes[seat], v.codes[seat]);
    assert.ok(fresh.seats.every((x) => !x.joined));
    const old = await call(client, "join", { code: v.codes.EX });
    assert.equal(old.isError, true);
    assert.match(old.value, /seat code is not valid/);
    assert.equal((await ok(client, "join", { code: fresh.codes.EX })).role, "executor");
    const view = await (await fetch(v.view)).json();
    assert.equal(view.codes, undefined);
    assert.ok(Array.isArray(view.messages) && Array.isArray(view.reports));
    assert.equal(view.map.sky, view.clock.sky_now);
    assert.ok(view.map.places.some((p) => p.id === "saturn" && p.xy.length === 2) && view.map.places.some((p) => p.id === "titan-dock" && !p.xy));
    const get = await fetch(`${w.base}/world/${v.world_id}/codes`); assert.equal(get.status, 405); assert.equal(get.headers.get("allow"), "POST"); await get.body?.cancel();
    const miss = await fetch(`${w.base}/world/w_00000000000000000000/codes`, { method: "POST" }); assert.equal(miss.status, 404); await miss.body?.cancel();
  });

  await check("sandbox play: a scripted executor and two scripted dispatchers run a company for 8 ticks; jobs land, the inbox, scores, comms and map agree", async () => {
    const v = await (await fetch(`${w.base}/world/new`, { method: "POST" })).json(), C = v.codes, TICKS = 8;
    for (const seat of ["EX", "D1", "D2"]) await ok(client, "join", { code: C[seat], agent_name: "e2e " + seat, model: "scripted" });
    const flown = {}, reports = [], inbox = { EX: [], D1: [], D2: [] };
    // A dispatcher flies each planning job on the nearest of its desk's free ships that plans (parked at the pickup, then in
    // its planet's system): least energy, the planned fare and arrival, never asked at a checkpoint. It reports each job it flies.
    const dispatcher = async (seat) => {
      const q = await ok(client, "queue", { code: C[seat] });
      for (const j of q.jobs.filter((x) => x.phase === "planning")) {
        const h = await ok(client, "get_hail", { code: C[seat], job_id: j.job_id });
        const near = (f) => (f.parked_at.id === h.pickup_at.id ? 0 : R.system(f.parked_at.id) === R.system(h.pickup_at.id) ? 1 : 2);
        for (const c of h.fleet.filter((f) => f.busy_until === "free").sort((a, b) => near(a) - near(b)).slice(0, 3)) {
          const p = await call(client, "plan_pickup", { code: C[seat], job_id: j.job_id, car: c.car, objective: "energy" });
          if (p.isError || !p.value.leg_id || p.value.gate === "FAIL") continue;
          const r = await call(client, "plan_ride", { code: C[seat], job_id: j.job_id, after_leg: p.value.leg_id, objective: "energy" });
          if (r.isError || !r.value.leg_id || r.value.gate === "FAIL") continue;
          const d = await call(client, "dispatch", { code: C[seat], job_id: j.job_id, pickup_leg: p.value.leg_id, ride_leg: r.value.leg_id, quoted_fare_usd: r.value.fare_usd, quoted_arrival: r.value.arrive, ask_after_hours: "never" });
          if (d.isError || d.value.ok === false) continue;
          flown[j.job_id] = { seat, car: c.car, status: d.value.status };
          const text = "Flew " + j.job_id + " on " + c.car + ".";
          await ok(client, "report", { code: C[seat], job_id: j.job_id, text }); reports.push([seat, j.job_id, text]);
          break;
        }
      }
    };
    for (let t = 0; t < TICKS; t++) {
      // The executor gives each desk up to two quick hops in its region a tick, while the desk has a free ship.
      const co = await ok(client, "company", { code: C.EX }), free = Object.fromEntries(co.desks.map((d) => [d.desk, d.ships.filter((s) => s.free === "free").length]));
      const m = await ok(client, "market", { code: C.EX, kind: "quick", limit: 80 }), given = { D1: 0, D2: 0 };
      for (const hl of m.hails) {
        const desk = hl.region === "inner" ? "D1" : "D2";
        if (given[desk] >= Math.min(2, free[desk])) continue;
        const a = await call(client, "assign", { code: C.EX, hail_id: hl.hail_id, desk });
        if (!a.isError) given[desk]++;
      }
      await dispatcher("D1"); await dispatcher("D2");
      // Every seat waits; the last wait runs the tick. A seat whose inbox already held events comes back with those at once
      // (still counted as waiting), and gets the tick on its next wait.
      const waits = await Promise.all(["EX", "D1", "D2"].map((seat) => ok(client, "wait", { code: C[seat], seconds: 30 }).then((r) => [seat, r])));
      for (const [seat, r] of waits) inbox[seat].push(...r.events);
    }
    const view = await (await fetch(v.view)).json(), jobs = Object.fromEntries(view.jobs.map((j) => [j.job_id, j]));
    assert.equal(view.clock.tick, TICKS);
    for (const seat of ["EX", "D1", "D2"]) {
      const seen = inbox[seat].filter((e) => e.kind === "tick").map((e) => e.tick), pending = (await ok(client, seat === "EX" ? "company" : "queue", { code: C[seat] })).inbox;
      // A new tick replaces an unread one, so a seat whose wait comes back at once (its inbox held reports) and then runs
      // the next tick itself skips a number. What it sees still runs forward, ending at the last tick or with it waiting.
      assert.ok(seen.length >= 1 && seen.every((t, i) => t >= 1 && t <= TICKS && (i === 0 || t > seen[i - 1])), seat + " saw the ticks in order: " + JSON.stringify(seen));
      assert.ok(seen.at(-1) === TICKS || pending > 0, seat + " saw the last tick or has it waiting: " + JSON.stringify(seen) + " inbox " + pending);
    }
    const ids = Object.keys(flown);
    assert.ok(ids.length >= 3, "the scripted company flew at least 3 jobs: " + JSON.stringify(flown));
    for (const id of ids) {
      const j = jobs[id], desk = view.desks.find((d) => d.desk === flown[id].seat);
      assert.equal(j.desk, flown[id].seat); assert.equal(j.car, flown[id].car);
      assert.ok(desk.ships.some((s) => s.car === j.car), id + " flew on its own desk's ship");
      assert.ok(j.legs && j.legs.length >= 1 && j.legs.at(-1).arrive === j.lands, id + " has its legs, ending when it lands");
    }
    // Jobs whose landing the clock has passed have landed, and their desk and the executor heard.
    const landed = view.jobs.filter((j) => j.landed).map((j) => j.job_id).sort();
    for (const j of view.jobs) if (j.lands) assert.equal(j.landed, j.lands <= view.clock.sky_now, j.job_id + " lands " + j.lands);
    assert.ok(landed.length >= 1, "jobs landed: " + JSON.stringify(view.jobs.map((j) => [j.job_id, j.phase, j.lands, j.landed])));
    // A landing on the last tick is still in its seats' inboxes: one more wait each brings it (and may run another tick).
    for (const seat of ["EX", "D1", "D2"]) inbox[seat].push(...(await ok(client, "wait", { code: C[seat], seconds: 0 })).events);
    const heard = (seat) => inbox[seat].filter((e) => e.kind === "landed").map((e) => e.job_id);
    for (const id of landed) { assert.ok(heard("EX").includes(id), "EX heard " + id + " land"); assert.ok(heard(jobs[id].desk).includes(id), jobs[id].desk + " heard " + id + " land"); }
    for (const id of ids) assert.ok(!heard(flown[id].seat === "D1" ? "D2" : "D1").includes(id), "the other desk never hears " + id);
    // Scores: each desk's mean is the mean of its ended jobs' totals; the company serves those person-trips.
    for (const d of view.scores.desks) {
      const ended = view.jobs.filter((j) => j.desk === d.desk && (j.phase === "arrived" || j.phase === "abandoned"));
      assert.equal(d.ended, ended.length, d.desk);
      if (ended.length) assert.ok(Math.abs(d.mean - ended.reduce((a, j) => a + (j.total ?? 0), 0) / ended.length) <= 0.05, d.desk + " mean (rounded to 0.1)");
    }
    assert.ok(view.scores.company.served_person_trips > 0 && view.scores.company.score > 0);
    // Comms: every report reached the executor's inbox and the view, in the dispatcher's own words.
    assert.deepEqual(view.reports.map((r) => [r.seat, r.job_id, r.text]), reports);
    assert.deepEqual(inbox.EX.filter((e) => e.kind === "report").map((e) => [e.from, e.job_id, e.text]), reports);
    assert.ok(inbox.D1.some((e) => e.kind === "assigned") && inbox.D2.some((e) => e.kind === "assigned"));
    // The map has every ship's place, and the page serves for this world.
    const at = new Set(view.map.places.map((p) => p.id));
    for (const d of view.desks) for (const s of d.ships) assert.ok(at.has(s.at.id), s.car + " at " + s.at.id);
    assert.equal((await fetch(v.page)).status, 200);
    report.sandbox_play = { flown, landed, scores: view.scores, reports: reports.length };
  });

  await check("sandbox world: an unknown world_id is 404, a malformed path is 404, and the wrong method is 405", async () => {
    const miss = await fetch(`${w.base}/world/w_00000000000000000000.json`);
    assert.equal(miss.status, 404); assert.match((await miss.json()).error, /no world/);
    for (const path of ["/world/w_123.json", "/world/", "/world/new.json"]) { const r = await fetch(`${w.base}${path}`); assert.equal(r.status, 404, path); await r.body?.cancel(); }
    const get = await fetch(`${w.base}/world/new`); assert.equal(get.status, 405); assert.equal(get.headers.get("allow"), "POST"); await get.body?.cancel();
  });

  await client.close();
  await w.stop();

  await check("a stored seasonal booking survives a complete local Worker restart", async () => {
    const persist = mkdtempSync(join(tmpdir(), "starfare-restart-"));
    const vars = { STARFARE_OAUTH: "off", RATE_PER_MIN: "1000" };
    let worker, bot;
    try {
      worker = await startWorker(vars, persist);
      bot = await connect(worker.base);
      const listed = await ok(bot, "list_hails", { limit: 200 });
      let taken = null;
      for (const hail of listed.hails.filter((h) => h.kind === "quick")) {
        const reply = await call(bot, "take_hail", { hail_id: hail.hail_id });
        if (!reply.isError) { taken = reply.value; break; }
      }
      assert.ok(taken, "this season needs at least one takeable quick booking");
      await bot.close(); bot = null;
      await worker.stop({ keepStorage: true });
      worker = await startWorker(vars, persist);
      bot = await connect(worker.base);
      const restored = await ok(bot, "get_hail", { run_id: taken.run_id });
      assert.equal(restored.hail_id, taken.hail_id);
      assert.equal(restored.title, taken.title);
      assert.deepEqual(restored.pickup_at, taken.pickup_at);
      assert.deepEqual(restored.destination, taken.destination);
      const pad = await ok(bot, "check_pad", { run_id: taken.run_id, place: taken.pickup_at.id, hours: 1 });
      assert.equal(pad.place.id, taken.pickup_at.id);
    } finally {
      await bot?.close();
      if (worker) await worker.stop();
      else await rm(persist, { recursive: true, force: true });
    }
  });

  await check("per-IP rate limit answers 429 past RATE_PER_MIN", async () => {
    const w2 = await startWorker({ STARFARE_OAUTH: "off", RATE_PER_MIN: "5" });
    await freshMinute();
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
  const follow = /name="follow" value="([0-9a-f]{32})"/.exec(html)?.[1]; // a hidden field, sent as a browser would
  assert.ok(follow && html.includes(`/agent/${follow}`), "consent page shows no follow link");
  const posted = await fetch(authUrl, { ...noFollow, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header() }, body: new URLSearchParams({ handle, follow, decision }) });
  assert.equal(posted.status, 302, await posted.clone().text());
  return { html, follow, location: new URL(posted.headers.get("location")) };
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
  const { html, follow, location } = await consent(auth.authUrl);
  assert.equal(location.origin + location.pathname, REDIRECT_URI);
  assert.equal(location.searchParams.get("state"), auth.authUrl.searchParams.get("state"));
  await first.finishAuth(location.searchParams.get("code"));
  trace.push("-- reconnect with the access token --");
  const client = new Client({ name, version: "1" });
  await client.connect(new StreamableHTTPClientTransport(url, { authProvider: auth, fetch: tracingFetch(trace) }));
  return { auth, trace, client, html, follow };
}

async function phaseOn() {
  console.log("\n== STARFARE_OAUTH=on ==");
  const report = {};
  // The on server also keys its seasons (STARFARE_SEASON_KEY), as the live one will once the secret is set.
  const SEASON_KEY = "e2e-season-key-".padEnd(48, "s"), season = sky(Date.now()).season;
  for (const n of [season, season + 1]) NODE_SEEDS[n] = await keyedSeed(n, SEASON_KEY);
  const w = await startWorker({ STARFARE_OAUTH: "on", RATE_PER_MIN: "1000", STARFARE_SEASON_KEY: SEASON_KEY });
  const { base } = w;
  console.log(`wrangler dev up at ${base}`);
  let asMeta, a, b;
  try {
    await check("on: the sandbox's world routes answer 404 while STARFARE_SANDBOX is off, as wrangler.jsonc ships it", async () => {
      const made = await fetch(`${base}/world/new`, { method: "POST" }); assert.equal(made.status, 404); await made.body?.cancel();
      const view = await fetch(`${base}/world/w_00000000000000000000.json`); assert.equal(view.status, 404); await view.body?.cancel();
      const page = await fetch(`${base}/world`); assert.equal(page.status, 404); await page.body?.cancel();
    });
    await check("on: /, /engine.js, /board and /board.json stay public; /mcp without a token is 401", async () => {
      for (const path of ["/", "/engine.js", "/board", "/board.json", "/hails.json", "/assets/flight-view.js"]) { const r = await fetch(`${base}${path}`); assert.equal(r.status, 200, path); await r.body?.cancel(); }
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
    await check("on: SDK OAuth flow: 401, discovery, dynamic registration, PKCE S256, one-click Allow, token, then tools/list is the eleven ride-hail tools and start_bench", async () => {
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
    await check("on: a second grant is a different anonymous player; a signed-in player's run answers only them, since its run_id is public on the watch page", async () => {
      b = await sdkSignIn(base, "sol e2e player B");
      const m = await ok(b.client, "take_hail", { hail_id: "iss-crew" });
      assert.match(m.player_id, /^p_[0-9a-f]{16}$/); assert.notEqual(m.player_id, good.hail.player_id);
      const seen = await ok(a.client, "get_hail", { run_id: good.hail.run_id });
      assert.equal(seen.run_id, good.hail.run_id); assert.equal(seen.player_id, good.hail.player_id);
      const other = await call(b.client, "get_hail", { run_id: good.hail.run_id });
      assert.equal(other.isError, true); assert.equal(other.value, "unknown run_id. Call take_hail to get one.");
      const u = await call(b.client, "get_hail", { run_id: "run_" + "0".repeat(20) });
      assert.equal(u.isError, true); assert.match(u.value, /unknown run_id/);
      report.second_player = m.player_id;
    });
    await check("on: the follow link on the consent page lists the agent's booking with its log in words; take_hail returns the same link", async () => {
      assert.equal(good.hail.follow_url, `${base}/agent/${a.follow}`);
      const j = await (await fetch(`${base}/agent/${a.follow}.json`)).json();
      assert.equal(j.simulated, true);
      const run = j.runs.find((r) => r.run_id === good.hail.run_id);
      assert.ok(run, JSON.stringify(j.runs.map((r) => r.run_id)));
      assert.equal(run.phase, "arrived"); assert.equal(run.watch, true); assert.equal(run.total, good.score.total);
      assert.deepEqual(run.trail.map((e) => e.tool), ["take_hail", "plan_pickup", "plan_ride", "dispatch"]);
      assert.equal(run.trail[0].agent.name, "sol e2e player A");
      assert.equal(Object.hasOwn(run, "player_id"), false);
      const page = await fetch(`${base}/agent/${a.follow}`);
      assert.equal(page.status, 200); assert.match(await page.text(), /<script src="\/assets\/agent-log.js">/);
      assert.equal((await fetch(`${base}/agent/${"0".repeat(32)}.json`)).status, 404);
      assert.notEqual(b.follow, a.follow);
    });
    await check("on: /board shows the best run with its player tag", async () => {
      const j = await (await fetch(`${base}/board.json`)).json();
      assert.equal(j.best["iss-crew"].player_tag, good.hail.player_id.slice(2, 8));
      assert.equal(j.best["iss-crew"].run_id, good.hail.run_id);
      assert.equal(Object.hasOwn(j.best["iss-crew"], "player_id"), false);
      // The season standings count the signed-in players' attempts (mean over attempts, ranked from 3).
      assert.equal(j.standings.min_attempts, 3);
      assert.ok(j.standings.players >= 1, JSON.stringify(j.standings));
      assert.equal(j.standings.players, j.standings.unranked + j.standings.ranked.length);
      const html = await (await fetch(`${base}/board`)).text();
      assert.match(html, /Season standings/);
      assert.ok(html.includes(`planned by Grok bot · player ${good.hail.player_id.slice(2, 8)}`));
      assert.ok(html.includes(`href="/flight/${good.hail.run_id}"`));
      assert.ok(html.includes(R.BY["iss-crew"].title));
      const rec = await (await fetch(`${base}/rides/${good.hail.run_id}.json`)).json();
      assert.deepEqual(rec.score.parts.map((p) => p.key).sort(), ["checker", "dose", "economy", "energy", "fare", "on_time", "pickup", "promise", "recovery", "window"]);
      report.board_row = j.best["iss-crew"];
    });
    await check("on: a keyed season: rides name the season, the home page reads /sky.json, and the seed stays secret until the reset", async () => {
      const html = await (await fetch(`${base}/`)).text(), site = JSON.parse(/window\.SITE = (.*?);<\/script>/.exec(html)[1]);
      assert.equal(site.hazards, "reported");
      assert.ok(html.includes('<script src="/assets/conditions.js"></script>'));
      assert.equal((await fetch(`${base}/assets/conditions.js`)).status, 200);
      const j = await (await fetch(`${base}/sky.json`)).json();
      assert.equal(j.keyed, true); assert.equal(j.seed, undefined);
      assert.ok(j.report.at <= j.now_jd && Array.isArray(j.report.eruptions) && Array.isArray(j.report.pads_full));
      for (const w of [...j.report.eruptions, ...Object.values(j.report.storms).flat()]) assert.ok(w.start <= j.now_jd && (w.end === null || w.end <= j.now_jd));
      const season = await (await fetch(`${base}/seasons/${j.season}.json`)).json();
      assert.deepEqual([season.keyed, season.released, season.seed], [true, false, null]);
      const rec = await (await fetch(`${base}/rides/${good.hail.run_id}.json`)).json();
      assert.equal(rec.season, good.hail.season);
      assert.ok(Number.isInteger(rec.season));
      assert.equal(JSON.stringify(rec).includes("k1:"), false, "no seed in a ride record");
      const ep = await fetch(`${base}/flight/${good.hail.run_id}/episode.jsonl`);
      assert.equal(ep.status, 404, "a keyed season's episodes wait for the reset"); await ep.body?.cancel();
    });
    await check("on: SSE transport with the access token works (list_hails)", async () => {
      const sse = await connect(base, "sse", { requestInit: { headers: { Authorization: `Bearer ${a.auth.saved.access_token}` } } });
      try { assertSeasonPool((await ok(sse, "list_hails", { limit: 200 })).hails); } finally { await sse.close(); }
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
      const dropped = await ok(a.client, "take_hail", { hail_id: "iss-crew" }); // abandoned by the next take_hail
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
      assert.equal(iss.rides, 1); assert.equal(iss.best_total, good.score.total); assert.equal(iss.last_total, good.score.total);
      assert.equal(iss.mean_total, Math.round(good.score.total * 10) / 10);
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
      assert.ok(all.rides.every((r) => r.hail_id === "iss-crew" && r.phase === "planning"), JSON.stringify(all.rides));
      assert.ok(!all.rides.some((r) => [good.hail.run_id, second.hail.run_id].includes(r.run_id)));
      const x = await call(b.client, "get_my_rides", { run_id: good.hail.run_id });
      assert.equal(x.isError, true); assert.match(x.value, /not one of your rides/);
    });
    await check("on: /rides/<run_id>.json downloads one arrived ride; the export JSONL holds A's arrived rides; other ids and tokens are 404", async () => {
      const r = await fetch(`${base}/rides/${good.hail.run_id}.json`);
      assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /application\/json/);
      assert.match(r.headers.get("content-disposition"), /attachment; filename="run_[0-9a-f]{20}\.json"/);
      const { live, trail, manifest, ...plain } = await r.json();
      assert.deepEqual(plain, detail); assert.equal(live.lands_at_ms, live.track.at(-1)[0]); assert.deepEqual(trail.at(-1).tool, "dispatch");
      assert.equal(manifest.bookings[0].hail_id, good.hail.hail_id);
      assert.equal(manifest.seats, R.CAR[manifest.car].seats);
      assert.deepEqual(live.flown.filter((f) => f.kind === "planned").map((f) => f.leg_id), good.score.log.dispatched);
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
      const { live: _l, trail: _t, manifest: _m, ...line1 } = lines[1];
      assert.deepEqual(line1, detail); assert.ok(lines.every((l) => l.format === "starfare.ride/1" && l.simulated === true));
    });
    await check("on: start_bench opens the practice split and refuses the test split when the server has no bench key", async () => {
      const t = await call(b.client, "start_bench", { split: "test" });
      const d = await call(b.client, "start_bench", { split: "dev" });
      assert.equal(t.isError, true); assert.match(String(t.value), /STARFARE_BENCH_KEY/);
      assert.equal(d.isError, false);
      assert.equal(d.value.practice, true);
      assert.equal(d.value.tasks, 5);
    });
    await a.client.close(); await b?.client.close();
  } finally { await w.stop(); }

  await check("on: the per-IP rate limit covers /mcp and the OAuth endpoints", async () => {
    const w2 = await startWorker({ STARFARE_OAUTH: "on", RATE_PER_MIN: "5" });
    await freshMinute();
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
