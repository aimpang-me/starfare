# Propulsion audit and proposed fix

2026-10-17. Audit baseline. Alvin subsequently approved the first fuel/power ledger slice, initially diagnostic. Fleet changes await review of ship options. The findings below describe the unchanged baseline physics.

Baseline: merged main `ff66fbc4532ec694770099e257dcc7214b9faaa0`, engine SHA-256 `13f5c2f0d2187b352d67d914057c54fb320aed3b020e642758478bd11dda8d65`, score version 3. Source bundle, connector copy, metadata and suite agree. This describes repository code, not a deployment inspection.

## Short verdict

The planner chooses instantaneous-burn trajectories and prices them using ion engines. It checks tank size and departure power, but does not establish that the engine can perform those maneuvers on that timetable. This is a model mismatch, not an arithmetic error in kWh conversion.

Of 45 representative leg requests, 19 were already refused and **all 26 accepted legs require more firing time than flight time at their quoted operating point**. Four two-leg plans also pass the existing plan check despite needing more xenon than their tanks hold when carrying fuel for the next leg.

## Evidence

Run from the repository root:

```powershell
node audit/propulsion-audit.mjs --out audit/propulsion-audit.json
```

The script only reads the engine and writes its report. It uses no secret, network, hidden benchmark task, rebuilt bundle or changed production calculation. Full inputs, refusal reasons and results are in the generated local `audit/propulsion-audit.json`, which is excluded from Git and can be reproduced with the command above.

### 1. Firing time is missing from feasibility

Five canonical passenger routes × three distinct active hull classes × three request dates (2027-10-22, 2034-08-26, 2041-06-30), energy objective, arrival limit JD 2468328.5. One deterministic evaluation per combination; repeat executions are not additional independent samples. These are single-leg capability probes, not completed dispatches or a census of every generated booking.

Examples at JD 2461700.5, using unrounded energy:

| Route / ship | Planned flight | Quoted-point firing time | Thruster power |
|---|---:|---:|---:|
| ISS → Lunar Data Center / SF-01 | 4.98 days | 389.81 days | 2310 W |
| Phobos → Mars Base / SF-03 | 2.23 hours | 273.91 days | 490 W |
| Io → Ganymede / SF-07 class | 2.08 days | 2188.03 days | 490 W |
| Titan → Earth / SF-07 | 1595.09 days | 7218.42 days | 490 W |

SF-07 is not asserted to be parked at Io; its RTG propulsion class is also used by the Jupiter ships. Across the 26 accepted probes, firing/flight ratios range from 2.90 to 5909.21. All 19 refusals in this sample are existing tank or departure-power refusals.

Calculation: `ve = Isp*g0`, `F = 2*eff*P/ve`, `mass_flow = F/ve`, `burn_seconds = xenon/mass_flow = energy_joules/P`. Both evaluation paths agree within 1e-8 days. They are algebraically equivalent checks of unit conversion, not independent trajectory validation. The inferred 91.92 mN / 19.47 mN thrusts agree approximately with the published 92 / 19.5 mN table values.

These durations apply to the current quote's delta-v and fixed operating point. They do not rule out every alternative trajectory or throttle history. Allowing firing across the entire flight is already generous: real departure/capture burns must occur at the right positions and times. A duration that fits would not establish feasibility. Charging earlier cannot increase the selected thruster's thrust.

Root: `world/engine/sol-engine.js` `localTransfer()` and Lambert search choose impulsive maneuvers; `battery()` and `finish()` price them without a burn schedule. NASA describes electric-propulsion trajectories as sustained thrust over months or years, with a different flight path from impulsive transfers: [NASA trajectory guide](https://science.nasa.gov/learn/basics-of-space-flight/chapter4-1/), [Dawn propulsion](https://science.nasa.gov/mission/dawn/technology/ion-propulsion/).

### 2. Departure power is reused for arrival burns

Two additional outbound SF-01 probes demonstrate the blind spot:

- ISS → Ceres Port: quote uses 2310 W for both burns; arrival arrays supply about 1190 W. Existing gravitational re-flight still passes (0.175 km final miss, 12.53 m/s retarget).
- ISS → Titan: quoted-point firing time is 1655.89 days versus 5548.28 flight days, so a duration-only guard would pass. Arrival arrays supply about **103 W**, below the implemented 490 W minimum. No alternative capture propulsion or storage-backed maneuver is modelled.

The 45 canonical probes alone did not expose this arrival-power issue. These are separate targeted routes, available through general hop planning.

Root: `battery(item.e.dv, ship, rAu)` uses departure distance for combined departure and arrival delta-v. `refly()` propagates gravity and adjusts initial velocity; it does not integrate engine thrust, power or fuel. Local transfers are explicitly not re-flown. Preserve the gravitational check, but expose its scope separately from propulsion validation.

### 3. Successive legs undercount carried fuel

At the first epoch, all seven parked cars × all five canonical bookings give 35 pickup/flight attempts; 24 have both legs accepted. Four pass `R.check()` with no busy-time input but need more fuel than their 1085 kg tanks hold:

| Booking / ship | Current leg sum | Fuel carried through both legs |
|---|---:|---:|
| ISS crew / SF-04 | 928.47 kg | 1100.21 kg |
| Titan home / SF-05 | 1064.69 kg | 1443.12 kg |
| Titan home / SF-06 | 993.79 kg | 1319.29 kg |
| Ceres shift / SF-05 | 882.04 kg | 1130.05 kg |

This isolates the tank check, not seasonal availability or an end-to-end successful flight. The comparison applies the same rocket equation backwards through the two legs with their current fixed Isp values, no intermediate refuelling, and dry final mass. Each earlier leg must accelerate fuel reserved for the later leg. The comparison still excludes passenger/habitat mass, hydrazine, reserves and additional tank structure; those cannot make the budget lighter.

Root: `battery()` independently starts each leg from class dry mass, and `sol-rides.js` `check()` sums the resulting estimates. Shared flights magnify this issue. Payload counts affect seats but not propulsion mass. [NASA ideal rocket equation](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/ideal-rocket-equation/) and [specific impulse](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/specific-impulse/) support the mass accounting.

### 4. Throttle choices and gameplay energy need explicit scope

- The engine contains two NSTAR points, although the source publishes five. At 1 AU a DS1-class hull has 2100 W spare: the engine picks 490 W while a published 2060 W point is available. Omitting intermediate points is a simplification, not proof that the other points are unavailable. Use the sourced table when modelling actual performance. [NASA/CR-1999-209162, Table 1, PDF page 26](https://ntrs.nasa.gov/api/citations/20000003023/downloads/20000003023.pdf#page=26).
- Orbit holding charges 250 kWh/hour, equivalent to 250 kW. A 633 W RTG produces 250 kWh in about 16.46 days; no storage or maneuver model supplies it during a one-hour hold. Gravity alone does not require continuous powered hovering in an orbit. Treat this as a disclosed gameplay penalty until a specific maneuver/resource model replaces it.
- Late departures add a simulated percentage of kWh and shift the existing arc. That is not a solved correction maneuver with propellant and thrust. A physics revision must budget actual correction/replan/diversion burns too.
- The RTG hull already discloses constant power, zero housekeeping and omitted larger-tank structure. These are optimistic fictional design assumptions. Life support, thermal loads, eclipses and degradation remain outside this audit; no passenger-safety or complete spacecraft certification is claimed.

## Proposed fix — for approval

**Recommendation: introduce propulsion-aware planning in stages, then switch the game only after playable routes are demonstrated.** Retain the Starseeker identities and fictional cabins, with explicit engineering capabilities.

1. **One resource ledger for the whole itinerary.** Represent each burn's engine, thrust, Isp, power, duration and mass flow. Carry fuel, declared passenger/cabin mass and reserves between burns and stops. Use all five sourced throttle points, power at each burn's location/time and explicit onboard loads. Calculate minimum required fuel backwards, then verify the loaded vehicle forwards. Any refuelling must be an explicit stop/action.
2. **One propulsion assessment shared by planner, checker, dispatcher and replay.** Report `infeasible` when a necessary bound fails, `unverified` when bounds pass without a validated thrust trajectory, and `verified` only after finite-thrust propagation reaches the required destination orbit with fuel and power remaining. Keep the gravity-check result as its own field. Store the approved burn schedule with the quote/replay.
3. **Solve maneuvers with finite thrust.** Start with a bounded local-transfer implementation; then extend to heliocentric transfers. Integrate gravity + thrust/mass, mass loss and power availability, including escape/capture and corrected maneuvers. Recompute encounters, dates, energy and fare from that solution. Merely setting flight time to `max(old_time, E/P)` would invalidate the encounter geometry.
4. **Make fleet/gameplay tradeoffs visible before rollout.** These ion profiles imply much slower service than today's quick flights. For faster local taxis, evaluate a separately specified high-thrust or hybrid simulated hull using sourced engine performance, honest tank/mass limits and validated transfers. Do not increase watts or invent an acceleration just to recover current timings. Some routes may remain unavailable. Show Alvin route coverage and timing under the candidate profiles before choosing them.
5. **Version the physics change.** Preserve historical records, bind new plans/cache keys/bench tasks to the new engine/model, regenerate suites through their normal generators and review references/fare/score effects. Never relabel old flights as propulsion-verified. Coordinate any new status fields with Design. Deployment and hosted key changes require separate authorization.

The first implementation slice would be the resource ledger and assessment for existing plans, initially diagnostic, with the finite-thrust local solver as the first validated flight path. Keep the current game identified as an impulsive approximation until the replacement has an agreed playable route set. Turning on a strict firing-time gate alone would reject all 26 accepted sample legs.

### Review gates for a future implementation

- Zero-burn transfers; every sourced throttle boundary; actual power at departure and arrival; fuel carried across multiple legs; passenger loading and declared refuelling.
- Both necessary-bound counterexamples above, especially Titan's passing duration but failed arrival power.
- Independently checked finite-thrust local transfer, conservation/coast checks, fuel depletion, power loss and unreachable destinations. Arrival means the required relative position/velocity or parking orbit, not only passing the body's centre.
- A corrected/replanned/shared itinerary uses the same mass ledger and burn schedule in MCP, browser replay and scoring.
- Timing, reference scores and available booking coverage reviewed before enabling the revised physics. These are proposed checks; no new physics implementation or such test suite has been run.

## Files changed by this audit

The audit produced this note, `audit/propulsion-audit.mjs` and its local JSON evidence. The subsequently approved diagnostic ledger slice is documented in `PROPULSION-LEDGER.md`. Production engine files, bundles, suite, ship parameters, scores and runtime UI remain unchanged. No deployment performed.
