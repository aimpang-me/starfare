# Motion specification and integration contract

Historical dashboard motion specification. The current [living-system motion thesis](LIVING-DIRECTION.md) supersedes its frozen-sky/no-autoplay choice following the user's explicit request for a living solar system. Recorded-flight truth, replay isolation, reduced-motion control and the PR #13 integration hold remain in force.

Motion communicates a user action or new information. It never supplies simulated flight behavior.

| Trigger | Treatment | Duration |
|---|---|---|
| Select booking | Update route/details immediately; fade updated facts and route highlight | 180 ms |
| Filter activity | Fade replaced entries, no moving or looping background | 150 ms |
| Explicit sample arrival | Fade the new entry; no scroll jump, flash or count pulse | 180 ms |
| Open dialog | Opacity plus 6 px vertical settling | 220 ms |
| Close dialog | Opacity only, then restore trigger focus | 140 ms |
| Expand route | Short content opacity transition | 180 ms |
| Step replay | Immediate timestamp/state change | No timeline easing |

Entrances use `cubic-bezier(.16,1,.3,1)`; dialog exit uses ease-out. No idle loops, floating spacecraft, rotating planets, parallax, pulsing dots or engine glow. Pointer hover and focus feedback are immediate. Layout disclosures do not animate height. Switching tabs finishes transient animations; reduced-motion preference bypasses animations, including when changed during the session.

Replay is an explicit local sample, excluded from the dispatcher data and counts. Its three records are 03:00 docked, 03:04 hold, 03:08 hold/checkpoint at Orbital depot. No recorded departure or position change exists, so no spacecraft movement is shown. Controls step one record at a time and disable at boundaries. There is no autoplay or inferred segment.

After PR #13, use the accepted run's recorded timestamps, position samples, hold states, checkpoint events and manifest/stop order. Render the simulation clock directly. Never shorten waits or ease simulated time to improve visual rhythm. Do not derive a departure, burn or arrival from a route line, progress percentage, or elapsed wall-clock time. Engine effects require an explicit recorded burn state and must remain off while coasting, held or docked. Do not emit replay interactions as live dispatcher events.

The prototype's map and image are a presentation reference. Production integration must preserve Engineering's actual orbital model, camera/renderer and event semantics. Coordinate any changes to `connector/src/site.html` and `connector/src/flight.html` after the PR is integrated.
