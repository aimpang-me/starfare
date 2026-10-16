> **Snapshot.** Exported 2026-10-16 from the Claude Doc "SOL Final Spec" (https://claude.ai/code/artifact/33317ff6-abf3-461e-b47a-8fdcfdd98aa6), which stays the live copy Alvin edits. Written before the rename to Starfare and before the Grok connector went live, so two things here are out of date: Grok now plays through the MCP connector in the player's own grok.com account (no xAI key anywhere), and the ride-hail game with hazards in `docs/HANDOFF.md` supersedes the game sections below.

# SOL Final Spec

Oct 16, 2026 · @Alvin

SOL is a ride-hail app for the solar system. A rider asks in plain words, three AI agents plan the trip, and an independent physics checker re-flies every route before it is offered. Any number the rider sees must come from a tool, or it is struck out.

## What the prototype proves

- **Agents beat a form.** On 20 absurd requests, the agent team beat a one-call parser on 8 (the bar was 3).
- **Physics gates every quote.** Each route is re-flown with the Sun, eight planets and the Moon pulling on it. The planner's raw routes miss by millions of km; a small correction brings the miss under 1 km, or the route is rejected.
- **No made-up numbers.** A provenance gate checks every number and date in an answer against the tool outputs. A planted fake number turns the test suite red.
- **It works as a product.** The hero demo, "Stranded at Titan", runs on a phone: request, pickup, a live trip panel and a receipt.

Prototype: [Stranded at Titan](https://claude.ai/artifact/2yebB9MK7NtNvYq7GKd5gD).

## The hero demo: Stranded at Titan

The rider is in a 1,500 km orbit around Titan and wants to get home to Earth. Every step below uses real trip outputs from the planner, each re-flown by the checker.

1. **Ask.** "I'm stuck on Titan. Get me home to Earth. What are my options?"
2. **Two options come back.**
   - A simulated fleet car parked in the rider's orbit, which arrives home 2032-03-13: 1,975 days, $1,000,147.68.
   - The real Roadster as a premium driver. It flies out from its true JPL position, reaches Titan 2033-08-15 and gets the rider home 2039-07-15: 4,655 days, $2,376,608.64.
3. **Push back.** "Too slow. Faster please, money is no object."
4. **The broker counter-offers.**
   - The fastest trip takes 680 days but hits Earth at 48.96 km/s. The broker won't sell it: money can't make that speed safe.
   - It offers a balanced trip instead: home 2030-03-09, 1,240 days, Earth arrival at 15.97 km/s, $632,813.76.
5. **Book.** The fleet car picks you up in 4.8 hours. Booking the Roadster needs a light-speed round trip to reach it (about 2 h 12 min), which the demo can skip.
6. **Ride.** A live panel counts up travel time, AU travelled, battery used and the fare (USD or Dogecoin), plus the light delay to Earth. The map zooms from your orbit out to the whole solar system.
7. **Arrive.** A receipt shows each leg's re-fly result and every stated assumption.

## Screens and features

The prototype is one page with four parts. It is phone-first and uses Alvin's Terminal design system.

| Part | What the rider or reviewer does | What it shows |
| --- | --- | --- |
| The app (phone) | Asks, taps a suggested reply, picks a ride, books, scrubs the trip, switches USD or Dogecoin, messages Earth | A map that zooms from your orbit to the solar system; chat with the broker; ride cards; a live trip panel (time, AU, battery, fare, light delay); a trip log; an arrival card |
| Behind the screen | Reads what each agent did on the current turn | The dispatcher's reading of the request, every planner call with its run time and re-fly result, and the provenance score |
| Ride receipt | Reads the selected ride's bill | Legs, dates, burn, burn time at an assumed 0.5 g, battery, energy and time fees, each leg's re-fly (raw miss, correction, final miss), and every stated assumption |
| Rejected wall and eval | Compares models and sees what the checker threw out | Per-model results on the same 20 requests, and every route the checker rejected with the reason |

Tapping any underlined number in a broker answer names the tool output and field it came from.

## Playable pages (added Oct 16)

Two more pages turn the prototype into something people can play.

| Page | What you do | What it proves |
| --- | --- | --- |
| [SOL Dispatch Desk](https://claude.ai/artifact/Y9BqECAnPLugQPhKqqb8N5) | You play the gate. Each ticket is a real agent answer or route; you SHIP it or HOLD it, then the answer key shows why. | The gates are learnable rules, not magic. Every ticket comes from recorded runs. |
| [SOL Open Sky](https://claude.ai/artifact/PDmHnbcrxCiMTAerA8JR2z) | You spawn somewhere random (planet, moon, station or spaceship), ask the dispatcher for a ride, book it and watch it fly. Everyone with the page open shares one sky. | The planner and checker run live in the browser, cross-checked against Python on 43 routes. The dispatcher is Claude, and its numbers go through the same gate. |

Open Sky has real stations (ISS and Tiangong, from JPL Horizons) and labelled fictional ones (Orbital Depot, Lunar Data Center, Mars Base, Ceres Port, Titan Dock). Sky time runs one day per real second, and the sky resets each season.

## The game: robotaxi dispatcher arena

As of Oct 16, SOL's game is ride hailing for flying roadsters. Agents are dispatchers that get scored and ranked. Alvin set the shape of the loop, and it replaces the earlier delivery missions:

1. Simulated riders (NPCs) around the system hail rides.
2. A player's agent takes a job. The player brings their own model and may write or install skills for it. Grok bots join through the MCP connector.
3. The agent picks a car, plans the pickup and the ride with SOL's engine, quotes the fare and arrival, and starts the ride.
4. The agent plans around the unpredictable parts: space weather, extreme weather on some worlds, each world's gravity and drag, and busy docks.
5. The agent may reroute or make mistakes, but it has to finish the job.
6. The run is scored, ranked on a leaderboard, and returned as a log the bot can learn from. Then the loop repeats.

In multiplayer, players see other agents' cars moving on the map. They can't interact with them, but that traffic is what makes docks busy.

What Claude added to the plan:

- Seeded conditions: weather and NPC traffic come from a daily seed, so ranks reflect skill, not luck.
- Mid-ride events: the agent is asked mid-flight (flare ahead, dock busy) and answers hold, reroute or push on.
- Failure states: an empty battery, a silent agent or a timeout gives a rescue penalty and "did not finish".
- Leaderboard labels: model plus skills, self-reported and marked unverified, so runs with skills compare against runs without.
- Run log: every tool call, event and score part in one downloadable JSON, plus a replay on the map.
- Honest physics labels: orbits and gravity are real; weather, landing drag and dock queues are labelled simulated models.

Later ideas, not yet scheduled:

- Dispatch rules: first to accept, or a short bidding window on price and arrival time; riders cancel if nobody takes the job.
- Passenger comfort: a max-g limit for fragile riders or cargo, scored as a rating.
- Battery and charging stops, which queue like docks: take the fare on low charge, or recharge first?
- Pooling: several riders in one car with different destinations.
- A get\_my\_rides tool: agents pull their past run logs to learn from them.
- Per-world hazards: Mars dust storms close the pad, Venus winds, high-gravity landings cost more. Labelled as simulated.

Build order:

1. Ride hails: NPC hails, a simulated fleet, pickup plus ride, scoring (fast pickup 25, on time 25 on a sliding scale, energy against the best nearby car 25, checker 10, honest quote 10, planning economy 5), in Open Sky and the Grok connector. In progress.
2. Seeded space weather and busy docks.
3. Mid-ride events with rerouting, and the run log.
4. A leaderboard by model and skills.

The Grok connector is live at [sol-connector.aimpang.workers.dev/mcp](https://sol-connector.aimpang.workers.dev/mcp). Its [board](https://sol-connector.aimpang.workers.dev/board) shows Grok's first run: 100/100 on the old lunch-rush delivery mission.

## How it works

&#91;embedded content: SOL pipeline · 3 agents, 2 gates\]

The agents never produce physics themselves. The engineer can only call the planner, and anything offered must carry a passing re-fly. The broker may use only numbers printed by the tools or written by the rider. Backends: replay (recorded runs, used in the prototype), Anthropic (written, untested without a key) and xAI Grok (a stub until a key exists).

## Physics, data and stated models

Positions are real. The car, the battery and the fare are made up on purpose, and every receipt prints them.

| Piece | What it is | Source or value |
| --- | --- | --- |
| Planets and Moon | Positions and velocities | JPL DE421 (valid to 2053) |
| Roadster, Bennu, Ceres | Starting states, checked against Horizons' range, range-rate and light-time columns | JPL Horizons |
| Planner | Izzo Lambert solver, 0 or 1 revolution, scanned over departure dates and flight times | Earth departures from a 200 km parking orbit; Titan trips from a 1,500 km Titan orbit |
| Checker | Re-flies the route with the Sun, 8 planets and the Moon (DOP853), then corrects the departure | Pass: miss under 1 km and a correction under 500 m/s |
| Cross-check | Bennu route compared with JPL's mission-design API | Found the 1-revolution route the first planner missed |
| Car (made up) | Dry mass, battery pack | 1,300 kg, 200 kWh |
| Thruster (made up) | Electric, burns treated as instant | 30 km/s exhaust, 60% efficient |
| Burn time (made up) | Page math, not a planner output | Total burn divided by an assumed 0.5 g push |
| Fare (made up) | Energy plus time | $0.16 per kWh plus $0.35 per minute |
| Dogecoin | The rider types the rate | No live price feed |

Titan's place in its orbit, the car's place around Titan, Saturn's rings and the short hop from Titan onto the Sun-centred route are drawn, not computed.

## Quality gates and the model eval

No made-up number got past the gates in any model, and Opus and Fable were the most helpful, with 15 verified rides each out of 20 requests.

Each model played all three agent roles on the same 20 rider requests, with the same planner and the same prompts. The gates:

- **Provenance.** Every number and date must trace to a tool output or the rider's words.
- **Physics.** Any ride offered must cite a re-fly that passed.
- **Phantom calls.** Every planner call an answer cites must actually have been run.

| Model | Passed both gates | Verified rides offered | Questions on complete requests (of 5) | Struck answers | Routes the checker rejected | Planner calls |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Opus | 20/20 | 15 | 0 | 0 | 0 | 21 |
| Claude Fable | 20/20 | 15 | 0 | 0 | 1 | 20 |
| Claude Sonnet | 19/20 | 13 | 0 | 1 | 1 | 23 |
| Claude Haiku | 20/20 | 6 | 2 | 0 | 0 | 10 |
| Recorded team, day 3 (reference) | 20/20 | 12 | 1 | 0 | n/a | n/a |
| Grok | not run |  |  |  |  |  |

- **Sonnet's one struck answer** was a bare "2028" ("if you can leave in 2028 instead"). The gate is strict: dates in 2028 were traced, but the bare year was not.
- **Haiku stays safe by not helping.** It asked or declined on 14 of 20 requests.
- **The checker's best catch.** Sonnet and Fable both asked for a Roadster route with an extra lap around the Sun at almost no launch energy (C3 0.83). It missed by about 30.6 million km and needed a 545.5 m/s correction, over the 500 m/s limit, so it was rejected. Both models then found a route that passed.
- **Checker stress test.** 56 random planner routes to 10 destinations all missed raw, by 19,309 km to 25,935,444 km. A correction of 0.9 to 72.3 m/s closed all 56 to under 1 km. An audit on Oct 16 caught the checker itself: its integrator was too loose for 20-year trips, so the first run had rejected a 7,000-day Neptune route (13.246 km off) and the 23-year Uranus quote from day 2 (12.456 km off). Flown again at tighter precision, both pass: Neptune ends 0.921 km off and Uranus 0.524 km.
- **Regression suite:** 20/20 pass, and a planted fake number turns it red.

The models ran as Claude subagents. Grok needs an xAI key in the cloud environment. Dollar cost per ride is not measured yet, for the same reason.

## Rules the product keeps

- **Nothing unchecked is offered.** A quote needs a passing re-fly, and the receipt shows it.
- **No made-up numbers.** Every number and date a rider reads traces to a tool output or to the rider's own words.
- **Say what is simulated.** The fleet car is labelled simulated everywhere. The Roadster's position is real, and the page says nobody can book it.
- **Say what is not modelled.** Landing, aerobraking, life support, recharging and the fleet car's phasing burn are named on every receipt.
- **Refuse the unsafe sale.** The broker will not book an Earth arrival it can't make safe, and offers a slower one instead.
- **No Tesla or SpaceX logos, and no affiliation claimed.** No scraping of X or the Robotaxi app.
- **No face or voice of Alvin** in demos or the launch video.
- **Grok-exclusive bring-your-own-agent.** When outside agents can drive, Grok is the house model and the first to get that seat.

## Known limits

- **No live model in the prototype.** It replays the recorded agent run. The Anthropic backend is written but untested, and the Grok backend is a stub; both need an API key in the cloud environment.
- **Every Earth arrival is too fast.** The slowest is 15.34 km/s, against about 12.9 km/s for Stardust (2006), the fastest capsule entry so far. Landing isn't modelled.
- **The battery is absurd on purpose.** The cheapest Titan trip uses 148 full packs, and recharging isn't modelled.
- **Provenance proves where a number came from, not that the sentence is true.** A traced number in a wrong claim still passes.
- **Patched conics at the ends.** Routes start and end at a planet's centre with that planet's own gravity off; the Titan departure is drawn.
- **The Roadster's position is an extrapolation.** JPL's fit uses observations from 2018.

## What we're missing

Checked on Oct 16 against what is built, ranked by what matters most for the portfolio.

1. **The eval arena.** Delivery missions ("pizza to the Lunar Data Center, then Mars Base, before a deadline, on one battery"), scoring against a brute-forced best stop order, and a scoreboard. This is the part that makes SOL an agent-evals piece, and it isn't built yet.
2. **Multi-stop trips.** The planner books one leg at a time (plus the Titan pickup). Deliveries need chained legs, parking between stops, and one battery across the whole run.
3. **Grok has never run.** The plan is a Grok bot, not the xAI API: a player adds SOL as a custom connector in their own Grok on grok.com, and their bot (with its own skills) plays the missions, with no API key on either side. SOL still needs a small public MCP server for Grok to connect to, the same pattern as Wingbot (a free Cloudflare Worker); deploying it waits on Alvin's OK.
4. **No live model tested end to end.** Open Sky's Claude dispatcher was only tested with a stand-in; the Titan page replays a recorded run. Cost per ride is still unmeasured.
5. **The math audit is half done.** The checker precision bug is fixed. Still to do: compare routes with an independent astrodynamics library, hand-check the battery, fare and burn-time models, and have a separate agent try to break the numbers.
6. **Physics we skip.** Every Earth arrival is too fast to land, and landing, aerocapture, recharging and station plane changes aren't priced.
7. **Shipping.** No GitHub repo or CI yet, no launch video or write-up, and every page is private until shared.
8. **One look.** The Titan page and dispatch game use the light Terminal style; Open Sky is dark. The style card is still open.

## Next steps

- [ ] Alvin's change list: add items here or as comments, and they go into the prototype. First change: turn the site into a playable demo or game.
- [ ] Audit the math: compare every trip with an independent astrodynamics library and JPL's trajectory tools, hand-check the battery, fare and burn-time models, and have a separate agent try to break the numbers. Started: the checker's precision is fixed, and the Titan page and dispatch game are corrected.
- [ ] Day 7: a launch video (screen capture with captions, no face or voice) and a write-up on what the checker caught.
- [ ] Create a GitHub repo for `sol/` so the regression suite runs in CI on every push.
- [ ] Add an API key as an environment variable in the cloud environment, with a spend cap, to run live models.
- [ ] Wire the Grok backend and run it through the same eval as the Claude models.
- [ ] Open a Grok-only driver seat over MCP, so a visitor's own Grok agent can plan rides.
- [ ] Week 2: LOOP CHECK (parked).

## Files and how to rebuild

Everything lives in the project folder under `sol/` until there is a repo.

| Path | What |
| --- | --- |
| `code/quote.py`, `code/trip.py` | Planner: Earth to one target; Titan to Earth with a pickup leg |
| `code/refly.py`, `code/nbody.py` | The n-body checker |
| `code/provenance.py` | The provenance gate |
| `code/models.py` | Battery and fare models |
| `agents/` | Agent prompts and the team runner (replay, Anthropic, Grok stub) |
| `day3/run_regression.py` | Regression suite: `--plant 2` must go red |
| `day6/` | Per-model eval, checker stress sweep, scoring |
| `day5/template.html` | The prototype page source |
| `receipts/` | Recorded rides |

Rebuild the page: `day5/build_data.py`, then `day5/inject.py`, then publish `day5/stranded-at-titan.html`.
