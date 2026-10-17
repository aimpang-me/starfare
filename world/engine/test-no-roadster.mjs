import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { placesTable } from "./sol-engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const ephemText = readFileSync(join(here, "ephem.js"), "utf8");
const exportAt = ephemText.indexOf("export default ");
if (exportAt < 0) throw new Error("ephem.js has no export default");
const ephem = JSON.parse(ephemText.slice(exportAt + "export default ".length).replace(/;\s*$/, ""));
const places = placesTable();

const BENNU_DATA = "5ef73c6b71a2d686f1cc21020a67cc02ae9264bb97b69fec242351a7b55a4f1e";
const CERES_DATA = "297deae073e36c23d38fd498266dc0bfb73d4fcfa316eae42543d7b87c0ff419";

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

if (failed) {
  console.log(failed, "failed");
  process.exit(1);
}
console.log("passed");
