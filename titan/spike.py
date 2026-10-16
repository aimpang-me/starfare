"""Spike: 'Stranded at Titan' numbers. Saturn->Earth ride home, Roadster pickup leg, Titan/Saturn escape,
Earth entry speed, and the stated battery + fare models. Heliocentric legs use Saturn's barycentre
(Titan's 1.2 million km offset is tiny at this scale); the n-body re-fly is not run here."""
import json, math, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "code"))
import skyfield_data
from ephem import DAY, MU_SUN, Ephemeris, iso_from_jd, jd_from_iso, AU_KM
from lambert_izzo import lambert
from kepler import propagate as kprop
eph = Ephemeris(os.path.join(os.path.dirname(skyfield_data.__file__), "data", "de421.bsp"))
MU_SAT, R_TITAN_ORB = 3.7931187e7, 1221870.0   # Saturn GM; Titan orbit radius (km)
MU_TITAN, R_TITAN = 8978.14, 2574.7
RP_TITAN = R_TITAN + 1500.0                      # parking orbit above Titan's thick atmosphere
MU_E, R_E = 398600.435, 6378.137

def leave_titan(vinf_saturn):
    v_need = math.sqrt(vinf_saturn**2 + 2*MU_SAT/R_TITAN_ORB)       # Saturn-relative speed needed at Titan's orbit
    vinf_titan = v_need - math.sqrt(MU_SAT/R_TITAN_ORB)              # best case: burn along Titan's motion
    return math.sqrt(vinf_titan**2 + 2*MU_TITAN/RP_TITAN) - math.sqrt(MU_TITAN/RP_TITAN)

def path_len(r1, v1, tof_s, n=2000):
    pts = [np.array(r1)] + [np.array(kprop(MU_SUN, r1, v1, t)[0]) for t in np.linspace(tof_s/n, tof_s, n)]
    return float(sum(np.linalg.norm(b-a) for a, b in zip(pts, pts[1:])))

def best_leg(src, dst, d_from, d_to, tmin, tmax, objective):
    best = None
    for d0 in np.arange(jd_from_iso(d_from), jd_from_iso(d_to), 10.0):
        p1, v1b = src(d0)
        for tof in np.arange(tmin, tmax, 20.0):
            p2, v2b = dst(d0 + tof)
            for M, low in ((0, True), (1, True), (1, False)):
                try: v1, v2 = lambert(MU_SUN, p1, p2, tof*DAY, M=M, lowpath=low)
                except Exception: continue
                vd = float(np.linalg.norm(np.array(v1)-v1b)); va = float(np.linalg.norm(np.array(v2)-v2b))
                k = objective(vd, va, tof)
                if best is None or k < best[0]: best = (k, d0, tof, vd, va, p1, np.array(v1))
    return best

saturn = lambda jd: eph.helio(6, jd)
earth = lambda jd: eph.helio(399, jd)
S = json.load(open("../data/targets.json"))["targets"]["roadster"]
roadster = lambda jd: tuple(np.array(x) for x in kprop(MU_SUN, np.array(S["r_km"]), np.array(S["v_kms"]), (jd - S["jd_tdb"])*DAY))

out = {}
# ride home: Saturn -> Earth, minimise total burn (leave Titan) with Earth entry speed reported
home = best_leg(saturn, earth, "2026-10-16", "2029-10-16", 1200, 4400, lambda vd, va, t: leave_titan(vd))
k, d0, tof, vd, va, p1, v1 = home
out["home"] = {"depart": iso_from_jd(d0), "arrive": iso_from_jd(d0+tof), "tof_days": tof, "tof_years": tof/365.25,
               "vinf_saturn_kms": vd, "dv_leave_titan_kms": leave_titan(vd), "vinf_earth_kms": va,
               "entry_speed_kms": math.sqrt(va**2 + 2*MU_E/(R_E+120)), "au_travelled": path_len(p1, v1, tof*DAY)/AU_KM}
# fast ride home: minimise time with leave-Titan burn <= 15 km/s
fast = best_leg(saturn, earth, "2026-10-16", "2028-10-16", 300, 2000, lambda vd, va, t: t if leave_titan(vd) <= 15 else 1e9)
k, d0, tof, vd, va, p1, v1 = fast
out["home_fast"] = {"depart": iso_from_jd(d0), "tof_days": tof, "dv_leave_titan_kms": leave_titan(vd), "vinf_earth_kms": va,
                    "entry_speed_kms": math.sqrt(va**2 + 2*MU_E/(R_E+120)), "au_travelled": path_len(p1, v1, tof*DAY)/AU_KM}
# premium pickup: real Roadster -> Saturn, minimise departure + arrival burns
pick = best_leg(roadster, saturn, "2026-10-16", "2029-10-16", 1200, 4400, lambda vd, va, t: vd + leave_titan(va))
k, d0, tof, vd, va, p1, v1 = pick
out["roadster_pickup"] = {"depart": iso_from_jd(d0), "arrive": iso_from_jd(d0+tof), "tof_days": tof, "tof_years": tof/365.25,
                          "dv_roadster_kms": vd, "dv_capture_at_titan_kms": leave_titan(va), "au_travelled": path_len(p1, v1, tof*DAY)/AU_KM}
# stated battery model: ideal electric thruster, exhaust 30 km/s, 60% efficient, car 1,300 kg dry, 200 kWh pack
def battery(dv_kms, m_dry=1300.0, ve=30.0, eff=0.6, pack=200.0):
    m_prop = m_dry*(math.exp(dv_kms/ve) - 1)
    kwh = 0.5*m_prop*(ve*1000)**2/eff/3.6e6
    return {"propellant_kg": m_prop, "energy_kwh": kwh, "packs": kwh/pack}
dv_home = out["home"]["dv_leave_titan_kms"]
out["battery_home"] = battery(dv_home)
out["battery_premium_total"] = battery(out["roadster_pickup"]["dv_roadster_kms"] + out["roadster_pickup"]["dv_capture_at_titan_kms"] + dv_home)
# stated fare model: electricity at $0.16/kWh + a ride-hail time fee of $0.35/min
fare = lambda kwh, days: kwh*0.16 + days*1440*0.35
out["fare_home_usd"] = fare(out["battery_home"]["energy_kwh"], out["home"]["tof_days"])
json.dump(out, open("spike.json", "w"), indent=1)
print(json.dumps(out, indent=1))
