# Plumbing investigation, 2026-10-17

Base: `3355b2c` (`main`). This is a source review and local verification of the engine/connector/storage/website boundaries. It is not a production or full scientific certification. No Cloudflare deployment or secret change was made.

Starfare is being developed as an ongoing passenger-flight game and agent platform. Its portfolio origin is history. Fictional assets and simulated gameplay are compatible with scientific calculations, provided the calculations, approximations and validation limits are explicit.

## Fixed in this branch

| Priority | Failure and cause | Change and reproduction |
| --- | --- | --- |
| P1 | Seasonal bookings existed only in the engine's in-memory `R.BY` map. A saved run reloaded into a fresh isolate failed at `hailInfo` with an undefined booking. | New runs retain booking rows. Every stored-run read restores the relevant rows; older seasonal runs regenerate their original season/index. Tests remove the in-memory row, reload a serialized run, and read it again. |
| P1 | Two run mutations could read the same state while an outbound hub RPC was pending. Both allocated the same leg id and one overwrote the other. A simultaneous leave could also be overwritten by a late plan. | Serialize `create`, `act` and `leave` per run. Tests deliberately suspend the hub lookup and overlap calls, then verify both legs, both charges, and the abandoned state. A rejected call must leave the queue usable. |
| P1 | The persistent leg-cache key omitted engine identity. A deployment changing physics or ship models could reuse an older engine's planned and checked leg. | Prefix the persistent cache key with the complete engine SHA. A regression supplies an old cached leg with different energy and checks that it is ignored, while the newly computed leg is reused. |
| P1 | Landing-page route and pickup previews omitted the selected ship argument. Legacy flight-arc reconstruction did the same. Those calculations silently used the default hull, including for outer-system ships. | Carry the par ship, candidate ship, or recorded flight ship through to `R.planLeg`. Execute the browser data-layer functions with a planner that refuses a missing ship. |
| P2 | `land()` supplied `score_version`, but the score projection discarded it. JSON episode exports consequently omitted the version too. The old assertion compared two undefined values. | Keep the version in the public score and require the actual version in the export test. The golden fixture update adds only this field to 14 existing views; no numerical result changes. |
| P1 | The documented `npm test` command ran only `game.test.mjs` plus e2e. CI ran only the older Python regression. Connector, replay, benchmark and export tests could be omitted from the normal checks. | Add explicit unit/e2e scripts and run every `*.test.mjs` through `npm test`. Proposed Windows/Linux connector CI jobs are preserved in `audit/connector-ci.patch`; applying them is pending the GitHub workflow permission described below. |
| P2 | The method-page integration test passed URL pathnames as Windows filesystem paths. Spaces remained encoded, causing `spawn ... ENOENT`. Its cleanup could hide the original failure or leave Worker children alive. | Convert URLs with `fileURLToPath`, handle spawn errors, stop the test's process tree and await asynchronous storage cleanup. Reuse process cleanup in e2e. |

Cloudflare documents that asynchronous calls can interleave even though Durable Objects execute JavaScript on one thread. Storage input gates do not serialize an entire operation containing outbound RPCs: [Durable Object state](https://developers.cloudflare.com/durable-objects/api/state/).

The engine source, bundled engine and benchmark task suite are unchanged. These fixes do not redefine scoring or recut the held-out split.

GitHub rejected the first push because the CLI OAuth token lacks the `workflow` scope needed to update `.github/workflows/sol-regression.yml`. The workflow file is unchanged in the published fix. The exact, unapplied CI change is retained as `audit/connector-ci.patch` for review. After workflow authorization is available, it can be checked with `git apply --check audit/connector-ci.patch` and applied. The existing Python CI remains in place; automated connector CI is still pending.

Read-only production checks on 2026-10-17 returned HTTP 200 for `/` and `/engine.js`, and HTTP 404 for `/method`. The live engine SHA is `c5fdd816d464827c7879256f69dd084e66c5928522b4e5ee642b9564cdd69732`; the reviewed main branch and suite use `6130a4578ea4e569cfed68c816120990d4bec9d36db1d6b02a94eb31a19d15a7`. This is deployment drift already anticipated in the handoff, not evidence that this branch has reached production.

## Important scientific model gap, reproduced

The planner prices real ion-thruster set points, propellant and power, but plans impulsive transfers. It does not integrate finite-duration thrust into the trajectory or enforce a burn-duration budget. A gravitational re-flight validates its gravitational trajectory model; it does not establish that the chosen propulsion system can fly that trajectory.

Run from the repository root:

```sh
node audit/propulsion-sanity.mjs
```

At request JD 2461700.5, with the existing engine and the energy objective:

| Route / ship | Planned transit, days | Energy, kWh | Stated thruster power, W | Powered days at that set point |
| --- | ---: | ---: | ---: | ---: |
| ISS to Lunar Data Center / SF-01 | 4.9822 | 21,611 | 2,310 | 389.8088 |
| Phobos to Mars Base / SF-03 | 0.09284 | 3,221 | 490 | 273.8946 |
| Titan to Earth / SF-07 | 1,595.0861 | 84,889 | 490 | 7,218.4524 |

The diagnostic divides electrical energy by electrical power, then converts hours to days. It assumes uninterrupted operation at the reported set point and excludes coasting and additional operational time. Even this simplified powered duration exceeds the planned transit in these cases.

This is a model inconsistency requiring finite-thrust planning or a consistently specified alternative propulsion model. Changing a score weight or relabelling the astronomical data would not resolve it. NASA describes electric propulsion as continuous thrust over months or years, which changes the trajectory: [Basics of Space Flight, trajectories](https://science.nasa.gov/learn/basics-of-space-flight/chapter4-1/), [Dawn ion propulsion](https://science.nasa.gov/mission/dawn/technology/ion-propulsion/).

## Remaining integration work

These are source-traced findings, not claims that the full workflows have been independently exercised in a browser.

1. **Public booking views differ from the agent's booking pool.** `mcp.js` lists the seeded seasonal pool, while the homepage injects the five catalog bookings. Its scoreboard also iterates that catalog and can omit seasonal winners returned by `/board.json`. The desk, map and score table need the same seasonal data contract and a usable presentation for the larger pool.
2. **Shared-flight results are richer than the flight page.** `game.js` emits per-booking scores and stop-by-stop passenger counts. `flight.html` constructs one booking and displays placeholder cabin data; its passenger rows reuse the overall score. The manifest must read the recorded booking and passenger data.
3. **Runs and score comparisons lack a stored engine identity.** Public best rows contain points but no engine SHA, score version or score denominator. `recordBest` compares totals directly. Persisted live runs also need a policy for continuing across engine changes. Runs from different rule versions should not compete as if their points were equivalent; legacy records need an explicit migration/display policy.
4. **Learning exports are summaries, not an exact chronological action replay.** `episode.js` groups forecasts first, plans next, then dispatch and checkpoints. That can reorder interleaved decisions. Preserve the original observation/action sequence before treating these files as training trajectories. Keep the held-out test worlds protected.
5. **Other players' flights do not yet drive actual berth occupancy.** The public map reads live flights; the engine's docking counts remain seeded NPC traffic. Connecting these requires a clearly defined shared clock and reservation model so benchmark repeatability is preserved.
6. **Cross-object writes need failure-injection coverage.** A run is saved before its board/history/live writes finish. If a hub write fails, retry behavior needs investigation and idempotent recovery; this has not been reproduced against workerd in this pass.
7. **The independent scientific audit remains open.** Check finite-thrust feasibility first, then endpoint models, corrected-burn costs, mass/propellant across chained legs, and the scope of the re-flight claim. Existing Python/JavaScript agreement is useful port verification, but shares algorithms and inputs.
8. **Scoring needs empirical calibration.** The current `scoreRatio` is at most 0.35, so the algebra caps all scores at 35,000 despite a 100,000 denominator. That is a deliberate rule, not an arithmetic defect. Assess task difficulty through differences in decisions and outcomes, baselines and repeated attempts. The local simulator's landed-only mean is labelled, but comparisons should also include completion rates; the benchmark harness has separate repeated-attempt statistics.

## Verification

Local environment: Windows, Node 24.20.0.

- `npm run test:unit`: 122 passed, 0 failed, 0 skipped.
- `npm run test:e2e`: 43 passed, including OAuth off/on and a complete Worker restart with preserved storage.
- `node world/engine/test-local-gm.js`: 3 checks passed.
- `node world/engine/test-seeded-hails.js`: 4 checks passed.
- Engine source, connector bundle, engine metadata and suite SHA match exactly.
- The 14 changed golden views differ only by the added `score_version` field.
- `git diff --check` passed. The proposed workflow YAML parsed with Python and Windows/Linux connector jobs present; the saved patch passes `git apply --check` against the unchanged workflow.
- After the test cleanup lifecycle guard was added, the method-page, storage and site-planning tests were rerun: 16 passed.

The initial complete unit run exposed the method-page Windows failure; it was not treated as a clean baseline. Linux CI, deployed behavior of these changes, and a complete browser interaction pass are not established by the local results.

The targeted regressions were observed failing before their fixes. The propulsion diagnostic continues to show a model gap and is deliberately separate from passing software regression checks.
