# Kestrel 3D game art — v4

One spacecraft, two self-contained textured GLBs. This is a local mesh-authoring revision of the Kestrel; no Higgsfield image-to-3D job was submitted. The original concept remains unchanged in `concept/`.

The model now has an uninterrupted pressure-glass lounge with thin graphite mullions and seat/console geometry, taller angular aft shrouds, framed cooling inlets, a central stern notch, stepped satin perimeter armor, geometric panel seams, nested maintenance hatches, hex screws, heat-exchanger blades, damper sleeves, ventral conduits and a closed docking service bay. The navy shell, satin titanium, graphite recesses, heat-treated machinery, leather upholstery and smoked glass use separate material responses.

| Export | Triangles | Material meshes | GLB size |
|---|---:|---:|---:|
| `models/kestrel.glb` | 143,368 | 17 | 4.65 MiB |
| `models/kestrel-low.glb` | 31,284 | 17 | 1.39 MiB |

The reduced version removes tiny screws and conduits, simplifies curved surfaces and panel tessellation, and retains the lounge, shrouds, hatches and main silhouette. It has 78.2% fewer triangles. These are separate models for an engine to select; no automatic LOD switching is installed.

## Review and use

Open `standalone-preview.html` for an offline rotatable view beside the original concept. Drag or use arrow keys, scroll to zoom, switch detailed/reduced geometry, and inspect the close-up. No automatic flight motion is added. `sprites/` contains transparent portrait, top, side and rear renders at 1024 pixels, plus a 96-pixel portrait for each mesh.

The five embedded 512-pixel PNG maps are also supplied in `textures/`. Base color is sRGB; normal and metal/roughness maps are linear data. Normal detail is subtle surface grain. Metal/roughness uses G for roughness and B for metalness. The AO map is a neutral white identity map, not a sculpted occlusion bake. Geometry and the review renderer's shadows provide panel relief. The maps contain no baked studio lighting. UVs repeat for surface finish; they are not a unique bake or lightmap atlas.

GLBs use +Z forward, +Y up, a visual-bounds-center pivot and arbitrary art units. Set the physical/game scale explicitly. Named nozzle and docking sockets have local directions; all propulsion/navigation effects are off. Static warm cabin emission is aesthetic and does not report occupancy or engine state.

For Starfare's Three.js r128 renderer, load `vendor/GLTFLoader.js` and `starfare-adapter.js`, then:

```js
await StarfareAssets.load('/art/kestrel/models');
const ship = StarfareAssets.create('kestrel'); // or 'kestrel-low'
scene.add(ship);
// Optional factory replacement, after loading:
const restore = StarfareAssets.install(SolArt);
```

The adapter normalizes the ship's length to one art unit and shares geometry/materials between clones. It includes the existing opt-in `StarfareAssets.configureOutput(renderer, post)` correction for Starfare's final linear-to-sRGB conversion. This changes the whole canvas; enable it only once and review it with the rest of the scene. The standalone studio has reflection cards; Starfare's current direct Sun lighting produces much deeper shadows on the navy hull. The engine screenshots preserve that difference.

## Verified scope

`geometry-validation.json` checks GLB structure, finite attributes, unit normals, valid indices, per-vertex UVs, zero-area triangles, embedded texture equality and SHA256 hashes.

`verification.json` records both meshes imported into the actual local home and replay templates at shared commit `ff66fbc4532ec694770099e257dcc7214b9faaa0`, with logarithmic depth, bloom, AO UVs and no WebGL errors. Four recorded replay samples preserve position, date and event counts across both meshes and align +Z with the engine's forward vector. Seven clones share geometry. The game source is hashed before and after and is not modified. Tests use the committed `iss-crew.record.arrived` fixture; no live flight is dispatched.

The viewer is checked at 390px, with keyboard rotation, unclipped transparent exports and no external requests from the offline file. Chrome's software GPU is used. This verifies import/render behavior, not mobile GPU performance. Owned browsers and temporary servers are closed and their ports checked as released in `process-ownership.json`.

This is a more detailed stylized reconstruction, with visible differences from the painting in sculpted contours, panel arrangement and small furnishings. It is not an exact reconstruction. No collision mesh, rig, damage state, unique texture bake or production performance certification is included.

## Rebuild

```powershell
node prepare.cjs
node build-models.mjs
node assemble-preview.cjs
node validate.cjs
node verify.cjs
```

The builder uses Node built-ins. Texture preparation and verification use the already-installed Codex runtime Sharp/Playwright and Chrome. The engine check reads the local Starfare checkout; it writes only this art folder. The old v3 GLB is read only for a same-lighting comparison. No dependency installation or paid generation is required.
