// The MCP server a player's Grok bot calls: the Starfare robotaxi dispatcher. The tool table lives in tools.js; this class is
// the hosted backend behind it. Run tools go to the run's Durable Object (StarfareRun.act); list_hails, take_hail and
// get_my_rides are answered here. The class holds nothing but the session's current run_id (and, with STARFARE_OAUTH on,
// the grant's player id in this.props).
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { engine } from "./engine.js";
import { fleet, listHails } from "./game.js";
import { hub, runStub } from "./store.js";
import { INSTRUCTIONS, registerTools } from "./tools.js";

// With STARFARE_OAUTH on, the grant's anonymous player id. Off: null.
const playerOf = (agent) => (agent.props && typeof agent.props.player_id === "string" ? agent.props.player_id : null);

/** The tools that are this session's, not one run's. Each returns plain data or { error }. */
const SESSION_TOOLS = {
  async list_hails() {
    const E = await engine();
    return { hails: listHails(E), fleet: fleet(E), board: "/board" };
  },

  async take_hail(agent, { hail_id }) {
    const prev = agent.state && agent.state.run_id;
    const id = "run_" + [...crypto.getRandomValues(new Uint8Array(10))].map((b) => b.toString(16).padStart(2, "0")).join("");
    // With STARFARE_OAUTH on, the grant's anonymous player id rides along on the run (to the board and the player's history).
    const r = await runStub(agent.env, id).create(id, hail_id, playerOf(agent));
    if (r.error) return r;
    const left = prev ? await runStub(agent.env, prev).leave() : null;
    agent.setState({ run_id: id });
    return left ? { ...r, previous_run: left } : r;
  },

  async get_my_rides(agent, { run_id, ...q }) {
    const player = playerOf(agent);
    if (!player) return { error: "Ride history needs the connector's sign-in (OAuth), and this server runs without it. Scores still go to /board." };
    if (run_id) return runStub(agent.env, run_id).ride(player);
    const h = hub(agent.env), r = await h.rides(player, q);
    if (r.error) return r;
    const dl = q.cursor ? null : await h.exportMint(player);
    return {
      player_id: player, simulated: true, ...r, ...(dl ? { download: { url: "/rides/export/" + dl.token + ".jsonl", expires: dl.expires } } : {}),
      note: "Simulated rides. Every number is copied from each ride's score and log; stats are sums and means over the rides listed. " +
        "One ride's file: /rides/<run_id>.json on this server.",
    };
  },
};

export class StarfareMcp extends McpAgent {
  server = new McpServer({ name: "starfare", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  initialState = { run_id: null };

  #call(tool, input) {
    if (Object.hasOwn(SESSION_TOOLS, tool)) return SESSION_TOOLS[tool](this, input);
    const { run_id, ...inp } = input;
    return runStub(this.env, run_id).act(tool, inp);
  }

  async init() {
    registerTools(this.server, { call: (tool, input) => this.#call(tool, input) });
  }
}

export const mcpHandler = StarfareMcp.serve("/mcp", { transport: "auto" });
