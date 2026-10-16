// Shared data layer for the website mockups (design/mockups/*.html). No drawing here: each mockup draws its own way.
// Everything it returns comes from the engine (window.SOLE, the same bundle the Worker serves at /engine.js) or from
// sample-data.js (rides flown by make-data.mjs through connector/src/game.js). Nothing is typed in by hand.
(function (root) {
  "use strict";
  var AU = 149597870.7, SITE = root.SITE, RIDES = root.SAMPLE_RIDES || [], SKY = SITE.sky;
  var SEASON_END = SKY.jd0 + SKY.len_days - 1;
  var E = null, R = null, PID = {};

  // The engine file sits next to the page when published ("engine.js"); opened from the repo it is two folders up.
  function loadEngine() {
    return new Promise(function (ok, bad) {
      if (root.SOLE) return ok(init(root.SOLE));
      var tries = ["engine.js", "../../world/engine/sol-page.js"];
      (function next() {
        var src = tries.shift();
        if (!src) return bad(new Error("engine not found"));
        var s = document.createElement("script");
        s.src = src;
        s.onload = function () { root.SOLE ? ok(init(root.SOLE)) : next(); };
        s.onerror = function () { s.remove(); next(); };
        document.head.appendChild(s);
      })();
    });
  }
  function init(sole) {
    E = sole; R = E.R;
    E.PLACES.forEach(function (p) { PID[p.id] = p; });
    return api;
  }

  // Sky clock: one real second is one sky day; the season loops every len_days.
  function sky(ms) {
    var e = ((ms == null ? Date.now() : ms) - SKY.t0_ms) / 1000, n = Math.floor(e / SKY.len_days);
    return { season: n + 1, jd: SKY.jd0 + (e - n * SKY.len_days), day: Math.floor(e - n * SKY.len_days) };
  }
  function iso(jd) { return new Date((jd - 2440587.5) * 864e5).toISOString().slice(0, 16).replace("T", " "); }
  function jdOf(s) { var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s || ""); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 864e5 + 2440587.5 : null; }
  function fmt(n, d) { return Number(n).toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; }); }
  function dur(days) { var h = days * 24; return h < 48 ? fmt(h, h < 10 ? 1 : 0) + " h" : days < 400 ? fmt(days, 1) + " days" : fmt(days / 365.25, 1) + " years"; }

  // Places. "system" is the planet (or the Sun's child) a place orbits; tag is what the page's chip says.
  function place(id) { return PID[id]; }
  function system(id) { var p = PID[id]; while (p && p.parent && p.parent !== "sun") p = PID[p.parent]; return p ? p.id : id; }
  function name(id) { var p = PID[id]; return id === "roadster" ? "Roadster" : p ? p.name : id; }
  function tag(id) { var p = PID[id]; return p && p.real ? "real" : "fict"; }
  function color(id) { var L = SITE.look[id] || SITE.look[system(id)]; return L ? L.color : "#a3abb6"; }
  function pos(id, jd) { if (id === "sun") return [0, 0, 0]; var r = E.placeState(id, jd).r; return [r[0] / AU, r[1] / AU, r[2] / AU]; }
  // One period of the orbit: planets as the osculating 2-body ellipse around the Sun (E.propagate, as site.html does,
  // so outer planets never step past the ephemeris), moons and stations sampled around their parent over their own
  // period (the place's period_days, else the 2-body period from the parent's GM). Points in AU.
  function orbit(id, jd, n) {
    n = n || 128;
    var p = PID[id], par = p && p.parent, pts = [], st = E.placeState(id, jd), i;
    if (!par || par === "sun") {
      var P = E.periodDays(st);
      for (i = 0; i <= n; i++) { var r = E.propagate(st.r, st.v, P * 86400 * i / n).r; pts.push([r[0] / AU, r[1] / AU, r[2] / AU]); }
      return pts;
    }
    var ps = E.placeState(par, jd), mu = PID[par] && PID[par].mu, Pm = p.period_days;
    if (!Pm && mu) {
      var rr = [st.r[0] - ps.r[0], st.r[1] - ps.r[1], st.r[2] - ps.r[2]], vv = [st.v[0] - ps.v[0], st.v[1] - ps.v[1], st.v[2] - ps.v[2]];
      var a = 1 / (2 / Math.hypot(rr[0], rr[1], rr[2]) - (vv[0] * vv[0] + vv[1] * vv[1] + vv[2] * vv[2]) / mu);
      if (a > 0) Pm = 2 * Math.PI * Math.sqrt(a * a * a / mu) / 86400;
    }
    if (!(Pm > 0)) return pts;
    var t0 = jd + Pm > E.EPHEM_RANGE[1] ? jd - Pm : jd;
    for (i = 0; i <= n; i++) {
      var t = t0 + Pm * i / n, A = pos(id, t), B = pos(par, t);
      pts.push([A[0] - B[0], A[1] - B[1], A[2] - B[2]]);
    }
    return pts;
  }

  // The request desk: the open hails with the times a take_hail made now would get (game.js newRun).
  function desk(ms) {
    var s = sky(ms);
    return SITE.hails.map(function (h) {
      var b = R.BY[h.hail_id], t0 = Math.floor(s.jd + (b.kind === "quick" ? 1 : R.LEAD)) + 0.5;
      return { id: h.hail_id, title: h.title, kind: h.kind, rider: h.rider, blurb: h.blurb, from: b.from, to: b.to,
        ready_jd: t0, open: t0 + 30 <= SEASON_END, season: s.season };
    });
  }
  // What an agent would see for one hail, computed by the engine now: the par plan, its arcs and the nearby cars.
  // Long hauls take a second or two (R.terms flies the par plan with this season's hazards), so callers should
  // show a "planning" state first. Cached per hail and ready time.
  var PLANS = {};
  function plan(hailId, ms) {
    var d = desk(ms).filter(function (x) { return x.id === hailId; })[0], key = hailId + "@" + d.ready_jd + "@" + d.season;
    if (PLANS[key]) return PLANS[key];
    if (!d.open) return (PLANS[key] = { hail: d, closed: "The season ends before this ride could finish. It opens again after the reset (season " + (d.season + 1) + ")." });
    var seed = String(d.season), T, fs = {};
    try { T = R.terms(hailId, d.ready_jd, SEASON_END, seed); } catch (e) { return (PLANS[key] = { hail: d, closed: "No car can serve this hail before the season ends." }); }
    R.fleetState(hailId, d.ready_jd, seed).forEach(function (c) { fs[c.car] = c.busy_until_jd; });
    var legs = T.par.legs.map(function (L) {
      var b = R.planLeg(L.from, L.to, L.dep_jd, "energy", SEASON_END);
      return { from: L.from, to: L.to, dep_jd: L.dep_jd, arr_jd: L.arr_jd, kwh: L.kwh, fare: L.fare, local: !!b.local, arc: b.arc_au || [] };
    });
    var cars = R.nearCars(R.BY[hailId]).map(function (c) {
      var free = fs[c.id] ? Math.max(fs[c.id], d.ready_jd) : d.ready_jd, leg = null;
      try { var p = R.planLeg(c.at, R.BY[hailId].from, free, "energy", SEASON_END); leg = { dep_jd: p.dep_jd, arr_jd: p.arr_jd, kwh: p.battery.energy_kwh, fare: p.fare.total_usd, local: !!p.local }; } catch (e) { leg = null; }
      return { car: c.id, name: c.name, at: c.at, busy_until_jd: fs[c.id] || null, pickup: leg, par: c.id === T.par.car };
    });
    return (PLANS[key] = { hail: d, arrive_by_jd: T.arrive_by_jd, par: { car: T.par.car, kwh: T.par.kwh, arr_jd: T.par.arr_jd, legs: legs }, cars: cars });
  }

  // Ride replay from a stored ride: where the car is at any sky time. Each flown leg follows its planned arc
  // (heliocentric AU), stretched to the flown departure and arrival. For a hop inside one planet's system the arc is
  // carried along with that planet, so a late departure still starts and ends at the right moon or station.
  function replay(ride) {
    var log = ride.record.log, arcs = Object.keys(ride.arcs).map(function (k) { return ride.arcs[k]; });
    var legs = log.flown.map(function (f) {
      var a = arcs.filter(function (x) { return x.from === f.from && x.to === f.to; })[0];
      return { kind: f.leg, from: f.from, to: f.to, dep: jdOf(f.depart), arr: jdOf(f.arrive), kwh: f.kwh, gate: f.gate, arc: a,
        sys: system(f.from) === system(f.to) ? system(f.from) : null };
    });
    var start = legs[0].dep - 0.25 * (legs[legs.length - 1].arr - legs[0].dep) / Math.max(1, legs.length), end = legs[legs.length - 1].arr;
    start = Math.min(start, legs[0].dep - 1 / 24);
    function ends(L) { // the arc's start and end offsets from the real places at the flown departure and arrival
      if (L.err) return L.err;
      var A = L.arc.arc_au, a0 = A[0], a1 = A[A.length - 1];
      if (L.sys) { var d0 = sub(pos(L.sys, L.dep), pos(L.sys, L.arc.dep_jd)), d1 = sub(pos(L.sys, L.arr), pos(L.sys, L.arc.arr_jd)); a0 = add(a0, d0); a1 = add(a1, d1); }
      return (L.err = [sub(pos(L.from, L.dep), a0), sub(pos(L.to, L.arr), a1)]);
    }
    function at(jd) {
      for (var i = 0; i < legs.length; i++) {
        var L = legs[i];
        if (jd < L.dep) return { p: pos(L.from, jd), leg: L, i: i, f: 0, phase: i ? "dwell" : "parked" };
        if (jd <= L.arr) {
          var f = (jd - L.dep) / Math.max(1e-9, L.arr - L.dep);
          if (!L.arc || !L.arc.arc_au || !L.arc.arc_au.length) { var a0 = pos(L.from, L.dep), a1 = pos(L.to, L.arr); return { p: lerp(a0, a1, f), leg: L, i: i, f: f, phase: "flight" }; }
          var A = L.arc.arc_au, k = f * (A.length - 1), j = Math.min(A.length - 2, Math.floor(k)), p = lerp(A[j], A[j + 1], k - j);
          if (L.sys) { var tp = L.arc.dep_jd + f * (L.arc.arr_jd - L.arc.dep_jd), s0 = pos(L.sys, tp), s1 = pos(L.sys, jd); p = [p[0] - s0[0] + s1[0], p[1] - s0[1] + s1[1], p[2] - s0[2] + s1[2]]; }
          // Blend out the end errors so the car leaves exactly from, and lands exactly on, the place at the flown times.
          var e0 = ends(L), w0 = 1 - f;
          p = [p[0] + w0 * e0[0][0] + f * e0[1][0], p[1] + w0 * e0[0][1] + f * e0[1][1], p[2] + w0 * e0[0][2] + f * e0[1][2]];
          return { p: p, leg: L, i: i, f: f, phase: "flight" };
        }
      }
      var last = legs[legs.length - 1];
      return { p: pos(last.to, jd), leg: last, i: legs.length - 1, f: 1, phase: "arrived" };
    }
    var ev = [];
    legs.forEach(function (L) {
      ev.push({ jd: L.dep, kind: "depart", title: (L.kind === "pickup" ? "Pickup leg departs " : "Ride departs ") + name(L.from), text: name(L.from) + " to " + name(L.to) });
      ev.push({ jd: L.arr, kind: "arrive", title: (L.kind === "pickup" ? "Rider aboard at " : "Arrived at ") + name(L.to), text: L.gate === "PASS" ? "Re-fly check: PASS" : "Local hop (not re-flown)" });
    });
    (log.checkpoints || []).forEach(function (c) {
      ev.push({ jd: jdOf(c.at), kind: "checkpoint", title: "Checkpoint " + c.n + ": " + c.kind.replace("_", " ") + " at " + name(c.place),
        text: "Cause: " + c.cause.replace("_", " ") + ". Agent chose: " + c.decision.action + ". Best in hindsight: " + c.best + ".", cp: c });
    });
    ride.record.score.incidents.forEach(function (x) {
      ev.push({ jd: jdOf(x.at), kind: "incident", title: x.kind.replace("_", " ") + " at " + x.place, text: x.note + (x.hours ? " (" + fmt(x.hours, 1) + " h" : "") + (x.kwh ? (x.hours ? ", " : " (") + fmt(x.kwh) + " kWh)" : x.hours ? ")" : "") });
    });
    ev.sort(function (a, b) { return a.jd - b.jd; });
    var focus = legs.every(function (L) { return L.sys; }) && legs.every(function (L) { return L.sys === legs[0].sys; }) ? legs[0].sys : "sun";
    return { legs: legs, start: start, end: end, at: at, events: ev, focus: focus, record: ride.record, label: ride.label, pub: ride.legs };
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function lerp(a, b, f) { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }

  var api = {
    AU: AU, SITE: SITE, RIDES: RIDES, SKY: SKY, SEASON_END: SEASON_END,
    loadEngine: loadEngine, sky: sky, iso: iso, jdOf: jdOf, fmt: fmt, esc: esc, dur: dur,
    place: place, system: system, name: name, tag: tag, color: color, pos: pos, orbit: orbit,
    desk: desk, plan: plan, replay: replay, lerp: lerp,
    get E() { return E; }, get R() { return R; },
    PLANETS: ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"],
    // The generic coupe from world/template.html (Open Sky). Not a real car. Side view, nose to the right.
    CAR_SVG: '<svg viewBox="0 0 160 84" aria-hidden="true"><defs><linearGradient id="cb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a5466"/><stop offset=".45" stop-color="#1a202b"/><stop offset="1" stop-color="#07090d"/></linearGradient><linearGradient id="cw" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0b0f16"/><stop offset=".6" stop-color="#22324a"/><stop offset="1" stop-color="#0b0f16"/></linearGradient><radialGradient id="cf" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="rgba(156,195,255,.28)"/><stop offset="1" stop-color="rgba(156,195,255,0)"/></radialGradient><radialGradient id="ch" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="rgba(220,235,255,.95)"/><stop offset="1" stop-color="rgba(220,235,255,0)"/></radialGradient></defs><ellipse cx="82" cy="70" rx="74" ry="7" fill="url(#cf)"/><path d="M10 58c0-6 5-9 14-11l26-13c10-5 22-7 36-7h14c16 0 27 5 38 12l9 5c6 2 9 6 9 11v3H10z" fill="url(#cb)" stroke="rgba(255,255,255,.18)" stroke-width=".8"/><path d="M58 35c9-4 19-5 30-5h12c11 0 19 3 27 9H62z" fill="url(#cw)"/><path d="M24 47c22-3 60-5 122-1" fill="none" stroke="rgba(255,255,255,.28)" stroke-width=".8"/><circle cx="40" cy="61" r="11" fill="#06080b" stroke="#2c333e" stroke-width="2"/><circle cx="40" cy="61" r="5.5" fill="none" stroke="#7d8794" stroke-width="1.2"/><circle cx="128" cy="61" r="11" fill="#06080b" stroke="#2c333e" stroke-width="2"/><circle cx="128" cy="61" r="5.5" fill="none" stroke="#7d8794" stroke-width="1.2"/><ellipse cx="150" cy="50" rx="16" ry="6" fill="url(#ch)" opacity=".55"/><path d="M142 48.5l10 1.2" stroke="#eaf3ff" stroke-width="2.2" stroke-linecap="round"/><path d="M12 52.5h5" stroke="#ff6b6b" stroke-width="2" stroke-linecap="round" opacity=".8"/></svg>',
    // The Starseeker: an original short-hop passenger ship (lifting body, window band, swept stub wings, one aft thruster).
    // Not modelled on any real or game vehicle. SHIP_SVG is a side view, SHIP_TOP_SVG a top view; both nose to the right.
    SHIP_SVG: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80" aria-hidden="true"><defs><linearGradient id="ssh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a6578"/><stop offset=".5" stop-color="#1c2230"/><stop offset="1" stop-color="#07090d"/></linearGradient><linearGradient id="ssg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffb65c" stop-opacity="0"/><stop offset="1" stop-color="#ffcf7a"/></linearGradient><linearGradient id="ssw" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0b0f16"/><stop offset="1" stop-color="#2a4266"/></linearGradient></defs><ellipse cx="8" cy="47" rx="14" ry="4" fill="url(#ssg)"/><path d="M70 54 L44 70 L100 61 Z" fill="#141a24" stroke="rgba(255,255,255,.18)"/><path d="M32 33 L22 13 L50 27 Z" fill="#1c2230" stroke="rgba(255,255,255,.2)"/><path d="M18 40 C30 30 52 24 84 23 C120 22 160 30 190 45 C170 52 140 57 100 58 L40 58 C28 57 20 50 18 40 Z" fill="url(#ssh)" stroke="rgba(255,255,255,.28)"/><path d="M72 31 C102 27 140 29 168 39 C140 36 104 35 76 37 Z" fill="url(#ssw)"/><g fill="#9cc3ff" opacity=".75"><rect x="86" y="31.5" width="7" height="2.4" rx="1"/><rect x="98" y="31" width="7" height="2.4" rx="1"/><rect x="110" y="31" width="7" height="2.4" rx="1"/><rect x="122" y="31.5" width="7" height="2.4" rx="1"/><rect x="134" y="32.5" width="7" height="2.4" rx="1"/></g><path d="M40 50 C90 53 140 51 182 45" fill="none" stroke="#9cc3ff" stroke-width="1.2" opacity=".7"/><ellipse cx="24" cy="47" rx="9" ry="6.5" fill="#10141c" stroke="rgba(255,255,255,.25)"/><ellipse cx="17" cy="47" rx="2.6" ry="4.6" fill="#ffcf7a"/></svg>',
    SHIP_TOP_SVG: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" aria-hidden="true"><path d="M116 40 C100 34 80 30 56 28 L30 10 L22 12 L34 30 C24 32 14 35 10 40 C14 45 24 48 34 50 L22 68 L30 70 L56 52 C80 50 100 46 116 40 Z" fill="#1c2230" stroke="rgba(255,255,255,.35)"/><ellipse cx="80" cy="40" rx="17" ry="4" fill="#2a4266"/><path d="M30 40 L106 40" stroke="#9cc3ff" stroke-width="1" opacity=".6"/><rect x="5" y="34" width="6" height="4" rx="2" fill="#ffcf7a"/><rect x="5" y="42" width="6" height="4" rx="2" fill="#ffcf7a"/></svg>',
    // Display word for the vehicle. Tool fields and run-log JSON keep "car" (car, par_car); pages show "Starseeker".
    SHIP: "Starseeker", SHIPS: "Starseekers",
    MCP_URL: "https://starfare.aimpang.workers.dev/mcp",
    SCORE_PARTS: [["pickup", "Fast pickup", 20], ["on_time", "Arrived on time", 20], ["energy", "Energy vs par", 20], ["promise", "Kept the promise", 15], ["checker", "Every leg checked", 10], ["fare", "Honest fare", 10], ["economy", "Planning economy", 5]],
  };
  root.SF = api;
})(typeof window !== "undefined" ? window : globalThis);
