# Fuel/power ledger verification

2026-10-17. Verification authorized by Alvin. Fleet and live physics remain unchanged.

## Focused results

`cd connector; node --test test/propulsion-ledger.test.mjs`: **57 passed, zero failed** after the numerical correction below. Includes 120 deterministic multi-leg scenarios inside one test. That scenario count is not 120 additional test cases or independent random trials.

The hand-solvable fixtures use a synthetic 1000 m/s exhaust velocity and delta-v increments of `1000 * ln(2)`, so burns halve total mass. Expected results use integer mass ratios and conservation, rather than the implementation's exponential recurrence:

- 100 kg dry mass, no reserve: one burn needs 100 kg xenon; two successive burns need 300 kg, not 200 kg.
- Two burns with a protected 20 kg reserve: 380 kg initial xenon, 360 kg consumed, 20 kg remaining.
- Changing known boarding loads over two legs: 560 kg initial fuel, burns consume 380 and 170 kg, 10 kg remains.
- Explicit 100 kg intermediate refuel: 140 kg initial fuel, 230 kg consumed, 10 kg remains. A 200 kg refill carries surplus fuel into the next burn instead of resetting inventory.
- A synthetic 1 N thrust, 0.001 kg/s flow burns 100 kg in 100000 s, consuming 27.7778 kWh at 1000 W.

These values are arithmetic fixtures, not fleet specifications or invented passenger data. Tests also cover missing mass/power provenance, load/unload dependencies, conditional versus necessary failures, constant and inverse-square solar power, all five sourced NSTAR points, exact timing boundaries, zero burns, depletion, malformed inputs, numeric overflow, immutability, slim-record rejection, actual SF-01/SF-04 plans and unchanged engine/suite identity.

## Defect reproduced and corrected

A new Julian-date boundary test failed before the fix. An intended 100000-second interval near JD 2461700.5 is represented as 99999.99998062849 seconds, a **19.37 microsecond** discrepancy. Comparing with a fixed 1e-8-second tolerance incorrectly labelled that equal budget infeasible.

The diagnostic comparison now bounds rounding at both Julian-date endpoints using their magnitude and `Number.EPSILON`. The regression passes at three representative epochs, and a one-second-short interval still fails. Both forward and backwards minimum-duration assessments use the same tolerance. No trajectory, engine performance, score or fleet parameter changed.

## Full regression run

The final fresh run used the corrected source and completed on 2026-10-17 Toronto time (2026-10-18 UTC):

| Command from `connector/` | Result | Exit | Completed UTC |
|---|---|---:|---|
| `node --test test/*.test.mjs` | **202 passed**, zero failed, cancelled or skipped; 480573 ms | 0 | 02:03:19 |
| `node test/e2e.mjs --mode=both` | **43 of 43 passed**: OAuth off 26/26, OAuth on 17/17 | 0 | 02:03:45 |

The 57 focused ledger tests are included in the 202 unit total. The Worker checks exercise the existing live-game code in a local workerd instance; they establish regression coverage, not runtime integration of this diagnostic ledger.

An earlier run was deliberately stopped after the new regression/fix so the final run includes the corrected source and all 57 tests. A first launcher attempt failed before tests because Windows backslashes were parsed out of a NODE_OPTIONS preload path; the helper now uses forward slashes. Neither incomplete launch is counted as passing verification.

Logs and process ownership records are in `connector/.wrangler/ledger-verification-*`. No private benchmark key is used by the ledger tests. The Worker harness uses its existing throwaway local test key.

The final ownership check at 02:03:53 UTC matched recorded PIDs and process creation times and found **zero active owned processes and zero owned listening ports**. Both final stderr logs are empty. Source and copied engine SHA-256 remain `13f5c2f0d2187b352d67d914057c54fb320aed3b020e642758478bd11dda8d65`, matching the existing suite; score version remains 3. No fleet, runtime engine, suite, hosted secret or deployment was changed.

The seven-case ledger artifact and the three-route ship comparison were regenerated successfully. `git diff --check` also passed.

## Scope

This verifies accounting and diagnostic bounds. It does not certify finite-thrust trajectories, continuous solar power, storage, coast/life-support consumption or a new vehicle design. [Concrete ship options](FLEET-OPTIONS.md) are proposals only; none is selected or installed.
