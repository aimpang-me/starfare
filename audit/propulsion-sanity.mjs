// Read-only model diagnostic. This does not certify a low-thrust trajectory.
// E/P is an optimistic lower bound with the chosen thruster operating continuously
// at its reported set point. It excludes waiting, coasting and changing solar power.
import { createRequire } from "node:module";

const E = createRequire(import.meta.url)("../world/engine/sol-page.js");
const cases = [
  ["iss", "lunar-data-center", "sf-01"],
  ["phobos", "mars-base", "sf-03"],
  ["titan", "earth", "sf-07"],
];
const departAfter = 2461700.5, endJd = 2468328.5;
const rows = cases.map(([from, to, ship]) => {
  const leg = E.R.planLeg(from, to, departAfter, "energy", endJd, ship);
  const powerW = leg.battery.set_point_w;
  const energyKwh = leg.battery.energy_kwh;
  const poweredDays = energyKwh / (powerW / 1000) / 24;
  return {
    from, to, ship, depart_after_jd: departAfter, end_jd: endJd,
    flight_days: leg.tof_days, energy_kwh: energyKwh, thruster_w: powerW,
    minimum_powered_days: poweredDays,
    energy_fits_flight_time: poweredDays <= leg.tof_days,
  };
});
process.stdout.write(JSON.stringify({
  diagnostic: "Energy divided by thruster power versus planned transit time",
  limitation: "The planner uses impulsive maneuvers. A gravitational re-flight does not establish finite-thrust feasibility.",
  rows,
}, null, 2) + "\n");
