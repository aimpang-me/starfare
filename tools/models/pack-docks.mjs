// Packs the Blender exports listed in design/assets/models/docks.json: welds and dedups, then quantizes and compresses
// the geometry with meshopt (KHR_mesh_quantization and EXT_meshopt_compression at level medium, no filters, which
// three r128's GLTFLoader reads with its examples/js/libs/meshopt_decoder.js, meshoptimizer 0.14). The baked JPEG maps
// pass through as they are. Rewrites each file's bytes and sha256 in docks.json.
//   python -I tools/models/blender/build_models.py && cd tools/models && npm ci && node pack-docks.mjs
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, dequantize, meshopt, prune, weld } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "design", "assets", "models");
const MAN = join(DIR, "docks.json");
const man = JSON.parse(readFileSync(MAN, "utf8"));
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });

for (const [name, m] of Object.entries(man.models)) {
  const path = join(DIR, m.file);
  const doc = await io.read(path);
  // Keep the named berth_N and seat_N nodes: no flatten or join, which would merge them away.
  // dequantize first, so packing an already packed file again gives the same result
  await doc.transform(dequantize(), weld(), dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: "medium", quantizePosition: 14, quantizeNormal: 10 }));
  const bytes = await io.writeBinary(doc);
  writeFileSync(path, bytes);
  m.bytes = bytes.byteLength;
  m.sha256 = createHash("sha256").update(bytes).digest("hex");
  console.log(`${name.padEnd(28)} ${String(m.bytes).padStart(7)} bytes`);
}
man.packed = "tools/models/pack-docks.mjs (weld, dedup, meshopt medium)";
writeFileSync(MAN, JSON.stringify(man, null, 2) + "\n");
