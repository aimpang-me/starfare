# Shared-flight timing correction

Engineering follow-up to PR #13, based on `575ce90`. No page layout changes, merge, deployment, or hosted secret changes.

## Cause and correction

After landing, `arrivePhase` previously respected the actual landing time only when someone boarded. A delayed drop-off or a stop without passenger events could advance to the next leg's original departure in the past.

Every continuation now departs no earlier than actual landing. Boarding still adds `DWELL` (0.05 simulated days); a drop-off adds no boarding dwell. Later scheduled departures remain later. Diversions retain their separate alternate-pad wait and return planning. Late interplanetary legs still use the existing launch checkpoint and correction-burn rules.

This changes simulation outcomes, not the underlying trajectory planner or score weights. Existing persisted flights are not rewritten; PR #13's recorded-timing warning remains useful for older records.

## Reproduction

Run `node audit/shared-flight-timing.mjs` from the repository root. The script opens the real connector game with SF-04, bookings `ceres-shift` and `phobos-commute`, seed `2`, and request JD `2461700.5`. It dispatches four planned legs on default decisions.

All dates below are simulated UTC sky dates, rounded to the recorded minute. The original overlap was 37.7 minutes, measured from unrounded Julian dates.

| Event on 2030-07-23 | Before | Corrected |
| --- | --- | --- |
| Ana lands at Mars Base | 01:00 | 01:00 |
| Empty pickup leaves Mars Base | 00:22 | 01:00 |
| Ravi boards at Phobos | 02:36 | 03:14 |
| Passenger leg leaves Phobos | 03:48 | 04:26 |
| Ravi lands at Mars Base | 06:02 | 06:39 |

The local hop durations and boarding dwell are preserved. This case still uses 61,412 kWh; Ravi's fare stays $1,079.11. His promise slip becomes 0.6 hours because the quoted arrival is unchanged and the actual arrival is later. The diagnostic now reports no overlapping segments for this case; that alone is not a certification of every engine route.

## Local evidence

- Three new regressions failed before the source correction and passed after rebuilding the engine and connector bundle.
- The final timing file covers five cases: the actual shared dispatch, continuation through empty stops, late interplanetary launch and correction, diversion/return ordering, and a later scheduled departure.
- Existing hazard checks: 8 passed. Existing reroute checks: 8 passed, including the unchanged 100-hail reference fixture.
- Focused game/timing checks: 51 passed.
- First full connector unit run: 141 passed, one failure. The failure was the expected shared-flight reference score change, from `28333.410804818926` to `28259.1704267676`; that reference assertion has been updated. The final affected rerun passed 65/65. A final full rerun is pending.
- A separate comparison executed both the prior bundle from Git and the corrected bundle against that reference task. Both selected SF-04, the energy plan, no checkpoint choices and 61,412 kWh. Almost all of the 74.240378-point decrease comes from the promise part (74.240366 points); pickup and on-time parts change by approximately 0.000012 points combined. These are deterministic simulation references, not measurements of model ability.

## Engine and benchmark status

`python world/bundle.py`, then `node connector/build.mjs`, rebuilt the source bundle and its byte-identical connector copy. New engine SHA: `13f5c2f0d2187b352d67d914057c54fb320aed3b020e642758478bd11dda8d65`.

Public dev-suite regeneration is running with the existing 80-candidate selection rule in ignored `.wrangler/timing-suite/`. The committed suite has not been relabelled by hand. Its old engine pin deliberately prevents loading it with this new engine.

The existing local key did not reproduce any of the current suite's 16 test-task candidates, including checks for raw text, trimmed text and a removed BOM. The accompanying old private selection file also contained none of those tasks. The user chose to provide the original key locally rather than approve replacement test worlds. Private test regeneration and Worker benchmark integration remain pending that prerequisite. No key, hidden seed, private selection score or private stratum is committed.
