"""Offline prescribed-circular Mars–Phobos flight and station rendezvous study.

Reference staging is supplied instantaneously at launch. The optional pad is a
proposed source condition, not an approved endpoint or a real landing site.
"""
import json
import math
import sys
from dataclasses import dataclass

import numpy as np
import scipy
from scipy.integrate import solve_ivp
from scipy.optimize import least_squares

LIMITS = {"arrival_position_m": 1., "arrival_velocity_m_s": .001,
          "replay_position_m": .1, "replay_velocity_m_s": .0001,
          "mass_balance_kg": 1e-6, "jacobi_relative": 1e-9, "clearance_refinement_m": .1}


@dataclass(frozen=True)
class Source:
    kind: str
    radius_from_phobos_km: float
    motion: str
    lift_seconds: float
    wait_support: str


@dataclass(frozen=True)
class Model:
    mu_mars: float
    mu_phobos: float
    phobos_orbit_km: float
    phobos_rate: float
    base_radius_km: float
    mars_radius_km: float
    envelope_km: float
    epoch_jd: float

    @property
    def base_rate(self):
        return math.sqrt(self.mu_mars / self.base_radius_km ** 3)


def rotate(xy, angle):
    c, s = math.cos(angle), math.sin(angle)
    return np.array([c * xy[0] - s * xy[1], s * xy[0] + c * xy[1]])


def initial_state(model, source, mass):
    d = source.radius_from_phobos_km
    if source.motion == "local_circular":
        vy = model.phobos_rate * model.phobos_orbit_km + math.sqrt(model.mu_phobos / d)
    elif source.motion == "body_corotation":
        vy = model.phobos_rate * (model.phobos_orbit_km + d)
    else:
        raise ValueError("Unknown source motion")
    return np.array([model.phobos_orbit_km + d, 0., 0., vy, mass])


def rotating_state(y, t, model, phase=0.):
    q = rotate(y[:2], -model.phobos_rate * t - phase)
    v = rotate(y[2:4], -model.phobos_rate * t - phase) - model.phobos_rate * np.array([-q[1], q[0]])
    return np.r_[q, v, y[4]]


def jacobi(q, model):
    x, y, vx, vy = q[:4]
    R, n = model.phobos_orbit_km, model.phobos_rate
    u = model.mu_mars / math.hypot(x, y) + model.mu_phobos / math.hypot(x - R, y) - model.mu_phobos * x / R ** 2
    return 2 * u + n * n * (x * x + y * y) - vx * vx - vy * vy


def inertial_replay(model, source, durations, mf, thrust, flow, phase=0., rtol=2e-11, max_step=60):
    firing = source.lift_seconds + durations[0] + durations[2]
    y = initial_state(model, source, mf + firing * flow)
    y[:2], y[2:4] = rotate(y[:2], phase), rotate(y[2:4], phase)
    t, min_mars, min_phobos, coasts = 0., float("inf"), float("inf"), []
    mars_min_at, phobos_min_at = 0., 0.
    schedule = [(source.lift_seconds, "lift"), (durations[0], "departure"), (durations[1], "coast"), (durations[2], "arrival")]
    for duration, kind in schedule:
        if duration == 0:
            continue
        before = rotating_state(y, t, model, phase)

        def moon(clock):
            a = model.phobos_rate * clock + phase
            return model.phobos_orbit_km * np.array([math.cos(a), math.sin(a)])

        def rhs(clock, state):
            x, z, vx, vz, mass = state
            r, p = math.hypot(x, z), moon(clock)
            dx, dz = x - p[0], z - p[1]
            d = math.hypot(dx, dz)
            ax = -model.mu_mars * x / r ** 3 - model.mu_phobos * dx / d ** 3 - model.mu_phobos * p[0] / model.phobos_orbit_km ** 3
            az = -model.mu_mars * z / r ** 3 - model.mu_phobos * dz / d ** 3 - model.mu_phobos * p[1] / model.phobos_orbit_km ** 3
            if kind != "coast":
                a = thrust / mass / 1000
                if kind == "lift":
                    ax += a * p[0] / model.phobos_orbit_km
                    az += a * p[1] / model.phobos_orbit_km
                else:
                    ax += a * z / r
                    az -= a * x / r
            return [vx, vz, ax, az, -flow if kind != "coast" else 0]

        def mars_extremum(clock, state):
            return state[0] * state[2] + state[1] * state[3]

        def phobos_extremum(clock, state):
            p = moon(clock)
            v = model.phobos_rate * np.array([-p[1], p[0]])
            return float(np.dot(state[:2] - p, state[2:4] - v))

        def mars_collision(clock, state):
            return math.hypot(*state[:2]) - model.mars_radius_km

        def phobos_envelope(clock, state):
            return float(np.linalg.norm(state[:2] - moon(clock))) - model.envelope_km

        mars_collision.terminal, mars_collision.direction = True, -1
        phobos_envelope.terminal, phobos_envelope.direction = True, -1
        result = solve_ivp(rhs, (t, t + duration), y, method="DOP853", rtol=rtol,
                           atol=[1e-10, 1e-10, 1e-13, 1e-13, 1e-9], max_step=max_step,
                           events=(mars_extremum, phobos_extremum, mars_collision, phobos_envelope))
        if not result.success or result.t[-1] < t + duration - 1e-7:
            raise ValueError("Trial hits the assumed envelope or fails propagation")
        checkpoints = [(t, y), (t + duration, result.y[:, -1])]
        for clocks, states in zip(result.t_events[:2], result.y_events[:2]):
            checkpoints.extend(zip(clocks, states))
        for clock, state in checkpoints:
            mars_alt = math.hypot(*state[:2]) - model.mars_radius_km
            phobos_clearance = float(np.linalg.norm(state[:2] - moon(clock))) - model.envelope_km
            if mars_alt < min_mars:
                min_mars, mars_min_at = mars_alt, clock
            if phobos_clearance < min_phobos:
                min_phobos, phobos_min_at = phobos_clearance, clock
        y, t = result.y[:, -1], t + duration
        if kind == "coast":
            after = rotating_state(y, t, model, phase)
            scale = model.mu_mars / model.phobos_orbit_km
            coasts.append(abs(jacobi(after, model) - jacobi(before, model)) / scale)
    return y, {"minimum_mars_altitude_km": min_mars, "minimum_phobos_envelope_clearance_km": min_phobos,
               "mars_minimum_at_seconds": float(mars_min_at), "phobos_minimum_at_seconds": float(phobos_min_at),
               "coast_jacobi_relative_drift": max(coasts, default=0.)}


def rotating_replay(model, source, durations, mf, thrust, flow, step):
    """Independent Cartesian equations in rotating axes, fixed-step RK4."""
    firing = source.lift_seconds + durations[0] + durations[2]
    y = np.r_[rotating_state(initial_state(model, source, mf + firing * flow), 0, model), 0.]
    initial_c = jacobi(y, model)
    t = 0.
    minimum_mars = math.hypot(*y[:2]) - model.mars_radius_km
    minimum_phobos = math.hypot(y[0] - model.phobos_orbit_km, y[1]) - model.envelope_km
    mars_min_at, phobos_min_at = 0., 0.
    for duration, kind in [(source.lift_seconds, "lift"), (durations[0], "departure"), (durations[1], "coast"), (durations[2], "arrival")]:
        if duration == 0:
            continue
        count = math.ceil(duration / step)
        dt = duration / count

        def rhs(state):
            x, z, vx, vz, mass = state[:5]
            R, n = model.phobos_orbit_km, model.phobos_rate
            r, d = math.hypot(x, z), math.hypot(x - R, z)
            gx = -model.mu_mars * x / r ** 3 - model.mu_phobos * (x - R) / d ** 3 - model.mu_phobos / R ** 2
            gz = -model.mu_mars * z / r ** 3 - model.mu_phobos * z / d ** 3
            ax, az = 0., 0.
            if kind != "coast":
                a = thrust / mass / 1000
                if kind == "lift":
                    ax = a
                else:
                    ax, az = a * z / r, -a * x / r
            return np.array([vx, vz, gx + 2 * n * vz + n * n * x + ax,
                             gz - 2 * n * vx + n * n * z + az, -flow if kind != "coast" else 0,
                             -2 * (vx * ax + vz * az)])

        for i in range(count):
            a = rhs(y)
            b = rhs(y + dt * a / 2)
            c = rhs(y + dt * b / 2)
            d = rhs(y + dt * c)
            y += dt * (a + 2 * b + 2 * c + d) / 6
            mars_alt = math.hypot(*y[:2]) - model.mars_radius_km
            phobos_clearance = math.hypot(y[0] - model.phobos_orbit_km, y[1]) - model.envelope_km
            if mars_alt < minimum_mars:
                minimum_mars, mars_min_at = mars_alt, t + (i + 1) * dt
            if phobos_clearance < minimum_phobos:
                minimum_phobos, phobos_min_at = phobos_clearance, t + (i + 1) * dt
        t += duration
    return y[:5], abs(jacobi(y, model) - initial_c - y[5]) / (model.mu_mars / model.phobos_orbit_km), {
        "minimum_mars_altitude_km": minimum_mars, "minimum_phobos_envelope_clearance_km": minimum_phobos,
        "mars_minimum_at_seconds": float(mars_min_at), "phobos_minimum_at_seconds": float(phobos_min_at)}


def evaluate(model, source, mf, chemical):
    thrust = chemical["total_thrust_n"]
    ve = chemical["isp_s"] * 9.80665 / 1000
    flow = thrust / (ve * 1000)
    y0 = initial_state(model, source, mf)
    r1, r2, mu = y0[0], model.base_radius_km, model.mu_mars
    a = (r1 + r2) / 2
    dv1 = abs(y0[3] - math.sqrt(mu * (2 / r1 - 1 / a)))
    dv2 = abs(math.sqrt(mu * (2 / r2 - 1 / a)) - math.sqrt(mu / r2))
    second = mf * math.expm1(dv2 / ve)
    first = (mf + second) * math.expm1(dv1 / ve)
    scale = np.array([first / flow, math.pi * math.sqrt(a ** 3 / mu), second / flow])
    vc = math.sqrt(mu / r2)

    def residual(x):
        try:
            y, _ = inertial_replay(model, source, x * scale, mf, thrust, flow)
        except ValueError:
            return np.array([10., 10., 10.])
        r = math.hypot(*y[:2])
        vr = np.dot(y[:2], y[2:4]) / r
        vt = (y[0] * y[3] - y[1] * y[2]) / r
        return [(r - r2) / r2, vr / vc, (vt - vc) / vc]

    attempts, solved = [], []
    for coast_seed in (.9, 1., 1.1):
        fit = least_squares(residual, [1., coast_seed, 1.], bounds=([.05, .5, .05], [5., 1.5, 5.]),
                            jac="3-point", x_scale="jac", max_nfev=100, ftol=1e-12, xtol=1e-12, gtol=1e-12)
        error = float(np.max(np.abs(fit.fun)))
        attempts.append({"coast_seed_factor": coast_seed, "nfev": fit.nfev, "optimizer_status": fit.status, "max_scaled_residual": error})
        if fit.success and error < 1e-10:
            solved.append(fit.x * scale)
    if not solved:
        return {"status": "unresolved_search", "attempts": attempts}
    durations = min(solved, key=np.sum)
    total = float(sum(durations) + source.lift_seconds)
    firing = float(durations[0] + durations[2] + source.lift_seconds)
    nominal, nominal_clearance = inertial_replay(model, source, durations, mf, thrust, flow)
    refined, evidence = inertial_replay(model, source, durations, mf, thrust, flow, rtol=2e-13, max_step=5)
    expected = rotating_state(refined, total, model)
    coarse, _, coarse_clearance = rotating_replay(model, source, durations, mf, thrust, flow, 2.)
    fine, work_error, fine_clearance = rotating_replay(model, source, durations, mf, thrust, flow, 1.)
    theta = math.atan2(refined[1], refined[0])
    since_j2000 = (model.epoch_jd - 2451545.) * 86400
    p0 = (model.phobos_rate * since_j2000) % (2 * math.pi)
    b0 = (model.base_rate * since_j2000) % (2 * math.pi)
    delta_rate = model.base_rate - model.phobos_rate
    wait = ((theta - (b0 - p0) - model.base_rate * total) % (2 * math.pi)) / delta_rate
    phase = (p0 + model.phobos_rate * wait) % (2 * math.pi)
    actual, _ = inertial_replay(model, source, durations, mf, thrust, flow, phase=phase, rtol=2e-13, max_step=5)
    target_angle = b0 + model.base_rate * (wait + total)
    target_r = r2 * np.array([math.cos(target_angle), math.sin(target_angle)])
    target_v = vc * np.array([-math.sin(target_angle), math.cos(target_angle)])
    evidence.update({
        "arrival_position_error_m": float(np.linalg.norm(actual[:2] - target_r)) * 1000,
        "arrival_velocity_error_m_s": float(np.linalg.norm(actual[2:4] - target_v)) * 1000,
        "free_departure_phase_used": False,
        "inertial_refinement_position_m": float(np.linalg.norm(nominal[:2] - refined[:2])) * 1000,
        "inertial_refinement_velocity_m_s": float(np.linalg.norm(nominal[2:4] - refined[2:4])) * 1000,
        "rotating_replay_position_difference_m": float(np.linalg.norm(fine[:2] - expected[:2])) * 1000,
        "rotating_replay_velocity_difference_m_s": float(np.linalg.norm(fine[2:4] - expected[2:4])) * 1000,
        "rk4_step_refinement_position_m": float(np.linalg.norm(coarse[:2] - fine[:2])) * 1000,
        "rk4_step_refinement_velocity_m_s": float(np.linalg.norm(coarse[2:4] - fine[2:4])) * 1000,
        "final_mass_error_kg": abs(float(fine[4]) - mf), "jacobi_thrust_work_relative_error": work_error,
        "clearance_replays": {"inertial_60s": nominal_clearance, "rotating_2s": coarse_clearance, "rotating_1s": fine_clearance},
        "clearance_refinement_difference_m": max(abs(record[key] - evidence[key]) * 1000
            for record in (nominal_clearance, coarse_clearance, fine_clearance)
            for key in ("minimum_mars_altitude_km", "minimum_phobos_envelope_clearance_km")),
    })
    accepted = (evidence["arrival_position_error_m"] < LIMITS["arrival_position_m"]
                and evidence["arrival_velocity_error_m_s"] < LIMITS["arrival_velocity_m_s"]
                and max(evidence[k] for k in ("inertial_refinement_position_m", "rotating_replay_position_difference_m", "rk4_step_refinement_position_m")) < LIMITS["replay_position_m"]
                and max(evidence[k] for k in ("inertial_refinement_velocity_m_s", "rotating_replay_velocity_difference_m_s", "rk4_step_refinement_velocity_m_s")) < LIMITS["replay_velocity_m_s"]
                and evidence["final_mass_error_kg"] < LIMITS["mass_balance_kg"]
                and max(evidence["coast_jacobi_relative_drift"], work_error) < LIMITS["jacobi_relative"]
                and evidence["clearance_refinement_difference_m"] < LIMITS["clearance_refinement_m"]
                and min(evidence["minimum_mars_altitude_km"], evidence["minimum_phobos_envelope_clearance_km"]) > 0)
    propellant = flow * firing
    mixture = chemical["oxidizer_to_fuel_mass_ratio"]
    return {"status": "accepted_within_model" if accepted else "unresolved_numerical_accuracy", "attempts": attempts,
            "flight_seconds": total, "launch_wait_seconds": wait, "wait_plus_flight_seconds": wait + total,
            "firing_seconds": firing, "propellant_kg": propellant, "mmh_kg": propellant / (1 + mixture),
            "oxidizer_kg": propellant * mixture / (1 + mixture), "minimum_starting_mass_kg": mf + propellant,
            "burn_schedule_seconds": {"lift": source.lift_seconds, "departure": float(durations[0]), "coast": float(durations[1]), "arrival": float(durations[2])},
            "actual_epoch_terminal_state": actual.tolist(), "actual_launch_phobos_angle_rad": phase,
            "seed_convergence": {"converged": len(solved), "flight_spread_seconds": float(np.ptp([sum(s) for s in solved])),
                                 "propellant_spread_kg": float(np.ptp([flow * (s[0] + s[2]) for s in solved]))},
            "duration_seed_seconds": scale.tolist(), "evidence": evidence}


def main():
    request = json.load(sys.stdin)
    m, p, b = request["mars"], request["phobos"], request["base"]
    model = Model(m["mu"], p["mu"], p["orbit_km"], 2 * math.pi / (p["period_days"] * 86400),
                  m["radius_km"] + b["park_alt_km"], m["radius_km"], request["collision_envelope_km"], request["epoch_jd"])
    rows = []
    for data in request["sources"]:
        source = Source(**data)
        if source.radius_from_phobos_km <= model.envelope_km or source.lift_seconds < 0:
            raise ValueError("Source must start outside the declared shape envelope")
        for mass in request["masses_kg"]:
            if not isinstance(mass, (float, int)) or not math.isfinite(mass) or mass <= 0:
                raise ValueError("Final mass must be positive and finite")
            rows.append({"source": data, "final_nonburned_mass_kg": mass, **evaluate(model, source, mass, request["chemical"])})
    report = {"format": "starfare.option-b-phobos/1", "diagnostic_only": True,
              "source_engine_sha256": request["source_engine_sha256"], "input": request,
              "model": model.__dict__, "acceptance_limits": LIMITS, "rows": rows,
              "summary": {"requested": len(rows), "accepted": sum(r["status"] == "accepted_within_model" for r in rows),
                          "starting_guesses_per_case": 3, "numpy_version": np.__version__, "scipy_version": scipy.__version__},
              "launch_alignment_repeat_seconds": 2 * math.pi / (model.base_rate - model.phobos_rate),
              "prescribed_phobos_period_seconds": 2 * math.pi / model.phobos_rate,
              "kepler_phobos_period_seconds": 2 * math.pi * math.sqrt(model.phobos_orbit_km ** 3 / (model.mu_mars + model.mu_phobos)),
              "numerics": {"primary": "inertial Cartesian DOP853 rtol2e-11 maxstep60s; replay2e-13 maxstep5s",
                           "independent": "Phobos-rotating Cartesian RK4 at2s/1s, with Coriolis/centrifugal terms",
                           "force": "Mars plus prescribed moving Phobos direct and Mars-origin indirect gravity throughout all phases",
                           "control": "20s synchronous outward lift for pad; both main burns Mars-relative transverse retrograde",
                           "search": "three coast starts .9/1/1.1, main burns .05..5 times seeds, coast .5..1.5 times half-ellipse seed"},
              "limitations": ["Prescribed circular/coplanar Phobos, point-mass gravity and spherical shape envelope; not a real ephemeris/terrain model.",
                              "The surface pad is a proposal, not a landing-site design. Its wait is supported by an assumed facility.",
                              "The21.1km reference is supplied at launch; access/preparation and orbital holding are not validated or included.",
                              "Final nonburned mass is a normalization including hull/payload/equipment and any reserve, not selected fleet hardware.",
                              "No minimum-fuel/time optimality, boarding/docking, Mars surface arrival, 3D plane change, oblateness, solar perturbation or tank/power/thermal sizing."]}
    print(json.dumps(report, allow_nan=False))


if __name__ == "__main__":
    main()
