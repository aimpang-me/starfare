# Starfare — solar-system canvas prototype

Historical static-canvas revision. The [current living-system refinement](LIVING-README.md) adds larger bodies, recognizable ships, quieter panels and controlled ephemeris playback. The current root preview serves that refinement; this document's frozen-sky behavior and verification counts describe the earlier version retained at `canvas-static.html`.

The solar system is the main experience. Bookings, activity and fleet information sit around the world as compact overlays. This corrects the previous dashboard composition following the user's explicit feedback on 17 October 2026. That earlier design is a component study, retained as [skeleton.html](skeleton.html) with [historical notes](SKELETON-README.md).

## Review

- Local preview: http://127.0.0.1:8795/?design=solar-canvas
- [Desktop](screenshots/canvas-final-desktop.png) · [Earth–Moon focus](screenshots/canvas-final-earth.png) · [Unobstructed canvas](screenshots/canvas-final-canvas-only.png)
- [Phone](screenshots/canvas-final-390.png) · [Phone activity](screenshots/canvas-final-390-activity.png) · [Small phone focus](screenshots/canvas-final-360-focus.png) · [Tablet](screenshots/canvas-final-900.png) · [Short desktop](screenshots/canvas-final-1280.png)
- [Reference lock and decisions](CANVAS-DIRECTION.md) · [Verification](verification-canvas-final.json) · [Additional mobile controls](verification-canvas-controls.json)

## The experience

The viewport is a real WebGL scene with the Sun, all eight planetary orbits, Ceres, textured planets, and a docked sample spacecraft marker. Pan, rotate, zoom, switch between System / Inner / Earth, focus another destination through Map layers, or hide the peripheral panels. Earth and Saturn focus reveal their relevant moons. Planet labels avoid panels and each other; dense phone overview labels are reduced, with the full destination list available in Map layers.

Desktop bookings and activity are collapsible overlays. Activity starts collapsed at tablet widths to keep the world visible. On phones, the canvas remains above a bottom sheet, with Bookings selected first and Activity one tap away. The sheet can collapse for a larger view. This supersedes the earlier phone layout that hid the map below bookings/activity.

Selecting a booking highlights its destination bodies and parent orbits. Locate changes camera framing; Manifest shows the selected sample passengers. No route curve, journey duration, price, burn, departure or arrival is fabricated. An agent plans and dispatches; the UI observes. Local replay steps sample records and remains excluded from dispatcher counts. Connect agent provides a starter prompt, not a real connector configuration.

## Map data and assets

`build-snapshot.cjs` reads the existing engine at the audit baseline `783986893d427e7963e0acf0d598d71d8772badb` and writes only `assets/system-snapshot.json`. The epoch is 10 September 2033, 03:20 UTC in the engine's date convention. Planet positions use the engine's JPL DE421-based ephemeris. The nine heliocentric orbit lines are osculating two-body samples at that epoch. Moon/Titan curves are sampled relative to their parents over their catalog periods.

Radial distances use logarithmic compression, body sizes are enlarged, and Moon/Titan offsets are expanded. The labels disclose this. These choices support readable orientation and must not be treated as a physical distance diagram. The sky is frozen: camera movement does not advance it. SF–01's offset at the fictional Orbital depot is a sample display marker, not a real station orbit. The sparse star background is decorative, not a claimed catalog visualization.

The original project's `design/assets/sol-art.js`, planet maps, and source credits are copied unchanged into this artifact directory. NASA/JPL/USGS and Solar System Scope (CC BY 4.0) attribution is retained in [SOLAR-CREDITS.md](assets/SOLAR-CREDITS.md) and reachable through the UI, including mobile. Three.js r128 is local, with its MIT license. The Kestrel image remains the previously generated derivative of Art's original concept. [Asset provenance](ASSETS.md) and [SHA-256 manifest](asset-manifest.json) retain the source details. No new image generation was needed for this correction.

## Research

Primary foundation: the user's solar-system requirement, Dark SOL / Design F in `docs/DESIGN.md`, and the original orbital-canvas mockup. Refero screenshots were inspected for [Spline](https://refero.design/pages/d73f2952-65c8-4b43-9416-31c8f9121103) and [OneSoil](https://refero.design/pages/98cab7c3-d74d-408e-b4a8-9105c64d0aba): peripheral tools, a continuous spatial canvas, and contextual detail. Their branding and domain content were not copied. Refero style search returned NO_RESULTS; no full style reference was retrieved.

## Motion and verification

No idle animation, automatic camera orbit, simulated clock playback or inferred ship movement. The scene renders on demand. User-controlled camera transformations are immediate; selections/dialogs use a 160 ms opacity transition that is skipped under reduced motion. Hidden documents finish transient fades and suppress redraw requests until visible.

An initialization error found before visual review was fixed. Then one initial screenshot review and one final confirmation covered 1440×900, 1280×720, 900×900, 390×844 and 360×740 in Chrome. The visual refinement fixed label collisions, tablet obstruction, zoom-tool overlap and confusing out-of-neighborhood bodies during Earth focus.

**36 final browser checks plus 5 targeted mobile-control checks passed (41 total).** No page errors or failed asset responses were recorded in the final main run. Coverage includes canvas dimensions, body/orbit presence, zoom and keyboard rotation, frozen epoch/ship position, labels, selected manifests, focus restoration, feed filtering, replay isolation, collapsible panels, reduced motion, idle rendering, mobile panels and focus, destination selection, and mobile credits access. This is not a full screen-reader or cross-browser conformance audit; mobile uses viewport/touch emulation. The WebGL verification uses Chrome software rendering, not a hardware performance benchmark.

## Source and coordination boundary

All implementation is standalone under `docs/design-variants/2026-10-17/mission-control-final`. No application source edits, merges, or deployments. Source and Art originals remain unchanged.

- **`connector/src/site.html` — HOLD until after PR #13 integration:** preserve its real solar-system renderer and ephemeris; adapt peripheral panels, camera controls, responsive sheet, source-filtered activity, and accessible dialogs around that renderer. The canvas is the layout foundation, not a replaceable dashboard card.
- **`connector/src/flight.html` — HOLD until after PR #13 integration:** reuse the spatial hierarchy and visual tokens while binding replay position, time, holds and checkpoints to the accepted recorded data. Do not copy these fixtures or create frontend flight behavior.

Read the merged implementation and coordinate both files before making application changes. The user's latest canvas requirement supersedes the earlier dashboard hierarchy; feed-source policy and BYOA remain unchanged.

## Preview lifecycle

Node PID **29368**, owned by Starfare Design, serves only this artifact directory at localhost:8795. The existing helper was reused; no second server was started. It expires after 45 minutes idle or two hours total. Current metadata: [preview-process.json](preview-process.json). Restart with `node serve.cjs` here when the port is free. Graceful shutdown is HTTP POST to `/__stop`.

Verification browsers close in `finally`. Recorded test process pairs: 92348/45392 (failed initialization), 95796/47376 (initial), 94356/88204 (final), 92040/61008 (targeted controls). They are not retained. A short diagnostic browser was also closed in its `finally` block. Do not terminate unrelated processes by name.
