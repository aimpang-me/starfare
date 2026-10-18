# Option B: ISS → Lunar Data Center

**Result:** four numerical rendezvous examples passed the declared arrival, replay, mass and clearance gates. Fleet and production physics are unchanged. These are found trajectories; fuel and schedule optimization remain open.

## Flight time and propellant

“Remaining mass” includes the ship, payload, equipment and any reserve carried after both burns. It is not payload alone. Propellant below is consumed MMH plus oxidizer, with no additional reserve automatically added.

| Remaining mass | Flight, including both burns | Consumed propellant | Departure mass | Launch wait from reference epoch |
|---:|---:|---:|---:|---:|
| 500 kg | 3 d 00 h 28 min | 2,880.6 kg | 3,380.6 kg | 16.9547 d |
| 1,000 kg | 3 d 01 h 19 min | 4,587.9 kg | 5,587.9 kg | 16.9360 d |
| 2,000 kg | 3 d 02 h 56 min | 11,017.2 kg | 13,017.2 kg | 16.8722 d |
| 500 kg, earlier window | 5 d 00 h 44 min | 3,283.5 kg | 3,783.5 kg | 0.9056 d |

Reference epoch: **JD 2461700.5**, around 22 October 2027 on the model calendar. These waits are examples from that epoch, not today's available departures. Waiting occurs attached to the modeled ISS; its phase, the Moon and the destination all advance on the same clock.

The five-day example consumes about 403 kg more propellant than the 500 kg three-day example, but arrives about **5.94 days after the reference epoch**, versus **19.97 days** for the later launch. Bookings therefore need both launch availability and flight duration. The examples use different actual geometries; do not extrapolate fuel linearly with mass or flight time.

| Case | MMH | Oxidizer | Departure firing | Capture firing |
|---|---:|---:|---:|---:|
| 500 kg / three-day family | 1,087.0 kg | 1,793.6 kg | 75.2 min | 13.7 min |
| 1,000 kg / three-day family | 1,731.3 kg | 2,856.6 kg | 130.1 min | 11.5 min |
| 2,000 kg / three-day family | 4,157.4 kg | 6,859.8 kg | 315.6 min | 24.4 min |
| 500 kg / five-day family | 1,239.1 kg | 2,044.4 kg | 88.8 min | 12.5 min |

The 2,000 kg example needs a continuous departure burn of approximately **5.3 hours**. This is an ideal constant-performance propulsion calculation; installation, duty cycle, tanks, pressure regulation, steering and thermal feasibility still need vehicle design.

## What was calculated

- Shared Option B proposal: four 425 N engines, total 1,700 N, 321 s Isp, oxidizer/fuel mass ratio 1.65. Nominal engine values were rechecked against the [ArianeGroup datasheet, page 8](https://www.ariane.group/app/uploads/2024/09/ArianeGroup_Chemical_Bipropellant_Thruster_Family.pdf#page=8).
- Exact modeled ISS source: 420 km circular Earth orbit, 51.6° inclination and its existing epoch phase. Exact fictional destination: the existing 100 km circular lunar orbit, plane and moving station phase.
- Three-dimensional Earth-centered propagation with Earth gravity and moving Moon/Sun direct-minus-origin gravity. Moon and Sun positions/velocities come from the existing DE421-based table, evaluated directly without interpolation.
- Finite departure and capture burns with acceleration `thrust/current_mass`; chemical mass flow `thrust/(Isp*g0)`. Departure carries capture propellant. All firing and coast time is included.
- Constant RTN steering per burn, Earth-relative for departure and Moon-relative for capture. Both actual endpoint velocities are required; reaching the Moon's vicinity does not count as arrival.

This remains a simplified simulation: prescribed circular station orbits, spherical point-mass gravity, ideal thrust and instantaneous attitude steering. Oblateness, atmosphere/drag, navigation errors, detailed vehicle dynamics, docking, tank capacity and operational mission margins are omitted. A remaining mass is a normalization, not an approved ship configuration.

## Numerical evidence

All four saved cases were replayed again with the final source at **03:18:55–03:19:02 UTC on 18 October 2026**. Each used continuous forward DOP853 and RK45 integration, with smaller steps/tighter tolerances in the second method. These methods share the force implementation. A separate read-only review checked all four reports and found no remaining acceptance or accounting issue.

| Evidence across four final case replays | Largest observed value | Acceptance limit |
|---|---:|---:|
| Arrival position error against Python station state | 0.0221 m | 10 m |
| Arrival velocity error | 0.0000193 m/s | 0.01 m/s |
| Difference between replay positions | 0.0107 m | 1 m |
| Difference between replay velocities | 0.00000939 m/s | 0.001 m/s |
| Difference between Earth/Moon minimum altitudes | 0.00890 m | 1 m |
| Absolute final mass error | 5.12e-11 kg | Relative error < 1e-9 |

Radial extrema, integration nodes and burn switches remained at least approximately 420 km above Earth and 100 km above the Moon. Numerical collision guards are 100 km and 1 km respectively. Node independently checks each optimized departure and arrival against the application's actual `placeState` clocks. Ephemeris parity uses 131 endpoint, off-grid and segment-boundary probes per saved case: Moon position discrepancy <0.022 m, Sun discrepancy <0.601 m and velocity discrepancy <1.21e-7 m/s.

These small errors show numerical agreement within the chosen model; they do not establish centimeter accuracy for a real mission.

## Search bounds and unresolved work

Launch seeds were ranked on 1,441 half-hour points over a 30-day window, then locally refined. Search families were centered on 3, 5 and 7 days. The final solver permits ±12 hours in flight duration and ±6 hours around a selected launch seed, while keeping launch inside the 30-day window. Early experiments used exact durations and a narrower launch bracket; their failures were retained as numerical search failures.

The seven-day 500 kg search exhausted its **420-second wall budget** after 20,875 propagation calls. Its last accepted continuation checkpoint was only about **357 kg**. It produced **no verified 500 kg flight time or fuel requirement**. This is unresolved, not proof that a seven-day transfer is impossible. No intermediate small-mass or reduced-gravity seed is reported as an Option B flight.

Split perigee burns and broader control/schedule optimization may improve fuel and launch availability. They were not required to verify the four examples above and remain future work. These results do not approve a fleet replacement.

## Reproduce

```powershell
node audit/option-b-lunar.mjs --case 500kg-3day --out audit/option-b-lunar.json
node audit/option-b-lunar.mjs --case 1000kg-3day --out audit/option-b-lunar.json
node audit/option-b-lunar.mjs --case 2000kg-3day --out audit/option-b-lunar.json
node audit/option-b-lunar.mjs --case 500kg-5day --out audit/option-b-lunar.json
# Optional: --python <Python executable with NumPy and SciPy>
```

The saved [case controls](../audit/option-b-lunar-cases.json) are proposals, never imported by the application. Replay refines them and reruns every acceptance gate. Raw JSON is ignored by Git and contains model inputs, actual clocks, controls, mass/mixture budgets, thresholds, extrema, residuals, source hashes and process completion. Fresh searches use `--mass`, `--flight-days`, `--candidates` and `--budget-seconds`; `--resume` continues recorded numerical checkpoints. Runtime: Python 3.11.15, NumPy 2.4.4, SciPy 1.17.1; no dependency was installed.

The source and connector engine copies retain SHA-256 `13f5c2f0d2187b352d67d914057c54fb320aed3b020e642758478bd11dda8d65`. The public suite remains on that engine and score version 3. This evaluation ran numerical scenarios, not application unit/Worker tests. See [design and review](OPTION-B-LUNAR-DESIGN.md) for the continuation changes and acceptance contract.
