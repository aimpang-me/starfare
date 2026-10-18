# Living solar system — application integration

Implemented on `codex/design-audit`, based on merged main `ff66fbc4532ec694770099e257dcc7214b9faaa0` (#13 and #14). User authorized application integration after those merges. No deployment, remote merge, push, hosted secret/configuration changes, or Engineering checkout edits were performed.

Review the actual local app at **http://127.0.0.1:8796/**. The separate historical prototype remains at port 8795 and is not the app. The local app helper uses Wrangler and local Durable Objects with OAuth disabled only by local CLI flags. It automatically stops after 90 minutes; `app-process.json` records owned process IDs. `node connector/build.mjs`, then `node serve-app.cjs` from this directory reproduces this review server when port 8796 is free. The committed Worker configuration is unchanged.

## Result

The home page is a full-viewport solar system with larger textured worlds, clear orbital paths, actual flight ships and engine-derived parked fleet. The selected Dark SOL / Design F direction, Inter, original SolArt assets and BYOA observation model are preserved. Compact Bookings is the default, Activity starts collapsed, secondary operations live in a drawer, and mobile keeps a bottom booking sheet plus Activity and an Operations menu. Distances/sizes remain explicitly illustrative; the positions and dates use the existing engine mapping.

The UI uses the real seasonal booking pool, identity, search, pagination and lazy route planning. Real flights use existing `/live.json` tracks and `/flight/<run_id>.json` stored arcs. Shared manifests, boarding/seat data, checkpoint holds, replay phases and actual continuation timing remain supplied by the merged implementation. Public agent calls/notes come from the existing `/rides/<run_id>.json` trail. Replayed physical events are labeled Simulation; actual tool calls are labeled Agent. Local route previews are excluded from feed entries/counts. No prototype DEMO paths or hardcoded bookings were integrated.

GSAP 3.15.0 is pinned and vendored locally for camera focus and panel entrances. It never targets ship positions, route curves, recorded time or physics. The observer can pause the map and explicitly resume live time. Reduced motion starts paused on home and replay; focus transitions become immediate. Hidden pages suspend rendering, bfcache restoration resumes correctly, modals trap/restore focus, and the map has keyboard controls. Original flight replay calculations are retained, with matching presentation and repaired navigation links.

## Verification

- **145/145 full connector unit tests passed**, zero fail/skip/cancel. [Output](unit-tests.tap). This full run includes long simulation-policy checks; it took about 459 seconds. Later changes were limited to presentation/reduced-motion behavior and were checked in the browser.
- **39/39 browser integration checks passed**, zero reported JS/asset errors. [Results](verification.json). Real MCP calls created the local flight; a browser-only read-only renderer probe measured recorded-clock advancement, visible ship movement and equality between rendered positions and replay mapping. No fixture payloads replaced real booking/flight responses.
- **10/10 state checks passed**, covering an explicitly injected HTTP 503 fleet outage, usable bookings, Escape/modal focus, reduced-motion flight playback, actual manifest and mobile overflow. [Results](state-verification.json).
- Desktop 1440px, 1280px, tablet 900px, phones 390px/360px, reduced motion and no-WebGL fallback checked. Browser contexts closed in `finally`; test processes exited. Only the explicitly retained local app/prototype previews remain for review.
- Read-only review initially found four issues with feed attribution, focus restoration, mobile navigation and Back lifecycle. They were fixed and rechecked; no remaining blocking contract issue was reported. Final Escape focus checks additionally cover the layered Reports/scoreboard case.
- Authored source whitespace checks passed; the unmodified vendored GSAP distribution retains its upstream header whitespace. Engine/source bundle SHA remains `13f5c2f0d2187b352d67d914057c54fb320aed3b020e642758478bd11dda8d65`.

Evidence: [desktop](integrated-desktop.png), [phone](integrated-390.png), [small phone](integrated-360.png), [phone canvas expanded](integrated-mobile-canvas.png), [actual flight replay](integrated-flight.png), [outage state](integrated-fleet-outage.png), [reduced-motion phone replay](integrated-flight-mobile-reduced.png). Earlier `verification-*.json` files are retained iteration evidence; the two linked current result files above are authoritative.

The local test client is named `starfare-design-local-verification`; its runs/notes are genuine local connector records. They are temporary verification traffic, not hosted players or model benchmarks. Flights arrive and stop according to their recorded tracks; this app does not synthesize perpetual traffic. Open a recorded flight for replay or connect an agent to create new traffic.

## Source and assets

- `connector/src/site.html`: actual app shell, live data/record attribution, GSAP camera progress hook, map visibility/pause and accessibility wiring.
- `connector/src/flight.html`: shared styling/navigation and reduced-motion playback preference; existing replay/manifest calculations stay intact.
- `design/assets/mission-control.css` and `.js`: shared presentation and UI motion. `connector/build.mjs` already copies the original asset tree to local `/assets/`; no build/config change is needed.
- `design/assets/vendor/gsap-3.15.0.min.js` and `GSAP-NOTICE.md`: unmodified pinned GSAP distribution and license/source notice.
- `design/assets/InterVariable.woff2` and `Inter-OFL.txt`: local font and existing license, reused from the selected prototype.

[Reference lock and integration plan](../INTEGRATION-PLAN.md) records the actual Refero results, their bounded roles, the official ARK reference and the approved prototype direction. Existing art credits remain at `/assets/CREDITS.md`. No SpaceX, xAI or Star Citizen artwork, logos or affiliation claims were introduced.

The earlier audit, prototype variants, image assets, motion recording and external preservation backup remain intact: [all 245 original artifact paths still exist and their backup bytes match](artifact-preservation.json). Future asset/renderer work should build on this merged contract and coordinate these two application HTML files; this integration does not represent a new Art GLB revision.
