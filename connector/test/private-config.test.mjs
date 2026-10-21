import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { OWNER_COOKIE, ownerGate } from "../src/owner.js";

// jsonc to JSON: drop // comments outside strings (none of these configs has "//" inside a string except in comments).
const load = (f) => JSON.parse(readFileSync(new URL("../" + f, import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/,\s*\/\/.*$/gm, ","));

test("the private configs are the public ones with only the private names, the sandbox and the gate changed", () => {
  const pub = load("wrangler.jsonc"), priv = load("wrangler.private.jsonc");
  assert.equal(priv.name, "starfare-private");
  assert.deepEqual(priv.vars, { ...pub.vars, STARFARE_SANDBOX: "on", STARFARE_OWNER_GATE: "on" });
  const ref = (c) => c.durable_objects.bindings.find((b) => b.name === "STARFARE_REF");
  assert.equal(ref(priv).script_name, "starfare-private-ref");
  const strip = (c) => ({ ...c, name: 0, vars: 0, durable_objects: { bindings: c.durable_objects.bindings.map((b) => ({ ...b, script_name: b.script_name && 1 })) } });
  assert.deepEqual(strip(priv), strip(pub));
  const pubRef = load("wrangler.ref.jsonc"), privRef = load("wrangler.private-ref.jsonc");
  assert.equal(privRef.name, "starfare-private-ref");
  for (const b of privRef.durable_objects.bindings) if (b.script_name) assert.equal(b.script_name, "starfare-private");
  assert.deepEqual(strip(privRef), strip(pubRef));
});

const KEY = "k".repeat(40), env = { STARFARE_OWNER_GATE: "on", STARFARE_OWNER_KEY: KEY };
const ok = async () => true;
const go = (path, init = {}, e = env) => ownerGate(new Request("https://x" + path, init), new URL("https://x" + path), e, ok);

test("the owner gate closes pages, keeps the agent's MCP and OAuth paths open, and opens with the right key", async () => {
  assert.equal((await go("/world", { headers: { accept: "text/html" } })).status, 401);
  assert.equal((await go("/world/new", { method: "POST" })).status, 401);
  assert.equal((await go("/authorize?x=1")).status, 401);
  for (const p of ["/mcp", "/token", "/register", "/.well-known/oauth-authorization-server"]) assert.equal(await go(p, { method: "POST" }), null, p);
  assert.match(await (await go("/robots.txt")).text(), /Disallow: \//);

  const form = (key, next) => go("/owner", { method: "POST", body: new URLSearchParams({ key, next }) });
  assert.equal((await form("wrong", "/world")).status, 401);
  const res = await form(KEY, "//evil.example/");
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/world");
  const set = res.headers.get("set-cookie");
  assert.ok(!set.includes(KEY));
  const c = set.split(";")[0];
  assert.ok(c.startsWith(OWNER_COOKIE + "="));
  assert.equal(await go("/world/new", { method: "POST", headers: { cookie: "a=b; " + c } }), null);
  assert.equal((await go("/world", { headers: { cookie: c + "x" } })).status, 401);
});

test("the owner gate fails closed without a long enough key, and limits sign-in attempts", async () => {
  for (const e of [{ STARFARE_OWNER_GATE: "on" }, { STARFARE_OWNER_GATE: "on", STARFARE_OWNER_KEY: "short" }]) {
    assert.equal((await go("/mcp", {}, e)).status, 503);
    assert.equal((await go("/world", {}, e)).status, 503);
  }
  const res = await ownerGate(new Request("https://x/owner", { method: "POST", body: new URLSearchParams({ key: KEY }) }), new URL("https://x/owner"), env, async () => false);
  assert.equal(res.status, 429);
});
