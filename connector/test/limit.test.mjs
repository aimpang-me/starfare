import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { allowed, clientKey, rpcCount } from "../src/limit.js";

const req = (ip, init) => new Request("http://x/mcp", { ...init, headers: { ...(init && init.headers), ...(ip ? { "cf-connecting-ip": ip } : {}) } });

/** StarfareHub with its Worker imports stripped and a do-nothing SQL store; only hit() is exercised. */
function hubOnly() {
  const source = readFileSync(new URL("../src/store.js", import.meta.url), "utf8")
    .replace(/^import\s[\s\S]*?;\r?\n/gm, "")
    .replace(/\bexport (?=const |class )/g, "");
  const deps = { DurableObject: class { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }, META: { sha256: "x" } };
  const { StarfareHub } = new Function(...Object.keys(deps), source + "\nreturn { StarfareHub };")(...Object.values(deps));
  return new StarfareHub({ storage: { sql: { exec: () => ({ toArray: () => [], one: () => ({}) }) } } }, {});
}

test("IPv4 counts per address; IPv6 counts per /64, however the address is written", () => {
  assert.equal(clientKey(req("203.0.113.7")), "203.0.113.7");
  assert.equal(clientKey(req(null)), "unknown");
  const a = clientKey(req("2001:db8:aa:bb:1:2:3:4")), b = clientKey(req("2001:0db8:00aa:00bb:ffff::9"));
  assert.equal(a, "2001:db8:aa:bb::/64");
  assert.equal(b, a);
  assert.equal(clientKey(req("2001:db8::1")), "2001:db8:0:0::/64");
  assert.equal(clientKey(req("::1")), "0:0:0:0::/64");
  assert.notEqual(clientKey(req("2001:db8:aa:bc::1")), a);
  assert.equal(clientKey(req("::ffff:198.51.100.2")), "198.51.100.2");
});

test("a JSON-RPC batch counts each message, and a batch over 10 is refused before it reaches the server", async () => {
  const post = (body) => req("1.1.1.1", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
  const msg = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_hails", arguments: {} } };
  assert.equal(await rpcCount(post(msg)), 1);
  assert.equal(await rpcCount(post([msg, msg, msg])), 3);
  assert.equal(await rpcCount(post([])), 1);
  assert.equal(await rpcCount(post("not json")), 1);
  assert.equal(await rpcCount(req("1.1.1.1")), 1);
  const big = await rpcCount(post(Array(11).fill(msg)));
  assert.ok(big instanceof Response);
  assert.equal(big.status, 400);
  assert.equal((await big.json()).error.code, -32600);
  const r = post([msg, msg]);
  await rpcCount(r);
  assert.equal((await r.json()).length, 2, "the body is still there for the MCP server");
});

test("the hub counts a minute per key and weighs batches, and a refused key is answered without the hub", async () => {
  const h = hubOnly();
  assert.deepEqual(h.hit("a", 3), { ok: true, n: 1, limit: 3 });
  assert.deepEqual(h.hit("a", 3, 2), { ok: true, n: 3, limit: 3 });
  assert.equal(h.hit("a", 3).ok, false);
  assert.equal(h.hit("b", 3).ok, true);
  h.hitsWin -= 1; // the next minute starts empty
  assert.deepEqual(h.hit("a", 3), { ok: true, n: 1, limit: 3 });

  let calls = 0;
  const counted = { hit: (k, limit, n) => { calls++; return h.hit(k, limit, n); } };
  assert.equal(await allowed(counted, "c", 1), true);
  assert.equal(await allowed(counted, "c", 1), false);
  assert.equal(await allowed(counted, "c", 1), false);
  assert.equal(calls, 2, "the third request never reached the hub");
});

test("past 20,000 keys in a minute, new keys share one bucket, so a flood of addresses cannot grow the map", () => {
  const h = hubOnly();
  for (let i = 0; i < 20000; i++) h.hit("ip" + i, 5);
  assert.equal(h.hits.size, 20000);
  for (let i = 0; i < 5; i++) assert.equal(h.hit("new" + i, 5).ok, true);
  assert.equal(h.hit("new-more", 5).ok, false);
  assert.equal(h.hits.size, 20001);
  assert.equal(h.hit("ip1", 5).ok, true, "keys already counted keep their own budget");
});

test("the held-out bench allows a few sessions per key per UTC day, and the next day starts fresh", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const source = readFileSync(new URL("../src/store.js", import.meta.url), "utf8")
    .replace(/^import\s[\s\S]*?;\r?\n/gm, "")
    .replace(/\bexport (?=const |class )/g, "");
  const deps = { DurableObject: class { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }, META: { sha256: "x" } };
  const { StarfareHub } = new Function(...Object.keys(deps), source + "\nreturn { StarfareHub };")(...Object.values(deps));
  const db = new DatabaseSync(":memory:");
  const h = new StarfareHub({ storage: { sql: { exec(q, ...a) { const rows = db.prepare(q).all(...a); return { toArray: () => rows, one: () => rows[0] }; } } } }, {});
  const real = Date.now, DAY = 864e5, T = 1_800_000_000_000;
  try {
    Date.now = () => T;
    assert.deepEqual([1, 2, 3, 4].map(() => h.benchQuota("player:a", 3).ok), [true, true, true, false]);
    assert.equal(h.benchQuota("player:b", 3).ok, true, "each key has its own count");
    Date.now = () => T + DAY;
    assert.deepEqual(h.benchQuota("player:a", 3), { ok: true, n: 1, limit: 3 });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bench_quota").get().n, 1, "yesterday's rows are gone");
  } finally { Date.now = real; }
});
