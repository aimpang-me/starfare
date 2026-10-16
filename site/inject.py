import json, os
H = os.path.dirname(os.path.abspath(__file__))
t = open(os.path.join(H, "template.html")).read()
d = json.load(open(os.path.join(H, "deck.json")))
open(os.path.join(H, "dispatch-desk.html"), "w").write(t.replace("__DECK__", json.dumps(d, separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/")))
print(os.path.getsize(os.path.join(H, "dispatch-desk.html")))
