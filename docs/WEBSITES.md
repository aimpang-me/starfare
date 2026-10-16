# Starfare web pages

Every page is a single self-contained HTML file built from a template plus baked data, then published as a **private claude.ai artifact** (only Alvin can open it until he shares it from the page's Share menu). There is no public website yet; see "Going public" below.

| Page | Live link | Source | Build | Status |
|---|---|---|---|---|
| **Open Sky** (the game: shared sky, free rides, ride hails, forecasts, scoreboard) | https://claude.ai/artifact/PDmHnbcrxCiMTAerA8JR2z | `world/template.html` + `world/engine/*` | `python3 world/bundle.py && python3 world/build.py` -> `world/open-sky.html` | Main page, version 7 (Starfare name, hazards, pill fix) |
| **Stranded at Titan** (hero prototype: one rider, Titan to Earth, replayed receipts) | https://claude.ai/artifact/2yebB9MK7NtNvYq7GKd5gD | `day5/template.html` + `day5/sol_data.json` | `python3 day5/build_data.py && python3 day5/inject.py` -> `day5/stranded-at-titan.html` | Done (day 5); still says SOL |
| **Dispatch Desk** (SHIP/REJECT game over 106 real eval answers and 14 labelled mutants) | https://claude.ai/artifact/Y9BqECAnPLugQPhKqqb8N5 | `site/template.html` + `site/deck.json` | `python3 site/build_deck.py && python3 site/inject.py` -> `site/dispatch-desk.html` | Done; still says SOL |
| **Ride to the Roadster** (teaser: where the real Roadster is, one checked ride to it) | https://claude.ai/artifact/PEfGQmdSq597bv8QGWJsfn | `teaser/page-template.html` + `teaser/teaser.json` | `python3 teaser/teaser.py` (see `teaser/spike-report.md`) | Done (Oct 15); Terminal design |
| **Final spec** (Claude Doc, the design and plan) | https://claude.ai/code/artifact/33317ff6-abf3-461e-b47a-8fdcfdd98aa6 | lives in Claude Docs | edit in place | Has "The game: robotaxi dispatcher arena" and "Later ideas" |

## Publishing
- Publish with the Artifact tool, to the **same URL** so the link stays the same (pass the URL as `url` the first time a new session republishes). Open Sky declares runtime capabilities `sample` (the Claude dispatcher, run on the viewer's own account), `db` (scoreboard: `scores/<uid>`, rides), `room` (live presence) and `user`; omit `capabilities` on republish to keep them.
- If the Code tab session has no Artifact tool, push the change to `main` and ask the project thread to publish.
- Opened as a plain local file, Open Sky still works, but without Claude, the shared board or presence (it falls back to the manual planner).

## Going public (not done yet)
The claude.ai artifacts are private. For a public site, options are: share the artifacts from their Share menu, or serve `open-sky.html` from Cloudflare (the `starfare` Worker could serve it at `/`, or a Pages project). Outside claude.ai the page loses the Claude dispatcher and the shared board, so a public version needs its own backend for those (the connector Worker already has a board at `/board`). Decide with Alvin before doing this.
