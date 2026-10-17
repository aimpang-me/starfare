// Build step: copy the SOL engine bundle (sol/world/engine/sol-page.js) byte for byte into src/engine/,
// and read the sky calendar and the planet colours out of sol/world/build.py, so the Worker scores exactly like the page.
// sol-page.cjs is what the Worker runs; sol-page.txt (gitignored) is the same bytes as text, served to browsers at /engine.js.
// It also copies the art pass (design/assets: sol-art.js, the star catalogue, planet maps, credits) into public/assets/,
// which Workers static assets serves at /assets/*. design/assets stays the single source; public/ is gitignored.
// Never edits anything under sol/world/ or design/. Run: node build.mjs
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
// The landing page's sky map: EXTRA's colours and big flags, e.g. "earth": dict(color="#6fa8ff", spawn=True, big=True, ...).
const look = {};
for (const [, id, args] of buildPy.matchAll(/"([\w-]+)":\s*dict\(([^)]*)\)/g)) {
  const color = /color="(#[0-9a-fA-F]{6})"/.exec(args)?.[1], big = /\bbig=True\b/.test(args);
  if (color || big) look[id] = { ...(color ? { color } : {}), ...(big ? { big } : {}) };
}
if (!look.earth?.color || !look.jupiter?.big) throw new Error("could not read the planet colours (EXTRA) in sol/world/build.py");

mkdirSync(OUT_DIR, { recursive: true });
// .cjs so the bundler treats it as CommonJS and the module.exports line works unchanged.
writeFileSync(join(OUT_DIR, "sol-page.cjs"), engine);
writeFileSync(join(OUT_DIR, "sol-page.txt"), engine);
const meta = {
  source: "sol/world/engine/sol-page.js",
  sha256: createHash("sha256").update(engine).digest("hex"),
  bytes: engine.length,
  sky: { t0_ms: Number(sky[1]), jd0: Number(sky[2]), len_days: Number(sky[3]) },
  window_days: Number(win[1]),
  look,
};
writeFileSync(join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
console.log(`engine copied: ${meta.bytes} bytes, sha256 ${meta.sha256.slice(0, 16)}…, sky ${JSON.stringify(meta.sky)}`);

const ART = join(HERE, "..", "design", "assets"), PUB = join(HERE, "public");
if (!readFileSync(join(ART, "sol-art.js"), "utf8").includes("root.SolArt = {")) throw new Error("design/assets/sol-art.js has no SolArt");
rmSync(join(PUB, "assets"), { recursive: true, force: true });
cpSync(ART, join(PUB, "assets"), { recursive: true });
cpSync(join(HERE, "src", "flight-view.cjs"), join(PUB, "assets", "flight-view.js"));
console.log("art copied: design/assets -> public/assets");
