# SOL day 4: the agent team and the Titan ride

Date: 2026-10-16. Gate for today: a rider can ask in plain words, three agents plan the ride, and every number they show comes from a tool and every leg is re-flown.

## What was built

| Piece | File | What it does |
|---|---|---|
| Trip planner | `code/trip.py` | Two legs: the car comes to you (pickup), then takes you home (ride). Fleet car or the real Roadster. Objective `energy` or `time`, optional `--max-burn`. |
| General re-fly | `code/refly.py` `refly_leg()` | Re-flies any leg (planet or asteroid at either end) in the n-body model. |
| Battery and fare | `code/models.py` | Made-up but stated: 1,300 kg car, 200 kWh pack, 30 km/s electric thruster at 60%, fare $0.16/kWh + $0.35/min, optional Dogecoin rate. |
| Agent team | `agents/prompts.py`, `agents/run_team.py` | Dispatcher (reads the request), engineer (calls `quote`/`trip` tools), broker (writes the rider's answer). Every answer goes through the provenance gate, and every quote needs a passing re-fly. |
| Receipts | `receipts/` | One JSON per ride: request, each role's words, every tool call with its output, provenance result, re-fly result. |

## Results

- **20 day-1 requests replayed through the team**: 20/20 provenance PASS (`receipts/day1_01.json` to `day1_20.json`).
- **Day-3 regression suite after all changes**: 20/20 pass; the planted-number self-test still goes red.
- **Titan trips, all re-flown in the n-body model and PASS**:

| Trip | Home | Door to door | Earth entry | Fare | Re-fly final miss |
|---|---|---|---|---|---|
| Fleet car (SIMULATED), cheapest | 2032-03-13 | 1975 days (5.41 yr) | 16.47 km/s | $1,000,147.68 | 0.28 km |
| Real Roadster, cheapest | 2039-07-15 | 4655 days (12.74 yr) | 15.34 km/s | $2,376,608.64 | both legs < 1 km |
| Fleet, fastest (burn cap 15 km/s) | 2028-08-26 | 680 days (1.86 yr) | 48.96 km/s | $370,472.48 | PASS |
| Fleet, burn cap 8 | 2029-07-02 | 990 days | 34.64 km/s | | PASS |
| Fleet, burn cap 5 | 2030-03-09 | 1240 days (3.39 yr) | 15.97 km/s | $632,813.76 | PASS |
| Real Roadster, fastest | 2035-06-26 | 3175 days | | | PASS |

The real Roadster is slow because it first has to fly out to Saturn from where JPL says it is today (it reaches Titan 2033-08-15).

## The two-turn conversation (`receipts/titan_conversation.json`)

1. "I'm stuck on Titan. Get me home to Earth. What are my options?" The broker offers the fleet car and the real Roadster, labels the fleet car as simulated, and lists what is not priced.
2. "Too slow. Faster please, money is no object." The broker finds the 680-day trip but refuses to sell it as is: it hits Earth at 48.96 km/s and "money cannot make that speed safe". It counter-offers the 5 km/s burn trip (1240 days, 15.97 km/s entry, cheaper than the slow trip).

Both turns: provenance PASS, every re-fly PASS.

## Bugs found and fixed today

- The `time` objective minimised flight time, not arrival date, so it would wait at Titan for a short flight. It now minimises the arrival date.
- The `energy` objective would wait years to save a little burn. It now charges 0.1 km/s per year of delay.
- Provenance flagged "Option 1" as an untraced number. List labels are now skipped.
- Turn 2 quoted a number from turn 1 and was struck. Provenance now counts tool outputs from earlier turns.
- The team runner reported "no re-fly" on fleet trips because the re-fly sits inside a leg. Fixed.

## Honest limits

- **The battery number is absurd on purpose.** The cheapest fleet trip needs 29,673 kWh, which is 14,837% of a 200 kWh pack, and the real Roadster trip needs 95,277%. An electric car cannot do this on one charge. Day-5 default: the UI shows this as "148 full charges" with a "recharging not modelled" label, rather than hiding it.
- No live model ran. There is no API key in this sandbox and the cost check was skipped by choice, so the three roles were played by a Claude subagent and every tool was re-run here. `run_team.py --backend anthropic` is written but untested; `--backend xai` (Grok) is a stub.
- Not modelled: landing, aerobraking, heat shield, life support, the fleet car's phasing burn, battery recharging. Each receipt lists these.
- Provenance proves where a number came from, not that the sentence around it is true.
