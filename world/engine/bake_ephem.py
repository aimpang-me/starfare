"""Bake a compact browser ephemeris for sol-engine.js from JPL DE421 (skyfield-data copy).

Output: ephem.json (and ephem.js = the same object as an ES module default export, for inlining).

Contents (all heliocentric J2000 ECLIPTIC, km, TDB Julian dates, the same frame as code/ephem.py helio()):
  mercury(1) venus(2) emb(3, Earth-Moon barycentre) mars(4) jupiter(5) saturn(6) uranus(7) neptune(8)
  moon_geo  = Moon minus Earth (geocentric Moon, 301-399)
  Earth is rebuilt in JS as  emb - k * moon_geo  with k = 1/(1+EMRAT) read from DE421 (stored as earth_k);
  Moon heliocentric = Earth + moon_geo.  (DE421 has zero offsets 1->199, 2->299, 4->499, so barycentre = body.)
  Places with kind small get n-body orbits integrated here with the SAME code the Python re-fly uses
  (code/nbody.py Model + DOP853, rtol 1e-12, Sun + 8 planets + Moon from HermiteTable) from their Horizons
  states in data/targets.json, so the JS planner and re-fly both fly these exactly as refly.py does.
  (quote.py/trip.py still use 2-body Kepler from the same Horizons states.)

Format per body: piecewise Chebyshev in time, uniform segments of seg_days, degree deg per axis, fitted by
interpolation at Chebyshev-Gauss-Lobatto nodes (segment end points are nodes, so position is continuous).
Coefficients are quantised to integers of q_km and packed as zigzag varints in a base64url string
(5 payload bits per character, the 6th bit = 'more').  Velocity = analytic derivative of the polynomial.
Each body's segment length / degree is chosen automatically: the smallest packed size whose max position
error vs DE421 (checked on a dense grid) is below that body's tolerance.

usage: python3 bake_ephem.py            (writes ephem.json, ephem.js, ephem_errors.json, ephem_testvectors.json)
"""
import json, math, os, subprocess, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CODE = os.path.normpath(os.path.join(HERE, "..", "..", "code"))
sys.path.insert(0, CODE)
import skyfield_data  # noqa: E402
from ephem import DAY, J2000, EQ2ECL, Ephemeris, HermiteTable, jd_from_iso  # noqa: E402
from nbody import Model, propagate, PERTURBERS  # noqa: E402

DE421 = os.path.join(os.path.dirname(skyfield_data.__file__), "data", "de421.bsp")
JD_START = jd_from_iso("2026-10-01")      # 2461314.5
JD_END = JD_START + 9856.0                # 2053-09-25 (= 77 x 128 d); DE421 ends 2053-10-09
SPAN = JD_END - JD_START

# position tolerance (km) the auto-tuner must meet, and the integer quantum (km)
TOL = {"mercury": 2e-2, "venus": 1e-2, "emb": 1e-2, "mars": 1e-2, "jupiter": 1e-2, "saturn": 1e-2,
       "uranus": 1e-2, "neptune": 1e-2, "moon_geo": 5e-2, "bennu": 1e-2, "ceres": 1e-2}
QFRAC = 20.0   # quantum = tol / QFRAC
NAIF = {"mercury": 1, "venus": 2, "emb": 3, "mars": 4, "jupiter": 5, "saturn": 6, "uranus": 7, "neptune": 8}
SEGS = [1, 2, 4, 7, 8, 11, 14, 16, 22, 28, 32, 44, 56, 64, 77, 88, 112, 128, 154, 176, 224, 308, 352, 448, 616, 704]  # all divide 9856

eph = Ephemeris(DE421)


def seg_state(center_target, jd):
    p, v = eph.seg[center_target].compute_and_differentiate(jd)
    return np.asarray(p), np.asarray(v) / DAY


def helio_ecl(naif, jd):
    return eph.helio(naif, jd, frame="ecl")


def moon_geo(jd):
    pm, vm = seg_state((3, 301), jd)
    pe, ve = seg_state((3, 399), jd)
    return EQ2ECL @ (pm - pe), EQ2ECL @ (vm - ve)


# k = |EMB->Earth| / |Earth->Moon| = 1/(1+EMRAT)
_jd = JD_START + np.linspace(0, SPAN, 50)
_pe, _ = seg_state((3, 399), _jd)
_pm, _ = seg_state((3, 301), _jd)
EARTH_K = float(np.mean(np.linalg.norm(_pe, axis=0) / np.linalg.norm(_pm - _pe, axis=0)))


# ---------------------------------------------------------------- small bodies: n-body, as refly.py
def shipped_small_ids():
    script = os.path.join(HERE, "ship-ephem.mjs")
    out = subprocess.check_output(["node", script, "--small-ids"], text=True)
    return [line.strip() for line in out.splitlines() if line.strip()]


def small_body_fun():
    states = json.load(open(os.path.join(CODE, "..", "data", "targets.json")))["targets"]
    jd_lo = min(min(s["jd_tdb"] for s in states.values()), JD_START) - 2
    table = HermiteTable(eph, PERTURBERS, jd_lo, JD_END + 5)
    want = set(shipped_small_ids())
    funs = {}
    for name, S in states.items():
        if name not in want:
            continue
        t0 = (S["jd_tdb"] - J2000) * DAY
        y0 = np.concatenate((S["r_km"], S["v_kms"]))
        tic = time.perf_counter()
        # forward from the Horizons epoch exactly as refly.py does; backward too if the epoch is after JD_START
        fwd = propagate(Model(table, PERTURBERS), t0, y0, (JD_END + 2 - J2000) * DAY, dense=True)
        bwd = None
        if S["jd_tdb"] > JD_START - 1:
            bwd = propagate(Model(table, PERTURBERS), t0, y0, (JD_START - 2 - J2000) * DAY, dense=True)
        print(f"  integrated {name} n-body from JD {S['jd_tdb']} to {JD_END + 2}: {len(fwd.t)} steps"
              f"{'' if bwd is None else f' (+{len(bwd.t)} backward to {JD_START - 2})'}, {time.perf_counter() - tic:.1f} s", flush=True)

        def f(jd, fwd=fwd, bwd=bwd, t0=t0):
            t = (np.atleast_1d(jd) - J2000) * DAY
            Y = np.empty((6, len(t)))
            m = t >= t0
            if m.any():
                Y[:, m] = fwd.sol(t[m])
            if (~m).any():
                Y[:, ~m] = bwd.sol(t[~m])
            return Y[:3], Y[3:]
        funs[name] = f
    return funs


# ---------------------------------------------------------------- Chebyshev fitting / packing
def lobatto(deg):
    return np.cos(np.pi * np.arange(deg + 1) / deg)  # 1 .. -1


def cheb_matrix(x, deg):
    T = np.empty((len(x), deg + 1))
    T[:, 0] = 1.0
    if deg >= 1:
        T[:, 1] = x
    for k in range(2, deg + 1):
        T[:, k] = 2 * x * T[:, k - 1] - T[:, k - 2]
    return T


def cheb_deriv_matrix(x, deg):
    T = cheb_matrix(x, deg)
    D = np.zeros_like(T)
    if deg >= 1:
        D[:, 1] = 1.0
    for k in range(2, deg + 1):
        D[:, k] = 2 * T[:, k - 1] + 2 * x * D[:, k - 1] - D[:, k - 2]
    return D


def fit(fun, starts, lens, deg):
    """coefficients (nseg, 3, deg+1) from interpolation at Lobatto nodes, segments [start, start+len]."""
    x = lobatto(deg)
    Tinv = np.linalg.inv(cheb_matrix(x, deg))
    mids = starts + 0.5 * lens
    jds = (mids[:, None] + 0.5 * lens[:, None] * x[None, :]).ravel()
    P, _ = fun(jds)
    P = P.reshape(3, len(starts), deg + 1).transpose(1, 0, 2)  # (nseg, 3, nodes)
    return np.einsum("kn,scn->sck", Tinv, P)


def quantise(C, q):
    return np.rint(C / q).astype(np.int64)


def evaluate(I, q, starts, lens, jd):
    """positions, velocities (km, km/s) from quantised coefficients (numpy mirror of the JS evaluator)."""
    deg = I.shape[2] - 1
    s = np.clip(np.searchsorted(starts, jd, side="right") - 1, 0, len(starts) - 1)
    x = 2 * (jd - starts[s]) / lens[s] - 1
    T, D = cheb_matrix(x, deg), cheb_deriv_matrix(x, deg)
    C = I[s].astype(float) * q  # (n, 3, deg+1)
    P = np.einsum("nk,nck->cn", T, C)
    V = np.einsum("nk,nck->cn", D, C) * (2.0 / (lens[s] * DAY))[None, :]
    return P, V


B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"


def pack(ints):
    out = []
    for n in ints.ravel().tolist():
        z = (n << 1) if n >= 0 else ((-n << 1) - 1)  # zigzag
        while True:
            c = z & 31
            z >>= 5
            if z:
                out.append(B64[c | 32])
            else:
                out.append(B64[c])
                break
    return "".join(out)


def unpack(s, n):
    vals, z, sh = [], 0, 0
    for ch in s:
        c = B64.index(ch)
        z |= (c & 31) << sh
        sh += 5
        if not c & 32:
            vals.append((z >> 1) if not z & 1 else -((z + 1) >> 1))
            z, sh = 0, 0
    assert len(vals) == n
    return np.array(vals, dtype=np.int64)


def errors(fun, I, q, starts, lens, n=40000, seed=1):
    rng = np.random.default_rng(seed)
    jd_lo, jd_hi = starts[0], starts[-1] + lens[-1]
    jd = rng.uniform(jd_lo, jd_hi, n)
    # also 8 random points inside every segment, and both sides of every boundary
    jd = np.concatenate((jd, (starts[:, None] + lens[:, None] * rng.uniform(0, 1, (len(starts), 8))).ravel(),
                         starts[1:] - 1e-7, starts[1:] + 1e-7))
    jd = np.sort(jd)
    P0, V0 = fun(jd)
    P, V = evaluate(I, q, starts, lens, jd)
    dp = np.linalg.norm(P - P0, axis=0)
    dv = np.linalg.norm(V - V0, axis=0)
    return float(dp.max()), float(dv.max()), float(np.sqrt((dp ** 2).mean()))


def seg_errors(fun, C, starts, lens, npts=24, seed=3):
    """max position error per segment (unquantised fit) on npts random points per segment."""
    rng = np.random.default_rng(seed)
    deg = C.shape[2] - 1
    u = rng.uniform(-1, 1, (len(starts), npts))
    jd = (starts[:, None] + 0.5 * lens[:, None] * (u + 1)).ravel()
    P0, _ = fun(jd)
    T = cheb_matrix(u.ravel(), deg)
    P = np.einsum("nk,nck->cn", T, np.repeat(C, npts, axis=0))
    return np.linalg.norm(P - P0, axis=0).reshape(len(starts), npts).max(axis=1)


def build(fun, seg, deg, ftol, max_split=6):
    """uniform segments of seg days; any segment whose fit error exceeds ftol is halved (up to max_split times)."""
    nseg = int(round(SPAN / seg))
    starts = JD_START + seg * np.arange(nseg)
    lens = np.full(nseg, float(seg))
    for level in range(max_split + 1):
        C = fit(fun, starts, lens, deg)
        bad = seg_errors(fun, C, starts, lens) > ftol
        if not bad.any() or level == max_split:
            return starts, lens, C
        ns, nl = [], []
        for s0, l0, b0 in zip(starts, lens, bad):
            if b0:
                ns += [s0, s0 + l0 / 2]
                nl += [l0 / 2, l0 / 2]
            else:
                ns.append(s0)
                nl.append(l0)
        starts, lens = np.array(ns), np.array(nl)


def tune(name, fun, tol):
    """smallest packed size over (base segment, degree) whose segments all fit within 0.5 tol (then verified)."""
    q = tol / QFRAC
    best = None
    for seg in SEGS:
        last = None
        for deg in range(6, 33):
            starts, lens, C = build(fun, seg, deg, 0.5 * tol)
            size = len(pack(quantise(C, q))) + (0 if len(starts) == round(SPAN / seg) else 4 * len(starts))
            ok = seg_errors(fun, C, starts, lens).max() <= 0.5 * tol
            if ok and (best is None or size < best[0]):
                best = (size, seg, deg, starts, lens, C)
            if ok and last is not None and size > last:
                break
            last = size if ok else last
    _, seg, deg, starts, lens, C = best
    I = quantise(C, q)
    ep, ev, rms = errors(fun, I, q, starts, lens)
    return {"seg": seg, "deg": deg, "starts": starts, "lens": lens, "q": q, "I": I,
            "err_pos_km": ep, "err_vel_kms": ev, "rms_pos_km": rms}


def main():
    tic = time.perf_counter()
    funs = {k: (lambda jd, n=n: helio_ecl(n, jd)) for k, n in NAIF.items()}
    funs["moon_geo"] = moon_geo
    print("integrating small bodies (n-body, same Model/DOP853 as refly.py) ...", flush=True)
    funs.update(small_body_fun())
    out = {"format": "sol-ephem-cheb-1",
           "source": "JPL DE421 (skyfield-data 7.0.0 de421.bsp) via jplephem; small bodies integrated n-body "
                     "(code/nbody.py, DOP853 rtol 1e-12, Sun+8 planets+Moon) from data/targets.json Horizons states",
           "frame": "heliocentric J2000 ecliptic (obliquity 84381.448 arcsec), km, km/s, TDB Julian date",
           "jd_start": JD_START, "jd_end": JD_END, "earth_k": EARTH_K,
           "alphabet": B64, "bodies": {}}
    report = {}
    for name, fun in funs.items():
        r = tune(name, fun, TOL[name])
        s = pack(r["I"])
        assert np.array_equal(unpack(s, r["I"].size), r["I"].ravel())
        nseg = len(r["starts"])
        body = {"seg_days": r["seg"], "deg": r["deg"], "nseg": nseg, "q_km": r["q"], "data": s}
        if nseg != round(SPAN / r["seg"]):  # adaptive: segment lengths as seg_days / 2^k, k packed per segment
            body["split"] = "".join(B64[int(round(math.log2(r["seg"] / l)))] for l in r["lens"])
        out["bodies"][name] = body
        report[name] = {"seg_days": r["seg"], "deg": r["deg"], "nseg": nseg, "chars": len(s) + len(body.get("split", "")),
                        "max_pos_err_km": r["err_pos_km"], "rms_pos_err_km": r["rms_pos_km"], "max_vel_err_kms": r["err_vel_kms"]}
        print(f"  {name:9s} seg {r['seg']:4d} d deg {r['deg']:2d} nseg {nseg:5d}: {len(s)/1024:7.1f} KB  max |dr| {r['err_pos_km']*1000:8.3f} m"
              f"  rms {r['rms_pos_km']*1000:7.3f} m  max |dv| {r['err_vel_kms']*1e6:8.4f} mm/s", flush=True)

    # derived bodies the JS builds: Earth = emb - k*moon_geo, Moon = Earth + moon_geo; check them end to end
    b = out["bodies"]

    def ev(name, jd):
        d = b[name]
        I = unpack(d["data"], d["nseg"] * 3 * (d["deg"] + 1)).reshape(d["nseg"], 3, d["deg"] + 1)
        lens = np.array([d["seg_days"] / 2 ** B64.index(c) for c in d["split"]]) if "split" in d else np.full(d["nseg"], float(d["seg_days"]))
        starts = JD_START + np.concatenate(([0.0], np.cumsum(lens)[:-1]))
        return evaluate(I, d["q_km"], starts, lens, jd)
    rng = np.random.default_rng(7)
    jd = np.sort(rng.uniform(JD_START, JD_END, 40000))
    Pe, Ve = ev("emb", jd)
    Pg, Vg = ev("moon_geo", jd)
    for name, P, V, naif in (("earth", Pe - EARTH_K * Pg, Ve - EARTH_K * Vg, 399),
                             ("moon", Pe + (1 - EARTH_K) * Pg, Ve + (1 - EARTH_K) * Vg, 301)):
        P0, V0 = helio_ecl(naif, jd)
        dp, dv = np.linalg.norm(P - P0, axis=0), np.linalg.norm(V - V0, axis=0)
        report[name] = {"derived": True, "max_pos_err_km": float(dp.max()), "rms_pos_err_km": float(np.sqrt((dp ** 2).mean())),
                        "max_vel_err_kms": float(dv.max())}
        print(f"  {name:9s} (derived)        max |dr| {dp.max()*1000:8.3f} m  rms {np.sqrt((dp**2).mean())*1000:7.3f} m"
              f"  max |dv| {dv.max()*1e6:8.4f} mm/s")

    js = json.dumps(out, separators=(",", ":"))
    open(os.path.join(HERE, "ephem.json"), "w").write(js)
    open(os.path.join(HERE, "ephem.js"), "w").write("// generated by bake_ephem.py -- DE421 Chebyshev table for sol-engine.js\nexport default " + js + ";\n")
    report["_total_json_bytes"] = len(js)
    report["_coverage"] = [JD_START, JD_END]
    json.dump(report, open(os.path.join(HERE, "ephem_errors.json"), "w"), indent=1)

    # test vectors so the JS evaluator can be checked against DE421 directly (not inlined in the page)
    rng = np.random.default_rng(11)
    tv = {"jd": [], "bodies": {}}
    jd = np.sort(rng.uniform(JD_START, JD_END, 300))
    tv["jd"] = jd.tolist()
    for name, naif in list(NAIF.items()) + [("earth", 399), ("moon", 301)]:
        P, V = helio_ecl(naif, jd)
        tv["bodies"][name] = {"r": P.T.tolist(), "v": V.T.tolist()}
    for name in shipped_small_ids():
        P, V = funs[name](jd)
        tv["bodies"][name] = {"r": P.T.tolist(), "v": V.T.tolist()}
    json.dump(tv, open(os.path.join(HERE, "ephem_testvectors.json"), "w"))
    print(f"ephem.json {len(js)/1024:.1f} KB, total {time.perf_counter()-tic:.0f} s")


if __name__ == "__main__":
    main()
