// The sandbox world (game-design/SANDBOX-BUILD-PLAN-2026-10-20.md, step 2), as pure functions over a plain world object.
// One private copy of the solar system per player: its own hazard seed, a sky clock that only moves in ticks, the 11 ships
// where they last landed (the engine's ships map, step 1), the desks that hold them, and the market (a seeded hail pool).
// The clock ticks when every joined seat has called wait, or once a seat has kept the others waiting for cap_ms of real
// time. Jobs, seats' codes, the tools and the inbox come in later steps; StarfareWorld (world.js) only stores what these
// functions return. No Worker imports, so the tests load it in plain Node.
import { POOL_TIERS, SEASON_END, SKY, hailView, isoJD, names } from "./game.js";

export const WORLD_FORMAT = "starfare.world/1";
export const WORLD_ID = /^w_[0-9a-f]{20}$/;
// Slice 1: one executor and two dispatchers. Desks split by region (sketch, open question 7): the Jupiter and Saturn
// ships make the outer desk, every other ship the inner one. The executor can move ships between desks in a later step.
export const SEATS = ["EX", "D1", "D2"];
const DESKS = { D1: "Inner desk", D2: "Outer desk" };
const OUTER = new Set(["jupiter", "saturn"]);
export const TICK_DAYS = 1; // sky days per tick
export const TICK_CAP_MS = 60 * 1000; // a tick runs after this long even if a joined seat has not called wait
export const MARKET_SIZE = POOL_TIERS.rows[0].hails; // today's season pool size
const EVENTS_KEPT = 50;

export class WorldError extends Error {}
const fail = (msg) => { throw new WorldError(msg); };

/** A new world at the start of the sky's span: every ship at its home berth and free, no seat joined, the clock stopped.
 *  seed is the world's hazard seed (world.js keys it); it never leaves the server. */
export function newWorld(E, { worldId, seed, owner = null, nowMs, capMs = TICK_CAP_MS }) {
  if (!WORLD_ID.test(worldId)) fail("world_id must look like w_ and 20 hex digits");
  const start = SKY.jd0, desks = {};
  for (const d of Object.keys(DESKS)) desks[d] = { name: DESKS[d], ships: [] };
  for (const c of E.R.FLEET) desks[OUTER.has(E.R.system(c.at)) ? "D2" : "D1"].ships.push(c.id);
  return {
    format: WORLD_FORMAT, world_id: worldId, owner, seed: String(seed), created_ms: nowMs, active_ms: nowMs,
    clock: { jd: start, start_jd: start, end_jd: SEASON_END, tick: 0, tick_days: TICK_DAYS, cap_ms: capMs, window_ms: null, done: false },
    ships: Object.fromEntries(E.R.FLEET.map((c) => [c.id, { at: c.at, free_jd: start }])),
    desks,
    seats: Object.fromEntries(SEATS.map((s) => [s, { joined_ms: null, waiting: false, stalls: 0 }])),
    market: { size: MARKET_SIZE, closed: {} },
    events: [],
  };
}

/** The market's hail ids carry the world's tag, so two worlds' bookings never share an id in the engine's registry. */
const tagOf = (w) => w.world_id.slice(2, 14);
export const MARKET_HAIL = /^w([0-9a-f]{12})-(\d+)$/;
/** Market hail i: the season pool's row drawn with the world's tag in place of a season number. */
export function marketRow(E, w, i) {
  const row = E.R.hailRow(tagOf(w), i);
  return { ...row, id: "w" + tagOf(w) + "-" + i };
}
/** The open market: every pool row not yet taken or declined, as list_hails shows a hail. */
export function marketHails(E, w) {
  const out = [];
  for (let i = 0; i < w.market.size; i++) {
    const row = marketRow(E, w, i);
    if (!Object.hasOwn(w.market.closed, row.id)) out.push(hailView(E, row));
  }
  return out;
}

const seatOf = (w, seat) => {
  if (!Object.hasOwn(w.seats, seat)) fail("unknown seat " + seat + "; this world's seats are " + SEATS.join(", "));
  return w.seats[seat];
};
const joined = (w) => SEATS.filter((s) => w.seats[s].joined_ms != null);

/** A seat takes part in ticks from now on. The first seat to join opens the tick window, so the cap starts counting. */
export function joinSeat(w, seat, nowMs) {
  const s = seatOf(w, seat);
  if (s.joined_ms == null) s.joined_ms = nowMs;
  if (w.clock.window_ms == null) w.clock.window_ms = nowMs;
  w.active_ms = nowMs;
  return w;
}

/** A joined seat is done for this tick. When it is the last joined seat to wait, the tick runs. Returns the tick's event or null. */
export function waitSeat(w, seat, nowMs) {
  const s = seatOf(w, seat);
  if (s.joined_ms == null) fail("seat " + seat + " has not joined this world");
  if (w.clock.done) fail("this world's clock has reached the end of its span");
  s.waiting = true;
  w.active_ms = nowMs;
  return joined(w).every((x) => w.seats[x].waiting) ? advance(w, nowMs, "every seat waited") : null;
}

/** When the open tick runs anyway (cap_ms after it opened), or null while no seat has joined or the clock has ended. */
export const capDueMs = (w) => (w.clock.done || w.clock.window_ms == null ? null : w.clock.window_ms + w.clock.cap_ms);

/** Runs the open tick if its cap has passed: the seats that had not waited are counted as stalled. Returns the event or null. */
export function capTick(w, nowMs) {
  const due = capDueMs(w);
  return due != null && nowMs >= due ? advance(w, nowMs, "cap") : null;
}

function advance(w, nowMs, why) {
  const c = w.clock, stalled = joined(w).filter((s) => !w.seats[s].waiting);
  for (const s of stalled) w.seats[s].stalls++;
  for (const s of SEATS) w.seats[s].waiting = false;
  c.jd = Math.min(c.end_jd, c.jd + c.tick_days);
  c.tick++;
  c.window_ms = nowMs;
  if (c.jd >= c.end_jd) c.done = true;
  const event = { tick: c.tick, sky: isoJD(c.jd), at_ms: nowMs, why, stalled };
  w.events.push(event);
  if (w.events.length > EVENTS_KEPT) w.events.splice(0, w.events.length - EVENTS_KEPT);
  return event;
}

/** What the world's page and its owner see. Never the seed: the world's weather and traffic stay hidden. */
export function worldView(E, w, nowMs) {
  const { placeName } = names(E), c = w.clock, due = capDueMs(w);
  const ship = (id) => {
    const car = E.R.CAR[id], st = w.ships[id];
    return { car: id, name: car.name, ship_class: E.SHIP_CLASSES[car.ship_class].name, seats: car.seats, at: { id: st.at, name: placeName(st.at) },
      free: st.free_jd <= c.jd ? "free" : isoJD(st.free_jd) };
  };
  return {
    simulated: true, format: w.format, world_id: w.world_id, created_ms: w.created_ms,
    clock: { sky_now: isoJD(c.jd), tick: c.tick, tick_days: c.tick_days, span_ends: isoJD(c.end_jd), done: c.done, cap_s: c.cap_ms / 1000,
      ...(due != null ? { cap_tick_in_s: Math.max(0, Math.ceil((due - nowMs) / 1000)) } : {}) },
    seats: SEATS.map((s) => ({ seat: s, role: s === "EX" ? "executor" : "dispatcher", ...(s === "EX" ? {} : { desk: w.desks[s].name }),
      joined: w.seats[s].joined_ms != null, waiting: w.seats[s].waiting, stalls: w.seats[s].stalls })),
    desks: Object.keys(w.desks).map((d) => ({ desk: d, name: w.desks[d].name, ships: w.desks[d].ships.map(ship) })),
    market: { size: w.market.size, open: w.market.size - Object.keys(w.market.closed).length },
    events: w.events.slice(-10),
    note: "A simulated private world: its own clock, weather and traffic. The clock moves one tick (" + c.tick_days + " sky day) when every joined seat has called wait, " +
      "or " + c.cap_ms / 1000 + " real seconds after the tick opened.",
  };
}
