"""Offline planetary ephemeris: JPL DE421 (SPK) read with jplephem.

The DE421 file comes from PyPI: package `skyfield-data` 7.0.0 ships
skyfield_data/data/de421.bsp; copied to data/de421.bsp (sha256 recorded in
REPORT.md).  Coverage 1899-07-29 .. 2053-10-09 (TDB).

Frames: DE421 is ICRF-aligned equatorial.  `helio(..., frame="ecl")` rotates to
the J2000 ecliptic with obliquity 84381.448 arcsec (the convention JPL Horizons
uses for REF_PLANE=ECLIPTIC), so states can be compared to Horizons directly.
Times are TDB Julian dates (or seconds past J2000 TDB for the integrator).
"""
import math
import os

import numpy as np
from jplephem.spk import SPK

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "de421.bsp")
J2000 = 2451545.0
DAY = 86400.0
AU_KM = 149597870.700

# GM [km^3/s^2], DE440 values (Park et al. 2021); system values for barycentres.
GM = {
    10: 1.32712440041279419e11,  # Sun
    1: 22031.868551,  # Mercury system
    2: 324858.592000,  # Venus system
    399: 398600.435507,  # Earth
    301: 4902.800118,  # Moon
    3: 398600.435507 + 4902.800118,  # Earth-Moon system
    4: 42828.375816,  # Mars system
    5: 126712764.100000,  # Jupiter system
    6: 37940584.841800,  # Saturn system
    7: 5794556.400000,  # Uranus system
    8: 6836527.100580,  # Neptune system
    9: 975.500000,  # Pluto system
}
MU_SUN = GM[10]
R_EARTH = 6378.137
R_MARS = 3396.19

EPS_J2000 = math.radians(84381.448 / 3600.0)
_ce, _se = math.cos(EPS_J2000), math.sin(EPS_J2000)
EQ2ECL = np.array([[1.0, 0.0, 0.0], [0.0, _ce, _se], [0.0, -_se, _ce]])
ECL2EQ = EQ2ECL.T

# chains from the solar-system barycentre (0) to each NAIF id in DE421
_CHAINS = {
    0: [],
    10: [(0, 10)],
    1: [(0, 1)], 199: [(0, 1), (1, 199)],
    2: [(0, 2)], 299: [(0, 2), (2, 299)],
    3: [(0, 3)], 399: [(0, 3), (3, 399)], 301: [(0, 3), (3, 301)],
    4: [(0, 4)], 499: [(0, 4), (4, 499)],
    5: [(0, 5)], 6: [(0, 6)], 7: [(0, 7)], 8: [(0, 8)], 9: [(0, 9)],
}


class Ephemeris:
    def __init__(self, path=DATA):
        self.kernel = SPK.open(path)
        self.seg = {(s.center, s.target): s for s in self.kernel.segments}

    def bary(self, naif, jd, jd2=0.0):
        """Barycentric ICRF state (km, km/s) of `naif` at TDB JD (scalar or array)."""
        pos = 0.0
        vel = 0.0
        for key in _CHAINS[naif]:
            p, v = self.seg[key].compute_and_differentiate(jd, jd2)
            pos = pos + p
            vel = vel + v
        return np.asarray(pos), np.asarray(vel) / DAY

    def helio(self, naif, jd, jd2=0.0, frame="ecl"):
        """Heliocentric state (km, km/s); frame 'ecl' (J2000 ecliptic) or 'eq' (ICRF)."""
        p, v = self.bary(naif, jd, jd2)
        ps, vs = self.bary(10, jd, jd2)
        p = p - ps
        v = v - vs
        if frame == "ecl":
            p = np.tensordot(EQ2ECL, p, axes=1)
            v = np.tensordot(EQ2ECL, v, axes=1)
        return p, v


def jd_from_iso(s):
    """'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM' (taken as TDB) -> Julian date."""
    date, _, tm = s.partition("T")
    y, m, d = (int(x) for x in date.split("-"))
    hh, mm = (int(x) for x in tm.split(":")) if tm else (0, 0)
    if m <= 2:
        y -= 1
        m += 12
    A = y // 100
    B = 2 - A + A // 4
    jd = int(365.25 * (y + 4716)) + int(30.6001 * (m + 1)) + d + B - 1524.5
    return jd + (hh + mm / 60.0) / 24.0


def iso_from_jd(jd, with_time=False):
    """TDB Julian date -> 'YYYY-MM-DD' (or with ' HH:MM', rounded to the minute)."""
    import datetime as _dt
    t = _dt.datetime(2000, 1, 1, 12, 0) + _dt.timedelta(days=float(jd) - J2000)
    if with_time:
        t = (t + _dt.timedelta(seconds=30)).replace(second=0, microsecond=0)
        return t.strftime("%Y-%m-%d %H:%M")
    return t.strftime("%Y-%m-%d")


class HermiteTable:
    """Fast heliocentric positions for many bodies: cubic Hermite interpolation of
    DE421 positions+velocities tabulated every `step_days` (default 0.25 d).
    Interpolation error (h^4/384 |r''''|): ~1e-2 km for the Moon, <1e-3 km for
    planets -- far below anything that matters for the verifier."""

    def __init__(self, eph, naifs, jd_start, jd_end, step_days=0.25, frame="ecl"):
        self.naifs = list(naifs)
        self.jd0 = jd_start - 2 * step_days
        n = int(math.ceil((jd_end + 2 * step_days - self.jd0) / step_days)) + 1
        self.h = step_days * DAY  # seconds
        self.n = n
        jds = self.jd0 + step_days * np.arange(n)
        P = np.empty((n, len(self.naifs), 3))
        V = np.empty((n, len(self.naifs), 3))
        for j, b in enumerate(self.naifs):
            p, v = eph.helio(b, jds, frame=frame)
            P[:, j, :] = p.T
            V[:, j, :] = v.T
        self.P, self.V = P, V
        self.t0 = (self.jd0 - J2000) * DAY  # seconds past J2000 TDB

    def pos(self, t):
        """t: seconds past J2000 TDB -> (n_bodies, 3) heliocentric positions [km]."""
        u = (t - self.t0) / self.h
        i = int(u)
        if i < 0 or i >= self.n - 1:
            raise ValueError("time outside Hermite table")
        s = u - i
        s2, s3 = s * s, s * s * s
        h00 = 2 * s3 - 3 * s2 + 1
        h10 = s3 - 2 * s2 + s
        h01 = -2 * s3 + 3 * s2
        h11 = s3 - s2
        return (h00 * self.P[i] + h10 * self.h * self.V[i] + h01 * self.P[i + 1] + h11 * self.h * self.V[i + 1])
