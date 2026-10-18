# Correction: the solar system is the game canvas

The user rejected the prior dashboard composition as a final look: the solar system and its orbits must be the center of Starfare. The prior treatment is retained as `skeleton.html` for comparison; it is a component study, not the final spatial hierarchy.

## Reference lock before build

- Primary: existing `docs/DESIGN.md` Dark SOL / Design F, the original `world/refs/mockup-ride-request.jpg`, and the user's explicit correction. Full-bleed solar system, visible orbits, textured celestial bodies, compact glass panels. Keep Starseeker / BYOA, no car imagery or false travel estimates.
- Refero Spline workspace: https://refero.design/pages/d73f2952-65c8-4b43-9416-31c8f9121103. Inspected screenshot. Borrow floating peripheral controls and a canvas that remains visible between them. Reject editing handles, asset trees and purple object styling.
- Refero OneSoil map: https://refero.design/pages/98cab7c3-d74d-408e-b4a8-9105c64d0aba. Inspected screenshot. Borrow continuous map surface, compact contextual sidebar and isolated zoom controls. Reject its white/green palette and agricultural information.
- Previously inspected xAI reference supplies quiet typography and thin dividers only. It does not determine the app's hierarchy.
- Refero style query `dark spatial interface astronomy map canvas` returned NO_RESULTS. Screen references and the established product direction ground this correction; no full style system is claimed.

## Decisions

1. The world occupies the viewport below one compact header. No large title block, dashboard grid or decorative map card.
2. Show all eight planetary orbits and the Sun at first paint. Planet bearings and orbit samples come from a frozen extraction of the baseline engine at the labeled epoch. Compress radial distance for legibility, enlarge body sizes, and state the scale treatment.
3. Reuse the project's existing textured 3D planet assets and credits unchanged. This is an interactive WebGL scene, not a raster background. Pan/tilt, zoom, reset, inner-system and Earth focus are camera operations only.
4. Bookings and activity are compact, collapsible peripheral panels. A selected booking highlights endpoints; no invented flight trajectory or flight duration. Focused body details are contextual.
5. On phones, keep the solar-system canvas visible above a bottom sheet. Bookings is the default sheet; Activity is one tap away. This updates the earlier collapsed-map layout in response to the user's latest correction while preserving fast booking/activity access.
6. No automatic camera orbit, time playback, twinkling stars or invented ship motion. Render on demand. Reduced motion avoids fades; camera changes are immediate and never alter the frozen sky clock.
7. All assets, extraction output and UI remain within this standalone design folder. Application source, simulation code and Art originals remain untouched; coordinate `connector/src/site.html` and `connector/src/flight.html` only after PR #13 integration.
