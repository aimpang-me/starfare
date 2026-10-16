"""Test 6: agent-value probe (design only, no LLM calls).

20 absurd multi-constraint ride requests, each hand-classified:
  D  dropdown-able: fits a fixed form {origin, destination, window, objective, simple caps};
     a deterministic planner serves it directly.
  P  parse-then-deterministic: the solve is deterministic (multi-leg, deadlines, budgets,
     exclusions) but the request does not fit a dropdown; needs language understanding OR a
     much richer form to capture it.
  L  language understanding: vague, cultural or implicit references must be resolved before
     any planner can run (and often a clarifying question).
  N  negotiation: infeasible or conflicting as stated; a deterministic planner can only say
     "no" -- someone must propose and trade off alternatives.
Plus capability flags: which data/solvers the offline core lacks.

For the D requests that are about the Earth->Mars 2026 window, the answer is computed
deterministically from the Test-3 porkchop grid, to show they need no agent.
"""
import datetime as dt
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from ephem import DAY, MU_SUN, Ephemeris, iso_from_jd, jd_from_iso  # noqa: E402
from lambert_izzo import lambert  # noqa: E402

OUT = os.path.join(os.path.dirname(HERE), "out")

REQUESTS = [
    # id, request, class, structured form (what a parser must produce), needs/gaps, why
    (1, "Pizza to Bennu, stop at the Moon on the way, and it has to arrive warm.", "N",
     "Earth -> Moon (stop) -> Bennu; objective: arrive 'warm'",
     "small-body ephemeris (Bennu); multi-leg; thermal constraint is physically meaningless for months-long TOF",
     "Two legs are solvable, but 'warm' after months in space is infeasible: needs a counter-offer (heated box, or 'warm' = sunlit arrival)."),
    (2, "Cheapest ride from Earth to Mars, leaving before Christmas 2026.", "D",
     "Earth -> Mars; depart <= 2026-12-25; minimise C3", "none (planets in DE421)", "Fits origin/destination/window/objective dropdowns."),
    (3, "Fastest ride to Mars this window, but keep departure C3 under 15.", "D",
     "Earth -> Mars; 2026 window; minimise TOF s.t. C3 <= 15", "none", "One extra numeric cap field."),
    (4, "Earth to Mars with the softest possible arrival, launching on a weekend.", "D",
     "Earth -> Mars; minimise arrival v_inf; departure weekday in {Sat, Sun}", "none", "Calendar filter + objective; a checkbox row covers it."),
    (5, "Earth to Jupiter, cheapest launch in 2027, any arrival date.", "D",
     "Earth -> Jupiter; depart in 2027; minimise C3", "none (Jupiter barycentre in DE421)", "Plain form; single Lambert leg."),
    (6, "Earth to Ceres, cheapest launch in 2027, arrive before 2030.", "D",
     "Earth -> Ceres; depart in 2027; arrive < 2030; minimise C3", "small-body ephemeris (Ceres) not in DE421",
     "Form-shaped, but blocked offline until small-body data is available."),
    (7, "Send my cat to Venus and back in time for her birthday, 1 June 2027.", "P",
     "Earth -> Venus (flyby) -> Earth; return <= 2027-06-01", "multi-leg / free-return search",
     "Deterministic once parsed ('her birthday' resolved by the user's date); likely infeasible -> may escalate to N."),
    (8, "Venus flyby then Mars, total delta-v from LEO under 4 km/s, leave in 2028.", "P",
     "Earth -> Venus (GA) -> Mars; depart 2028; sum dv <= 4 km/s", "gravity-assist (MGA) solver",
     "Fully specified but needs a 'via' list and a budget field; MGA search is deterministic."),
    (9, "Drop me at the Moon, then Mars, then home by Thanksgiving 2028.", "P",
     "Earth -> Moon -> Mars (stay) -> Earth; return <= 2028-11-23", "multi-leg with stays; holiday date resolution",
     "Deterministic after parsing; conjunction-class Mars stays return ~2029, so probably infeasible -> N."),
    (10, "Cheapest way to Europa, but I get motion sick, so no gravity assists.", "P",
     "Earth -> Europa; direct transfer only; minimise C3", "satellite ephemeris (Europa); exclusion constraint",
     "'Motion sick' must be mapped to 'no flybys' (irrelevant physiology); then deterministic."),
    (11, "Mars with a coffee stop at Phobos, and never more than 2 g.", "P",
     "Earth -> Phobos (stop) -> Mars; acceleration cap", "satellite ephemeris (Phobos); 2 g is a launch/landing constraint, not a ballistic one",
     "Parse + map the comfort cap onto launcher/lander choices; trajectory part is deterministic."),
    (12, "Sun-Earth L2 to visit JWST, and stay well clear of the Moon.", "P",
     "Earth -> SEL2 halo; min lunar distance >= X", "CR3BP / halo solver (Lambert cannot do L2)",
     "Deterministic constraint once 'well clear' gets a number; capability gap in the core."),
    (13, "Take me to the planet where it rains diamonds, via the scenic route past Saturn's rings.", "L",
     "Earth -> Saturn (flyby) -> Uranus or Neptune", "MGA solver; entity resolution",
     "'Rains diamonds' is pop-science for Uranus/Neptune (ambiguous); 'scenic' must become a flyby constraint."),
    (14, "A ride to wherever the Tesla Roadster is, but make it romantic.", "L",
     "Earth -> Roadster; objective undefined ('romantic')", "spacecraft ephemeris (Horizons -143205)",
     "Needs a clarifying question: low arrival speed? Earthrise view? arrival on a date?"),
    (15, "Something like The Martian, but cheaper.", "L",
     "reference to a film's Earth-Mars mission profile; objective: lower cost", "world knowledge",
     "Must recall the film's mission (Ares/Hermes) and ask what 'cheaper' gives up."),
    (16, "Deliver a cake to my friend's rover the day it lands in Perseverance's crater.", "L",
     "Earth -> Mars surface (Jezero); arrival date = friend's landing date (unknown)", "entity + date resolution; EDL",
     "'My friend's rover' and its landing date are unknown; must ask."),
    (17, "Birthday cake to Jupiter's Great Red Spot by the next opposition.", "L",
     "Earth -> Jupiter atmosphere entry at a storm; arrive <= next Jupiter opposition", "atmospheric target; date resolution",
     "Resolve 'next opposition' and the GRS location; the 'deliver into a storm' goal then needs N."),
    (18, "Overnight shipping to Mars.", "N",
     "Earth -> Mars; TOF <= 1 day", "none", "Physically infeasible; a planner can prove it but must offer alternatives."),
    (19, "Bring this letter to Voyager 1 before it leaves the solar system.", "N",
     "Earth -> Voyager 1; arrive before it leaves", "spacecraft ephemeris", "Already past the heliopause (2012) at ~17 km/s; offer a radio message instead."),
    (20, "Flowers to Mercury between New Year and Valentine's Day 2027, launch C3 at most 20.", "N",
     "Earth -> Mercury; arrive 2027-01-01..2027-02-14; C3 <= 20", "none",
     "Mercury needs C3 well above 20 and months of flight; must renegotiate dates or energy."),
]


def main():
    g = np.load(os.path.join(OUT, "porkchop_grid.npz"))
    deps, tofs, C3, VA, ANG = g["deps"], g["tofs"], g["C3"], g["VA"], g["ANG"]
    ok = np.abs(ANG - 180.0) >= 1.0  # avoid the degenerate 180-deg plane (Test 3)
    answers = {}
    # 2: cheapest before Christmas 2026
    m = ok & (deps[:, None] <= jd_from_iso("2026-12-25"))
    k = np.nanargmin(np.where(m, C3, np.nan))
    i, j = np.unravel_index(k, C3.shape)
    answers[2] = f"depart {iso_from_jd(deps[i])}, TOF {tofs[j]:.0f} d, C3 {C3[i, j]:.2f} km2/s2"
    # 3: fastest with C3 <= 15
    m = ok & (C3 <= 15.0)
    T = np.where(m, np.broadcast_to(tofs[None, :], C3.shape), np.nan)
    k = np.nanargmin(T)
    i, j = np.unravel_index(k, C3.shape)
    answers[3] = f"depart {iso_from_jd(deps[i])}, TOF {tofs[j]:.0f} d (fastest with C3 <= 15), C3 {C3[i, j]:.2f}, v_inf,arr {VA[i, j]:.2f} km/s"
    # 4: softest arrival, weekend departure
    wk = np.array([(dt.datetime(2000, 1, 1, 12) + dt.timedelta(days=float(d) - 2451545.0)).weekday() >= 5 for d in deps])
    m = ok & wk[:, None] & (C3 <= 30)
    k = np.nanargmin(np.where(m, VA, np.nan))
    i, j = np.unravel_index(k, C3.shape)
    answers[4] = (f"depart {iso_from_jd(deps[i])} ({(dt.datetime(2000, 1, 1, 12) + dt.timedelta(days=float(deps[i]) - 2451545.0)).strftime('%A')}), "
                  f"TOF {tofs[j]:.0f} d, v_inf,arr {VA[i, j]:.2f} km/s, C3 {C3[i, j]:.2f} (C3 cap 30 assumed)")
    eph = Ephemeris()
    # 5: Earth -> Jupiter, cheapest launch in 2027 (0-rev Lambert scan)
    best5 = None
    for d0 in np.arange(jd_from_iso("2027-01-01"), jd_from_iso("2027-12-31") + 0.1, 3.0):
        pE, vE = eph.helio(399, d0)
        for tof in np.arange(400.0, 1801.0, 10.0):
            pj, _ = eph.helio(5, d0 + tof)
            try:
                v1, _, inf = lambert(MU_SUN, pE, pj, tof * DAY, return_info=True)
            except Exception:
                continue
            if abs(inf["transfer_angle_deg"] - 180) < 1:
                continue
            c = float(np.sum((np.array(v1) - vE) ** 2))
            if best5 is None or c < best5[0]:
                best5 = (c, d0, tof)
    answers[5] = f"depart {iso_from_jd(best5[1])}, TOF {best5[2]:.0f} d, C3 {best5[0]:.1f} km2/s2 (direct, no flybys)"
    # 18: overnight to Mars -- prove infeasibility with a 1-day Lambert
    dj = jd_from_iso("2026-10-31")
    pE, vE = eph.helio(399, dj)
    pM, _ = eph.helio(499, dj + 1)
    v1, _ = lambert(MU_SUN, pE, pM, DAY)
    c3 = float(np.sum((np.array(v1) - vE) ** 2))
    answers[18] = f"1-day Lambert Earth->Mars from 2026-10-31: C3 = {c3:,.0f} km2/s2 (v_inf {math.sqrt(c3):,.0f} km/s) -> infeasible"
    # 20: Mercury C3 floor in a 2026-10..2027-02 window, arrival 2027-01-01..2027-02-14
    best = None
    for d0 in np.arange(jd_from_iso("2026-10-16"), jd_from_iso("2027-02-10"), 2.0):
        pE, vE = eph.helio(399, d0)
        for a in np.arange(max(d0 + 20, jd_from_iso("2027-01-01")), jd_from_iso("2027-02-14") + 0.1, 2.0):
            pm, _ = eph.helio(199, a)
            try:
                v1, _, inf = lambert(MU_SUN, pE, pm, (a - d0) * DAY, return_info=True)
            except Exception:
                continue
            if abs(inf["transfer_angle_deg"] - 180) < 1:
                continue
            c = float(np.sum((np.array(v1) - vE) ** 2))
            if best is None or c < best[0]:
                best = (c, d0, a)
    answers[20] = f"min C3 for that arrival window: {best[0]:.1f} km2/s2 (dep {iso_from_jd(best[1])}, arr {iso_from_jd(best[2])}) > 20 -> must renegotiate"

    counts = {c: sum(1 for r in REQUESTS if r[2] == c) for c in "DPLN"}
    rows = [{"id": r[0], "request": r[1], "class": r[2], "structured_form": r[3], "needs": r[4], "why": r[5],
             "deterministic_answer": answers.get(r[0])} for r in REQUESTS]
    data_gaps = [r[0] for r in REQUESTS if any(s in r[4] for s in ("ephemeris",))]
    print("TEST 6  agent-value probe: 20 requests")
    for r in rows:
        print(f"  #{r['id']:2d} [{r['class']}] {r['request']}")
        if r["deterministic_answer"]:
            print(f"        deterministic planner: {r['deterministic_answer']}")
    print(f"Counts: D={counts['D']}  P={counts['P']}  L={counts['L']}  N={counts['N']}; requests needing data the offline core lacks: {data_gaps}")
    with open(os.path.join(OUT, "test6_requests.json"), "w") as f:
        json.dump({"rows": rows, "counts": counts, "data_gap_ids": data_gaps}, f, indent=2)


if __name__ == "__main__":
    main()
