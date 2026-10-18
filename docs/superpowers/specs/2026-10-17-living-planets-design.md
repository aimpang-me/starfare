# Living planets: proposed effects direction

Status: planning only. Requested by Alvin on October 17, 2026. No application changes or deployment are authorized by this document.

**October 18 implementation note:** The user subsequently authorized implementation, then expanded it to every currently mapped planet/moon and the Sun. The user also requested a Monday handoff with merges coordinated after all chats finish. The original design rationale below is preserved. See [actual results](../../design-audit/2026-10-17/planet-effects/RESULT.md) for delivered behavior, tests and outstanding limits; deployment remains prohibited.

## Design context

Starfare is a passenger-flight game and bring-your-own-agent platform. People should be able to enjoy a living solar system while understanding real simulated bookings, ships and destinations. Alvin wants the solar system to be the canvas, minimal SpaceX/xAI-like UI, and the orbital presentation of Solar Expanse. Dark SOL, Inter and the existing restrained controls remain the chosen direction.

The next pass should make the worlds feel like illuminated volumes, with distinct materials and subtle motion. The signature view is Earth: a shaded globe with independent clouds, cloud shadows, ocean reflections, a thin atmosphere and restrained night lights. All values below are the designer's proposed implementation defaults, not measurements or previously approved requirements.

## What is missing now

Inspection of `design/assets/sol-art.js` at `dd29e95` confirms that most bodies use one color map on a Lambert sphere. Earth already has a custom day/night shader and atmosphere rims, but lacks cloud, elevation and water-mask layers. Its specular response is guessed from color channels. Saturn's ring material is unlit. The planet surfaces have no update loop for rotation; all bodies receive the same initial tilt. The assets directory contains color maps and Earth lights, with no cloud, normal or roughness maps.

The existing spheres and textures are a foundation; increasing glow alone will not solve the flatness.

## Visual treatments

| World | Recommended treatment | Limit |
| --- | --- | --- |
| Earth, first showcase | Slow surface rotation; separately drifting clouds; soft cloud shadows; normal relief; an ocean mask for sun glints; a light-shaped blue atmosphere and readable terminator; city lights restricted to night | Clouds do not glow on the night side. No thick electric-blue outline or flickering cities. |
| Moon, Mercury, Mars, Ceres | Matte rough surfaces and terrain normals derived from elevation where available; grazing light reveals craters/ridges; subtle illustrative spin | No invented mountains inferred from a grayscale color texture. Airless bodies have no atmospheric glow. Missing elevation falls back to honest rough shading. |
| Mars, Venus, Titan | Thin dusty Mars limb; dense cream Venus cloud cover; soft amber Titan haze, with slow cloud-layer movement where assets support it | Ambient haze is decorative, not a claim that a simulated dust storm is active. No random event-like storms. |
| Jupiter, Saturn | Slow rotation; low-amplitude latitude-dependent cloud drift, preserving the mapped storm identity; soft limb depth and distinct bands | No swimming texture, warping silhouette or endlessly flashing lightning. |
| Saturn's rings | Lit translucent bands; planet shadow on rings and ring shadow on the planet; stable ring plane | Use analytic local shadows, not a costly solar-system-wide shadow map. |
| Uranus, Neptune | Calm shaded volumes, restrained haze and faint cloud detail | Keep their quieter character; do not turn every world into Jupiter. |
| Sun | Subtle surface convection and a compact flowing corona, with controlled exposure | Retain the small overview Sun. No repeated flare animation that could be confused with an actual simulated hazard. |

## Motion, detail and truth

- Overview: small shaded bodies, clean orbits and readable ships. Fine relief and animated transparent layers are reserved for useful viewing sizes.
- Focus: full layers for the focused planetary system. Proposed radius thresholds: base shading below 24 CSS pixels; blend additional detail between 24 and 64 pixels; full available detail above 64. Use hysteresis of 8 pixels to avoid repeated switches. The exact ramps may be tuned after visual review.
- Cosmetic surface periods: start with 180 seconds per turn and 240 seconds per cloud turn. Body profiles may vary periods within 120–360 seconds. Direction/axial orientation must use sourced metadata or explicitly documented illustration defaults. Do not rotate the map root, orbital position, route or Saturn's ring plane with the surface mesh.
- A presentation clock is independent of the accelerated simulation. Pause, reduced motion and hidden tabs freeze the added effects. Resume does not catch up. Replay seeks reset the decorative clock to a stable initial phase; no planet effect changes a recorded position or time. Existing playback behavior remains authoritative.
- Slowed surface motion is illustrative. A short note in Map info can explain this beside the existing compressed-distance/enlarged-body approximation. Decorative weather is never shown as a dispatcher event or scientific telemetry.
- Static high-quality lighting, normals and atmospheric depth remain when motion is reduced. GSAP stays responsible for existing UI/camera transitions; shaders and the render loop own planetary appearance. No animated loading reveal is needed.

## Assets and rendering

Keep Three r128 for this pass. Use its supported material/shader features; do not mix modern color-space APIs into the pinned renderer. Audit output encoding, color-map decoding and bloom exposure before tuning materials. Normal/height/roughness masks are linear data, not color textures.

Retain the existing credited albedo and night maps. Add registered cloud, ocean/specular and normal layers for Earth; derive Moon normals from NASA elevation data. Record source URL, original coordinate convention, conversion, attribution and output dimensions for each new asset. Do not copy game artwork or use generative imagery to invent terrain. Other rocky bodies may use a base material until a suitable registered data source is obtained.

Primary sources checked during planning:

- [Three r128 material implementation](https://github.com/mrdoob/three.js/blob/r128/src/materials/MeshStandardMaterial.js): normal, roughness and related map support in the actual version.
- [Solar System Scope textures](https://www.solarsystemscope.com/textures/): Earth cloud, normal and specular maps are available; their compatibility with the existing NASA color map must be checked.
- [NASA CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/): color and LOLA elevation maps, including coordinate and height conventions. Use suitable reduced assets, not the large scientific source files in the browser.

## Boundaries and performance

All changes stay in the Design worktree. Keep the orbital camera, body sizes, planet navigation, compact mobile panels, BYOA flow and actual flight geometry/timing unchanged. Modify `connector/src/site.html` and `connector/src/flight.html` only to load/update the shared appearance module; coordinate those two files before implementation if another chat is editing them.

Proposed budgets: retain the current 30fps desktop / 24fps phone caps; preserve headroom within their frame intervals; add at most four draw calls for a fully detailed focused world and no global shadow pass. New high-detail textures load only on focus/detail demand. Target at most 4 MiB additional compressed assets for the whole effects pack, and at most 48 MiB desktop / 24 MiB phone additional resident texture memory. Default new maps to 2K desktop / 1K phone; reduce layers and resolution before sacrificing ship or interface responsiveness. These are targets to profile, not claimed results.

## Build order and acceptance

1. Lighting/material foundation and an effects clock, without altering geometry or clocks owned by gameplay.
2. Earth + Moon as the quality benchmark. Review an actual before/after and a short motion capture before scaling the style to all bodies.
3. Rocky/hazy worlds, gas giants, Saturn rings and the Sun, then phone/performance refinement.

Acceptance: the improvement must be obvious in a still frame, not depend on glow or a video to hide flat surfaces. Earth clouds visibly separate from terrain; rocky relief responds to light; nights stay dark but legible; ring shadows track the Sun. At the overview scale, the map remains clean. Pause/reduced motion remain visually rich and still. Test desktop, 390px and 360px phones, actual flights, replay seeks, missing assets, hidden-tab resume and repeated focus switches. No accessibility or performance pass is claimed until these checks are executed.
