// Packs the Blender exports of tools/models/blender/variety.py for the web: welds and dedups the geometry (not the
// materials: they are plain and alike, and their names are what the page keys the trims on), then
// quantizes positions and normals (KHR_mesh_quantization, which three.js r128's GLTFLoader reads without a decoder;
// UVs stay float because the cube-projected trims tile far past 0..1). Rewrites each
// design/assets/models/variety/*.glb in place and refreshes its bytes and sha256 in variety.json.
//   cd tools/models && npm ci && node pack-variety.mjs
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, PropertyType } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, quantize, weld } from "@gltf-transform/functions";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODELS = join(ROOT, "design", "assets", "models");
const DIR = join(MODELS, "variety");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const manifestPath = join(MODELS, "variety.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

for (const f of readdirSync(DIR).filter((f) => f.endsWith(".glb")).sort()) {
  const path = join(DIR, f), before = readFileSync(path).length;
  const doc = await io.read(path);
  await doc.transform(weld(), dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH] }), prune(), quantize({ pattern: /^(POSITION|NORMAL)$/, quantizePosition: 14, quantizeNormal: 10 }));
  const out = await io.writeBinary(doc);
  writeFileSync(path, out);
  const id = f.replace(/-lod\.glb$|\.glb$/, ""), lod = f.endsWith("-lod.glb"), m = manifest.models[id];
  if (m) { m[lod ? "lod_bytes" : "bytes"] = out.length; m[lod ? "lod_sha256" : "sha256"] = sha256(out); }
  console.log(`${f}: ${before} -> ${out.length} bytes`);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + "\n");
