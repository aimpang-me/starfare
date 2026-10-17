import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertProjected, keepIds } from "./ship-ephem.mjs";
import { placesTable } from "./sol-engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const ephemText = readFileSync(join(here, "ephem.js"), "utf8");
const exportAt = ephemText.indexOf("export default ");
if (exportAt < 0) throw new Error("ephem.js has no export default");
const ephem = JSON.parse(ephemText.slice(exportAt + "export default ".length).replace(/;\s*$/, ""));
const places = placesTable();

const BENNU_DATA = "5ef73c6b71a2d686f1cc21020a67cc02ae9264bb97b69fec242351a7b55a4f1e";
const CERES_DATA = "297deae073e36c23d38fd498266dc0bfb73d4fcfa316eae42543d7b87c0ff419";
const SERIES_SHA = "5f591dec3f75ceec2db1688a4ffe0629a2b773ff98d7dd83c33cfb681a815128";

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log("ok", name);
  } catch (err) {
    failed += 1;
    console.log("FAIL", name);
    console.log(err.message);
  }
}

check("placesTable has no roadster id and no roadster or tesla name", () => {
  const hits = places
    .filter((p) => p.id === "roadster" || /roadster|tesla/i.test(p.name))
    .map((p) => ({ id: p.id, name: p.name }));
  assert.deepEqual(hits, []);
});

check("Bennu subtitle is Asteroid, gravity ignored", () => {
  assert.equal(places.find((p) => p.id === "bennu").sub, "Asteroid · gravity ignored");
});

check("Ceres subtitle is Dwarf planet, 200 km orbit", () => {
  assert.equal(places.find((p) => p.id === "ceres").sub, "Dwarf planet · 200 km orbit");
});

check("ephem.bodies has no roadster key", () => {
  const present = Object.prototype.hasOwnProperty.call(ephem.bodies, "roadster");
  assert.equal(present, false, "ephem.bodies still has key roadster");
});

check("bennu.data and ceres.data hashes", () => {
  const sha = (s) => createHash("sha256").update(s).digest("hex");
  assert.equal(sha(ephem.bodies.bennu.data), BENNU_DATA);
  assert.equal(sha(ephem.bodies.ceres.data), CERES_DATA);
});

check("ephem.js still prints earth_k 0.01215058427057155", () => {
  assert.equal(ephemText.includes('earth_k":0.01215058427057155'), true);
});

check("shipped ephemeris keys are keepIds(places)", () => {
  assertProjected(ephem, places);
  const keep = [...keepIds(places)].sort();
  assert.deepEqual(Object.keys(ephem.bodies).sort(), keep);
  const lines = keep.map((id) => {
    const b = ephem.bodies[id];
    return [id, b.q_km, b.seg_days, b.deg, b.nseg].join(" ");
  });
  assert.equal(createHash("sha256").update(lines.join("\n")).digest("hex"), SERIES_SHA);
});

check("assertProjected rejects a kept body whose q_km is not a number", () => {
  const sample = [
    { id: "mars", kind: "planet" },
    { id: "bennu", kind: "small" },
  ];
  const body = (q) => ({ q_km: q, seg_days: 1, deg: 1, nseg: 1, data: "A" });
  const baked = { bodies: { emb: body(1), moon_geo: body(1), mars: body(1), bennu: body("1") } };
  assert.throws(() => assertProjected(baked, sample), /bennu q_km/);
});

check("shipped files have no roadster or tesla", () => {
  const root = join(here, "..", "..");
  const files = [
    "world/engine/sol-engine.js",
    "world/engine/sol-rides.js",
    "world/engine/sol-missions.js",
    "world/engine/sol-page.js",
    "world/engine/ephem.js",
    "world/engine/ephem.json",
    "world/engine/ephem_errors.json",
    "world/engine/ephem_testvectors.json",
    "world/engine/places.json",
    "world/engine/crosscheck_py.py",
    "world/engine/ship-ephem.mjs",
    "world/engine/bake_ephem.py",
    "world/engine/CHECK.md",
    "world/engine/crosscheck.mjs",
    "world/build.py",
    "world/template.html",
    "world/open-sky.html",
    "world/sim_rides.json",
    "connector/src/site.html",
    "connector/src/flight.html",
    "connector/src/engine/sol-page.cjs",
    "connector/src/engine/meta.json",
  ];
  const hits = [];
  for (const rel of files) {
    if (/roadster|tesla/i.test(readFileSync(join(root, rel), "utf8"))) hits.push(rel);
  }
  assert.deepEqual(hits, []);
});

if (failed) {
  console.log(failed, "failed");
  process.exit(1);
}
console.log("passed");
