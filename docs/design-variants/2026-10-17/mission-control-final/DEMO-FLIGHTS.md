# Demo flight motion

The user explicitly requested clearly labeled demo flights with smooth, restrained motion in the standalone prototype. This authorizes illustrative motion; it does not turn a demo into a dispatched or recorded flight.

## Current PR context, checked 17 October 2026

- `origin/main` and this audit worktree remain at PR #12, `7839868`.
- PR #13 is OPEN at `575ce905ac1beb6912c1aa5381035b223dd9c01d`. It already implements recorded arc selection, shared manifest presentation, held-flight retention, orbit arrival vs landing, and endpoint arrival state. The prototype previously understated that progress.
- PR #14 is OPEN at `46a41c36ccc1ddced49c6d309423ac18394659ad`, stacked on #13. It fixes continuation after actual landing; Engineering is still validating regenerated benchmarks. Its timing behavior must be considered in future integration.
- These are read-only status/contract checks. No PR branch is merged into the design worktree and no application file is edited.

## Motion and labeling decisions

Two system-view demo shuttles move Earth–Jupiter and Saturn–Mars. Earth focus provides an Earth–Moon demonstration. Each has a `DEMO` callsign and a faint dashed path. A persistent Demo flights control says the paths are illustrative. Inspecting a demo repeats that its path and duration are visual examples, separate from planning, dispatch and recorded replay.

Use smooth curved movement, slow visual travel, short endpoint stops, and a continuous return leg. No instant wrap/teleport at a loop boundary, thruster plume, or fake event feed entry. The live ephemeris sky and the local demo animation have distinct clocks: the sky rate stays one simulated day/second; demo durations are wall-clock visual durations and do not claim transit times.

The existing pause/play control stops both sky and ship motion. Demo flights can be disabled to restore the original docked sample fleet. Restart returns the demo tour to its initial phases. Reduced-motion starts paused; dialogs and hidden-state events suspend both clocks without hidden-time catch-up. Retain the existing 30/20 FPS render caps.

The moving ship artwork is anchored to its projected path position, rather than switching callout candidates mid-flight. Labels may occlude at endpoints briefly, but ships must not jump to avoid labels. Planet labels continue to resolve around the moving ships. Camera movement remains user-controlled.

## Integration hold

All code stays in this artifact directory. Keep proposed changes to `connector/src/site.html` and `connector/src/flight.html` on hold until PR #13 integration and coordination. Later production motion must use its stored/replanned arcs and PR #14's actual-landing timing semantics; never copy these Bézier paths or visual loops into real flight playback.
> Current branch and copied engine: merged main `ff66fbc`, including PR #13/#14. Presentation remains a standalone demo. See [synchronization handoff](SYNC-HANDOFF.md); earlier PR status entries below are historical.

