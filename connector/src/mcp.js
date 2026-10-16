// The MCP server a player's Grok bot calls: the Starfare robotaxi dispatcher. Same game as the in-page dispatcher
// (get_hail, plan_pickup, plan_ride, dispatch) plus list_hails and take_hail, two free forecast tools for the
// simulated hazards (check_pad, space_weather), decide for the checkpoints a ride stops at, and get_my_rides (a signed-in
// player's past rides and logs). Tools only forward to the run's Durable Object or the hub; this class holds nothing but the
// session's current run_id (and, with STARFARE_OAUTH on, the grant's player id in this.props).
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { engine } from "./engine.js";
import { fleet, listHails } from "./game.js";
import { RUN_ID, hub, runStub } from "./store.js";

const INSTRUCTIONS =
  "Starfare is a concept robotaxi service for flying roadsters across the solar system. You are the dispatcher. Simulated riders hail a ride; you pick a car from the simulated fleet, " +
  "plan the pickup and the ride with Starfare's engine (every leg between planets is re-flown in an n-body checker), quote the rider a fare and arrival, and dispatch.\n" +
  "Before planning, call get_my_rides: your past rides (simulated), what you lost points on, and at each checkpoint what the best choice would have used in hindsight.\n" +
  "Call list_hails, then take_hail to get a run_id and the fleet. Some cars are busy on another job until their busy_until time; their pickup can't leave earlier. " +
  "For each car worth trying, plan_pickup (car to rider), then plan_ride after that pickup. Compare cars, objectives (energy = least battery, time = fastest) and wait_days, " +
  "then dispatch with the pickup leg, the ride leg, the fare copied from the ride leg, and the arrival you promise the rider.\n" +
  "Hazards (simulated, seeded per season, the same for every player): pads have few berths and other traffic, solar flares hold any launch with a rider aboard, " +
  "Mars dust storms and Titan haze close those pads, a leg between planets that leaves late needs a correction burn, and holding in orbit for a berth costs 250 kWh an hour. " +
  "You only get forecasts: check_pad (booked berths per hour and local weather odds; unscheduled traffic, about a quarter, is never shown) and space_weather (flare odds per day). " +
  "Both are free and do not count as plans.\n" +
  "Once dispatched, the car flies the season's hazards. When a flare grounds a launch or a pad is closed when the car arrives, the ride stops at a checkpoint and the result is status \"checkpoint\" " +
  "with a situation: what happened, where the car is, the kWh used so far and the options. Answer with decide: at a launch hold, wait or replan the leg from a later time (a replan counts as a plan); " +
  "at a closed pad, hold in orbit or divert to a nearby pad. Small holds are decided for you: dispatch's ask_after_hours (default 1, or \"never\") sets how long before the ride asks. " +
  "The ride's sky clock is stopped at a checkpoint, and get_hail shows the open one. When the ride arrives the result says what actually happened (incidents, extra kWh, actual arrival), " +
  "what each choice at each checkpoint would have cost in hindsight, and a log you can learn from.\n" +
  "Goal: pick the rider up fast, arrive by arrive_by, use the least battery actually flown, and keep your promise. The quoted arrival is a promise scored against the actual arrival: " +
  "late costs the most (0 at 6 hours late on a quick hail, 1 day on a long haul), early costs a quarter as much. Each plan counts: 6 are free, then each costs a point.\n" +
  "Hard rules: every number you write must be copied from a tool result or the player's words, dates exactly as given. Never estimate a number. Never dispatch a leg whose refly.result is FAIL. " +
  "The one time you choose is the promised arrival: the ride leg's arrive, or a later time you pick as a buffer for a forecast hazard; if you add a buffer, tell the rider it is one and why.\n" +
  "The sky clock runs 1 sky day per real second, so work promptly on long-haul hails. Scores go to the public board at /board on this server, labelled \"planned by Grok bot\".";

const runId = z.string().regex(RUN_ID).describe("run_id from take_hail");
const json = (v) => ({ content: [{ type: "text", text: JSON.stringify(v) }] });
const err = (msg) => ({ content: [{ type: "text", text: msg }], isError: true });
const out = (r) => (r && r.error ? err(r.error) : json(r));

export class StarfareMcp extends McpAgent {
  server = new McpServer({ name: "starfare", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  initialState = { run_id: null };
  // With STARFARE_OAUTH on, the grant's anonymous player id. Off: null.
  #player() { return this.props && typeof this.props.player_id === "string" ? this.props.player_id : null; }

  async init() {
    const s = this.server;
    s.registerTool("list_hails", {
      description: "Riders waiting for a Starfare robotaxi (simulated riders): hail id, pickup place, destination, quick or long haul. Also the fleet of cars. Take one with take_hail.",
      inputSchema: {},
    }, async () => { const E = await engine(); return json({ hails: listHails(E), fleet: fleet(E), board: "/board" }); });

    s.registerTool("take_hail", {
      description: "Take a ride hail. Returns a run_id and the terms: where and when the rider is ready, the destination, the arrive_by time, the fleet and the scoring rules. One run per bot: taking a new hail abandons this session's undispatched run, or flies a ride waiting at a checkpoint on to arrive with the default answers (scored). The result's previous_run says which.",
      inputSchema: { hail_id: z.string().describe("hail id from list_hails, e.g. iss-crew") },
    }, async ({ hail_id }) => {
      const prev = this.state && this.state.run_id;
      const id = "run_" + [...crypto.getRandomValues(new Uint8Array(10))].map((b) => b.toString(16).padStart(2, "0")).join("");
      // With STARFARE_OAUTH on, the grant's anonymous player id rides along on the run (to the board and the player's history).
      const r = await runStub(this.env, id).create(id, hail_id, this.#player());
      if (r.error) return err(r.error);
      const left = prev ? await runStub(this.env, prev).leave() : null;
      this.setState({ run_id: id });
      return json(left ? { ...r, previous_run: left } : r);
    });

    s.registerTool("get_hail", {
      description: "The run's hail: rider, pickup place and time, destination, arrive_by, the fleet (each car free or busy_until a time), plans used, the hazards and the scoring rules.",
      inputSchema: { run_id: runId },
    }, async ({ run_id }) => out(await runStub(this.env, run_id).info()));

    s.registerTool("plan_pickup", {
      description: "Plan a car's flight from where it is parked to the rider, leaving when the rider is ready or the car is free, whichever is later (or wait_days after that), and re-fly it in the n-body checker. Returns the pickup leg with its leg_id; a note says if the car was busy.",
      inputSchema: {
        run_id: runId,
        car: z.string().describe("car id from the fleet, e.g. sf-01"),
        objective: z.enum(["energy", "time"]).optional(),
        wait_days: z.number().min(0).max(400).optional(),
      },
    }, async ({ run_id, ...inp }) => out(await runStub(this.env, run_id).plan("pickup", inp)));

    s.registerTool("plan_ride", {
      description: "Plan the rider's ride from the pickup to the destination, leaving after the given pickup leg and boarding (or wait_days later), and re-fly it in the n-body checker. Returns the ride leg with its fare_usd and arrive time.",
      inputSchema: {
        run_id: runId,
        after_leg: z.string().describe("leg_id of the pickup this ride follows"),
        objective: z.enum(["energy", "time"]).optional(),
        wait_days: z.number().min(0).max(400).optional(),
      },
    }, async ({ run_id, ...inp }) => out(await runStub(this.env, run_id).plan("ride", inp)));

    const skyTime = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    const from = skyTime.describe("sky time YYYY-MM-DD HH:MM to start from (default: when the rider is ready, or the open checkpoint's time in flight)").optional();
    s.registerTool("check_pad", {
      description: "Forecast for a pad (simulated): its berths, how many are booked each hour, and local weather odds (Mars dust, Titan haze) if any. Scheduled traffic only: about a quarter of ships are unscheduled and never show here. Free; does not count as a plan.",
      inputSchema: {
        run_id: runId,
        place: z.string().min(1).max(64).describe("place id or name, e.g. iss or Mars Base"),
        hours: z.number().int().min(1).max(72).optional().describe("hours to show, 1-72 (default 24)"),
        from,
      },
    }, async ({ run_id, ...inp }) => out(await runStub(this.env, run_id).forecast("pad", inp)));

    s.registerTool("space_weather", {
      description: "Solar radiation storm (flare) forecast (simulated): the odds a storm starts, per sky day. A storm holds any launch with a rider aboard until it passes. Free; does not count as a plan.",
      inputSchema: {
        run_id: runId,
        days: z.number().int().min(1).max(60).optional().describe("days to show, 1-60 (default 10)"),
        from,
      },
    }, async ({ run_id, ...inp }) => out(await runStub(this.env, run_id).forecast("flares", inp)));

    s.registerTool("dispatch", {
      description: "Dispatch the car: the pickup leg, the ride leg, the fare you quote (copy the ride leg's fare_usd) and the arrival you promise the rider. The season's hazards are then flown. " +
        "If a hazard stops the ride, the result is status \"checkpoint\" with the situation; answer it with decide. Otherwise the ride arrives and the result says what actually happened " +
        "(actual pickup and arrival, delay, extra kWh, incidents), the locked score and a run log. Arrived scores go on the /board page.",
      inputSchema: {
        run_id: runId,
        pickup_leg: z.string(),
        ride_leg: z.string(),
        quoted_fare_usd: z.number().describe("the fare you tell the rider, in US dollars"),
        quoted_arrival: z.string().describe("the arrival time you promise the rider, YYYY-MM-DD HH:MM"),
        ask_after_hours: z.union([z.number().min(0).max(24), z.literal("never")]).optional()
          .describe("stop at a checkpoint once a hold or pad wait passes this many hours (0-24, default 1); \"never\" flies the default answers without stopping"),
      },
    }, async ({ run_id, ...inp }) => out(await runStub(this.env, run_id).dispatch(inp)));

    s.registerTool("decide", {
      description: "Answer the open checkpoint of a dispatched ride. At a launch_hold (a flare grounds the launch): action wait, or replan with depart_after and objective (re-planned and re-flown " +
        "in the n-body checker; counts as a plan). At a pad_closed (no berth, dust or haze): action hold, with hours to ask again after that long or none to hold until it opens, or divert " +
        "with place (one of the situation's alternates) and wait_hours on the ground there. Returns the next checkpoint or the arrived result. Sending the same answer again returns where the ride stands.",
      inputSchema: {
        run_id: runId,
        checkpoint: z.number().int().min(1).describe("the situation's checkpoint number"),
        action: z.enum(["wait", "replan", "hold", "divert"]),
        hours: z.number().optional().describe("hold: hours before the ride asks again (default: until the pad opens)"),
        place: z.string().min(1).max(64).optional().describe("divert: an alternate's place id or name"),
        wait_hours: z.number().min(0).optional().describe("divert: hours on the ground at the alternate before flying back (default 0)"),
        depart_after: skyTime.optional().describe("replan: leave no earlier than this sky time YYYY-MM-DD HH:MM (default: the checkpoint's time)"),
        objective: z.enum(["energy", "time"]).optional().describe("replan: least battery or fastest (default energy)"),
      },
    }, async ({ run_id, ...inp }) => out(await runStub(this.env, run_id).decide(inp)));

    s.registerTool("get_my_rides", {
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
    }, async ({ run_id, ...q }) => {
      const player = this.#player();
      if (!player) return err("Ride history needs the connector's sign-in (OAuth), and this server runs without it. Scores still go to /board.");
      if (run_id) return out(await runStub(this.env, run_id).ride(player));
      const h = hub(this.env), r = await h.rides(player, q);
      if (r.error) return err(r.error);
      const dl = q.cursor ? null : await h.exportMint(player);
      return json({
        player_id: player, simulated: true, ...r, ...(dl ? { download: { url: "/rides/export/" + dl.token + ".jsonl", expires: dl.expires } } : {}),
        note: "Simulated rides. Every number is copied from each ride's score and log; stats are sums and means over the rides listed. " +
          "One ride's file: /rides/<run_id>.json on this server.",
      });
    });
  }
}

export const mcpHandler = StarfareMcp.serve("/mcp", { transport: "auto" });
