// Build step: copy the SOL engine bundle (sol/world/engine/sol-page.js) byte for byte into src/engine/,
// and read the sky calendar out of sol/world/build.py, so the Worker scores exactly like the page.
// Never edits anything under sol/world/. Run: node build.mjs
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORLD = join(HERE, "..", "world");
const SRC = join(WORLD, "engine", "sol-page.js");
const OUT_DIR = join(HERE, "src", "engine");

const engine = readFileSync(SRC);
if (!engine.includes("module.exports = SOLE")) throw new Error("sol-page.js no longer ends with module.exports = SOLE");
if (!engine.includes("SOLE.R = (function(E)")) throw new Error("sol-page.js has no ride-hail module (SOLE.R)");

const buildPy = readFileSync(join(WORLD, "build.py"), "utf8");
const sky = /"sky":\s*\{"t0_ms":\s*(\d+),\s*"jd0":\s*([\d.]+),\s*"len_days":\s*(\d+)\}/.exec(buildPy);
const win = /"window_days":\s*(\d+)/.exec(buildPy);
if (!sky || !win) throw new Error("could not find WORLD.sky / window_days in sol/world/build.py");

mkdirSync(OUT_DIR, { recursive: true });
// .cjs so the bundler treats it as CommonJS and the module.exports line works unchanged.
writeFileSync(join(OUT_DIR, "sol-page.cjs"), engine);
const meta = {
  source: "sol/world/engine/sol-page.js",
  sha256: createHash("sha256").update(engine).digest("hex"),
  bytes: engine.length,
  sky: { t0_ms: Number(sky[1]), jd0: Number(sky[2]), len_days: Number(sky[3]) },
  window_days: Number(win[1]),
};
writeFileSync(join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
console.log(`engine copied: ${meta.bytes} bytes, sha256 ${meta.sha256.slice(0, 16)}…, sky ${JSON.stringify(meta.sky)}`);
