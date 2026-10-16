# Testing the Starfare connector

**Latest run: checkpoints and `decide` (2026-10-16, branch `worktree-agent-a3e7a2c61cdef21c8`, Windows 11, Node, local `wrangler dev`; nothing deployed).** A dispatched ride now stops at a checkpoint when a flare grounds a launch or a pad is closed on arrival for longer than `ask_after_hours`, and the bot answers with the ninth tool, `decide`. Results:

- Build: `engine copied: 511448 bytes, sha256 17ecbd6fcb24e011…`.
- Engine: `node world/engine/test-hazards.js` 7 passed; `node world/engine/test-reroute.js` 8 passed (par with hindsight never needs more energy than par without it on 100 fixture hails; par fell on 6 of them).
- `node --test test/game.test.mjs`: **22 of 22** (was 17). New: the engine's pinned dust-storm ride at Mars Base through the connector (hold 45,505 kWh arriving 2029-02-12 00:44; divert to Phobos with 88.4 h on the ground 44,358 kWh, 22,054 of them on divert hops, arriving 00:47; the log's hindsight names the divert as best), `decide` idempotency and refusals, the Ceres Shift flare (wait 110,481 kWh; a replan asked for after 2028-01-10 22:57 counts as a plan, plans a 64,696 kWh leg leaving 2028-05-09 22:57, and with the defaults after it lands at 71,619 kWh; a leg the checker rejects is counted and leaves the checkpoint open; the plan cap), `ask_after_hours` validation and `"never"`, and runs stored before phases existed.
- `node test/e2e.mjs`: **31 of 31** (off 20 of 20, on 11 of 11). New off check: `dispatch` with `ask_after_hours: 0` over cars until a ride stops (this run: iss-crew with SF-02, checkpoint 1 `pad_closed` `pad_full` at the ISS 2028-04-18 23:34), then `get_hail` shows the same situation, `check_pad` starts from the checkpoint's time, each default answer is sent twice through `decide` (the second returns `already_decided`), and the arrived score matches `R.fly` + `R.score` in Node part by part (46, 76,513 kWh; hindsight best "divert to Tiangong, wait 0 h"). Every other scored dispatch passes `ask_after_hours: "never"`, which flies the defaults like `R.fly`.

**Earlier run: the hazard layer (2026-10-16, later the same day).** The engine (`sol/world/engine/sol-rides.js`) gained a simulated hazard layer: busy pads with hidden unscheduled traffic, solar flares, Mars dust, Titan haze, correction burns and busy cars, seeded per season, and a score taken from what actually happened (`R.fly`). The connector now seeds every engine call with the season number, adds `check_pad` and `space_weather`, and scores dispatches from `R.fly`. Results of that run, same sandbox and versions:

- Build: `engine copied: 493178 bytes, sha256 e8634d4297c3f306…`.
- `node --test test/game.test.mjs`: **17 of 17** (was 10). New: the season seed, fleet `busy_until`, the score from `R.fly` part by part on 18 dispatches, a clean 100 when nothing is in the way, the promise (late, kept, early, wrong), the busy-car rule in `plan_pickup` and `dispatch`, `check_pad` never showing unscheduled traffic, `space_weather` showing odds only, forecast input validation and the run log, determinism per season seed.
- `node test/e2e.mjs`: **30 of 30** (off 19 of 19, on 11 of 11), three full runs. `wrangler.jsonc` now ships `STARFARE_OAUTH` `"on"`, so the off phase starts `wrangler dev` with `--var STARFARE_OAUTH:off`. New off checks: the fleet's `busy_until`, a busy car's pickup, and the two forecast tools (equal to the engine's forecasts for the run's seed, booked berths only, bad input refused, free, listed in the dispatch log). Every scored run is compared with `R.fly` + `R.score` in Node on the same legs and seed, including the incidents.
- Dry run: `Total Upload: 4035.86 KiB / gzip: 974.47 KiB`, `env.STARFARE_OAUTH ("on")`.
- CPU (`node test/bench.mjs`, with the season seed): quick `take_hail` 5 to 35 ms, long haul 0.9 to 1.3 s, interplanetary legs 0.3 to 0.5 s, about the same as before.
- Example (off mode, season 8): iss-crew with the par car SF-01, rider ready 2031-07-18 00:00. The ISS pad was full (an unscheduled ship during the crew-change rush), so the car held in orbit 11.2 h (2,805 kWh). The dispatch quoted the ride leg's arrival, so it arrived 11.2 h after the promise: 82 (pickup 20, on time 20, energy 17.3, promise 0, checker 10, fare 10, economy 5); Node 82. SF-02 from the Lunar Data Center: 53. ceres-shift with SF-04: no incidents, 100. A busy car: SF-04 on iss-crew was busy until 2031-07-19 18:35, and its pickup left at 18:35 with the note. `check_pad` at the Lunar Data Center over 72 h hid 35 ship-hours of unscheduled traffic that `booked` never showed.

Note: the hazard seed is the season, so an e2e run that straddles a season reset (the last minute or so of a 7000 s season, every ~1.9 h) can fail its Node comparison; rerun it.

The sections below are from the earlier run (before the hazard layer), except the test listings in sections 2 and 4, which are from this run. The other numbers there (scores out of the old 25/25/25/10/10/5 split, kWh, timings, the 4,010 KiB bundle) are the earlier run's; the OAuth, transport, rate-limit and cache behaviour they describe is unchanged.

Everything here ran in the build sandbox on 2026-10-16, after the game changed from delivery missions to robotaxi ride hails: Node 22.22.0, wrangler 4.151.0 (local workerd), `@modelcontextprotocol/sdk` 1.32.1 client, `agents` 0.28.1, `zod` 4.6.7, and for OAuth mode `@cloudflare/workers-oauth-provider` 1.2.3. These are the versions Wingbot's connector pins. Nothing was deployed and no Cloudflare account was used. During `wrangler dev`, the sandbox proxy refused wrangler's own calls to workers.cloudflare.com (update check and telemetry); the Worker does not need them.

**Where it ran.** `npm install` inside `sol/connector/` on the shared mount fails twice over: the mount has no symlinks (`ENOSYS: function not implemented, symlink ... node_modules/.bin/parser`), and with `--no-bin-links` it cannot execute binaries (`spawnSync .../@esbuild/linux-x64/bin/esbuild EACCES`). So I copied `sol/connector` (without `node_modules`), `sol/world/engine/sol-page.js` and `sol/world/build.py` to a scratch directory on local disk, keeping the `sol/connector` + `sol/world` layout so `build.mjs` finds the engine, ran `npm install --no-audit --no-fund` there (14 s, 207 packages, registry reachable), and ran every command below from that copy. The changed files were copied back and `diff -r` (excluding `node_modules`, `.wrangler` and `src/engine`) shows no differences.

**Results move with the clock.** The sky clock runs 1 sky day per real second, so each run plans different dates, and the kWh, fares and CPU figures change from run to run. What must not change is that every check passes.

## 1. Build: copy the engine unchanged

```sh
node build.mjs
```

```
engine copied: 481160 bytes, sha256 faf1e946bb985bb4…, sky {"t0_ms":1792108800000,"jd0":2461329.5,"len_days":7000}
```

`src/engine/sol-page.cjs` is byte-identical to `sol/world/engine/sol-page.js`, which now carries the ride-hail module as `SOLE.R` (`build.mjs` refuses an engine without it). This is the engine after the coordinator's last change to `sol-rides.js` (`nearCars` lists the rider's neighbourhood first); every result below is from that engine, and an earlier full run on the previous bundle (480,973 bytes) also passed 27 of 27. `src/engine/meta.json` records the sha256 and `WORLD.sky` read from `sol/world/build.py`.

## 2. Game rules with a fake clock (plain Node)

```sh
node --test test/game.test.mjs
```

```
ok 1 - sky clock matches the page: 1 real second = 1 sky day, season resets
ok 2 - isoJD rounds to the minute exactly like the engine; jdOfIso reads it back and rejects bad dates
ok 3 - t0: quick hails 1 sky day ahead, long-haul hails LEAD days ahead; the hazard seed is the season number
ok 4 - get_hail: each car is free or busy_until the engine's fleetState; the rules explain the hazards and the promise
ok 5 - dispatch scores from what actually happened: R.fly on the same legs, then R.score with ctx.flown
ok 6 - with nothing in the way, the par car's plan with an exact quote scores 100
ok 7 - a far car scores lower than the par car
ok 8 - the quoted arrival is a promise scored against the actual arrival; a wrong fare loses the fare points
ok 9 - arriving late costs points on a sliding scale
ok 10 - busy cars: plan_pickup leaves no earlier than R.pickupStart + wait_days and says so; dispatch refuses an earlier pickup
ok 11 - check_pad shows booked (scheduled) berths only, never the hidden unscheduled traffic
ok 12 - space_weather shows flare odds only, never the actual storms
ok 13 - forecast tools validate input, are free (not plans) and are noted in the dispatch log
ok 14 - hazards are deterministic per season: the same season replays the same, the next season differs
ok 15 - long haul: the hail goes cold if the first interplanetary departure passes before dispatch
ok 16 - wrong legs are refused; validation failures are not counted; the plan cap holds
ok 17 - SEASON_END is the page's
# tests 17
# pass 17
# fail 0
```

## 3. CPU cost (plain Node)

```sh
node test/bench.mjs
```

`take_hail` is `R.terms` (par: every nearby car's pickup and ride for energy, and each one's pickup for time). `plan_pickup` and `plan_ride` are `R.planLeg` plus `refly` for one leg, tried for every car in the fleet; "nearby cars" are the ones `R.nearCars` counts for par.

```
engine load + ephemeris init: 74 ms (once per isolate, on first tool call)
┌─────────┬──────────────────┬─────────┬──────────────────────┬────────────────┬────────────────────┬────────────────────┬────────────────────────────┬──────────────────┬──────────────────────────┬────────────────────┐
│ (index) │ hail             │ kind    │ take_hail (terms) ms │ terms again ms │ plan_pickup max ms │ nearby cars max ms │ pickup planLeg / refly max │ plan_ride max ms │ ride planLeg / refly max │ cars with no route │
├─────────┼──────────────────┼─────────┼──────────────────────┼────────────────┼────────────────────┼────────────────────┼────────────────────────────┼──────────────────┼──────────────────────────┼────────────────────┤
│ 0       │ 'iss-crew'       │ 'quick' │ 15                   │ 1.9            │ 652.5              │ 1.1                │ '608.7 / 128.9'            │ 0.4              │ '0.4 / 0.0'              │ 0                  │
│ 1       │ 'phobos-commute' │ 'quick' │ 0.7                  │ 0.6            │ 490.3              │ 0.2                │ '417.8 / 99.2'             │ 0.5              │ '0.5 / 0.0'              │ 0                  │
│ 2       │ 'jovian-hop'     │ 'quick' │ 1.5                  │ 0.9            │ 535.9              │ 0.1                │ '347.8 / 301.6'            │ 0.3              │ '0.2 / 0.0'              │ 0                  │
│ 3       │ 'titan-home'     │ 'long'  │ 2043.9               │ 1598.9         │ 405.6              │ 294                │ '305.2 / 119.4'            │ 352.6            │ '242.2 / 112.3'          │ 0                  │
│ 4       │ 'ceres-shift'    │ 'long'  │ 1256.2               │ 1538           │ 495.5              │ 392.7              │ '404.0 / 172.3'            │ 390.8            │ '346.3 / 72.8'           │ 0                  │
└─────────┴──────────────────┴─────────┴──────────────────────┴────────────────┴────────────────────┴────────────────────┴────────────────────────────┴──────────────────┴──────────────────────────┴────────────────────┘
sky date now: JD 2463889.65 (2033-10-19 03:39), season end JD 2468328.5
```

Four earlier runs the same day gave 1.2 to 2.2 s for a long-haul `take_hail`, 400 to 700 ms for an interplanetary `plan_pickup` and 420 to 480 ms for a long-haul `plan_ride`, and 47 to 55 ms for the engine load. Quick hails cost under 20 ms for `take_hail` and under 1 ms per leg when the car is nearby (a local hop); sending a car from another planet costs 400 to 700 ms for its pickup. Conclusion: Workers Paid. See DEPLOY.md.

## 4. End to end over MCP against `wrangler dev`, OAuth off and on

```sh
node build.mjs && node test/e2e.mjs            # both modes (what npm test runs)
node test/e2e.mjs --mode=off                   # or: npm run e2e:off
node test/e2e.mjs --mode=on                    # or: npm run e2e:on
```

`test/e2e.mjs` was rewritten for the ride-hail tools; the harness is the same as before. It starts `wrangler dev` on a free port with a throwaway `--persist-to` directory and drives it with the MCP SDK client. Every scored run is cross-checked against the engine run directly in Node: same `rider_ready` time, same car, the same two legs through `computeLeg`, then `SOLE.R.terms` and `SOLE.R.score`, compared part by part.

**Off** (`--var STARFARE_OAUTH:off`; `wrangler.jsonc` now ships `"on"`). Streamable HTTP (and once SSE) with no auth. A second `wrangler dev` with `--var RATE_PER_MIN:5` checks the rate limit.

**On** (`--var STARFARE_OAUTH:on`, `RATE_PER_MIN` raised to 1000 so the test is not throttled). The SDK's own OAuth client (`OAuthClientProvider` plus `StreamableHTTPClientTransport`'s `authProvider`) connects with no token and does what grok.com did with Wingbot: it gets the 401, follows `resource_metadata` to both metadata documents, registers itself at `/register`, and builds the `/authorize` URL with PKCE S256 and `resource`. The test then opens that URL like a browser, checks the page has Allow and Deny and no code or password field, presses Allow, and hands the code back to the SDK (`finishAuth`), which exchanges it at `/token`. The reconnected client lists the tools and plays a scored hail. A hand-rolled client covers Deny and a wrong PKCE verifier, and a third `wrangler dev` with `RATE_PER_MIN:5` checks the limit over the OAuth endpoints.

Run of `npm test` (build, the Node tests, then `node test/e2e.mjs` in both modes), checks:

```
== STARFARE_OAUTH=off (default) ==
wrangler dev up at http://127.0.0.1:63032
PASS  tools/list is exactly the nine ride-hail tools
PASS  list_hails returns the engine's hails (SOLE.R.HAILS) and the fleet
PASS  iss-crew: take_hail, plan_pickup (par car), plan_ride, dispatch with the leg's fare and arrival; the result says what actually happened
PASS  iss-crew score matches SOLE.R.fly + SOLE.R.score run directly in Node on the same legs and season seed
PASS  after dispatch the run is locked; a second dispatch returns the same locked score
PASS  a ride that stops at checkpoints (ask_after_hours 0), answered with decide's defaults, lands where R.fly does in Node; get_hail shows the open checkpoint
PASS  iss-crew with a farther car (SF-02 from the Lunar Data Center) scores lower, and matches Node
PASS  a wrong quote (fare and an arrival years early) loses the fare 10 and the promise 15; a fare $5 off loses the fare 10; both match Node
PASS  get_hail fleet: every car is free or busy_until, as SOLE.R.fleetState says for the run's season seed
PASS  busy car: plan_pickup leaves no earlier than the car's busy_until and says so
PASS  check_pad and space_weather: free, the engine's forecasts for the run's seed, booked berths and odds only; bad input refused; noted in the dispatch log
PASS  bad leg ids are refused (plan_ride after_leg, dispatch) and refusals are not counted as plans
PASS  unknown or malformed run_id is rejected; unknown hail_id is refused
PASS  ceres-shift (long haul): take_hail, plan_pickup (par car), plan_ride re-flown PASS, dispatch, matches Node
PASS  re-fly cache: the same pickup parameters are served from the cache
PASS  one run per session: a new take_hail abandons the open run
PASS  SSE transport also works (list_hails, take_hail, get_hail)
PASS  GET /board and /board.json: best per hail with hail titles, labelled planned by Grok bot
PASS  off: no OAuth: /mcp needs no token, OAuth endpoints are 404, runs carry no player_id
PASS  per-IP rate limit answers 429 past RATE_PER_MIN
== STARFARE_OAUTH=on ==
wrangler dev up at http://127.0.0.1:63109
PASS  on: /, /board and /board.json stay public; /mcp without a token is 401
PASS  on: the 401 points at protected-resource metadata; authorization-server metadata has DCR, PKCE S256, scope play
PASS  on: SDK OAuth flow: 401, discovery, dynamic registration, PKCE S256, one-click Allow, token, then tools/list is the nine ride-hail tools
PASS  on: iss-crew over OAuth: take_hail, plan_pickup, plan_ride, dispatch; the run carries the grant's player id; the score matches Node
PASS  on: a second grant is a different anonymous player; run_id rules unchanged (any session can address a run by its id, unknown ids rejected)
PASS  on: /board shows the best run with its player tag
PASS  on: SSE transport with the access token works (list_hails)
PASS  on: a refreshed access token works and keeps the same player id
PASS  on: Deny redirects back with access_denied and the same state
PASS  on: a wrong PKCE verifier is refused at /token
PASS  on: the per-IP rate limit covers /mcp and the OAuth endpoints
off: 20 of 20 checks passed
on: 11 of 11 checks passed
31 of 31 checks passed
```

This is the checkpoint branch's run, once in full. The hazard-layer run before it was repeated three times, 30 of 30 each time. (The run before that also passed `--mode=off` and `--mode=on` on their own.)

Off-mode details of the earlier run, before the hazard layer (the full JSON is printed by the test; this run's example is at the top of this file):

- iss-crew with the par car SF-01 (rider ready 2033-11-18 00:00, arrive by 2033-11-27 00:00): pickup Orbital Depot to ISS 403 kWh, ride ISS to Lunar Data Center 37,578 kWh, $8,523.49, both local transfers. 100 of 100 (pickup 25, on time 25, energy 25, checker 10, quote 10, economy 5); Node 100, 37,981 kWh.
- iss-crew with SF-02 from the Lunar Data Center: 51 (pickup 0.2, on time 19.4, energy 6.4, 75,156 kWh); Node the same.
- Wrong quote (`$1`, `2020-01-01 00:00`) with the par car: 90, quote part 0, note "fare doesn't match $8,523, arrival doesn't match ...". Fare $5 off with the right arrival: 95.
- ceres-shift with the par car SF-04 (rider ready 2034-04-17 00:00, taken at sky 2033-11-19 13:26, arrive by 2038-01-23 00:00): Ceres to Ceres Port 337 kWh (local), Ceres Port to Mars Base 103,157 kWh, $478,596.59, re-fly PASS, miss 0 km. 100; Node 100.
- Refusals: `unknown leg_id leg999: pass the pickup leg this ride follows`, `leg2 is a ride leg; pass the pickup leg`, `unknown car sol-99. The fleet is in get_hail.`, `unknown pickup_leg forged`, `leg2 is not a pickup leg` + `leg1 is not a ride leg` (swapped), `unknown pickup_leg leg9` + `unknown ride_leg leg10` (ids from another run), `the ride leaves before the rider has boarded` (SF-01's ride dispatched with SF-02's later pickup). After all of them `plans_used` was 3, the three real plans. `unknown hail_id lunch-rush` (an old mission id) and `unknown hail_id constructor`; malformed `run_id` is refused by the input schema (`must match pattern /^run_[0-9a-f]{20}$/`).
- Cache: the repeated pickup (SF-01 from the Orbital Depot to Phobos, interplanetary) took 392 ms the first time, then came from the cache (18 ms).
- Board: `iss-crew` 100 (SF-01, pickup wait 0.8 h), `ceres-shift` 100, `runs_scored` 5; the HTML lists all five hail titles, "planned by Grok bot", the note about the in-page board, and "no connector runs yet" for the hails nobody played. Rate limit `[200, 200, 200, 200, 200, 429, 429]`.

```
--- tool call wall times through wrangler dev ---
list_hails                   48 ms
--- iss-crew par car
take_hail    iss-crew        34 ms
plan_pickup  sf-01          22 ms
plan_ride    leg1            18 ms
dispatch                     21 ms
dispatch                     18 ms
get_hail                     19 ms
--- iss-crew sf-02
take_hail    iss-crew        28 ms
plan_pickup  sf-02          19 ms
plan_ride    leg1            19 ms
...
--- ceres-shift par car
take_hail    ceres-shift     1765 ms
plan_pickup  sf-04          29 ms
plan_ride    leg1            532 ms
dispatch                     16 ms
take_hail    phobos-commute  25 ms
plan_pickup  sf-01          392 ms
```

(Trimmed; every other call in the run took 13 to 48 ms. Other runs: ceres-shift `take_hail` 1,677 to 2,221 ms, its `plan_ride` 464 to 590 ms.)

On-mode details of the same run:

```
 "sdk_requests": [
  "POST /mcp 401",
  "GET /.well-known/oauth-protected-resource/mcp 200",
  "GET /.well-known/oauth-authorization-server 200",
  "POST /register 201",
  "GET /.well-known/oauth-protected-resource/mcp 200",
  "GET /.well-known/oauth-authorization-server 200",
  "POST /token 200",
  "-- reconnect with the access token --",
  "POST /mcp 200",
  "POST /mcp 202",
  "GET /mcp 200",
  "POST /mcp 200",
  ...
 ],
 "play": { "run_id": "run_9a79daa4a323a12f4919", "player_id": "p_1dfb959f22ea9020", "car": "SF-01", "total": 100, "node_total": 100 },
 "second_player": "p_447e36b2d8ae69a1",
 "board_row": { "hail_id": "iss-crew", "title": "ISS crew change", "points": 100, "car": "SF-01", "wait_h": 0.8, "kwh": 37981, "par": 37981, "plans": 2, "player_tag": "1dfb95", ... },
 "rate": [ "/mcp 401", "/.well-known/oauth-authorization-server 200", "/register 400", "/mcp 401", "/token 400", "/authorize 429", "/mcp 429" ]
```

How to read the on-mode details: `sdk_requests` is every HTTP request the SDK client sent, in order, with the status. Discovery runs twice because the SDK re-reads the metadata before the token exchange. `play` is the scored run with its player id; `second_player` is the id the second grant got. In `rate`, the 400s are requests with no body (`/register`, `/token`) and the 401s are `/mcp` with no token; the sixth and seventh requests in the minute get 429. The `www_authenticate` header and protected-resource metadata are unchanged from the earlier version (`Bearer realm="OAuth", resource_metadata=".../.well-known/oauth-protected-resource/mcp"`, `resource_name` `Starfare`).

Also run, not part of the test file:

- The new `test/e2e.mjs` against `src/game.js` as it was before the two fixes below: 13 of 16 off-mode checks passed. The three failures were exactly those bugs.
- Not re-run for the ride-hail version: `--mode=on` with a KV namespace bound as `OAUTH_KV` (it passed 11 of 11 with the mission version; `oauth.js` changed only in one sentence of the consent page).

Bugs found and fixed in the connector while testing:

- `src/game.js`: `take_hail` with an id like `constructor` or `__proto__` was looked up on a plain object and found `Object.prototype`'s property, so it failed deep in the engine with a plain error ("no car can serve undefined") instead of "unknown hail_id"; the same for car ids (`constructor` counted as a plan) and leg ids (`after_leg: "constructor"` said "is a ride leg"). Lookups in `R.BY`, `R.CAR` and `run.legs` now use own keys only.
- `src/game.js`: `boarding_hours` was `0.05 * 24` = `1.2000000000000002`; now `1.2`.

Smaller changes: the board record field is `hail_id` instead of `mission_id` (`src/store.js`; the SQLite column keeps its name), and the consent page says "take ride hails, plan pickups and rides" instead of "start missions, plan legs" (`src/oauth.js`).

What the checks cover, in the order the brief asked:

- The tool list is exactly `dispatch`, `get_hail`, `list_hails`, `plan_pickup`, `plan_ride`, `take_hail`, with OAuth off and on.
- `list_hails` returns the ids, titles and places of `SOLE.R.HAILS` and the fleet of `SOLE.R.FLEET`.
- `take_hail(iss-crew)`, `plan_pickup` with the par car, `plan_ride` after it, `dispatch` with the ride leg's own `fare_usd` and `arrive`: 100, equal to `SOLE.R.score` on the same legs in Node, part by part. A farther car (SF-02) scores lower and also matches Node. A wrong quote loses the 10 quote points (90), a fare $5 off loses 5 (95).
- Bad leg ids are refused: `plan_ride` after an unknown leg or after a ride leg; `dispatch` with a forged leg, swapped legs, leg ids from another run, or a ride that leaves before the pickup it is dispatched with has arrived. None of these refusals counts as a plan.
- An unknown or malformed `run_id` and an unknown `hail_id` are refused.
- A long-haul hail (ceres-shift) plays end to end: rider ready about 150 sky days after `take_hail`, the interplanetary ride re-flown in the n-body checker (PASS), score equal to Node's.
- One run per session: a new `take_hail` abandons the open run (`plan_pickup` and `dispatch` on it say "abandoned").
- After `dispatch` the run is locked: a second `dispatch` returns the same score with `already_dispatched`, `plan_pickup` is refused.
- SSE works, with OAuth off and with an access token. `/board` and `/board.json` show the best run per hail with the hail titles, labelled "planned by Grok bot". The plan+re-fly cache serves a repeated leg. With the limit set to 5, the sixth and seventh requests in a minute from one IP get 429, with OAuth off and on.
- OAuth on: see the paragraph above. The run's `player_id` appears in `take_hail`, `get_hail`, `dispatch` and `/board`; a second grant gets a different id; a refreshed token keeps the id; a run can still be addressed by its `run_id` from another session.
- Not in the e2e test: a hail going cold (it needs the real clock to pass a departure; `test/game.test.mjs` checks it with a fake clock) and the 40-plan cap (also in `game.test.mjs`).

## 5. Bundle

```sh
node node_modules/wrangler/bin/wrangler.js deploy --dry-run --outdir /tmp/starfare-dry
```

```
Total Upload: 4010.27 KiB / gzip: 966.63 KiB
Binding                         Resource
env.MCP_OBJECT (StarfareMcp)         Durable Object
env.STARFARE_RUN (StarfareRun)            Durable Object
env.STARFARE_HUB (StarfareHub)            Durable Object
env.STARFARE_AUTH (StarfareAuth)          Durable Object
env.RATE_PER_MIN ("120")        Environment Variable
env.STARFARE_OAUTH ("off")           Environment Variable
--dry-run: exiting now.
```

## 6. The DEPLOY.md step 3 requests, against `wrangler dev`

```sh
URL=http://127.0.0.1:8787
curl -s $URL/
curl -si -X POST $URL/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
curl -s $URL/board | head -c 300
```

```
Starfare connector. Add http://127.0.0.1:8787/mcp as a custom connector at grok.com/connectors. Scores: http://127.0.0.1:8787/board
HTTP/1.1 200 OK
Content-Type: text/event-stream
mcp-session-id: e4a4980f16e24dcd826f9387946c978a49ab0ab9a29c32aa4556e1862e09502e

event: message
data: {"result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"starfare","version":"0.1.0"},"instructions":"Starfare is a concept robotaxi service for flying roadsters across the solar system. You are the dispatcher. ...
<!doctype html><html lang="en"><head><meta charset="utf-8"> ... <title>Starfare Dispatcher Board</title> ...
```

(Headers and the instructions text are trimmed here.) An unauthenticated `initialize` gets 200, so a client has no reason to start OAuth.

The same with OAuth on (`wrangler dev --var STARFARE_OAUTH:on`), the requests from DEPLOY.md "Turning OAuth on", step 3, were run against the mission version and are covered for this version by the on-mode e2e checks above (401 with `resource_metadata`, both metadata documents):

```sh
curl -si -X POST $URL/mcp | head -5
curl -s $URL/.well-known/oauth-protected-resource/mcp
curl -s $URL/.well-known/oauth-authorization-server | head -c 400
```

## Not tested

A Cloudflare deployment, the workers.dev hostname, real CPU limits on Cloudflare (all CPU numbers are Node or local-workerd timings), grok.com's connector form, Grok as an MCP client (with OAuth off or on), the `StarfareAuth` OAuth storage on Cloudflare rather than local workerd, how per-IP limits behave when every request comes from xAI's servers, and the in-page ride dispatcher (`sol/world/template.html` still has the mission dispatcher, so connector and page scores could not be compared on the page itself; the connector is compared with `SOLE.R` in Node).
