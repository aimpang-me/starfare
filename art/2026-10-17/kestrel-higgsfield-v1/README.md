# Kestrel Higgsfield CLI trial

The official Higgsfield CLI 1.2.2 is installed, authenticated and connected to the selected workspace. Its live catalog and `image_to_3d` schema were retrieved successfully.

One Kestrel generation was requested with textures, PBR maps, remeshing to a 60,000-triangle target, triangle topology and symmetry enabled. Humanoid rigging and canned animation were disabled. The source is the unchanged original concept plus an isolated hero reference prepared with the built-in image tool.

Higgsfield rejected the request with `only_mcp_usage_on_trial_is_available` (exit code 3). No generation job ID was returned, no GLB was generated, and the workspace balance stayed at 110 credits. No Starfare test has run for a Higgsfield model.

`generation-output.log` preserves the rejection. `generation-request.json` preserves the exact requested settings. `model-schema.json` and `model-catalog.json` are the current CLI discovery responses. `setup-result.json` records setup and submission status.

The `source/` folder contains the original and isolated concept. The viewer, adapter and engine-check source are preparation only; they must not be presented as a completed or tested Higgsfield asset. The `models/` folder is empty.

To continue, the account must be eligible to generate through the official CLI, or the chat connector must expose a supported native image-to-3D command. Do not disguise CLI traffic as MCP or automatically repeat the refused request. No subscription or account upgrade has been purchased.
