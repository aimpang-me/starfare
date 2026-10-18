# Option B tank and reserve study: design

## Work plan

- [x] Ground the propulsion and trajectory mass contract; research tank/pressurant data.
- [x] Compare two independent budget designs and cross-review the synthesis.
- [x] Implement the offline mass, reserve and tank calculator.
- [x] Evaluate complete ship options and numerical mass closure; reconcile assumptions.
- [x] Report concrete options before any fleet change.

## Boundary

The user authorized sizing tanks/reserves and proposing complete ship budgets. Existing Option B is four aligned 425 N engines at 321 s Isp, MMH/N2O4 mass ratio 1.65. Existing lunar examples normalize final nonburned mass to 500/1000/2000 kg. That arrival mass already includes the ship, payload, retained chemical reserve, trapped residuals and retained pressurant. Adding these above the envelope invalidates the saved trajectory.

The study must close departure and arrival mass, distinguish usable reserve from unusable residuals, size separate tanks with ullage and thermal density assumptions, include pressurant gas/storage/feed hardware, and label component estimates and reserve policy. It must not turn normalized masses into passenger claims without cabin/life-support budgets. Fleet and production physics remain unchanged.

## Comparison rubric

Score 0–2 each: mass/trajectory consistency; reserve and residual separation; sourced tank/pressure/density reasoning; complete reviewable component/payload budgets; small offline interface and reproducibility. Candidate sketches are isolated under `connector/.wrangler/tank-design/`.

## Grounding and synthesis

The independent `how` explanation traced the saved trajectory's final mass through engine specification, finite-burn propagation and station replay. A budget allocator belongs in `audit/`, consuming immutable mission envelopes and reserving mass for hardware, gas, liquids and payload. A negative remainder is a refusal, not permission to scale the old trajectory.

The two sketches both scored 10/10 in the independent arena review. Select B's discrete catalog enumeration and single offline calculator; graft A's explicit verified-source provenance and sensitivity outcomes. Both keep the trajectory envelope fixed. The user confirmed both passenger and cargo proposals. Compare the three proposed Phobos pad cases and four lunar cases; preserve their distinct physical scopes.

## Usage and shape

```powershell
node audit/option-b-ship-budget.mjs --out audit/option-b-ship-budget.json
```

One calculator owns `sizeShip(mission, role, policy) -> conditional_budget | mass_deficit`, hides inventory, discrete tank-bank selection and helium accounting, and returns complete ledgers. `option-b-hardware.json` owns sourced catalog/EOS snapshots; `option-b-ship-assumptions.json` owns estimated component allocations and policy; `option-b-ship-missions.json` owns checked snapshots of verified route budgets. No production imports this study.

## Contract

- Fixed arrival mass includes all hardware, passengers/cargo, unspent reserve, residuals, retained helium and growth allowance. Departure mass is exactly arrival mass plus nominal mission propellant consumed.
- Policy: 5% of nominal consumed propellant as contingency, plus an independent 100 m/s ideal docking/attitude allowance at the 10 N thruster's 292 s Isp. Size the latter from full arrival mass using `mf*(1-exp(-dv/ve))`; using contingency first only increases its ideal capability. Neither reserve maneuver nor docking is a validated trajectory.
- Residual is 1% of loaded liquid: `load=(burn+contingency+docking)/(1-.01)`. Keep every liquid component separate and split at O/F 1.65. Minimum ullage is 5% at the warm bound; conservative liquid design densities and 4% expansion from 10 to 30 C remain explicit assumptions.
- Enumerate separate catalog banks, reject inadequate pressure or volume, and include tank-specific mounts/manifolds and thermal allocations. Select the combination with the lowest total retained sizing mass, not just the lightest shell.
- Helium is precharged in tank ullage and stored in actual 50 L bottles; all is retained in the no-vent/no-jettison model. NIST real-gas snapshots cover charge, cold cutoff and low-pressure tank gas, plus hot bottle pressure. Size withdrawal capacity through consumption of all usable reserves, with 15% gas-delivery allowance.
- Baseline allocates 25% growth on the enumerated dry hardware subtotal, excluding liquids/gas, occupants and cargo. Proposed budgets use the combined sensitivity: 40% growth plus 10% burn contingency. Passenger concepts additionally include cabin, seats, life support, protection, emergency equipment and retained consumables/waste.
- Positive payload is a conditional mass allocation; trim/ballast closes the target envelope after rounding. If as-built mass is lower, carry equivalent cargo/ballast or recompute the trajectory. Passenger mass closure does not establish human readiness.

## Alternatives and reconciliation

Continuous tank mass fractions lost to catalog enumeration because pressure/capacity choices are discrete. A coupled ship/trajectory optimizer is deferred until these budgets expose useful mass envelopes. Missing detailed feed, thermal, regulator and cabin verification remains explicit conditional engineering work; arithmetic closure is never promoted to operational approval.

## Reviewed implementation and outcomes

The [complete budgets](OPTION-B-SHIP-BUDGETS.md) report 56 numerical sizing evaluations with fixed payload targets across sensitivities. Seven mission snapshots match accepted local reports and recorded hashes. Offline clones explicitly label absent report provenance as reviewed snapshots. The calculator refuses source engine/specification drift and inconsistent pinned helium pressure/temperature states.

The selected combined-case concepts close at 70 kg cargo in the 500 kg Phobos envelope, 450 kg cargo in the 1000 kg envelope, and two occupants plus 150 kg cargo in the 2000 kg envelope. Independent reviews found no remaining accounting/enumeration blocker. The previously considered 250 kg cabin cargo target fails the combined budget by 69.18 kg. Every lunar envelope is overweight before cargo.

Pressure review changed the preliminary design: closed ullage heating and liquid expansion must precede tank selection. Use 16.25 +/- 0.25 bar cold allocation, NIST 30 C hot helium bounds, an explicitly assumed 2 bar vapor contribution and 1 bar transient headroom. Equal fractional filling makes the individual tank calculation identical within a bank; retain each tank's fill allocation in the report. The selected banks pass the assumed tank MEOP screen, but the upper inlet pressure exceeds the main-engine catalog range. Engine feed pressure and actual propellant properties remain explicitly unclosed. No operational readiness or fleet update follows from mass closure.

Complete as a conceptual budgeting study. Feed/regulator flow/loss and thermal/property verification, electrical loads, physical integration, pad clearance and any docking/abort/return trajectory remain separate engineering work. No application tests were added or run for this numerical study.
