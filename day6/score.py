"""Score the day-6 model eval with the same gates the app uses, and build the rejected wall.
Per model: provenance (numbers no tool made are struck), physics (an offered ride must cite a --verify run
the n-body checker passed), cited calls that were never run, and routes the checker rejected."""
import hashlib, json, os, shlex, sys, glob
HERE = os.path.dirname(os.path.abspath(__file__)); SOL = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(SOL, "code"))
from provenance import check
CLASS = {t["id"]: t["class"] for t in json.load(open(os.path.join(SOL, "day1", "truth.json")))}
REQ = {r["id"]: r["request"] for r in json.load(open(os.path.join(SOL, "day1", "requests.json")))}
NAMES = {"haiku": "Claude Haiku", "sonnet": "Claude Sonnet", "opus": "Claude Opus", "fable": "Claude Fable", "day3": "Recorded team (day 3)"}

def cached(cmd):
    key = " ".join(shlex.quote(a) for a in shlex.split(cmd))
    for k in (key, cmd):
        p = os.path.join(HERE, "cache", hashlib.sha1(k.encode()).hexdigest()[:16] + ".json")
        if os.path.exists(p): return json.load(open(p))["out"]
    return None

def score(tag, cases):
    rows, wall = [], []
    for c in cases:
        outs, why = [], []
        for cmd in c.get("commands", []):
            o = cached(cmd)
            if o is None: why.append(("never-ran", "cited a planner call it never made: " + cmd)); continue
            outs.append((cmd, o))
        ok, bad, struck = check(c["answer"], [o for _, o in outs], REQ.get(c["id"], ""))
        if not ok: why.append(("untraced", "numbers no tool made: " + ", ".join(bad)))
        offered = c["outcome"] in ("QUOTE", "COUNTER")
        verified = any("--verify" in cmd and o.get("ok") and (o.get("refly") or {}).get("pass") for cmd, o in outs)
        if offered and not verified: why.append(("no-refly", "offered a ride without a passing n-body re-fly"))
        rows.append({"id": c["id"], "outcome": c["outcome"], "pass": not why, "why": [w for _, w in why], "kinds": [k for k, _ in why]})
        if why: wall.append({"model": tag, "id": c["id"], "request": REQ.get(c["id"], ""), "outcome": c["outcome"],
                              "answer": c["answer"], "struck": struck, "why": [w for _, w in why], "kinds": [k for k, _ in why]})
    calls = []
    p = os.path.join(HERE, f"calls_{tag}.jsonl")
    if os.path.exists(p): calls = [json.loads(l) for l in open(p) if l.strip()]
    rej = [x for x in calls if "--verify" in x["cmd"] and x.get("refly_pass") is False]
    for x in rej:
        o = cached(x["cmd"]) or {}; r = o.get("refly") or {}
        what = (f"{o.get('dest', '').capitalize()} route, leave {o.get('depart')}, {o.get('tof_days')} days, {'one extra lap around the Sun, ' if o.get('revs') else ''}C3 {o.get('c3_km2s2')}: "
                f"the planner's route missed by {r.get('raw_miss_km'):,.0f} km; fixing it took a {r.get('retarget_ms')} m/s correction, over the 500 m/s limit") if r.get("final_miss_km", 99) < 1 else \
               f"still {r.get('final_miss_km')} km off after {r.get('iterations')} tries"
        wall.append({"model": tag, "kind": "checker", "cmd": "q.py " + x["cmd"], "why": ["the n-body checker rejected it. " + what], "refly": r})
    n = len(rows); outc = {}
    for r in rows: outc[r["outcome"]] = outc.get(r["outcome"], 0) + 1
    return {"tag": tag, "name": NAMES.get(tag, tag), "cases": n, "passed": sum(r["pass"] for r in rows),
            "untraced": sum("untraced" in r["kinds"] for r in rows), "no_refly": sum("no-refly" in r["kinds"] for r in rows),
            "never_ran": sum("never-ran" in r["kinds"] for r in rows), "outcomes": outc, "planner_calls": len(calls),
            "checker_rejected": len(rej), "rows": rows,
            "rides_offered": sum(r["pass"] and r["outcome"] in ("QUOTE", "COUNTER") for r in rows),
            "asked_on_complete": sum(r["outcome"] == "ASK" and CLASS.get(r["id"]) == "D" for r in rows)}, wall

def main():
    models, wall = [], []
    sets = [(os.path.basename(f)[6:-5], json.load(open(f))) for f in sorted(glob.glob(os.path.join(HERE, "cases_*.json")))]
    sets.append(("day3", json.load(open(os.path.join(SOL, "day3", "cases.json")))))
    for tag, cases in sets:
        m, w = score(tag, cases); models.append(m); wall += w
    models.sort(key=lambda m: (m["tag"] == "day3", -m["rides_offered"], m["name"]))
    # The day-2 Uranus quote was rejected at the old checker precision (rtol 1e-10, 12.5 km off). The 2026-10-16 audit
    # re-flew it at rtol 1e-12 and it passes, so it is reported as overturned, not on the rejected wall.
    u = json.load(open(os.path.join(SOL, "day2", "q_uranus.json")))
    ar = {r["leg"]: r for r in json.load(open(os.path.join(SOL, "audit", "rerun_rejections.json")))}
    audit = {"uranus_day2": {"depart": u["depart"], "tof_days": u["tof_days"], "before": u["refly"], "after": ar["uranus (day 2)"]},
             "neptune_sweep_before": next((r for r in json.load(open(os.path.join(HERE, "sweep_rtol10.json"))) if r["dest"] == "neptune" and r["result"] == "REJECTED"), None)
                                     if os.path.exists(os.path.join(HERE, "sweep_rtol10.json")) else None}
    sweep = json.load(open(os.path.join(HERE, "sweep.json"))) if os.path.exists(os.path.join(HERE, "sweep.json")) else []
    for r in sweep:
        if r["result"] == "REJECTED" and r.get("raw_miss_km") is not None:
            wall.append({"model": "planner", "kind": "checker", "cmd": f"stress sweep: Earth to {r['dest'].capitalize()}, leave {r['depart']}, {r['tof']:.0f} days",
                         "why": ["the n-body checker rejected it: " + r["why"] + " (pass needs under 1 km)"]})
    json.dump({"models": models, "wall": wall, "sweep": sweep, "audit": audit}, open(os.path.join(HERE, "eval.json"), "w"), indent=1)
    for m in models:
        print(f"{m['name']:24s} pass {m['passed']}/{m['cases']}  untraced {m['untraced']}  no-refly {m['no_refly']}  never-ran {m['never_ran']}  calls {m['planner_calls']}  checker-rejected {m['checker_rejected']}  rides {m['rides_offered']}  asked-on-complete {m['asked_on_complete']}  {m['outcomes']}")
main()
