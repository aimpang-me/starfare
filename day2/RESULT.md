# SOL day 2: planner core, 13 verified quotes

Every quote was re-flown by `code/refly.py`: Sun, 8 planets and Moon, from a 200 km LEO departure, with a Newton retarget of the departure velocity. **Pass** = final miss < 1 km and retarget < 500 m/s.

| quote | depart | days | C3 km²/s² | revs | launchable | raw miss km | final miss km | retarget m/s | gate |
|---|---|---|---|---|---|---|---|---|---|
| mars_cheapest | 2026-10-31 | 293.0 | 9.18 | 0 | yes | 1,183,830 | 0.041 | 86.2 | PASS |
| mars_fast | 2026-11-09 | 202.0 | 14.98 | - | yes | 700,606 | 0.118 | 21.1 | PASS |
| mars_soft_weekend | 2026-11-08 | 303.5 | 9.98 | - | yes | 2,364,799 | 0.01 | 41.8 | PASS |
| venus | 2026-10-16 | 160.0 | 16.82 | - | yes | 879,703 | 0.284 | 36.4 | PASS |
| mercury | 2027-11-05 | 114.0 | 41.8 | - | yes | 299,088 | 0.106 | 8.9 | PASS |
| jupiter | 2027-12-06 | 1333.0 | 79.06 | - | yes | 844,179 | 0.749 | 9.3 | PASS |
| saturn | 2028-07-17 | 2156.0 | 107.35 | - | no | 4,091,336 | 0.568 | 33.1 | PASS |
| uranus | 2029-09-08 | 8345.0 | 134.14 | - | no | 751,876 | 12.456 | 16.0 | REJECT |
| neptune | 2033-06-04 | 6195.0 | 157.12 | - | no | 61,986,699 | 0.801 | 250.4 | PASS |
| roadster | 2026-10-16 | 275.0 | 4.96 | - | yes | 2,668,071 | 0.906 | 71.8 | PASS |
| bennu | 2028-10-24 | 730.0 | 0.26 | 1 | yes | 44,331,922 | 0.176 | 380.8 | PASS |
| ceres | 2027-06-07 | 1415.0 | 39.58 | 1 | yes | 1,191,329 | 0.165 | 7.5 | PASS |
| moon | 2026-11-20 | 3.5 | -2.024 (TLI 3.134 km/s) | - | yes | 1,708 | 0.057 | 28.1 | PASS |

**12 of 13 pass.** Every raw route misses, by 1,700 km (Moon) up to 62 million km (Neptune). The gate retargets all but one to under 1 km.

## Independent checks
- **Mars 2026:** C3 9.18, 293 days, 86 m/s retarget. Matches the spike (9.18, ~80 m/s).
- **Roadster:** corrected departure burn 3.438 km/s, identical to the day-0 teaser's, from a separately fetched JPL state (2026-01-01 vs 2026-10-15).
- **Moon:** TLI 3.134 km/s, 3.5 days, C3 -2.02; textbook value is about 3.1 km/s.
- **Bennu vs JPL Small-Body Mission Design API:** JPL lists departure 2027-10-16, 670 days, C3 0.322, arrival v∞ 6.31 km/s. The first planner (0-rev only) found **C3 23.5** for that window. Cause: JPL's best routes loop once around the Sun. After adding 1-revolution Lambert, the planner finds 2027-10-22, 664.5 days, **C3 0.31**, arrival v∞ 6.43. JPL notes its precomputed list uses an outdated Bennu orbit, so a small gap is expected.
- The same fix improved **Ceres** from C3 70.6 to **39.6**.

## Known limits
- **Uranus rejected:** Newton stalls at ~22 km on a 23-year, 3-billion-km arc. That is a numerical limit, not proof of impossibility; the 1 km bar stays strict. Uranus is not launchable direct anyway (C3 134).
- Saturn, Uranus and Neptune pass or fail the gate but need C3 > 100, so the app must decline them as direct rides.
- Bennu's 1-rev route needs a 381 m/s retarget: at C3 0.3 the craft lingers near Earth, so Earth's pull matters a lot. Within the gate, but it is the largest correction.
- Every quote now lists its vehicle assumptions (200 km LEO start, impulsive burns, C3 <= 100 as a placeholder for 'launchable', no capture or landing priced).
- Targets: planets from DE421, and Roadster, Bennu and Ceres from JPL Horizons states in `data/targets.json`, which acts as the cache. Each state was checked against Horizons' own range, range-rate and light-time columns.

Reproduce: `python3 code/quote.py --dest bennu --dep-from 2026-10-16 --dep-to 2028-12-31 --verify`
