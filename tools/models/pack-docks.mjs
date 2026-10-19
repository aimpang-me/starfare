// Packs the Blender exports listed in design/assets/models/docks.json: welds and dedups, then quantizes positions and
// normals (KHR_mesh_quantization, which three r128's GLTFLoader reads). Rewrites each file's bytes and sha256 in docks.json.
//   python -I tools/models/blender/build_models.py && cd tools/models && npm ci && node pack-docks.mjs
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, quantize, weld } from "@gltf-transform/functions";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "design", "assets", "models");
const MAN = join(DIR, "docks.json");
const man = JSON.parse(readFileSync(MAN, "utf8"));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

for (const [name, m] of Object.entries(man.models)) {
  const path = join(DIR, m.file);
  const doc = await io.read(path);
  // Keep the named berth_N and seat_N nodes: no flatten or join, which would merge them away.
  await doc.transform(weld(), dedup(), prune(), quantize({ quantizePosition: 14, quantizeNormal: 10 }));
  const bytes = await io.writeBinary(doc);
  writeFileSync(path, bytes);
  m.bytes = bytes.byteLength;
  m.sha256 = createHash("sha256").update(bytes).digest("hex");
  console.log(`${name.padEnd(28)} ${String(m.bytes).padStart(7)} bytes`);
}
man.packed = "tools/models/pack-docks.mjs (weld, dedup, quantize)";
writeFileSync(MAN, JSON.stringify(man, null, 2) + "\n");
