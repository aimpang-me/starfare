#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const meta = JSON.parse(readFileSync(join(root, "connector", "src", "engine", "meta.json"), "utf8"));
const prefix = String(meta.sha256).slice(0, 16);
const origin = "https://starfare.aimpang.workers.dev";
const fails = [];

function say(ok, line) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${line}`);
  if (!ok) fails.push(line);
}

async function hit(path, method, body) {
  const headers = { "user-agent": "starfare-verify" };
  if (body) {
    headers["content-type"] = "application/json";
    headers.accept = "application/json, text/event-stream";
  }
  const res = await fetch(origin + path, { method, headers, body, redirect: "manual" });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, text: buf.toString("utf8"), bytes: buf.length };
}

console.log(`origin ${origin}`);
console.log(`expected_engine_prefix ${prefix}`);
console.log(`meta_bytes ${meta.bytes}`);

try {
  const pages = ["/", "/board", "/board.json", "/live.json", "/engine.js", "/bench"];
  const got = {};
  for (const path of pages) {
    const row = await hit(path, "GET");
    got[path] = row;
    say(row.status === 200, `GET ${path} ${row.status} bytes ${row.bytes}`);
  }

  const versions = [...got["/"].text.matchAll(/\/engine\.js\?v=([0-9a-f]+)/g)].map((match) => match[1]);
  const unique = [...new Set(versions)];
  say(unique.length === 1 && unique[0] === prefix, `home engine versions ${unique.join(" ") || "none"} expected ${prefix}`);

  const versioned = await hit(`/engine.js?v=${prefix}`, "GET");
  say(
    versioned.status === 200 && versioned.bytes === meta.bytes,
    `GET /engine.js?v=${prefix} ${versioned.status} bytes ${versioned.bytes} meta_bytes ${meta.bytes}`,
  );
  say(got["/engine.js"].bytes === meta.bytes, `GET /engine.js bytes ${got["/engine.js"].bytes} meta_bytes ${meta.bytes}`);

  let live = null;
  try {
    live = JSON.parse(got["/live.json"].text);
  } catch {
    live = null;
  }
  const flightCount = live && Array.isArray(live.flights) ? live.flights.length : "bad";
  say(
    Boolean(live) && live.simulated === true && Array.isArray(live.flights) && typeof live.now_ms === "number",
    `live.json simulated ${live ? live.simulated : "bad"} flights ${flightCount} now_ms ${live ? live.now_ms : "bad"}`,
  );

  let board = null;
  try {
    board = JSON.parse(got["/board.json"].text);
  } catch {
    board = null;
  }
  const bestOk = Boolean(board) && board.best !== null && typeof board.best === "object" && !Array.isArray(board.best);
  const statsOk = Boolean(board) && board.stats !== null && typeof board.stats === "object" && !Array.isArray(board.stats);
  const ids = bestOk ? Object.keys(board.best).sort() : [];
  const statKeys = statsOk ? Object.keys(board.stats).sort() : [];
  say(
    Boolean(board) && board.label === "planned by Grok bot" && bestOk && statsOk,
    `board.json label ${board ? board.label : "bad"} best ${ids.join(" ") || "none"} stats ${statKeys.join(" ") || "none"}`,
  );

  const mcp = await hit("/mcp", "POST", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
  const www = mcp.headers.get("www-authenticate") || "";
  say(mcp.status === 401 && www.startsWith("Bearer"), `POST /mcp ${mcp.status} www-authenticate ${www || "missing"} bytes ${mcp.bytes}`);
} catch (error) {
  say(false, `request failed ${error instanceof Error ? error.message : String(error)}`);
}

console.log("does not prove rendering");
console.log("does not prove a real MCP ride via OAuth");
console.log("does not prove the deploy version");
console.log(`${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
