# Design handoff — Monday, October 19, 2026

## State and integration ownership

- Repository: https://github.com/aimpang-me/starfare
- Branch: `codex/design-audit`, based on merged #13/#14 at `ff66fbc`.
- Latest production implementation: **`5cb1ab9`** (all mapped planet/moon effects). The preceding six commits contain Mission Control integration, compact mobile details, flight geometry/heading fixes, strategic projection and the effects plan.
- PR: **https://github.com/aimpang-me/starfare/pull/16**. Draft until final verification/evidence packaging finishes; readiness is visible on GitHub. **Do not merge independently of the Orchestrator**: the user's latest request says merge after all chats finish. No deployment is authorized.
- Worktree: `C:\Users\PC-AIMPANG\Documents\New project 3\.worktrees\starfare-design-audit`. Preserve this checkout and all local-only artifacts. Engineering owns its separate `starfare` checkout; do not reset or overwrite either.
- Shared application edit targets: `connector/src/site.html`, `connector/src/flight.html`, `connector/src/flight-view.cjs`, `connector/src/game.js`. Engineering must integrate serially. Engine/fleet/scoring assumptions were not changed by Design.

## Where to start

1. [Current all-world implementation and actual limits](planet-effects/RESULT.md).
2. [Earlier integrated application, route/heading and mobile evidence](integration/README.md).
3. [Original visual/accessibility/feed audit](README.md). Historical findings are not a fresh audit of the final implementation.
4. [Standalone historical variants](../../design-variants/2026-10-17/README.md), including Mission Control final/living/demo studies. Their demo curves and durations must never become application flight physics.
5. [Artifact inventory with sizes, SHA256 and role](HANDOFF-ARTIFACTS.json). It separately lists non-shipped source downloads/runtime state that remain in this worktree.

## Commands and evidence

From `connector/`:

```powershell
node build.mjs
node --test test/planet-effects.test.mjs test/solar-map.test.mjs test/ship-heading.test.mjs test/flight-geometry.test.mjs test/flight-route.test.mjs test/site-planning.test.mjs test/booking-replay.test.mjs test/flight-timing.test.mjs test/live.test.mjs test/live-keep.test.mjs
node --test test/*.test.mjs
```

The focused run passed **72/72**; final expanded full run **185/185** in 470.4 seconds, zero skipped/cancelled. See `planet-effects/tests-final.tap`, `full-unit.tap` (earlier 180/180) and `full-final.tap`. The first expanded run ended without a completion summary and is retained locally as `full-interrupted.tap`, never represented as a pass. A numeric Three r128 check passed **15/15** heading cases. Two fresh source reviews found no remaining Critical/Important blocker after the paused-replay-clock fix; the expanded reviewer independently passed a 40-test subset.

New production textures total **2,596,641 bytes**, with provenance and conversion in `design/assets/planet-assets.json`, `CREDITS.md`, and `design/prepare-planet-assets.py`. Existing world color maps are reused. There are no added runtime packages or renderer upgrades.

The engine bundle remains SHA256 `13f5c2f0d2187b352d67d914057c54fb320aed3b020e642758478bd11dda8d65`. CI's `sol-regression` workflow runs numerical regression and planted-error detection; it does not deploy.

## Local preview and process ownership

Actual integrated app: `http://127.0.0.1:8796/`; the old standalone prototype is port **8795**, not production.

The preview is temporarily retained solely for the user's explicit current local visual review. It is not an idle handoff service. The Orchestrator should stop it after that review and before finalizing the Monday handoff; its exact owned PID must be re-read from the local metadata immediately before cleanup. No other Design preview process needs to remain running.

Owned preview helper: `integration/serve-app.cjs`, persistent local state `connector/.wrangler/design-integration/` (ignored). Runtime ownership/PIDs are in local `integration/app-process.json`, not Git. It starts Wrangler on loopback, with local-only OAuth disabled, and self-terminates after 90 minutes. It has no effect on hosted configuration. When the handoff is finalized, stop its verified process tree and confirm port/process exit. Do not kill processes by generic Node/Wrangler name.

To restart for local review after dependencies are available, build first, then run the helper in a hidden process:

```powershell
Start-Process -FilePath 'C:/Program Files/nodejs/node.exe' -ArgumentList '"C:/Users/PC-AIMPANG/Documents/New project 3/.worktrees/starfare-design-audit/docs/design-audit/2026-10-17/integration/serve-app.cjs"' -WorkingDirectory 'C:/Users/PC-AIMPANG/Documents/New project 3/.worktrees/starfare-design-audit' -WindowStyle Hidden
```

Stop that owned helper before rebuilding. `build.mjs` replaces the asset directory; rebuilding under Wrangler's watcher can otherwise cause a transient missing-file crash. The local app must stay running only for the current requested visual review, then be stopped for the finalized handoff.

`planet-effects/seed-earth.mjs` dispatches through actual localhost MCP tools and saves local-only state. It creates a local simulated flight, not a hosted run. Existing captured run: `run_e8374be1e63e3ef02b36` (SF-01, Orbital Depot → ISS → Lunar Data Center); it may have finished by the next review. Replay remains available while that local store is preserved.

## Decisions and cost if wrong

- Execute the shared facade/material foundation together before its first commit: avoids a temporary renderer; cost is a larger initial review range.
- Start with Earth/Moon, then extend to every currently mapped world under the user's later instruction: no invented destinations; cost is that optional terrain relief remains limited to registered Earth/Moon assets.
- Use a separate presentation clock and surface children: keeps real endpoints and flight timing stable; no game-state authority is delegated to decoration.
- Add one Moon button to the existing dock: makes the Moon reviewable; cost is one extra horizontally scrollable item.
- Retain the existing illustrative tilt and slow periods (up to 720 seconds), with subdued gas drift: prioritizes restrained motion; cost is that this is not an accurate axial-rotation visualization.
- Use existing color maps for remaining worlds, never derive mountains from color: preserves honest provenance; cost is less close-up terrain detail outside Earth/Moon.
- Keep the Sun's compact existing halo static while its surface moves: avoids flare-like hazard cues; cost is no new corona-flow mesh.
- Optional layers use a smooth projected-size ramp, 1K/2K caps and page-lifetime shared caches: cost is retaining both detail tiers after both were visited, bounded rather than unbounded.
- The latest directly verified human handoff request supersedes independent automatic merge: push PR #16, coordinate merge only after all chats finish. Cost is waiting for the Orchestrator's integration step; deployment stays prohibited.
- Refero returned no matching style in this pass. Preserve the already approved Dark SOL / Solar Expanse target rather than inventing a new theme; cost is no additional live Refero reference.

## Open quality limits

- Physical phone GPU performance, resident memory, draw-call/frame-time profiling and exhaustive every-world/every-light/every-camera validation remain unverified. 390/360px viewport checks do not substitute for physical devices.
- Only Earth/Moon have registered normals. No storm/volcano/jet/flare effect claims live game state. No paid generation was performed.
- Deferred minor: resuming an offscreen/modal-stopped map can advance decoration by at most 0.1 seconds. Pause and hidden-tab paths disable the clock explicitly; no real flight state changes.
- Existing model/propulsion feasibility issues and any raw record timing warning belong to Engineering; do not hide warnings by rewriting logs or inventing route data.

No keys, `.env` files, browser profiles, caches, private benchmark selections or credential values are in this package. Local source/runtime artifacts are preserved in place and enumerated separately; none is individually larger than the repository's normal file limit.

## Sanitized local archive

The valuable source/reference downloads omitted from Git are preserved in `docs/design-audit/2026-10-17/design-source-reference-archive.zip` in this worktree: **5,508,678 bytes**, SHA256 **`b4fee93f26a1d5b998456def0bb8fb98921946812a6ac74b8903ff8d0b61f322`**. It contains only public source texture downloads and Solar Expanse reference images/HTML. No process ownership, auth, cache, browser profile or local application-state record is in the ZIP. [LOCAL-ARCHIVE.json](LOCAL-ARCHIVE.json) lists its contents and checksum. Originals remain intact. The ZIP is intentionally local/ignored; the Orchestrator can package it for the final handoff.
