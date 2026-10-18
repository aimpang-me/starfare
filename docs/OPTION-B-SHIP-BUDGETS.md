# Option B: tank sizing, reserves and ship budgets

Follow-up: the [feed-pressure proposal and revised budgets](OPTION-B-FEED-PRESSURE.md) add explicit feed/thermal hardware and reduce the courier cargo targets to 40/420 kg. This document retains the earlier 70/450 kg comparison baseline. Both studies remain conditional; no fleet change is approved.

## Decision for review

**Three Phobos concepts close their conceptual mass budgets. None has a closed engine-feed pressure design. The lunar envelopes do not close.** Fleet and production physics are unchanged.

The proposals below use the combined conservative scenario: **40% growth on dry hardware, 10% extra nominal burn inventory, a separate 100 m/s ideal RCS allowance, 1% trapped liquid, and at least 5% warm ullage**. These percentages are study policy, not flight standards. Estimated bus/cabin hardware and thermal/property bounds still need engineering validation.

| Proposed concept | Payload | Departure / arrival mass | Loaded MMH + MON-3 | Nominal flight | Alignment wait |
|---|---|---:|---:|---:|---:|
| B Courier S | 70 kg uncrewed cargo | 745.17 / 500.00 kg | 289.74 kg | 141.6 min | 33.8 min |
| B Courier M | 450 kg uncrewed cargo | 1479.78 / 1000.00 kg | 567.76 kg | 143.4 min | 33.9 min |
| B Cabin | 2 occupants plus 150 kg cargo | 2950.97 / 2000.00 kg | 1125.97 kg | 150.1 min | 30.9 min |

These names are proposals, not fleet classes. Route: **proposed anti-Mars Phobos pad to fictional Mars Base in 300 km Mars orbit**. The existing [Phobos numerical rendezvous](OPTION-B-PHOBOS-EVALUATION.md) supplies flight times and nominal burns at these exact mass envelopes. The point-craft pad model does not establish full vehicle terrain clearance, a real landing facility, boarding or docking. Reserves remain unspent at the transfer endpoint; docking, abort and return flights have not been solved.

## Complete mass ledger

All values below are kg, rounded independently to 0.001 kg. Unrounded machine ledgers close within 0.000001 kg. Growth is a design allocation: if actual hardware does not consume it, carry equivalent payload/equipment/ballast or recompute the trajectory. It cannot simply disappear while keeping these flight times.

| Mass item | Courier S | Courier M | Cabin |
|---|---:|---:|---:|
| Dry hardware before growth | 269.952 | 321.904 | 1001.508 |
| Dry hardware growth, 40% | 107.981 | 128.762 | 400.603 |
| **Dry design mass** | **377.933** | **450.665** | **1402.111** |
| Nominally burned propellant | 245.170 | 479.783 | 950.971 |
| Unspent contingency | 24.517 | 47.978 | 95.097 |
| Unspent RCS inventory | 17.160 | 34.319 | 68.638 |
| Unusable liquid residual | 2.897 | 5.678 | 11.260 |
| **Loaded propellant, sum of preceding four liquid rows** | **289.744** | **567.758** | **1125.966** |
| All retained helium, bottles plus ullage | 2.427 | 4.882 | 7.953 |
| Occupants and suits | 0 | 0 | 200.000 |
| Provisions and cabin air | 0 | 0 | 34.120 |
| Cargo allocation | 70.000 | 450.000 | 150.000 |
| Additional trim/ballast | 5.067 | 6.477 | 30.821 |
| **Departure total** | **745.170** | **1479.783** | **2950.971** |
| Less nominal burn | -245.170 | -479.783 | -950.971 |
| **Arrival total** | **500.000** | **1000.000** | **2000.000** |

Subtotal rows are not additional mass. No venting, hardware jettison or crew-waste loss is assumed. Cabin provisions cover two people for two days: oxygen 3.36, water 14.08, dry food 2.48, LiOH/packaging 7.00 and cabin air 7.20 kg. Occupants/suits are allocated 100 kg each. Food and cabin values are concept allocations; oxygen/water/LiOH rates are based on the [NASA consumables study](https://ntrs.nasa.gov/api/citations/20160005782/downloads/20160005782.pdf). This inventory does not establish human readiness, cabin endurance or emergency return capability.

### Every dry hardware allocation

Except for manufacturer engine/tank/bottle masses, entries are explicit concept estimates. Growth applies to their entire subtotal, including sourced hardware and integration estimates. Power values below are **hardware mass allocations**, not solved electrical energy/load budgets.

| Component, kg | Courier S | Courier M | Cabin | Basis |
|---|---:|---:|---:|---|
| Primary structure / engine frame | 45 | 45 | 90 | Estimate |
| Docking / cargo interface | 20 | 20 | 40 | Estimate |
| Guidance, navigation, communications | 20 | 20 | 35 | Estimate |
| Electrical generation, storage, distribution | 45 | 45 | 80 | Estimate |
| Bus thermal control | 15 | 15 | 30 | Estimate |
| Regulators, isolation valves, common feed | 20 | 20 | 25 | Estimate; pressure/flow unresolved |
| Harness and integration | 10 | 10 | 20 | Estimate |
| Attitude electronics / wheels | 8 | 8 | 15 | Estimate |
| Cargo restraints / containment | 10 | 10 | 10 | Estimate |
| Cabin, hatch, windows | 0 | 0 | 240 | Estimate |
| Cabin impact / radiation protection | 0 | 0 | 30 | Estimate; protection not qualified |
| Life support hardware | 0 | 0 | 80 | Estimate |
| Oxygen / water containers | 0 | 0 | 15 | Estimate |
| Waste and hygiene hardware | 0 | 0 | 20 | Estimate |
| Seats / restraints | 0 | 0 | 20 | Estimate |
| Emergency crew equipment | 0 | 0 | 30 | Estimate |
| Four main engines with valves | 17.2 | 17.2 | 17.2 | Manufacturer |
| Twelve 10 N RCS thrusters with dual-seat valves | 7.8 | 7.8 | 7.8 | Manufacturer mass; proposed count/layout |
| Propellant tank shells / PMDs | 32 | 64 | 128 | Manufacturer |
| Propellant tank mounts | 4 | 8 | 16 | Estimate |
| Tank branch lines / isolation | 2 | 4 | 8 | Estimate |
| Tank insulation / heaters / integration | 2.652 | 5.304 | 10.608 | Area estimate |
| Helium bottle shells | 9.5 | 19 | 28.5 | Manufacturer |
| Helium mounts / branch lines | 1.8 | 3.6 | 5.4 | Estimate |
| **Subtotal before growth** | **269.952** | **321.904** | **1001.508** | |

## Separate fuel, oxidizer and pressure storage

Main propulsion remains four aligned 425 N engines, 1700 N total, 321 s Isp. Proposed RCS uses twelve 10 N engines at 292 s Isp. O/F is 1.65 for both allocations. Published main/RCS masses and permitted MON-3/MMH chemistry are in the [ArianeGroup catalog, pages 8 and 4](https://www.ariane.group/app/uploads/2024/09/ArianeGroup_Chemical_Bipropellant_Thruster_Family.pdf). Assembly alignment, plume clearance, cycle life, valve power and delivered performance are unverified.

| Inventory / equipment | Courier S | Courier M | Cabin |
|---|---:|---:|---:|
| MMH loaded, kg | 109.338 | 214.248 | 424.893 |
| MON-3 loaded, kg | 180.407 | 353.510 | 701.073 |
| MMH cold volume, L | 128.632 | 252.057 | 499.874 |
| MON-3 cold volume, L | 128.862 | 252.507 | 500.766 |
| MMH warm volume, L | 133.778 | 262.139 | 519.869 |
| MON-3 warm volume, L | 134.017 | 262.607 | 520.797 |
| Fuel bank | 1 x OST21-235 | 2 x OST21-235 | 4 x OST21-235 |
| Oxidizer bank | 1 x OST21-235 | 2 x OST21-235 | 4 x OST21-235 |
| Internal volume per fluid bank, L | 235 | 470 | 940 |
| Helium storage | 1 x PVG50 | 2 x PVG50 | 3 x PVG50 |
| Helium initially in storage, kg | 1.835 | 3.671 | 5.506 |
| Helium initially in tank ullage, kg | 0.591 | 1.211 | 2.446 |
| Helium delivery demand with 15% allowance, kg | 0.816 | 1.598 | 3.169 |
| Available helium above cold cutoff, kg | 1.544 | 3.087 | 4.631 |

Each OST21 tank is 235 L, 16 kg and 22 bar MEOP, pinned to the [November 2021 tank catalog, page 9](https://space-propulsion.com/brochures/propellant-tanks/spacecraft-propellant-tanks.pdf#page=9). MON/MMH compatibility is published; this study specifically assumes MON-3, not unsupported pure-N2O4 qualification. The calculator enumerates five published tank families without interpolating their masses or ratings. Other catalog families may win a different scenario.

Each [MT Aerospace PVG50](https://www.mt-aerospace.de/files/mta/tankkatalog/Datenblatt_PVG-50.pdf) is 50 L, 9.5 kg bare and 310 bar MEOP. Study charge is 250 bar at 20 C. Pinned [NIST real-helium properties](https://webbook.nist.gov/cgi/fluid.cgi?ID=C7440597&Action=Page) give 36.7099 kg/m3 at charge; a 30 bar cutoff at -30 C retains 5.83553 kg/m3. At +60 C the full storage charge reaches 283.574 bar. Each bottle can therefore deliver 1.5437185 kg above the selected cold cutoff. Regulator delivery at cutoff remains a hardware requirement. All helium, including cutoff gas and excess delivery capacity, stays in the vehicle mass.

### Pressure result: unresolved

Liquid sizing assumes MMH 0.85 kg/L and MON-3 1.40 kg/L at the cold reference, with a separate **4% maximum volume expansion from 10 to 30 C**. These are sizing assumptions, not measured mixture curves. They are below room-temperature pure-MMH/N2O4 reference densities in the [NASA propellant handbook](https://ntrs.nasa.gov/api/citations/19860005869/downloads/19860005869.pdf); that does not validate the MON-3 thermal bound.

Cold total regulator allocation is 16.25 +/- 0.25 bar. Treating all cold ullage pressure as helium deliberately overallocates helium. For each physical tank, divide liquid proportional to internal volume, calculate remaining ullage after warm expansion, conserve precharged helium and use its NIST 30 C table. Add an **assumed 2 bar vapor contribution**, then **1 bar transient headroom** before comparing with MEOP. Never substitute proof/burst pressure for MEOP. The equal-fill plan and property/transient assumptions need validation. [NASA identifies helium dissolution and release in MMH/MON-3 as a feed-system concern](https://www.nasa.gov/centers-and-facilities/nesc/nesc-leads-testing-efforts-to-characterize-engine-anomalies/); the 15% helium allowance is not a demonstrated bound on that behavior.

All three selected banks screen at **20.75 bar warm total plus 1 bar transient, versus 22 bar MEOP**. However, the main engine catalog permits **12.5–18.5 bar inlet**. At the cold minimum, subtracting the allocated 3 bar feed loss leaves only **13 bar**. The present pressure screen therefore **fails the engine inlet range**. No operational pressure closure is claimed.

Next design step is a compatible feed/regulator arrangement with measured flow/loss/differential behavior at approximately **0.540 kg/s main-engine flow**, plus actual fluid-property and thermal bounds. Revisit the 20/25 kg common-feed hardware estimates and entire mass ledger if that hardware changes. A downstream regulator cannot repair an over-rated tank. The tank screen itself is conditional on the assumptions above.

## Reserves: definition and limits

For nominal burn `B`, arrival mass `mf`, RCS exhaust velocity `ve = 9.80665 * 292`, contingency `C = 0.10 B`, and ideal RCS allowance `R = mf*(1-exp(-100/ve))`:

```text
loaded liquid = (B + C + R) / 0.99
trapped residual = 0.01 * loaded liquid
arrival mass = dry design + C + R + residual + retained He + people/provisions + cargo + trim
departure mass = arrival mass + B
```

Size R at full nominal arrival mass. Using contingency first reduces the mass at which R is subsequently used. This is an inventory allowance for ideal translation, not a demonstrated 100 m/s attitude/docking/abort capability. Both liquids are split at O/F 1.65. The helium inventory supplies displacement through nominal burn plus both usable reserves, with 15% extra delivery capacity. Unusable liquid cannot be spent as reserve.

## Sensitivity and rejected concepts

Payload targets remain fixed across scenarios; the calculator does not silently lower payload when assumptions worsen. Each scenario separately sizes its storage hardware. Below is capacity remaining for additional actual trim/ballast after the selected payload, kg:

| Scenario | Courier S, 70 kg cargo | Courier M, 450 kg cargo | Cabin, 2 people + 150 kg cargo |
|---|---:|---:|---:|
| 25% dry growth, 5% contingency | 57.91 | 94.89 | 244.92 |
| 40% dry growth, 5% contingency | 17.42 | 48.30 | 96.39 |
| 25% dry growth, 10% contingency | 45.56 | 54.76 | 181.05 |
| **40% dry growth, 10% contingency: proposed budgets** | **5.07** | **6.48** | **30.82** |

The initially considered two-person + 250 kg cargo target exceeds the combined budget by **69.18 kg**. Reduce the proposed cargo allocation to 150 kg; this changes the study proposal, not the fleet. The 500 and 1000 kg arrival envelopes cannot accommodate the two-person cabin allocation even with zero cargo. Tight remaining trim in the couriers means they have little capacity beyond the already included 40% hardware growth allowance.

### Lunar: existing flight solutions are not complete ships

Under the same combined assumptions and **zero cargo**, additional mass required above the saved arrival envelope is:

| Saved lunar envelope | Uncrewed deficit | Two-person deficit |
|---|---:|---:|
| 500 kg, approximately 3-day flight | 584.65 kg | 1680.95 kg |
| 1000 kg, approximately 3-day flight | 701.65 kg | 1797.95 kg |
| 2000 kg, approximately 3-day flight | 1350.60 kg | 2446.90 kg |
| 500 kg, approximately 5-day flight | 645.96 kg | 1769.18 kg |

Even the lower 25% growth / 5% contingency baseline is overweight before cargo: uncrewed deficits **361.04 / 333.67 / 256.99 / 400.36 kg**, respectively. These are failures of these selected component/policy/catalog envelopes, not proof that all chemical lunar ships are impossible. Increasing arrival mass invalidates the old thrust/gravity-loss solution: solve the ship and trajectory together before giving a replacement lunar flight time or fuel figure. The [lunar evaluation](OPTION-B-LUNAR-EVALUATION.md) remains a propulsion/model rendezvous result.

## Reproduce and inspect

```powershell
node audit/option-b-ship-budget.mjs --out audit/option-b-ship-budget.json
node audit/option-b-ship-budget.mjs --mission phobos-pad-2000kg --role passenger
```

The tracked calculator, hardware/EOS snapshots, assumptions and mission snapshots live in `audit/option-b-ship-*` and `audit/option-b-hardware.json`. The generated report is ignored. It includes full precision ledgers, four scenarios, source hashes and explicit unresolved pressure status. There are seven mission envelopes x two roles x four scenarios = **56 numerical sizing evaluations**. All seven mission snapshots matched their accepted local reports and original report hashes in this workspace. These sizing runs reuse their flight solutions; they do not rerun trajectories or application tests.

On a fresh clone, ignored trajectory reports may be absent. The calculator then explicitly reports `reviewed_snapshot_only` provenance rather than claiming a fresh replay. Lunar snapshots are also checked against tracked saved-case reference numbers. If a local report exists, source engine/specification, acceptance status, mass, burn, flight and wait must match. Changed policy temperatures/pressures require matching helium property data. Production engine, connector engine and score/suite definitions are untouched.
