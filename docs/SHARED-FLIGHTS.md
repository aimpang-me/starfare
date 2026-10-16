# Shared flights: design (draft, 2026-10-16)

Decided by Alvin on 2026-10-16: a Starseeker carries several people, a booking can be a party, ships have seats, and one ship can pool several bookings with several stops. This note is the engine design for that. Copy words follow DESIGN.md (flight, booking, passengers); code and JSON keep `hail`, `ride`, `rider`, `car`.

## The constraint
A flight with one booking must fly, score and print byte for byte as a ride does today. The live season keeps running on this engine, and three guards already pin it: `connector/test/live.test.mjs` (64 tool views), `world/engine/test-reroute.js` (298 fixture rides, 100 replayed hails) and `world/engine/test-keyed-hash.js` (digit-seed literals). So shared flights is a generalisation of the ride, not a second model beside it.

## Data shape
- **Ship**: a `FLEET` entry gains `seats`.
- **Booking**: a `HAILS` entry gains `party`, the number of passengers (the five hails today are parties of 1). `rider` stays the lead passenger's line.
- **Flight plan** (what a dispatcher sends): `{ car, stops, legs }`.
  - `stops[0] = { at: <where the ship is parked> }`, then each stop is `{ at, board: [hail ids], alight: [hail ids] }`.
  - `legs[i]` flies `stops[i].at` to `stops[i + 1].at`.
  - Today's dispatch `[pickup, ride]` is the plan with stops `[base, {at: from, board: [h]}, {at: to, alight: [h]}]`, and `check` rewrites the two-leg form into it, so old callers keep working.
- **Segment role**: a segment is `pickup` when the cabin is empty and `ride` when anyone is aboard. That keeps the flare rule as it is (launches are grounded during a flare whenever someone is aboard) and keeps the names in run logs.
- **Flight state**: `pickup_jd` and `arrive_jd` become maps by hail id. A one-booking flight still sets the scalar fields from its only booking, so outcome JSON is unchanged.
- **Boarding**: `DWELL` at every stop where someone boards, as today at the single pickup.
- **Rush**: a flight sees the rush of every booking on it (the union), which for one booking is its rush.

## Rules `check` enforces
- The legs chain: each leg leaves where the last one landed, and the first leaves where the ship is parked, after it is free.
- Every booking boards exactly once and alights exactly once, at its own `from` and `to`, boarding first.
- Passengers aboard never exceed `seats`, counting each booking's `party`.
- A leg after a boarding stop leaves no earlier than the last boarding plus `DWELL`.

## Scoring
Per booking, the parts that are about a passenger: fast pickup, on time, kept promise, honest fare. Per flight, the parts that are about the ship: energy vs par, every leg checked, planning economy. The flight's total combines them; how is open (below). For one booking the combination must reduce to today's seven parts and total.

## Par for a set of bookings
Par becomes a small pickup-and-delivery search. For every nearby ship with enough seats, try every stop order that boards each booking before it alights (2 bookings give 6 orders, 3 give 90), plan each leg for least energy, fly it through the season's hazards and keep the least energy. The oracle stays as it is, per ordering. This bounds a task's size: 3 bookings at most until timing says otherwise. Par also gains a "split" baseline: each booking flown by its own ship. Pooling has to beat that to be worth anything, which is the decision the benchmark measures.

Built as `parSet(ids, t0, endJd, seed)` and `termsSet` in `sol-rides.js` (`test-shared.js` pins them). Choices made there, open until Alvin says otherwise:
- The first booking in a set is the lead. It keys every ship's busy time, as the hail a dispatcher passes to `check` does.
- Pooled par plans each leg once the ship has really landed at the stop before it. It doesn't wait on the ground the way a quick hail's par does (0 to 12 h per leg), because that would multiply the search by 4 per leg.
- The split baseline sums each booking's own par even when two bookings want the same ship. That makes it a floor the pool has to beat.
- Each booking keeps the terms it would have alone: ready at the set's `t0`, its own arrive-by and its own best wait. Pooling never loosens a deadline, and a detour costs on-time points.
- One `t0` for the whole set.

## Benchmark impact
`Instance.hail_id` becomes `hails: [ids]`, and a suite task is a set of bookings. That is what lifts the saturation in BENCHMARK-GAPS gap 2. A suite can still hold one-booking tasks, so today's five hails stay as the easy class.

## Numbers
Alvin kept all six placeholders as the rules on 2026-10-16. The engine comments still call them placeholders; they change with the next engine edit, since a comment-only change would move the engine sha and force a suite re-cut.
1. Seats per Starseeker: 4 for every ship.
2. Party sizes for new bookings: 1 to 3.
3. Most bookings in one task: 3 (par cost grows with the stop orders).
4. Pooled fare: each booking pays the fare of its own leg as the planner prices it. A fare split by seat-distance was the alternative.
5. How booking scores combine into the flight's total: the mean over bookings weighted by party size, plus the ship parts.
6. A detour limit (how much later a pooled passenger may arrive than flying alone): none; the on-time part already prices it.

## Build order
1. Engine core in `world/engine/sol-rides.js`: seats, party, the stops plan, occupancy roles, per-booking times, `check`, `score`. Guarded by the three suites above, unchanged.
2. Par and terms for a set of bookings, with the split baseline.
3. Connector: dispatch takes a stops plan, tool views show a manifest. This touches `connector/src/game.js` after bench step 3 (applyTool and tools.js) lands, so the two never edit it at once.
4. New multi-booking hails and suite tasks, once Alvin sets the numbers above.
