# Option B local-route evaluation

## Work plan

- [x] Ground the existing route endpoints and approximations.
- [x] Compare two independent numerical designs and cross-review the choice.
- [x] Implement an offline evaluation against the chosen design.
- [x] Evaluate flight time, consumed fuel, loading assumptions and numerical accuracy.
- [x] Reconcile the design and report the options before any fleet change.

The user approved evaluation only. Production fleet, planner, bundles, suites and deployment stay outside this artifact. Results must distinguish transfer time from engine firing and scheduling/boarding wait, state the final nonburned mass used, and distinguish numerical arrival from an actual station rendezvous.

## Candidate rubric

Score 0–2 on each: explicit endpoint/phase/plane scope; integrated finite thrust and changing mass; reproducible time/fuel tradeoffs; independently checkable numerical residuals; small offline interface with no production mutation.

## Grounding and synthesis

The independent `how` explanation found that `sol-engine.js:602` selects the first common primary, then quotes an instantaneous Hohmann transfer. `endpointModel()` owns parking-orbit chains (`:439`); `PLACES` owns radii/altitudes/inclinations (`:338`); `state()` supplies station circular motion with arbitrary J2000 phase (`:406`). Local `refly()` returns `pass: null` (`:1086`). The illustrated local arc is not a rendezvous.

An honest first finite-thrust demonstration uses the existing Earth 200 km orbit → Orbital Depot 500 km orbit, Mars 200 km orbit → Mars Base 300 km orbit, and Ceres 200 km orbit → Ceres Port 400 km orbit. These share one central primary and coplanar model orbits. Arrival must match radius, circular speed and the named station's phase, or explicitly remain orbit-only. Parking-orbit departure phase is an explicit design freedom for planet endpoints.

ISS/Tiangong need inclination and rendezvous phasing. Phobos → Mars Base and ISS → Lunar Data Center additionally need the moon's well, encounter and escape/capture. Their older idealized firing budgets cannot be relabelled as finite-thrust service times.

Numerical runtime available locally: Python with SciPy 1.17.1 / NumPy 2.4.4. The bundled workspace Python lacks SciPy; no package or project dependency was changed.

## Usage and provisional shape

```powershell
node audit/option-b-local.mjs --out audit/option-b-local.json
```

The Node shell reads the current engine's place constants, obtains the shared proposed chemical specification, and passes a JSON request to one Python numerical evaluator over stdin. The evaluator returns 18 results (three pairs, both directions, three final masses). Failed searches remain unresolved. The shell writes a reproducible local artifact; no production caller imports it.

```python
@dataclass(frozen=True)
class TransferRequest:
    primary: str
    mu_km3_s2: float
    body_radius_km: float
    from_radius_km: float
    to_radius_km: float
    final_nonburned_mass_kg: float

def evaluate(request: TransferRequest, chemical: dict) -> dict:
    raise NotImplementedError
```

Candidate A is the selected base. Resolve its ambiguous control description as **pure transverse thrust** along `e_theta` (not the full velocity vector); both burns are prograde for an outward transfer and retrograde for an inward one. Fit positive departure/coast/capture durations to final radius, zero radial speed and prograde circular speed. Independently replay in Cartesian coordinates, with fixed-step RK4 at successively smaller steps, to check the polar adaptive propagation. Candidate B's dimensional residual thresholds and explicit unresolved status are useful grafts.

Keep only two numerical ownership layers: `audit/option-b-local.mjs` owns engine extraction/process/JSON; `audit/option-b-local.py` owns physics, solving, phase rotation and numerical evidence. A shared `audit/option-b-spec.mjs` owns the proposal's sourced engine constants for this evaluator and `ship-options.mjs`; no second hand-synchronized specification is introduced.

## Synthesis decision and reconciliation

Two distinct designs were compared: A solves three segment durations with a prescribed transverse control; B solves vector steering at specified flight times with a constrained fuel objective. Independent cross-review scored the original A 8/10 and B 10/10, but recommended corrected A as the smaller first-results base, grafting B's acceptance/evidence rules. The parent agrees: a full time/fuel optimization adds a dimension this initial evaluation does not require. Neither design promises global optimality.

The review identified A's contradictory force law and burn signs before implementation. The accepted resolution explicitly uses zero radial thrust in both polar and Cartesian implementations, with both signs selected from the direction of the radius change. The review allowed this alternative to its preferred velocity-aligned control provided both propagators agree; this document and implementation now agree. Cartesian RK4 supplies a different coordinate formulation and integration algorithm from polar DOP853. Route extraction replaces both candidates' proposed hand-copied geometry snapshot, keeping the current engine as geometry owner.

The shell invokes `evaluate()` as the sole numerical entrypoint. The final implementation records three fixed seed searches per case, segment controls, finite-thrust flight/fuel results, radius/velocity and independent replay errors, continuous polar radial extrema and coast invariants. A failed search means unresolved, not physically impossible. `seed_convergence` records spread across three starts; these are not independent physical trials. The Node shell independently compares rotated Cartesian terminal position and velocity with the engine's actual station state at the Julian-date arrival, rather than reporting only an algebraically zero phase residual.

The implementation reviewer found no blocking endpoint, force-unit, mass-flow or scope issue. Its one finding was that some recorded refinement/coast diagnostics did not gate acceptance. The accepted correction adds explicit position/velocity refinement and coast-invariant thresholds to the verdict. A fresh evaluation after that correction accepted all 18 scenarios. [Results and limits](OPTION-B-LOCAL-EVALUATION.md) record the actual outputs. This is numerical model evidence, not application regression testing or a spacecraft qualification.
