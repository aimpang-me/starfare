# SOL day 6: per-model eval, checker stress, rejected wall (2026-10-16)

Done-when met: a page shows per-model numbers (section "sol eval --models" in the prototype, https://claude.ai/artifact/2yebB9MK7NtNvYq7GKd5gD).

- Brief: `EVAL_BRIEF.md` (identical for every model). Planner wrapper with cache and per-model call log: `q.py` -> `calls_<tag>.jsonl`. Answers: `cases_<tag>.json`. Scorer: `score.py` -> `eval.json`.
- Models (Claude subagents): Opus 20/20 gates, 15 verified rides; Fable 20/20, 15; Sonnet 19/20 (a bare year "2028" struck), 13; Haiku 20/20, 6 (asked or declined 14 of 20). Grok not run (no xAI key).
- Checker catch: a 1-lap Roadster route (C3 0.83) missed by ~30.6M km and needed 545.5 m/s (> 500 limit); rejected for Sonnet and Fable, both recovered.
- Stress sweep (`sweep.py`, seeded): 56 routes, raw misses 19,309 to 25,935,397 km, corrections 0.9-72.3 m/s, 55 pass; rejected a 7,000-day Neptune route (13.246 km). 4 requested 1-lap routes don't exist.
- Audit 2026-10-16: the Neptune rejection (and day-2 Uranus, 12.456 km) was checker noise from DOP853 rtol 1e-10. At rtol 1e-12 the re-run sweep passes 56/56 (max final miss 0.921 km) and Uranus passes at 0.524 km. Old run kept as sweep_rtol10.json/.log. See ../audit/.
- Rebuild page: `python3 day6/score.py && python3 day5/inject.py`, publish `day5/stranded-at-titan.html`.
