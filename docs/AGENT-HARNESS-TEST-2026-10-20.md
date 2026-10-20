# Agent harness test, 20 October 2026

First end-to-end test of the agent harness with a real LLM agent, and the changes that make an agent's actions visible to a player. Everything ran in a Claude cloud container against a local `wrangler dev` (OAuth off, throwaway bench key). Nothing was deployed. Every score below is simulated.

## How it was tested

The agent was Claude Code in headless mode (`claude -p`), restricted to the `starfare` MCP tools, on Sonnet 5.5. Grok could not be connected from the container; Claude reaches the same MCP endpoints a Grok connector does.

| Path | What ran | Result |
| --- | --- | --- |
| Bench runner, built-in agent | `node bench/run.mjs --split dev --agent naive` (20 tasks) | Works. Mean 19,966 of 100,000. |
| Bench runner, external agent over stdio | `bench/run.mjs --agent bench/claude-code-agent.sh ...` on 3 dev tasks (`bench/serve.mjs` as the MCP server) | Works. 29,153, 27,607 and 26,292; 7 to 12 tool calls and 124k to 215k tokens per task. |
| Hosted live game over HTTP | Claude connected to `http://127.0.0.1:8799/mcp`, asked to fly a booking and answer checkpoints | Works after the `list_hails` fix below. Dispatches, `decide` at 1 to 4 checkpoints, `watch_url` returned, flight page plays it. |
| Hosted bench over HTTP | Claude asked to "play the Starfare bench" | Works. `start_bench`, 5 tasks, watch page live, replay verified. |
| Waiting state | A scripted MCP client (named `capture-script`) dispatched with `ask_after_hours: 0` and did not answer | Flight page and home feed show the flight waiting on the agent. |

`bench/claude-code-agent.sh` is the wrapper used for the stdio runs; the usage line is at its top.

## What broke, and what this change fixes

1. **An agent could not read `list_hails`.** The live pool is 200 hails, about 70 kB of JSON. Claude Code refused the result as over its tool-result limit and the agent fell back to the catalog example `iss-crew`; it told the player it "couldn't see which hails were long". Fixed: `list_hails` takes `kind`, `from`, `to`, `limit` and `cursor` and returns 25 at a time with `matching`, `next_cursor` and a `page_note`. A default page is under 16 kB. `/hails.json` and the home desk are unchanged.
2. **Agents took long hauls the season could no longer fit.** `take_hail` refused with "The season ends too soon". Fixed: `list_hails` now carries `season_clock` (sky now, season end, real seconds left, whether quick and long hauls can be taken, and a sentence saying so). One agent still tried a long haul after reading it; the refusal is unchanged.
3. **The home feed dropped agent actions within seconds.** Agent lines and simulation lines shared one 40-line list, and sky events arrive every sky day, so an agent's calls were pushed out about 10 seconds after page load. Fixed: agent actions have their own list above the sky feed ("Agent actions, newest first", up to 30), with a count on the Activity button, and the panel opens by itself on wide screens the first time an agent acts unless the viewer has toggled it.
4. **The agent's log on the flight page was at the bottom,** below the receipt, about 1,500 px down on desktop and further on a phone. Fixed: it is now the first tab of the side panel beside the replay ("Agent log", with Passengers as the second tab). On phones that panel sits directly under the player.
5. **Log lines were tool dumps with misleading times.** Each line showed the sky clock at the moment of the call (the wall-clock sky), which is unrelated to the flight's own dates. Fixed: one shared module (`src/agent-log.cjs`, served as `/assets/agent-log.js`) writes every call in words: what the agent did, the numbers from the tool result, its own note as "Why", your local time of the call, and the flight time the action is about. The flight page, home feed and bench page all use it.
6. **The log claimed every agent was "the Grok bot".** Fixed: `take_hail` now records the MCP client name and version the agent reported at initialize, as the first log entry, labelled self-reported and unverified. "Works with Grok" text is unchanged.
7. **Waiting on the agent was easy to miss.** Fixed: the flight page shows "Waiting for <agent>" with the checkpoint, place and cause at the top of the agent log, and the home feed adds a line when a flight stops at a checkpoint. The time readout no longer says "Held until the agent decides" after a flight has landed.
8. **The bench page printed raw floats** such as `148493.74433038838`, which overflowed every task card on desktop and phone. Fixed: scores are rounded with thousands separators. Rows now read as actions with the agent's note under them; the exact input and result are still one click away.
9. **Phone flight page: callouts covered the caption and readout.** Fixed: on screens up to 520 px wide the stage callouts are hidden, since the agent log and waiting banner sit directly under the player.
10. **A long first leg early in the season left the replay black.** The replay's lead-in before the first leg reached back before the sky begins, the engine threw "outside the ephemeris table" every frame, and the 3D stage never drew (seen on a Claude-flown Mars Base to Moon run). Fixed: the lead-in stops at the sky's first day.
11. **Phone flight page: the caption sat on the controls.** The control bar wraps to two or three rows on a phone and the caption was placed for one. Fixed: the caption follows the bar's real height.
12. **The bench's end-of-task line gave raw floats to the agent** ("scoring 26281.63516970564"). Fixed: rounded in the message; the structured `total` fields keep full precision.

13. **A signed-in player had no way to follow their agent.** Alvin connected a Grok bot to the live connector and had nowhere to watch it plan or decide: the flight page only exists after dispatch, and only if the bot passes its link on. Fixed: the sign-in page now shows a follow link (`/agent/<token>`) before Allow, and `take_hail` returns the same link as `follow_url`. The page lists the agent's newest ten bookings live, from `take_hail` on, each step in words with the agent's own reasons, a waiting banner at checkpoints, the score once it lands and a link to the flight. The token is random and only shown to the person who pressed Allow; the page shows only what the flight pages already make public.

## Found, not fixed here

- **A ship parked at the pickup cannot serve it.** `plan_pickup` fails with "SF-05 is already at the pickup", and `plan_ride` needs a pickup leg, so the closest ship is unusable. This is a game-rule change in `planPickup` and is left for Engineering.
- **Some pool hails no ship can fly.** `take_hail` on s50-35, s50-11 and s50-17 failed with a xenon-tank message from the par computation. The message reads like a planning error, not "this booking can't be served". The pool should leave these out or say so.
- **Scores look low.** Good runs land around 26,000 to 35,000 of 100,000 and the agents themselves misread that as "near the max". The scale is score version 3's; the board and bench should say what a strong total is.
- **Shared flights can promise years-late arrivals.** One shared-flight task delivered a booking 5.5 years after its arrive_by and still scored 27,607.
- **`get_my_rides` needs OAuth,** so history cannot be tested locally with OAuth off.
- **The home feed polls every 30 seconds,** so an agent action appears on the map page up to 30 s after it happens. The flight page polls separately.
- **The phone flight stage is crowded.** The sky-time readout covers place labels on a 390 px screen. Left for UI & Design.
- **Grok itself is untested.** Connecting a real Grok bot needs the hosted connector, which this container cannot reach and which is not deployed with these changes.

## Checks

- Unit tests (`node --test test/*.test.mjs`): 278 of 290 pass. The 12 failures are the planet-effects tests that fetch three.js from a CDN this container cannot reach; main fails the same 12 here. `test/agent-log.test.mjs` is new (log wording, bench mapping, agent name cleaning, `list_hails` paging and the season clock). The shared-dispatch escaping test now checks `AgentLog`.
- Local Worker checks (`test/e2e.mjs`): the full-pool calls now pass `limit: 200`. 43 of 43 passed earlier on 20 October; later the same day 42 of 43 pass on this branch and on main alike. The failing check re-dispatches a pool hail later in sky time and the engine refuses the leg with "RTG class xenon tank holds 1085 kg and this leg needs 1230.4 kg", the same unflyable-hail bug listed above.
- Captures: desktop 1440x900 and phone 390x844 in `docs/agent-harness/2026-10-20/`, from the real pages on local `wrangler dev`, labelled simulated. three.js r128 was served from npm because the container cannot reach cdnjs or jsdelivr.
