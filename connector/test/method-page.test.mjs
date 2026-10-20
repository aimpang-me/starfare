import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { EPISODE_SCHEMA } from "../src/episode.js";
import { SKY, RIDE_FORMAT, POOL_TIERS } from "../src/game.js";
import { methodPage } from "../src/method.js";
import { stopWorkerProcess } from "./worker-process.mjs";

const require = createRequire(import.meta.url);
const E = require("../src/engine/sol-page.cjs");
const R = E.R;
const root = new URL("../", import.meta.url);
const repo = new URL("../../", import.meta.url);
const html = methodPage(E, SKY);

const UNIT_WORDS = { min: "minutes", kWh: "kWh", kg: "kg", USD: "USD", legs: "count", plans: "count", mSv: "mSv" };

function scoreProbe() {
  const t0 = 2461700.5;
  const legs = [
    { from: "orbital-depot", to: "iss", arr_jd: t0 + 0.03, kwh: 400, fare: 80, gate: "PASS", xenon_kg: 1 },
    { from: "iss", to: "lunar-data-center", arr_jd: t0 + 5, kwh: 37000, fare: 8000, gate: "PASS", xenon_kg: 90 },
  ];
  return R.score("iss-crew", legs, {
    t0, arrive_by_jd: t0 + 9, par_kwh: 37400, best_wait_days: 0.03, plan_calls: 2, ship: "sf-01",
    window_kwh: 37400, throttled_kwh: 37400, hindsight_kwh: 37400,
    quote: { fare_usd: 8000, arrival: R.iso(t0 + 5) },
    flown: { pickup_jd: t0 + 0.03, arrive_jd: t0 + 5, used_kwh: 37400, extra_kwh: 0, incidents: [] },
  });
}

function row(attr, value) {
  const marker = `${attr}="${value}"`;
  const at = html.indexOf(marker);
  assert.notEqual(at, -1, marker);
  const end = html.indexOf("</tr>", at);
  return html.slice(at, end);
}

test("the page renders every score part from the engine", () => {
  const scored = scoreProbe();
  assert.equal(scored.out_of, R.SCORE_TOTAL);
  assert.equal(scored.score_version, 4);
  assert.equal(R.SCORE_TOTAL, 100000);
  assert.equal(scored.parts.reduce((s, p) => s + p.max, 0), 100000);
  assert.match(html, new RegExp("Score version " + scored.score_version + " scores out of " + R.SCORE_TOTAL));
  assert.match(html, /The weights are placeholders\./);
  assert.match(html, new RegExp("earns its full weight when the flight is on the stated reference \\(a headroom of " + R.SCORE_HEADROOM + "\\)"));
  assert.match(html, new RegExp("falloff steepness is " + R.SCORE_STEEPNESS));
  assert.match(html, /simulated assumption/);
  for (const p of scored.parts) {
    const line = row("data-key", p.key);
    assert.match(line, new RegExp(">" + p.label + "<"));
    assert.match(line, new RegExp(">" + p.max + "<"));
    assert.match(line, new RegExp(">" + UNIT_WORDS[p.unit] + "<"));
    assert.match(line, new RegExp(">" + p.unit + "<"));
  }
  assert.match(html, new RegExp(R.CRUISE_MSV_DAY + " mSv per day"));
  assert.match(html, /Zeitlin et al\. 2013/);
  const dose = scored.parts.find((p) => p.key === "dose");
  assert.equal(dose.max, 0);
  assert.match(row("data-key", "dose"), /scores 0/);
});

test("the page renders every ship class from the engine", () => {
  const fare = { perKwh: E.fare(1, 0).energy_usd, perMin: E.fare(0, 1 / 1440).time_usd };
  assert.match(html, new RegExp("\\$" + fare.perKwh + " per kWh plus \\$" + fare.perMin + " per minute"));
  assert.match(html, /made up on purpose/);
  assert.match(html, new RegExp("Standard gravity is " + E.G0 + " m/s\\^2"));
  const engineSrc = readFileSync(new URL("world/engine/sol-engine.js", repo), "utf8");
  const points = [...engineSrc.matchAll(/power_w: (\d+), isp_s: (\d+), eff: ([0-9.]+)/g)];
  assert.equal(points.length, 2);
  for (const [, power, isp, eff] of points) {
    assert.ok(html.includes(power + " W"), power);
    assert.ok(html.includes(isp + " s"), isp);
    assert.ok(html.includes(eff), eff);
  }
  for (const cls of Object.values(E.SHIP_CLASSES)) {
    const line = row("data-class", cls.id);
    assert.match(line, new RegExp(">" + cls.name + "<"));
    assert.match(line, new RegExp(">" + cls.dry_kg + "<"));
    assert.match(line, new RegExp(">" + cls.seats + "<"));
    if (cls.fictional) {
      assert.match(line, new RegExp(">" + cls.propellant_kg + "<"));
      assert.match(line, new RegExp(">" + cls.ve_kms + "<"));
      assert.match(line, new RegExp(">" + cls.thrust_n / 1000 + "<"));
      assert.ok(line.includes(R.FLIES_TEXT[R.FLIES[cls.id]]), line);
    } else {
      assert.match(line, new RegExp(">" + cls.xenon_kg + "<"));
      assert.match(line, new RegExp(">" + cls.power_w_1au + "<"));
      assert.match(line, new RegExp(">" + cls.housekeeping_w + "<"));
    }
    const parked = R.FLEET.filter((s) => s.ship_class === cls.id).map((s) => s.name);
    if (parked.length === 0) assert.match(line, /not parked/);
    else assert.ok(parked.every((name) => line.includes(name)), line);
  }
  // The parked fleet is all Starseekers; the real hulls stay in the catalog as references.
  assert.ok(R.FLEET.every((s) => E.SHIP_CLASSES[s.ship_class].fictional));
  assert.match(row("data-class", "star-liner"), /total burn at most 45 km\/s/);
  assert.match(html, /declared fictional drive/);
  assert.match(engineSrc, /over 10000 W at 1 AU/);
  assert.match(engineSrc, /near 400 W/);
  assert.match(engineSrc, /up to 1085 kg/);
  assert.match(engineSrc, /633 W at the end of the mission/);
  assert.match(engineSrc, /about 68000 kg/);
  assert.match(engineSrc, /orbiter crew of 7/);
  assert.match(html, /NASA JPL Psyche quick facts/);
  assert.match(html, /NASA Cassini quick facts/);
  assert.match(html, /published lower bound/);
  assert.match(html, /simulated cabin/);
  assert.match(html, /not a flown ship/);
});

test("the page quotes the ephemeris and does not treat 1361 as an engine constant", () => {
  const ephem = readFileSync(new URL("world/engine/ephem.js", repo), "utf8");
  const source = ephem.match(/"source":"([^"]+)"/)[1];
  assert.match(source, /JPL DE421/);
  assert.ok(html.includes(source.split(";")[0]));
  assert.match(html, /The Moon position is DE421/);
  assert.match(html, /circular orbits and approximate/);
  const engineSrc = readFileSync(new URL("world/engine/sol-engine.js", repo), "utf8");
  const ridesSrc = readFileSync(new URL("world/engine/sol-rides.js", repo), "utf8");
  assert.equal(engineSrc.includes("1361"), false);
  assert.equal(ridesSrc.includes("1361"), false);
  assert.match(engineSrc, /1\/r\^2/);
  const solarDoc = readFileSync(new URL("docs/SOLAR-VARIABLES.md", repo), "utf8");
  assert.match(solarDoc, /irradiance/);
  assert.match(solarDoc, /do not change any ride/);
  assert.match(html, /The engine does not use a solar constant of 1361 W\/m2\./);
  assert.match(html, /docs\/SOLAR-VARIABLES\.md lists irradiance/);
  assert.match(html, /divided by the square of the heliocentric distance/);
  assert.match(html, /The RTG class generator does not fall off/);
  const ephemPy = readFileSync(new URL("code/ephem.py", repo), "utf8");
  assert.match(ephemPy, /DE440/);
  assert.match(html, /DE440 values \(Park et al\. 2021\)/);
  const simulated = E.PLACES.filter((p) => p.real === false).map((p) => p.name);
  assert.ok(simulated.length > 0, "the engine lists no simulated places, so the page check below would pass empty");
  for (const name of simulated) assert.ok(html.includes(name), name);
});

test("the page states the seeded season pool, the season, and the held out seeds", () => {
  assert.equal(POOL_TIERS.placeholder, true);
  assert.match(html, new RegExp("A season is " + SKY.len_days + " sky days"));
  assert.match(html, /One real second is one sky day/);
  assert.match(html, /The tier sizes are placeholders/);
  assert.match(html, /simulated passengers/);
  for (const tier of POOL_TIERS.rows) {
    const line = row("data-tier", String(tier.min_players));
    assert.match(line, new RegExp(">" + tier.hails + "<"));
  }
  assert.match(html, /frozen from the previous season's distinct signed-in players/);
  const hub = readFileSync(new URL("src/hub-pool.js", root), "utf8");
  assert.match(hub, /if \(cur != null\) return cur/);
  assert.match(hub, /distinctPlayers\(sql, n - 1\)/);
  const suite = readFileSync(new URL("src/suite.js", root), "utf8");
  assert.match(suite, /The file holds no seeds/);
  assert.match(suite, /SHA-256/);
  assert.match(suite, /HMAC/);
  assert.match(html, /The suite file stores no seeds/);
  assert.match(html, /128 bits from SHA-256 of a public string/);
  assert.match(html, /128 bits from HMAC-SHA-256 under the server key STARFARE_BENCH_KEY/);
  assert.match(html, /That key is not in the repository/);
  assert.match(html, /A split named train is refused/);
  assert.match(html, /scores stay sealed until every task in the session is played/);
  assert.equal(html.includes("k1:" + "a".repeat(32)), false);
});

test("the page states the ride record and the episode export", () => {
  const sim = readFileSync(new URL("sim.mjs", root), "utf8");
  const index = readFileSync(new URL("src/index.js", root), "utf8");
  const store = readFileSync(new URL("src/store.js", root), "utf8");
  const run = readFileSync(new URL("bench/run.mjs", root), "utf8");
  const bench = readFileSync(new URL("src/bench-host.js", root), "utf8");
  const exportMax = store.match(/const EXPORT_MAX = (\d+)/)[1];
  const simDoc = readFileSync(new URL("SIM.md", root), "utf8");
  assert.match(sim, /landedRows/);
  assert.match(simDoc, /are not folded in as 0/);
  assert.match(html, /are not folded in as 0/);
  assert.equal(html.includes("counts as 0 in this mean only"), false);
  assert.match(index, /for 24 hours/);
  assert.match(html, /lasts 24 hours/);
  assert.match(store, /newest EXPORT_MAX arrived rides/);
  assert.match(html, new RegExp("the newest " + exportMax + " arrived flights"));
  assert.match(run, /one ride record per attempt/);
  assert.match(html, /one of those records per attempt, including a flight that did not arrive/);
  assert.match(bench, /Bench mode: no ride history/);
  assert.match(html, /A bench session does not add those attempts to the player download/);
  assert.ok(html.includes(RIDE_FORMAT));
  assert.ok(html.includes(EPISODE_SCHEMA));
  assert.match(html, /\/flight\/&lt;run_id&gt;\/episode\.jsonl/);
  assert.match(html, /one full episode per arrived flight/);
  assert.match(html, /Hidden test seeds stay out of training data/);
  const episodeSrc = readFileSync(new URL("src/episode.js", root), "utf8");
  assert.match(episodeSrc, /if \(!world\) return null/);
  const rides = readFileSync(new URL("world/engine/sol-rides.js", repo), "utf8");
  const free = rides.match(/\(ctx\.plan_calls \|\| 0\) - (\d+)/);
  assert.ok(free, "sol-rides.js no longer states the free plan count the page quotes");
  assert.ok(html.includes(free[1] + " free plans"));
});

test("the page does not use forbidden words or dash characters", () => {
  assert.equal(/[—–]/.test(html), false);
  assert.equal(/\b(car|cars|robotaxi|roadster|tesla|spacex|rider|riders)\b/i.test(html), false);
  assert.match(html, /passengers/);
  assert.match(html, /<h1>How a flight is measured<\/h1>/);
});

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.once("error", rej);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); });
});

async function stopWorker(child, persist) {
  await stopWorkerProcess(child);
  try { await rm(persist, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch (error) { console.warn("Local Worker storage cleanup failed:", error.message); }
}

test("GET /method returns the page and stays public when OAuth is on", async () => {
  const port = await freePort();
  const persist = mkdtempSync(join(tmpdir(), "method-page-"));
  const bin = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
  const args = [bin, "dev", "--port", String(port), "--ip", "127.0.0.1", "--persist-to", persist, "--var", "STARFARE_OAUTH:on"];
  const child = spawn(process.execPath, args, { cwd: fileURLToPath(new URL("..", import.meta.url)), detached: true, windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" } });
  const log = [];
  child.stdout.on("data", (c) => log.push(String(c)));
  child.stderr.on("data", (c) => log.push(String(c)));
  let exited = false, startError = null;
  child.on("exit", () => { exited = true; });
  child.on("error", (error) => { startError = error; });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 180000;
  try {
    for (;;) {
      if (startError) throw startError;
      if (exited) throw new Error("wrangler dev exited early:\n" + log.join("").slice(-2000));
      if (Date.now() > deadline) throw new Error("wrangler dev not ready:\n" + log.join("").slice(-2000));
      try { await fetch(base + "/"); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
    }
    const open = await fetch(base + "/method");
    assert.equal(open.status, 200);
    assert.match(open.headers.get("content-type"), /^text\/html/);
    assert.equal(await open.text(), html);
    const posted = await fetch(base + "/method", { method: "POST" });
    assert.equal(posted.status, 405);
  } finally {
    await stopWorker(child, persist);
  }
});
