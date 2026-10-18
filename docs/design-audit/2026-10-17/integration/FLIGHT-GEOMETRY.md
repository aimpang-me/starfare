# Flight geometry repair

User-reported failure: cyan flight paths formed a jagged scribble around Ceres in the integrated app. Fixed locally on `codex/design-audit`; no deployment or remote update.

## Root causes and repair

1. `computeLeg` rounded heliocentric coordinates to six decimal places in AU. Each coordinate could lose almost 75 km. The actual archived Ceres pickup contained a waypoint displaced by **113.267 km** in three dimensions. Its small local orbit and exaggerated display scale made that noise conspicuous. New stored arcs retain 12 decimal places. The cache key includes the new precision revision so an older cached plan cannot reintroduce the loss.
2. Both replay implementations interpolated heliocentric waypoints before subtracting the parent's curved solar motion. Local transfers now interpolate in the parent's frame, then return to the actual parent position at the recorded flight time.
3. The local display scale jumped from zero to a minimum displayed radius. It now extends continuously to the body centre, matching both value and slope at the surface radius. Existing exterior marker/orbit scaling is retained.
4. The home map sampled until landing, including orbital holds, and joined every leg into one polyline. Both route renderers now use independent line segments. Home samples only departure through orbital arrival, skips idle legs, and extends a completed trail to the ship only while it is actually flying on that leg. An orbital hold is shown at the destination, rather than the departure. Both renderers sample short local paths sufficiently for a close-up.

### Archived flights

Existing records are not rewritten. For an old six-decimal local arc, the shared presentation helper asks the unchanged engine to reproduce the local transfer at its stored planned departure. Recovery is accepted **only if both exact plan times, the sample count, and every coordinate of every waypoint match the entire stored arc at its original six-decimal resolution**. A different result is rejected; the recorded arc is retained. Interplanetary arcs are not regenerated. This is a narrowly checked recovery of serialization precision, not a route substitution.

The archived Ceres route `run_d2275ddf3493c65104a6` passes that check. Its recovered points match the original unrounded engine output exactly. Flights, fares, manifests, incidents, physics, recorded tracks and dates are not retimed or changed. GSAP remains limited to UI and camera transitions.

## Evidence

- [92 passing regression tests](route-tests.tap), including 12 focused geometry cases, booking/replay, timing, live/golden output, game and storage coverage. The seven original geometry assertions failed before the fix; later frame/segment and surface-slope assertions also failed before their corresponding fixes.
- [Numerical verification](route-numeric-verification.json): actual local Worker/MCP dispatch `run_4477e7d7a1b15bf5adbd`, 49 pickup points, maximum new serialization error **0.1155 metres**. Physics engine SHA remains `13f5c2f0d2187b352d67d914057c54fb320aed3b020e642758478bd11dda8d65`.
- [Original real payload](route-reproduction.json), retained for diagnosis. [Fresh real local dispatch](route-local-flight.json). These are local verification runs, not hosted traffic or invented demonstrations.
- [Browser observations](route-browser-verification.json): actual archived replay progress, live Ceres close-up, compact mobile panel, no overflow or browser errors. Browser interactions used CUA; no fixture responses or runtime mutation were injected.
- [Corrected close-up](route-fixed-desktop.png), [mobile](route-fixed-mobile.png), [archived system route](route-after-archived.png), and [user-reported failure](route-reported.png).

The screenshots show illustrative compressed distances and enlarged bodies, as labeled in the app. A flight ends according to its recorded track; review uses pause/replay rather than generating perpetual motion.

## Changed source

- `connector/src/game.js`: arc serialization and cache precision revision.
- `connector/src/flight-view.cjs`: strictly verified legacy local precision recovery.
- `connector/src/site.html` and `connector/src/flight.html`: parent-frame interpolation, continuous local projection, separated flight-only geometry and orbital hold positioning. These are the coordinated application files, now edited after the merged #13/#14 integration.
- `connector/test/flight-geometry.test.mjs`: regression coverage for the actual failure modes.

`node build.mjs` from `connector` copies the shared browser helper into the local assets. The Worker configuration and engine remain unchanged. No deploy, merge, push or Engineering checkout edits were performed.

Re-run the numerical check with `node docs/design-audit/2026-10-17/integration/verify-route-data.cjs` while the local app is running. The regression command, from `connector`, is `node --test test/flight-geometry.test.mjs test/site-planning.test.mjs test/booking-replay.test.mjs test/flight-timing.test.mjs test/live.test.mjs test/live-keep.test.mjs test/game.test.mjs test/storage-plumbing.test.mjs`.
