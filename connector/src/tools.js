// The tool table a player's Grok bot sees: names, descriptions and input schemas, registered against any backend.
// The hosted connector's backend forwards to Durable Objects (mcp.js); a Node harness can supply its own in-process one.
// A backend has one method, call(tool, input), which returns the tool's plain data or { error } for a game error.
import { z } from "zod";

export const RUN_ID = /^run_[0-9a-f]{20}$/;

export const INSTRUCTIONS =
  "Starfare is a concept robotaxi service for Starseeker ships across the solar system. You are the dispatcher. Simulated riders hail a ride; you pick a Starseeker from the simulated fleet, " +
  "plan the pickup and the ride with Starfare's engine (every leg between planets is re-flown in an n-body checker), quote the rider a fare and arrival, and dispatch.\n" +
  "Before planning, call get_my_rides: your past rides (simulated), what you lost points on, and at each checkpoint what the best choice would have used in hindsight.\n" +
  "Call list_hails, then take_hail to get a run_id and the fleet. Some ships are busy on another job until their busy_until time; their pickup can't leave earlier. " +
  "For each ship worth trying, plan_pickup (ship to rider), then plan_ride after that pickup. Compare ships, objectives (energy = least battery, time = fastest) and wait_days, " +
  "then dispatch with the pickup leg, the ride leg, the fare copied from the ride leg, and the arrival you promise the rider.\n" +
  "Hazards (simulated, seeded per season, the same for every player): pads have few berths and other traffic, solar flares hold any launch with a rider aboard, " +
  "Mars dust storms and Titan haze close those pads, a leg between planets that leaves late needs a correction burn, and holding in orbit for a berth costs 250 kWh an hour. " +
  "You only get forecasts: check_pad (booked berths per hour and local weather odds; unscheduled traffic, about a quarter, is never shown) and space_weather (flare odds per day at a place; storms reach far places later and less often). " +
  "Both are free and do not count as plans.\n" +
  "Once dispatched, the ship flies the season's hazards. When a flare grounds a launch or a pad is closed when the ship arrives, the ride stops at a checkpoint and the result is status \"checkpoint\" " +
  "with a situation: what happened, where the ship is, the kWh used so far and the options. Answer with decide: at a launch hold, wait or replan the leg from a later time (a replan counts as a plan); " +
  "at a closed pad, hold in orbit or divert to a nearby pad. Small holds are decided for you: dispatch's ask_after_hours (default 1, or \"never\") sets how long before the ride asks. " +
  "The ride's sky clock is stopped at a checkpoint, and get_hail shows the open one. When the ride arrives the result says what actually happened (incidents, extra kWh, actual arrival), " +
  "what each choice at each checkpoint would have cost in hindsight, and a log you can learn from.\n" +
  "Watching live (the live game, not bench tasks): dispatch and decide also return watch_url, a page where the player watches the Starseeker fly the ride in 3D with your dispatcher log, " +
  "and lands_in_s, the real seconds until it lands there (a playback of simulated sky time; checkpoint_in_s when a checkpoint comes first). Right after dispatching, give the player the watch_url, " +
  "say the Starseeker is flying now, and say it lands in about lands_in_s seconds; after a decide, say when it lands again. The score in the result is final; the page shows it at landing. " +
  "Add a note to dispatch and decide: one or two sentences on why, which the page shows as your own words.\n" +
  "Goal: pick the rider up fast, arrive by arrive_by, use the least battery actually flown, and keep your promise. The quoted arrival is a promise scored against the actual arrival: " +
  "late costs the most (0 at 6 hours late on a quick hail, 1 day on a long haul), early costs a quarter as much. Each plan counts: 6 are free, then each costs a point.\n" +
  "Hard rules: every number you write must be copied from a tool result or the player's words, dates exactly as given. Never estimate a number. Never dispatch a leg whose refly.result is FAIL. " +
  "The one time you choose is the promised arrival: the ride leg's arrive, or a later time you pick as a buffer for a forecast hazard; if you add a buffer, tell the rider it is one and why.\n" +
  "The sky clock runs 1 sky day per real second, so work promptly on long-haul hails. Scores go to the public board at /board on this server, labelled \"planned by Grok bot\".";

const runId = z.string().regex(RUN_ID).describe("run_id from take_hail");
const skyTime = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
const note = z.string().max(300).optional().describe("one or two sentences on why, shown to the player on the flight page as the Grok bot's own words");
const from = skyTime.describe("sky time YYYY-MM-DD HH:MM to start from (default: when the rider is ready, or the open checkpoint's time in flight)").optional();

/** Every tool, in the order tools/list shows them. */
export const TOOLS = {
  list_hails: {
    description: "Simulated passengers waiting this season: hail id, party size, pickup place, destination, quick or long haul. The five catalog hails stay takeable and are not in this list. Also the fleet of Starseekers. Take one with take_hail. " +
      "The pool has hundreds of hails, so this returns 25 at a time: filter with kind, from and to, and page with next_cursor.",
    inputSchema: {
      kind: z.enum(["quick", "long haul"]).optional().describe("only quick or only long-haul hails"),
      from: z.string().min(1).max(64).optional().describe("only hails picking up at this place id or name, e.g. mars-base"),
      to: z.string().min(1).max(64).optional().describe("only hails going to this place id or name"),
      limit: z.number().int().min(1).max(200).optional().describe("hails per page, 1-200 (default 25)"),
      cursor: z.string().max(12).optional().describe("next_cursor from the previous page"),
    },
  },
  take_hail: {
    description: "Take a ride hail. Returns a run_id and the terms: where and when the rider is ready, the destination, the arrive_by time, the fleet and the scoring rules. One run per bot: taking a new hail abandons this session's undispatched run, or flies a ride waiting at a checkpoint on to arrive with the default answers (scored). The result's previous_run says which. When the player signed in, the result also has follow_url, a page where they follow every booking you take and each call you make on it, live: give it to them right away.",
    inputSchema: { hail_id: z.string().describe("hail id from list_hails, e.g. iss-crew") },
  },
  get_hail: {
    description: "The run's hail: rider, pickup place and time, destination, arrive_by, the fleet (each ship free or busy_until a time), plans used, the hazards and the scoring rules.",
    inputSchema: { run_id: runId },
  },
  plan_pickup: {
    description: "Plan a ship's flight from where it is parked to the rider, leaving when the rider is ready or the ship is free, whichever is later (or wait_days after that), and re-fly it in the n-body checker. Returns the pickup leg with its leg_id; a note says if the ship was busy.",
    inputSchema: {
      run_id: runId,
      car: z.string().describe("the ship's call sign from the fleet, e.g. sf-01"),
      objective: z.enum(["energy", "time"]).optional(),
      wait_days: z.number().min(0).max(400).optional(),
    },
  },
  plan_ride: {
    description: "Plan the rider's ride from the pickup to the destination, leaving after the given pickup leg and boarding (or wait_days later), and re-fly it in the n-body checker. Returns the ride leg with its fare_usd and arrive time, plus departures: other legal departure times in the search, with no ranking and no mark on a single one.",
    inputSchema: {
      run_id: runId,
      after_leg: z.string().describe("leg_id of the pickup this ride follows"),
      objective: z.enum(["energy", "time"]).optional(),
      wait_days: z.number().min(0).max(400).optional(),
    },
  },
  plan_leg: {
    description: "Shared flights only (get_hail lists several bookings): plan one leg of the flight to a booking's pickup place or destination, and re-fly it in the n-body checker. " +
      "The first leg names a ship (its car field) and flies from where it is parked; each later leg names after_leg and flies on from where that leg lands, after boarding if anyone boards there (or wait_days later). Returns the leg with its leg_id, fare_usd and arrive time.",
    inputSchema: {
      run_id: runId,
      car: z.string().optional().describe("first leg: the ship's call sign from the fleet, e.g. sf-01"),
      after_leg: z.string().optional().describe("later legs: leg_id of the leg this one follows"),
      to: z.string().min(1).max(64).describe("place id or name: one of the bookings' pickup places or destinations"),
      objective: z.enum(["energy", "time"]).optional(),
      wait_days: z.number().min(0).max(400).optional(),
    },
  },
  check_pad: {
    description: "Forecast for a pad (simulated): its berths, how many are booked each hour, and local weather odds (Mars dust, Titan haze) if any. Scheduled traffic only: about a quarter of ships are unscheduled and never show here. Free; does not count as a plan.",
    inputSchema: {
      run_id: runId,
      place: z.string().min(1).max(64).describe("place id or name, e.g. iss or Mars Base"),
      hours: z.number().int().min(1).max(72).optional().describe("hours to show, 1-72 (default 24)"),
      from,
    },
  },
  space_weather: {
    description: "Solar radiation storm (flare) forecast (simulated): the odds a storm starts at a place, per sky day. Storms travel out from the Sun at 1500 km/s and fewer reach far places. A storm holds any launch with a rider aboard until it passes. Free; does not count as a plan.",
    inputSchema: {
      run_id: runId,
      place: z.string().min(1).max(64).optional().describe("place id or name (default: the open checkpoint's place, else the pickup)"),
      days: z.number().int().min(1).max(60).optional().describe("days to show, 1-60 (default 10)"),
      from,
    },
  },
  dispatch: {
    description: "Dispatch the ship: the pickup leg, the ride leg, the fare you quote (copy the ride leg's fare_usd) and the arrival you promise the rider. The season's hazards are then flown. " +
      "If a hazard stops the ride, the result is status \"checkpoint\" with the situation; answer it with decide. Otherwise the ride arrives and the result says what actually happened " +
      "(actual pickup and arrival, delay, extra kWh, incidents), the locked score and a run log. Arrived scores go on the /board page. " +
      "A shared flight sends legs, stops (who boards and alights where each leg lands) and quotes per booking instead of the pickup and ride legs and the one quote. " +
      "In the live game the result also has watch_url (the page where the player watches the Starseeker fly now) and lands_in_s (real seconds until it lands there): give the player the link right away.",
    inputSchema: {
      run_id: runId,
      pickup_leg: z.string().optional(),
      ride_leg: z.string().optional(),
      quoted_fare_usd: z.number().optional().describe("the fare you tell the rider, in US dollars"),
      quoted_arrival: z.string().optional().describe("the arrival time you promise the rider, YYYY-MM-DD HH:MM"),
      legs: z.array(z.string()).optional().describe("shared flight: the plan_leg leg_ids in flying order"),
      stops: z.array(z.object({ board: z.array(z.string()).optional(), alight: z.array(z.string()).optional() })).optional()
        .describe("shared flight: one entry per leg, the hail ids that board and alight where that leg lands"),
      quotes: z.record(z.object({ fare_usd: z.number(), arrival: z.string() })).optional()
        .describe("shared flight: per hail id, the fare you quote (the sum of fare_usd over the legs it rides) and the arrival you promise"),
      ask_after_hours: z.union([z.number().min(0).max(24), z.literal("never")]).optional()
        .describe("stop at a checkpoint once a hold or pad wait passes this many hours (0-24, default 1); \"never\" flies the default answers without stopping"),
      note,
    },
  },
  decide: {
    description: "Answer the open checkpoint of a dispatched ride. At a launch_hold (a flare grounds the launch): action wait, or replan with depart_after and objective (re-planned and re-flown " +
      "in the n-body checker; counts as a plan). At a pad_closed (no berth, dust or haze): action hold, with hours to ask again after that long or none to hold until it opens, or divert " +
      "with place (one of the situation's alternates) and wait_hours on the ground there. Returns the next checkpoint or the arrived result. Sending the same answer again returns where the ride stands. " +
      "In the live game the result has watch_url and lands_in_s again: the Starseeker flies on from the checkpoint on the watch page.",
    inputSchema: {
      run_id: runId,
      checkpoint: z.number().int().min(1).describe("the situation's checkpoint number"),
      action: z.enum(["wait", "replan", "hold", "divert"]),
      hours: z.number().optional().describe("hold: hours before the ride asks again (default: until the pad opens)"),
      place: z.string().min(1).max(64).optional().describe("divert: an alternate's place id or name"),
      wait_hours: z.number().min(0).optional().describe("divert: hours on the ground at the alternate before flying back (default 0)"),
      depart_after: skyTime.optional().describe("replan: leave no earlier than this sky time YYYY-MM-DD HH:MM (default: the checkpoint's time)"),
      objective: z.enum(["energy", "time"]).optional().describe("replan: least battery or fastest (default energy)"),
      note,
    },
  },
  get_my_rides: {
    description: "Your past rides (simulated), newest first: each ride's score and parts, energy against par, how far the arrival slipped from your promise, incidents, " +
      "and at each checkpoint what you decided and the best choice in hindsight with the kWh and arrival it would have given. The first page adds stats per hail " +
      "(best, last and mean total, the mean of each part, and the part you lose most on), computed from your rides. Page with next_cursor. include \"all\" adds rides " +
      "still planning, in flight (answer the open checkpoint with decide) or abandoned (a newer hail, or it went cold). Pass run_id for one ride's full record and log. " +
      "download.url is a 24-hour JSONL file of your rides on this server. Your history belongs to this connector sign-in: removing and re-adding the connector starts a new one.",
    inputSchema: {
      run_id: z.string().regex(RUN_ID).optional().describe("one of your rides: returns its full record and run log"),
      limit: z.number().int().min(1).max(25).optional().describe("rides per page, 1-25 (default 10)"),
      cursor: z.string().max(200).optional().describe("next_cursor from the previous page"),
      hail_id: z.string().max(64).optional().describe("only rides of this hail"),
      include: z.enum(["scored", "all"]).optional().describe("scored (default): arrived rides only; all: also planning, in flight and abandoned"),
    },
  },
};

const answer = (r) => (r && r.error
  ? { content: [{ type: "text", text: r.error }], isError: true }
  : { content: [{ type: "text", text: JSON.stringify(r) }] });

/** The hosted connector also runs the bench: start_bench, and the paragraph that tells a bot when to call it. */
export const HOSTED_TOOLS = {
  ...TOOLS,
  start_bench: {
    description: "Start a Starfare bench session (simulated): a few tasks from the bench suite, played one after another with these same tools. " +
      "Returns a watch link that shows the player every tool call live. Call it when the player asks to play the bench.",
    inputSchema: {
      split: z.enum(["dev", "test"]).describe("dev (default): practice tasks from the public split, each score shown when its ride arrives. " +
        "test: the held-out split; every score stays sealed until all its tasks are played. Use test only when the player asks for it.").optional(),
    },
  },
};

export const HOSTED_INSTRUCTIONS = INSTRUCTIONS + "\n" +
  "Bench: when the player asks to play the Starfare bench, call start_bench and give the player its watch link. Then play its tasks in order with the same tools: " +
  "list_hails shows the open task's one hail (or one shared flight) and its task_id, take_hail gives that task's run_id, and sky time is paused for the task. " +
  "Every call counts against the task's budget, list_hails and take_hail included. Every result's bench field says which task you are on, calls used and the budget; " +
  "when a task ends (its ride arrived or its budget is used) it says so, and the next call opens the next task. When bench.done is set, tell the player the total; later calls play the normal game. " +
  "Bench scores never go to /board. start_bench plays the practice (dev) split unless the player asks for the held-out test split (split \"test\"); " +
  "there a task's score stays sealed until every task is played: a ride that arrives says only that it flew, and the next call opens the next task.";

export function registerTools(server, backend, tools = TOOLS) {
  for (const [name, def] of Object.entries(tools)) server.registerTool(name, def, async (input) => answer(await backend.call(name, input)));
}
