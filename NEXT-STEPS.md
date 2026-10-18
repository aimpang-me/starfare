# Next steps for whoever picks this up (2026-10-16)

Current priorities and integration receipt: [Monday 19 October 2026 model handoff](docs/MODEL-HANDOFF-2026-10-19.md). The dated sections below are historical and must not override the current handoff or GitHub state.

Read `CLAUDE.md` first. Its "Rules from Alvin" section applies to everything below.

## Current Engineering follow-up (2026-10-17)

- PR #13 aligns bookings, manifests and replay. PR #14 is its stacked timing correction; details and evidence are in `docs/SHARED-FLIGHT-TIMING.md`.
- The timing branch uses engine `13f5c2f0d2187b352d67d914057c54fb320aed3b020e642758478bd11dda8d65`, score version 3, and genuinely regenerated suite splits: dev 20, test 19, each selected from 80 candidates. The public selection report now uses the current scoring rules.
- Alvin approved a new local benchmark key. It and the private selection evidence live outside Git in `C:\Users\PC-AIMPANG\starfare-private\`; the key file is `bench-key.txt`. Previous local files were preserved.
- No merge, hosted secret update or deployment was performed. After release approval, the Worker must receive this same new key before serving the new suite. Old test worlds/traces need their matching old suite and key.
- See PR #14 for the latest completed verification. The propulsion-feasibility gap remains a separate follow-up.

## Earlier baseline (2026-10-16)
- Design F is live. Main is at ab0b4c9. The last named deploy is Worker ff7f8356 at https://starfare.aimpang.workers.dev/. That deploy runs engine c5fdd816, and suite v1 on that deploy is the re-cut for engine c5fdd816.
- The Roadster place and its Chebyshev series are out of the engine. This repo's bundle sha is 44a1f7fe, which is not the deployed engine. Suite v1 in `connector/src/suites/v1.json` is the re-cut for that sha (dev 18, test 16). `loadSuite` accepts it.
- From `connector/`, the dev split is `node bench/make-suite.mjs --id v1 --out` with `--out` pointed at a file that is not `src/suites/v1.json`. The test split is `node bench/make-suite.mjs --test-into src/suites/v1.json --test-selection` with the selection file outside the repo and `STARFARE_BENCH_KEY` set. `--out` pointed at `src/suites/v1.json` drops the test split.
- The live site was checked before this engine change. It has no Roadster text, and all 21 planet and moon textures return 200.
- On this tree, after the 44a1f7fe re-cut: hazards 8 of 8, reroute 8 of 8, `node world/engine/test-no-roadster.mjs` passed, connector unit tests 72 of 72, e2e 41 of 41, and `python3 day3/run_regression.py` 20 of 20. Two earlier full e2e runs lost the held-out `start_bench` check to `Network connection lost` from wrangler dev. The next full run passed 41 of 41.

## Open follow-ups
- Suite v1 is re-cut. Do not write `engine_sha256` into `src/suites/v1.json` by hand on a later cut. At deploy time, from `connector/`, run `node node_modules/wrangler/bin/wrangler.js secret put STARFARE_BENCH_KEY` and paste the key that cut this test split, then deploy. That deploy needs Alvin's go. The key stays out of the repo. Traces played under the previous key no longer verify.
- A scored row on the public board links to `/flight/<run_id>`, and that page shows the receipt. The board table itself still does not inline the seven parts. The home map keeps the newest landed flight after the 60 second window.

## Leave alone unless Alvin says
- Branch `claude/nice-albattani-90f2cb` (2fbc7e7) is an engine change that would also need a suite re-cut.
- Old sessions and worktrees. Alvin declined archiving them.
- The old Worker `sol-connector`.
- The uncommitted `kit:` export line in `.claude/worktrees/focused-lovelace-afac7e/design/assets/sol-art.js`.
