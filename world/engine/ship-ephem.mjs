// bake_ephem.py writes ephem.json and ephem.js. This module only checks that file against the place catalog.
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { placesTable } from "./sol-engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const SERIES_NUM = ["q_km", "seg_days", "deg", "nseg"];

export function keepIds(places) {
  const ids = new Set(["emb", "moon_geo"]);
  for (const p of places) {
    if (p.kind === "planet" && p.id !== "earth") ids.add(p.id);
    else if (p.kind === "small") ids.add(p.id);
  }
  return ids;
}

export function assertProjected(baked, places) {
  const keep = keepIds(places);
  const got = new Set(Object.keys(baked.bodies));
  const extra = [...got].filter((id) => !keep.has(id)).sort();
  const missing = [...keep].filter((id) => !got.has(id)).sort();
  if (extra.length || missing.length) {
    throw new Error("ephemeris bodies and place catalog disagree: extra [" + extra.join(",") + "] missing [" + missing.join(",") + "]");
  }
  for (const id of keep) {
    const body = baked.bodies[id];
    for (const key of SERIES_NUM) {
      if (typeof body[key] !== "number" || !Number.isFinite(body[key])) {
        throw new Error("ephemeris " + id + " " + key + " is not a finite number");
      }
    }
    if (typeof body.data !== "string" || body.data.length === 0) {
      throw new Error("ephemeris " + id + " data is empty");
    }
  }
}

function readEphemeris() {
  const js = readFileSync(join(here, "ephem.js"), "utf8");
  const at = js.indexOf("export default ");
  if (at < 0) throw new Error("ephem.js has no export default");
  let body = js.slice(at + "export default ".length);
  if (body.endsWith(";\n")) body = body.slice(0, -2);
  else if (body.endsWith(";")) body = body.slice(0, -1);
  const jsonFile = readFileSync(join(here, "ephem.json"), "utf8");
  if (jsonFile !== body) throw new Error("ephem.js and ephem.json differ");
  return JSON.parse(body);
}

function main() {
  const cmd = process.argv[2];
  if (cmd === "--small-ids") {
    for (const p of placesTable()) if (p.kind === "small") console.log(p.id);
    return;
  }
  if (cmd === "--check") {
    assertProjected(readEphemeris(), placesTable());
    return;
  }
  throw new Error("usage: node world/engine/ship-ephem.mjs --check | --small-ids");
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
