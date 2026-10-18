# Mission Control — final-look prototype

17 October 2026. Standalone design artifact on `codex/design-audit`, based on audit commit `783986893d427e7963e0acf0d598d71d8772badb`. The user selected Mission Control and requested a crystal-clear, minimal, SpaceX / xAI-inspired refinement. This supersedes the earlier study's Orbital Desk recommendation for this prototype.

## Review

- Live local preview: http://127.0.0.1:8795/ while the preview helper is running.
- [Desktop screenshot](screenshots/final-desktop.png), [phone](screenshots/final-390.png), [small phone with map expanded](screenshots/final-360-map.png), [tablet](screenshots/final-768.png).
- [Manifest](screenshots/final-manifest.png), [replay](screenshots/final-replay.png), [loading](screenshots/final-loading.png), [empty](screenshots/final-empty.png), [unavailable](screenshots/final-unavailable.png).
- [Direction and research](DIRECTION.md), [motion and integration](MOTION.md), [asset provenance](ASSETS.md), [verification results](verification-final.json).

This is the proposed final visual treatment: Dark SOL navy-black, white typography, generous space, thin separators, restrained cyan/amber semantics, actual celestial imagery, and a detailed fictional spacecraft cutout. Data and connections remain explicitly illustrative. The ship image is an Art concept, not an approved production vehicle or capacity specification.

## Interactions

Select a booking to inspect its route and passenger manifest. Filter activity by Agent or Simulation, or pause updates. Inspect the spacecraft and step through local replay records. Connect agent explains BYOA setup and copies a starter prompt; it does not configure a real connection.

On phones, two bookings and two activity entries appear first. Expand either list, open the route, or use Flight replay beside Inspect spacecraft. Replay stays outside dispatcher activity and its count. There is no human-facing dispatch action.

The review controls at the bottom demonstrate loading, empty and connection-unavailable states. The incoming-event control inserts exactly one labeled sample agent event, and queues it while paused. Retry restores a local fixture; it makes no network request. All three booking fixtures use the Earth–Moon corridor to give the visual example a coherent scope; this does not change production routes.

## Verification

Two bounded browser rounds: initial inspection, a single refinement batch, final confirmation. Final: **39 checks passed**, no JavaScript page errors captured. Tested Chrome at 1440, 768, 390 and 360 CSS pixels. No horizontal overflow or mobile viewport scaling; manifests and category filters update correctly; replay preserves the held position and does not add feed events; paused updates queue once; restored states work; dialogs retain keyboard focus and Escape restores it; mobile replay is reachable; reduced motion creates no animation; idle UI has no animation.

Core text-token contrast checks range from 8.55:1 to 17.73:1. This is a targeted design verification, not a full screen-reader, cross-browser or WCAG conformance audit. Browser viewport emulation is not physical-device testing. `verify.cjs` uses the local cached Playwright package path and closes its browser in `finally`.

The manual Impeccable detector ran once before refinement; its raw output remains in `detector.json`. Addressed undersized metadata, top-banner padding, mobile map text and Replay access. Remaining structural padding reports were reviewed visually: section boundaries have intentional spacing, and filter tabs deliberately meet their underline. Inter is retained to preserve Dark SOL rather than changing the established typeface to satisfy a generic font warning. The detector was not rerun and its JSON is not a post-fix result.

## Integration hold

**Do not copy this prototype into application source before PR #13 is integrated and the merged implementation is reviewed.** No merge or deployment was performed. `git diff --stat` was empty at completion; artifacts are untracked design files, not application edits.

| Proposed target | Reconcile after PR #13 |
|---|---|
| `connector/src/site.html` | Spacing/type tokens, Bookings + compact activity on mobile, source-filtered feed and counts, disclosure/dialog behavior, asset references, truthful loading/freshness. Re-read the actual manifest and event schema first. |
| `connector/src/flight.html` | Matching tokens and accessible replay controls; bind time, position, hold, checkpoint and event labels to recorded data. Preserve real ephemeris and the production renderer. |

The schematic map here is explicitly illustrative and must not replace the production orbital model. Engineering owns simulation correctness and booking/replay wiring. UI animations never create burns, departures, arrivals, or coasting thrust. Preserve Art originals; review final vehicle selection separately.

## Local preview lifecycle

Run `node serve.cjs` in this directory to restart, only when port 8795 is free. The server binds to localhost and serves this artifact directory only. Current process ownership and PID are in `preview-process.json`; the retained process at delivery is Node **29368**, owned by Starfare Design for user review. It shuts down after 45 minutes without requests or two hours total.

Graceful shutdown: send an HTTP POST to `http://127.0.0.1:8795/__stop`. Do not stop processes by name. Verification helper Node/browser PIDs 41596/90384 and 37712/61152 were closed and absent at the final process check. No verification browser or Python helper was retained.
