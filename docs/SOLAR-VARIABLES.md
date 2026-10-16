# Solar system variables (2026-10-16)

Alvin's workbook `Documents\Solar_System_Environment_Variables.xlsx` (sheets "Planets" and "Assumptions") lists real values for the eight planets: orbits, sunlight, atmosphere, weather, magnetic fields, space weather, radiation and signal delay. His direction: follow the real values and hazards in the workbook, apply them in the calculations, add what is missing, and cut what the game does not need but list it.

This note says which workbook values the engine now uses, what was added beyond the workbook, what stays simulated, what was cut, and which workbook values look wrong. Every number below comes from the workbook, the engine (`world/engine/sol-rides.js`, `sol-engine.js`) or a run of the engine on this branch.

## Applied

Four constants from the Assumptions sheet now drive the hazards. They sit at the top of `sol-rides.js` and are exported on `R`.

| Constant | Value | Workbook source | Used for |
|---|---|---|---|
| `C_KMS` | 299792.458 km/s | Speed of light, exact (SI) | Signal delay between Earth and the car |
| `AU_KM` | 149597870.7 km | Astronomical unit (IAU) | How strong a storm still is at a place |
| `CME_KMS` | 1500 km/s | Fast CME speed, held constant | When a storm reaches a place |
| `CRUISE_MSV_DAY` | 1.84 mSv/day | Curiosity RAD, cruise to Mars | Rider dose |

**Solar storms travel.** A flare erupts at the Sun and its storm reaches a place `distance / 1500 km/s` later, using the place's real distance from the Sun on that day (DE421). Its strength falls as 1/r², so the share of storms strong enough to ground a launch is `min(1, (1 AU / r)²)`: every storm counts inside Earth's orbit, and about 1 in 87 reaches Saturn. This is the workbook's "Fast CME travel time" and "Flare and solar-storm intensity vs Earth" rows, computed from the live distance instead of the mean.

Measured on seed 1 over 1500 sky days, storms that ground launches: Sun 320, Mercury 320, Earth 315, Mars Base 147, Ceres 38, Europa 8, Titan 2, Triton 0. A storm takes about 27.2 h to reach Earth, 70.8 h to reach Ceres (share 0.153) and about 257 h to reach Saturn (share about 0.0115). The workbook's mean-distance figures are 27.7 h for Earth and 265.2 h for Saturn.

`flareAt(jd, place)` and `flareForecast(fromJd, days, seed, place)` take the place. The forecast blends the Sun's odds for the eruption days that land on each sky day, times the share. Without a place they keep the old meaning, the odds at the Sun.

**Signal delay.** The dispatcher works from Earth (a simulated assumption; see open questions). A checkpoint's news takes the one-way light time to reach Earth, and the answer takes as long back, so the car acts at `reply_jd = sky_at + 2 × one-way`. Measured one-way delays: Mars 6 to 19 min, Ceres 14.2 min in the flare test, Saturn system 77 to 84 min. The workbook's best and worst cases bracket these (Mars 3.0 to 22.3 min, Saturn 67.0 to 92.2 min).

What the delay changes:
- A launch hold's correction burn is priced as if the car leaves when the answer arrives (`correction_kwh_if_it_left_on_reply`).
- A replan must depart at or after `reply_jd`. The connector's `depart_after_min` and its error messages say so.
- After "wait", the car stays on the pad until at least `reply_jd`. If the hazard cleared sooner, the ride logs an `awaiting_answer` incident for the extra ground time. Of the 100 fixture par rides, 2 do this: titan-home seed 10 (the haze lasted 0.6 h, the round trip 2.8 h) and ceres-shift seed 17.
- A hold for N hours counts from `reply_jd`.
- A divert happens at `reply_jd`. If the pad opens before the answer arrives, the car lands where it is and logs `divert_overtaken`.
- Hindsight (regret) measures from `reply_jd` too. The Mars Base dust case's best answer moved from "divert to Phobos, wait 88.4 h" (44358 kWh) to "wait 88.2 h" (44419 kWh).

**Rider dose.** Every finished ride reports `rider_dose_msv = 1.84 × days from pickup to arrival`. It is a ceiling. Stations inside a magnetosphere get less, and storms and shielding are not modelled. Fixture par rides: ISS Crew 9.3 to 11.9 mSv, Phobos Commute 0.3 to 2.7, Jovian Hop 3.9 to 4.8, Ceres Shift 1011 to 3380, Titan Home 2878 to 3549. It is shown in `fly()`, `score()`, the connector's ride result and the Open Sky page. It does not change the score.

**Radii and atmospheres.** Mercury's radius is now the workbook's equatorial 2440.5 km (was the mean radius 2439.4 km). Venus, Jupiter, Saturn, Uranus and Neptune now carry `atmosphere: true`, as the workbook's surface-pressure row shows. The flag only adds an "entry speed" line to a plan's not-priced list when it arrives without a capture burn.

## Where it shows

- **Connector.** `space_weather` takes an optional `place` (id or name; default the open checkpoint's place, else the pickup). It returns `place`, `storm_travel_hours` and `storm_share`, and its note names the 1500 km/s speed and the 1/r² rule. A checkpoint shows `signal_delay_minutes`, `reply_arrives` and a `signal` line. A finished ride shows `rider_dose_msv`. The game rules text tells the bot it dispatches from Earth.
- **Open Sky page.** The same checkpoint fields, the dose, and incident labels for "Awaiting answer" and "Divert overtaken".
- **Fixture.** `world/engine/fixtures/fly-baseline.json` was recaptured, because storms now reach each place at a different time. Par for ceres-shift seed 1 went from 56183 to 85063 kWh.

## Confirmed

These workbook values match what the engine already used, so nothing changed:
- Radii of Venus, Earth (6378.1 km), Mars (3396.2 km) and the four giants.
- Orbits, distances, eccentricities and periods. The engine takes them from the NASA JPL DE421 ephemeris, which is more precise than the fact-sheet means.
- Surface gravity and escape velocity. They follow from GM and radius, which the engine has. Jupiter and Saturn read 23.1 and 9.0 m/s² in the workbook against 24.79 and 10.45 from GM/R². The workbook's values are the fact sheet's equatorial gravity, which includes spin.
- Mars dust storms and Titan haze as the local weather that closes pads. The workbook confirms planet-wide Mars storms that can last months.

## Kept simulated

The workbook has no values for these, so they stay simulated and labelled so:
- Flare frequency, spell length and storm duration (27-day spells, 4 to 48 h storms).
- Dust storm and haze odds and lengths. Real global Mars storms last weeks to months, and the engine's run 1 to 4 days.
- Berths, traffic and unscheduled dockings.
- Correction burn (2% of the leg per hour late, up to 30%) and holding energy.
- That the dispatcher is at Earth.

## Cut, and listed

The workbook rows below do not change any ride, so the engine does not use them:
- Orbital: perihelion, aphelion, eccentricity, mean distance and year length (all from DE421 instead); season length; sidereal rotation; solar day; axial tilt.
- Sunlight and temperature: irradiance, sunlight vs Earth, sunlight swing, Bond albedo, black-body temperature, mean, minimum, maximum and swing, temperatures at 1 bar and 0.1 bar.
- Atmosphere: surface pressure values (used only as the atmosphere flag), air density, scale height, molecular weight, composition, clouds.
- Weather: peak winds, where they happen, signature storms, lightning, precipitation.
- Magnetic field: global field, dipole strength, moment, surface range, tilt, offset, magnetopause standoff, auroras.
- Space weather: solar wind density, slow wind speed, dynamic pressure, interplanetary field, Parker spiral angle, flare light delay (the storm uses the CME speed), slow-wind travel time, surface protection.
- Radiation: Earth and Mars surface dose, surface vs cruise, radiation belts, surface UV, galactic cosmic rays.
- Surroundings: moon counts, rings, closest and farthest distance to Earth (the engine uses the live distance), impact hazard.
- Assumptions: solar wind density at 1 AU, slow wind speed, radial field at 1 AU, Sun rotation rate, proton mass, standard gravity.

## Suspect workbook values

Worth fixing in the workbook. None of them feed the engine.
- Earth's Bond albedo 0.294 does not give its own 254 K black-body temperature; 0.306 does.
- Venus peak wind 100 m/s, but its own source says about 90 m/s.
- Earth peak wind 100 m/s has no source.
- Mars air density 0.016 kg/m³ and molecular weight 43.49 g/mol need a check against the Mars fact sheet.
- Earth surface dose uses 0.39 mSv/yr, which is only the cosmic-ray part at sea level, not the full UNSCEAR average.
- Uranus has 28 moons in the workbook; the count may be stale.
- Derived rows (AU, km/h, × Earth) are coloured as sourced in places.
- The workbook has no moons, no Ceres and no flare frequency, and the length of global Mars storms has no source.

## Open questions

Also in `docs/OPEN-QUESTIONS.md`.
1. **Where does the dispatcher sit?** Earth now (simulated). A dispatcher near each region (Mars, Jupiter, Saturn) would cut the delay to seconds there.
2. **Dose limits.** Ceres and Titan rides give 1 to 3.5 Sv at the cruise rate, against NASA-STD-3001's 600 mSv career limit. Score it, cap it, or only show it?
3. **Flare frequency.** Keep the simulated spells, or fit them to a real solar cycle?
4. **CME direction.** Every storm now goes everywhere, thinned by 1/r². Real CMEs are cones aimed one way. Add direction?
5. **Mars Base is an orbit station** with Mars dust weather. Keep it that way?
