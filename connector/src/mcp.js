// The MCP server a player's Grok bot calls: the Starfare robotaxi dispatcher. The tool table lives in tools.js; this class is
// the hosted backend behind it. Run tools go to the run's Durable Object (StarfareRun.act); list_hails, take_hail and
// get_my_rides are answered here. The class holds nothing but the session's current run_id, or its bench_id while it plays
// the bench (every call then goes to that session's StarfareBench), and in this.props the server's origin and, with
// STARFARE_OAUTH on, the grant's player id.
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { benchStub } from "./bench.js";
import { hex } from "./bench-host.js";
import { engine } from "./engine.js";
import { checkInInfo, hailPage, poolView, seasonClock, sky } from "./game.js";
import { hub, runStub } from "./store.js";
import { HOSTED_INSTRUCTIONS, HOSTED_TOOLS, SANDBOX_INSTRUCTIONS, SANDBOX_RUN_TOOLS, SANDBOX_TOOLS, registerTools } from "./tools.js";
import { parseCode, sandboxOn, worldStub } from "./world.js";

// With STARFARE_OAUTH on, the grant's anonymous player id. Off: null.
const playerOf = (agent) => (agent.props && typeof agent.props.player_id === "string" ? agent.props.player_id : null);
// Who the held-out bench's daily limit counts: the player, or without sign-in the address the session connected from.
const benchWho = (agent) => (playerOf(agent) ? "player:" + playerOf(agent) : "addr:" + ((agent.props && agent.props.client) || "unknown"));

/** The tools that are this session's, not one run's. Each returns plain data or { error }. */
const SESSION_TOOLS = {
  async list_hails(agent, input) {
    const E = await engine(), season = sky(Date.now()).season;
    const cap = await hub(agent.env).ensurePool(season);
    const page = hailPage(poolView(E, season, cap), input || {});
    return page.error ? page : { ...page, season_clock: seasonClock(E, Date.now()) };
  },

  async take_hail(agent, { hail_id }) {
    const prev = agent.state && agent.state.run_id;
    const id = "run_" + hex(10);
    // With STARFARE_OAUTH on, the grant's anonymous player id rides along on the run (to the board and the player's history).
    // The MCP client name the agent reported at initialize labels its dispatcher log (self-reported).
    const r = await runStub(agent.env, id).create(id, hail_id, playerOf(agent), agent.server.server.getClientVersion() || null);
    if (r.error) return r;
    const left = prev ? await runStub(agent.env, prev).leave() : null;
    agent.setState({ ...agent.state, run_id: id });
    // Checked in on a home page's Comms channel: the booking shows there too (the only link when the server runs without sign-in).
    if (agent.state.comms) await hub(agent.env).commsRun(agent.state.comms, id);
    // Signed in: the player's follow page lists this booking and every call on it from now on.
    const player = playerOf(agent), origin = agent.props && agent.props.origin;
    const out = player && origin ? { follow_url: origin + "/agent/" + (await hub(agent.env).followFor(player)), ...r } : r;
    return left ? { ...out, previous_run: left } : out;
  },

  async start_bench(agent, input) {
    const id = "b_" + hex(10), r = await benchStub(agent.env, id).create(id, playerOf(agent), (input && input.split) || "dev", benchWho(agent));
    if (r.error) return r;
    const prev = agent.state && agent.state.run_id, left = prev ? await runStub(agent.env, prev).leave() : null;
    agent.setState({ ...agent.state, run_id: null, bench_id: id });
    return { ...r, watch: ((agent.props && agent.props.origin) || "") + "/bench/" + id, ...(left ? { previous_run: left } : {}) };
  },

  // The player's Comms panel: the agent says who it is (self-reported, unverified) and the panel shows its bookings from now on.
  async check_in(agent, input) {
    const r = await hub(agent.env).commsCheckIn(input.code, checkInInfo(input, agent.server.server.getClientVersion()), playerOf(agent));
    if (r.error) return r;
    agent.setState({ ...agent.state, comms: r.channel });
    return { checked_in: true, simulated: true,
      note: "HQ confirmed you on the player's Comms panel. It shows your name, model, thinking and skills as self-reported and unverified, " +
        "and every booking you take from now on with your notes as your own words. HQ only answers the player from public game data; planning stays yours." };
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

/** A sandbox tool goes to the world its seat code names, which checks the code and the seat's scope (world.js). */
async function sandboxCall(agent, tool, { code, ...input }) {
  const c = parseCode(code);
  if (!c) return { error: "That seat code is not valid. Ask the player for the code their world's page shows for your seat." };
  const inp = tool === "join" ? { agent: checkInInfo(input, agent.server.server.getClientVersion()) } : input;
  return worldStub(agent.env, c.world_id).seat(code, tool, inp);
}

export class StarfareMcp extends McpAgent {
  // The sandbox's tools and paragraph only while STARFARE_SANDBOX is on (this.env is set before field initializers run).
  server = new McpServer({ name: "starfare", version: "0.1.0" }, { instructions: HOSTED_INSTRUCTIONS + (sandboxOn(this.env) ? SANDBOX_INSTRUCTIONS : "") });
  initialState = { run_id: null, bench_id: null };

  async #bench(id, tool, input) {
    const r = await benchStub(this.env, id).call(tool, input);
    if (r.bench && r.bench.done) this.setState({ ...this.state, bench_id: null });
    return r;
  }

  async #call(tool, input) {
    // A sandbox tool, or a run tool called with a seat code (a dispatcher flying a job), goes to the code's world.
    if (Object.hasOwn(SANDBOX_TOOLS, tool) || (Object.hasOwn(SANDBOX_RUN_TOOLS, tool) && input && input.code != null)) return sandboxCall(this, tool, input);
    if (Object.hasOwn(SANDBOX_RUN_TOOLS, tool) && !(input && input.run_id)) return { error: "Pass run_id from take_hail (or, in the sandbox, your seat code and the job_id)." };
    const bench = this.state && this.state.bench_id;
    if (bench && tool !== "start_bench" && tool !== "check_in") return this.#bench(bench, tool, input);
    if (Object.hasOwn(SESSION_TOOLS, tool)) return SESSION_TOOLS[tool](this, input);
    const { run_id, ...inp } = input, r = await runStub(this.env, run_id).act(tool, inp, playerOf(this));
    // A season flight now flying (dispatch or decide): the page where everyone watches it live.
    return r.lands_in_s != null ? { watch_url: ((this.props && this.props.origin) || "") + "/flight/" + run_id, ...r } : r;
  }

  async init() {
    registerTools(this.server, { call: (tool, input) => this.#call(tool, input) }, sandboxOn(this.env) ? { ...HOSTED_TOOLS, ...SANDBOX_RUN_TOOLS, ...SANDBOX_TOOLS } : HOSTED_TOOLS);
  }
}

export const mcpHandler = StarfareMcp.serve("/mcp", { transport: "auto" });
