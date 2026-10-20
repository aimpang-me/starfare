// HQ on the home page's Comms panel: answers a player's typed question from the game data the page already has (simulated).
// No model and no network: a question is matched to a topic, and every number in the answer is copied from the context the
// page passes in (the booking desk, the sky clock, the hazards, the fleet, flights in the air, the board). HQ never plans a
// booking or picks a ship: that is the agent's job, and it is what gets scored. build.mjs publishes these bytes as
// /assets/comms.js. Text comes back plain (not HTML): callers escape it.
(function (root) {
  "use strict";
  var TOPICS = ["Open routes", "Season clock", "Space weather", "Fleet", "Flights in the air", "Scoreboard", "My agent"];

  // Planning and advice stay with the agent. Checked first, so "which route should I take" is refused, not listed.
  var ADVICE = /\b(best|should|recommend|optimal|optimi[sz]e|cheapest|fastest|quickest|most points|highest score|worth it|strategy|tip|tips|advice|advise)\b|\bwhich (ship|starseeker|one|booking|hail|route)\b|\bplan (a|the|my|it)\b|\bhow (do|can|should) i (win|score)\b/i;
  var T = {
    agent: /\bmy agent\b|\bmy (bot|grok|dispatcher)\b|\bagent (status|doing)\b|\bwhat is my agent\b/i,
    ship: /\bsf-?\s?(\d{1,3})\b/i,
    clock: /\bseason\b|\bclock\b|\btime left\b|\breset\b|\bdeadline\b|\bhow long\b|\bwhen does\b|\bsky time\b/i,
    weather: /\bweather\b|\bflares?\b|\bstorms?\b|\bdust\b|\bhaze\b|\bhazards?\b|\balerts?\b|\bpads?\b|\bberths?\b|\bclosed\b/i,
    flights: /\bflights?\b|\bin the air\b|\bflying\b|\bairborne\b|\blive\b/i,
    fleet: /\bfleet\b|\bships?\b|\bstarseekers?\b|\bwhere is\b|\bwhere are\b/i,
    board: /\b(score)?board\b|\bscores?\b|\bleader(board)?\b|\bpoints\b|\branking\b|\btop\b/i,
    routes: /\broutes?\b|\bbookings?\b|\bhails?\b|\bpassengers?\b|\btrips?\b|\brides?\b|\bavailable\b|\bopen\b|\bgoing to\b|\bfrom\b/i,
  };

  function num(n, d) { return Number(n).toLocaleString("en-US", { maximumFractionDigits: d || 0, minimumFractionDigits: 0 }); }
  function realTime(s) {
    s = Math.max(0, Math.round(s));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? h + " h " + m + " m" : m ? m + " m " + (s % 60) + " s" : s + " s";
  }
  function plural(n, one, many) { return num(n) + " " + (n === 1 ? one : many); }

  // Places named in the question, longest first so "Mars Base" wins over "Mars". "from X" and "to Y" set the end.
  function placesIn(q, names) {
    var low = " " + q.toLowerCase().replace(/[^a-z0-9 -]/g, " ") + " ", out = { from: null, to: null, any: [] };
    names.slice().sort(function (a, b) { return b.length - a.length; }).forEach(function (n) {
      var k = n.toLowerCase(), at = low.indexOf(" " + k + " ");
      if (at < 0 || out.any.some(function (x) { return x.toLowerCase().indexOf(k) >= 0; })) return;
      out.any.push(n);
      var before = low.slice(Math.max(0, at - 6), at);
      if (/from\s*$/.test(before)) out.from = n; else if (/\bto\s*$/.test(before)) out.to = n;
    });
    return out;
  }

  function routes(q, ctx) {
    var all = ctx.routes(), P = placesIn(q, ctx.places || []), kind = /\bquick\b/i.test(q) ? "quick" : /\blong\b/i.test(q) ? "long haul" : null;
    var list = all.filter(function (r) {
      if (kind && r.kind !== kind) return false;
      if (P.from && r.from !== P.from) return false;
      if (P.to && r.to !== P.to) return false;
      if (!P.from && !P.to && P.any.length && P.any.indexOf(r.from) < 0 && P.any.indexOf(r.to) < 0) return false;
      return true;
    });
    var open = list.filter(function (r) { return r.open; }), c = ctx.clock();
    var where = (kind ? kind + " " : "") + (P.from || P.to || P.any.length ? "bookings" + (P.from ? " from " + P.from : "") + (P.to ? " to " + P.to : "") +
      (!P.from && !P.to ? " touching " + P.any.join(" or ") : "") : "bookings");
    if (!all.length) return { topic: "routes", text: "The booking desk is empty right now. It refills when the season resets.", sub: "Live booking pool · Simulated" };
    var text = open.length ? plural(open.length, "open " + where.replace(/bookings/, "booking"), "open " + where) + " an agent can take now." :
      "No open " + where + " an agent can take now.";
    if (!c.long_open && c.quick_open) text += " Long hauls are closed for the rest of this season; quick hops close in " + realTime(c.seconds_left - 31) + " of real time.";
    else if (c.long_open) text += " Long hauls can still be taken for " + realTime(c.long_seconds_left) + " of real time.";
    return {
      topic: "routes", text: text, sub: "Live booking pool · Simulated" + (open.length > 8 ? " · showing 8 of " + num(open.length) : ""),
      rows: open.slice(0, 8).map(function (r) { return [r.from + " → " + r.to, r.kind + " · " + plural(r.party, "passenger", "passengers")]; }),
      actions: open.length ? [{ label: "Show bookings", act: "bookings" }] : [],
    };
  }
  function clock(ctx) {
    var c = ctx.clock();
    var text = "Season " + c.season + ". Sky time " + c.sky_now + " UTC; the season resets in " + realTime(c.seconds_left) + " of real time.";
    text += c.long_open ? " Every kind of booking can be taken now." : c.quick_open ? " Long hauls are closed until the reset; quick hops can still be taken." : " No booking can be taken until the reset.";
    return { topic: "clock", text: text, sub: "One real second is one sky day · Simulated" };
  }
  function weather(ctx) {
    var a = ctx.alerts();
    if (!a.length) return { topic: "weather", text: "All clear: no solar flare, no storm or haze, and no full pad right now.", sub: "Seeded hazards · Simulated" };
    return { topic: "weather", text: plural(a.length, "alert", "alerts") + " right now.", sub: "Seeded hazards · Simulated", rows: a.map(function (x) { return [x.t, x.d]; }) };
  }
  function fleet(q, ctx) {
    var m = T.ship.exec(q), ships = ctx.fleet(), flying = ctx.flights();
    if (m) {
      var call = "SF-" + ("0" + Number(m[1])).slice(-2), f = flying.filter(function (x) { return x.call === call; })[0];
      if (f) return { topic: "fleet", text: call + " is flying " + f.where + ". " + (f.eta ? "It lands in " + f.eta + " of sky time." : ""), sub: "Live flight · Simulated", actions: [{ label: "Follow on map", act: "follow", run_id: f.run_id }] };
      var s = ships.filter(function (x) { return x.call === call; })[0];
      if (!s) return { topic: "fleet", text: "HQ has no Starseeker called " + call + ". The fleet runs " + ships.map(function (x) { return x.call; }).join(", ") + "." };
      return { topic: "fleet", text: call + (s.name ? " (" + s.name + ")" : "") + " is " + s.where + (s.busy ? ", busy until " + s.busy + " sky time" : ", free") + ".", sub: "Fleet · Simulated" };
    }
    return { topic: "fleet", text: plural(ships.length, "Starseeker is", "Starseekers are") + " on the ground or in orbit, and " + plural(flying.length, "is", "are") + " flying.",
      sub: "Fleet · Fictional ships · Simulated", rows: ships.slice(0, 10).map(function (s) { return [s.call + (s.name ? " · " + s.name : ""), s.where + (s.busy ? " · busy" : "")]; }) };
  }
  function flights(ctx) {
    var f = ctx.flights();
    if (!f.length) return { topic: "flights", text: "No agent flight is in the air right now.", sub: "Live flights · Simulated" };
    return { topic: "flights", text: plural(f.length, "flight is", "flights are") + " in the air.", sub: "Live flights · Simulated",
      rows: f.slice(0, 8).map(function (x) { return [x.call + " · " + x.title, x.where]; }), actions: [{ label: "Show flights", act: "flights" }] };
  }
  function board(ctx) {
    var b = ctx.board && ctx.board();
    if (!b) return { topic: "board", text: "The scoreboard is loading. Ask again in a moment, or open it from Reports.", actions: [{ label: "Open the scoreboard", act: "board" }] };
    if (!b.length) return { topic: "board", text: "No flight has scored this season yet.", actions: [{ label: "Open the scoreboard", act: "board" }] };
    return { topic: "board", text: "The best arrived flight for each booking this season, top " + Math.min(5, b.length) + " by points.", sub: "Scores out of 100,000 · Simulated",
      rows: b.slice(0, 5).map(function (r) { return [r.title, num(r.points) + " points"]; }), actions: [{ label: "Open the scoreboard", act: "board" }] };
  }
  function agent(ctx) {
    var a = ctx.agent && ctx.agent();
    if (!a) return { topic: "agent", text: "No agent is linked to this channel yet. Give your agent the HQ code above, or open its follow link from the sign-in page.", actions: [{ label: "Connect agent", act: "connect" }] };
    if (!a.current) return { topic: "agent", text: (a.name || "Your agent") + " is linked and hasn't taken a booking yet." };
    return { topic: "agent", text: (a.name || "Your agent") + " is on " + a.current.title + ": " + a.current.state + ".", actions: a.current.run_id ? [{ label: "Open flight page", act: "flight", run_id: a.current.run_id }] : [] };
  }
  function help() {
    return { topic: "help", text: "HQ answers from live game data: " + TOPICS.join(", ").toLowerCase() + ". Try \"open routes to Titan Dock\" or \"where is SF-07?\".", sub: "HQ never plans or picks for your agent" };
  }

  /** The answer to one question: { topic, text, sub, rows: [[left, right]], actions: [{ label, act, run_id }] }. */
  function ask(q, ctx) {
    q = String(q || "").trim().slice(0, 300);
    if (!q) return help();
    if (ADVICE.test(q)) return { topic: "advice", refused: true,
      text: "That's your agent's call, and it's what gets scored, so HQ won't plan or pick for it. HQ can tell you the open routes, the season clock, space weather, the fleet and the board." };
    if (T.agent.test(q)) return agent(ctx);
    if (T.ship.test(q)) return fleet(q, ctx);
    if (T.weather.test(q)) return weather(ctx);
    if (T.clock.test(q) && !T.routes.test(q)) return clock(ctx);
    if (T.board.test(q)) return board(ctx);
    if (T.flights.test(q) && !/\bavailable\b|\bopen\b/i.test(q)) return flights(ctx);
    if (T.fleet.test(q)) return fleet(q, ctx);
    if (T.routes.test(q) || placesIn(q, ctx.places || []).any.length) return routes(q, ctx);
    if (T.clock.test(q)) return clock(ctx);
    return help();
  }

  /** Who checked in, for HQ's check-in row: [[key, value]] with only the fields the agent gave. */
  function checkIn(e) {
    var rows = [], c = e.client;
    rows.push(["Name", (e.name || (c && c.name) || "not given") + (c && c.name ? " · client \"" + c.name + "\"" + (c.version ? " " + c.version : "") : "")]);
    rows.push(["Model", e.model || "not given"]);
    rows.push(["Thinking", e.thinking || "not given"]);
    rows.push(["Skills", e.skills && e.skills.length ? e.skills.join(", ") : "none given"]);
    rows.push(["Player", e.signed_in ? "signed in" : "not signed in"]);
    return rows;
  }

  /** The chip word for one agent log line (AgentLog.line output). */
  function chipOf(L) {
    if (L.tone === "error") return "Refused";
    if (L.tool === "dispatch") return "Dispatch";
    if (L.tool === "decide") return "Checkpoint";
    if (L.tool === "take_hail") return "Take";
    if (L.tone === "plan") return "Plan";
    return "Agent";
  }

  var api = { ask: ask, checkIn: checkIn, chipOf: chipOf, placesIn: placesIn, realTime: realTime, TOPICS: TOPICS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Comms = api;
})(typeof self !== "undefined" ? self : this);
