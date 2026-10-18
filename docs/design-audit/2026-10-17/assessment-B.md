# Assessment B: deterministic detector and browser evidence

Completed independently of Assessment A. No Assessment A output was read. Source baseline: origin/main 7839868 in this audit worktree. Browser evidence is the currently deployed public application, which differs from current source. No application source, external account, dispatch, booking, flight or deployment state was changed.

## Scope and reproducibility

- Initial broad `impeccable detect --json connector/src` completed, exit 2, raw output `evidence/detector-raw.json`. It also inspected a JS-generated method page, so it is superseded for this assessment by the explicitly scoped markup run below.
- Authoritative scan: `C:\Users\PC-AIMPANG\.agents\skills\impeccable\scripts\impeccable.cmd detect --json connector/src/site.html connector/src/flight.html connector/src/bench.html docs/design-audit/2026-10-17/evidence/board-live.html`.
- Board markup captured by a read-only GET of https://starfare.aimpang.workers.dev/board; its source generator is `connector/src/board.js`. This is deployed rendered markup, not generated from current main. The deployed board says scores out of 100; current source says 100000. Do not conflate them.
- Authoritative output: `evidence/detector-markup.json`, complete 111 findings, exit 2. Compact full-detail projection: `evidence/detector-summary.json`.
- All detector findings returned line **0**. These are not valid source line references. The manually verified source references below locate relevant selectors.

## Counts

| Rule | Count |
|---|---:|
| undersized-ui-text | 70 |
| low-contrast | 24 |
| tiny-text | 5 |
| dark-glow | 4 |
| overused-font | 2 |
| wide-tracking | 2 |
| cramped-padding | 1 |
| marquee | 1 |
| pulsing-dot | 1 |
| repeating-stripes-gradient | 1 |
| **Total** | **111** |

Severity totals: 100 warnings, 11 advisories. These are detector severities, **not** 100 confirmed user-facing accessibility defects.

| Markup file | Findings |
|---|---:|
| connector/src/site.html | 79 |
| connector/src/flight.html | 23 |
| connector/src/bench.html | 9 |
| evidence/board-live.html | 0 |

## Browser procedure and limitations

The native `mcp__playwright__browser_run_code_unsafe` was attempted first but failed with `Browser is already in use for ... mcp-chrome-534ef91, use --isolated`. No shared browser was killed or reused. The fallback script `evidence/detector-browser.cjs` launched a dedicated headless Chrome process through cached Playwright, created a fresh page, and stored it as `globalThis.starfareDetectorPage`. It inspected `/`, `/bench`, and `/board`, at 1440×1000 and 390×844. This is a viewport resize, **not touch-device emulation**.

Mutable injection preflight succeeded on all three pages: title set to `[Human] ...` and an inline script executed. Bundled live-server ran on localhost:8400, PID 78440; `/detect.js` injection was attempted on all three pages. Chrome blocked every injection: `Permission was denied for this request to access the loopback address space` (CORS/private network access). No detector script executed in the page, no reliable overlay exists, and no user-visible Human tab is left open. The screenshots named `*-overlay.png` are evidence of the failed attempt, **not successful overlays**. No bypass was applied.

Live-server was stopped with `impeccable.cmd live-server stop --keep-inject`; it reported `Stopped live server on port 8400`. The dedicated browser was closed in `finally`. No source file was injected.

Full browser console, extracted visible text, control sizes, status regions and viewport measurements are in `evidence/detector-browser.json`. The homepage also logged one unattributed resource 404; it is not classified as an application defect without the resource URL. No page runtime exceptions were captured.

## Evidence worth carrying into synthesis

### Legibility: high confidence

The source and rendered UI both contain functional 9–10.5px text. At desktop, the live flights/open bookings tabs and all map preset controls computed to 10.5px; Credits computed to 9.5px. Source anchors: `site.html:21` caps, `site.html:25` badges, `site.html:61` clock labels, `site.html:163` map labels, `site.html:361` table headers; `flight.html:26` caps, `flight.html:29` badges, `flight.html:216` table headers; `bench.html:56` small key labels.

The 111 findings should be consolidated into a typography/contrast workstream, not treated as separate design issues. Keep the Dark SOL technical character and increase supporting text to a legible 12–13px minimum where content-bearing, maintain readable line-height, and use fewer uppercase wide-tracked labels. This 12–13px recommendation is a design target; WCAG does not impose a universal minimum font size.

### Contrast: valid concern, automated ratios require validation

The detector repeatedly flagged `--ink-3`. Source uses `#66788f` for supporting text on both site and flight, and `#6e7783` on bench. Detector estimates include 4.4:1 for `#66788f` on `#050a14`, 4.1:1 on `#0a1322`, and 4.4:1 for bench `#6e7783` on `#06080c`. This is credible evidence of marginal supporting-text contrast, especially in small labels. Brighter supporting-text tokens can preserve the chosen dark palette.

Do **not** publish every static ratio as a verified WCAG failure: the source scan also reports black text on gray backgrounds, despite the rendered controls showing the expected light/cyan text. Translucent panels, gradients, CSS inheritance and canvas content make the static flattened backgrounds suspect. Validate exact computed text/background pairs or pixel composites before claiming a compliance count. The mobile screenshot visibly supports weak secondary-text legibility but is not a contrast-meter result.

### Responsiveness and input sizes: qualified evidence

All three visited routes measured 390px document scroll width at a 390px viewport: no body-level horizontal overflow in the tested default state. The mobile homepage becomes a long page (screenshot 390×3295), with the dispatcher feed near the bottom after map, fleet and tools. Preset chip rows are horizontally constrained inside the map. The screenshot is useful evidence for prioritizing a compact map and earlier access to feed/bookings.

Desktop controls measured 25px high for map presets, 28px for flight tabs and Filters/Layers, and 32px for Connect your agent. Do not label these as a confirmed mobile touch violation: `site.html:414-415` expands button/chip/tab/menu targets to 44px under `pointer:coarse`, and this browser run used a desktop pointer. The Credits link measured 32×11px. Do not apply WCAG target-size failures without checking spacing and applicable exceptions.

### Dispatcher feed: observable behavior and source-backed risks

The live feed was populated during this run: DESK engine-planned entries and SKY hazard/clear entries; no flight was in the air. It was visibly labelled Simulated. `site.html:529` sets the list to `aria-live="off"`; `site.html:1780-1785` prepends events and retains only 40. The feed's text is 11px and its scroll area 170px (`site.html:281-285`). There is no feed pause, filtering, source/freshness control or retained history link in the inspected markup. Propose controlled updates and an opt-in polite summary of new events, never a raw every-tick live announcement. Distinguish engine planning/system events from connected-agent flight decisions. Do not invent agent activity to fill an empty feed.

### Useful existing accessibility provisions

Visible focus style is declared in all three HTML files (`site.html:18`, `flight.html:24`, `bench.html:29`). Site and flight have reduced-motion CSS (`site.html:404`, `flight.html:240`) and JavaScript preference reads (`site.html:795`, `flight.html:457`). Loading statuses and selected content use explicit live regions. Therefore a blanket claim of missing focus, reduced-motion support or all live announcements would be inaccurate. This run did not verify a complete keyboard/screen-reader flow.

## False-positive and intended-design disposition

- `overused-font`: suppress as a redesign basis. Inter is explicitly chosen in docs/DESIGN.md.
- `dark-glow`, glass/translucency, cyan/warm accents, subtle stripes: evaluate local readability and hierarchy only; these belong to the chosen Dark SOL / Design F direction.
- `pulsing-dot` and marquee-style motion: review pause/reduced-motion behavior, not automatic removal. Existing reduced-motion handling means the raw detection is not proof that motion preferences are ignored.
- Board's zero detector findings does not establish good navigation, consistency, responsive table semantics, or alignment with the current product language. It is a limitation of detector coverage.

## Screenshots and artifacts

Representative images: `evidence/b-home-desktop.png`, `evidence/b-home-mobile.png`, `evidence/b-bench-desktop.png`, `evidence/b-bench-mobile.png`, `evidence/b-board-desktop.png`, `evidence/b-board-mobile.png`. Every page was captured after a 4-second initial load. Exact dynamic sky time and feed contents vary across captures.

Any proposed change to **connector/src/site.html** or **connector/src/flight.html** is a coordination item for after PR #13 (`codex/booking-replay`). None was implemented. Shared manifests, seasonal bookings, and replay semantics are explicitly not defects to fix concurrently in this audit.
