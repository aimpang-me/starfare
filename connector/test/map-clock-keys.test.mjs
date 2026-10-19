import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evalSlice } from "./page-slice.mjs";

const html = readFileSync(new URL("../src/site.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../../design/assets/mission-control.css", import.meta.url), "utf8");

// The map clock block, run against a fake wall clock.
function mapClock() {
  const clock = { t: Date.UTC(2026, 9, 19) };
  const el = () => ({ textContent: "", setAttribute() {} });
  const ctx = {
    reduced: false, window: {}, performance: { now: () => 0 }, Date: { now: () => clock.t },
    iso: (ms) => new Date(ms).toISOString(), $: el, glStart() {}, slowTick() {},
  };
  const api = evalSlice(html, "var MAP_PAUSED = reduced", "function V(x, y, z)",
    "({ wall: mapWallNow, rate: setMapRate, pause: toggleMapPause, words: mapTimeWords, live: mapLive })", ctx);
  return { clock, api };
}

test("the map starts on the live sky: Live is the selected speed and the map clock keeps the sky's pace", () => {
  const select = html.match(/<select[^>]*id="mapRate"[^>]*>([\s\S]*?)<\/select>/)[1];
  assert.match(select, /<option value="1" selected>Live/);
  assert.equal((select.match(/ selected/g) || []).length, 1);
  const { clock, api } = mapClock();
  clock.t += 5 * 60e3;
  assert.equal(api.wall(), clock.t, "after 5 real minutes the map must still be on the sky clock");
  assert.equal(api.words(0), "Live sky");
  assert.equal(api.live(), true);
});

test("a slowed or paused map says map time, never live sky", () => {
  const { clock, api } = mapClock();
  api.rate(0.1);
  clock.t += 60e3;
  assert.ok(clock.t - api.wall() > 50e3, "Calm falls behind the sky clock");
  assert.match(api.words(api.wall()), /^Map time &middot; slowed &middot; /);
  assert.equal(api.live(), false);
  api.rate(1);
  assert.equal(api.wall(), clock.t, "going back to Live rejoins the sky clock");
  api.pause();
  assert.match(api.words(api.wall()), /^Map paused &middot; /);
});

test("the map readout takes its time words from mapTimeWords, not a fixed Live sky", () => {
  const hud = html.slice(html.indexOf("function mapHud()"), html.indexOf("$(\"#liveBtn\").hidden = !rep;"));
  assert.match(hud, /mapTimeWords\(MAPJD\)/);
  assert.doesNotMatch(hud, /"Live sky"/);
});

test("on phones the readout drops its scale and speed lines and keeps the simulated label on its first line", () => {
  const phone = css.slice(css.indexOf("@media(max-width:760px)"));
  assert.match(css, /\.mc-home \.hud \.hud-m\{display:none\}/);
  assert.match(phone, /\.mc-home \.hud \.hud-m\{display:inline\}/);
  assert.match(phone, /\.mc-home \.hud \.hud-scale,\.mc-home \.hud \.hud-speed\{display:none\}/);
  assert.match(html, /hud-m"> &middot; true scale &middot; simulated/);
});

// bindKeys with a fake document: records what each keydown did.
function keys() {
  const handlers = {}, box = { on: {}, addEventListener(t, f) { this.on[t] = f; }, contains: (el) => el === ctx.focusInMap };
  const ctx = {
    KEYS: {}, MOVE: { w: 1, a: 1, s: 1, d: 1, " ": 1, control: 1 }, PIL: { mul: 1 }, focusInMap: {},
    document: { addEventListener(t, f) { handlers[t] = f; }, activeElement: null },
    addEventListener() {}, glStart() {}, mapHud() {}, toggleClean() {}, clamp: (v) => v,
    $: (s) => s === "#mapbox" ? box : { hidden: true },
  };
  evalSlice(html, "function bindKeys() {", "function markFocus(", "bindKeys()", ctx);
  const press = (key, mods = {}) => {
    let prevented = false;
    handlers.keydown({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: { tagName: "DIV" }, ...mods, preventDefault() { prevented = true; } });
    return prevented;
  };
  const up = (key) => handlers.keyup({ key, shiftKey: false });
  return { ctx, box, press, up };
}

test("Ctrl+A, Ctrl+S and Ctrl+D keep their browser meaning while the map has neither pointer nor focus", () => {
  const { ctx, press } = keys();
  for (const k of ["a", "s", "d", "w", " "]) assert.equal(press(k, { ctrlKey: true }), false, `Ctrl+${k} away from the map`);
  assert.equal(press("Control", { ctrlKey: true }), false);
  assert.deepEqual(Object.keys(ctx.KEYS).filter((k) => ctx.MOVE[k]), [], "no flight key is held");
  assert.equal(press("c", { ctrlKey: true }), false, "Ctrl+C is never taken");
});

test("Ctrl flies down over the map, with the map focused, or while already flying", () => {
  const over = keys();
  over.box.on.pointerenter();
  assert.equal(over.press("Control", { ctrlKey: true }), true);
  assert.equal(over.press("a", { ctrlKey: true }), true, "Ctrl+A over the map flies");
  over.box.on.pointerleave();
  over.up("a"); over.up("Control");
  assert.equal(over.press("a", { ctrlKey: true }), false, "after the pointer leaves, Ctrl+A is the browser's again");

  const focused = keys();
  focused.ctx.document.activeElement = focused.ctx.focusInMap;
  assert.equal(focused.press("s", { ctrlKey: true }), true);

  const flying = keys();
  assert.equal(flying.press("w"), true, "plain W flies anywhere off form fields, as before");
  assert.equal(flying.press("Control", { ctrlKey: true }), true, "Ctrl while W is held adds the descent");
  assert.equal(flying.ctx.KEYS.control, 1);
});
