// The MCP server a player's Grok bot calls: the Starfare robotaxi dispatcher. Same game as the in-page dispatcher
// (get_hail, plan_pickup, plan_ride, dispatch) plus list_hails and take_hail, and two free forecast tools for the
// simulated hazards (check_pad, space_weather). Tools only forward to the run's
// Durable Object; this class holds nothing but the session's current run_id (and, with STARFARE_OAUTH on, the
// grant's player id in this.props).
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { engine } from "./engine.js";
import { fleet, listHails } from "./game.js";
import { RUN_ID, runStub } from "./store.js";

const INSTRUCTIONS =
  "Starfare is a concept robotaxi service for flying roadsters across the solar system. You are the dispatcher. Simulated riders hail a ride; you pick a car from the simulated fleet, " +
  "plan the pickup and the ride with Starfare's engine (every leg between planets is re-flown in an n-body checker), quote the rider a fare and arrival, and dispatch.\n" +
  "Call list_hails, then take_hail to get a run_id and the fleet. Some cars are busy on another job until their busy_until time; their pickup can't leave earlier. " +
  "For each car worth trying, plan_pickup (car to rider), then plan_ride after that pickup. Compare cars, objectives (energy = least battery, time = fastest) and wait_days, " +
  "then dispatch with the pickup leg, the ride leg, the fare copied from the ride leg, and the arrival you promise the rider.\n" +
  "Hazards (simulated, seeded per season, the same for every player): pads have few berths and other traffic, solar flares hold any launch with a rider aboard, " +
  "Mars dust storms and Titan haze close those pads, a leg between planets that leaves late needs a correction burn, and holding in orbit for a berth costs 250 kWh an hour. " +
  "You only get forecasts: check_pad (booked berths per hour and local weather odds; unscheduled traffic, about a quarter, is never shown) and space_weather (flare odds per day). " +
  "Both are free and do not count as plans. The dispatch result says what actually happened (incidents, extra kWh, actual arrival) and returns a log you can learn from.\n" +
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

  async init() {
    const s = this.server;
    s.registerTool("list_hails", {
      description: "Riders waiting for a Starfare robotaxi (simulated riders): hail id, pickup place, destination, quick or long haul. Also the fleet of cars. Take one with take_hail.",
      inputSchema: {},
    }, async () => { const E = await engine(); return json({ hails: listHails(E), fleet: fleet(E), board: "/board" }); });

    s.registerTool("take_hail", {
      description: "Take a ride hail. Returns a run_id and the terms: where and when the rider is ready, the destination, the arrive_by time, the fleet and the scoring rules. One run per bot: taking a new hail abandons this session's undispatched run.",
      inputSchema: { hail_id: z.string().describe("hail id from list_hails, e.g. iss-crew") },
    }, async ({ hail_id }) => {
      const prev = this.state && this.state.run_id;
      const id = "run_" + [...crypto.getRandomValues(new Uint8Array(10))].map((b) => b.toString(16).padStart(2, "0")).join("");
      // With STARFARE_OAUTH on, the grant's anonymous player id rides along on the run (and to the board). Off: null.
      const player = this.props && typeof this.props.player_id === "string" ? this.props.player_id : null;
      const r = await runStub(this.env, id).create(id, hail_id, player);
      if (r.error) return err(r.error);
      if (prev) await runStub(this.env, prev).abandon();
      this.setState({ run_id: id });
      return json(r);
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

    const from = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/).describe("sky time YYYY-MM-DD HH:MM to start from (default: when the rider is ready)").optional();
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
      description: "Dispatch the car: the pickup leg, the ride leg, the fare you quote (copy the ride leg's fare_usd) and the arrival you promise the rider. The season's hazards are then flown: the result says what actually happened (actual pickup and arrival, delay, extra kWh, incidents), the locked score and a run log. The score goes on the /board page.",
      inputSchema: {
        run_id: runId,
        pickup_leg: z.string(),
        ride_leg: z.string(),
        quoted_fare_usd: z.number().describe("the fare you tell the rider, in US dollars"),
        quoted_arrival: z.string().describe("the arrival time you promise the rider, YYYY-MM-DD HH:MM"),
      },
    }, async ({ run_id, ...inp }) => out(await runStub(this.env, run_id).dispatch(inp)));
  }
}

export const mcpHandler = StarfareMcp.serve("/mcp", { transport: "auto" });
