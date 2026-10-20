import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { evalSlice } from "./page-slice.mjs";

// Lore (world/lore/sol-lore.js, docs/LORE.md) on the booking desk and the flight page: Fictional flavour beside the
// simulated booking or recorded event, never part of the plan, the score or the tool views.
const require = createRequire(import.meta.url);
const LORE = require("../../world/lore/sol-lore.js");
const site = readFileSync(new URL("../src/site.html", import.meta.url), "utf8");
const flight = readFileSync(new URL("../src/flight.html", import.meta.url), "utf8");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

test("build.mjs serves the lore library byte for byte at /assets/sol-lore.js, and both pages load it", () => {
  const src = readFileSync(new URL("../../world/lore/sol-lore.js", import.meta.url));
  assert.deepEqual(readFileSync(new URL("../public/assets/sol-lore.js", import.meta.url)), src);
  for (const html of [site, flight]) assert.match(html, /<script src="\/assets\/sol-lore\.js"><\/script>/);
});

test("the booking desk shows a desk row's story with its Fictional tag, and the place note with the engine's Real tag", () => {
  const api = evalSlice(site, "function loreOf(d) {", "function hailOf(id) {", "({ loreOf, loreBox })", { window: { SOL_LORE: LORE }, SOL_LORE: LORE, esc });
  const row = { id: "iss-crew", rider: "Dana, a station engineer (simulated)", party: 1, from: "iss", to: "lunar-data-center", kind: "quick" };
  const o = api.loreOf(row);
  assert.deepEqual(o, LORE.booking(row));
  const html = api.loreBox(o);
  assert.ok(html.includes(esc(o.story)) && html.includes('<span class="tag fict">Fictional</span>'), html);
  const io = api.loreOf({ id: "s1-0", rider: "Ren, a medic (simulated)", party: 2, from: "mars-base", to: "io", kind: "long haul" });
  assert.match(api.loreBox(io), /<span class="tag real">Real<\/span><\/p><\/div>$/, "Io's note is about a real moon");
  assert.equal(evalSlice(site, "function loreOf(d) {", "function hailOf(id) {", "loreOf({ id: 'x' })", { window: {}, esc }), null, "no library, no lore");
});

test("the flight page puts a moment beside recorded events only, and still draws the event without the library", () => {
  const ctx = { window: { SOL_LORE: LORE }, SOL_LORE: LORE, esc, W: esc };
  const api = evalSlice(flight, "function evText(e) {", "function initGL() {", "({ evText, addLore })", ctx);
  const legs = [{ kind: "pickup", from: "orbital-depot", to: "iss", dep: 1, arr: 1.03 }, { kind: "ride", from: "iss", to: "lunar-data-center", dep: 1.08, arr: 6.3 }];
  const dana = { id: "iss-crew", lead: "Dana", party: 1 };
  const pl = { stops: [{ at: "orbital-depot", board: [], alight: [] }, { at: "iss", board: [dana], alight: [] }, { at: "lunar-data-center", board: [], alight: [dana] }] };
  const rp = { legs, events: [
    { jd: 1, kind: "depart", leg: 0, text: "Orbital Depot to ISS" }, { jd: 1, kind: "note", text: "Lore check" },
    { jd: 1.03, kind: "arrive", leg: 0, text: "Local hop" }, { jd: 1.08, kind: "depart", leg: 1, text: "ISS to Lunar Data Center" },
    { jd: 5.9, kind: "incident", cause: "pad_busy", where: "Lunar Data Center", text: "All 2 berths were taken" }, { jd: 6.3, kind: "arrive", leg: 1, text: "Local hop" }] };
  api.addLore(rp, pl, { run_id: "run_00000000000000000000", score: { promise_slip_hours: 10.4 } });
  assert.deepEqual(rp.events.map((e) => e.lore ? e.lore.moment : null), [null, null, "boarding", "departure", "hold", "arrival_late"]);
  assert.ok(api.evText(rp.events[4]).endsWith('<span class="tag fict">Fictional</span></span>'));
  const bare = { kind: "arrive", text: "Local hop" };
  assert.equal(api.evText(bare), "Local hop");
  const none = evalSlice(flight, "function evText(e) {", "function initGL() {", "(function () { var r = { legs: [], events: [bare] }; addLore(r, { stops: [] }, {}); return r.events[0].lore; })()", { window: {}, esc, W: esc, bare });
  assert.equal(none, undefined, "without the library the page draws the event as before");
});
