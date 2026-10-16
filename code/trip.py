"""SOL trip planner: a pickup leg (driver -> rider) plus a ride (rider -> destination), with receipts.
First supported trip: stranded at Titan, ride home to Earth.
  driver 'fleet'    = SIMULATED fleet car parked in the rider's Titan orbit (labelled simulated)
  driver 'roadster' = the real Roadster from its JPL position (premium; honest ETA)
usage: trip.py --driver fleet|roadster [--objective energy|time] [--max-burn KMS] [--doge-usd X] [--verify]"""
import argparse, datetime as dt, json, math, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import skyfield_data
from ephem import AU_KM, DAY, MU_SUN, Ephemeris, iso_from_jd, jd_from_iso
from lambert_izzo import lambert
from kepler import propagate as kprop
import models

MU_SAT, R_TITAN_ORB = 3.7931187e7, 1221870.0
MU_TITAN, RP_TITAN = 8978.14, 2574.7 + 1500.0
MU_E, R_E = 398600.435, 6378.137
EPH = Ephemeris(os.path.join(os.path.dirname(skyfield_data.__file__), "data", "de421.bsp"))
STATES = json.load(open(os.path.join(HERE, "..", "data", "targets.json")))["targets"]

def titan_burn(vinf_saturn):
    """Burn from a 1,500 km Titan orbit to leave (or, reversed, to be captured from) Saturn with this v_inf."""
    v_need = math.sqrt(vinf_saturn**2 + 2*MU_SAT/R_TITAN_ORB)
    vinf_t = v_need - math.sqrt(MU_SAT/R_TITAN_ORB)
    return math.sqrt(vinf_t**2 + 2*MU_TITAN/RP_TITAN) - math.sqrt(MU_TITAN/RP_TITAN)

def state(name, jd):
    if name in STATES:
        S = STATES[name]
        r, v = kprop(MU_SUN, np.array(S["r_km"]), np.array(S["v_kms"]), (jd - S["jd_tdb"])*DAY)
        return np.array(r), np.array(v)
    return EPH.helio({"saturn": 6, "earth": 399}[name], jd)

def arc_au(r1, v1, tof_s, n=600):
    pts = [np.array(r1)] + [np.array(kprop(MU_SUN, r1, v1, t)[0]) for t in np.linspace(tof_s/n, tof_s, n)]
    return float(sum(np.linalg.norm(b - a) for a, b in zip(pts, pts[1:]))) / AU_KM

def search(src, dst, j0, j1, tmin, tmax, cost):
    best = None
    for d0 in np.arange(j0, j1, 5.0):
        p1, vb1 = state(src, d0)
        for tof in np.arange(tmin, tmax, 10.0):
            p2, vb2 = state(dst, d0 + tof)
            for M, low in ((0, True), (1, True), (1, False)):
                try: v1, v2 = lambert(MU_SUN, p1, p2, tof*DAY, M=M, lowpath=low)
                except Exception: continue
                vd, va = float(np.linalg.norm(np.array(v1) - vb1)), float(np.linalg.norm(np.array(v2) - vb2))
                k = cost(vd, va, tof, d0)
                if k is not None and (best is None or k < best[0]):
                    best = (k, float(d0), float(tof), vd, va, M, low, p1, np.array(v1))
    return best

def main():
    a = argparse.ArgumentParser()
    a.add_argument("--driver", choices=["fleet", "roadster"], default="fleet")
    a.add_argument("--objective", choices=["energy", "time"], default="energy")
    a.add_argument("--max-burn", type=float, default=15.0, help="max burn to leave Titan, km/s (time objective)")
    a.add_argument("--request-date", default="2026-10-16")
    a.add_argument("--doge-usd", type=float, help="DOGE price in USD at booking (no live feed here)")
    a.add_argument("--verify", action="store_true"); a = a.parse_args()
    now = jd_from_iso(a.request_date)
    legs = []
    if a.driver == "fleet":
        T = 2*math.pi*math.sqrt(RP_TITAN**3/MU_TITAN)/3600
        legs.append({"leg": "pickup", "driver": "fleet car (SIMULATED: parked in your Titan orbit)",
                     "eta_hours": round(T, 1), "note": "catches up within one orbit; phasing burn not modelled",
                     "au": 0.0, "dv_kms": 0.0})
        ride_from = now
    else:
        b = search("roadster", "saturn", now, now + 3*365.25, 1200, 4400, lambda vd, va, t, d0: vd + titan_burn(va) + 0.1*(d0 + t - now)/365.25)
        _, d0, tof, vd, va, M, low, p1, v1 = b
        leg = {"leg": "pickup", "driver": "the real Roadster (JPL Horizons -143205)", "depart": iso_from_jd(d0),
               "arrive_titan": iso_from_jd(d0 + tof), "tof_days": tof, "eta_days_from_request": round(d0 + tof - now),
               "dv_kms": round(vd + titan_burn(va), 3), "dv_roadster_kms": round(vd, 3), "dv_titan_capture_kms": round(titan_burn(va), 3),
               "au": round(arc_au(p1, v1, tof*DAY), 2), "revs": M}
        if a.verify:
            from refly import refly_leg
            leg["refly"] = refly_leg("roadster", "saturn", d0, tof, M, low)
        legs.append(leg); ride_from = d0 + tof
    if a.objective == "energy":
        cost = lambda vd, va, t, d0: titan_burn(vd) + 0.1*(d0 + t - ride_from)/365.25  # 0.1 km/s per year of delay
    else:
        cost = lambda vd, va, t, d0: d0 + t if titan_burn(vd) <= a.max_burn else None  # earliest arrival home
    b = search("saturn", "earth", ride_from, ride_from + 3*365.25, 300 if a.objective == "time" else 1200, 4400, cost)
    if b is None:
        print(json.dumps({"ok": False, "error": f"no ride home with a Titan departure burn <= {a.max_burn} km/s"})); return
    _, d0, tof, vd, va, M, low, p1, v1 = b
    ride = {"leg": "ride", "depart_titan": iso_from_jd(d0), "arrive_earth": iso_from_jd(d0 + tof), "tof_days": tof,
            "wait_at_titan_days": round(d0 - ride_from), "dv_kms": round(titan_burn(vd), 3), "vinf_saturn_kms": round(vd, 3),
            "vinf_earth_kms": round(va, 3), "earth_entry_kms": round(math.sqrt(va**2 + 2*MU_E/(R_E + 120)), 2),
            "au": round(arc_au(p1, v1, tof*DAY), 2), "revs": M}
    if a.verify:
        from refly import refly_leg
        ride["refly"] = refly_leg("saturn", "earth", d0, tof, M, low)
    legs.append(ride)
    total_dv = sum(l["dv_kms"] for l in legs)
    bat = models.battery(total_dv)
    door_days = d0 + tof - now
    rec = {"ok": all(l.get("refly", {"pass": True})["pass"] for l in legs), "trip": "Titan -> Earth", "driver": a.driver,
           "objective": a.objective, "request_date": a.request_date, "arrive_home": iso_from_jd(d0 + tof),
           "door_to_door_days": round(door_days), "door_to_door_years": round(door_days/365.25, 2),
           "au_travelled": round(sum(l["au"] for l in legs), 2), "battery": bat, "fare": models.fare(bat["energy_kwh"], door_days, a.doge_usd),
           "legs": legs, "assumptions": models.ASSUMPTIONS + ["Titan parking orbit 1,500 km up; burns in the best direction",
                                                             "energy objective trades 0.1 km/s of burn per year of delay (so it will not wait years to save a little)",
                                                             "Sun-centred legs start/end at Saturn's and Earth's centres (patched conic)"],
           "verified": a.verify}
    if a.verify and not rec["ok"]: rec["error"] = "a leg was rejected by the n-body checker"
    print(json.dumps(rec, indent=1))

main()
