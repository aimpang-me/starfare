"""Bounded 3D Earth–Moon finite-thrust shooting, offline numerical proposal."""
import json
import math
import platform
from pathlib import Path
import sys
import time

import numpy as np
import scipy
from scipy.integrate import solve_ivp
from scipy.optimize import least_squares, minimize_scalar

from lunar_ephemeris import LunarEphemeris

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "code"))
from lambert_izzo import lambert


class BudgetExhausted(Exception):
    pass


class LunarStudy:
    def __init__(self, data):
        self.data = data
        self.ephem = LunarEphemeris(data["ephemeris"], data["epoch_jd"])
        self.mu_e, self.mu_m, self.mu_s = data["earth"]["mu"], data["moon"]["mu"], data["mu_sun"]
        self.thrust = data["chemical"]["total_thrust_n"]
        self.ve = data["chemical"]["isp_s"] * 9.80665 / 1000
        self.flow = self.thrust / (self.ve * 1000)
        self.T = data["flight_days"] * 86400
        self.deadline = time.monotonic() + data["budget_seconds"]
        self.propagations = 0
        self.active_attempt = None

    def check_budget(self):
        if time.monotonic() >= self.deadline:
            raise BudgetExhausted

    def endpoint(self, kind, t):
        o = self.data[kind]
        angle = o["phase_at_epoch"] + o["n"] * t
        P, Q = np.array(o["P"]), np.array(o["Q"])
        r = o["radius_km"] * (math.cos(angle) * P + math.sin(angle) * Q)
        v = o["radius_km"] * o["n"] * (-math.sin(angle) * P + math.cos(angle) * Q)
        if kind == "target":
            p, w, _, _ = self.ephem.state(t)
            r, v = r + p, v + w
        return r, v

    def frame(self, r, v):
        er = r / np.linalg.norm(r)
        en = np.cross(r, v)
        h = np.linalg.norm(en)
        if h < 1e-10:
            raise ValueError("Degenerate RTN frame")
        en /= h
        return er, np.cross(en, er), en

    def angles(self, direction, r, v):
        er, et, en = self.frame(r, v)
        d = direction / np.linalg.norm(direction)
        return math.atan2(np.dot(d, er), np.dot(d, et)), math.asin(np.clip(np.dot(d, en), -1, 1))

    def seed(self, wait):
        r0, v0 = self.endpoint("source", wait)
        r1, v1 = self.endpoint("target", wait + self.T)
        a, b = lambert(self.mu_e, r0, r1, self.T, ref_normal=np.cross(r0, v0))
        dv0, dv1 = np.array(a) - v0, v1 - np.array(b)
        p, w, _, _ = self.ephem.state(wait + self.T)
        ad, bd = self.angles(dv0, r0, v0)
        ac, bc = self.angles(dv1, r1 - p, v1 - w)
        controls = np.array([np.linalg.norm(dv0) / self.ve, ad, bd, np.linalg.norm(dv1) / self.ve, ac, bc])
        return float(np.linalg.norm(dv0) + np.linalg.norm(dv1)), controls

    def rank_launches(self):
        rows = []
        for wait in np.arange(0, self.data["launch_window_days"] * 86400 + 1, self.data["launch_grid_seconds"]):
            self.check_budget()
            try:
                cost, controls = self.seed(wait)
                rows.append((cost, float(wait), controls))
            except (ValueError, ArithmeticError):
                pass
        candidates = []
        for _, wait, _ in sorted(rows, key=lambda x: x[0]):
            if any(abs(wait - item[1]) < 7200 for item in candidates):
                continue
            half = self.data["launch_grid_seconds"] / 2
            def objective(t):
                try:
                    return self.seed(t)[0]
                except (ValueError, ArithmeticError):
                    return 1e4
            fit = minimize_scalar(objective, bounds=(max(0, wait - half), min(self.data["launch_window_days"] * 86400, wait + half)), method="bounded", options={"xatol": .01})
            score, controls = self.seed(float(fit.x))
            candidates.append((score, float(fit.x), controls))
            if len(candidates) == self.data["retained_candidates"]:
                break
        return sorted(candidates, key=lambda x: x[0]), len(rows)

    def durations(self, x, mass):
        td = mass * math.exp(x[3]) * math.expm1(x[0]) / self.flow
        tc = mass * math.expm1(x[3]) / self.flow
        return td, tc

    def propagate(self, y, t0, t1, burn, angles, perturbation, rtol=2e-9,
                  details=False, method="DOP853", max_step=14400):
        self.check_budget()
        self.propagations += 1
        if t1 == t0:
            return y
        alpha, beta = angles
        ca, sa, cb, sb = math.cos(alpha), math.sin(alpha), math.cos(beta), math.sin(beta)

        def rhs(t, state):
            self.check_budget()
            r, v, m = state[:3], state[3:6], state[6]
            radius = np.linalg.norm(r)
            p, sun = self.ephem.positions(t)
            d, ds = p - r, sun - r
            acc = -self.mu_e * r / radius ** 3
            acc += perturbation * (self.mu_m * (d / np.linalg.norm(d) ** 3 - p / np.linalg.norm(p) ** 3)
                                   + self.mu_s * (ds / np.linalg.norm(ds) ** 3 - sun / np.linalg.norm(sun) ** 3))
            if burn:
                if burn == "capture":
                    _, mv, _, _ = self.ephem.state(t)
                    er, et, en = self.frame(r - p, v - mv)
                else:
                    er, et, en = self.frame(r, v)
                direction = cb * (ca * et + sa * er) + sb * en
                acc += self.thrust / m / 1000 * direction
            return np.r_[v, acc, -self.flow if burn else 0.]

        def earth_guard(t, state):
            return np.linalg.norm(state[:3]) - self.data["earth"]["radius_km"] - 100
        def moon_guard(t, state):
            p, _ = self.ephem.positions(t)
            return np.linalg.norm(state[:3] - p) - self.data["moon"]["radius_km"] - 1
        def earth_extremum(t, state):
            return np.dot(state[:3], state[3:6])
        def moon_extremum(t, state):
            p, mv, _, _ = self.ephem.state(t)
            return np.dot(state[:3] - p, state[3:6] - mv)
        earth_guard.terminal = moon_guard.terminal = True
        events = (earth_guard, moon_guard, earth_extremum, moon_extremum) if details else (earth_guard, moon_guard)
        result = solve_ivp(rhs, (t0, t1), y, method=method, rtol=rtol,
                           atol=[min(1e-6, rtol * 1000)] * 3 + [min(1e-10, rtol * .01)] * 3 + [1e-9], max_step=max_step,
                           events=events if perturbation >= 1 else None, dense_output=details)
        if not result.success or abs(result.t[-1] - t1) > 1e-5:
            raise ValueError("Propagation/clearance refusal")
        return result if details else result.y[:, -1]

    def mismatch(self, x, mass, wait, perturbation, rtol=2e-9, return_states=False):
        wait += x[6] if len(x) > 6 else 0.
        flight = self.T + (x[7] if len(x) > 7 else 0.)
        td, tc = self.durations(x, mass)
        if max(td, tc) > flight / 2 - 1:
            raise ValueError("Burn overlaps the matching midpoint")
        r0, v0 = self.endpoint("source", wait)
        ra, va = self.endpoint("target", wait + flight)
        a = np.r_[r0, v0, mass * math.exp(x[0] + x[3])]
        b = np.r_[ra, va, mass]
        a = self.propagate(a, wait, wait + td, "departure", x[1:3], perturbation, rtol)
        a = self.propagate(a, wait + td, wait + flight / 2, None, (0, 0), perturbation, rtol)
        b = self.propagate(b, wait + flight, wait + flight - tc, "capture", x[4:6], perturbation, rtol)
        b = self.propagate(b, wait + flight - tc, wait + flight / 2, None, (0, 0), perturbation, rtol)
        if return_states:
            return a, b
        return np.r_[(a[:3] - b[:3]) / 100000, a[3:6] - b[3:6]]

    def fit(self, seed, mass, wait, perturbation, rtol=2e-9):
        # Cartesian RTN log-impulse coordinates avoid an unidentifiable azimuth
        # when a capture direction passes near normal or its magnitude is small.
        def encode(x):
            return np.r_[np.concatenate([x[i] * np.array([math.sin(x[i+1]) * math.cos(x[i+2]),
                math.cos(x[i+1]) * math.cos(x[i+2]), math.sin(x[i+2])]) for i in (0, 3)]),
                x[6] / 1000 if len(x) > 6 else 0., x[7] / 1000 if len(x) > 7 else 0.]
        def decode(z):
            out = []
            for i in (0, 3):
                q = np.linalg.norm(z[i:i+3])
                out.extend((q, math.atan2(z[i], z[i+1]), math.asin(np.clip(z[i+2] / max(q, 1e-15), -1, 1))))
            return np.r_[out, z[6:8] * 1000]
        launch_limit = self.data["launch_correction_limit_seconds"]
        low = np.array([-2.5] * 3 + [-1.5] * 3 + [max(-launch_limit, -wait) / 1000, -43.2])
        high = np.array([2.5] * 3 + [1.5] * 3 + [min(launch_limit, self.data["launch_window_days"] * 86400 - wait) / 1000, 43.2])
        seed = np.clip(encode(seed), low + 1e-6, high - 1e-6)
        clock_anchor = seed[6:8].copy()
        launch_weight = 1e-5 if rtol > 1e-11 else 1e-2
        refusals = [0]
        def residual(z):
            try:
                return np.r_[self.mismatch(decode(z), mass, wait, perturbation, rtol=rtol), launch_weight * (z[6:8] - clock_anchor)]
            except (ValueError, ArithmeticError):
                refusals[0] += 1
                return np.full(8, 10.)
        def jacobian(z):
            base = residual(z)
            columns = []
            for j in range(8):
                # Relative steps vanish for near-zero launch offsets, hiding
                # clock sensitivity behind absolute ephemeris-time rounding.
                h = max(abs(z[j]), .1) * 2e-5 if j < 6 else max(abs(z[j]) * 2e-5, 1e-5)
                trial = z.copy()
                trial[j] += h if z[j] + h < high[j] else -h
                columns.append((residual(trial) - base) / (trial[j] - z[j]))
            return np.column_stack(columns)
        match_tolerance = 5e-7 if rtol > 1e-11 else 5e-11
        def stop_when_matched(z):
            if np.max(np.abs(residual(z)[:6])) < match_tolerance:
                raise StopIteration
        fit = least_squares(residual, seed, bounds=(low, high), jac=jacobian, x_scale="jac",
                            ftol=1e-10, xtol=1e-10, gtol=1e-10, max_nfev=60, callback=stop_when_matched)
        error = float(np.max(np.abs(fit.fun[:6])))
        controls = decode(fit.x)
        return controls, {"mass_kg": mass, "perturbation_factor": perturbation, "nfev": fit.nfev,
                       "max_scaled_match_residual": error, "residual_components": fit.fun[:6].tolist(),
                       "clock_regularization_residuals": fit.fun[6:8].tolist(),
                       "active_bounds": fit.active_mask.tolist(), "jacobian_singular_values": np.linalg.svd(fit.jac, compute_uv=False).tolist(),
                       "physical_jacobian_singular_values": np.linalg.svd(fit.jac[:6], compute_uv=False).tolist(),
                       "refused_trials": refusals[0], "optimizer_status": fit.status,
                       "converged": bool(error < 1e-6)}

    def replay(self, x, mass, wait, flight, method, rtol, coast_step, burn_step):
        td, tc = self.durations(x, mass)
        r, v = self.endpoint("source", wait)
        initial_mass = mass * math.exp(x[0] + x[3])
        y, clock = np.r_[r, v, initial_mass], wait
        minima = {"earth": float("inf"), "moon": float("inf")}
        minimum_times = {"earth": None, "moon": None}
        schedule = [(td, "departure", x[1:3]), (flight - td - tc, None, (0, 0)), (tc, "capture", x[4:6])]
        for duration, burn, angles in schedule:
            if duration == 0:
                continue
            arc = self.propagate(y, clock, clock + duration, burn, angles, 1., rtol,
                                 details=True, method=method, max_step=burn_step if burn else coast_step)
            samples = [clock, clock + duration] + list(arc.t_events[2]) + list(arc.t_events[3])
            # Segment switches and bracketed radial extrema, plus integration nodes.
            for t in samples + list(arc.t):
                state = arc.sol(t)
                moon, _ = self.ephem.positions(t)
                for body, distance in (("earth", np.linalg.norm(state[:3]) - self.data["earth"]["radius_km"]),
                                       ("moon", np.linalg.norm(state[:3] - moon) - self.data["moon"]["radius_km"])):
                    if distance < minima[body]:
                        minima[body], minimum_times[body] = distance, float(t)
            y, clock = arc.y[:, -1], clock + duration
        target_r, target_v = self.endpoint("target", wait + flight)
        return y, {"method": method, "rtol": rtol, "coast_max_step_s": coast_step, "burn_max_step_s": burn_step,
                   "arrival_position_m": float(np.linalg.norm(y[:3] - target_r) * 1000),
                   "arrival_velocity_m_s": float(np.linalg.norm(y[3:6] - target_v) * 1000),
                   "mass_balance_kg": float(abs(y[6] - mass)),
                   "minimum_earth_altitude_m": float(minima["earth"] * 1000),
                   "minimum_moon_altitude_m": float(minima["moon"] * 1000), "minimum_times_seconds_from_epoch": minimum_times}

    def verify(self, controls, mass, wait):
        controls, refinement = self.fit(controls, mass, wait, 1., rtol=5e-13)
        wait += controls[6]
        flight = self.T + controls[7]
        controls = controls[:6]
        first, a = self.replay(controls, mass, wait, flight, "DOP853", 5e-13, 1800, 60)
        second, b = self.replay(controls, mass, wait, flight, "RK45", 2e-13, 900, 30)
        delta_r = float(np.linalg.norm(first[:3] - second[:3]) * 1000)
        delta_v = float(np.linalg.norm(first[3:6] - second[3:6]) * 1000)
        clearance_difference = max(abs(a["minimum_" + body + "_altitude_m"] - b["minimum_" + body + "_altitude_m"]) for body in ("earth", "moon"))
        accepted = all(r["arrival_position_m"] < 10 and r["arrival_velocity_m_s"] < .01
                       and r["mass_balance_kg"] / mass < 1e-9 and r["minimum_earth_altitude_m"] > 100000
                       and r["minimum_moon_altitude_m"] > 1000 for r in (a, b)) and delta_r < 1 and delta_v < .001 and clearance_difference < 1
        td, tc = self.durations(controls, mass)
        propellant = mass * math.expm1(controls[0] + controls[3])
        return {"status": "verified_numerical_rendezvous" if accepted else "unresolved_forward_verification",
                "launch_wait_seconds": wait, "flight_seconds": flight, "final_nonburned_mass_kg": mass,
                "departure_mass_kg": mass + propellant, "chemical_propellant_kg": propellant,
                "mmh_kg": propellant / (1 + self.data["chemical"]["oxidizer_to_fuel_mass_ratio"]),
                "oxidizer_kg": propellant * self.data["chemical"]["oxidizer_to_fuel_mass_ratio"] / (1 + self.data["chemical"]["oxidizer_to_fuel_mass_ratio"]),
                "departure_firing_s": td, "capture_firing_s": tc, "coast_s": flight - td - tc,
                "controls": controls.tolist(), "refinement": refinement, "forward_replays": [a, b],
                "replay_difference_position_m": delta_r, "replay_difference_velocity_m_s": delta_v,
                "clearance_refinement_difference_m": float(clearance_difference),
                "source_state": np.r_[self.endpoint("source", wait)].tolist(),
                "arrival_state": second.tolist(), "arrival_target_state": np.r_[self.endpoint("target", wait + flight)].tolist()}

    def run_candidate(self, rank, wait, seed):
        controls, history = seed, []
        self.active_attempt = {"launch_wait_seconds": wait, "history": history}
        force, increment, attempts = 0., .05, 0
        resume = self.data.get("resume")
        if resume:
            controls = np.array(resume["controls"])
            force = min(1., resume["perturbation_factor"] + increment) if resume["perturbation_factor"] < 1 else 2.
        while force <= 1.:
            trial, record = self.fit(controls, 1., wait, force)
            record["controls"] = trial.tolist()
            history.append(record)
            print(json.dumps({"candidate": rank, "stage": record}), file=sys.stderr, flush=True)
            if not record["converged"]:
                if increment <= .003125 or attempts >= 12 or force == 0:
                    return {"status": "unresolved_seed", "launch_wait_seconds": wait, "history": history, "last_controls": controls.tolist()}
                force -= increment / 2
                increment /= 2
                attempts += 1
                continue
            controls = trial
            if force == 1.:
                break
            force = min(1., force + increment)
        accepted_mass, mass_step, failed_steps = resume["mass_kg"] if resume else 1., 10. if resume else 1., 0
        while accepted_mass < self.data["mass_kg"]:
            mass = min(self.data["mass_kg"], accepted_mass + mass_step)
            trial, record = self.fit(controls, mass, wait, 1.)
            record["controls"] = trial.tolist()
            history.append(record)
            print(json.dumps({"candidate": rank, "stage": record}), file=sys.stderr, flush=True)
            if not record["converged"]:
                if mass_step < .25 or failed_steps >= 12:
                    return {"status": "unresolved_mass_continuation", "launch_wait_seconds": wait, "history": history, "last_controls": controls.tolist()}
                mass_step /= 2
                failed_steps += 1
                continue
            controls, accepted_mass = trial, mass
            mass_step = min(50., mass_step * 1.7)
        try:
            result = self.verify(controls, self.data["mass_kg"], wait)
        except (ValueError, ArithmeticError) as error:
            result = {"status": "unresolved_forward_verification", "launch_wait_seconds": wait,
                      "controls": controls.tolist(), "reason": str(error)}
        result["nominal_wait_seconds"] = wait
        result["history"] = history
        return result


def main():
    data = json.load(sys.stdin)
    study = LunarStudy(data)
    attempts, ranking_count, candidates = [], 0, []
    try:
        if data.get("mode") != "ephemeris":
            if data.get("resume"):
                candidates = [(0., data["resume"]["nominal_wait_seconds"], np.array(data["resume"]["controls"]))]
            else:
                candidates, ranking_count = study.rank_launches()
        for rank, (_, wait, seed) in enumerate(candidates if data.get("mode") == "study" else []):
            result = study.run_candidate(rank, wait, seed)
            attempts.append(result)
            if result["status"] == "verified_numerical_rendezvous":
                break
    except BudgetExhausted:
        attempts.append({"status": "unresolved_budget", "propagations": study.propagations,
                         **(study.active_attempt or {})})
    offsets = list(np.linspace(137., 38 * 86400 - 117., 101))
    for attempt in attempts:
        if "flight_seconds" in attempt:
            offsets.extend([attempt["launch_wait_seconds"], attempt["launch_wait_seconds"] + attempt["flight_seconds"]])
    for _, starts, _, _ in study.ephem.bodies.values():
        for boundary in starts - study.ephem.epoch_seconds:
            if 1 < boundary < 38 * 86400 - 1:
                offsets.extend([float(boundary + delta) for delta in (-149, -1, -.001, 0, .001, 1, 149)])
    probes = study.ephem.probes(offsets)
    status = "ephemeris_parity_report" if data.get("mode") == "ephemeris" else "unresolved_search"
    if data.get("mode") == "rank":
        status = "ranked_impulse_seeds_only"
    if any(a["status"] == "verified_numerical_rendezvous" for a in attempts):
        status = "verified_numerical_rendezvous"
    report = {"format": "starfare.option-b-lunar/1", "status": status, "diagnostic_only": True,
              "source_engine_sha256": data["source_engine_sha256"], "epoch_jd": data["epoch_jd"],
              "final_nonburned_mass_kg": data["mass_kg"], "requested_flight_days": data["flight_days"],
              "ranked_launch_grid_points": ranking_count, "retained_candidates": [{"impulse_seed_kms": s, "launch_wait_seconds": w} for s, w, _ in candidates],
              "attempts": attempts, "propagations": study.propagations, "ephemeris_probes": probes,
              "chemical": data["chemical"], "input": {k: v for k, v in data.items() if k != "ephemeris"}}
    report["environment"] = {"python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__}
    report["limits"] = {"launch_correction_s": data["launch_correction_limit_seconds"], "flight_correction_s": 43200,
                        "arrival_position_m": 10, "arrival_velocity_m_s": .01,
                        "replay_position_m": 1, "replay_velocity_m_s": .001,
                        "clearance_agreement_m": 1, "relative_mass_balance": 1e-9,
                        "earth_altitude_guard_km": 100, "moon_altitude_guard_km": 1}
    print(json.dumps(report, allow_nan=False))


if __name__ == "__main__":
    main()
