"""Re-run each agent-arm command; every number the agent quoted must appear in some tool output (or be a request constant)."""
import json, subprocess, shlex, re
rows = json.load(open("agent_arm.json")); bad = []
for r in rows:
    blob = ""
    for c in r["cmds"]:
        o = subprocess.run(["python3", "../code/quote.py"] + shlex.split(c), capture_output=True, text=True, timeout=300)
        blob += o.stdout + o.stderr
    toks = set(re.findall(r"[\d][\d\-.]*", blob))
    def seen(n):
        if n in toks or n in blob: return True
        try: f = float(n)
        except ValueError: return False
        return any(abs(float(t) - f) < 0.051 for t in toks if re.fullmatch(r"\d+(\.\d+)?", t))
    miss = [n for n in r["nums"] if not seen(n)]
    cmdnums = " ".join(r["cmds"])
    miss = [n for n in miss if n not in cmdnums]
    print(r["id"], r["outcome"], "UNTRACED:" + str(miss) if miss else "ok")
    if miss: bad.append(r["id"])
print("untraced ids:", bad)
