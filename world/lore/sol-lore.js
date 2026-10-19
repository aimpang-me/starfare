// Starfare lore: flavour text for bookings, flight logs and places. Everything here is Fictional except placeFact,
// which only formats numbers it is handed from the engine's PLACES table (Real). Spec: docs/LORE.md.
//
// Rules this file keeps (test-lore.js checks them):
// - Flavour only. Nothing here is read by the engine, the scorer or the benchmark, and the engine never imports it,
//   so changing a line never moves the engine sha or a suite.
// - Seeded from public booking fields only (id, rider, party, from, to, kind). Never from a season seed, a forecast
//   or a hazard, so a story cannot leak hidden state or hint at weather.
// - No numbers except the booking's own party size. No units, prices, durations or distances.
// - Never addresses the dispatcher and never names a route, fare, energy or score.
// - Moments only describe an event the run log already recorded; the caller passes the event in.
// - No real people, companies, agencies or logos. Real stations (ISS, Tiangong) appear only as places.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SOL_LORE = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var VERSION = "lore-1";

  // FNV-1a 32-bit, the same family the engine uses for seasonal bookings. Lore keeps its own keys.
  function hash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    // Final avalanche (MurmurHash3 fmix32) so keys that differ in one character still pick independently.
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
  }
  function unit(key) { return hash(key) / 4294967296; }
  function pick(list, key) { return list[Math.floor(unit(key) * list.length)]; }

  // Names match world/engine/sol-engine.js PLACES (test-lore.js checks). real: an actual body or station.
  var PLACE = {
    earth: { name: "Earth", real: true }, moon: { name: "the Moon", real: true }, mars: { name: "Mars", real: true },
    phobos: { name: "Phobos", real: true }, ceres: { name: "Ceres", real: true }, jupiter: { name: "Jupiter", real: true },
    io: { name: "Io", real: true }, europa: { name: "Europa", real: true }, ganymede: { name: "Ganymede", real: true },
    callisto: { name: "Callisto", real: true }, saturn: { name: "Saturn", real: true }, enceladus: { name: "Enceladus", real: true },
    titan: { name: "Titan", real: true }, iss: { name: "the ISS", real: true }, tiangong: { name: "Tiangong", real: true },
    "orbital-depot": { name: "the Orbital Depot", real: false }, "lunar-data-center": { name: "the Lunar Data Center", real: false },
    "mars-base": { name: "Mars Base", real: false }, "ceres-port": { name: "Ceres Port", real: false },
    "titan-dock": { name: "Titan Dock", real: false }
  };
  function placeName(id) { return PLACE[id] ? PLACE[id].name : id; }
  // A place id from an id or a display name: run logs name their incident places ("Mars Base", "Moon").
  function idOf(x) {
    if (PLACE[x]) return x;
    var bare = String(x || "").replace(/^the /i, "").toLowerCase();
    for (var id in PLACE) if (PLACE[id].name.replace(/^the /, "").toLowerCase() === bare) return id;
    return x;
  }
  // "at Mars Base", "on Earth", "around Saturn": planets and the Moon take "on", gas giants "around", the rest "at".
  var ON = { earth: 1, mars: 1, moon: 1 }, AROUND = { jupiter: 1, saturn: 1 };
  function placeAt(id) { return (ON[id] ? "on " : AROUND[id] ? "around " : "at ") + placeName(id); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // One quiet line per place. Real places get only well-established, qualitative facts; fictional ones get invented texture.
  var PLACE_NOTE = {
    earth: "Earth, blue and white and loud with weather.",
    moon: "The Moon, grey and patient, with Earth hanging over its near side.",
    mars: "Mars, rust-coloured under a thin, dusty sky.",
    phobos: "Phobos, a small dark moon where Mars looms enormous overhead.",
    ceres: "Ceres, the largest body in the asteroid belt, with bright salt deposits in some of its craters.",
    jupiter: "Jupiter, banded and enormous, with a storm larger than Earth.",
    io: "Io, the most volcanically active world known, with Jupiter huge in its sky.",
    europa: "Europa, cracked ice over what is thought to be a deep ocean.",
    ganymede: "Ganymede, the largest moon in the solar system and the only moon known to have its own magnetic field.",
    callisto: "Callisto, cratered almost everywhere you look, and very quiet.",
    saturn: "Saturn, rings and all, pale gold in the window.",
    enceladus: "Enceladus, bright as fresh snow, with plumes of ice rising from its south pole.",
    titan: "Titan, under a thick orange sky, with lakes of liquid methane near its poles.",
    iss: "The ISS, whose cupola windows look straight down at Earth.",
    tiangong: "Tiangong, gliding around Earth a little below the ISS.",
    "orbital-depot": "The Orbital Depot, whose long ring lounge announces departures with a single soft chime.",
    "lunar-data-center": "The Lunar Data Center, where the corridors hum with cooling fans and people speak a little quietly.",
    "mars-base": "Mars Base, whose greenhouse deck smells of tomatoes and wet soil.",
    "ceres-port": "Ceres Port, where belt crews leave their boots in a long row by the inner airlock.",
    "titan-dock": "Titan Dock, whose observation windows look down into the orange haze."
  };

  // Hand-written stories for the five catalog bookings. They agree with the engine's own blurbs.
  var CATALOG = {
    "iss-crew": { headline: "End of rotation", story: "Dana has kept the same air scrubbers running for a long rotation and knows each one by the sound it makes. The new posting at the Lunar Data Center is quieter, and that is the part Dana is most nervous about." },
    "phobos-commute": { headline: "Survey filed", story: "Ravi has flown so many low passes over Phobos that the craters have nicknames. The survey is filed, and Mars Base has a bunk with real sheets." },
    "jovian-hop": { headline: "A difficult volcano", story: "Mei's talk at the Ganymede conference is about one volcano on Io that refuses to behave like the models. The slides are done. The ending is not." },
    "titan-home": { headline: "Left behind", story: "Sam stayed too long at the Titan Dock window, hoping for a glimpse of the methane lakes, and the tour left without them. Sam has sent a long apology home and a short one to the tour company." },
    "ceres-shift": { headline: "Shift's end", story: "Ana's crew threw a small party in the Ceres Port mess when the shift ended. Ana is taking home a dented mug signed by all of them, wrapped in a spare jumpsuit." }
  };

  // Why the lead passenger is travelling. {lead} {from} {to}. Keyed by the job in the engine's rider line.
  var MOTIVE_BY_JOB = {
    geologist: [
      ["Field notes", "{lead} spent a long season mapping fault lines near {from} and is taking the notes to {to} to argue about them in person.", "ground"],
      ["A strange rock", "{lead} is going to {to} to see a rock that, on paper, should not exist."],
      ["Samples", "{lead} has a case of core samples from {from} that never leaves their lap.", "ground"]
    ],
    pilot: [
      ["In the back for once", "{lead} flies for a living and, for once, is riding in the cabin. The destination is {to}."],
      ["New posting", "{lead} is heading to a new posting {at_to} and keeps glancing toward the flight deck."],
      ["An old instructor", "{lead} is between contracts and visiting {to}, where an old instructor still teaches."]
    ],
    medic: [
      ["Long-promised leave", "{lead} is rotating out of the clinic {at_from} and finally taking the leave they were promised."],
      ["Covering shifts", "{lead} is covering a friend's shifts at the clinic {at_to}, so the friend can go home for a while."],
      ["The exam", "{lead} is going to {to} to sit an exam they have studied for since before {from} felt like home."]
    ],
    miner: [
      ["The bonus", "{lead} finished a rotation {at_from} and is spending the bonus on a quiet stretch {at_to}."],
      ["A new niece", "{lead} is heading to {to} to meet a newborn niece for the first time."],
      ["The claim", "{lead} has a hand-drawn map of a claim near {from} and a meeting {at_to} with someone who might fund it.", "ground"]
    ],
    surveyor: [
      ["Markers", "{lead} is carrying a box of benchmark markers to {to}, where the survey picks up again."],
      ["The last grid square", "{lead} has surveyed every grid square near {from} except one, and the permit for it is waiting {at_to}.", "ground"],
      ["A second opinion", "{lead} is taking a contested boundary map to {to} for a second opinion."]
    ],
    technician: [
      ["A loop that hums wrong", "{lead} keeps the life-support loops running {at_from} and has been called to {to} to look at one that hums wrong."],
      ["Moving out", "{lead} is moving to {to} with a toolkit, a houseplant and not much else."],
      ["Spare parts", "{lead} spent a long time building a spare-parts library {at_from} and is going to {to} to start another one."]
    ]
  };
  var MOTIVE_ANY = [
    ["A wedding", "{lead} is going to {to} for a sibling's wedding, with a gift wrapped in station foil."],
    ["Visiting a parent", "{lead} is visiting a parent who retired to {to} and keeps sending pictures of the view."],
    ["Surprise", "{lead} is going home to {to} after a long time away. Nobody there knows they are coming."],
    ["The talk", "{lead} is presenting at a small conference {at_to}. The slides are finished; the talk is not."],
    ["Everything in two bags", "{lead} has packed everything they own into two duffels and is moving to {to}."],
    ["The promised trip", "{lead} is taking the trip they have been promising themselves since arriving {at_from}."],
    ["A borrowed telescope", "{lead} is returning a borrowed telescope to a friend {at_to}."],
    ["The gig", "{lead} plays in a station band, and the band has a gig {at_to}."],
    ["Looking for work", "{lead} heard they are hiring {at_to} and decided not to wait for the letter."],
    ["A reunion", "{lead} is meeting old classmates {at_to}, most of whom have not been in one place since school."]
  ];

  // Third field "ground": the motive puts field work at {from}, so it is skipped when {from} is a station or an orbit.
  // Real stations are workplaces with small crews, and the gas giants are orbits, not towns, so trips there get their own
  // motives instead of weddings, retirements and moving house.
  var MOTIVE_STATION = [
    ["Work rotation", "{lead} is joining a work rotation {at_to}."],
    ["Handover", "{lead} is going up to {to} for a handover with the outgoing shift."],
    ["Visitor pass", "{lead} has a short visitor pass for {to} and has read the safety briefing many times."]
  ];
  var MOTIVE_ORBIT = [
    ["Platform rotation", "{lead} is starting a rotation on a research platform in orbit around {to}."],
    ["Just looking", "{lead} has saved for a long time to spend a quiet stretch in orbit around {to}, just looking."],
    ["The instrument", "{lead} built one instrument on an orbital observatory around {to} and is going to see it work."]
  ];
  var STATION_TO = { iss: 1, tiangong: 1 }, ORBIT_TO = { jupiter: 1, saturn: 1 };

  // Who travels with the lead. Must agree with party. {party} is the booking's own number.
  var COMPANY = {
    1: ["{lead} is travelling alone.", "{lead} travels light and alone.", "It is just {lead} on this booking."],
    2: ["{lead} travels with a partner.", "{lead} is bringing a sibling along.", "{lead} and a colleague share the booking.", "{lead} travels with their teenager, who has opinions about window seats."],
    3: ["{lead} travels with a partner and their child.", "{lead} and two colleagues from the same shift share the booking.", "Three old friends, {lead} among them, are finally on the same schedule.", "{lead}, a parent and a grandparent are travelling together for the first time."],
    small: ["{lead} travels with a small group of {party}.", "{lead} has the passenger list for a group of {party}."]
  };

  // One concrete detail.
  var DETAIL = [
    "{lead} has requested a window seat in writing.",
    "{lead}'s luggage is mostly books.",
    "{lead} has brought a thermos of tea from home.",
    "{lead} is hoping for a quiet cabin and a long nap.",
    "{lead} has promised to send a picture of the view.",
    "{lead} has practised a greeting in the local station slang.",
    "{lead} packed a jar of something homemade for the people {at_to}.",
    "{lead} has never flown on a Starseeker before.",
    "{lead} knows every Starseeker by call sign and has a favourite.",
    "There is a letter in {lead}'s pocket that has been rewritten many times.",
    "{lead} is wearing the jacket from the last trip, for luck.",
    "{lead} has a playlist for the trip and has told everyone about it."
  ];

  // Overheard at the departure dock. Optional tidbit.
  var OVERHEARD = [
    "\"Did you pack the charger? The good charger?\"",
    "\"Wave at the window. They cannot see you, but wave anyway.\"",
    "\"The tea at the Depot is better. I will not be discussing this.\"",
    "\"Call when you land. Not a message. Call.\"",
    "\"I counted the craters on the way in. I lost count.\"",
    "\"Every station smells different. This one smells like toast.\"",
    "\"First time? Keep your feet under the strap.\"",
    "\"I brought you a rock. It is a nice rock.\"",
    "\"Somebody left a scarf at gate four.\"",
    "\"It looks smaller from up here. Everything does.\""
  ];

  // Rare hand-written stories for generated bookings. when(): the public fields they fit.
  var FEATURES = [
    { id: "plumes", when: function (b) { return b.to === "enceladus"; }, headline: "The poster",
      story: "{lead} has wanted to see the Enceladus plumes since a poster on a school wall. The poster is in the luggage, rolled in a tube." },
    { id: "oceans", when: function (b) { return b.to === "earth" && b.kind === "long"; }, headline: "First oceans",
      story: "{lead} grew up {at_from} and has only ever seen Earth's oceans in pictures. {lead} has been told the smell is the surprising part." },
    { id: "look-up", when: function (b) { return (b.from === "iss" || b.from === "tiangong") && b.to !== "iss" && b.to !== "tiangong"; }, headline: "Looking up",
      story: "{lead}'s rotation is over. After a long stretch of looking down at Earth, {lead} would like to look up at something else for a while." },
    { id: "grandparent", party: true, when: function (b) { return b.party === 3; }, headline: "Where it started",
      story: "A family of three, {lead} carrying the youngest, is going to {to} to see where a grandparent grew up." },
    { id: "warm-socks", when: function (b) { return b.to === "ceres-port" || b.to === "ceres"; }, headline: "Warm socks",
      story: "{lead} is starting a job in the belt and was told to bring warm socks. {lead} has brought a great many warm socks." },
    { id: "orange", when: function (b) { return b.to === "titan" || b.to === "titan-dock"; }, headline: "Every orange",
      story: "{lead} paints skies and is going to {to} for the orange one, with a box of every orange paint {lead} could find." },
    { id: "hum", when: function (b) { return b.to === "io"; }, headline: "The hum",
      story: "{lead} records sound for a living and wants the hum of the Io dock, which people say you can feel in your teeth." },
    { id: "letters", when: function (b) { return b.to === "lunar-data-center"; }, headline: "The archive",
      story: "{lead} is visiting the archive at the Lunar Data Center to read a grandparent's letters, kept on a server there for longer than {lead} has been alive." },
    { id: "proposal", when: function (b) { return b.to === "ganymede" && b.party === 1; }, headline: "The question",
      story: "{lead} is going to Ganymede to ask someone a question, and has practised it in the mirror." },
    { id: "nothing", when: function (b) { return b.to === "callisto"; }, headline: "Nothing happens there",
      story: "{lead} is going to Callisto because a friend said nothing ever happens there, and {lead} could use some nothing." },
    { id: "bore", when: function (b) { return b.to === "europa"; }, headline: "The old bore hole",
      story: "{lead} works on ice-drilling rigs and is going to Europa to see the oldest bore hole on the moon, which crews visit the way others visit cathedrals." },
    { id: "observatory", when: function (b) { return b.to === "jupiter" || b.to === "saturn"; }, headline: "Orbital watch",
      story: "{lead} is joining the crew of a small orbital observatory around {to}, and has been warned the view makes it hard to sleep." },
    { id: "duty-free", when: function (b) { return b.to === "orbital-depot"; }, headline: "Changing ships",
      story: "{lead} is changing ships at the Orbital Depot and has a long list of things to buy at the counter by the ring lounge." },
    { id: "greenhouse", when: function (b) { return b.to === "mars-base"; }, headline: "Seeds",
      story: "{lead} is bringing seeds from {from} for the Mars Base greenhouse deck, each packet labelled in careful handwriting." },
    { id: "earthrise", when: function (b) { return b.to === "moon"; }, headline: "Earthrise",
      story: "{lead} wants to see Earth hanging over the Moon's horizon, because a photograph of it changed {lead}'s mind about something once." }
  ];

  // Crew and liner stories (8 or more), for parties larger than a Starseeker carries today. They show what larger ships would carry;
  // the engine does not produce these parties yet (docs/LORE.md).
  var CREW = [
    ["Relief crew", "A relief crew of {party} is heading to {to} to rebuild a docking arm, with {lead} as foreman. They have brought their own coffee."],
    ["Field trip", "A school group of {party}, students and teachers with {lead} among them, is on a field trip to {to} that took ages of bake sales to pay for."],
    ["The choir", "A choir of {party} from {from}, with {lead} conducting, is singing at the opening of a new concourse {at_to}."],
    ["A new ring", "A group of {party} from {from}, with {lead} keeping the passenger list, is moving to {to} together to start a new settlement ring."],
    ["Expedition", "A survey expedition of {party}, led by {lead}, is bound for {to} with crates of instruments and a long tradition of bad card games."],
    ["The vote", "A delegation of {party} miners from {from}, with {lead} speaking for them, is travelling to {to} for the first all-hands vote in their union's history."],
    ["Families", "A group of {party} passengers, most of them families, is going to {to} to look for a fresh start. {lead} has learned every child's name."],
    ["Repair season", "A repair crew of {party}, led by {lead}, is going to {to} to replace a station's long solar wings, one panel at a time."]
  ];

  // Flight-log moments, keyed by the event the log recorded. {lead} {where}.
  var MOMENT = {
    boarding: ["{lead} finds the window seat and does not let it go.", "The cabin lights warm as {lead} settles in.", "{lead} is the first aboard and the last to stop looking out."],
    boarding_group: ["{lead}'s group claims the row by the window.", "{lead} counts heads twice, then sits down."],
    departure: ["{where} falls away below the window.", "A soft chime, a long push, and {where} begins to shrink.", "{lead} waves at {where}, though nobody there can see it."],
    cruise: ["On the long cruise, {lead} learns the names of the stars in the window.", "{lead} starts a letter home and keeps adding to it.", "The cabin settles into its long-haul quiet. Someone is knitting."],
    hold: ["Holding in orbit. {lead} watches {where} turn slowly below and decides it is beautiful anyway.", "The ship waits its turn above {where}. Someone starts a card game.", "{lead} uses the hold to finish a book."],
    launch_hold: ["The launch is held. {lead} reads the notice twice, then makes tea.", "Held on the pad at {where}. The cabin crew bring out blankets."],
    divert: ["A change of plans: the ship sets down at {where} instead. {lead} buys a postcard there.", "Diverted to {where}. {lead} calls it an extra stop and means it kindly."],
    correction: ["A longer push than planned. {lead} feels it in the seat and grins.", "The engines run long. Cups stay in their holders."],
    waiting_word: ["A question goes to Earth and the answer comes back. In the cabin, the waiting is the quietest part of the trip.", "Word from Earth is on its way. {lead} watches the light-delay counter like a kettle."],
    waiting: ["{lead} waits at {where} with a coffee going cold.", "At {where}, {lead} watches the arrivals board and reads every name on it.", "{lead} is still at {where}, making friends with the dock cat."],
    arrival: ["{lead} steps off at {where} with everything they brought and one thing they did not.", "At {where}, someone is holding a sign with {lead}'s name on it.", "{lead} reaches {where} and stands at the window a moment longer than needed."],
    arrival_late: ["{lead} reaches {where} later than promised and is gracious about it, mostly.", "Late into {where}. {lead} has already forgiven the ship and is working on the schedule."],
    arrival_early: ["{lead} reaches {where} early and has time to find the good coffee.", "Early into {where}. {lead} has never been early for anything before."]
  };
  // Run-log incident kinds (world/engine/sol-rides.js) mapped onto moments.
  var CHECKPOINT = { launch_hold: "launch_hold", pad_closed: "hold" };
  var INCIDENT = { pad_busy: "hold", flare: "launch_hold", dust_storm: "hold", titan_haze: "hold", divert: "divert", divert_overtaken: "arrival",
    correction_burn: "correction", awaiting_answer: "waiting_word", replanned: "waiting_word" };

  function parseRider(rider) {
    var m = /^([^,]+),\s*(?:a|an)\s+(.+?)(?:\s*\(simulated\))?$/.exec(String(rider || ""));
    return m ? { lead: m[1].trim(), job: m[2].trim() } : { lead: String(rider || "A passenger").replace(/\s*\(simulated\)$/, ""), job: "" };
  }
  function fill(t, v) {
    return t.replace(/\{(\w+)\}/g, function (_, k) { return v[k] != null ? String(v[k]) : "{" + k + "}"; });
  }
  function sentence(s) { return cap(s); }

  /** A booking's story. b: a booking row (engine HAILS or hailRow): { id, rider, party, from, to, kind }.
   *  Returns { tag: "Fictional", version, headline, story, overheard|null, place_note, source }. */
  function booking(b) {
    var r = parseRider(b.rider), party = b.party | 0 || 1, k = VERSION + "|" + b.id + "|";
    // The booking desk says "long haul" where the engine says "long".
    var kind = /^long/.test(b.kind) ? "long" : b.kind;
    var v = { lead: r.lead, from: placeName(b.from), to: placeName(b.to), at_from: placeAt(b.from), at_to: placeAt(b.to), party: party };
    var out = { tag: "Fictional", version: VERSION, headline: null, story: null, overheard: null,
      place_note: PLACE_NOTE[b.to] ? { tag: PLACE[b.to] && PLACE[b.to].real ? "Real" : "Fictional", text: PLACE_NOTE[b.to] } : null, source: null };
    if (CATALOG[b.id] && party === 1) { out.headline = CATALOG[b.id].headline; out.story = CATALOG[b.id].story; out.source = "catalog"; return out; }
    if (party >= 8) {
      var c = pick(CREW, k + "crew");
      out.headline = c[0]; out.story = sentence(fill(c[1], v)); out.source = "crew";
      return out;
    }
    var fits = FEATURES.filter(function (f) { return f.when({ from: b.from, to: b.to, party: party, kind: kind }); });
    if (fits.length && unit(k + "feature?") < 0.2) {
      var f = pick(fits, k + "feature");
      out.headline = f.headline; out.story = sentence(fill(f.story, v)); out.source = "feature:" + f.id;
      // A feature written for one traveller still says who else is on the booking.
      if (party > 1 && !f.party) out.story += " " + sentence(fill(pick(COMPANY[party] || COMPANY.small, k + "company"), v));
    } else {
      var pool = STATION_TO[b.to] ? MOTIVE_STATION : ORBIT_TO[b.to] ? MOTIVE_ORBIT : (MOTIVE_BY_JOB[r.job] || []).concat(MOTIVE_ANY);
      // Field work happens on a body, not on a real station or around a gas giant.
      if (STATION_TO[b.from] || ORBIT_TO[b.from]) pool = pool.filter(function (m) { return m[2] !== "ground"; });
      var m = pick(pool, k + "motive");
      var company = COMPANY[party] || COMPANY.small;
      out.headline = m[0];
      out.story = [fill(m[1], v), fill(pick(company, k + "company"), v), fill(pick(DETAIL, k + "detail"), v)].map(sentence).join(" ");
      out.source = "generated";
    }
    if (unit(k + "overheard?") < 0.35) out.overheard = "Overheard before departure from " + v.from + ": " + pick(OVERHEARD, k + "overheard");
    return out;
  }

  /** A flight-log moment for an event the run log recorded. b: the booking row. ev: { moment }, { incident: kind } or
   *  { checkpoint: kind }, plus leg ("pickup" or "ride", from the log) and where (a place id or name).
   *  key: something unique to this run and event, e.g. run_id + "|" + index.
   *  Returns { tag: "Fictional", version, moment, text } or null when the event has no moment. */
  function moment(b, ev, key) {
    var name = ev.moment || INCIDENT[ev.incident] || CHECKPOINT[ev.checkpoint];
    // On a pickup leg the passengers are not aboard yet: whatever holds the ship, they wait at the dock until it comes.
    if (ev.leg === "pickup" && name && name !== "boarding") name = "waiting";
    if (name === "boarding" && (b.party | 0) > 1) name = "boarding_group";
    if (!name || !MOMENT[name]) return null;
    var r = parseRider(b.rider);
    var text = sentence(fill(pick(MOMENT[name], VERSION + "|" + key + "|" + name), { lead: r.lead, where: placeName(idOf(ev.where)) }));
    return { tag: "Fictional", version: VERSION, moment: name, text: text };
  }

  /** Moments for one recorded flight, one entry (a moment or null) per event, in the order given.
   *  f: { key: the run id, late: true when the last arrival was later than planned,
   *       legs: [{ kind: "pickup" | "ride", from, to, dep, arr, idle }] as flown (jd days),
   *       stops: [{ at, board: [booking], alight: [booking] }], stop i being where legs[i - 1] ends,
   *       events: [{ kind: "depart" | "arrive", leg: i } | { kind: "checkpoint" | "incident", cause, jd, where }] }.
   *  A booking is { id, rider or lead, party }. Departures and arrivals speak for whoever boards, rides or alights;
   *  a hold speaks for whoever is aboard, or for the passengers waiting at the next stop when nobody is. */
  function flight(f) {
    var legs = f.legs || [], stops = f.stops || [], last = stops.length - 1;
    function who(b) { return { id: b.id, rider: b.rider || b.lead, party: b.party }; }
    function aboard(i) { // bookings in the cabin on leg i: boarded at stop i or earlier, alighting after it
      var on = [];
      for (var s = 0; s <= i && s < stops.length; s++) (stops[s].board || []).forEach(function (b) {
        for (var t = s + 1; t <= i; t++) if ((stops[t].alight || []).indexOf(b) >= 0) return;
        on.push(b);
      });
      return on;
    }
    function legAt(jd) {
      for (var i = 0; i < legs.length; i++) if (!legs[i].idle && jd <= legs[i].arr + 1 / 1440) return i;
      return legs.length - 1;
    }
    return (f.events || []).map(function (e, n) {
      var key = f.key + "|" + n + "|" + e.kind;
      if (e.kind === "depart" || e.kind === "arrive") {
        var L = legs[e.leg]; if (!L || L.idle) return null;
        if (e.kind === "depart") { var on = aboard(e.leg); return on.length ? moment(who(on[0]), { moment: "departure", where: L.from }, key) : null; }
        var S = stops[e.leg + 1] || {}, off = S.alight || [], up = S.board || [];
        if (off.length) return moment(who(off[0]), { moment: f.late && e.leg + 1 === last ? "arrival_late" : "arrival", where: L.to }, key);
        return up.length ? moment(who(up[0]), { moment: "boarding", where: L.to }, key) : null;
      }
      var i = legAt(e.jd), ride = i >= 0 ? aboard(i) : [], S2 = i >= 0 ? stops[i + 1] : null, next = S2 ? S2.board || [] : [];
      var ev = e.kind === "checkpoint" ? { checkpoint: e.cause } : { incident: e.cause };
      if (ride.length) { ev.leg = "ride"; ev.where = e.where; return moment(who(ride[0]), ev, key); }
      // Nobody aboard yet: the passengers who board at the next stop are waiting there.
      if (next.length) { ev.leg = "pickup"; ev.where = S2.at; return moment(who(next[0]), ev, key); }
      return null;
    });
  }

  /** A short place line: { tag: "Real" | "Fictional", text }. */
  function placeNote(id) {
    return PLACE_NOTE[id] ? { tag: PLACE[id].real ? "Real" : "Fictional", text: PLACE_NOTE[id] } : null;
  }

  /** A numeric fact about a real body, formatted only from the engine's PLACES record p (radius_km, period_days, parent).
   *  Returns null for fictional places. The numbers are the engine's; nothing is invented here. */
  function placeFact(p, parentName) {
    if (!p || !p.real) return null;
    var name = cap(placeName(p.id));
    if (p.period_days && parentName) {
      var perDay = 1 / p.period_days;
      var t = perDay >= 1 ? name + " goes round " + parentName + " about " + Math.round(perDay) + " times a day."
        : name + " goes round " + parentName + " once every " + (p.period_days < 10 ? p.period_days.toFixed(1) : Math.round(p.period_days)) + " days.";
      return { tag: "Real", source: "engine PLACES", text: t };
    }
    if (p.radius_km && p.kind !== "station") return { tag: "Real", source: "engine PLACES", text: name + " is about " + Math.round(p.radius_km).toLocaleString("en-US") + " km in radius." };
    return null;
  }

  return { VERSION: VERSION, booking: booking, moment: moment, flight: flight, idOf: idOf, placeNote: placeNote, placeFact: placeFact, parseRider: parseRider,
    PLACE: PLACE, MOMENTS: Object.keys(MOMENT), _company: COMPANY, INCIDENT: INCIDENT, CHECKPOINT: CHECKPOINT,
    counts: function () { var n = MOTIVE_ANY.length + MOTIVE_STATION.length + MOTIVE_ORBIT.length; Object.keys(MOTIVE_BY_JOB).forEach(function (j) { n += MOTIVE_BY_JOB[j].length; });
      return { motives: n, details: DETAIL.length, overheard: OVERHEARD.length, features: FEATURES.length, crew: CREW.length, catalog: Object.keys(CATALOG).length,
        moments: Object.keys(MOMENT).reduce(function (a, m) { return a + MOMENT[m].length; }, 0) }; } };
});
