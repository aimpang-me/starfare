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
- First full connector unit run: 141 passed, one failure. The failure was the expected shared-flight reference score change, from `28333.410804818926` to `28259.1704267676`; that reference assertion has been updated. The affected rerun passed 65/65. Full unit reruns passed 142/142 with no failures, skips or cancellations before the later harness regressions were added. The latest completed full-run count is recorded in PR #14.
- Both GitHub Python regression gates passed on the code commit `3672ba2` and documentation commit `3c3f4a1`.
- Follow-up Worker OAuth integration passed 17/17 against the actual regenerated public dev suite. A separate both-mode Worker run passed 43/43 against an explicitly local integration fixture (five public dev tasks per split, a fixture suite ID, and the harness's throwaway test key). These check real Worker/MCP/OAuth/storage/booking/replay wiring; they do not validate the private benchmark worlds or reference values. The committed combined suite was restored byte-for-byte in `finally` after each run. Test processes exited and the recorded Worker ports were released.
- With the complete regenerated suite, the first Worker run passed 40/43. Two checks wrongly assumed the first quick seasonal booking was physically bookable; its tank was too small. A third oracle compared a checkpoint flight to `R.fly`, omitting the simulated reply delay. The harness now selects an actually bookable quick booking, fails on unexpected server errors, and compares checkpoint flights with `R.start`/`R.step`. A frozen Ceres fixture reproduced the reply-delay mismatch before that correction; all eight affected timing/harness unit checks passed afterward. The corrected full Worker rerun passed 43/43 against the actual combined suite, using the harness's throwaway local test key.
- A separate comparison executed both the prior bundle from Git and the corrected bundle against that reference task. Both selected SF-04, the energy plan, no checkpoint choices and 61,412 kWh. Almost all of the 74.240378-point decrease comes from the promise part (74.240366 points); pickup and on-time parts change by approximately 0.000012 points combined. These are deterministic simulation references, not measurements of model ability.

## Engine and benchmark status

`python world/bundle.py`, then `node connector/build.mjs`, rebuilt the source bundle and its byte-identical connector copy. New engine SHA: `13f5c2f0d2187b352d67d914057c54fb320aed3b020e642758478bd11dda8d65`.

Both suite splits were regenerated with the existing 80-candidate selection rule: 20 public dev tasks and 19 held-out test tasks. The combined suite and public dev selection report replace `connector/src/suites/v1.json` and `v1.selection.json`. The source bundle, connector copy, metadata and suite SHA match exactly. No SHA was relabelled by hand.

The 80 candidates include one opening error and six without a reference plan. The opening error is `titan-home/6491`: the season ends too soon. A separate run against both `575ce90`'s engine and the corrected bundle reproduced the same refusal, so it predates this change. The prior public selection report still contains the older 100-point, seven-part scoring results despite the committed suite's newer score-version pin. Consequently its old 18-task selection is not a valid current benchmark comparison. The fresh selection uses the current score rules; no improvement in model ability is claimed.

The previous local key and private selection did not correspond to the earlier committed test tasks. The user subsequently approved a new key. A cryptographically random 256-bit key was saved in `C:\Users\PC-AIMPANG\starfare-private\bench-key.txt`; the previous file was preserved. Private selection reports are in that same external directory (`v1.test.selection.json` and `v1.timing.test.selection.json`), with the previous canonical report preserved too.

Validation reproduced the new key's 80-candidate task list, checked the public test-task fields against the metadata-only schema, and scanned changed tracked files for the key value. A completed nonzero test trace replayed successfully with the real new key and failed verification with a wrong key. That trace and its hidden results remain outside Git. No key, hidden seed, private selection score or private stratum is committed.

## Release handoff

PR #14 remains stacked on PR #13. Merge and deployment require the user's authorization. A later approved deployment must set the Worker's `STARFARE_BENCH_KEY` to the new local key that cut this suite. Earlier test worlds and traces require their matching prior suite and key; they are not comparable to the new cut. No hosted secret update or deployment was performed here.

Engineering helpers record process ownership and close their own children. The completed generator and final Worker processes were checked after exit, and the final Worker ports were released. No preview server is retained.
