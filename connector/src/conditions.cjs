// Conditions as reported: what the public map and alerts may show of a season's hazards when its seed is keyed
// (season-seed.js). Only the past: every window started at or before `at` (no later than the sky time now), and a window
// still going has end null, because nobody, agent or viewer, is told when a storm or haze ends. The Worker serves
// reportOf at /sky.json; the site rebuilds a hazard view from it (reportedHazards) that answers the same calls as the
// engine's R.hazards(seed). build.mjs publishes these bytes as /assets/conditions.js.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StarfareConditions = factory();
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";
  var PADS = ["iss", "lunar-data-center", "phobos", "mars-base", "io", "ganymede", "europa", "titan", "earth", "ceres-port", "orbital-depot", "ceres", "callisto", "titan-dock"];
  var STORM_PLACES = ["earth", "jupiter", "saturn"];
  // The engine keeps one dust record for Mars and Mars Base, and one haze record for Titan and Titan Dock.
  var WEATHER = { dust: "mars", haze: "titan" }, KIND_AT = { mars: "dust", "mars-base": "dust", titan: "haze", "titan-dock": "haze" };
  var FRONT_DAYS = 47; // past eruptions sent: a front is drawn for about 46 days (sky-effects.js)
  var RECENT_DAYS = 2; // past storms, weather and full pads sent
  var STEP = 1 / 144, HOUR = 1 / 24;

  // Distinct windows ({ start, end, ... }) that hit the probe times from..to, oldest first.
  function windows(probe, from, to, step) {
    var out = [], seen = {};
    for (var jd = from; jd <= to + 1e-9; jd += step) {
      var w = probe(Math.min(jd, to));
      if (w && !seen[w.start]) { seen[w.start] = 1; out.push(w); }
    }
    return out;
  }

  // Eruptions at the Sun that started on one sky day; days[day] keeps a day once it is wholly past (a day's eruptions are
  // fixed by the seed), so a server answering every few seconds probes only the current day.
  function eruptionsOn(H, day, to, days) {
    if (days && days[day]) return days[day];
    var out = windows(function (jd) { return H.flareAt(jd); }, day, Math.min(day + 1 + 1 / 6, to), STEP).filter(function (w) { return w.start >= day && w.start < day + 1; });
    if (days && day + 1 + 1 / 6 <= to) days[day] = out;
    return out;
  }

  // The report for sky time at (clamped to nowJd) from a season's hazard layer H (R.hazards(seed)). days (optional) is a
  // cache for one seed's eruptions.
  function reportOf(H, at, nowJd, days) {
    at = Math.min(at, nowJd);
    function hide(w) { var o = { start: w.start, end: w.end > nowJd ? null : w.end }; if (w.kind) o.kind = w.kind; if (w.erupted != null) o.erupted = w.erupted; return o; }
    var recent = at - RECENT_DAYS, hr = Math.floor(at * 24), pads = [], berths = {}, storms = {}, weather = {};
    PADS.forEach(function (p) {
      berths[p] = H.berths(p);
      for (var h = hr - RECENT_DAYS * 24; h <= hr; h++) { var n = H.docked(p, h); if (n >= berths[p]) pads.push([h, p, n]); }
    });
    STORM_PLACES.forEach(function (p) { storms[p] = windows(function (jd) { return H.flareAt(jd, p); }, recent, at, HOUR).map(hide); });
    Object.keys(WEATHER).forEach(function (k) { weather[k] = windows(function (jd) { return H.weatherAt(WEATHER[k], jd); }, recent, at, HOUR).map(hide); });
    var eruptions = [];
    for (var d = Math.floor(at - FRONT_DAYS); d <= at; d++) eruptionsOn(H, d, at, days).forEach(function (w) { if (w.start >= at - FRONT_DAYS && w.start <= at) eruptions.push(w); });
    return { at: at, eruptions: eruptions.map(hide), storms: storms, weather: weather, berths: berths, pads_full: pads };
  }

  // A hazard view over a report: flareAt, weatherAt, berths and docked as R.hazards answers them, for times up to the
  // report. A later time reads as the report's own (conditions as last reported); an earlier one it doesn't cover, as clear.
  // A window still going (end null) reads as ending at Infinity.
  function reportedHazards(rep) {
    function find(list, jd) {
      jd = Math.min(jd, rep.at);
      for (var i = 0; list && i < list.length; i++) {
        var w = list[i];
        if (jd >= w.start && (w.end == null || jd < w.end)) return w.end == null ? Object.assign({}, w, { end: Infinity }) : w;
      }
      return null;
    }
    var full = {};
    rep.pads_full.forEach(function (x) { full[x[0] + "|" + x[1]] = x[2]; });
    return {
      reported: true, at: rep.at,
      flareAt: function (jd, place) { return find(place == null ? rep.eruptions : rep.storms[place], jd); },
      weatherAt: function (place, jd) { return KIND_AT[place] ? find(rep.weather[KIND_AT[place]], jd) : null; },
      berths: function (p) { return rep.berths[p] || 2; },
      docked: function (p, h) { return full[Math.min(h, Math.floor(rep.at * 24)) + "|" + p] || 0; },
    };
  }

  return { PADS: PADS, STORM_PLACES: STORM_PLACES, FRONT_DAYS: FRONT_DAYS, RECENT_DAYS: RECENT_DAYS, reportOf: reportOf, reportedHazards: reportedHazards };
});
