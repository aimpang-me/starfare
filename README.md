# Starfare

A concept robotaxi game: Starseeker ships across the solar system. Simulated riders hail rides; a dispatcher (you, Claude, or your own Grok bot over MCP) picks a Starseeker, plans the pickup and the ride on real planet positions (NASA JPL DE421), quotes a fare and an arrival time, and is scored on what actually happens through simulated, seeded hazards (busy pads, solar radiation storms, Mars dust, Titan haze, busy cars).

Not affiliated with any real company. Riders, fleet, weather and traffic are simulated.

- `world/`: the engine (`engine/sol-engine.js`, ride rules and hazards in `engine/sol-rides.js`, bundled by `bundle.py`) and the Open Sky page (`template.html`, built by `build.py` into `open-sky.html`). Tests: `node world/engine/test-hazards.js`.
- `connector/`: the Grok MCP connector, a Cloudflare Worker named `starfare`. See `connector/DEPLOY.md` and `connector/TEST.md`.
- `code/`, `day1`-`day6/`, `audit/`, `receipts/`: the original planner (Python), the n-body re-fly checker, evals and their results.

Internal names (`SOLE`, `sol-*.js`, `STARFARE_OAUTH`, `StarfareRun`) are from the project's working title, SOL.
