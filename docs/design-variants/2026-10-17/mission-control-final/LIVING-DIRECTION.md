# Living solar system refinement

User direction: larger/more visible planets and ships, less dominant panels, a living world, minimal clean UI. This is a refinement of the approved canvas hierarchy, not another layout replacement. Primary references remain Dark SOL / Design F, the original orbital mockup, and the inspected Refero Spline/OneSoil screens recorded in CANVAS-DIRECTION.md.

## Visual decisions

- Increase planet display radii and minimum screen sizes so textures and Saturn's rings survive the overview, including mobile. The scale disclosure remains visible.
- Replace the single diamond-as-ship treatment with recognizable Kestrel artwork, callsigns and thin leaders to sample station anchors. Show three sample docked ships across Earth, Mars and Saturn; adapt callouts to available phone space.
- Reduce the booking panel to compact route rows, start desktop activity collapsed with a readable event count, remove the redundant fleet card, and reduce the selected-booking bar. Lower the panel fill/border contrast while keeping text readable.
- The solar scene carries the visual weight. No new dashboard metrics, decorative pulses, dust effects, drifting controls or status glows.

## Motion thesis

The focal motion is the solar system itself: run a clearly labeled sky preview at one simulated day per real second using the existing engine ephemeris. Planet positions and Moon/Titan offsets update from engine states. Camera framing follows a focused destination without changing simulation time independently. Orbit curves remain epoch reference curves. No eased or fabricated flight timeline.

Pause is always available beside the date. Reduced-motion preference starts and switches the preview to paused; manually resuming is an explicit opt-in. Hidden documents and modal dialogs suspend playback without catching up hidden time. Stop at the ephemeris boundary. Rendering is capped at 30 FPS desktop / 20 FPS small screens; paused scenes render only on interaction.

The three ships are explicitly local fixtures, docked to their parent worlds. Their anchors move with those worlds; they never depart, burn, coast or arrive. Their presentation offsets and icon sizes are exaggerated for readability. Flight replay remains a separate, timestamped sample and emits no activity event.

## Boundary and validation

Changes stay in this standalone prototype. Copy the baseline browser engine into its assets without editing source. Keep its hash and source attribution. PR #13 integration hold and coordination of site.html / flight.html remain in effect.

Build fully, inspect desktop/mobile together, apply one correction batch and one final confirmation. Verify playback/pause, clock and positions, reduced motion, hidden/dialog suspension, no invented flight events, clearer spacecraft, overlay footprint, keyboard/modal behavior, mobile sheets, and no horizontal overflow. This is a prototype verification, not a hardware performance claim.
