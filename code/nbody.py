"""Test 4: independent n-body verifier for the best Earth->Mars Lambert arc.

Different code path from the Lambert solver: Cartesian equations of motion in the
heliocentric J2000-ecliptic frame (with the indirect terms for the accelerating
Sun), point-mass perturbers at DE421 positions (cubic-Hermite table), integrated
numerically with scipy's DOP853 (8th-order Dormand-Prince), rtol 1e-12.

Runs (miss = r_sc - r_Mars at the Lambert arrival epoch t_arr)
  S0         Sun only, start at Earth's centre with the Lambert v1  -> solver vs integrator
  +X         Sun + one planet X (Mars' own gravity excluded), Earth-centre start
  PLANETS    Sun + Mercury, Venus, Jupiter..Neptune (no Earth/Moon/Mars), Earth-centre start
  +MarsGrav  Sun + Mars only: what Mars' own gravity does to a centre-aimed arc
  EarthOnly  Sun + Earth, start at perigee of a departure hyperbola from a 200 km LEO
  EARTH      Sun + Earth + Moon, same LEO-hyperbola start
  FULL       Sun + Mercury..Neptune + Earth + Moon + Mars, same LEO-hyperbola start
Then the delta-v sensitivity d(miss)/d(dv) at departure and at two TCM epochs, and
the TCM / departure retarget that null the FULL-model miss (differential correction).
"""
import json
import math
import os
import sys
import time

import numpy as np
from scipy.integrate import solve_ivp

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from ephem import (DAY, ECL2EQ, EQ2ECL, GM, J2000, MU_SUN, R_EARTH, R_MARS,  # noqa: E402
                   Ephemeris, HermiteTable, iso_from_jd)
from lambert_izzo import lambert  # noqa: E402

OUT = os.path.join(os.path.dirname(HERE), "out")
PERTURBERS = [1, 2, 399, 301, 4, 5, 6, 7, 8]
NO_MARS = [1, 2, 399, 301, 5, 6, 7, 8]
NAMES = {1: "Mercury", 2: "Venus", 399: "Earth", 301: "Moon", 4: "Mars", 5: "Jupiter", 6: "Saturn", 7: "Uranus", 8: "Neptune"}
R_SOI_MARS = 2.2794e8 * (GM[4] / MU_SUN) ** 0.4
R_PARK = R_EARTH + 200.0
RTOL = 1e-12
ATOL = np.array([1e-6] * 3 + [1e-12] * 3)


class Model:
    def __init__(self, table, active):
        self.table = table
        self.idx = np.array([table.naifs.index(b) for b in active], dtype=int)
        self.gm = np.array([GM[b] for b in active])[:, None]
        self.nfev = 0

    def rhs(self, t, y):
        self.nfev += 1
        r = y[:3]
        rn = math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2])
        a = -MU_SUN * r / rn ** 3
        if len(self.idx):
            P = self.table.pos(t)[self.idx]
            d = P - r
            dn = np.sqrt((d * d).sum(axis=1))[:, None]
            pn = np.sqrt((P * P).sum(axis=1))[:, None]
            a = a + (self.gm * (d / dn ** 3 - P / pn ** 3)).sum(axis=0)
        return np.concatenate((y[3:], a))


def propagate(model, t0, y0, t1, dense=False, events=None, rtol=None):
    sol = solve_ivp(model.rhs, (t0, t1), y0, method="DOP853", rtol=rtol or RTOL, atol=ATOL,
                    dense_output=dense, events=events)
    if sol.status < 0:
        raise RuntimeError(sol.message)
    return sol


def body_pos(table, naif, t):
    return table.pos(t)[table.naifs.index(naif)]


def body_vel(table, naif, t, h=10.0):
    return (body_pos(table, naif, t + h) - body_pos(table, naif, t - h)) / (2 * h)


def hyperbola_start(r_earth, v_earth, vinf_vec, mu=GM[399], rp=R_PARK):
    """Perigee state of a geocentric departure hyperbola whose outgoing asymptote is vinf_vec.
    Plane: the minimum-inclination plane w.r.t. Earth's equator containing the asymptote."""
    vinf = np.linalg.norm(vinf_vec)
    s = vinf_vec / vinf
    s_eq = ECL2EQ @ s
    z = np.array([0.0, 0.0, 1.0])
    n_eq = z - (z @ s_eq) * s_eq
    n = EQ2ECL @ (n_eq / np.linalg.norm(n_eq))
    e = 1.0 + rp * vinf ** 2 / mu
    nu_inf = math.acos(-1.0 / e)
    p_hat = math.cos(nu_inf) * s - math.sin(nu_inf) * np.cross(n, s)
    w_hat = np.cross(n, p_hat)
    vp = math.sqrt(vinf ** 2 + 2 * mu / rp)
    b = (mu / vinf ** 2) * math.sqrt(e * e - 1)
    info = {"e": e, "vp": vp, "impact_param_km": b, "incl_eq_deg": math.degrees(math.acos(n_eq[2] / np.linalg.norm(n_eq)))}
    return np.concatenate((r_earth + rp * p_hat, v_earth + vp * w_hat)), info


def arrival_frame(table, t_arr):
    """R = Mars radial, N = Mars orbit normal, T = N x R (Mars' direction of motion)."""
    r = body_pos(table, 4, t_arr)
    v = body_vel(table, 4, t_arr)
    R = r / np.linalg.norm(r)
    N = np.cross(r, v)
    N /= np.linalg.norm(N)
    return np.vstack((R, np.cross(N, R), N))


def analyse(model, table, t0, y0, t_arr, with_moon_check=False):
    """Miss at t_arr, closest approach to Mars (+/-25 d), B-plane at Mars SOI entry, Moon pass."""
    def ev_soi(t, y):
        return np.linalg.norm(y[:3] - body_pos(table, 4, t)) - R_SOI_MARS
    ev_soi.direction = -1

    def ev_hit(t, y):
        return np.linalg.norm(y[:3] - body_pos(table, 4, t)) - R_MARS
    ev_hit.terminal = True
    ev_hit.direction = -1
    sol = propagate(model, t0, y0, t_arr + 25 * DAY, dense=True, events=[ev_soi, ev_hit])
    out = {"rhs_evals": model.nfev, "impacts_mars": bool(len(sol.t_events[1]) > 0)}
    if sol.t[-1] >= t_arr:
        d = sol.sol(t_arr)[:3] - body_pos(table, 4, t_arr)
        out["miss_vec_km"] = d.tolist()
        out["miss_km"] = float(np.linalg.norm(d))
        out["miss_RTN_km"] = (arrival_frame(table, t_arr) @ d).tolist()
    else:
        out["miss_km"] = None
    ts = np.linspace(t_arr - 25 * DAY, sol.t[-1], 4001)
    dist = np.array([np.linalg.norm(sol.sol(t)[:3] - body_pos(table, 4, t)) for t in ts])
    k = int(np.argmin(dist))
    lo, hi = ts[max(k - 1, 0)], ts[min(k + 1, len(ts) - 1)]
    for _ in range(80):
        m1, m2 = lo + 0.382 * (hi - lo), lo + 0.618 * (hi - lo)
        if np.linalg.norm(sol.sol(m1)[:3] - body_pos(table, 4, m1)) < np.linalg.norm(sol.sol(m2)[:3] - body_pos(table, 4, m2)):
            hi = m2
        else:
            lo = m1
    tca = 0.5 * (lo + hi)
    out["closest_approach_km"] = float(np.linalg.norm(sol.sol(tca)[:3] - body_pos(table, 4, tca)))
    out["tca_minus_tarr_hours"] = float((tca - t_arr) / 3600)
    out["B_km"] = None
    if len(sol.t_events[0]):
        te, ye = sol.t_events[0][0], sol.y_events[0][0]
        rr = ye[:3] - body_pos(table, 4, te)
        vv = ye[3:] - body_vel(table, 4, te)
        mu = GM[4]
        vinf2 = vv @ vv - 2 * mu / np.linalg.norm(rr)
        hm = np.linalg.norm(np.cross(rr, vv))
        out["B_km"] = float(hm / math.sqrt(vinf2))
        out["vinf_arr_kms"] = float(math.sqrt(vinf2))
        out["hyperbola_periapsis_km"] = float((-mu + math.sqrt(mu * mu + hm * hm * vinf2)) / vinf2)
    if with_moon_check:
        tt = np.linspace(t0, t0 + 5 * DAY, 5001)
        dm = np.array([np.linalg.norm(sol.sol(t)[:3] - body_pos(table, 301, t)) for t in tt])
        k = int(np.argmin(dm))
        out["moon_closest_km"] = float(dm[k])
        out["moon_closest_t_days"] = float((tt[k] - t0) / DAY)
    return out, sol


def jacobian(fun, x, h):
    J = np.zeros((3, 3))
    for k in range(3):
        e = np.zeros(3)
        e[k] = h
        J[:, k] = (fun(x + e) - fun(x - e)) / (2 * h)
    return J


def newton(fun, x0, h=1e-4, tol_km=0.5, max_iter=10):
    """Damped Newton with a fresh central-difference Jacobian each iteration."""
    x = np.array(x0, float)
    d = fun(x)
    hist = [float(np.linalg.norm(d))]
    for _ in range(max_iter):
        if hist[-1] < tol_km:
            break
        J = jacobian(fun, x, h)
        step = -np.linalg.solve(J, d)
        alpha = 1.0
        while True:
            xn = x + alpha * step
            dn = fun(xn)
            if np.linalg.norm(dn) < np.linalg.norm(d) or alpha < 1 / 256:
                break
            alpha *= 0.5
        x, d = xn, dn
        hist.append(float(np.linalg.norm(d)))
    return x, d, hist


def main():
    eph = Ephemeris()
    best = json.load(open(os.path.join(OUT, "test3_porkchop.json")))["overall_min"]
    dep_jd, tof_d = best["dep_jd"], best["tof_days"]
    arr_jd = dep_jd + tof_d
    t0, t_arr = (dep_jd - J2000) * DAY, (arr_jd - J2000) * DAY
    table = HermiteTable(eph, PERTURBERS, dep_jd - 2, arr_jd + 70)
    pE, vE = eph.helio(399, J2000, t0 / DAY)
    pM, vM = eph.helio(499, J2000, t_arr / DAY)
    v1, v2 = lambert(MU_SUN, pE, pM, tof_d * DAY)
    v1 = np.array(v1)
    vinf = v1 - vE
    res = {"arc": {"dep": iso_from_jd(dep_jd, True), "arr": iso_from_jd(arr_jd, True), "tof_days": tof_d,
                   "c3": float(vinf @ vinf), "vinf_kms": float(np.linalg.norm(vinf))}}
    print("TEST 4  n-body verification of the best arc (DOP853, rtol 1e-12, DE421 point masses)")
    print(f"Arc: dep {iso_from_jd(dep_jd, True)} TDB, TOF {tof_d:.3f} d, arr {iso_from_jd(arr_jd, True)}; "
          f"C3 {vinf @ vinf:.4f} km^2/s^2, |v_inf| {np.linalg.norm(vinf):.4f} km/s; Mars SOI radius {R_SOI_MARS:,.0f} km")
    y_center = np.concatenate((pE, v1))
    y_leo, hinfo = hyperbola_start(pE, vE, vinf)
    res["departure_hyperbola"] = hinfo
    print(f"Departure hyperbola from {R_PARK:.0f} km perigee: e {hinfo['e']:.4f}, perigee speed {hinfo['vp']:.4f} km/s, "
          f"asymptote offset {hinfo['impact_param_km']:,.0f} km, plane inclination to equator {hinfo['incl_eq_deg']:.1f} deg")
    runs = {}
    sols = {}

    def do(label, active, y0, note, moon=False):
        m = Model(table, active)
        tic = time.perf_counter()
        out, sol = analyse(m, table, t0, y0, t_arr, with_moon_check=moon)
        out.update({"perturbers": [NAMES[b] for b in active], "start": note, "seconds": time.perf_counter() - tic})
        runs[label], sols[label] = out, sol
        miss = f"{out['miss_km']:14,.3f}" if out["miss_km"] is not None else "   (impacted) "
        Bs = f"{out['B_km']:,.0f} km" if out["B_km"] is not None else "outside SOI"
        extra = f" | Moon pass {out['moon_closest_km']:,.0f} km at +{out['moon_closest_t_days']:.2f} d" if moon else ""
        print(f"  {label:10s} miss@t_arr {miss} km | closest approach {out['closest_approach_km']:12,.1f} km at "
              f"{out['tca_minus_tarr_hours']:+7.1f} h | B {Bs:>12s} | impact {str(out['impacts_mars']):5s}{extra}")

    print("\nRuns:")
    do("S0", [], y_center, "Earth centre")
    for b in (5, 2, 1, 6, 7, 8):
        do("+" + NAMES[b], [b], y_center, "Earth centre")
    do("PLANETS", [1, 2, 5, 6, 7, 8], y_center, "Earth centre")
    do("+MarsGrav", [4], y_center, "Earth centre")
    do("EarthOnly", [399], y_leo, "LEO hyperbola", moon=True)
    do("EARTH", [399, 301], y_leo, "LEO hyperbola", moon=True)
    do("FULL", PERTURBERS, y_leo, "LEO hyperbola", moon=True)

    # time-bias variant: on the hyperbola the craft runs ahead of the patched-conic straight line
    # r = v_inf * (t - t_dep) (log-growing lead). Delay perigee by lead/v_inf, measured at +10 d in the
    # pure Earth two-body problem, and re-fly Sun + Earth only.
    from kepler import propagate as kep
    rel0 = y_leo - np.concatenate((pE, vE))
    r10, _ = kep(GM[399], rel0[:3], rel0[3:], 10 * DAY)
    lead = r10 @ (vinf / np.linalg.norm(vinf)) - np.linalg.norm(vinf) * 10 * DAY
    dt_bias = lead / np.linalg.norm(vinf)
    pEb, vEb = eph.helio(399, J2000, (t0 + dt_bias) / DAY)
    y_bias, _ = hyperbola_start(pEb, vEb, vinf)
    mb = Model(table, [399])
    sb = propagate(mb, t0 + dt_bias, y_bias, t_arr)
    db = np.linalg.norm(sb.y[:3, -1] - body_pos(table, 4, t_arr))
    print(f"  EarthOnly with perigee delayed by the hyperbola's along-track lead ({lead:,.0f} km at +10 d -> {dt_bias/3600:.2f} h): "
          f"miss@t_arr {db:,.0f} km (vs {runs['EarthOnly']['miss_km']:,.0f} km)")
    res["earth_time_bias"] = {"lead_km_at_10d": float(lead), "delay_hours": float(dt_bias / 3600), "miss_km": float(db)}

    s0 = np.array(runs["S0"]["miss_vec_km"])
    parts = sum(np.array(runs["+" + NAMES[b]]["miss_vec_km"]) - s0 for b in (1, 2, 5, 6, 7, 8))
    comb = np.array(runs["PLANETS"]["miss_vec_km"]) - s0
    e_part = np.array(runs["EARTH"]["miss_vec_km"]) - s0
    full = np.array(runs["FULL"]["miss_vec_km"])
    print(f"  superposition: sum of single-planet misses {np.linalg.norm(parts):,.0f} km vs PLANETS run {np.linalg.norm(comb):,.0f} km; "
          f"EARTH part {np.linalg.norm(e_part):,.0f} km + PLANETS {np.linalg.norm(comb):,.0f} km -> |sum| {np.linalg.norm(e_part + comb):,.0f} km "
          f"vs FULL {np.linalg.norm(full):,.0f} km")
    print(f"  FULL miss in Mars R/T/N frame: radial {runs['FULL']['miss_RTN_km'][0]:,.0f}, along-track {runs['FULL']['miss_RTN_km'][1]:,.0f}, "
          f"normal {runs['FULL']['miss_RTN_km'][2]:,.0f} km")
    res["superposition"] = {"sum_single_planets_km": float(np.linalg.norm(parts)), "planets_run_km": float(np.linalg.norm(comb)),
                            "earth_moon_part_km": float(np.linalg.norm(e_part)), "earth_plus_planets_km": float(np.linalg.norm(e_part + comb))}

    # S0 vs Lambert endpoint (Sun-only numerical vs analytic)
    s0sol = sols["S0"]
    dr = np.linalg.norm(s0sol.sol(t_arr)[:3] - pM)
    dv = np.linalg.norm(s0sol.sol(t_arr)[3:] - np.array(v2))
    print(f"\nS0 check (Sun-only DOP853 vs Lambert endpoint): |dr| = {dr*1000:.2f} m, |dv| = {dv*1e6:.4f} mm/s over {tof_d:.1f} d")
    res["s0_vs_lambert"] = {"dr_m": float(dr * 1000), "dv_mm_s": float(dv * 1e6)}
    # integrator tolerance check
    m = Model(table, PERTURBERS)
    s_lo = propagate(m, t0, y_leo, t_arr, rtol=1e-10)
    s_hi = propagate(Model(table, PERTURBERS), t0, y_leo, t_arr)
    ddiff = np.linalg.norm(s_lo.y[:3, -1] - s_hi.y[:3, -1])
    s_vhi = propagate(Model(table, PERTURBERS), t0, y_leo, t_arr, rtol=1e-13)
    ddiff2 = np.linalg.norm(s_vhi.y[:3, -1] - s_hi.y[:3, -1])
    print(f"Integrator check: FULL end position, rtol 1e-10 vs 1e-12: {ddiff*1000:,.1f} m; rtol 1e-13 vs 1e-12: {ddiff2*1000:,.1f} m")
    res["integrator_rtol_1e-10_vs_1e-12_m"] = float(ddiff * 1000)
    res["integrator_rtol_1e-13_vs_1e-12_m"] = float(ddiff2 * 1000)

    # ---- delta-v sensitivity (Mars' own gravity off so the map is smooth near the aim point) ----
    targ = Model(table, NO_MARS)
    mars_arr = body_pos(table, 4, t_arr)

    def miss_from_departure(vinf_vec):
        y0, _ = hyperbola_start(pE, vE, vinf_vec)
        return propagate(targ, t0, y0, t_arr).y[:3, -1] - mars_arr

    J = jacobian(miss_from_departure, vinf, 1e-4) / 1000.0  # km per m/s
    # express departure directions in a local frame: V along v_inf, N normal to the transfer plane, B = N x V
    hN = np.cross(pE, v1)
    Nd = hN / np.linalg.norm(hN)
    Vd = vinf / np.linalg.norm(vinf)
    Bd = np.cross(Nd, Vd)
    Bd /= np.linalg.norm(Bd)
    Vd = np.cross(Bd, Nd)
    loc = {lab: float(np.linalg.norm(J @ u)) for lab, u in (("along_vinf", Vd), ("in_plane_perp", Bd), ("out_of_plane", Nd))}
    sv = np.linalg.svd(J, compute_uv=False)
    print(f"\nDelta-v sensitivity at departure |d miss / d v_inf| (km per m/s): along v_inf {loc['along_vinf']:,.0f}, "
          f"in-plane perpendicular {loc['in_plane_perp']:,.0f}, out-of-plane {loc['out_of_plane']:,.0f}; "
          f"singular values {sv[0]:,.0f} / {sv[1]:,.0f} / {sv[2]:,.0f}")
    res["sensitivity_departure_km_per_mps"] = {"local": loc, "singular_values": sv.tolist()}

    # TCMs on the uncorrected FULL (no-Mars-gravity) trajectory
    base = propagate(Model(table, NO_MARS), t0, y_leo, t_arr, dense=True)
    # mid-course epoch where the remaining transfer angle to the arrival point is ~90 deg (out-of-plane efficient)
    ts = np.linspace(t0 + 10 * DAY, t_arr - 10 * DAY, 2000)
    ang = []
    for t in ts:
        r = base.sol(t)[:3]
        ang.append(math.degrees(math.acos(np.clip(r @ mars_arr / np.linalg.norm(r) / np.linalg.norm(mars_arr), -1, 1))))
    t_mid = ts[int(np.argmin(np.abs(np.array(ang) - 90.0)))]
    res["tcm"] = {}
    for label, t_tcm in (("L+10d", t0 + 10 * DAY), ("mid-course", t_mid)):
        y_tcm = base.sol(t_tcm)
        mm = Model(table, NO_MARS)

        def miss_from_tcm(dvv, y_tcm=y_tcm, t_tcm=t_tcm, mm=mm):
            y = y_tcm.copy()
            y[3:] += dvv
            return propagate(mm, t_tcm, y, t_arr).y[:3, -1] - mars_arr

        Jt = jacobian(miss_from_tcm, np.zeros(3), 1e-4) / 1000.0
        x, dfin, hist = newton(miss_from_tcm, np.zeros(3))
        svt = np.linalg.svd(Jt, compute_uv=False)
        print(f"TCM at {label} ({(t_tcm - t0)/DAY:.0f} d after departure): {np.linalg.norm(x)*1000:,.2f} m/s; miss "
              f"{' -> '.join(f'{v:,.1f}' for v in hist)} km; sensitivity singular values "
              f"{svt[0]:,.0f} / {svt[1]:,.0f} / {svt[2]:,.0f} km per m/s")
        res["tcm"][label] = {"days_after_departure": float((t_tcm - t0) / DAY), "dv_mps": float(np.linalg.norm(x) * 1000),
                             "miss_history_km": hist, "sensitivity_singular_values_km_per_mps": svt.tolist()}

    # free-arrival-time variant: null only the B-plane miss (2 constraints, 3 unknowns -> minimum-norm
    # Gauss-Newton). Mars' gravity off; B = offset at closest approach, which is perpendicular to the
    # relative velocity.
    S_hat = None

    def bvec(model, t_start, y_start):
        nonlocal S_hat
        sol = propagate(model, t_start, y_start, t_arr + 60 * DAY, dense=True)
        tt = np.linspace(t_arr - 60 * DAY, t_arr + 60 * DAY, 2401)
        dd = np.array([np.linalg.norm(sol.sol(t)[:3] - body_pos(table, 4, t)) for t in tt])
        k = int(np.argmin(dd))
        lo, hi = tt[max(k - 1, 0)], tt[min(k + 1, len(tt) - 1)]
        for _ in range(80):
            m1, m2 = lo + 0.382 * (hi - lo), lo + 0.618 * (hi - lo)
            if np.linalg.norm(sol.sol(m1)[:3] - body_pos(table, 4, m1)) < np.linalg.norm(sol.sol(m2)[:3] - body_pos(table, 4, m2)):
                hi = m2
            else:
                lo = m1
        tca = 0.5 * (lo + hi)
        d = sol.sol(tca)[:3] - body_pos(table, 4, tca)
        if S_hat is None:
            vrel = sol.sol(tca)[3:] - body_vel(table, 4, tca)
            S_hat = vrel / np.linalg.norm(vrel)
        T_hat = np.cross(S_hat, [0.0, 0.0, 1.0])
        T_hat /= np.linalg.norm(T_hat)
        R_hat = np.cross(S_hat, T_hat)
        return np.array([d @ T_hat, d @ R_hat]), (tca - t_arr) / DAY

    def gauss_newton_b(fun, x0, h=1e-4, tol_km=1.0, max_iter=12):
        x = np.array(x0, float)
        b, tl = fun(x)
        hist = [float(np.linalg.norm(b))]
        for _ in range(max_iter):
            if hist[-1] < tol_km:
                break
            J2 = np.zeros((2, 3))
            for k in range(3):
                e = np.zeros(3)
                e[k] = h
                J2[:, k] = (fun(x + e)[0] - fun(x - e)[0]) / (2 * h)
            step = -np.linalg.pinv(J2) @ b
            alpha = 1.0
            while True:
                bn, tn = fun(x + alpha * step)
                if np.linalg.norm(bn) < np.linalg.norm(b) or alpha < 1 / 256:
                    break
                alpha *= 0.5
            x, b, tl = x + alpha * step, bn, tn
            hist.append(float(np.linalg.norm(b)))
        return x, hist, tl

    res["free_time_bplane"] = {}
    mdl_nm = Model(table, NO_MARS)
    for label, t_tcm in (("L+10d", t0 + 10 * DAY), ("mid-course", t_mid)):
        y_tcm = base.sol(t_tcm)

        def fb(dvv, y_tcm=y_tcm, t_tcm=t_tcm):
            y = y_tcm.copy()
            y[3:] += dvv
            return bvec(mdl_nm, t_tcm, y)

        x, hist, tl = gauss_newton_b(fb, np.zeros(3))
        print(f"Free-arrival-time B-plane TCM at {label}: {np.linalg.norm(x)*1000:,.2f} m/s; |B| "
              f"{' -> '.join(f'{v:,.1f}' for v in hist)} km; arrival shifts {tl:+.2f} d")
        res["free_time_bplane"][label] = {"dv_mps": float(np.linalg.norm(x) * 1000), "B_history_km": hist, "arrival_shift_days": float(tl)}

    def fbd(vv_):
        y0_, _ = hyperbola_start(pE, vE, vv_)
        return bvec(mdl_nm, t0, y0_)

    x, hist, tl = gauss_newton_b(fbd, vinf)
    print(f"Free-arrival-time B-plane departure retarget: |delta v_inf| {np.linalg.norm(x - vinf)*1000:,.2f} m/s; |B| "
          f"{' -> '.join(f'{v:,.1f}' for v in hist)} km; arrival shifts {tl:+.2f} d; C3 {x@x:.4f}")
    res["free_time_bplane"]["departure"] = {"dv_mps": float(np.linalg.norm(x - vinf) * 1000), "B_history_km": hist,
                                            "arrival_shift_days": float(tl), "c3_new": float(x @ x)}

    # departure retarget: new v_inf so the FULL (no-Mars-gravity) trajectory reaches Mars' centre at t_arr
    x, dfin, hist = newton(miss_from_departure, vinf)
    dvd = x - vinf
    print(f"Departure retarget (damped Newton): miss {' -> '.join(f'{v:,.1f}' for v in hist)} km; "
          f"|delta v_inf| {np.linalg.norm(dvd)*1000:,.2f} m/s; C3 {vinf@vinf:.4f} -> {x@x:.4f} km^2/s^2")
    res["departure_retarget"] = {"miss_history_km": hist, "dvinf_mps": float(np.linalg.norm(dvd) * 1000),
                                 "c3_new": float(x @ x), "converged": bool(hist[-1] < 0.5)}

    # attribution in delta-v terms: the departure change needed to cancel each contribution alone
    attrib = {}
    for label, active, leo in (("PLANETS (Earth-centre start)", [1, 2, 5, 6, 7, 8], False),
                               ("EarthOnly (LEO start)", [399], True),
                               ("EARTH = Earth+Moon (LEO start)", [399, 301], True)):
        mdl = Model(table, active)

        def fmiss(vv_, mdl=mdl, leo=leo):
            if leo:
                y0_, _ = hyperbola_start(pE, vE, vv_)
            else:
                y0_ = np.concatenate((pE, vE + vv_))
            return propagate(mdl, t0, y0_, t_arr).y[:3, -1] - mars_arr

        xa, _, ha = newton(fmiss, vinf)
        attrib[label] = {"dv_mps": float(np.linalg.norm(xa - vinf) * 1000), "c3_new": float(xa @ xa), "miss_history_km": ha}
        print(f"  departure change that cancels {label:31s}: {np.linalg.norm(xa - vinf)*1000:7.2f} m/s "
              f"(C3 {vinf@vinf:.4f} -> {xa@xa:.4f}); miss {ha[0]:,.0f} -> {ha[-1]:,.2f} km")
    res["departure_retarget_attribution"] = attrib
    if hist[-1] < 0.5:
        y0n, _ = hyperbola_start(pE, vE, x)
        out, _ = analyse(Model(table, PERTURBERS), table, t0, y0n, t_arr, with_moon_check=True)
        print(f"  re-flown with Mars gravity on: impacts Mars = {out['impacts_mars']}, closest approach {out['closest_approach_km']:,.1f} km "
              f"(R_Mars {R_MARS} km); Moon pass {out['moon_closest_km']:,.0f} km")
        res["departure_retarget"]["check_with_mars_gravity"] = {k: out[k] for k in ("impacts_mars", "closest_approach_km", "moon_closest_km")}
    res["runs"] = runs
    with open(os.path.join(OUT, "test4_nbody.json"), "w") as f:
        json.dump(res, f, indent=2)


if __name__ == "__main__":
    main()
