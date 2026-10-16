"""Cached planner call for the day-6 model eval. Same CLI as code/quote.py; outputs are cached by the exact
argument string (the planner is deterministic), and every call is logged per model (env SOL_TAG)."""
import hashlib, json, os, shlex, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
cmd = " ".join(shlex.quote(a) for a in sys.argv[1:])
key = os.path.join(HERE, "cache", hashlib.sha1(cmd.encode()).hexdigest()[:16] + ".json")
t0 = time.time(); hit = os.path.exists(key)
if hit: out = json.load(open(key))["out"]
else:
    o = subprocess.run([sys.executable, os.path.join(HERE, "..", "code", "quote.py")] + sys.argv[1:], capture_output=True, text=True, timeout=900)
    out = json.loads(o.stdout) if o.returncode == 0 and o.stdout.strip() else {"crash": (o.stderr.strip().splitlines() or ["nonzero exit"])[-1]}
    tmp = key + f".{os.getpid()}.tmp"; json.dump({"cmd": cmd, "out": out}, open(tmp, "w"), indent=1); os.replace(tmp, key)
tag = os.environ.get("SOL_TAG", "untagged")
with open(os.path.join(HERE, f"calls_{tag}.jsonl"), "a") as f:
    f.write(json.dumps({"cmd": cmd, "cached": hit, "seconds": round(time.time() - t0, 1), "ok": out.get("ok"),
                        "refly_pass": (out.get("refly") or {}).get("pass")}) + "\n")
print(json.dumps(out, indent=1))
