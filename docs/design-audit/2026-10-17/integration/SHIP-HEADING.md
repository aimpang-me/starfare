# Ship heading and attitude repair

Local follow-up on `codex/design-audit` to the report that ships were being rendered vertically/horizontally rather than following their flight. No deployment or remote update.

## Cause

The existing Starseeker mesh already has the correct nose axis (+Z), dorsal axis (+Y), and aft exhaust (-Z). Rotating the art asset by an arbitrary quarter-turn would not address the failure.

The replay chose its direction by looking ahead a fraction of the **entire run**, even during a short local pickup. The actual archived Ceres flight demonstrates the error: a **0.098114-day pickup (2.35 hours)** was given a **2.063752-day** look-ahead, sampling the dwell for the next leg. The home map similarly based its direction window on landing time rather than orbital arrival, allowing a landing hold to contaminate its flight tangent. Heading easing could additionally leave the nose pointing away from the currently drawn path.

Parked fleet meshes and newly loaded arrived flight meshes received no orientation, leaving unrelated ships facing the same default world axis. A fixed up vector also becomes singular when a tangent points vertically.

## Changes

- Shared `flightDirection` samples a small interval strictly within the current leg's departure and orbital arrival. It does not sample a different leg, idle period, or arrival hold.
- Both maps orient the +Z nose directly along that displayed tangent, with the exhaust behind it. Camera smoothing remains separate from the ship's attitude. Positions, route geometry, time, incidents and manifests are unchanged.
- Parked, waiting and arrived ships use the displayed motion of their current location. They no longer inherit the mesh's arbitrary default heading or aim towards a future departure.
- `headingFrame` projects the preferred up direction perpendicular to the tangent, carries the previous up direction through vertical tangents, and avoids a sudden 180-degree roll. The local replay keeps its radial up preference; the solar-system map keeps its existing ecliptic up preference.
- No mesh rotation, cardinal-angle snapping, screen-facing billboard, invented bank animation or new dependency was added. A ship can appear vertical or horizontal when its projected route has that direction; its attitude is determined in 3D rather than locked to screen axes.

Source: `connector/src/flight-view.cjs`, `connector/src/site.html`, `connector/src/flight.html`. `node connector/build.mjs` publishes the shared helper through the existing assets pipeline.

## Verification

- [48 passing relevant tests](ship-heading-tests.tap), including [nine heading regressions](../../../../connector/test/ship-heading.test.mjs), previous flight geometry, booking/replay, flight timing, live/golden output and site planning. Zero failures or skips.
- [15 numeric renderer checks](ship-heading-numeric.json) use the actual Three r128 build pinned by the app, verified against its SRI hash, and the actual application coordinate mapping. The model's transformed +Z nose has a dot product of effectively 1 with the travel direction at ten points across the real archived pickup and cruise; its -Z exhaust has a dot product of -1. Five parked positions also align with their displayed orbital tangents.
- [Reproducible renderer check](verify-ship-heading.cjs): `node docs/design-audit/2026-10-17/integration/verify-ship-heading.cjs`. It downloads only the app's already pinned Three build for numeric verification; no browser interaction or stored-flight mutation occurs.
- [Browser results](ship-heading-browser.json): actual fresh local MCP dispatch `run_2b0862de3effa7260261`, map camera changes, 390px phone layout, actual replay, and no browser errors. The [real dispatch payload](orientation-local-flight.json) is retained.
- Visual evidence: [before](orientation-before.png), [route-aligned cruise at an oblique camera angle](orientation-fixed-flight.png), [phone](orientation-fixed-mobile.png), [close-up replay](orientation-fixed-replay.png). The bright exhaust is aft; the dim blue hull points forward along the dashed remaining path.

Browser verification used CUA and read-only DOM observations, with no fixture responses or injected runtime state. The temporary phone viewport was restored. The real local flight can be reviewed paused; it ends at its recorded arrival rather than looping.
