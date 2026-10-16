"""Bake the day-4 Titan receipts into data for the day-5 ride-hail screen.
Nothing here plans a ride: every trip comes from receipts/titan_conversation.json (trip.py outputs, re-flown).
This script only redraws each leg's Sun-centred arc (same Lambert solve as trip.py), samples planet
positions from DE421 for the map, and maps each number in the broker's answer to the tool field it came from."""
import json, math, os, re, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); SOL = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(SOL, "code"))
import skyfield_data
from ephem import AU_KM, DAY, MU_SUN, Ephemeris, jd_from_iso, iso_from_jd
from lambert_izzo import lambert
from kepler import propagate as kprop
import models, provenance

EPH = Ephemeris(os.path.join(os.path.dirname(skyfield_data.__file__), "data", "de421.bsp"))
STATES = json.load(open(os.path.join(SOL, "data", "targets.json")))["targets"]
CONV = json.load(open(os.path.join(SOL, "receipts", "titan_conversation.json")))
NOW = jd_from_iso("2026-10-16")
STEP = 5.0
PLANETS = [("MERCURY", 1), ("VENUS", 2), ("EARTH", 399), ("MARS", 4), ("JUPITER", 5), ("SATURN", 6), ("URANUS", 7), ("NEPTUNE", 8)]

def st(name, jd):
    if name in STATES:
        S = STATES[name]; r, v = kprop(MU_SUN, np.array(S["r_km"]), np.array(S["v_kms"]), (jd - S["jd_tdb"]) * DAY)
        return np.array(r), np.array(v)
    return EPH.helio({"saturn": 6, "earth": 399}[name], jd)

def au3(r): return [round(float(x) / AU_KM, 4) for x in r]

def arc(src, dst, d0, tof, M=0):
    p1, _ = st(src, d0); p2, _ = st(dst, d0 + tof)
    v1, _ = lambert(MU_SUN, p1, p2, tof * DAY, M=M, lowpath=True)
    n = max(40, int(tof / STEP))
    ts = np.linspace(0, tof, n + 1)
    pts = [p1] + [np.array(kprop(MU_SUN, p1, np.array(v1), t * DAY)[0]) for t in ts[1:]]
    return [[round(float(d0 + t - NOW), 3)] + au3(p) for t, p in zip(ts, pts)]

def burns_timeline(legs, out):
    """Burns are instant; the battery model is applied to the running total of burn so the last value equals the receipt."""
    b = []
    for L in legs:
        if L["leg"] == "pickup" and "depart" in L:
            b.append((jd_from_iso(L["depart"]) - NOW, L["dv_roadster_kms"], "Roadster leaves its orbit"))
            b.append((jd_from_iso(L["arrive_titan"]) - NOW, L["dv_titan_capture_kms"], "Roadster brakes into your Titan orbit"))
        if L["leg"] == "ride":
            b.append((jd_from_iso(L["depart_titan"]) - NOW + (0.2 if L["wait_at_titan_days"] == 0 and legs[0].get("eta_hours") else 0), L["dv_kms"], "Burn to leave Titan and Saturn"))
    cum, res = 0.0, []
    for t, dv, what in b:
        cum += dv; bat = models.battery(cum)
        res.append({"t": round(t, 3), "dv": dv, "what": what, "cum_kwh": bat["energy_kwh"], "cum_pct": bat["battery_pct"]})
    res[-1]["cum_kwh"], res[-1]["cum_pct"] = out["battery"]["energy_kwh"], out["battery"]["battery_pct"]
    return res

def flat(x, path=""):
    if isinstance(x, bool): return
    if isinstance(x, (int, float)): yield path, x; return
    if isinstance(x, str): yield path, x; return
    items = x.items() if isinstance(x, dict) else enumerate(x)
    for k, v in items: yield from flat(v, f"{path}.{k}" if path else str(k))

def trace(answer, calls, request, earlier):
    """For each number or date in the answer, the first tool field that matches at the printed precision."""
    spans = []
    pools = [(f"{c['tool']} {c['args']}", c["output"]) for c in calls] + earlier
    for s, e, tok in provenance.tokens(answer):
        if provenance.LABEL.search(answer[max(0, s - 8):s]): continue
        src = None
        for name, out in pools:
            for p, v in flat(out):
                if isinstance(v, str):
                    if tok in [t for _, _, t in provenance.tokens(v)]: src = (name, p); break
                elif isinstance(v, (int, float)) and not re.fullmatch(provenance.DATE, tok):
                    dec = len(tok.split(".")[1]) if "." in tok else 0
                    if round(float(v), dec) == round(float(tok.replace(",", "")), dec): src = (name, p); break
            if src: break
        if not src and tok in request: src = ("rider's request", "")
        spans.append({"s": s, "e": e, "tok": tok, "tool": src[0] if src else None, "field": src[1] if src else None})
    return spans

KIND = {"--driver fleet --verify": "fleet_low", "--driver roadster --verify": "roadster_low",
        "--driver fleet --objective time --verify": "fleet_fastest", "--driver roadster --objective time --verify": "roadster_fastest",
        "--driver fleet --objective time --max-burn 8 --verify": "fleet_quicker", "--driver fleet --objective time --max-burn 5 --verify": "fleet_balanced"}

trips, turns, earlier, end_t = {}, [], [], 0
for ti, T in enumerate(CONV["turns"]):
    ids = []
    for c in T["tool_calls"]:
        out, k = c["output"], KIND[c["args"]]; ids.append(k)
        legs, paths = out["legs"], []
        if legs[0].get("depart"):  # the real Roadster: its own orbit until it leaves, then the pickup leg
            L = legs[0]; d0 = jd_from_iso(L["depart"])
            ts = np.arange(NOW, d0 + 0.01, STEP)
            paths.append({"kind": "roadster_orbit", "pts": [[round(float(t - NOW), 3)] + au3(st("roadster", t)[0]) for t in ts]})
            paths.append({"kind": "pickup", "pts": arc("roadster", "saturn", d0, L["tof_days"], L["revs"])})
        R = legs[-1]; d0 = jd_from_iso(R["depart_titan"])
        paths.append({"kind": "ride", "pts": arc("saturn", "earth", d0, R["tof_days"], R["revs"])})
        if R["wait_at_titan_days"] == 0 and legs[0].get("eta_hours"):  # fleet pickup takes 4.8 h, so the ride starts then
            paths[-1]["pts"] = [[p[0] + 0.2 if i == 0 else p[0]] + p[1:] for i, p in enumerate(paths[-1]["pts"])]
        end = jd_from_iso(out["arrive_home"]) - NOW; end_t = max(end_t, end)
        trips[k] = {"args": c["args"], "seconds": c["seconds"], "out": out, "paths": paths,
                    "burns": burns_timeline(legs, out), "end_t": round(end, 3), "turn": ti}
    turns.append({"request": T["request"].split("? ")[-1].strip() if ti else T["request"].strip(),
                  "full_request": T["request"].strip(), "dispatcher": T["roles"]["dispatcher"], "broker": T["rider_sees"],
                  "provenance": T["provenance"], "calls": [{"args": c["args"], "seconds": c["seconds"], "kind": KIND[c["args"]],
                  "refly_pass": all(l.get("refly", {"pass": True})["pass"] for l in c["output"]["legs"])} for c in T["tool_calls"]],
                  "spans": trace(T["rider_sees"], T["tool_calls"], T["request"], earlier), "trips": ids})
    earlier += [(f"{c['tool']} {c['args']}", c["output"]) for c in T["tool_calls"]]

# planets every 5 days over the whole window, and one full osculating orbit each for the rings on the map
grid = np.arange(NOW, NOW + end_t + 30, STEP)
planets = {}
for name, n in PLANETS:
    r0, v0 = EPH.helio(n, NOW)
    a = 1 / (2 / np.linalg.norm(r0) - np.dot(v0, v0) / MU_SUN); P = 2 * math.pi * math.sqrt(a**3 / MU_SUN)
    ring = [au3(kprop(MU_SUN, r0, v0, t)[0])[:2] for t in np.linspace(0, P, 181)]
    planets[name] = {"pos": [au3(EPH.helio(n, t)[0]) for t in grid], "orbit": ring}
S = STATES["roadster"]; r0, v0 = st("roadster", NOW)
a = 1 / (2 / np.linalg.norm(r0) - np.dot(v0, v0) / MU_SUN); P = 2 * math.pi * math.sqrt(a**3 / MU_SUN)
roadster_orbit = [au3(kprop(MU_SUN, r0, v0, t)[0])[:2] for t in np.linspace(0, P, 121)]

data = {"request_date": "2026-10-16", "step_days": STEP, "planets": planets, "roadster_orbit": roadster_orbit,
        "roadster_now": au3(r0), "trips": trips, "turns": turns,
        "assumptions": trips["fleet_low"]["out"]["assumptions"], "pack_kwh": models.PACK_KWH,
        "usd_per_min": models.USD_PER_MIN, "usd_per_kwh": models.USD_PER_KWH,
        "titan": {"orbit_km": 1221870.0, "radius_km": 2574.7, "park_alt_km": 1500.0, "period_days": 15.945},
        "saturn_radius_km": 58232.0}
json.dump(data, open(os.path.join(HERE, "sol_data.json"), "w"), separators=(",", ":"))
untr = [(t["tok"]) for T in turns for t in T["spans"] if not t["tool"]]
print("trips", list(trips), "turns", len(turns), "untraced spans", untr, "bytes", os.path.getsize(os.path.join(HERE, "sol_data.json")))
for k, v in trips.items(): print(k, v["end_t"], [(b["t"], b["cum_pct"]) for b in v["burns"]], [ (p["kind"], len(p["pts"])) for p in v["paths"]])
e0 = np.array(planets["EARTH"]["pos"][0]); s0 = np.array(planets["SATURN"]["pos"][0]); rr = np.array(au3(r0))
print("light min Saturn-Earth", np.linalg.norm(e0 - s0) * AU_KM / 299792.458 / 60, "Saturn-Roadster", np.linalg.norm(rr - s0) * AU_KM / 299792.458 / 60)
