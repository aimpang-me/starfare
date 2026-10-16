# Starfare web pages

Every page is a single self-contained HTML file built from a template plus baked data, then published as a **private claude.ai artifact** (only Alvin can open it until he shares it from the page's Share menu). The one public page is the Starfare website on the `starfare` Worker; see "Going public" below.

| Page | Live link | Source | Build | Status |
|---|---|---|---|---|
| **Open Sky** (the game: shared sky, free rides, ride hails, forecasts, scoreboard) | https://claude.ai/artifact/PDmHnbcrxCiMTAerA8JR2z | `world/template.html` + `world/engine/*` | `python3 world/bundle.py && python3 world/build.py` -> `world/open-sky.html` | Main page, version 8 |
| **Starfare website** (public landing page: what Starfare is, a live read-only sky map running the engine in the browser, the scoreboard, how to connect Grok, how a ride is checked) | https://starfare.aimpang.workers.dev/ | `connector/src/site.html`, served by `connector/src/index.js` with the engine at `/engine.js` | `cd connector && node build.mjs`, then `wrangler deploy` (only with Alvin's go) | Deployed 2026-10-16 (Worker version ba5fae0f, main 4362dc3, with the fast-orbit map fix); Dark SOL. On main, not deployed: rebuilt from mockup D (Sky desk) with live flights from `/live.json` (merge 1b85ad2) |
| **Bench watch page** (a Grok bot says "Play the Starfare bench.", calls `start_bench`, and this page shows each tool call, its input and result, calls used and the score, live; practice, simulated, not on the scoreboard) | https://starfare.aimpang.workers.dev/bench (how to start), `/bench/<bench_id>` (one session) | `connector/src/bench.html`, served by `connector/src/index.js`; sessions in the `StarfareBench` DO (`src/bench.js`, `src/bench-host.js`) | same as the website | Deployed 2026-10-16 (Worker version ba5fae0f); Dark SOL. Bench sessions refuse to start on the live Worker until main is deployed; suite v1 is re-cut for engine c5fdd816 on main (7917522) |
| **Flight page** (replay and receipt of one arrived ride: three.js replay, passenger list, debrief, timeline, raw log link) | `https://starfare.aimpang.workers.dev/flight/<run_id>` | `connector/src/flight.html`, served by `connector/src/index.js`; it fetches `/rides/<run_id>.json` | `cd connector && node build.mjs`, then `wrangler deploy` (only with Alvin's go) | Deployed 2026-10-16 (Worker version ba5fae0f); first production step of mockup D |
| **Stranded at Titan** (hero prototype: one rider, Titan to Earth, replayed receipts) | https://claude.ai/artifact/2yebB9MK7NtNvYq7GKd5gD | `day5/template.html` + `day5/sol_data.json` | `python3 day5/build_data.py && python3 day5/inject.py` -> `day5/stranded-at-titan.html` | Done (day 5); still says SOL |
| **Dispatch Desk** (SHIP/REJECT game over 106 real eval answers and 14 labelled mutants) | https://claude.ai/artifact/Y9BqECAnPLugQPhKqqb8N5 | `site/template.html` + `site/deck.json` | `python3 site/build_deck.py && python3 site/inject.py` -> `site/dispatch-desk.html` | Done; still says SOL |
| **Ride to the Roadster** (teaser: where the real Roadster is, one checked ride to it) | https://claude.ai/artifact/PEfGQmdSq597bv8QGWJsfn | `teaser/page-template.html` + `teaser/teaser.json` | `python3 teaser/teaser.py` (see `teaser/spike-report.md`) | Done (Oct 15); Terminal design |
| **Final spec** (Claude Doc, the design and plan) | https://claude.ai/code/artifact/33317ff6-abf3-461e-b47a-8fdcfdd98aa6 | lives in Claude Docs | edit in place | Has "The game: robotaxi dispatcher arena" and "Later ideas" |

## Idea explorations (not Starfare pages, kept for context)
- Orbital Idea Arena: https://claude.ai/artifact/CUEyieCHM9PujpAQE2NbDk (the orbital ideas Starfare was picked from).
- Consumer Idea Arena: https://claude.ai/artifact/J1bFrB99wSUtFps15jbim1.

## Publishing
- Publish with the Artifact tool, to the **same URL** so the link stays the same (pass the URL as `url` the first time a new session republishes). Open Sky declares runtime capabilities `sample` (the Claude dispatcher, run on the viewer's own account), `db` (scoreboard: `scores/<uid>`, rides), `room` (live presence) and `user`; omit `capabilities` on republish to keep them.
- If the Code tab session has no Artifact tool, push the change to `main` and ask the project thread to publish.
- Opened as a plain local file, Open Sky still works, but without Claude, the shared board or presence (it falls back to the manual planner).

## Going public
Decided 2026-10-16: the `starfare` Worker serves the public website at `/` (`connector/src/site.html`), next to `/mcp`, `/board` and `/rides/<run_id>.json`. No login. It is read-only: the live sky map, the open hails, the simulated fleet, the board and how to connect Grok. Play happens through Grok and the connector, so the page needs no Claude dispatcher, shared db or presence. The claude.ai artifacts above stay private and are not linked from it until Alvin shares them. Deployed 2026-10-16 at https://starfare.aimpang.workers.dev/ (Worker version 9b7a7f33, then 460862e8 from branch `bench` with the bench watch page, then ba5fae0f from main with the flight page and the map fix); redeploy only with Alvin's go, see `connector/DEPLOY.md`.

## Flight page (`/flight/<run_id>`)
Ports mockup D's replay and debrief (`design/mockups/d-hybrid.html` and `sky-core.js` at commit 105a967 on `claude/lucid-torvalds-69b6ae`, not merged here) into `connector/src/flight.html`, which is now the source to edit. The Worker embeds the flown legs and each leg's stored `arc_au` in the page (`window.FLIGHT`). The `/rides/<run_id>.json` download stays the exact `starfare.ride/1` record that `get_my_rides` returns. three.js r128 loads from cdnjs only on this page. A run is labelled Player run (it has a `player_tag`) or Connector run; nothing is shown as a sample. Seats and party size are labelled placeholders, with one booking per flight. A run id that has not arrived returns 404 with a short message. Legs planned before arcs were kept are planned again on their next use.

Still to do:
- Shared flights. The page was built before shared flights reached main: it shows the lead booking only and placeholder seats. A shared flight's record carries `bookings` and `passengers` (real seats) to show instead.
- Live traffic in the replay (other Starseekers in the sky at the same time).
- The home desk swap: put the flight view on the landing page in place of the current desk.
- Board links. `/board.json` rows carry only a 6-hex `run_tag`, not the full run id, and a full run id works as a capability. Linking the board to `/flight/<run_id>` needs a decision (a public flight id, or opt-in sharing) before the board can carry it.
