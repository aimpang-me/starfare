"""SOL planner tool: the ONLY source of numbers. Direct (0-rev Lambert) Earth->body scan.
usage: quote.py --dest mars --dep-from 2026-10-16 --dep-to 2026-12-25 [--arr-by D] [--arr-from D]
                [--max-c3 X] [--max-tof D] [--min-tof D] [--objective c3|tof|vinf_arr] [--weekend]
Prints one JSON object. Unsupported bodies return {"ok":false,"error":...}."""
import argparse, datetime as dt, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import skyfield_data
from kepler import propagate as kprop
from ephem import DAY, MU_SUN, Ephemeris, iso_from_jd, jd_from_iso
from lambert_izzo import lambert
# default max TOF (days): ~2x Hohmann time per body, so the optimum is interior
TOFMAX = {"mercury":300,"venus":400,"roadster":1500,"bennu":1000,"ceres":1800,"mars":700,"jupiter":2600,"saturn":4800,"uranus":9000,"neptune":13000}
EPH_END = 2471000.0  # ~2053-09 (DE421 ends 2053-10-09)
BODY = {"mercury":199,"venus":299,"roadster":0,"bennu":0,"ceres":0,"mars":499,"jupiter":5,"saturn":6,"uranus":7,"neptune":8}
STATES = json.load(open(os.path.join(HERE, "..", "data", "targets.json")))["targets"]
def state(eph, d, jd):
    if d in STATES:  # 2-body from the Horizons epoch; the n-body re-fly corrects this
        S = STATES[d]
        r, v = kprop(MU_SUN, np.array(S["r_km"]), np.array(S["v_kms"]), (jd - S["jd_tdb"]) * DAY)
        return np.array(r), np.array(v)
    return eph.helio(BODY[d], jd)
ASSUME = ["starts from a 200 km circular parking orbit (launch to LEO not priced)",
          "impulsive burns, no thrust limits or g-load model",
          "launchable means C3 <= 100 km2/s2: a placeholder, not a specific rocket",
          "arrives at the target's centre: no capture burn, landing or orbit insertion priced"]
def moon_quote(a):
    from moon import tli
    eph = Ephemeris(os.path.join(os.path.dirname(skyfield_data.__file__), "data", "de421.bsp"))
    j0, j1 = jd_from_iso(a.dep_from), jd_from_iso(a.dep_to)
    best = None
    for d0 in np.arange(j0, j1 + 0.01, 0.25):
        if a.weekend and (dt.datetime(2000,1,1,12)+dt.timedelta(days=float(d0)-2451545.0)).weekday() < 5: continue
        for tof in np.arange(max(1.5, a.min_tof if a.min_tof != 20 else 1.5), (a.max_tof or 6.0) + 0.01, 0.25):
            try: q = tli(eph, d0, tof)
            except Exception: continue
            key = {"c3": q["dv_tli_kms"], "tof": tof, "vinf_arr": q["dv_tli_kms"]}[a.objective]
            if best is None or key < best[0]: best = (key, d0, tof, q)
    if best is None:
        print(json.dumps({"ok": False, "error": "no Moon transfer found"})); return
    _, d0, tof, q = best
    out = {"ok": True, "dest": "moon", "depart": iso_from_jd(d0, True), "arrive": iso_from_jd(d0 + tof, True), "tof_days": float(tof),
           "c3_km2s2": round(q["c3_km2s2"], 3), "dv_tli_kms": round(q["dv_tli_kms"], 3), "launchable": True, "dep_jd": float(d0),
           "model": "geocentric Lambert from 200 km LEO, Earth two-body, unchecked"}
    if a.verify:
        from refly import refly_moon
        out["refly"] = refly_moon(float(d0), float(tof)); out["ok"] = out["refly"]["pass"]
        out["model"] = "geocentric Lambert from 200 km LEO, n-body re-flown"
        if not out["ok"]: out["error"] = "quote rejected by n-body checker"
    out["assumptions"] = ASSUME
    print(json.dumps(out))

def main():
    a = argparse.ArgumentParser()
    a.add_argument("--dest", required=True); a.add_argument("--dep-from", required=True); a.add_argument("--dep-to", required=True)
    a.add_argument("--arr-from"); a.add_argument("--arr-by"); a.add_argument("--max-c3", type=float); a.add_argument("--max-tof", type=float)
    a.add_argument("--min-tof", type=float, default=20); a.add_argument("--objective", default="c3", choices=["c3","tof","vinf_arr"])
    a.add_argument("--weekend", action="store_true"); a.add_argument("--verify", action="store_true"); a.add_argument("--revs", type=int, default=1); a = a.parse_args()
    d = a.dest.lower()
    if d == "moon":
        return moon_quote(a)
    if d not in BODY:
        print(json.dumps({"ok":False,"error":f"destination '{a.dest}' not supported by planner (supported: {sorted(BODY)})"})); return
    eph = Ephemeris(os.path.join(os.path.dirname(skyfield_data.__file__), "data", "de421.bsp"))
    j0, j1 = jd_from_iso(a.dep_from), jd_from_iso(a.dep_to)
    step = max(1.0, (j1 - j0) / 120)
    best = None; n = 0
    for d0 in np.arange(j0, j1 + 0.01, step):
        if a.weekend and (dt.datetime(2000,1,1,12)+dt.timedelta(days=float(d0)-2451545.0)).weekday() < 5: continue
        pE, vE = eph.helio(399, d0)
        tmax = a.max_tof or TOFMAX[d]
        for tof in np.arange(a.min_tof, tmax + 0.1, max(2.0, tmax/200)):
            arr = d0 + tof
            if arr > EPH_END: continue  # DE421 coverage ends 2053-10-09
            if a.arr_by and arr > jd_from_iso(a.arr_by): continue
            if a.arr_from and arr < jd_from_iso(a.arr_from): continue
            pB, vB = state(eph, d, arr)
            for M, low in ((0, True),) + (((1, True), (1, False)) if a.revs >= 1 else ()):
                try: v1, v2, inf = lambert(MU_SUN, pE, pB, tof*DAY, M=M, lowpath=low, return_info=True)
                except Exception: continue
                if abs(inf["transfer_angle_deg"]-180) < 1: continue
                c3 = float(np.sum((np.array(v1)-vE)**2)); va = float(np.linalg.norm(np.array(v2)-vB))
                if a.max_c3 is not None and c3 > a.max_c3: continue
                n += 1
                key = {"c3":c3,"tof":tof,"vinf_arr":va}[a.objective]
                if best is None or key < best[0]: best = (key, d0, tof, c3, va, M, low)
    if best is None:
        print(json.dumps({"ok":False,"error":"no feasible direct transfer under these constraints","solves_feasible":0,"scanned":f"{a.dep_from}..{a.dep_to}, TOF {a.min_tof}-{a.max_tof or TOFMAX[d]} d"})); return
    _, d0, tof, c3, va, M, low = best
    out = ({"ok":True,"dest":d,"depart":iso_from_jd(d0),"arrive":iso_from_jd(d0+tof),"tof_days":round(float(tof),1),
        "c3_km2s2":round(c3,2),"vinf_arrival_kms":round(va,2),"launchable":c3<=100,"at_search_edge":bool(tof>=(a.max_tof or TOFMAX[d])-1e-6*0+ -2*max(2.0,(a.max_tof or TOFMAX[d])/200) or d0<=j0+1e-9 or d0>=j1-step),"feasible_solves":n,"dep_jd":float(d0),"revs":int(M),"lowpath":bool(low),"model":"Lambert 0-1 rev, DE421, unchecked (no n-body yet)"})
    if a.verify:
        from refly import refly
        out["refly"] = refly(d, float(d0), float(tof), M=int(M), lowpath=bool(low)); out["model"] = "Lambert 0-1 rev, DE421, n-body re-flown"
        out["ok"] = out["refly"]["pass"]
        if not out["ok"]: out["error"] = "quote rejected by n-body checker"
    out["assumptions"] = ASSUME
    print(json.dumps(out))
main()
