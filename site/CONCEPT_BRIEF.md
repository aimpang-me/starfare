# Brief: turn SOL into a website people play (2026-10-16)

Owner: Alvin, an SDET / AI-quality engineer building a portfolio piece to get hired at SpaceX, Tesla, xAI or an AI startup. He said: "the logic works, resource needs calc is going, now we need to design the website and show this like an actual demo (or game)".

What exists (all real, all verified):
- SOL = ride-hail for the solar system. Rider asks in plain words -> dispatcher, engineer, broker agents -> planner (Lambert routes on JPL DE421 + Horizons) -> n-body checker re-flies every route (miss < 1 km or rejected) -> provenance gate strikes any number no tool made.
- Hero demo "Stranded at Titan": six re-flown trips home (fleet car SIMULATED vs the real Roadster as premium), with live time, AU, battery (kWh, packs), fare ($ or DOGE), light delay. The broker refuses a 48.96 km/s Earth arrival.
- 20 absurd rider requests (pizza to Bennu warm, overnight to Mars, cat to Venus and back, cake to the Great Red Spot, letter to Voyager 1...). Four Claude models answered them; every answer and the planner calls are recorded with verified quotes.
- Checker catches: a cheap 1-lap Roadster route (C3 0.83) missed by 30.6M km and needed 545 m/s (over 500) -> rejected; a 23-year Uranus quote and a 7,000-day Neptune route didn't converge -> rejected. Planner's raw routes always miss by 19,000 to 26M km before correction.
- Stated made-up models: 1,300 kg car, 200 kWh pack, 30 km/s thruster, fare $0.16/kWh + $0.35/min, 0.5 g burns.
- Current page: https://claude.ai/artifact/2yebB9MK7NtNvYq7GKd5gD (phone ride-hail screen + eval tables).

Constraints: runs as a single static web page (no backend, no live LLM; replays recorded, verified data; can include precomputed planner outputs for more scenarios). Alvin's design system "Alvin Impang Terminal" (near-white terminal printout, Departure Mono, graphite ink, square corners, box-drawing, 2px dither; muted sage/brick only hues). No Tesla/SpaceX logos. No face/voice of Alvin. Honest labels (simulated vs real). Works on a phone. Grok is the favoured model for any future bring-your-own-agent seat. Launch timing: the new Roadster was unveiled tonight (claims 0-60 in under a second; 0.5 g mentioned).

Your job: pitch ONE concept for the site as a demo/game. Include: name, one-line hook, the core loop (what the player does every 30 seconds), screens, how real data powers it (no faked physics), how it shows off Alvin's QA/evals skill to a hiring manager, what makes it shareable on X, build size for one person in ~1 day, and risks. Then score it 1-10 on: fun, hire signal, honesty, buildability in a day, shareability. Under 450 words.
