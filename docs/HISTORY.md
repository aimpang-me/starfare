# How Starfare got here

A timeline for a new session, so nothing has to be rediscovered. Dates are 2026. Day reports live in `day1/`-`day6/RESULT.md`, the math audit in `audit/`.

## Origin: the space idea arena (Oct 15)
Alvin (SDET / AI-quality engineer, job-hunting) ran an arena of about 60 space portfolio ideas scored by three AI judges. The pitch that became Starfare was "ROBOTAXI: SOL": request a ride anywhere in the solar system in plain English; an agent mission-control team plans it with a Lambert solver over JPL ephemerides; a separate verifier rejects any plan whose numbers it can't reproduce. The judges ranked LOOP CHECK first; Alvin overrode them and built SOL first, timed to the Tesla Roadster reveal of Oct 15. The week plan is `docs/history/sol-plan.md`.

## The one-week build (Oct 15-16)
- **Day 0**: teaser "Ride to the Roadster" (`teaser/`): real Roadster position, 30,298 Lambert solves, n-body checker retargets every ride under 1 km.
- **Day 1**: agents beat a one-call parser on 8 of 20 absurd requests (bar was 3), every number traced. Alvin skipped the per-ride dollar check (no API key in the sandbox; don't ask again).
- **Day 2**: planner core, 13 quotes re-flown. JPL's Small-Body Mission Design API showed 0-rev Lambert missed Bennu's 1-rev routes, so the planner searches 0-1 revs. Moon has its own geocentric solver.
- **Day 3**: checker as a gate. Regression goldens, a provenance check that strikes untraced numbers, 20/20 pass, a planted fake number turns it red.
- **Day 4**: two-leg trips (pickup + ride), stated battery and fare models, the dispatcher/engineer/broker agent team (replay backend), receipts.
- **Day 5**: hero demo "Stranded at Titan" (Alvin's pick), a phone-sized page.
- **Day 6**: per-model eval (Opus/Fable 15 rides, Sonnet 13, Haiku 6), checker sweep, rejected wall. Final spec written (`docs/SPEC.md`). Day 7 (video, write-up) waits on Alvin.
- **Audit**: integrator tolerance tightened 1e-10 -> 1e-12 (the old setting left 16-37 km of noise on 17-23 year legs). Uranus now passes; the only real rejection left is a Roadster 1-lap route.

## Web pages (Oct 16)
- Alvin picked a game over a combo site: "SOL Dispatch Desk" (you play the gate, SHIP or HOLD real tickets).
- Then "Open Sky", a shared world: visitors spawn around the system, call rides through Claude, see other riders. Real stations (ISS, Tiangong) plus fictional ones (Orbital Depot, Lunar Data Center, Mars Base). It must open on the whole-system view.
- Next came delivery missions with a brute-forced par. Alvin then dropped deliveries: the game is ride hailing for flying cars.

## Grok and the connector (Oct 16)
- Correction from Alvin: it's a Grok **bot**, not the xAI API. Players add the game as a custom connector in their own Grok on grok.com. No xAI key anywhere.
- The connector is a Cloudflare Worker (Durable Objects, OAuth), following the Wingbot pattern. Grok played and scored 100 every time, so the game was too easy.

## Making it hard (Oct 16)
The seeded hazard layer: busy pads with hidden NPC traffic, radiation storms that hold launches, Mars dust and Titan haze, correction burns for late departures, busy cars, a promise score. A naive bot fell to about 92-98 on quick hails. Then a bug fix in Open Sky: clicking suggestion pills mixed stale history and the sky date, so the agent struck its own numbers.

## Name, repo and the move to the PC (Oct 16)
- Zip handoffs were painful, so the code moved to this GitHub repo and Alvin's desktop Claude Code (Documents\starfare).
- Name picked: **Starfare**, "a fare between the stars, scored on fares". Avoid "Roadster" in names.
- A desktop session briefly made a duplicate repo (aimpang/starfare) and Worker. The two were merged here (commit eb3caae), and the live Worker `starfare` runs the merge.
- Since then: mid-ride rerouting and `get_my_rides` (desktop session, commit 80610df notes).
