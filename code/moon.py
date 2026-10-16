"""Earth -> Moon: geocentric Lambert from a 200 km circular LEO (point chosen 175 deg behind the Moon's
arrival position, in the Moon's orbital plane, to avoid the degenerate 180 deg transfer) to the Moon's
centre. Two-body Earth only; the n-body re-fly (Sun, planets, Moon gravity off on approach) checks it."""
import math, numpy as np
from ephem import DAY, GM, R_EARTH
from lambert_izzo import lambert
MU_E, RP = GM[399], R_EARTH + 200.0
VC = math.sqrt(MU_E / RP)

def geo_moon(eph, jd):
    pm, vm = eph.helio(301, jd); pe, ve = eph.helio(399, jd)
    return pm - pe, vm - ve

def tli(eph, dep_jd, tof_days):
    rm, vm = geo_moon(eph, dep_jd + tof_days)
    h = np.cross(rm, vm); n = h / np.linalg.norm(h); u = rm / np.linalg.norm(rm)
    a = math.radians(175.0)  # LEO point 175 deg before the arrival point, prograde
    r1 = RP * (math.cos(a) * u - math.sin(a) * np.cross(n, u))
    v1, _ = lambert(MU_E, r1, rm, tof_days * DAY)
    v1 = np.array(v1)
    vcirc = VC * np.cross(n, r1 / RP)
    return {"r1": r1, "v1": v1, "dv_tli_kms": float(np.linalg.norm(v1 - vcirc)),
            "c3_km2s2": float(v1 @ v1 - 2 * MU_E / RP)}
