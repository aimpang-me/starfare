# SOL day-1 test: do agents beat a plain parser? (2026-10-15)

**Verdict: pass on quality (8 clear wins out of 20, bar was 3). Cost not measured (no API key in this sandbox).**

Arms: (b) one-call parser -> deterministic planner; (c) agent team (dispatcher/engineer/broker as one agent) with the same planner as its only source of numbers. Arm (a) dropdown skipped: it can only serve requests 2-5 and the parser covers those identically.
Both arms ran as Claude subagents (no Anthropic/xAI key reachable from the sandbox; api.x.ai blocked). Judge: the builder (me), strict rule = agent response is clearly better for the rider.

## Clear agent wins (8)
| # | Request | Parser did | Agent did |
|---|---|---|---|
| 8 | Venus flyby then Mars, <4 km/s | silently dropped the flyby, quoted plain Mars | said flyby is not modelled, offered plain Mars |
| 11 | Mars, Phobos coffee stop, 2 g cap | silently dropped both | disclosed both, quoted Mars |
| 13 | Diamond planet via Saturn rings | silently dropped scenic flyby | disclosed, offered Jupiter |
| 15 | Something like The Martian, cheaper | silently quoted Mars | asked "cheaper than what?" |
| 16 | Cake to friend's rover | null | asked which rover/date |
| 17 | Cake to Great Red Spot by opposition | "quote" with C3 225,830 | explained, offered a launchable alternative |
| 18 | Overnight to Mars | "no feasible route" | proved it, offered fastest launchable (90 d) |
| 20 | Mercury Jan-Feb 2027, C3<=20 | "no feasible route" | said so, offered 100 d at C3 98.38 |
Mild wins (parser returned nothing, agent explained + offered a one-way alternative): 7, 9, 10.
Ties: 2-5 (identical answers), 1, 6, 12, 19 (both can't serve; the agent explains why).
Agent loss: 14 (Roadster): offered Mars, a non sequitur; the planner has no Roadster target yet.

## Provenance
`day1/provenance.py` re-runs every agent command: all numbers in all 20 answers trace to planner output (0 untraced).
BUT traced does not mean correct (see below).

## Findings to fix before day 3
1. Silent dropping is the parser's real failure (4 of 8 wins). Day 3 gate: an answer must name every constraint it dropped.
2. Request 13: the agent said Neptune needs C3 541 and Uranus 244. Those are search-boundary artifacts (TOF capped at 1500 d by default), not true minimums. The numbers were traced yet the claim "not launchable" is unsound. The planner must widen TOF per body and report when the optimum sits on the search edge. **Fixed in quote.py (day 2 start):** per-body TOF caps, an `at_search_edge` flag, and an ephemeris-range clamp. Re-run: Uranus C3 134.5 and Neptune 156.8 (not 244/541). Both are still not launchable direct, so the agent's conclusion held but its numbers were wrong.
3. "Launchable = C3 <= 100" is my arbitrary threshold; a Mars ride at C3 99.66 is not realistic. Needs per-vehicle stated assumptions (plan day 2).
4. Planner is direct Lambert only and NOT yet n-body-checked; no small bodies, satellites, Roadster, flybys, stops, return legs. 6-9 of 20 requests are blocked on that (day 2).
5. Cost: subagent token use was ~14k tokens per request for the agent arm vs ~3k for the parser (includes tool-loop overhead). Dollar cost unmeasured; needs an API key to confirm "<$0.30 a ride".

Files: requests.json, truth.json (spike's hand classes D/P/L/N), parser_arm_results.json, agent_arm.json, provenance.py; planner: ../code/quote.py.
