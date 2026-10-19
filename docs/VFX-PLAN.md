# VFX pass (branch claude/vfx-pass)

Effects on the flight page that show what the record says happened. Every effect is a state recomputed from replay
time each frame, so pause, seek and replay at any speed give the same picture. `art/2026-10-17/motion-spec.md` wins
over the MengTo skills in `.claude/skills/`.

## Phases

| Phase | What | Commit |
|---|---|---|
| 0 | Plume off, steady nav lights, "Propulsion telemetry unavailable" in the HUD | e94138d |
| 1 | Game LODs of the generated hulls, loader, hull table, linear textures, environment fill, planet shadow on the ship | 6094c73, 6bc0324 |
| 2 | Hold ring, checkpoint outline, Mars dust and Titan haze, flown-trail ribbon, arrival state | this branch |
| 3 | Quality tiers with an adaptive drop | 6bc0324 |

## Phase 2 effects

| Effect | Trigger | Look | Reduced motion |
|---|---|---|---|
| Checkpoint outline | Live flight with a hold it has not reached | Dashed ring on the hold's place | Same |
| Hold ring | Playback at the live hold | Steady ring around the ship, checkpoint colour | Same |
| Dust storm, haze | A recorded `dust_storm` or `titan_haze` incident, or a live hold with that cause | Ochre veil over the body, thicker rim, label "Mars · dust storm · simulated" | Same |
| Flown trail | Always | Ribbon cut at the ship, widest (about 3 px) and brightest there, fading toward the start | Same |
| Arrival | Playback crossing into `arrived` | "Name · reached" label and one ring that grows and fades over 1.2 s | Label only |

A scrub into `arrived` also shows the label only.

Weather comes from the record and never from the run seed (bench seeds are secret). `StarfareView.weatherWindows`
turns incidents into windows per body: a station's weather is its parent body's. Holds that follow each other join
into one window. A live hold stays open until the bot decides. `weatherAt` builds the veil over the window's first
hour (or first quarter, if shorter) and clears it over the last. Tests: `connector/test/flight-weather.test.mjs`.

The trail's parameter is flight time, not sky time, so a long dwell between legs keeps the trail to the ship lit.

## Defaults and their alternatives

1. Plume off, because runs record no burns. Alternative: a plume driven by recorded burn telemetry, once runs log it.
2. Hull mapping: dawn (sf-01) is Kestrel, ds1 (sf-02, sf-03) is Tandem, rtg (sf-04 to sf-07) is Lantern.
   Alternative: any other mapping in the hull table in `design/assets/sol-art.js`.
3. Game LODs committed in `design/assets/models/`, about 0.8 MB each. Alternative: fetch them at build time from a
   draft release.
4. Meshes not yet approved for production stay on this branch.
5. Nav lights are steady. Alternative: blinking lights.
6. Wayfarer stays on the review page.
7. Hulls on the flight page only. The home map keeps procedural ships: at about 16 px the hulls read as smudges and
   cost 157k triangles (11.4 fps against 49.8k at 19.9 fps, measured) plus 2.5 MB. Alternative: a far LOD for the map.

## Approximations

- Planet shadow on the ship: only the focus planet casts it. It is a cylinder of the planet's radius, softened over
  the penumbra the Sun's disc gives at that depth (IAU nominal solar radius 695,700 km). The umbra's taper is
  ignored, the light eases over 0.3 s of real time, and the Moon's shadow is not modelled.
- The veil needs the shader planets. The fallback planets (no `StarfarePlanetEffects`) show the label only.

## Quality tiers

`high` on desktop at 30 fps, `medium` at `innerWidth <= 760` at 24 fps, `low` with Save-Data or after a drop.
`?quality=` pins a tier. Drop rule: after 30 warm-up frames, frame cost above 1.5 times the budget, summed past
3000 ms (each frame capped at 500 ms), drops one tier. It never climbs back.

## Not doing

Plume or burn flashes, docking, station rotation, camera shake, star streaks, travel bob.

## Verification

Unit tests 246 of 246 and engine hazards 8 of 8 pass on this branch.

Not yet checked in a browser:
- the Phase 2 effects at 1280x800, 390x844 and with reduced motion
- the trail shader compiling on a real GPU
- console output, draw calls and frame time with the trail
- e2e (41)

Run `node test/e2e.mjs` from `connector/` before any merge, and look at one dust-storm replay, one live hold and one
arrival.
