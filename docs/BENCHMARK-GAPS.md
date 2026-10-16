# Starfare as an agent benchmark: what is missing

Date: 2026-10-16. Code read at commit `628387b` (main); first written at `61abb1b`, and every line citation was re-checked at `628387b`. Question from Alvin: what capabilities are we missing to have this a BENCHMARK for agents as solar system dispatchers.

This is a research note. No code was changed. It was reviewed by four models (pstack interrogate) and a benchmark-mode design was sketched by four more runs (pstack architect); both are recorded at the end, and their corrections are folded in. Every claim carries a label:
- **[verified]**: read in the code or docs at the cited line, or measured by a run described in this note.
- **[sourced]**: read from a cited external page by a research agent through a summarising fetch tool. I did not re-read the page myself.
- **[checked]**: a [sourced] claim re-checked on 2026-10-16 by a second set of agents that opened the paper or repo itself and gave the section, table or file. Corrections from that pass are already applied; see "Second pass" below.
- **[inferred]**: my reasoning from verified facts. It may be wrong.

Everything in Starfare's world is simulated (riders, fleet, weather, traffic, fares). Planet positions are real (NASA JPL DE421).

## Verdict

Starfare is a well-built scored game. It is not yet a benchmark. **[inferred]**

It already has the hard parts that many benchmarks lack. **[verified]**
- A fully programmatic scorer with no LLM judge (`world/engine/sol-rides.js:455-476`).
- A seeded, deterministic hazard world (`sol-rides.js:56-89`, `node world/engine/test-hazards.js`: 7 passed in this session).
- A hindsight oracle at each checkpoint (`sol-rides.js:342-367`).
- A pure game core that runs in plain Node (`connector/src/game.js:7`).

What it lacks is the scaffolding that makes two scores comparable. **[inferred]**
- A fixed task instance: today the instance depends on the moment the agent calls `take_hail`.
- A harness that anyone can run offline against any model.
- A leaderboard that reports a model's average and spread over a fixed suite instead of the best run per hail.
- Tasks with room to separate agents. In the baseline sweep below, a naive heuristic averages 95.3 over 500 simulated rides and scores exactly 100 on 263 of them, so a perfect agent can gain at most 4.7 points on average over naive. A random dispatcher averages 52.6 when its 30 unplannable rides count as 0. **[verified]**
- A hidden test split. Hiding the seed is not enough: every hazard passes through a 32-bit hash state, and two runs in this review recovered or enumerated it in 25 to 93 seconds of Node. **[verified]** (see gap 1)

## How established agent benchmarks do it

The research covers τ-bench, τ²-bench, Vending-Bench, SWE-bench (and Verified), WebArena, OSWorld, AgentBench, GAIA, the METR task standard and time-horizon work, Inspect and HELM. It also uses two critiques: the Agentic Benchmark Checklist (ABC, https://arxiv.org/html/2507.02825) and "AI Agents That Matter" (AATM, https://arxiv.org/html/2407.01502). The full notes, with a source URL for every claim, are in the shared session notes as `benchmark-research.md`. Every figure in this table and in this section was first **[sourced]**, then **[checked]** against the primary source: τ-bench arXiv 2406.12045, τ²-bench arXiv 2506.07982 and github.com/sierra-research/tau2-bench, SWE-bench github.com/SWE-bench/experiments, WebArena arXiv 2307.13854, OSWorld arXiv 2404.07972, GAIA arXiv 2311.12983 and its Hugging Face leaderboard space, Vending-Bench arXiv 2502.15840, METR time horizons arXiv 2503.14499, ABC v5 and AATM. Claims the second pass corrected are reworded here; the list of corrections is in "Second pass" below.

| Property | What established benchmarks do | Starfare today |
|---|---|---|
| Fixed task set | Every one ships a fixed list: τ-bench has 115 retail and 50 airline tasks (τ Table 1); SWE-bench Verified 500; WebArena 812 from 241 templates; OSWorld 369 Ubuntu tasks, 30 of them deliberately infeasible, plus 43 Windows versions of Ubuntu tasks; GAIA 466 (166 dev, 300 test). | 5 hail templates. The instance (start time, seed) floats with the wall clock. |
| Held-out test split | GAIA keeps the answers to its 300 test questions private and gates the dataset on Hugging Face. AATM found 7 of 17 surveyed benchmarks have no holdout and no plan for one, and says builders should "consider" keeping test sets secret (AATM §5, Table 1). | None. The engine is public and the seed is shown to the agent. |
| Frozen, resettable environment | WebArena resets from Docker images; OSWorld resets from a VM snapshot plus per-task setup scripts. ABC T.6 asks for an environment "fully reproducible and frozen at the time of benchmark release" (ABC §4.1); 13 of OSWorld's 46 Chrome problems broke as live sites changed (ABC §5.2, App. D). | Deterministic per seed, but the live season changes every run of the 7000-second clock. |
| Isolation from ground truth | ABC T.5: "fully isolate agents from the ground truth results". | Not isolated (see gap 1). |
| Verifiable scoring | τ-bench: database end state must match, times required facts present in the agent's replies (τ §3); τ²-bench adds status, natural-language assertion and action checks. Unit tests (SWE-bench FAIL_TO_PASS and PASS_TO_PASS), quasi-exact match (GAIA), execution checkers (OSWorld), net worth (Vending-Bench §2.4). | Strong: a programmatic score from the flown ride, no judge. |
| Trivial and oracle baselines | ABC R.13 asks for trivial agents and T.9 for an oracle solver. ABC's do-nothing agent scored 38% on τ-bench airline, above a GPT-4o agent's 35%; a spamming agent scored 40% (ABC §1, App. E.2). τ²-bench runs an "Oracle Plan" ablation in its telecom domain only (τ² §4.2). | Par is an energy oracle. No trivial baseline is published; this note measures two. |
| Human baseline | WebArena 78.24% (170 tasks, 5 graduate students), OSWorld 72.36%, GAIA 92% (validation annotators), Vending-Bench one 5-hour human run, METR 800+ baselines totalling 2,529 hours used to calibrate task length. ABC R.12. | None. |
| Repeats and reliability | τ-bench defines pass^k; gpt-4o retail drops from 61.2 at pass^1 to under 25% at pass^8 (τ §3, Table 2, Fig. 4; the paper gives no exact pass^8). τ²-bench's leaderboard strongly prefers at least 4 trials per domain. METR runs 8 attempts per task and reports 95% CIs from a 3-level hierarchical bootstrap (task family, task, run; 10,000 samples; arXiv 2503.14499 §2.3, §3.2). ABC R.10 asks for significance. | One best score per hail. No repeats, no spread. |
| Cost and steps | τ-bench gives a one-off cost analysis (about $0.38 per task for the agent and $0.23 for the user simulator); Vending-Bench 2 bills $100 per million output tokens weekly in game; OSWorld caps its main experiments at 15 steps, and OSWorld-Verified reports o3 between 9.1% and 23.0% across step settings; Inspect has message, token, time, working-time, turn and cost limits. AATM asks for accuracy-vs-cost Pareto curves and token counts. | Plan calls are counted and capped at 40. Forecasts are free. No tokens, time or total call count. |
| Runnable harness | τ²-bench (`tau2 run`, any provider via LiteLLM), SWE-bench (Docker, Modal, sb-cli; MIT), WebArena, AgentBench and HELM (Apache-2.0) and Inspect are open source. ABC R.2. | The game core runs in Node and the Worker runs under `wrangler dev`, but there is no agent runner. |
| Versioning | τ²-bench submissions carry `tau2_bench_version`; its one stated non-comparability rule (below 1.0.1 vs 1.0.1 and later) covers only the banking_knowledge domain, and superseded entries move to `legacy_submissions`. The original τ-bench tasks are stale: the repo is now τ³-bench with "75+ fixes". Inspect logs a task `version`. METR's archived task standard declares `standard_version = "0.5.0"`. | MCP version is a constant 0.1.0. No version on runs or board rows. |
| Leaderboard integrity | SWE-bench requires a tech report and trajectories for every rollout behind a best@k score; its "verified" checkmark is opt-in, and maintainers re-run a random subset (`swebench submit verify` only re-grades). τ²-bench marks an entry "Unverified" unless trajectories are available, prompts are unmodified and no task is omitted, and requires the base split with the same agent and user arguments. OSWorld-Verified re-runs agents for its verified board. GAIA's board lists every entry, one per model and organisation, with one submission a day from accounts at least 60 days old. | Best-of-N per hail, unnamed agent, across seasons. |

Two lessons from the critiques apply directly. **[inferred]**
- **A programmatic score is necessary, not sufficient.** τ-bench's reward let a do-nothing agent (38%) and a spamming agent (40%) beat GPT-4o (35%) on airline (ABC §1, App. E.2). Starfare needs the same trivial-agent tests before anyone trusts its numbers. The sweep below runs two.
- **Long-horizon benchmarks report spread, not best runs.** Vending-Bench runs each model 5 times and tables the minimum beside the mean (Table 1; ±1 SD bands appear in Figs 3-4), because the worst run shows how reliable a model is. Starfare's checkpoints are a small version of the same risk.

## What Starfare has today

| Capability | Status | Evidence | Label |
|---|---|---|---|
| Task set | Partial | 5 hails: iss-crew, phobos-commute, jovian-hop (quick); titan-home, ceres-shift (long). `sol-rides.js:22-33`. 7 simulated cars, `sol-rides.js:11-19`. | verified |
| Fixed task instances | Lacks | `newRun` sets `t0 = floor(sky(now).jd + (quick ? 1 : LEAD)) + 0.5` and the hazard seed to the season number (`game.js:77-78`). There is no task ID that pins `t0` and seed. | verified |
| Deterministic environment | Has | Hazards are a hash of `seed\|key` (`sol-rides.js:55-89`). The test "same seed same weather, other seed differs" passed. | verified |
| Seeds | Partial | One seed per sky season (`game.js:41-42`); a season lasts 7000 sky days at 1 sky day per real second (`game.js:14-17`, `world/build.py:31`). The comment at `game.js:5` says "a season plays the same for everyone". | verified |
| Held-out split | Lacks | No split of hails, seeds or start times. The hazard code and every seed are public in the repo. | verified |
| Clock independent of agent speed | Lacks | Interplanetary legs go cold if their departure passes before `dispatch` (`game.js:293-297`). The rule checks only the first non-local leg. Every leg of the 3 quick hails, from each of their near cars, is a local hop (checked with `R.system` in this session), so only long hails can go cold. Long hails are booked `LEAD = 150` sky days ahead (`sol-rides.js:9`), so about 150 real seconds. The rules text tells the agent the ride's clock waits at checkpoints (`game.js:135-139`); that is an instruction string, not the mechanism. | verified (rule); inferred (that latency is scored) |
| Simulated user | Lacks | Riders are fixed hail records, not a conversational user. There is no rider to ask, clarify with or disappoint. | verified |
| Verifiable scoring | Has | Score /100 from what was flown: pickup 20, on time 20, energy vs par 20, promise 15, checker 10, fare 10, economy 5 (`sol-rides.js:455-476`). No LLM judge. | verified |
| Score ceiling (oracle) | Partial | `par()` tries nearby cars with ground waits and a hindsight checkpoint search (`sol-rides.js:404-432`, `ORACLE_DEPTH = 3` at line 105). It minimises energy, then arrival. It is not the maximum of the total score, and agents can beat it (`beat_par`, line 475; the energy part is capped at 20). | verified |
| Per-decision regret | Has | `regret(ride)` gives each checkpoint's options in hindsight (`sol-rides.js:356-367`), shown in the run log as `options_hindsight` and `best`. | verified |
| Baselines (random, heuristic, human) | Lacks | None published. HANDOFF says "a naive bot now averages about 92-98 on quick hails" with no script or data (`docs/HANDOFF.md:23`). This note measures random and naive baselines; see below. | verified (no baseline in repo); inferred (that HANDOFF's line has no data behind it anywhere) |
| Multi-run reliability (pass^k, variance) | Lacks | The public board keeps one row per hail, the max points (`connector/src/store.js:178`, `209-215`). A player's own `get_my_rides` does give per-hail means, best, last and the part lost most (`rideStats`, `game.js:489-503`). There is no spread, no per-model view and no fixed repeat count. | verified |
| Agent and model identity | Lacks | `planned_by` is hard-coded to "Grok bot (connector)" (`game.js:320`). The board says Starfare "can't confirm which MCP client called it" (`connector/src/board.js:25`). With OAuth on, a player is an anonymous id per grant. There is no model field. | verified |
| Cost and step accounting | Partial | Plan calls are counted and capped at 40 a run (`game.js:12`, `174`); 6 are free and each extra one costs a point (`game.js:322`, `sol-rides.js:462`). Forecasts are free, unlimited, and may look anywhere in the season (`forecastFrom`, `game.js:215-221`). Tokens, total tool calls and wall time are not recorded. | verified |
| Honesty of numbers | Partial | INSTRUCTIONS tell the bot to copy every number from a tool (`connector/src/mcp.js:31`). The score checks the quoted fare (10 points within $1), the quoted arrival (promise, 15) and whether flown legs passed the checker (10) (`sol-rides.js:459-468`). Free-text numbers in a reply are not checked. The day-3 provenance gate (`code/provenance.py`) checks every number but is not wired to the connector. | verified |
| Harness others can run | Partial | `game.js` is pure (`game.js:7`) and the tests drive it in Node. `connector/test/e2e.mjs` runs the Worker locally under `wrangler dev`. There is no agent runner, no model adapter and no results file. | verified |
| Trajectory logs | Has | Run logs and JSONL exports in format `starfare.ride/1` (`game.js:451`), and `get_my_rides` returns past rides. | verified |
| Versioning | Lacks | MCP server version is a constant "0.1.0" (`mcp.js:41`). Board rows hold hail id, title, run tag, points, car, pickup wait, kWh, par, plans, time and player tag, but no season, seed, engine or score version (`store.js:40-44`). The terms cache key carries an informal "p2" tag (`store.js:195-197`). | verified |
| Contamination resistance | Lacks | Within a season the hazards are fixed and the run log shows when they hit, so a second run of the same season can use the first run's log. The design notes call this "within-season hindsight", open decision 7 (shared notes `run-log-history-design.md:79`). | verified (leak exists); inferred (that it inflates scores) |
| Anti-gaming on the board | Partial | Rate limit of 120 requests a minute per IP, by default (`connector/src/index.js:56-66`; `RATE_PER_MIN`). Best-of-N keeps the luckiest run. Nothing stops many retries of one hail in one season. | verified |
| Prior multi-model eval | Has, retired | Day 6 ran Opus, Fable, Sonnet and Haiku on 20 fixed rider requests with one brief, a cached planner and `day6/score.py` gates (`day6/RESULT.md`). Grok was not run in day 6 (`day6/RESULT.md` gives the reason: no key was available for that run). That was a day-6 limit, not a Starfare requirement; Grok bots play through the MCP connector. This was the old planner game, not the hail game. | verified |

## Measurements made for this note

All rides here are simulated. The numbers below come from one offline sweep run in this session against the engine bundle at this commit. **[verified]**

**Method.**
- A scratch script loads `world/engine/sol-page.js` and calls the engine directly: `R.terms`, `R.nearCars`, `R.planLeg`, `R.start` and `R.score`. It is reproduced in the appendix so the numbers can be re-run. It does not go through `game.js` or the connector, so the cold-hail rule, the checker gate that `dispatch` enforces, and the wall clock play no part.
- Grid: seeds 1 to 10, start offsets of 200, 900, 1600, 2300, 3000, 3700, 4400, 5100, 5800 and 6500 sky days into the season, and all 5 hails. That is 500 rides. `t0` follows `newRun` (`game.js:78`): one sky day later for quick hails, `LEAD` later for long ones. `R.terms` succeeded on all 500.
- Each ride is flown to the end with no checkpoint decisions (`ask_after_hours: null`) and scored by `R.score` against that ride's own terms and par.
- The four dispatchers:
  - **random:** a random car from the whole fleet and a random objective (energy or time), quoting the planned arrival. It retries up to 5 times when planning throws, but its `plan_calls` is fixed at 2, so retries cost it nothing in the economy part. In 30 of 500 rides it never got a plan (titan-home 22, ceres-shift 5, jovian-hop 2, phobos-commute 1). The table counts those rides as 0; leaving them out gives 56.0 over 470 rides.
  - **naive:** plans an energy leg pair for every car in `R.nearCars` (the same candidate set par searches, 1 to 3 cars per hail), takes the lowest planned kWh, and quotes the planned arrival. No forecasts, no buffer. Its plan calls (2 per car) count toward the economy part.
  - **par plan:** par's own legs, quoting the planned arrival. Par chooses its legs with hindsight, and this replay flies them on default checkpoint decisions, dropping par's own hindsight choices. Its legs are marked PASS without running the checker. It is a reference, not a baseline a real agent could reach.
  - **par + true quote:** par's legs as above, but quoting the arrival the ride actually had. No agent can know that before the ride. It is **not a ceiling**: it inherits par plan's dropped choices, and naive beats it on 22 rides.
- **Legs the connector would refuse.** Naive flew a FAIL-gated leg on 9 of 500 rides, all ceres-shift (re-counted in this session). Random did so on 2 (one reviewer's count, not re-run). `dispatch` refuses a FAIL leg (`game.js:290`), so the connector would have made those agents re-plan. Their scores here include the checker penalty instead. **[verified]**

**Results** (score out of 100, mean and range; random counts its 30 unplannable rides as 0):

| Hails | Rides | random | naive | par plan | par + true quote |
|---|---|---|---|---|---|
| All | 500 | 52.6 (0-100) | 95.3 (71-100) | 96.6 (68-100) | 98.6 (81-100) |
| Quick | 300 | 51.6 | 94.4 (71-100) | 96.2 (68-100) | 98.3 (81-100) |
| Long | 200 | 54.3 | 96.5 (72-100) | 97.1 (76-100) | 99.1 (90-100) |
| iss-crew | 100 | 51.7 | 92.3 | 93.1 | 96.0 |
| phobos-commute | 100 | 47.0 | 95.8 | 97.7 | 99.0 |
| jovian-hop | 100 | 55.9 | 95.2 | 97.8 | 99.8 |
| titan-home | 100 | 50.5 | 97.0 | 97.1 | 98.9 |
| ceres-shift | 100 | 58.0 | 96.1 | 97.1 | 99.3 |

**What it shows.**
- **The score saturates.** **[verified]** Naive averages 95.3. It scores 90 or more on 391 of 500 rides and exactly 100 on 263.
- **The only sound headroom bound is 4.7 points.** **[verified]** No score exceeds 100, so no agent can average more than 100 − 95.3 = 4.7 points above naive on this grid, and on 263 rides it can gain nothing. The par + true quote column cannot serve as the bound: naive is above it on 22 rides, below on 213 and tied on 265.
- **A normalised score against that column breaks.** (agent − naive) / (reference − naive) is undefined or negative on 287 of 500 rides. **[verified]** Gap 3 says what a real ceiling needs.
- **The useful range is a few points above naive, not the 40 points above random.** **[inferred]** An agent that forecasts, buffers its promise and handles checkpoints well can gain at most 4.7 points on average, and repeat-to-repeat noise could be as large.
- **The decision space is small.** **[verified]** `R.nearCars` offers 1 to 3 cars per hail (iss-crew 2, phobos-commute 1, jovian-hop 2, titan-home 3, ceres-shift 2), so picking the cheapest of them already gets most of the score. **[inferred]** This explains the saturation better than any scoring detail.
- **HANDOFF's claim holds up for the mean.** HANDOFF says a naive bot averages about 92 to 98 on quick hails (`docs/HANDOFF.md:23`). This naive dispatcher averages 94.4 on 300 quick rides. **[verified]** Its range is wider, 71 to 100.
- **Par is not a ceiling on the total.** Naive beat the par plan on 33 rides and lost to it on 132. **[verified]** Par minimises energy, not total score, and this replay drops its checkpoint choices.
- **Caveats.**
  - These dispatchers skip the connector, so they never lose a ride to the clock and never get a FAIL leg refused. A real agent can.
  - The random dispatcher picks from the whole fleet, not only nearby cars, and pays nothing for retries.
  - The par columns assume the par gate passes.
  - One run of the grid. The engine is deterministic for a seed, but the random dispatcher draws from one process-wide RNG, so a repeat gives the same numbers only if the rides run in the same order. **[verified]**

## Gaps, ranked by how much each blocks calling Starfare a benchmark

The ranking is my judgment **[inferred]**, revised after review. The first draft ranked the real-time clock second. The review showed it matters only for long hails and is easy to fix, while saturation was underweighted. Gaps 1 to 5 each stop a number from being comparable or meaningful across agents. Gaps 6 to 12 limit what the number means. The design that closes gaps 1 to 7 is in the next section, so each gap below lists only what that design must do.

### 1. No frozen, versioned task suite, and the agent can reach the answer key

**What is missing.**
- A task is whatever `newRun` builds at the moment of the call: `t0` from the sky clock and the seed from the season number (`game.js:74-85`). **[verified]**
- Two agents tested seconds apart face different start times. Two agents in different seasons face different weather. **[inferred]**
- No task ID, suite file, split, engine version or score version exists. **[verified]**

**The answer key is reachable in five ways.**
- **The seed is printed.** `season: +seedOf(run)` is emitted from five places: `hailInfo` (`game.js:114`, the `get_hail` reply), `land` (361), `runLog` (423), `rideSummary` (457) and `rideRecord` (481). The Open Sky page derives the season from the clock on its own (`world/template.html:295`). The unary `+` also turns any non-numeric seed into `NaN`, so string seeds would break these five sites. **[verified]**
- **The engine is public.** `hazards`, `fly` and `par` are exported (the return block at the end of `sol-rides.js`) and embedded in the Open Sky page (`world/template.html:276`). An agent that can run code and knows the seed can replay the exact weather and traffic and fly every option before it dispatches. **[verified]** That fails ABC T.5, isolation from ground truth. **[inferred]**
- **Hiding the seed is not enough.** `hazards(seed)` folds the seed into one 32-bit FNV-1a state, and every hazard after that depends only on that state. **[verified]** Two runs in this review measured what that allows:
  - Different seed strings collide on the same state after about 72,000 tries (71,832 in one run), and a loop over all 2^32 states takes about 25 seconds of Node. This comes from the architect Opus run, and I did not re-run it.
  - Four free forecasts were enough to narrow all 2^32 states to 126 candidates, the true one among them (architect Sonnet run). I re-ran that probe in this session: 126 candidates, true state included, 88 seconds. **[verified]**
  - So a secret test seed fed into today's hash can be recovered in about a minute and a half by an agent with a shell. A test split needs a keyed hash with a wide state for bench seeds. **[inferred]**
- **Hindsight leaks across runs.** (This was gap 7 in the first draft.) Within a season the hazards are fixed, and every run log in `get_my_rides` shows when they struck. The run-log design note calls this "within-season hindsight", open decision 7 (shared notes, `run-log-history-design.md:79`). **[verified]** A second attempt at the same task can read the first attempt's log. **[inferred]**
- **Forecasts are free and unbounded.** `forecastFrom` accepts any time in the season (`game.js:215-221`), and nothing limits the count. **[verified]** They supplied the observations for the recovery probe above. **[verified]**

**What the design must do.**
- Pin each task to `{hail_id, t0, seed}` in a versioned suite file.
- Give the engine one owner of the mapping from seed to label, so the five sites print a task label, not the seed.
- Feed bench seeds through a keyed hash with a wide state.
- Hold back the run logs and score parts of test tasks until the session is ranked.
- Bound forecasts in bench mode.
- The live season game keeps today's behaviour.

### 2. The tasks do not separate agents

**What is missing.**
- Naive averages 95.3 and scores exactly 100 on 263 of 500 rides. The most any agent can gain over it is 4.7 points on average. **[verified]** (sweep above)
- `R.nearCars` offers 1 to 3 cars per hail, so picking the cheapest of them is most of the job. **[verified]**
- Every quick hail uses local hops only (`R.system`, checked in this session), so the cold-hail rule and the interplanetary checker never touch them. **[verified]**
- With that little headroom, repeat-to-repeat noise may be as large as the gap between a careful agent and a naive one. **[inferred]**

**What the design must do.**
- Select suite tasks by headroom: keep tasks where naive falls clearly below a true ceiling (gap 3). Record the selection rule and the rejected tasks in a selection file, so the choice can be audited.
- Stratify by quick and long, and by clear and hazard-heavy weather, so the suite does not collapse into easy rides.
- Widen the decision where the engine allows it:
  - tighter `arrive_by` or promise tolerances on some tasks;
  - rides where forecasts and checkpoints change the best choice. `find-reroute-cases.js` already finds such rides for dust storms.
- Keep a few anchor tasks that naive solves, so a broken agent shows up as a drop.

### 3. No baselines and no true ceiling

**What is missing.**
- No trivial or heuristic baseline is published, and no human baseline exists. **[verified]**
- Par is the minimum-energy plan chosen with hindsight (`sol-rides.js:404-432`). It is not the best possible total score, and naive beat the par plan on 33 rides. **[verified]**
- The sweep's par + true quote column is not a ceiling either: naive beat it on 22 rides. **[verified]**
- HANDOFF's "a naive bot now averages about 92-98 on quick hails" (`docs/HANDOFF.md:23`) has no script in the repo. This note's sweep backs the mean. **[verified]**

**What the design must do.**
- Ship the random and naive dispatchers as scripted agents, and re-run them on every suite release. Fix the two method defects found here: count every plan call, and send their legs through the same checker gate as `dispatch`.
- Define the ceiling as the maximum total over every candidate car and objective, with par's checkpoint choices replayed and the hindsight-true arrival quoted. It is a hindsight reference. It runs only offline and is never shown to the agent.
- Report the normalised score (agent − naive) / (ceiling − naive) only on tasks where ceiling − naive is above a set margin, and say how many tasks that leaves. Against the sweep's old reference, a margin of 0 already drops 287 of 500 rides.

### 4. No harness that others can run against any agent

**What is missing.**
- The hosted connector is the only way to play. **[verified]**
- There is no agent loop, no model adapter, no suite runner and no results file. **[verified]** The pieces exist:
  - `game.js` runs in plain Node (`game.js:7`);
  - the e2e test runs the Worker under `wrangler dev` with no Cloudflare account (`connector/TEST.md`).
- The 10 tool registrations live inside the `StarfareMcp` Durable Object class in `mcp.js`, so a second server, such as a stdio one, would have to copy them. **[verified]** Two copies of a tool table drift. **[inferred]**
- ABC R.2 asks for a runnable harness, and most benchmarks in the table ship one. **[checked]**

**What the design must do.**
- Move the tool table out of the DO class into one module. The hosted connector and an offline stdio server both register from it.
- Add a suite runner that writes `results.json` and one `starfare.ride/1` log per run. Each task and repeat records its score, parts, tool calls, wall time, self-reported tokens and the engine hash.
- Scripted baselines call the engine through the same tool path, so they pay the same costs as a model.
- The hosted connector stays the primary, Grok-first route: a Grok bot added at grok.com/connectors plays the same tools.
- The offline runner is for everyone else, with whatever model provider the person running it chooses. Starfare itself holds no model key.
- **Optional:** wrap the suite as an Inspect task. METR archived its task standard repo and now uses Inspect, and Inspect already provides epochs with reducers, limits and token counts in `EvalLog.stats`. **[checked]**

### 5. The leaderboard keeps the luckiest run of an unnamed agent

**What is missing.**
- The public board keeps one row per hail, the maximum points ever (`store.js:209-215`). **[verified]**
- No model or agent name: `planned_by` is fixed text (`game.js:320`). **[verified]**
- No season, seed or version on board rows (`store.js:40-44`). **[verified]**
- `rideStats` already gives a player per-hail means through `get_my_rides` (`game.js:489-503`). The board has no spread, no repeat count and no per-model view. **[verified]**
- Many retries of one hail in one season raise the max without any skill. **[inferred]**
- The live board was empty when read in this session: `{"label":"planned by Grok bot","best":{},"stats":{}}` from `/board.json`. **[verified]** So changing the format loses nothing published. **[inferred]**

**What the design must do.**
- Rank only complete sessions: every task in the suite, k repeats each, no omitted tasks (τ²-bench's rule).
- Report:
  - the mean with a 95% interval that treats the task, not the run, as the unit;
  - pass^k by τ-bench's estimator (τ §3);
  - the minimum per task class.
- Set a success rule for pass^k. One candidate: a run succeeds if it landed and scored at least naive's score on that task. Alvin picks the rule; the score parts in `sol-rides.js:464-470` hold every input.
- Mark agent and model labels as self-reported (`board.js:25`: Starfare cannot confirm the MCP client). A row becomes "verified" when Alvin replays its trajectories offline and gets the same scores.
- First version: `results.json` files turned into a ranked table in the repo. A hosted bench board comes later and needs a deploy.
- Keep the best-per-hail table as the casual "season records" view.

### 6. No cost or step accounting beyond plan calls

**What is missing.**
- Plan calls are counted, 6 are free and the cap is 40 (`game.js:12`, `322`). **[verified]**
- Forecasts are free and unlimited, and only the first 60 are logged (`MAX_FORECAST_LOG`, `game.js:213`, `232`). **[verified]**
- Tokens, total tool calls and wall time are not recorded. **[verified]** The connector cannot see tokens, since MCP carries tool calls and not model usage. A harness can, if the agent reports them. **[inferred]**
- OSWorld-Verified reports o3 between 9.1% and 23.0% across its step settings. **[checked]** The post does not hold everything else fixed, so the step budget is not shown to cause all of that gap. An unbounded budget still makes scores hard to compare. **[inferred]**

**What the design must do.**
- Count every tool call per run, forecasts included, and log all of them.
- Publish a per-task budget in the suite file; Alvin picks the number.
- Record wall time and self-reported tokens beside the score, and show score against cost as AATM asks.

### 7. Real time is scored as skill on long hails

**What is missing.**
- The sky runs one day per real second (`game.js:14-17`). **[verified]**
- The first non-local leg goes cold if its departure passes before `dispatch` (`game.js:293-297`). Quick hails have no non-local leg, so only the 2 long hails are exposed. **[verified]**
- Long hails are booked 150 sky days ahead, about two and a half real minutes (`sol-rides.js:9`, `game.js:78`). **[verified]**
- On those hails a slower model or provider loses rides that a faster agent with the same plan keeps. That measures latency, not dispatching. **[inferred]**

**What the design must do.**
- In bench mode, read sky time from the run, not the wall clock. `nowMs` is already a parameter of `newRun`, `checkPad`, `spaceWeather` and `dispatch` (`game.js:74`, `237`, `256`, `276`). **[verified]**
- Pinning it per run is enough; no new tool such as `wait_until` is needed.
- Wall time is still recorded, as a cost (gap 6).

### 8. The prompt and scaffold are not standardised

- The INSTRUCTIONS string in `mcp.js` carries strategy hints as well as rules: call `get_my_rides` first for past rides and hindsight choices (`mcp.js:16`), compare cars, objectives and waits (`mcp.js:18`), and add a buffer to the promise for a forecast hazard (`mcp.js:32`). **[verified]**
- A benchmark score then measures the agent plus those hints, and any edit to them changes every score. **[inferred]**
- **What the design must do:**
  - freeze the bench-mode instructions with the suite version, and keep strategy hints out of them or version them;
  - record the scaffold (system prompt, tool descriptions, step limit) in `results.json`.

### 9. The number-honesty rule is partly unscored, and runs carry no provenance

- INSTRUCTIONS forbid invented numbers (`mcp.js:31`). **[verified]**
- The score checks the quoted fare, the quoted arrival and the checker gate (`sol-rides.js:459-468`), but no free-text number. **[verified]**
- The day-3 provenance gate (`code/provenance.py`) checks every number in a reply against tool outputs, and day 6 used it to score four models. **[verified]**
- Runs record no engine hash, suite version or real agent identity: `planned_by` is a constant (`game.js:320`). **[verified]**
- **Smallest design:**
  - in the harness, require a final rider message per run;
  - score it with a JavaScript port of the provenance check against that run's tool outputs, as its own column outside the 100;
  - stamp every run with the engine hash and suite version.

### 10. Only five task templates

- The 5 hails differ in route and class, and start time and seed multiply them into many instances. **[verified]**
- The capabilities tested are set by those 5 templates. A held-out *template* split, such as a hail whose route never appears in dev, tests generalisation the way AATM asks. **[inferred]**
- **Smallest design:** add hail templates to the engine's `HAILS` list, mark some as test-only, and keep the suite file as the source of truth.

### 11. No simulated rider

- τ-bench and τ²-bench test the conversation as well as the actions: a simulated user (gpt-4-0613 in τ, gpt-4.1 in τ²; τ² adds dual control in telecom only). **[checked]**
- Starfare's riders are fixed records (`sol-rides.js:22-33`). **[verified]**
- That is a scope choice, not a defect: Starfare tests dispatch under uncertainty, not dialogue. **[inferred]**
- **Smallest design:** state the construct in the suite's README, as ABC R.5 asks (R.6 asks to name the evaluation subject: model, or model plus scaffold). Add a rider later only if Alvin wants the conversation scored.

### 12. No human baseline

- WebArena, OSWorld, GAIA, Vending-Bench and METR each publish one; ABC R.12 asks for it. Vending-Bench 2 has none. **[checked]**
- **Smallest design:**
  - The Open Sky page already plays the same hails. Let it load a dev-split task by `task_id` and log runs labelled "human".
  - A handful of runs by Alvin and friends gives a first reference.
  - The page reads the clock and the season itself (`world/template.html:295`), so it needs the same task pinning as the connector.

## Second pass: claims checked against the primary sources (2026-10-16)

Five agents opened the papers, repos and leaderboard code behind every [sourced] claim. Most held up: the task counts, the human baselines, pass^k and the gpt-4o numbers, ABC's do-nothing result, T.5, R.2, R.10, R.13, T.9, AATM's 7 of 17 and Pareto curves, METR's 8 runs, Inspect's limits, and the SWE-bench, WebArena and GAIA set-ups. **[checked]**

**Corrected in the text above.** **[checked]**
- GAIA "shows best runs only, a selection effect per ABC and AATM" was wrong. The board lists every entry (one per model and organisation, one submission a day, accounts 60+ days old), and neither paper says it. The nearest AATM point (§6 item 3) is that reported scores exceeded the best of their 5 reproduction runs.
- ABC T.6's wording is "fully reproducible and frozen at the time of benchmark release".
- OSWorld's 43 are Windows versions of Ubuntu tasks; 30 of the 369 are infeasible on purpose; reset is a snapshot plus setup scripts.
- OSWorld-Verified does not show the step budget "alone" moves o3 from 9.1% to 23.0%.
- τ-bench's reward is database match times required output facts, not a pure state diff. Its dollar figures are a one-off analysis, not a reported column. τ²-bench's Oracle Plan is a telecom-only ablation, and "at least 4 trials" is a leaderboard preference per domain.
- τ²-bench's version rule covers only banking_knowledge.
- AATM says to "consider" keeping test sets secret.
- Vending-Bench's ±1 SD is in its figures only, and its reason for the minimum is reliability; it does not call coherence failures "rare".
- Construct is ABC R.5; R.6 is the evaluation subject.
- SWE-bench's verified mark is opt-in, with a random subset re-run.

**Lessons the first pass missed.** **[checked]** for the source, **[inferred]** for what it means for Starfare.
- **Unsolvable tasks belong in the suite.** OSWorld ships 30 infeasible tasks and scores the agent for saying so; ToolBeHonest finds GPT-4o scores 37.0 on unsolvable tool tasks. Starfare already has rides no plan can fly (the random sweep's 30). Score an honest "cannot fly this" on them instead of dropping them.
- **More than one trivial agent.** ABC's spamming agent beat its do-nothing agent. Add an "enumerate everything" agent that calls every plan and forecast it can, next to random and naive.
- **Retry and verifier baselines.** AATM §2 shows simple retry and verify loops match complex agents at lower cost. Starfare's free forecasts and the re-fly checker are a verifier, so a plan-check-retry baseline is the fair bar for any model.
- **State checks should cover what should not change.** ABC O.g.2 and O.g.3: check irrelevant state too, and make sure the check is not trivially passed.
- **Tasks must be independent.** ABC T.4 and AATM §6 item 4. The shared live season lets one run change another's sky. Bench mode must pin each task (gap 7).
- **Verified means re-run, not re-graded.** OSWorld-Verified and SWE-bench's subset re-run the agent; `swebench submit verify` and a replay of logs only re-grade. Say which one a Starfare "verified" row means.
- **Verified releases mostly fix tasks and checkers.** SWE-bench Verified, OSWorld-Verified and τ³-bench's 75+ fixes all repaired broken tasks. Audit each hail for solvability and scorer bugs before release, and version the suite.
- **Cheap submission gates.** GAIA limits one submission a day, one row per model and org, and accounts 60+ days old.
- **Cluster by template.** With 5 templates, compute intervals with the template as the cluster (METR's hierarchical bootstrap; Miller's clustered standard errors below).
- **Say how a run that hits a limit scores.** Inspect scores it, usually as incorrect. Starfare must state what a run that hits 40 plan calls or the step budget scores.
- **Measure when the agent stops working.** Vending-Bench tracks the day sales stop, which says more than the final score for long runs.
- **Fix the scaffold.** Vending-Bench fixes the run budget and memory tools; METR calibrates difficulty by human time.

**Related papers the first pass missed.** Each was opened on arXiv in this pass. **[checked]** unless marked.
| Paper | arXiv | Why it matters for Starfare |
|---|---|---|
| TravelPlanner | 2402.01622 | Closest planning benchmark: 1,225 queries split 45 / 180 / 1,000, a 30-step limit, layered pass rates (constraint, then final), and a "within sandbox" check that catches invented facts, like Starfare's number-honesty rule. |
| TheAgentCompany | 2412.14161 | 175 tasks with simulated coworkers, partial credit by checkpoints (score = 0.5 × checkpoints passed / total + 0.5 × full success), and steps and dollars per task. A model for scoring Starfare's mid-ride checkpoints. |
| BALROG | 2411.13543 | Procedurally generated games, reported with ± standard error over 5 to 25 seeds. The same shape as Starfare's seeded hails. |
| Adding Error Bars to Evals (Evan Miller) | 2411.00640 | Standard errors, clustered standard errors, paired differences between models and power analysis: how many tasks and repeats a Starfare suite needs. |
| The Leaderboard Illusion | 2504.20879 | Shows best-of-N private testing and selective disclosure distort a public board, and proposes fixes. Directly about gap 5. |
| GSM-Symbolic | 2410.05229 | Template instances plus irrelevant distractors expose memorisation. Starfare's templates and seeds can do the same. The authors' affiliation was not checked. |
| ToolBeHonest | 2406.20015 | Unsolvable tool tasks; GPT-4o scores 37.0. Supports scoring honest refusals. |
| Can Vibe Coding Beat Graduate CS Students? | 2511.20613 | A pickup-and-delivery logistics benchmark where 33 of 40 LLM-coded agents lost to simple baselines. The nearest published result to Starfare's naive-bot problem. |

No published benchmark for LLM agents dispatching a live fleet was found. RoutBench (2502.15359) and a routing survey (2607.00604) turned up in search but were not opened, so nothing here rests on them.

## A benchmark mode: synthesized design (not built)

This is a design sketch from the pstack architect run recorded under "How this note was reviewed". No code was written. Everything in this section is **[inferred]** design unless a line says otherwise. The four candidate packages, the cross-judge report and the interrogate verdict are in the shared session notes under `benchmark-review/`.

### Usage

**1. Anyone runs the dev split offline.** No Cloudflare account and no key are needed, and any MCP-capable agent with any model provider works:
```
cd connector && npm ci && node build.mjs
node bench/run.mjs --suite src/suites/v1.json --split dev --agent '<command that starts the agent>' --label-agent <name> --label-model <name> --out runs/mine.json
node bench/stats.mjs runs/mine.json
```
- For each task and repeat, the runner starts `bench/serve.mjs`, a stdio MCP server, and then a fresh agent process.
- The agent sees the ordinary 10 tools.
- `list_hails` shows one hail and its `task_id`.
- The bench instructions say that sky time is paused and that every tool call counts.

**2. Alvin cuts a suite and keeps the test split private.**
- `STARFARE_BENCH_KEY` lives in his environment, never in the repo.
- `make-suite.mjs` samples candidate tasks, scores them with the naive baseline and the hindsight reference, and keeps the ones with headroom. It writes `v1.json` and a selection file.
- `run.mjs --split test` runs only where the key is.

**3. Later, a Grok bot plays a hosted test session.** This step needs a deploy and Alvin's go.
- A session URL `/bench/<token>/mcp` is added at grok.com/connectors ("Works with Grok").
- The bot plays every hail `list_hails` offers until the session is complete.
- Its row is ranked only once every task has been played.

### Shape

**`Instance` `{hail_id, t0, end_jd, seed, clock, tag, budget}`** is the world of one attempt.
- It has two constructors:
  - `seasonInstance(E, hailId, nowMs)` is today's `newRun` lines, moved;
  - `suiteInstance(E, suite, split, task, repeat, key)` builds a bench task.
- Its only consumer is `openRun`, which replaces `newRun`. `newRun` is deleted, not kept beside it.
- Every line after `openRun` is shared by the live game and bench mode.

**Seeds.**
- Live seeds stay digits and keep today's FNV hazards byte for byte, so seasons, fixtures and the Open Sky page do not change.
- Bench seeds look like `k1:<128-bit hex>` and switch `hazards()` to a keyed SipHash-2-4. The seed's format is the only switch in the engine.
- The dev seed is SHA-256 of a public string. The test seed is HMAC(`STARFARE_BENCH_KEY`, suite|split|task|repeat).
- The suite file holds no seeds.

**`Clock` = `wall | frozen(jd)`.**
- `skyNow(run, nowMs)` is the only reader. It replaces the four direct `sky(nowMs).jd` reads (`game.js:110`, `244`, `259`, `294`).
- Bench freezes the clock where a live take would have read it, before `t0`.
- Every leg departs at or after `t0`, because `pickupStart` never returns less than `t0` (`sol-rides.js:87`). So the cold rule (`game.js:293-297`) cannot fire in bench mode. **[verified]** It is inert there, and the bench instructions say so.

**One exit to the agent.**
- `project(run, view)` lists the fields each view may print. It is a positive list (from the Haiku candidate).
- `worldOf(run)` is the world field inside it. It replaces the five `season: +seedOf(run)` sites and the fixed `planned_by`.
- The seed never leaves the server.
- Bench runs never write to the public board's tables.

**`applyTool(run, tool, input)` is one pure reducer** for the live game, offline bench and hosted bench. It:
- counts every call in one place, forecasts and host-scoped tools such as `list_hails` and `get_my_rides` included;
- ends the attempt once the suite's budget is passed;
- keeps a trace;
- ends each run exactly once;
- in bench mode, refuses forecasts outside clock to clock + H, with H set by the suite.

**`tools.js` `registerTools(server, backend)`** holds the tool table.
- The registrations move out of the `StarfareMcp` class.
- A `backend` has one method, `call(tool, input)`. The hosted connector and `serve.mjs` each supply one.

**`suite.js`** loads a suite and derives seeds.
- It refuses a suite whose `engine_sha256` or score version differs from the bundle's.
- `make-suite` selects tasks by headroom (hindsight reference − naive). It stratifies them into quick or long and clear or hazard, and adds a few anchor tasks.
- It writes every candidate's baseline scores to a selection file, plus a random sample of unselected tasks, so selection bias can be checked.

**Sealed outcomes on the test split.**
- Score parts, run logs and hindsight are withheld until the session is complete.
- Mid-ride checkpoints still show what the live game shows, because they are part of the task.
- After the session, `replay(trace, seed)` re-scores every run. A row is "verified" when the replay matches.

**`stats.js`** is shared by the CLI and any hosted board. It reports:
- the mean over per-task means, with a cluster bootstrap 95% interval (tasks resampled, repeats kept together);
- a paired bootstrap between agents on the same tasks;
- pass^k by τ-bench's estimator (τ §3);
- the minimum and mean per class;
- the normalised score, only on tasks whose headroom is above the suite's margin, with the count it leaves.

Cost (tool calls, wall time, self-reported tokens) sits in a `RunMeta` record beside the score, outside it.

**Shells.**
- `serve.mjs`, `run.mjs`, `stats.mjs`, `make-suite.mjs`, and the `naive` and `random` agents.
- The baselines play through the same tools, so they pay the same costs.
- The hindsight reference needs par's `oracle`, which `sol-rides.js` does not export today (only `par()` returns its choices). Exporting it is an engine change.

Agents see the same 10 tools in every mode. There is no bench-only tool.

### Synthesis decision

Two scorings: mine as lead, and a blind cross-judge (Fable) that saw the candidates under letters only.

| Criterion | Opus | Fable | Sonnet | Haiku |
|---|---|---|---|---|
| Comparability | strong / 5 | strong / 4 | strong / 4 | fair / 4 |
| Isolation | strong / 4 | weak / 2 | strong / 4 | fair / 2 |
| Depth and one path | strong / 5 | good / 4 | good / 3 | fair / 3 |
| Harness reach | good / 4 | good / 4 | good / 4 | fair / 3 |
| Statistics | good / 4 | strong / 3 | strong / 5 | weak / 4 |
| Buildable in order | good / 5 | good / 4 | fair / 4 | good / 3 |
| Cross-judge total | 27 | 21 | 24 | 19 |

Each cell is lead / cross-judge (1-5). We disagree on Fable's and Haiku's statistics: the cross-judge found that Fable's pass^k is "first k all succeed", not τ-bench's estimator.

**Base: Opus** ("one instance, one reducer, one tool table"). Both judges picked it.
- It is the only candidate where one `Instance` feeds one `openRun` and one reducer, with `newRun` deleted.
- It priced its keyed hash: 844 ns a draw, about +1.3 ms median and +69 ms worst on `terms` over 20 instances. That figure is from its run; I did not re-run it.

**Grafts.**
- **From Sonnet:**
  - sealed outcomes on the test split;
  - replay verification;
  - no bench writes to the board;
  - the cluster and paired bootstrap, which replaces Opus's t-interval;
  - anchor tasks;
  - the forecast seed-recovery probe, which I re-ran.
- **From Fable:**
  - `loadSuite` refusing an engine or score mismatch;
  - the selection file, the four strata and the unselected-task sample;
  - `RunMeta` kept outside the scored record;
  - two risks: the hub `termscache` key lacks the engine hash, and `+seed` gives `NaN` for string seeds.
- **From Haiku:**
  - the bench forecast window, the only design that bounds free forecasts;
  - the positive `project` list;
  - the note that the Open Sky page is a fourth player path, which the human baseline must go through.
- **From the cross-judge:**
  - one writer of the call counter, so host-scoped tools are counted in the reducer too;
  - the cold-rule correction under the Clock item above.

**Rejected.**
- **Hiding the seed but keeping FNV (Fable, Haiku).** The state is 32 bits, and a probe recovered it from 4 forecasts in 88 s. Fable's claim that HMAC seeds make matching infeasible does not hold while the hazard hash is FNV. Haiku's `seed_digest` is enumerable for the same reason.
- **Pure-JS SHA-256 hazards (Sonnet).** Sound, but their cost on Workers was not measured, and Sonnet's 1.15 µs figure is for native code. SipHash's cost was measured.
- **A per-call virtual clock (Sonnet's `jd_per_call`).** It would make the score depend on the call count, a second pressure on top of the budget with no basis for its rate.
- **Separate live and bench rule sets (Haiku).** They become fields on `Instance`, so there is no second rules table to keep in sync.
- **Opus's claim that the cold rule "fires identically" under a frozen clock.** It cannot fire at all (see Clock).
- **Haiku's `MIN_GAP` from the 3.3-point gap.** That gap was measured against the old reference, which is not a ceiling.

### Tradeoffs accepted

- **Thinking time is free.** The frozen clock charges nothing per call or per second, so the call budget is the only pressure.
- **The live tool path is refactored.** `StarfareRun` methods become one `act(tool, input)` over `applyTool`, and live play gains a call count.
  - The storage key and the DO class names stay the same, so no migration is needed.
  - The change is guarded by the 27 unit tests, the e2e tests and a new check that live `get_hail` output stays byte-identical.
  - It reaches players only through a deploy, which needs Alvin's go.
- **Sealed outcomes cut feedback within a test session.** In return, an agent cannot learn the scorer from its own early tasks.
- **Hidden test worlds leak through play over time,** as any fixed test set does. Suites rotate by version.
- **The keyed hash is new code.** It must pass the SipHash reference vectors before any suite is cut. The Opus sketch did not check them.

## Build order

Each step uses the one before it. **[inferred]**

1. **`game.js` seam.** Node only; no engine or Cloudflare change.
   - Add `Instance`, `seasonInstance`, `openRun`, `skyNow` and `worldOf`/`project` to `game.js`.
   - Switch `store.js` to `openRun` and delete `newRun`.
   - Test that:
     - live output is byte-identical;
     - a frozen-clock run never goes cold, even with `nowMs` a year later;
     - a bench `get_hail` prints `task_id` and no seed;
     - no tool output contains the seed.
2. **Keyed hash in the engine.**
   - Add SipHash-2-4 behind the `k1:` seed prefix, checked against the reference vectors.
   - Rebundle, and check that every existing fixture is byte-identical.
   - Export the oracle for the hindsight reference.
   - Add the engine hash to the `termscache` key.
3. **`applyTool` and `tools.js`.**
   - Build the one reducer, call counting, the budget and the forecast window.
   - Move the tool table out of the DO class.
   - The live connector uses both, so this step ships to players only with a deploy and Alvin's go.
4. **Suite, harness and baselines.**
   - Write `suite.js` and `make-suite.mjs` with the selection file, plus `serve.mjs` and `run.mjs`.
   - The naive and random agents fix the two method defects: every plan call is counted, and legs pass the checker gate.
   - The dev split goes in the repo.
5. **`stats.js` and a ranked table** built from `results.json` files in the repo.
6. **Hosted bench sessions.**
   - Add `/bench/sessions`, `/bench/<token>/mcp` and the hub tables, with sealed outcomes and replay verification.
   - Put `STARFARE_BENCH_KEY` in a Wrangler secret.
   - This needs a deploy and a Cloudflare change, so it needs Alvin's go.
   - **The test split's task list is public.** It sits in the suite file as `splits.test`, each task only an id, its hail or hails and its sky day, because what a test task hides is its world (the hazards drawn from the keyed seed), every task shows its hail and sky day in `list_hails` the moment it opens anyway, and a public list lets anyone check which tasks a test session was played on. The stratum and anchor flags stay out of it, since each says how naive fared in a hidden world; those and every score go only to the selection file, which `make-suite.mjs --test-selection` refuses to write inside the repo.
   - **Status (2026-10-16, built and tested locally, not deployed).** Sessions start with `start_bench` over the connector's own `/mcp` and live in the `StarfareBench` DO, rather than at `/bench/sessions`. The rest of this step is built.
     - Test-split worlds come only from `STARFARE_BENCH_KEY`. A server without the key refuses `start_bench` with split test, and practice (split dev) still works.
     - Test-split outcomes are sealed until the session is done. A task that arrives answers `status: "flown"` with the next task, and no tool result, watch page or `.json` shows a score, parts, incidents or hindsight before then. Practice shows everything as before.
     - When the last task closes, the DO replays the stored calls through the same reducer and keeps `verified: true` or `false` on the session. The watch page shows it. `/bench/<bench_id>/trace.json` serves the calls once the session is done, and `node bench/verify.mjs <trace.json>` replays that file in Node and exits 1 on any difference. A test-split trace needs the key. A rotated key makes old test traces fail.
     - Bench sessions never write to the public board. `StarfareBench` imports nothing from `store.js`, and the e2e checks that `/board.json` is byte-identical before and after a bench ride arrives.
     - Still to do: `wrangler secret put STARFARE_BENCH_KEY` and cutting the test split (both in `connector/DEPLOY.md`), then a deploy. Each needs Alvin's go.
7. **Later:**
   - more hail templates with a held-out template split (gap 10);
   - a scored provenance column (gap 9);
   - human runs from the Open Sky page (gap 12);
   - a stated construct (gap 11).

**Cloudflare.**
- Steps 1, 2, 4 and 5 run in Node, with no deploy and no Cloudflare change. Before step 6, the test key is an environment variable on Alvin's machine.
- Step 3 changes code the live Worker runs, but nothing reaches Cloudflare until a deploy.
- Step 6 is the first Cloudflare change.

## Open questions for Alvin

Nothing here was decided for him; the defaults named are the reviewers' recommendations.

- **Benchmark mode or season game.** Is the benchmark a separate mode with its own clock and seeds, leaving the season game as it is? This note assumes yes.
- **A world per repeat or per task.**
  - Per task is τ-bench's pass^k: the same world k times, so it measures the agent's consistency.
  - Per repeat measures robustness across worlds.
  - The cross-judge recommends per task, with sealed outcomes and a fresh agent process per repeat.
- **Cold rule in bench mode.** Inert under the frozen clock (recommended, and documented), or kept alive with a per-call clock, which ties the score to the call count.
- **Over budget.** Score 0 as abandoned, score what was flown, or refuse further calls.
- **Numbers to set.** None was invented here.
  - the tool-call budget per task;
  - repeats per task (k);
  - suite size;
  - the headroom margin for selection and normalisation;
  - the forecast horizon H.
- **Success rule for pass^k.** One candidate: the ride landed and scored at least naive's score on that task.
- **Where the test split runs.** Only on Alvin's machine and the hosted Worker (recommended), or also offline for invited agents.
- **Who may open hosted bench sessions**, and how often suites rotate.
- **Forecast window in the live game.** Should the live game adopt the bench forecast window too?
- **Ranking self-reported model labels.** Should those rows be ranked at all, or listed apart until replay verifies them?

## How this note was reviewed

**Interrogate.** Four reviewers checked the first draft for correctness, completeness and labelling: Opus (16 findings), Fable (10), Sonnet (15) and Haiku (13). Each recomputed the sweep aggregates, and all matched. I traced every accepted finding to code or to the sweep data. Fixed in this version:
- The old "ceiling probe" was not a ceiling (all four). It is renamed, the 4.7-point bound is stated, and gap 3 defines what a real ceiling needs.
- Baseline method defects are now disclosed: par plan's dropped choices, FAIL legs, random's fixed plan count and unplannable rides, and naive using par's candidate set.
- Factual errors are fixed:
  - the forecast log keeps the first 60, not the last;
  - the promise and checker parts are scored as well as the fare;
  - `rideStats` gives means;
  - the rate-limit line, the rules-string citation and the `newRun` name;
  - the header commit and a third label that was not in the legend.
- Seed isolation is now complete: five emission sites, the Open Sky page, `NaN` on string seeds, run logs and free forecasts.
- The clock gap was moved down, because quick hails cannot go cold. Saturation and the small decision space were moved up.
- Gaps 8, 9 and 12 are new: prompt and scaffold, provenance, and the human baseline.

Dismissed findings:
- one asked for a citation that was already there;
- one argued against a claim the note does not make;
- one questioned counts that two other reviewers had recomputed.

**Architect.**
- A grounding pass traced `game.js`, `store.js`, `mcp.js` and the engine hazards.
- Four runners (Opus, Fable, Sonnet, Haiku) each sketched a whole benchmark mode against a six-criterion rubric: comparability, isolation, depth and one path, harness reach, statistics, and buildable in order.
- I scored them, and a Fable cross-judge scored them blind under letters. The result is above.
- Phase D (implementation) was skipped on purpose: this is a research note and no code was to change.

## Appendix: the baseline script

This is the scratch script that produced the sweep, run as `node baselines.js 1,2,3,4,5,6,7,8,9,10 200,900,1600,2300,3000,3700,4400,5100,5800,6500`. Before running it elsewhere, edit the `require` path to point at `world/engine/sol-page.js`.
- The only change since the run is one comment, which used to call the last column a "ceiling probe".
- It skips nearby cars that start at the pickup. No hail has one (checked in this session), so the skip has no effect.

```js
// Offline baselines for docs/BENCHMARK-GAPS.md. Scratch only; reads the repo's engine bundle.
const E = require("C:/Users/PC-AIMPANG/Documents/starfare/world/engine/sol-page.js"), R = E.R;
const JD0 = 2461329.5, END = JD0 + 7000 - 1;
const SEEDS = (process.argv[2] || "1,2,3").split(","), OFFS = (process.argv[3] || "300,2000,4500").split(",").map(Number);
let rs = 12345; const rnd = () => ((rs = (rs * 1103515245 + 12345) >>> 0) / 4294967296);
function leg(from, to, after, obj){ const b = R.planLeg(from, to, after, obj, END);
  const loc = R.system(from) === R.system(to); let gate = "local"; if (!loc){ const g = E.refly(b); gate = g && g.pass ? "PASS" : "FAIL"; }
  return { from, to, dep_jd: b.dep_jd, arr_jd: b.arr_jd, kwh: b.battery.energy_kwh, fare: b.fare.total_usd, gate }; }
function plan(h, car, obj, t0, seed){ const c = R.CAR[car], st = R.pickupStart(h.id, car, t0, seed);
  const p = leg(c.at, h.from, st, obj), r = leg(h.from, h.to, p.arr_jd + R.DWELL, obj); return [p, r]; }
function scoreOf(h, car, legs, T, seed, calls, quoteJd){
  const F = R.start(h.id, car, legs, T.t0, seed, { ask_after_hours: null, end_jd: END }).done;
  const s = R.score(h.id, legs, { t0: T.t0, arrive_by_jd: T.arrive_by_jd, par_kwh: T.par.kwh, best_wait_days: T.par.best_wait_days, plan_calls: calls, kind: h.kind,
    quote: { fare_usd: legs[1].fare, arrival: R.iso(quoteJd == null ? legs[1].arr_jd : quoteJd(F)) }, flown: F });
  return s.total; }
const out = [];
for (const seed of SEEDS) for (const off of OFFS) for (const h of R.HAILS){
  const t0 = Math.floor(JD0 + off + (h.kind === "quick" ? 1 : R.LEAD)) + 0.5, a = Date.now();
  let T; try { T = R.terms(h.id, t0, END, seed); } catch (e) { out.push({ seed, off, hail: h.id, err: String(e.message) }); continue; }
  const row = { seed, off, hail: h.id, kind: h.kind, terms_ms: 0 };
  // naive: every nearby car, energy plans, cheapest planned kWh, quote the planned arrival
  let best = null, calls = 0;
  for (const c of R.nearCars(h)) { if (c.at === h.from) continue; try { const L = plan(h, c.id, "energy", t0, seed); calls += 2; const kwh = L[0].kwh + L[1].kwh; if (!best || kwh < best.kwh) best = { car: c.id, L, kwh }; } catch (e) {} }
  row.naive = best ? scoreOf(h, best.car, best.L, T, seed, calls) : null;
  // random: one random car, random objective, quote the planned arrival
  const cars = R.FLEET.filter((c) => c.at !== h.from); let L = null, car;
  for (let i = 0; i < 5 && !L; i++){ car = cars[Math.floor(rnd() * cars.length)].id; try { L = plan(h, car, rnd() < 0.5 ? "energy" : "time", t0, seed); } catch (e) {} }
  row.random = L ? scoreOf(h, car, L, T, seed, 2) : null;
  // par plan flown with defaults; quote planned arrival; and the same with the hindsight-true arrival quoted (a hindsight reference, not a ceiling)
  const PL = T.par.legs.map((x) => Object.assign({}, x, { gate: R.system(x.from) === R.system(x.to) ? "local" : "PASS" }));
  row.par_plan = scoreOf(h, T.par.car, PL, T, seed, 2);
  row.par_plan_true_quote = scoreOf(h, T.par.car, PL, T, seed, 2, (F) => F.arrive_jd);
  row.terms_ms = Date.now() - a; out.push(row); console.error(JSON.stringify(row));
}
console.log(JSON.stringify(out));
```
