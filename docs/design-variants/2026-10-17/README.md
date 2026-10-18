# Starfare design variants — 17 October 2026

**Application integration:** now implemented on the same design branch under the user's subsequent authorization. Actual local app: http://127.0.0.1:8796/ . [Handoff and verification](../../design-audit/2026-10-17/integration/README.md). The prototypes below remain historical standalone studies at port 8795; they are not the integrated app.

**Latest review:** [Clearly labeled demo flights](mission-control-final/DEMO-README.md), including smooth ship travel, endpoint stops/return legs, shared pause control, and a motion recording. Design branch and copied engine now include merged PR #13/#14 at `ff66fbc`; the presentation remains a standalone demo. See [synchronization handoff](mission-control-final/SYNC-HANDOFF.md). No application source edits were made.

**Latest refinement:** [Living solar system](mission-control-final/LIVING-README.md): larger textured planets and ship artwork, compact peripheral UI, and a controllable engine-driven sky preview. Previous directions remain saved for comparison.

**Current review target:** [Solar-system canvas revision](mission-control-final/CANVAS-README.md). The user clarified that the solar system and its orbits are the center of the game. The earlier dashboard treatment is retained only as a component study; the current prototype uses a full-viewport interactive world with peripheral controls.

Three standalone, reviewable UI prototypes on `codex/design-audit`. These are design artifacts, not changes to the running application. The audit baseline remains `783986893d427e7963e0acf0d598d71d8772badb`.

**Selected direction:** the user chose Mission Control for a polished final-look prototype. The [finished refinement](mission-control-final/README.md) includes proper assets, restrained motion, accessible interactions and final screenshots. This supersedes the earlier Orbital Desk recommendation below. Application source remains on hold until after PR #13 integration.

## Open the work

- [Side-by-side comparison](compare.html) includes desktop and mobile screenshots with descriptive alt text.
- [Interactive prototype](index.html) has a three-way direction switcher, selectable bookings, a schematic route map, category filters, a pause-state demonstration, sample manifest/replay dialogs, and a BYOA connection explanation.
- Current local preview: http://127.0.0.1:8795/ serves the Mission Control final-look refinement. The older comparison remains saved as `compare.html`; its parent-directory server can be restarted with `node serve.cjs` after gracefully stopping the final-look helper. Do not run both on the same port.
- [Verification results](verification.json), [browser checks](verify-browser.js), [verification runner](verify.cjs).

## Comparison and recommendation

| Direction | Composition | Strength | Tradeoff | Preview |
|---|---|---|---|---|
| **01 · Orbital desk** | Bookings / orbital map + route / activity | Best balanced evolution of Dark SOL; makes the feed visible without removing spatial context | Three columns still require careful desktop density | [Desktop](orbital-desk-desktop.png) · [Phone](orbital-desk-mobile.png) |
| **02 · Departure lounge** | Large booking cards / smaller contextual map / activity | Clearest booking discovery and most welcoming first encounter | Less room for fleet context; longest mobile introduction | [Desktop](departure-lounge-desktop.png) · [Phone](departure-lounge-mobile.png) |
| **03 · Mission control** | Compact bookings / map / wider activity | More room for actor, action and outcome; efficient observation | Denser and less inviting for newcomers | [Desktop](mission-control-desktop.png) · [Phone](mission-control-mobile.png) |

**Recommend Orbital desk as the base.** Consider Departure lounge's larger route headings and Mission control's wider event rows after testing against PR #13's actual payloads. These are alternatives, not a proposal to implement all three themes.

## Decisions preserved

1. **Dark SOL / Design F:** navy-black background, cool cyan flight/action accents, warm solar/simulation accents, explicit provenance, recognizable orbital context, Starseeker fleet. Keep the production Three.js map and real ephemeris in any future implementation; this artifact's original SVG is a labeled schematic, not a replacement renderer or astronomical model.
2. **Bring your own agent:** the page observes; an MCP-connected agent plans and dispatches. There is no human-facing Book/Launch button, hard-coded agent vendor, or production connector action in these studies.
3. **Mobile: Bookings + compact activity.** Initially show two bookings and two events with explicit expansion controls; map is collapsed. Fleet and setup follow. Actor labels stay visible on compact event rows. All three variants share this hierarchy.
4. **Default feed: agent + simulation events.** Category, time, actor and affected flight/booking are separated. Local previews are omitted from feed data and counts. Preview replay does not append an event.
5. **Hold source changes until after PR #13 is integrated.** Engineering owns booking/replay wiring, engine logic and shared-flight timing. The sample data and replay here are independent presentation examples; no production schema or timing correctness is implied.

## Refero research and reference lock

Refero initially returned authentication retries. Following the user's reconnection, screen search and image retrieval succeeded. **Style search still returned NO_RESULTS**, including broad `dark`, `Linear`, and `travel` queries. No full style system was retrieved or claimed.

Viewed the actual screen images for these references:

| Reference | Pattern used to assess/refine the studies | Explicitly not adopted |
|---|---|---|
| [Shuttle activity](https://refero.design/pages/15ec7dea-408b-4a39-a6b9-12ca72447e3e) | Readable actor/action rows and a discrete activity surface; retain attribution in mobile rows | Its orange background, heavy translucency and file-sharing vocabulary |
| [Skyscanner flight detail](https://refero.design/pages/f4dd00de-9bc8-4648-8568-6d46e3c9e2c9) | Selected journey retains context while secondary details are disclosed; applied to manifest dialog | Purchase/price/fare-selection workflow, white sheet styling |
| [Linear Insights](https://refero.design/pages/91b6ffd0-8f8a-4810-99df-1030d2c17b55) | Restrained dark surfaces and clear hierarchy around operational information | Marketing-page composition, gradients as primary structure, its exact brand/type system |

**Primary reference is Starfare's audited Dark SOL**, not a blend of unrelated brands. Reference images were inspected through Refero and are linked, not copied into assets. The orbital diagram, ship glyphs and logo-like navigation mark in this prototype are original code-native SVG concept drawings. Final brand artwork must retain the established product assets rather than treating these study glyphs as approved replacements.

Token commitments: background `#050a14`; base surface `#0b1423`; text `#e9f0f8`; supporting text `#a2b3c8`; cyan interaction/flight `#56cefa`; warm simulation/solar `#ffc06a`; success `#83dfb4`. Color is reinforced by text labels. Existing Inter preference is retained with a Segoe UI fallback; fonts are not downloaded. Production assets are not embedded or fetched.

## Verification and limitations

- **12 responsive checks passed:** all three variants at widths 360, 390, 768 and 1440; no document horizontal overflow.
- **3 true mobile-emulation checks passed:** 390×844, touch enabled, `innerWidth=390`, `scrollWidth=390`, visual viewport scale 1. Mobile screenshots were recaptured in these contexts, not merely desktop-window resizing.
- **12 interaction checks passed:** agent/simulation filters, pause-state toggle, route selection, matching manifest, replay advancement, no preview-feed insertion, forward Tab containment, Escape focus return, and mobile booking/activity/map expansion.
- Zero JavaScript page errors in the automated run. Native dialog plus explicit boundary handling corrected the focus failure found during the first pass. Clear focus rings, semantic buttons, language/viewport metadata, descriptive diagram text, named dialogs and minimum 44px mobile button heights are included.
- Six final screenshots: desktop 1440px and mobile 390px for each direction. All desktop compositions and the phone pattern were visually inspected. This is not a complete WCAG certification, screen-reader test, or exhaustive cross-browser audit.
- Feed data is static; Pause demonstrates control state only. There is no live polling/SSE, production error handling or scheduling validation. Three bookings/passenger manifests, agent identity, seat counts, window times and events are fictional examples.
- Browser CLI was used first. A quoting error prevented its batch run-code command; verification then ran through the installed Playwright library. `verification.txt` preserves that failed CLI attempt; `verification.json` is the final successful result. The local runner points to the available cached Playwright package and needs that path adjusted on another machine.

## Coordination after PR #13

| Proposed production touchpoint | Design proposal | Gate |
|---|---|---|
| `connector/src/site.html` | Bookings/map/activity composition, mobile viewport and order, feed category/actor presentation, disclosure controls, connection dialog focus | Rebase the design branch onto merged main; inspect final DOM, event types and booking payloads; coordinate ownership before implementation |
| `connector/src/flight.html` (or final PR #13 location) | Shared-flight manifest hierarchy, replay labels and explicit provenance, accessible dialogs/navigation | Inspect the merged flight/replay state model; preserve Engineering's wiring and timing semantics |
| Engine/event producers | No changes proposed in this study | Engineering owns logic and timing fixes |

No app source edits, commits, pushes, dispatches, merges, deployments, Cloudflare changes, secret changes or paid asset generation were performed for these studies. Read-only `git diff --stat` was empty after artifact creation. The artifact directory remains untracked for review.

## Focused UI and asset toolchain

For the earlier tooling request: use **Refero** for real interface reference research (screen retrieval verified here), **Figma** for editable UI/components (installed; no design write performed), and the available **imagegen** tool for future bespoke raster assets. Use **frontend-design** to build prototypes; **audit + critique** to evaluate them; **adapt + polish** for the selected direction. These skills already exist in the session; no redundant skill installation was needed. The current studies use vector diagrams directly and require no paid image generation. Figma generation or another paid asset service requires separate direct authorization before spending credits.
