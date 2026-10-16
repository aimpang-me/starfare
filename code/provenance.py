"""Provenance gate: every number in an agent's rider-facing answer must come from a tool output
(or from the rider's own request). Untraced numbers are struck out, and the answer fails the gate.
Matching is exact at the precision the agent printed: "9.2" traces to a tool value 9.18 only if the
agent rounded it the way Python's round() would; "290" traces to 290.0. Dates must match verbatim."""
import json, re

DATE = r"\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?"
NUM = r"[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[-+]?\d+(?:\.\d+)?"
TOKEN = re.compile(r"(?<![A-Za-z0-9_.\-])(" + DATE + "|" + NUM + r")(?![A-Za-z0-9_]|\.\d)")

LABEL = re.compile(r"(?:Option|option|#)\s?$")

def _flatten(x, nums, strs):
    if isinstance(x, bool): return
    if isinstance(x, (int, float)): nums.append(float(x)); return
    if isinstance(x, str):
        strs.append(x)
        for m in TOKEN.finditer(x):
            t = m.group(1)
            if not re.fullmatch(DATE, t): nums.append(float(t.replace(",", "")))
        return
    for v in (x.values() if isinstance(x, dict) else x): _flatten(v, nums, strs)

def tokens(text):
    return [(m.start(1), m.end(1), m.group(1)) for m in TOKEN.finditer(text)]

def traced(tok, nums, blob):
    if re.fullmatch(DATE, tok): return tok in blob
    val = float(tok.replace(",", ""))
    dec = len(tok.split(".")[1]) if "." in tok else 0
    return any(round(v, dec) == round(val, dec) for v in nums)

def check(answer, tool_outputs, request=""):
    """Return (ok, untraced_tokens, struck_answer)."""
    nums, strs = [], []
    _flatten(tool_outputs, nums, strs); _flatten(request, nums, strs)
    blob = json.dumps(tool_outputs) + " " + request
    bad, out, last = [], [], 0
    for s, e, t in tokens(answer):
        if LABEL.search(answer[max(0, s - 8):s]): continue  # list labels like "Option 2" or "#3" are not data
        if not traced(t, nums, blob):
            bad.append(t); out.append(answer[last:s] + "~~" + t + "~~[no tool made this]"); last = e
    out.append(answer[last:])
    return (not bad), bad, "".join(out)

if __name__ == "__main__":
    tool = [{"depart": "2026-10-31", "tof_days": 293.0, "c3_km2s2": 9.18}]
    print(check("Leave 2026-10-31, 293 days, C3 9.18 (about 9.2).", tool, "cheapest to Mars"))
    print(check("Leave 2026-10-31, 293 days, C3 9.18, only 4.2 km/s.", tool, ""))
