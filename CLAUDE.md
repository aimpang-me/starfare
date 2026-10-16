# Starfare: notes for Claude

Starfare (working title SOL) is Alvin Impang's portfolio project: a robotaxi game for flying cars across the solar system. Riders, the fleet, weather and traffic are simulated; planet positions are real (NASA JPL DE421).

## Layout
- `world/engine/`: the engine. `sol-engine.js` (planner, n-body re-fly checker), `sol-rides.js` (ride hails, hazards, scoring), `sol-missions.js` (older delivery game). `python3 world/bundle.py` bundles them into `engine/sol-page.js`.
- `world/template.html` -> `python3 world/build.py` -> `world/open-sky.html` (the Open Sky page, published as a claude.ai artifact).
- `connector/`: the Grok MCP connector, a Cloudflare Worker named `starfare`. `node build.mjs` copies the engine bundle into `src/engine/`. Docs: `DEPLOY.md`, `TEST.md`.
- `code/`, `day1`-`day6/`, `audit/`, `receipts/`: the original Python planner, checker, evals.

## Tests
- Engine hazards: `node world/engine/test-hazards.js` (7 checks).
- Connector: `cd connector && npm ci && node build.mjs && node --test test/game.test.mjs` (17) and `node test/e2e.mjs` (30, runs wrangler dev; fails in the last minute of a 7000-sky-day season, about 1.9 h real time, so rerun).

## Rules from Alvin
- Never deploy, delete a Worker, or change Cloudflare without Alvin's go in this session.
- No Tesla or SpaceX logos or claims of affiliation; no Grok/xAI logos ("Works with Grok" text only).
- Label everything simulated as simulated. Never invent numbers: every number a dispatcher says must come from a tool.
- Bring-your-own-agent features are Grok-first (Grok bots connect through the MCP connector at grok.com/connectors). Never say Starfare "needs an xAI key".
- Keep secrets out of the repo; use environment variables or Wrangler secrets.

## Open items (2026-10-16)
- Done: merged with the live connector (DO classes StarfareMcp/Run/Hub/Auth, STARFARE_OAUTH); MCP server named "starfare"; live Worker version 37989da3. Don't rename the DO classes again without a wrangler migration.
- See docs/HANDOFF.md for the game's vision, decisions and build order.
- Old Worker `sol-connector` still running; delete only when Alvin says.
- Later ideas: mid-ride events and rerouting, get_my_rides / run-log history, leaderboard by model + skills, daily seed, dispatch bidding, comfort max-g, charging stops, pooling.
