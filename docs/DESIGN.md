# Starfare design

## Current look: Mission Control (2026-10-19)
The website (`connector/src/site.html`) and the flight page (`connector/src/flight.html`) use **Mission Control**: the map fills the screen, and flat, quiet panels float over it. It came in with PR #16. The pilot camera, Layers menu and line work came in with PR #19. Each page still carries its older inline Design F tokens. `design/assets/mission-control.css` loads after them and overrides them, so that file is the source of truth for the look. `mission-control.js` holds the shared behaviour. Interface decisions, evidence and open limits are recorded in `docs/design-audit/2026-10-17/DESIGN-HANDOFF.md`.

### Tokens (`mission-control.css` `:root`)
| Token | Value | Use |
|---|---|---|
| `--bg` / `--bg-2` | `#06090d` / `#0b1016` | page and map background / raised surfaces |
| `--glass` | `rgba(9,14,20,.94)` | floating panels (nearly opaque, no backdrop blur) |
| `--line` / `--line-2` | `#26323e` / `#465565` | hairlines / stronger borders and focus-adjacent edges |
| `--ink` / `--ink-2` / `--ink-3` | `#edf1f5` / `#aab6c3` / `#96a4b3` | text: primary / secondary / tertiary |
| `--cy` = `--ride` | `#9cc3df` | cool accent: selection, flights, pressed states |
| `--sun` = `--me` | `#e7c48c` | warm accent: the Sun, the player's own items, Fictional |
| `--r` | `4px` | radius (2–3px on small chips and nav items) |
| `--cond` = `--mono` | Inter | the older Rajdhani and JetBrains Mono slots now point at Inter |

- **Type:** Inter only, self-hosted as `/assets/InterVariable.woff2` (OFL, `design/assets/Inter-OFL.txt`). Headings use sentence case with no letter-spacing, for example `600 13px` panel titles and a `600 21px` map title. Small caps labels are `11px` with `.07em` tracking. The wordmark is `650 16px` with `.2em` tracking. Map labels are 10–11px and scale with the Layers size setting (`--ls`: 0.85 / 1 / 1.2).
- **Surfaces:** flat. No glass blur, no glow shadows, no corner brackets (`.panel:before/:after` are off). A selected card gets `#13212d` with an inset 2px `--cy` bar on the left.
- **Controls:** buttons are at least 40px high, or 36px for `.small`. Primary buttons are `#17222d` on a `#526576` border. Segmented controls mark the pressed option `#1b2937`. Focus shows as a `2px #d6e7f4` outline.
- **Tags:** Real / Fictional / Simulated / Demo chips on every place, ship, passenger and number that needs them. They are 9px, sentence case and outlined. Honesty labels stay visible, for example "Map speed only; the game clock is unchanged · Simulated".

### Layout
- **Home (`.mc-home`):** a 60px top bar holds the wordmark, "Mission control" and Connect your agent. The map is full-bleed underneath. The left panel holds Bookings and Flights, 280px wide. Activity sits top right at 300px, and selection details appear bottom right. A planet dock runs along the bottom centre, the map controls (+ − ⊙ Map info) sit bottom right, and the HUD time readout sits bottom left (on phones it sits above the planet dock and drops the scale and keyboard-only lines). A 50px bottom strip holds pause, the clock, map speed, and Fleet / Agent tools / Alerts / Reports / Hide panels. Fleet and the rest open a 360px drawer.
- **Flight page (`.mc-flight`):** the replay stage and a 300px passenger list sit side by side, with the replay bar under the stage (play, scrubber, speed, Overhead/Live, Layers). The receipt, timeline, raw log and dispatcher log follow below.
- **Mobile (≤760px):** bookings come first. Panels become a bottom sheet with Bookings / Flights / Activity tabs, the strip collapses into an Operations menu, and Earth–Moon drops out of the focus control. Every page should work at 360px with no horizontal scroll.

### Map
- **Camera:** the home map uses a true-scale perspective pilot camera, with real distances and sizes. Bodies too small to see get a few-pixel floor. You can follow a ship in chase or cockpit view. Controls: drag or right-mouse to look, W A S D to fly, Space up, Ctrl down (only while the map has the pointer or focus, so Ctrl shortcuts keep their browser meaning elsewhere), Shift to boost, wheel or `[` `]` for throttle (with the right button held), Home for the whole system, H for Clean view. Right-click opens a map menu. The flight page's Overhead view is **not** to scale, and its note says so.
- **Layers** (`design/assets/sol-layers.js`, saved under `sf-layers` and shared by both pages): planet, place and Starseeker names; orbit lines, moon rings, path lines (all, or only the selected one) and the distance grid; the time readout; name size; arrival framing (Close / Medium / Far).
- **Lines** (`design/assets/sol-lines.js`): orbits are GPU conics drawn from one style table. Orbit and moon rings are full brightness just behind the body and 40% just ahead, with feathered edges and a gap around the body (Alvin, 2026-10-19). Flown legs use stored arcs. Unflown legs are dashed straight guides labelled as guides.
- **Markers:** a station is a screen-space dot with a thin ring, white for real places and amber for fictional ones. A ring appears on selection and hover. Route stops keep the diamond (Alvin, 2026-10-19). Docks at stations are labelled placeholder art.
- **Ships:** Starseekers are three fictional hulls, Kestrel, Lantern and Tandem (`design/assets/models/*.glb`, mapped from engine classes in `fleet.json`). They are not production-approved (`productionApproved: false`). Ships are sized against the body beside them and drawn clear of it when parked.
- **Bodies:** every mapped planet and moon has 1K/2K textures (4K close up). Earth and the Moon have relief normals, and Earth has clouds. Other worlds get declared rough, icy, haze or gas treatments (`planet-effects.js`, `planet-assets.json`, `CREDITS.md`). Surface rotation and clouds are slowed for viewing and labelled as such.
- **Map speed:** Live (1 day/s, the default, so the map keeps pace with the sky clock), Slow (0.25) or Calm (0.1). It changes only the map's presentation clock, never the game clock. When slowed or paused, the readout says "Map time · slowed" or "Map paused" with the map date instead of "Live sky".

### Motion
- Two clocks: the simulation/replay clock comes from recorded data and is authoritative, and a separate presentation clock is used for decoration only. Decoration never moves a flight, changes a time or implies a physical event (`art/2026-10-17/motion-spec.md`).
- GSAP 3.15 (`design/assets/vendor/`) is used for UI and camera transitions only, never for flight paths or simulation time.
- No camera shake, star streaks or flame plumes. The one engine effect is a faint ion glow labelled "Ion glow illustrative: thrust not recorded" (Alvin, 2026-10-18; `docs/VFX-PLAN.md`).
- Parked ships bob and sway by a few pixels, out of step per ship (Alvin, 2026-10-20). It is decoration only: it never moves the recorded position and is never used for holds.
- `prefers-reduced-motion`: replay starts paused, the map starts paused, camera moves are instant, and parked-ship drift and surface rotation are frozen.

### Not yet on Mission Control
- `/bench` (`connector/src/bench.html`) still uses Dark SOL: Google-hosted Inter, 14px radius, glass and white hairlines.
- Open Sky (`world/template.html`) still uses Dark SOL, draws the generic coupe (`CAR`), and still has ride/hail/rider copy.

## History
- **Dark SOL** (2026-10-16): Open Sky's look and the first public site. It used glass panels with blur, white hairlines, Inter from Google Fonts and a 14px radius. Tokens: `--bg #06080c`, `--glass rgba(18,22,30,.72)`, `--line rgba(255,255,255,.12)`, `--ink #eef1f5`, `--sun #ffb65c`, `--me #ffcf7a`, `--ride #9cc3ff`. Alvin chose it over the Terminal look for the whole site. No style toggle.
- **Design F** (2026-10-17, from `design/mockups/f-ops-3d.html`): an ops console with a three.js map. It had blue-tinted tokens (`--bg #050a14`, `--line rgba(120,180,255,.14)`), a 6px radius and Rajdhani + JetBrains Mono + Inter. It is still the base of the inline styles that Mission Control overrides.
- **Studies** (`docs/design-variants/2026-10-17/`): Mission Control, Orbital Desk and Departure Lounge. They are historical. Their demo curves and durations must never become flight physics.
- **Alvin's reference mockups** (`world/refs/`, `mocks-grok/`): the original layout reference for Open Sky. Do **not** copy their SpaceX/Tesla wording or car, the made-up times and prices, the "sol.space" domain, or Careers/Log in.
- **Portfolio "Alvin Impang Terminal"** (https://claude.ai/artifact/SehVRJjqmPB1CRkyzXKtGe): near-white terminal printout, Departure Mono, square corners. It is the portfolio's system and is used only by the Roadster teaser. Departure Mono lacks ✓ ✕ ▶ ●, so put those in fixed 2ch spans with a fallback font.

## Decision: the ships are Starseekers (2026-10-16)
The vehicles are ships called **Starseekers**, not flying cars ("Starseeker SF-07 is en route to Titan"). Copy and art say Starseeker. "Ship" is the generic word, and fleet call signs (SF-07) stay. The art is an original ship design: not SpaceX Starship's steel rocket shape, not a Tesla, not a copy of any Star Citizen ship. Agent-facing tool fields and run-log JSON (`car`, `par_car`, ...) keep their names so Grok runs, old ride logs and tests keep working. Names rejected as taken: Starship (SpaceX), Starfarer (Star Citizen), Starfinder (Paizo), Cutter (Star Citizen). Still open: a trademark search on "Starseeker" before launch.

Shared flights (decided the same day): a Starseeker carries several people. A booking can be a party, a ship has seats, and one ship can pool several bookings with several stops. Art and copy should show a cabin with seats and a passenger manifest, not a single passenger.

## Decision: flights, not rides (2026-10-16)
Copy says **flight** for the journey, **booking** for a request (was "hail") and **passengers** (was "riders"): "Flight SF-07 to Titan, 4 passengers". "Ride", "ride hail" and "rider" leave all user-facing copy, including verbs ("Follow ship", not "Ride along"). As with `car`, agent-facing tool names and fields and run-log JSON (`take_hail`, `ride`, `rider`, `starfare.ride/1`) keep their names until a versioned rename, so Grok runs, old logs and tests keep working.

## Rules
No Tesla/SpaceX/xAI logos or claims; "Works with Grok" as text only. Label everything simulated. Keep the honesty gate visible.
