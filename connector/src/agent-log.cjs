// What an agent did, in words a player reads: one line per tool call from a run's dispatcher log (trail) or a bench trace.
// Shared by the flight page, the home activity feed and the bench watch page; build.mjs publishes these bytes as
// /assets/agent-log.js. Every number is copied from the log entry; nothing here computes or estimates one.
// Text comes back plain (not HTML): callers escape it.
(function (root) {
  "use strict";
  var ACT = {
    take_hail: "Took the booking", get_hail: "Read the booking", list_hails: "Listed the bookings", start_bench: "Started a bench session",
    plan_pickup: "Planned the pickup", plan_ride: "Planned the ride", plan_leg: "Planned a leg",
    check_pad: "Checked a pad forecast", space_weather: "Checked space weather", dispatch: "Dispatched", decide: "Decided", get_my_rides: "Read its past rides",
  };
  var TONE = { plan_pickup: "plan", plan_ride: "plan", plan_leg: "plan", check_pad: "check", space_weather: "check", dispatch: "dispatch", decide: "decide", take_hail: "take" };
  function num(n, d) {
    if (typeof n !== "number" || !isFinite(n)) return String(n);
    return n.toLocaleString("en-US", { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: 0 });
  }
  function money(n) { return typeof n === "number" ? "$" + num(n, 2) : String(n); }
  function plain(s) { return String(s == null ? "" : s).replace(/_/g, " "); }
  function placeOf(p, name) { return name ? name(p) : p; }
  // A decide answer in words, from the stored decision.
  function decision(d, name) {
    if (!d) return "";
    if (d.action === "hold") return d.hours != null ? "hold in orbit, ask again in " + num(d.hours, 1) + " h" : "hold in orbit until the pad opens";
    if (d.action === "divert") return "divert to " + placeOf(d.place, name) + (d.wait_hours ? " and wait " + num(d.wait_hours, 1) + " h on the ground" : "");
    if (d.action === "replan") return "replan the leg, leaving after " + (d.depart_after || "the checkpoint") + (d.objective ? " (" + d.objective + ")" : "");
    if (d.action === "wait") return "wait for the launch hold to lift";
    return plain(d.action);
  }
  function gate(g) { return g === "PASS" ? "n-body re-fly passed" : g === "FAIL" ? "n-body re-fly failed" : g === "local" || /^not re-flown/.test(g) ? "local hop, not re-flown" : g ? "re-fly " + g : ""; }
  function status(s) { return s === "checkpoint" ? "stopped at a checkpoint" : s === "arrived" ? "landed" : s ? plain(s) : ""; }
  function odds(x) { return typeof x === "number" ? num(x * 100, 1) + "%" : String(x); }

  /** One trail entry (or a bench call mapped by fromCall) in words: act (what), text (details), why (the agent's own note),
   *  at (the sky time the action is about, when it has one), tone (plan, check, dispatch, decide, take, error, other). */
  function line(e, name) {
    var act = ACT[e.tool] || "Called " + e.tool, out = { tool: e.tool, act: act, text: "", why: e.note || "", at: null, tone: TONE[e.tool] || "other" };
    if (e.error) { out.act = act + ": refused"; out.text = e.error; out.tone = "error"; return out; }
    if (e.tool === "take_hail") out.text = (e.title ? e.title + " " : "") + (e.hail_id ? "(" + e.hail_id + ")" : "");
    else if (e.tool === "check_pad") out.text = placeOf(e.place, name) + ": " + e.berths + " berths, up to " + e.max_booked + " booked in an hour" + (e.weather ? "; " + plain(e.weather) + " odds up to " + odds(e.max_odds) : "");
    else if (e.tool === "space_weather") out.text = placeOf(e.place, name) + ": flare odds up to " + odds(e.max_flare_odds) + " a day";
    else if (e.tool === "dispatch") {
      if (e.problems) { out.act = "Dispatch refused"; out.text = e.problems.join("; "); out.tone = "error"; return out; }
      out.act = "Dispatched " + (e.car || "the Starseeker");
      var q = e.quotes ? Object.keys(e.quotes).map(function (id) { return id + ": fare " + money(e.quotes[id].fare_usd) + ", promised " + e.quotes[id].arrival; }).join("; ")
        : "fare " + money(e.fare_usd) + ", promised arrival " + e.arrival;
      out.text = q + (status(e.status) ? " · " + status(e.status) : "");
    } else if (e.tool === "decide") {
      out.act = "Decided at checkpoint " + e.checkpoint;
      out.text = (e.kind ? plain(e.kind) + (e.checkpoint_at ? " at " + e.checkpoint_at : "") + ": " : "") + decision(e.decision, name) + (status(e.status) ? " · " + status(e.status) : "");
      out.at = e.checkpoint_at || null;
    } else if (e.leg_id) {
      out.text = (e.car ? String(e.car).toUpperCase() + " " : "") + placeOf(e.from, name) + " → " + placeOf(e.to, name) + ", leaves " + e.depart + ", lands " + e.arrive +
        " · " + num(e.kwh) + " kWh · " + money(e.fare_usd) + (gate(e.gate) ? " · " + gate(e.gate) : "");
      out.at = e.depart || null;
    }
    return out;
  }

  /** A bench trace call ({ tool, input, result }) as a trail-like entry, so the bench page reads like the flight page. */
  function fromCall(tool, input, result) {
    var r = result || {}, i = input || {}, e = { tool: tool };
    if (r.error) { e.error = r.error; return e; }
    if (i.note) e.note = i.note;
    if (tool === "take_hail") { e.hail_id = r.hail_id; e.title = r.title; }
    else if (tool === "check_pad" && r.place) {
      e.place = r.place.name; e.berths = r.berths;
      e.max_booked = Array.isArray(r.hours) ? Math.max.apply(null, r.hours.map(function (h) { return h.booked; })) : null;
      var w = r.local_weather; if (w && Array.isArray(w.days)) { e.weather = w.kind; e.max_odds = Math.max.apply(null, w.days.map(function (d) { return d.odds; })); }
    } else if (tool === "space_weather" && r.place) {
      e.place = r.place.name; e.max_flare_odds = Array.isArray(r.days) ? Math.max.apply(null, r.days.map(function (d) { return d.flare_odds; })) : null;
    } else if (tool === "dispatch") {
      if (r.problems) e.problems = r.problems;
      else { e.car = r.car || null; e.fare_usd = i.quoted_fare_usd; e.arrival = i.quoted_arrival; e.quotes = i.quotes; e.status = r.status; }
    } else if (tool === "decide") {
      e.checkpoint = i.checkpoint; e.decision = { action: i.action, hours: i.hours, place: i.place, wait_hours: i.wait_hours, depart_after: i.depart_after, objective: i.objective };
      e.status = r.status;
    } else if (r.leg_id) {
      e.leg_id = r.leg_id; e.kind = r.kind; e.car = r.car; e.from = r.from; e.to = r.to; e.depart = r.depart; e.arrive = r.arrive; e.kwh = r.battery_kwh; e.fare_usd = r.fare_usd;
      e.gate = r.refly && r.refly.result ? r.refly.result : null;
    }
    return e;
  }

  /** Who flew it: the MCP client name the agent reported (self-reported), else a plain "the agent". */
  function agentName(trail) {
    var t = (trail || []).filter(function (x) { return x.tool === "take_hail" && x.agent && x.agent.name; })[0];
    return t ? t.agent.name : "";
  }

  // Message style B (design/assets/message-b.css): every row carries a worded chip; colour lives only in the chip.
  var CHIP = { plan: ["Plan", "plan"], check: ["Plan", "plan"], dispatch: ["Dispatch", "dispatch"], decide: ["Checkpoint", "checkpoint"], take: ["Take", "neutral"], error: ["Refused", "refused"] };
  var READS = { get_hail: 1, list_hails: 1 };
  /** The chip for a line: [words, class]. */
  function chip(L) { return CHIP[L.tone] || (READS[L.tool] ? CHIP.plan : ["System", "neutral"]); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  /** A wall-clock time as 24-hour HH:MM in the reader's zone ("" without one). */
  function clock(ms) { if (typeof ms !== "number" || !isFinite(ms)) return ""; var d = new Date(ms); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  /** One log line as a style B row (HTML; everything from the line is escaped here). o: tag (li), cls, attrs (trusted HTML), ms (wall time),
   *  time (text for the time column instead), title (its tooltip), words (a function over plain text, applied to act and text),
   *  sub (trusted HTML lines added under the text), chip ([words, class] instead of the line's own), inner (just the cells, for an element the caller made). */
  function row(L, o) {
    o = o || {};
    var tag = o.tag || "li", c = o.chip || chip(L), w = o.words || function (s) { return s; }, t = o.time != null ? o.time : clock(o.ms);
    var title = o.title || (typeof o.ms === "number" ? new Date(o.ms).toLocaleString() + " your time" : "");
    var cells = '<span class="mb-t"' + (title ? ' title="' + esc(title) + '"' : "") + ">" + esc(t) + "</span>" +
      '<span class="mb-c ' + c[1] + '">' + esc(c[0]) + "</span>" +
      '<span class="mb-x"><span class="mb-a">' + esc(w(L.act)) + "</span>" + (L.text ? '<span class="mb-s">' + esc(w(L.text)) + "</span>" : "") +
      (o.sub || "") + (L.why ? '<span class="mb-w">Why: <q>' + esc(L.why) + "</q></span>" : "") + "</span>";
    return o.inner ? cells : "<" + tag + ' class="mb' + (o.cls ? " " + o.cls : "") + '"' + (o.attrs ? " " + o.attrs : "") + ">" + cells + "</" + tag + ">";
  }

  var api = { line: line, fromCall: fromCall, agentName: agentName, decision: decision, chip: chip, row: row, clock: clock, esc: esc };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AgentLog = api;
})(typeof self !== "undefined" ? self : this);
