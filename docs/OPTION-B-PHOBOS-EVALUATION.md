# Option B: Phobos → Mars Base

2026-10-17. **Offline evaluation only; fleet and production physics are unchanged.**

## Flight times and fuel

The proposed departure is a body-fixed Phobos pad on the anti-Mars side, with a 20-second powered outward lift. Arrival matches the fictional Mars Base station **300 km above Mars**, not the Martian surface.

| Final nonburned mass | Pad flight | Fuel + oxidizer consumed | Instantaneous staging reference flight / propellant |
|---|---:|---:|---:|
| 500 kg | **141.6 min** | **245.2 kg** | 137.7 min / 235.4 kg |
| 1000 kg | **143.4 min** | **479.8 kg** | 141.4 min / 471.0 kg |
| 2000 kg | **150.1 min** | **951.0 kg** | 149.1 min / 944.2 kg |

Final mass contains everything remaining after the burns: hull, passengers, equipment, tanks and any unburned reserve. These are comparison masses, not chosen ships. The 1000 kg pad case starts at **1479.8 kg**, consuming **181.1 kg MMH and 298.7 kg oxidizer**. Additional mission margins must be included in the actual vehicle mass budget and recomputed.

The four-engine proposal retains **1700 N thrust, 321 s Isp and 1.65 oxidizer/MMH mass ratio**, from the [manufacturer's nominal engine data](https://www.ariane.group/app/uploads/2024/09/ArianeGroup_Chemical_Bipropellant_Thruster_Family.pdf#page=8). The 1000 kg pad flight contains 14.8 minutes of firing, including lift, and 128.6 minutes of coast. The earlier 14.3-minute impulsive budget was firing time, not trip time.

## Launch wait is separate

At the evaluation epoch **JD 2461700.5 (2027-10-22)**:

| Pad case | Alignment wait | Wait + flight |
|---|---:|---:|
| 500 kg final | 33.8 min | 175.4 min |
| 1000 kg final | **33.9 min** | **177.4 min** |
| 2000 kg final | 30.9 min | 181.1 min |

These waits enforce the actual modeled station phase; the solver does not freely move the ship around Phobos to arrange arrival. Equivalent alignment repeats about every **151.1 minutes** in this circular model. The supported pad can wait for the window. Boarding, docking approach and real facility preparation are outside these times. They are simulated physical times, not a forecast of a real mission or a claim about the application's playback speed.

The reference column starts 21.1 km from Phobos's center, at the anti-Mars point with a specified prograde local circular-speed velocity. It is **supplied at launch**. The 1000 kg reference needs a 36.2-minute availability offset, but access and physical holding at that point are unvalidated and unpriced. It is not a stable parking-orbit service proposal.

## What was solved and checked

Six scenarios: two source conditions × three masses, with three starting guesses each. All **6/6 meet the declared numerical acceptance checks**. These are deterministic scenarios, not statistical trials or application unit tests.

The evaluator integrates Mars gravity, moving Phobos gravity, acceleration of the Mars-centered origin, finite thrust and mass loss throughout lift, escape, coast and arrival. Both main burns are Mars-relative transverse retrograde. It solves three durations for the final circular orbit, calculates the earliest nonnegative alignment wait, then independently replays at the actual launch epoch and checks position **and velocity** against the engine's station.

- Largest engine station match error: **0.064 m / 0.000059 m/s**, including Julian-date representation.
- Independent rotating-frame versus inertial endpoint difference: below 0.00000051 m. The rotating equations include Coriolis/centrifugal terms and separately check coast conservation and thrust work.
- Refining RK4 steps from 2 s to 1 s changes position by at most 0.000017 m. Coast Jacobi drift is below 5.1e-15; thrust-work discrepancy below 2.6e-14; mass-balance error below 2.6e-10 kg.
- Clearance extrema and their times are retained. Changing inertial maximum step from 60 s to 5 s and comparing both rotating replays changes reported minimum clearance by less than **0.0000027 m**. All clearances remain positive relative to the assumed envelope. The pad begins with a declared 1 m clearance above that envelope; this is an idealized ignition boundary, not a certified terrain clearance.
- Three-start flight spread is below 1.1e-9 s; propellant spread below 3.5e-10 kg. The bounded control search does not establish minimum-time or minimum-fuel optimality.

## Assumptions needing review before production

The pad is a **proposal**, not a known landing site. A 13.5 km spherical exclusion envelope encloses the assumed 13.5×11×9 km ellipsoid, inferred from [NASA/JPL's approximate Phobos dimensions](https://www.jpl.nasa.gov/images/pia04589-phobos-over-the-martian-limb/). Clearance checks apply to this assumed envelope, not measured terrain or a spacecraft's full dimensions. Point-mass Phobos gravity is not its measured surface gravity field.

The planar model preserves the engine's prescribed Phobos radius and period. That period is about 10.06 seconds shorter than the Kepler period implied by the same GM/radius, so this is a prescribed-motion approximation, not an exact circular three-body ephemeris. Real inclination, irregular gravity/terrain, Mars oblateness, solar perturbations, navigation errors, tank/pressure/thermal/power design and operational margins remain outside the study. Small numerical residuals do not remove those physical uncertainties.

**Recommendation:** Option B supports this proposed pad-to-orbital-base transfer in the stated model. Review pickup facility, vehicle mass, separate fuel/oxidizer tanks and reserves before choosing a fleet profile. The production Phobos endpoint is unchanged.

## Reproduce / delivery evidence

```powershell
node audit/option-b-phobos.mjs --out audit/option-b-phobos.json
# Optional: --mass 1000 or --python <executable with NumPy/SciPy>
```

The generated JSON contains full inputs, all six schedules, launch waits, budgets, numerical thresholds, seed outcomes, minima/times and residuals. See [design and independent review](OPTION-B-PHOBOS-DESIGN.md). Existing NumPy 2.4.4 / SciPy 1.17.1 were used; no dependency was installed.

The final six-case run exited 0 at 02:27:38 UTC. Recorded Node/Python processes, including the observed Python launcher child, were absent at 02:28:19 UTC. No server was started. Engine source and connector copy retain SHA-256 `13f5c2f0d2187b352d67d914057c54fb320aed3b020e642758478bd11dda8d65`; fleet, suite and score are untouched. `git diff --check` passed. No application test suite, deployment or hosted configuration change is claimed for this evaluation.
