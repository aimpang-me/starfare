# Deploying the Starfare connector ("bring your own Grok bot")

This puts the `starfare` Worker on `https://starfare.<your-subdomain>.workers.dev` so a player can add it to Grok as a custom connector. Their Grok bot then works as Starfare's robotaxi dispatcher through nine MCP tools: simulated riders hail a ride, the bot picks a car from the simulated fleet, checks the forecasts for the simulated hazards, plans the pickup and the ride, quotes the rider a fare and promises an arrival, dispatches, and decides at the checkpoints where a hazard stops the ride. Starfare scores the dispatch with the engine's own ride-hail rules (`SOLE.R`). It is not the xAI API: nobody needs an xAI key, and Starfare never calls Grok. Grok calls Starfare.

Legend: **[verified]** means I ran it in the build sandbox against `wrangler dev` (local workerd) or plain Node. **[not verified]** means it needs a Cloudflare account or grok.com, neither of which the sandbox can reach. Nothing here has been deployed.

## The game

Five simulated riders (`SOLE.R.HAILS`), each a hail from a pickup place to a destination:

| hail_id | Title | From, to | Kind |
|---|---|---|---|
| `iss-crew` | ISS crew change | ISS to Lunar Data Center | quick |
| `phobos-commute` | Phobos commute | Phobos to Mars Base | quick |
| `jovian-hop` | Jovian hop | Io to Ganymede | quick |
| `titan-home` | Stranded at Titan | Titan to Earth | long haul |
| `ceres-shift` | Belt shift change | Ceres Port to Mars Base | long haul |

Seven simulated Starseekers (`SOLE.R.FLEET`, `sf-01` to `sf-07`) are parked at the Orbital Depot, the Lunar Data Center, Mars Base, Ceres, Europa, Callisto and Titan Dock. A quick hail's rider is ready 1 sky day after `take_hail`; a long-haul rider 150 sky days later (a booked ride). Boarding takes 1.2 hours.

Hazards (all simulated, from the engine's hazard layer, seeded by the sky season number so a season plays the same for every player): pads have a few berths and other traffic, a quarter of it unscheduled and never in the forecast, and a car that finds a full pad holds in orbit at 250 kWh an hour; solar flares hold any launch with a rider aboard (an empty car may fly through); Mars dust storms (Mars, Mars Base) and Titan haze (Titan, Titan Dock) close those pads; a leg between planets that leaves late needs a correction burn; a car may be busy on another job until its `busy_until`. The bot only sees forecasts (`check_pad`, `space_weather`); `SOLE.R.fly` decides what happened when it dispatches.

Score out of 100, computed by `SOLE.R.score` unchanged from what actually happened (`SOLE.R.fly`): fast pickup 20 (versus the quickest nearby car), arrived on time 20 (falls to 0 at half the trip's allowed time late), energy 20 (kWh actually flown, holds and correction burns included, versus par: the best nearby car flown through the same hazards), kept the promise 15 (actual arrival versus the quoted arrival: 0 at 6 h late on a quick hail or 1 day on a long haul, arriving early costs a quarter as much), every leg checked 10, honest fare 10 (within $1 of the ride leg's `fare_usd`), planning economy 5 (6 plans free, then a point each; forecasts are free). With nothing in the way, the par car with an exact quote scores 100 [verified].

## What it serves

| Path | What |
|---|---|
| `/mcp` | MCP server, Streamable HTTP and the older SSE transport on the same path (`McpAgent`, `transport: "auto"`, same pattern as Wingbot's `web/`). No auth by default (`STARFARE_OAUTH` `off`). Rate limited per IP. |
| `/.well-known/oauth-*`, `/register`, `/authorize`, `/token` | Only with `STARFARE_OAUTH` `on`: OAuth for `/mcp`, see "Turning OAuth on" below. With `off` they answer 404. |
| `/board` | Scoreboard page: best connector score per hail, with the hail titles, labelled "planned by Grok bot". `/board.json` is the same data. |
| `/` | Public landing page (`src/site.html`): what Starfare is, a live read-only sky map that runs the engine in the browser (real planet positions, the current hails, the simulated fleet), the scoreboard from `/board.json`, and how to add `/mcp` at grok.com/connectors. Public even with `STARFARE_OAUTH` `on`. |
| `/engine.js` | The engine bundle for the landing page, the same bytes as `src/engine/sol-page.cjs` (`node build.mjs` writes a gitignored copy, `src/engine/sol-page.txt`). Cached for a year at `?v=<first 16 hex of the engine sha256>`, which is the URL the page uses. |

Tools:

- `list_hails`: the hails (id, title, rider, pickup, destination, quick or long haul) and the fleet.
- `take_hail(hail_id)`: starts a run. Returns `run_id`, `rider_ready`, `arrive_by`, `season` (the hazard seed), the fleet (each car `busy_until` a time or `"free"`), `boarding_hours` and the rules. One run per bot: a new `take_hail` abandons the session's undispatched run, or flies a ride stopped at a checkpoint on to arrive with each checkpoint's default answer (scored, on the board, and its log notes the checkpoint it was left at). `previous_run` in the result says which.
- `get_hail(run_id)`: the same terms again, plus `sky_now`, `plans_used`, `dispatched`, `phase` (`planning`, `in_flight`, `arrived` or `abandoned`) and, in flight, the open checkpoint's `situation`.
- `check_pad(run_id, place, hours?, from?)`: forecast for a pad, by place id or name: berths, booked berths per hour (1 to 72 hours, default 24, from `rider_ready` or `from`, `YYYY-MM-DD HH:MM`; in flight, from the open checkpoint's time), and dust or haze odds for Mars, Mars Base, Titan and Titan Dock. Scheduled traffic only. Free.
- `space_weather(run_id, days?, from?)`: flare odds per sky day (1 to 60 days, default 10). Free.
- `plan_pickup(run_id, car, objective?, wait_days?)`: the ship's flight from where it is parked to the rider, leaving when the rider is ready or the ship is free, whichever is later (or `wait_days` after that; a `note` says if the car was busy). `objective` is `energy` (default) or `time`. Every leg between planets is re-flown in the n-body checker. Returns a leg with `leg_id`, `depart`, `arrive`, `battery_kwh`, `fare_usd`, `refly`.
- `plan_ride(run_id, after_leg, objective?, wait_days?)`: the rider's ride from the pickup to the destination, after that pickup leg and boarding. Same leg fields.
- `dispatch(run_id, pickup_leg, ride_leg, quoted_fare_usd, quoted_arrival, ask_after_hours?)`: checks the two legs and flies them through the season's hazards. When a flare grounds a launch or a pad is closed on arrival for longer than `ask_after_hours` (0 to 24, default 1, or `"never"`), the ride stops at a checkpoint and the result is `status: "checkpoint"` with a `situation` (what happened, where the car is, kWh so far, the options and the default). Otherwise the ride arrives: the score is locked and posted to the board, and the result says what happened: actual `pickup` and `arrive`, `promised_arrival`, `delay_hours`, `extra_kwh`, `divert_kwh`, `incidents` (kind, leg, place, at, hours, kWh, note), and a `log` of the run (hail, car, legs planned, forecasts called, checkpoints with what each option would have cost in hindsight, the segments flown, incidents, score parts) the bot can learn from. A second `dispatch` returns where the ride stands.
- `decide(run_id, checkpoint, action, hours?, place?, wait_hours?, depart_after?, objective?)`: answers the open checkpoint. A `launch_hold` takes `wait` or `replan` (a new leg from `depart_after`, re-flown in the checker; it counts as a plan). A `pad_closed` takes `hold` (with `hours` to be asked again, or until the pad opens) or `divert` to one of the situation's alternates, with `wait_hours` on the ground there. Returns the next checkpoint or the arrived score. Up to 8 checkpoints per ride; after that the defaults fly. The same answer sent again returns where the ride stands; a different answer to a decided checkpoint is refused.

## Read this first: auth, and what the rate limit really limits

**No auth (the default).** The Starfare tools expose no private data: hails, plans and scores are game data. A run is addressed by an unguessable `run_id` (`run_` plus 20 random hex characters), so nobody can dispatch somebody else's run without being given its id. Leg ids are only looked up inside their own run.

Why no OAuth by default: what is known now is that grok.com **does** accept a custom connector that uses OAuth (the Wingbot connector worked: Grok ran dynamic client registration, PKCE and the consent page, then called a tool). Whether it accepts one with **no** auth is still unknown. xAI's page (docs.x.ai/grok/connectors) says only "complete any required authentication", and third-party guides show optional OAuth fields, which suggests a URL-only connector is allowed. A server that answers an unauthenticated `initialize` with 200 never asks a well-behaved client to start OAuth. If grok.com refuses the no-auth server, that is the first thing step 5 will show, and the fix is one var: `STARFARE_OAUTH` `on` (section "Turning OAuth on"), which is built and tested locally.

**Rate limit:** each IP gets `RATE_PER_MIN` requests a minute on `/mcp` (default 120; fixed one-minute window; counted in the `StarfareHub` Durable Object's memory, so a restart resets it). When Grok calls the connector, the requests come from xAI's servers, not from the player. All Grok players may then share a few IPs and one budget. Watch `wrangler tail` for 429s after launch and raise `RATE_PER_MIN` if needed. A run also stops accepting plans after 40 `plan_pickup` and `plan_ride` calls, which bounds the CPU one run can spend.

**"Planned by Grok bot" is a label, not a check.** Any MCP client can call `/mcp`. The board says so.

## Cloudflare plan: Workers Paid ($5/month) is needed

Measured in Node on the copied engine (`npm run bench`, numbers in TEST.md) [verified]:

| Call | Quick hails | Long haul (titan-home, ceres-shift) |
|---|---|---|
| `take_hail` (hail terms: par over every nearby car) | 1 to 17 ms | 1.2 to 2.2 s |
| `plan_pickup` (`planLeg` + `refly`), car in the rider's neighbourhood | under 2 ms (a local hop) | 290 to 640 ms (except a car already beside the rider) |
| `plan_pickup`, car on another planet | 400 to 700 ms | 400 to 700 ms |
| `plan_ride` | under 1 ms | 350 to 480 ms |
| engine parse and init, once per isolate | about 50 to 75 ms | same |

Through `wrangler dev` (local workerd, so wall time including the MCP and Durable Object hops) quick-hail tools answered in 13 to 86 ms, ceres-shift's `take_hail` in 1.7 to 2.2 s and its `plan_ride` in 0.46 to 0.59 s, and an interplanetary pickup in 0.36 to 0.61 s.

The free plan allows 10 ms of CPU per request. Long-haul `take_hail` is 100 to 200 times over that, an interplanetary leg 40 to 70 times, and even a quick `take_hail` can go over it. The paid plan's default is 30 s per request, which is plenty. The free plan would at best play quick hails with nearby cars some of the time, so I did not try to make it fit. Durable Objects on the free plan need SQLite storage; this Worker uses SQLite-backed classes only, so the bindings work on either plan.

Caching: every leg (plan plus re-fly) is cached in `StarfareHub` keyed by `from|to|depart-after|objective|season-end`, and hail terms are cached by `hail|t0|season-end` (5,000 rows each, oldest dropped first). Be honest with yourself about the hit rate: the sky clock moves one sky day per real second, so `t0` changes every second and two players rarely ask for the same leg. The cache mainly helps a bot that re-plans the same leg, and players who take the same hail in the same second.

## Local development [verified]

On a normal disk. (In the build sandbox the shared project mount cannot hold `node_modules`: it has no symlinks and will not execute binaries, so `npm install` there fails on esbuild with EACCES. I ran everything from a copy of `sol/connector` plus `sol/world/engine/sol-page.js` and `sol/world/build.py` in a scratch directory on local disk, same layout. The npm scripts call wrangler by path, so they work either way.)

```sh
cd sol/connector
npm install --no-audit --no-fund
npm run build        # copies sol/world/engine/sol-page.js byte for byte to src/engine/sol-page.cjs; reads WORLD.sky from sol/world/build.py
npm run dev          # wrangler dev on http://localhost:8787, MCP at /mcp, board at /board
npm test             # Node game tests, then the end-to-end MCP test against wrangler dev, OAuth off and on (TEST.md)
npm run e2e:off      # only the OAuth-off end-to-end checks
npm run e2e:on       # only the OAuth-on end-to-end checks (SDK OAuth client, consent Allow, then a hail)
npm run bench        # CPU numbers
```

Re-run `npm run build` whenever `sol/world/engine/sol-page.js` (rebuilt by `sol/world/bundle.py`, which appends `sol-rides.js` as `SOLE.R`) or `sol/world/build.py` changes. `build.mjs` refuses an engine bundle without the ride-hail module. `src/engine/meta.json` records the engine's sha256 so you can see which engine a deployment carries. Nothing under `sol/world/` is edited.

| Name | Kind | Meaning |
|---|---|---|
| `RATE_PER_MIN` | var | Requests a minute per IP on `/mcp` (and, with OAuth on, on the OAuth endpoints too). Default `120`. |
| `STARFARE_OAUTH` | var | `off` (default): no auth. `on`: OAuth with a one-click consent page. Only `on` exactly turns it on. |

No secrets.

## Steps on your machine

Prerequisites: Node 22.22 or newer, a Cloudflare account on the **Workers Paid** plan, `npm install` done in `sol/connector`. Run every command from `sol/connector`.

### 1. Log in [not verified]

Alvin's desktop already has wrangler logged in to his Cloudflare account from the Wingbot deploy, so there `whoami` alone should be enough; run `login` only if `whoami` shows no account or the wrong one.

```sh
node node_modules/wrangler/bin/wrangler.js login
node node_modules/wrangler/bin/wrangler.js whoami
```

(On a normal disk, `npx wrangler ...` works too.)

### 2. Deploy to workers.dev [not verified]

```sh
npm run build
node node_modules/wrangler/bin/wrangler.js deploy
```

No databases or KV namespaces to create: all state is in Durable Objects (`StarfareMcp` per MCP session, `StarfareRun` per run, one `StarfareHub`, and one `StarfareAuth` that only OAuth mode uses), created by the `v1` and `v2` migrations on first deploy. The first deploy may ask you to register a workers.dev subdomain. It prints the URL, for example `https://starfare.aimpang.workers.dev`. Call it `$URL` below. `npm run dry-run` bundles cleanly [verified]: 4,036 KiB, 974 KiB gzipped, under the free plan's 3 MB gzipped limit and the paid plan's 10 MB.

### 3. Check the deployment from your terminal

These requests were run against `wrangler dev` [verified]; against workers.dev they are [not verified].

```sh
URL=https://starfare.<your-subdomain>.workers.dev
curl -s $URL/
curl -si -X POST $URL/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
curl -s $URL/board | head -20
```

Expected: the first prints the landing page's HTML (`<title>Starfare</title>`, the `/mcp` URL under "Works with Grok"); open `$URL/` in a browser to see the sky map move; the second returns `200` with an `event: message` body naming `serverInfo.name` `sol` and carrying the dispatcher instructions ("Starfare is a concept robotaxi service for flying roadsters ..."); the third is the board's HTML ("Starfare dispatcher board", one row per hail).

### 4. Play one run from your terminal (optional) [verified locally]

`node test/e2e.mjs` starts its own `wrangler dev`. To drive a deployed Worker instead, use any MCP client against `$URL/mcp`, for example the MCP Inspector (`npx @modelcontextprotocol/inspector`, Streamable HTTP, URL `$URL/mcp`, no auth) [not verified]: `list_hails`, `take_hail` with `iss-crew`, `plan_pickup` with `sf-01`, `plan_ride` after that leg, then `dispatch` with the two leg ids and the ride leg's `fare_usd` and `arrive`.

### 5. How a player adds it in Grok [not verified, cannot be done from the sandbox]

Following xAI's page (docs.x.ai/grok/connectors) and Wingbot's DEPLOY.md:

1. Open https://grok.com/connectors (in the app: Settings, then Connectors; some guides call the screen "Skills and Connectors").
2. Choose New Connector, then the **Custom** option.
3. Name: `Starfare`. Server URL: `$URL/mcp`. Use the same URL whether Grok wants Streamable HTTP or SSE; `/mcp` serves both. Leave any OAuth fields (client id, endpoints) empty.
4. Add the connector. Grok should list nine tools (`list_hails`, `take_hail`, `get_hail`, `check_pad`, `space_weather`, `plan_pickup`, `plan_ride`, `dispatch`, `decide`) without asking anyone to sign in.
5. Start a chat, turn the connector on, and ask, for example: "Take the Starfare hail iss-crew and get the best score." Others to try: "Use Starfare. List the hails, take phobos-commute, try the nearby cars for pickup, and dispatch the best one with an honest quote." and, for a long haul, "Take the Starfare hail ceres-shift, compare SF-03 and SF-04, and dispatch the better one before its departure passes." The player's own skills and instructions decide how the bot compares cars and objectives; that is the game.
6. Open `$URL/board`. The run shows up under the hail's title as "planned by Grok bot".

What to check: Grok lists the tools, calls `take_hail`, passes the pickup's `leg_id` as `after_leg` to `plan_ride`, copies the ride leg's `fare_usd` into `dispatch` with a promised arrival, and `dispatch` returns a score with what happened (incidents, actual arrival). Run `node node_modules/wrangler/bin/wrangler.js tail starfare` in another terminal to see what reached the Worker.

If it fails, the useful facts are where it stopped (URL rejected, an OAuth prompt appeared, tool list empty, a call failed, 429s) and the `wrangler tail` lines for that moment. Things I could not check and that may matter:

- Whether grok.com accepts a connector with no auth at all. If it insists on OAuth, see "Turning OAuth on".
- Which MCP transport Grok uses. Both are served on `/mcp` and both passed with the SDK client.
- Whether Grok keeps one MCP session for a whole chat. Nothing depends on it: every tool takes the `run_id`. The session only remembers its latest run so that a new `take_hail` can settle the old one.
- How long Grok takes per tool call. The sky clock runs 1 sky day per real second. If a pickup or ride flies between planets and its departure passes before `dispatch`, the hail goes cold and has to be taken again. A long-haul rider is ready 150 sky days (2.5 real minutes) after `take_hail`, which is time enough for a few plans. On a quick hail the rider is ready about one real second after `take_hail`, so a car sent from another planet often goes cold before a bot can dispatch it (its energy-best departure is often right at the ready time); the nearby cars fly local hops, which never go cold. A slow bot can use `wait_days` to plan a later departure.
- From which IPs grok.com calls, and so how the per-IP limit behaves (see above).

### 6. Afterwards

`node node_modules/wrangler/bin/wrangler.js delete` removes the Worker and its Durable Objects (and the board) when the demo is over.

## Turning OAuth on (fallback if grok.com refuses a no-auth connector)

**When:** only if step 5 fails because of auth: Grok rejects the URL, says the server needs authentication, or shows an empty tool list for the no-auth connector. If Grok lists the nine tools with OAuth off, leave it off.

**What changes with `STARFARE_OAUTH` `on`.** It is the same setup as Wingbot's `web/` (`@cloudflare/workers-oauth-provider` 1.2.3, Wingbot's version), so Grok sees the same flow it already completed with Wingbot:

- `/mcp` without a token answers 401 with `WWW-Authenticate: Bearer realm="OAuth", resource_metadata=".../.well-known/oauth-protected-resource/mcp"`. Grok follows that to the metadata, registers itself at `/register`, opens `/authorize` with PKCE, and exchanges the code at `/token`.
- The consent page ("Allow Grok to play Starfare?") has one Allow button and a Deny button. There is no owner code or login, because Starfare has no accounts and nothing private. Allow creates a new anonymous player id (`p_` plus 16 random hex characters) for that grant. Every grant gets a new one.
- Tools, `run_id` rules and scoring do not change. A run taken with OAuth on also carries the grant's `player_id` (in `take_hail`, `get_hail` and `dispatch` results), and the board row says "planned by Grok bot · player 1a2b3c" (the first six hex characters). Any session that has a `run_id` can still play that run, as with OAuth off.
- `/`, `/board` and `/board.json` stay public. The per-IP rate limit covers `/mcp` and the OAuth endpoints.
- Clients, grants and tokens are stored in the `StarfareAuth` Durable Object, so no KV namespace is needed. If you would rather do it Wingbot's way, create a KV namespace, bind it as `OAUTH_KV` in `wrangler.jsonc`, and the Worker uses it instead (tested locally with the local KV on the mission version, see TEST.md). Lifetimes are the provider's defaults: access tokens 1 hour, refresh tokens 30 days (after that Grok asks for one more click on Allow), registered clients 90 days.

What it does not protect: anyone can click Allow, so anyone can get a player id. It is a label, not an account, exactly like "planned by Grok bot". The rate limit bounds how fast grants can be made.

**Steps.** Run them from `sol/connector`. Alvin already has wrangler logged in to his Cloudflare account on his desktop from the Wingbot deploy, so step 1 above should not be needed there: run `node node_modules/wrangler/bin/wrangler.js whoami` to confirm it shows that account, and run `login` only if it does not [not verified].

1. In `wrangler.jsonc`, change `"STARFARE_OAUTH": "off"` to `"STARFARE_OAUTH": "on"` [verified locally: the e2e test runs `wrangler dev` with `--var STARFARE_OAUTH:on`, which overrides the same var].
2. Deploy: `npm run build`, then `node node_modules/wrangler/bin/wrangler.js deploy` [not verified]. The first deploy that includes this version adds the `StarfareAuth` class (migration `v2`). There are no secrets to set.
3. Check from your terminal [verified against `wrangler dev`; not verified against workers.dev]:

   ```sh
   curl -si -X POST $URL/mcp | head -5                       # 401 with resource_metadata=".../.well-known/oauth-protected-resource/mcp"
   curl -s $URL/.well-known/oauth-protected-resource/mcp      # {"resource":"$URL/mcp","authorization_servers":["$URL"],...,"resource_name":"Starfare"}
   curl -s $URL/.well-known/oauth-authorization-server        # authorize, token and registration endpoints, scopes_supported ["play"]
   ```

4. In Grok, remove the old Starfare connector if it is there, then add it again with the same URL, `$URL/mcp`, and leave the client id fields empty (Grok registers itself, as it did with Wingbot) [not verified]. Grok opens the Starfare consent page; press Allow. Then play as in step 5 above. On `/board` the run shows a player tag.
5. Watch `node node_modules/wrangler/bin/wrangler.js tail starfare` while connecting. You should see `POST /mcp 401`, the two `/.well-known` requests, `POST /register`, `GET /authorize`, `POST /authorize`, `POST /token`, then `POST /mcp` with 200s [verified against `wrangler dev` with the MCP SDK client; not verified with Grok].

**Turning it off again:** set `"STARFARE_OAUTH": "off"` and deploy [verified locally that `off` serves `/mcp` with no auth and answers 404 on every OAuth path]. Grok then no longer needs its token; whether it reconnects without one, or needs the connector added again, is [not verified].

## Scoring over MCP

`dispatch` first runs `SOLE.R.check` on the car and its two legs with the run's `t0` and season seed (the pickup must leave where the car is parked, no earlier than the car is free, and end at the rider; the ride must go from the rider to the destination and leave after boarding), and refuses legs the n-body checker failed. Then it applies the cold-hail rule (above), flies the legs with `SOLE.R.fly` (the run's seed), and calls `SOLE.R.score` unchanged with the run's own inputs: `t0`, `arrive_by_jd`, par kWh and the best possible pickup wait from `SOLE.R.terms` (same seed; the terms cache key includes it), the number of plans, the quote, and `flown`. Nothing is rescaled: every part of the score is checked over MCP, including the honest quote, so the connector's total is exactly the engine's. The e2e test checks it part by part against the engine run directly in Node.

The in-page dispatcher in `sol/world/template.html` still plays the old delivery missions, so connector and page boards cannot be compared on the page yet. Both boards are separate in any case: the page is a sandboxed artifact and cannot reach this server.

## What was verified locally, and how

All against `wrangler dev` with real workerd and the MCP SDK v1 client, no mocks, plus plain-Node tests (exact commands and output in TEST.md). `node test/e2e.mjs` runs both modes: OAuth off (20 checks: the nine ride tools, hails and fleet, iss-crew with the par car matching `SOLE.R.fly` + `SOLE.R.score` in Node including the incidents, a ride stopped at a checkpoint and answered with `decide` landing where `R.fly` does, a farther car scoring lower, a wrong quote losing the fare and promise points, the fleet's `busy_until`, a busy car's pickup, `check_pad` and `space_weather` (the engine's forecasts, booked berths and odds only, free, in the log), bad leg ids refused, bad run and hail ids, the long-haul ceres-shift end to end, the cache, one run per session, SSE, the board, no OAuth paths, the rate limit) and OAuth on (11 checks: the SDK's own OAuth client doing discovery, registration, PKCE, one-click Allow and token exchange, then a scored hail with a player id; Deny; a wrong PKCE verifier; refresh; SSE; the rate limit). Not covered anywhere: a Cloudflare deployment, the workers.dev hostname, real CPU limits on Cloudflare (the numbers above are Node timings), grok.com, the `StarfareAuth` storage on Cloudflare (only local workerd), and any MCP client other than the SDK.
