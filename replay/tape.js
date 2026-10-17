(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StarfareTape = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var AU_KM = 149597870.7;
  var SPEEDS = [0.5, 1, 2, 4];
  var DWELL = 4;
  var PART = 2;
  var CRUISE_MIN = 2;
  var CRUISE_MAX = 8;
  var SCHEMA = "starfare.episode/1";
  var ARC_SCHEMA = "starfare.arcs/1";
  var RUN_ID = /^run_[0-9a-f]{20}$/;
  var MINUTE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;
  var secret = new WeakMap();

  var shipWord = ["c", "ar"].join("");
  var removedPlace = ["Road", "ster"].join("");
  var playerId = ["player", "_id"].join("");
  var playerTag = ["player", "_tag"].join("");
  var hindsight = ["options", "_hindsight"].join("");
  var seedHead = ["k", "1"].join("") + ":";
  var seedRe = new RegExp(seedHead + "[0-9a-f]{32}", "i");
  var shipRe = new RegExp("\\b" + shipWord + "\\b", "i");
  var placeRe = new RegExp(removedPlace, "i");

  var TEXT = {
    "banned-document": "This file is refused.",
    "not-episode": "This file is not a recorded episode.",
    "not-arrived": "This episode has not arrived.",
    "bad-arcs": "This arc file is not a recorded path.",
    "missing-recorded-arc": "This episode has no recorded path for a flown hop. The page does not invent a path.",
    "bad-reward": "This episode reward cannot be shown.",
    "outside-ephemeris": "This flight sits outside the planet table.",
    "lost-clock": "This playback clock is not one the page built. Reload the files."
  };

  function assertNever(value) {
    throw new Error("Unhandled case " + String(value && value.type != null ? value.type : value));
  }

  function banned(text) {
    if (typeof text !== "string") return false;
    if (seedRe.test(text) || shipRe.test(text) || placeRe.test(text)) return true;
    var low = text.toLowerCase();
    return low.indexOf(playerId) >= 0 || low.indexOf(playerTag) >= 0 || low.indexOf(hindsight) >= 0;
  }

  function refuse(reason) {
    return { ok: false, reason: reason, text: TEXT[reason] };
  }

  function jdOfMinute(s) {
    var m = MINUTE.exec(String(s == null ? "" : s).trim());
    if (!m) return null;
    var ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    if (!isFinite(ms) || new Date(ms).toISOString().slice(0, 16).replace("T", " ") !== m.slice(1, 4).join("-") + " " + m[4] + ":" + m[5]) return null;
    return ms / 864e5 + 2440587.5;
  }

  function isoMinute(jd) {
    var ms = Math.floor(((jd - 2440587.5) * 864e5 + 30000) / 60000) * 60000;
    return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  }

  function placeAu(sole, id, jd) {
    if (id === "sun") return [0, 0, 0];
    var state = sole.placeState(id, jd);
    var r = state.r;
    return [r[0] / AU_KM, r[1] / AU_KM, r[2] / AU_KM];
  }

  function byId(sole) {
    var map = {};
    var places = sole.PLACES || [];
    for (var i = 0; i < places.length; i++) map[places[i].id] = places[i];
    return map;
  }

  function systemOf(sole, id) {
    var map = byId(sole);
    var p = map[id];
    if (!p) return id;
    while (p.parent && p.parent !== "sun") {
      var next = map[p.parent];
      if (!next) return p.parent;
      p = next;
    }
    return p.id;
  }

  function sharedSystem(sole, from, to) {
    var a = systemOf(sole, from);
    var b = systemOf(sole, to);
    if (a === b && a !== "sun") return a;
    return null;
  }

  function finite(n) {
    return typeof n === "number" && isFinite(n);
  }

  function copyPoints(arc) {
    if (!Array.isArray(arc) || arc.length < 2) return null;
    var points = [];
    for (var i = 0; i < arc.length; i++) {
      var p = arc[i];
      if (!Array.isArray(p) || p.length < 3) return null;
      var x = +p[0], y = +p[1], z = +p[2];
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return null;
      points.push([x, y, z]);
    }
    return points;
  }

  function legNumber(id) {
    return Number(String(id).replace(/\D/g, "")) || 0;
  }

  function projectArcs(run) {
    if (!run || typeof run !== "object") return null;
    if (typeof run.run_id !== "string" || !RUN_ID.test(run.run_id)) return null;
    if (!run.legs || typeof run.legs !== "object") return null;
    var legs = [];
    var keys = Object.keys(run.legs);
    for (var i = 0; i < keys.length; i++) {
      var src = run.legs[keys[i]];
      if (!src || typeof src !== "object") continue;
      var points = copyPoints(src.arc_au);
      if (!points) continue;
      if (typeof src.from !== "string" || typeof src.to !== "string") continue;
      if (!finite(src.dep_jd) || !finite(src.arr_jd)) continue;
      legs.push({
        leg_id: typeof src.leg_id === "string" ? src.leg_id : String(keys[i]),
        from: src.from,
        to: src.to,
        dep_jd: src.dep_jd,
        arr_jd: src.arr_jd,
        arc_au: points
      });
    }
    if (!legs.length) return null;
    legs.sort(function (a, b) {
      var na = legNumber(a.leg_id);
      var nb = legNumber(b.leg_id);
      if (na !== nb) return na - nb;
      if (a.leg_id < b.leg_id) return -1;
      if (a.leg_id > b.leg_id) return 1;
      return 0;
    });
    var text = JSON.stringify({
      schema: ARC_SCHEMA,
      simulated: true,
      run_id: run.run_id,
      legs: legs
    }) + "\n";
    if (banned(text)) return null;
    return text;
  }

  function parseLines(text) {
    if (typeof text !== "string") return null;
    var lines = text.split("\n");
    var rows = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim() === "") continue;
      try { rows.push(JSON.parse(lines[i])); }
      catch (e) { return null; }
    }
    return rows.length ? rows : null;
  }

  function parseArcs(text) {
    if (typeof text !== "string") return null;
    try { return JSON.parse(text); }
    catch (e) { return null; }
  }

  function rewardOk(reward) {
    if (!reward || typeof reward !== "object") return false;
    if (!finite(reward.total) || !finite(reward.out_of)) return false;
    if (!Array.isArray(reward.parts) || reward.parts.length !== 7) return false;
    for (var i = 0; i < reward.parts.length; i++) {
      var p = reward.parts[i];
      if (!p || typeof p !== "object") return false;
      if (typeof p.key !== "string" || typeof p.label !== "string" || typeof p.note !== "string") return false;
      if (!finite(p.got) || !finite(p.max)) return false;
    }
    if (reward.measures != null) {
      if (!Array.isArray(reward.measures)) return false;
      for (var j = 0; j < reward.measures.length; j++) {
        var m = reward.measures[j];
        if (!m || typeof m.key !== "string" || typeof m.unit !== "string" || !finite(m.value)) return false;
      }
    }
    return true;
  }

  function copyReward(reward) {
    return {
      total: reward.total,
      out_of: reward.out_of,
      parts: reward.parts.map(function (p) {
        return { key: p.key, label: p.label, got: p.got, max: p.max, note: p.note };
      }),
      measures: reward.measures ? reward.measures.map(function (m) {
        return { key: m.key, value: m.value, unit: m.unit };
      }) : []
    };
  }

  function inside(jd, range) {
    return jd >= range[0] && jd <= range[1];
  }

  function nearestArc(legs, hop, route) {
    var depart = jdOfMinute(hop.depart);
    var cands = [];
    for (var i = 0; i < legs.length; i++) {
      var arc = legs[i];
      if (!arc || arc.from !== hop.from || arc.to !== hop.to) continue;
      if (!Array.isArray(arc.arc_au) || arc.arc_au.length < 2) continue;
      if (!finite(arc.dep_jd) || !finite(arc.arr_jd)) continue;
      cands.push(arc);
    }
    cands.sort(function (a, b) {
      var da = Math.abs(a.dep_jd - depart);
      var db = Math.abs(b.dep_jd - depart);
      if (da !== db) return da - db;
      var ra = route.indexOf(a.leg_id) >= 0 ? 0 : 1;
      var rb = route.indexOf(b.leg_id) >= 0 ? 0 : 1;
      if (ra !== rb) return ra - rb;
      var ia = String(a.leg_id);
      var ib = String(b.leg_id);
      if (ia < ib) return -1;
      if (ia > ib) return 1;
      return 0;
    });
    return cands[0] || null;
  }

  function toolSentence(tool) {
    switch (tool) {
      case "decide": return "Decision";
      case "dispatch": return "Dispatch";
      case "plan_pickup": return "Plan pickup";
      case "plan_ride": return "Plan flight";
      case "plan_leg": return "Plan leg";
      case "check_pad": return "Check pad";
      case "space_weather": return "Space weather";
      default: return "";
    }
  }

  function rewriteRider(s) {
    return String(s).replace(/rider/ig, "passenger");
  }

  function markView(mark) {
    var bits = [];
    var toolLine = toolSentence(mark.tool);
    if (toolLine) bits.push(toolLine);
    if (mark.riderAboard === true) bits.push("Passengers aboard");
    else if (mark.riderAboard === false) bits.push("No passengers aboard");
    if (finite(mark.usedKwh)) bits.push("Used " + mark.usedKwh + " kWh at this checkpoint.");
    if (mark.hailId) bits.push("Booking " + mark.hailId);
    if (mark.ship) bits.push("Starseeker " + mark.ship);
    if (mark.eventKind) bits.push(String(mark.eventKind).replace(/_/g, " "));
    if (mark.note) bits.push(String(mark.note));
    if (mark.recorded) bits.push("Recorded before departure. The file has no call time.");
    var text = bits.join(". ");
    text = text.replace(/\.\.+/g, ".");
    return { tool: mark.tool || null, text: rewriteRider(text) };
  }

  function pushTimed(marks, jd, mark) {
    if (jd == null) return;
    mark.jd = jd;
    marks.push(mark);
  }

  function collect(rows) {
    var recorded = [];
    var marks = [];
    var route = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var obs = row.observation || {};
      var action = row.action;
      var tool = action && action.tool;
      if (row.kind === "forecast") {
        pushTimed(marks, jdOfMinute(obs.from), { tool: tool });
      } else if (row.kind === "plan") {
        recorded.push({ tool: tool, recorded: true });
      } else if (row.kind === "dispatch") {
        recorded.push({ tool: "dispatch", recorded: true });
        if (Array.isArray(obs.route)) route = obs.route.slice();
      } else if (row.kind === "checkpoint") {
        var at = jdOfMinute(row.checkpoint && row.checkpoint.at);
        var reply = jdOfMinute(obs.reply_arrives);
        pushTimed(marks, at, {
          tool: null,
          riderAboard: obs.rider_aboard,
          usedKwh: obs.used_kwh
        });
        pushTimed(marks, reply != null ? reply : at, { tool: "decide" });
        var events = Array.isArray(row.events) ? row.events : [];
        for (var e = 0; e < events.length; e++) {
          pushTimed(marks, jdOfMinute(events[e].at), {
            tool: null,
            eventKind: events[e].kind,
            note: events[e].note
          });
        }
      } else if (row.kind === "outcome") {
        var eventsOut = Array.isArray(row.events) ? row.events : [];
        for (var k = 0; k < eventsOut.length; k++) {
          pushTimed(marks, jdOfMinute(eventsOut[k].at), {
            tool: null,
            eventKind: eventsOut[k].kind,
            note: eventsOut[k].note
          });
        }
      }
    }
    return { recorded: recorded, marks: marks, route: route };
  }

  function loadReplay(episodeText, arcsText, sole) {
    if (banned(episodeText) || banned(arcsText)) return refuse("banned-document");
    var rows = parseLines(episodeText);
    if (!rows) return refuse("not-episode");
    var arcs = parseArcs(arcsText);
    if (!arcs || typeof arcs !== "object" || Array.isArray(arcs)) return refuse("bad-arcs");
    if (banned(JSON.stringify(rows)) || banned(JSON.stringify(arcs))) return refuse("banned-document");
    if (!sole || !Array.isArray(sole.EPHEM_RANGE) || sole.EPHEM_RANGE.length < 2) return refuse("outside-ephemeris");

    var runId = null;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || typeof row !== "object" || Array.isArray(row)) return refuse("not-episode");
      if (row.schema !== SCHEMA || row.simulated !== true || typeof row.run_id !== "string" || !RUN_ID.test(row.run_id)) return refuse("not-episode");
      if (runId == null) runId = row.run_id;
      if (row.run_id !== runId) return refuse("not-episode");
      if (i < rows.length - 1 && (row.reward != null || row.outcome != null)) return refuse("not-episode");
    }

    var last = rows[rows.length - 1];
    var outcome = last.outcome;
    if (!outcome || outcome.status !== "arrived") return refuse("not-arrived");
    if (!rewardOk(last.reward)) return refuse("bad-reward");
    if (arcs.schema !== ARC_SCHEMA || arcs.simulated !== true || arcs.run_id !== runId || !Array.isArray(arcs.legs)) return refuse("bad-arcs");

    var obs = last.observation;
    var flown = obs && obs.flown;
    if (!Array.isArray(flown) || !flown.length) return refuse("not-episode");
    var bag = collect(rows);
    var hops = [];
    for (var h = 0; h < flown.length; h++) {
      var hop = flown[h];
      if (!hop || typeof hop.from !== "string" || typeof hop.to !== "string") return refuse("not-episode");
      var depart = jdOfMinute(hop.depart);
      var land = jdOfMinute(hop.arrive);
      if (depart == null || land == null) return refuse("not-episode");
      var arc = nearestArc(arcs.legs, hop, bag.route);
      if (!arc) return refuse("missing-recorded-arc");
      var orbit = arc.arr_jd + (depart - arc.dep_jd);
      if (!(orbit > depart)) return refuse("missing-recorded-arc");
      var points = copyPoints(arc.arc_au);
      if (!points) return refuse("missing-recorded-arc");
      hops.push({
        from: hop.from,
        to: hop.to,
        depart: depart,
        land: land,
        orbit: orbit,
        system: sharedSystem(sole, hop.from, hop.to),
        arc: {
          leg_id: arc.leg_id,
          from: arc.from,
          to: arc.to,
          dep_jd: arc.dep_jd,
          arr_jd: arc.arr_jd,
          arc_au: points
        }
      });
    }

    var end = jdOfMinute(outcome.arrive);
    if (end == null) end = hops[hops.length - 1].land;
    var range = sole.EPHEM_RANGE;
    var firstDepart = hops[0].depart;
    if (!inside(end, range)) return refuse("outside-ephemeris");
    for (var n = 0; n < hops.length; n++) {
      if (!inside(hops[n].depart, range) || !inside(hops[n].land, range)) return refuse("outside-ephemeris");
    }
    var start = Math.max(range[0], firstDepart - 1 / 24);
    if (!(end >= start)) return refuse("not-episode");

    var shipName = obs && typeof obs.ship === "string" ? obs.ship : "";
    var parShip = obs && typeof obs.par_ship === "string" ? obs.par_ship : null;
    var hailId = typeof outcome.hail_id === "string" ? outcome.hail_id : "";
    pushTimed(bag.marks, end, { tool: null, hailId: hailId, ship: shipName });
    var names = nameMap(sole);
    var beats = captionBeats(rows, hops, names);
    var schedule = buildSchedule(start, end, beats);

    var clock = {
      jd: start,
      playing: false,
      speed: 1,
      span: { start: start, end: end },
      runId: runId,
      shipName: shipName
    };
    secret.set(clock, {
      hops: hops,
      marks: bag.marks,
      recorded: bag.recorded.map(markView),
      reward: copyReward(last.reward),
      schedule: schedule,
      beats: beats,
      names: names,
      cursor: 0,
      note: typeof outcome.note === "string" ? outcome.note : "",
      parShip: parShip,
      shipName: shipName
    });
    return { ok: true, clock: clock };
  }

  function nameMap(sole) {
    var map = {};
    var places = sole && sole.PLACES || [];
    for (var i = 0; i < places.length; i++) {
      if (places[i] && places[i].id) map[places[i].id] = places[i].name || places[i].id;
    }
    return map;
  }

  function named(names, id, fallback) {
    if (fallback) return fallback;
    if (id && names && names[id]) return names[id];
    return id || "";
  }

  function lead(s) {
    var text = String(s || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function cruiseSeconds(days) {
    if (!(days > 0)) return 0;
    return Math.min(CRUISE_MAX, Math.max(CRUISE_MIN, days));
  }

  function captionBeats(rows, hops, names) {
    var beats = [];
    for (var i = 0; i < hops.length; i++) {
      beats.push({
        jd: hops[i].depart,
        caption: "Departure. " + named(names, hops[i].from) + " to " + named(names, hops[i].to) + "."
      });
    }
    for (var r = 0; r < rows.length; r++) addRowBeats(beats, rows[r], names);
    beats.sort(function (a, b) {
      if (a.jd !== b.jd) return a.jd - b.jd;
      if (a.caption < b.caption) return -1;
      if (a.caption > b.caption) return 1;
      return 0;
    });
    return beats;
  }

  function addRowBeats(beats, row, names) {
    if (!row || row.kind !== "checkpoint") return;
    var cp = row.checkpoint || {};
    var obs = row.observation || {};
    var at = jdOfMinute(cp.at);
    var place = named(names, cp.place, obs.place && obs.place.name);
    var why = lead(obs.why).replace(/\.+$/, "");
    if (at != null && place) {
      beats.push({
        jd: at,
        caption: why ? "Checkpoint. " + place + ". " + why + "." : "Checkpoint. " + place + "."
      });
    }
    var reply = jdOfMinute(obs.reply_arrives);
    var act = row.action && row.action.arguments ? row.action.arguments.action : "";
    if (reply != null && act) beats.push({ jd: reply, caption: "Decision. " + lead(act).replace(/\.+$/, "") + "." });
  }

  function buildSchedule(start, end, beats) {
    var events = [];
    for (var i = 0; i < beats.length; i++) {
      if (beats[i].jd > start && beats[i].jd < end) events.push(beats[i]);
    }
    events.push({ jd: end, caption: "Arrived." });
    events.sort(function (a, b) { return a.jd - b.jd; });
    var points = [{ t: 0, jd: start, caption: null, parts: 0 }];
    var t = 0;
    var jd = start;
    var caption = null;
    for (var n = 0; n < events.length; n++) {
      var gap = cruiseSeconds(events[n].jd - jd);
      if (gap > 0) {
        t += gap;
        points.push({ t: t, jd: events[n].jd, caption: caption, parts: 0 });
      }
      caption = events[n].caption;
      jd = events[n].jd;
      points.push({ t: t, jd: jd, caption: caption, parts: 0 });
      t += DWELL;
      points.push({ t: t, jd: jd, caption: caption, parts: 0 });
    }
    for (var p = 1; p <= 7; p++) {
      t += PART;
      points.push({ t: t, jd: end, caption: "Arrived.", parts: p });
    }
    return { points: points, duration: t };
  }

  function atCursor(points, cursor) {
    var i = 0;
    while (i < points.length - 1 && points[i + 1].t <= cursor) i++;
    var a = points[i];
    if (i === points.length - 1 || points[i + 1].t === a.t) return a;
    var b = points[i + 1];
    if (a.jd === b.jd) return a;
    var f = (cursor - a.t) / (b.t - a.t);
    return { t: cursor, jd: a.jd + (b.jd - a.jd) * f, caption: a.caption, parts: a.parts };
  }

  function cursorForJd(points, jd) {
    for (var i = 0; i < points.length; i++) {
      if (points[i].parts > 0) break;
      if (points[i].jd === jd && (i === 0 || points[i - 1].jd !== jd)) return points[i].t;
    }
    for (var k = 1; k < points.length; k++) {
      var a = points[k - 1];
      var b = points[k];
      if (a.parts > 0 || b.parts > 0) break;
      if (b.jd > a.jd && jd > a.jd && jd < b.jd) {
        var f = (jd - a.jd) / (b.jd - a.jd);
        return a.t + f * (b.t - a.t);
      }
    }
    return 0;
  }

  function captionsSoFar(points, cursor) {
    var out = [];
    var seen = {};
    for (var i = 0; i < points.length; i++) {
      if (points[i].t > cursor) break;
      var text = points[i].caption;
      if (!text || seen[text]) continue;
      seen[text] = true;
      out.push(text);
    }
    return out;
  }

  function rowBeats(row, names) {
    var beats = [];
    addRowBeats(beats, row, names);
    return beats;
  }

  function retarget(clock, seal, jd, playing, speed, cursor, schedule, beats) {
    if (clock.jd === jd && clock.playing === playing && clock.speed === speed && seal.cursor === cursor && !schedule) return clock;
    var next = {
      jd: jd,
      playing: playing,
      speed: speed,
      span: { start: clock.span.start, end: clock.span.end },
      runId: clock.runId,
      shipName: clock.shipName
    };
    secret.set(next, {
      hops: seal.hops,
      marks: seal.marks,
      recorded: seal.recorded,
      reward: seal.reward,
      schedule: schedule || seal.schedule,
      beats: beats || seal.beats,
      names: seal.names,
      cursor: cursor,
      note: seal.note,
      parShip: seal.parShip,
      shipName: seal.shipName
    });
    return next;
  }

  function reduce(clock, action) {
    if (!clock || typeof clock !== "object") return clock;
    var seal = secret.get(clock);
    if (!seal) return clock;
    if (!action || typeof action.type !== "string") assertNever(action);
    switch (action.type) {
      case "tick":
        if (!clock.playing || !(action.seconds > 0)) return clock;
        var cursor = Math.min(seal.schedule.duration, seal.cursor + action.seconds * clock.speed);
        if (cursor === seal.cursor) return clock;
        var here = atCursor(seal.schedule.points, cursor);
        return retarget(clock, seal, here.jd, cursor < seal.schedule.duration, clock.speed, cursor);
      case "pause":
        if (!clock.playing) return clock;
        return retarget(clock, seal, clock.jd, false, clock.speed, seal.cursor);
      case "play":
        if (seal.cursor >= seal.schedule.duration) return retarget(clock, seal, clock.span.start, true, clock.speed, 0);
        if (clock.playing) return clock;
        return retarget(clock, seal, clock.jd, true, clock.speed, seal.cursor);
      case "speed":
        if (SPEEDS.indexOf(action.speed) < 0 || action.speed === clock.speed) return clock;
        return retarget(clock, seal, clock.jd, clock.playing, action.speed, seal.cursor);
      case "scrub":
        if (!finite(action.jd)) return clock;
        var nextJd = Math.min(clock.span.end, Math.max(clock.span.start, action.jd));
        var nextCursor = cursorForJd(seal.schedule.points, nextJd);
        return retarget(clock, seal, nextJd, clock.playing, clock.speed, nextCursor);
      case "append":
        return appendRow(clock, seal, action.row);
      default:
        assertNever(action);
    }
  }

  function appendRow(clock, seal, row) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return clock;
    if (banned(JSON.stringify(row))) return clock;
    if (row.schema !== SCHEMA || row.simulated !== true || row.run_id !== clock.runId) return clock;
    var extra = rowBeats(row, seal.names).filter(function (beat) {
      if (!(beat.jd > clock.span.start && beat.jd < clock.span.end)) return false;
      for (var i = 0; i < seal.beats.length; i++) {
        if (seal.beats[i].jd === beat.jd && seal.beats[i].caption === beat.caption) return false;
      }
      return true;
    });
    if (!extra.length) return clock;
    var beats = seal.beats.concat(extra);
    var schedule = buildSchedule(clock.span.start, clock.span.end, beats);
    var cursor = cursorForJd(schedule.points, clock.jd);
    return retarget(clock, seal, clock.jd, clock.playing, clock.speed, cursor, schedule, beats);
  }

  function clamp01(f) {
    if (!(f > 0)) return 0;
    if (f > 1) return 1;
    return f;
  }

  function lerp(a, b, f) {
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  function sample(points, f) {
    var n = points.length;
    var k = clamp01(f) * (n - 1);
    var j = Math.min(n - 2, Math.floor(k));
    return lerp(points[j], points[j + 1], k - j);
  }

  function poseAu(seal, jd, sole) {
    var hops = seal.hops;
    var first = hops[0];
    if (jd < first.depart) return { phase: "before", p: placeAu(sole, first.from, jd) };
    for (var i = 0; i < hops.length; i++) {
      var hop = hops[i];
      if (jd < hop.depart) return { phase: "dwell", p: placeAu(sole, hops[i - 1].to, jd) };
      if (jd <= hop.orbit) {
        var span = hop.orbit - hop.depart;
        var f = span > 0 ? (jd - hop.depart) / span : 0;
        var p = sample(hop.arc.arc_au, f);
        if (hop.system) {
          var tp = hop.arc.dep_jd + f * (hop.arc.arr_jd - hop.arc.dep_jd);
          var s0 = placeAu(sole, hop.system, tp);
          var s1 = placeAu(sole, hop.system, jd);
          p = [p[0] - s0[0] + s1[0], p[1] - s0[1] + s1[1], p[2] - s0[2] + s1[2]];
        }
        return { phase: "transfer", p: p };
      }
      if (jd < hop.land) return { phase: "hold", p: placeAu(sole, hop.to, jd) };
    }
    var last = hops[hops.length - 1];
    return { phase: "arrived", p: placeAu(sole, last.to, jd) };
  }

  function knownPhase(phase) {
    switch (phase) {
      case "before":
      case "transfer":
      case "hold":
      case "dwell":
      case "arrived":
        return phase;
      default:
        assertNever(phase);
    }
  }

  function sceneOf(hops) {
    var sys = null;
    for (var i = 0; i < hops.length; i++) {
      var s = hops[i].system;
      if (!s || (sys && sys !== s)) return { mode: "helio", primary: null };
      sys = s;
    }
    return { mode: "local", primary: sys };
  }

  function axes(v, s) {
    return [v[0] * s, v[2] * s, -v[1] * s];
  }

  function toView(au, jd, scene, sole) {
    if (scene.mode === "local") {
      var origin = placeAu(sole, scene.primary, jd);
      return axes([au[0] - origin[0], au[1] - origin[1], au[2] - origin[2]], AU_KM / 1000);
    }
    var r = Math.hypot(au[0], au[1], au[2]);
    var scale = r ? 30 / Math.sqrt(r) : 0;
    return axes(au, scale);
  }

  function trailTimes(hops) {
    var times = [];
    for (var i = 0; i < hops.length; i++) {
      var hop = hops[i];
      var n = hop.arc.arc_au.length;
      var span = hop.orbit - hop.depart;
      for (var k = 0; k < n; k++) {
        var f = n === 1 ? 0 : k / (n - 1);
        times.push({ t: hop.depart + f * span, hold: false });
      }
      var hold = hop.land - hop.orbit;
      if (hold > 0) {
        var step = Math.max(hold / 32, 1 / 1440);
        for (var t = hop.orbit + step; t < hop.land; t += step) times.push({ t: t, hold: true, place: hop.to });
        times.push({ t: hop.land, hold: true, place: hop.to });
      }
    }
    return times;
  }

  function bodiesOf(scene, jd, sole) {
    var places = sole.PLACES || [];
    var list = [];
    if (scene.mode === "helio") {
      list.push({ id: "sun", name: "Sun", kind: "sun", real: true, position: [0, 0, 0], radius: 0 });
    }
    for (var i = 0; i < places.length; i++) {
      var p = places[i];
      if (p.id === "sun") continue;
      var keep = scene.mode === "helio"
        || p.id === scene.primary
        || (systemOf(sole, p.id) === scene.primary && (p.kind === "station" || p.kind === "moon"));
      if (!keep) continue;
      var au = placeAu(sole, p.id, jd);
      list.push({
        id: p.id,
        name: p.name,
        kind: p.kind,
        real: !!p.real,
        position: toView(au, jd, scene, sole),
        radius: p.radius_km / 1000
      });
    }
    return list;
  }

  function toScene(pose, seal, jd, sole) {
    var scene = sceneOf(seal.hops);
    var times = trailTimes(seal.hops);
    var trail = [];
    for (var i = 0; i < times.length; i++) {
      var item = times[i];
      var au = item.hold ? placeAu(sole, item.place, item.t) : poseAu(seal, item.t, sole).p;
      trail.push(toView(au, item.t, scene, sole));
    }
    return {
      mode: scene.mode,
      primary: scene.primary,
      ship: toView(pose.p, jd, scene, sole),
      trail: trail,
      bodies: bodiesOf(scene, jd, sole)
    };
  }

  function scoreView(seal, count) {
    if (!(count > 0)) return null;
    var reward = seal.reward;
    var n = Math.min(count, reward.parts.length);
    var done = n >= reward.parts.length;
    return {
      total: done ? reward.total : null,
      outOf: reward.out_of,
      parts: reward.parts.slice(0, n).map(function (p) {
        return { key: p.key, label: p.label, got: p.got, max: p.max, note: p.note };
      }),
      measures: done ? reward.measures.map(function (m) {
        return { key: m.key, value: m.value, unit: m.unit };
      }) : [],
      parShip: seal.parShip,
      text: done ? "Score " + reward.total + " out of " + reward.out_of + "." : ""
    };
  }

  function frameAt(clock, sole) {
    if (!clock || typeof clock !== "object") return refuse("lost-clock");
    var seal = secret.get(clock);
    if (!seal) return refuse("lost-clock");
    var here = atCursor(seal.schedule.points, seal.cursor);
    var pose;
    var view;
    try {
      pose = poseAu(seal, here.jd, sole);
      view = toScene(pose, seal, here.jd, sole);
    } catch (e) {
      if (e && (e.name === "RangeError" || /ephemeris/i.test(String(e && e.message)))) return refuse("outside-ephemeris");
      throw e;
    }
    var arrived = seal.marks.filter(function (m) { return m.jd <= here.jd; })
      .sort(function (a, b) { return a.jd - b.jd; })
      .map(markView);
    var shipText = seal.shipName ? "Starseeker " + seal.shipName : "Starseeker";
    return {
      ok: true,
      minute: isoMinute(here.jd),
      phase: knownPhase(pose.phase),
      shipText: shipText,
      note: seal.note,
      caption: here.caption,
      captions: captionsSoFar(seal.schedule.points, seal.cursor),
      au: pose.p,
      view: view,
      recorded: seal.recorded,
      arrived: arrived,
      score: scoreView(seal, here.parts)
    };
  }

  return { projectArcs: projectArcs, loadReplay: loadReplay, reduce: reduce, frameAt: frameAt };
});
