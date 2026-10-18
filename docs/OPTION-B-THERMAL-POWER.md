# Option B: thermal power and revised ship budgets

2026-10-18. **Pressure continuity is not yet demonstrated.** The old 8 kg thermal allowance specified no capacity. This study calculates what active conditioning would need to deliver through both burns and the coast. It does not predict the temperatures of an actual bottle, wall, coolant loop or engine installation. Fleet and production physics are unchanged.

## Proposed fix

Use separate high-pressure helium heating, regulated-gas conditioning and liquid-tank heating/cooling, with a dedicated battery and an isolated radiator loop. Condition everything externally before launch. Recover no engine heat and take no power or mass credit from the existing bus allocations.

The reference path holds liquid/ullage at **10.5 ± 0.25 °C**, helium storage at **20 °C**, and nominal tank pressure at **16.25 bara**. Its sampled temperature-error pressure envelope is **16.218–16.282 bara**. That is conditional on tracking the target; it is not a simulated pressure trace. Regulator errors, plumbing transients and engine performance remain separate requirements from the [feed study](OPTION-B-FEED-PRESSURE.md).

## Both burns, without a reset

These are the saved Phobos pad → Mars Base timelines. Mars Base is the fictional station in 300 km Mars orbit. The first firing includes a contiguous 20 s pad lift. External alignment/conditioning wait is separate from flight.

| Reference configuration | First firing | Coast | Arrival firing | Flight |
|---|---:|---:|---:|---:|
| Courier S, 500 kg arrival | 232.55 s | 8043.33 s | 221.43 s | 141.62 min |
| Courier M, 1000 kg arrival | 444.43 s | 7718.14 s | 443.99 s | 143.44 min |
| Cabin, 2000 kg arrival | 862.60 s | 7247.20 s | 898.34 s | 150.14 min |

| Thermal subsystem electrical demand | S reference | M | Cabin |
|---|---:|---:|---:|
| First firing peak | 1499 W | 1529 W | 1585 W |
| Coast peak | 75 W | 105 W | 162 W |
| Arrival firing peak | 1483 W | 1514 W | 1566 W |
| Whole-flight battery output energy | 354 Wh | 600 Wh | 1091 Wh |
| **Electrical design rating, including 25% margin** | **1.873 kW** | **1.911 kW** | **1.982 kW** |
| Required battery nameplate, including margin and derating | 692 Wh | 1171 Wh | 2131 Wh |
| Estimated complete battery mass | 9.5 kg | 10.0 kg | 18.0 kg |
| Radiator design heat rejection, including 25% margin | 1.422 kW | 1.449 kW | 1.504 kW |
| Radiator emitting area | 8.60 m² | 8.76 m² | 9.09 m² |

S is a sizing reference, **not a usable conservative ship proposal**: its revised hardware exceeds its trajectory's mass allowance. All power here serves this added thermal subsystem. Cabin, avionics, engine valves and the rest of the spacecraft still need a complete electrical budget.

## Complete mass reconciliation

Use the combined policy: **40% dry growth**, unspent contingency equal to 10% of nominal burn, the existing ideal RCS reserve allowance, and **1.2% retained unusable propellant inventory**. Growth is an allocation; an as-built ship must preserve the solved total mass with real equipment, payload or trim, or have its trajectory solved again.

| Allocated mass, kg | S: rejected | M: proposed | Cabin: proposed |
|---|---:|---:|---:|
| Dry hardware before growth | 338.327 | 391.628 | 1080.948 |
| Dry growth allocation | 135.331 | 156.651 | 432.379 |
| **Dry design subtotal** | **473.658** | **548.280** | **1513.327** |
| Nominal propellant consumed | 245.170 | 479.783 | 950.971 |
| Unspent contingency | 24.517 | 47.978 | 95.097 |
| Unspent ideal RCS inventory | 17.160 | 34.319 | 68.638 |
| Retained unusable inventory, including vapor and wet-line liquid | 3.484 | 6.827 | 13.539 |
| **Loaded propellant subtotal** | **290.331** | **568.907** | **1128.245** |
| All retained helium | 2.417 | 4.851 | 7.879 |
| People and suits | 0 | 0 | 200.000 |
| Provisions and cabin air | 0 | 0 | 34.120 |
| Cargo | 0 | **350.000** | **60.000** |
| Additional trim | 0 | 7.745 | 7.399 |
| **Required departure total** | **766.406** | **1479.783** | **2950.971** |
| **Required arrival total** | **521.235** | **1000.000** | **2000.000** |
| Arrival allowance from saved trajectory | 500.000 | 1000.000 | 2000.000 |
| **Overweight** | **21.235** | **0** | **0** |

Subtotal rows are not additional mass. These proposed allocations replace the earlier feed-study cargo figures of 40/420/150 kg. No new flight time is assigned to the overweight S assembly.

Keep the previous 1/2/4 OST21-235 tanks **per fluid** and 1/2/3 PVG50 bottles. Replace the 8 kg thermal placeholder exactly once:

| Replacement thermal equipment before dry growth | S | M | Cabin |
|---|---:|---:|---:|
| Filled heaters, exchangers, pump/transport, added insulation and mounts | 6.000 kg | 6.000 kg | 6.000 kg |
| Filled radiator panel assembly | 43.002 kg | 43.813 kg | 45.459 kg |
| Dedicated complete battery | 9.500 kg | 10.000 kg | 18.000 kg |
| Power conditioner | 1.873 kg | 1.911 kg | 1.982 kg |
| **Replacement subtotal** | **60.375 kg** | **61.725 kg** | **71.440 kg** |

Existing tank insulation, bus thermal allocations, feed sensors and common feed components remain separately counted. All replacement hardware masses are design estimates, not selected assemblies.

## What determines whether it can work

- **Heat exposure:** evaluate ±5 W/m² net insulated heat leak, 0/250/1000 W total engine-to-liquid coupling while firing, and ±20% vapor pressure. These are sensitivity cases, not measured bounds. The table sizes to all cases through 1000 W. Worst electrical demand occurs in the cold, zero-recovered-heat case; the hotter cases enlarge the radiator.
- **Radiator geometry:** one emitting face at 5 °C, emissivity 0.85, solar absorptivity 0.08, solar flux 750 W/m², planet IR 350 W/m², albedo 0.3, planet view factor ≤0.2. Net rejection is only **165.4 W/m²** before margin. At view factor about **0.724**, this assumed environment leaves no rejection capacity. Geometry, shadowing, deployment and pump/flow performance must establish the proposed view and temperature.
- **Heat transfer:** the reference requires at least **43.7/43.9/44.1 W/K** helium-to-wall conductance with a 20 K wall approach, **69.9/72.1/76.5 W/K per liquid heating interface** with 5 K approach, and **216.8/220.9/229.1 W/K** aggregate cooling conductance with the available 5.25 K approach. Gas-conditioning interfaces also require about **15.5 W/K each**. These are necessary reference-path capacities without design margin, not demonstrated conductances; wall and actuator response remain unmodeled.
- **Pad service:** externally establish equilibrium at the target temperatures and charge the dedicated battery before release. Cooling the liquid inventory alone from 30 to 10.5 °C removes **3.36/6.59/13.07 kWh of heat**. Doing that within the saved alignment waits requires average **5.98/11.65/25.35 kW of heat removal**, before tank walls, gas, environment and equipment losses. This is a lower bound on external cooling duty, not pad electrical input or onboard capacity. Pad service and the carried interface remain unqualified; the 6 kg integration allowance is not proof of sufficient hardware.
- **Battery:** estimate 120 Wh/kg complete packs, 80% permitted discharge, 80% end-of-life capacity and 200 W/kg deliverable power; round mass up by 0.5 kg. S is peak-power limited, Cabin energy limited. Heater/distribution efficiencies are 95%/90%; pump/control load is 40 W continuously. Actual packs, working temperatures and thermal isolation require selection.

If shielding and geometry could substantiate **≤250 W** engine coupling, radiator areas fall to **3.81/3.88/4.01 m²**. A full rerun then gives S **10 kg cargo plus 2.290 kg trim**, while M/Cabin have 41.954/42.976 kg trim at the proposed cargo. This is a conditional sensitivity, not an established shielding solution or an approved mass saving.

## Physics and numerical checks

Use NIST real-helium density, internal energy and enthalpy, with no extrapolation. For each firing step, the high-pressure bottle obeys `Q·dt = Δ(m·u) + Δm_out·h_out`; pressure/density and `u` change even at fixed temperature. The regulator is approximately isenthalpic; a separate conditioner removes or supplies the enthalpy difference to the low-pressure target. There is no inter-burn temperature or energy reset.

Low-pressure tanks use equilibrium vapor plus helium partial pressure. At fixed temperature/total pressure in a rigid tank, conditioned helium inflow enthalpy cancels its inventory accumulation; liquid outflow cancels liquid inventory loss. The remaining phase-change demand uses **latent enthalpy × vapor mass increase**, without adding a second ullage flow-work heater. Additive partial-fluid enthalpies, ideal propellant vapor, conservative pure-N2O4 vapor molecular mass, and negligible dissolution/mixing effects are screening approximations. Latent design inputs are 1 MJ/kg MMH and 0.5 MJ/kg oxidizer, not measured properties at this installation.

Retained vapor stays vehicle mass and cannot be used as delivered liquid. The 1.2% unusable allocation covers hot/high-vapor residuals, **0.82257 L wet hold-up per fluid**, and an additional assumed **0.2 kg liquid PMD allowance per fluid**, including after the separately allocated usable reserves are spent. That inventory screen does not solve reserve maneuvers or demonstrate single-phase feed. Initial helium now uses its actual partial-pressure allocation; lower actual gas loads require equivalent physical trim to retain trajectory mass. Under the controlled path, final bottle pressure remains at least **164.0/165.7/139.8 bar** across sensitivities, above the proposed 30 bar regulator inlet floor; unheated blowdown is not validated.

Evaluation covers 24 mission/role/policy rows with 18 sensitivity cases each. Halving firing steps from 2 s to 1 s changes selected peak power by <0.04 W, whole-flight energy by <0.000001 Wh and dry design allocation by <0.003 kg. This checks numerical resolution, not physical accuracy. The HP energy-identity residual is an algebraic identity, not independent evidence. All **6692 original-study and 17052 feed-study numeric fields compared** remain unchanged without the thermal flag. Application tests were not added or run.

## Reproduce and next decision

```powershell
node audit/option-b-ship-budget.mjs --feed-proposal audit/option-b-feed-proposal.json --thermal-proposal audit/option-b-thermal-proposal.json --out audit/option-b-thermal-budget.json
```

Inputs and property provenance are tracked; the generated JSON is ignored. For the 250 W sensitivity, copy the proposal, set `sizing_engine_heat_w` to `250` and S cargo to `10`, and run with that file. The same CLI owns every mass allocation.

**Next evidence:** establish engine-to-tank heat exposure and the actual bottle/loop conductance and transient response, then select radiator, battery, conditioning and pad-interface hardware against those requirements. Exact regulators and calibrated engine thrust/Isp are still open. M and Cabin close an estimated mass ledger; neither has demonstrated continuous pressure control or operational readiness.

## Sources

- [NIST helium WebBook](https://webbook.nist.gov/cgi/fluid.cgi?ID=C7440597&Action=Page): four sourced isotherms with retrieval URLs and response hashes in `audit/option-b-thermal-properties.json`.
- [USAF MON propellant report](https://rocketprops.readthedocs.io/en/latest/_static/AFRPL-TR_76-76_MON_propellants.pdf), Vol II §2.3-3: NTO vapor correlation stated adequate for MON-1/MON-3. [NASA RP-1013](https://ntrs.nasa.gov/api/citations/19780005291/downloads/19780005291.pdf): MMH vapor correlation. [NASA GUNNS fluid properties](https://raw.githubusercontent.com/nasa/gunns/master/ms-utils/properties/FluidProperties.cpp): MMH/NTO heat-capacity fits for pad-duty estimates.
- [NASA thermal-control survey](https://www.nasa.gov/smallsat-institute/sst-soa/thermal-control/) and [power-subsystem survey](https://www.nasa.gov/smallsat-institute/sst-soa/power-subsystems/): architecture and pack-level context. Our optical, coupling, conductance, pack and mass assumptions are design requirements/estimates, not performance established by these surveys.
- [ArianeGroup engine catalog](https://www.ariane.group/app/uploads/2024/09/ArianeGroup_Chemical_Bipropellant_Thruster_Family.pdf), [propellant tanks](https://space-propulsion.com/brochures/propellant-tanks/spacecraft-propellant-tanks.pdf), and [PVG50 bottle](https://www.mt-aerospace.de/files/mta/tankkatalog/Datenblatt_PVG-50.pdf): unchanged proposed engine and vessel references from the earlier studies.
