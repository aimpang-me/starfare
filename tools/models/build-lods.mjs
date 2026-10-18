// Builds the game versions of the generated Starseeker meshes: about 15k triangles, 1024 px JPEG maps, at most
// 1.5 MB each, normalised to length 1 with the bow on +Z and up +Y (the engine's ship convention). Writes
// design/assets/models/<hull>.glb and fleet.json (engine ship class -> hull, light mounts, provenance).
//   cd tools/models && npm ci && node build-lods.mjs
// Rerun after replacing a source mesh; the output is deterministic for the same sources and package versions.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, getBounds, prune, simplify, textureCompress, transformPrimitive, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "design", "assets", "models");
const TRIANGLES = 15000, MAX_BYTES = 1.5 * 1024 * 1024, TEXTURE_PX = 1024;
// Engine ship class (SOLE.R.CAR[car].ship_class) -> hull. Wayfarer is a station, not a car, and stays on its review page.
const HULLS = [
  { id: "kestrel", classes: ["dawn"], src: "art/2026-10-17/kestrel-higgsfield-v1/models/kestrel-tripo-h3_1.glb" },
  { id: "tandem", classes: ["ds1"], src: "art/2026-10-18/fleet-tripo-v1/models/tandem-tripo-h3_1.glb" },
  { id: "lantern", classes: ["rtg"], src: "art/2026-10-18/fleet-tripo-v1/models/lantern-tripo-h3_1.glb" },
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const round = (v) => v.map((x) => +x.toFixed(4));
const triangles = (prim) => (prim.getIndices() ?? prim.getAttribute("POSITION")).getCount() / 3;

// Wingtip lights sit on the outermost vertex each side (+X port red, -X starboard green), the beacon on the highest
// vertex of the centreline strip: generated hulls are not exactly symmetric, and an off-centre beacon reads as a defect.
function mounts(prim) {
  const pos = prim.getAttribute("POSITION"), v = [0, 0, 0];
  let port = null, starboard = null, beacon = null;
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, v);
    if (!port || v[0] > port[0]) port = v.slice();
    if (!starboard || v[0] < starboard[0]) starboard = v.slice();
    if (Math.abs(v[0]) < 0.02 && (!beacon || v[1] > beacon[1])) beacon = v.slice();
  }
  return { port_light: round(port), starboard_light: round(starboard), beacon: round([0, beacon[1], beacon[2]]) };
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
mkdirSync(OUT, { recursive: true });
const fleet = { generator: "tools/models/build-lods.mjs", productionApproved: false, classes: {}, hulls: {} };

for (const hull of HULLS) {
  const source = readFileSync(join(ROOT, hull.src));
  const doc = await io.readBinary(source), root = doc.getRoot();
  const prims = root.listMeshes().flatMap((m) => m.listPrimitives());
  if (root.listNodes().length !== 1 || prims.length !== 1) throw new Error(`${hull.id}: expected one node with one primitive`);
  const before = triangles(prims[0]);

  const { min, max } = getBounds(root.listScenes()[0]), s = 1 / (max[2] - min[2]);
  const c = [0, 1, 2].map((i) => (min[i] + max[i]) / 2);
  transformPrimitive(prims[0], [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -c[0] * s, -c[1] * s, -c[2] * s, 1]);

  await doc.transform(
    dedup(), weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: TRIANGLES / before, error: 0.02 }),
    textureCompress({ encoder: sharp, targetFormat: "jpeg", resize: [TEXTURE_PX, TEXTURE_PX], quality: 85 }),
    prune(),
  );
  root.listNodes()[0].setName(hull.id);
  root.listMaterials()[0].setName(hull.id);

  const bytes = await io.writeBinary(doc), after = triangles(prims[0]);
  if (bytes.byteLength > MAX_BYTES) throw new Error(`${hull.id}: ${bytes.byteLength} bytes is over the ${MAX_BYTES} byte budget`);
  if (after > TRIANGLES * 1.1) throw new Error(`${hull.id}: ${after} triangles is over the ${TRIANGLES} target`);
  writeFileSync(join(OUT, `${hull.id}.glb`), bytes);
  const b = getBounds(root.listScenes()[0]);
  for (const cls of hull.classes) fleet.classes[cls] = hull.id;
  fleet.hulls[hull.id] = {
    file: `${hull.id}.glb`, bytes: bytes.byteLength, sha256: sha256(bytes), triangles: after,
    textures: root.listTextures().map((t) => `${t.getMimeType()} ${t.getSize().join("x")}`),
    bounds: round(b.max.map((x, i) => x - b.min[i])),
    mounts: mounts(prims[0]),
    source: { path: hull.src, sha256: sha256(source), triangles: before },
  };
  console.log(`${hull.id}: ${before} -> ${after} triangles, ${(bytes.byteLength / 1024).toFixed(0)} KB`);
}
writeFileSync(join(OUT, "fleet.json"), JSON.stringify(fleet, null, 2) + "\n");
console.log(`wrote ${OUT}`);
