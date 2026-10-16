"""SOL agent team: dispatcher -> engineer (tool loop) -> broker, then the provenance gate. Writes one receipt per ride.
Backends:  anthropic (needs ANTHROPIC_API_KEY)  |  xai (needs XAI_API_KEY, OpenAI-compatible; Grok as the driver persona)
           replay (no LLM: rebuilds receipts from recorded answers in day3/cases.json, re-running every tool call)
usage: run_team.py --backend replay | run_team.py --backend anthropic --request "Overnight shipping to Mars." """
import argparse, json, os, shlex, subprocess, sys, time, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "code")); sys.path.insert(0, HERE)
from provenance import check
import prompts
OUT = os.path.join(ROOT, "receipts"); os.makedirs(OUT, exist_ok=True)

def tool_args(name, inp):
    flags = []
    for k, v in inp.items():
        f = "--" + k.replace("_", "-")
        if v is True: flags.append(f)
        elif v not in (False, None): flags += [f, str(v)]
    return flags

def run_tool(name, inp=None, argstr=None):
    script = os.path.join(ROOT, "code", "quote.py" if name == "quote" else "trip.py")
    args = shlex.split(argstr) if argstr is not None else tool_args(name, inp)
    t = time.time(); o = subprocess.run([sys.executable, script] + args, capture_output=True, text=True, timeout=900)
    try: out = json.loads(o.stdout)
    except Exception: out = {"ok": False, "error": (o.stderr or "no output").strip().splitlines()[-1]}
    return {"tool": name, "args": " ".join(args), "seconds": round(time.time() - t, 1), "output": out}

# ---- LLM backends (live; not exercised in the build sandbox, which has no API key) ----
def post(url, headers, body):
    req = urllib.request.Request(url, json.dumps(body).encode(), {"content-type": "application/json", **headers})
    return json.loads(urllib.request.urlopen(req, timeout=300).read())

def anthropic_chat(system, messages, tools=None):
    body = {"model": os.environ.get("SOL_MODEL", "claude-sonnet-5-5"), "max_tokens": 2000, "system": system, "messages": messages}
    if tools: body["tools"] = tools
    r = post("https://api.anthropic.com/v1/messages", {"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"}, body)
    return r

def team_live(request, chat):
    rec = {"request": request, "roles": {}, "tool_calls": []}
    d = chat(prompts.DISPATCHER, [{"role": "user", "content": request}])
    rec["roles"]["dispatcher"] = disp = "".join(b.get("text", "") for b in d["content"])
    msgs = [{"role": "user", "content": f"Rider: {request}\nDispatcher intent: {disp}"}]
    for _ in range(8):  # engineer tool loop
        r = chat(prompts.ENGINEER, msgs, prompts.TOOLS)
        msgs.append({"role": "assistant", "content": r["content"]})
        uses = [b for b in r["content"] if b.get("type") == "tool_use"]
        if not uses: break
        results = []
        for u in uses:
            call = run_tool(u["name"], u["input"]); rec["tool_calls"].append(call)
            results.append({"type": "tool_result", "tool_use_id": u["id"], "content": json.dumps(call["output"])})
        msgs.append({"role": "user", "content": results})
    outs = json.dumps([c["output"] for c in rec["tool_calls"]])
    b = chat(prompts.BROKER, [{"role": "user", "content": f"Rider: {request}\nDispatcher: {disp}\nTool outputs: {outs}"}])
    rec["roles"]["broker"] = "".join(x.get("text", "") for x in b["content"])
    return rec

def finish(rec, earlier=()):
    outs = list(earlier) + [c["output"] for c in rec["tool_calls"]]  # a conversation may cite earlier turns
    ok, bad, struck = check(rec["roles"]["broker"], outs, rec["request"])
    rec["provenance"] = {"pass": ok, "untraced": bad}
    rec["rider_sees"] = struck  # untraced numbers are struck out before the rider sees them
    def refly_ok(o):
        if "refly" in o: return o["refly"]["pass"]
        legs = [l["refly"]["pass"] for l in o.get("legs", []) if "refly" in l]
        return all(legs) if legs else None   # None = not re-flown (no --verify)
    rec["physics"] = [{"args": c["args"], "refly_pass": refly_ok(c["output"])} for c in rec["tool_calls"]]
    return rec

def main():
    a = argparse.ArgumentParser(); a.add_argument("--backend", choices=["replay", "anthropic", "xai"], default="replay")
    a.add_argument("--request"); a.add_argument("--id", default="live"); a = a.parse_args()
    if a.backend == "replay":
        reqs = {r["id"]: r["request"] for r in json.load(open(os.path.join(ROOT, "day1", "requests.json")))}
        for c in json.load(open(os.path.join(ROOT, "day3", "cases.json"))):
            rec = {"id": c["id"], "request": reqs[c["id"]], "backend": "replay (recorded agent answer, tools re-run)",
                   "outcome": c["outcome"], "roles": {"broker": c["answer"]},
                   "tool_calls": [run_tool("quote", argstr=s) for s in c["commands"]]}
            rec = finish(rec)
            json.dump(rec, open(os.path.join(OUT, f"day1_{c['id']:02d}.json"), "w"), indent=1)
            print(f"#{c['id']:2d} {c['outcome']:8s} provenance {'PASS' if rec['provenance']['pass'] else 'FAIL'}  tools {len(rec['tool_calls'])}")
        return
    if a.backend == "xai":
        sys.exit("xai backend: set XAI_API_KEY; adapter to OpenAI-style tool calls is the day-4 TODO (sandbox cannot reach api.x.ai)")
    rec = finish(team_live(a.request, anthropic_chat)); rec["backend"] = "anthropic"
    json.dump(rec, open(os.path.join(OUT, f"{a.id}.json"), "w"), indent=1); print(rec["rider_sees"])

if __name__ == "__main__":
    main()
