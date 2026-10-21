/* company-map.js: the company page's 3D map (three.js r128, SolArt). Presentation only: it reads the world's view
   (/world/<id>.json) and the engine (window.SOLE) and never changes a flight, a clock or a score.
   Places sit where the engine puts them at the world's sky time, in true AU (engine heliocentric J2000 ecliptic, mapped to
   three.js as (x, z, -y)). Bodies are drawn at true size or a few pixels across when that is smaller. A ship in flight is
   drawn on a straight line between the stops of its leg by sky time (illustrative), as the 2D map draws it. */
(function (root) {
  "use strict";
  var AU = 149597870.7, TAU = Math.PI * 2, FOV = 45;
  var SUN_KM = 695700;

  function jdOf(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s || "");
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 864e5 + 2440587.5 : null;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function supported() {
    if (!root.THREE || !root.SOLE || !root.SOLE.placeState || !root.SOLE.propagate) return false;
    try { var c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; }
  }

  function create(host, opt) {
    if (!supported()) return null;
    opt = opt || {};
    var THREE = root.THREE, E = root.SOLE, Art = root.SolArt || null, COL = opt.colors || {};
    var V = function (x, y, z) { return new THREE.Vector3(x || 0, y || 0, z || 0); };
    var reduced = !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
    var r;
    try { r = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true }); } catch (e) { return null; }
    r.setPixelRatio(Math.min(2, root.devicePixelRatio || 1));
    r.setClearColor(0x05090c, 1);
    if (Art) Art.init(r);
    var post = Art ? Art.composer(r, { threshold: 0.9 }) : null;
    var canvas = r.domElement;
    canvas.className = "m3-gl";
    canvas.setAttribute("role", "img");
    var labels = document.createElement("div"); labels.className = "m3-labels";
    var reset = document.createElement("button"); reset.type = "button"; reset.className = "btn small m3-reset"; reset.textContent = "Whole system";
    host.append(canvas, labels, reset);

    var scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(FOV, 1, 1e-11, 3e5), WORLD = new THREE.Group();
    scene.add(WORLD);
    if (Art) scene.add(Art.stars(1e5));
    scene.add(new THREE.AmbientLight(0xffffff, 0.16));
    WORLD.add(new THREE.PointLight(0xfff1dc, 1.45, 0));
    var SUN = Art ? Art.sun(1, 8) : new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: 0xffe2b0 }));
    WORLD.add(SUN);

    var PL = {}, KIDS = {};
    E.PLACES.forEach(function (p) { PL[p.id] = p; if (p.parent && p.parent !== "sun") (KIDS[p.parent] = KIDS[p.parent] || []).push(p.id); });
    var top = function (id) { var p = PL[id]; while (p && p.parent && p.parent !== "sun") p = PL[p.parent]; return p ? p.id : id; };

    function tex(draw) { var c = document.createElement("canvas"); c.width = c.height = 64; draw(c.getContext("2d")); return new THREE.CanvasTexture(c); }
    var DOT = tex(function (g) { var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.3, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
    var DIA = tex(function (g) { g.translate(32, 32); g.rotate(Math.PI / 4); g.fillStyle = "rgba(255,255,255,.2)"; g.fillRect(-14, -14, 28, 28); g.strokeStyle = "#fff"; g.lineWidth = 5; g.strokeRect(-14, -14, 28, 28); });
    var RING = tex(function (g) { g.strokeStyle = "#fff"; g.lineWidth = 4; g.beginPath(); g.arc(32, 32, 26, 0, TAU); g.stroke(); });
    function sprite(map, color, opacity, add) {
      return new THREE.Sprite(new THREE.SpriteMaterial({ map: map, color: color, transparent: true, opacity: opacity == null ? 1 : opacity, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending }));
    }

    // Bodies: textured spheres for planets, moons and small bodies; a diamond for a station.
    var BODIES = [], BID = {};
    E.PLACES.forEach(function (p) {
      var o, rKm = p.radius_km || 0, min = 0;
      if (rKm) {
        o = Art && Art.planet(p.id);
        if (!o) o = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshLambertMaterial({ color: 0x8b95a1 }));
        min = p.kind === "planet" ? 4 : p.kind === "moon" ? 2.5 : 1.5;
      } else o = sprite(DIA, p.real ? 0xdfe6ee : 0xffb65c);
      WORLD.add(o);
      BODIES.push(BID[p.id] = { id: p.id, p: p, obj: o, rKm: rKm, min: min });
    });

    var MEMO = {};
    function posAt(id, jd) {
      if (id === "sun" || !PL[id]) return V();
      var k = id + "|" + jd; if (MEMO[k]) return MEMO[k];
      var s = E.placeState(id, jd).r;
      return (MEMO[k] = V(s[0] / AU, s[2] / AU, -s[1] / AU));
    }
    // Orbits of the bodies that circle the Sun: the osculating two-body ellipse at the world's sky time (E.propagate over
    // E.periodDays, as the old home page drew them), so an outer planet never samples past the engine's ephemeris table.
    var ORB = new THREE.Group(); WORLD.add(ORB);
    function buildOrbits(jd) {
      ORB.children.slice().forEach(function (o) { ORB.remove(o); o.geometry.dispose(); o.material.dispose(); });
      E.PLACES.forEach(function (p) {
        if (p.parent !== "sun" || !(p.kind === "planet" || p.kind === "small")) return;
        var st = E.placeState(p.id, jd), T = E.periodDays(st), pts = [];
        for (var i = 0; i <= 180; i++) { var q = E.propagate(st.r, st.v, (T * 86400 * i) / 180).r; pts.push(V(q[0] / AU, q[2] / AU, -q[1] / AU)); }
        ORB.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x6f8296, transparent: true, opacity: p.kind === "planet" ? 0.28 : 0.14, depthWrite: false })));
      });
    }

    // Camera: it circles a target; the world group moves by minus the target so the view stays precise up close.
    // auto: until the player moves the view, it keeps the whole system in frame as the view resizes and ships move.
    var C = { target: V(), dist: 20, az: 0.6, el: 0.75, goal: null, auto: true };
    var W = 1, H = 1, JD = null, orbJd = null, view = null, SHIPS = {}, used = {};
    var camPos = V(), tmp = V(), CR = V(), CU = V();
    function pxAt(v) { return tmp.copy(v).sub(C.target).distanceTo(camPos) * 2 * Math.tan((FOV * Math.PI) / 360) / H; }
    function sepPx(id) { var p = PL[id]; return p && p.parent !== "sun" ? posAt(id, JD).distanceTo(posAt(p.parent, JD)) / pxAt(posAt(id, JD)) : 1e9; }
    // How far out the whole-system view reaches: Saturn (Titan Dock is the farthest berth), or farther when a ship is there.
    function systemRadius() {
      var r = 0, want = { mercury: 1, venus: 1, earth: 1, mars: 1, jupiter: 1, saturn: 1 };
      Object.keys(used).forEach(function (id) { want[top(id)] = 1; });
      Object.keys(want).forEach(function (id) { if (PL[id]) r = Math.max(r, posAt(id, JD).length()); });
      return r || 10;
    }
    function goTo(id) {
      var b = BID[id], v = id === "sun" ? V() : posAt(id, JD), d;
      if (id === "sun") d = 3;
      else if (b.p.parent === "sun") {
        // Close enough to see the planet's moons and stations that ships use, or the planet itself.
        var kids = (KIDS[id] || []).filter(function (k) { return used[k]; }).map(function (k) { return posAt(k, JD).distanceTo(v); });
        d = Math.max(b.rKm ? (60 * b.rKm) / AU : 1e-4, (kids.length ? Math.max.apply(null, kids) : 0) * 4.5);
      } else d = Math.max(b.rKm ? (30 * b.rKm) / AU : 2e-5, posAt(id, JD).distanceTo(posAt(b.p.parent, JD)) * 0.8);
      tween(v, d);
    }
    // The whole-system distance: the system's radius fits the narrower side of the view, with a margin.
    function fitDist() { return (systemRadius() * 1.12) / (Math.tan((FOV * Math.PI) / 360) * Math.min(1, W / H)); }
    function whole() { tween(V(), fitDist()); if (C.goal) C.goal.whole = true; else C.auto = true; }
    function tween(target, dist) {
      if (reduced) { C.target.copy(target); C.dist = dist; C.goal = null; C.auto = false; kick(); return; }
      C.goal = { t0: performance.now(), from: C.target.clone(), to: target.clone(), d0: C.dist, d1: dist }; C.auto = false;
      kick();
    }
    reset.addEventListener("click", whole);

    // Pointer: drag turns the view, the wheel or a pinch zooms, a tap on a name goes there.
    var P = {};
    canvas.style.touchAction = "pan-y"; // a finger dragging up or down still scrolls the page on a phone
    canvas.addEventListener("pointerdown", function (e) { canvas.setPointerCapture(e.pointerId); P[e.pointerId] = [e.clientX, e.clientY]; C.goal = null; C.auto = false; });
    canvas.addEventListener("pointermove", function (e) {
      var q = P[e.pointerId]; if (!q) return;
      var ids = Object.keys(P);
      if (ids.length === 2) {
        var o = P[ids[0] === String(e.pointerId) ? ids[1] : ids[0]], d0 = Math.hypot(q[0] - o[0], q[1] - o[1]), d1 = Math.hypot(e.clientX - o[0], e.clientY - o[1]);
        if (d0 > 0 && d1 > 0) zoom(d0 / d1);
      } else {
        C.az -= (e.clientX - q[0]) * 0.006;
        C.el = clamp(C.el + (e.clientY - q[1]) * 0.006, -1.45, 1.45);
      }
      P[e.pointerId] = [e.clientX, e.clientY]; kick();
    });
    var up = function (e) { delete P[e.pointerId]; };
    canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", function (e) { e.preventDefault(); C.goal = null; C.auto = false; zoom(Math.exp(e.deltaY * 0.0015)); }, { passive: false });
    function zoom(k) { C.dist = clamp(C.dist * k, 1.2e-5, 120); kick(); }

    // Labels: ships first, then planets, then the places in use. A label goes where it overlaps no other, or is left out.
    var LBL = [];
    function label(text, cls, pri, pos, click) {
      var el = document.createElement("button");
      el.type = "button"; el.className = "m3-l " + (cls || ""); el.textContent = text; el.hidden = true;
      el.addEventListener("click", click);
      labels.appendChild(el);
      var L = { el: el, pri: pri, pos: pos, w: 0, h: 0 };
      LBL.push(L); return L;
    }
    function dropLabel(L) { var i = LBL.indexOf(L); if (i >= 0) LBL.splice(i, 1); L.el.remove(); }
    BODIES.forEach(function (b) {
      var p = b.p;
      b.lbl = label(p.name, p.parent === "sun" ? "m3-planet" : "m3-place", p.kind === "planet" ? 2 : 1, function () {
        if (p.parent !== "sun" && (!used[p.id] || sepPx(p.id) < 10)) return null;
        if (p.parent === "sun" && p.kind !== "planet" && !used[p.id]) return null;
        return posAt(p.id, JD);
      }, function () { goTo(p.id); });
    });
    label("Sun", "m3-planet", 2, function () { return V(); }, function () { goTo("sun"); });
    var V2 = V();
    function placeLabels() {
      var boxes = [], list = [];
      LBL.forEach(function (L) {
        var v = L.pos(); if (!v) { L.el.hidden = true; return; }
        V2.copy(v).add(WORLD.position).project(cam);
        if (V2.z > 1 || V2.z < -1 || Math.abs(V2.x) > 1.05 || Math.abs(V2.y) > 1.05) { L.el.hidden = true; return; }
        list.push({ L: L, x: ((V2.x + 1) * W) / 2, y: ((1 - V2.y) * H) / 2, d: V2.z });
      });
      list.sort(function (a, b) { return b.L.pri - a.L.pri || a.d - b.d; });
      list.forEach(function (o) {
        var L = o.L;
        L.el.hidden = false;
        if (!L.w) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
        var spots = [[o.x + 8, o.y - L.h / 2], [o.x - 8 - L.w, o.y - L.h / 2], [o.x - L.w / 2, o.y - 10 - L.h], [o.x - L.w / 2, o.y + 10]], at = null;
        for (var i = 0; i < spots.length && !at; i++) {
          var bx = [spots[i][0], spots[i][1], L.w, L.h];
          if (bx[0] < 2 || bx[1] < 2 || bx[0] + bx[2] > W - 2 || bx[1] + bx[3] > H - 2) continue;
          if (!boxes.some(function (q) { return bx[0] < q[0] + q[2] && q[0] < bx[0] + bx[2] && bx[1] < q[1] + q[3] && q[1] < bx[1] + bx[3]; })) at = bx;
        }
        if (!at) { L.el.hidden = true; return; }
        boxes.push(at);
        L.el.style.transform = "translate(" + Math.round(at[0]) + "px," + Math.round(at[1]) + "px)";
      });
    }

    // Ships: one model per ship, a halo and a name in its desk's colour, and a faint line along the rest of its route.
    function shipObj(sh, desk) {
      var g = Art ? Art.ship({ callsign: sh.name, car: sh.car }) : new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.6, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9aa7b8 }));
      var halo = sprite(DOT, COL[desk] || "#ffffff", 0.75, true), ring = sprite(RING, COL[desk] || "#ffffff", 0.9);
      var lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 24), 3));
      var line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: COL[desk] || "#ffffff", transparent: true, opacity: 0.55, depthWrite: false }));
      WORLD.add(g, halo, ring, line);
      var S = { car: sh.car, desk: desk, g: g, halo: halo, ring: ring, line: line, v: V(), route: null, held: false, at: null, dir: null, slot: 0 };
      S.lbl = label(sh.name, "m3-ship", 3, function () { return S.v; }, function () { tween(S.v.clone(), Math.max(Math.min(C.dist, 0.05), 4e-5)); });
      S.lbl.el.style.color = COL[desk] || "";
      return S;
    }
    function dropShip(S) {
      [S.g, S.halo, S.ring, S.line].forEach(function (o) { WORLD.remove(o); });
      S.line.geometry.dispose(); S.halo.material.dispose(); S.ring.material.dispose(); S.line.material.dispose();
      dropLabel(S.lbl);
    }
    // A place in use, and the moon or planet it circles, get their names on the map.
    function use(id) { for (var p = PL[id]; p; p = PL[p.parent]) used[p.id] = 1; }
    // Where each ship is at the world's sky time, by the same rules as the 2D map.
    function placeShips() {
      var jobs = {}, seen = {}, now = JD, stack = {};
      used = {};
      (view.jobs || []).forEach(function (j) { jobs[j.job_id] = j; });
      (view.desks || []).forEach(function (d) {
        d.ships.forEach(function (sh) {
          var S = SHIPS[sh.car];
          if (S && S.desk !== d.desk) { dropShip(S); S = null; }
          if (!S) S = SHIPS[sh.car] = shipObj(sh, d.desk);
          seen[sh.car] = 1;
          var j = sh.job && jobs[sh.job];
          S.route = null; S.held = false; S.at = null; S.dir = null;
          if (j && j.held_at) { S.at = j.held_at; S.held = true; }
          else if (j && j.legs && j.legs.length) {
            var legs = j.legs.map(function (L) { return [L.from, L.to, jdOf(L.depart), jdOf(L.arrive)]; }), k = -1;
            for (var i = 0; i < legs.length; i++) if (now < legs[i][3]) { k = i; break; }
            if (k >= 0) {
              var L = legs[k], f = now <= L[2] ? 0 : Math.min(1, (now - L[2]) / Math.max(L[3] - L[2], 1e-9)), a = posAt(L[0], now), b = posAt(L[1], now);
              S.v.copy(a).lerp(b, f);
              S.route = [S.v.clone()].concat(legs.slice(k).map(function (x) { return posAt(x[1], now); }));
              S.dir = b.clone().sub(a);
              legs.slice(k).forEach(function (x) { use(x[0]); use(x[1]); });
            }
          }
          if (!S.route) { S.at = S.at || sh.at.id; S.slot = (stack[S.at] = (stack[S.at] || 0) + 1) - 1; }
          if (S.at) use(S.at);
          if (S.lbl.el.textContent !== sh.name) { S.lbl.el.textContent = sh.name; S.lbl.w = 0; }
        });
      });
      Object.keys(SHIPS).forEach(function (id) { if (!seen[id]) { dropShip(SHIPS[id]); delete SHIPS[id]; } });
    }

    function frame() {
      // Camera tween, then the camera's place round the target.
      if (C.goal) {
        var k = clamp((performance.now() - C.goal.t0) / 900, 0, 1), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        C.target.copy(C.goal.from).lerp(C.goal.to, e);
        C.dist = Math.exp(Math.log(C.goal.d0) + (Math.log(C.goal.d1) - Math.log(C.goal.d0)) * e);
        if (k >= 1) { C.auto = !!C.goal.whole; C.goal = null; }
      }
      if (C.auto) { C.target.set(0, 0, 0); C.dist = fitDist(); }
      camPos.set(Math.cos(C.el) * Math.sin(C.az), Math.sin(C.el), Math.cos(C.el) * Math.cos(C.az)).multiplyScalar(C.dist);
      cam.position.copy(camPos); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
      CR.setFromMatrixColumn(cam.matrixWorld, 0); CU.setFromMatrixColumn(cam.matrixWorld, 1);
      WORLD.position.copy(C.target).negate();
      if (Art) Art.setSun(WORLD.position);
      var q = Art ? Art.quality() : { maps: "mobile" }, secs = reduced ? 0 : performance.now() / 1000, V0 = V();
      SUN.scale.setScalar(Math.max(SUN_KM / AU, pxAt(V0) * 6));
      if (Art && Art.updateSun) Art.updateSun(SUN, { elapsedSeconds: secs, camera: cam, radiusPx: SUN.scale.x / pxAt(V0), quality: q.maps, flare: 0 });
      ORB.visible = C.dist > 0.03; // up close a 180-point orbit line misses its planet by thousands of km
      BODIES.forEach(function (b) {
        var v = posAt(b.id, JD), px = pxAt(v);
        b.obj.position.copy(v);
        b.obj.visible = b.p.parent === "sun" || sepPx(b.id) > (b.rKm ? 4 : 8);
        if (!b.obj.visible) return;
        if (!b.rKm) { b.obj.scale.setScalar(px * 9); b.obj.material.opacity = used[b.id] ? 1 : 0.55; return; }
        b.obj.scale.setScalar(Math.max(b.rKm / AU, px * b.min));
        if (Art && Art.updatePlanet) Art.updatePlanet(b.obj, { elapsedSeconds: secs, camera: cam, radiusPx: b.obj.scale.x / px, quality: q.maps, veil: 0, storm: 0 });
      });
      Object.keys(SHIPS).forEach(function (id) {
        var S = SHIPS[id];
        if (S.at) {
          // Parked or held: beside its place, fanned out on screen so ships at one dock don't stack. A moon or station drawn
          // inside its planet's disc: the ship waits by the planet.
          var b = BID[S.at];
          if (b && !b.obj.visible) b = BID[b.p.parent];
          var c = b ? b.obj.position : posAt(S.at, JD), pc = pxAt(c), lift = b ? (b.rKm ? b.obj.scale.x : 6 * pc) : 0;
          var a = 0.6 + 1.3 * S.slot, dd = lift + (14 + 6 * S.slot) * pc;
          S.v.copy(c).addScaledVector(CR, Math.cos(a) * dd).addScaledVector(CU, Math.sin(a) * dd);
        }
        var px = pxAt(S.v);
        S.g.position.copy(S.v); S.g.scale.setScalar(px * 20);
        S.g.updateMatrixWorld();
        if (S.dir && S.dir.lengthSq() > 0) S.g.lookAt(tmp.copy(S.v).add(S.dir).add(WORLD.position));
        else S.g.lookAt(tmp.copy(S.v).add(CR).add(WORLD.position));
        S.halo.position.copy(S.v); S.halo.scale.setScalar(px * 18);
        S.ring.visible = S.held; S.ring.position.copy(S.v); S.ring.scale.setScalar(px * 22);
        S.line.visible = !!S.route;
        if (S.route) {
          // One buffer per ship, rewritten in place (a new attribute each frame would leak GPU buffers).
          var pa = S.line.geometry.attributes.position, n = Math.min(S.route.length, pa.count);
          for (var i = 0; i < n; i++) pa.setXYZ(i, S.route[i].x, S.route[i].y, S.route[i].z);
          pa.needsUpdate = true; S.line.geometry.setDrawRange(0, n); S.line.geometry.computeBoundingSphere();
        }
      });
      placeLabels();
      if (post) post.render(scene, cam); else r.render(scene, cam);
    }

    var raf = 0, last = 0, onScreen = true, dirty = true;
    function kick() { dirty = true; start(); }
    function loop(t) {
      raf = 0;
      if (document.hidden || !onScreen) return;
      var fps = Art ? Art.quality().fps : 30, moving = C.goal || Object.keys(P).length;
      if (moving || dirty || (!reduced && t - last >= 1000 / fps)) {
        last = t; dirty = false; MEMO = {};
        try { frame(); } catch (e) { if (!loop.err) { loop.err = 1; console.error(e); } }
      }
      raf = requestAnimationFrame(loop);
    }
    function start() { if (!raf && !document.hidden && onScreen && view) raf = requestAnimationFrame(loop); }
    function resize() {
      W = host.clientWidth || 1; H = host.clientHeight || 1;
      r.setSize(W, H); if (post) post.setSize(W, H);
      cam.aspect = W / H; cam.updateProjectionMatrix();
      LBL.forEach(function (L) { L.w = 0; });
      kick();
    }
    var ro = root.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(host); else root.addEventListener("resize", resize);
    var io = root.IntersectionObserver ? new IntersectionObserver(function (es) { onScreen = es[es.length - 1].isIntersecting; start(); }) : null;
    if (io) io.observe(host);
    document.addEventListener("visibilitychange", start);
    root.addEventListener("solart-texture-ready", kick);

    return {
      update: function (v) {
        view = v;
        var jd = jdOf(v.map && v.map.sky) || jdOf(v.clock && v.clock.sky_now);
        if (jd !== JD) {
          JD = jd; MEMO = {};
          if (orbJd == null || Math.abs(jd - orbJd) > 30) { buildOrbits(jd); orbJd = jd; }
        }
        placeShips();
        canvas.setAttribute("aria-label", "3D map of the solar system at " + (v.clock && v.clock.sky_now) + " with your ships coloured by desk. The Desks and ships table lists the same ships.");
        kick();
      },
    };
  }

  root.StarfareCompanyMap = { create: create, jdOf: jdOf };
})(window);
