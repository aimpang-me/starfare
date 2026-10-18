# All-world material pass — actual results

October 18, 2026. Local implementation on `codex/design-audit`; no deployment. User first approved Earth/Moon, then expanded the scope to every planet and moon already in the app. Latest handoff instruction leaves merging to serial coordination after all chats finish.

## Delivered

| Bodies | Appearance |
|---|---|
| Earth | Independent cloud shell and shadows, registered normal and ocean maps, restrained glints, night lights gated by sunlight, thin blue atmosphere |
| Moon | NASA LOLA height-derived normals, matte grazing-light relief, no atmosphere |
| Mercury, Phobos, Ceres, Bennu, Io, Callisto | Rough lit surfaces and slow illustrative rotation; existing sourced color geography |
| Europa, Ganymede, Enceladus, Triton | Lit icy surfaces with subtle broad highlights; no invented terrain, jets or eruptions |
| Mars | Thin dusty limb and warm volume shading |
| Venus | Existing cream cloud-top map, dense limb haze, very slow retrograde illustration |
| Titan | Existing Cassini-derived haze map, soft amber envelope |
| Jupiter, Saturn | Coherent map rotation with small latitude-dependent drift; quiet atmosphere |
| Uranus, Neptune | Quieter band drift, cool shaded limbs |
| Saturn rings | Lit alpha bands, analytic planet-on-ring and ring-on-planet shadows; ring plane fixed independently of spin |
| Sun | Low-amplitude surface convection/flow; existing compact halo and overview radius retained |

All effects use one presentation clock per page. Pause, hidden tabs and reduced motion freeze added motion; explicit replay seeks reset it. Same-flight polling preserves the previous clock and paused phase. Surface children rotate; orbital roots, station/moon anchors, recorded trajectories, ship headings, simulation time and sizes do not.

Optional Earth/Moon maps load only at useful projected sizes, with a 24–64 CSS-pixel detail ramp, hysteresis and 1K mobile / 2K desktop tiers. Instance disposal releases materials while shared sphere/ring geometry and bounded texture caches remain shared. Missing relief/clouds retains base shading. Missing Saturn alpha suppresses rings and their shadow. An unavailable effects module falls back to the existing art facade.

Six new texture files total **2,596,641 bytes**. Source URLs, hashes, dimensions, conversion and licenses are in `design/assets/planet-assets.json` and `CREDITS.md`. Reproduction: `python design/prepare-planet-assets.py` with Pillow/numpy. Source downloads are research artifacts, not shipped textures.

## Actual verification

- `node build.mjs`: successful; engine bundle unchanged, SHA256 `13f5c2f0d2187b352d67d914057c54fb320aed3b020e642758478bd11dda8d65`.
- Expanded targeted suite: **72/72 passed**, `tests-final.tap`. Includes actual Three r128/SRI transform checks; visual clock pause/reset/static/long-gap behavior; every profile; fixed-ring matrix; opposite-Sun shadow checks; failed-map and shared-disposal behavior; actual `loadRide` paused-rebuild regression; flight geometry, heading, route, timing, booking/replay and live-state checks.
- Independent numeric renderer check: **15/15 headings passed**, `ship-heading-numeric.json`.
- Full expanded unit suite: **185/185 passed**, zero skipped/cancelled, 470.4 seconds, `full-final.tap`. Earlier benchmark-stage run: **180/180 passed**, `full-unit.tap`.
- Fresh expanded-scope source review found no Critical/Important blocker; reviewer independently ran effects/map/heading/geometry subset **40/40 passed**. Earlier review's same-flight clock reset was reproduced RED and fixed GREEN.
- Local browser: Earth cloud/terminator/night appearance, Moon relief, Jupiter and its moons, lit Saturn/rings, Mars, Venus and outer-planet focuses rendered. No captured shader errors. Captures in this directory record actual views, not generated mockups.
- Actual local MCP booking/dispatch: `run_e8374be1e63e3ef02b36`, SF-01, Orbital Depot → ISS → Lunar Data Center. The flight page advanced across recorded leg progress, then replay seek returned to Earth. This is simulated local application state, not a hosted dispatch or a fabricated demo path. `seed-earth.mjs` reproduces the local flow.
- Responsive checks: actual DOM viewports **390×844** and **360×740**, neither with document horizontal overflow. Collapsing Bookings exposed more of Saturn's system. `real-flight-mobile-390.png` shows the sourced Earth/cloud material in the perspective flight view.
- Pause screenshot comparison: unobscured Earth and Moon surface regions were pixel-identical across settled captures (`pause-pixel-check.json`). The whole canvas was not pixel-identical because route/label polling can still update; do not call it a whole-map pixel freeze. Resumed frame pair with capture timestamps is in `motion-full-a.png` / `motion-full-b.png`; it is not a video or an isolated GPU performance measurement.

## Limits and deliberate choices

- Registered relief is available for Earth/Moon only. Other rocky worlds use honest rough shading; normal-from-color terrain was rejected. No fake volcanoes, plumes, lightning or event weather.
- Existing .35-radian presentation tilt remains; periods are slowed illustration defaults rather than a scientific body-orientation model. Gas texture offsets stay small and preserve poles/seams/storm identity.
- The Sun's existing radial halo stays compact/static; this pass adds surface flow, not a new corona mesh or hazard-like flare animation.
- Physical phone/GPU performance, GPU resident memory and measured draw-call/frame-time budgets are **unverified**. Responsive viewport checks are not device-performance measurements. Existing application render caps remain unchanged.
- Reduced motion and hidden-tab timing have behavioral coverage; OS preference switching and every world's three-angle rendering in both camera types are not exhaustively verified.
- Deferred minor from final review: offscreen/modal `glStop()` does not disable the visual clock. Resume can advance decoration by the capped **0.1 seconds**; no game time or flight state changes. Pause and document-hidden paths explicitly disable it.
- Refero style lookup for aerospace/dark-monochrome references returned no results this pass. Existing user-approved Dark SOL / Solar Expanse reference lock from the prior design work was retained; no new generic UI theme was introduced.

## Decisions carried forward

1. Solar system remains the canvas; compact Bookings + Activity on mobile.
2. Default activity includes agent + simulation events, with local planning previews excluded.
3. Dark SOL / Design F, restrained GSAP interface/camera transitions and BYOA observation remain the product direction.
4. Shared `site.html` and `flight.html` edits build on merged #13/#14. This pass does not change engine or fleet assumptions.
5. Push a reviewable Design PR; merge with Engineering/Art handoff serially after all chats finish. Never deploy as part of this pass.
