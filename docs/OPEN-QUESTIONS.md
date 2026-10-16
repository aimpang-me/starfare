# Open questions for Alvin (2026-10-16)

Decisions only Alvin can make. Ask them one at a time, with the options below and the recommendation marked; carry on with the recommended option where the work allows, and record each answer here (move it to "Answered" with the date).

## Waiting
None waiting. Everything asked on 2026-10-16 is under Answered.

## Answered
- Name: Starfare (2026-10-16).
- Repo home: aimpang-me/starfare, worked on in the desktop Code tab on his PC (2026-10-16).
- Ride hailing, not deliveries; Grok-first bring-your-own-agent; no xAI key on our side (2026-10-16).
- Where the public website lives: (b), the `starfare` Worker serves it at `/` (`connector/src/site.html`), with the board at `/board` (2026-10-16, by starting the website session). Deployed 2026-10-16 (Worker version 9b7a7f33).
- Shared flights (2026-10-16): Starseekers carry more than one person. Bookings can be parties, ships have seats, and one ship can pool several bookings going the same way with several stops; the dispatcher decides who flies together. Chosen over "parties only" and "single riders for now". Seat counts and pooling rules are not set yet.
- Words (2026-10-16): "flight", "booking", "passengers" replace "ride", "hail", "riders" in copy. Chosen over voyage, passage and trip. Tool and log field names stay.
- Which look ships: Dark SOL for the game and the landing page (2026-10-16). He compared a mock of the landing page in each look and chose Dark SOL; no Terminal variant or style toggle.
- Bench numbers (2026-10-16): keep all four as built. 5 tasks a session, 60 tool calls a task, anyone with the watch link can press End (the bench_id is the capability), and the watch page polls every 1.5 s. Chosen over "only the bot ends a task" and "40 calls a task".
- Shared-flights numbers (2026-10-16): keep the placeholders. 4 seats per Starseeker, parties of 1 to 3, at most 3 bookings per flight, each booking pays its own legs' fare, no detour limit (the on-time part prices a detour). Chosen over a seat-distance fare split, a 25% detour cap, and 6 seats with 4 bookings. Booking scores combine as the mean weighted by party size, plus the ship parts (chosen over a plain mean and the worst booking).
- Solar variables (docs/SOLAR-VARIABLES.md), "just follow recommendations" (2026-10-16): dispatch HQ is on Earth and controls every station and Starseeker, so checkpoint answers cross the light time from Earth; rider dose is shown only, not scored or capped; flare spells stay simulated (27 days); storms reach every place thinned by 1/r^2, no CME direction; Mars Base stays an orbit station with Mars dust weather.
- Older pages (2026-10-16): rename Stranded at Titan and Dispatch Desk to Starfare, with the flight, booking and Starseeker wording, and republish to the same links. Chosen over leaving them as SOL.
- Difficulty (2026-10-16): tighten now, before Grok runs. Chosen over waiting for 5-10 Grok runs. On the re-cut dev split (engine cc4d09d2) naive averages 57.0 and random 45.5 over 18 tasks; quick clear hails are the ones naive scores near 100.
- Next build (2026-10-16): visible multiplayer traffic (other Starseekers in the sky map and flight replays). Chosen over the model leaderboard with a daily seed and shared-flight hails.
- Bench pass^k success (2026-10-16): a task succeeds when the flight arrived and scored at least the naive bot's score on that task. Chosen over "landed at all" and "scored 90 or more".
- Day 7 video and write-up (2026-10-16): after the next deploy, once the bench, flight page and tighter difficulty are live.
- Math audit (2026-10-16): yes, before the video, against independent tools.
- Repo visibility (2026-10-16): make aimpang-me/starfare private until launch. Done 2026-10-16.
- Clean-up (2026-10-16): delete the old `sol-connector` Worker, the duplicate repo `aimpang/starfare` and `Documents\starfare-mine`. Chosen over waiting and over deleting only the Worker.
- Old scores (2026-10-16): let them go with the `sol-connector` Worker; no copy and no "old rules" table.
