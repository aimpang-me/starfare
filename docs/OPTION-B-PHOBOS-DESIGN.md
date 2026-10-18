# Phobos → Mars Base evaluation design

## Work plan

- [x] Ground the Phobos endpoint, moving gravity and rendezvous requirements.
- [x] Frame two distinct numerical designs and cross-review the choice.
- [x] Implement the offline evaluator against the agreed shape.
- [x] Calculate launch wait, flight time, fuel, clearances and independent arrival evidence.
- [x] Reconcile findings and present results before any fleet change.

Evaluation only. Fleet, production places/planner, bundle, suites, score and deployment are outside the scope. Reuse the sourced Option B engine proposal and current geometry; do not stretch an old Hohmann time or treat a moon encounter as a single-body orbit.

## Grounding / open boundary choices

The current Phobos model has orbital radius 9376 km, period 0.31891 days, GM 0.0007087 km³/s², radius 11.1 km and an assumed 10 km parking altitude. Mars Base is a fictional circular station 300 km above Mars, not a surface base. Prior screening found the 21.1 km assumed Phobos parking radius lies beyond its approximate Hill radius. An instantaneous departure state at that location can be evaluated without asserting a stable waiting orbit.

Use the previous 500/1000/2000 kg final nonburned mass comparison. Propellant is total MMH plus oxidizer. Report preparation/wait and flight separately; a wait cannot be spent on an unvalidated free orbit. A proposed Phobos facility or launch waypoint must be labeled as a proposal, and arrival requires station position and velocity, not just Mars altitude.

## Candidate rubric

Score 0–2 each: explicit physical boundary states/wait; moving-moon gravity and finite-thrust/mass; reproducible bounded solve; independent frame/invariant/arrival evidence; small offline ownership boundary with unchanged runtime.

## Grounding, usage, synthesis and reconciliation

The independent `how` pass confirms that `sol-engine.js:449–450,618–620` collapses Phobos escape into an instantaneous well burn. `circular():400–405` prescribes Phobos using its tabulated period, while the station uses the Kepler frequency. The offline one-body solver's free initial phase (`option-b-local.py:214–225`) is not available for a prescribed Phobos source state. Preserve the difference in angular rates and solve a launch wait.

The new model must include Mars gravity plus moving Phobos gravity and the Mars-origin indirect acceleration throughout all segments. For fixed Phobos-relative initial conditions, solve one relative trajectory; rotational symmetry permits calculation of the smallest nonnegative wait for the station rendezvous. Independently replay at that actual launch epoch, and check the full station state.

Compare two explicit boundary states: (1) instantaneous 21.1 km radius, anti-Mars side, prograde local circular-speed reference, supplied at launch with no assertion of stable waiting; (2) proposed anti-Mars surface pad on an approximate synchronously rotating ellipsoid of semiaxes 13.5×11×9 km, with a 20-second outward liftoff. The latter uses a declared 1 m initial pad clearance and includes liftoff in flight/fuel. Ellipsoid shape is an assumed collision model, not a measured landing site or gravity field. The source of these approximate dimensions is NASA/JPL's Phobos image description.

## Usage and shape

```powershell
node audit/option-b-phobos.mjs --out audit/option-b-phobos.json
```

`option-b-phobos.mjs` extracts current engine geometry and the shared chemical proposal, passes JSON to one Python evaluator and compares its actual-epoch arrival against the engine station. `option-b-phobos.py` owns source states, moving gravity, bounded shooting, launch clock and numerical evidence. No production code imports either.

```python
@dataclass(frozen=True)
class Source:
    kind: str
    radius_from_phobos_km: float
    motion: str  # local_circular reference | body_corotation proposal
    lift_seconds: float

def evaluate(model, source: Source, final_mass_kg: float, chemical: dict) -> dict:
    raise NotImplementedError
```

## Synthesis and accepted reconciliation

Candidate A uses a Cartesian three-duration boundary solve plus analytic launch wait; B uses rotating-frame multiple shooting with explicit wait and additional steering variables. The cross-judge scored A 9/10 and B 10/10 but recommended corrected A for this one-route slice, grafting B's rotating equations, Jacobi invariant, dimensional acceptance thresholds and actual-epoch replay. The parent agrees with that boundary and independently read both candidates.

Both main burns are Mars-relative **transverse retrograde**; A's copied prograde/departure wording is rejected. Lift is a separate 20-second segment following the synchronous anti-Mars axis (not the changing craft-to-moon direction). All propagators use the same law. Search bounds: each main burn .05..5 times its impulsive seed; coast .5..1.5 times the half-ellipse seed, three coast starts .9/1/1.1. The minimum flight among converged starts is a local-family result, not a global optimum.

Use a conservative **13.5 km spherical exclusion envelope** enclosing the assumed ellipsoid, with the pad initial point at 13.501 km on the long anti-Mars axis. Report envelope clearance, not terrain clearance. A rejection by this envelope does not prove actual terrain collision. The reviewer explicitly accepted this simpler conservative check.

The primary solver includes Mars plus moving Phobos direct/indirect gravity. An independent rotating-frame RK4 replay at two step sizes checks Coriolis/centrifugal terms, coast Jacobi conservation and thrust-work change; a tighter actual-epoch inertial replay checks clock and station position/velocity. Candidate A's hand-copied constants module is replaced by live engine extraction and the already shared Option B specification. Failed searches remain unresolved, including failed numerical accuracy or envelope checks.

## Implementation reconciliation

The first 1000 kg pair and the full six-case matrix met the numerical criteria. Implementation review found the clearance minima needed an independent refinement check; event-detected extrema alone did not establish the promised evidence. The accepted correction refines inertial maximum step from 60 s to 5 s, retains minimum clearances and their times, and compares rotating-frame 2 s/1 s sampled minima. Agreement within 0.1 m now gates acceptance. A fresh six-case run after that correction exited 0 with all six accepted. These are numerical model checks, not application tests or landing-site certification.

The accepted implementation uses the agreed synchronous outward lift and both retrograde main burns. Its prescribed Phobos rate is retained and its non-Kepler period difference is disclosed. The launch wait is an actual timing constraint for fixed source conditions; the staging reference is supplied only at launch, while the proposed pad supplies physical support during its wait. [The evaluation report](OPTION-B-PHOBOS-EVALUATION.md) distinguishes the two.

The same independent reviewer inspected the corrected code and all six fresh result records, confirmed the clearance reconciliation and found no remaining actionable issue within this declared scope. It did not run simulations itself. Numerical agreement does not establish a real pad, stable parking orbit, terrain clearance or operational spacecraft feasibility.
