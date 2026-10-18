"""Offline central-body, coplanar Option B study. Requires NumPy and SciPy.

This is a restricted transfer family, not a flight-qualified spacecraft model.
The live game never imports this evaluator. JSON input/output is owned by its
Node shell, which extracts current engine geometry instead of copying it here.
"""
import json
import math
import sys
from dataclasses import dataclass

import numpy as np
import scipy
from scipy.integrate import solve_ivp
from scipy.optimize import least_squares

G0 = 9.80665
LIMITS = {"arrival_position_m": 1., "arrival_velocity_m_s": .001,
          "refinement_position_m": .1, "refinement_velocity_m_s": .0001,
          "mass_balance_kg": 1e-6, "coast_relative_drift": 1e-9}


@dataclass(frozen=True)
class TransferRequest:
    primary: str
    mu_km3_s2: float
    body_radius_km: float
    from_radius_km: float
    to_radius_km: float
    final_nonburned_mass_kg: float


def positive(value, name):
    if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ValueError(name + " must be positive and finite")
    return value


def impulse_guess(q, ve, flow):
    mu, r1, r2, mf = q.mu_km3_s2, q.from_radius_km, q.to_radius_km, q.final_nonburned_mass_kg
    a = (r1 + r2) / 2
    dv1 = abs(math.sqrt(mu * (2 / r1 - 1 / a)) - math.sqrt(mu / r1))
    dv2 = abs(math.sqrt(mu / r2) - math.sqrt(mu * (2 / r2 - 1 / a)))
    second = mf * math.expm1(dv2 / ve)
    first = (mf + second) * math.expm1(dv1 / ve)
    coast = math.pi * math.sqrt(a ** 3 / mu)
    return np.array([first / flow, coast, second / flow]), dv1 + dv2


def polar_replay(q, durations, thrust, flow, rtol=2e-11):
    mu, r1, mf = q.mu_km3_s2, q.from_radius_km, q.final_nonburned_mass_kg
    sign = 1 if q.to_radius_km > r1 else -1
    y = np.array([r1, 0., 0., math.sqrt(mu / r1), mf + flow * (durations[0] + durations[2])])
    minimum = r1
    coasts = []
    for duration, burning in zip(durations, (True, False, True)):
        before = y.copy()

        def rhs(t, state):
            r, theta, vr, vt, mass = state
            return [vr, vt / r, vt * vt / r - mu / (r * r),
                    -vr * vt / r + (sign * thrust / mass / 1000 if burning else 0),
                    -flow if burning else 0]

        def radial_extremum(t, state):
            return state[2]

        def surface(t, state):
            return state[0] - q.body_radius_km

        surface.terminal, surface.direction = True, -1
        result = solve_ivp(rhs, (0, duration), y, method="DOP853", rtol=rtol,
                           atol=[1e-10, 1e-13, 1e-13, 1e-13, 1e-9],
                           max_step=120, events=(radial_extremum, surface))
        if not result.success or result.t[-1] < duration - 1e-7:
            raise ValueError("Propagation stopped before the segment ended")
        y = result.y[:, -1]
        extrema = [state[0] for state in result.y_events[0]]
        minimum = min(minimum, before[0], y[0], *extrema)
        if not burning:
            def invariants(s):
                return ((s[2] ** 2 + s[3] ** 2) / 2 - mu / s[0], s[0] * s[3])
            e0, h0 = invariants(before)
            e1, h1 = invariants(y)
            coasts.append({"relative_energy_drift": abs((e1 - e0) / e0),
                           "relative_angular_momentum_drift": abs((h1 - h0) / h0)})
    return y, minimum, coasts


def cartesian_replay(q, durations, thrust, flow, step):
    """Independent fixed-step RK4, Cartesian acceleration and mass balance."""
    mu, r1, mf = q.mu_km3_s2, q.from_radius_km, q.final_nonburned_mass_kg
    sign = 1 if q.to_radius_km > r1 else -1
    y = np.array([r1, 0., 0., math.sqrt(mu / r1), mf + flow * (durations[0] + durations[2])])
    for duration, burning in zip(durations, (True, False, True)):
        count = max(1, math.ceil(duration / step))
        dt = duration / count

        def rhs(state):
            x, z, vx, vz, mass = state
            r = math.hypot(x, z)
            a = sign * thrust / mass / 1000 if burning else 0
            return np.array([vx, vz, -mu * x / r ** 3 - a * z / r,
                             -mu * z / r ** 3 + a * x / r, -flow if burning else 0])

        for _ in range(count):
            k1 = rhs(y)
            k2 = rhs(y + dt * k1 / 2)
            k3 = rhs(y + dt * k2 / 2)
            k4 = rhs(y + dt * k3)
            y += dt * (k1 + 2 * k2 + 2 * k3 + k4) / 6
    return y


def cartesian(polar):
    r, theta, vr, vt, mass = polar
    c, s = math.cos(theta), math.sin(theta)
    return np.array([r * c, r * s, vr * c - vt * s, vr * s + vt * c, mass])


def evaluate(q, chemical):
    thrust = positive(chemical["total_thrust_n"], "thrust")
    ve = positive(chemical["isp_s"], "Isp") * G0 / 1000
    flow = thrust / (ve * 1000)
    for key, value in q.__dict__.items():
        if key != "primary":
            positive(value, key)
    if min(q.from_radius_km, q.to_radius_km) <= q.body_radius_km or q.from_radius_km == q.to_radius_km:
        raise ValueError("Distinct orbits above the surface are required")
    guess, impulse_dv = impulse_guess(q, ve, flow)
    scale = guess.copy()
    scale[1] = guess[1]
    vc2 = math.sqrt(q.mu_km3_s2 / q.to_radius_km)

    def residual(x):
        y, _, _ = polar_replay(q, x * scale, thrust, flow)
        return np.array([(y[0] - q.to_radius_km) / q.to_radius_km,
                         y[2] / vc2, (y[3] - vc2) / vc2])

    attempts, solutions = [], []
    for coast_seed in (1., .9, 1.1):
        result = least_squares(residual, [1., coast_seed, 1.], bounds=([.001, .5, .001], [5., 1.5, 5.]),
                               jac="3-point", x_scale="jac", xtol=1e-12, ftol=1e-12, gtol=1e-12, max_nfev=100)
        error = float(np.max(np.abs(result.fun)))
        attempts.append({"coast_seed_factor": coast_seed, "nfev": result.nfev,
                         "optimizer_status": result.status, "max_scaled_residual": error})
        if result.success and error < 1e-10:
            solutions.append(result.x * scale)
    if not solutions:
        return {"status": "unresolved", "attempts": attempts}
    durations = min(solutions, key=np.sum)
    y, minimum, coasts = polar_replay(q, durations, thrust, flow)
    refined, _, _ = polar_replay(q, durations, thrust, flow, 2e-13)
    expected = cartesian(refined)
    coarse = cartesian_replay(q, durations, thrust, flow, 2.)
    fine = cartesian_replay(q, durations, thrust, flow, 1.)
    total = float(sum(durations))
    burning = float(durations[0] + durations[2])
    propellant = flow * burning
    mixture = chemical["oxidizer_to_fuel_mass_ratio"]
    evidence = {
        "radius_error_m": abs(float(refined[0]) - q.to_radius_km) * 1000,
        "radial_speed_error_m_s": abs(float(refined[2])) * 1000,
        "circular_speed_error_m_s": abs(float(refined[3]) - vc2) * 1000,
        "polar_refinement_position_m": float(np.linalg.norm(cartesian(y)[:2] - expected[:2])) * 1000,
        "polar_refinement_velocity_m_s": float(np.linalg.norm(cartesian(y)[2:4] - expected[2:4])) * 1000,
        "cartesian_position_difference_m": float(np.linalg.norm(fine[:2] - expected[:2])) * 1000,
        "cartesian_velocity_difference_m_s": float(np.linalg.norm(fine[2:4] - expected[2:4])) * 1000,
        "rk4_step_refinement_position_m": float(np.linalg.norm(fine[:2] - coarse[:2])) * 1000,
        "rk4_step_refinement_velocity_m_s": float(np.linalg.norm(fine[2:4] - coarse[2:4])) * 1000,
        "final_mass_error_kg": abs(float(fine[4]) - q.final_nonburned_mass_kg),
        "minimum_altitude_km": float(minimum - q.body_radius_km),
        "coast_invariants": coasts,
    }
    accepted = (evidence["radius_error_m"] < LIMITS["arrival_position_m"]
                and max(evidence["radial_speed_error_m_s"], evidence["circular_speed_error_m_s"]) < LIMITS["arrival_velocity_m_s"]
                and max(evidence["polar_refinement_position_m"], evidence["cartesian_position_difference_m"],
                        evidence["rk4_step_refinement_position_m"]) < LIMITS["refinement_position_m"]
                and max(evidence["polar_refinement_velocity_m_s"], evidence["cartesian_velocity_difference_m_s"],
                        evidence["rk4_step_refinement_velocity_m_s"]) < LIMITS["refinement_velocity_m_s"]
                and evidence["final_mass_error_kg"] < LIMITS["mass_balance_kg"] and evidence["minimum_altitude_km"] > 0
                and all(max(c.values()) < LIMITS["coast_relative_drift"] for c in coasts))
    return {"status": "accepted_within_model" if accepted else "unresolved_numerical_accuracy",
            "flight_seconds": total, "firing_seconds": burning, "coast_seconds": float(durations[1]),
            "burn_schedule_seconds": {"departure": float(durations[0]), "coast": float(durations[1]), "arrival": float(durations[2])},
            "propellant_kg": propellant, "mmh_kg": propellant / (1 + mixture),
            "oxidizer_kg": propellant * mixture / (1 + mixture),
            "minimum_starting_mass_kg": q.final_nonburned_mass_kg + propellant,
            "initial_acceleration_m_s2": thrust / (q.final_nonburned_mass_kg + propellant),
            "final_acceleration_m_s2": thrust / q.final_nonburned_mass_kg,
            "impulsive_reference": {"flight_seconds": float(guess[1]), "dv_kms": impulse_dv,
                                    "propellant_kg": q.final_nonburned_mass_kg * math.expm1(impulse_dv / ve)},
            "transfer_angle_rad": float(refined[1]), "terminal_cartesian_unrotated": fine.tolist(),
            "seed_convergence": {"converged": len(solutions),
                                 "flight_spread_seconds": float(np.ptp([sum(s) for s in solutions])),
                                 "propellant_spread_kg": float(np.ptp([flow * (s[0] + s[2]) for s in solutions]))},
            "attempts": attempts, "evidence": evidence}


def main():
    request = json.load(sys.stdin)
    chemical, epoch = request["chemical"], request["epoch_jd"]
    rows = []
    for pair in request["pairs"]:
        for reverse in (False, True):
            for mass in request["final_masses_kg"]:
                r1, r2 = pair["parking_radius_km"], pair["station_radius_km"]
                if reverse:
                    r1, r2 = r2, r1
                q = TransferRequest(pair["primary"], pair["mu_km3_s2"], pair["body_radius_km"], r1, r2, mass)
                row = {"route": (pair["station_name"] + " -> " + pair["primary_name"] + " parking orbit") if reverse else (pair["primary_name"] + " parking orbit -> " + pair["station_name"]),
                       "final_nonburned_mass_kg": mass, "scope": "parking_orbit_arrival" if reverse else "model_station_match_with_free_departure_phase",
                       "input": q.__dict__, **evaluate(q, chemical)}
                if row["status"].startswith("accepted"):
                    n = math.sqrt(pair["mu_km3_s2"] / pair["station_radius_km"] ** 3)
                    station_at_departure = (n * ((epoch - 2451545.) * 86400)) % (2 * math.pi)
                    rotation = station_at_departure if reverse else (station_at_departure + n * row["flight_seconds"] - row["transfer_angle_rad"]) % (2 * math.pi)
                    row["departure_phase_rad"] = rotation
                    row["departure_phase_kind"] = "modeled_station_phase" if reverse else "required_free_parking_phase"
                    row["phase_wait_seconds"] = None
                    if not reverse:
                        arrival = rotation + row["transfer_angle_rad"]
                        target = station_at_departure + n * row["flight_seconds"]
                        phase_error = math.atan2(math.sin(arrival - target), math.cos(arrival - target))
                        row["evidence"]["modeled_station_phase_error_m"] = abs(phase_error) * r2 * 1000
                rows.append(row)
    result = {"format": "starfare.option-b-local/1", "diagnostic_only": True,
              "source_engine_sha256": request["source_engine_sha256"], "chemical": chemical,
              "epoch_jd": epoch, "geometry": request["pairs"], "rows": rows,
              "summary": {"requested": len(rows), "accepted": sum(r["status"] == "accepted_within_model" for r in rows),
                          "starting_guesses_per_case": 3, "numpy_version": np.__version__, "scipy_version": scipy.__version__},
              "numerics": {"primary": "polar DOP853, rtol 2e-11; replay 2e-13", "independent": "Cartesian fixed-step RK4 at 2s and 1s",
                           "acceptance_limits": LIMITS,
                           "control": "pure transverse; both burns prograde outward, retrograde inward",
                           "search": "Three Hohmann-neighborhood seeds; burn durations .001..5 times impulse seeds; coast .5..1.5 times Hohmann flight"},
              "limitations": ["Restricted coplanar central-gravity burn/coast/burn family, not minimum fuel or minimum time optimization.",
                              "Station phase is the fictional circular model; free parking departure phase excludes scheduling, boarding and access wait.",
                              "Final nonburned mass includes hull, people, equipment and any reserve: it is a normalization, not a selected ship design.",
                              "Consumed propellant is MMH plus oxidizer. No tank, pressurization, electrical or thermal system has been sized.",
                              "No surface takeoff/landing, atmosphere, docking approach, plane change, oblateness, third-body gravity or navigation margin.",
                              "Phobos-Mars and ISS-Moon require additional encounter and moon escape/capture physics; no trip time is certified for them."]}
    print(json.dumps(result, allow_nan=False))


if __name__ == "__main__":
    main()
