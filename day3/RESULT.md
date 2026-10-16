# SOL day 3: the checker is a gate (2026-10-16)

**Done-when met: the suite goes red on a planted made-up number.**

## What runs
`python3 day3/run_regression.py` checks 20 recorded cases (the day-1 rider requests, answered fresh by the agent team against today's planner) and fails if any of these breaks:
1. **Planner drift:** every planner command an answer cites is re-run and must match its golden output (`day3/golden/`).
2. **Provenance:** every number in the rider-facing answer must appear in those outputs, or in the rider's request, at the precision printed (`code/provenance.py`). Untraced numbers are struck: `~~4.2~~[no tool made this]`.
3. **Physics:** a QUOTE must cite a `--verify` run that the n-body re-fly passed.

## Results
- Clean run: **20/20 pass**, twice in a row (about 2 minutes each), so the goldens are deterministic.
- Planted test (`--plant 2` adds "Estimated fuel: 4.2 tonnes." to case 2): **19/20, exit code 1**, and the answer comes back with the 4.2 struck.
- CI file: `.github/workflows/sol-regression.yml` runs both. It needs a GitHub repo to actually run in CI; today it runs locally.

## What changed in the agents' answers vs day 1 (same 20 prompts, better planner)
- #14 Roadster: day 1 offered Mars (a non sequitur). Now it is a verified QUOTE: depart 2027-02-14, 605 days, C3 3.6.
- #6 Ceres: day 1 declined. Now a verified QUOTE, and the agent flags that the optimum sits at the edge of the rider's window.
- #13 diamond planet: day 1 quoted wrong Uranus/Neptune numbers. Now it asks "Uranus or Neptune?"
- #4 Mars weekend: day 1 quoted; now it asks which launch window. Slightly worse; counted as acceptable.

## Known limit
Provenance proves a number came from a tool, not that the sentence around it is true. Day 1's Uranus mistake (traced numbers, wrong "not launchable" claim) would still pass this gate. The fix is planner-side: the edge-of-search flag and wider search, which is done.
