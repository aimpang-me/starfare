# SOL build plan (reworked 2026-10-15)

Alvin's call: build SOL first, timed to the Roadster unveiling. LOOP CHECK moves to week 2.

**SOL in one line:** a ride-hail app for the solar system. Agents plan the ride, and an independent physics checker re-flies every route before a fare is shown. Agents propose, physics disposes.

## Day 0 (done tonight)

The teaser [Ride to the Roadster](https://claude.ai/artifact/PEfGQmdSq597bv8QGWJsfn) is the deterministic core:
- Real Roadster position from JPL Horizons.
- A Lambert solver making 30,298 solves over a year of pickup dates.
- An n-body checker (Sun, 8 planets, Moon) that retargets every ride to under 1 km.

Code and data are in `sol-teaser/`.

## The week

| Day | Build | Done when |
|---|---|---|
| 1 | **Day-1 test, three arms.** Run the spike's 20 absurd requests through (a) a destination dropdown, (b) a one-call parser feeding the deterministic planner, and (c) the agent team. | Agents beat the parser on at least 3 of 20, at under $0.30 a ride, with every number traced to a tool call. If not, ship (b) and say so: it's still a good product. |
| 2 | **Planner core.** Porkchop grids for the Moon, Mars, Venus, the Roadster and asteroids (cross-checked against JPL's Small-Body Mission Design API). Stated vehicle assumptions. A Horizons cache. | Quotes for 10 destinations, each re-flown by the checker. |
| 3 | **Checker as a gate.** Every quote passes an n-body re-fly and retarget. A provenance check strikes any number in an agent's answer that no tool produced. 20 regression prompts in CI. | CI red on a planted made-up number. |
| 4 | **Agent team.** A dispatcher (parses and asks clarifying questions), a trajectory engineer (calls the planner) and a broker (counter-offers, e.g. "Mars overnight is impossible; 210 days for 4.1 km/s?"). Grok is an optional driver persona. Cost logged per ride. | The day-1 prompts run end to end with receipts. |
| 5 | **Ride-hail UI.** Street-to-solar-system zoom, receipts like the teaser, and messages timed by real light delay. | Works on a phone. |
| 6 | **Rejected wall and eval page.** Every quote the checker rejected, why, and the rejection rate per model. | A public page showing per-model numbers. |
| 7 | **Ship.** A video, "Pizza to the Roadster", plus a write-up on what the checker caught. Post it while the Roadster news is still warm. | Posted. |

## Budget and risks

- **Cost:** about $10-60 a month (spike estimate). JPL data is free and hosting fits a free tier.
- **Risk: agents add little over a dropdown.** The day-1 test guards this. The spike found 9 of 20 requests need an agent.
- **Risk: Roadster position is an extrapolation.** JPL's fit uses 2018 observations, so the page says so.
- **Risk: raw routes miss.** They do, by millions of km. That's the checker's job and the demo's hook.

## Week 2

LOOP CHECK. The pixel demo exists: https://claude.ai/artifact/1fa4EoTKv2BJQEjLrwE285. Next for it:
- Real LLM crews (the $7-21 day-1 test).
- Open crew seats over MCP, so visitors' agents can fly, with Grok as the house crew.

## Hero demo decision (2026-10-16, Alvin)

"Stranded at Titan": a rider at a moon of Saturn requests a ride home. Default driver is a **simulated fleet car** parked in Saturn orbit (labeled as simulated). The **real Roadster** is a "premium driver" option with its true position and honest ETA (years). Every leg (pickup and ride home) goes through the planner and the n-body re-fly. Live trip panel: travel time, AU travelled, battery used (stated energy model: 1,300 kg car, 200 kWh pack), fare in $ or DOGE (stated formula). Needs: any-origin rides, Saturn moons from JPL, two-leg trips, battery and fare models. Slots into days 4-5.
