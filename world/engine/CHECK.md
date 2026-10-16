# CHECK: sol-engine.js vs the Python planner and re-fly gate

Audit of the browser port (`sol-engine.js`, `sol-facade.js`, `ephem.json`) against the unmodified Python in
`sol/code` (DE421 via skyfield-data, `lambert_izzo.py`, `kepler.py`, `nbody.py`, `refly.py`, `quote.py`, `trip.py`).
Everything below is reproducible: `python3 bake_ephem.py` (about 5 min), then `node crosscheck.mjs` (about 15 min
with an empty cache; Python jobs run 4 at a time in separate processes and are cached in `$SOL_CACHE`).
43 routes (39 re-flown legs, 38 with a Python re-fly to compare): 15 `quote.py` cases (Earth to every planet, Roadster, Bennu 1-rev, Ceres), 3 `trip.py` cases
(Titan ride home energy/time, Roadster pickup), 18 general rides (Mars to Earth, Saturn to Earth, stations, moons,
a free ship, Uranus to Earth), 4 exact recorded legs (the day-2 Uranus leg Python rejects, the day-2 Neptune and
Saturn legs, the Titan ride home), and 3 local transfers.

## Verdict

| quantity | worst JS minus Python | where | notes |
|---|---|---|---|
| planner choice on the same grid | 0 of 36 differ | all | same departure date, TOF and Lambert branch in every case, including quote.py's and trip.py's own output |
| C3 at the same point | 3.1e-7 km²/s² | T2 Titan, 680 d | the ephemeris table: Saturn/Earth are within 5 m of DE421 |
| v∞ / burn at the same point | 2.6e-8 km/s | G10 Mercury to Venus | the same; Mercury has the largest planet fit error (11 m) |
| Lambert, 3,000 random cases | 5.7e-14 km/s | - | the port matches lambert_izzo.py to rounding, incl. which cases are infeasible |
| Kepler, 2,000 random cases | 9.3e-13 relative | - | |
| titan_burn | 0 | - | JS `wellBurn(Titan)` is trip.py's formula |
| re-fly retarget, same leg | 0.05 m/s | D3 Saturn | below Python's 0.1 m/s print rounding |
| re-fly raw miss, same leg | 70 km of 6.5 million | Q12 Roadster | the ephemeris table, amplified by a slow near-Earth departure (see 3) |
| re-fly PASS/REJECT at refly.py's rtol 1e-10 | 3 of 38 legs differ | Q10, Q11, D2 | integrator noise at rtol 1e-10; at 1e-12 all 38 agree, all PASS (see 1) |
| re-fly PASS/REJECT on the page's refined legs, rtol 1e-12 | 1 of 34 differs | Q12 refined | both stop at the 20-iteration cap at the same 376.1 m/s retarget (see 2) |

**Port correctness.** Where the two codes get the same inputs they agree to rounding: Lambert and Kepler to
1e-13, the planners' grid choices exactly, and the re-fly retarget to 0.05 m/s. Python fed the JS Chebyshev table
(`Py/cheb` in table C) reproduces the JS raw misses to within 2 km on legs up to 6 years. So the remaining raw-miss
differences come from the ephemeris table, not from the code.

## Disagreements and which side is right

1. **The day-2 Uranus REJECT, and the long-leg PASS/REJECT flips, are integrator noise. 1e-12 is right.**
   At refly.py's `rtol=1e-10`, the integration error on a 17 to 23 year leg is tens of km: Python's own raw miss on the day-2
   Neptune leg moves 37 km between rtol 1e-10 and 1e-12, and on the day-2 Uranus leg 16 km. That is far above the
   1 km bar, and the miss as a function of departure velocity becomes piecewise discontinuous because the step sequence changes with
   the input. So damped Newton stalls at a few to 22 km, on noise. At 1e-10 the codes disagree on 3 legs, and each
   is a coin toss: Q10 Uranus (Py REJECT 2.6 km / JS PASS 0.34 km), Q11 Neptune (Py PASS 0.78 / JS REJECT 3.6),
   and the day-2 Neptune leg (Py PASS 0.80 / JS REJECT 4.7). Both codes REJECT the day-2 Uranus leg at 1e-10
   (22.4 / 22.7 km). With the integrator tightened to 1e-12 (Python: the same refly.py functions with only
   `nbody.propagate`'s rtol swapped), **every leg passes in both codes, with the same retarget to 0.1 m/s**. The
   day-2 Uranus leg passes at 0.52 km (Py) / 0.24 km (JS) with the same 16.0 m/s retarget it had when it was
   rejected. JS at 1e-11 and 1e-13 converges too, to the same retarget. So the day-2 "REJECT" was not a
   property of the route. day2/RESULT.md suspected a numerical limit, and that is what it is.
   **Decision taken in the port:** `refly()` defaults to rtol 1e-12. It is *faster* than 1e-10 on long legs
   because Newton converges in 4 to 7 iterations instead of hitting the 20-iteration cap: 0.7 s vs 3.1 s on the Uranus
   leg. `refly(leg, {rtol: 1e-10})` gives refly.py parity. **Recommendation, not done, outside my folder:**
   change refly.py's `rtol=1e-10` to `1e-12` too, and re-run the day-2/day-3 goldens.
2. **Q12 refined leg (Earth to Roadster, 2027-02-12, 607 d, 1-rev high branch, 376 m/s retarget).** Python stops
   at 2.66 km and JS at 0.88 km, both after exactly 20 Newton iterations. The miss histories bounce
   (185,000, 177,000, 16,900, 8,400 km...) because a 376 m/s correction on a slow (C3 3.4) departure is strongly
   nonlinear. Both codes reach the same retarget, 376.1 m/s. JS passes at 1e-13 in 21 iterations. This is the
   iteration cap meeting a hard leg, not a port difference. The grid leg of the same route passes in both
   (244.7 m/s, 6 to 7 iterations).
3. **Raw-miss differences up to 70 km (Q12 Roadster), 15 km (Q13 Bennu), 13 km (day-2 Uranus).** These are the
   ephemeris table: Python with the JS table reproduces JS to 3.7 km on Q12 (6,545,312.7 vs 6,545,316.4 km), and
   both are 70 km from Python on DE421. Low-C3 departures linger near Earth, and Earth's 5 m table error is amplified. The
   retarget, final miss and verdict are unaffected (retarget equal to 0.1 m/s).
4. **quote.py prints C3 to 2 decimals.** Table A shows quote.py's rounded C3 next to JS's value at the same point,
   for example 9.180 / 9.183 for Mars. The exact DE421 value at that point, from crosscheck_py.py, differs from JS by at most
   3e-7. This is not a disagreement.
5. **The page's refined search is never worse than the Python grid.** In all 35 routes with a ride, the refined
   cost is at or below the Python grid optimum: Mars 2026 C3 9.182 vs 9.183, Saturn 7.305 vs 7.309 km/s, the Titan ride
   home 3.117 km/s in 1,973.2 d vs trip.py's 3.119 km/s in 1,970 d (cost includes the 0.1 km/s per year delay
   term). It also beats the TOF objectives by 3 to 4.5 days. Python re-evaluated at the refined points agrees with JS to 2.5e-8 km/s.
6. **A port bug found and fixed during the audit.** The first JS evaluator took its Chebyshev argument from the JD.
   A JD near 2.46e6 only resolves about 40 µs, and Earth moves 1.2 m in that time, so Earth's position was noisy at the metre level. Near
   Earth this made DOP853 reject steps: 3,544 steps instead of Python's 100 on the Mars leg, about 30 times slower.
   The evaluator now works in seconds past J2000: 100 steps, the same as scipy, and the raw miss agrees to 0.3 km.

## Ephemeris table (deliverable 1)

`bake_ephem.py` writes `ephem.json` (392.6 KiB, plus `ephem.js`, the same object as an ES module for inlining).
Format: piecewise Chebyshev, interpolated at Gauss-Lobatto nodes, so segment ends are continuous. Coefficients are
quantised and packed as zigzag varints in base64url strings. The segment length and degree are tuned per body to
the smallest size meeting a 10 m tolerance (Mercury 20 m, geocentric Moon 50 m); segments that miss it are halved
(adaptive splits for the Roadster's 2035 Mars and 2047 Earth passes, and around Bennu's 2035-36 Earth approach). Earth is not stored. It is rebuilt as
EMB minus k times the geocentric Moon, with k = 1/(1+EMRAT) read from DE421, so the 27-day wobble costs nothing extra.
**Coverage: 2026-10-01 to 2053-09-25**, which is more than the 2026-10-01 to 2046-12-31 asked for. The longer span
lets the day-2 Uranus and Neptune legs (arrivals in 2050 to 2052) be planned and re-flown. Cut to 2046-12-31, the table
would be about 300 KiB. Small bodies (Roadster, Bennu, Ceres) are their n-body orbits, integrated in the bake with the
same `nbody.Model` + DOP853 rtol 1e-12 as refly.py, from `data/targets.json`. The planner, like quote.py and
trip.py, uses 2-body Kepler from those same states and needs no table. Errors vs DE421 are in table G. The worst
position errors are the Moon at 25 m and Mercury at 11 m; all others are at most 5.5 m. The worst velocity error is
3.1 mm/s (Moon); all others are at most 1 mm/s.

## Engine (deliverables 2 and the coordinator's addendum)

- `state(body, jd)` covers planets (DE421 barycentres; DE421's 1->199, 2->299 and 4->499 offsets are zero), Earth,
  the Moon and the small bodies (`{smallBody: "nbody"}` for the re-fly orbit). It also covers the moons Phobos, Io, Europa,
  Ganymede, Callisto, Enceladus, Titan and Triton as **approximate** circular orbits about the parent: radius and
  period from the JPL SSD mean elements as listed in the source, the plane is the parent's IAU equator, and the
  phase is arbitrary. Triton is retrograde in Neptune's equator, which is about 23 degrees off its real plane. Titan uses trip.py's 1,221,870 km and 15.945 d.
- `PLACES` / `places.json` lists 27 places: 8 planets, 9 moons, Roadster, Bennu and Ceres, and stations. The stations are
  ISS (real, 420 km, 51.6 deg), Tiangong (real, 390 km, 41.5 deg), Orbital Depot (fictional, 500 km LEO), Lunar Data Center
  (fictional, 100 km lunar), Mars Base (fictional, 300 km), Ceres Port (fictional, 400 km) and Titan Dock (fictional,
  Titan 1,500 km). Plane matching to the ISS or Tiangong is **not priced**, and each ride says so in `not_priced`.
- Endpoints are patched conics. (a) A planet or station leaves or joins a circular parking orbit:
  `sqrt(v∞²+2µ/rp) − sqrt(µ/rp)`, which is refly.py's `dv_dep` for Earth at 200 km. (b) A moon, or a station orbiting a moon, escapes or is captured through the
  parent's well at the moon's orbit radius and then through the moon's own well. This is trip.py's `titan_burn`, generalised; for
  Titan it matches to 0 km/s. (c) A free ship has no well. `planRide` returns `dv_dep_kms`, `dv_arr_kms` and
  `dv_total_kms`; battery and fare come from the total with the models.py formulas, ported with Python-style rounding.
- Date window: departures from `depFrom` to `depTo`, which defaults to depFrom + 120 d. Arrivals must come before `arriveBy`
  and before the ephemeris end; anything later is rejected with an error that names the limit.
- Same-primary rides, for example ISS to Orbital Depot, Moon to Earth LEO, or Io to Europa, are a local Hohmann transfer around the shared
  primary. They are labelled as such, and `refly` returns `{local: true, note: "not re-flown: local transfer"}`. Phasing and plane
  change are not modelled. Sanity check: LEO 200 km to the Moon's distance needs 3.131 km/s, against quote.py's
  geocentric-Lambert TLI of 3.134 km/s.
- `refly(option)` is a pure function on plain data with no DOM. It runs in `refly-worker.js`, a module Worker, and
  survives `structuredClone`; this was tested in Node with a Worker shim. Its modes are "leo" (refly.py `refly`: a hyperbola from a circular
  Earth orbit, using the station's own altitude for ISS etc.) and "centre" (`refly_leg`: the start is at the origin's centre, and both
  endpoint planets' gravity is off; a moon uses its parent, as trip.py does for Titan). The DOP853 is a line-for-line port of
  scipy's: same tableau, initial step, error norm and step control. It matches scipy's step count (100 vs 100 on the
  Mars leg).

## Timings (Node 22, one core, measured with nothing else running)

- `planRide` in page mode (coarse grid, then pattern-search refinement of the best basins): median 0.52 s, max 0.83 to 0.88 s
  (two runs) over 35 Sun-centred routes with 1 to 3 year windows. With the default 120-day window it takes 0.25 to 0.36 s. Local transfers take about 1 ms.
- `refly` at the default rtol 1e-12 (range over two runs): Mars 0.12 s, Titan ride home 0.12 to 0.14 s, Saturn 0.27 to 0.29 s,
  Neptune 0.46 to 0.52 s (day-2 leg), Uranus 0.71 to 0.82 s, and at most 1.0 to 1.1 s (the 20-iteration Q12 case). Each miss
  propagation takes about 20 ms for a 23-year leg. The median is 0.07 s. At rtol 1e-10 it takes up to 3.1 s.
  Python refly.py on the same legs: Mars 1.5 s, Neptune 23 s, Uranus 86 s.

## Open problems / limits

- The pass verdict on 17 to 23 year legs depends on integrator tolerance (point 1). The engine uses 1e-12; refly.py still
  uses 1e-10, and that is for the owner to change.
- Moons and stations use approximate circular orbits with arbitrary phase. That is fine for burns, which depend only on radii, and for
  drawing, but they are not ephemerides. Sun-centred legs use the parent planet's centre, as trip.py does.
- Python has no re-fly for free-ship origins, and it hard-codes 200 km for the LEO start. The JS results for ship legs
  (G17) and for ISS-altitude starts are therefore checked only against the planner and the 2-body arc, not against Python.
- Local transfers are not re-flown, by design, and ignore phasing (the ride departs at the start of the window) and plane change.
- The ephemeris ends 2053-09-25, so rides with Hohmann-class times to Neptune (about 30 years) cannot be planned from 2026.
- The planner refines up to 10 local minima of a coarse grid (24 to 120 departures × 60 to 160 TOFs × 3 branches). A
  basin narrower than one coarse cell could be missed. In all 35 routes it found the Python grid optimum's basin or a better one.

<!-- GENERATED START -->
## Generated tables (node crosscheck.mjs, 2026-10-16T03:31Z)

### A. Planner, same grid: JS grid mode vs Python

Python reference: quote.py / trip.py themselves for Q/T rows; crosscheck_py.py grid (independent burn code, DE421, lambert_izzo, kepler) for G rows. 'same' = identical grid point and branch.

| route | Python depart | Python TOF d | JS depart | JS TOF d | branch | same pt | C3 or v∞ dep: Py / JS (km²/s² or km/s) | dv dep JS-Py km/s | dv arr JS-Py km/s | cost JS-Py |
|---|---|---|---|---|---|---|---|---|---|---|
| Q01 earth-mars c3 | 2026-10-31 00:00 | 293.0 | 2026-10-31 00:00 | 293.0 | 0 | yes | 9.180 / 9.183 | 1.2e-9 | 0 | - |
| Q02 earth-mars tof c3<=15 | 2026-11-09 21:36 | 202.0 | 2026-11-09 21:36 | 202.0 | 0 | yes | 14.980 / 14.979 | 2.3e-12 | 0 | - |
| Q03 earth-mars 2028 | 2028-11-30 14:00 | 317.5 | 2028-11-30 14:00 | 317.5 | 0 | yes | 9.000 / 8.998 | -1.4e-9 | 0 | - |
| Q04 earth-mercury | 2027-02-14 00:00 | 300.0 | 2027-02-14 00:00 | 300.0 | 1H | yes | 84.000 / 84.003 | 5.4e-9 | 0 | - |
| Q05 earth-mercury c3<=20 | no feasible direct transfer under these constraints | | no ride found: departures 2026-10-16..2027-12-31, arriving by 2053-04-07, TOF 20-300 d | - | | | | | | |
| Q06 earth-venus | 2026-10-16 00:00 | 160.0 | 2026-10-16 00:00 | 160.0 | 0 | yes | 16.820 / 16.823 | 5.5e-11 | 0 | - |
| Q07 earth-jupiter | 2027-12-06 17:36 | 1333.0 | 2027-12-06 17:36 | 1333.0 | 0 | yes | 79.060 / 79.058 | 8.2e-10 | 0 | - |
| Q08 earth-jupiter tof c3<=100 | 2026-10-22 02:00 | 618.0 | 2026-10-22 02:00 | 618.0 | 0 | yes | 99.510 / 99.513 | -2.6e-9 | 0 | - |
| Q09 earth-saturn | 2028-07-13 16:00 | 2180.0 | 2028-07-13 16:00 | 2180.0 | 0 | yes | 106.610 / 106.615 | -1.5e-9 | 0 | - |
| Q10 earth-uranus | 2029-09-09 18:24 | 8435.0 | 2029-09-09 18:24 | 8435.0 | 0 | yes | 134.000 / 134.001 | -3.7e-9 | 0 | - |
| Q11 earth-neptune | 2033-06-04 16:48 | 6130.0 | 2033-06-04 16:48 | 6130.0 | 0 | yes | 157.120 / 157.120 | -6.2e-10 | 0 | - |
| Q12 earth-roadster | 2027-02-14 16:00 | 605.0 | 2027-02-14 16:00 | 605.0 | 1H | yes | 3.600 / 3.596 | 4.0e-10 | 0 | - |
| Q13 earth-bennu 1-rev | 2028-10-24 18:00 | 730.0 | 2028-10-24 18:00 | 730.0 | 1H | yes | 0.260 / 0.259 | -4.6e-10 | 0 | - |
| Q14 earth-bennu tof c3<=100 | 2026-10-28 00:00 | 160.0 | 2026-10-28 00:00 | 160.0 | 0 | yes | 99.690 / 99.688 | -1.9e-10 | 0 | - |
| Q15 earth-ceres | 2027-12-31 00:00 | 308.0 | 2027-12-31 00:00 | 308.0 | 0 | yes | 84.700 / 84.699 | -6.6e-9 | 0 | - |
| T1 titan-earth energy (trip fleet) | 2026-10-21 00:00 | 1970.0 | 2026-10-21 00:00 | 1970.0 | 0 | yes | 31.384 / 31.384 | -2.8e-9 | 0 | -2.8e-9 |
| T2 titan-earth time (trip fleet fast) | 2026-10-16 00:00 | 680.0 | 2026-10-16 00:00 | 680.0 | 0 | yes | 411.837 / 411.837 | 7.1e-9 | 0 | 0 |
| T3 roadster-titan pickup (trip roadster) | 2027-11-25 00:00 | 2090.0 | 2027-11-25 00:00 | 2090.0 | 0 | yes | 102.066 / 102.066 | -3.9e-12 | -6.3e-10 | -6.3e-10 |
| G01 mars-earth | 2028-08-07 00:00 | 343.0 | 2028-08-07 00:00 | 343.0 | 0 | yes | 6.710 / 6.710 | -5.7e-10 | -9.8e-10 | -1.6e-9 |
| G02 saturn-earth (5,000 km Saturn orbit) | 2026-10-25 03:12 | 1600.0 | 2026-10-25 03:12 | 1600.0 | 0 | yes | 39.399 / 39.399 | -5.6e-10 | -7.5e-9 | -8.1e-9 |
| G03 earth-saturn capture | 2028-07-13 16:00 | 2159.0 | 2028-07-13 16:00 | 2159.0 | 0 | yes | 106.623 / 106.623 | -1.6e-9 | 2.1e-10 | -1.3e-9 |
| G04 jupiter-earth | 2027-02-06 09:36 | 906.0 | 2027-02-06 09:36 | 906.0 | 0 | yes | 34.427 / 34.427 | -1.5e-9 | 1.6e-10 | -1.3e-9 |
| G05 venus-mars | 2028-03-03 16:48 | 613.6 | 2028-03-03 16:48 | 613.6 | 1H | yes | 32.342 / 32.342 | -5.7e-10 | -7.6e-10 | -1.6e-9 |
| G06 mars-jupiter | 2028-09-30 18:00 | 978.5 | 2028-09-30 18:00 | 978.5 | 0 | yes | 42.323 / 42.323 | 4.9e-9 | 1.4e-10 | 5.0e-9 |
| G07 ceres-mars | 2028-09-06 10:00 | 702.0 | 2028-09-06 10:00 | 702.0 | 0 | yes | 8.343 / 8.343 | -7.7e-12 | -7.7e-9 | -7.7e-9 |
| G08 bennu-earth | 2028-07-25 20:00 | 788.5 | 2028-07-25 20:00 | 788.5 | 1H | yes | 0.160 / 0.160 | 4.7e-11 | 2.2e-9 | 2.1e-9 |
| G09 roadster-earth | 2027-04-10 15:48 | 1032.0 | 2027-04-10 15:48 | 1032.0 | 1H | yes | 0.227 / 0.227 | 3.5e-11 | 2.8e-9 | 2.8e-9 |
| G10 mercury-venus | 2027-07-20 04:48 | 74.4 | 2027-07-20 04:48 | 74.4 | 0 | yes | 33.317 / 33.317 | -2.1e-8 | -1.9e-9 | -2.3e-8 |
| G11 iss-mars | 2026-11-01 02:24 | 309.0 | 2026-11-01 02:24 | 309.0 | 0 | yes | 9.262 / 9.262 | -4.5e-10 | 1.5e-10 | -3.0e-10 |
| G12 lunar-data-center-mars | 2026-10-31 12:36 | 309.0 | 2026-10-31 12:36 | 309.0 | 0 | yes | 9.253 / 9.253 | 8.3e-10 | 1.1e-10 | 9.5e-10 |
| G13 mars-base-ceres-port | 2026-10-16 00:00 | 744.0 | 2026-10-16 00:00 | 744.0 | 0 | yes | 19.546 / 19.546 | 6.0e-10 | 3.9e-11 | 6.4e-10 |
| G14 titan-dock-earth | 2026-10-28 04:00 | 1595.0 | 2026-10-28 04:00 | 1595.0 | 0 | yes | 39.500 / 39.500 | 4.9e-9 | -3.1e-9 | 1.8e-9 |
| G15 europa-earth | 2027-01-04 00:48 | 939.0 | 2027-01-04 00:48 | 939.0 | 0 | yes | 32.719 / 32.719 | 1.7e-10 | -1.9e-9 | -1.7e-9 |
| G16 earth-triton | 2033-06-07 17:36 | 6985.0 | 2033-06-07 17:36 | 6985.0 | 0 | yes | 157.930 / 157.930 | -5.3e-9 | 8.0e-10 | -4.5e-9 |
| G17 ship-mars | 2026-10-16 00:00 | 315.8 | 2026-10-16 00:00 | 315.8 | 0 | yes | 8.194 / 8.194 | -1.2e-12 | -4.4e-10 | -4.4e-10 |
| G18 uranus-earth | 2030-01-16 04:00 | 4520.0 | 2030-01-16 04:00 | 4520.0 | 0 | yes | 24.737 / 24.737 | 1.9e-9 | -6.8e-10 | 1.2e-9 |

### B. Planner, coarse-then-refine (the page's mode) vs the Python grid optimum

Negative 'cost JS-Py' = the refined search found a cheaper (or earlier/shorter) ride than the Python grid; values at the JS point are re-evaluated in Python on DE421 ('Py@JS').

| route | JS depart | JS TOF d | branch | dv dep / arr km/s | total km/s | cost JS | cost Py grid | JS-Py | Py@JS dv total - JS | search ms |
|---|---|---|---|---|---|---|---|---|---|---|
| Q01 earth-mars c3 | 2026-10-31 10:24 | 292.29 | 0 | 3.634 / 0.000 | 3.634 | 3.6338 | 3.6338 | -0.0001 | -6.1e-10 | 112 |
| Q02 earth-mars tof c3<=15 | 2026-11-15 04:22 | 198.71 | 0 | 3.886 / 0.000 | 3.886 | 198.7063 | 202.0000 | -3.2937 | -1.2e-10 | 182 |
| Q03 earth-mars 2028 | 2028-11-29 16:47 | 314.76 | 0 | 3.626 / 0.000 | 3.626 | 3.6256 | 3.6257 | -0.0001 | 5.8e-10 | 423 |
| Q04 earth-mercury | 2027-02-14 00:00 | 300.00 | 1H | 6.540 / 0.000 | 6.540 | 6.5403 | 6.5403 | 0.0000 | -5.4e-9 | 43 |
| Q05 earth-mercury c3<=20 | no ride found: departures 2026-10-16..2027-12-31, arriving by 2053-04-07, TOF 20-300 d |||||||||215|
| Q06 earth-venus | 2026-10-16 00:00 | 159.29 | 0 | 3.963 / 0.000 | 3.963 | 3.9632 | 3.9636 | -0.0004 | -1.5e-10 | 84 |
| Q07 earth-jupiter | 2027-12-06 00:53 | 1324.27 | 0 | 6.366 / 0.000 | 6.366 | 6.3664 | 6.3666 | -0.0002 | 9.9e-10 | 589 |
| Q08 earth-jupiter tof c3<=100 | 2026-10-22 03:14 | 613.78 | 0 | 7.088 / 0.000 | 7.088 | 613.7834 | 618.0000 | -4.2166 | 2.5e-9 | 489 |
| Q09 earth-saturn | 2028-07-14 07:04 | 2168.71 | 0 | 7.305 / 0.000 | 7.305 | 7.3054 | 7.3089 | -0.0036 | 6.0e-10 | 621 |
| Q10 earth-uranus | 2029-09-12 00:53 | 8608.46 | 0 | 8.186 / 0.000 | 8.186 | 8.1859 | 8.1904 | -0.0045 | -5.8e-9 | 467 |
| Q11 earth-neptune | 2033-06-04 14:25 | 6145.80 | 0 | 8.898 / 0.000 | 8.898 | 8.8982 | 8.8983 | -0.0001 | -2.5e-10 | 505 |
| Q12 earth-roadster | 2027-02-12 09:11 | 607.14 | 1H | 3.386 / 0.000 | 3.386 | 3.3863 | 3.3865 | -0.0002 | -6.6e-10 | 593 |
| Q13 earth-bennu 1-rev | 2028-11-11 04:53 | 711.81 | 1H | 3.236 / 0.000 | 3.236 | 3.2361 | 3.2361 | -0.0000 | -1.3e-10 | 622 |
| Q14 earth-bennu tof c3<=100 | 2026-11-13 02:40 | 155.51 | 0 | 7.088 / 0.000 | 7.088 | 155.5102 | 160.0000 | -4.4898 | -6.4e-10 | 190 |
| Q15 earth-ceres | 2027-12-31 00:00 | 306.76 | 0 | 6.563 / 0.000 | 6.563 | 6.5633 | 6.5645 | -0.0012 | 6.6e-9 | 766 |
| T1 titan-earth energy (trip fleet) | 2026-10-16 00:00 | 1973.20 | 0 | 3.117 / 0.000 | 3.117 | 3.6573 | 3.6593 | -0.0020 | -2.3e-9 | 686 |
| T2 titan-earth time (trip fleet fast) | 2026-10-16 00:00 | 675.82 | 0 | 15.000 / 0.000 | 15.000 | 2462005.3211 | 2462009.5000 | -4.1789 | -7.1e-9 | 508 |
| T3 roadster-titan pickup (trip roadster) | 2027-11-25 03:39 | 2092.54 | 0 | 10.103 / 2.698 | 12.801 | 13.4847 | 13.4848 | -0.0000 | -2.9e-10 | 884 |
| G01 mars-earth | 2028-08-05 10:19 | 343.23 | 0 | 2.080 / 3.770 | 5.850 | 6.1034 | 6.1042 | -0.0009 | 4.7e-9 | 364 |
| G02 saturn-earth (5,000 km Saturn orbit) | 2026-10-22 18:03 | 1601.74 | 0 | 10.558 / 8.238 | 18.796 | 19.2363 | 19.2383 | -0.0020 | 6.8e-9 | 558 |
| G03 earth-saturn capture | 2028-07-14 00:34 | 2165.15 | 0 | 7.306 / 10.469 | 17.775 | 18.4210 | 18.4223 | -0.0013 | 5.2e-10 | 519 |
| G04 jupiter-earth | 2027-01-30 00:02 | 913.19 | 0 | 17.153 / 6.696 | 23.849 | 24.1069 | 24.1076 | -0.0007 | 5.7e-11 | 547 |
| G05 venus-mars | 2028-03-05 12:04 | 615.06 | 1H | 4.444 / 3.865 | 8.309 | 8.5947 | 8.6119 | -0.0171 | 2.9e-12 | 290 |
| G06 mars-jupiter | 2028-10-02 18:06 | 986.32 | 0 | 4.682 / 17.048 | 21.730 | 22.1755 | 22.1773 | -0.0018 | -4.8e-9 | 592 |
| G07 ceres-mars | 2028-09-09 10:19 | 700.81 | 0 | 2.644 / 2.887 | 5.531 | 5.8921 | 5.8942 | -0.0021 | -3.6e-9 | 781 |
| G08 bennu-earth | 2028-07-17 22:33 | 796.35 | 1H | 0.395 / 4.567 | 4.962 | 5.3346 | 5.3424 | -0.0078 | -2.5e-9 | 665 |
| G09 roadster-earth | 2027-04-08 08:35 | 1034.59 | 1H | 0.474 / 3.622 | 4.096 | 4.4269 | 4.4283 | -0.0013 | -2.5e-9 | 601 |
| G10 mercury-venus | 2027-07-19 15:02 | 73.89 | 0 | 4.137 / 5.456 | 9.593 | 9.6675 | 9.6910 | -0.0234 | 2.5e-8 | 140 |
| G11 iss-mars | 2026-11-01 03:48 | 309.48 | 0 | 3.591 / 2.064 | 5.656 | 5.7449 | 5.7449 | -0.0001 | 3.3e-10 | 78 |
| G12 lunar-data-center-mars | 2026-10-31 15:57 | 308.73 | 0 | 1.660 / 2.066 | 3.725 | 3.8142 | 3.8142 | -0.0000 | -4.6e-10 | 75 |
| G13 mars-base-ceres-port | 2026-10-16 00:00 | 745.89 | 0 | 3.106 / 5.669 | 8.774 | 8.9783 | 8.9804 | -0.0021 | -7.0e-10 | 731 |
| G14 titan-dock-earth | 2026-10-17 01:53 | 1607.10 | 0 | 3.466 / 8.242 | 11.709 | 12.1488 | 12.1750 | -0.0262 | 3.9e-9 | 522 |
| G15 europa-earth | 2027-01-01 00:01 | 940.66 | 0 | 5.413 / 6.712 | 12.124 | 12.3817 | 12.3913 | -0.0095 | -2.1e-9 | 531 |
| G16 earth-triton | 2033-06-08 05:22 | 7000.00 | 0 | 8.922 / 3.006 | 11.929 | 13.8887 | 13.8921 | -0.0035 | -9.9e-10 | 485 |
| G17 ship-mars | 2026-10-16 00:00 | 316.56 | 0 | 2.861 / 2.006 | 4.867 | 4.9536 | 4.9537 | -0.0001 | 3.6e-10 | 261 |
| G18 uranus-earth | 2030-01-03 02:11 | 4532.53 | 0 | 6.327 / 8.113 | 14.439 | 15.6807 | 15.6847 | -0.0040 | -3.4e-9 | 677 |

### C. Re-fly gate: JS refly() vs Python refly.py on the same leg

Py = refly.refly (mode leo, Earth 200 km) or refly.refly_leg (mode centre), unmodified, DE421 + its Hermite table, DOP853 rtol 1e-10. Py/cheb = the same Python functions fed the JS Chebyshev table (rtol 1e-10): JS ≈ Py/cheb but ≠ Py means the difference is the ephemeris table, not the port. The last columns repeat both at rtol 1e-12 (Python: the same functions with nbody.propagate's rtol swapped in; JS: the engine default). Python rounds its outputs (0.1 km / 0.1 m/s).

| route | mode | raw miss km: Py / JS / Py-cheb | final km Py / JS | retarget m/s Py / JS | iters Py / JS | pass @1e-10 Py / JS | @1e-12: final km Py / JS, retarget m/s Py / JS, pass Py / JS | s @1e-10 Py / JS, @1e-12 JS |
|---|---|---|---|---|---|---|---|---|
| Q01 earth-mars c3 | leo | 1183829.6 / 1183829.8 / 1183829.9 | 0.041 / 0.370 | 86.2 / 86.2 | 3 / 3 | PASS / PASS | 0.648 / 0.697, 86.2 / 86.2, PASS / PASS | 1.5 / 0.06, 0.12 |
| Q02 earth-mars tof c3<=15 | leo | 700605.6 / 700604.3 / 700604.5 | 0.218 / 0.402 | 21.1 / 21.1 | 2 / 3 | PASS / PASS | 0.148 / 0.034, 21.1 / 21.1, PASS / PASS | 0.7 / 0.04, 0.11 |
| Q03 earth-mars 2028 | leo | 619153.8 / 619152.2 / 619150.3 | 0.727 / 0.270 | 40.4 / 40.4 | 3 / 2 | PASS / PASS | 0.763 / 0.834, 40.4 / 40.4, PASS / PASS | 1.0 / 0.02, 0.07 |
| Q04 earth-mercury | leo | 679101.6 / 679101.9 / 679101.8 | 0.093 / 0.023 | 12.0 / 12.0 | 3 / 3 | PASS / PASS | 0.094 / 0.164, 12.0 / 12.0, PASS / PASS | 1.9 / 0.05, 0.08 |
| Q06 earth-venus | leo | 879703.2 / 879704.5 / 879704.0 | 0.284 / 0.777 | 36.4 / 36.4 | 3 / 2 | PASS / PASS | 0.234 / 0.067, 36.4 / 36.4, PASS / PASS | 1.2 / 0.03, 0.05 |
| Q07 earth-jupiter | leo | 844175.4 / 844174.4 / 844172.2 | 0.280 / 0.929 | 9.3 / 9.3 | 2 / 6 | PASS / PASS | 0.587 / 0.453, 9.3 / 9.3, PASS / PASS | 1.5 / 0.17, 0.14 |
| Q08 earth-jupiter tof c3<=100 | leo | 300392.2 / 300391.3 / 300391.6 | 0.591 / 0.445 | 4.5 / 4.5 | 2 / 2 | PASS / PASS | 0.103 / 0.445, 4.5 / 4.5, PASS / PASS | 1.0 / 0.03, 0.04 |
| Q09 earth-saturn | leo | 3169337.7 / 3169337.8 / 3169337.7 | 0.562 / 0.922 | 32.5 / 32.5 | 3 / 5 | PASS / PASS | 0.657 / 0.674, 32.5 / 32.5, PASS / PASS | 3.7 / 0.20, 0.31 |
| Q10 earth-uranus | leo | 730359.4 / 730349.1 / 730309.8 | 2.592 / 0.337 | 16.1 / 16.1 | 20 / 6 | REJECT / PASS **DIFF** | 0.180 / 0.573, 16.1 / 16.1, PASS / PASS | 93.3 / 0.83, 0.74 |
| Q11 earth-neptune | leo | 60998052.5 / 60998034.1 / 60998066.1 | 0.783 / 3.592 | 248.2 / 248.2 | 11 / 20 | PASS / REJECT **DIFF** | 0.951 / 0.577, 248.2 / 248.2, PASS / PASS | 36.2 / 2.47, 0.47 |
| Q12 earth-roadster | leo | 6545386.0 / 6545316.4 / 6545312.7 | 0.357 / 0.823 | 244.7 / 244.7 | 6 / 6 | PASS / PASS | 0.809 / 0.415, 244.7 / 244.7, PASS / PASS | 2.9 / 0.11, 0.21 |
| Q13 earth-bennu 1-rev | leo | 44331920.4 / 44331905.3 / 44331905.8 | 0.161 / 0.613 | 380.8 / 380.8 | 5 / 6 | PASS / PASS | 0.228 / 0.046, 380.8 / 380.8, PASS / PASS | 2.8 / 0.11, 0.27 |
| Q14 earth-bennu tof c3<=100 | leo | 56291.8 / 56291.8 / 56291.7 | 0.048 / 0.027 | 3.1 / 3.1 | 2 / 2 | PASS / PASS | 0.025 / 0.087, 3.1 / 3.1, PASS / PASS | 0.9 / 0.03, 0.06 |
| Q15 earth-ceres | leo | 117050.7 / 117050.3 / 117050.3 | 0.662 / 0.884 | 11.8 / 11.8 | 2 / 2 | PASS / PASS | 0.146 / 0.201, 11.8 / 11.8, PASS / PASS | 0.7 / 0.03, 0.04 |
| T1 titan-earth energy (trip fleet) | centre | 2884163.8 / 2884160.8 / 2884160.8 | 0.283 / 0.171 | 9.6 / 9.6 | 3 / 4 | PASS / PASS | 0.000 / 0.003, 9.6 / 9.6, PASS / PASS | 2.5 / 0.12, 0.12 |
| T2 titan-earth time (trip fleet fast) | centre | 399675.7 / 399675.7 / 399675.7 | 0.001 / 0.001 | 4.7 / 4.7 | 2 / 2 | PASS / PASS | 0.002 / 0.003, 4.7 / 4.7, PASS / PASS | 1.4 / 0.05, 0.06 |
| T3 roadster-titan pickup (trip roadster) | centre | 2365949.3 / 2365949.3 / 2365949.3 | 0.003 / 0.003 | 5.1 / 5.1 | 2 / 2 | PASS / PASS | 0.251 / 0.024, 5.1 / 5.1, PASS / PASS | 1.9 / 0.06, 0.08 |
| G01 mars-earth | centre | 18381.8 / 18381.8 / 18381.8 | 0.000 / 0.000 | 1.7 / 1.7 | 2 / 2 | PASS / PASS | 0.002 / 0.002, 1.7 / 1.7, PASS / PASS | 0.4 / 0.03, 0.03 |
| G02 saturn-earth (5,000 km Saturn orbit) | centre | 1077758.5 / 1077758.5 / 1077758.5 | 0.378 / 0.376 | 9.8 / 9.8 | 2 / 2 | PASS / PASS | 0.032 / 0.032, 9.8 / 9.8, PASS / PASS | 1.4 / 0.05, 0.07 |
| G03 earth-saturn capture | centre | 887790.0 / 887789.9 / 887789.8 | 0.827 / 0.022 | 32.3 / 32.3 | 3 / 3 | PASS / PASS | 0.052 / 0.008, 32.3 / 32.3, PASS / PASS | 3.1 / 0.11, 0.13 |
| G04 jupiter-earth | centre | 82634.4 / 82633.4 / 82633.4 | 0.904 / 0.645 | 0.4 / 0.4 | 2 / 2 | PASS / PASS | 0.014 / 0.012, 0.4 / 0.4, PASS / PASS | 0.8 / 0.03, 0.04 |
| G05 venus-mars | centre | 84815.9 / 84815.9 / 84815.9 | 0.000 / 0.000 | 2.1 / 2.1 | 2 / 2 | PASS / PASS | 0.001 / 0.001, 2.1 / 2.1, PASS / PASS | 0.6 / 0.02, 0.03 |
| G06 mars-jupiter | centre | 30955.2 / 30955.2 / 30955.2 | 0.004 / 0.001 | 0.5 / 0.5 | 2 / 2 | PASS / PASS | 0.983 / 0.951, 0.5 / 0.5, PASS / PASS | 0.6 / 0.02, 0.02 |
| G07 ceres-mars | centre | 103278.9 / 103278.9 / 103278.9 | 0.000 / 0.000 | 4.1 / 4.1 | 2 / 2 | PASS / PASS | 0.001 / 0.000, 4.1 / 4.1, PASS / PASS | 0.5 / 0.02, 0.02 |
| G08 bennu-earth | centre | 48580.8 / 48580.8 / 48580.8 | 0.000 / 0.000 | 1.4 / 1.4 | 2 / 2 | PASS / PASS | 0.000 / 0.000, 1.4 / 1.4, PASS / PASS | 0.7 / 0.02, 0.04 |
| G09 roadster-earth | centre | 56539.9 / 56539.9 / 56539.9 | 0.308 / 0.308 | 40.1 / 40.1 | 2 / 2 | PASS / PASS | 0.308 / 0.306, 40.1 / 40.1, PASS / PASS | 0.9 / 0.03, 0.05 |
| G10 mercury-venus | centre | 767.8 / 767.8 / 767.8 | 0.001 / 0.001 | 0.1 / 0.1 | 1 / 1 | PASS / PASS | 0.001 / 0.001, 0.1 / 0.1, PASS / PASS | 0.2 / 0.00, 0.01 |
| G11 iss-mars | centre | 637900.6 / 637900.6 / 637900.6 | 0.006 / 0.007 | 29.6 / 29.6 | 2 / 2 | PASS / PASS | 0.003 / 0.004, 29.6 / 29.6, PASS / PASS | 0.5 / 0.02, 0.02 |
| G11 iss-mars (JS default mode) | leo | - / 2433401.1 / - | - / 0.443 | - / 23.7 | - / 5 | - / PASS | | - / 0.19 |
| G12 lunar-data-center-mars | centre | 941940.4 / 941940.3 / 941940.3 | 0.033 / 0.033 | 42.5 / 42.5 | 2 / 2 | PASS / PASS | 0.035 / 0.033, 42.5 / 42.5, PASS / PASS | 0.5 / 0.02, 0.03 |
| G12 lunar-data-center-mars (JS default mode) | centre | - / 941940.4 / - | - / 0.033 | - / 42.5 | - / 2 | - / PASS | | - / 0.03 |
| G13 mars-base-ceres-port | centre | 430403.0 / 430403.0 / 430403.0 | 0.012 / 0.012 | 13.9 / 13.9 | 2 / 2 | PASS / PASS | 0.031 / 0.090, 13.9 / 13.9, PASS / PASS | 0.5 / 0.02, 0.02 |
| G14 titan-dock-earth | centre | 1097368.0 / 1097368.0 / 1097368.0 | 0.908 / 0.116 | 9.7 / 9.7 | 2 / 2 | PASS / PASS | 0.033 / 0.033, 9.7 / 9.7, PASS / PASS | 1.7 / 0.05, 0.06 |
| G15 europa-earth | centre | 70722.0 / 70722.0 / 70722.0 | 0.000 / 0.000 | 0.4 / 0.4 | 2 / 2 | PASS / PASS | 0.017 / 0.005, 0.4 / 0.4, PASS / PASS | 0.8 / 0.03, 0.04 |
| G16 earth-triton | centre | 79788509.9 / 79788509.8 / 79788509.8 | 0.001 / 0.052 | 261.9 / 261.9 | 3 / 3 | PASS / PASS | 0.012 / 0.055, 261.9 / 261.9, PASS / PASS | 8.2 / 0.32, 0.37 |
| G17 ship-mars | centre | n/a / 153981.8 / - | - / 0.018 | - / 1.8 | - / 2 | - / PASS | - / 0.000, - / 1.8, - / PASS | - / 0.02, 0.01 |
| G18 uranus-earth | centre | 10767773.9 / 10767773.9 / 10767774.4 | 0.102 / 0.123 | 13.1 / 13.1 | 3 / 3 | PASS / PASS | 0.001 / 0.001, 13.1 / 13.1, PASS / PASS | 6.7 / 0.22, 0.25 |
| D1 day-2 uranus leg (REJECT in Python) | leo | 751876.0 / 751857.4 / 751859.8 | 22.410 / 22.740 | 16.0 / 16.0 | 20 / 20 | REJECT / REJECT | 0.524 / 0.236, 16.0 / 16.0, PASS / PASS | 85.8 / 3.07, 0.82 |
| D2 day-2 neptune leg | leo | 61986699.4 / 61986677.4 / 61986688.5 | 0.801 / 4.745 | 250.4 / 250.4 | 8 / 20 | PASS / REJECT **DIFF** | 0.446 / 0.575, 250.4 / 250.4, PASS / PASS | 23.3 / 2.58, 0.46 |
| D3 day-2 saturn leg | leo | 4091336.0 / 4091340.3 / 4091334.7 | 0.568 / 0.827 | 33.1 / 33.1 | 5 / 3 | PASS / PASS | 0.160 / 0.482, 33.1 / 33.1, PASS / PASS | 6.3 / 0.15, 0.29 |
| D4 titan ride home leg (receipts/titan_fleet) | centre | 2884163.8 / 2884160.8 / 2884160.8 | 0.283 / 0.171 | 9.6 / 9.6 | 3 / 4 | PASS / PASS | 0.000 / 0.003, 9.6 / 9.6, PASS / PASS | 2.5 / 0.14, 0.14 |

Re-fly of the refined (page-mode) option at rtol 1e-12, JS vs Python on the same (non-grid) leg:

| route | depart | TOF d | final km Py / JS | retarget m/s Py / JS | iters Py / JS | pass Py / JS | s Py / JS |
|---|---|---|---|---|---|---|---|
| Q01 earth-mars c3 | 2026-10-31 10:24 | 292.29 | 0.584 / 0.327 | 80.1 / 80.1 | 6 / 5 | PASS / PASS | 5.5 / 0.16 |
| Q02 earth-mars tof c3<=15 | 2026-11-15 04:22 | 198.71 | 0.237 / 0.042 | 24.0 / 24.0 | 2 / 2 | PASS / PASS | 3.6 / 0.11 |
| Q03 earth-mars 2028 | 2028-11-29 16:47 | 314.76 | 0.895 / 0.590 | 40.8 / 40.8 | 2 / 4 | PASS / PASS | 2.4 / 0.13 |
| Q04 earth-mercury | 2027-02-14 00:00 | 300.00 | 0.094 / 0.164 | 12.0 / 12.0 | 3 / 3 | PASS / PASS | 2.8 / 0.08 |
| Q06 earth-venus | 2026-10-16 00:00 | 159.29 | 0.517 / 0.890 | 36.5 / 36.5 | 2 / 2 | PASS / PASS | 1.3 / 0.05 |
| Q07 earth-jupiter | 2027-12-06 00:53 | 1324.27 | 0.209 / 0.180 | 9.5 / 9.5 | 3 / 3 | PASS / PASS | 3.0 / 0.11 |
| Q08 earth-jupiter tof c3<=100 | 2026-10-22 03:14 | 613.78 | 0.047 / 0.418 | 4.5 / 4.5 | 2 / 2 | PASS / PASS | 1.3 / 0.04 |
| Q09 earth-saturn | 2028-07-14 07:04 | 2168.71 | 0.317 / 0.407 | 68.7 / 68.7 | 3 / 3 | PASS / PASS | 5.0 / 0.20 |
| Q10 earth-uranus | 2029-09-12 00:53 | 8608.46 | 0.178 / 0.197 | 15.7 / 15.7 | 3 / 5 | PASS / PASS | 15.4 / 0.90 |
| Q11 earth-neptune | 2033-06-04 14:25 | 6145.80 | 0.604 / 0.399 | 250.2 / 250.2 | 4 / 7 | PASS / PASS | 14.2 / 0.89 |
| Q12 earth-roadster | 2027-02-12 09:11 | 607.14 | 2.658 / 0.880 | 376.1 / 376.1 | 20 / 20 | REJECT / PASS **DIFF** | 26.3 / 1.01 |
| Q13 earth-bennu 1-rev | 2028-11-11 04:53 | 711.81 | 0.265 / 0.516 | 302.6 / 302.6 | 5 / 5 | PASS / PASS | 7.9 / 0.26 |
| Q14 earth-bennu tof c3<=100 | 2026-11-13 02:40 | 155.51 | 0.023 / 0.013 | 7.2 / 7.2 | 2 / 2 | PASS / PASS | 1.6 / 0.06 |
| Q15 earth-ceres | 2027-12-31 00:00 | 306.76 | 0.119 / 0.446 | 11.2 / 11.2 | 2 / 2 | PASS / PASS | 1.1 / 0.04 |
| T1 titan-earth energy (trip fleet) | 2026-10-16 00:00 | 1973.20 | 0.013 / 0.015 | 9.6 / 9.6 | 3 / 3 | PASS / PASS | 3.2 / 0.14 |
| T2 titan-earth time (trip fleet fast) | 2026-10-16 00:00 | 675.82 | 0.001 / 0.001 | 4.7 / 4.7 | 2 / 2 | PASS / PASS | 1.7 / 0.06 |
| T3 roadster-titan pickup (trip roadster) | 2027-11-25 03:39 | 2092.54 | 0.020 / 0.202 | 5.1 / 5.1 | 2 / 2 | PASS / PASS | 2.3 / 0.08 |
| G01 mars-earth | 2028-08-05 10:19 | 343.23 | 0.000 / 0.002 | 1.7 / 1.7 | 2 / 2 | PASS / PASS | 0.6 / 0.03 |
| G02 saturn-earth (5,000 km Saturn orbit) | 2026-10-22 18:03 | 1601.74 | 0.032 / 0.032 | 9.8 / 9.8 | 2 / 2 | PASS / PASS | 2.1 / 0.06 |
| G03 earth-saturn capture | 2028-07-14 00:34 | 2165.15 | 0.035 / 0.048 | 35.0 / 35.0 | 3 / 3 | PASS / PASS | 4.2 / 0.14 |
| G04 jupiter-earth | 2027-01-30 00:02 | 913.19 | 0.000 / 0.000 | 0.4 / 0.4 | 2 / 2 | PASS / PASS | 1.2 / 0.04 |
| G05 venus-mars | 2028-03-05 12:04 | 615.06 | 0.005 / 0.006 | 2.1 / 2.1 | 2 / 2 | PASS / PASS | 0.9 / 0.03 |
| G06 mars-jupiter | 2028-10-02 18:06 | 986.32 | 0.002 / 0.022 | 0.5 / 0.5 | 2 / 2 | PASS / PASS | 0.9 / 0.03 |
| G07 ceres-mars | 2028-09-09 10:19 | 700.81 | 0.000 / 0.000 | 4.1 / 4.1 | 2 / 2 | PASS / PASS | 0.7 / 0.02 |
| G08 bennu-earth | 2028-07-17 22:33 | 796.35 | 0.000 / 0.000 | 1.6 / 1.6 | 2 / 2 | PASS / PASS | 1.1 / 0.04 |
| G09 roadster-earth | 2027-04-08 08:35 | 1034.59 | 0.000 / 0.003 | 59.1 / 59.1 | 3 / 3 | PASS / PASS | 2.0 / 0.07 |
| G10 mercury-venus | 2027-07-19 15:02 | 73.89 | 0.001 / 0.001 | 0.1 / 0.1 | 1 / 1 | PASS / PASS | 0.2 / 0.01 |
| G11 iss-mars | 2026-11-01 03:48 | 309.48 | 0.001 / 0.001 | 28.3 / 28.3 | 2 / 2 | PASS / PASS | 0.7 / 0.02 |
| G12 lunar-data-center-mars | 2026-10-31 15:57 | 308.73 | 0.018 / 0.018 | 39.8 / 39.8 | 2 / 2 | PASS / PASS | 0.8 / 0.03 |
| G13 mars-base-ceres-port | 2026-10-16 00:00 | 745.89 | 0.002 / 0.058 | 13.7 / 13.7 | 2 / 2 | PASS / PASS | 0.9 / 0.02 |
| G14 titan-dock-earth | 2026-10-17 01:53 | 1607.10 | 0.029 / 0.032 | 9.8 / 9.8 | 2 / 2 | PASS / PASS | 1.8 / 0.06 |
| G15 europa-earth | 2027-01-01 00:01 | 940.66 | 0.000 / 0.000 | 0.4 / 0.4 | 2 / 2 | PASS / PASS | 1.3 / 0.04 |
| G16 earth-triton | 2033-06-08 05:22 | 7000.00 | 0.508 / 0.227 | 256.0 / 256.0 | 3 / 3 | PASS / PASS | 10.7 / 0.38 |
| G17 ship-mars | 2026-10-16 00:00 | 316.56 | - / 0.000 | - / 1.8 | - / 2 | - / PASS | - / 0.01 |
| G18 uranus-earth | 2030-01-03 02:11 | 4532.53 | 0.001 / 0.001 | 12.9 / 12.9 | 3 / 3 | PASS / PASS | 7.7 / 0.25 |

### D. Local transfers (Hohmann around Earth)

| route | depart | TOF d | dv dep km/s | dv arr km/s | refly |
|---|---|---|---|---|---|
| L1 iss-orbital-depot | 2026-10-16 00:00 | 0.033 | 0.022 | 0.022 | not re-flown: local transfer |
| L2 moon-earth | 2026-10-16 00:00 | 4.978 | 0.822 | 3.131 | not re-flown: local transfer |
| L3 earth-lunar-data-center | 2026-10-16 00:00 | 4.978 | 3.131 | 0.822 | not re-flown: local transfer |

quote.py --dest moon (geocentric Lambert from 200 km LEO, 2026-11-20): TLI 3.134 km/s, TOF 3.5 d; JS Hohmann LEO 200 km -> Moon distance (L3/L2 departure leg): 3.131 km/s.

### F. Unit cross-check: random Lambert / Kepler / titan_burn cases, JS vs Python

Lambert (Izzo), 3000 random cases (r1 up to 3 AU, r2 up to 15 AU, TOF 20-6020 d, M 0/1, both branches): 1887 solved by both, 1113 infeasible in both, **0 disagree**; max |v| difference 5.7e-14 km/s, transfer angle 8.5e-14 deg. Kepler (universal variables), 2000 cases incl. hyperbolic and backward: max relative |r| difference 9.3e-13, 0 disagree. titan_burn (trip.py formula) vs JS wellBurn(Titan), v∞ 0-20 km/s: max 0.0e+0 km/s.

### G. Ephemeris table vs DE421

ephem.json: 392.6 KiB (402060 bytes), JD 2461314.5 (2026-10-01) .. 2471170.5 (2053-09-25). 'bake' = bake_ephem.py's check (40,000 random epochs + 8 per segment + both sides of every segment boundary, numpy evaluator); 'JS' = sol-engine.js's own decoder and evaluator vs DE421 states at 300 independent random epochs (ephem_testvectors.json). Small bodies are compared with their n-body orbits (the re-fly targets), not with DE421.

| body | segment d (base) | degree | segments | KiB | bake max \|dr\| m | bake rms m | bake max \|dv\| mm/s | JS max \|dr\| m | JS max \|dv\| mm/s |
|---|---|---|---|---|---|---|---|---|---|
| mercury | 616 | 26 | 243 | 67.3 | 10.9 | 2.1 | 1.02 | 9.0 | 0.16 |
| venus | 44 | 10 | 224 | 33.4 | 2.5 | 0.8 | 0.05 | 2.2 | 0.03 |
| emb | 448 | 8 | 352 | 38.1 | 5.2 | 1.7 | 0.07 | 4.7 | 0.03 |
| mars | 64 | 13 | 154 | 22.1 | 4.5 | 1.2 | 0.07 | 4.0 | 0.03 |
| jupiter | 64 | 13 | 154 | 19.2 | 4.5 | 1.1 | 0.06 | 4.1 | 0.03 |
| saturn | 64 | 13 | 154 | 18.6 | 4.1 | 1.1 | 0.06 | 4.1 | 0.03 |
| uranus | 64 | 13 | 154 | 17.9 | 4.2 | 1.1 | 0.06 | 3.9 | 0.03 |
| neptune | 64 | 13 | 154 | 17.8 | 3.9 | 1.1 | 0.06 | 3.8 | 0.03 |
| moon_geo | 704 | 21 | 448 | 89.7 | 23.2 | 5.0 | 3.09 | - | - |
| roadster | 77 | 16 | 133 | 22.7 | 4.3 | 1.1 | 0.32 | 3.0 | 0.10 |
| bennu | 77 | 15 | 130 | 23.7 | 5.5 | 1.4 | 0.08 | 5.3 | 0.02 |
| ceres | 64 | 13 | 154 | 20.8 | 4.1 | 1.1 | 0.07 | 3.8 | 0.03 |
| earth (derived) | - | - | - | - | 5.2 | 1.7 | 0.06 | 4.6 | 0.04 |
| moon (derived) | - | - | - | - | 24.8 | 5.2 | 2.51 | 20.1 | 0.94 |

### E. Worst case per quantity (JS - Python)

| quantity | worst difference | route |
|---|---|---|
| C3 (same point, km2/s2) | 3.14e-7 | T2 titan-earth time (trip fleet fast) |
| v_inf dep (km/s) | -2.61e-8 | G10 mercury-venus |
| v_inf arr (km/s) | 2.22e-8 | T2 titan-earth time (trip fleet fast) |
| dv dep (km/s) | -2.13e-8 | G10 mercury-venus |
| dv arr (km/s) | -7.70e-9 | G07 ceres-mars |
| dv total at refined point (km/s) | -2.46e-8 | G10 mercury-venus |
| re-fly raw miss, rtol 1e-10 (km) | -6.96e+1 | Q12 earth-roadster |
| re-fly retarget, rtol 1e-10 (m/s) | -4.91e-2 | D3 day-2 saturn leg |
| re-fly raw miss JS vs Py/cheb (km) | 3.93e+1 | Q10 earth-uranus |
| re-fly raw miss, rtol 1e-12 (km) | -6.96e+1 | Q12 earth-roadster |
| re-fly retarget, rtol 1e-12 (m/s) | -4.91e-2 | D3 day-2 saturn leg |
| re-fly retarget, refined legs, rtol 1e-12 (m/s) | 4.98e-2 | G11 iss-mars |
| ephemeris mercury |dr| (km) | 8.96e-3 | JS vs DE421 |
| ephemeris venus |dr| (km) | 2.21e-3 | JS vs DE421 |
| ephemeris emb |dr| (km) | 4.67e-3 | JS vs DE421 |
| ephemeris mars |dr| (km) | 3.97e-3 | JS vs DE421 |
| ephemeris jupiter |dr| (km) | 4.13e-3 | JS vs DE421 |
| ephemeris saturn |dr| (km) | 4.10e-3 | JS vs DE421 |
| ephemeris uranus |dr| (km) | 3.92e-3 | JS vs DE421 |
| ephemeris neptune |dr| (km) | 3.81e-3 | JS vs DE421 |
| ephemeris roadster |dr| (km) | 2.99e-3 | JS vs DE421 |
| ephemeris bennu |dr| (km) | 5.28e-3 | JS vs DE421 |
| ephemeris ceres |dr| (km) | 3.80e-3 | JS vs DE421 |
| ephemeris earth |dr| (km) | 4.64e-3 | JS vs DE421 |
| ephemeris moon |dr| (km) | 2.01e-2 | JS vs DE421 |
<!-- GENERATED END -->
