RESULT: PASS

# ROBOTAXI: SOL: offline feasibility spike for the trajectory core

Date: 2026-10-15. Folder: `/tmp/arena-space-ideas/swarm/sol/` (code in `code/`, downloaded data in `data/`, logs, JSON and the figure in `out/`). To reproduce everything (about 50 s on this shared 4-core box), run `code/run_all.sh`.

**Verdict.** The core works offline. My own Izzo Lambert solver matches Vallado's textbook example to 2.1e-7 and Der's published cases to about 1e-10. It also agrees with ESA pykep's C++ solver (written by Izzo himself) to 3.4e-13 or better on 20,000 random cases. JPL's DE421 ephemeris installs from PyPI and needs no network. The 150 x 150 Earth-to-Mars porkchop runs in 2.1 s and gives a minimum C3 of **9.18 km²/s²** (departing 2026-10-31, 292-day flight). That value is physically plausible, but I could not check it against a published figure offline. An independent n-body re-propagation reproduces the Lambert arc to **0.34 m** when the physics is the same. With realistic physics (a 200 km LEO departure plus all planets and the Moon) the craft misses Mars by **4.05 million km**. The cause is fully accounted for: Earth escape, plus an accidental lunar flyby at 18,347 km. Changing the departure v∞ by **80 m/s** (C3 drops 2%) closes the miss to 0.4 km. The pass criteria (tests 1, 3 and 4 succeed, plausible C3, miss explained) are met. The issues below are real, but none of them blocks feasibility. Each is a day-1 work item.

## Headline numbers

| Test | Status | Key measured numbers |
|---|---|---|
| 1 Lambert core | PASS | Vallado (2013) Ex. 7-5: rel. err 2.07e-7 (v1) / 2.15e-7 (v2). Der (2011) Molniya M=0: 1.1e-10 / 5.0e-10. Max difference vs pykep C++ over 20,000 random cases: 3.4e-13, with 0 failures. 22-25 µs per solve. |
| 2 Offline ephemerides | PASS | JPL DE421 SPK from PyPI (`skyfield-data` 7.0.0). Agrees with independent ERFA theories within their documented error: Earth max 6.1 km, Mars max 6,130 km. Puts the 2027-02-19 Mars opposition on the right date. |
| 3 Porkchop | PASS (plausibility) | Min C3 **9.1821 km²/s²**: departs 2026-10-31 10:23 TDB, TOF 292.3 d, arrival v∞ 2.72 km/s, DLA +23.7°, Type II. 150x150 grid: **2.11 s** (pykep C++: 0.15 s). Hohmann bracket 8.87-9.49. |
| 4 n-body verifier | PASS (miss explained) | Sun-only check: **0.34 m**. FULL model: miss **4,048,501 km** at the nominal arrival epoch (closest approach 743,469 km, 15.2 d early). Sensitivity 92,356 km per m/s along v∞. Retargeting v∞ by **80.1 m/s** closes it to 0.4 km. |
| 5 Roadster | PASS (fetch worked) | Horizons state for 2027-01-01 fetched and self-consistent. Cheapest pizza: C3 4.98, flyby at 8.54 km/s. Near-rendezvous option: C3 16.37 + 0.64 km/s. Both use two-body propagation, with error 0.2k-69k km. |
| 6 Agent probe | done | 20 requests: 5 dropdown-able, 6 parse-then-deterministic, 5 need language understanding, 4 need negotiation. 6 of 20 need data the offline core lacks. |

## Method and environment

- **Python 3.13** in a venv at `.venv` (it reuses the system numpy 2.5.3). Installed once each from PyPI:
  - scipy 1.18.1
  - matplotlib 3.11.2
  - jplephem 2.24
  - skyfield-data 7.0.0
  - astropy 8.0.1 with pyerfa 2.0.1.5
  - pykep 3.0.1, which pulled in heyoka 7.10.1, pygmo 2.20.0 and spiceypy 8.3.0
- **Python that reads downloaded data** always ran as `.venv/bin/python3 -I`.
- **Network use:**
  - PyPI for the installs above.
  - The lamberthub 1.0.0 sdist, downloaded and read as data, never executed.
  - Two test files from GitHub raw, read as data: lamberthub `tests/test_all_solvers.py` and poliastro `tests/test_iod.py`, in `data/gh_tests/`.
  - One successful WebFetch to the JPL Horizons API (test 5). A first, longer URL was refused by the fetch proxy before reaching JPL.
  - No LLM API calls. No messaging, posting or GitHub tools.
- **Lambert** (`code/lambert_izzo.py`): written from Izzo (2015), "Revisiting Lambert's problem", CMDA 121:1-15. It uses the x-variable TOF equation, Householder iterations, the corrected single-rev initial guess and multi-rev branches. Pure Python.
- **Independent checks:**
  - `code/kepler.py`: a universal-variable Kepler propagator with a bracketed Newton solve.
  - pykep's C++ `lambert_problem`, loaded through `code/pykep_core_loader.py` (see issue 8).
- **Ephemeris** (`code/ephem.py`): DE421 through jplephem. Heliocentric states (body minus Sun) are rotated to the J2000 ecliptic with ε = 84381.448″, the same convention Horizons uses. A cubic-Hermite table at 0.25 d serves the integrator. Its interpolation error is at most 0.08 km for Mercury, 0.02 km for the Moon and 3 cm for Mars.
- **Verifier** (`code/test4_nbody.py`): Cartesian heliocentric equations of motion with indirect terms, point masses at DE421 positions, and DE440 GM values. It is integrated with scipy DOP853 at rtol 1e-12. This is a different code path from the Lambert solver.

## Test 1: Lambert core (PASS)

The expected values are transcribed from the lamberthub and poliastro test suites, which cite the books. I did not have the books themselves. Evidence: `code/test1_lambert.py` and `out/test1_lambert.log` / `.json`.

| Case (source) | Rel. err vs printed v1 / v2 | vs pykep C++ | Book's own v1, propagated, misses r2 by (fraction of chord) |
|---|---|---|---|
| **Vallado, *Fundamentals of Astrodynamics and Applications*, 4th ed. (2013), Example 7-5** (μ = 398600.4418) | **2.07e-7 / 2.15e-7** (PASS; printed to 7 digits) | 7.0e-16 | 2.5e-7 |
| Der (2011), Molniya, M=0 (AMOS paper / "Astrodynamics 102") | **1.14e-10 / 5.0e-10** | 5.6e-16 | 1.4e-9 |
| Der (2011), M=1 high / low branch | 2.3e-9 / 4.4e-10; 2.2e-9 / 8.3e-8 | <1e-15 | <1e-8 |
| Battin (1999), Example 7.12 | 2.2e-6 (fails 1e-6) | 3.0e-15 | **2.2e-6**: the printed answer does not solve the printed problem |
| Vallado, older-edition variant (r2x = 12214.83399) | 4.2e-6 (fails) | 4.9e-16 | 7.0e-6: transcription/edition inconsistency |
| Curtis, Example 5.2 | 7.3e-6 / 8.1e-6 (consistent with 5 printed digits) | 7.0e-16 | 6.8e-6 |

Key log lines:

```
Vallado (2013, 4th ed.) Example 7-5  ... rel.err vs book: v1 2.069e-07  v2 2.151e-07 ... PASS(<1e-6)=True
Random stress test ... N = 20000  failures: 0; worst rel diff vs pykep C++: 3.43e-13
  Kepler re-propagation rel. error: median 2.5e-15, 99th pct 5.8e-12 (worst 9.5e-8 = a hyperbola with periapsis 3e-5 of the unit length)
  mean solve time: this Python Izzo ~22-25 us, pykep C++ (incl. Python call) ~9 us
```

## Test 2: Offline ephemerides (PASS)

- **Source:** JPL **DE421**, `de421.bsp`, shipped inside the PyPI package `skyfield-data` 7.0.0.
  - Copied to `data/de421.bsp`, sha256 `a20a7139da04cbc462454634918e9a9ca69127044e2cc9d4f9c16e238d2deedc`.
  - The file has 15 type-2 segments covering 1899-07-29 to 2053-10-09.
  - Its SPK comment says it was created 2008-02-12 by NIOSPK.
  - No other JPL DE file is on PyPI (`de440` and `de440s` do not exist). The `de421` package is the 2008 legacy format.
- **Stated accuracy** (Folkner et al. 2009, IPN PR 42-178; quoted from memory, not verified offline): inner-planet orbits are sub-kilometre over the fit span, and Jupiter/Saturn are good to tens of km. DE421's data ends around 2008, so 2026-27 is an extrapolation of about 18 years. Its error against DE440 for these dates is **not quantified offline**.
- **What that error does to C3:** a 1 km position error changes C3 by about 2e-7 km²/s². Even swapping in the ERFA theories, which are off by thousands of km, moved the minimum C3 by only 0.0002.
- **Measured cross-check** against independent ERFA analytic theories (`out/test2_ephem.log`), daily over 2026-09 to 2028-06:

| Body | ERFA theory | max \|Δr\| | RMS \|Δr\| | Documented ERFA error |
|---|---|---|---|---|
| Earth | epv00 (VSOP2000) | **6.1 km** | 3.5 km | RMS 3.7 km, max 11.2 km |
| Venus | plan94 | 2,700 km | 1,406 km | RMS 1,060 km; L 5″ (≈2,600 km) |
| Mars | plan94 | **6,130 km** | 3,581 km | RMS 7,690 km |
| Jupiter | plan94 | 93,233 km | 87,461 km | L 71″ (≈270,000 km) |

- **Sanity checks against known dates:**
  - DE421 puts the Mars opposition at **2027-02-19 16:00 TDB** (closest approach 2027-02-20, 0.6779 AU). That matches the published opposition date.
  - Earth perihelion falls on 2027-01-03, at 0.983333 AU.

## Test 3: Earth-to-Mars porkchop (PASS, on plausibility)

- **Setup:**
  - Departures 2026-09-01 to 2027-01-31, TOF 120-400 d.
  - Earth geocentre (399) to Mars centre (499), prograde, zero revolutions.
- **Grids:**
  - The required **150 x 150** grid (22,500 solves): **2.11 s** wall time. Ephemeris took 50 ms; the Python loop, including the C3/v∞/DLA bookkeeping, took 2.06 s.
  - The same grid with pykep's C++ solver: **0.15 s**. Its C3 matches mine to 2.8e-11 km²/s².
  - A dense 305 x 281 grid (0.5 d x 1 d, 85,705 solves) for the plot: 8.46 s, 0 failures.
- **Figure:** `out/porkchop_earth_mars_2026.png`. The raw grid is in `out/porkchop_grid.npz`.

![porkchop](out/porkchop_earth_mars_2026.png)

```
type_II  min C3 = 9.1821 km^2/s^2  dep 2026-10-31 10:23 TDB  TOF 292.29 d  arr 2027-08-19 17:15  vinf_arr 2.717 km/s  DLA +23.7 deg  angle 195.86 deg  (interior minimum)
type_I   min C3 = 10.6463 km^2/s^2 dep 2026-11-13 01:02 TDB  TOF 271.35 d  ... angle 179.00 deg  <- on the ridge margin: no interior minimum
Degeneracy demo: C3 10.4231 at angle 179.9999976 deg; 0.05 d either side: C3 11.4621 / 11.4607 -> spurious, excluded
Ephemeris sensitivity: C3 at the DE421 optimum using ERFA epv00/plan94 = 9.1819
Best 21-day launch period: 2026-10-20 .. 2026-11-09, max C3 9.900 km^2/s^2
```

**Published comparison.** I have **no published 2026 value I can verify offline**. The reference to check on day 1 is NASA/TM-2010-216764: Burke, Falck & McGuire, *Interplanetary Mission Design Handbook: Earth-to-Mars Mission Opportunities 2026 to 2045*. I am not quoting numbers from it from memory.

**Why 9.18 km²/s² is physically plausible:**

1. **Hohmann bracket.** A coplanar Hohmann transfer between the actual radii of the optimal arc (0.9928 AU to 1.5421 AU) needs C3 = 8.87 km²/s² using Earth's true speed, or 9.49 using a circular speed. 9.18 sits inside that bracket. The +3.5% above the true-speed figure fits a 195.9° (not 180°) transfer and Mars's 1.85° inclination. For comparison, a Hohmann transfer between the mean orbits needs 8.67.
2. **Phasing.** At departure Mars leads Earth by 62.7°. That is the lead a 292-day, 196° arc needs while Mars moves slowly near aphelion: 195.9° − about 133°. The departure falls 3.6 months before the 2027-02-19 opposition, as minimum-energy phasing predicts.
3. **Robustness.**
   - The result does not depend on the ephemeris: ERFA gives 9.1819.
   - It does not depend on the solver: pykep agrees to 2.8e-11.
   - Grid and refined minima agree: 9.1822 vs 9.1821.

**A feature of this window.** The Type I and Type II lobes touch near 2026-11-12, TOF 272 d. At that point Earth (at departure) sits on Mars's ascending node and Mars (at arrival) sits at its descending node, at ecliptic latitude 0.003°. A transfer in Mars's own orbit plane therefore passes straight through the 180° geometry. As a result the Type I minimum lies on the ridge and depends on the margin chosen (see issue 2).

## Test 4: Independent n-body verifier (PASS: miss reported, explained and closed)

**The arc:** the Test 3 optimum. C3 9.1821 km²/s², |v∞| 3.0302 km/s, Mars SOI 577,230 km.

**FULL model:**
- Bodies: Sun, Mercury to Neptune, the Moon, and Earth and Mars as real gravitating bodies.
- Start: the perigee of a departure hyperbola from a 200 km LEO.
  - Eccentricity 1.1515, perigee speed 11.418 km/s.
  - The asymptote is offset 24,787 km from Earth's centre.
  - The plane is the lowest-inclination plane that contains v∞ (23.7° to the equator).

Evidence: `code/test4_nbody.py`, `out/test4_nbody.log` / `.json`.

| Run | Miss at nominal arrival (km) | Closest approach (km) | Notes |
|---|---|---|---|
| S0: Sun only, from Earth's centre | **0.000** (0.34 m) | 0.0 | Lambert and integrator agree |
| + Jupiter / Venus / Mercury / Saturn / Uranus / Neptune (one at a time) | 41,621 / 6,670 / 1,309 / 596 / 6.9 / 3.2 | | Superposition holds: sum 35,378 vs combined 35,377 |
| PLANETS (all except Earth, Moon, Mars) | 35,377 | 10,769 | Equivalent to **0.73 m/s** at departure |
| + Mars's own gravity | impacts | 3,396 (= R_Mars) | Arc aimed at Mars's centre: B = 2,772 km at SOI entry, inside the ~7,100 km capture radius |
| EarthOnly, LEO start | 1,788,478 | 464,350 | Equivalent to **32.3 m/s**. Delaying perigee by 14.9 h to cancel the hyperbola's along-track lead only brings it to 1,437,578 km. |
| EARTH = Earth + Moon, LEO start | 3,994,276 | 739,907 | **Lunar flyby at 18,347 km, 1.09 d after injection.** Equivalent to **79.8 m/s**. |
| **FULL** | **4,048,501** | **743,469** (15.2 d early) | Mars radial/along-track/normal: 2.11M / −3.45M / 0.15M km. Never enters Mars's SOI. |

**Why it misses.** The Lambert arc is a patched conic: Sun-only motion from Earth's centre to Mars's centre. In reality the craft has to climb out of Earth's well from LEO. On the hyperbola it runs about 160,000 km ahead of the patched-conic straight line by L+10 d. Earth's pull and the solar tide keep changing its velocity by tens of m/s for weeks. That is worth about 32 m/s, or 1.8 million km at Mars. At this particular departure epoch the outbound asymptote also passes 18,000 km from the Moon. That unplanned lunar gravity assist adds about 48 m/s more. The planets contribute only 0.7 m/s (Jupiter first, then Venus). Because the trajectory amplifies departure errors so strongly (next paragraph), 80 m/s turns into 4 million km.

**Delta-v sensitivity** of the arrival miss to the departure v∞:
- **92,356 km per m/s along v∞**.
- 20,751 km per m/s in-plane perpendicular.
- 15,653 km per m/s out of plane.
- Singular values: 95,234 / 11,648 / 328.

**Closing the miss:**
- **Departure retarget** (damped Newton): miss goes 4.03M → 711k → 53k → 1.8k → 2.8 → 0.4 km, with **|Δv∞| = 80.09 m/s** and C3 changing from 9.182 to 8.984.
- **With free arrival time** (B-plane targeting):
  - 72.5 m/s at departure.
  - Or a TCM of 58.7 m/s at L+10 d.
  - Or 64.9 m/s at L+115 d.
- **With the arrival time fixed:** a TCM costs 339 m/s at L+10 d, or 169 m/s mid-course.
- Re-flying the retargeted arc with Mars's gravity on shows it impacting Mars, as expected for an arc aimed at the centre.

**Integrator check:** the FULL end position moves 166 m between rtol 1e-12 and 1e-13, and 2.4 km between 1e-10 and 1e-12.

## Test 5: Pizza to the Roadster (PASS: one fetch worked)

**The fetch.** One WebFetch, minimal URL:

`https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='-143205'&EPHEM_TYPE=VECTORS&CENTER='500@10'&START_TIME=2027-01-01&STOP_TIME=2027-01-02&STEP_SIZE=2d`

It returned one vector at 2027-01-01 00:00 TDB (ecliptic of J2000.0, km, km/s). I saved it verbatim to `data/horizons/roadster_2027-01-01_webfetch.txt`.

**Checking the transcription.** WebFetch passes text through a model, so I checked the numbers against Horizons' own RG/RR/LT columns. They agree to all printed digits. The osculating elements are a 1.3252 AU, e 0.2560, i 1.075°, period 557.2 d, which match the Roadster's known orbit. At the epoch the Roadster is 0.994 AU from Earth.

**Caveat on the source.** Horizons says this trajectory is "JPL solution #11, a fit to 374 … measurements spanning 2018 Feb 8.2 to March 19.1". So the 2027 position is a long extrapolation of uncertain accuracy.

**Approximation used.** The Roadster is propagated from the fetched epoch with **two-body Sun-only dynamics**. Against my n-body integration of the same state, the position error is 235 km at +30 d, 9,724 km at +365 d and 68,818 km at +750 d (31,845 km at −365 d).

**Transfers.** Lambert from Earth's geocentre (prograde, zero revolutions, skipping arcs within 1° of 180°). "One impulse" means the pizza flies by. A true rendezvous would need a second burn equal to the arrival relative speed. Evidence: `code/test5_roadster.py`, `out/test5_roadster.log`.

| Departure | Min-C3 option | Best C3^½ + v_rel option |
|---|---|---|
| 2026-11-01 | C3 6.41, TOF 276 d, v_rel 8.09 km/s, **DLA +47.3°** | C3 7.69, v_rel 7.62 |
| 2026-12-01 | C3 9.71, TOF 291 d, v_rel 6.45 | C3 13.60, v_rel 5.41 |
| 2027-01-01 | C3 12.14, TOF 326 d, v_rel 4.36 | C3 19.93, TOF 440 d, v_rel 2.46 |
| 2027-02-01 | C3 16.28, TOF 507 d, v_rel 1.23 | C3 16.83, TOF 589 d, v_rel 0.71 |
| 2027-03-01 | C3 16.42, TOF 600 d, v_rel 2.79 | C3 20.02, v_rel 1.29 |
| 2027-05/07/09-01 | C3 16.6 / 17.2 / 18.9; v_rel 9.2 / 13.4 / 14.3 | |

A scan of departures every 4 d from 2026-10-16 to 2027-12-31 (18,602 solves) finds:
- **Cheapest:** depart 2026-10-16 (tomorrow, the first date in the scan), C3 4.98 km²/s², flyby at 8.54 km/s.
- **Near-rendezvous:** depart 2027-02-09, TOF 602 d, C3 16.37 km²/s², v_rel 0.64 km/s.

## Test 6: Agent-value probe (design only, no LLM calls)

**Classes:**
- **D** fits a dropdown form, so a deterministic planner answers directly.
- **P** is deterministic once parsed: multi-leg trips, deadlines, budgets or exclusions that a dropdown cannot express.
- **L** needs language understanding or a clarifying question.
- **N** needs negotiation, because the request as stated is infeasible or contradictory.

The D answers below were computed by the offline core (`code/test6_requests.py`, `out/test6_requests.json`).

| # | Request | Class | Why / deterministic answer |
|---|---|---|---|
| 1 | Pizza to Bennu, stop at the Moon on the way, and it has to arrive warm. | N | Two legs are solvable, but "warm" after months is not. Needs a counter-offer. Bennu ephemeris is missing offline. |
| 2 | Cheapest ride from Earth to Mars, leaving before Christmas 2026. | D | Depart 2026-10-31, TOF 292 d, C3 9.18 |
| 3 | Fastest ride to Mars this window, but keep departure C3 under 15. | D | Depart 2026-11-13, TOF 199 d, C3 14.99, v∞ at arrival 5.93 km/s |
| 4 | Earth to Mars with the softest possible arrival, launching on a weekend. | D | Saturday 2026-11-07, TOF 305 d, v∞ at arrival 2.56 km/s |
| 5 | Earth to Jupiter, cheapest launch in 2027, any arrival date. | D | Depart 2027-12-06, TOF 1320 d, C3 79.1 (direct) |
| 6 | Earth to Ceres, cheapest launch in 2027, arrive before 2030. | D | Form-shaped, but Ceres is not in DE421 |
| 7 | Send my cat to Venus and back in time for her birthday, 1 June 2027. | P | Free-return search; probably infeasible, which turns it into N |
| 8 | Venus flyby then Mars, total delta-v from LEO under 4 km/s, leave in 2028. | P | Needs a gravity-assist (MGA) solver and a budget field |
| 9 | Drop me at the Moon, then Mars, then home by Thanksgiving 2028. | P | Multi-leg with stays; probably infeasible, which turns it into N |
| 10 | Cheapest way to Europa, but I get motion sick, so no gravity assists. | P | Map "motion sick" to "no flybys". Europa is not in DE421. |
| 11 | Mars with a coffee stop at Phobos, and never more than 2 g. | P | Phobos ephemeris missing; the g-cap applies to the launcher/lander |
| 12 | Sun-Earth L2 to visit JWST, and stay well clear of the Moon. | P | Needs a three-body/halo solver (Lambert cannot do this) and a number for "well clear" |
| 13 | Take me to the planet where it rains diamonds, via the scenic route past Saturn's rings. | L | "Rains diamonds" could mean Uranus or Neptune; "scenic" has to become a Saturn flyby |
| 14 | A ride to wherever the Tesla Roadster is, but make it romantic. | L | The objective is undefined; ask. Needs spacecraft ephemeris. |
| 15 | Something like The Martian, but cheaper. | L | Film reference; ask what "cheaper" gives up |
| 16 | Deliver a cake to my friend's rover the day it lands in Perseverance's crater. | L | The rover and its landing date are unknown |
| 17 | Birthday cake to Jupiter's Great Red Spot by the next opposition. | L | Resolve "next opposition" and the storm's location, then negotiate an atmospheric "delivery" |
| 18 | Overnight shipping to Mars. | N | A 1-day Lambert needs C3 = 6,153,206 km²/s² (v∞ 2,481 km/s). Provably infeasible. |
| 19 | Bring this letter to Voyager 1 before it leaves the solar system. | N | Already past the heliopause; offer a radio message instead |
| 20 | Flowers to Mercury between New Year and Valentine's Day 2027, launch C3 at most 20. | N | Minimum C3 for that window is 191.9 > 20; renegotiate |

**Counts:** D = 5, P = 6, L = 5, N = 4. Requests that need data the offline core lacks: 1, 6, 10, 11, 14, 19.

**What this means for the day-1 test:**
- A dropdown with a deterministic planner should handle **25%** of these.
- A much richer form could raise that to about 55%.
- The remaining **45%** (L + N) is where an agent can add value: resolving references, asking clarifying questions, and making counter-offers that trade dates, energy or comfort.

## Issues (all proven by the logs above; none blocks feasibility)

1. **Textbook data provenance.** Battin's Ex. 7.12 and the older Vallado variant, as transcribed in third-party test suites, fail 1e-6. Their own printed v1, propagated with an independent Kepler propagator, misses the printed r2 by 2.2e-6 and 7.0e-6 of the chord. Two independent solvers agree with each other to 3e-15. So the problem is the reference data, not the solver. Day-1 validation must cite the books directly.
2. **Degenerate 180° transfers.** At exactly 180° the transfer plane is set by round-off in r1 × r2. An unconstrained optimiser found a spurious **C3 10.42 at 179.9999976°**, against 11.46 just 0.05 d either side. pykep's C++ solver behaves the same way. I checked one point (179.9999987°): both solvers give 11.2475, against 11.46 ±0.001 d away. My planner now excludes arcs within 1° of 180°. A production planner needs this guard, or a broken-plane manoeuvre model.
3. **"Type I minimum" depends on the margin.** In 2026 the Type I C3 keeps falling toward the 180° ridge, which is the node-aligned geometry. The Type I best of 10.65 km²/s² is a value at the 1° margin, not a true minimum.
4. **A raw Lambert arc is not a deliverable ride.** From a real LEO departure it misses Mars by 4.05 million km. It needs an n-body differential correction: about 80 m/s of v∞ retarget, or a TCM budget of 59-65 m/s. It also needs launch timing that accounts for the Moon (here the Moon passed 18,347 km away on day 1). Without these steps the verifier will flag every ride.
5. **Arcs aimed at a planet's centre impact.** With Mars's gravity on, the centre-aimed arc hits Mars (B = 2,772 km). The planner must target a B-plane aim point, such as a periapsis altitude.
6. **The ephemeris is old and planets-only.** DE421 is a 2008 fit; its 2026-27 error against DE440/441 is unquantified offline. It has no small bodies (Bennu, Ceres) and no satellites beyond the Moon (Phobos, Europa). Spacecraft (the Roadster, Voyager) need Horizons. 6 of the 20 probe requests are blocked offline, and this sandbox blocks the JPL/NAIF hosts that serve those files.
7. **No verifiable published 2026 C3 offline.** The ±15% check against literature is not done; only the plausibility argument is.
8. **The pykep 3.0.1 PyPI wheel is broken.** It is missing `pykep/trajopt/gym/tops/*.json`, so `import pykep` raises FileNotFoundError. I worked around it by loading only the compiled core (`code/pykep_core_loader.py`). That is a dependency risk if pykep is adopted.
9. **WebFetch limits.** The Horizons URL with optional parameters was refused by the proxy as too long; only a minimal URL works. WebFetch returns model-transcribed text, so numbers need a self-consistency check (done here with RG, RR and LT).
10. **Roadster uncertainty.** The Horizons solution is a 6-week 2018 arc extrapolated 9 years, with unknown 2027 uncertainty, and I add 0.2k-69k km of two-body error on top. That is fine for a "pizza" porkchop, not for a rendezvous. The cheapest 2026-11-01 option also needs **DLA +47.3°**, which is out of reach from the Cape without a dogleg. The planner needs DLA constraints.
11. **Speed.** Pure-Python Izzo is about 22-25 µs per solve, and the 150 x 150 grid takes 2.1 s, about 14 times slower than pykep's C++ (0.15 s). That is fine for single porkchops. Multi-leg, multi-rev "anywhere" searches will need a vectorised or C++ core.

## What remains for the real day-1 test

1. **Check against published numbers.**
   - Compare the 2026 minimum C3 and launch period with NASA/TM-2010-216764 (target: within 15%).
   - Re-check Vallado Ex. 7-5 and Battin Ex. 7.12 against the books themselves.
2. **Update the ephemeris and add small bodies.**
   - Replace DE421 with DE440/441, or measure DE421's 2026-27 drift.
   - Add a small-body and spacecraft source: SBDB/Horizons SPK with caching, plus satellite SPKs for Phobos and Europa.
   - This needs network access to JPL/NAIF that this sandbox does not allow.
3. **Put the verifier inside the planner, not after it.** That means:
   - B-plane targeting.
   - A departure-hyperbola model with launch time-of-day and lunar avoidance.
   - Differential correction.
   - A TCM budget.
   - A DLA/launch-site check.
   - A 180° degeneracy guard.
4. **Broaden the solvers.** P-class requests need a gravity-assist (MGA) and multi-rev search, and a CR3BP/halo solver for L-points.
5. **Run "agents vs dropdown" on the 20 prompts.**
   - Arm 1: a dropdown or rich form with the planner. Arm 2: an agent with the same planner.
   - Score by class: correct structured parse (P), clarifying-question quality (L), counter-offer acceptability (N). For D, check the dropdown is not worse.
   - Keep the deterministic planner as the only source of numbers.

## File index

- `code/lambert_izzo.py`, `code/kepler.py`, `code/ephem.py`, `code/pykep_core_loader.py`: the core.
- `code/test1_lambert.py` … `code/test6_requests.py`, `code/run_all.sh`: the tests and the runner.
- `out/test{1..6}_*.log` and `out/test{1..6}_*.json`: evidence.
- `out/porkchop_earth_mars_2026.png`, `out/porkchop_grid.npz`: the figure and raw grid.
- `data/de421.bsp`: the ephemeris.
- `data/horizons/roadster_2027-01-01_webfetch.txt`: the one Horizons response.
- `data/gh_tests/`: the test files I took textbook values from.
