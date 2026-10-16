"""Two-body propagation with universal variables (Stumpff functions).

Independent of the Lambert code: used to re-propagate Lambert solutions
(r1, v1) over the time of flight and check that r2 is reached, and to
propagate the Roadster from its fetched epoch.  Reference formulation:
Curtis, "Orbital Mechanics for Engineering Students", Algorithms 3.3/3.4.
"""
import math

import numpy as np


def stumpff_C(z):
    if z > 1e-6:
        return (1.0 - math.cos(math.sqrt(z))) / z
    if z < -1e-6:
        return (math.cosh(math.sqrt(-z)) - 1.0) / (-z)
    return 1.0 / 2.0 - z / 24.0 + z * z / 720.0 - z ** 3 / 40320.0


def stumpff_S(z):
    if z > 1e-6:
        sz = math.sqrt(z)
        return (sz - math.sin(sz)) / sz ** 3
    if z < -1e-6:
        sz = math.sqrt(-z)
        return (math.sinh(sz) - sz) / sz ** 3
    return 1.0 / 6.0 - z / 120.0 + z * z / 5040.0 - z ** 3 / 362880.0


def propagate(mu, r0, v0, dt, tol=1e-15, maxiter=200):
    """Return (r, v) after dt for the two-body problem."""
    r0 = np.asarray(r0, float)
    v0 = np.asarray(v0, float)
    r0n = float(np.linalg.norm(r0))
    vr0 = float(np.dot(r0, v0)) / r0n
    alpha = 2.0 / r0n - float(np.dot(v0, v0)) / mu  # 1/a
    smu = math.sqrt(mu)
    # initial guess (Vallado)
    if alpha > 1e-12:
        chi = smu * dt * alpha
    elif alpha < -1e-12:
        a = 1.0 / alpha
        s = 1.0 if dt > 0 else -1.0
        num = -2.0 * mu * alpha * dt
        den = float(np.dot(r0, v0)) + s * math.sqrt(-mu * a) * (1.0 - r0n * alpha)
        chi = s * math.sqrt(-a) * math.log(num / den) if num / den > 0 else smu * dt / r0n
    else:
        chi = smu * dt / r0n
    def FdF(x):
        z = alpha * x * x
        C, S = stumpff_C(z), stumpff_S(z)
        F = r0n * vr0 / smu * x * x * C + (1.0 - alpha * r0n) * x ** 3 * S + r0n * x - smu * dt
        dF = r0n * vr0 / smu * x * (1.0 - alpha * x * x * S) + (1.0 - alpha * r0n) * x * x * C + r0n
        return F, dF

    # F is monotonically increasing in chi (dF/dchi = r > 0): bracket the root, then
    # safeguarded Newton (bisection fallback) -- robust for near-radial hyperbolas.
    if dt == 0.0:
        return r0.copy(), v0.copy()
    lo, hi = (0.0, None) if dt > 0 else (None, 0.0)
    probe = chi if (chi != 0.0 and math.copysign(1.0, chi) == math.copysign(1.0, dt)) else smu * dt / r0n
    while True:
        Fp, _ = FdF(probe)
        if dt > 0:
            if Fp < 0:
                lo = probe
                probe *= 2.0
            else:
                hi = probe
                break
        else:
            if Fp > 0:
                hi = probe
                probe *= 2.0
            else:
                lo = probe
                break
    chi = 0.5 * (lo + hi)
    for _ in range(maxiter):
        F, dF = FdF(chi)
        if F < 0:
            lo = chi
        else:
            hi = chi
        new = chi - F / dF
        if not (lo < new < hi):
            new = 0.5 * (lo + hi)
        if abs(new - chi) <= tol * max(1.0, abs(chi)):
            chi = new
            break
        chi = new
    else:
        raise RuntimeError("Kepler universal-variable iteration did not converge")
    z = alpha * chi * chi
    C, S = stumpff_C(z), stumpff_S(z)
    f = 1.0 - chi * chi / r0n * C
    g = dt - chi ** 3 / smu * S
    r = f * r0 + g * v0
    rn = float(np.linalg.norm(r))
    fdot = smu / (rn * r0n) * (alpha * chi ** 3 * S - chi)
    gdot = 1.0 - chi * chi / rn * C
    v = fdot * r0 + gdot * v0
    return r, v


def elements(mu, r, v):
    """Classical elements (a, e, i, raan, argp, nu) in radians for an inertial frame."""
    r = np.asarray(r, float)
    v = np.asarray(v, float)
    h = np.cross(r, v)
    rn = np.linalg.norm(r)
    e_vec = np.cross(v, h) / mu - r / rn
    e = np.linalg.norm(e_vec)
    energy = np.dot(v, v) / 2 - mu / rn
    a = -mu / (2 * energy)
    i = math.acos(h[2] / np.linalg.norm(h))
    n = np.cross([0, 0, 1.0], h)
    nn = np.linalg.norm(n)
    raan = math.atan2(n[1], n[0]) % (2 * math.pi) if nn > 0 else 0.0
    argp = math.atan2(np.dot(np.cross(n, e_vec), h) / np.linalg.norm(h), np.dot(n, e_vec)) % (2 * math.pi) if nn > 0 else 0.0
    nu = math.atan2(np.dot(np.cross(e_vec, r), h) / np.linalg.norm(h), np.dot(e_vec, r)) % (2 * math.pi)
    return a, e, i, raan, argp, nu
