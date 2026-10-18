# Solar canvas implementation review

Implemented locally on `codex/design-audit`. No deployment, merge, push, hosted configuration or engine changes.

## Source truth

The [Solar Expanse Steam page](https://store.steampowered.com/app/1369700/Solar_Expanse__Space_Exploration_Manager/) is the dominant visual source: a compact Sun, oblique orbital overview, restrained markers, textured planetary focus and major-object navigation. The screenshots downloaded here are research only; no game artwork is used by Starfare.

Refero provided the bounded UI references: [Chargetrip dark map](https://refero.design/pages/9fb51c18-479b-4da4-8e27-c2ec36034d83), [route planning](https://refero.design/pages/0bc20bfd-5d94-4d60-829d-fe588fdeca82), and [Clay visualization](https://refero.design/pages/8333b544-fbd2-48ce-83ed-27401f108659). Style searches returned no results; the exact research is retained in `refero-research.json`. Decisions were locked in `REFERENCE-LOCK.md` before implementation.

## Changes and impact

| Priority addressed | Change | Result |
| --- | --- | --- |
| P1 | Strategic orthographic map with framing that reserves space for controls and bookings | Full orbital structure remains visible. Camera depth no longer makes a foreground body balloon across the Sun. |
| P1 | Remove inherited `60vh` height from the mobile map | The canvas fills its container and fits the system above the booking sheet instead of shrinking it into the upper corner. |
| P1 | Compact Sun, readable thin orbits, stable body markers, focused planetary context | Worlds reveal their textures on focus; unrelated enlarged planets do not intrude into a local-system view. |
| P2 | Ten-body navigation strip and clickable planet names | Direct navigation to inner and outer worlds; native keyboard buttons, pressed state, 52px minimum touch targets in the phone checks. |
| P2 | Quiet parked-ship labels in the overview, more detail on focus | Planet names and actual flight labels take priority. Ships remain rendered. |
| P2 | Small phone details retained; navigation hides behind a flight selection | The collapsed flight panel measured 84.19px at 390px width. Details remain available through the existing disclosure. |
| P3 | Planet labels outside the sphere, short leaders terminating at its edge, smaller desktop flight list | Less visual interference with the worlds. Bookings stay selected while navigating planets. |

The existing credited textures, original Starseeker model, Inter typography, Dark SOL colors, Bookings default, compact Activity and BYOA flow remain. The star catalog uses angular perspective behind the strategic map, independent of zoom and translation. GSAP continues to animate camera/UI transitions only. Real recorded arcs, flight clocks, holds and arrivals remain authoritative.

`connector/src/site.html`, `design/assets/mission-control.css`, `design/assets/sol-art.js` and new presentation-only `design/assets/solar-map.js` contain this pass. `connector/src/flight.html` was not changed; its default star renderer remains unchanged by the optional home-map backdrop mode.

## Verification

| Evidence | Result |
| --- | --- |
| `tests.tap` | 61/61 tests pass: map framing, flight geometry/routes/headings, booking replay, planning, timing, live data and retained flights. |
| `projection-numeric.json` | 16 actual Three r128 projection cases pass. The app's camera class and SRI-verified library were used to project full orbit rings into the usable frame and compare scale at different depths. |
| `heading-numeric.json` | 15 actual Three quaternion checks pass against the application mapping and a real archived Worker payload. Nose aligns to the flight/orbit tangent; exhaust points aft. |
| `motion-policy.json` | Actual GSAP controller tested in Node: reduced motion snaps to the target without tweening; normal camera motion remains restrained at 0.75 seconds and can be cancelled. This is not an OS-level emulation claim. |
| `browser-qa.json` | 390x844 and 360x740: no horizontal page overflow, map fills its container, all ten thumbnails load. Desktop focus survives the phone-to-desktop resize; Bookings remains selected. Neptune activated with Enter. No console errors captured in the final page. |
| `flight-motion-browser.json`, `solar-real-flight-a.png`, `solar-real-flight-b.png` | Actual local MCP flight `run_d1ea94ad2dc67330fe35`, SF-04, Ceres pickup: captures 16 seconds apart show the real flight clock and changed relative positions. These motion captures precede final background/label polish; geometry and replay timing are the same. |
| Engine build | SHA256 remains `13f5c2f0d2187b352d67d914057c54fb320aed3b020e642758478bd11dda8d65`. |

## Visual QA

Final result: passed for the reviewed scope. Compared the rendered overview directly with the source screenshot: the broad oblique orbit structure, compact warm Sun, quiet background, readable body labels and clear hierarchy are present. The management panels remain Starfare's own minimal interface.

Final captures: `solar-desktop-overview.png`, `solar-desktop-inner.png`, `solar-desktop-earth.png`, `solar-mobile-overview.png`, `solar-mobile-360.png`. Additional outer-world and real-flight captures record the interaction checks. Earlier `v1` captures are iteration evidence, not final targets.

The map still explicitly states that distances are compressed and bodies enlarged. This remains a navigable game map, not a uniform-scale astronomical instrument. The audit does not claim a full accessibility conformance certification or performance coverage across every device. The local flight/data mutations were confined to the local Worker used for review.
