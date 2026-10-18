# Starfare art handoff for Monday 19 October 2026

Prepared on 18 October 2026 in America/Toronto. Art work is at a stopping point. No additional generation or application integration is authorized by this handoff.

## Current result

Four original concept paintings and fourteen local/procedural GLBs exist. There is no Higgsfield-generated GLB. The user asked for closer concept fidelity, explicitly requested Higgsfield, then chose to generate on the website after the CLI attempt was refused. The latest delivered item is the website prompt in `site-generation-prompt.txt` and the isolated Kestrel reference.

The original paintings are visual references. User feedback that they look good is not production approval. No final fleet selection, physical spacecraft size, capacity or performance was approved. The local models are technically verified interpretations and remain visibly different from the paintings. Kestrel v4 must not be described as Higgsfield output or as fulfillment of the requested Higgsfield generation.

## Asset index

All paths in this table are relative to the parent `art/` folder.

| Path | Contents | Status |
|---|---|---|
| `2026-10-17/starseeker-01-kestrel.png` | Original Kestrel concept plate. | Preserved reference. |
| `2026-10-17/starseeker-02-tandem.png` | Original Tandem concept plate. | Preserved reference. |
| `2026-10-17/starseeker-03-lantern.png` | Original Lantern concept plate. | Preserved reference. |
| `2026-10-17/wayfarer-station.png` | Original Wayfarer concept plate. | Preserved reference. |
| `2026-10-17/art-direction.md` | Palette, concept and asset specifications. | Historical direction. Later requests for finer detail supersede the early seam-simplification suggestion. |
| `2026-10-17/motion-spec.md` | Effect and recorded-state ownership rules. | Reference. No flight physics implementation. |
| `2026-10-17/generation-prompts.md` | Original image prompts. | Reference. |
| `2026-10-17/game-assets-v1/` | Four simple GLBs, twenty sprites and model source. | Legacy local models. Separate renderer checks only. |
| `2026-10-17/game-assets-v2/` | Four textured GLBs, twenty sprites, four surface maps, source and import adapter. | Legacy local models. Home and replay import evidence exists. |
| `2026-10-17/game-assets-v3/` | Four detailed textured GLBs, twenty sprites, five maps, source, comparison images and adapter. | Latest complete local fleet iteration. No final visual approval. |
| `2026-10-17/kestrel-game-art-v4/` | Detailed and reduced Kestrel GLBs, ten sprites, procedural maps, source and offline viewer. | Latest local Kestrel iteration. Not an accepted replacement for Higgsfield output. |
| `2026-10-17/kestrel-higgsfield-trial/` | Initial capability investigation and an empty lighting study. | Historical preparation. Any fixture screenshot uses the old local v3 Kestrel. |
| `2026-10-17/kestrel-higgsfield-v1/source/kestrel-original-concept.png` | Unchanged copy of the original concept. | Reference. |
| `2026-10-17/kestrel-higgsfield-v1/source/kestrel-isolated-reference.png` | One isolated hero ship prepared with built-in imagegen. | Ready for the user's website upload. It is a 2D reference, not a mesh. |
| `2026-10-17/kestrel-higgsfield-v1/generation-request.json` | Exact rejected CLI request, including PBR, texturing and topology settings. | Blocked. No job ID or output model. |
| `2026-10-17/kestrel-higgsfield-v1/models/` | Empty directory. | No Higgsfield model exists. |

The original Kestrel SHA256 is `fe34453022ea00598e3261964dfd48546003826b16ecd0e574e74c75a4a138f8`. The manifest gives the size and checksum of every source artifact, its provenance group, package decision and reason.

## Existing model geometry

| Version | Kestrel | Tandem | Lantern | Wayfarer |
|---|---:|---:|---:|---:|
| v1 | 4,108 | 7,316 | 5,248 | 14,244 |
| v2 | 18,708 | 65,492 | 42,708 | 26,408 |
| v3 | 65,128 | 91,440 | 102,628 | 106,724 |
| Kestrel v4 | 143,368 detailed, 31,284 reduced | Not supplied. | Not supplied. | Not supplied. |

Values are triangle counts from the actual GLBs and saved version manifests. Each GLB is self-contained. Source and textures remain beside the versioned models. The reduced Kestrel is a separate export. No automatic LOD selection is installed.

## Verification evidence and limits

The saved `verification.json` files report passing runs with no recorded errors. V1 checks four models and twenty sprites in a separate renderer. V2 and v3 each record four home imports and sixteen replay samples. V4 records two home imports and eight replay samples. The v4 target commit is `ff66fbc4532ec694770099e257dcc7214b9faaa0`. V2 and v3 predate that merge and must not be relabeled as checks against the Monday application head.

V4's saved geometry validation has finite attributes, unit normals, per-vertex UVs, zero degenerate triangles and matching embedded maps. V3 has a geometry validation report for the fleet. The handoff script reads the current GLBs, checks binary headers, hashes them, and compares available saved model hashes. It does not rerun browser or engine tests.

The engine checks read the actual local home and replay templates and apply model substitution only to served test bytes. The committed `iss-crew.record.arrived` fixture supplies the recorded state. No live dispatch occurs. The code preserves +Z forward and +Y up and normalizes display size in arbitrary art units. Flight time, routes, telemetry and physics remain Engineering's responsibility. UI and accessibility remain Design's responsibility.

The adapter's optional final linear-to-sRGB correction affects the entire canvas. It is opt-in. Review it with all other scene art before integration. The studio viewer has reflection cards. The engine's direct Sun lighting produces deeper shadows. Screenshots record this difference.

Tests use Chrome SwiftShader and establish import/render behavior, not desktop or mobile GPU performance. The local pack has no physical scale guarantee, collision mesh, rig, damage states, production performance certification or exact reconstruction guarantee. V4 uses repeating finish UVs and a neutral white AO identity map, not a unique texture or sculpt bake. Original source images remain flattened paintings.

## Higgsfield blocker

The official Higgsfield CLI 1.2.2 was installed through its published npm package. Browser sign-in succeeded and model discovery returned `image_to_3d`. One generation request enabled texturing and PBR, targeted 60,000 triangles, enabled remeshing and symmetry, and disabled rigging and animation.

The service refused the request with `only_mcp_usage_on_trial_is_available`, exit code 3. No job ID was returned. No credit change was observed. Account balances, workspace IDs, login URLs and account discovery responses are excluded from the transferable package. The error establishes the refusal observed in this session. It does not prove a particular paid plan or upgrade will resolve it.

The chat connector did not expose a callable native 3D-generation command when checked. Scene-builder tools can edit a scene but were not used as a substitute for image-to-3D generation. No credentials were copied into the art folder. CLI authentication state belongs to the user's installed tool outside this handoff and must not be packaged.

The user chose website generation. Preserve the prepared reference and exact prompt. The next art action is to inspect a GLB the user exports from the site, if supplied. Confirm texture maps, materials, geometry, scale convention and orientation before running Starfare import checks. Do not call the local v4 mesh a generated result and do not repeat the refused paid request automatically.

## Repository and process state

This grouping repository is `C:/Users/PC-AIMPANG/Documents/ChatGPT/Starfare`. Its branch is `master`, HEAD is unborn, and it has no remote. The art folder is untracked. No art commit, push, merge or application edit was made. The coordinator owns serial packaging into the application repository. Existing local changes remain in place.

The process audit finds no running Node, Chrome or Higgsfield process whose command line points into this art workspace. Saved preview ownership records all report stopped processes and released ports. The CLI login processes exited. The handoff does not stop unrelated user browsers, apps or services.

## Transfer policy

`art-artifacts-sanitized.zip` is release material, not a Git source file. It contains versioned source, original and derived images, GLBs, maps, sprites, review pages, embedded offline previews and test evidence. Original legacy ZIP files are omitted because their unpacked payload already exists and some contain process ownership records. Their original paths, checksums and sizes remain indexed and the original files stay on disk.

The package excludes account metadata, catalog/schema caches, raw process logs, process ownership records and generated engine HTML snapshots. Snapshot code is already owned by the application repository. Test reports retain assertions, counts and cleanup outcomes while the package copy omits owned process IDs. The source report is preserved unchanged. The manifest records transformed entry hashes separately.

The manifest marks every source file over 50 MiB. Embedded v2/v3 previews and legacy archives contain duplicate binary payloads. The coordinator can commit this concise handoff, source scripts, prompts, manifest and selected manageable references. Large models and review media belong in the draft release. No `.env`, credential store, browser profile, cache directory or private benchmark data belongs in the package.

## Reproduction commands

From this handoff folder, regenerate the inventory and release archive with `powershell -NoProfile -File ./package-art.ps1`. The script verifies each archive entry and fails on a missing source file, wrong GLB header, saved-hash mismatch, forbidden credential pattern or archive mismatch. Its negative control also verifies that a deliberately wrong expected digest is rejected without modifying an artifact.

The existing model checks remain separate. V3 and v4 provide `node validate.cjs` and `node verify.cjs` in their folders. V3 requires `node verify.cjs --engine` for the engine checks. V4 includes engine checks by default. Use the existing Codex runtime Playwright and Sharp and the installed Chrome. Repoint the check scripts only after inspecting the new application checkout and keep original source hashes. Do not rebuild old models merely to refresh a handoff.

## Handoff method

Build the Lever supplied the rerunnable packaging script. Model the Domain supplied per-artifact records with provenance, approval status and transfer policy. Prove It Works required reading the actual files, matching saved hashes, auditing processes and verifying every archive entry. No independent shipping review, commit or merge is claimed.

Completion is recorded in `handoff-verification.json` after the archive passes. The remaining decisions are website output review, final visual acceptance, engine lighting review, game asset selection and production performance budgets. These decisions are not resolved by this handoff.
