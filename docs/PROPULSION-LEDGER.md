# Fuel and power ledger: first implementation slice

2026-10-17. Approved by Alvin after the propulsion audit. **Diagnostic only. Fleet selection remains pending.**

## What is implemented

- One pure itinerary assessment in `world/engine/propulsion-ledger.mjs`.
- One full-plan translation boundary in `world/engine/propulsion-adapter.mjs`.
- An artifact generator in `audit/propulsion-ledger.mjs`; its local JSON output contains the normalized inputs and complete ledger for seven real-plan examples. Generated JSON evidence stays out of Git and is reproducible from the checked-in scripts.

The ledger carries xenon reserved for later burns, applies passenger loads at boarding/alighting stops, protects a declared reserve and accounts for explicit fixed-quantity refuelling. It computes each burn's thrust, flow, fuel, duration and electrical energy, with power checked separately at departure and capture. These are fixed-point impulse budgets, not integrated finite-thrust trajectories.

## Caller usage

```js
import { adaptFullPlans } from '../world/engine/propulsion-adapter.mjs';
import { assessItinerary } from '../world/engine/propulsion-ledger.mjs';

const input = adaptFullPlans(E, {
  id: flightId, ship: car.id, stops, plans: fullPlans,
  declarations: operatorDeclarations,
});
const ledger = assessItinerary(input);
```

`fullPlans` are the original successful `E.R.planLeg`/`E.planRide` results for the selected class. Slim connector legs and rounded receipts lack the exact burn split and are rejected. The adapter does not plan, re-fly or mutate a flight. The core takes the normalized itinerary directly if a future planner already produces it.

Optional declarations use `{ kind: 'known', value: measuredNumber, source: 'measurement or explicit model assumption' }`. An omitted declaration becomes `{ kind: 'missing', source: 'required declaration owner' }`, not a measured zero. Values are SI except explicit `_kg`, `_w`, `_mps`, `_jd`, `_au` and output `_kwh` units.

| Declaration | Meaning |
|---|---|
| `additional_mass_kg` | Cabin, equipment, carried hydrazine and structure not already included in class dry mass; avoid double counting. |
| `payload_mass_kg[bookingId]` | Total passenger/luggage mass for that booking, not a mass inferred from seats. |
| `initial_payloads` | Explicit already-boarded payloads, each `{ id, mass_kg: measurement }`. Otherwise use the current model's empty initial parked-ship manifest. |
| `initial_xenon_kg` | Actual starting fuel; class tank capacity is not assumed to be its fill level. |
| `reserve_kg` | Protected minimum xenon at the initial state and throughout the flight; explicit zero is permitted. |
| `refuel_kg_by_stop[index]` | Explicit delivered kilograms. Omission means no refuelling action. Final-stop refuelling cannot satisfy an earlier arrival reserve. |
| `power_loads_w[index].departure` / `.capture` | Additional electrical demand, including conversion losses not in the class housekeeping figure. |

Generate the concrete artifact from the repository root:

```powershell
node audit/propulsion-ledger.mjs --out audit/propulsion-ledger.json
```

This is an example/report command, not an automated test suite. It requires no secret, server, deployment or network access.

## Reading the result

- `minimum_initial_xenon_kg` and `requirements` are backwards-calculated minimum requirements. Missing nonnegative mass/reserve inputs produce explicitly labelled lower bounds.
- `minimum_loading` projects a forward inventory using that calculated minimum. `declared_loading` is a separate projection for an explicitly supplied initial inventory, or `null` when no load was declared. A minimum is never described as an actual observed fill.
- Incomplete forward balances are labelled `optimistic_projection`, since unknown passengers can consume extra fuel then alight; later remaining fuel and duration are not all monotone bounds. Such conditional projection findings alone never declare a flight infeasible.
- Proven minimum-fuel/capacity/time failures, a declared inventory below the minimum, or a selected thruster exceeding even the optimistic power supply are necessary failures and produce `infeasible` for the declared plan/model. Passing bounds produces only `unverified`; this module has no `verified` state.
- Zero-delta-v slots require no operating point, energy, fuel or firing time. Fuel depletion terminates a forward projection rather than propagating negative fuel. Unknown/partial totals stay unavailable.
- Power is a nominal endpoint sample; a burn's duration is not its scheduled start/end. Continuous power, storage, eclipses, coast/life-support consumption and thrust direction remain unsolved. Gameplay holding charges and correction percentages are not converted into invented physical burns.

`ledger.operating_point_alternatives` lists sourced NSTAR choices only where additional loads were declared. The quoted operating point remains selected for both endpoint burns so the actual existing quote is assessed. All five reference points are owned by the adapter, sourced to [NASA/CR-1999-209162, Table 1](https://ntrs.nasa.gov/api/citations/20000003023/downloads/20000003023.pdf#page=26). No replacement throttle point is silently applied to the current engine.

## Architecture rationale and reconciliation

The independent architecture candidates compared a generic resource-event stream with an ordered stop/leg batch. The cross-judge preferred the event candidate's mass/reserve semantics. The chosen synthesis keeps the stop/leg caller boundary, which already matches `R.planOf`, and adopts the event candidate's explicit additional fixed mass, protected reserve and separate required/loaded projections. Ordered burn/load/refuel transitions are privately evaluated within that one function. Callers do not coordinate separate accounting stages.

The implementation refines the sketches by distinguishing reverse necessary bounds from conditional forward projections when mass is unknown. Dependencies follow the affected burn: a later unknown boarding cannot weaken a known early-leg failure, and an unknown earlier passenger's alighting cannot create a false later-leg timing failure. Refuelling is a declared addition, not a reset or automatic fill. Boundary validation rejects malformed data, route/time mismatches, duplicate loads, absent alightings and slim legacy plans.

The core has no Node, engine, ephemeris, storage or transport dependency. The adapter owns current engine field names and reads endpoint positions through the supplied engine. The generator owns file I/O. This keeps source knowledge and arithmetic in one place each.

## Runtime boundary and next work

The modules are outside the explicit `world/bundle.py` source list. The shipped engine, suite, fleet, fares, scores, MCP responses and UI are unchanged in this slice. Integration will require exact immutable burn snapshots before `computeLeg` slims a plan; historical rounded receipts cannot be backfilled as verified physics.

Next: independently verify the ledger, then use it as the resource model for the first finite-thrust local solver. Review [ship options](FLEET-OPTIONS.md) before selecting or modifying fleet hardware. No deployment is included.

## Evidence and limits of this delivery

The seven-case artifact was generated by the new modules from the unchanged engine. It includes SF-04's 1100.205942 kg minimum for a 1085 kg tank, SF-05's 1443.116486 kg minimum, SF-01's unsupported Titan arrival power and the zero-burn Titan dock transfer. Missing engineering inputs remain explicit throughout. Source review identified and corrected conditional forward-balance labelling, capacity certainty and finite-arithmetic handling. JavaScript syntax checks passed. Automated tests were not added or run in this implementation turn; refuelling and declaration edge cases have source review only.
