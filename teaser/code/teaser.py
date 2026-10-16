"""SOL teaser numbers: where the Roadster is today, and one physics-checked ride to it.

Inputs: Horizons state of -143205 at 2026-10-15 00:00 TDB (fetched today; checked against
Horizons' own RG/RR/LT columns) and the earlier 2027-01-01 state (cross-check).
Roadster target positions come from an n-body integration (Sun + planets + Moon, DE421).
"""
import json, math, os, sys, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from ephem import AU_KM, DAY, J2000, MU_SUN, GM, R_EARTH, Ephemeris, HermiteTable, iso_from_jd, jd_from_iso
from lambert_izzo import lambert
from test4_nbody import Model, propagate, hyperbola_start, newton, PERTURBERS
from test5_roadster import parse_horizons

OUT = os.path.join(os.path.dirname(HERE), "teaser")
JD_TODAY = 2461328.5
R_TODAY = np.array([2.244337077597221E+08, 6.101800365039362E+06, 2.961963347068539E+06])
V_TODAY = np.array([-5.603792421131766E+00, 2.193758084858202E+01, 2.285051702200942E-01])
C = 299792.458
MU_E = GM[399]; RP = R_EARTH + 200.0

def dv_dep(c3): return math.sqrt(c3 + 2 * MU_E / RP) - math.sqrt(MU_E / RP)

def main():
    t_start = time.time()
    eph = Ephemeris(); out = {}
    jd_launch = jd_from_iso("2018-02-07")
    table = HermiteTable(eph, PERTURBERS, jd_launch - 2, JD_TODAY + 1200)
    model = Model(table, PERTURBERS)
    t0 = (JD_TODAY - J2000) * DAY
    y0 = np.concatenate((R_TODAY, V_TODAY))
    # cross-check: integrate the separately fetched 2027-01-01 state back to today
    jd1, r1, v1, _ = parse_horizons(os.path.join(os.path.dirname(HERE), "data", "horizons", "roadster_2027-01-01_webfetch.txt"))
    back = propagate(Model(table, PERTURBERS), (jd1 - J2000) * DAY, np.concatenate((r1, v1)), t0)
    out["crosscheck_km"] = float(np.linalg.norm(back.y[:3, -1] - R_TODAY))
    # Roadster forward and backward
    fwd = propagate(model, t0, y0, t0 + 1150 * DAY, dense=True)
    bwd = propagate(Model(table, PERTURBERS), t0, y0, (jd_launch - J2000) * DAY, dense=True)
    pE, vE = eph.helio(399, JD_TODAY); pM, vM = eph.helio(4, JD_TODAY)
    out["today"] = {
        "date": "2026-10-15", "sun_km": float(np.linalg.norm(R_TODAY)), "sun_au": float(np.linalg.norm(R_TODAY) / AU_KM),
        "earth_km": float(np.linalg.norm(R_TODAY - pE)), "mars_km": float(np.linalg.norm(R_TODAY - pM)),
        "speed_sun_kms": float(np.linalg.norm(V_TODAY)), "speed_earth_kms": float(np.linalg.norm(V_TODAY - vE)),
        "light_min_earth": float(np.linalg.norm(R_TODAY - pE) / C / 60),
        "pos_au": (R_TODAY / AU_KM).tolist(), "earth_au": (pE / AU_KM).tolist(), "mars_au": (pM / AU_KM).tolist()}
    # odometer since launch (heliocentric path length) and laps
    ts = np.linspace((jd_launch - J2000) * DAY, t0, 40001)
    P = bwd.sol(ts)[:3].T
    out["odometer_km"] = float(np.sum(np.linalg.norm(np.diff(P, axis=0), axis=1)))
    a = 1.0 / (2 / np.linalg.norm(R_TODAY) - V_TODAY @ V_TODAY / MU_SUN)
    per = 2 * math.pi * math.sqrt(a ** 3 / MU_SUN) / DAY
    out["period_days"] = per; out["laps"] = (JD_TODAY - jd_launch) / per
    out["days_since_launch"] = JD_TODAY - jd_launch
    # orbit tracks for the diagram (one period ahead)
    tt = np.linspace(t0, t0 + per * DAY, 241)
    out["track_roadster_au"] = (fwd.sol(tt)[:3].T / AU_KM)[:, :2].round(5).tolist()
    for nm, nf, pd in (("earth", 399, 365.25), ("mars", 4, 687.0)):
        out["track_" + nm + "_au"] = [list(np.round(eph.helio(nf, JD_TODAY + d)[0][:2] / AU_KM, 5)) for d in np.linspace(0, pd, 181)]
    # next close pass to Earth in the next 3 years
    days = np.arange(0, 1150, 1.0)
    dE = np.array([np.linalg.norm(fwd.sol(t0 + d * DAY)[:3] - eph.helio(399, JD_TODAY + d)[0]) for d in days])
    k = int(np.argmin(dE)); out["closest_earth"] = {"date": iso_from_jd(JD_TODAY + days[k]), "km": float(dE[k])}
    dM = np.array([np.linalg.norm(fwd.sol(t0 + d * DAY)[:3] - eph.helio(4, JD_TODAY + d)[0]) for d in days])
    k = int(np.argmin(dM)); out["closest_mars"] = {"date": iso_from_jd(JD_TODAY + days[k]), "km": float(dM[k])}
    # ride scan: depart 2026-10-16 .. 2027-10-15 every 2 d, TOF 40..700 every 4 d
    scan = []
    for dj in np.arange(JD_TODAY + 1, JD_TODAY + 366, 2.0):
        pe, ve = eph.helio(399, dj)
        for tof in np.arange(40.0, 701.0, 4.0):
            if dj + tof - JD_TODAY > 1140: continue
            ra = fwd.sol((dj + tof - J2000) * DAY)
            try: va1, va2, info = lambert(MU_SUN, pe, ra[:3], tof * DAY, return_info=True)
            except Exception: continue
            if abs(info["transfer_angle_deg"] - 180.0) < 1.0: continue
            c3 = float(np.sum((np.array(va1) - ve) ** 2)); vrel = float(np.linalg.norm(np.array(va2) - ra[3:]))
            scan.append((dj, tof, c3, vrel))
    sc = np.array(scan); out["scan_solves"] = len(sc)
    dvd = np.array([dv_dep(c) for c in sc[:, 2]])
    picks = {"flyby": int(np.argmin(dvd)), "rendezvous": int(np.argmin(dvd + sc[:, 3]))}
    fast = np.where(dvd <= 4.5)[0]; picks["express"] = int(fast[np.argmin(sc[fast, 1])])
    rides = {}
    for kname, i in picks.items():
        dj, tof, c3, vrel = sc[i]
        rides[kname] = {"dep": iso_from_jd(dj), "arr": iso_from_jd(dj + tof), "tof_days": float(tof), "c3": float(c3),
                        "dv_dep_kms": dv_dep(c3), "vrel_arr_kms": float(vrel),
                        "dv_total_kms": dv_dep(c3) + (float(vrel) if kname == "rendezvous" else 0.0), "dep_jd": float(dj)}
    out["rides"] = rides
    # fare curve: cheapest one-burn flyby per departure date
    curve = {}
    for (dj, tof, c3, vrel), dv in zip(sc, dvd):
        curve[dj] = min(curve.get(dj, 99), dv)
    out["fare_curve"] = [[iso_from_jd(k), round(v, 3)] for k, v in sorted(curve.items())]
    for kname in rides: verify(rides[kname], eph, table, fwd)
    from kepler import propagate as kprop
    for kname, r in rides.items():
        dj, tof = r["dep_jd"], r["tof_days"]
        pe, ve = eph.helio(399, dj); ra = fwd.sol((dj + tof - J2000) * DAY)[:3]
        va1, _ = lambert(MU_SUN, pe, ra, tof * DAY)
        pts = [pe[:2]] + [kprop(MU_SUN, pe, np.array(va1), f * tof * DAY)[0][:2] for f in np.linspace(0.02, 1, 50)]
        r["arc_au"] = (np.array(pts) / AU_KM).round(5).tolist()
        r["dep_earth_au"] = (pe[:2] / AU_KM).round(5).tolist(); r["arr_roadster_au"] = (ra[:2] / AU_KM).round(5).tolist()
    out["runtime_s"] = time.time() - t_start
    json.dump(out, open(os.path.join(OUT, "teaser.json"), "w"), indent=1)
    o = {k: v for k, v in out.items() if not k.startswith("track") and k != "fare_curve"}
    print(json.dumps(o, indent=1)); print(out["fare_curve"][:5], out["fare_curve"][::20])

def verify(r, eph, table, fwd):
    """Full n-body (Sun, 8 planets, Moon) re-fly from a 200 km LEO departure hyperbola; Newton retarget."""
    dj, tof = r["dep_jd"], r["tof_days"]
    ta = (dj + tof - J2000) * DAY; tdep = (dj - J2000) * DAY
    pe, ve = eph.helio(399, dj)
    target = fwd.sol(ta)[:3]
    va1, va2 = lambert(MU_SUN, pe, target, tof * DAY)
    vinf0 = np.array(va1) - ve
    full = Model(table, PERTURBERS)
    def miss(vinf):
        ys, _ = hyperbola_start(pe, ve, vinf)
        s = propagate(full, tdep, ys, ta, rtol=1e-10)
        return s.y[:3, -1] - target
    m0 = miss(vinf0)
    x, d, hist = newton(miss, vinf0, h=1e-4, tol_km=1.0, max_iter=8)
    r["verify"] = {"raw_miss_km": float(np.linalg.norm(m0)), "final_miss_km": float(np.linalg.norm(d)),
                   "retarget_ms": float(np.linalg.norm(x - vinf0) * 1000), "iterations": len(hist) - 1,
                   "dv_dep_corrected_kms": dv_dep(float(x @ x))}

if __name__ == "__main__":
    main()
