# Engineering handoff for Monday 19 October 2026

Prepared Sunday 18 October. **Current scope finished; no further feature work started.** Use `pstack:bro` for short user reports and relevant skills for fixes. Starfare is Alvin Impang's simulated passenger-flight game/agent platform, intended to grow beyond a portfolio piece; physical calculations should follow known science and label approximations.

## Repository and integration status

- Repository: `aimpang-me/starfare`, currently private; visibility unchanged.
- Engineering checkout: `C:\Users\PC-AIMPANG\Documents\New project 3\starfare`.
- Branch: **`codex/propulsion-audit`**, pushed with upstream `origin/codex/propulsion-audit`.
- PR: **[#15 — Add diagnostic propulsion ledger and offline Option B studies](https://github.com/aimpang-me/starfare/pull/15)**, open, not merged. Reviewable audit/diagnostic work; this is not an approved fleet change.
- Frozen implementation snapshot: **`3e94ba3e3907754f149152d010707fc2477e2664`**.
- Frozen code plus reproducible validation snapshot: **`34fcf36d2747291789f9db2e2a1e3037e195a64e`**. Later handoff-only commits update this document; retrieve the final published PR head with `gh pr view 15 --json headRefOid`.
- Current-main reconciliation: `ff66fbc4532ec694770099e257dcc7214b9faaa0` is already an ancestor; no merge/rebase or overwrite of Design was needed. Recheck after Design integration. GitHub initially reported the branch mergeable; initial checks were queued/running, not reported as passed here.
- **Integration owner: Orchestrator**, after Design finishes. Engineering must not merge this PR. Deployment, hosted secrets, new fleet/physics selection and paid generation remain outside this handoff authorization.

Design's separate checkout is `C:\Users\PC-AIMPANG\Documents\New project 3\.worktrees\starfare-design-audit` on `codex/design-audit`. Its local files and processes were not modified or cleaned up by Engineering. Preserve every checkout/artifact until its owner confirms it is no longer needed.

## Read first

1. [Latest heat-transfer/hardware proposal](OPTION-B-HEAT-TRANSFER.md): current mass/power result and unresolved evidence.
2. [Fleet-options index](FLEET-OPTIONS.md): chronological study links; no selected fleet.
3. [Propulsion audit](PROPULSION-AUDIT.md), [ledger contract](PROPULSION-LEDGER.md) and [actual regression evidence](PROPULSION-VERIFICATION.md).
4. [Fresh nonsecret numerical evidence](ENGINEERING-VALIDATION-2026-10-19.json) and [hardware design/review record](OPTION-B-HARDWARE-DESIGN.md).
5. Existing product context: `CLAUDE.md`, `docs/HANDOFF.md`, `docs/OPEN-QUESTIONS.md`, `docs/DESIGN.md`, `NEXT-STEPS.md`. Historical deployment notes are not a fresh live inspection.

## What was completed

| Commit | Scope |
|---|---|
| `273f204` | Pure diagnostic itinerary fuel/power ledger, full-plan adapter and tests |
| `0fe9530` | Julian-date rounding correction, verified ledger, concrete engine options |
| `d2ae3c4` | Chemical local finite-burn studies |
| `269626a` | Proposed Phobos pad → Mars orbital base study |
| `b0a0daa` | ISS → Lunar Data Center numerical study and replay controls |
| `f6636ba` | Complete tank/reserve/hardware/passenger/cargo budgets |
| `ec56b13` | Feed-pressure requirements and revised masses |
| `ba3dcb2` | Controlled-path thermal/power sizing, vapor/helium inventory refinement |
| `3e94ba3` | Installed-equipment/exposure/transfer requirements and latest budgets |
| `34fcf36` | Reproducible public numerical-check runner, baselines and handoff evidence |

The live planner's impulse/ion timetable mismatch remains. The new ledger is diagnostic: `world/engine/propulsion-ledger.mjs` owns normalized accounting; `propulsion-adapter.mjs` translates full existing plans. Neither is integrated into the runtime bundle. Missing physical inputs remain unknown/lower bounds rather than invented measurements. A passing diagnostic is never a verified vehicle.

`audit/option-b-ship-budget.mjs` is the **single mass-ledger owner**. Optional feed/thermal/hardware inputs rerun capacities before growth, payload and trim closure. `option-b-thermal.mjs` calculates heat demanded by prescribed temperatures; `option-b-thermal-hardware.mjs` calculates missing installed interfaces and declared hydraulic arithmetic. No component or measured conductance is selected by a `screen_pass` field.

## Latest proposal and superseded estimates

The latest hardware study budgets four engine shields, external bottle/tank jackets, two gas conditioners, a 150 W secondary coolant pump, 4 L retained transport coolant, accumulator/valves/pipes, carried pad interface, radiator and dedicated battery. Named manufacturer component classes are candidates; their installed mass/capacity estimates are not quotes or qualified ratings.

**Latest duty:** both saved burns and coast plus one hour of onboard conditioning after capture; then external conditioning service is required. Includes 40% filled-hardware growth. Wall/loop startup energy and actual thermal transients are still unknown and can increase requirements.

| Latest selected reference | Installed design allocation | Loaded propellant | Thermal rating | Result |
|---|---:|---:|---:|---|
| S, 500 kg arrival allowance | 525.208 kg | 290.331 kg | 2.047 kW | Rejected: 72.786 kg overweight empty |
| M, 1000 kg arrival | 611.030 kg | 568.907 kg | 2.085 kW | Conditional mass closure: **290 kg cargo + 4.994 kg trim** |
| Cabin, 2000 kg arrival allowance | 1585.878 kg | 1128.245 kg | 2.155 kW | Rejected: two occupants, no cargo, 5.151 kg overweight |

The rejected assemblies cannot reuse saved flight times at their larger mass. M preserves the solved departure/arrival envelope, conditional on delivered thrust/Isp, temperature tracking and other unsolved requirements. Subtotals and complete gas/reserve/person/provision budgets are in the latest study.

| Earlier iteration | S cargo | M cargo | Cabin cargo with two occupants | Status today |
|---|---:|---:|---:|---|
| Tank/reserve budgets | 70 kg | 450 kg | 150 kg | Historical assumptions |
| Feed-pressure proposal | 40 kg | 420 kg | 150 kg | Superseded by thermal hardware requirements |
| Earlier isothermal thermal sizing | Empty, already overweight | 350 kg | 60 kg | Superseded by fuller assembly/pump and post-capture duty |
| Latest installed-hardware sizing | Empty, overweight | **290 kg** | Zero, still overweight | Current conditional proposal; no fleet approval |

Local transfer studies and the proposed Phobos pad rendezvous are numerical results within approximate models. The production Phobos endpoint is unchanged. The four accepted lunar examples are numerical rendezvous, not passenger-qualified routes; complete lunar assemblies are overweight. The seven-day 500 kg lunar search timed out and remains unresolved, not proven impossible.

## Actual evidence and reproducible commands

**Historical application tests, not rerun for this handoff:** 57 focused ledger tests are included in **202/202 unit tests**, exit 0 at `2026-10-18T02:03:19Z`; Worker OAuth off/on checks **43/43**, exit 0 at `02:03:45Z`. The ledger/adapter/test files are unchanged between `0fe9530` and the frozen code snapshot. Summary/log tails were checked during handoff; see `PROPULSION-VERIFICATION.md`. Reproduce those suites only when testing is authorized:

```powershell
# From connector/; historical commands, not newly executed for handoff
node --test test/propulsion-ledger.test.mjs
node --test test/*.test.mjs
node test/e2e.mjs --mode=both
```

**Fresh handoff numerical evaluation:** completed `2026-10-18T06:25:06Z`, all five synchronous sizing commands exited 0. This is public offline arithmetic/refinement, not application tests or hardware validation:

```powershell
# Repository root; no network, key, server or Python required
node audit/propulsion-study-check.mjs
# Optional: --out <new-summary.json>; do not overwrite historical evidence casually
```

The runner preserves full outputs under a new ignored `connector/.wrangler/propulsion-handoff-check/<UTC>/` directory. It verifies numeric fingerprints against saved public-study baselines (6692/17052/34644 original/feed/thermal fields, excluding enriched mission metadata), independently reconciles mass to a maximum error of **4.55e-13 kg**, checks engine/suite hashes and halves the firing/cooldown step on the three selected proposals. Observed differences: peak power <0.036 W, rejection rating <0.057 W, total selected duty energy <0.000001 Wh, any individual case/phase energy <0.015 Wh, installed allocation <0.0025 kg. These measure resolution within the model, not real-world accuracy. Exact fingerprints are runtime-sensitive; if a different JavaScript runtime/platform changes them, inspect the numerical differences rather than refreshing the baseline automatically.

Run the latest budget directly:

```powershell
node audit/option-b-ship-budget.mjs --feed-proposal audit/option-b-feed-proposal.json --thermal-proposal audit/option-b-thermal-proposal.json --thermal-hardware audit/option-b-thermal-hardware.json --out audit/option-b-thermal-hardware-budget.json
```

Earlier modes omit the corresponding later flags. Public input/provenance snapshots and lunar replay controls are committed. Raw generated reports remain ignored. From a fresh checkout, missing original local reports are labelled reviewed snapshots rather than falsely matched source artifacts. Regenerate trajectories using each study's documented command; numerical search reruns are not needed merely to reproduce sizing.

```powershell
node audit/propulsion-audit.mjs --out audit/propulsion-audit.json
node audit/propulsion-ledger.mjs --out audit/propulsion-ledger.json
node audit/ship-options.mjs --out audit/ship-options.json
node audit/option-b-local.mjs --out audit/option-b-local.json
node audit/option-b-phobos.mjs --out audit/option-b-phobos.json
node audit/option-b-lunar.mjs --case 500kg-3day --out audit/option-b-lunar.json
```

Observed runtimes: Node **24.20.0**, Python **3.11.15**, NumPy **2.4.4**, SciPy **1.17.1**. The three trajectory drivers use NumPy/SciPy; they accept `--python <executable>`. Other accepted lunar cases and unresolved searches are listed in `OPTION-B-LUNAR-EVALUATION.md`; do not overwrite one ignored output and assume it contains every case.

## Unchanged boundaries and remaining decisions

Source and connector engine bundles remain byte-identical at SHA-256 `13f5c2f0d2187b352d67d914057c54fb320aed3b020e642758478bd11dda8d65`. The production suite is unchanged, score version remains 3, and no UI, live fleet, deployment or hosted secret was changed. This is a repository comparison, not current production verification.

Before fleet approval, obtain an installed engine heat/plume/soak map; supplier-approved PVG50 attachment, wall heat capacity and gas-transfer response under actual acceleration/withdrawal; actual jacket/radiator UA, full pump/system curve and cold coolant properties; exact regulator pressure reference/performance; calibrated engine thrust/Isp; complete bus/cabin/valve power/storage; pad conditioning and post-capture service/docking plan. Current fields explicitly report continuity false and unknown measured capacities. A larger hull or lighter system needs a new reconciled mass/trajectory study, not reusing an overweight reference.

## Private artifacts and process ownership

**Keep all of these local. Do not print or commit contents:**

- Current benchmark key: `C:\Users\PC-AIMPANG\starfare-private\bench-key.txt`.
- Preserved previous key: `C:\Users\PC-AIMPANG\starfare-private\bench-key.txt.previous-2026-10-17T22-48-39-589Z`.
- Private selections/validation/trace: the same external directory, including `v1.test.selection.json`, its timestamped predecessor, `v1.timing.test.selection.json`, `v1.timing.validation.json`, `v1.timing.sample-test.trace.json` and generation logs. Do not put hidden seeds, strata or results in Git/PR text.
- Local `.dev.vars`/`.env` files, caches, browser profiles, and all `.wrangler` contents remain excluded. There was no key rotation or hosted-key update in this scope.

Packaging added explicit `.env` and `.env.*` ignore rules after checking that only `.dev.vars` had previously been protected by the repository's ignore file. No dotenv content was staged.

The pre-publication scan compared both local key values against changed file contents and every Engineering branch commit, without displaying the values; no matches or credential/private/cache paths were found. Only explicit nonsecret files were staged. Do not replace this with adding all untracked/ignored files.

Engineering-owned historical unit/Worker processes were checked against recorded PID **and creation time** at `2026-10-18T06:23:23Z`: zero active owned processes and zero owned listening ports; reused unrelated PIDs were excluded. The new numerical runner uses synchronous children and all returned exit 0; it starts no server. Ownership logs and completed raw evidence remain in `connector/.wrangler/ledger-verification-*` and `propulsion-handoff-check/`. Unrelated Codex kernels and Design previews were left with their owners. No Engineering background process is intentionally retained.

## Successor / Orchestrator checklist

- Read the latest study and this handoff before quoting payload or ship readiness.
- Inspect PR #15's latest checks/head; merge only when Orchestrator has completed Design's handoff and serial integration review. No Engineering merge was performed.
- Preserve raw/private artifacts and all other workers' changes. Reconcile any new main changes without overwriting Design.
- Keep reports short. Ask Alvin before changing fleet/production physics; a deployment or hosted-secret change still needs its own authorization.
