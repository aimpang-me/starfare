# Living solar system integration

User authorization: integrate the selected living-system prototype into the actual app after merged PR #13/#14, with real bookings/recorded flight motion, GSAP, Refero research and no deployment. Base: `ff66fbc`. This supersedes the earlier source-edit hold for this work only. Historical audit/prototype evidence stays intact.

## Reference lock

Primary visual target: the user-selected living solar system prototype. Preserve the world-first canvas, visible textured planets/orbits, quiet Inter typography, small peripheral panels, neutral Dark SOL surfaces and restrained warm/cool state accents. No company logos or affiliation claims.

Refero styles searches for xAI, aerospace and monochrome technology returned no results; no full styles are claimed. Refero screen research retrieved the xAI API page (`68328aa1-e88e-4d2f-aaba-066fd5e54300`, https://refero.design/pages/68328aa1-e88e-4d2f-aaba-066fd5e54300) and Chargetrip's dark map (`9fb51c18-479b-4da4-8e27-c2ec36034d83`, https://refero.design/pages/9fb51c18-479b-4da4-8e27-c2ec36034d83); the latter image was inspected. Exact Star Citizen research in Refero returned unrelated map results. The official ARK Starmap at https://robertsspaceindustries.com/en/starmap?selection=SOL.PLANETS.EARTH&system=SOL establishes the 3D exploration reference; its text-only web response does not establish exact visual details.

| Decision | Source and bounded adaptation |
|---|---|
| Black canvas, clear sans type, rare accents, quiet borders | Selected prototype + Refero xAI screen; no marketing layout or decorative light flares |
| Map dominates; narrow floating panels and edge controls | Selected prototype + Refero Chargetrip; no red/teal borrowed brand tokens |
| Spatial solar system, focus navigation, textured worlds | User's Star Citizen direction + existing original SolArt; no borrowed game assets or fictional physics |
| Bookings default; compact Activity on mobile | Explicit user decision; preserve search/pagination and real seasonal IDs |
| Agent + simulation events, previews excluded | Explicit user decision; source labels and source filter, no invented feed activity |
| GSAP for focus and panel entrances | User request; official gsap.to/context/matchMedia docs reviewed. No easing of live time, paths, recorded holds or arrivals |

Tokens: background `#06090d`, surface `rgba(9,14,20,.94)`, primary text `#edf1f5`, secondary `#aab6c3`, hairline `#26323e`, cool selected/flight `#9cc3df`, warm solar/passenger `#e7c48c`; 4px UI radius. Existing planet textures/ship geometry retain provenance.

## Build and validation

1. Keep the merged engine, seasonal booking payloads, manifests, live tracks, stored arcs and replay calculations unchanged. Adapt the existing home scene and DOM around them.
2. Add shared local presentation assets and pinned GSAP. Home becomes a viewport canvas with compact booking list, collapsed Activity, utility drawer, selected-flight inspector, clock and keyboard/touch map controls. Flight replay receives matching typography/surfaces and valid return links without replacing playback.
3. Enlarge worlds/ships in scene units/pixels, explicitly retain compressed-distance/enlarged-body labels. Do not install illustrative prototype flights in production. No flights means a truthful empty state with parked fleet where engine data exists.
4. Preserve WebGL fallback, reduced motion, modal focus, data loading/error states, hidden-tab suspension and cleanup. Verify live recorded positions against existing replay math, not screenshot resemblance alone.
5. Run relevant/full connector unit checks and local Worker browser integration with actual MCP-generated bookings/flights. Save screenshots/results; keep test data and processes local. No deployment or hosted secret changes.
