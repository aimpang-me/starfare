// HQ's answers on the Comms panel (src/comms.cjs): topics, place filters, the refusal to plan, and the check-in rows.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { checkInInfo } from "../src/game.js";

const Comms = createRequire(import.meta.url)("../src/comms.cjs");
const ctx = {
  routes: () => [
    { from: "ISS", to: "Lunar Data Center", kind: "quick", party: 3, open: true },
    { from: "Orbital Depot", to: "Mars Base", kind: "long haul", party: 2, open: true },
    { from: "Ceres Port", to: "Titan Dock", kind: "long haul", party: 1, open: false },
  ],
  clock: () => ({ season: 4, sky_now: "2027-03-01 12:00", seconds_left: 5000, quick_open: true, long_open: true, long_seconds_left: 4900 }),
  alerts: () => [{ t: "Dust storm at Mars Base (simulated)", d: "Until 2027-03-04 00:00" }],
  fleet: () => [{ call: "SF-05", name: "", where: "at Orbital Depot", busy: null }, { call: "SF-07", name: "", where: "at ISS", busy: "2027-03-02 00:00" }],
  flights: () => [{ call: "SF-02", title: "Crew change", where: "between Earth and the Moon", eta: "4.0 h", run_id: "run_00000000000000000001" }],
  board: () => [{ title: "Crew change", points: 31234.5 }],
  agent: () => null,
  places: ["ISS", "Lunar Data Center", "Orbital Depot", "Mars Base", "Mars", "Ceres Port", "Titan Dock", "Earth"],
};

test("open routes lists only bookings an agent can take now, with the long-haul clock", () => {
  const a = Comms.ask("What routes are available right now?", ctx);
  assert.equal(a.topic, "routes");
  assert.match(a.text, /^2 open bookings an agent can take now\. Long hauls can still be taken for 1 h 21 m of real time\.$/);
  assert.deepEqual(a.rows, [["ISS → Lunar Data Center", "quick · 3 passengers"], ["Orbital Depot → Mars Base", "long haul · 2 passengers"]]);
});

test("a place in the question filters the routes, longest name first", () => {
  const to = Comms.ask("any bookings to Mars Base?", ctx);
  assert.deepEqual(to.rows, [["Orbital Depot → Mars Base", "long haul · 2 passengers"]]);
  assert.equal(Comms.placesIn("trips from Mars Base", ctx.places).from, "Mars Base");
  assert.equal(Comms.ask("quick routes", ctx).rows.length, 1);
});

test("HQ never plans or picks for the agent", () => {
  for (const q of ["Which ship should take the Mars one?", "what's the best route to score", "plan the ride for me", "which booking is worth it"]) {
    const a = Comms.ask(q, ctx);
    assert.equal(a.refused, true, q);
    assert.doesNotMatch(a.text, /\d/, q);
  }
});

test("weather, clock, fleet, flights, board and help answer from the context", () => {
  assert.match(Comms.ask("any solar flares or storms?", ctx).text, /^1 alert right now\.$/);
  assert.match(Comms.ask("when does the season reset?", ctx).text, /^Season 4\. Sky time 2027-03-01 12:00 UTC; the season resets in 1 h 23 m/);
  assert.match(Comms.ask("where is sf-7?", ctx).text, /^SF-07 is at ISS, busy until 2027-03-02 00:00 sky time\.$/);
  const live = Comms.ask("where is SF-02", ctx);
  assert.equal(live.actions[0].act, "follow");
  assert.match(Comms.ask("flights in the air", ctx).text, /^1 flight is in the air\.$/);
  assert.deepEqual(Comms.ask("show the scoreboard", ctx).rows, [["Crew change", "31,235 points"]]);
  assert.equal(Comms.ask("hello", ctx).topic, "help");
  assert.equal(Comms.ask("what is my agent doing", ctx).topic, "agent");
});

test("check-in rows say what the agent gave and nothing it didn't", () => {
  const info = checkInInfo({ agent_name: " Space Test ", model: "grok-4", skills: ["planning", "", "weather\u0007"], thinking: 7 }, { name: "grok", version: "1.0" });
  assert.deepEqual(info, { name: "Space Test", model: "grok-4", thinking: null, skills: ["planning", "weather"], client: { name: "grok", version: "1.0" } });
  assert.deepEqual(Comms.checkIn({ ...info, signed_in: true }), [
    ["Name", "Space Test · client \"grok\" 1.0"], ["Model", "grok-4"], ["Thinking", "not given"], ["Skills", "planning, weather"], ["Player", "signed in"],
  ]);
});
