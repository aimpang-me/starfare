"""Lightweight reader for the existing SOL Chebyshev table, no SPK downloads.

The decoding follows sol-engine.js and the existing crosscheck_py.py reader.
The source table owns the coefficients; Node parity probes gate this reader.
"""
import numpy as np


class LunarEphemeris:
    def __init__(self, data, epoch_jd):
        self.epoch_seconds = (epoch_jd - 2451545.) * 86400
        self.earth_k = data["earth_k"]
        self.bodies = {}
        alphabet = {c: i for i, c in enumerate(data["alphabet"])}
        for name in ("emb", "moon_geo"):
            b = data["bodies"][name]
            vals, z, shift = [], 0, 0
            for char in b["data"]:
                c = alphabet[char]
                z |= (c & 31) << shift
                shift += 5
                if not c & 32:
                    vals.append(z // 2 if z % 2 == 0 else -(z + 1) // 2)
                    z, shift = 0, 0
            coefs = np.array(vals, float).reshape(b["nseg"], 3, b["deg"] + 1) * b["q_km"]
            lengths = np.array([b["seg_days"] / 2 ** alphabet[c] for c in b["split"]]) if "split" in b else np.full(b["nseg"], b["seg_days"])
            starts = (data["jd_start"] + np.r_[0., np.cumsum(lengths)[:-1]] - 2451545.) * 86400
            derivative = np.polynomial.chebyshev.chebder(coefs, axis=2)
            self.bodies[name] = (coefs, starts, lengths * 86400, derivative)

    def scalar(self, name, offset, velocity=False):
        coefs, starts, lengths, derivative = self.bodies[name]
        ts = float(offset) + self.epoch_seconds
        index = int(np.searchsorted(starts, ts, side="right") - 1)
        if index < 0 or index >= len(starts) or ts > starts[-1] + lengths[-1]:
            raise ValueError("Outside ephemeris coverage")
        x = 2 * (ts - starts[index]) / lengths[index] - 1
        T = [1., x]
        for _ in range(2, coefs.shape[-1]):
            T.append(2 * x * T[-1] - T[-2])
        terms = np.array(T)
        p = coefs[index] @ terms
        if velocity:
            return p, derivative[index] @ terms[:-1] * (2 / lengths[index])
        return p

    def state(self, offset):
        moon, mv = self.scalar("moon_geo", offset, True)
        emb, ev = self.scalar("emb", offset, True)
        return moon, mv, -emb + self.earth_k * moon, -ev + self.earth_k * mv

    def positions(self, offset):
        moon = self.scalar("moon_geo", offset)
        return moon, -self.scalar("emb", offset) + self.earth_k * moon

    def probes(self, offsets):
        result = []
        for t in sorted(set(offsets)):
            moon, mv, sun, sv = self.state(t)
            result.append({"offset_seconds": t, "moon_r": moon.tolist(), "moon_v": mv.tolist(),
                           "sun_r": sun.tolist(), "sun_v": sv.tolist()})
        return result
