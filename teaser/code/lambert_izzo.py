"""Izzo (2015) Lambert solver, implemented from the paper.

D. Izzo, "Revisiting Lambert's problem", Celest. Mech. Dyn. Astr. 121, 1-15 (2015).
Structure follows the paper (and the open-source poliastro/pykep layouts):
non-dimensional TOF equation in x (Lancaster-Blanchard variable), Householder
(4th-order) iterations, and the corrected single-rev initial guess
(poliastro issue #1362 / pykep).  Pure Python + math, no numpy in the hot path.
"""
import math

PI = math.pi


def _norm(a):
    return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _hyp2f1b(x):
    """Hypergeometric 2F1(3, 1, 5/2, x), series form (|x| < 1)."""
    if x >= 1.0:
        return math.inf
    res, term, i = 1.0, 1.0, 0
    while True:
        term = term * (3 + i) * (1 + i) / (2.5 + i) * x / (i + 1)
        res_old = res
        res += term
        if res_old == res:
            return res
        i += 1


def _compute_y(x, ll):
    return math.sqrt(1.0 - ll * ll * (1.0 - x * x))


def _compute_psi(x, y, ll):
    if -1.0 <= x < 1.0:
        return math.acos(max(-1.0, min(1.0, x * y + ll * (1.0 - x * x))))
    if x > 1.0:
        return math.asinh((y - x * ll) * math.sqrt(x * x - 1.0))
    return 0.0


def _tof_equation_y(x, y, T0, ll, M):
    if M == 0 and math.sqrt(0.6) < x < math.sqrt(1.4):
        eta = y - ll * x
        S1 = (1.0 - ll - x * eta) * 0.5
        Q = 4.0 / 3.0 * _hyp2f1b(S1)
        T_ = (eta ** 3 * Q + 4.0 * ll * eta) * 0.5
    else:
        psi = _compute_psi(x, y, ll)
        T_ = ((psi + M * PI) / math.sqrt(abs(1.0 - x * x)) - x + ll * y) / (1.0 - x * x)
    return T_ - T0


def _tof_equation(x, T0, ll, M):
    return _tof_equation_y(x, _compute_y(x, ll), T0, ll, M)


def _dT(x, y, T, ll):
    return (3.0 * T * x - 2.0 + 2.0 * ll ** 3 * x / y) / (1.0 - x * x)


def _d2T(x, y, T, dT, ll):
    return (3.0 * T + 5.0 * x * dT + 2.0 * (1.0 - ll * ll) * ll ** 3 / y ** 3) / (1.0 - x * x)


def _d3T(x, y, T, dT, ddT, ll):
    return (7.0 * x * ddT + 8.0 * dT - 6.0 * (1.0 - ll * ll) * ll ** 5 * x / y ** 5) / (1.0 - x * x)


def _halley_tmin(x0, T0, ll, tol, maxiter):
    for _ in range(maxiter):
        y = _compute_y(x0, ll)
        f1 = _dT(x0, y, T0, ll)
        f2 = _d2T(x0, y, T0, f1, ll)
        if f2 == 0.0:
            raise RuntimeError("Derivative was zero")
        f3 = _d3T(x0, y, T0, f1, f2, ll)
        x = x0 - 2.0 * f1 * f2 / (2.0 * f2 * f2 - f1 * f3)
        if abs(x - x0) < tol:
            return x
        x0 = x
    raise RuntimeError("Tmin Halley iteration failed to converge")


def _compute_T_min(ll, M, maxiter, tol):
    if ll == 1.0:
        x = 0.0
        return x, _tof_equation(x, 0.0, ll, M)
    if M == 0:
        return math.inf, 0.0
    x_i = 0.1
    T_i = _tof_equation(x_i, 0.0, ll, M)
    x = _halley_tmin(x_i, T_i, ll, tol, maxiter)
    return x, _tof_equation(x, 0.0, ll, M)


def _initial_guess(T, ll, M, lowpath):
    if M == 0:
        T_0 = math.acos(ll) + ll * math.sqrt(1.0 - ll * ll)  # eq. 19 (x = 0)
        T_1 = 2.0 * (1.0 - ll ** 3) / 3.0  # eq. 21 (x = 1)
        if T >= T_0:
            return (T_0 / T) ** (2.0 / 3.0) - 1.0
        if T < T_1:
            return 2.5 * T_1 / T * (T_1 - T) / (1.0 - ll ** 5) + 1.0
        # corrected interpolation (passes through x=0 at T_0 and x=1 at T_1)
        return math.exp(math.log(2.0) * math.log(T / T_0) / math.log(T_1 / T_0)) - 1.0
    a = ((M * PI + PI) / (8.0 * T)) ** (2.0 / 3.0)
    x0l = (a - 1.0) / (a + 1.0)
    b = ((8.0 * T) / (M * PI)) ** (2.0 / 3.0)
    x0r = (b - 1.0) / (b + 1.0)
    return max(x0l, x0r) if lowpath else min(x0l, x0r)


def _householder(x0, T0, ll, M, tol, maxiter):
    for it in range(maxiter):
        y = _compute_y(x0, ll)
        fval = _tof_equation_y(x0, y, T0, ll, M)
        T = fval + T0
        f1 = _dT(x0, y, T, ll)
        f2 = _d2T(x0, y, T, f1, ll)
        f3 = _d3T(x0, y, T, f1, f2, ll)
        x = x0 - fval * ((f1 * f1 - fval * f2 / 2.0) / (f1 * (f1 * f1 - fval * f2) + f3 * fval * fval / 6.0))
        if abs(x - x0) < tol:
            return x, it + 1
        x0 = x
    raise RuntimeError("Householder iteration failed to converge")


def _find_xy(ll, T, M, maxiter, lowpath, tol):
    if not abs(ll) < 1.0:
        raise ValueError("degenerate geometry |lambda| = 1")
    if not T > 0.0:
        raise ValueError("non-positive time of flight")
    M_max = math.floor(T / PI)
    T_00 = math.acos(ll) + ll * math.sqrt(1.0 - ll * ll)
    if T < T_00 + M_max * PI and M_max > 0:
        _, T_min = _compute_T_min(ll, M_max, maxiter, tol)
        if T < T_min:
            M_max -= 1
    if M > M_max:
        raise ValueError("No feasible solution for M=%d (M_max=%d)" % (M, M_max))
    x0 = _initial_guess(T, ll, M, lowpath)
    x, iters = _householder(x0, T, ll, M, tol, maxiter)
    return x, _compute_y(x, ll), iters


def lambert(mu, r1, r2, tof, M=0, prograde=True, lowpath=True, maxiter=35, tol=1e-13,
            ref_normal=(0.0, 0.0, 1.0), return_info=False):
    """Solve Lambert's problem with Izzo's algorithm.

    mu       gravitational parameter [L^3/T^2]
    r1, r2   position vectors [L]
    tof      time of flight [T] (> 0)
    M        number of complete revolutions
    prograde if True, motion is counter-clockwise about ref_normal
    lowpath  for M > 0 selects the low- or high-energy branch
    Returns v1, v2 (tuples) [L/T]; with return_info also a dict (x, y, iterations, transfer angle).
    """
    r1 = tuple(float(c) for c in r1)
    r2 = tuple(float(c) for c in r2)
    if not (tof > 0 and mu > 0):
        raise ValueError("tof and mu must be positive")
    c = (r2[0] - r1[0], r2[1] - r1[1], r2[2] - r1[2])
    c_n, r1_n, r2_n = _norm(c), _norm(r1), _norm(r2)
    s = 0.5 * (r1_n + r2_n + c_n)
    i_r1 = (r1[0] / r1_n, r1[1] / r1_n, r1[2] / r1_n)
    i_r2 = (r2[0] / r2_n, r2[1] / r2_n, r2[2] / r2_n)
    h = _cross(i_r1, i_r2)
    h_n = _norm(h)
    if h_n < 1e-14:
        raise ValueError("collinear position vectors: transfer plane undefined")
    i_h = (h[0] / h_n, h[1] / h_n, h[2] / h_n)
    ll = math.sqrt(max(0.0, 1.0 - min(1.0, c_n / s)))
    if _dot(i_h, ref_normal) < 0.0:
        ll = -ll
        i_t1, i_t2 = _cross(i_r1, i_h), _cross(i_r2, i_h)
    else:
        i_t1, i_t2 = _cross(i_h, i_r1), _cross(i_h, i_r2)
    if not prograde:
        ll = -ll
        i_t1 = (-i_t1[0], -i_t1[1], -i_t1[2])
        i_t2 = (-i_t2[0], -i_t2[1], -i_t2[2])
    T = math.sqrt(2.0 * mu / s ** 3) * tof
    x, y, iters = _find_xy(ll, T, M, maxiter, lowpath, tol)
    gamma = math.sqrt(mu * s / 2.0)
    rho = (r1_n - r2_n) / c_n
    sigma = math.sqrt(max(0.0, 1.0 - rho * rho))
    V_r1 = gamma * ((ll * y - x) - rho * (ll * y + x)) / r1_n
    V_r2 = -gamma * ((ll * y - x) + rho * (ll * y + x)) / r2_n
    V_t1 = gamma * sigma * (y + ll * x) / r1_n
    V_t2 = gamma * sigma * (y + ll * x) / r2_n
    v1 = tuple(V_r1 * i_r1[k] + V_t1 * i_t1[k] for k in range(3))
    v2 = tuple(V_r2 * i_r2[k] + V_t2 * i_t2[k] for k in range(3))
    if return_info:
        # transfer angle measured in the direction of motion (orbit normal r1 x v1)
        n = _cross(r1, v1)
        n_n = _norm(n)
        n = (n[0] / n_n, n[1] / n_n, n[2] / n_n)
        ang = math.degrees(math.atan2(_dot(_cross(i_r1, i_r2), n), _dot(i_r1, i_r2))) % 360.0
        return v1, v2, {"x": x, "y": y, "iterations": iters, "lambda": ll, "transfer_angle_deg": ang}
    return v1, v2
