# Starfare — labeled demo flights

Latest version sync: [Synchronization handoff](SYNC-HANDOFF.md). **Design branch now includes merged PRs #13 and #14 at ff66fbc**, with a matching copied engine. The presentation remains a standalone demo with sample bookings and illustrative flights; no backend or production DOM integration is implied. All prior artifacts were protected and verified through the fast-forward. Art remains independently versioned. Historical status snapshots below are superseded.

Current standalone prototype: http://127.0.0.1:8795/?design=demo-flights

The user requested visible ship travel with smooth, restrained motion and explicit demo labels. The moving ships now follow illustrative curved paths between destinations. The solar system remains the primary canvas; compact panels, the larger planetary assets and the Dark SOL direction are preserved.

## Review

- [Motion recording](recordings/demo-flights.webm), about seven seconds of the running prototype.
- [Desktop](screenshots/demo-final-desktop.png) · [Earth–Moon](screenshots/demo-final-earth.png) · [Tablet](screenshots/demo-final-900.png)
- [Phone](screenshots/demo-final-390.png) · [Small phone](screenshots/demo-final-360.png) · [Phone Earth focus](screenshots/demo-final-390-focus.png)
- [Motion decisions and current PR context](DEMO-FLIGHTS.md) · [Verification](verification-demo-final.json)

## Controls and behavior

Demo flights starts enabled. `DEMO–01` travels Earth–Jupiter and `DEMO–02` travels Saturn–Mars in system view. Earth/Moon focus substitutes `DEMO–03`, an Earth–Moon demonstration. The remaining sample SF–07 stays docked. Ships have recognizable Kestrel artwork, gold DEMO callsigns and faint dashed paths; the persistent Demo flights control says “Illustrative paths.” Inspecting one explains its visual-demo role.

The bottom-left pause/play button controls both sky and demo motion. Demo flights can be unchecked to restore the original docked sample fleet. The restart control returns the demo tour to its initial, staggered mid-flight phases without changing the sky time or playback preference.

System demos take 28 and 38 wall-clock seconds per direction, with 3 and 4 second endpoint stops; the lunar demo takes 18 seconds with 3 second stops. These are **visual durations, not transit-time estimates**. The loops return continuously along their curves, rather than teleporting to their origins. Smoothstep affects only these explicit visual flights; the engine-driven sky clock remains linear at one simulated day per real second. Ship artwork is anchored directly to the projected route position so collision avoidance never jumps a moving ship between callout candidates. Planet labels resolve around it.

Reduced motion starts paused. Explicitly choosing Play opts into playback. Modal dialogs and hidden-state events suspend both clocks without catching up hidden time. Existing render caps remain 30 FPS desktop / 20 FPS phones. No engine flame, fabricated burn state, dispatch action, or new network write is introduced.

**Demo flights never enter dispatcher activity or counts.** Agent + simulation activity remains the original four-entry sample snapshot; recorded replay remains its own timestamped example. Demo IDs differ from SF callsigns so illustrative motion cannot be mistaken for a recorded SF–01 flight.

## PR correction and application boundary

The user correctly pointed out that this prototype's PR context lagged Engineering. Live GitHub/read-only branch checks confirmed:

- [PR #13](https://github.com/aimpang-me/starfare/pull/13), OPEN at `575ce905ac1beb6912c1aa5381035b223dd9c01d`, already implements stored/replanned arc playback, manifests, holds and final arrival state.
- [PR #14](https://github.com/aimpang-me/starfare/pull/14), OPEN at `46a41c36ccc1ddced49c6d309423ac18394659ad`, supplies the delayed-landing continuation fix; Engineering was validating regenerated benchmarks when checked.
- `origin/main` and this audit worktree remain on PR #12 baseline `7839868`. The copied engine is used for planetary ephemeris, not to manufacture real flights. The demos are explicitly authored visual fixtures.

No PR branch was merged, no deployment was made, and no application source was edited. **Proposed `connector/src/site.html` and `connector/src/flight.html` changes stay on hold until PR #13 integration and coordination.** Later application motion must follow PR #13's selected stored arcs and PR #14's actual-landing continuation semantics. Never copy the illustrative Bézier curves, visual durations, or demo return loops into recorded-flight playback.

The prior statement that visible flight motion had to wait for PR #13 was incorrect: recorded playback already exists in that open PR. The current task demonstrates movement now while respecting the integration boundary.

## Verification and evidence limits

The final Chrome run passed **42 checks**, with no captured page/console errors or failed asset responses. Covered 1440×900, 1280×720, 900×900, 390×844 and 360×740. Checks cover actual ship-position changes, both clocks, pause/idle rendering, inspector labeling and focus, demo toggle/restart, unchanged activity, endpoint/stop/return/loop continuity, lunar focus, modal suspension/resume, reduced-motion changes/startup/explicit Play, phone controls and viewport overflow.

Boundary checks sample immediately before and after each arrival, stop departure, return arrival and loop wrap while paused; all remained continuous. The main rendering review used one initial desktop/mobile batch and one final confirmation. The first test pass read a media-preference change before its asynchronous event; the harness now waits for the resulting paused state. Video capture initially used a local-path API unavailable on the remote browser connection; it was repaired to use `saveAs`, and the complete final check was rerun. These were verification-harness fixes.

The motion recording is a real browser capture of this prototype. Tests use software-rendered Chrome and viewport/touch emulation; they are not physical-device performance or full accessibility certification. No unit/CI results from PR #13/#14 are claimed as executed by this design task.

The Impeccable detector ran once for this change. [Raw results](detector-demo.json) contain deliberate 11 px metadata warnings, the existing filter underline report, and the retained Inter font. The established Dark SOL font and compact metadata were preserved. The detector was not rerun.

## Artifacts and process ownership

- [Previous docked-fleet version](canvas-docked.html) and [its notes](LIVING-README.md) remain saved. Older static-canvas and dashboard studies also remain available.
- Assets and their credits are unchanged. The demo uses the existing Kestrel cutout; no new image generation was needed. [Asset provenance](ASSETS.md).
- The existing Starfare Design server, PID **29368**, remains the only retained helper at localhost:8795. Its 45-minute idle / two-hour lifetime limits and HTTP POST `/__stop` shutdown remain in effect. [Process metadata](preview-process.json).
- Initial Node/browser pair 8956/82640, recording-repair pair 87728/60856, and final pair 66944/72600 all exited; verification browsers close in `finally`. No unrelated process was terminated.
