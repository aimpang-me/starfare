// End-to-end check of the sandbox spike (src/spike.js) under `wrangler dev`: three MCP clients join three seats of one test
// world, each on its own session; a note wakes a waiting seat; a wait runs past the SDK's 60 s default request timeout;
// a client that asks for progress gets it. Also checks that without STARFARE_SPIKE the tools and pages are not there.
// Run: node build.mjs && node test/spike-e2e.mjs   (about two minutes)
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { stopWorkerProcess } from "./worker-process.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const results = [];
async function check(name, fn) {
  try { await fn(); results.push(true); console.log(`PASS  ${name}`); }
  catch (e) { results.push(false); console.log(`FAIL  ${name}\n      ${String(e?.stack ?? e).split("\n").slice(0, 6).join("\n      ")}`); }
}

async function startWorker(vars) {
  const port = await freePort(), persist = mkdtempSync(join(tmpdir(), "sol-spike-")), log = [];
  const args = [join(DIR, "node_modules", "wrangler", "bin", "wrangler.js"), "dev", "--port", String(port), "--ip", "127.0.0.1", "--persist-to", persist];
  for (const [k, v] of Object.entries(vars)) args.push("--var", `${k}:${v}`);
  const child = spawn(process.execPath, args, { cwd: DIR, detached: true, windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" } });
  child.stdout.on("data", (c) => log.push(String(c))); child.stderr.on("data", (c) => log.push(String(c)));
  let exited = false; child.on("exit", () => { exited = true; });
  const base = `http://127.0.0.1:${port}`, deadline = Date.now() + 180_000;
  for (;;) {
    if (exited) throw new Error(`wrangler dev exited early:\n${log.join("").slice(-2000)}`);
    if (Date.now() > deadline) throw new Error(`wrangler dev not ready:\n${log.join("").slice(-2000)}`);
    try { await fetch(`${base}/`); break; } catch { await sleep(250); }
  }
  return { base, stop: async () => { await stopWorkerProcess(child); await rm(persist, { recursive: true, force: true }).catch(() => {}); } };
}
async function connect(base, name) {
  const client = new Client({ name, version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  return client;
}
async function call(client, name, args = {}, opts) {
  const r = await client.callTool({ name, arguments: args }, undefined, opts);
  const text = r.content[0].text;
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return { isError: r.isError === true, value };
}

const vars = { STARFARE_OAUTH: "off", RATE_PER_MIN: "1000" };

let w = await startWorker(vars);
await check("without STARFARE_SPIKE: no join, wait or send tools and no /spike page", async () => {
  const c = await connect(w.base, "off");
  const names = (await c.listTools()).tools.map((t) => t.name);
  for (const n of ["join", "wait", "send"]) assert.ok(!names.includes(n), n);
  await c.close();
  assert.equal((await fetch(`${w.base}/spike`)).status, 404);
  assert.equal((await fetch(`${w.base}/spike/new`, { method: "POST" })).status, 404);
});
await w.stop();

w = await startWorker({ ...vars, STARFARE_SPIKE: "on" });
const opened = await (await fetch(`${w.base}/spike/new`, { method: "POST" })).json();
const ex = await connect(w.base, "chat-ex"), d1 = await connect(w.base, "chat-d1"), d2 = await connect(w.base, "chat-d2");

await check("the page and a world with three seat codes", async () => {
  assert.match(opened.world, /^[0-9a-f]{32}$/);
  for (const k of ["EX", "D1", "D2"]) assert.match(opened.codes[k], new RegExp(`^${k}-[A-HJ-NP-Z2-9]{5}$`));
  const page = await (await fetch(`${w.base}/spike/${opened.world}`)).text();
  assert.match(page, /Sandbox connection test/);
  assert.equal((await fetch(`${w.base}/spike/${"0".repeat(32)}.json`)).status, 404);
});

await check("three clients join three seats, each on its own session", async () => {
  const r = [await call(ex, "join", { code: opened.codes.EX, agent_name: "ex" }), await call(d1, "join", { code: opened.codes.D1.toLowerCase() }), await call(d2, "join", { code: opened.codes.D2 })];
  for (const x of r) { assert.equal(x.isError, false, JSON.stringify(x.value)); assert.equal(x.value.joined, true); assert.equal(x.value.warning, undefined); }
  assert.equal(new Set(r.map((x) => x.value.session)).size, 3);
  assert.equal(r[2].value.seats.filter((s) => s.joined).length, 3);
  const bad = await call(d1, "join", { code: "D1-AAAAA" });
  assert.equal(bad.isError, true);
});

await check("a client without a seat is told so, and can pass its code instead", async () => {
  const other = await connect(w.base, "chat-new");
  const r = await call(other, "wait", { seconds: 1 });
  assert.equal(r.isError, true); assert.match(r.value, /has no seat/);
  const ok = await call(other, "wait", { seconds: 1, code: opened.codes.D1 });
  assert.equal(ok.isError, false); assert.equal(ok.value.woke_by, "timeout");
  await other.close();
});

await check("a note wakes a waiting seat, and only once", async () => {
  const t = Date.now(), waiting = call(d2, "wait", { seconds: 30 });
  await sleep(3000);
  const s = await call(ex, "send", { to: "D2", text: "wake up, D2" });
  assert.equal(s.value.sent, true);
  const r = await waiting;
  assert.equal(r.value.woke_by, "note"); assert.equal(r.value.notes.length, 1); assert.equal(r.value.notes[0].from, "EX");
  assert.ok(Date.now() - t < 12000, "woke within a few seconds of the note");
  const again = await call(d2, "wait", { seconds: 2 });
  assert.equal(again.value.woke_by, "timeout"); assert.equal(again.value.notes.length, 0);
  assert.equal((await call(ex, "send", { to: "EX", text: "me" })).isError, true);
});

await check("a client that asks for progress gets one every 10 s", async () => {
  const seen = [];
  const r = await call(d1, "wait", { seconds: 12 }, { onprogress: (p) => seen.push(p), timeout: 30000 });
  assert.equal(r.value.woke_by, "timeout");
  assert.ok(seen.length >= 1, "progress notifications: " + seen.length);
});

await check("a 75 s wait runs to its end past the SDK's 60 s default timeout", async () => {
  const r = await call(d1, "wait", { seconds: 75 }, { timeout: 120000 });
  assert.equal(r.value.woke_by, "timeout"); assert.ok(r.value.elapsed_s >= 74, String(r.value.elapsed_s));
});

await check("one client joining two seats is flagged", async () => {
  const r = await call(ex, "join", { code: opened.codes.D1 });
  assert.match(r.value.warning, /more than one chat/);
  assert.ok(r.value.note && /moved/.test(r.value.note));
});

await check("the page's log has the joins, notes and waits", async () => {
  const v = await (await fetch(`${w.base}/spike/${opened.world}.json`)).json();
  const kinds = v.events.map((e) => e.kind);
  for (const k of ["opened", "join", "send", "wait_start", "wait_end"]) assert.ok(kinds.includes(k), k);
  assert.ok(v.events.some((e) => e.kind === "wait_end" && e.woke_by === "note"));
  assert.ok(v.events.some((e) => e.kind === "wait_start" && e.progress_token));
  assert.ok(v.events.some((e) => e.by === "code"));
  const later = await (await fetch(`${w.base}/spike/${opened.world}.json?after=${v.events[v.events.length - 1].seq}`)).json();
  assert.equal(later.events.length, 0);
});

for (const c of [ex, d1, d2]) await c.close().catch(() => {});
await w.stop();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
