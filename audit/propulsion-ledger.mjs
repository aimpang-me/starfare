// Generate a diagnostic artifact from real full plans. This is not a test suite.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { adaptFullPlans } from "../world/engine/propulsion-adapter.mjs";
import { assessItinerary } from "../world/engine/propulsion-ledger.mjs";

const E = createRequire(import.meta.url)("../world/engine/sol-page.js");
const root = new URL("../", import.meta.url), requestJd = 2461700.5, endJd = 2468328.5;
const source = readFileSync(new URL("world/engine/sol-page.js", root));
const sha = createHash("sha256").update(source).digest("hex");
const suite = JSON.parse(readFileSync(new URL("connector/src/suites/v1.json", root)));
const meta = JSON.parse(readFileSync(new URL("connector/src/engine/meta.json", root)));
if (!source.equals(readFileSync(new URL("connector/src/engine/sol-page.cjs", root))) || sha !== meta.sha256 || sha !== suite.engine_sha256)
  throw new Error("Current engine source/copy/metadata/suite do not agree");

function bookingCase(id, ship) {
  const h = E.R.BY[id], car = E.R.CAR[ship];
  const pickup = E.R.planLeg(car.at, h.from, requestJd, "energy", endJd, ship);
  const ride = E.R.planLeg(h.from, h.to, pickup.arr_jd + E.R.DWELL, "energy", endJd, ship);
  return { id: id + "/" + ship, ship,
    stops: [{ at: car.at }, { at: h.from, board: [id] }, { at: h.to, alight: [id] }], plans: [pickup, ride] };
}
function directCase(from, to, ship) {
  return { id: from + "/" + to + "/" + ship, ship, stops: [{ at: from }, { at: to }],
    plans: [E.R.planLeg(from, to, requestJd, "energy", endJd, ship)] };
}
const requests = [bookingCase("iss-crew", "sf-01"), bookingCase("phobos-commute", "sf-03"),
  bookingCase("iss-crew", "sf-04"), bookingCase("titan-home", "sf-05"),
  directCase("iss", "titan", "sf-01"), directCase("iss", "ceres-port", "sf-01"), directCase("titan-dock", "titan", "sf-07")];
const cases = requests.map((request) => {
  const input = adaptFullPlans(E, request), ledger = assessItinerary(input);
  return { id: request.id, input, ledger };
});
const report = { format: "starfare.propulsion-ledger-examples/1", engine_sha256: sha, score_version: suite.score_version,
  request_jd: requestJd, end_jd: endJd,
  note: "Current full-plan diagnostics with undeclared cabin/payload/reserve/load values left missing. Minimums are explicitly lower bounds; no loaded inventory or solved thrust trajectory is invented.",
  cases };
const outIndex = process.argv.indexOf("--out");
if (outIndex >= 0) {
  if (!process.argv[outIndex + 1]) throw new Error("--out requires a filename");
  writeFileSync(process.argv[outIndex + 1], JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ engine_sha256: sha, diagnostic_only: true, cases: cases.map(({ id, ledger }) => ({
    id, status: ledger.status, minimum_initial_xenon_kg: ledger.minimum_initial_xenon_kg,
    necessary_failure_codes: [...new Set(ledger.findings.filter((f) => f.certainty === "necessary").map((f) => f.code))],
    missing_inputs: ledger.missing_inputs.length, loaded_inventory_declared: ledger.declared_loading !== null,
  })) }, null, 2));
} else console.log(JSON.stringify(report, null, 2));
