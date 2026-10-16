"""Stress the n-body checker: re-fly a seeded sample of planner routes (Earth -> each target, assorted
departure dates, flight times and 0/1 revolutions) and record every rejection and why.
Pass = final miss < 1 km and departure retarget < 500 m/s (the same gate the app uses)."""
import json, os, sys, random, time, traceback
import numpy as np
from multiprocessing import Pool
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, "..", "code"))
TOF = {"mercury": (60, 300), "venus": (80, 400), "mars": (120, 600), "jupiter": (500, 2400), "saturn": (900, 3600),
       "uranus": (1800, 6000), "neptune": (2500, 7000), "roadster": (150, 1200), "bennu": (120, 900), "ceres": (300, 1600)}
def jobs():
    rnd = random.Random(20261016); out = []
    for dest, (lo, hi) in TOF.items():
        for i in range(6):
            M = 1 if (i == 5 and dest not in ("uranus", "neptune", "saturn", "jupiter")) else 0
            out.append({"dest": dest, "dep_off": rnd.randint(0, 730), "tof": float(rnd.randint(lo, hi)), "M": M})
    return out
def one(j):
    from ephem import jd_from_iso, iso_from_jd
    import refly
    dep = jd_from_iso("2026-10-16") + j["dep_off"]
    t0 = time.time(); r = dict(j, depart=iso_from_jd(dep))
    try:
        if dep + j["tof"] > 2471000.0: r.update(result="skipped", why="past the end of the DE421 ephemeris"); return r
        f = refly.refly(j["dest"], dep, j["tof"], j["M"], True)
        r.update(f); r["result"] = "PASS" if f["pass"] else "REJECTED"
        if not f["pass"]:
            r["why"] = ("did not converge: still %.1f km off after %d tries" % (f["final_miss_km"], f["iterations"])) if f["final_miss_km"] >= 1 else \
                       ("needed a %.0f m/s correction, over the 500 m/s limit" % f["retarget_ms"])
    except Exception as e:
        r.update(result="REJECTED", why="no route: " + (str(e).splitlines() or [type(e).__name__])[0][:120])
    r["seconds"] = round(time.time() - t0, 1); return r
if __name__ == "__main__":
    os.nice(10); J = jobs(); res = []
    with Pool(int(sys.argv[1]) if len(sys.argv) > 1 else 2) as p:
        for r in p.imap_unordered(one, J):
            res.append(r); print(r["dest"], r["depart"], r["tof"], r["M"], r["result"], r.get("why", ""), r["seconds"], flush=True)
            json.dump(sorted(res, key=lambda x: (x["dest"], x["depart"])), open(os.path.join(HERE, "sweep.json"), "w"), indent=1)
