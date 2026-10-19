// Pure presentation of recorded flights, shared by the home map and the flight page.
// build.mjs publishes these same bytes as /assets/flight-view.js.
(function (root) {
  "use strict";
  function directionBetween(a, b) {
    var d = b.map(function (n, i) { return n - a[i]; });
    return d.every(Number.isFinite) && Math.hypot.apply(null, d) > 1e-12 ? d : null;
  }
  // A heading is local to the active flight, not the duration of a whole replay or its landing hold.
  function flightDirection(rp, jd, positionAt) {
    var s = rp.at(jd), L = s.leg, span = L.orb - L.dep;
    if (s.phase !== "flight" || L.idle || !(span > 0)) return null;
    var eps = Math.min(1e-8, span * 1e-6), lo = L.dep + eps, hi = L.orb - eps;
    var step = span / Math.max(768, ((L.arc && L.arc.arc_au || []).length - 1) * 16);
    var t = Math.max(lo, Math.min(hi, jd)), a = Math.max(lo, t - step), b = Math.min(hi, t + step);
    return b > a ? directionBetween(positionAt(a), positionAt(b)) : null;
  }
  function orbitDirection(jd, positionAt) {
    return directionBetween(positionAt(jd - 1 / 1440), positionAt(jd + 1 / 1440));
  }
  function headingFrame(direction, up, previousUp) {
    if (!direction || !direction.every(Number.isFinite)) return null;
    var n = Math.hypot.apply(null, direction); if (!(n > 1e-12)) return null;
    var f = direction.map(function (v) { return v / n; });
    function dot(a, b) { return a.reduce(function (s, v, i) { return s + v * b[i]; }, 0); }
    function project(a) { var d = dot(a, f); return a.map(function (v, i) { return v - d * f[i]; }); }
    var u = project(up || [0, 1, 0]);
    // LookAt's fixed world-up becomes singular at a vertical tangent. Carry roll through that pole.
    if (Math.hypot.apply(null, u) < 1e-5 && previousUp) u = project(previousUp);
    if (Math.hypot.apply(null, u) < 1e-5) u = project(Math.abs(f[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
    var un = Math.hypot.apply(null, u), sign = previousUp && dot(u, previousUp) < 0 ? -1 : 1;
    return { forward: f, up: u.map(function (v) { return sign * v / un; }) };
  }
  function orientShip(ship, frame) {
    if (!frame) return;
    ship.up.set(frame.up[0], frame.up[1], frame.up[2]);
    // SolArt and both fallback models point nose +Z and dorsal +Y. Object3D.lookAt uses those same axes.
    var forward = ship.up.clone().set(frame.forward[0], frame.forward[1], frame.forward[2]);
    ship.lookAt(ship.position.clone().add(forward));
    if (ship.userData) ship.userData.headingSet = true;
  }
  // Recover old local arcs only when the unchanged engine reproduces EVERY recorded waypoint at its original
  // six-decimal resolution and both exact plan times. Never substitute a different route or alter a stored run.
  function preciseLocalArc(E, arc, ship, end) {
    var A = arc && arc.arc_au;
    if (!A || A.length < 2 || !A.every(function (p) { return p.length === 3 && p.every(function (n) { return Number.isFinite(n) && +n.toFixed(6) === n; }); })) return arc;
    try {
      var b = E.R.planLeg(arc.from, arc.to, arc.dep_jd, "energy", end, ship);
      if (!b.local || b.dep_jd !== arc.dep_jd || b.arr_jd !== arc.arr_jd || b.arc_au.length !== A.length) return arc;
      if (!b.arc_au.every(function (p, i) { return p.every(function (n, k) { return +n.toFixed(6) === A[i][k]; }); })) return arc;
      return Object.assign({}, arc, { arc_au: b.arc_au });
    } catch (_) { return arc; }
  }
  function passengerList(rec, lg, hailOf) {
    var meta = rec.manifest || {}, live = rec.live;
    var flown = live ? live.flown : lg.flown || [];
    var legs = flown.concat(live ? (live.planned || []).map(function (f) { return Object.assign({}, f, { planned: true }); }) : []);
    var scores = rec.score && rec.score.bookings || [];
    var rows = meta.bookings || (lg.hails || [lg.hail]).filter(Boolean).map(function (id) {
      var h = hailOf(id) || {}, sc = scores.find(function (b) { return b.hail_id === id; });
      return { hail_id: id, rider: h.rider, party: sc ? sc.party : null, from: h.from ? h.from.id : lg.from, to: h.to ? h.to.id : lg.to };
    });
    var bookings = rows.map(function (h) {
      return { id: h.hail_id, lead: (h.rider || "").split(",")[0], party: h.party == null ? null : h.party,
        from: h.from, to: h.to, b: -1, a: -1,
        score: scores.find(function (s) { return s.hail_id === h.hail_id; }) || (rows.length === 1 ? rec.score : null) };
    });
    var stops = legs.length ? [{ at: legs[0].from, arrive: null, leave: legs[0].depart, board: [], alight: [] }] : [];
    legs.forEach(function (f, i) {
      stops.push({ at: f.to, arrive: f.open ? null : f.arrive, leave: legs[i + 1] ? legs[i + 1].depart : null,
        planned: !!f.planned, board: [], alight: [] });
    });
    var recorded = meta.stops || (rec.score && rec.score.passengers || []).map(function (s) {
      return { at: s.place.id, board: s.board, alight: s.alight };
    });
    var next = 1;
    legs.forEach(function (f, i) {
      var n = Object.hasOwn(f, "stop") ? f.stop : meta.flown_stops && i < meta.flown_stops.length ? meta.flown_stops[i] : recorded[next] && !f.open && recorded[next].at === f.to ? next : null;
      if (n == null || !recorded[n]) return;
      next = n + 1;
      ["board", "alight"].forEach(function (kind) {
        (recorded[n][kind] || []).forEach(function (id) {
          var b = bookings.find(function (x) { return x.id === id; });
          if (!b) return;
          b[kind === "board" ? "b" : "a"] = i + 1;
          stops[i + 1][kind].push(b);
        });
      });
    });
    // Old one-booking records did not store manifests. Infer only the stop order; missing cabin numbers stay unknown.
    if (!recorded.length) bookings.forEach(function (b) {
      stops.forEach(function (s, i) {
        if (!i || legs[i - 1].open) return;
        if (b.b < 0 && s.at === b.from) { b.b = i; s.board.push(b); }
        else if (b.b >= 0 && b.a < 0 && s.at === b.to) { b.a = i; s.alight.push(b); }
      });
    });
    return { stops: stops, bookings: bookings, legs: legs, seats: meta.seats ?? (rec.score && rec.score.passengers && rec.score.passengers[0] ? rec.score.passengers[0].seats : null), legacy: !rec.manifest || meta.source === "reconstructed" };
  }
  function aboardAt(P, r) { return P.bookings.filter(function (b) { return b.b >= 0 && b.b <= r && (b.a < 0 || r < b.a); }); }
  function seatCount(on) { return on.some(function (b) { return b.party == null; }) ? null : on.reduce(function (n, b) { return n + b.party; }, 0); }
  function seatsHtml(on, seats) {
    var used = seatCount(on), cells = "";
    if (seats != null) for (var i = 0; i < seats; i++) cells += '<span class="seat' + (used != null && i < used ? " on" : "") + '"></span>';
    return cells + '<span class="st">Seats in use <b>' + (used == null ? "unknown" : used) + '</b> / <b>' + (seats == null ? "not recorded" : seats) + "</b> (simulated)</span>";
  }
  function timingConflicts(rec, lg) {
    var legs = rec.live ? rec.live.flown : lg.flown || [];
    function ms(s) { return s ? Date.parse(s.replace(" ", "T") + ":00Z") : NaN; }
    return legs.flatMap(function (f, i) {
      return i && ms(f.depart) < ms(legs[i - 1].arrive) ? [i + 1] : [];
    });
  }
  // Pad weather a flight's record shows: each dust storm or Titan haze incident over its booked hours, and a live
  // checkpoint that weather holds, from its time on (when it clears is not known yet). Run seeds never reach the page,
  // so the record is all it knows of the weather. Incidents name their place; a station's weather is its body's.
  // Back-to-back holds join into one window: their times are rounded to the minute and hours to a tenth.
  var WEATHER = { dust_storm: 1, titan_haze: 1 };
  function weatherWindows(incidents, hold, places) {
    var at = {};
    places.forEach(function (p) { at[p.id] = at[p.name] = p; });
    function jd(s) { return Date.parse(s.replace(" ", "T") + ":00Z") / 864e5 + 2440587.5; }
    function on(kind, place, from, to) {
      var p = at[place];
      return WEATHER[kind] && p ? [{ kind: kind, body: p.kind === "station" ? p.parent : p.id, from: from, to: to }] : [];
    }
    var list = incidents.flatMap(function (x) { return x.hours > 0 ? on(x.kind, x.place, jd(x.at), jd(x.at) + x.hours / 24) : []; })
      .concat(hold ? on(hold.cause, hold.place, jd(hold.at), Infinity) : []);
    list.sort(function (a, b) { return a.body < b.body ? -1 : a.body > b.body ? 1 : a.from - b.from; });
    return list.reduce(function (out, w) {
      var last = out[out.length - 1];
      if (last && last.kind === w.kind && last.body === w.body && w.from <= last.to + 0.1 / 24) last.to = Math.max(last.to, w.to);
      else out.push(w);
      return out;
    }, []);
  }
  // How thick a body's weather is at jd, 0 to 1. It builds over a window's first hour (its first quarter if shorter)
  // and clears over the last.
  function weatherAt(windows, body, jd) {
    var k = 0;
    for (var i = 0; i < windows.length; i++) {
      var w = windows[i];
      if (w.body !== body || jd < w.from || jd > w.to) continue;
      var edge = Math.min(1 / 24, (w.to - w.from) / 4), x = Math.min(1, (jd - w.from) / edge, (w.to - jd) / edge);
      k = Math.max(k, x * x * (3 - 2 * x));
    }
    return k;
  }
  // A moon's or station's offset from its parent as the replay draws it. A replay squeezes years into seconds, which
  // spins the ISS hundreds of laps a second. state(jd) gives the true offset r (km) and velocity v (km/s). At every
  // key (the replay's departures, orbits, landings, hold and ends) the body is where it really was. Between two keys
  // more than one of its laps apart it turns forward at an even rate from the first key's offset to the second's,
  // under one lap, about its orbit's normal, with its distance eased between theirs. Closer keys keep the true motion.
  function slowOrbit(state, keys, jd) {
    var i = 0;
    while (i < keys.length && keys[i] <= jd) i++;
    if (!i || i === keys.length) return state(jd).r;
    var t0 = keys[i - 1], t1 = keys[i], a = state(t0);
    var n = cross(a.r, a.v), r0 = len(a.r), lap = 2 * Math.PI * r0 * r0 / len(n) / 86400;
    if (!(t1 - t0 > lap)) return state(jd).r;
    var b = state(t1).r, e0 = unit(a.r), e1 = unit(b), c = Math.max(-1, Math.min(1, dot(e0, e1)));
    var w = e1.map(function (x, k) { return x - c * e0[k]; }), turn = Math.acos(c);
    if (len(w) < 1e-9) w = unit(cross(n, e0));
    else { w = unit(w); if (dot(cross(e0, e1), n) < 0) { turn = 2 * Math.PI - turn; w = w.map(function (x) { return -x; }); } }
    var u = (jd - t0) / (t1 - t0), g = u * turn, d = r0 + (len(b) - r0) * u;
    return e0.map(function (x, k) { return d * (Math.cos(g) * x + Math.sin(g) * w[k]); });
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len(a) { return Math.hypot(a[0], a[1], a[2]); }
  function unit(a) { var n = len(a); return [a[0] / n, a[1] / n, a[2] / n]; }
  var api = { flightDirection: flightDirection, orbitDirection: orbitDirection, headingFrame: headingFrame, orientShip: orientShip,
    preciseLocalArc: preciseLocalArc, passengerList: passengerList, aboardAt: aboardAt, seatCount: seatCount, seatsHtml: seatsHtml, timingConflicts: timingConflicts,
    weatherWindows: weatherWindows, weatherAt: weatherAt, slowOrbit: slowOrbit };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StarfareView = api;
})(typeof window !== "undefined" ? window : globalThis);
