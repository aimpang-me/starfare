# Ship options for review

2026-10-17. Concrete propulsion configurations for Alvin's review. **No fleet changes are approved or implemented by this document.** Engine performance is sourced; the proposed assemblies are fictional design candidates.

| Option | Concrete configuration | Suitable role / tradeoff |
|---|---|---|
| A: retain current ion profiles | NSTAR reference points: 19.5–92 mN, 1950–3280 s Isp, 490–2310 W at the thruster; xenon. Current RTG class can supply only the 490 W point. | Efficient, slow transport; requires a finite-thrust trajectory. Current quick-flight timetables cannot be retained. |
| B: Chemical Local | Four ArianeGroup 400N-family engines, each nominally **425 N**, giving **1700 N** aligned thrust; **321 s Isp**. MMH plus N2O4/MON oxidizer, nominal oxidizer/fuel mass ratio 1.65. | Candidate for local departures/capture. Higher propellant mass, separate fuel/oxidizer tanks, pressure system and electrical loads required. |
| C: Hybrid Starseeker | The same four-engine chemical cluster, plus one NSTAR unit for selected cruise maneuvers: up to 92 mN at 2310 W net and 3280 s Isp. | Separate chemical and xenon inventories, additional engine/power hardware and a solved maneuver allocation. No fast interplanetary service is promised. |

**Recommendation:** evaluate B on local routes first, with A as the efficiency reference. Evaluate C after explicitly allocating chemical versus electric maneuvers and extending the ledger beyond its current xenon-only consumption model. Choose a profile only after reviewing the resulting masses, trajectories, route coverage and fares. This recommendation is not authorization to replace a fleet class.

The [first Option B local evaluation](OPTION-B-LOCAL-EVALUATION.md) now supplies integrated flight/fuel results for three same-primary orbital pairs at three masses in both directions. It does not yet validate the existing Phobos or Earth–Moon bookings, select a hull or change the fleet.

The subsequent [Phobos → Mars Base study](OPTION-B-PHOBOS-EVALUATION.md) evaluates a proposed pad and an instantaneous staging reference. At 1000 kg final mass the pad case takes 143.4 minutes of flight and consumes 479.8 kg of fuel plus oxidizer, with alignment wait reported separately. It remains conditional on the stated source/dynamics assumptions; no fleet or endpoint is selected by the study.

The [tank, reserve and complete ship budgets](OPTION-B-SHIP-BUDGETS.md) propose two local cargo concepts and a two-person cabin concept. Their mass ledgers close under the stated conservative assumptions; engine feed pressure remains unresolved. The existing lunar mass envelopes are overweight with complete hardware/reserve budgets. These are conditional study proposals for review, with no fleet change.

The [feed-pressure follow-up](OPTION-B-FEED-PRESSURE.md) proposes separate helium regulation, wider feed lines, calibrated orifices and a measured firing envelope. Updated mass allocations allow 40/420 kg courier cargo or two occupants plus 150 kg cargo; exact regulators, thermal continuity and delivered performance remain unverified. These proposed budgets do not authorize a fleet change.

The subsequent [thermal power study](OPTION-B-THERMAL-POWER.md) replaces the 8 kg thermal placeholder with dedicated conditioning, radiator and battery estimates. Under its declared heat sensitivities, the small courier is overweight; revised proposals allow **350 kg medium-courier cargo** or **two occupants plus 60 kg cabin cargo**, with **1.91/1.98 kW** thermal electrical design ratings. Actual heat exposure, conductance, pad service and hardware remain unverified; pressure continuity is not demonstrated.

The latest [heat exposure and installed-hardware investigation](OPTION-B-HEAT-TRANSFER.md) adds explicit jackets, shields, transport coolant and pad interfaces, a 150 W pump allocation and one hour of post-capture conditioning. Its conservative medium-courier proposal carries **290 kg cargo** at a **2.085 kW thermal design rating**. The small courier and two-person cabin are overweight under that duty/assembly. Component classes are identified; installed exposure, conductance and qualified hardware performance are still unproven.

The four-engine alignment is a proposal, not a flown assembly. The chemical engine datasheet lists 4.30 kg bare mass with valve per engine (17.2 kg for four); this excludes tanks, piping, pressurization, mounting, thermal protection, cabin and passengers. No hull dry mass, tank capacity, electrical plant, reserve or passenger mass is silently assigned to an existing Starseeker. A hybrid must supply 2310 W **net at the ion burn location**, not merely have that solar rating at 1 AU.

## Quantified comparison: burn budget, not a new trajectory

The script `node audit/ship-options.mjs --out audit/ship-options.json` uses the current full plans at JD 2461700.5 and the rocket equation. All rows are normalized to **1000 kg final nonburned mass**, including hull, payload and unburned reserves. This is a comparison unit, not a selected hull mass. Chemical propellant is fuel **plus oxidizer**; xenon tank capacities do not apply to it.

| Existing route's impulsive delta-v | Delta-v | Chemical propellant | Four-engine firing time |
|---|---:|---:|---:|
| Phobos → Mars Base | 1.197 km/s | 462.8 kg | 14.3 min |
| ISS → Lunar Data Center | 3.898 km/s | 2449.6 kg | 75.6 min |
| Titan → Earth | 11.765 km/s | 40992.0 kg | 21.1 h |

These are idealized constant-thrust fuel/firing budgets for the **existing impulse demands**, not passenger trip times, tank sizing or validated route feasibility. Finite-thrust gravity losses and encounter geometry still need solving. Titan's roughly 41 tonnes of propellant per tonne of final mass demonstrates why chemical thrust alone does not establish a usable outer-system taxi. A hybrid total remains unspecified until its burns are allocated; no arbitrary electric/chemical split is invented.

## Scientific basis

- NASA explains the distinction between the short strong burns of chemical propulsion and electric propulsion's sustained thrust: [The propulsion we're supplying, it's electrifying](https://www.nasa.gov/humans-in-space/the-propulsion-were-supplying-its-electrifying/).
- NASA's trajectory guide explains that electric thrust changes the trajectory over months or years: [Chapter 4: Trajectories](https://science.nasa.gov/learn/basics-of-space-flight/chapter4-1/).
- All five reference ion operating points are in [NASA/CR-1999-209162, Table 1, PDF page 26](https://ntrs.nasa.gov/api/citations/20000003023/downloads/20000003023.pdf#page=26). Published thrust values are rounded; the ledger consistently derives thrust from power, Isp and efficiency.
- Chemical engine nominal thrust, Isp, mixture, engine mass and propellants are from the manufacturer: [ArianeGroup chemical bipropellant family, PDF page 8](https://www.ariane.group/app/uploads/2024/09/ArianeGroup_Chemical_Bipropellant_Thruster_Family.pdf#page=8).

The recommendation is an engineering proposal inferred from those tradeoffs and the repository audit, not a claim that any of these fictional passenger ships has been designed or validated.
