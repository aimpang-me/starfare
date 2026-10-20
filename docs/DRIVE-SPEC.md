# Starseeker drive: sizing spec for taxis, shuttles and liners

Draft for Alvin, 2026-10-19. Game Design thread. Nothing in the engine changes until the decisions at the end are made.

The drive is **Fictional**: Alvin chose a declared fictional drive on 2026-10-19 (`docs/OPEN-QUESTIONS.md`). The physics is real. Every figure below comes from the engine's own planner run over every bookable route, then the rocket equation. The scripts and route data are in `world/drive/` (see "Reproduce"). Seat counts are placeholders until Alvin sets the capacity ladder.

## The short version

- **One fictional drive, three hull sizes.** Taxis and shuttles use an exhaust speed of 30 km/s (Isp 3,059 s, close to the real NSTAR thruster's 3,280 s). Liners use 60 km/s (Isp 6,118 s).
- **The drive covers every route.** All 374 bookable routes are flyable with a full cabin. On the plans proposed here, the worst mass ratio is 1.97 for a taxi hop and 2.12 for a long haul.
- **The fiction is power.** A 6 t taxi needs 495 MW of jet power, and a 200 t liner needs 7.5 GW. No real power source comes close at that mass. That is what the "Fictional" label covers.
- **Once people are aboard, the slowest plan is not the cheapest.** On the liner's worst route, the cheapest-energy plan takes 5,548 days and carries 1,387 t of food, water and air. A plan capped at 45 km/s takes 928 days, carries 232 t and uses 37% less energy. So liners should fly a capped-delta-v plan, and the planner needs to price consumables.
- **Two flags.** Eight taxi hops at Jupiter burn for up to 81 minutes from a parking orbit that takes 3.3 hours. That is too long for the impulsive approximation to hold. Separately, the per-kWh fare charges a liner seat about $617,000 for energy alone.

## What is fictional and what is real

| Fictional (labelled in the game) | Real (computed) |
|---|---|
| The power source: hundreds of MW from a few tonnes, constant at any distance from the Sun | Rocket equation, mass flow, burn time, jet power, energy, acceleration |
| Holding 30 or 60 km/s exhaust speed at tens to hundreds of kN of thrust | Orbits and transfers: the engine's Lambert planner on DE421 ephemerides, unchanged |
| Getting rid of the waste heat (radiator areas below are what real radiators would need) | Passenger and consumables mass entering the rocket equation |

## Equations

With final mass m_f, exhaust speed vₑ, thrust F and efficiency η (jet power over input power):

- Propellant: m_p = m_f · (e^(Δv/vₑ) − 1). Start mass m₀ = m_f + m_p.
- Mass flow: ṁ = F / vₑ. Burn time: t = m_p / ṁ.
- Jet power: P_jet = ½ · F · vₑ. Input power: P_in = P_jet / η. Waste heat: P_in − P_jet.
- Energy per leg: E = ½ · m_p · vₑ² / η.
- Acceleration: a = F / m, lowest at the start of the burn (F/m₀), highest at the end (F/m_f).

The engine already uses the first and fourth equations in `battery()` (`world/engine/sol-engine.js:557-558`). Today m_f is the dry hull alone.

## How it was sized

- **Routes:** every distinct from-to pair in the first 400 hails of seeds 1 to 8 (`R.hailRow`). That is 374 routes: 64 quick hops, 72 long hauls that stay inside Jupiter's orbit, and 238 long hauls that touch the outer system.
- **Plans:** each route was planned with a test ship that never runs out of power or propellant, so only the orbital geometry limits it:
  - "Cheapest" is the engine's energy objective at three departure dates (2027-10-22, then 500 and 1,000 days later), taking the worst of the three.
  - "Δv ≤ N" is the engine's time objective, the earliest arrival with total burn at most N km/s (`maxBurnKms`). Caps of 15 and 30 were run on every route, and caps of 45, 60 and 90 on the 238 outer routes. Each starts in the 120-day window from 2027-10-22.
- **Mass model:** every seat is full. Each passenger with luggage is 100 kg. Consumables are 2.5 kg per person per day for the whole transit. Both figures are my assumptions to tune, not sourced figures.
- **Classes:** taxis fly quick hops, shuttles fly the inner long hauls, and liners fly the outer long hauls.

Approximations: burns are impulsive, as in the engine, with burn times checked afterwards. Thrust and exhaust speed are constant. Consumables are counted in the arrival mass, which slightly overstates propellant, since they are used up on the way. There are no refuelling stops. Shielding mass and crew are not modelled, beyond what the dry mass allows. Launch from a surface is not priced, the same as today.

## Proposed classes (Fictional)

| Class | Seats (placeholder) | Dry mass | vₑ (Isp) | Thrust | η | Jet power | Input power | Waste heat | Flies |
|---|---|---|---|---|---|---|---|---|---|
| Taxi | 6 | 6 t | 30 km/s (3,059 s) | 33 kN | 0.64 | 495 MW | 773 MW | 278 MW | 64 quick hops |
| Shuttle | 20 | 25 t | 30 km/s (3,059 s) | 60 kN | 0.64 | 900 MW | 1,406 MW | 506 MW | 72 inner long hauls |
| Liner | 100 | 200 t | 60 km/s (6,118 s) | 250 kN | 0.64 | 7,500 MW | 11,719 MW | 4,219 MW | 238 outer long hauls |

Dry mass covers hull, cabin, tanks, drive and crew allowance. The efficiency 0.64 is NSTAR's published figure at full power, kept so the drive sits next to real hardware.

Radiating the waste heat at 1,000 K from both faces (emissivity 1) would take about 2,450 m² for a taxi (a 50 m square), 4,460 m² for a shuttle and 37,200 m² for a liner (193 m square). The fiction carries this. The numbers say how big the fiction is.

## Results per class

Worst case over the class's routes unless marked p50 (median).

**Taxi, 64 quick hops.** Every plan is the same, because local hops have no transfer to shorten.

| Plan | Δv max | Transit p50 / max | Mass ratio max | Propellant max | Start mass max | Longest single burn | Acceleration | Energy max |
|---|---|---|---|---|---|---|---|---|
| Any | 20.4 km/s | 2.6 / 5.8 days | 1.97 | 6.5 t | 13.1 t | 81 min | 0.26 to 0.51 g | 1.27 GWh |

**Shuttle, 72 inner long hauls.**

| Plan | Δv max | Transit p50 / max | Mass ratio max | Consumables max | Start mass max | Total burn max | Acceleration | Energy max |
|---|---|---|---|---|---|---|---|---|
| Cheapest | 14.2 km/s | 654 / 1,726 days | 1.60 | 86 t | 168 t | 7.5 h | 0.04 to 0.14 g | 10.6 GWh |
| **Δv ≤ 15** | 15 km/s | 600 / 1,480 days | 1.65 | 74 t | 141 t | 6.4 h | 0.04 to 0.15 g | **9.0 GWh** |
| Δv ≤ 30 | 30 km/s | 207 / 959 days | 2.72 | 48 t | 204 t | 17.9 h | 0.03 to 0.18 g | 25.2 GWh |

**Liner, 238 outer long hauls (vₑ 60 km/s).**

| Plan | Routes | Δv max | Transit p50 / max | Mass ratio max | Consumables max | Start mass max | Total burn max | Acceleration | Energy max |
|---|---|---|---|---|---|---|---|---|---|
| Cheapest | 238 | 28.1 km/s | 2,287 / 5,548 days | 1.60 | 1,387 t | 2,286 t | 52.6 h | 0.011 to 0.058 g | 617 GWh |
| Δv ≤ 15 | 163 | 15 km/s | 1,220 / 5,481 days | 1.28 | 1,370 t | 2,021 t | 29.8 h | 0.013 to 0.074 g | 349 GWh |
| Δv ≤ 30 | 238 | 30 km/s | 802 / 3,547 days | 1.65 | 887 t | 1,808 t | 47.4 h | 0.014 to 0.089 g | 556 GWh |
| **Δv ≤ 45** | 238 | 45 km/s | **467 / 928 days** | 2.12 | 232 t | 936 t | 32.9 h | 0.027 to 0.096 g | **386 GWh** |
| Δv ≤ 60 | 238 | 60 km/s | 371 / 628 days | 2.72 | 157 t | 997 t | 42.0 h | 0.026 to 0.101 g | 493 GWh |
| Δv ≤ 90 | 238 | 90 km/s | 265 / 457 days | 4.48 | 114 t | 1,454 t | 75.3 h | 0.018 to 0.107 g | 882 GWh |

The capped-at-15 plan reaches only 163 of the outer routes, so its maximums aren't comparable with the other rows.

I also ran a liner at 90 km/s. It used less propellant but more energy on every plan: 504 GWh on Δv ≤ 45, against 386 GWh at 60 km/s. So 60 km/s is the better liner exhaust speed of the two.

## What the numbers say

1. **The drive closes the whole map.** On the plans proposed here, the worst mass ratio is 1.97 for quick hops, 1.65 for shuttles and 2.12 for liners. Every real-hardware option in `docs/FLEET-OPTIONS.md` cut most of the map.
2. **On long trips, consumables are the cargo.** A liner's 100 passengers weigh 10 t. Their consumables on the cheapest plan weigh 1,387 t, seven times the dry hull. Going faster costs more delta-v but carries less food, so energy falls until about Δv 45 for liners and Δv 15 for shuttles, then rises again. The engine's energy objective doesn't see this today, because passengers weigh nothing in the planner.
3. **Trips fit a season.** A season is 7,000 sky days. On Δv ≤ 45, the liner's longest trip is 928 days. On the cheapest plan it is 5,548 days, so a liner could make one trip a season on its worst route.
4. **Long-haul burns are short next to the trip.** On the liner's proposed plan, the longest total burn is 33 hours against a median transit of 467 days, so the impulsive approximation the engine uses holds well there.
5. **Jupiter taxi hops strain the impulsive approximation.** Eight hops between Jupiter's parking orbit and its moons burn for 51 to 81 minutes in one go. The parking orbit (5,000 km up, `sol-engine.js:344`) takes 3.3 hours, so the burn sweeps up to 41% of an orbit. The engine's delta-v understates those hops by an amount it doesn't compute yet. Saturn's worst is 39 minutes from a 4.7-hour orbit, which is borderline. Three ways to fix it: triple taxi thrust for the Jovian hops, raise the Jupiter parking orbit, or add a finite-burn loss to long single burns. Triple thrust (99 kN) cuts the worst burn to 27 minutes (14% of an orbit), peaking at 1.3 g. Throttled to stay at or under 1 g, it takes 28.6 minutes.
6. **Fares jump by orders of magnitude.** The fare is $0.16 per kWh plus $0.35 a minute (`sol-engine.js:567`), written for kW-class probes. On the worst route, the energy part alone comes to:

   | Ship | Plan | Energy fare per trip | Per seat, full |
   |---|---|---|---|
   | Taxi | Any | $202,400 | $33,700 |
   | Shuttle | Δv ≤ 15 | $1.45 M | $72,300 |
   | Liner | Δv ≤ 45 | $61.7 M | $617,100 |

## Engine changes this needs

None of these are made. Together they move the engine sha, so the suite is re-cut afterwards. That needs the score-version storage fix from the 2026-10-19 game design review first.

1. **Classes.** Add taxi, shuttle and liner to `SHIP_CLASSES` (`sol-engine.js:492`), each with a drive block (vₑ, thrust, η), a propellant tank, seats, and "Fictional" in `ASSUMPTIONS` (`sol-engine.js:498`). The power doesn't depend on distance from the Sun, which `power_mode: "constant"` already handles (`sol-engine.js:516`). Dawn, DS1 and RTG stay as the real reference hulls.
2. **Mass.** In `battery()`, take vₑ from the class instead of the NSTAR set point (`sol-engine.js:548-556`). Make the final mass dry plus passengers aboard, plus consumables for the leg, plus the propellant later legs still need, instead of `cls.dry_kg` alone (`sol-engine.js:557`). On a multi-stop flight, that means costing legs from the last one back.
3. **Burns.** Record burn time and start and end acceleration on each leg. Apply the Jupiter fix chosen in point 5 above.
4. **Planner objective.** Either price consumables in the energy objective, or give each class a default delta-v cap for the time objective. Today the cap is 15 for every ship (`sol-engine.js:734`). The second is a one-line change per class. The first finds the best plan per route.
5. **Fare.** Whatever Alvin picks in decision 4 (`sol-engine.js:567`). Score terms that weigh kWh shift scale too.
6. **Carried over from the capacity review, unchanged:** boarding time (`DWELL`) scales with the number of people boarding, liners stay off 1-berth pads (`BERTHS`, `sol-rides.js:81`), and liners fly fixed routes so the par search stays small.

## Decisions for Alvin

Each one was put to Alvin on 2026-10-20 with the options below. The recommendation is marked.

1. **Liner speed**, meaning how much delta-v a liner may spend on one outer trip. The cheapest-energy plan is ruled out: it is the slowest plan (up to 5,548 sky days) and still uses 37% more energy than Δv ≤ 45.
   - **Δv ≤ 45 (recommended).** The longest trip is 928 sky days, about 15 minutes on the live map at 1 s per sky day, and the typical trip is 467. It has the lowest energy of any plan.
   - Δv ≤ 60. The longest trip is 628 sky days and the typical trip is 371, with 28% more energy.
   - Both. Liners sell an economy fare (45) and an express fare (60), and the dispatcher picks per booking. That is a real time-versus-cost choice, but it means more engine and suite work.
2. **Comfort limit**, meaning the most acceleration passengers feel in a burn. As sized, taxis peak at 0.51 g, and shuttles and liners stay under 0.2 g ("comfort max-g" is on the later-ideas list).
   - **1 g (recommended).** Jovian taxis get triple thrust, throttled at 1 g. Burns stay near 29 minutes, and passengers never feel more than Earth gravity.
   - 0.5 g. Taxis stay as sized, so the Jupiter fix has to come from a higher parking orbit or a charge for long burns.
   - No limit.
3. **Fare.** Today's fare is $0.16 per kWh plus $0.35 a minute (`sol-engine.js:567`). The score uses energy, not dollars.
   - **Per seat (recommended).** Each booking pays its seats' share of the flight's energy and time at today's rates. The median taxi seat is about $5,200 when the taxi is full and $29,000 flying alone. A full shuttle seat is about $73,000 and a full liner seat about $455,000 (median routes, plans as recommended). Pooling shows up in the price.
   - Per flight. Today's formula, where a liner booking costs tens of millions and sharing lowers nobody's fare.
   - Flat table. A fixed fare by ship and route, so fares stop coming from the physics.
4. **Seat ladder.** Today every ship has 4 seats, a pooled flight takes at most 3 bookings (`MAX_BOOKINGS`, `sol-rides.js:627`), and parties are 1 to 3 people (`sol-rides.js:837`). So seats only matter when a pool doesn't fit.
   - **6 / 20 / 100 (recommended).** Taxis fit some 3-booking pools but not others (3+3+1 is too many), so capacity is a real choice. Shuttles and liners run scheduled routes with one pickup and one drop-off, so par stays one stop order however many board. They are filled by group bookings, such as the crews and families the lore writes for parties of 8 or more.
   - 4 / 20 / 100. Taxis stay as today, where 3 bookings fit only as 1+1+1 or 1+1+2.
   - 6 only. One ship size everywhere. It is the smallest engine change, but long hauls become private taxi trips lasting years.

   The tables above use 6, 20 and 100. Mass scales roughly with seats on long hauls, where consumables dominate, so the conclusions hold across this range, but the tables would need re-running.

## Reproduce

In `world/drive/`, against `world/engine/sol-page.js` (engine sha 13f5c2f0):

- `node routes.cjs 0 1 > route-dv-2026-10-19.json` plans all 374 routes: cheapest at three dates, Δv ≤ 15 and ≤ 30. `<part> <parts>` splits the work across processes; the stored file joins four parts.
- `node routes-fast.cjs 0 1 > route-dv-fast-2026-10-19.json` plans the 238 outer routes at Δv ≤ 45, 60 and 90.
- `node size-drive.cjs` prints the tables above. Pass a JSON array of classes as the first argument to try other figures, for example a different seat count or thrust.
