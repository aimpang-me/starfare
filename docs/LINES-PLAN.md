# Lines plan: orbits, routes and station markers

Status: proposed, 2026-10-18. Covers the home map (`connector/src/site.html`) first, then the flight page (`connector/src/flight.html`).

## What Alvin reported

- Lines draw badly. Some are jittery, some are noisy.
- Cyan wireframes surround the stations.
- Orbit lines run through the planets and moons, and do not look centred on them.

## What was measured

All numbers come from headless probes against `wrangler dev` (1440x900, three.js r128). The probes read the live scene and camera, so they measure what the page draws, not a copy of its maths.

### Orbit lines are on their bodies at page load

Each probe measured the distance in pixels from a body's projected centre to its own orbit line:

- Every planet, Ceres and Bennu at the whole-system view, and Earth, Mars, Jupiter and Saturn at their focus views, sit within 0.4 px of their lines.
- The Moon, Io, Europa, Ganymede, Callisto, Enceladus, Titan and Phobos sit within 0.9 px of their rings.

The ring maths (`SF.orbit`, `localOff`, `S`) is correct.

### The Moon drifts off its ring while the page stays open

Rings are sampled once, when the scene is built (`site.html:1552`, `:1558`). The sky then advances one sky day per real second. A second probe measured how far each body sits from its load-time line after a given number of sky days, as a share of the ring radius:

| Body | 7 d | 30 d | 100 d | 1000 d | 3000 d |
|---|---|---|---|---|---|
| Moon | 0.0% | 0.3% | 1.2% | 8.5% | 7.9% |
| Phobos, Io, Titan, Triton | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| Planets, Ceres, Bennu | 0.00% | 0.01% | 0.01% | 0.05% | 0.14% |

The Moon follows the real lunar ephemeris. Its orbit plane regresses with an 18.6-year period and its perigee advances with an 8.85-year period. The other moons are fixed Kepler orbits in the engine, so they never drift. 1000 sky days is about 17 real minutes. At that point the Moon sits 8.5% of the ring radius off its line. That is about 19 px at the Earth focus view and about 85 px when the Moon fills the screen. This is the "not centred" report.

### Orbit lines skewer their bodies by design

The bodies are opaque spheres that write depth. The orbit and ring lines test depth, and the r128 log-depth shader falls back to normal depth for the orthographic map camera. The line segment inside a body is therefore hidden. But an orbit line passes through its body's centre, so on screen it enters one side of the disc and leaves the other. That reads as a skewer at every zoom where the disc is wider than a few pixels.

### Two update loops run slower than the frame rate

A third probe tracked route vertices on screen frame by frame for 150 frames:

| View | Line | Behaviour |
|---|---|---|
| Whole system | Flown trail tip | Still for 114 of 149 frames, then jumps 3.8 px on average and up to 7 px |
| Earth focus | Flown trail tip | Still for 65 of 149 frames, then jumps 60 px on average and up to 112 px |
| Mars focus | Planned route | Still between rebuilds, then jumps 7.0 px every 200 ms |
| Whole system | Planned route | Jumps 0.4 px every 200 ms (not visible) |

The causes are in `draw()` (`site.html:1690`, `:1691`):

- `rebuildRoutes()` runs every 200 ms. Routes inside a planet's system are drawn where the planet is at rebuild time. The planet keeps moving every frame, so the route lags behind and then snaps. Mars moves about 0.23 scene units per sky day, which is 7.8 px per 200 ms at the Mars focus zoom. The measured jump is 7.0 px.
- `updateFlown()` runs every 100 ms. The trail ends where the ship was at update time, while the ship itself moves every frame. On fast hops inside a system the tip trails the ship by up to one update.
- `setLine()` (`site.html:1234`) disposes the old geometry and allocates a new one on every update, for every flight. This churns GPU buffers and garbage at 5 to 10 Hz.

### Sources of noise

- Every line is a `GL_LINES` hairline. Width is one device pixel, so it is half a CSS pixel on a DPR 2 screen. A hairline that moves by less than a pixel flickers between pixel rows even with MSAA.
- Dash size follows zoom every frame (`site.html:1692`). Dashes are measured from each line's first vertex, so a zoom or a rebuild slides the whole pattern.
- Many lines draw at once with no budget by zoom. The whole-system view draws 7 grid rings, 12 spokes and 10 orbits. Each flight adds its full route and its flown trail. Each booking adds a dashed line. Moon rings join below `RIG.dist` 45. Grid rings at 0.5 to 30 AU still draw at a planet focus, where they carry no meaning.

### Station markers

Stations on the home map are cyan (`0x5cc8ff`) wireframe octahedra at 85% opacity (`site.html:1565`). The flight page uses the same shape in `0xdfe6ee` for real places and `0xffb65c` for fictional ones (`flight.html:1023`, `:1041`). A wireframe solid at 3 to 10 px reads as a tangle of lines.

## The lever: one screen-space line module

The flight page already has the right primitive. `trailOf()` (`flight.html:972`) draws each segment as an instanced screen-space quad with a width in CSS pixels, analytic edge antialiasing and a per-vertex time attribute. The fragment shader cuts the line at a `now` uniform, so the flown part grows every frame with no rebuild.

Promote it to `design/assets/sol-lines.js`, beside `solar-map.js`, with node tests in `connector/test/sol-lines.test.mjs`. The data shape is one static geometry per line, built when the line's shape changes, never on a clock:

- Per vertex: position, plus a scalar `s` (sky time for routes, orbital phase for rings).
- Per line uniforms: colour, width in CSS px, opacity, `now`, dash period in `s`, and up to two gap centres with radii in px.
- Per leg uniforms for routes: the two end corrections and the anchor that `shipC()` already computes (`site.html:1330`). The shader applies `base + (1 - f) * e0 + f * e1 + anchor`, the same formula `shipC` uses, so a route moves with its planet and meets its moving moon or station every frame without a rebuild.

The pure parts get unit tests the way `solar-map.js` does. These are the ring sampling window, the gap ramp, the dash period per zoom octave and the line budget table.

## Steps

Each step ends in a check. Alvin eyeballs each one in his own browser before the next starts.

1. **Resample moon rings around the map time.** Sample each ring over half a period either side of `MAPJD`, so the seam sits opposite the moon. Resample when `MAPJD` moves more than 5 sky days from the ring's epoch (at 7 days the Moon's drift is still 0.0%). This costs 120 position calls per ring per 5 seconds. Check: the drift probe reads at most 0.5% at every time out to 3000 sky days.
2. **Build `sol-lines.js` and move orbits and grid onto it.** Each orbit line and moon ring gets a gap around its own body: alpha 0 out to the disc radius plus 2 px, ramping to full by the disc radius plus 10 px. A ring sampled around `MAPJD` gets a gentle trail fade, full behind the body and 40% ahead. Widths are 1 px for the grid, 1.25 px for orbits and 1.5 px for routes, at every DPR. Check: the probe still reads at most 1 px from each body to its line, and the line's alpha is 0 inside the gap.
3. **Move routes onto it.** Build one geometry per flight when its plan changes. Split flown from planned with `now = F.jd` in the shader. Drive the end corrections and the anchor with per-leg uniforms every frame. Anchor dashes to sky time, with the period snapped to zoom octaves. Then delete `rebuildRoutes`'s 200 ms timer, `updateFlown`, `setLine`, `DASHED` and the per-frame dash update. Check: the jitter probe finds no frame where a route vertex is still and then jumps more than 1.5 px, and the trail tip is within 1 px of the ship.
4. **Set a line budget by zoom.** Grid rings and spokes fade out above a set zoom into one system. Moon rings fade in between 12 px and 40 px ring radius. Unselected flights show a short trail behind the ship; only the selected flight shows its whole route. The table lives in `sol-lines.js` with a unit test. Check: count the lines drawn at the whole-system, Earth focus and Jupiter focus views before and after.
5. **Replace the station wireframes.** Use a screen-space dot with a thin ring, about 8 px, white for real places and amber for fictional ones, as the flight page already colours them. Stops on a selected route keep their diamond, so the two stay distinct. Selection and hover add an outer ring. Check: no `OctahedronGeometry` in either scene.
6. **Move the flight page onto `sol-lines.js`.** Its path, trail, planned legs and rings switch over, and its station markers get step 5's marker. Check: the same probes, run on `/flight`.

## Verification lever

Commit the probes as `tools/media/probe-lines.mjs`, next to `capture.mjs`. One run against `wrangler dev` reports:

- the distance from each body to its line at the whole-system view and four focus views;
- the moon ring drift out to 3000 sky days;
- frame-to-frame route and trail continuity, and the gap from the trail tip to the ship.

Each step's check is a threshold on this report, so a reviewer can rerun it.

## Not in scope

- No engine changes. The Moon's ephemeris is right; the map was sampling it once.
- No change to `solar-map.js` projection or the camera rig.
- Dark SOL and Design F colours stay. Widths and opacities change; hues do not.

## Decisions for Alvin

- The trail fade on orbit rings in step 2 is a look change. The alternative is uniform rings with only the gap around the body.
- The station marker in step 5 is a proposal. The alternative is a small filled diamond, which would then need a different stop marker.
