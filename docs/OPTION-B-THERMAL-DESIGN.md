# Option B thermal continuity study: design record

## Work plan

- [x] Ground both saved burn schedules, pressure/gas inventories and thermal boundaries.
- [x] Compare two independent thermal/power architectures and select the proposal.
- [x] Build an offline phase-resolved thermal requirement model and mass reconciliation.
- [x] Evaluate both burns, intervening coast and uncertain heat-load sensitivities.
- [x] Report thermal power, energy and revised mass budgets before any fleet change.

## Scope and rubric

Assess the three Phobos ship proposals against their existing finite-burn timelines. The first firing includes the contiguous 20-second pad lift. Keep departure and arrival mass fixed, reuse the existing mass ledger, preserve retained inventories, and do not assume nominal engine performance from pressure alone. No fleet, production physics or deployment changes.

Compare designs on energy/pressure conservation, actual burn/coast coverage, explicit environmental/engine heat-load uncertainty, complete power/hardware/gas mass accounting, and a small reproducible offline interface (0–2 each). Thermal allocations are estimates until hardware and geometry substantiate them; no guessed heat coupling may be presented as a measured spacecraft load.

## Grounding and synthesis

The independent how explanation traced the actual pad schedule: first contiguous firing 232.554/444.433/862.602 s, coast 8043.330/7718.138/7247.202 s, capture 221.434/443.994/898.335 s. High-pressure bottle outflow removes enthalpy; expanding ullage includes flow work. Static density/cutoff tables do not prove transient thermal behavior. Existing bus electrical allocations do not establish available power.

Both candidate sketches were read end-to-end; root and independent cross-judge select A's electrical heater/radiator path. Each scored 10/10 on the rubric. Graft B's pad conditioning, finite heat-transfer requirements and zero recovered-heat baseline. The low-temperature PCM store lacks a selected flight assembly and would add finite energy/coupling constraints; retain it as an alternative, not a claimed saving. Sketches stay ignored in `connector/.wrangler/thermal-design/`.

## Usage and model contract

The existing mass CLI remains the only mass-ledger owner:

```powershell
node audit/option-b-ship-budget.mjs --feed-proposal audit/option-b-feed-proposal.json --thermal-proposal audit/option-b-thermal-proposal.json --out audit/option-b-thermal-budget.json
```

A pure `sizeThermal(context, proposal, properties, feed, hardware)` module calculates required heat/power along a controlled reference path and returns filled thermal hardware/battery allocations and corrected initial helium mass. The context contains the existing ledger's mission, liquid/tank/gas inventories, feed allocation and chemical specification. Mission snapshots own verified phase times; properties own sourced vapor correlations and NIST real-helium energy tables. Keep the previously proposed tank banks fixed while comparing thermal hardware; no global catalog optimum is claimed.

Accepted narrowing, independently reviewed: actual conductances, engine radiation paths and geometry are unknown. Calculate the phase-resolved **isothermal control demand** and necessary heat-transfer capacity instead of inventing those coefficients and presenting a simulated trajectory as validation. LP target is 283.65 +/- 0.25 K, HP reference is 293.15 K. Outputs remain required power/energy/UA under declared heat-load sensitivities. They do not demonstrate hardware continuity.

Conserve HP gas energy with changing real-fluid internal energy and enthalpy. Keep each liquid node's heater/cooler demand separate; no cancellation across disconnected systems. Source the MON-3/NTO vapor approximation from USAF Vol II, the MMH correlation from NASA RP-1013, and heat-capacity context from NASA GUNNS. Retained vapor and wet-line liquid must fit unusable residual inventory; actual initial helium partial pressure and mass return to the ledger. No venting or unspent-reserve use occurs in the nominal timeline.

Size independent battery peak and energy for the entire flight without bus/generation credit. Replace the 8 kg thermal placeholder once. Heat-load scenarios are +/-5 W/m2 over the declared insulated area and 0/250/1000 W total engine coupling during firing; these are sensitivity inputs, not evidenced spacecraft limits. Preserve pressure-reference, regulator and calibrated thrust/Isp uncertainties from the feed study.

## Reconciliation and review

Independent implementation reviews by the active-design candidate and grounding/cross-judge found no blocking thermodynamic or fixed-mass accounting errors within the narrowed reference-path contract. Both required prominent external pad conditioning and a release-at-target prerequisite. Both identified the HP energy residual as an algebraic identity, not validation. The grounding review additionally confirms that nominal thermal evaluation does not establish reserve-maneuver continuity. These limits are retained in the output and [final study](OPTION-B-THERMAL-POWER.md).

Accepted local refinements: keep the previous tank banks fixed; integrate the sourced linear heat-capacity fit for external pad duty; increase proposed unusable retained inventory from 1% to 1.2% to cover wet lines, equilibrium vapor and an explicit PMD liquid allowance; replace the previous pure-helium tank allocation with partial-pressure helium mass. The single mass-ledger owner and optional CLI boundary remain intact. No production call sites use the thermal module.

The original and feed-only numeric budgets remain unchanged. A 2-to-1-second firing-step comparison bounds resolution changes for the selected proposals; it does not validate actual hardware. No application tests, fleet or production physics changes were made.
