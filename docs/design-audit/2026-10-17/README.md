# Starfare design audit — 17 October 2026

**October 18 handoff:** all mapped worlds now have restrained material/motion profiles, implemented in `5cb1ab9`. See [actual results and limitations](planet-effects/RESULT.md) and [Design handoff](DESIGN-HANDOFF.md). Historical findings, standalone studies and current application evidence are separately labeled in [the artifact inventory](HANDOFF-ARTIFACTS.json). The final Design PR is held for coordinated integration after all chats finish; no deployment.

**Latest phase:** the user authorized application integration after PR #13/#14 merged. The actual app now has the living-system presentation with real bookings/recorded flights, reviewed locally without deployment. See [integration handoff and verification](integration/README.md). The audit below remains its original evidence snapshot.

Current checkout: `codex/design-audit` now includes merged PR #13/#14 at `ff66fbc`. This audit records its original baseline; historical findings are not a fresh audit of merged functionality. All artifacts were preserved. See [synchronization handoff](../../design-variants/2026-10-17/mission-control-final/SYNC-HANDOFF.md).

Method: dual-agent (A: /root/visual_review · B: /root/detector_review), followed by parent technical reproduction. A completed before B findings were released for synthesis.

## Verdict

**Preserve Dark SOL / Design F.** The orbital map, Starseeker fleet, cool flight accents, warm solar accents and visible Real / Fictional / Simulated labels give Starfare a recognizable identity. The biggest opportunity is making operations understandable: what happened, who caused it, whether the data is current, and what the observer can do next.

Anti-pattern verdict: **pass for product specificity, with readability and density problems.** Glass, cyan accents and Inter are chosen design decisions, not reasons to replace the brand. Repeated corner ticks, tiny uppercase metadata and nested panels sometimes compete with the operational content.

**Technical audit: 10/20. Design critique: 22/40.** Both fall in the skills' “Acceptable — significant improvements needed” band. These are review rubrics, not measured user satisfaction or a WCAG certification. **11 consolidated issues: 0 P0, 7 P1, 4 P2, 0 P3.** No live dispatch workflow was exercised, so absence of P0 findings does not certify that workflow.

## Baseline and boundaries

- Branch: codex/design-audit. Worktree: C:/Users/PC-AIMPANG/Documents/New project 3/.worktrees/starfare-design-audit.
- Fetched origin/main and created this branch at **783986893d427e7963e0acf0d598d71d8772badb**, merge of PR #12.
- Exact-main Worker: http://127.0.0.1:8794 during capture. Local build generated assets but left tracked application files unchanged.
- Deployed comparison: https://starfare.aimpang.workers.dev/. Its engine was c5fdd816d464827c; local main was 6130a4578ea4e569. Normalized home CSS also differs. Deployed scores were /100; current board source describes /100000. **These are separate versions.**
- GitHub CLI could not resolve PR #13 in aimpang-me/starfare during the audit. Its scope and branch codex/booking-replay are user-provided coordination context. The existing booking-replay checkout had uncommitted implementation work; it was not modified.
- Read-only public navigation and local/browser-only experiments. No application source edits, commits, dispatches, bench sessions, account changes, merges or deployments.
- Existing docs/DESIGN.md, docs/HANDOFF.md, docs/OPEN-QUESTIONS.md and incumbent code supplied sufficient design context. No replacement design or PRODUCT.md was invented.

## Scores

| Technical dimension | /4 | Reason |
|---|---:|---|
| Accessibility | 1 | Modal focus escapes, language missing, supporting text contrast below normal-text threshold |
| Performance | 3 | Hidden/offscreen rendering guards and capped pixel ratio; some startup main-thread work |
| Responsive design | 1 | Home fails true phone viewport setup despite useful breakpoint/coarse-pointer CSS |
| Theming | 2 | Main surfaces share tokens; standalone board leaves chosen visual system |
| Anti-patterns / implementation integrity | 3 | Product-specific map and provenance; repetitive framing and unclear event taxonomy |
| **Total** | **10/20** | **Acceptable; significant work needed** |

| Nielsen heuristic | /4 | Principal evidence |
|---|---:|---|
| Visibility of system status | 2 | Simulated sky is clear; failed live fetch becomes false empty state |
| Match to real-world concepts | 2 | Flight routes work; par/tool jargon and old hail terminology add translation |
| User control and freedom | 2 | Escape/Close exist; modal isolation and feed pause do not |
| Consistency and standards | 2 | Board diverges; flight navigation points at absent sections |
| Error prevention | 3 | Explicit read-only observer surface avoids accidental dispatch |
| Recognition rather than recall | 2 | Useful labels, but weak route navigation and offscreen map choices |
| Flexibility and efficiency | 2 | Map presets/MCP help experts; feed lacks filters and run navigation |
| Aesthetic and minimalist design | 2 | Strong map, excessive subordinate framing and empty-column weight |
| Error recovery | 2 | Reload guidance exists; live connection failure is silent |
| Help and documentation | 3 | Progressive connection checklist and clear practice sequence |
| **Total** | **22/40** | **Acceptable; significant work needed** |

## Ranked findings

All line references are to the pinned main commit, not the moving booking-replay checkout. “After PR #13” is a coordination flag, not an assertion that PR #13 leaves the issue unresolved.

### D01 — P1: phones receive a scaled desktop home page

**Location/category:** connector/src/site.html:1; responsive design. **After PR #13: site.html.**

At 390×844 with mobile and touch emulation, home renders a 980px layout at visual scale 0.398. At 360px it remains 980px at scale 0.367. Tablet 768px also uses 980px. The served document lacks the standard viewport meta. The 760px phone breakpoint never activates on these devices. Both deployed and exact-main captures reproduce it; desktop width-only resizing hides the defect.

**Impact:** tiny text and shrunken targets make basic observation/booking discovery difficult. No body overflow at 980px is not evidence of mobile success.

**Proposal:** add width=device-width, initial-scale=1, viewport-fit=cover to a complete served document; preserve pinch zoom and safe-area gutters. Verify real mobile emulation at 360, 390 and 768, then revise layout. Existing 44px coarse-pointer rules at 414–415 should be retained. Suggested **/adapt**.

**Evidence:** screenshots/main-phone.png, main-phone360.png, main-tablet.png; evidence/technical-check.json. Acceptance: innerWidth equals device width, scale is 1, controls remain legible and usable.

### D02 — P1: keyboard focus escapes open modal dialogs

**Location/category:** site.html:543, 555, 1883, 1939, 2029; accessibility/usability. **After PR #13: site.html.**

After opening Connect, Tab visits ten dialog controls, then BODY, Connect your agent behind the scrim, flight tabs and map controls. Both independent and parent keyboard traces reproduce this. aria-modal=true does not enforce modal behavior. Scoreboard uses the same focus-only opening pattern.

**Impact:** a keyboard user can lose visible focus and operate obscured content.

**Proposal:** use native dialog/showModal or an inert background plus correctly trapped Tab/Shift+Tab. Retain current initial heading focus, Escape and return focus. Suggested **/harden**. Acceptance: forward/backward focus wraps inside each dialog; Escape restores its trigger.

**Standard:** [WAI modal-dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). **Evidence:** technical-check.json modalFocus and assessment-A-extra.json; main-connect-dialog.png.

### D03 — P1: essential secondary text has marginal contrast and excessive small type

**Location/category:** site.html:9, 21, 23, 61, 281; flight.html:15, 26, 216; accessibility/typography. **After PR #13: both site.html and flight.html.**

The #66788f muted token computes to 4.39:1 on #050a14, 4.14:1 on #0a1222 and 4.00:1 on #0c1628. Many dates, notes and labels use this color at 9.5–12px. These are explicit token-pair calculations; translucent/gradient surfaces require individual compositing checks, not blanket acceptance of every detector estimate.

**Impact:** low-vision users can miss dates, provenance and empty-state instructions.

**Proposal:** raise content-bearing muted text to a measured minimum 4.5:1 on every relevant surface; reserve darker color for decoration. Increase operational metadata toward 12–14px and use letterspacing selectively. Keep the Dark SOL color roles. Suggested **/colorize**, **/typeset**.

**Standard:** [WCAG normal-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). There is no universal WCAG minimum font size; the size recommendation is a design target. **Evidence:** supplemental-check.json, main-feed-detail.png.

### D04 — P1: an unavailable live service looks like a genuinely empty sky

**Location/category:** site.html:930–935, 1655–1667; usability/status. **After PR #13: site.html.**

A browser-only 503 response for /live.json produced “No flights in the air right now.” Source catches errors with setFlights([]). The map/engine status continues, making service failure easy to miss.

**Impact:** observers receive the wrong explanation and cannot tell whether activity stopped or data stopped arriving.

**Proposal:** separate loading, connected-empty, populated, stale and failed states. Preserve the last successful snapshot with a stale marker; show last successful update, retry state and Retry. Distinguish engine availability from live-feed connectivity. Apply the same visible freshness contract to flight polling; its catches currently only warn at flight.html:1321–1348. Suggested **/harden**.

**Evidence:** main-live-service-error.png, technical-check.json liveFailureText. Flight polling risk is source-based; a real in-flight outage was not exercised.

### D05 — P1: local preview events are counted as flights

**Location/category:** site.html:1045, 526–529, 1777–1785; feed integrity/usability. **After PR #13: site.html plus agreed event contract.**

Observed with zero live flights: DESK “Engine planned …” events populate the waveform. Those events use kind=plan, but the bin map has no plan category and defaults unknown kinds to index 0, labeled Flight. Flight events also come from the home replay adapter, not a complete agent tool-call trace; liveRide creates empty checkpoints/incidents arrays at 875–877.

**Impact:** activity can be mistaken for actual agent flight actions, undermining the bring-your-own-agent observability promise.

**Proposal:** visibly distinguish **Agent action / Simulation event / Local preview**. Exclude previews from Flight counts or give them a separate series. Until persisted, label it “Activity in this tab.” Use real run/event IDs for links and identity; never fill an empty feed with invented agent activity. Source-backed tool results belong in the agent stream. Suggested **/clarify**, **/harden**.

**Evidence:** main-feed-detail.png, supplemental-check.json feedText; assessment-A.md. Acceptance: opening the page with no agents cannot increase the Flight count through local preview planning.

### D06 — P1: the home document has no declared language

**Location/category:** site.html:1; accessibility/document semantics. **After PR #13: site.html.**

The served home reports documentElement.lang empty and BackCompat. It begins with title/meta/style rather than a complete document shell. There is also no h1; that is a navigation best-practice gap, not by itself a WCAG failure.

**Impact:** assistive technology cannot programmatically obtain the page's default language; quirks mode makes layout reasoning less predictable.

**Proposal:** add doctype, html lang=en, charset, head/body structure and an appropriate page heading when correcting the viewport. Validate standards mode and landmark order. Suggested **/harden**.

**Standard:** [WCAG Language of Page](https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html). **Evidence:** technical-check.json lang/headings; supplemental-check.json compatMode.

### D07 — P1: flight navigation points to missing home sections

**Location/category:** flight.html:266; navigation/usability. **After PR #13: both flight.html and site.html; likely direct overlap with page wiring.**

The visible navigation links use /#hails, /#scores and /#play. Current home contains none of those target IDs or matching hash handlers. The links lead to the home top instead of the promised destination. “Ride hails” also contradicts chosen copy.

**Impact:** a visitor leaving a receipt cannot reliably find bookings, scores or the play/connection instructions.

**Proposal:** agree on stable Bookings, Scoreboard and Connect destinations with PR #13; route hashes must select/reveal the correct tab/dialog and move focus meaningfully. Replace visible “Ride hails” with “Bookings” while keeping stable API field names. Suggested **/harden**, **/clarify**.

**Evidence:** source references and fixture-flight-desktop.png. Re-audit the merged wiring before scheduling any patch.

### D08 — P2: activity is too distant and difficult to read continuously

**Location/category:** site.html:79–96, 227–233, 281–285, 521–529, 1780–1785; responsive hierarchy/feed controls. **After PR #13: site.html.**

At the intended 390 CSS-pixel breakpoint, A measured the feed heading ~2,846px down. At 1440×1000 it begins ~843px down. The 11px feed occupies a fixed 170px scroller, prepends entries and drops history after 40; no pause/filter/new-event buffer is offered. The map preset strip hides its scrollbar.

**Impact:** phone observers must pass the map, fleet and tool reference to check recent activity; continuous updates impede review.

**Proposal:** keep the map as the identity anchor but offer a compact phone map and Sky / Bookings / Activity navigation. Place actionable bookings and activity above full fleet/tool reference. Add Pause, buffered-new-event count, source/selected-flight filters, and truthful retention wording. Keep aria-live=off for raw chatter; offer a concise opt-in update summary. Suggested **/layout**, **/adapt**.

**Evidence:** A-main-phone-css-390.png, main-200pct-equivalent-reflow.png, main-feed-detail.png. The 720px capture approximates 200% viewport reflow; it is not a browser text-zoom certification.

### D09 — P2: standalone board breaks the chosen system and return journey

**Location/category:** board.js:20–35; theming/consistency. Also bench.html:19, 44–50 for a softer older Dark SOL variant.

The board defaults to near-white/system typography, switches with OS preference, retains robotaxi/rider/hail copy, exposes a long scoring paragraph and provides no home link. It looks detached from Design F. Its zero detector flags do not establish good UX.

**Impact:** the flight/score journey loses continuity and a clear route back.

**Proposal:** give board the fixed Dark SOL shell, current passenger/booking language, Back to sky and Practice links. Show score interpretation briefly; disclose detailed weights on demand. Harmonize bench chrome without sacrificing its readable three-step instructions. Suggested **/clarify**, **/polish**.

**Evidence:** main-board.png, A-board-desktop.png. Home's scoreboard modal itself can remain; shared navigation integration still coordinates after PR #13.

### D10 — P2: tab and popover state contracts are incomplete

**Location/category:** site.html:433–440, 1651–1653, 2029–2033; accessibility/widget behavior. **After PR #13: site.html.**

ArrowLeft on Open bookings leaves focus/selection unchanged; tabs lack roving tabindex and keyboard selection. Open bookings aria-controls references bkList rather than its tabpanel bkWrap. Escape hides Filters but leaves aria-expanded=true.

**Impact:** keyboard and assistive-technology users get inconsistent navigation and stale state announcements.

**Proposal:** implement the complete tab keyboard pattern and correct panel association, or use ordinary toggle buttons if tab behavior is not intended. Centralize popover close so expanded state always follows visibility. Suggested **/harden**.

**Standard:** [WAI tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/). **Evidence:** technical-check.json tabArrow/filterAfterEscape.

### D11 — P2: attribution assumes Grok when the client is unknown

**Location/category:** board.js:16,31; flight.html:309–310,1059; BYOA provenance/copy. **After PR #13: flight.html; coordinate shared attribution labels.**

Board rows say “planned by Grok bot” while the board explicitly admits the client cannot be confirmed. Flight dispatcher-log heading says “Written by the Grok bot.” Home correctly says other MCP agents may use the same URL.

**Impact:** Claude, ChatGPT or custom-agent players can be mislabeled, and a claimed identity appears verified when it is not.

**Proposal:** use “Connected agent” or “Agent tool log” by default. Show client/model/skills only when available, with self-reported/unverified labels as appropriate. Preserve Grok-first connection instructions and the text-only Works with Grok support statement. Do not add an xAI-key requirement. Suggested **/clarify**.

**Evidence:** board screenshots/source; flight log label source. The committed fixture has no trail, so its hidden log was not presented as a live observation.

## Dispatcher feed contract proposed for post-PR #13 work

| Source | Meaning | Minimum visible fields | Count/history behavior |
|---|---|---|---|
| Agent action | Actual recorded MCP action/result | Agent identity status, tool/action, flight/run link, outcome, sky time | Persisted event ID; deduplicate; distinguish pending/refused/completed |
| Simulation event | Engine weather, traffic or flight milestone | Event type, affected place/flight, simulated badge, sky time | Do not imply an agent decided it |
| Local preview | Browser-generated booking plan | “Local preview,” booking, calculation time | Separate count; never counted as a flown flight |

A compact freshness row should say when the last server update succeeded. A pause button pauses presentation, not the simulation; buffer new entries and offer an explicit resume. Link to an existing stored tool log/receipt instead of inventing a second unverifiable history. Retain raw data downloads and the distinction between checked trajectories, local hops, assumptions and simulated hazards.

## Cognitive load, personas and emotional journey

A's checklist has **4/8 failures**: single focus, chunking, one decision at a time, minimal choices. Grouping, main visual anchors, co-located context and progressive disclosure pass. Six camera presets plus Filters/Layers create eight adjacent choices; six tools and seven fleet entries have similar weight. This is a skill rubric, not a user-study measurement.

- **Jordan, first timer:** the striking map leads into an oversized empty-flight area and raw tool names. An explicit Open bookings action and a short observe → connect → agent dispatch explanation would clarify the next step.
- **Sam, keyboard/low vision:** heading focus and Escape work, but Tab escapes the dialog. Muted operational text and small dates add difficulty. Keep focus outlines and restrained announcements while fixing containment.
- **Casey, phone observer:** gets a shrunken desktop layout, then even the intended phone stack buries Activity. Compact map plus direct Bookings/Activity access better supports a quick visit.

The first emotion is curiosity and credible mission-control atmosphere. Empty-flight emphasis creates uncertainty; the connection checklist restores agency. A real agent decision-to-arrival peak was not available to observe. The fixture demonstrates receipt structure, not production delight or successful shared-flight dispatch.

## Detector synthesis and safeguards against false positives

Authoritative scan: **111 flags**, 100 warnings + 11 advisories: home 79, flight 23, bench 9, deployed board markup 0. Rules: undersized-ui-text 70; low-contrast 24; tiny-text 5; dark-glow 4; overused-font 2; wide-tracking 2; cramped-padding, marquee, pulsing-dot and repeating-stripes-gradient 1 each.

A and B independently agree on small supporting type, muted contrast, feed limitations and mobile hierarchy. Parent device emulation explains why B's 390px desktop resize appeared to reflow while actual phones did not. Detector line fields were all 0; report source anchors were verified manually. Inter, dark glass and glows are intentional, and several static background/black-text contrast estimates are unreliable. No mass “111 accessibility failures” claim is warranted.

Native browser automation was attempted but its profile was locked. Dedicated isolated Chrome processes supplied the captures. Detector injection on three deployed routes failed because Chrome denied access to the localhost script; **no successful overlay exists**. Failed-overlay screenshots are explicitly labeled in assessment-B.md. Its live server and browsers were stopped.

## Performance, positive behavior and limits

- Home stops WebGL rendering when the page is hidden or map is offscreen and caps pixel ratio at 2 (site.html:1063,1508–1516,1978–1980).
- Reduced-motion JS exists; fixture replay was paused under reduced-motion. An injected WebGL-unavailable context displayed useful fallback copy and retained text panels.
- Native buttons, many labels, focus outlines, Escape handling, raw logs and visible provenance are useful foundations.
- A warm local desktop navigation recorded four long tasks of 85–160ms. This is diagnostic evidence, not a field Core Web Vitals score or a proven severe performance defect. Profile planning work and asset delivery before deciding on workers/lazy loading.
- Replayed a committed Phobos arrived-record fixture with browser-only response interception and a visible AUDIT FIXTURE banner. Only the route ID was adapted; no server flight was created. Missing stored arcs use the existing client fallback. This does not validate production live replay, agent-written trails, shared manifests or PR #13.
- Desktop 1440×1000, mobile/touch emulation 360/390/768, intended narrow CSS layout and a 720px reflow equivalent were checked. No physical touch gesture suite, NVDA/VoiceOver session, true browser text-only zoom test, real authenticated agent connection, bench session, or dispatch was performed.
- Invalid local flight route returned 404 with a useful Back to sky message. Main home produced no captured page exceptions in the baseline width matrix.
- 44px touch sizing is a usability target and enhanced accessibility criterion; [WCAG 2.2 AA minimum target sizing](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) uses 24px with spacing/exceptions. Desktop 25–34px controls are not automatically AA failures.

## Coordination and concrete next pass

| File/surface | Proposed work | Coordination |
|---|---|---|
| connector/src/site.html | D01–D06, D08, D10; document shell, typography, dialogs, truthful live states, feed, mobile ordering | **Hold application edits until after PR #13; re-read merged DOM and event payloads** |
| connector/src/flight.html | D03, D04, D07, D11; shared tokens, visible freshness, real navigation, neutral agent attribution | **Hold until after PR #13; replay/manifest wiring is owned by booking-replay** |
| connector/src/board.js | D09, D11; fixed Dark SOL shell, current copy, route home, honest attribution | Reconcile score/run-link behavior with post-PR #13 implementation |
| connector/src/bench.html | D09; harmonize shell only | Preserve practice semantics and readable steps |
| Manifest/seasonal/replay payloads | Confirm real party/seat/stop data, selected run, checkpoint and route links | **Acceptance criteria for PR #13, not concurrent implementation findings** |

Recommended sequence, proposals only:
1. **/adapt** — correct viewport, then prioritize phone bookings/activity.
2. **/harden** — document semantics, modal isolation, tab/popover contracts, navigation and stale/error states.
3. **/colorize + /typeset** — measure semantic text colors and improve essential metadata.
4. **/clarify + /layout** — honest feed source taxonomy, BYOA attribution and observer hierarchy.
5. **/polish** — reconcile all public surfaces with Dark SOL after behavior is settled.
6. Re-run **/audit** and **/critique** against the merged branch and, separately, any later deployment.

These commands may be requested one at a time, together, or in another order. No implementation is included in this audit.

## Evidence

See [SCREENSHOTS.md](SCREENSHOTS.md) for selected captures, [assessment-A.md](assessment-A.md) and [assessment-B.md](assessment-B.md) for independent reviews, and evidence/*.json for raw measurements. Scripts in this folder are audit harnesses with an environment-specific cached Playwright path.

## Confirmed design decisions — 17 October 2026

Confirmed by the user after reviewing this audit:

1. **Mobile: Bookings + compact activity.** After correcting the viewport, prioritize bookings and a compact activity view. Preserve the map as an expandable part of Dark SOL / Design F.
2. **Default dispatcher feed: agent + simulation events, with local previews filtered out.** Keep source labels explicit. Browser-generated planning previews must not appear in the default feed or inflate its Flight activity count.

**Implementation hold:** keep all application source changes on hold until after PR #13. Re-read the merged booking/replay implementation and coordinate changes to connector/src/site.html and connector/src/flight.html before implementation. These decisions update the audit only; they do not authorize source changes, merging or deployment now.

## Final-look prototype follow-up

**Latest authorized addition:** the user requested clearly labeled demo flights. The [standalone demo refinement](../../design-variants/2026-10-17/mission-control-final/DEMO-README.md) now shows illustrative Earth–Jupiter, Saturn–Mars and contextual Earth–Moon motion, with pause, restart, reduced-motion handling and no dispatcher-feed insertion. Live status checks confirmed PR #13 already implements recorded-arc replay and PR #14 adds the landing-timing correction; both were open when checked. This corrects the prototype's lagging PR context. No application edits or merges were performed, and site.html/flight.html coordination remains pending PR #13 integration.

**Latest refinement:** the user requested more visible planets/ships, less dominant panels, and a living solar system. The [standalone refinement](../../design-variants/2026-10-17/mission-control-final/LIVING-README.md) enlarges textured bodies and ship artwork, compacts overlays, and adds a labeled, pausable engine-driven sky preview. Reduced motion starts paused; sample ships remain docked and replay remains excluded from activity. This is design evidence only. The integration hold for `connector/src/site.html` and `connector/src/flight.html` remains unchanged.

**Latest correction:** the user clarified that the solar system itself must be the canvas and treated the dashboard as a design skeleton. The [canvas-first revision](../../design-variants/2026-10-17/mission-control-final/CANVAS-README.md) restores the full-bleed orbital scene and uses compact peripheral overlays. On phones, the world remains visible above a Bookings/Activity sheet; this supersedes the earlier collapsed-map proposal. Agent + simulation feed filtering and BYOA remain unchanged. The source-change hold still applies to `connector/src/site.html` and `connector/src/flight.html` until after PR #13 integration.

The user selected Mission Control and requested a cleaner, minimal SpaceX / xAI-inspired visual treatment with proper assets and restrained motion. The standalone [final-look prototype](../../design-variants/2026-10-17/mission-control-final/README.md) preserves the two confirmed decisions above, Dark SOL / Design F, and BYOA observation. It adds NASA body imagery, an Art-derived Kestrel cutout, responsive details, sample state demonstrations and reduced-motion support. Final targeted browser verification passed 39 checks. This is design evidence, not a resolution of production audit findings; application source was not modified. Proposed integration targets remain `connector/src/site.html` and `connector/src/flight.html`, to be reconciled after PR #13.

