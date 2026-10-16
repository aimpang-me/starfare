# Open questions for Alvin (2026-10-16)

Decisions only Alvin can make. Ask them one at a time, with the options below and the recommendation marked; carry on with the recommended option where the work allows, and record each answer here (move it to "Answered" with the date).

## Product
3. **Rename the older pages?** Stranded at Titan and Dispatch Desk still say SOL. Recommendation: rename both to Starfare and republish to the same links.
4. **Difficulty.** With hazards a naive bot scores about 92-98 on quick hails. Tighten further (busier pads, stricter promise) or wait for real Grok runs first? Recommendation: wait for 5-10 Grok runs on the live board, then tune.
5. **What's next to build?** Mid-ride rerouting and `get_my_rides` are done and deployed. Remaining in his order: leaderboard by model plus skills with a daily seed; visible multiplayer traffic. Confirm the order.
6. **Day 7 of the original plan:** a demo video and a write-up. When? (He won't use his own face or voice; plan synthetic voices or typed input.)
7. **Math audit:** he asked earlier for the physics math to be checked against independent tools. Do it before going public? Recommendation: yes.

## Housekeeping
8. **Repo visibility:** `aimpang-me/starfare` is public. Keep public (portfolio) or make private until launch?
9. **Clean-up (can't be undone; only on his explicit go):** delete the old `sol-connector` Worker, the duplicate repo `aimpang/starfare`, and `Documents\starfare-mine`. Recommendation: after Grok works on the new `starfare` connector.
10. **Old scores:** the old `sol-connector` board holds pre-hazard 100s; the new board started empty. Leave them, or show them as an "old rules" table?

## Answered
- Name: Starfare (2026-10-16).
- Repo home: aimpang-me/starfare, worked on in the desktop Code tab on his PC (2026-10-16).
- Ride hailing, not deliveries; Grok-first bring-your-own-agent; no xAI key on our side (2026-10-16).
- Where the public website lives: (b), the `starfare` Worker serves it at `/` (`connector/src/site.html`), with the board at `/board` (2026-10-16, by starting the website session). Deployed 2026-10-16 (Worker version 9b7a7f33).
- Shared flights (2026-10-16): Starseekers carry more than one person. Bookings can be parties, ships have seats, and one ship can pool several bookings going the same way with several stops; the dispatcher decides who flies together. Chosen over "parties only" and "single riders for now". Seat counts and pooling rules are not set yet.
- Words (2026-10-16): "flight", "booking", "passengers" replace "ride", "hail", "riders" in copy. Chosen over voyage, passage and trip. Tool and log field names stay.
- Which look ships: Dark SOL for the game and the landing page (2026-10-16). He compared a mock of the landing page in each look and chose Dark SOL; no Terminal variant or style toggle.
