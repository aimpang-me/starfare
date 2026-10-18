// Sourced engine data for an offline proposal, never a production fleet class.
const count = 4, thrust = 425, mass = 4.30;
export const OPTION_B = Object.freeze({
  engine_count: count, engine_nominal_thrust_n: thrust, total_thrust_n: count * thrust,
  isp_s: 321, bare_engine_mass_kg: count * mass, oxidizer_to_fuel_mass_ratio: 1.65,
  source: "https://www.ariane.group/app/uploads/2024/09/ArianeGroup_Chemical_Bipropellant_Thruster_Family.pdf#page=8",
});
