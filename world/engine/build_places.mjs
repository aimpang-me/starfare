// writes places.json from sol-engine.js PLACES (node build_places.mjs)
import fs from "fs";
import { placesTable } from "./sol-engine.js";
const out = { note: "Places for the SOL page. kind planet|moon|station|small; real=false means fictional. mu km^3/s^2; " +
  "park_alt_km = the parking orbit the planner prices burns from/to (assumed). Moons/stations: circular orbits, phase arbitrary.",
  places: placesTable() };
fs.writeFileSync(new URL("./places.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(out.places.length, "places");
