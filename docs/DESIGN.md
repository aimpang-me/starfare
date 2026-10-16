# Starfare design

## Open Sky's look ("Dark SOL", current)
Dark space UI over a live solar-system map: glass panels, thin hairlines, one sans typeface, warm sun/rider accents and a cool ride accent.
- Font: Inter 300-600 (Google Fonts), uppercase letter-spaced labels (`.caps`), tabular numbers (`.num`).
- Tokens (`world/template.html` `:root`):
  `--bg #06080c`, `--bg-2 #0b0e14`, `--glass rgba(18,22,30,.72)`, `--line rgba(255,255,255,.12)`, `--line-2 rgba(255,255,255,.22)`,
  `--ink #eef1f5`, `--ink-2 #a3abb6`, `--ink-3 #6e7783`, `--sun #ffb65c`, `--me #ffcf7a` (you), `--ride #9cc3ff` (rides), `--sim #7f8a99` (simulated),
  `--ok #86d9a8`, `--bad #ff8f80`, radius `--r 14px`, gutter `max(16px, safe-area)`.
- Layout: top nav (logo, Sky / Ride hails / Riders / Stations / How it works, season + sky date pill, online count); map full-bleed with zoom chips (System, You, Inner, Outer, Tilt); left "Ride request" desk with chat and suggestion pills; right "Choose your ride" / hail panel; sections below for hails, fleet, scoreboard, riders, stations, how a ride is checked.
- Car art: generic dark coupe SVG (`CAR` in the template). Not a real car.
- Tags: Real / Fictional / Simulated chips on every place, car and rider. Struck-through numbers with "[no tool made this]" are the provenance gate.
- Mobile: works at 360 px with no horizontal scroll.

## Alvin's reference mockups
`world/refs/` (same images as `mocks-grok/`): `mockup-ride-request.jpg` (map with ride request desk and "Choose your ride" cards), `mockup-choose-ride.jpg`, `mockup-receipt.jpg`. Open Sky's layout follows them. Do **not** copy: the SpaceX/Tesla wording and car, the made-up "~21 days Titan to Earth" times and prices (every number must come from the planner), the "sol.space" domain, or Careers/Log in.

## Alvin's portfolio design system ("Alvin Impang Terminal")
https://claude.ai/artifact/SehVRJjqmPB1CRkyzXKtGe: near-white terminal printout, Departure Mono only, graphite ink, square corners, box-drawing tables, 2px dither shadow, shell-command headings, single light theme. The font file is published there at `project/fonts/DepartureMono-Regular.woff2`. Departure Mono lacks the glyphs ✓ ✕ ▶ ●: put them in fixed 2ch spans with a fallback font. The Roadster teaser uses this system.

## Decision (2026-10-16)
Dark SOL for the game and the landing page. Alvin compared a mock of the landing page in each look and chose Dark SOL, so the whole site keeps Open Sky's style: the tokens and Inter above, glass panels, caps labels and Real / Fictional / Simulated chips. No Terminal variant or style toggle. Terminal stays the portfolio's system (the Roadster teaser).

## Rules
No Tesla/SpaceX/xAI logos or claims; "Works with Grok" as text only. Label everything simulated. Keep the honesty gate visible.
