"""n-body re-fly of the Saturn -> Earth ride home from spike.json. Starts at Saturn's barycentre with
the Lambert departure velocity (Saturn's own gravity off: patched-conic start, the escape burn is
priced separately) and aims at Earth's centre (Earth's gravity off on approach; Moon on). Newton-retargets
the departure v_inf. Same pass rule as the main gate: final miss < 1 km, retarget < 500 m/s."""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "code"))
import skyfield_data
from ephem import DAY, J2000, MU_SUN, Ephemeris, HermiteTable, jd_from_iso
from lambert_izzo import lambert
from nbody import Model, propagate, newton, PERTURBERS
eph = Ephemeris(os.path.join(os.path.dirname(skyfield_data.__file__), "data", "de421.bsp"))
h = json.load(open("spike.json"))["home"]
dep = jd_from_iso(h["depart"]); tof = h["tof_days"]; arr = dep + tof
ps, vs = eph.helio(6, dep); target = eph.helio(399, arr)[0]
best = None
for M, low in ((0, True), (1, True), (1, False)):
    try: v1, _ = lambert(MU_SUN, ps, target, tof*DAY, M=M, lowpath=low)
    except Exception: continue
    vi = np.linalg.norm(np.array(v1) - vs)
    if best is None or vi < best[0]: best = (vi, np.array(v1))
v0 = best[1]
table = HermiteTable(eph, PERTURBERS, dep - 2, arr + 5)
model = Model(table, [b for b in PERTURBERS if b not in (6, 399)])
t0, t1 = (dep - J2000)*DAY, (arr - J2000)*DAY
miss = lambda v: propagate(model, t0, np.concatenate((ps, v)), t1, rtol=1e-10).y[:3, -1] - target
m0 = miss(v0)
x, d, hist = newton(miss, v0, h=1e-4, tol_km=1.0, max_iter=20)
res = {"raw_miss_km": float(np.linalg.norm(m0)), "final_miss_km": float(np.linalg.norm(d)),
       "retarget_ms": float(np.linalg.norm(x - v0)*1000), "iterations": len(hist)-1,
       "vinf_saturn_corrected_kms": float(np.linalg.norm(x - vs))}
res["pass"] = res["final_miss_km"] < 1.0 and res["retarget_ms"] < 500
print(json.dumps(res, indent=1)); json.dump(res, open("refly_home.json", "w"), indent=1)
