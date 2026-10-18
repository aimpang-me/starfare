# PR dependencies and design handoff

**Subsequent authorized phase:** after synchronization, the user requested integration into the actual app with real bookings/flight motion, GSAP and Refero, without deployment. This is implemented on `codex/design-audit` based on `ff66fbc`; source changes are confined to the coordinated home/flight HTML and presentation assets. [Current application handoff](../../../design-audit/2026-10-17/integration/README.md). The dependency/synchronization record below is historical context.

Latest direct GitHub/fetch check: 17 October 2026, following the user's version-sync request. Both PRs merged while the sync audit was running. Recheck GitHub before dependent implementation; do not use older chat summaries as current status.

| PR | Current state | Head | Base | Checks |
|---|---|---|---|---|
| [#13 — Align seasonal bookings, shared manifests, and replay](https://github.com/aimpang-me/starfare/pull/13) | MERGED | `codex/booking-replay`, `575ce905ac1beb6912c1aa5381035b223dd9c01d` | `main` | Earlier reported gates SUCCESS |
| [#14 — Fix shared-flight continuation after delayed landings](https://github.com/aimpang-me/starfare/pull/14) | MERGED | `codex/shared-flight-timing`, `f0564ba493ba2b5cfcb8fa461674cec8cab4424d` | `main` after retarget | Earlier reported gates SUCCESS |

**Change from the relay:** #13 merged at 23:39:17 UTC, merge commit `0ff06ee0417574a27b2f29b577ceba96652703e4`. #14 was retargeted to main and merged at 23:39:36 UTC. Fetched `origin/main` is now `ff66fbc4532ec694770099e257dcc7214b9faaa0` (merge of #14, including #13). These are direct GitHub/fetch observations, not an inference from the interrupted merge request. This Design chat did not perform either merge.

## Exact version labels

| Workstream | Label and actual checkout |
|---|---|
| Engineering candidate | **PR14 f0564ba**; clean `codex/shared-flight-timing` at `f0564ba493ba2b5cfcb8fa461674cec8cab4424d` when checked. Its changes are now included in merged main `ff66fbc`. |
| Design prototype | **Merged main ff66fbc + standalone presentation changes**; `codex/design-audit` at `ff66fbc4532ec694770099e257dcc7214b9faaa0`. Copied engine matches this commit. All 245 prior artifacts survived the fast-forward unchanged and have verified external backups. The presentation remains a fixture-based demo with no backend connection or production DOM integration. |
| Art | **Independent asset revision**; assets in the grouping project, not an application checkout. The prototype uses its recorded Kestrel concept derivative; do not imply that represents Art's latest independent revision. |
| Merged main | **ff66fbc**, full commit `ff66fbc4532ec694770099e257dcc7214b9faaa0`, observed after fetching. Agree/recheck this implementation target before integration work. |

PR #13 owns seasonal booking identity, shared manifests, held flights and recorded/replanned-arc replay. PR #14 fixes an empty pickup departing before the preceding landing and includes regenerated benchmark suites with the approved new local key. Successful reported CI gates do not imply deployment or substitute for every required validation.

## Required order and permissions

1. The requested merge order (#13, then retargeted #14) has now occurred outside this Design chat. Do not repeat those merges.
2. Recheck and agree on the resulting main commit before implementation. Current observed target is `ff66fbc`.
3. Design's own branch was safely fast-forwarded to `ff66fbc` under the subsequent synchronization authorization. Every prior artifact was protected externally and verified unchanged immediately after the fast-forward. Engineering's checkout was not modified. See [SYNC-HANDOFF.md](SYNC-HANDOFF.md).
4. Merged booking/manifest/replay DOM, payloads, clock and flight-state contracts were reviewed. Fixtures remain fixtures. Future application implementation must coordinate `connector/src/site.html` and `connector/src/flight.html` so Engineering and Design do not overlap edits. Art should target the agreed renderer/asset contract and version its GLB trial independently.

The previous waiting condition (#13 unmerged) is resolved. This synchronization updates the branch, copied dependency and truthful labels; it does not integrate the standalone presentation into application source. Future application implementation needs a coordinated scope on the agreed merged target. No deployment or hosted secret changes were performed.

## Ownership and motion boundary

- Engineering: physics, sky clock, flight state, holds, actual arrivals, replay and suite integrity.
- Design: interface, camera/UI transitions, responsiveness and accessibility.
- Art: artwork and effects.

Real flight positions and routes must follow Engineering's stored data. UI/camera easing must never ease simulation time or fabricate physical events. Explicit local demo flights remain authorized by the user's separate request and clearly labeled; they never enter the dispatcher feed and must never be substituted for real playback.

GSAP may be used directly for meaningful UI/camera transitions and needs no connector. Verify its current official APIs/docs before adding it; retain native CSS for trivial effects. Respect reduced motion, suspend inactive views, cancel/dispose timelines and listeners, and keep test/preview processes owned and cleaned up. GSAP has not been added to the current prototype.

## Current deliverable

The standalone prototype and evidence are summarized in [DEMO-README.md](DEMO-README.md). Its files remain on the independent design worktree. Preserve the historical notes as historical snapshots; use this file for the latest PR dependency status.
