# Starfare model handoff for Monday, 19 October 2026

Prepared on 18 October 2026 in America/Toronto. This is the entry point for the incoming model. The integration receipt and final verification below are completed after Engineering, Design, and Art finish their current tasks.

## Start here

1. Read this document and the linked team handoffs before changing code.
2. Fetch `origin`, inspect the current checkout, and compare it with `origin/main`. Preserve local changes and existing worktrees.
3. Read `CLAUDE.md` for repository instructions. Its older deployment and test counts are historical. Use the dated verification evidence linked here.
4. Distinguish the application, standalone design studies, offline propulsion evaluations, and published service. A merge does not deploy the Worker.
5. Continue the priorities below. Do not select fleet hardware or deploy without the user's explicit authorization.

## Product and rules

Starfare is an ongoing passenger-flight game and bring-your-own-agent platform across the solar system. Its portfolio origin is history. The website observes; agents plan and dispatch through MCP. Grok-first does not require an xAI API key. Tools and stored field names can retain legacy `hail`, `ride`, and `car` identifiers while product copy uses booking, flight, passenger, and Starseeker.

- Preserve Dark SOL / Design F and the user's later canvas-focused design decisions. Read the final Design handoff for the actual implemented interface.
- Mobile prioritizes bookings and compact activity. Default activity includes agent and simulation events, with local previews excluded from feed data and counts.
- Use explicit Real, Fictional, Simulated, and Demo labels. Never invent flight numbers, telemetry, scientific performance, or measured test results.
- Real flight positions, timestamps, route arcs, holds, and arrivals come from recorded data. Cosmetic clocks and camera easing must not change simulation time or create physical events. Engine effects require supporting recorded state.
- Logs do not automatically train an agent. Existing episode exports do not establish chronological training trajectories.
- No Tesla, SpaceX, Grok, or xAI logos or affiliation claims. Text “Works with Grok” is permitted.
- Keep reports short: what changed, what remains broken, what comes next. Use `pstack:bro` where available.

## Authority at handoff

The user authorized finishing current team work, preparing documentation, committing, pushing, and merging the completed work after the team finishes. The user has not authorized a deployment, Cloudflare change, hosted secret update, fleet replacement, or paid asset generation as part of this handoff. A proposal or a trial quote is not spending approval.

Engineering's diagnostic ledger and offline Option B studies are authorized research. Their presence in Git does not enact new runtime physics. Ship options require human review before fleet changes. Keep unresolved thermal, pressure, tank, mass, and trajectory assumptions visible.

Never reset, clean, delete, or repurpose other worktrees to synchronize them. Inspect the real branch and file state first. Do not stop every Node or Python process by name. Track each process you start, stop your own idle helpers and descendants, and verify exit and port release. Keep previews only while needed and record their owner, URL, and shutdown method. Avoid duplicate servers.

## Checkouts and chat ownership

| Owner | Local path | Scope |
| --- | --- | --- |
| Engineering | `C:\Users\PC-AIMPANG\Documents\New project 3\starfare` | Engine, diagnostics, calculations, MCP, storage, replay, tests |
| Design | `C:\Users\PC-AIMPANG\Documents\New project 3\.worktrees\starfare-design-audit` | Interface, materials, cosmetic motion, accessibility, mobile, studies |
| Art | `C:\Users\PC-AIMPANG\Documents\ChatGPT\Starfare\art\2026-10-17` | Original assets, concepts, model trials, specs |
| Handoff integration | `C:\Users\PC-AIMPANG\Documents\New project 3\.worktrees\starfare-monday-handoff` | This guide and transfer packaging |

The saved Starfare project directory is a grouping repository with no original remote or commits. It is not the application checkout. Do not initialize a replacement application there or force-push it.

All existing chats run on host `local`:

| Chat | ID |
| --- | --- |
| Orchestrator | `01a14bd8-b2f1-7263-8157-c27e23315e68` |
| Engineering | `01a14b8c-865f-7190-9521-f573021ac7c7` |
| Design | `01a14bbd-d30d-70e2-92eb-fb5d80d02d45` |
| Art | `01a14be0-eb35-7433-9ef0-8b13ecc6a61d` |

Read recent human messages before continuing a chat's task. Observe the host's direct-human-authorization requirement before messaging another chat. Old task prompts can describe superseded PR states; GitHub and dated integration receipts establish the actual version.

## Established merged baseline

PR #13 fixed seasonal booking parity, shared manifests, individual booking results, stored-arc replay, and dispatcher notes. It merged as `0ff06ee0417574a27b2f29b577ceba96652703e4`.

PR #14 fixed shared-flight continuation departing before the preceding landing. It merged as `ff66fbc4532ec694770099e257dcc7214b9faaa0`. The original reproduction overlapped by 37.7 simulated minutes. Persisted historical records were not rewritten. See [booking and replay](BOOKING-REPLAY.md) and [timing correction](SHARED-FLIGHT-TIMING.md).

At that baseline, engine SHA-256 is `13f5c2f0d2187b352d67d914057c54fb320aed3b020e642758478bd11dda8d65`, score version is 3, and suite v1 contains 20 dev and 19 test tasks selected from 80 candidates per split. The completed PR #14 verification was 145 unit tests, 43 local Worker checks, and passing Python CI. Those counts describe that baseline, not every later commit.

## Propulsion: diagnostics are not a new fleet

Read [Engineering's final handoff](ENGINEERING-HANDOFF-2026-10-19.md), [propulsion audit](PROPULSION-AUDIT.md), [ledger](PROPULSION-LEDGER.md), [verification](PROPULSION-VERIFICATION.md), and [fleet options](FLEET-OPTIONS.md).

The runtime planner combines impulsive transfers with low-thrust operating points. A successful gravitational re-flight does not establish propulsion feasibility. The audit's 26 accepted canonical legs required more firing time than flight duration at their quoted fixed operating points. Whole-itinerary carried fuel, payload, reserves, refueling, and power require explicit accounting.

The new ledger is diagnostic and separates necessary bounds, conditional projections, missing inputs, and finite-thrust verification. No finite-thrust certification follows from a passing accounting test.

Offline Option B evaluates a proposed four-engine chemical cluster. Saved local, Phobos, and lunar trajectories have stated assumptions and numerical acceptance checks; none selects actual fleet hardware. Read the reports in this order:

1. [Local transfers](OPTION-B-LOCAL-EVALUATION.md).
2. [Phobos departure and Mars rendezvous](OPTION-B-PHOBOS-EVALUATION.md).
3. [ISS to lunar station](OPTION-B-LUNAR-EVALUATION.md).
4. [Tank and reserve budgets](OPTION-B-SHIP-BUDGETS.md).
5. [Feed pressure](OPTION-B-FEED-PRESSURE.md).
6. [Thermal power](OPTION-B-THERMAL-POWER.md).
7. [Heat transfer and installed hardware](OPTION-B-HEAT-TRANSFER.md), the latest budget assumptions.

Earlier payload estimates are superseded by the later studies. Under the latest declared allowances, the medium courier has a conditional 290 kg cargo budget; the small courier is about 73 kg overweight empty, and the cabin concept is about 5 kg overweight with two people and no cargo. Actual engine heat maps, bottle and loop conductance, startup energy, continuous operation, and supplier-qualified hardware remain unresolved. A closing mass ledger is not proof of an operable vehicle. Lunar propellant and waiting-time results are conditional trajectories, not a practical taxi-service claim.

The completed ledger verification before later offline studies was 202 unit tests and 43 local Worker checks. Later numerical reports specify their own cases and do not claim a full application-suite rerun. Use the final integration verification receipt for the combined tree.

## Design and Art

Read [Design's handoff](design-audit/2026-10-17/DESIGN-HANDOFF.md) before reusing prototypes or effects. Historical studies remain evidence, not the current application. PR #16 implements the canvas-focused Mission Control interface, compact mobile details, corrected route precision and ship headings, and restrained material effects for every mapped planet and moon. Earth/Moon have sourced relief maps; other worlds use declared rough, icy, haze or gas treatments. Recorded-flight motion remains authoritative. Physical phone GPU performance and final user visual acceptance remain unverified.

Art has concept packs and local model experiments. Do not describe a procedural approximation as a generated Higgsfield reconstruction or a concept drawing as an approved production asset. The latest attempted Higgsfield CLI generation was rejected with `only_mcp_usage_on_trial_is_available`. Art supplied an isolated Kestrel reference and a prompt for the user to generate on the website. No completed Higgsfield GLB was established at handoff preparation. Check the final Art manifest for any subsequent supplied result.

Higgsfield's catalog has exposed Meshy, Tripo, and SAM 3D tools in some turns, but connection and account entitlements changed during the session. Verify actual access and quote the credit cost before generation. Do not request secrets in chat or silently use a paid fallback. Design added vendored GSAP 3.15.0 for interface and camera transitions; its notice is in `design/assets/vendor/`. It does not tween physical flight paths or simulation time.

Large transferable media is indexed in [the Art transfer guide](../art/README.md) and [Art's final handoff](../art/handoff-2026-10-19/README.md). Originals stay in place. Use the sanitized archive and checksums in the final integration receipt to recover files on another machine.

## Secrets and deployment

The new benchmark key and held-out selection/results live outside Git in `C:\Users\PC-AIMPANG\starfare-private\`. The key filename is `bench-key.txt`. Do not print, commit, attach, or export its contents or hidden test evidence. Preserve previous key/suite/trace combinations separately.

A future explicitly approved release must provision the Worker with the key that generated its test split. The new suite must not silently run against an older hosted key. Old traces require their matching engine, suite, and key. Do not recut held-out worlds merely to avoid locating the right key.

No deployment is authorized. The published service may differ substantially from merged main. Historical named Worker versions in old docs are not live verification. No production health or physics certification is claimed by this handoff.

## Reproduce the application checks

Use Node 24 where available. Check `connector/package.json` for current scripts and the final verification receipt for exact commands and results. From `connector/`, install the locked dependencies with `npm ci` when needed, then use `npm run test:unit` and `npm run test:e2e`. These tests start local Worker processes; ensure the harness closes them.

From the repository root, the timing reproduction is `node audit/shared-flight-timing.mjs`. Engine checks include `node world/engine/test-hazards.js` and `node world/engine/test-reroute.js`. Python CI runs `python day3/run_regression.py` and requires `python day3/run_regression.py --plant 2` to fail. The workflow installs numpy, scipy, jplephem, and skyfield-data.

The existing GitHub workflow runs the Python regression. Passing GitHub gates do not prove every JavaScript, browser, or Worker test ran remotely. A proposed connector CI patch has historically required workflow-token authorization; inspect its final status rather than assuming it was applied.

Engine changes require rebundling with `python world/bundle.py`, rebuilding the connector, and genuinely regenerating affected benchmark references with the correct key. Never edit a suite's engine SHA by hand to bypass compatibility checks. A documentation, visual, or diagnostic-only change must not silently alter production physics, scoring, or held-out tests.

## Recommended next work

1. Review the final local UI and motion with Alvin. Passing interaction checks do not establish visual quality or acceptance. Review real and clearly labeled sample flight states on desktop and mobile.
2. Resolve Option B's missing thermal and feed evidence before choosing fleet hardware. Present assumptions and alternatives for human review. Keep offline studies separate from runtime physics.
3. Inspect the first actual Kestrel textured GLB, if supplied or approved for generation. Check silhouette, underside, material maps, geometry, scale, pivot, orientation, and file size in the real renderer. Do not expand the fleet before that trial proves useful.
4. Address remaining run/score version compatibility, chronological observation/action exports, and failure recovery from the plumbing audit as separately scoped work. Other agents' ships do not yet establish a real berth-reservation system.
5. Prepare deployment only after explicit approval, including the benchmark-key/suite pairing. Merging this handoff grants no deployment permission.

## Final integration receipt

Pending team finalization. Record the merged PRs, retained branches/worktrees, artifact archive URL/checksum, final combined checks, known failures, and retained process state here before completion. The incoming model must recheck remote main, because the documentation commit cannot contain its own final commit hash.
