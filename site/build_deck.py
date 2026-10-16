"""Build the ticket deck for the SHIP/HOLD dispatch-desk game from recorded, verified data.
Real tickets: the four models' day-6 answers (with the planner outputs they cite), the day-3 planted-number
test, the n-body checker's rejected routes and a sample of its passing routes.
Mutants: real passing answers with ONE number changed, checked by the real provenance gate; every mutant
is labelled MUTANT (a test fixture) when it is revealed."""
import hashlib, json, os, random, re, shlex, sys
HERE = os.path.dirname(os.path.abspath(__file__)); SOL = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(SOL, "code"))
import provenance
REQ = {r["id"]: r["request"] for r in json.load(open(os.path.join(SOL, "day1", "requests.json")))}
NAME = {"opus": "Claude Opus", "fable": "Claude Fable", "sonnet": "Claude Sonnet", "haiku": "Claude Haiku"}

def cached(cmd):
    key = " ".join(shlex.quote(a) for a in shlex.split(cmd))
    for k in (key, cmd):
        p = os.path.join(SOL, "day6", "cache", hashlib.sha1(k.encode()).hexdigest()[:16] + ".json")
        if os.path.exists(p): return json.load(open(p))["out"]
    return None

def panel(o):
    """What the player sees from a planner output: everything the gate traced against, minus the pass/fail verdict."""
    hide = {"ok", "pass", "dep_jd"}
    p = {k: v for k, v in o.items() if k not in hide}
    if isinstance(o.get("refly"), dict): p["refly"] = {k: v for k, v in o["refly"].items() if k not in hide}
    return p

def verdict(case, outs):
    ok, bad, struck = provenance.check(case["answer"], outs, REQ.get(case["id"], ""))
    offered = case["outcome"] in ("QUOTE", "COUNTER")
    verified = any((o.get("refly") or {}).get("pass") and o.get("ok") for o in outs)
    why = []
    if not ok: why.append("numbers no tool made: " + ", ".join(bad))
    if offered and not verified: why.append("offers a ride without a passing re-fly")
    return why, bad, struck

tickets, clean_answers = [], []
for m in ("opus", "fable", "sonnet", "haiku"):
    for c in json.load(open(os.path.join(SOL, "day6", f"cases_{m}.json"))):
        outs = [cached(x) for x in c["commands"]]
        if any(o is None for o in outs): continue
        why, bad, struck = verdict(c, outs)
        t = {"kind": "answer", "src": "real", "model": NAME[m], "rid": c["id"], "request": REQ[c["id"]], "outcome": c["outcome"],
             "answer": c["answer"], "tools": [{"cmd": "quote " + x, "out": panel(o)} for x, o in zip(c["commands"], outs)],
             "truth": "HOLD" if why else "SHIP", "why": why, "bad": bad, "struck": struck}
        tickets.append(t)
        if not why and c["outcome"] in ("QUOTE", "COUNTER") and outs: clean_answers.append((t, outs, c))

# mutants: one traced number changed, confirmed struck by the real gate
rnd = random.Random(20261016); mutants = []
for t, outs, c in rnd.sample(clean_answers, len(clean_answers)):
    toks = [(s, e, tok) for s, e, tok in provenance.tokens(c["answer"]) if not re.fullmatch(provenance.DATE, tok) and "." in tok and not provenance.LABEL.search(c["answer"][max(0, s - 8):s])]
    if not toks: continue
    s, e, tok = rnd.choice(toks)
    whole, frac = tok.split(".")
    digits = list(whole.replace(",", ""))
    i = rnd.randrange(len(digits)); digits[i] = str((int(digits[i]) + rnd.choice([1, 2, 3, 7])) % 10)
    if digits[0] == "0" and len(digits) > 1: continue
    new = "".join(digits) + "." + frac
    ans = c["answer"][:s] + new + c["answer"][e:]
    ok, bad, struck = provenance.check(ans, outs, REQ.get(c["id"], ""))
    if ok or new not in bad: continue
    mutants.append(dict(t, src="mutant", answer=ans, truth="HOLD", why=[f"MUTANT (test fixture): the real answer said {tok}; this copy says {new}, which no tool printed"], bad=bad, struck=struck, was=tok))
    if len(mutants) >= 14: break
tickets += mutants

# the day-3 planted-number test
d3 = json.load(open(os.path.join(SOL, "day3", "cases.json")))
c = [x for x in d3 if x["id"] == 2][0]
gold = os.path.join(SOL, "day3", "golden")
outs = []
for cmd in c["commands"]:
    g = os.path.join(gold, hashlib.sha1(cmd.encode()).hexdigest()[:16] + ".json"); outs.append(json.load(open(g))["out"])
ans = c["answer"] + " Estimated fuel: 4.2 tonnes."
ok, bad, struck = provenance.check(ans, outs, REQ[2])
tickets.append({"kind": "answer", "src": "planted", "model": "Recorded team (day 3)", "rid": 2, "request": REQ[2], "outcome": c["outcome"], "answer": ans,
                "tools": [{"cmd": "quote " + x, "out": panel(o)} for x, o in zip(c["commands"], outs)], "truth": "HOLD",
                "why": ["PLANTED (the day-3 self-test): 'Estimated fuel: 4.2 tonnes' was added on purpose; no tool made 4.2"], "bad": bad, "struck": struck})

# route tickets: the checker's rejections and a sample of its passes
seen = set()
for m in ("sonnet", "fable"):
    for l in open(os.path.join(SOL, "day6", f"calls_{m}.jsonl")):
        x = json.loads(l)
        if "--verify" in x["cmd"] and x.get("refly_pass") is False:
            o = cached(x["cmd"]); key = (o["dest"], o["depart"][:7])
            if key in seen: continue
            seen.add(key)
            tickets.append({"kind": "route", "src": "real", "model": "Claude Sonnet and Claude Fable both asked for this", "route": panel(o), "truth": "HOLD",
                            "why": [f"the correction was {o['refly']['retarget_ms']} m/s, over the 500 m/s limit: the planner's route was too far from real physics, even though the final miss looks perfect"]})
u = json.load(open(os.path.join(SOL, "day2", "q_uranus.json")))
# Rejected on day 2 at the old checker precision; the 2026-10-16 audit re-flew it at rtol 1e-12 and it passes (audit/rerun_rejections.json).
ua = next(r for r in json.load(open(os.path.join(SOL, "audit", "rerun_rejections.json"))) if r["leg"] == "uranus (day 2)")
u2 = {k: v for k, v in u.items() if k != "error"}
u2["refly"] = {k: v for k, v in ua.items() if k not in ("seconds", "leg", "rtol")}
tickets.append({"kind": "route", "src": "real", "model": "Planner, day 2", "route": panel(u2), "truth": "SHIP",
                "why": [f"ends {ua['final_miss_km']} km off, under the 1 km bar. The first check rejected this route at {u['refly']['final_miss_km']} km, but an audit found the checker itself was too imprecise over 23 years; at tighter precision it passes"]})
sweep = json.load(open(os.path.join(SOL, "day6", "sweep.json")))
for r in sweep:
    if r["result"] == "REJECTED" and r.get("raw_miss_km") is not None:
        tickets.append({"kind": "route", "src": "real", "model": "Checker stress sweep", "route": {"dest": r["dest"], "depart": r["depart"], "tof_days": r["tof"],
                        "refly": {k: r[k] for k in ("raw_miss_km", "final_miss_km", "retarget_ms", "iterations")}}, "truth": "HOLD", "why": [r["why"] + "; a pass needs under 1 km"]})
for r in rnd.sample([r for r in sweep if r["result"] == "PASS"], 8):
    tickets.append({"kind": "route", "src": "real", "model": "Checker stress sweep", "route": {"dest": r["dest"], "depart": r["depart"], "tof_days": r["tof"],
                    "refly": {k: r[k] for k in ("raw_miss_km", "final_miss_km", "retarget_ms", "iterations")}}, "truth": "SHIP", "why": []})


def where(tok, tools, request):
    """Where the gate's matching rule finds a token: a field path in a tool output, the request, or None."""
    def walk(x, path):
        if isinstance(x, bool): return
        if isinstance(x, (int, float, str)):
            nums, strs = [], []; provenance._flatten(x, nums, strs)
            if provenance.traced(tok, nums, json.dumps(x)): yield path
            return
        for k, v in (x.items() if isinstance(x, dict) else enumerate(x)): yield from walk(v, path + [str(k)])
    for i, t in enumerate(tools):
        for path in walk(t["out"], []): return (f"tool {i + 1}: " if len(tools) > 1 else "") + ".".join(path)
    nums, strs = [], []; provenance._flatten(request, nums, strs)
    if provenance.traced(tok, nums, request): return "the rider's request"
    return None

for t in tickets:
    if t["kind"] == "answer":
        t["toks"] = [[s, e, where(tok, t["tools"], t["request"])] for s, e, tok in provenance.tokens(t["answer"]) if not provenance.LABEL.search(t["answer"][max(0, s - 8):s])]
        t.pop("struck", None)
for i, t in enumerate(tickets): t["n"] = i
json.dump(tickets, open(os.path.join(HERE, "deck.json"), "w"), separators=(",", ":"))
from collections import Counter
print(len(tickets), Counter((t["kind"], t["src"], t["truth"]) for t in tickets), os.path.getsize(os.path.join(HERE, "deck.json")))
for m in mutants[:4]: print(m["was"], "->", m["bad"], "|", m["answer"][:120])
