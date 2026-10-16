# Open questions for Alvin (2026-10-16)

Decisions only Alvin can make. Ask them one at a time, with the options below and the recommendation marked; carry on with the recommended option where the work allows, and record each answer here (move it to "Answered" with the date).

## Product
1. **Where does the public website live?** Today every page is a private claude.ai artifact.
   - a) Share the claude.ai artifacts from their Share menu. Fastest; Claude dispatcher and shared board keep working; viewers need a claude.ai login.
   - b) **Recommended:** serve Open Sky from Cloudflare (the `starfare` Worker at `/`, or a Pages project), with the board from the connector's `/board`. Public, no login; the in-page Claude dispatcher needs a replacement (Grok via the connector is the main path anyway).
   - c) Own domain on top of (b). Costs money; never buy it for him.
2. **Which look ships?** Keep Open Sky's dark style ("Dark SOL", `docs/DESIGN.md`), or move it to his "Alvin Impang Terminal" design system to match the portfolio. Recommendation: keep Dark SOL for the game, use Terminal for the write-up/landing page. Show both before he picks.
3. **Rename the older pages?** Stranded at Titan and Dispatch Desk still say SOL. Recommendation: rename both to Starfare and republish to the same links.
4. **Difficulty.** With hazards a naive bot scores about 92-98 on quick hails. Tighten further (busier pads, stricter promise) or wait for real Grok runs first? Recommendation: wait for 5-10 Grok runs on the live board, then tune.
5. **What's next to build?** His order: mid-ride events and rerouting; run-log history (`get_my_rides`); leaderboard by model plus skills with a daily seed; visible multiplayer traffic. Confirm the order.
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
