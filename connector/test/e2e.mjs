// End-to-end check of the Starfare connector: the game, a simulated company that three agents run in seats. Starts
// `wrangler dev` (real workerd, local Durable Objects) beside the reference company's Worker, and drives them with the MCP
// SDK v1 client, like a Grok bot would. Two modes, both run by default:
//   off: --var STARFARE_OAUTH:off, no auth (wrangler.jsonc ships with "on").
//   on:  STARFARE_OAUTH=on. The SDK's own OAuth client does what grok.com does: follow the 401 to the metadata, register
//        itself (DCR), authorize with PKCE, press Allow on the consent page, exchange the code, then join a seat.
// Run: node build.mjs && node test/e2e.mjs [--mode=off|on|both]
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
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
import { isoJD } from "../src/game.js";
import { stopWorkerProcess } from "./worker-process.mjs";

const DIR = fileURLToPath(new URL("..", import.meta.url));
const MODE = (process.argv.find((a) => a.startsWith("--mode=")) || "--mode=both").slice(7);
if (!["off", "on", "both"].includes(MODE)) throw new Error("--mode must be off, on or both");
const E = createRequire(import.meta.url)("../src/engine/sol-page.cjs");
const R = E.R;
const META = JSON.parse(readFileSync(new URL("../src/engine/meta.json", import.meta.url), "utf8"));
const SANDBOX_SEAT_TOOLS = ["join", "company", "market", "assign", "decline", "transfer_ship", "reports", "queue", "report", "hand_back", "wait", "message"];
const GAME_RUN_TOOL_NAMES = ["check_pad", "decide", "dispatch", "get_hail", "plan_leg", "plan_pickup", "plan_ride", "space_weather"];
const GAME_TOOLS = [...SANDBOX_SEAT_TOOLS, ...GAME_RUN_TOOL_NAMES].sort();

const results = [];
let workerLog = [];
async function check(name, fn) {
  const from = workerLog.length;
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS  ${name}`); }
  catch (error) {
    results.push({ name, ok: false }); console.log(`FAIL  ${name}\n      ${String(error?.stack ?? error).split("\n").slice(0, 6).join("\n      ")}${error?.cause ? `\n      cause: ${error.cause?.code ?? ""} ${error.cause?.message ?? error.cause}` : ""}`);
    const errs = workerLog.slice(from).join("").split("\n").filter((l) => /error|exception|uncaught/i.test(l)).slice(0, 12);
    if (errs.length) console.log(`      wrangler dev said:\n      ${errs.join("\n      ")}`);
  }
}
// wrangler dev's ProxyWorker keeps pooled connections to the local Worker. When the Worker's isolate has been busy for
// seconds (a long plan on a slow or shared runner) while a streaming response is open, as an MCP session's is, a pooled
// connection can be dead, and the next request fails with "Network connection lost" before it reaches the Worker: it never
// runs. wrangler retries GET and HEAD for this; a deployed Worker has no ProxyWorker. So a request that comes back as that
// 500, with the ProxyWorker saying so in wrangler's log, is sent once more. Each one is counted in the summary.
const devFetch = globalThis.fetch;
let proxyRetries = 0;
const proxyDropped = (from) => /Error inside ProxyWorker[^\n]*Network connection lost/.test(workerLog.slice(from).join(""));
globalThis.fetch = async (input, init) => {
  const from = workerLog.length, r = await devFetch(input, init);
  if (r.status !== 500 || !(typeof input === "string" || input instanceof URL) || (init?.body != null && typeof init.body !== "string")) return r;
  if (!/^Error: Network connection lost\./.test(await r.clone().text())) return r;
  for (let i = 0; i < 20 && !proxyDropped(from); i++) await sleep(100);
  if (!proxyDropped(from)) return r;
  proxyRetries++;
  return devFetch(input, init);
};
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
async function startWorker(vars = {}, persistTo = null, { ref = true } = {}) {
  const port = await freePort(), persist = persistTo || mkdtempSync(join(tmpdir(), "sol-e2e-")), log = workerLog = [];
  // The reference keeps its own storage: two wrangler dev processes on one --persist-to share miniflare's trace database,
  // which then answers SQLITE_BUSY.
  const refPersist = mkdtempSync(join(tmpdir(), "sol-e2e-ref-"));
  const registry = mkdtempSync(join(tmpdir(), "sol-e2e-registry-")), env = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1", WRANGLER_REGISTRY_PATH: registry };
  const spawnDev = async (args, tag, to = persist) => {
    const child = spawn(process.execPath, [join(DIR, "node_modules", "wrangler", "bin", "wrangler.js"), "dev", ...args, "--ip", "127.0.0.1", "--persist-to", to], { cwd: DIR, detached: true, windowsHide: true, env });
    running.add(child);
    const keep = (c) => { log.push(tag + String(c)); if (process.env.E2E_WRANGLER_LOG) appendFileSync(process.env.E2E_WRANGLER_LOG, `${new Date().toISOString()} ${tag}${c}`); };
    child.stdout.on("data", keep); child.stderr.on("data", keep);
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
  // The reference company's Worker (wrangler.ref.jsonc) runs as a second wrangler dev; checks that make no world skip it.
  if (ref) {
    const refPort = await freePort(), ref = await spawnDev(["-c", "wrangler.ref.jsonc", "--port", String(refPort), "--inspector-port", String(await freePort())], "[ref] ", refPersist);
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
    for (const dir of [registry, refPersist]) try { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
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
const timings = []; // wall time per tool call through wrangler dev (includes MCP + Durable Object hops)
async function ok(client, name, args) {
  const r = await call(client, name, args);
  timings.push({ tool: name, what: args?.hail_id ?? args?.car ?? args?.after_leg ?? "", ms: r.ms });
  assert.equal(r.isError, false, `${name} failed: ${JSON.stringify(r.value)}`);
  return r.value;
}


async function phaseOff() {
  console.log("\n== STARFARE_OAUTH=off ==");
  const report = {};
  // wrangler.jsonc ships OAuth "on" (the live setting); this server runs without it.
  const w = await startWorker({ STARFARE_OAUTH: "off", RATE_PER_MIN: "1000" });
  console.log(`wrangler dev up at ${w.base}`);
  const client = await connect(w.base);

  await check("game: tools/list is the seat tools and the run tools only, and each run tool takes code and job_id, not run_id", async () => {
    const tools = (await client.listTools()).tools, names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, GAME_TOOLS);
    for (const t of tools.filter((x) => GAME_RUN_TOOL_NAMES.includes(x.name))) {
      assert.ok(t.inputSchema.required.includes("code") && t.inputSchema.required.includes("job_id"), t.name);
      assert.ok(!("run_id" in t.inputSchema.properties), t.name);
    }
    const info = client.getInstructions();
    assert.ok(info.includes(`${w.base}/world`), info);
    assert.doesNotMatch(info, /take_hail|list_hails|start_bench|check_in|\/board/);
  });

  await check("game: GET / is the page that starts a company, hardened; the older game's pages and data are gone (404)", async () => {
    const r = await fetch(`${w.base}/`), html = await r.text();
    assert.equal(r.status, 200);
    assert.ok(html.includes("const WORLD = null;") && html.includes("Start a company"));
    for (const [k, v] of [["x-content-type-options", "nosniff"], ["referrer-policy", "no-referrer"], ["x-frame-options", "DENY"]]) assert.equal(r.headers.get(k), v, k);
    assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.ok(html.includes("/mcp") && html.includes("grok.com/connectors"), "the page says how to add the connector");
    const src = `${w.base}/engine.js?v=${META.sha256.slice(0, 16)}`, js = await fetch(src);
    assert.equal(js.status, 200); assert.match(js.headers.get("cache-control"), /immutable/);
    assert.ok((await js.text()).includes("module.exports = SOLE"));
    for (const path of ["/board", "/board.json", "/hails.json", "/live.json", "/sky.json", "/bench", "/comms/new", `/agent/${"0".repeat(32)}`, `/flight/run_${"0".repeat(20)}`, `/rides/run_${"0".repeat(20)}.json`, "/seasons/1.json", "/method"]) {
      const x = await fetch(`${w.base}${path}`); assert.equal(x.status, 404, path); await x.body?.cancel();
    }
    for (const path of ["/world", "/assets/message-b.css"]) { const x = await fetch(`${w.base}${path}`); assert.equal(x.status, 200, path); await x.body?.cancel(); }
  });

  await check("game: a call without a valid seat code is told to get one from /world", async () => {
    for (const [tool, args] of [["join", { code: "not-a-seat-code-at-all-0000" }], ["get_hail", { code: "not-a-seat-code-at-all-0000", job_id: "j1" }]]) {
      const r = await call(client, tool, args);
      assert.equal(r.isError, true, tool); assert.match(r.value, /seat code is not valid/); assert.ok(r.value.includes(`${w.base}/world`), r.value);
    }
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
    for (let i = 0; i < 120 && ref?.tick !== 1; i++) { ref = (await ok(client, "company", { code: EX })).scores.reference; if (ref?.tick !== 1) await new Promise((r) => setTimeout(r, 500)); }
    assert.equal(ref?.tick, 1, "the reference reached the world's tick");
    assert.ok(ref.company.ended > 0, "the reference flew jobs in its first tick");
  });

  await check("sandbox page: GET /world and GET /world/<id> serve the page and its 3D map scripts; POST /world/<id>/codes gives new codes once and the old ones stop working", async () => {
    for (const path of ["/world", "/world/w_00000000000000000000"]) {
      const r = await fetch(`${w.base}${path}`), html = await r.text();
      assert.equal(r.status, 200, path);
      assert.match(r.headers.get("content-type"), /text\/html/);
      assert.match(html, /simulated/i);
      assert.doesNotMatch(html, /__WORLD__|__ENGINE_URL__/);
    }
    const page = await (await fetch(`${w.base}/world/w_00000000000000000000`)).text();
    assert.match(page, /"w_00000000000000000000"/);
    // The 3D map's scripts: the engine at its cacheable URL, and the map itself.
    const eng = /const ENGINE_URL = "([^"]+)"/.exec(page);
    assert.ok(eng && /^\/engine\.js\?v=[0-9a-f]{16}$/.test(eng[1]), "engine URL");
    for (const path of [eng[1], "/assets/company-map.js"]) assert.equal((await fetch(`${w.base}${path}`)).status, 200, path);
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

  await check("off: no OAuth: /mcp needs no token and the OAuth endpoints are 404", async () => {
    const r = await fetch(`${w.base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "curl", version: "1" } } }) });
    assert.equal(r.status, 200); assert.equal(r.headers.get("www-authenticate"), null); await r.body?.cancel();
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server", "/authorize", "/token", "/register"]) {
      const g = await fetch(`${w.base}${path}`, { redirect: "manual" });
      assert.equal(g.status, 404, path); await g.body?.cancel();
    }
  });
  await client.close();
  await w.stop();

  await check("a world survives a complete local Worker restart: its view and its seat codes", async () => {
    const persist = mkdtempSync(join(tmpdir(), "starfare-restart-"));
    const vars = { STARFARE_OAUTH: "off", RATE_PER_MIN: "1000" };
    let worker, bot;
    try {
      worker = await startWorker(vars, persist);
      const v = await (await fetch(`${worker.base}/world/new`, { method: "POST" })).json();
      bot = await connect(worker.base);
      await ok(bot, "join", { code: v.codes.D1, agent_name: "before restart" });
      await bot.close(); bot = null;
      await worker.stop({ keepStorage: true });
      worker = await startWorker(vars, persist);
      const after = await (await fetch(`${worker.base}/world/${v.world_id}.json`)).json();
      assert.equal(after.world_id, v.world_id);
      assert.equal(after.seats[1].agent.name, "before restart");
      bot = await connect(worker.base);
      assert.equal((await ok(bot, "queue", { code: v.codes.D1 })).name, "Inner desk", "the old seat code still works");
    } finally {
      await bot?.close();
      if (worker) await worker.stop();
      else await rm(persist, { recursive: true, force: true });
    }
  });

  await check("per-IP rate limit answers 429 past RATE_PER_MIN", async () => {
    const w2 = await startWorker({ STARFARE_OAUTH: "off", RATE_PER_MIN: "5" }, null, { ref: false });
    await freshMinute();
    try {
      const statuses = [];
      for (let i = 0; i < 7; i++) {
        const r = await fetch(`${w2.base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "curl", version: "1" } } }) });
        statuses.push(r.status); await r.body?.cancel();
      }
      assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
      const home = await fetch(`${w2.base}/`); assert.equal(home.status, 200, "the pages are not rate limited"); await home.body?.cancel();
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
  assert.ok(!html.includes("/agent/") && !html.includes("/board") && html.includes("seat code"), "the consent page names seats, not bookings");
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
  let asMeta, a;
  try {
    await check("on: /, /world and /engine.js stay public; /mcp without a token is 401", async () => {
      for (const path of ["/", "/world", "/engine.js", "/assets/message-b.css"]) { const r = await fetch(`${base}${path}`); assert.equal(r.status, 200, path); await r.body?.cancel(); }
      const made = await fetch(`${base}/world/new`, { method: "POST" }); assert.equal(made.status, 201); await made.body?.cancel();
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
    await check("on: SDK OAuth flow: 401, discovery, dynamic registration, PKCE S256, one-click Allow, token, then tools/list is the game's tools and the instructions name /world", async () => {
      a = await sdkSignIn(base, "sol e2e player A");
      const q = a.auth.authUrl.searchParams;
      assert.equal(q.get("code_challenge_method"), "S256"); assert.ok(q.get("code_challenge"));
      assert.equal(q.get("client_id"), a.auth.client.client_id);
      assert.equal(q.get("resource"), `${base}/mcp`);
      assert.ok(a.auth.saved.access_token && a.auth.saved.refresh_token);
      assert.ok(a.trace.some((t) => t.startsWith("POST /register 201")), a.trace.join("\n"));
      assert.ok(a.trace.some((t) => t.startsWith("POST /token 200")), a.trace.join("\n"));
      const names = (await a.client.listTools()).tools.map((t) => t.name).sort();
      assert.deepEqual(names, GAME_TOOLS);
      assert.ok(a.client.getInstructions().includes(`${base}/world`));
      report.sdk_requests = a.trace;
      report.authorize_query = Object.fromEntries([...q].map(([k, v]) => [k, k === "code_challenge" || k === "client_id" ? v.slice(0, 8) + "…" : v]));
    });
    if (!a) return;
    await check("on: a signed-in agent joins a seat and plays it", async () => {
      const v = await (await fetch(`${base}/world/new`, { method: "POST" })).json();
      assert.equal((await ok(a.client, "join", { code: v.codes.EX, agent_name: "e2e oauth" })).role, "executor");
      assert.ok((await ok(a.client, "market", { code: v.codes.EX, limit: 5 })).hails.length > 0);
      const view = await (await fetch(v.view)).json();
      assert.equal(view.seats[0].agent.name, "e2e oauth");
    });
    await check("on: SSE transport with the access token works (join with a bad code is told to get one from /world)", async () => {
      const sse = await connect(base, "sse", { requestInit: { headers: { Authorization: `Bearer ${a.auth.saved.access_token}` } } });
      try {
        const r = await call(sse, "join", { code: "not-a-seat-code-at-all-0000" });
        assert.equal(r.isError, true); assert.ok(r.value.includes(`${base}/world`), r.value);
      } finally { await sse.close(); }
    });
    await check("on: a refreshed access token works: the agent joins a seat with it", async () => {
      const r = await fetch(asMeta.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: a.auth.saved.refresh_token, client_id: a.auth.client.client_id, resource: `${base}/mcp` }) });
      assert.equal(r.status, 200, await r.clone().text());
      const t = await r.json();
      assert.notEqual(t.access_token, a.auth.saved.access_token);
      const c = await connect(base, "streamable-http", { requestInit: { headers: { Authorization: `Bearer ${t.access_token}` } } });
      try {
        const v = await (await fetch(`${base}/world/new`, { method: "POST" })).json();
        assert.equal((await ok(c, "join", { code: v.codes.EX })).role, "executor");
      } finally { await c.close(); }
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
  } finally {
    await a?.client.close();
    await w.stop();
  }
  await check("on: the per-IP rate limit covers /mcp and the OAuth endpoints", async () => {
    const w2 = await startWorker({ STARFARE_OAUTH: "on", RATE_PER_MIN: "5" }, null, { ref: false });
    await freshMinute();
    try {
      const statuses = [];
      for (const path of ["/mcp", "/.well-known/oauth-authorization-server", "/register", "/mcp", "/token", "/authorize", "/mcp"]) {
        const r = await fetch(`${w2.base}${path}`, { method: path === "/mcp" || path === "/register" || path === "/token" ? "POST" : "GET", ...noFollow });
        statuses.push(`${path} ${r.status}`); await r.body?.cancel();
      }
      assert.deepEqual(statuses.slice(5).map((s) => s.split(" ")[1]), ["429", "429"], statuses.join(", "));
      assert.ok(statuses.slice(0, 5).every((s) => !s.endsWith(" 429")), statuses.join(", "));
      const home = await fetch(`${w2.base}/`); assert.equal(home.status, 200, "the pages are not rate limited"); await home.body?.cancel();
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
if (proxyRetries) console.log(`resent ${proxyRetries} request(s) that wrangler dev's ProxyWorker dropped before they reached the Worker`);
console.log(`\n${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
