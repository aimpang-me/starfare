# Option B heat exposure and transfer: design record

## Work plan

- [x] Ground the existing thermal sizing and mass-ledger ownership.
- [x] Compare two independent physical hardware arrangements.
- [x] Select a design against source evidence, conservation, completeness and interface size.
- [x] Evaluate engine exposure and bottle/loop transfer requirements, retaining unknowns explicitly.
- [x] Reconcile all carried hardware and filled-fluid mass in the existing ledger.
- [x] Report proposed hardware, power and mass before any fleet changes.

## Scope and selection rubric

Offline investigation of the three saved Phobos pad mission envelopes. Score evidence quality, heat-transfer/pressure consistency through both burns, complete installed mass/power accounting, and a small reproducible interface (0–2 each). Preserve source engine/suite, nominal trajectory masses, retained inventories and no-free-bus-credit policy. No application tests or fleet/production changes.

Published catalog ranges do not establish an installed thermal boundary. A proposal may be a custom hardware requirement if no catalog assembly meets it; numerical sizing must not turn unknown geometry or conductance into demonstrated performance.

## Grounding

The independent how explanation traced the optional proposal load, verified mission schedules, inventory/tank selection, `sizeThermal` controlled-path requirements, and the final `sizeShip` mass reconciliation. `option-b-ship-budget.mjs` remains the sole total-mass owner. Thermal components enter before growth; retained helium replaces the older estimate; fixed departure/arrival masses determine payload and trim. The requirement calculation does not predict actual wall/gas/loop temperatures.

Outside COPV heating requires a series heat-transfer path through contact, composite/liner and internal gas. Firing acceleration and outlet flow can change gas-side convection; zero-g and firing cannot share a guessed conductance. A downstream heater cannot restore energy to stored gas. Coolant interfaces must share the available temperature difference, and pump draw must enter energy, battery, rejection and mass together.

## Candidate synthesis

Both isolated sketches were read end to end in `connector/.wrangler/thermal-design/hardware-a/` and `hardware-b/` (ignored research artifacts). Root and independent cross-judge agree on A: external heated bottles plus a separately budgeted secondary coolant loop, explicit missing transfer evidence and optional installed-hardware input. Scores for evidence / both-burn consistency / installed completeness / interface size: **A 2/2/1/2 = 7**, **B 2/2/1/1 = 6**.

B's larger warm gas bank is structurally viable as a further design study, but selecting it requires new real-gas temperature/pressure, wall and flow-imbalance analysis. Graft its ideal adiabatic diagnostic, no-reset requirement and distinction between stored-gas and outlet heating; do not claim a selected bottle count or subtract heater watts without a new analysis.

## Interface and accepted refinements

```powershell
node audit/option-b-ship-budget.mjs --feed-proposal audit/option-b-feed-proposal.json --thermal-proposal audit/option-b-thermal-proposal.json --thermal-hardware audit/option-b-thermal-hardware.json --out audit/option-b-thermal-hardware-budget.json
```

`validateThermalHardware(input, reference)` validates the new boundary. `sizeThermal(..., installed = null)` owns required heat/power and constructs component quantities using actual tank/bottle counts. `assessThermalHardware(context, required, input, reference)` owns installed exposure, series conductance, finite coolant approaches, hydraulic arithmetic and explicitly missing measured capacities. The existing ledger alone totals mass; no second mass calculator or production importer is added. Prior modes keep their numeric behavior.

Accepted during root/cross-judge reconciliation: replace candidate A's lumped loop with itemized hardware, four litres of nonpanel coolant and a carried pad interface; allocate 6→8 °C coolant and 5 °C panel with finite approaches; use a 150 W pump/15 W controls; add a 600 s exponential engine-cooldown sensitivity and an explicit one-hour post-capture conditioning duty. This extra hour is a design assumption, not saved flight time or a proven service plan. External service must take over thereafter.

Both final independent reviewers found component/phase/mass accounting consistent. They requested two corrections, accepted and implemented: make the 40 kPa allowance explicitly cover **all** nonpipe elements including panel and jacket branches, while keeping actual losses unknown; and give the gas conditioner its own finite coolant approach instead of interpreting the inherited full-span UA as installed capability. The installed assessment now returns a conservative gas-conditioner UA requirement with a 2.25 K minimum approach; inherited metrics are labelled reference lower bounds. Hydraulic success means only arithmetic within declared allowances, never measured pump/loop qualification.

## Numerical evaluation and limits

Selected conservative S/M/Cabin rows have source-to-sink duty through both burns, coast and one hour after capture. A 2→1 s refinement changes peak electrical rating inputs by <0.036 W, peak rejection rating by <0.057 W, selected duty energy by <0.000001 Wh, any individual phase/case energy by <0.015 Wh, and design mass by <0.0025 kg. The left-endpoint declining heat tail is intentionally conservative. These are numerical-resolution checks, not physical tests.

Independent sums of component, propellant and departure-mass ledgers have maximum absolute arithmetic residual **4.55e-13 kg**. Numeric comparisons against saved original/feed/thermal modes cover **6972/17332/34860** row fields respectively, with zero changes (this comparison includes mission numeric fields). No application tests were added or run. Source engine, connector engine, suite, fleet and deployment remain unchanged.

Outcome: S is 72.786 kg overweight empty; M fits 290 kg cargo plus 4.994 kg trim; Cabin is 5.151 kg overweight with two people and no cargo under the new duty and allowances. Full proposed assembly, primary references and evidence gaps: [heat-transfer study](OPTION-B-HEAT-TRANSFER.md).
