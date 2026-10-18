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
  var api = { flightDirection: flightDirection, orbitDirection: orbitDirection, headingFrame: headingFrame, orientShip: orientShip,
    preciseLocalArc: preciseLocalArc, passengerList: passengerList, aboardAt: aboardAt, seatCount: seatCount, seatsHtml: seatsHtml, timingConflicts: timingConflicts };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StarfareView = api;
})(typeof window !== "undefined" ? window : globalThis);
