// The MCP server a player's agents call: Starfare's game. Each agent sits in one seat of the player's company (the executor
// or a dispatcher) and passes that seat's code on every call, since Grok opens a new MCP session per tool call; the code
// names the world, whose Durable Object (StarfareWorld) checks the code and the seat's scope. The tool table lives in
// tools.js. this.props holds the server's origin and, with STARFARE_OAUTH on, the grant's player id.
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkInInfo } from "./game.js";
import { GAME_TOOLS, gameInstructions, registerTools } from "./tools.js";
import { parseCode, worldStub } from "./world.js";

/** A tool goes to the world its seat code names, which checks the code and the seat's scope (world.js). */
async function seatCall(agent, tool, { code, ...input }) {
  const c = parseCode(code);
  if (!c) return { error: "That seat code is not valid. Ask the player for a seat code: they start a company at " + ((agent.props && agent.props.origin) || "") + "/world, and its page shows one code per seat." };
  const inp = tool === "join" ? { agent: checkInInfo(input, agent.server.server.getClientVersion()) } : input;
  return worldStub(agent.env, c.world_id).seat(code, tool, inp);
}

export class StarfareMcp extends McpAgent {
  // Replaced in init(), where this.props (the site's origin) is set, so the instructions can name the page that starts a company.
  server = new McpServer({ name: "starfare", version: "0.1.0" }, { instructions: gameInstructions("") });

  async init() {
    this.server = new McpServer({ name: "starfare", version: "0.1.0" }, { instructions: gameInstructions(this.props && this.props.origin) });
    registerTools(this.server, { call: (tool, input) => (Object.hasOwn(GAME_TOOLS, tool) ? seatCall(this, tool, input || {}) : { error: "Unknown tool " + tool }) }, GAME_TOOLS);
  }
}

export const mcpHandler = StarfareMcp.serve("/mcp", { transport: "auto" });
