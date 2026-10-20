# Ship and station motion — data first

Scope: asset effects only. This is an art specification, not an implementation or a verified production telemetry schema. Design owns UI transitions and accessibility. Engineering owns flight state, coordinate frames, route interpolation, event timing and replay.

Override, 2026-10-18: at Alvin's request the flight page shows a faint ion glow on ion ships through each flight stretch, labelled "Ion glow illustrative: thrust not recorded", and slows moon and station orbits between replay keys. See `docs/VFX-PLAN.md`.

Override, 2026-10-20: at Alvin's request ships parked at a station on the sky map keep a slow idle bob and sway of a few pixels, out of step per ship. It is decoration on the presentation clock: it never moves the recorded position, it is not a hold, and it freezes with the map pause and for reduced motion. Holds keep the rule below (no hovering bob).

**Default to an unlit, stationary asset when the required information is absent.** Never infer thrust from velocity, a departure label, distance covered or a plotted line. Never infer docking from arrival. All isolated demonstrations must say “CONCEPT PREVIEW — SYNTHETIC STATE — NOT A RECORDED FLIGHT” and stay out of activity feeds and counts.

## Effect decisions

| Effect | Required evidence from Engineering | Permitted depiction | Missing / stale / ambiguous data | Reduced motion |
|---|---|---|---|---|
| Hull and cabin materials | Fictional asset identity only | Static materials; no state claim | Remain static; identify as fictional | Same static asset |
| Navigation lights | Recorded light state and valid sample interval, or explicit concept mode | Small steady fixtures; optional gentle intensity cycle only if approved | Dynamic lights off; a static painted concept is allowed only as labeled art | Steady light for a known on-state; off otherwise |
| Propulsion | Recorded active-burn interval, engine identity, throttle and valid orientation/frame | Confined nozzle emission mapped to recorded throttle; no arbitrary acceleration | Off if any required field is unavailable; show “Propulsion telemetry unavailable” in the associated description | Static intensity while burn is known active; no flicker or particles |
| Coasting | Recorded coast state, or absence of an active supported burn | No plume, thrust flare or speed streaks | No propulsion effect | Same |
| Approach / docking guidance | Explicit recorded docking phase, target berth, time interval and valid relative pose | Guidance on the named collar only; alignment follows recorded pose | Off; arrival alone is insufficient | Static phase marker plus text; no sweeping sequence |
| Docked indication | Recorded docked state with station and berth identity | Steady collar marker with “Docked · simulated” when applicable | Neutral collar, unknown state text | Same steady state |
| Departure / arrival depiction | Recorded route, departure/arrival times and relevant state | Follow Engineering's authoritative state; arrival may stop a route marker, never invent a landing or latch | Hold last valid sample and mark stale; no invented transition | Static current sample and timestamp |
| Holds | Recorded hold interval and location/path | Follow the stored hold representation exactly | Never invent an orbit, circling or hovering bob | Static marker and “Holding” label when supported |
| Orientation / maneuvers | Recorded orientation samples and maneuver events in defined coordinates | Follow those samples; only Engineering-approved interpolation | Fixed diagram orientation clearly marked illustrative; no bank/turn animation | Static sampled orientation |
| Station rotation | Explicit orientation/rotation telemetry | Only recorded motion | Station stays still; C-shape does not imply rotation or artificial gravity | Static sampled orientation |

## Two clocks, separate purposes

1. **Simulation/replay clock:** selects recorded position, status, holds, burn intervals, docking phase and arrival. Pausing freezes this clock. Seeking recomputes effects directly at the target time, without playing skipped events. Playback speed changes when records are visited; it must not stretch a burn into unrecorded time. A replay label and sampled timestamp remain visible.
2. **Aesthetic clock:** may gently vary a supported navigation-light intensity. Proposed cycle: 4 seconds, shallow 70–100% brightness, no full on/off flashes. This number is an art timing choice, not simulation duration. It never changes position, status or the time of an event. Disable it when replay is paused, hidden, stale, or reduced motion is requested.

State boundaries take precedence over fades. A burn ends visually at the recorded end, with no decorative trailing afterglow. Throttle is not guessed or normalized across unknown engines. Any artistic throttle-to-emission curve must be documented as a visual mapping, not a physical exhaust model. No continuous thrust during coasting. No camera shake, looping travel bob, idle docking sweep, star streaks or automatic station rotation.

## Missing-data and replay behavior

- Require source identity, event/sample timestamps, valid intervals and data freshness. Engineering supplies the actual field names and freshness threshold; Art does not invent a timeout.
- Contradictory phase/burn data turns the uncertain effect off and exposes an unknown/conflict state. Do not choose the more dramatic interpretation.
- On disconnection, hold the last valid pose as a stale observation and disable dynamic effects. Do not extrapolate an arrival or maneuver.
- At replay end, preserve only the recorded terminal state. “Arrived” alone does not imply docked, landed, engines fired or passengers disembarked.
- A route line can be a schematic if labeled; its presence is not orientation telemetry. Do not derive banking or nozzle direction from it.
- Pure concept motion must use explicit synthetic data, separate files and permanent concept labeling. This pass delivers no animated preview, so no synthetic motion can be mistaken for a flight recording.

## Integration acceptance cases

These are planned checks, **not executed tests**:

| Input case | Expected asset result |
|---|---|
| Route + times, no burn/orientation telemetry | Recorded route presentation if supported; propulsion off; fixed illustrative orientation |
| Supported burn interval followed by coast | Emission only within that interval; exactly off at coast boundary |
| Arrival with no docking fields | Arrival state only; no collar sequence, latch, landing or docking claim |
| Recorded hold | Match stored hold; no invented loop or timing change |
| Pause, seek backward, replay at a new speed | Sampled state remains correct; no phantom event replay or skipped-event effects |
| Stale/conflicting records | Static last valid pose with stale/unknown label; uncertain effects off |
| Reduced-motion preference | Static state cues preserve meaning; no pulsing, particles or travel tween |
| Local concept preview opened | No write to flight state, bookings, agent activity or simulation counts |

No production data or schema was inspected for this art pass. Integration requires Engineering to confirm available fields and Design to approve the accessible presentation, after PR #13 and the interface choice.
