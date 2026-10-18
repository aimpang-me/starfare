# Starfare detailed asset pack — v3

This revision adds fitted hull plates, geometric fasteners and latches, inset cooling louvers, layered armor, machined collars, drive throat hardware, hydraulic pistons and routed conduits. A new dense navy surface atlas has companion normal, packed metal/roughness and occlusion maps. Brushed alloy, painted ceramic, smoked glazing, dark recesses and heat-treated machinery have distinct material responses.

The original paintings remain the reference. These meshes are more detailed interpretations, with remaining differences in sculpted contours, interior furnishings and very small concept mechanisms.

## Review the result

- `standalone-preview.html`: complete offline model viewer, including original concepts and all GLBs. Drag/arrow keys rotate; scroll zooms; **Inspect details** moves to a close-up. Approximately 77 MiB because all dependencies are embedded.
- `comparison.html`: original concept / v2 / v3. Both model revisions were re-rendered with the same camera angles, lighting, shadows and environment. Framing is normalized to each model's bounds. Baseline images come from the unchanged v2 GLBs.
- `details.html`: large close-ups of the delivered meshes.
- `inspection/detail-gallery.png`, `inspection/v2-v3-comparison.png`, `inspection/asset-gallery.png`: saved review images.

## What changed

| Model | Triangles | Material meshes | Fitted panels | Fasteners | Key changes |
|---|---:|---:|---:|---:|---|
| Kestrel | 65,128 | 19 | 486 | 570 | Flush wing panelwork, open cooling wells on the aft shrouds, layered perimeter armor, machined bow port |
| Tandem | 91,440 | 18 | 548 | 732 | Narrower twin-hull planform, shoulder armor, layered bridge roof, docking clamps and stepped drive throats |
| Lantern | 102,628 | 18 | 680 | 866 | Petals stretched along their radial axes, wraparound bow glazing, spine conduits and suspension pistons |
| Wayfarer | 106,724 | 18 | 320 | 414 | Nine larger ring bays, layered two-deck glazing, dorsal plates, locking clamps, protected docking machinery |

Feature counts come from the procedural generator; they include access and maintenance panels. Materials are merged into static meshes to limit draw calls. The five 1254×1254 maps are embedded in every self-contained GLB:

1. `hull-basecolor.png` — dense navy panel and maintenance artwork, sRGB.
2. `hull-normal.png` — tangent-space OpenGL normal detail, linear data.
3. `hull-metalrough.png` — G roughness, B metallic multiplier, linear data.
4. `alloy-basecolor.png` — brushed alloy artwork reused from v2, sRGB.
5. `hull-occlusion.png` — local crevice occlusion, linear data.

The maps were authored with the built-in image tool; prompts are in `generation-prompts.json`. Normal/AO detail is artist-authored rather than a high-resolution sculpt bake. Generated maps are not claimed to have mathematically exact registration or seamlessness. Actual plate bevels, gaps, fasteners, pipes and louvers are mesh geometry and remain present in the exported GLBs.

`sprites/` supplies portrait, top, side and rear views at 1024×1024, and a native 96×96 portrait for each model: 20 transparent PNGs. The studio viewer uses a warm key, cool fill, reflection cards and self-shadowing to reveal materials. Its lighting is a review setup; engine screenshots separately show Starfare's renderer.

## Starfare integration

Target: the local Starfare browser renderer using **Three.js r128**. Load the pinned `vendor/GLTFLoader.js` after the existing Three.js, then `starfare-adapter.js`:

```js
await StarfareAssets.load('/art/models');
const restoreFactory = StarfareAssets.install(SolArt); // Tandem default
// Optional explicit mapping: install(SolArt, options => designForCallsign(options.callsign))
const station = StarfareAssets.create('wayfarer');
scene.add(station);
```

Await loading before the engine constructs ships. The adapter preserves the engine's +Z nose and +Y up, normalizes ship length to 1, and provides `userData.update(t, flying, reduced)`. Static geometry, materials and all five maps are shared between clones. It includes AO-map sharing and uses the loader's UV2 copy for occlusion.

Raw GLBs use arbitrary art units with a visual-bounds-center pivot. Port sockets are +X; starboard sockets −X. Named socket nodes carry local directions and recorded-state requirements. Wayfarer is normalized by its largest dimension and should be placed as a station; replay substitution is only a compatibility check.

Propulsion, navigation and docking effects remain off. Static warm cabin light is aesthetic and does not indicate passenger occupancy or burn telemetry. A generic `flying` callback never activates thrust. This package does not implement flight physics, docking logic or burn effects.

### Output-color compatibility

The inspected Starfare composer does not have a final linear-to-sRGB conversion. As in v2, PBR imports appear too dark in that native output. The adapter provides an explicit, idempotent correction:

```js
StarfareAssets.configureOutput(GL.r, GL.post);
```

It converts after bloom and before perceptual grain/vignette, while linearizing the clear color to preserve its displayed background. It affects the entire canvas, so review it alongside existing engine art and do not add it where another output pass already performs this conversion. With no composer, it sets the renderer's sRGB output encoding. Native and corrected screenshots are preserved. No production engine source was changed.

Remove all clones from scenes before calling `StarfareAssets.dispose()` to release shared resources. Do not dispose shared geometry or materials through one clone while another clone still uses them.

## Verification and limits

`geometry-validation.json` records binary structure, finite attributes, unit normals, valid indices, per-vertex UVs, zero-area triangle checks, embedded-map equality and SHA256 hashes. `verification.json` records browser/import evidence:

- Four textured models loaded in r128, with no JavaScript or WebGL errors.
- Actual local Starfare home and replay templates execute with their ephemeris bundle, art module, flight-view module, logarithmic depth and bloom pipeline. Model injection is applied to served test bytes.
- Home: all four models render; seven Tandem clones share geometry. AO maps have corresponding UV2 data.
- Replay: all four models are substituted at four recorded time samples; dates, positions and event counts remain identical. +Z follows the engine forward vector, AO data is present, and telemetry effects stay off.
- The replay uses the repository's committed `iss-crew.record.arrived` fixture and its local-hop interpolation fallback, with no supplied arc payload. It does not create a live run or dispatch anything.
- The 20 sprites have alpha, visible geometry and unclipped margins. The viewer supports keyboard rotation, works without horizontal overflow at 390px, and its standalone file loads all four models with no external resource request.
- Source hashes are checked before/after; owned browsers and local servers are closed and ports released. See `process-ownership.json` and `engine-snapshot/source-hashes.json`.

The detailed meshes have higher geometry and texture costs than v2. Tests establish desktop import/render behavior, not mobile GPU frame-rate certification. No LOD chain, collision mesh, rig, damage state or high-resolution sculpt source is supplied. Transparent overlapping ships and final whole-scene lighting still need release-level visual review.

## Editable source and reproduction

`build-models.mjs`, `detail-geometry.mjs` and `detail-models.mjs` contain the editable geometry/material source. Generation uses Node built-ins only. Run:

```powershell
node build-models.mjs
node assemble-preview.cjs
node validate.cjs
node verify.cjs --engine
```

The assembly step reads original concepts from the parent art folder. The verification runner uses already-installed Codex runtime Playwright/Sharp and local Chrome. Set `STARFARE_SOURCE` for a different source checkout. The comparison check also reads the sibling v2 models; it does not modify them. Generated engine HTML snapshots require the source checkout; they are evidence rather than a standalone copy of Starfare.

All mesh and artwork designs are fictional Starfare assets. No external model was downloaded. Three.js vendor files retain their MIT license in `vendor/LICENSE`; pinned source URLs and hashes are in `vendor/sources.json`. Existing planet/map attribution appears in engine screenshots; those planetary assets are not part of this pack.
