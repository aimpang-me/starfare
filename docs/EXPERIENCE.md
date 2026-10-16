# Starfare website: experience brief

Status: design draft, 2026-10-16. Nothing here is built into the Worker yet. The mockups live in `design/mockups/` and are published as private claude.ai artifacts for Alvin to compare.

## What the site is for

Today https://starfare.aimpang.workers.dev/ shows a static sky map, the scoreboard and a "connect Grok" box. Alvin's note: it is "just logic... a website that doesn't do anything." The new site should feel like the opening of a space game. You arrive and the solar system is already moving, Starseekers are in flight, and passengers are waiting. In one screen you understand three things: this is a robotaxi network across the solar system, your AI agent is the dispatcher, and every flight gets checked and scored.

The visitor watches the game. The agent plays it. The website never dispatches a flight itself. Grok (or another MCP agent) does that through the connector at `/mcp`. The site shows the sky, the open bookings, the scoreboard and each finished flight.

Look: Dark SOL (docs/DESIGN.md) pushed toward a cinematic, third-person, HUD-heavy space game ("Star Citizen, but not first person"). We keep the Dark SOL tokens, Inter, glass panels, caps labels and the Real / Fictional / Simulated chips. We add a camera that moves, thin HUD brackets, telemetry readouts and the Starseeker, an original short-hop passenger ship (no Tesla, SpaceX or Star Citizen shapes or names).

## Words

User-facing copy uses the player's words; the agent-facing API keeps its names, because Grok runs, old run logs and the tests depend on them.

| On the site | In tools and run-log JSON (unchanged) |
|---|---|
| Starseeker (plural Starseekers; "ship" as the generic word), call signs stay (SF-07) | `car`, `par_car` |
| flight | `ride`, `/rides/<run_id>.json`, `starfare.ride/1` |
| booking | hail, `take_hail`, `hail_id` |
| passengers | `rider` |

Example: "Flight SF-07 to Titan, 4 passengers". "Starseeker" is not trademark-searched yet. Names already taken and not to use: Starship, Starfarer, Starfinder, Cutter.

## Shared flights

A Starseeker carries several people. A booking can be a party, ships have seats, and one ship can pool several bookings into one flight with several stops; the dispatcher (the agent) decides who flies together. The site shows a cabin / seat count and a passenger manifest on bookings, Starseeker cards, the flight HUD and the receipt, and draws multi-stop routes on the map and in the replay.

None of that is in the game yet: seat counts, party sizes and pooling rules are open (docs/OPEN-QUESTIONS.md). Until they are set, pages show labelled placeholders ("Seats: not set yet", "Party size: not in the data yet") and never a made-up number. The sample flights are single-booking and say so. A pooled route may appear only as a labelled concept, either schematic or with each leg planned live by the engine.

## Labelling rules that every screen follows

- **Real**: planet and moon positions (JPL DE421 through the engine), body names and radii, the real stations (ISS, Tiangong), the Roadster's orbit.
- **Fictional**: the made-up places (Orbital Depot, Lunar Data Center, Mars Base, Ceres Port, Titan Dock), the Starseekers, the passengers.
- **Simulated**: bookings, fleet, weather, pad traffic, fares, every flight and score.
- Every number on a page comes from the engine, from a tool result, or from a stored run log. The mockups take theirs from `design/mockups/sample-data.js`, which `make-data.mjs` builds by flying real engine rides through `connector/src/game.js`. Those flights are flown by a "sample bot", not a player, and the pages label them that way.
- "Works with Grok" appears as text only. No Grok, xAI, Tesla or SpaceX logos.
- Model and skills a player declares are self-reported and shown as **unverified**.

## Flow

```
first visit ──> Onboarding sheet (over the live sky)
                 ├─ Connect Grok (grok.com/connectors, paste the MCP URL, OAuth)
                 ├─ Other MCP agents (same URL)
                 ├─ Declare model + skills (unverified)
                 └─ How a flight is scored and checked
                        │ "Watch the sky"
                        ▼
Live sky + Booking desk  (home, `/`)
   ├─ tap a booking ──> route preview on the map + "choose your Starseeker" cards
   │                    (what an agent would see: the fleet, pickup wait, seats, the engine's par plan)
   ├─ Scoreboard (top runs, by player tag; later by model)
   └─ tap a finished run ──> Flight page `/flight/<run_id>`
                               ├─ cinematic replay (camera follows the Starseeker along the planned arcs, stop by stop)
                               └─ receipt (manifest, legs, re-fly checks, checkpoints, incidents, score)
```

Returning visitors skip the sheet (one `localStorage` flag). It stays reachable from a "Connect your agent" button in the top bar.

## Screens

### 1. Onboarding (first visit)

A glass sheet over the moving sky, in four short steps a visitor can skip through:

1. **Connect your agent.** Grok first: open grok.com/connectors, add a custom connector with the URL `https://starfare.aimpang.workers.dev/mcp`, sign in through Starfare's OAuth page. A copy button for the URL. Then: "Any other MCP agent (Claude, ChatGPT, your own bot) uses the same URL." No key is needed from the player.
2. **Tell us who's flying.** Model (free text, e.g. "Grok 4") and skills (chips: planning, weather, pricing, a custom skill name). Marked "self-reported, unverified". Stored per player tag.
3. **What's real.** The three chips with one line each.
4. **How a flight is scored.** The seven parts out of 100 (pickup 20, on time 20, energy 20, promise 15, checker 10, fare 10, economy 5), the re-fly check ("the server re-flies every leg in an n-body sim; a miss fails it") and checkpoints ("mid-flight the sky can close a pad or hold a launch; your agent decides").

Data: none from the server beyond the origin. Static copy plus `SITE.sky` for the season.

### 2. Live sky + Booking desk (home)

A full-bleed sky. Real planet positions at the current sky time (one real second is one sky day; `jd = jd0 + (elapsed mod len_days)`), labels on planets and places, the fleet parked at its places, and the open bookings pulsing at their pickup points. HUD overlay: sky clock and season, a compass and zoom ladder, focus brackets around the selected body.

Docked panel, the **booking desk** (layout taken from the `world/refs/` "ride request" mockup, not its wording):

- One row per open booking: passenger, party size (placeholder until set), from → to, ready, arrive-by, kind (quick / long haul).
- Selecting a booking draws the route on the map (the engine's par plan for that booking from `R.planLeg` in the browser) and opens **choose your Starseeker** cards: each fleet Starseeker with its parking place, how long until it frees up, seats (placeholder until set), and the par plan's departure, arrival, energy and fare. These are the engine's numbers, labelled "par plan, simulated". The desk ends with "Ask your agent to take this booking" (the tool call is still `take_hail`) and the connect link, because only an agent can dispatch.
- Scoreboard tab: the top runs from `/board.json`.

Data today: `SITE.hails`, `SITE.fleet`, `SITE.sky`, `SITE.look` (all injected by index.js), the engine at `/engine.js` for positions and par plans, `/board.json` for the board.

### 3. Flight page (`/flight/<run_id>`)

A cinematic replay of one finished flight, then its receipt.

- **Replay.** The camera follows the Starseeker along the leg arcs (heliocentric AU, 49 points per leg) from pickup through each stop to the last drop-off. Sky time runs fast and the planets move with it. Events from the log appear on the timeline and as HUD callouts at their time: checkpoints ("Launch hold: solar flare at Titan. Agent chose: wait"), incidents (pad busy, correction burn), and later boarding / drop-off at each stop. Controls: play / pause, scrub, speed, camera (chase / overhead).
- **Receipt.** Header: passengers, from → to, Starseeker, simulated chip, season, total /100. Manifest: bookings on board and their stops (one booking until pooling exists). Legs table: depart, arrive, energy, fare, re-fly result (PASS with miss km, or "local hop"). Checkpoints with the agent's decision and the hindsight options (which one was best). Incidents. Score parts with each part's note. Promise vs actual arrival. A link to the raw `/rides/<run_id>.json`.

Data: `/rides/<run_id>.json` (`rideRecord()`: score parts and notes, the log with planned / flown legs, forecasts, checkpoints with `options_hindsight` and `best`, incidents). The arcs are not in the record yet (see backend additions).

## Backend additions each screen would need

| Screen | Addition | Why |
|---|---|---|
| Flight page | An HTML route `GET /flight/<run_id>` that serves a page shell reading `/rides/<run_id>.json` | Today only the JSON exists. |
| Flight page | Store each dispatched leg's `arc_au` (49 points, about 2 KB) in the run, or have the page recompute it with `R.planLeg(from, to, dep, obj, end)` | The replay needs the path. Recomputing in the browser costs nothing on the server but must match the stored plan; storing is safer. |
| Flight page | Mark the record "sample" vs "player" | So the page never passes a sample off as a real run. |
| Live sky | A public `GET /live.json`: in-flight runs with car (the Starseeker's call sign), from, to, dep_jd, arr_jd (and arc or enough to recompute it), no player identity unless the player opted in | Today the public site cannot see Starseekers in flight. Until then the mockups show sample traffic, labelled. |
| Live sky | Bookings with their current status (open / taken by a run) | The desk can show "taken" instead of only the static list. |
| Shared flights | Seats per Starseeker, party size per booking, and a pooled run (several bookings, several stops) in the game and the run log | The manifest, seat counts and multi-stop replay need them. Rules are an open question. |
| Onboarding | Model + skills declaration per player: a `declare_agent` MCP tool or a field on the OAuth consent page, stored with the player tag; shown as unverified | The board can group by model later. |
| Scoreboard | `/board.json` entries carry model + skills and the run id | Board rows link to flight pages; leaderboard by model. |
| All | Keep the engine at `/engine.js` cacheable (it is 511 KB) | Every screen draws real positions in the browser. |

None of this is built. Each item is a separate change for the connector, after Alvin picks a direction.

## Mockups

All three use the same data (real engine positions at sky time, `sample-data.js` for the sample flights) and cover the same three screens, so the comparison is about look and feel.

- **A. Chase Cam** (`design/mockups/a-chase-cam.html`, private artifact https://claude.ai/artifact/TinNjMMVug8wFPFPCDuhQo): three.js, a third-person camera behind the Starseeker, cinematic.
- **B. Tactical** (`design/mockups/b-tactical.html`, https://claude.ai/artifact/VBw5awXwQH75R567uqNfb6): a stylised 2.5D canvas HUD, the current Dark SOL map grown into a tactical display.
- **C. Flight Log** (`design/mockups/c-flight-log.html`, https://claude.ai/artifact/FpCoed9Qo8HuTQ3oW34u44): a scroll-driven cinematic story; each section is a camera shot.

**Direction chosen (Alvin, 2026-10-16): the hybrid.** B's tactical home, booking desk and intro, with A's chase-cam replay and debrief on the flight page, in one look. Mockup D (`design/mockups/d-hybrid.html`, https://claude.ai/artifact/XE9yeuEqYvknsXSbqZpPFh) shows it and is the reference for the build. D also carries C's passenger list (Alvin, 2026-10-16), following docs/SHARED-FLIGHTS.md:
- **Flight page:** the list sits beside the replay and follows it stop by stop. It shows who boards and who gets off at each stop, seats in use out of seats on the ship, and each booking as a party.
- **Debrief:** each booking gets a row (pickup, on time, kept promise, fare), next to the ship's parts (energy vs par, every leg checked, planning economy).
- **Placeholders:** seats per Starseeker, party size and bookings per flight are chipped "Simulated · placeholder, not set yet" until Alvin sets them: 4 seats, parties of 1 to 3, up to 3 bookings.

**Ops console studies (Alvin's reference, `design/refs/ops-console-reference.webp`).** Two mockups take the reference's command-console layout and keep every part truthful:
- **Layout:**
  - Left: flights in the air, as labelled samples, since `/live.json` isn't built.
  - Centre: the map.
  - Right: the Starseeker fleet from the engine.
- **Quick actions:** "Your agent's tools" (real MCP tool names with an "ask your agent" prompt), because the site never dispatches.
- **Other panels:** system alerts from the engine's simulated hazards, and a sample dispatcher feed.
- **Dropped from the reference:** stardate, crew and supply bars, and invented places.

The two mockups:
- **E. Ops, schematic** (`design/mockups/e-ops-schematic.html`, https://claude.ai/artifact/YLWmuFAQFRtLgzt7ZKhjKd): a 2D network map. Bearings come from real positions; distances are not to scale.
- **F. Ops, 3D** (`design/mockups/f-ops-3d.html`, https://claude.ai/artifact/HrsA3dazbDh3eL12sHG8rQ): a three.js solar system at real positions with log-compressed distances.

Each artifact is published with `engine.js` (a copy of `world/engine/sol-page.js`), `sample-data.js` and `sky-core.js` next to it.

Run locally: open the HTML files from `design/mockups/` (they load the engine from `../../world/engine/sol-page.js` when `engine.js` is not next to them). Rebuild the sample flights with `node design/mockups/make-data.mjs` after `node connector/build.mjs`.
