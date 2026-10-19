/* Map lines drawn as screen-space quads: a width in CSS pixels with feathered edges, a gap around the body a line
   belongs to, and a trail fade that follows the body round its orbit every frame without rebuilding the geometry.
   Route legs are built once per plan and moved by uniforms every frame. Station markers are a dot in a thin ring.
   The pure parts run in node for tests; line(), leg(), marker() and resize() need window.THREE (r128). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SolLines = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var TAU = Math.PI * 2;
  // An orbit is at full brightness just behind its body and at AHEAD of that just in front of it.
  var AHEAD = 0.4, GAP_IN = 2, GAP_OUT = 10, DASH_PX = 12, MARKER_PX = 9, MAX_HOLES = 48;
  // The line budget by zoom: each kind of line fades in over a range of one measure of the view. The distance grid
  // fades out as the camera closes on one system (camera distance in map units; the map shows one system from 35 in).
  // A moon ring fades in as it opens out round its planet (ring radius in CSS px). A flight that is not selected
  // draws only a trail TRAIL_PX long behind its ship.
  var BUDGET = { grid: [35, 60], moonRing: [12, 40], orbit: [6, 24] }, TRAIL_PX = 80;
  // Every colour and opacity a map line takes, shared by the map and the flight page. Flights and the part of a
  // plan already flown are one blue, bookings amber, the plan still to fly a lighter amber. An orbit is warm grey
  // tinted toward its body (tint is how far), a planet's brighter than a small body's. Flight-page rings run fainter.
  var STYLE = {
    route: { color: 0x8ec5ff, width: 1.5 }, flown: { color: 0x8ec5ff, opacity: 0.22, width: 1 },
    booking: { color: 0xffb65c, width: 1.5 }, plan: { color: 0xffcf7a, opacity: 0.5, width: 1.5 },
    orbit: { color: 0xada79c, planet: 0.42, small: 0.17, tint: 0.16, tintEarth: 0.6, width: 1.25 },
    moon: { opacity: 0.27, width: 1.25 }, grid: { color: 0x5cc8ff, width: 1 },
    ring: { color: 0xffffff, orbit: 0.12, moon: 0.14, width: 1 }
  };

  // u is the share of one revolution back from the body to a point on its orbit: 0 just behind, 1 just ahead.
  function trail(u, ahead) { return 1 + (ahead - 1) * u; }
  function smooth(e0, e1, x) { var t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
  function budget(kind, x) { return smooth(BUDGET[kind][0], BUDGET[kind][1], x); }
  // Line alpha at d CSS px from a body drawn disc CSS px in radius.
  function gap(d, disc) { return smooth(disc + GAP_IN, disc + GAP_OUT, d); }
  // Dashes are fixed to distance along the route. Their period (world units) steps by octaves of zoom, and the shader
  // blends toward twice the period by t, so a zoom grows or shrinks the dashes in place instead of sliding them.
  function dash(pxw) { var x = Math.log2(DASH_PX * pxw), o = Math.floor(x); return { period: Math.pow(2, o), t: x - o }; }
  // Distance along a leg's drawn shape at sky time s, from its points' sky times ss and distances ds, held at its ends.
  function along(ss, ds, s) {
    var lo = 0, hi = ss.length - 1;
    if (s <= ss[lo]) return ds[lo];
    if (s >= ss[hi]) return ds[hi];
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (ss[mid] <= s) lo = mid; else hi = mid; }
    return ds[lo] + (ds[hi] - ds[lo]) * (s - ss[lo]) / (ss[hi] - ss[lo]);
  }
  // A trail length (world units) long behind the ship at sky time now, over a route's legs in order. Each leg is told
  // how far along the route from its own start the ship is; a length of 0 draws the legs whole.
  function tails(legs, now, length) {
    var start = 0, ship = 0;
    legs.forEach(function (m) { var t = m.userData; if (now >= t.ss[0]) ship = start + along(t.ss, t.ds, now); start += t.ds[t.ds.length - 1]; });
    start = 0;
    legs.forEach(function (m) { var t = m.userData; m.material.uniforms.tail.value.set(ship - start, length); start += t.ds[t.ds.length - 1]; });
  }

  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len(a) { return Math.hypot(a[0], a[1], a[2]); }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  // The osculating two-body orbit of a state r, v about an attractor of gravitational parameter mu (any one set of
  // units), as the shader draws it: P points to periapsis, Q is 90 degrees on along the motion, p is the semi-latus
  // rectum, e the eccentricity, a the semi-major axis and nu the true anomaly of the body. Null for an orbit that
  // is open or nearly so, which has no closed line to draw.
  function elements(r, v, mu) {
    var h = cross(r, v), hm = len(h), rm = len(r);
    if (!hm || !rm || !(mu > 0)) return null;
    var vh = cross(v, h), ev = [vh[0] / mu - r[0] / rm, vh[1] / mu - r[1] / rm, vh[2] / mu - r[2] / rm], e = len(ev);
    if (!(e < 0.98)) return null;
    var P = e > 1e-6 ? mul(ev, 1 / e) : mul(r, 1 / rm), Q = cross(mul(h, 1 / hm), P), p = hm * hm / mu;
    return { P: P, Q: Q, p: p, e: e, a: p / (1 - e * e), nu: Math.atan2(dot(r, Q), dot(r, P)) };
  }
  // The point of the orbit at true anomaly nu, relative to the attractor: what the vertex shader computes.
  function conicAt(el, nu) {
    var rad = el.p / (1 + el.e * Math.cos(nu)), c = Math.cos(nu) * rad, s = Math.sin(nu) * rad;
    return [el.P[0] * c + el.Q[0] * s, el.P[1] * c + el.Q[1] * s, el.P[2] * c + el.Q[2] * s];
  }
  // The elements of a place's orbit about its parent at jd, from SF (a page's engine facade): a planet or small body
  // about the Sun, a moon or station about its planet. k scales the engine's lengths to the page's, and map turns a
  // vector from the engine's frame into the page's.
  function osculate(SF, id, jd, k, map) {
    var P = SF.place(id), a = SF.E.placeState(id, jd), mu, r = a.r, v = a.v;
    if (P.parent === 'sun') mu = SF.E.MU_SUN;
    else {
      var b = SF.E.placeState(P.parent, jd), q = SF.place(P.parent);
      r = [r[0] - b.r[0], r[1] - b.r[1], r[2] - b.r[2]]; v = [v[0] - b.v[0], v[1] - b.v[1], v[2] - b.v[2]]; mu = q.mu;
    }
    var el = elements(r, v, mu);
    if (!el) return null;
    var f = map || function (x) { return x; };
    el.P = f(el.P); el.Q = f(el.Q); el.p *= k; el.a *= k;
    return el;
  }
  // Segment ends along one revolution back from the body, bunched toward both ends of it (just behind and just ahead of
  // the body), where a close view needs them, with the middle as dense as even spacing would make it.
  function axes(v) { return [v[0], v[2], -v[1]]; }
  function crowd(n) { var u = []; for (var k = 0; k <= n; k++) u.push((1 - Math.cos(Math.PI * k / n)) / 2); return u; }

  var SHARED = null;
  function shared() { return SHARED || (SHARED = { res: { value: new THREE.Vector2(1, 1) }, dpr: { value: 1 }, dash: { value: new THREE.Vector2(1, 0) },
    holes: { value: Array.from({ length: MAX_HOLES }, function () { return new THREE.Vector3(); }) }, nh: { value: 0 } }); }
  function resize(renderer) { var U = shared(); renderer.getDrawingBufferSize(U.res.value); U.dpr.value = renderer.getPixelRatio(); }
  function zoom(pxw) { var d = dash(pxw); shared().dash.value.set(d.period, d.t); }

  // ROUTE adds per point (f, s, d): the share of the leg flown, sky time and distance along the leg. The leg's end
  // corrections e0 and e1 are blended by f, as the map blends them for the ship, so the line meets the ship.
  // Under a perspective camera a segment end behind the near plane moves along the segment onto it (ka, kb), as the
  // flight page's chase camera passes lines that run behind it.
  var VERT = '#include <common>\n#include <logdepthbuf_pars_vertex>\n' +
    'attribute vec3 a;attribute vec3 b;uniform vec2 res;uniform float dpr;uniform float hw;uniform vec3 gapC;' +
    'varying vec3 vP;varying float vSide;varying vec2 vGap;\n' +
    '#ifdef ROUTE\nattribute vec3 ra;attribute vec3 rb;uniform vec3 e0;uniform vec3 e1;varying float vS;varying float vD;\n#endif\n' +
    '#ifdef CONIC\nattribute vec2 uu;uniform vec3 cP;uniform vec3 cQ;uniform vec2 cE;uniform float nu0;uniform float cK;uniform vec3 cA;uniform vec3 cB;varying float vU;\n' +
    'vec3 conic(float u){float dl=-6.2831853*u;\n' +
    'if(cK>0.){float nu=nu0+dl;vec3 q=cE.x/(1.+cE.y*cos(nu))*(cos(nu)*cP+sin(nu)*cQ);return q*cK/sqrt(length(q));}\n' +
    'float sh=sin(.5*dl),nu=nu0+dl,e=cE.y,r=cE.x/(1.+e*cos(nu));\n' +
    'float dr=2.*cE.x*e*sin(nu0+.5*dl)*sh/((1.+e*cos(nu))*(1.+e*cos(nu0)));\n' +
    'return (dr-2.*r*sh*sh)*cA+r*sin(dl)*cB;}\n#endif\n' +
    'void main(){vec3 pa=a,pb=b;\n' +
    '#ifdef CONIC\npa=conic(uu.x);pb=conic(uu.y);\n#endif\n' +
    '#ifdef ROUTE\npa+=mix(e0,e1,ra.x);pb+=mix(e0,e1,rb.x);\n#endif\n' +
    'vec4 va=modelViewMatrix*vec4(pa,1.),vb=modelViewMatrix*vec4(pb,1.);float ka=0.,kb=1.;' +
    'if(projectionMatrix[3][3]<.5){float n=1.01*projectionMatrix[3][2]/(projectionMatrix[2][2]-1.);' +
    'if(va.z>-n&&vb.z>-n){gl_Position=vec4(0.,0.,2.,1.);return;}' +
    'if(va.z>-n)ka=(va.z+n)/(va.z-vb.z);else if(vb.z>-n)kb=1.-(vb.z+n)/(vb.z-va.z);' +
    'vec4 v0=mix(va,vb,ka);vb=mix(va,vb,kb);va=v0;}' +
    'vec4 ca=projectionMatrix*va,cb=projectionMatrix*vb;' +
    'vec2 d=(cb.xy/cb.w-ca.xy/ca.w)*res;float l=length(d);vec2 nr=l>1e-6?vec2(-d.y,d.x)/l:vec2(0.,1.);' +
    'vec4 c=position.y<.5?ca:cb;c.xy+=nr*position.x*hw*dpr*2./res*c.w;gl_Position=c;float k=position.y<.5?ka:kb;\n' +
    '#ifdef ROUTE\nvec3 r=mix(ra,rb,k);vS=r.y;vD=r.z;\n#endif\n' +
    '#ifdef CONIC\nvU=mix(uu.x,uu.y,k);\n#endif\n' +
    'vP=mix(pa,pb,k);vSide=position.x;vec4 g=projectionMatrix*viewMatrix*vec4(gapC,1.);vGap=g.w>0.?(g.xy/g.w*.5+.5)*res:vec2(-1e5);\n' +
    '#include <logdepthbuf_vertex>\n}';
  // A route is solid at flown opacity up to now (sky time) and dashed at opacity after it. A trail fades out over tail.y
  // (world units) behind the ship, which is tail.x along this leg.
  var FRAG = '#include <common>\n#include <logdepthbuf_pars_fragment>\n' +
    'uniform vec3 color;uniform float opacity;uniform float dpr;uniform float hw;uniform float feather;uniform float ahead;' +
    'uniform vec2 gapR;varying vec3 vP;varying float vSide;varying vec2 vGap;\n' +
    '#ifdef HOLES\nuniform vec3 holes[' + MAX_HOLES + '];uniform float nh;\n#endif\n' +
    '#ifdef CONIC\nvarying float vU;\n#endif\n' +
    '#ifdef ROUTE\nuniform float now;uniform float flown;uniform vec2 dash;uniform vec2 tail;varying float vS;varying float vD;\n' +
    'float dashOn(float x){x=fract(x);return smoothstep(0.,.06,x)*(1.-smoothstep(.5,.56,x));}\n#endif\n' +
    'void main(){\n#include <logdepthbuf_fragment>\n' +
    'float al=opacity;\n#ifdef ROUTE\nal=vS<=now?flown:al*mix(dashOn(vD/dash.x),dashOn(.5*vD/dash.x),dash.y);' +
    'if(tail.y>0.)al*=1.-smoothstep(0.,tail.y,tail.x-vD);\n#endif\n' +
    'float e=clamp((1.-abs(vSide))*hw/feather,0.,1.);al*=e*e*(3.-2.*e);' +
    '\n#ifdef CONIC\nal*=1.+(ahead-1.)*vU;\n#endif\n' +
    'al*=smoothstep(gapR.x,gapR.y,length(gl_FragCoord.xy-vGap)/dpr);\n' +
    '#ifdef HOLES\nfor(int i=0;i<' + MAX_HOLES + ';i++){if(float(i)>=nh)break;vec3 h=holes[i];al*=smoothstep(h.z+' + GAP_IN.toFixed(1) + ',h.z+' + GAP_OUT.toFixed(1) + ',length(gl_FragCoord.xy-h.xy)/dpr);}\n#endif\n' +
    'if(al<.002)discard;gl_FragColor=vec4(color,al);}';

  function material(o, kind) {
    var U = shared(), feather = o.feather == null ? 1 : o.feather, u = {
      res: U.res, dpr: U.dpr, color: { value: new THREE.Color(o.color) }, opacity: { value: o.opacity == null ? 1 : o.opacity },
      hw: { value: (o.width || 1) / 2 + feather }, feather: { value: feather }, ahead: { value: o.ahead == null ? 1 : o.ahead },
      gapC: { value: new THREE.Vector3() }, gapR: { value: new THREE.Vector2(-2, -1) }
    };
    var route = kind === 'ROUTE';
    if (route) { u.e0 = { value: new THREE.Vector3() }; u.e1 = { value: new THREE.Vector3() }; u.now = { value: -1 }; u.flown = { value: 1 }; u.dash = U.dash; u.tail = { value: new THREE.Vector2() }; }
    if (kind === 'CONIC') { u.cP = { value: new THREE.Vector3(1, 0, 0) }; u.cQ = { value: new THREE.Vector3(0, 1, 0) }; u.cE = { value: new THREE.Vector2(1, 0) }; u.nu0 = { value: 0 }; u.cK = { value: o.compress || 0 }; u.cA = { value: new THREE.Vector3(1, 0, 0) }; u.cB = { value: new THREE.Vector3(0, 1, 0) }; }
    var defines = {}; if (kind) defines[kind] = 1;
    if (kind === 'CONIC' || kind === 'ROUTE') { defines.HOLES = 1; u.holes = U.holes; u.nh = U.nh; }
    return new THREE.ShaderMaterial({
      uniforms: u, defines: defines,
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
  }
  function quads(kind, o) {
    var g = new THREE.InstancedBufferGeometry();
    g.setIndex([0, 1, 2, 2, 1, 3]);
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    var mesh = new THREE.Mesh(g, material(o, kind)); mesh.frustumCulled = false;
    return mesh;
  }
  // o: color, opacity, width and feather in CSS px, ahead (trail fade; 1 for none).
  function line(points, o) {
    var mesh = quads(null, o || {});
    setPoints(mesh, points);
    return mesh;
  }
  // Several separate polylines drawn as one mesh.
  function lines(list, o) {
    var mesh = quads(null, o || {}), segs = [];
    list.forEach(function (pts) { for (var i = 1; i < pts.length; i++) segs.push(pts[i - 1], pts[i]); });
    setPoints(mesh, segs, true);
    return mesh;
  }
  // points are joined end to end, or with pairs each two are one separate segment (a then b).
  function setPoints(mesh, points, pairs) {
    var g = mesh.geometry, n = pairs ? points.length >> 1 : Math.max(0, points.length - 1), ib = g.userData.ib;
    if (!ib || ib.count !== n) {
      ib = g.userData.ib = new THREE.InstancedInterleavedBuffer(new Float32Array(n * 6), 6);
      g.setAttribute('a', new THREE.InterleavedBufferAttribute(ib, 3, 0));
      g.setAttribute('b', new THREE.InterleavedBufferAttribute(ib, 3, 3));
    }
    for (var i = 0, f = ib.array; i < n; i++) {
      var p = points[pairs ? 2 * i : i], q = points[pairs ? 2 * i + 1 : i + 1];
      f[i * 6] = p.x; f[i * 6 + 1] = p.y; f[i * 6 + 2] = p.z; f[i * 6 + 3] = q.x; f[i * 6 + 4] = q.y; f[i * 6 + 5] = q.z;
    }
    ib.needsUpdate = true;
    g.instanceCount = n;
  }
  // A route leg from points { v, f, s }: v the leg's fixed shape, f the share of the leg flown there, s sky time.
  // Each frame the map sets e0, e1, now and flown in the uniforms, and the mesh position for a hop's planet.
  function leg(points, o) {
    var mesh = quads('ROUTE', o || {}), g = mesh.geometry, n = Math.max(0, points.length - 1);
    var ib = new THREE.InstancedInterleavedBuffer(new Float32Array(n * 12), 12), f = ib.array, d = 0;
    var ss = mesh.userData.ss = [points[0].s], ds = mesh.userData.ds = [0];
    for (var i = 0; i < n; i++) {
      var p = points[i], q = points[i + 1], k = i * 12, d1 = d + p.v.distanceTo(q.v);
      f[k] = p.v.x; f[k + 1] = p.v.y; f[k + 2] = p.v.z; f[k + 3] = q.v.x; f[k + 4] = q.v.y; f[k + 5] = q.v.z;
      f[k + 6] = p.f; f[k + 7] = p.s; f[k + 8] = d; f[k + 9] = q.f; f[k + 10] = q.s; f[k + 11] = d1;
      d = d1; ss.push(q.s); ds.push(d);
    }
    g.setAttribute('a', new THREE.InterleavedBufferAttribute(ib, 3, 0));
    g.setAttribute('b', new THREE.InterleavedBufferAttribute(ib, 3, 3));
    g.setAttribute('ra', new THREE.InterleavedBufferAttribute(ib, 3, 6));
    g.setAttribute('rb', new THREE.InterleavedBufferAttribute(ib, 3, 9));
    g.instanceCount = n;
    return mesh;
  }
  // An orbit drawn as a true conic: the vertex shader evaluates the ellipse itself, so the line needs no rebuild as the
  // body moves or its elements change, and the segments crowd at the body. n segments; o as for line().
  // The mesh sits at its body: the shader gives each point as its offset from the body, which keeps its float32 error in
  // proportion to the distance from the body (the camera's own offset is subtracted in doubles by the matrices). Where o.compress
  // is K, each point is instead drawn at K/sqrt(r) of its place, the flight page's radial compression of the Sun's scene,
  // and the mesh stays at the centre.
  function conic(n, o) {
    var mesh = quads('CONIC', o || {}), g = mesh.geometry, u = crowd(n), f = new Float32Array(n * 2);
    for (var i = 0; i < n; i++) { f[i * 2] = u[i]; f[i * 2 + 1] = u[i + 1]; }
    g.setAttribute('uu', new THREE.InstancedBufferAttribute(f, 2));
    g.instanceCount = n;
    return mesh;
  }
  // el from osculate(): sets the conic's shape and where the body stands on it.
  function aim(mesh, el) {
    var u = mesh.material.uniforms;
    var c = Math.cos(el.nu), s = Math.sin(el.nu);
    u.cP.value.fromArray(el.P); u.cQ.value.fromArray(el.Q); u.cE.value.set(el.p, el.e); u.nu0.value = el.nu;
    u.cA.value.set(c * el.P[0] + s * el.Q[0], c * el.P[1] + s * el.Q[1], c * el.P[2] + s * el.Q[2]);
    u.cB.value.set(c * el.Q[0] - s * el.P[0], c * el.Q[1] - s * el.P[1], c * el.Q[2] - s * el.P[2]);
  }
  // Each frame: where the line's body is drawn (world) and the body's drawn radius in CSS px.
  function follow(mesh, world, disc) {
    var u = mesh.material.uniforms;
    u.gapC.value.copy(world);
    u.gapR.value.set(disc + GAP_IN, disc + GAP_OUT);
  }

  // Orbit and route lines fade out round every body, ship and dock on screen, whichever is in front. list is
  // [{ p, r }]: p the thing's place relative to the camera's origin (as for follow), r its drawn radius in CSS px.
  var HV = null;
  function setHoles(cam, list) {
    var U = shared(), n = 0, v = HV || (HV = new THREE.Vector3()), res = U.res.value, dpr = U.dpr.value;
    for (var i = 0; i < list.length && n < MAX_HOLES; i++) {
      var h = list[i]; v.copy(h.p).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
      if (v.z >= 1 || v.z < -1) continue;
      var mx = (h.r + GAP_OUT) * dpr * 2 / res.x, my = (h.r + GAP_OUT) * dpr * 2 / res.y;
      if (Math.abs(v.x) - 1 > mx || Math.abs(v.y) - 1 > my) continue;
      U.holes.value[n++].set((v.x * .5 + .5) * res.x, (v.y * .5 + .5) * res.y, h.r);
    }
    U.nh.value = n;
  }

  // A station: a dot in a thin ring, MARKER_PX CSS px across at every zoom, hidden behind nearer bodies.
  var DOT = null;
  function marker(color) {
    if (!DOT) {
      var c = document.createElement('canvas'), x = c.getContext('2d'), k = 64 / MARKER_PX;
      c.width = c.height = 64; x.fillStyle = x.strokeStyle = '#fff';
      x.beginPath(); x.arc(32, 32, 1.5 * k, 0, TAU); x.fill();
      x.lineWidth = k; x.beginPath(); x.arc(32, 32, 3.6 * k, 0, TAU); x.stroke();
      DOT = new THREE.CanvasTexture(c);
    }
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ color: color, size: MARKER_PX, sizeAttenuation: false, map: DOT, transparent: true, depthWrite: false }));
  }

  return { elements: elements, conicAt: conicAt, osculate: osculate, crowd: crowd, conic: conic, aim: aim, axes: axes, STYLE: STYLE, AHEAD: AHEAD, TRAIL_PX: TRAIL_PX, trail: trail, gap: gap, dash: dash,
    budget: budget, along: along, tails: tails, line: line, lines: lines, setPoints: setPoints, leg: leg, follow: follow, setHoles: setHoles, shared: shared, marker: marker,
    resize: resize, zoom: zoom };
});
