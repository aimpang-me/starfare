# Living Planets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Starfare's planets visible surface depth, atmospheric layers and restrained motion while preserving the minimal orbital map and actual simulated flights.

**Architecture:** A shared `planet-effects.js` module owns body appearance, layer detail and a cosmetic clock. `sol-art.js` remains the public art facade; the home and replay pages supply frame context without changing their physics or route mapping. Begin with Earth/Moon as a reviewable benchmark, then reuse the system for the other worlds.

**Tech Stack:** Existing Three r128/WebGL, GLSL, JavaScript UMD/CommonJS, existing GSAP controller, Node tests. No renderer upgrade or new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-10-17-living-planets-design.md`

**Status (October 18):** Implementation authorized, first for Earth/Moon, then expanded by the user to all currently mapped bodies. The original checklists below remain the proposal baseline; actual completed checks and limitations are recorded in `docs/design-audit/2026-10-17/planet-effects/RESULT.md`. Do not infer completion from this proposal.

**Plan review:** Independent graphics-engineering builder check completed; no important unanswered questions or contradictions were identified. Implementation still requires a subsequent user request.

## Global Constraints

- All changes stay in the Design worktree.
- Keep the orbital camera, body sizes, planet navigation, compact mobile panels, BYOA flow and actual flight geometry/timing unchanged.
- Keep Three r128 for this pass.
- Pause, reduced motion and hidden tabs freeze the added effects.
- Cosmetic motion is independent of simulation time. Replay seeking resets it to a stable initial phase.
- GSAP stays responsible for existing UI/camera transitions; shaders and the render loop own planetary appearance.
- No deployment or hosted configuration changes. The user subsequently authorized pushing and merging; the latest handoff instruction coordinates merge after every chat finishes. Prepare the Design PR for that serial integration.
- Resolve concurrent ownership of `connector/src/site.html` and `connector/src/flight.html` before source edits; preserve other chats' work.

## Review Focus

1. Pause/visibility changes must freeze decoration without a resume jump or leaked frame loop: Task 1 clock tests and Task 5 browser checks.
2. Cosmetic rotation must never rotate an orbit, move a flight endpoint or corrupt a replay seek: Tasks 1 and 5 regression checks.
3. Transparent clouds/rings must render correctly with log depth and both orthographic/perspective cameras: Tasks 2 and 4 visual checks.
4. Missing maps, low texture-unit limits and repeated focus changes must degrade cleanly without GPU growth: Tasks 2 and 5 fallback/resource checks.
5. Asset coordinates, color encoding and body normals must agree across day/night, haze, roughness and shadows: Tasks 1–4 light-angle/asset-registration checks.

## Task 1: Shared appearance contract and stable visual clock

**Files:** Create `design/assets/planet-effects.js`; modify `design/assets/sol-art.js`, `connector/src/site.html`, `connector/src/flight.html`; create `connector/test/planet-effects.test.mjs`.

**Interfaces:**
- Module exports `createClock()` with `sample(nowMs, enabled): number` and `reset(nowMs): void`. Seconds advance only across consecutive enabled samples, delta is capped at 0.1 seconds, and reset sets the elapsed time to zero. Pause/visibility handlers sample disabled before the render loop stops.
- Module exports `createBody(THREE, id, services): THREE.Group`, where services provide `texture(file)` and the existing shared Sun uniform. Keep root location/scale separate from a tilted frame, a surface rotor and independent cloud/ring children.
- `SolArt.planet(id)` retains its existing call signature and returns the body root; `SolArt.updatePlanet(body, context)` delegates to the module. Context is `{elapsedSeconds, camera, radiusPx, quality}`, where quality is `overview`, `mobile` or `desktop`. `SolArt.disposePlanet(body)` releases instance resources without disposing shared textures still in use.

- [ ] Add behavioral tests for enabled/disabled/reset clock samples, long hidden gaps, reduced-motion callers, independent clocks for page instances and bounded delta after resume.
- [ ] Add a real Three transform test: advancing appearance changes a surface child's rotation while root world position/scale, moon/station anchors and the ring plane remain unchanged. Audit callers for assumptions that `planet()` returns a Mesh rather than a Group.
- [ ] Implement the module/facade and integrate it into the existing render loops and pause/visibility/seek paths. Preserve existing load order and fall back to the current basic planet if the effects module is unavailable.
- [ ] Audit r128 color/output encoding and custom shader log-depth chunks. Resolve lighting without raising global bloom to simulate depth. Ensure orthographic view direction is constant across the body; perspective views use per-fragment view direction.
- [ ] Run `node --test test/planet-effects.test.mjs test/solar-map.test.mjs test/ship-heading.test.mjs test/flight-geometry.test.mjs` from `connector`; require all pass. Commit this independently verified foundation.

## Task 2: Earth and Moon benchmark

**Files:** Modify `design/assets/planet-effects.js`, `design/assets/sol-art.js`, `design/assets/CREDITS.md`; add `design/assets/planet-assets.json` and new files under `design/assets/tex/`; extend `connector/test/planet-effects.test.mjs`.

**Interfaces:** Use Task 1's body/update contract. Asset manifest entries contain body/layer, filename, width/height, color-or-linear encoding, source URL, coordinate registration/conversion and credit. The first assets are Earth cloud 1K/2K WebP, Earth ocean mask 1K PNG, Earth normal 1K/2K PNG and Moon normal 1K PNG. Existing color/night maps remain the source of geography.

- [ ] Acquire the referenced sources and prepare registered web assets. Record exact conversion commands and confirm longitude, pole orientation and recognizable Earth coastlines align before rendering. Derive lunar normals from height data, not its color photograph.
- [ ] Implement Earth surface normals, ocean-mask highlights, smooth day/night shading and night lights that fade into daylight. Add an independent sunlit cloud shell, restrained shadowing and an atmosphere shaped by sunlight/view direction. Start at the spec's 180/240-second periods.
- [ ] Give the Moon matte relief and grazing-light depth, without an atmosphere or oversized displacement. Keep silhouettes, map radii and local anchors unchanged.
- [ ] Add asset-failure tests: cloud/normal missing yields a usable base globe; cloud failure cannot remove the body; shared textures survive disposal of a different instance. Add clock phase tests proving repeated timestamps and reset produce stable layer angles.
- [ ] Run the Task 1 suite, build with `node build.mjs`, then inspect Earth/Moon at three light angles in home and actual replay views. Capture before/after stills plus 10 seconds of motion. Verify cloud relief, night-light gating, seam/pole continuity and no transparency halos under log depth. Record actual observations, not planned passes.
- [ ] Save evidence under `docs/design-audit/2026-10-17/planet-effects/` and commit. Use this as the appearance checkpoint before broadening the effects.

## Task 3: Distinct rocky and atmospheric worlds

**Files:** Extend `design/assets/planet-effects.js`, `design/assets/planet-assets.json`, `design/assets/CREDITS.md`; add sourced normal maps under `design/assets/tex/` where available; extend `connector/test/planet-effects.test.mjs`.

**Interfaces:** Reuse the same body/update contract and asset manifest. Per-body profiles select matte rocky, thin atmosphere or thick cloud/haze appearance; they do not introduce separate update loops.

- [ ] Apply material/relief profiles to Mercury, Mars, Ceres and remaining moons; only enable relief for registered elevation-derived data. Missing suitable data stays a rough lit sphere and is documented as a fallback, not fabricated terrain.
- [ ] Give Mars, Venus and Titan distinct atmosphere thickness/color and slow cloud/haze treatments, preserving readable night sides. Source spin/tilt metadata before replacing the uniform tilt; document any illustration defaults. Do not animate game-weather events without authoritative simulation state.
- [ ] Test profiles for absent optional assets and update/dispose cycles. Visually check one airless body, Mars and Titan in still and reduced-motion views; confirm that every material remains convincing without animation and the orbit map still fits.
- [ ] Run the planet-effects and geometry/heading suites; capture the three comparisons and commit the world profiles.

## Task 4: Gas giants, Saturn rings and compact solar activity

**Files:** Extend `design/assets/planet-effects.js` and `design/assets/sol-art.js`; extend the asset manifest/credits only when an additional sourced map is required; extend `connector/test/planet-effects.test.mjs`.

**Interfaces:** Gas giants reuse Task 1's update contract. Add `SolArt.updateSun(body, context)` with the same context for its existing Sun Group. Analytic shadows consume local body coordinates and the shared Sun direction, never gameplay state or a scene-wide shadow map.

- [ ] Add restrained gas-band advection with coherent mapped storms and stable poles/seams; keep Uranus and Neptune quieter. Do not deform sphere geometry.
- [ ] Light Saturn's existing alpha ring map and implement analytic planet-on-ring and ring-on-planet shadows. Test shadow orientation by moving the Sun direction across opposite sides; ensure the ring frame stays fixed while surface motion advances.
- [ ] Add low-amplitude solar convection/coronal flow while retaining the current overview Sun size and exposure. Pause/reduced motion must freeze it. Do not add flare-like hazard cues.
- [ ] Run the behavioral tests and inspect Jupiter, Saturn and the Sun in both camera types, including ring transparency behind/in front of the globe. Record draw calls and shader/texture failures. Commit only when these focused checks pass.

## Task 5: Detail scaling, fallback, performance and real-flight verification

**Files:** Refine the shared module and page adapters; extend `connector/test/planet-effects.test.mjs`; add the completed verification report/captures under `docs/design-audit/2026-10-17/planet-effects/`. Modify UI CSS only if an observed regression requires it.

- [ ] Implement the 24–64px detail ramp and 8px hysteresis from the spec. Lazy-load high-detail assets; cap new texture resolutions at 2K desktop / 1K phone by default. Use shared caches and explicit ownership/reference counts. Drop cloud shadows/advection and resolution first on constrained GPUs; keep baseline shading and ships readable.
- [ ] Test repeated focus switches and disposal, optional-map network failure, unsupported shader paths, pause/resume, tab hiding, reduced-motion changes, replay speed/seek, zoom threshold churn and static timestamps. No unbounded cache growth or frame loop should remain after teardown.
- [ ] Run `node build.mjs`, then `node --test test/planet-effects.test.mjs test/solar-map.test.mjs test/ship-heading.test.mjs test/flight-geometry.test.mjs test/flight-route.test.mjs test/site-planning.test.mjs test/booking-replay.test.mjs test/flight-timing.test.mjs test/live.test.mjs test/live-keep.test.mjs` from `connector`. Require all pass and engine hash unchanged.
- [ ] Inspect actual local bookings/flights and replay on desktop, 390x844 and 360x740. Capture overview, Earth/Moon, Mars, Saturn, Sun and compact flight details, including pause/reduced motion. Compare recorded ship positions/headings/timing before/after and verify there is no effects-driven route movement.
- [ ] Profile baseline versus effects on the available desktop and a representative phone/GPU. Check the proposed draw-call, download and resident-memory budgets and current 30/24fps caps. If no representative phone is available, report that performance as unverified rather than equating viewport emulation with device performance. Downgrade or defer layers that exceed the budget.
- [ ] Save actual results, unresolved limitations and before/after images; commit the completed local pass. Keep deployment and integration outside this plan.
