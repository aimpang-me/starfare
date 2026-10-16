"""Re-fly the two long legs the checker rejected at rtol 1e-10 (day-2 Uranus, day-6 sweep Neptune) at rtol 1e-12."""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, "..", "code"))
import refly
from ephem import jd_from_iso
u = json.load(open(os.path.join(HERE, "..", "day2", "q_uranus.json")))
legs = [("uranus (day 2)", "uranus", u["dep_jd"], u["tof_days"], 0), ("neptune (day-6 sweep)", "neptune", jd_from_iso("2026-10-16") + 64, 7000.0, 0)]
out = []
for name, dest, dep, tof, M in legs:
    t = time.time(); f = refly.refly(dest, dep, tof, M, True); f["seconds"] = round(time.time() - t, 1); f["leg"] = name; f["rtol"] = refly.RTOL
    out.append(f); print(name, json.dumps({k: f[k] for k in ("pass", "raw_miss_km", "final_miss_km", "retarget_ms", "iterations", "seconds")}), flush=True)
json.dump(out, open(os.path.join(HERE, "rerun_rejections.json"), "w"), indent=1)
