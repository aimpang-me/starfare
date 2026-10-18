# Design synchronization — merged main ff66fbc

Design branch `codex/design-audit` was fast-forwarded from `783986893d427e7963e0acf0d598d71d8772badb` to `ff66fbc4532ec694770099e257dcc7214b9faaa0`, including merged PR #13 and #14. Application source has no local modifications. Engineering's checkout was read only.

## Preservation

Before the update, all 245 existing artifact files (30,969,945 bytes), including `.impeccable`, audits, variants, assets and evidence, were copied and SHA-256 verified at:

`C:\Users\PC-AIMPANG\Documents\New project 3\starfare-design-preservation\sync-ff66fbc-20261017`

Immediately after the fast-forward, every original artifact still matched its original hash. Subsequent intentional changes are limited to compatibility/version documentation, copied engine, asset manifest, preview process metadata and the browser verification harness. Original bytes remain in the external backup. [Final preservation audit](sync-preservation-final.json) lists exact deltas. No reset, clean or artifact deletion was used.

## Compatibility and evidence

- Copied `assets/sky-engine.js` is byte-identical to merged `connector/src/engine/sol-page.cjs`; SHA-256 `13f5c2f0d2187b352d67d914057c54fb320aed3b020e642758478bd11dda8d65`.
- All 11 initial snapshot body positions match the merged engine exactly at the saved Julian date. The fixed snapshot remains unchanged. [Compatibility results](sync-compatibility.json).
- 23 targeted booking, manifest, replay and timing tests passed, zero failures/skips. [Test results](sync-unit-tests.json), [TAP output](sync-unit-tests.tap).
- 42 browser checks passed across desktop, tablet, 390px and 360px widths, with no reported JavaScript or asset failures. Coverage includes visible demo motion, endpoint continuity, pause, demo toggle, inspector, focus, reduced motion and overflow. [Browser results](verification-demo-synced.json).
- The first browser attempt found the prior preview helper had exited. The next exposed a harness race after toggling demo flights; the harness now waits for docked labels before checking. Both failed attempts remain saved. No UI behavior was changed for that correction.
- Synced screenshots: [desktop](screenshots/demo-synced-desktop.png), [phone](screenshots/demo-synced-390.png), [small phone](screenshots/demo-synced-360.png). Desktop and phone labels were visually reviewed.

## Merged contracts reviewed

Seasonal pool identity and stale refresh are shared across booking surfaces. Shared manifests preserve booking parties, seats, stop mappings and per-booking scores; unknown legacy values stay unknown. Replay selects recorded arcs by leg identity with explicit legacy fallback and keeps parked, flight, orbit, dwell, holding and arrived phases distinct. Holds freeze at recorded positions; final arrival stays at the endpoint. Shared minute-rounding conventions must remain intact.

PR #14 schedules continuation no earlier than the previous actual landing, adding the boarding dwell where applicable. Diversion and return rules remain Engineering-owned. Production renderer mapping, Three.js r128 and the `SolArt.ship({callsign})` update contract were inspected; production flight state drives the flying flag. Interface transitions must not fabricate simulation events or alter recorded time.

## Presentation boundary

The preview visibly identifies merged main `ff66fbc` and remains a **standalone demo**, with sample bookings and illustrative DEMO flights. It has no live backend connection and does not implement the production booking/replay DOM. The copied ephemeris is current; the illustrative flight paths are deliberately not production trajectories. Demo/local previews stay outside the dispatcher feed. Mobile keeps Bookings plus compact Activity, preserving the user's decisions.

Art remains independently versioned; the existing Kestrel concept derivative is reused. Dark SOL / Design F, solar-system-first canvas and bring-your-own-agent direction are preserved. Proposed application edits to `connector/src/site.html` and `connector/src/flight.html` still require coordinated implementation scope. This sync made none.

The Design-owned local preview is retained for review at http://127.0.0.1:8795/?design=synced-ff66fbc (PID 94164 when verified; 45-minute idle / 2-hour maximum lifetime). Browser/test helpers were closed. No deployment, hosted secret changes, remote merges or pushes were performed.
