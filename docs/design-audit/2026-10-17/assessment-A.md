# Assessment A — independent design review

Date: 2026-10-17 (America/Toronto). Reviewer: visual_review subagent. This assessment was completed independently without reading Assessment B or the parent's technical-check files.

## Scope and provenance

Read CLAUDE.md, docs/DESIGN.md, docs/WEBSITES.md, the critique / impeccable skills and critique references, and the relevant site, board, bench and flight source. Source baseline is origin/main 783986893d427e7963e0acf0d598d71d8772badb in this audit worktree. Creator decisions in the brief and design documentation govern the review: Dark SOL / Design F, simulated passenger flights, Starseeker ships, bring your own agent with Grok first. This audit does not propose a different brand direction.

Visually inspected the deployed public home, open-bookings tab, scoreboard modal, /board and /bench in an isolated Chrome Playwright process. Desktop viewport 1440×1000. Actual mobile emulation 390×844, isMobile:true, hasTouch:true. Cross-checked home viewport and dialog keyboard behavior against the exact-main local Worker at http://127.0.0.1:8794/. Also captured a 390 CSS-pixel desktop viewport to inspect the narrow breakpoint separately from actual device emulation. These are browser-emulation observations, not physical-device or screen-reader tests.

Deployed content demonstrably differs from the source baseline: deployed board scores describe /100; main's board source describes /100000. Live board and scoreboard provided no linked flight run, and live sky showed zero flights. Therefore a real flight replay was not visually assessed; flight.html findings below are source-based only. No sample run was substituted for a real one. No dispatch, signup, bench start/end or agent action was performed. No application source was edited.

## Verdict

The distinctive solar-system operational map, ship fleet and provenance labels provide a strong core. The interface looks like an authored space simulation, although repeated cyan corner ticks, glass framing, tiny uppercase labels and nested boxes push parts toward generic sci-fi dashboard styling. Preserve the space-map composition and Dark SOL palette; improve readability and action hierarchy within them. Inter and cyan are intentional user-approved choices, not grounds to replace the identity merely because a generic detector dislikes them.

The biggest opportunity is to make the simulation understandable at a glance: what is happening, who actually caused it, and what the observer can do next. At present the empty-flight column dominates while locally generated planning events fill a component called Dispatcher feed. The UI has much stronger environmental atmosphere than operational explanation.

## Design health — 22/40, acceptable but significant improvements needed

Scores are informed reviewer judgments, not measured user-study outcomes. Untested destructive/session flows do not receive assumed perfect scores.

| Nielsen heuristic | Score /4 | Evidence |
|---|---:|---|
| Visibility of system status | 2 | Sky clock, statuses and counts are visible; failed live fetch becomes an empty sky in source, and feed activity conflates local planning with flights. |
| Match system / real world | 2 | Passenger routes and familiar boarding vocabulary help; par, heliocentric ecliptic and raw tool identifiers burden first-time use. Board retains hail/rider/robotaxi language. |
| User control and freedom | 2 | Dialog Close/Escape and focus return exist; focus escapes modal and continuously arriving feed cannot be paused. |
| Consistency and standards | 2 | Home is coherent Design F; full board uses an unrelated light-by-default shell and old terms. |
| Error prevention | 3 | Read-only observer surface and explicit agent handoff reduce accidental dispatch risk; no mutation flow tested. |
| Recognition rather than recall | 2 | Named route buttons, tabs and labeled tools help; mobile map options extend offscreen without an obvious affordance and no global route navigation links bench/method. |
| Flexibility and efficiency | 2 | Focus presets, filters and direct MCP instructions support experienced users; feed has no search/filter/jump-to-event capability. |
| Aesthetic and minimalist design | 2 | Map is compelling; repeated frames and oversized empty columns compete with task content. |
| Error recovery | 2 | Engine-load failure suggests reload, board offers alternative route; live-fetch failure has no actionable visible recovery. |
| Help and documentation | 3 | Four-part onboarding explains connection, provenance and scoring; practice bench has a clear three-step path. Contextual terminology help is uneven. |

## What works

1. The solar-system map is a real product centerpiece. Orbital geometry, recognizable planet imagery, labeled Starseekers and warm sun provide a meaningful visual identity. Keep the map and amber/cool role split.
2. Real/Fictional/Simulated labels and map compression disclosure make the honesty principle visible. The bench also distinguishes practice from scored results. These are trust assets worth preserving, although labels should be easier to read.
3. The agent handoff is explicit: Connect your agent, MCP URL with Copy, and a reminder that the website does not dispatch. Main source explicitly supports other MCP agents without implying an xAI key is required. Four accordion checks progressively disclose onboarding rather than demanding all form fields at once.

## Ranked issues

### 1. [P1] Actual phones receive a scaled desktop layout

Evidence: A-home-phone-device.png and A-main-phone-device.png. On a 390×844 mobile context, both deployed and exact-main home reported innerWidth=980 and scrollWidth=980; no viewport meta existed. The screenshot contains a two-column middle/bottom layout, very small type and desktop map tools. The 760px mobile layout never activates. Site source starts with title and claude:viewport-fit-sides rather than a browser viewport declaration (connector/src/site.html:1-4). Flight and bench have correct viewport metas (flight.html:5, bench.html:5).

Impact: Casey must zoom and pan just to read or choose bookings; apparent lack of horizontal overflow at 980 is not responsive success.

Fix: add width=device-width, initial-scale=1, viewport-fit=cover to the served home document, preserving pinch zoom. Then test true mobile emulation at 360/390/768 and keyboard at narrow widths. Keep safe-area tokens. Main already provides 44px coarse-pointer control minima at site.html:414-415; preserve them. Live measured map controls were only 25px in the device's 980px layout, which also demonstrates deployment drift rather than absence of that main-source rule. Suggested /adapt.

Coordination: site.html; schedule after PR #13.

### 2. [P1] Modal focus escapes into the obscured operations UI

Exact-main keyboard observation: after opening Connect your agent, focus proceeds from introH through Close, accordion controls, connector link and Copy to Back to operations. The next Tab leaves the dialog; the following Tab focuses connectBtn behind the modal, followed by flight tabs and map controls. Evidence: assessment-A-extra.json. The markup advertises aria-modal=true but openIntro only focuses the heading, and the keydown handler implements Escape only (site.html:555-560, 1939-1940, 2029-2033). The same architecture exists for scoreboard (543-545, 1883-1886).

Impact: Sam loses visible focus and can operate concealed content while a modal claims to be exclusive. This is a navigation failure, not a request for extra decorative focus styling.

Fix: use a native dialog opened with showModal or implement a tested focus trap plus inert background; retain Escape and focus restoration. Verify Tab and Shift+Tab around first/last controls. Suggested /harden.

Coordination: site.html; schedule after PR #13.

### 3. [P1] Small secondary text does not meet normal-text contrast

Source token --ink-3 #66788f (site.html:9, flight.html:15) is used for notes, timestamps, small labels, selected route metadata and empty-state guidance. Contrast against opaque #050a14 is approximately 4.39:1, against #0a1222 4.14:1, and against #0c1628 4.00:1. These mathematical token comparisons fall below 4.5:1; exact glass compositing varies, so they are not a claim that every pixel has the same ratio. Screenshot evidence visibly shows hard-to-read fleet dates, map explanations and feed timestamps. Typical sizes are 9.5–12px (site.html:21-25, 163, 220, 245, 251, 275-284).

Impact: Sam and anyone on a small or dim display can miss dates, provenance details and explanations. These are operational content, not decorative text.

Fix: raise the semantic muted-text token to a measured 4.5:1 minimum across all actual surfaces; use 12–14px minimum for essential metadata and increase line height. Reserve ultra-small letterspaced caps for nonessential grouping labels. Apply the same token contract to flight.html. Suggested /typeset, /colorize.

Coordination: site.html AND flight.html; schedule after PR #13.

### 4. [P1] Dispatcher feed implies a stronger activity record than it supplies

Observed live: zero flights, yet the feed waveform showed events and a FLIGHT legend while the list contained DESK Engine planned ... and SKY ... hazard changes. Main source confirms local plan results call pushFeed(kind:'plan') at site.html:1045, but WVK has no plan key and falls back to bin 0, visually labeled Flight (1777,1785; legend markup 526-529). Feed is page-local, seeds prior flight events on first fetch (924-925), prepends without timestamp sorting and removes items after 40 (1781-1785). It has no pause/filter/retained-history control. Pad-full updates are intentionally suppressed after initial snapshot (1768-1770), so the visible list cannot be treated as a full hazard audit trail.

Impact: an observer can mistake browser-generated preview work for actual agent dispatch activity. A person examining history may lose their reading position or assume the last 40 local lines are a server-backed log. This weakens the bring-your-own-agent promise because agent intent, tool result and simulation background are not clearly distinguished.

Fix: define event provenance visibly: Agent action, Simulation event, Local preview. Either add a Local preview series or exclude previews from the Flight chart. Label the feed as this-tab activity until backed by a persisted feed. Keep sky timestamp and add explicit real-time freshness/receipt context; do not invent agent identity. Offer pause with buffered new-event count, category filters, selected-flight filtering and event links where actual run IDs exist. Keep chatter aria-live=off by default; provide an opt-in concise status summary rather than announcing every tick. Suggested /clarify, /harden.

Coordination: site.html; discuss the event contract with booking/replay implementation after PR #13. Do not reconstruct that work independently.

### 5. [P2] The mobile hierarchy buries the feed and delays the next useful action

Even with a 390 CSS-pixel viewport that activates the intended breakpoint, the feed heading is ~2846 CSS pixels down in the captured empty-flight state (A-main-phone-css-390.png; assessment-A-extra.json). Map, selection box, legend, distance scale, empty flights, seven fleet rows and six tool cards all precede the feed. On 1440 desktop the feed heading begins ~843px down. The initial empty-flight column consumes most of a 750px-high row despite offering only one sentence. Layout rules: site.html:79-96; mobile overlay stacking 227-233; six tool tiles 254-260; feed fixed height 281.

Impact: Casey cannot check recent activity quickly, and Jordan sees operations before understanding the next useful step. The empty state is technically truthful but visually inert.

Fix: retain map identity but add a compact status strip and simple anchored sections (Sky, Bookings, Activity). When zero flights exist, provide a prominent Open bookings action and a truthful explanation that agent flights appear here. On phones use a collapsible compact map with a clearly labeled Expand map control; place Bookings and Activity before full fleet and tool reference. Group six camera presets behind an obvious scroll affordance or menu; do not silently hide offscreen choices. Suggested /layout, /adapt, /distill.

Coordination: site.html; after PR #13 so page wiring is not duplicated.

## Additional observations

- [P2] /board breaks the chosen direction: light by default, system typography, no Starfare home link, old robotaxi/rider/hail copy and a dense scoring paragraph. Screenshot A-board-desktop.png; source board.js:20-35. Bring its shell into Dark SOL, give it Home/Practice navigation and current passenger/booking vocabulary, and progressively disclose scoring details. The deployed lack of run links is NOT filed as a missing-main-code bug: source already supports them when run_id exists (board.js:6-8).
- [P2] Live API failure is indistinguishable from no flights in main source: catch calls setFlights([]) at site.html:930-935. Preserve last-known flights, show Last updated / Connection delayed, and offer Retry. This was source review only in Assessment A; do not imply a network-failure experiment was performed here.
- [P2] Map focal choices require horizontal scrolling on narrow CSS viewport but the scrollbar is hidden (site.html:142-144). Measured Saturn starts at x474px in a 390px viewport. This is not whole-page horizontal overflow; it is weak discoverability in an intentionally scrolling group.
- [P3] Duplicate DISPATCH OPERATIONS branding, “True positions · three.js”, every-panel corner ticks and repeated all-caps tiny labels add visual noise. Remove implementation vocabulary from user copy and use accents to distinguish selected/critical surfaces. Retain meaningful line semantics and provenance tags.
- [P3] Bench uses a softer 14px-radius Dark SOL variant while home uses Design F's 6px panels. It remains readable and its three-step sequence is effective; unify chrome without turning the helpful onboarding into a dense command console. bench.html:19,44-50.
- Source includes reduced-motion CSS and JS detection (site.html:404-406,795; flight.html:240,457), visible focus styling and accessible labels for many controls. Do not incorrectly report these as wholly missing. No full assistive-technology conformance claim is made.

## Cognitive load checklist — 4 failures / 8 (high by skill rubric)

| Item | Result | Reason |
|---|---|---|
| Single focus | Fail | Empty flights, map, detailed fleet, tools, hazards and feed compete without an observer's primary next step. |
| Chunking | Fail | Six camera presets, six tool cards and seven fleet entries; no higher-level prioritization. |
| Grouping | Pass | Distinct labeled panels and route cards clearly group related objects. |
| Visual hierarchy | Pass | Central map and bright Connect CTA are immediate visual anchors, despite excess subordinate framing. |
| One thing at a time | Fail | The observer reads changing sky/alerts while learning raw tools and interpreting multiple clocks. |
| Minimal choices | Fail | Six map presets plus Filters and Layers form eight adjacent choices; tools expose six simultaneously. |
| Working memory | Pass | Selected object details and route/fleet labels are visible on the same operational page; no required cross-screen memorization demonstrated in read-only flow. |
| Progressive disclosure | Pass | Onboarding accordions, booking tabs and on-demand long-haul planning hide some complexity effectively. |

The threshold is a critique rubric, not a clinical cognitive-load measurement. Reducing options should preserve power-user access.

## Persona walkthroughs

**Jordan, first timer:** sees an impressive sky and Connect your agent, but no short visible explanation of the game's observe/connect/dispatch loop. The default flight list is empty. Next, raw take_hail and plan_ride names appear alongside booking/flight UI terms. Opening onboarding resolves much of the agent question; a small persistent explanation and explicit Open bookings action would resolve it earlier. On /board, old hail/robotaxi language and no Home link disrupt the learned model.

**Sam, keyboard/low-vision:** opening Connect works and first focus is placed on the heading; Tab then escapes into the obscured map. Normal-text muted contrast is below 4.5:1 and operational metadata is often 9.5–11px. Feed silence prevents a barrage of announcements but offers no summarized new-event cue. Preserve keyboard-operable native buttons, visible focus and reduced motion while repairing modal isolation and legibility.

**Casey, distracted phone observer:** real-device emulation scales the 980px layout into 390px. Even the intended CSS phone layout puts Activity nearly 2.9k pixels down and camera presets offscreen in a strip with no scrollbar. Place a compact current-status/bookings/activity route before secondary reference content, preserve the expanded map as an opt-in view, and verify coarse-pointer sizes after the viewport correction.

## Emotional journey

Arrival evokes fascination and credible mission-control atmosphere. The first valley is a huge empty flights area: the product appears inactive despite a busy-looking map and waveform. Opening the agent checklist restores clarity and agency. The strongest potential positive peak—a real agent decision turning into a checked flight with a receipt—was unavailable during this read-only observation, so success/replay delight is unverified. The board ends the journey in a different visual system without a route home; bringing the receipt/board loop back to the sky would give a deliberate ending. No payment/delete/commit journey was tested or invented.

## Questions for the combined report

1. Should the first mobile screen prioritize Bookings or Activity once the viewport is fixed, while keeping the map expandable?
2. Should Dispatcher feed represent only real agent activity, or explicitly include a separately labeled local-preview stream? The observed waveform currently mixes them.

## Evidence index

- screenshots/A-home-desktop.png — deployed default desktop, zero flights
- screenshots/A-bookings-desktop.png — deployed bookings and bottom activity panels
- screenshots/A-scoreboard-desktop.png — deployed score modal
- screenshots/A-board-desktop.png — deployed standalone board, light default
- screenshots/A-bench-desktop.png — deployed three-step practice instructions
- screenshots/A-home-phone-device.png — deployed 390px mobile emulation, 980px layout
- screenshots/A-main-phone-device.png — exact-main 390px mobile emulation, 980px layout
- screenshots/A-main-phone-css-390.png — exact-main narrow CSS viewport, intended stacked layout
- assessment-A-observations.json — visible text, links, measured dimensions
- assessment-A-extra.json — exact-main keyboard focus trace and narrow breakpoint positions
- assessment-A-capture.cjs / assessment-A-checks.cjs — read-only capture scripts; local Playwright module path is environment-specific

No P0 identified within the observed read-only scope. Blocking problems in untested dispatch/replay workflows cannot be excluded. All site.html and flight.html recommendations are proposals for coordination after PR #13, not authorization or implementation.
