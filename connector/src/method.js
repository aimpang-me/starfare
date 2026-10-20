const UNIT_WORDS = { min: "minutes", kWh: "kWh", kg: "kg", USD: "USD", legs: "count", plans: "count", mSv: "mSv" };
const MEASURE = {
  pickup: "Minutes the passengers wait beyond the quickest nearby Starseeker.",
  on_time: "Minutes late. The reference is 0 minutes late.",
  energy: "kWh flown above par. Holds and correction burns are included.",
  promise: "Minutes off the quoted arrival. Late minutes are divided by 60. Early minutes are divided by 240. A missing arrival quote scores 0.",
  checker: "Count of legs that did not pass the checker and were not local hops.",
  fare: "USD off the flight fare. A missing fare quote scores 0.",
  economy: "Count of plans past the 6 free plans.",
  window: "kWh above the lowest energy departure in the search.",
  recovery: "kWh above a hindsight option at a checkpoint. With no checkpoint, the excess is 0.",
  dose: "mSv on the cruise. This part is a placeholder and scores 0.",
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function unitWord(unit) {
  if (!Object.hasOwn(UNIT_WORDS, unit)) throw new Error("no plain unit for " + unit);
  return UNIT_WORDS[unit];
}

import { EPISODE_SCHEMA } from "./episode.js";
import { POOL_TIERS } from "./game.js";

// Labels and units are whatever score() emits, so the page cannot keep a second copy.
function partCatalog(E) {
  const R = E.R;
  const t0 = 2461700.5;
  const legs = [
    { from: "orbital-depot", to: "iss", arr_jd: t0 + 0.03, kwh: 400, fare: 80, gate: "PASS", xenon_kg: 1 },
    { from: "iss", to: "lunar-data-center", arr_jd: t0 + 5, kwh: 37000, fare: 8000, gate: "PASS", xenon_kg: 90 },
  ];
  const scored = R.score("iss-crew", legs, {
    t0, arrive_by_jd: t0 + 9, par_kwh: 37400, best_wait_days: 0.03, plan_calls: 2, ship: "sf-01",
    window_kwh: 37400, throttled_kwh: 37400, hindsight_kwh: 37400,
    quote: { fare_usd: 8000, arrival: R.iso(t0 + 5) },
    flown: { pickup_jd: t0 + 0.03, arrive_jd: t0 + 5, used_kwh: 37400, extra_kwh: 0, incidents: [] },
  });
  return {
    version: scored.score_version,
    parts: scored.parts.map((p) => {
      if (!Object.hasOwn(MEASURE, p.key)) throw new Error("no measure sentence for " + p.key);
      return { key: p.key, label: p.label, max: p.max, unit: p.unit, plain: unitWord(p.unit), measure: MEASURE[p.key] };
    }),
  };
}

function fareRates(E) {
  return { perKwh: E.fare(1, 0).energy_usd, perMin: E.fare(0, 1 / 1440).time_usd };
}

export function methodPage(E, sky) {
  const R = E.R;
  const catalog = partCatalog(E);
  const parts = catalog.parts;
  const fare = fareRates(E);
  if (!POOL_TIERS.placeholder) throw new Error("pool tiers are no longer a placeholder");
  const places = E.PLACES;
  const simulatedStations = places.filter((p) => p.real === false).map((p) => p.name);
  const classes = Object.values(E.SHIP_CLASSES);
  const fleet = R.FLEET;
  const rows = parts.map((p) =>
    `<tr data-key="${esc(p.key)}"><td>${esc(p.label)}</td><td class="num">${esc(p.max)}</td><td>${esc(p.plain)}</td><td class="mono">${esc(p.unit)}</td><td>${esc(p.measure)}</td></tr>`).join("");
  const parkedOf = (c) => {
    const parked = fleet.filter((s) => s.ship_class === c.id).map((s) => s.name);
    return parked.length ? esc(parked.join(", ")) : "not parked";
  };
  const stars = classes.filter((c) => c.fictional).map((c) =>
    `<tr data-class="${esc(c.id)}"><td>${esc(c.name)}</td><td class="num">${esc(c.seats)}</td><td class="num">${esc(c.dry_kg)}</td><td class="num">${esc(c.propellant_kg)}</td><td class="num">${esc(c.ve_kms)}</td><td class="num">${esc(c.thrust_n / 1000)}</td><td>${esc(R.FLIES_TEXT[R.FLIES[c.id]])}${c.plan_dv_kms ? esc("; one plan, total burn at most " + c.plan_dv_kms + " km/s") : ""}</td><td>${parkedOf(c)}</td></tr>`).join("");
  const ships = classes.filter((c) => !c.fictional).map((c) => {
    const mode = c.power_mode === "constant" ? "constant" : "arrays, 1/r^2";
    return `<tr data-class="${esc(c.id)}"><td>${esc(c.name)}</td><td class="num">${esc(c.dry_kg)}</td><td class="num">${esc(c.xenon_kg)}</td><td class="num">${esc(c.power_w_1au)}</td><td class="num">${esc(c.housekeeping_w)}</td><td class="num">${esc(c.seats)}</td><td>${esc(mode)}</td><td>${parkedOf(c)}</td></tr>`;
  }).join("");
  const tierRows = POOL_TIERS.rows.map((row) =>
    `<tr data-tier="${esc(row.min_players)}"><td class="num">${esc(row.min_players)}</td><td class="num">${esc(row.hails)}</td></tr>`).join("");
  const dawn = E.SHIP_CLASSES.dawn;
  const ds1 = E.SHIP_CLASSES.ds1;
  const rtg = E.SHIP_CLASSES.rtg;
  const shuttle = E.SHIP_CLASSES.shuttle;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>How Starfare measures a flight</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Rajdhani:wght@500;600;700&display=swap">
<style>
:root{
  color-scheme: dark;
  --bg:#050a14; --bg-2:#0a1222; --glass:rgba(12,22,40,.72); --line:rgba(120,180,255,.14); --line-2:rgba(120,190,255,.28);
  --ink:#e8f0fa; --ink-2:#9fb0c6; --ink-3:#66788f; --cy:#5cc8ff; --ride:#8ec5ff; --sun:#ffb65c; --me:#ffcf7a; --ok:#6fe0a8; --bad:#ff8f80; --sim:#7f8a99;
  --r:6px; --mono:"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; --cond:Rajdhani, "Arial Narrow", Inter, sans-serif;
  --gl:max(16px, env(safe-area-inset-left, 0px)); --gr:max(16px, env(safe-area-inset-right, 0px));
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink)}
body{background:radial-gradient(1200px 700px at 50% -10%, #0c1a33 0%, var(--bg) 60%) fixed, var(--bg);font:15px/1.55 Inter, system-ui, sans-serif}
a{color:var(--ride)}
h1,h2{margin:0;font-weight:600}
h1{font:700 28px/1.1 var(--cond);letter-spacing:.06em}
h2{font:700 16px/1.2 var(--cond);letter-spacing:.14em;text-transform:uppercase;margin:28px 0 8px}
p{margin:0 0 12px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px var(--gl);border-bottom:1px solid var(--line);background:rgba(5,10,20,.88)}
.brand{font:700 18px/1 var(--cond);letter-spacing:.28em}
.brand span{display:block;margin-top:4px;font:600 10px/1.2 var(--mono);letter-spacing:.14em;color:var(--cy);text-transform:uppercase}
.tag{display:inline-flex;align-items:center;font:600 10px/1 Inter, sans-serif;letter-spacing:.1em;text-transform:uppercase;padding:4px 7px;border-radius:999px;border:1px solid rgba(127,138,153,.5);color:#b9c2ce;background:rgba(127,138,153,.12)}
.doc{max-width:880px;margin:0 auto;padding:28px var(--gl) 64px}
.lede{color:var(--ink-2);font-size:16px}
table{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:13.5px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--ink-3);font:600 10px/1.3 Inter, sans-serif;letter-spacing:.12em;text-transform:uppercase}
.num,.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.note{color:var(--ink-3);font-size:13px}
.source{color:var(--ink-2)}
</style>
</head>
<body>
<header class="top">
  <a class="brand" href="/">STARFARE<span>Method</span></a>
  <span class="tag">Simulated</span>
</header>
<main class="doc">
  <h1>How a flight is measured</h1>
  <p class="note">Transfer planning uses an impulsive approximation. The current propulsion power and burn duration model is not yet validated against the planned flight times. Gravitational re-flight checks do not certify propulsion feasibility. Map paths are interpolated for playback.</p>
  <p class="lede">Starfare scores an agent that maneuvers Starseeker starships carrying passengers in the solar system. Passengers, the fleet, the hazards, the fare, and the score weights are simulated. Planet positions in the baked table are real.</p>

  <h2>The scale</h2>
  <p>Score version ${esc(catalog.version)} scores out of ${esc(R.SCORE_TOTAL)}. The weights are placeholders. They sum to ${esc(R.SCORE_TOTAL)}. The total is the sum of the part scores. Stored part scores are not rounded. Pages show them in whole points.</p>
  <p>Each part except cruise dose earns its full weight when the flight is on the stated reference (a headroom of ${esc(R.SCORE_HEADROOM)}). As the flight moves off the reference, the part falls. The falloff steepness is ${esc(R.SCORE_STEEPNESS)}, a simulated assumption. Doing better than the reference does not add points past the weight. Score version 3 paid at most 0.35 of each weight on the reference. Because no part can score above its reference, that only scaled every total down, so version 4 pays the full weight.</p>

  <h2>Score parts</h2>
  <p>Each row is one part. Weight is the placeholder maximum. Unit is the plain unit. Engine unit is the string <span class="mono">score()</span> puts on the part.</p>
  <table>
    <thead><tr><th>Part</th><th>Weight</th><th>Unit</th><th>Engine unit</th><th>What it measures</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="note">Reported cruise dose uses ${esc(R.CRUISE_MSV_DAY)} mSv per day. The engine comment cites Curiosity RAD, cruise to Mars, Zeitlin et al. 2013. The dose part scores 0.</p>

  <h2>Stranded flights</h2>
  <p>In the local report, a flight that does not arrive is stranded. The score cell is blank. The mean uses landed flights only. Stranded flights are counted beside it and are not folded in as 0.</p>

  <h2>Starseeker classes</h2>
  <p>The parked fleet is Starseeker Taxis, Shuttles and Liners. They are fictional classes on a declared fictional drive. The exhaust speed and thrust are fictional. The rocket equation, mass flow, burn time, jet power and energy are computed from them, with a jet efficiency of ${esc(E.SHIP_CLASSES["star-taxi"].eta)}.</p>
  <p>Each leg is costed on the hull plus ${esc(E.DRIVE.PAX_KG)} kg per person aboard (with luggage) plus ${esc(E.DRIVE.SUPPLY_KG_DAY)} kg of supplies per person per day aboard. Those two figures are assumptions, not sourced. Burns throttle so nobody aboard feels more than ${esc(E.DRIVE.COMFORT_G)} g; the leg is still planned as impulsive burns. A Starseeker refuels at every stop, so its tank holds one leg. A leg is refused when it carries more people than seats or needs more propellant than the tank.</p>
  <p>Each class flies its own bookings. A ship of the wrong class is refused. Par and the quickest nearby ship only look at ships of the right class near the passengers or near their destination. The ship assignment is simulated.</p>
  <table>
    <thead><tr><th>Class</th><th>Seats</th><th>Dry kg</th><th>Propellant kg per leg</th><th>Exhaust km/s</th><th>Thrust kN</th><th>Flies</th><th>Parked</th></tr></thead>
    <tbody>${stars}</tbody>
  </table>

  <h2>Reference hulls</h2>
  <p>The catalog also keeps Dawn class, Deep Space 1 class, RTG class, and Shuttle class from real spacecraft. None is parked. Seat counts on Dawn class and Deep Space 1 class are a simulated cabin. Those probes flew with no passengers.</p>
  <table>
    <thead><tr><th>Class</th><th>Dry kg</th><th>Xenon kg</th><th>Power W at 1 AU</th><th>Housekeeping W</th><th>Seats</th><th>Power</th><th>Parked</th></tr></thead>
    <tbody>${ships}</tbody>
  </table>
  <p class="source">Dawn class stores dry mass ${esc(dawn.dry_kg)} kg, a xenon tank of ${esc(dawn.xenon_kg)} kg, and ${esc(dawn.power_w_1au)} W at 1 AU. The engine comment calls that power a published lower bound, over 10000 W at 1 AU. The repository does not give a URL for Dawn.</p>
  <p class="source">Deep Space 1 class stores dry mass ${esc(ds1.dry_kg)} kg, a xenon tank of ${esc(ds1.xenon_kg)} kg, ${esc(ds1.power_w_1au)} W at 1 AU, and housekeeping ${esc(ds1.housekeeping_w)} W. The assumptions line says housekeeping near 400 W. The repository does not give a URL for Deep Space 1.</p>
  <p class="source">RTG class is a simulated hull, not a flown ship. Dry mass ${esc(rtg.dry_kg)} kg is the Dawn figure. The xenon tank is ${esc(rtg.xenon_kg)} kg, Psyche's published load of up to 1085 kg (NASA JPL Psyche quick facts). Power is ${esc(rtg.power_w_1au)} W held constant, from Cassini at the end of the mission (NASA Cassini quick facts). The ${esc(rtg.power_w_1au)} W is treated as spare for the thruster. Housekeeping is not charged. The dry mass does not add tank structure for the larger xenon load. The repository does not give a URL for those quick facts.</p>
  <p class="source">Shuttle class stores dry mass ${esc(shuttle.dry_kg)} kg and ${esc(shuttle.seats)} seats. The engine comment calls the mass the published orbiter figure of about 68000 kg, and the seats the orbiter crew of 7. It has no xenon ion thruster. The repository does not give a URL.</p>
  <p>On the reference hulls the ion thruster uses two published NSTAR set points. 2310 W, specific impulse 3280 s, efficiency 0.64. 490 W, specific impulse 1950 s, efficiency 0.38. The engine keeps the highest point the spare power can feed. No set point is published below 0.49 kW. Standard gravity is ${esc(E.G0)} m/s^2. The engine comment calls that NIST standard gravity.</p>
  <p>The fare is simulated. It is $${esc(fare.perKwh)} per kWh plus $${esc(fare.perMin)} per minute. The engine header for those rates says they are stated and made up on purpose. Landing, aerobraking, and life support are not priced.</p>

  <h2>Planet positions</h2>
  <p>The baked ephemeris source is JPL DE421 (skyfield-data 7.0.0 de421.bsp) via jplephem. Small bodies in that file are integrated n-body from Horizons states. The frame line is heliocentric J2000 ecliptic.</p>
  <p>The Moon position is DE421. The engine comment labels the other moons as circular orbits and approximate. Bennu and Ceres use that n-body integration, not DE421 positions. Gravitational parameters used with the positions are DE440 values (Park et al. 2021), not DE421.</p>
  <p>Simulated stations, marked not real in the place table: ${esc(simulatedStations.join(", "))}.</p>

  <h2>Array power</h2>
  <p>The engine does not use a solar constant of 1361 W/m2. docs/SOLAR-VARIABLES.md lists irradiance among the workbook rows the engine does not use. On the reference hulls, solar array power is the class power at 1 AU divided by the square of the heliocentric distance. The RTG class generator does not fall off. It holds its watts at every distance.</p>

  <h2>Passengers and seasons</h2>
  <p>A season is ${esc(sky.len_days)} sky days. One real second is one sky day. Hazards are seeded by the season number, so every player in that season meets the same simulated hazards. A season's passengers are a seeded pool of simulated passengers. The tier sizes are placeholders.</p>
  <p>The pool size is frozen from the previous season's distinct signed-in players. The first season counts 0 players, so it uses the first tier. A later season keeps the size written for it.</p>
  <table>
    <thead><tr><th>Distinct signed-in players</th><th>Hails</th></tr></thead>
    <tbody>${tierRows}</tbody>
  </table>

  <h2>Held out seeds</h2>
  <p>The suite file stores no seeds. Practice tasks use the dev split. A dev seed is the prefix k1: and 128 bits from SHA-256 of a public string. The test split is held out. Its seed is the prefix k1: and 128 bits from HMAC-SHA-256 under the server key STARFARE_BENCH_KEY. That key is not in the repository. A split named train is refused. On the test split, scores stay sealed until every task in the session is played. The task list can name the booking and the sky day. The hazard world drawn from the keyed seed stays out of the suite file. Hidden test seeds stay out of training data. An episode export refuses a hidden test seed.</p>

  <h2>Flight records</h2>
  <p>A download at /rides/export/&lt;token&gt;.jsonl is one starfare.ride/1 record per line. It holds the newest 500 arrived flights and lasts 24 hours. Each record says it is simulated, and that planet positions are real (JPL DE421). A bench run writes one of those records per attempt, including a flight that did not arrive, to a .rides.jsonl file. A bench session does not add those attempts to the player download.</p>
  <p>An arrived flight also downloads at /flight/&lt;run_id&gt;/episode.jsonl. The file is ${esc(EPISODE_SCHEMA)} JSONL, one full episode per arrived flight. Each line is one step, and the file says it is simulated. A hidden test seed exports nothing. A public dev seed and a live season seed can. The engine also steps a flight with start and step. Each return is plain JSON, an open checkpoint or a finished flight.</p>
</main>
</body>
</html>`;
}
