# Starfare: notes for Claude

Starfare (working title SOL) is Alvin Impang's portfolio project: a robotaxi game for Starseeker ships across the solar system. Riders, the fleet, weather and traffic are simulated; planet positions are real (NASA JPL DE421).

Read first: `docs/HANDOFF.md` (state, decisions, next steps), `docs/OPEN-QUESTIONS.md`, `docs/WEBSITES.md`, `docs/DESIGN.md`, `docs/HISTORY.md`, `docs/SPEC.md`.

## Layout
- `world/engine/`: the engine. `sol-engine.js` (planner, n-body re-fly checker), `sol-rides.js` (ride hails, hazards, scoring), `sol-missions.js` (older delivery game). `python3 world/bundle.py` bundles them into `engine/sol-page.js`.
- `world/template.html` -> `python3 world/build.py` -> `world/open-sky.html` (the Open Sky page, published as a claude.ai artifact).
- `connector/`: the Grok MCP connector, a Cloudflare Worker named `starfare`. `node build.mjs` copies the engine bundle into `src/engine/`. `GET /` is the public website (`src/site.html`): a live read-only sky map running the engine in the browser (served at `/engine.js`), the scoreboard and how to connect Grok. Docs: `DEPLOY.md`, `TEST.md`.
- `day5/` (Stranded at Titan page), `site/` (Dispatch Desk page), `teaser/` (Ride to the Roadster page).
- `code/`, `day1`-`day6/`, `audit/`, `receipts/`: the original Python planner, checker, evals.

## Tests
- Engine hazards: `node world/engine/test-hazards.js` (8 checks).
- Engine checkpoints: `node world/engine/test-reroute.js` (8 checks, about a minute; one replays 100 fixture hails). `node world/engine/find-reroute-cases.js` finds the dust-storm rides it pins.
- Connector: `cd connector && npm ci && node build.mjs && node --test test/*.test.mjs` (69) and `node test/e2e.mjs` (41, runs wrangler dev; take_hail refuses long hauls for about the last 7 real minutes of a 7000-sky-day season (about 1.9 h real time), so e2e can fail then; rerun).

## Rules from Alvin
- Never deploy, delete a Worker, or change Cloudflare without Alvin's go in this session.
- No Tesla or SpaceX logos or claims of affiliation; no Grok/xAI logos ("Works with Grok" text only).
- Label everything simulated as simulated. Never invent numbers: every number a dispatcher says must come from a tool.
- Bring-your-own-agent features are Grok-first (Grok bots connect through the MCP connector at grok.com/connectors). Never say Starfare "needs an xAI key".
- Keep secrets out of the repo; use environment variables or Wrangler secrets.

## Open items (2026-10-16)
- Done: merged with the live connector (DO classes StarfareMcp/Run/Hub/Auth, STARFARE_OAUTH); MCP server named "starfare"; live Worker version ba5fae0f (main 4362dc3; the StarfareBench DO came in migration v3 with 460862e8). Engine bundle c5fdd816 (small bodies planned on the n-body table); suite v1 re-cut for it on main (dev 18, test 18). Live bench sessions refuse to start until main is deployed. Don't rename the DO classes again without a wrangler migration.
- See docs/HANDOFF.md (vision, decisions, build order), docs/WEBSITES.md (every page, link, build, publish) and docs/DESIGN.md (look, tokens, mockups) and docs/OPEN-QUESTIONS.md (decisions waiting on Alvin; ask him and record answers).
- Old Worker `sol-connector` still running; delete only when Alvin says.
- Done and deployed: mid-ride checkpoints (launch_hold, pad_closed) with the `decide` tool, on the connector and the Open Sky page; get_my_rides with ride history and run logs.
- Done and deployed: the public website at https://starfare.aimpang.workers.dev/ (`connector/src/site.html`, Dark SOL).
- Done and deployed (Worker ff7f8356, main 4537087): the website rebuilt from Design F (`design/mockups/f-ops-3d.html`): three.js map with textured planets served from `connector/public/assets`, live flights from `/live.json`, no Roadster, non-overlapping labels; the flight page plays runs in real time. Follow-ups in `NEXT-STEPS.md`.
- Later ideas: leaderboard by model + skills, daily seed, dispatch bidding, comfort max-g, charging stops, pooling.
