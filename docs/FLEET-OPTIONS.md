# Ship options for review

2026-10-17. Concepts for Alvin's review. **No fleet changes are approved or implemented by this document.**

| Option | Suitable role | Main tradeoff |
|---|---|---|
| Keep the current ion-powered classes | Slow, fuel-efficient orbital transport | Current quick-flight timetables cannot be retained; requires finite-thrust trajectories and a declared passenger/cabin mass budget. |
| Chemical orbital taxi | Strong, short burns for local transfers and capture | More propellant for the same delta-v; tank, payload and reserve mass must fit. Chemical propulsion energy is not priced as electricity consumed by an ion engine. |
| Hybrid Starseeker | Chemical departure/capture with electric cruise where useful | Two propulsion/fuel systems and extra dry mass; higher modelling complexity. It does not guarantee fast interplanetary service. |

**Recommendation:** keep fleet identities unchanged while the ledger is built. Then compare a chemical local taxi and a hybrid design against the ion baseline on the same routes. Choose a profile only after reviewing the resulting masses, burn times, route coverage and fares. Ship names and cabins may be fictional; engine capabilities and budgets must be explicit and physically consistent.

No new thrust, Isp, passenger mass, reactor output, tank capacity or travel-time promise is introduced here. Sizing a candidate requires its sourced engine specification, vehicle dry/cabin mass, fuel/oxidizer or xenon inventory, electrical loads and reserves. A passenger life-support design remains additional work.

## Scientific basis

- NASA explains the distinction between the short strong burns of chemical propulsion and electric propulsion's sustained thrust: [The propulsion we're supplying, it's electrifying](https://www.nasa.gov/humans-in-space/the-propulsion-were-supplying-its-electrifying/).
- NASA's trajectory guide explains that electric thrust changes the trajectory over months or years: [Chapter 4: Trajectories](https://science.nasa.gov/learn/basics-of-space-flight/chapter4-1/).

The recommendation is an engineering proposal inferred from those tradeoffs and the repository audit, not a claim that any of these fictional passenger ships has been designed or validated.
