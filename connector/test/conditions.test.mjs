import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { engine } from "../src/engine.js";
import { keyedSeed, seasonKey, seasonRelease, seasonSeed } from "../src/season-seed.js";

const require = createRequire(import.meta.url);
const C = require("../src/conditions.cjs");
const E = await engine(), H = E.R.hazards("k1:0123456789abcdef0123456789abcdef");
const KEY = "season-key".padEnd(40, "x");

test("a reported view answers like the engine for every past moment it covers, and never says when a running storm ends", () => {
  // Busy enough that the report holds eruptions, storms, weather and full pads.
  const now = 2462172.6, rep = C.reportOf(H, now, now), V = C.reportedHazards(rep);
  assert.ok(rep.eruptions.length > 0 && rep.pads_full.length > 0, JSON.stringify({ e: rep.eruptions.length, p: rep.pads_full.length }));
  const same = (a, b, what) => {
    if (!b) return assert.equal(a, null, what);
    assert.ok(a, what);
    assert.equal(a.start, b.start, what);
    assert.equal(a.end, b.end > now ? Infinity : b.end, what);
  };
  for (let jd = now - C.RECENT_DAYS; jd <= now; jd += 1 / 96) {
    same(V.flareAt(jd), H.flareAt(jd), "sun " + jd);
    for (const p of C.STORM_PLACES) same(V.flareAt(jd, p), H.flareAt(jd, p), p + " " + jd);
    for (const p of ["mars", "mars-base", "titan", "titan-dock"]) same(V.weatherAt(p, jd), H.weatherAt(p, jd), p + " " + jd);
    const hr = Math.floor(jd * 24);
    for (const p of C.PADS) assert.equal(V.docked(p, hr) >= V.berths(p), H.docked(p, hr) >= H.berths(p), p + " hour " + hr);
  }
  for (let jd = now - C.FRONT_DAYS + 1; jd <= now; jd += 1 / 144) same(V.flareAt(jd), H.flareAt(jd), "front " + jd);
  // Past the report, conditions hold as last reported; nothing later is ever in it.
  assert.deepEqual(V.flareAt(now + 3), V.flareAt(now));
  assert.equal(V.docked("iss", Math.floor(now * 24) + 30), V.docked("iss", Math.floor(now * 24)));
  for (const w of [...rep.eruptions, ...Object.values(rep.storms).flat(), ...Object.values(rep.weather).flat()]) {
    assert.ok(w.start <= now);
    assert.ok(w.end === null || w.end <= now);
  }
  assert.ok(JSON.stringify(rep).length < 20000, "small enough to poll");
});

test("a report asked for later than now is the report for now", () => {
  const now = 2462172.6;
  assert.deepEqual(C.reportOf(H, now + 5, now), C.reportOf(H, now, now));
});

test("season seeds: the number without a key (or with a short one), a k1 HMAC with one, published after the season", async () => {
  assert.equal(await seasonSeed({}, 51), "51");
  assert.equal(seasonKey({ STARFARE_SEASON_KEY: "short" }), null);
  assert.equal(await seasonSeed({ STARFARE_SEASON_KEY: "short" }, 51), "51");
  const env = { STARFARE_SEASON_KEY: KEY }, s51 = await seasonSeed(env, 51);
  assert.match(s51, /^k1:[0-9a-f]{32}$/);
  assert.equal(s51, await keyedSeed(51, KEY));
  assert.notEqual(s51, await seasonSeed(env, 52));
  assert.notEqual(s51, await keyedSeed(51, KEY + "y"));
  assert.deepEqual(await seasonRelease(env, 51, 51), { season: 51, keyed: true, released: false, seed: null, note: "This season's seed is published after it resets." });
  assert.deepEqual(await seasonRelease(env, 50, 51), { season: 50, keyed: true, released: true, seed: await keyedSeed(50, KEY) });
  assert.deepEqual(await seasonRelease({}, 51, 51), { season: 51, keyed: false, released: true, seed: "51" });
  for (const bad of [0, 52, "x", 1.5]) assert.equal(await seasonRelease(env, bad, 51), null);
});

test("the home page's alerts for a keyed season come from the report, and a running storm has no end time", async () => {
  const { readFileSync } = await import("node:fs");
  const { evalSlice } = await import("./page-slice.mjs");
  const html = readFileSync(new URL("../src/site.html", import.meta.url), "utf8");
  const iso = (jd) => new Date(Math.round((jd - 2440587.5) * 864e5 / 60000) * 60000).toISOString().slice(0, 16).replace("T", " ");
  const fetched = [];
  const ctx = {
    SF: { SITE: { hazards: "reported" }, R: E.R, name: (p) => p }, iso, document: { hidden: false }, window: { StarfareConditions: C }, StarfareConditions: C,
    fetch: (u) => { fetched.push(u); return new Promise(() => {}); }, MAPJD: 0, LIVEJD: 0, raf: 0, FX: { cache: {} }, HZ_NOW: {},
  };
  const page = evalSlice(html, "var PADS = [", "// Open bookings:", "({ alertsNow, hz, set: (r) => { REPORT = r; } })", ctx);
  // Find a moment with a solar flare at the Sun still going: its end is past the sky time now.
  let now = 2462172.6;
  while (!(H.flareAt(now) && H.flareAt(now).end > now)) now += 0.05;
  assert.equal(page.alertsNow(now, 7).length, 0, "nothing before a report arrives");
  assert.deepEqual(fetched, ["/sky.json"]);
  page.set({ season: 7, view: C.reportedHazards(C.reportOf(H, now, now)) });
  const alerts = page.alertsNow(now, 7), flare = alerts.find((a) => a.k === "flare");
  assert.equal(flare.d, "No launches with a passenger aboard until it passes (no end time is given)");
  const hr = Math.floor(now * 24);
  assert.deepEqual([...alerts.filter((a) => a.k === "pad").map((a) => a.p)].sort(), C.PADS.filter((p) => H.docked(p, hr) >= H.berths(p)).sort());
  assert.equal(page.hz(8).flareAt(now), null, "another season's report is not used");
});
