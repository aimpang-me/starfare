# Option B feed-pressure investigation: design record

## Work plan

- [x] Ground the current mass/pressure model and manufacturer operating limits.
- [x] Compare two independent feed-system designs; cross-review and select a proposal.
- [x] Implement the selected proposal in the offline budget study.
- [x] Evaluate pressure requirements and updated mass budgets; record remaining evidence gaps.
- [x] Present the proposed fix before any fleet change.

## Boundary and rubric

Investigate the engine-feed pressure gap and prepare revised conceptual ship budgets. No fleet, production physics or deployment changes. Existing accepted trajectory arrival masses remain fixed; added feed hardware consumes growth/payload/trim capacity and never changes the saved burn/flight by fiat.

Compare alternatives on: physically consistent operating/stored pressure and temperature states; manufacturer evidence for flow/lockup/droop/media/rating; complete mass and gas accounting; honest engine performance limits; small reproducible offline interface. Each criterion scores 0–2. Missing evidence is a requirement, not permission to claim qualification.

Current reference: cold tank total allocation 16.25 +/- 0.25 bar, warm total screen 20.75 bar, tank MEOP 22 bar, engine inlet range 12.5–18.5 bar. Study feed loss is allocated at 3 bar, not measured. Engine nominal thrust/Isp does not follow merely from staying inside its inlet range.

## Grounding

The independent how explanation traced liquid inventory, physical tank thermal screens, helium capacity, and fixed arrival mass through the existing calculator. Tank pressure and engine inlet pressure are different states. A maximum feed loss cannot be subtracted as a guaranteed pressure reduction; an upstream helium regulator cannot remove trapped thermal pressure. Keep the existing mass selector and mission provenance as the only ledger owners. An allowed inlet interval does not establish the nominal thrust/Isp operating point.

## Usage and shape

```powershell
node audit/option-b-ship-budget.mjs --feed-proposal audit/option-b-feed-proposal.json --out audit/option-b-feed-budget.json
node audit/option-b-ship-budget.mjs --feed-proposal audit/option-b-feed-proposal.json --mission phobos-pad-2000kg --role passenger
node audit/option-b-ship-budget.mjs --out audit/option-b-ship-budget.json
```

`option-b-feed-proposal.json` owns declared feed requirements and component replacement allocations. Pure `assessFeed(budget, proposal, hardware)` hides hydraulic/flow/pressure/gas checks and returns requirements with explicit evidence gaps. `feedAllocation(role, proposal, hardware)` returns replacement dry components and retained dead-volume helium. The existing calculator applies them before growth and re-closes the same trajectory masses. No second catalog selector, CLI or copied mission ledger.

Outcome contract: `requirements_only` is distinct from conditional mass closure. It never means the thermal system, regulator, failure isolation or engine calibration has been verified. A pressure interlock can reject a burn; continuous scheduled firing remains an unresolved trajectory applicability gate.

## Synthesis decision

Both sketches were read end-to-end. Root and independent cross-judge selected A, helium regulation plus operating pressure/thermal requirements, over B, downstream liquid regulation plus higher tank pressure. Scores: A 9/10, B 8/10, on the five criteria above. A lacks an exact regulator match; B additionally lacks a qualifying chemical-compatible liquid regulator and likely requires heavier tanks. The sketches remain ignored under `connector/.wrangler/feed-design/`.

Graft B's separate fluid flow bounds including all RCS, zero/pulse/maximum-flow states, minimum differential/lockup/restart requirements, trapped-liquid and helium-release limits, and explicit unverified thrust/Isp status. Reject fixed orifices as a substitute for pressure regulation; retain manufacturer orifice calibration as a separate performance requirement.

## Accepted implementation decisions

- Preserve original 20/25 kg common-feed allocation as isolation, filtration, manifold and integration reserve. Replace its generic row explicitly, then add 16 kg net bare hardware: 3.6 kg regulator allowance, 1.4 kg sensing/control, 3 kg line/trim upgrades, 8 kg thermal equipment. The old allowance is not credited against these additions; new allocations are estimates, not a qualified bill of materials.
- At 40% growth this adds 22.4 kg dry design mass, plus small retained helium in new gas lines and ullage displaced by wet feed-line inventory. Reduce courier cargo from 70/450 to 40/420 kg; retain two occupants plus 150 kg Cabin cargo. All wet line liquid comes from existing loaded propellant; its trapped amount must fit existing unusable residual per fluid.
- Model a 14 mm internal-diameter, 2 m header and 6 mm, 1 m main branches. The initial 12 mm proposal was widened to retain margin with a declared conservative friction factor. RCS branches have their own geometry. Lengths, friction/viscosity bounds, fittings and fixed PMD/filter loss remain assumptions to measure.
- Use measured absolute tank firing limits 15.5–17.5 bar with sensor/transient and signed acceleration-head allowances; minimum hydraulic loss is zero. Keep the independent 30 C hot storage/MEOP check. No venting is introduced. Supplier/thermal/performance evidence remains unresolved regardless of arithmetic passes.
- Review found the manufacturer engine inlet table says only "bar". Compare absolute and gauge-relative-to-standard-atmosphere interpretations, require the interval to fit both, and keep the comparison provisional until the supplier confirms its reference. Review also required numeric proposal inputs and residual coverage to be enforced; both are boundary/refusal conditions now.

## Reconciliation and result

Independent physical and accounting reviews accepted the selected model arithmetic, wet-line volumes and additional retained gas. Their numeric-boundary, residual-coverage and pressure-reference findings are incorporated above. The optional feed flag preserves the original no-flag mass budgets. Pressure and flow evaluations remain explicitly requirements only, separate from mass closure; the offline ledger does not change nominal thrust, Isp, production routes or the fleet.

The [reviewable result](OPTION-B-FEED-PRESSURE.md) includes complete revised ledgers. Combined conservative selected budgets close with 12.656/14.066/8.410 kg additional trim for 40/420/150 kg cargo respectively. The worst selected modeled pressure interval is 13.646–18.148 bar absolute. The design has not established the exact regulator configuration, temperature/pressure continuity through scheduled burns, chemical properties, transient/failure behavior or calibrated engine performance. These remain requirements, not passing defaults.
