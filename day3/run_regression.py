"""SOL regression suite (day 3). For each recorded case (rider request + agent answer + the planner
commands it cited) this checks three things and exits non-zero if any fails:
  1. planner drift: re-running every cited command reproduces its golden output;
  2. provenance: every number in the answer traces to those outputs or to the request;
  3. physics: a QUOTE must cite a --verify run that the n-body checker passed.
  --update      rewrite goldens from the current planner (after an intended planner change)
  --plant N     self-test: inject a made-up number into case N and expect the suite to go red"""
import hashlib, json, os, shlex, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "code"))
from provenance import check
QUOTE = os.path.join(HERE, "..", "code", "quote.py")
GOLD = os.path.join(HERE, "golden"); os.makedirs(GOLD, exist_ok=True)

def run(cmd):
    o = subprocess.run([sys.executable, QUOTE] + shlex.split(cmd), capture_output=True, text=True, timeout=900)
    if o.returncode: return {"crash": o.stderr.strip().splitlines()[-1] if o.stderr else "nonzero exit"}
    return json.loads(o.stdout)

def same(a, b, tol=1e-6):
    if isinstance(a, dict) and isinstance(b, dict): return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list): return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(a - b) <= tol * max(1.0, abs(b))
    return a == b

def main(argv):
    update = "--update" in argv
    plant = int(argv[argv.index("--plant") + 1]) if "--plant" in argv else None
    cases = json.load(open(os.path.join(HERE, "cases.json")))
    reqs = {r["id"]: r["request"] for r in json.load(open(os.path.join(HERE, "..", "day1", "requests.json")))}
    fails, rows = 0, []
    for c in cases:
        answer = c["answer"]
        if plant == c["id"]: answer += " Estimated fuel: 4.2 tonnes."  # the planted made-up number
        outs, why = [], []
        for cmd in c["commands"]:
            g = os.path.join(GOLD, hashlib.sha1(cmd.encode()).hexdigest()[:16] + ".json")
            out = run(cmd)
            if update or not os.path.exists(g): json.dump({"cmd": cmd, "out": out}, open(g, "w"), indent=1)
            elif not same(out, json.load(open(g))["out"]): why.append("planner drift on: " + cmd)
            if "crash" in out: why.append("planner crashed on: " + cmd)
            outs.append(out)
        ok, bad, struck = check(answer, outs, reqs.get(c["id"], ""))
        if not ok: why.append("untraced numbers " + ", ".join(bad) + " -> " + struck)
        if c["outcome"] == "QUOTE" and not any("--verify" in cmd and o.get("ok") and o.get("refly", {}).get("pass")
                                             for cmd, o in zip(c["commands"], outs)):
            why.append("QUOTE without a passing n-body re-fly")
        fails += bool(why)
        rows.append((c["id"], c["outcome"], "PASS" if not why else "FAIL", why))
    for i, o, s, w in rows:
        print(f"#{i:2d} {o:8s} {s}")
        for x in w: print("      " + x)
    print(f"{len(rows) - fails}/{len(rows)} cases pass")
    return 1 if fails else 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
