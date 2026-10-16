"""Independent physics gate: re-fly a Lambert quote through an n-body model (Sun, 8 planets, Moon),
starting from a 200 km LEO departure hyperbola, then Newton-retarget the departure v_inf so the craft
reaches the target. A quote only passes if the retarget converges (< 1 km) with a sane correction.
The planner (quote.py) and this file share only the ephemeris and the Lambert solver for the first guess."""
import math, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import skyfield_data
from ephem import DAY, GM, J2000, MU_SUN, R_EARTH, Ephemeris, HermiteTable
from lambert_izzo import lambert
from nbody import Model, propagate, hyperbola_start, newton, PERTURBERS
import json

NAIF = {"mercury":1,"venus":2,"mars":4,"jupiter":5,"saturn":6,"uranus":7,"neptune":8}
MAX_RETARGET_MS = 500.0   # a correction bigger than this means the raw route was not a real route
RTOL = 1e-12  # DOP853 rtol for the miss propagations. Was 1e-10 until 2026-10-16: on 17-23 year legs that left 16-37 km of
              # integration noise, above the 1 km pass bar, so long legs "failed" on noise (see world/engine/CHECK.md).
MU_E, RP = GM[399], R_EARTH + 200.0
def dv_dep(c3): return math.sqrt(c3 + 2*MU_E/RP) - math.sqrt(MU_E/RP)

def refly(dest, dep_jd, tof_days, M=0, lowpath=True):
    eph = Ephemeris(os.path.join(os.path.dirname(skyfield_data.__file__), "data", "de421.bsp"))
    arr_jd = dep_jd + tof_days
    ta, tdep = (arr_jd - J2000)*DAY, (dep_jd - J2000)*DAY
    states = json.load(open(os.path.join(HERE, "..", "data", "targets.json")))["targets"]
    if dest in states:  # small bodies and spacecraft: integrate their own n-body orbit from the Horizons state
        road = states[dest]
        jd0 = road["jd_tdb"]
        table = HermiteTable(eph, PERTURBERS, min(jd0, dep_jd) - 2, arr_jd + 70)
        t0 = (jd0 - J2000)*DAY
        fwd = propagate(Model(table, PERTURBERS), t0, np.concatenate((road["r_km"], road["v_kms"])), ta, dense=True)
        target = fwd.sol(ta)[:3]
        active = PERTURBERS
    else:
        table = HermiteTable(eph, PERTURBERS, dep_jd - 2, arr_jd + 70)
        target = eph.helio(NAIF[dest], arr_jd)[0]
        active = [b for b in PERTURBERS if b != NAIF[dest]]  # aim at the centre; target's own gravity off
    pe, ve = eph.helio(399, dep_jd)
    v1, _ = lambert(MU_SUN, pe, target, tof_days*DAY, M=M, lowpath=lowpath)
    vinf0 = np.array(v1) - ve
    full = Model(table, active)
    def miss(vinf):
        ys, _ = hyperbola_start(pe, ve, vinf)
        return propagate(full, tdep, ys, ta, rtol=RTOL).y[:3, -1] - target
    m0 = miss(vinf0)
    x, d, hist = newton(miss, vinf0, h=1e-4, tol_km=1.0, max_iter=20)
    fin, ret = float(np.linalg.norm(d)), float(np.linalg.norm(x - vinf0)*1000)
    return {"raw_miss_km": round(float(np.linalg.norm(m0)), 1), "final_miss_km": round(fin, 3), "retarget_ms": round(ret, 1),
            "iterations": len(hist) - 1, "c3_corrected_km2s2": round(float(x @ x), 2),
            "dv_dep_corrected_kms": round(dv_dep(float(x @ x)), 3),
            "pass": bool(fin < 1.0 and ret < MAX_RETARGET_MS), "model": "n-body Sun+8 planets+Moon, 200 km LEO departure, aimed at target centre"}

def refly_moon(dep_jd, tof_days):
    from moon import tli
    eph = Ephemeris(os.path.join(os.path.dirname(skyfield_data.__file__), "data", "de421.bsp"))
    q = tli(eph, dep_jd, tof_days)
    table = HermiteTable(eph, PERTURBERS, dep_jd - 2, dep_jd + tof_days + 5, step_days=0.05)
    tdep, ta = (dep_jd - J2000)*DAY, (dep_jd + tof_days - J2000)*DAY
    pe, ve = eph.helio(399, dep_jd); target = eph.helio(301, dep_jd + tof_days)[0]
    full = Model(table, [b for b in PERTURBERS if b != 301])
    def miss(v1):
        y0 = np.concatenate((pe + q["r1"], ve + v1))
        return propagate(full, tdep, y0, ta, rtol=1e-11).y[:3, -1] - target
    m0 = miss(q["v1"])
    x, d, hist = newton(miss, q["v1"], h=1e-5, tol_km=1.0, max_iter=12)
    fin, ret = float(np.linalg.norm(d)), float(np.linalg.norm(x - q["v1"])*1000)
    return {"raw_miss_km": round(float(np.linalg.norm(m0)), 1), "final_miss_km": round(fin, 3), "retarget_ms": round(ret, 1),
            "iterations": len(hist) - 1, "pass": bool(fin < 1.0 and ret < MAX_RETARGET_MS),
            "model": "n-body Sun+8 planets (Moon's gravity off on approach), from 200 km LEO, aimed at Moon centre"}

if __name__ == "__main__":
    import argparse
    a = argparse.ArgumentParser(); a.add_argument("--dest", required=True); a.add_argument("--dep-jd", type=float, required=True); a.add_argument("--tof", type=float, required=True)
    a = a.parse_args(); print(json.dumps(refly(a.dest, a.dep_jd, a.tof)))


def refly_leg(src, dst, dep_jd, tof_days, M=0, lowpath=True):
    """General Sun-centred leg between any two of: planets (by name) and Horizons-state targets.
    A planet endpoint is its centre with its own gravity switched off (patched-conic: escape and
    capture burns are priced separately). A state target is integrated n-body as its own orbit."""
    eph = Ephemeris(os.path.join(os.path.dirname(skyfield_data.__file__), "data", "de421.bsp"))
    states = json.load(open(os.path.join(HERE, "..", "data", "targets.json")))["targets"]
    naif = dict(NAIF, earth=399)
    arr_jd = dep_jd + tof_days
    t_dep, t_arr = (dep_jd - J2000)*DAY, (arr_jd - J2000)*DAY
    lo = min([dep_jd] + [states[n]["jd_tdb"] for n in (src, dst) if n in states])
    table = HermiteTable(eph, PERTURBERS, lo - 2, arr_jd + 5)
    def where(name, jd):
        if name in states:
            S = states[name]; t0 = (S["jd_tdb"] - J2000)*DAY; t1 = (jd - J2000)*DAY
            y = propagate(Model(table, PERTURBERS), t0, np.concatenate((S["r_km"], S["v_kms"])), t1).y[:, -1]
            return y[:3], y[3:]
        return eph.helio(naif[name], jd)
    p0, v0b = where(src, dep_jd); target, _ = where(dst, arr_jd)
    v1, _ = lambert(MU_SUN, p0, target, tof_days*DAY, M=M, lowpath=lowpath); v1 = np.array(v1)
    off = [naif[n] for n in (src, dst) if n in naif]
    model = Model(table, [b for b in PERTURBERS if b not in off])
    miss = lambda v: propagate(model, t_dep, np.concatenate((p0, v)), t_arr, rtol=RTOL).y[:3, -1] - target
    m0 = miss(v1)
    x, d, hist = newton(miss, v1, h=1e-4, tol_km=1.0, max_iter=20)
    fin, ret = float(np.linalg.norm(d)), float(np.linalg.norm(x - v1)*1000)
    return {"raw_miss_km": round(float(np.linalg.norm(m0)), 1), "final_miss_km": round(fin, 4), "retarget_ms": round(ret, 1),
            "iterations": len(hist) - 1, "vinf_dep_corrected_kms": round(float(np.linalg.norm(x - v0b)), 3),
            "pass": bool(fin < 1.0 and ret < MAX_RETARGET_MS),
            "model": "n-body Sun+8 planets+Moon; planet endpoints patched-conic (own gravity off)"}
