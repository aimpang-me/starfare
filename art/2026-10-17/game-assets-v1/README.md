# Starfare — usable 3D and 2D asset set

17 October 2026 · Fictional assets · First modeling pass

This package contains **four actual GLB models and twenty transparent PNG renders**, not just concept sheets. Use the meshes in a glTF-compatible workflow and the PNGs for fixed-view portraits, inventory images or simple 2D representations. The models preserve the concept silhouettes with a simplified material-based finish; they do **not** reproduce the paintings' fine surface detail.

## See and download

- Open [standalone-preview.html](standalone-preview.html) in a modern WebGL 2 browser to rotate all four models. It embeds the GLBs and needs no server, installation or internet connection. Drag or use the arrow keys; use + / − to zoom. It can save the current transparent view.
- [Review sheet](inspection/all-models.png) — inspected model portraits, top views and small-size renders.
- [Kestrel GLB](models/kestrel.glb), [Tandem GLB](models/tandem.glb), [Lantern GLB](models/lantern.glb), [Wayfarer GLB](models/wayfarer.glb).
- [Manifest](manifest.json) — dimensions in art units, bounds, sockets and geometry counts.
- [Verification results](verification.json) and [process cleanup](process-ownership.json).

![The four modeled assets with matching top views and small transparent portraits.](inspection/all-models.png)

## What is ready

| Asset | Triangles | Material draw groups | Mesh file size, approximate |
|---|---:|---:|---:|
| Kestrel | 4,108 | 8 | 198 KiB |
| Tandem | 7,316 | 8 | 467 KiB |
| Lantern | 5,248 | 8 | 265 KiB |
| Wayfarer | 14,244 | 7 | 454 KiB |

- GLB 2.0 files contain indexed triangles, vertex normals, named material groups and named empty nodes for effects. No external texture files or runtime dependencies are required by the models.
- The meshes are static rigid assets; they can be translated and rotated as whole objects. There is no skeleton or invented motion clip.
- Hull, cabin glass, warm window material, trim and navigation fixture groups are separate where present. All `emissiveFactor` values are zero. The windows are opaque decorative material, not animated light telemetry. No separate 2D glow layers are included.
- Every asset has portrait, top, side and rear PNGs at **1024 × 1024**, plus a **96 × 96** portrait. These are actual renders of the included GLBs. Transparency is alpha, not a painted checkerboard.
- Source is included in [build-models.mjs](build-models.mjs). The mesh source uses only Node built-ins and can be adjusted or regenerated without a paid asset service.

## Import contract

| Property | Value / instruction |
|---|---|
| Model coordinates | Right-handed, +Y up, +Z forward; station +Z points toward its opening |
| Units | Arbitrary art units. Explicitly choose display scale; do not interpret this as spacecraft meters |
| Pivot | Center of visible mesh bounds; not center of mass or station docking origin |
| Materials | Metallic/roughness factors, opaque, single-sided; no UV textures, normal maps or baked light maps |
| Sockets | Named empty nodes with local positions and `extras.localDirection` where relevant; nodes have identity rotation |
| Socket use | Align effects using the direction metadata; do not assume local node rotation already points an emitter correctly |
| Collision | No physics colliders or mass values. The model bounds are for visual placement, not safe collision geometry |
| Sprite alpha | Straight/unassociated alpha; standard source-alpha blending, clamp edges; do not color-key black |
| Sprite pivot | Normalized (0.5, 0.5), corresponding to the rendered model pivot; full canvas is intentionally untrimmed |
| Top-view heading | Ship bow points down the image (+image Y). Rotate explicitly if the consuming 2D convention is up |
| Portrait camera | Fixed three-quarter presentation. Never rotate it as though it were a top-down ship sprite |
| Relative size | Each asset is framed independently. Sprite size does not establish relative physical scale |

For a game engine, import one GLB first and confirm axis conversion, material appearance and socket preservation. Retain its named nodes. Do not rescale individual child groups independently. The viewport renderer in this package uses a simple local material shader; lighting in another engine will differ. These files were not imported into Starfare's production Three.js scene, Unity, Godot or Unreal in this pass.

## Recorded-data effects

Propulsion and navigation fixtures default off. The named nodes are attachment locations, not evidence that any light, burn or docking event occurred. Follow [the motion specification](../motion-spec.md): no burn without recorded burn/throttle/orientation data, no docking inferred from arrival, and no thrust during coasting. Missing or stale information leaves the effect off. Keep Real / Fictional / Simulated provenance outside the reusable sprite as readable interface text. Concept inspection never contributes activity or flight counts.

## Verified and still unfinished

Executed checks: GLB header/chunk lengths, in-range indices, finite vertex data, unit normals, no zero-area triangles, emission off, and sixteen 1024px renders with visible subject, real alpha and clear canvas margins. The local viewer rotated a mesh by keyboard, worked at 390px without horizontal overflow, and showed no automatic motion under reduced motion. The self-contained viewer loaded all four embedded models without secondary resource requests. No browser page errors were recorded. Actual portraits and the checkerboard preview were visually inspected; floating frame/seam details found in the first render were corrected.

The resulting style is intentionally simpler than the original paintings. Remaining for a production fidelity pass: richer hull surfaces, UVs and texture sets if desired, art-directed LODs, collision shapes if gameplay needs them, and performance checks in the target engine. Mesh parts intersect as assembled hard-surface components; they are not watertight manufacturing meshes. The window and cabin details do not represent measured capacity. This was a local custom validation/render pass, not Khronos validator certification, broad engine compatibility certification or a performance benchmark.

## Rebuild and review

From this folder, run `node build-models.mjs`, then `node assemble-preview.mjs`. The standalone preview is the everyday review path. `node verify-export.cjs` uses the existing bundled Playwright and sharp paths shown in that script, starts a temporary localhost server and isolated Chrome, exports the sprites, and closes both in `finally`. It installs nothing. Set `STARFARE_NODE_PACKAGES` if the local bundle moves. The script records PIDs, purpose, ownership, exit and port release.

No preview server is retained. No application source, other worker's artifacts, cloud configuration or existing product assets were changed. Original concepts remain untouched. One built-in image edit was explored for a Tandem portrait; it was not used for this package, which uses mesh-derived sprites for consistency. No API fallback or paid external generation was used. See [the experiment prompt](portrait-experiment-prompt.md).
