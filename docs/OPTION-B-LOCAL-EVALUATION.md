# Option B: first local flight evaluation

2026-10-17. Offline proposal, saved against engine `13f5c2f0d2187b352d67d914057c54fb320aed3b020e642758478bd11dda8d65`. **Fleet and live physics are unchanged.**

Follow-up: the [Phobos → Mars Base evaluation](OPTION-B-PHOBOS-EVALUATION.md) now supplies finite-thrust flight/fuel results for two explicitly defined Phobos source conditions, with launch wait and remaining assumptions. The headline-booking gap below describes this earlier three-pair study; the follow-up does not validate the old parking orbit or change the fleet.

## Results to review

For **1000 kg final nonburned mass**, four 425 N engines and 321 s Isp:

| Route in the current orbital model | Orbit altitude change | Flight time | Consumed propellant | Engines firing |
|---|---|---:|---:|---:|
| Earth parking orbit → Orbital Depot | 200 → 500 km | **46.6 min** | **56.0 kg** | 103.8 s |
| Mars parking orbit → Mars Base | 200 → 300 km | **55.9 min** | **15.0 kg** | 27.9 s |
| Ceres parking orbit → Ceres Port | 200 → 400 km | **141.5 min** | **11.9 kg** | 22.1 s |

These are integrated burn/coast/burn flight times, not engine-on durations or surface journeys. Most time is spent coasting under central gravity. Doubling thrust alone would not halve that coast.

Propellant means **MMH fuel plus oxidizer**, at a 1:1.65 mass ratio. The Earth example consumes 21.15 kg MMH and 34.89 kg oxidizer and starts at about 1056.04 kg total mass. The final 1000 kg contains all mass that remains: hull, occupants, equipment, tanks and any unburned reserve. It is a normalization, not an approved hull, tank or reserve allocation. Additional fuel margin must be carried in that final mass and the trajectory recomputed for the actual design. Engine data: [ArianeGroup datasheet, page 8](https://www.ariane.group/app/uploads/2024/09/ArianeGroup_Chemical_Bipropellant_Thruster_Family.pdf#page=8).

Departure is assumed to start at the required position on the parking orbit. The evaluator calculates that position and matches the engine's moving fictional station at arrival. **Time to reach the departure alignment, boarding and docking approach are excluded.** Reverse transfers finish in the planet's parking orbit, not at a ground destination. At the displayed precision the reverse flight/fuel values equal the forward values.

## Mass sensitivity

Each cell is **flight minutes / consumed propellant kg**. This is a mass comparison within one control family, not a minimum-time or minimum-fuel frontier.

| Outbound route | 500 kg final | 1000 kg final | 2000 kg final |
|---|---:|---:|---:|
| Earth → Depot | 46.2 / 28.0 | 46.6 / 56.0 | 47.5 / 112.1 |
| Mars → Base | 55.8 / 7.5 | 55.9 / 15.0 | 56.2 / 30.1 |
| Ceres → Port | 141.4 / 6.0 | 141.5 / 11.9 | 141.7 / 23.8 |

## What was evaluated

**18 scenarios**: three same-primary, coplanar pairs × both directions × three masses, at model epoch JD 2461700.5. Three numerical starting guesses per scenario converge to the same local branch; they are not independent physical trials or extra scenarios.

The offline evaluator integrates central gravity, pure transverse thrust and changing vehicle mass during each burn. Both burns accelerate prograde when raising the orbit and retrograde when lowering it. A bounded three-duration solve matches destination radius, zero radial speed and circular tangential speed. A free departure-phase rotation then enforces the fictional station's position and velocity. It does not assume that the current parked ship already has that phase.

All **18/18 met the declared model acceptance checks**. Independent Cartesian RK4 propagation checks the polar DOP853 solution; RK4 steps are refined from 2 s to 1 s and polar tolerance from 2e-11 to 2e-13. Numerical evidence across the full matrix:

- Largest independent endpoint difference: 0.0000011 m; RK4 step-refinement difference: 0.000018 m.
- Largest match error against the engine station state: **0.102 m and 0.000112 m/s**, including Julian-date arrival representation.
- Largest circular-radius residual: 0.000032 m; final mass balance error: below 1.6e-11 kg.
- Three-start flight spread: below 1.5e-7 s; propellant spread: below 4.5e-8 kg.
- Coast relative energy drift: below 2.1e-15; angular momentum, refinement velocity and continuous radial-extremum clearance are also checked against the saved thresholds.

These small residuals measure numerical agreement **inside the simplified model**, not real-world accuracy or docking qualification. No atmosphere, oblateness, third-body gravity, plane change, navigation error, power/thermal/pressure system or tank design is included. This turn ran numerical scenarios, not the application unit/Worker suite; the previous 202/43 regression result remains a separate earlier run.

## Headline bookings still need a different model

**Phobos → Mars Base and ISS → Lunar Data Center do not yet have validated Option B flight times.** Their earlier 14.3/75.6 minute figures remain idealized firing budgets. Escape/capture, encounter geometry and (for ISS) plane geometry must be solved before quoting service times.

The Phobos endpoint deserves specific review: the repository assumes a 21.1 km parking radius around Phobos. Using its own Mars/Phobos constants gives a circular Hill-radius estimate of about 16.57 km (`9376 * cbrt(0.0007087 / (3 * 42828.375816))`). This is a screening inference, not a stability proof; the assumed isolated two-body parking orbit is unvalidated. [Research on Phobos proximity orbits](https://pureportal.strath.ac.uk/files-asset/45774806/Zamaro_PhD_Thesis_Oct_2015_Natural_and_artificial_orbits_around_the_Martian_moon_Phobos.pdf) reports the same scale. [JAXA's MMX mission](https://www.mmx.jaxa.jp/en/probe/) instead describes a Mars-centered quasi-satellite orbit near Phobos. No endpoint was changed in this evaluation.

**Recommendation:** retain Option B as a candidate for modest orbital hops. Next, choose an actual mass/reserve/tank design and departure scheduling policy, and solve the Mars–Phobos encounter before using it for the existing Phobos booking. These results do not approve a fleet replacement or a surface taxi.

## Reproduce and inspect

```powershell
node audit/option-b-local.mjs --out audit/option-b-local.json
# Optional: --python <Python executable with NumPy and SciPy>
```

The local run used NumPy 2.4.4 / SciPy 1.17.1 from the existing `python` runtime; no dependency was installed. The JSON contains all 18 full inputs, schedules, mass/mixture budgets, phases, solver attempts, thresholds, residuals and source hash. The generated JSON is ignored by Git. Numerical methods: [SciPy integration](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html), [bounded least squares](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.least_squares.html). See [design and independent review](OPTION-B-DESIGN.md) for the synthesis and control contract.

The final generation exited 0. At 02:16:28 UTC all six recorded Node/Python process IDs from the three evaluation runs were absent; no server or listener was started. The earlier impulse-budget generator was also rerun after sharing the engine specification and retained its original numbers. Source and connector-copy engine hashes remain equal and unchanged. `git diff --check` passed. No deployment or hosted configuration was touched.
