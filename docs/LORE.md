# Lore: stories on bookings and in flight logs

Status: first cut, 2026-10-19. The library, generator and tests are in `world/lore/`. Nothing is wired into the Worker, the website or the Open Sky page yet; see "Where it plugs in". Samples: `docs/LORE-SAMPLES.md`, regenerated with `node world/lore/samples.mjs > docs/LORE-SAMPLES.md`.

Alvin asked for lore and stories, "lots of them or procedural", on bookings and in logs, with interesting tidbits here and there (2026-10-19).

## Approach: an authored library, combined by a seeded generator

- **Hand-written catalog stories** for the five fixed bookings. They agree with the engine's own blurbs.
- **Generated stories** for seasonal bookings, built from four parts: why the lead passenger is travelling (keyed by their job), who travels with them (matching the party size), one concrete detail, and an optional line overheard before departure.
- **Feature stories**, rarer hand-written pieces that fit a destination or party (the Enceladus plumes, first oceans on Earth, a family going to see where a grandparent grew up). About one booking in five that fits a feature gets one.
- **Crew stories** for parties of 8 or more: a relief crew, a choir, a school trip, families moving to a new settlement ring. The engine's parties are 1 to 3 today, so these only show up once larger ships exist (docs: game-design review, capacity).
- **Flight-log moments**: a short line beside an event the run log already recorded (boarding, departure, cruise, a hold, a launch hold, a divert, a correction burn, waiting for word from Earth, arrival early, on time or late).
- **Place notes**: one quiet line per place. Real places get well-established qualitative facts, and fictional stations get invented texture. `placeFact` can add a numeric fact, formatted only from the engine's own `PLACES` fields.

Why a mix: hand-written pieces carry the quality, and the combinations carry the volume. The first library holds 34 motives, 12 details, 10 overheard lines, 15 features, 8 crew stories, 5 catalog stories and 32 log moments. Over 400 bookings in a season, the tests require more than 300 distinct stories.

## Tone: Quiet passage

From `art/2026-10-17/art-direction.md`: "Make a place passengers would want to travel." Calm, civilian, warm.
- Small, specific human details: tea, letters, window seats, a dented mug.
- Work and family, homecomings and fresh starts. No villains, weapons, disasters or melodrama.
- Short sentences, plain words and gentle humour that is never at a passenger's expense.
- Names, not pronouns, for the lead passenger, and "they" where a pronoun is needed.

## Rules

1. **Flavour only.** The engine never imports lore. Scoring, par, hazards and the benchmark never read it. `test-lore.js` checks that the engine bundle has no lore in it, so editing a story can never move the engine sha or force a suite re-cut.
2. **Seeded from public booking fields only:** `id`, `rider`, `party`, `from`, `to`, `kind`. Never from a season seed, a forecast or a hazard. A story can't leak hidden test state or hint at weather. The tests check that adding `rush` or a seed field changes nothing.
3. **No invented numbers.** Booking stories carry no digits, units, prices, durations or distances. The one exception is a crew story repeating the booking's own party size. Numeric facts come only from `placeFact`, which formats engine fields.
4. **Never speaks to the dispatcher.** No mention of routes, fares, energy, scores or deadlines, and no urgency ("hurry", "emergency"). A story must not become a prompt that changes how an agent plays. The tests check a banned-word list.
5. **Moments only follow the record.** The caller passes an event the run log holds. On a pickup leg the passengers are still at the dock, so a hold there becomes a waiting moment.
6. **Labels.** Every story and moment is tagged **Fictional**. Place notes are tagged **Real** or **Fictional** by the engine's `real` flag (checked by the tests). Bookings and flights stay **Simulated**. Show the tag as a word beside the text.
7. **Real places stay places.** No real people, companies, agencies or logos. The ISS and Tiangong get work-rotation motives only, not weddings or retirements, and the gas giants get orbital-platform motives.
8. **Versioned.** `VERSION` (`lore-1`) goes with every output. Changing the library changes the text of past bookings, which is fine because it's flavour, but the version says which library wrote it.

## Where it plugs in (next steps, not built here)

| Surface | What shows | Notes |
|---|---|---|
| Booking desk on the site, Open Sky booking card | Headline, story, overheard line, destination note | Next to the engine blurb, which stays as it is. Load `world/lore/sol-lore.js` beside `engine.js`. |
| Flight page `/flight/<run_id>` | Moments on the timeline and in the replay callouts, next to the recorded event | Built in the page from the recorded log. Nothing is stored. |
| Run log JSON `/rides/<run_id>.json` | `lore: { version, booking, moments }`, derived at read time | Derived rather than stored, so the log of record stays exactly what was flown. |
| MCP tool views (`list_hails`, `get_hail`) | A `story` field in the season game | Off in bench mode, so the measured task stays identical to the suite. The golden tool views in `connector/test/live.test.mjs` change when it is added. |
| Benchmark | Nothing | Bench prompts stay byte-identical. |

Site and flight-page wiring should land after PR #19 (the pilot-default map), which is rewriting `connector/src/site.html` and `flight.html`, so the two don't collide.

## Larger ships

Crew stories exist so that bigger ships have something to carry. If the capacity ladder in the game-design review is adopted (taxis of about 4 to 6 seats, shuttles of about 20, liners of about 100), seasonal bookings can roll larger parties, and the crew stories take over at 8 and above with no other change. Until then, `docs/LORE-SAMPLES.md` shows them on hypothetical bookings, labelled as such.

## Ideas for later

- **Recurring regulars:** a few named passengers who book again across seasons, so players start to recognise them. Their stories would key on the season and the passenger, still from public fields only.
- **Station noticeboards:** a rotating line per fictional station (a lost scarf, a choir rehearsal, a greenhouse open day) for the map's station panel.
- **Postcards on arrival:** a one-line postcard from the passenger at the end of the flight page, drawn from what the log recorded (a hold, a divert, an early arrival).
- **Player-written lore:** later, a moderated way for players to add motives, under the same rules and banned-word checks.
