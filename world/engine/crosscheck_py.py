"""Python side of crosscheck.mjs.  Reads a JSON list of jobs (file in argv[1]), writes a JSON list of results
(argv[2]).  Uses the UNMODIFIED code in sol/code (ephem, kepler, lambert_izzo, nbody, refly) and DE421.

Job kinds
  grid   : exhaustive (dep, tof, branch) grid search with the same cost/burn models as sol-engine.js planRide
           grid mode, on DE421 + lambert_izzo + kepler (independent of the JS ephemeris table and port)
  eval   : one leg at a given (dep_jd, tof, M, lowpath): v_inf, C3, burns on DE421
  refly  : refly.refly (mode 'leo', Earth 200 km) or refly.refly_leg (mode 'centre'), exactly as in sol/code;
           with "ephem": "cheb" the same functions run on the JS Chebyshev table (ephem.json) instead of DE421,
           by swapping refly.Ephemeris / refly.HermiteTable (no file is modified) -- isolates table vs code.
  cli    : run quote.py / trip.py (argv list) and return their JSON
"""
import json, math, os, subprocess, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CODE = os.path.normpath(os.path.join(HERE, "..", "..", "code"))
sys.path.insert(0, CODE)
import skyfield_data  # noqa: E402
from ephem import DAY, J2000, MU_SUN, Ephemeris  # noqa: E402
from kepler import propagate as kprop  # noqa: E402
from lambert_izzo import lambert  # noqa: E402
import refly as R  # noqa: E402

EPH = Ephemeris(os.path.join(os.path.dirname(skyfield_data.__file__), "data", "de421.bsp"))
STATES = json.load(open(os.path.join(CODE, "..", "data", "targets.json")))["targets"]
PLACES = {p["id"]: p for p in json.load(open(os.path.join(HERE, "places.json")))["places"]}
BODY = {"mercury": 199, "venus": 299, "earth": 399, "mars": 499, "jupiter": 5, "saturn": 6, "uranus": 7, "neptune": 8}
# trip.py titan_burn constants, copied literally from trip.py (it cannot be imported: it runs main())
MU_SAT, R_TITAN_ORB, MU_TITAN, RP_TITAN = 3.7931187e7, 1221870.0, 8978.14, 2574.7 + 1500.0


def titan_burn(vinf_saturn):
    v_need = math.sqrt(vinf_saturn**2 + 2*MU_SAT/R_TITAN_ORB)
    vinf_t = v_need - math.sqrt(MU_SAT/R_TITAN_ORB)
    return math.sqrt(vinf_t**2 + 2*MU_TITAN/RP_TITAN) - math.sqrt(MU_TITAN/RP_TITAN)


# ---------------------------------------------------------------- endpoints (independent re-implementation)
def endpoint(ep):
    """-> (anchor, chain) ; chain = [(mu, r)] (planet/station) or [(mu_m, rp_m), (mu_parent, a_moon)] (moon)"""
    if "ship" in ep:
        return None, []
    p = PLACES[ep["place"]]
    if p["kind"] == "planet":
        return p["id"], [(p["mu"], p["radius_km"] + p["park_alt_km"])]
    if p["kind"] == "small":
        return p["id"], ([(p["mu"], p["radius_km"] + p["park_alt_km"])] if p["mu"] else [])
    if p["kind"] == "moon":
        return p["parent"], [(p["mu"], p["radius_km"] + p["park_alt_km"]), (p["parent_mu"], p["orbit_km"])]
    par = PLACES[p["parent"]]
    inner = (par["mu"], par["radius_km"] + p["park_alt_km"])
    if par["kind"] == "moon":
        return par["parent"], [inner, (par["parent_mu"], par["orbit_km"])]
    return par["id"], [inner]


def burn(chain, vinf):
    if not chain:
        return vinf
    if len(chain) == 1:
        mu, r = chain[0]
        return math.sqrt(vinf**2 + 2*mu/r) - math.sqrt(mu/r)
    (mu_m, rp), (mu_p, a) = chain
    vinf_m = math.sqrt(vinf**2 + 2*mu_p/a) - math.sqrt(mu_p/a)
    return math.sqrt(vinf_m**2 + 2*mu_m/rp) - math.sqrt(mu_m/rp)


def anchor_state(anchor, ep, jd):
    if "ship" in ep:
        s = ep["ship"]
        r, v = kprop(MU_SUN, np.array(s["r"]), np.array(s["v"]), (jd - s["jd"]) * DAY)
        return np.array(r), np.array(v)
    if anchor in STATES:  # 2-body from the Horizons epoch, as quote.py / trip.py
        S = STATES[anchor]
        r, v = kprop(MU_SUN, np.array(S["r_km"]), np.array(S["v_kms"]), (jd - S["jd_tdb"]) * DAY)
        return np.array(r), np.array(v)
    return EPH.helio(BODY[anchor], jd)


def leg(job, d0, tof, M, low):
    ao, co = endpoint(job["origin"])
    ad, cd = endpoint(job["dest"])
    p1, vb1 = anchor_state(ao, job["origin"], d0)
    p2, vb2 = anchor_state(ad, job["dest"], d0 + tof)
    v1, v2, inf = lambert(MU_SUN, p1, p2, tof * DAY, M=M, lowpath=low, return_info=True)
    vd = float(np.linalg.norm(np.array(v1) - vb1))
    va = float(np.linalg.norm(np.array(v2) - vb2))
    dvd = burn(co, vd)
    dva = burn(cd, va) if job.get("arrive", "capture") == "capture" else 0.0
    return {"vd": vd, "va": va, "dvd": dvd, "dva": dva, "dv": dvd + dva, "angle": inf["transfer_angle_deg"], "c3": vd * vd}


def opt(job, k, default):  # JSON has no Infinity: JS sends null for it
    v = job.get(k)
    return default if v is None else v


def cost(job, e, d0, tof):
    obj = job.get("objective", "energy")
    maxb = opt(job, "maxBurnKms", math.inf if obj == "energy" else 15.0)
    if e["c3"] > opt(job, "maxC3", math.inf) or e["dv"] > maxb:
        return None
    if obj == "time":
        return d0 + tof
    if obj == "tof":
        return tof
    return e["dv"] + opt(job, "delayPenalty", 0.1) * (d0 + tof - opt(job, "requestJd", job["depFrom"])) / 365.25


def grid(job):
    g = job["grid"]
    j0, j1 = job["depFrom"], job["depTo"]
    arr_by = opt(job, "arriveBy", math.inf)
    deps = np.arange(j0, j1 + (0.01 if g.get("inclusive") else 0.0), g["depStep"])
    tofs = np.arange(g["tofMin"], g["tofMax"] + (0.1 if g.get("inclusive") else 0.0), g["tofStep"])
    branches = [(0, True), (1, True), (1, False)][: 1 + 2 * (job.get("revs", 1) >= 1)]
    best, n = None, 0
    for d0 in deps:
        for tof in tofs:
            if d0 + tof > arr_by + 1e-9:
                continue
            for M, low in branches:
                try:
                    e = leg(job, float(d0), float(tof), M, low)
                except Exception:
                    continue
                if job.get("skip180", True) and abs(e["angle"] - 180) < 1:
                    continue
                k = cost(job, e, float(d0), float(tof))
                n += 1
                if k is not None and (best is None or k < best["cost"]):
                    best = dict(e, cost=k, dep_jd=float(d0), tof_days=float(tof), revs=M, lowpath=low)
    return {"best": best, "evaluated": n}


# ---------------------------------------------------------------- the JS table, for refly in "cheb" mode
class ChebEph:
    """helio(naif, jd) from ephem.json, mirroring sol-engine.js (Earth = emb - k*moon_geo)."""
    NAME = {1: "mercury", 199: "mercury", 2: "venus", 299: "venus", 4: "mars", 499: "mars", 5: "jupiter", 6: "saturn",
            7: "uranus", 8: "neptune"}

    def __init__(self, path=os.path.join(HERE, "ephem.json")):
        d = json.load(open(path))
        A = d["alphabet"]
        self.k, self.jd0 = d["earth_k"], d["jd_start"]
        self.b = {}
        for name, b in d["bodies"].items():
            vals, z, sh = [], 0, 0
            for ch in b["data"]:
                c = A.index(ch)
                z |= (c & 31) << sh
                sh += 5
                if not c & 32:
                    vals.append((z >> 1) if not z & 1 else -((z + 1) >> 1))
                    z, sh = 0, 0
            C = np.array(vals, float).reshape(b["nseg"], 3, b["deg"] + 1) * b["q_km"]
            lens = np.array([b["seg_days"] / 2 ** A.index(c) for c in b["split"]]) if "split" in b else np.full(b["nseg"], float(b["seg_days"]))
            starts = self.jd0 + np.concatenate(([0.0], np.cumsum(lens)[:-1]))
            self.b[name] = (C, (starts - J2000) * DAY, lens * DAY)

    def _ev(self, name, ts):
        C, S, L = self.b[name]
        ts = np.atleast_1d(np.asarray(ts, float))
        s = np.clip(np.searchsorted(S, ts, side="right") - 1, 0, len(S) - 1)
        x = 2 * (ts - S[s]) / L[s] - 1
        deg = C.shape[2] - 1
        T = np.empty((len(ts), deg + 1)); D = np.zeros_like(T)
        T[:, 0] = 1; T[:, 1] = x; D[:, 1] = 1
        for k in range(2, deg + 1):
            T[:, k] = 2 * x * T[:, k - 1] - T[:, k - 2]
            D[:, k] = 2 * T[:, k - 1] + 2 * x * D[:, k - 1] - D[:, k - 2]
        P = np.einsum("nk,nck->cn", T, C[s]); V = np.einsum("nk,nck->cn", D, C[s]) * (2 / L[s])
        return P, V

    def helio_ts(self, naif, ts):
        if naif in (399, 301):
            pe, ve = self._ev("emb", ts); pg, vg = self._ev("moon_geo", ts)
            k = -self.k if naif == 399 else 1 - self.k
            return pe + k * pg, ve + k * vg
        return self._ev(self.NAME[naif], ts)

    def helio(self, naif, jd, jd2=0.0, frame="ecl"):
        p, v = self.helio_ts(naif, (np.asarray(jd, float) - J2000) * DAY + jd2 * DAY)
        return (p[:, 0], v[:, 0]) if np.ndim(jd) == 0 else (p, v)


class ChebTable:
    """HermiteTable stand-in: pos(t) -> (n_bodies, 3) from the JS table (scalar fast path, same maths as _ev)."""
    NAMES = {399: "earth", 301: "moon"}

    def __init__(self, eph, naifs, jd_start, jd_end, step_days=0.25, frame="ecl"):
        import bisect
        from ephem import HermiteTable
        self.bisect = bisect.bisect_right
        self.eph, self.naifs = eph, list(naifs)
        # the JS table starts 2026-10-01; Horizons epochs in data/targets.json can be earlier,
        # so before the table start fall back to refly.py's own DE421 Hermite table
        self.t_start = (eph.jd0 - J2000) * DAY
        self.pre = HermiteTable(EPH, self.naifs, jd_start, eph.jd0 + 1) if jd_start < eph.jd0 else None
        self.k = eph.k
        self.src = {n: (eph.b[eph.NAME[n]] if n in eph.NAME else None) for n in self.naifs}
        self.S = {name: list(v[1]) for name, v in eph.b.items()}

    def _one(self, name, t):
        C, S, L = self.eph.b[name]
        s = max(0, min(len(S) - 1, self.bisect(self.S[name], t) - 1))
        x = 2 * (t - S[s]) / L[s] - 1
        n1 = C.shape[2]
        T = [1.0, x]
        for k in range(2, n1):
            T.append(2 * x * T[-1] - T[-2])
        return C[s] @ np.array(T[:n1])

    def pos(self, t):
        if t < self.t_start and self.pre is not None:
            return self.pre.pos(t)
        out = np.empty((len(self.naifs), 3))
        em = gm = None
        for i, n in enumerate(self.naifs):
            if n in (399, 301):
                if em is None:
                    em, gm = self._one("emb", t), self._one("moon_geo", t)
                out[i] = em + ((-self.k) if n == 399 else (1 - self.k)) * gm
            else:
                out[i] = self._one(self.eph.NAME[n], t)
        return out


def run_refly(job):
    if job.get("ephem") == "cheb":
        ce = ChebEph()
        R.Ephemeris = lambda *a, **k: ce
        R.HermiteTable = ChebTable
    if job.get("rtol"):  # same code, tighter integrator tolerance on the miss propagations (refly.py uses 1e-10)
        orig, rt = R.propagate, job["rtol"]
        R.propagate = lambda model, t0, y0, t1, dense=False, events=None, rtol=None: orig(
            model, t0, y0, t1, dense=dense, events=events, rtol=(rt if rtol == 1e-10 else rtol))
    tic = time.perf_counter()
    if job["mode"] == "leo":
        out = R.refly(job["dest"], job["dep_jd"], job["tof_days"], M=job["revs"], lowpath=job["lowpath"])
    else:
        out = R.refly_leg(job["src"], job["dst"], job["dep_jd"], job["tof_days"], job["revs"], job["lowpath"])
    out["seconds"] = time.perf_counter() - tic
    return out


def run(job):
    try:
        if job["kind"] == "grid":
            tic = time.perf_counter(); r = grid(job); r["seconds"] = time.perf_counter() - tic; return r
        if job["kind"] == "eval":
            return leg(job, job["dep_jd"], job["tof_days"], job["revs"], job["lowpath"])
        if job["kind"] == "refly":
            return run_refly(job)
        if job["kind"] == "cli":
            tic = time.perf_counter()
            p = subprocess.run([sys.executable] + job["argv"], cwd=CODE, capture_output=True, text=True, timeout=7200)
            txt = p.stdout.strip()
            return {"out": json.loads(txt) if txt else None, "stderr": p.stderr[-2000:], "seconds": time.perf_counter() - tic}
        if job["kind"] == "unit":
            lam, kep = [], []
            for c in job["lambert"]:
                try:
                    v1, v2, inf = lambert(MU_SUN, c["r1"], c["r2"], c["tof"], M=c["M"], lowpath=c["low"], return_info=True)
                    lam.append([list(v1), list(v2), inf["transfer_angle_deg"]])
                except Exception as e:
                    lam.append(str(e))
            for c in job["kepler"]:
                try:
                    r, v = kprop(MU_SUN, c["r"], c["v"], c["dt"])
                    kep.append([r.tolist(), v.tolist()])
                except Exception as e:
                    kep.append(str(e))
            return {"lambert": lam, "kepler": kep, "titan_burn": [titan_burn(v) for v in job["vinf"]]}
        if job["kind"] == "titan_burn":
            return {"values": [titan_burn(v) for v in job["vinf"]]}
    except Exception as e:  # report, do not hide
        return {"error": f"{type(e).__name__}: {e}"}
    return {"error": "unknown job kind"}


if __name__ == "__main__":
    jobs = json.load(open(sys.argv[1]))
    if isinstance(jobs, dict):
        jobs = [jobs]
    res = [run(j) for j in jobs]
    json.dump(res, open(sys.argv[2], "w"))
