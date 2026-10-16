import json, os
H = os.path.dirname(os.path.abspath(__file__))
t = open(os.path.join(H, "template.html")).read()
d = open(os.path.join(H, "sol_data.json")).read()
e = json.load(open(os.path.join(H, "..", "day6", "eval.json")))
for m in e["models"]: m.pop("rows", None)
e["lead"] = open(os.path.join(H, "..", "day6", "LEAD.txt")).read().strip() if os.path.exists(os.path.join(H, "..", "day6", "LEAD.txt")) else ""
open(os.path.join(H, "stranded-at-titan.html"), "w").write(t.replace("__DATA__", d).replace("__EVAL__", json.dumps(e, separators=(",", ":"))))
print(os.path.getsize(os.path.join(H, "stranded-at-titan.html")))
