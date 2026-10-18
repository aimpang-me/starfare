# Starfare textured game assets — v2

Four concept-derived, rotatable GLBs with embedded PBR textures, plus 20 transparent PNG sprites. This is a substantial refinement of v1: navy panelled hulls, brushed alloy, normal/roughness detail, beveled structures, glazed lounges with interiors, service hatches, docking collars and static warm cabin windows.

Open `standalone-preview.html` directly in a browser to compare each model against the original painting and rotate it. It embeds every dependency, model and reference image, so it is approximately 59 MiB. `gallery.html` is a lighter contact sheet; `inspection/asset-gallery.png` is its saved preview.

## Delivered models

| Asset | Triangles | Static material meshes | Distinctive geometry |
|---|---:|---:|---|
| Kestrel | 18,708 | 12 | Broad delta hull, lounge spine, two angular aft recesses |
| Tandem | 65,492 | 12 | Twin hulls, two bridges, shoulder armor, observation lounge |
| Lantern | 42,708 | 12 | Three radial passenger pods, forward cabin, triangular tail |
| Wayfarer | 26,408 | 11 | Open C-ring, two window rows, offset three-berth service spine |

`models/*.glb` are self-contained glTF 2.0 files. Each embeds four 1254×1254 PNG maps: navy base color, tangent-space normal, packed metal/roughness and alloy base color. Color maps use sRGB; normal/metal/roughness are non-color data. glTF G is roughness and B is the metallic multiplier. Materials include factor-based upholstery, glazing and static cabin emission. Every vertex has UVs and normals. No Draco, KTX, custom shader extension or remote texture is required.

`sprites/` contains portrait, top, side and rear views at 1024×1024, plus a native 96×96 portrait for each model. These are renders of the delivered meshes, with real alpha and unclipped margins. Lighting and scale are consistent within each view family; their square framing is normalized to each asset's bounds, not a claim of real relative size.

## Import into Starfare

The verified target is the current local Starfare browser renderer, **Three.js r128**, not Unity or Godot. Load the pinned `vendor/GLTFLoader.js` after the engine's existing Three.js, then load `starfare-adapter.js`:

```js
await StarfareAssets.load('/art/models');
const restoreShipFactory = StarfareAssets.install(SolArt); // Tandem default
// Or select a design through your own explicit callsign-to-design mapping:
// StarfareAssets.install(SolArt, options => designForCallsign(options.callsign));
const station = StarfareAssets.create('wayfarer');
scene.add(station);
```

Await loading **before** `buildScene` / `loadRide` constructs ships. The adapter normalizes ship length to 1, preserves the engine's +Z nose / +Y up convention, provides its `userData.update(t, flying, reduced)` callback, and shares static geometry/materials and surface maps between clones. Wayfarer is normalized by its largest dimension and should be placed as a station; its replay substitution was only an import stress test.

The raw GLBs use arbitrary art units and a visual-bounds-center pivot. Port sockets are +X, starboard sockets −X. Named socket nodes contain local axes and `requiresRecordedState: true`. Propulsion, navigation and docking effects are off. Static warm cabin emission is aesthetic and is not burn, occupancy or docking telemetry. The callback deliberately does not infer thrust from a generic `flying` flag. No burn-effect implementation or flight simulation is included.

### Color output compatibility

The inspected Starfare composer has bloom and optional grain/vignette, but no final linear-to-sRGB conversion. PBR imports render very dark in that native pipeline. The adapter supplies an explicit, idempotent correction:

```js
StarfareAssets.configureOutput(GL.r, GL.post);
```

It inserts the conversion after bloom and before perceptual grain/vignette, and linearizes the clear color to preserve the background's displayed color. It affects the whole rendered canvas, so adopt it with the engine's other art in view; it is never enabled automatically by loading a model. Do not add it if another output pass already converts to sRGB. With no composer, it sets the renderer's sRGB output encoding. The inspection folder preserves the native-color baseline alongside corrected screenshots. No production engine file was edited.

Remove every clone from its scene before calling `StarfareAssets.dispose()` to release shared model resources. Do not dispose one clone's geometry or materials while another clone uses them.

## Verification performed

- All four GLBs load using the exact r128 GLTFLoader. UVs, embedded maps, indices, finite geometry and unit normals pass. No zero-area triangles were found.
- Actual local copies of Starfare's `site.html` and `flight.html` execute with its ephemeris bundle, `sol-art.js`, `flight-view.cjs`, bloom, logarithmic depth and replay code. Test-only asset injection is applied to served bytes.
- Home import: all four models render. Seven Tandem instances share geometry without increasing geometry allocations per clone.
- Replay import: all four assets are substituted at four time samples from the repository's committed `iss-crew.record.arrived` fixture. Positions, dates and event counts remain identical between substitutions; +Z aligns with the engine's forward vector; effects remain off. The fixture uses the engine's local-hop interpolation fallback because no arc payload is supplied. No live run was created or dispatched.
- Twenty transparent PNGs exported; 1024px views have visible subject, transparent margins and no clipping. Keyboard rotation and the review page at 390px width pass. The offline viewer loads all four models with no external resource request.
- Chrome/SwiftShader desktop verification reported no JavaScript or WebGL errors. Source hashes matched before/after. Owned browsers and local servers were closed and their ports released.

Read `verification.json`, `geometry-validation.json` and `engine-snapshot/source-hashes.json` for evidence. `inspection/` includes original-versus-mesh comparisons, native and corrected engine output, and full application screenshots.

This is an art/import verification, not a mobile GPU or frame-rate certification. The meshes preserve the major concept silhouettes and material language but simplify the paintings' small mechanical detail and complex glazing. No high-resolution sculpt bake, collision hull, LOD chain, damage state or animated rig is included. The generated normal and roughness maps are authored approximations, not measured scans; no mathematically exact seamlessness or pixel registration is claimed. Transparent glazing can require sorting review when ships overlap. A final whole-scene lighting pass is still appropriate before release.

## Reproduce

`build-models.mjs` is the editable procedural source and uses Node built-ins only. Regenerate with `node build-models.mjs`, then `node assemble-preview.cjs`. Preserve the four source textures and original concept files (the assembly script reads originals from the parent art folder).

`validate.cjs` and `verify.cjs --engine` use the already-installed Codex runtime's Playwright/Sharp and local Chrome. The verification harness defaults to this machine's Starfare checkout; set `STARFARE_SOURCE` to another checkout when reproducing. It starts an ephemeral localhost server and its own Chrome instance, then closes both. The generated engine HTML snapshots require that source checkout and are evidence, not standalone copies of the game.

Skills used: imagegen for material artwork; verification-before-completion for fresh checks; pstack:bro for reporting. Plugin Management was used to search for a dedicated Blender/modeling plugin; none was available. Mesh construction therefore uses the editable local generator, with the existing browser tools for verification. No modeling plugin, package installation or paid external generation service was used.

## Provenance

The mesh source and concept/material artwork were created for this Starfare task. All designs are fictional. The concept images are included solely as the visual reference, not as 3D textures. Texture prompts are saved in `generation-prompts.json`. The pinned Three.js vendor files retain their MIT license in `vendor/LICENSE` and source URLs/hashes in `vendor/sources.json`. Engine screenshots show the existing Starfare attribution for planetary data and maps; those planetary assets are not part of this model pack.
