import { isoJD, jdOfIso, names, phaseOf, seedOf } from "./game.js";
import { seedFor } from "./suite.js";

export const EPISODE_SCHEMA = "starfare.episode/1";
export const EPISODE_PATH = /^\/flight\/(run_[0-9a-f]{20})\/episode\.jsonl$/;

const NOTE = "Simulated riders, fleet and hazards; planet positions are real (JPL DE421).";
const PART_KEYS = ["pickup", "on_time", "energy", "promise", "checker", "fare", "economy"];
const MEASURES = [
  ["delay_hours", "hours"], ["promise_slip_hours", "hours"], ["fare_usd", "usd"],
  ["planned_kwh", "kwh"], ["extra_kwh", "kwh"], ["divert_kwh", "kwh"], ["used_kwh", "kwh"], ["par_kwh", "kwh"],
  ["rider_dose_msv", "msv"],
];
const K1 = /^k1:[0-9a-f]{32}$/;
const shipKey = ["c", "ar"].join("");
const lateCause = shipKey + "_late";
const removed = ["Road", "ster"].join("");
const banned = new RegExp("\\b" + shipKey + "\\b|" + removed, "i");

const r1 = (x) => Math.round(x * 10) / 10 || 0;
const causeName = (cause) => (cause === lateCause ? "ship_late" : cause);
const weatherKind = (kind) => kind === "dust_storm" || kind === "titan_haze" || kind === "flare" || kind === "solar_flare";

function strip(v) {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v)) {
      if (k === "best" || k === "options_hindsight" || k === "player_id" || k === "player_tag") continue;
      if (k === shipKey) { out.ship = strip(v[k]); continue; }
      if (k === "par_" + shipKey) { out.par_ship = strip(v[k]); continue; }
      out[k] = strip(v[k]);
    }
    return out;
  }
  return v;
}

async function worldClass(run, suite) {
  const seed = String(seedOf(run));
  const keyed = K1.test(seed);
  if (run.tag == null) return keyed ? null : { kind: "live", seed };
  if (!suite || !keyed) return null;
  const dev = await seedFor(suite, "dev", { id: run.tag }, 0);
  if (seed !== dev) return null;
  return { kind: "dev", seed, task_id: run.tag };
}

function forecastView(E, run, entry) {
  const from = jdOfIso(entry.from);
  const place = { id: entry.place, name: names(E).placeName(entry.place) };
  if (from == null) return { tool: entry.tool, place, from: entry.from };
  const seed = seedOf(run);
  if (entry.tool === "check_pad") {
    const f = E.R.padForecast(entry.place, from, entry.hours, run.id, run.t0, seed);
    const span = Math.min(60, Math.ceil(entry.hours / 24) + 1);
    const wx = f.local_weather ? E.R.weatherForecast(entry.place, from, span, seed) : null;
    return {
      tool: "check_pad", place, berths: f.berths, from: entry.from,
      hours: f.hours.map((x) => ({ hour: isoJD(x.hour_jd), booked: x.booked, free: Math.max(0, f.berths - x.booked) })),
      local_weather: wx && wx.kind ? { kind: wx.kind, odds_are: wx.odds_are, days: wx.days.map((d) => ({ from: isoJD(d.day_jd), to: isoJD(d.day_jd + 1), odds: d.odds })) } : null,
    };
  }
  if (entry.tool === "space_weather") {
    const days = E.R.flareForecast(from, entry.days, seed, entry.place);
    return {
      tool: "space_weather", place, from: entry.from,
      days: days.map((d) => ({ from: isoJD(d.day_jd), to: isoJD(d.day_jd + 1), flare_odds: d.flare_odds })),
    };
  }
  return { tool: entry.tool, place, from: entry.from };
}

function forecastAction(entry) {
  return {
    tool: entry.tool,
    arguments: {
      place: entry.place, from: entry.from,
      ...(entry.hours != null ? { hours: entry.hours } : {}),
      ...(entry.days != null ? { days: entry.days } : {}),
    },
  };
}

function planTool(role) {
  if (role === "pickup") return "plan_pickup";
  if (role === "ride") return "plan_ride";
  return "plan_leg";
}

function planRow(L) {
  return {
    kind: "plan",
    observation: {
      leg: L.leg_id, role: L.role, ship: L[shipKey], from: L.from, to: L.to,
      depart: isoJD(L.dep_jd), arrive: isoJD(L.arr_jd), kwh: L.kwh, fare_usd: L.fare, gate: L.gate,
    },
    action: {
      tool: planTool(L.role),
      arguments: {
        ship: L[shipKey], from: L.from, to: L.to, objective: L.objective, wait_days: L.wait_days,
        ...(L.after ? { after: L.after } : {}), ...(L.replan_of ? { replan_of: L.replan_of } : {}),
      },
    },
    events: [], checkpoint: null, options: [], reward: null, outcome: null,
  };
}

function eventOf(x, seed) {
  const kind = causeName(x.kind);
  return { kind, weather: weatherKind(kind), leg: x.leg, place: x.where, at: isoJD(x.at_jd), hours: r1(x.hours), kwh: x.kwh, seed };
}
function causeEvent(cp, seed) {
  const kind = causeName(cp.cause);
  return { kind, weather: weatherKind(kind), leg: cp.leg, place: cp.place, at: isoJD(cp.sky_at), hours: null, kwh: null, seed };
}

function eventQueue(ride, seed) {
  const items = [...(ride.incidents || [])].sort((a, b) => a.at_jd - b.at_jd || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  return {
    until(jd) {
      const out = [];
      while (items.length && items[0].at_jd <= jd + 1e-9) out.push(eventOf(items.shift(), seed));
      return out;
    },
    rest() { return items.splice(0).map((x) => eventOf(x, seed)); },
  };
}

function checkpointView(run, cp) {
  return {
    why: cp.why, place: { id: cp.place, name: cp.place_name }, leg: cp.leg, sky_at: isoJD(cp.sky_at),
    signal_delay_minutes: cp.signal_delay_minutes, reply_arrives: isoJD(cp.reply_jd), ship_state: cp[shipKey],
    rider_aboard: cp.rider_aboard, held_hours: r1(cp.held_hours), behind_plan_hours: r1(cp.behind_plan_hours),
    extra_kwh: cp.extra_kwh, used_kwh: cp.used_kwh, default: cp.default,
    ask_after_hours: run.ride ? run.ride.ask_after_hours : null,
  };
}

function rewardOf(score) {
  return {
    total: score.total, out_of: score.out_of,
    parts: PART_KEYS.map((key) => {
      const p = score.parts.find((x) => x.key === key);
      if (!p) throw new Error("score is missing a part");
      return { key: p.key, label: p.label, got: p.got, max: p.max, note: p.note };
    }),
    measures: MEASURES.map(([key, unit]) => ({ key, value: score[key], unit })),
  };
}

function worldOut(world) {
  return world.kind === "live" ? { kind: "live", season: Number(world.seed), seed: world.seed } : { kind: "dev", task_id: world.task_id, seed: world.seed };
}

function build(E, run, world) {
  const score = run.score, ride = run.ride || { checkpoints: [], incidents: [] }, ev = eventQueue(ride, world.seed);
  const rows = [];
  for (const entry of run.forecasts || []) {
    rows.push({
      kind: "forecast", observation: forecastView(E, run, entry), action: forecastAction(entry),
      events: [], checkpoint: null, options: [], reward: null, outcome: null,
    });
  }
  const legs = Object.values(run.legs || {}).sort((a, b) => (Number(String(a.leg_id).replace(/\D/g, "")) || 0) - (Number(String(b.leg_id).replace(/\D/g, "")) || 0));
  for (const L of legs) rows.push(planRow(L));
  if (run.route) {
    const quote = run.quote || {};
    const ask = ride.ask_after_hours == null ? null : ride.ask_after_hours;
    rows.push({
      kind: "dispatch",
      observation: { route: run.route.slice(), ship: run[shipKey], quote: { fare_usd: quote.fare_usd, arrival: quote.arrival }, ask_after_hours: ask },
      action: { tool: "dispatch", arguments: { legs: run.route.slice(), quote: { fare_usd: quote.fare_usd, arrival: quote.arrival }, ask_after_hours: ask } },
      events: [], checkpoint: null, options: [], reward: null, outcome: null,
    });
  }
  for (const cp of ride.checkpoints || []) {
    const decision = (run.decisions || [])[cp.n - 1] || cp.decision || null;
    rows.push({
      kind: "checkpoint", observation: checkpointView(run, cp),
      action: { tool: "decide", arguments: strip(decision) },
      events: [causeEvent(cp, world.seed), ...ev.until(cp.sky_at)],
      checkpoint: { n: cp.n, kind: cp.kind, cause: causeName(cp.cause), place: cp.place, at: isoJD(cp.sky_at) },
      options: strip(cp.options),
      reward: null, outcome: null,
    });
  }
  rows.push({
    kind: "outcome",
    observation: { flown: (score.log && score.log.flown) || [], ship: score[shipKey], par_ship: score["par_" + shipKey] },
    action: null,
    events: ev.rest(),
    checkpoint: null, options: [],
    reward: rewardOf(score),
    outcome: {
      status: "arrived", phase: "arrived", simulated: true, hail_id: run.id, world: worldOut(world),
      pickup: score.pickup, arrive: score.arrive, note: NOTE,
    },
  });
  return rows.map((row, index) => ({
    schema: EPISODE_SCHEMA, simulated: true, run_id: run.run_id, index, steps: rows.length,
    kind: row.kind, observation: row.observation, action: row.action, events: row.events,
    checkpoint: row.checkpoint, options: row.options, reward: row.reward, outcome: row.outcome,
  }));
}

function leaked(text, run) {
  if (banned.test(text)) return true;
  if (text.includes("player_id") || text.includes("player_tag")) return true;
  if (run.player_id && text.includes(run.player_id)) return true;
  return false;
}

export async function episodeText(E, run, suite) {
  if (!run || phaseOf(run) !== "arrived" || !run.score) return null;
  const world = await worldClass(run, suite);
  if (!world) return null;
  const text = build(E, run, world).map((row) => JSON.stringify(row)).join("\n") + "\n";
  if (leaked(text, run)) throw new Error("episode refused");
  return text;
}
