// Proposal arithmetic only. Does not edit fleet, plan trajectories or price fares.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const E = createRequire(import.meta.url)("../world/engine/sol-page.js");
const G0 = 9.80665, finalMassKg = 1000;
const chemical = { engine_count: 4, engine_nominal_thrust_n: 425, total_thrust_n: 1700,
  isp_s: 321, bare_engine_mass_kg: 17.2, oxidizer_to_fuel_mass_ratio: 1.65,
  source: "https://www.ariane.group/app/uploads/2024/09/ArianeGroup_Chemical_Bipropellant_Thruster_Family.pdf#page=8" };
const rows = [["phobos", "mars-base", "sf-03"], ["iss", "lunar-data-center", "sf-01"], ["titan", "earth", "sf-07"]].map(([from, to, ship]) => {
  const plan = E.R.planLeg(from, to, 2461700.5, "energy", 2468328.5, ship), b = plan.battery;
  const dvMps = plan.dv_total_kms * 1000;
  const cVe = G0 * chemical.isp_s, iVe = G0 * b.isp_s;
  const cPropellant = finalMassKg * Math.expm1(dvMps / cVe);
  const iPropellant = finalMassKg * Math.expm1(dvMps / iVe);
  const iThrust = 2 * b.eff * b.set_point_w / iVe;
  return { from, to, baseline_ship: ship, impulse_delta_v_kms: plan.dv_total_kms, quoted_transit_days: plan.tof_days,
    final_nonburned_mass_kg: finalMassKg,
    ion: { point_w: b.set_point_w, isp_s: b.isp_s, propellant_kg: iPropellant,
      firing_days_at_quoted_point: iPropellant * iVe / iThrust / 86400 },
    chemical: { combined_propellant_kg: cPropellant, mmh_kg: cPropellant / 2.65, oxidizer_kg: cPropellant * 1.65 / 2.65,
      firing_minutes: cPropellant * cVe / chemical.total_thrust_n / 60,
      propellant_share_of_initial_mass: cPropellant / (finalMassKg + cPropellant) } };
});
const report = { format: "starfare.ship-options/1", proposal_only: true, chemical, rows,
  scope: "Compare the existing quote's impulsive delta-v at a normalized 1000 kg final nonburned mass. This includes hull, payload and unburned reserves; it is not a selected ship mass or tank capacity.",
  limitations: ["Four simultaneously aligned chemical engines are a proposed fictional assembly, not a sourced flown spacecraft.",
    "No finite-thrust trajectory, duty cycle, gravity loss, escape/capture or hardware integration is validated by this comparison.",
    "Ion power is the current quote's point held continuously, not a claim that it is available throughout the maneuver.",
    "Hybrid maneuver allocation is unspecified; chemical and xenon budgets cannot be combined into a claimed route yet.",
    "Chemical energy is not drawn from the ion electrical bus; valves/heaters and life support still require an electrical budget."] };
const i = process.argv.indexOf("--out");
if (i >= 0) {
  if (!process.argv[i + 1]) throw new Error("--out requires a filename");
  writeFileSync(process.argv[i + 1], JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ proposal_only: true, final_nonburned_mass_kg: finalMassKg,
  rows: rows.map((r) => ({ route: r.from + " -> " + r.to, dv_kms: r.impulse_delta_v_kms,
    ion_xenon_kg: r.ion.propellant_kg, ion_firing_days: r.ion.firing_days_at_quoted_point,
    chemical_propellant_kg: r.chemical.combined_propellant_kg, chemical_firing_minutes: r.chemical.firing_minutes })) }, null, 2));
