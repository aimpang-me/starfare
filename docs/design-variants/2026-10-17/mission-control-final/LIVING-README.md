# Starfare — living solar-system prototype

Historical docked-fleet refinement. The [current demo-flight version](DEMO-README.md) adds explicitly illustrative moving flights at the user's request. This document's all-docked behavior and 46-check verification describe the earlier version retained at `canvas-docked.html`.

Current review target, refined on 17 October 2026 after the user requested more visible planets/ships and less dominant panels. The canvas hierarchy and Dark SOL identity remain the foundation.

Preview: http://127.0.0.1:8795/?design=living-system

- [Desktop](screenshots/living-final-desktop.png) · [Earth–Moon focus](screenshots/living-final-earth.png)
- [Phone](screenshots/living-final-390.png) · [Small phone](screenshots/living-final-360.png) · [Phone focus](screenshots/living-final-390-focus.png)
- [Tablet](screenshots/living-final-900.png) · [Short desktop](screenshots/living-final-1280.png)
- [Direction and motion thesis](LIVING-DIRECTION.md) · [46-check verification](verification-living-final.json)

## What changed

Planet display radii are about 50% larger in the desktop overview, with minimum pixel sizes on phones. Saturn's rings and the planet textures read more clearly. Three sample Kestrel ships have artwork and callsigns connected to station anchors: SF–01 at Orbital depot/Earth, SF–04 at Mars base, SF–07 at Titan dock/Saturn. Artwork and leader offsets are presentation aids; vehicle sizes and station locations are illustrative. Their docked state is explicit.

Bookings use compact route rows. Activity starts as a collapsed header with its event count. The separate fleet card is removed, the selection bar is smaller, and panel fill/borders are quieter. Phones retain the Bookings/Activity sheet, shortened by 56 pixels to give more space to the world. Ship and planet labels adapt to avoid controls and one another; a callout may hide when no clear placement exists at a given camera angle. Full destination access remains in Map layers.

The established Dark SOL tokens and the inspected Refero Spline/OneSoil references remain the visual authority. See [CANVAS-DIRECTION.md](CANVAS-DIRECTION.md) for the reference lock; no new visual world was introduced.

## Living sky and controls

The preview starts from 10 September 2033, 03:20 in the baseline engine's date convention and advances at **one simulated day per real second**. Planet and Moon/Titan positions come directly from the copied baseline engine's ephemeris. Camera changes do not create a separate clock. Focus follows the chosen destination while preserving camera offset.

The footer names the preview rate and provides a keyboard-accessible pause/play control. The running clock shows the date to avoid a rapidly flashing hour/minute display. Pausing shows the exact time and freezes positions. Reduced-motion preference starts paused and pauses running playback when enabled; choosing Play afterward is an explicit opt-in. Dialogs and hidden-state events suspend playback without catching up the time spent suspended. Playback stops at the ephemeris boundary.

The renderer caps requested updates at 30 FPS desktop / 20 FPS phones. Paused scenes redraw only for interactions or asset loading. These are caps, not measured hardware performance claims. No automatic camera drift, twinkling, pulse, engine flame or artificial flight movement was added.

The three ships keep constant offsets from their parent worlds and remain docked. They do not depart, burn, coast, arrive, or emit events. Dispatcher activity remains a fixed, labeled sample snapshot, while the sky preview date advances independently. Local replay uses separate sample records, temporarily suspends the sky, and remains excluded from activity and counts.

## Assets and boundaries

The existing textured planets and Art-derived Kestrel PNG are reused. No new image generation was needed. `assets/sky-engine.js` is a byte-for-byte copy of `connector/src/engine/sol-page.cjs` at audit baseline `783986893d427e7963e0acf0d598d71d8772badb`, SHA-256 `6130a4578ea4e569cfed68c816120990d4bec9d36db1d6b02a94eb31a19d15a7`. The browser uses it only for sky state lookup. Planetary orbit curves remain reference curves sampled at the starting epoch; distances and Moon/Titan offsets are compressed/expanded for readability, and body sizes are enlarged.

[Asset credits](ASSETS.md), [planet texture attribution](assets/SOLAR-CREDITS.md), and [asset hashes](asset-manifest.json) are retained. Art originals and engine source were not modified.

All work remains in this standalone design folder. **Hold changes to `connector/src/site.html` and `connector/src/flight.html` until after PR #13 integration and coordination.** Reuse the actual production sky clock, renderer, ship state and replay data during later integration. Do not copy prototype fixtures into production or infer flight events in the frontend. No source edits, merges or deployment were performed.

## Validation

One initial batched visual inspection, one correction batch, and one final confirmation. The refinement fixed a hidden third ship callout, a stale out-of-neighborhood station marker, fixed-size station anchors, and small footer text. The final run passed **46 checks**, with no captured page/console errors or failed asset responses.

Chrome verification covered 1440×900, 1280×720, 900×900, 390×844 and 360×740. Checks included running clock/planet positions, constant docked ship offsets, pause/idle rendering, dialog suspension/resume, a synthetic hidden-state event, reduced-motion startup/change, artwork loading and visibility, compact panels, manifest/focus handling, feed filtering, replay isolation, keyboard camera controls, mobile sheets and viewport overflow. Screenshots were captured paused so the composition can be compared. This is software-rendered Chrome with mobile viewport/touch emulation, not a physical-device benchmark, cross-browser certification or complete screen-reader audit.

The manual Impeccable detector ran once before the correction batch; raw output is [detector-living.json](detector-living.json). Functional 10 px footer text was raised to 11 px. Remaining small-type warnings apply to deliberate metadata. The filter underline is a tab boundary with vertical spacing, and Inter is the pinned Dark SOL typeface. The detector was not rerun; its JSON records the pre-fix scan.

## Review history and process ownership

- [Previous static solar canvas](canvas-static.html), with [canvas notes](CANVAS-README.md), remains available for comparison.
- [Earlier dashboard component study](skeleton.html), with [historical notes](SKELETON-README.md), remains saved.
- The existing Starfare Design server, Node PID **29368**, remains the only retained helper. It serves this directory on localhost:8795. It expires after 45 minutes idle or two hours total. Current metadata: [preview-process.json](preview-process.json). Restart with `node serve.cjs` here if needed; stop gracefully with an HTTP POST to `/__stop`.
- This refinement's test Node/browser pairs 68636/97408 (initial) and 81880/70764 (final) were closed and absent at completion. No unrelated process was terminated.
