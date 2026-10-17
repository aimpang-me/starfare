# Next steps for whoever picks this up (2026-10-16)

Read `CLAUDE.md` first. Its "Rules from Alvin" section applies to everything below.

## Where things stand
- Design F is live. Main is at ab0b4c9. The last named deploy is Worker ff7f8356 at https://starfare.aimpang.workers.dev/. That deploy runs engine c5fdd816, and suite v1 on that deploy is the re-cut for engine c5fdd816.
- The Roadster place and its Chebyshev series are out of the engine. This repo's bundle sha is 44a1f7fe, which is not the deployed engine. Suite v1 in `connector/src/suites/v1.json` is the re-cut for that sha (dev 18, test 16). `loadSuite` accepts it.
- From `connector/`, the dev split is `node bench/make-suite.mjs --id v1 --out` with `--out` pointed at a file that is not `src/suites/v1.json`. The test split is `node bench/make-suite.mjs --test-into src/suites/v1.json --test-selection` with the selection file outside the repo and `STARFARE_BENCH_KEY` set. `--out` pointed at `src/suites/v1.json` drops the test split.
- The live site was checked before this engine change. It has no Roadster text, and all 21 planet and moon textures return 200.
- On this tree, after the 44a1f7fe re-cut: hazards 8 of 8, reroute 8 of 8, `node world/engine/test-no-roadster.mjs` passed, connector unit tests 72 of 72, e2e 41 of 41, and `python3 day3/run_regression.py` 20 of 20. Two earlier full e2e runs lost the held-out `start_bench` check to `Network connection lost` from wrangler dev. The next full run passed 41 of 41.

## Open follow-ups
- Suite v1 is re-cut. Do not write `engine_sha256` into `src/suites/v1.json` by hand on a later cut. At deploy time, from `connector/`, run `node node_modules/wrangler/bin/wrangler.js secret put STARFARE_BENCH_KEY` and paste the key that cut this test split, then deploy. That deploy needs Alvin's go. The key stays out of the repo. Traces played under the previous key no longer verify.
- Log & Reports lists flight logs where the mockup shows a scoreboard receipt, because `/board.json` has no receipt feed yet.

## Leave alone unless Alvin says
- Branch `claude/nice-albattani-90f2cb` (2fbc7e7) is an engine change that would also need a suite re-cut.
- Old sessions and worktrees. Alvin declined archiving them.
- The old Worker `sol-connector`.
- The uncommitted `kit:` export line in `.claude/worktrees/focused-lovelace-afac7e/design/assets/sol-art.js`.
