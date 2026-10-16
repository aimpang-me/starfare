"""Build SOL Open Sky: inline the engine (as a classic script exposing SOLE) and the WORLD data into template.html.
usage: python3 build.py [--mock ENGINE.js]   (a mock engine is for local layout tests only; never publish it)"""
import json, os, re, sys
H = os.path.dirname(os.path.abspath(__file__))
EXTRA = {  # page-side look and feel only: colours, spawn pool, default zoom, aliases, notes
 "mercury": dict(color="#b9b2a8"), "venus": dict(color="#e8d3a2"), "earth": dict(color="#6fa8ff", spawn=True, big=True, zoom=5.4, alias=["home"]),
 "mars": dict(color="#d9734e", spawn=True), "jupiter": dict(color="#d9b38c", big=True, spawn=True, zoom=7.0), "saturn": dict(color="#e3cf9a", big=True, zoom=7.0),
 "uranus": dict(color="#9fe3e0", big=True), "neptune": dict(color="#6f8cff", big=True),
 "moon": dict(color="#cfd3d8", spawn=True, zoom=5.6), "phobos": dict(color="#a08f80"), "io": dict(color="#e6d36a"), "europa": dict(color="#d8c9b0", spawn=True),
 "ganymede": dict(color="#a9a29a", spawn=True), "callisto": dict(color="#7d746b"), "titan": dict(color="#e0a659", spawn=True), "enceladus": dict(color="#f2f6fa", spawn=True), "triton": dict(color="#c9b8c4"),
 "ceres": dict(color="#9a948c"), "bennu": dict(color="#6e6a66"), "roadster": dict(color="#ff6b6b", name="Roadster"),
 "iss": dict(spawn=True, zoom=4.45, alias=["space station"], note="Orbit from JPL Horizons, 2026-10-16. Plane matching isn't priced."),
 "tiangong": dict(spawn=True, zoom=4.45, alias=["chinese space station", "css"], note="Orbit from JPL Horizons, 2026-10-16. Plane matching isn't priced."),
 "orbital-depot": dict(spawn=True, zoom=4.5, alias=["depot"], note="Made up for the game."),
 "lunar-data-center": dict(spawn=True, zoom=5.0, alias=["data center", "datacenter", "moon data"], note="Made up for the game."),
 "mars-base": dict(spawn=True, zoom=5.0, alias=["mars base"], note="Made up for the game."),
 "ceres-port": dict(spawn=True, alias=["ceres port"], note="Made up for the game."),
 "titan-dock": dict(spawn=True, alias=["titan dock"], note="Made up for the game; the Stranded at Titan parking orbit."),
}
def main():
    mock = sys.argv[sys.argv.index("--mock") + 1] if "--mock" in sys.argv else None
    eng_dir = os.path.join(H, "engine")
    src = open(mock).read() if mock else open(os.path.join(eng_dir, "sol-page.js")).read()
    places = json.load(open(os.path.join(os.path.dirname(mock), "places.json") if mock else os.path.join(eng_dir, "places.json")))
    places = places["places"] if isinstance(places, dict) else places
    for p in places:
        p.update(EXTRA.get(p["id"], {}))
        if p.get("parent") == "sun": p["parent"] = None
    sim = json.load(open(os.path.join(os.path.dirname(mock) if mock else H, "sim_rides.json")))
    world = {"places": places, "planets": [p["id"] for p in places if p["kind"] == "planet"], "sim": sim, "window_days": 120,
             "sky": {"t0_ms": 1792108800000, "jd0": 2461329.5, "len_days": 7000}}
    t = open(os.path.join(H, "template.html")).read()
    out = t.replace("/*__ENGINE__*/", src.replace("</script", "<\\/script")).replace("__WORLD__", json.dumps(world, separators=(",", ":")))
    dst = os.path.join(H, "open-sky.html") if not mock else os.path.join(os.path.dirname(mock), "open-sky-mock.html")
    open(dst, "w").write(out); print(dst, os.path.getsize(dst))
if __name__ == "__main__": main()
