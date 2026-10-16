"""Stated, made-up-on-purpose models for the ride-hail layer. Physics numbers come from the planner and
the re-fly; these turn them into 'battery used' and a fare. Every receipt prints these assumptions."""
import math
CAR_DRY_KG, PACK_KWH = 1300.0, 200.0            # Roadster-class car and pack (assumed)
EXHAUST_KMS, THRUSTER_EFF = 30.0, 0.60          # ideal electric thruster (assumed)
USD_PER_KWH, USD_PER_MIN = 0.16, 0.35           # electricity + ride-hail time fee (assumed)
ASSUMPTIONS = [f"car {CAR_DRY_KG:.0f} kg dry with a {PACK_KWH:.0f} kWh pack",
               f"electric thruster: {EXHAUST_KMS:.0f} km/s exhaust, {THRUSTER_EFF:.0%} efficient, burns treated as instant",
               f"fare = ${USD_PER_KWH}/kWh energy + ${USD_PER_MIN}/min time fee",
               "landing, aerobraking and life support are not priced"]

def battery(dv_kms):
    m_prop = CAR_DRY_KG * (math.exp(dv_kms / EXHAUST_KMS) - 1)
    kwh = 0.5 * m_prop * (EXHAUST_KMS * 1000) ** 2 / THRUSTER_EFF / 3.6e6
    return {"dv_kms": round(dv_kms, 3), "propellant_kg": round(m_prop, 1), "energy_kwh": round(kwh),
            "battery_pct": round(100 * kwh / PACK_KWH)}

def fare(kwh, days, doge_usd=None):
    usd = kwh * USD_PER_KWH + days * 1440 * USD_PER_MIN
    out = {"energy_usd": round(kwh * USD_PER_KWH, 2), "time_usd": round(days * 1440 * USD_PER_MIN, 2), "total_usd": round(usd, 2)}
    if doge_usd: out.update({"doge_rate_usd": doge_usd, "total_doge": round(usd / doge_usd)})
    return out
