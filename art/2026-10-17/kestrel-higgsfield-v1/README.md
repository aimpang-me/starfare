# Kestrel Higgsfield trial

**October 17, 2026, Higgsfield CLI: refused.** The official Higgsfield CLI 1.2.2 was installed and authenticated, and its catalog and `image_to_3d` schema were retrieved. One Kestrel image-to-3D request (textures, PBR maps, 60,000-triangle remesh, symmetry on, no rigging) was rejected with `only_mcp_usage_on_trial_is_available` (exit code 3). No job ran and no credits were spent. `generation-request.json` preserves the requested settings.

**October 18, 2026, Higgsfield MCP connector: generated.** With Alvin's approval (about 62 credits), the same isolated reference (`source/kestrel-isolated-reference.png`) went through the claude.ai Higgsfield connector to three image-to-3D models. All three meshes are in `models/`:

| File | Model | Triangles | Notes |
|---|---|---|---|
| `kestrel-tripo-h3_1.glb` | Tripo H3.1 | 57,140 | Bow on +Z, up +Y. Chosen: the game hull `design/assets/models/kestrel.glb` is built from it |
| `kestrel-meshy-v7.glb` | Meshy v7 | 60,133 | Bow on -X; needs +90 degrees about Y |
| `kestrel-hunyuan3d-v3.glb` | Hunyuan3D v3 | 499,822 | Bow on -X; comparison only |

Job IDs, credits, hashes and parameters are in `generation-2026-10-18.json`; `review/compare.png` and `review/hero.png` compare them. `tools/models/build-lods.mjs` makes the game version (about 15k triangles, 1024 px maps), and `design/assets/models/fleet.json` keeps it at `productionApproved: false`.

The viewer, adapter and engine check in this folder are the preparation harness. Rights and the open Tripo commercial-use question are recorded in `design/assets/CREDITS.md`.
