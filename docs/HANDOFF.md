# Starfare handoff (2026-10-16)

Context for a new Claude Code session picking up Starfare. `CLAUDE.md` has the layout, tests and rules; this file has the why, the decisions and what's next.

## What Starfare is
A robotaxi game for flying cars across the solar system, built as Alvin's portfolio piece (AI quality / agent evaluation angle). It doubles as an **agent benchmark**: anyone's agent can play by connecting over MCP.

Alvin's game loop, in his words (2026-10-16):
- Robotaxi ride hails. Simulated riders (NPCs) in different places request rides.
- Your agent takes a job. The player uses the model they want, and can write or install skills to help it. Grok bots connect via MCP.
- The agent plans the route, accounting for unpredictable space weather, each world's extreme weather, gravity and drag.
- The agent flies the ride. It may reroute, but it has to finish.
- It's scored, the score goes on a leaderboard, and the bot gets a log of what happened that it can learn from (RL). Loop.
- Multiplayer: other agents are visible driving around; not interactive, but they make docks busy.

## Where things stand
- **Engine** (`world/engine/sol-rides.js`): 5 hails (iss-crew, phobos-commute, jovian-hop quick; titan-home, ceres-shift long haul), 7 simulated cars SF-01..SF-07, par = best nearby car flown through the hazards with hindsight.
- **Hazard layer** (all simulated, seeded per season so everyone gets the same weather): pads with limited berths and NPC traffic (25% unscheduled, hidden from forecasts; holding in orbit costs 250 kWh/h), radiation storms that hold launches with a rider aboard, Mars dust storms and Titan haze closing pads, correction burns for late interplanetary departures, fleet cars busy on other jobs. `fly()` decides what happened; bots only see forecasts.
- **Score /100**: fast pickup 20, on time 20, energy vs par 20, kept the promise 15 (quoted arrival vs actual; 0 at 6 h late on quick hails, 1 day on long; early costs a quarter as much), every leg checked 10, honest fare 10, planning economy 5.
- **Grok connector** (`connector/`): live at https://starfare.aimpang.workers.dev/mcp (board at /board), OAuth on. Tools: list_hails, take_hail, get_hail, plan_pickup, plan_ride, check_pad, space_weather, dispatch (returns what happened, incidents and a run log).
- **Open Sky page** (`world/template.html` -> `open-sky.html`): the shared sky with free rides, a Claude dispatcher (through the viewer's own Claude account), the hail game with forecasts, a promise box and an incident list. Published as a private claude.ai artifact: https://claude.ai/artifact/PDmHnbcrxCiMTAerA8JR2z (republish to the same URL; it declares sample, db, room, user capabilities; keep them).
- **Spec**: "SOL Final Spec" Claude Doc https://claude.ai/code/artifact/33317ff6-abf3-461e-b47a-8fdcfdd98aa6 (section "The game: robotaxi dispatcher arena", and "Later ideas").
- Before the hazards, Grok scored 100 every time; a naive bot now averages about 92-98 on quick hails.

## Decisions already made (don't relitigate)
- It's ride hailing for flying cars, not deliveries (the older delivery game `sol-missions.js` is legacy).
- Bring-your-own-agent is Grok-first: players add the connector in their own Grok at grok.com/connectors. No xAI key on our side, ever.
- The Claude dispatcher in the page runs through the viewer's own Claude account (the page can't reach the network).
- Honest labels on everything simulated; the number gate strikes any number a dispatcher writes that no tool produced.
- No Tesla/SpaceX/xAI branding or affiliation ("Orbital Depot", not a SpaceX station). Text "Works with Grok" only.

## Next, in Alvin's build order
1. Mid-ride events and rerouting (a flare or a closed pad mid-ride; the agent must reroute and still finish).
2. Run log history: `get_my_rides` so a bot can learn across runs; downloadable JSON log.
3. Leaderboard labelled by model plus skills; daily seed so runs are comparable.
4. Show other agents' cars on the map and make their dockings fill real pads (multiplayer busy docks).
5. Later: dispatch bidding, comfort (max g), battery and charging stops, pooling.

## Housekeeping
- Loose ends: delete the old `sol-connector` Worker, the `aimpang/starfare` repo and `Documents\starfare-mine` once Alvin says so.
- This repo is public as of 2026-10-16; Alvin may make it private.
- Windows: `.gitattributes` keeps LF so the engine copy stays byte-identical. `connector/test/e2e.mjs` stop() has a Windows fallback (if `process.kill(-pid)` throws, `child.kill('SIGKILL')`; `rmSync` in a try with `maxRetries: 5`), or cleanup fails with EBUSY. Committed in eb3caae.
- The Open Sky pill fix is already in (pills lock while Claude answers, each pill starts fresh, the gate trusts the page's sky date).
- e2e tests fail in the last minute of a sky season (7000 sky days, about 1.9 h real time); rerun.
