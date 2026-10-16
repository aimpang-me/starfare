# Starfare web pages

Every page is a single self-contained HTML file built from a template plus baked data, then published as a **private claude.ai artifact** (only Alvin can open it until he shares it from the page's Share menu). There is no public website yet; see "Going public" below.

| Page | Live link | Source | Build | Status |
|---|---|---|---|---|
| **Open Sky** (the game: shared sky, free rides, ride hails, forecasts, scoreboard) | https://claude.ai/artifact/PDmHnbcrxCiMTAerA8JR2z | `world/template.html` + `world/engine/*` | `python3 world/bundle.py && python3 world/build.py` -> `world/open-sky.html` | Main page, version 8 |
| **Starfare website** (public landing page: what Starfare is, a live read-only sky map running the engine in the browser, the scoreboard, how to connect Grok, how a ride is checked) | not deployed yet; will be `https://starfare.aimpang.workers.dev/` | `connector/src/site.html`, served by `connector/src/index.js` with the engine at `/engine.js` | `cd connector && node build.mjs`, then `wrangler dev` (deploy only with Alvin's go) | Built on branch claude/mystifying-germain-497196; Dark SOL; not deployed |
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
Decided 2026-10-16: the `starfare` Worker serves the public website at `/` (`connector/src/site.html`), next to `/mcp`, `/board` and `/rides/<run_id>.json`. No login. It is read-only: the live sky map, the open hails, the simulated fleet, the board and how to connect Grok. Play happens through Grok and the connector, so the page needs no Claude dispatcher, shared db or presence. The claude.ai artifacts above stay private and are not linked from it until Alvin shares them. Built on branch claude/mystifying-germain-497196; not deployed (deploy only with Alvin's go, see `connector/DEPLOY.md`).
