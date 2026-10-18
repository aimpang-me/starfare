# ISS → Lunar Data Center evaluation design

## Work plan

- [x] Ground the inclined ISS source, lunar ephemeris and destination orbit.
- [x] Compare two numerical designs and cross-review the choice.
- [x] Implement a bounded offline study, preserving the fleet and runtime.
- [x] Evaluate flight/fuel and independent arrival/clearance evidence; retain unresolved cases.
- [x] Reconcile the results and report concrete options before a fleet change.

The user authorized evaluation, not fleet replacement or deployment. Continue the 500/1000/2000 kg final nonburned mass comparison using the shared 1700 N / 321 s chemical proposal. Trip times must include all finite maneuvers and coast; launch wait is separate. A failed search is unresolved, not proof that no trajectory exists.

## Boundary and rubric

The current source is the model ISS circular orbit at 420 km altitude and 51.6° inclination, with a fixed epoch phase. The destination is the fictional Lunar Data Center's 100 km circular lunar orbit and its moving phase. Moon motion comes from the existing DE421 ephemeris, not a freely rotated circle. Free initial spacecraft phase or ignored lunar capture/plane changes cannot support a station-rendezvous claim.

Score candidate designs 0–2 each: fixed 3D boundary/launch-clock correctness; finite thrust/mass and Earth–Moon dynamics; bounded reproducible search; independent arrival and numerical evidence; simple offline ownership/no production mutation.

## Grounding and synthesis

The independent `how` explanation confirms the fixed source and target clocks, different orbit planes, and DE421-based Moon motion. The previous Phobos analytic wait is not applicable. `sol-engine.js:39–112` owns the decoded Chebyshev table; `crosscheck_py.py:138–188` contains an existing decoder/evaluator, but that script has import-time SPK dependencies. A lightweight offline copy must be cross-checked directly against the Node engine, including adaptive segment boundaries, rather than requiring a new external ephemeris.

Use Earth-centered 3D dynamics: Earth gravity plus moving Moon and Sun direct-minus-origin terms throughout flight and capture. The time-dependent field has no conserved circular-frame Jacobi quantity. The old local plan's ~5-day flight and 3.898 km/s impulse demand are baseline estimates only. At 1700 N, increasing carried fuel lengthens the LEO burn, so gravity loss and multi-revolution departure must be solved rather than adding E/P to the old coast.

A bounded first study used prescribed 3/5/7-day durations. During implementation these became search centers with ±12 hours of flight freedom, so departure timing and the fast-moving lunar station need not force an artificial exact-day arrival. Report the actual integrated duration, never the center as an achieved flight. Multiple perigee burns remain an alternative for improving the restricted control family. Failed searches remain unresolved; disclose the launch epoch and wait.

## Usage and synthesized shape

```powershell
node audit/option-b-lunar.mjs --case 500kg-3day --out audit/option-b-lunar.json
# Fresh search, rather than replaying saved numerical controls:
node audit/option-b-lunar.mjs --mass 500 --flight-days 3 --budget-seconds 420 --out audit/option-b-lunar.json
```

The Node shell extracts the source/target circular-orbit bases from the engine, supplies the encoded current ephemeris and gates the returned endpoints against the engine itself. `lunar_ephemeris.py` decodes only EMB/Moon data and evaluates the source Chebyshev polynomials and derivatives directly. `option-b-lunar.py` owns 3D dynamics, bounded launch ranking, continuation and rendezvous evidence. `option-b-lunar-cases.json` retains small, reproducible control records for verified examples. No production code imports this study.

The implemented boundary is one JSON request/report over a Python subprocess. `LunarStudy.endpoint`, `mismatch`, `fit`, `replay` and `verify` are private numerical operations; the Node CLI hides their arrays. An unresolved numerical report exits normally and has an explicit status: exit zero alone never establishes a flight.

The independent cross-judge scored A's two-burn continuation design 8/10 and B's split-perigee multiple shooting 10/10, and selected A with B's forward/backward matching grafted immediately. The parent agrees: propagate departure and half-coast forward from the exact ISS state, capture and half-coast backward from the exact lunar station state, and match six Cartesian components at one time. This avoids a full-flight capture sensitivity while retaining a small six-unknown solve. Split-perigee burns remain the fallback if the restricted two-burn family fails.

The six physical controls are departure/capture log mass ratios `qD,qC >= 0`, and two constant RTN steering angles per burn. At exhaust velocity `ve`, exact burn durations are `tC = mf*expm1(qC)/flow` and `tD = mf*exp(qC)*expm1(qD)/flow`; initial mass is `mf*exp(qD+qC)`. Both coast arcs carry the same capture-start mass. Departure RTN is Earth-relative; capture RTN is Moon-relative, including Moon velocity. Backward integration retains physical thrust and negative mass derivative; only time runs backward. Both burns stay on their side of the midpoint.

Seed with existing Izzo Lambert code at a small final mass, continue perturbations to full Moon/Sun gravity, then increase mass. Reduced-gravity or small-mass results are numerical seeds only. Launches are ranked from a 30-minute grid over a 30-day window and locally refined. Continuation uses bounded least squares, at most 60 optimizer evaluations per stage, adaptive force/mass increments and an explicit wall budget. A wall budget preserves accepted checkpoints. Only full-force, requested-mass continuous replay can establish a reported flight.

## Reconciliation during numerical work

- A prototype cubic Hermite table crossed adaptive ephemeris boundaries and introduced about 12.7 m Moon position / 0.064 m/s velocity error. It was removed. Direct source evaluation passes boundary and off-grid parity probes.
- Capture direction changed rapidly as Moon gravity increased; angle coordinates stalled. The optimizer now uses Cartesian RTN log-impulse vectors, decoded to the same physical steering law.
- Finite departure burns alter the useful launch phase. Two clock controls now recompute both true endpoints: launch correction and flight correction. The initial ±2-hour launch bracket limited the 2,000 kg continuation, so the final bracket is ±6 hours, clipped to the declared 30-day window. Flight correction remains ±12 hours around each center.
- Near-zero relative finite-difference steps concealed clock sensitivity. Clock Jacobian steps now have a 0.01-second floor. Weak per-stage clock regularization stabilizes the underdetermined solve; it is not a fuel objective.
- A stage is a checkpoint when its physical mismatch meets the declared threshold, even if the optimizer stops at its evaluation cap or the endpoint callback. Optimizer status, physical/augmented Jacobian singular values, controls and residuals remain in the raw report. Checkpoints do not bypass final verification.

## Acceptance gates

Refine at full gravity, then continuously replay departure, coast and capture from the exact source with DOP853 and RK45. Require each arrival within 10 m / 0.01 m/s; method disagreement below 1 m / 0.001 m/s; relative mass imbalance below 1e-9; Earth/Moon radial-minimum disagreement below 1 m. The second replay reduces coast steps from 1,800 to 900 seconds and burn steps from 60 to 30 seconds, with tighter tolerances.

Locate radial extrema with event bracketing, including segment endpoints and integration nodes. Both replays must remain above the 100 km Earth and 1 km Moon numerical guards. These are collision guards, not mission margins. Node separately checks the actual optimized ISS and lunar-station clocks, including position and velocity. Ephemeris checks include both endpoints and every crossed adaptive boundary. DOP853/RK45 check integration of a shared force implementation; they do not independently validate the physical model.

The process wrapper records ownership, streams progress, enforces a watchdog and checks child completion. Replays use the same acceptance gates as searches. Source hashes and numerical library versions accompany the report. The independent post-result review found no acceptance defect in the first 500 kg case and specifically checked launch/arrival clocks, backward mass accounting, continuous replay and station reconstruction. It required explicit model accuracy limits, launch waits and the remaining fuel/schedule optimization work. Results and practical limits are in [the evaluation](OPTION-B-LUNAR-EVALUATION.md).
