# Kestrel / Higgsfield feasibility trial

Status: preparation complete; native 3D generation and exact credit quote unavailable in this chat. No generation submitted, no new Higgsfield model produced, no credits spent. Remaining fleet work and cinematic videos are on hold.

## Confirmed capabilities and blocker

Higgsfield's connected catalog works. `models_list(type="3d")` and `models_get("image_to_3d")` returned the Meshy image-to-3D schema, including texturing, PBR, retopology and explicit rigging/animation switches. This is the proposed path inside Higgsfield, rather than a separate provider account.

The exposed tool inventory has no `generate_3d`, `estimate_3d_cost` or equivalent 3D quote tool. The hosted sandbox's `command -v higgsfield` returned no executable. No software was installed.

The available image-cost estimator was tried as a cost-only request. It rejected the model with:

> model "image_to_3d" is a 3d model; use generate_3d instead.

It returned no credit price and submitted no job. Exact cost is **unknown**, not zero. Do not approve or submit from this draft until a native 3D quote succeeds and the user approves its exact cost. The saved `quote-attempt.json` contains the typed rejection; `model-schema.json` contains the returned live schema.

## Proposed one-model settings — not submitted

- Model: `image_to_3d` (Meshy, through Higgsfield).
- Count: one Kestrel GLB.
- `should_texture: true`, `enable_pbr: true`.
- `should_remesh: true`, `topology: "triangle"`, `target_polycount: 60000`.
- `symmetry_mode: "on"` for the ship's bilateral hull.
- `enable_rigging: false`, `enable_animation: false`.
- Seed: `20261017`.
- Character pose, rigging height and animation action are omitted.
- Texture prompt and acceptance checks: `generation-settings-draft.json`.

The triangle target is a trial budget, not an observed output count or performance guarantee. Price must be quoted for the final input and these settings; catalog bounds do not establish a generation cost.

## Inspected source and preparation

`source/kestrel-original-concept.png` is an unchanged copy of the existing 1536×1024 concept sheet. SHA256: `FE34453022EA00598E3261964DFD48546003826B16ECD0E574E74C75A4A138F8`.

The sheet contains a large three-quarter hero and two lower orthographic views, plus title, stars and decorative lines. Submit a single isolated hero, not the entire sheet: remove the lower views, title and background while preserving the broad delta silhouette, long central lounge, split rear notch and paired angular aft shrouds. This cleaned generation input has not yet been made or uploaded. The source painting is preserved.

The original concept's highlights are illustrative. A generator may bake them into the base-color map, fill the rear notch, simplify the shrouds, infer a weak underside or model the glazing as an opaque shell. Inspect those explicitly before considering another fleet asset. A PBR option does not guarantee correctly separated glass, materials or mechanical topology.

## Standalone lighting/size study

Open `standalone-study.html` directly in a browser. It embeds Three.js r128, GLTFLoader and the original concept. It starts with **no model loaded** and accepts a local self-contained GLB. It supports Dark SOL lighting values, a separate studio key/fill setup, desktop/phone sizes, 96px/48px sizes and manual rotation/zoom. No model is uploaded by this viewer; loading a file is local.

`study-verification.json` describes a setup test using the previously delivered procedural v3 Kestrel. Files named `fixture-v3-*` show that old local fixture, not a Higgsfield-generated result. `study-pending-desktop.png` shows the actual pending state. No server is retained; temporary browser/server processes are closed by `verify-study.cjs`.

The study is a static **asset preview**, not a simulated flight or application implementation. It uses neutral display normalization rather than invented physical ship dimensions. It does not animate the spacecraft, burn effects, navigation lights or any flight state. Engineering will supply actual positions/timing from recorded data.

## Version labels and future checks

- Art: independent Kestrel Higgsfield trial; no generated model yet.
- Target game: merged main `ff66fbc4532ec694770099e257dcc7214b9faaa0`.
- Exact commit objects were inspected locally for `site.html`, `flight.html` and `sol-art.js`; renderer source blobs are saved in `renderer-contract.json`. They retain r128, logarithmic depth and the SolArt composer contract.
- The active Engineering checkout was still at candidate `f0564ba` when read. Its active checkout was not changed.
- Design prototype: PR12 `7839868` plus independent presentation changes, not the merged game build.
- Recheck GitHub and agree on the resulting main commit before actual engine integration.

After approved generation, inspect the returned GLB's actual silhouette, underside, textures, PBR maps, normals, indices, disconnected components, orientation, bounds, file size and texture dimensions. Align through an explicit +Z-forward/+Y-up adapter if needed; preserve raw output. Record its measured geometry and limits, supply a usable GLB and an accessible model preview, and repeat desktop/mobile size studies before proceeding with the fleet.

## Read references

- Installed Higgsfield skill: `C:/Users/PC-AIMPANG/.codex/plugins/cache/openai-curated-remote/app-6a3293e129088191abf0875820e839da/2.2.0/skills/higgsfield/SKILL.md`.
- [Official game-3d-animation reference](https://github.com/higgsfield-ai/skills/blob/main/higgsfield-websites/references/game-3d-animation.md): native path first; static meshes stop before rigging; use isolated reference images.
- That reference's linked `meshy-input-rules.md` and `meshy-api.md` URLs returned 404 during preparation. Read current native input rules before any future submission; no raw API fallback is authorized.

The installed skill requires explaining missing runtimes/tools and prohibits installing or inventing a replacement workflow to bypass unavailable capabilities. Current work therefore stops before pricing approval or generation. No paid substitute, application/Design edit, deployment or hosted-secret change was performed.
