import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { SKY } from "../src/game.js";

function fixture() {
  const calls = [], t = SKY.jd0 + 10;
  const row = { id: "titan-home", kind: "long", from: "titan", to: "earth" };
  const E = { PLACES: [], R: {
    BY: { "titan-home": row }, LEAD: 150,
    terms: () => ({ arrive_by_jd: t + 2000, par: { car: "sf-07", kwh: 20, arr_jd: t + 1000,
      legs: [{ from: "titan-dock", to: "titan", dep_jd: t, arr_jd: t + 1, kwh: 20, fare: 100 }] } }),
    fleetState: () => [{ car: "sf-07", busy_until_jd: null }],
    nearCars: () => [{ id: "sf-07", name: "SF-07", at: "titan-dock" }],
    planLeg(...args) {
      calls.push(args);
      assert.equal(args[5], "sf-07", "the browser must plan with the selected ship, rather than the default hull");
      return { dep_jd: args[2], arr_jd: args[2] + 1, local: true,
        battery: { energy_kwh: 20 }, fare: { total_usd: 100 }, arc_au: [[0, 0, 0], [1, 0, 0]] };
    },
  } };
  const SITE = { sky: SKY, look: {}, hails: [{ hail_id: row.id, title: "Titan home", kind: "long haul" }] };
  return { E, SITE, calls, t };
}

test("the landing-page plan and pickup previews use the par ship and each candidate's own hull", async () => {
  const { E, SITE, calls } = fixture();
  const html = readFileSync(new URL("../src/site.html", import.meta.url), "utf8");
  const start = html.indexOf("(function (root) {");
  const end = html.indexOf("</script>", start);
  const window = { SITE, SOLE: E };
  runInNewContext(html.slice(start, end), { window });
  const api = await window.SF.loadEngine();
  const plan = api.plan("titan-home", SKY.t0_ms + 1000);
  assert.equal(plan.cars[0].pickup.kwh, 20);
  assert.equal(calls.length, 2);
});

test("a legacy flight without stored arcs recomputes its path with the recorded ship", () => {
  const { E, SITE, calls, t } = fixture();
  const html = readFileSync(new URL("../src/flight.html", import.meta.url), "utf8");
  const start = html.indexOf("var SF = (function () {");
  const end = html.indexOf("})();", start) + 5;
  const api = runInNewContext(html.slice(start, end) + "\nSF;", { window: { SITE } });
  api.init(E);
  const iso = (jd) => new Date((jd - 2440587.5) * 864e5).toISOString().slice(0, 16).replace("T", " ");
  const live = { car: "SF-07", hold: null, track: [[0, t], [1000, t + 1]], planned: [], incidents: [], checkpoints: [],
    flown: [{ leg: "ride", from: "titan", to: "earth", depart: iso(t), arrive: iso(t + 1), kwh: 20, gate: "PASS" }] };
  const replay = api.replay({ record: { log: null }, legs: [{ car: "sf-07" }], arcs: {}, trail: [] }, live);
  assert.equal(calls.length, 1);
  assert.ok(replay.legs[0].arc, "the selected ship must produce the fallback arc");
});
