"""Test 5: "pizza to the Roadster" one-impulse transfers.

Input: ONE heliocentric state of the Tesla Roadster (Horizons -143205) at 2027-01-01 00:00 TDB,
fetched once with WebFetch and saved in data/horizons/roadster_2027-01-01_webfetch.txt
(Horizons: ecliptic of J2000.0, km, km/s, Sun-centred, TDB).

Approximation (stated in REPORT.md): the Roadster is propagated from that epoch with
TWO-BODY Sun-only dynamics (kepler.py).  We quantify that approximation by also
integrating it with the n-body model (Sun + planets from DE421) and comparing.

For each departure date: Lambert (prograde, 0-rev) from Earth (DE421 geocentre) to the
Roadster's two-body position; report departure C3 and the arrival relative speed
(the flyby speed for the pizza, or the second impulse a true rendezvous would need).
"""
import json
import math
import os
import re
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from ephem import AU_KM, DAY, ECL2EQ, J2000, MU_SUN, Ephemeris, HermiteTable, iso_from_jd, jd_from_iso  # noqa: E402
from kepler import elements, propagate  # noqa: E402
from lambert_izzo import lambert  # noqa: E402

ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "out")
SRC = os.path.join(ROOT, "data", "horizons", "roadster_2027-01-01_webfetch.txt")


def parse_horizons(path):
    txt = open(path).read()
    block = txt.split("$$SOE")[1].split("$$EOE")[0]
    jd = float(block.split("=")[0])
    num = r"([-+]?\d\.\d+E[-+]\d+)"
    vals = {}
    for key in ("X", "Y", "Z", "VX", "VY", "VZ", "LT", "RG", "RR"):
        m = re.search(r"(?<![A-Z])" + key + r"\s*=\s*" + num, block)
        vals[key] = float(m.group(1))
    assert "Ecliptic of J2000.0" in txt and "KM-S" in txt and "Sun (10)" in txt and "TDB" in txt
    return jd, np.array([vals["X"], vals["Y"], vals["Z"]]), np.array([vals["VX"], vals["VY"], vals["VZ"]]), vals


def main():
    jd0, r0, v0, vals = parse_horizons(SRC)
    out = {"epoch_jd_tdb": jd0, "r0_km": r0.tolist(), "v0_kms": v0.tolist()}
    print("TEST 5  Pizza to the Roadster")
    print(f"Horizons state (ecliptic J2000, Sun-centred) at {iso_from_jd(jd0, True)} TDB: r = {r0} km, v = {v0} km/s")
    # transcription self-consistency: Horizons' own RG / RR / LT columns vs the X..VZ we parsed
    rg = np.linalg.norm(r0)
    rr = r0 @ v0 / rg
    lt = rg / 299792.458
    print(f"  self-consistency: |r| {rg:.6e} vs RG {vals['RG']:.6e}; r.v/|r| {rr:.9f} vs RR {vals['RR']:.9f}; |r|/c {lt:.6f} vs LT {vals['LT']:.6f}")
    out["consistency"] = {"rg_rel": abs(rg - vals["RG"]) / vals["RG"], "rr_abs": abs(rr - vals["RR"]), "lt_abs": abs(lt - vals["LT"])}
    a, e, inc, raan, argp, nu = elements(MU_SUN, r0, v0)
    per = 2 * math.pi * math.sqrt(a ** 3 / MU_SUN) / DAY
    print(f"  osculating elements: a {a/AU_KM:.4f} AU, e {e:.4f}, i {math.degrees(inc):.3f} deg (ecliptic), "
          f"q {a*(1-e)/AU_KM:.4f} AU, Q {a*(1+e)/AU_KM:.4f} AU, period {per:.1f} d")
    out["elements"] = {"a_au": a / AU_KM, "e": e, "i_deg": math.degrees(inc), "q_au": a * (1 - e) / AU_KM,
                       "Q_au": a * (1 + e) / AU_KM, "period_days": per}
    eph = Ephemeris()
    pE0, _ = eph.helio(399, jd0)
    print(f"  Earth-Roadster distance at epoch: {np.linalg.norm(r0 - pE0)/AU_KM:.3f} AU")
    out["earth_distance_au_at_epoch"] = float(np.linalg.norm(r0 - pE0) / AU_KM)

    # how bad is two-body?  integrate the Roadster with Sun + planets (DE421) and compare
    from scipy.integrate import solve_ivp
    from ephem import GM
    naifs = [1, 2, 399, 301, 4, 5, 6, 7, 8]
    tab = HermiteTable(eph, naifs, jd0 - 400, jd0 + 800)
    gms = np.array([GM[b] for b in naifs])[:, None]

    def rhs(t, y):
        r = y[:3]
        acc = -MU_SUN * r / np.linalg.norm(r) ** 3
        P = tab.pos(t)
        d = P - r
        acc = acc + (gms * (d / np.linalg.norm(d, axis=1)[:, None] ** 3 - P / np.linalg.norm(P, axis=1)[:, None] ** 3)).sum(axis=0)
        return np.concatenate((y[3:], acc))

    t0s = (jd0 - J2000) * DAY
    sol = solve_ivp(rhs, (t0s, t0s + 760 * DAY), np.concatenate((r0, v0)), method="DOP853", rtol=1e-12, atol=1e-6, dense_output=True)
    sol_back = solve_ivp(rhs, (t0s, t0s - 365 * DAY), np.concatenate((r0, v0)), method="DOP853", rtol=1e-12, atol=1e-6, dense_output=True)
    errs = {}
    for dd in (-365, -180, 30, 100, 200, 365, 550, 750):
        s_ = sol if dd > 0 else sol_back
        rk, _ = propagate(MU_SUN, r0, v0, dd * DAY)
        errs[dd] = float(np.linalg.norm(rk - s_.sol(t0s + dd * DAY)[:3]))
    print("  two-body vs n-body (Sun+planets) Roadster position difference: " +
          ", ".join(f"{k:+d} d: {v:,.0f} km" for k, v in errs.items()))
    out["twobody_vs_nbody_km"] = errs

    # one-impulse transfers for a few departure dates
    deps = ["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01", "2027-05-01", "2027-07-01", "2027-09-01"]
    tofs = np.arange(30.0, 701.0, 1.0)  # 0-rev only; arrivals stay within ~-60..+900 d of the fetched epoch
    rows = []
    print("\n  departure    | min-C3 option                                         | min (v_inf,dep + v_rel,arr) option")
    for ds in deps:
        dj = jd_from_iso(ds)
        pE, vE = eph.helio(399, dj)
        best_c3, best_tot = None, None
        for tof in tofs:
            ra, va = propagate(MU_SUN, r0, v0, (dj + tof - jd0) * DAY)  # two-body Roadster
            try:
                v1, v2, info = lambert(MU_SUN, pE, ra, tof * DAY, return_info=True)
            except Exception:
                continue
            if abs(info["transfer_angle_deg"] - 180.0) < 1.0:
                continue  # skip the degenerate 180-deg plane (see Test 3)
            vinf = np.array(v1) - vE
            c3 = float(vinf @ vinf)
            vrel = float(np.linalg.norm(np.array(v2) - va))
            dla = math.degrees(math.asin((ECL2EQ @ vinf)[2] / np.linalg.norm(vinf)))
            cand = {"dep": ds, "tof_days": float(tof), "arr": iso_from_jd(dj + tof), "c3": c3, "vrel_arr_kms": vrel,
                    "dla_deg": dla, "angle_deg": info["transfer_angle_deg"],
                    "arr_days_from_epoch": float(dj + tof - jd0)}
            if best_c3 is None or c3 < best_c3["c3"]:
                best_c3 = cand
            if best_tot is None or math.sqrt(c3) + vrel < math.sqrt(best_tot["c3"]) + best_tot["vrel_arr_kms"]:
                best_tot = cand
        rows.append({"departure": ds, "min_c3": best_c3, "min_total": best_tot})
        b, t = best_c3, best_tot
        print(f"  {ds}   | C3 {b['c3']:7.2f} km2/s2, TOF {b['tof_days']:4.0f} d, v_rel {b['vrel_arr_kms']:5.2f} km/s, DLA {b['dla_deg']:+5.1f} "
              f"| C3 {t['c3']:7.2f}, TOF {t['tof_days']:4.0f} d, v_rel {t['vrel_arr_kms']:5.2f} km/s (sum {math.sqrt(t['c3'])+t['vrel_arr_kms']:.2f})")
    out["transfers"] = rows
    # coarse scan of departure dates (every 4 d) for the best one-impulse options
    scan = []
    for dj in np.arange(jd_from_iso("2026-10-16"), jd_from_iso("2027-12-31"), 4.0):
        pE, vE = eph.helio(399, dj)
        for tof in np.arange(30.0, 701.0, 4.0):
            ra, va = propagate(MU_SUN, r0, v0, (dj + tof - jd0) * DAY)
            try:
                v1, v2, info = lambert(MU_SUN, pE, ra, tof * DAY, return_info=True)
            except Exception:
                continue
            if abs(info["transfer_angle_deg"] - 180.0) < 1.0:
                continue
            c3 = float(np.sum((np.array(v1) - vE) ** 2))
            vrel = float(np.linalg.norm(np.array(v2) - va))
            scan.append((dj, tof, c3, vrel))
    sc = np.array(scan)
    i1 = int(np.argmin(sc[:, 2]))
    i2 = int(np.argmin(np.sqrt(sc[:, 2]) + sc[:, 3]))
    for lab, i in (("min C3", i1), ("min v_inf,dep + v_rel,arr", i2)):
        dj, tof, c3, vrel = sc[i]
        print(f"  scan 2026-10-16..2027-12-31 ({len(sc)} solves), {lab}: dep {iso_from_jd(dj)}, TOF {tof:.0f} d, "
              f"C3 {c3:.2f} km2/s2, v_rel,arr {vrel:.2f} km/s (arrival {dj + tof - jd0:+.0f} d from the fetched epoch)")
        out["scan_" + lab.replace(" ", "_").replace(",", "")] = {"dep": iso_from_jd(dj), "tof_days": float(tof), "c3": float(c3),
                                                                  "vrel_arr_kms": float(vrel), "arr_days_from_epoch": float(dj + tof - jd0)}
    with open(os.path.join(OUT, "test5_roadster.json"), "w") as f:
        json.dump(out, f, indent=2)


if __name__ == "__main__":
    main()
