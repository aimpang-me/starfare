"""The regression treats two quotes as the same ride when the route and the re-fly verdict match.
CPU SIMD kernels move the re-fly residual and the Newton count. A different departure is drift."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from run_regression import same

ROUTE = {
    "ok": True,
    "dest": "mars",
    "depart": "2026-10-31",
    "arrive": "2027-08-20",
    "tof_days": 293.0,
    "c3_km2s2": 9.18,
    "vinf_arrival_kms": 2.65,
    "launchable": True,
    "refly": {
        "raw_miss_km": 1183829.0,
        "final_miss_km": 0.648,
        "retarget_ms": 86.2,
        "iterations": 3,
        "c3_corrected_km2s2": 9.25,
        "dv_dep_corrected_kms": 3.637,
        "pass": True,
    },
}


def noisy_copy():
    out = dict(ROUTE)
    out["refly"] = dict(ROUTE["refly"])
    out["refly"]["raw_miss_km"] = 1183830.5
    out["refly"]["final_miss_km"] = 0.24
    out["refly"]["iterations"] = 2
    return out


def test_residual_noise_is_not_drift():
    assert same(ROUTE, noisy_copy())


def test_a_different_departure_is_drift():
    other = dict(ROUTE)
    other["depart"] = "2026-11-01"
    assert not same(ROUTE, other)


def test_a_failed_refly_is_drift():
    other = noisy_copy()
    other["refly"]["pass"] = False
    other["ok"] = False
    assert not same(ROUTE, other)


if __name__ == "__main__":
    test_residual_noise_is_not_drift()
    test_a_different_departure_is_drift()
    test_a_failed_refly_is_drift()
    print("passed")
