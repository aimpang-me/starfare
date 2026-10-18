# Asset provenance

The current `assets/sky-engine.js` is an unchanged copy of merged-main `ff66fbc` `connector/src/engine/sol-page.cjs`, used for ephemeris lookups. SHA-256: `13f5c2f0d2187b352d67d914057c54fb320aed3b020e642758478bd11dda8d65`. It supersedes the audit-baseline copy (`6130a4578ea4e569cfed68c816120990d4bec9d36db1d6b02a94eb31a19d15a7`), preserved in the external synchronization backup. All 11 saved snapshot positions match the updated engine exactly. See [SYNC-HANDOFF.md](SYNC-HANDOFF.md). The ship callouts reuse the existing Kestrel cutout for fictional sample members of the same class. No engine or Art original was edited.

## Current solar-system canvas revision

The current canvas uses unchanged copies of the repository's `design/assets/sol-art.js`, `tex/` files and `stars-bsc5.json`; their full attribution and existing transformations are retained in [SOLAR-CREDITS.md](assets/SOLAR-CREDITS.md). The renderer uses the planet/Sun materials and a separate sparse decorative star background; it does not present the catalog as live sky data. Three.js r128 was downloaded from `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`; the MIT license is retained in `assets/THREE-LICENSE.txt`. `assets/system-snapshot.json` is extracted from the baseline engine by `build-snapshot.cjs`; no engine code is modified.

Earth/Moon disk photographs below remain assets of the saved dashboard study. The current WebGL canvas instead uses the project's equirectangular planet textures. Kestrel and Inter are reused. The SHA-256 manifest now includes the complete local asset tree.

All runtime assets are local. No remote fonts, trackers or image requests are required by the prototype. See `asset-manifest.json` for sizes and SHA-256 hashes.

## Kestrel spacecraft

`assets/kestrel.png`: 1536 × 1024 RGBA PNG. Built-in image generation produced a UI cutout derived from Starfare Art's existing concept sheet. Alpha at corner and top edge verified as zero; the rendered asset was inspected on the dark UI. The main navy delta-hull craft, amber passenger windows and restrained cyan seams are retained. There are no logos, exhaust flames or implied active engines.

Original, read-only Art reference:
`C:\Users\PC-AIMPANG\.codex\generated_images\01a14be0-eb35-7433-9ef0-8b13ecc6a61d\exec-10aef7cd-ab38-407e-98f6-be1ca31233ee.png`

Generated derivative:
`C:\Users\PC-AIMPANG\.codex\generated_images\01a14bbd-d30d-70e2-92eb-fb5d80d02d45\exec-66d6a41a-4faf-4365-8553-0e80ecf5500a.png`

Prompt:
> Create a clean transparent-background UI asset from this Starfare Kestrel concept sheet. Extract and faithfully preserve ONLY the large upper three-quarter spacecraft, same nose-left pose, exact hull silhouette, navy panels, metallic edges, amber passenger windows and restrained cyan seams. Remove all background, text, orbital lines and the two smaller alternate-view ships. The entire one main ship must fit with 8% transparent margin on every side. High-quality crisp photoreal industrial render, true alpha transparency, no ground shadow, no backdrop, no letters, no added elements, no glow halos, no flame, no exhaust, engine apertures remain dark. This is a derivative interface cutout of the supplied fictional spacecraft design, not a new design.

No source Art file was modified. Vehicle identity, seat capacity and performance are not approved by this visual treatment.

## Celestial imagery

- `assets/earth.jpg`: [DSCOVR EPIC / NASA source and credit](https://science.nasa.gov/earth/earth-observatory/an-epic-new-view-of-earth-86257/). [Downloaded image](https://assets.science.nasa.gov/dynamicimage/assets/science/esd/eo/images/imagerecords/86000/86257/epicfirstlight_DSC_2015186_lrg.jpg?fit=contain&w=1200). The UI clips the photograph to a circular body silhouette; the source file is unchanged.
- `assets/moon.png`: [NASA Scientific Visualization Studio / LRO source and credit](https://science.nasa.gov/resource/moon-mosaic/). [Downloaded image](https://assets.science.nasa.gov/dynamicimage/assets/science/psd/earths-moon/outreach-materials/NASA-LRO-Moon-mosaic.png?fit=contain&w=800).

These are real imagery, not a live Earth/Moon view. The map labels body sizes, placement, orbital lines and paths as illustrative and not to scale. Orbital depot and Lunar hub are fictional.

## Typography and icons

- `assets/InterVariable.woff2`: [Inter official repository](https://github.com/rsms/inter), Rasmus Andersson. License retained in `assets/Inter-OFL.txt`. Downloaded from `https://raw.githubusercontent.com/rsms/inter/master/docs/font-files/InterVariable.woff2`.
- Small UI icons are inline SVG primitives authored for this prototype, with consistent rounded 1.5 px strokes. No SpaceX or xAI marks are used.

## Research

Refero's inspected [xAI contact screen](https://refero.design/pages/f992731e-2dc9-4fe6-8d9a-647450903885) informed whitespace, fine dividers, simple typography and outlined actions. The result retains Starfare's Dark SOL identity; it is not affiliated with either referenced company. Full research limitations are recorded in `DIRECTION.md`.
