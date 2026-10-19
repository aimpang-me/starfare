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
  var AHEAD = 0.4, GAP_IN = 2, GAP_OUT = 10, RESAMPLE_DAYS = 5, DASH_PX = 12, MARKER_PX = 9;
  // The line budget by zoom: each kind of line fades in over a range of one measure of the view. The distance grid
  // fades out as the camera closes on one system (camera distance in map units; the map shows one system from 35 in).
  // A moon ring fades in as it opens out round its planet (ring radius in CSS px). A flight that is not selected
  // draws only a trail TRAIL_PX long behind its ship.
  var BUDGET = { grid: [35, 60], moonRing: [12, 40] }, TRAIL_PX = 80;

  // u is the share of one revolution back from the body to a point on its orbit: 0 just behind, 1 just ahead.
  function trail(u, ahead) { return 1 + (ahead - 1) * u; }
  function phase(p, body, n) {
    var cx = p.y * body.z - p.z * body.y, cy = p.z * body.x - p.x * body.z, cz = p.x * body.y - p.y * body.x;
    var a = Math.atan2(cx * n.x + cy * n.y + cz * n.z, p.x * body.x + p.y * body.y + p.z * body.z) / TAU;
    return a - Math.floor(a);
  }
  function smooth(e0, e1, x) { var t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
  function budget(kind, x) { return smooth(BUDGET[kind][0], BUDGET[kind][1], x); }
  // Line alpha at d CSS px from a body drawn disc CSS px in radius.
  function gap(d, disc) { return smooth(disc + GAP_IN, disc + GAP_OUT, d); }
  // The orbit plane's normal, pointing along the motion (Newell's method over the polyline round its centre).
  function normal(points) {
    var x = 0, y = 0, z = 0;
    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1], b = points[i];
      x += a.y * b.z - a.z * b.y; y += a.z * b.x - a.x * b.z; z += a.x * b.y - a.y * b.x;
    }
    var l = Math.hypot(x, y, z) || 1;
    return { x: x / l, y: y / l, z: z / l };
  }
  // A ring sampled at one epoch stays on its body for RESAMPLE_DAYS sky days either way.
  function stale(epoch, jd) { return epoch == null || Math.abs(jd - epoch) > RESAMPLE_DAYS; }
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

  var SHARED = null;
  function shared() { return SHARED || (SHARED = { res: { value: new THREE.Vector2(1, 1) }, dpr: { value: 1 }, dash: { value: new THREE.Vector2(1, 0) } }); }
  function resize(renderer) { var U = shared(); renderer.getDrawingBufferSize(U.res.value); U.dpr.value = renderer.getPixelRatio(); }
  function zoom(pxw) { var d = dash(pxw); shared().dash.value.set(d.period, d.t); }

  // ROUTE adds per point (f, s, d): the share of the leg flown, sky time and distance along the leg. The leg's end
  // corrections e0 and e1 are blended by f, as the map blends them for the ship, so the line meets the ship.
  var VERT = '#include <common>\n#include <logdepthbuf_pars_vertex>\n' +
    'attribute vec3 a;attribute vec3 b;uniform vec2 res;uniform float dpr;uniform float hw;uniform vec3 gapC;' +
    'varying vec3 vP;varying float vSide;varying vec2 vGap;\n' +
    '#ifdef ROUTE\nattribute vec3 ra;attribute vec3 rb;uniform vec3 e0;uniform vec3 e1;varying float vS;varying float vD;\n#endif\n' +
    'void main(){vec3 pa=a,pb=b;\n' +
    '#ifdef ROUTE\npa+=mix(e0,e1,ra.x);pb+=mix(e0,e1,rb.x);vec3 r=position.y<.5?ra:rb;vS=r.y;vD=r.z;\n#endif\n' +
    'vec4 ca=projectionMatrix*modelViewMatrix*vec4(pa,1.),cb=projectionMatrix*modelViewMatrix*vec4(pb,1.);' +
    'vec2 d=(cb.xy/cb.w-ca.xy/ca.w)*res;float l=length(d);vec2 nr=l>1e-6?vec2(-d.y,d.x)/l:vec2(0.,1.);' +
    'vec4 c=position.y<.5?ca:cb;c.xy+=nr*position.x*hw*dpr*2./res*c.w;gl_Position=c;' +
    'vP=position.y<.5?a:b;vSide=position.x;vec4 g=projectionMatrix*viewMatrix*vec4(gapC,1.);vGap=(g.xy/g.w*.5+.5)*res;\n' +
    '#include <logdepthbuf_vertex>\n}';
  // A route is solid at flown opacity up to now (sky time) and dashed at opacity after it. A trail fades out over tail.y
  // (world units) behind the ship, which is tail.x along this leg.
  var FRAG = '#include <common>\n#include <logdepthbuf_pars_fragment>\n' +
    'uniform vec3 color;uniform float opacity;uniform float dpr;uniform float hw;uniform float feather;uniform float ahead;' +
    'uniform vec3 nrm;uniform vec3 body;uniform vec2 gapR;varying vec3 vP;varying float vSide;varying vec2 vGap;\n' +
    '#ifdef ROUTE\nuniform float now;uniform float flown;uniform vec2 dash;uniform vec2 tail;varying float vS;varying float vD;\n' +
    'float dashOn(float x){x=fract(x);return smoothstep(0.,.06,x)*(1.-smoothstep(.5,.56,x));}\n#endif\n' +
    'void main(){\n#include <logdepthbuf_fragment>\n' +
    'float al=opacity;\n#ifdef ROUTE\nal=vS<=now?flown:al*mix(dashOn(vD/dash.x),dashOn(.5*vD/dash.x),dash.y);' +
    'if(tail.y>0.)al*=1.-smoothstep(0.,tail.y,tail.x-vD);\n#endif\n' +
    'float e=clamp((1.-abs(vSide))*hw/feather,0.,1.);al*=e*e*(3.-2.*e);' +
    'if(ahead<1.){float u=atan(dot(cross(vP,body),nrm),dot(vP,body))/6.2831853;al*=1.+(ahead-1.)*(u-floor(u));}' +
    'al*=smoothstep(gapR.x,gapR.y,length(gl_FragCoord.xy-vGap)/dpr);if(al<.002)discard;gl_FragColor=vec4(color,al);}';

  function material(o, route) {
    var U = shared(), feather = o.feather == null ? 1 : o.feather, u = {
      res: U.res, dpr: U.dpr, color: { value: new THREE.Color(o.color) }, opacity: { value: o.opacity == null ? 1 : o.opacity },
      hw: { value: (o.width || 1) / 2 + feather }, feather: { value: feather }, ahead: { value: o.ahead == null ? 1 : o.ahead },
      nrm: { value: new THREE.Vector3(0, 1, 0) }, body: { value: new THREE.Vector3(1, 0, 0) },
      gapC: { value: new THREE.Vector3() }, gapR: { value: new THREE.Vector2(-2, -1) }
    };
    if (route) { u.e0 = { value: new THREE.Vector3() }; u.e1 = { value: new THREE.Vector3() }; u.now = { value: -1 }; u.flown = { value: 1 }; u.dash = U.dash; u.tail = { value: new THREE.Vector2() }; }
    return new THREE.ShaderMaterial({
      uniforms: u, defines: route ? { ROUTE: 1 } : {},
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
  }
  function quads(route, o) {
    var g = new THREE.InstancedBufferGeometry();
    g.setIndex([0, 1, 2, 2, 1, 3]);
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    var mesh = new THREE.Mesh(g, material(o, route)); mesh.frustumCulled = false;
    return mesh;
  }
  // o: color, opacity, width and feather in CSS px, ahead (trail fade; 1 for none).
  function line(points, o) {
    var mesh = quads(false, o || {});
    setPoints(mesh, points);
    return mesh;
  }
  function setPoints(mesh, points) {
    var g = mesh.geometry, n = Math.max(0, points.length - 1), ib = g.userData.ib;
    if (!ib || ib.count !== n) {
      ib = g.userData.ib = new THREE.InstancedInterleavedBuffer(new Float32Array(n * 6), 6);
      g.setAttribute('a', new THREE.InterleavedBufferAttribute(ib, 3, 0));
      g.setAttribute('b', new THREE.InterleavedBufferAttribute(ib, 3, 3));
    }
    for (var i = 0, f = ib.array; i < n; i++) {
      var p = points[i], q = points[i + 1];
      f[i * 6] = p.x; f[i * 6 + 1] = p.y; f[i * 6 + 2] = p.z; f[i * 6 + 3] = q.x; f[i * 6 + 4] = q.y; f[i * 6 + 5] = q.z;
    }
    ib.needsUpdate = true;
    g.instanceCount = n;
    var N = normal(points); mesh.material.uniforms.nrm.value.set(N.x, N.y, N.z);
  }
  // A route leg from points { v, f, s }: v the leg's fixed shape, f the share of the leg flown there, s sky time.
  // Each frame the map sets e0, e1, now and flown in the uniforms, and the mesh position for a hop's planet.
  function leg(points, o) {
    var mesh = quads(true, o || {}), g = mesh.geometry, n = Math.max(0, points.length - 1);
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
  // Each frame: where the line's body is drawn (world), the line's centre (world), and the body's drawn radius in CSS px.
  function follow(mesh, world, centre, disc) {
    var u = mesh.material.uniforms;
    u.gapC.value.copy(world);
    u.body.value.copy(world).sub(centre);
    u.gapR.value.set(disc + GAP_IN, disc + GAP_OUT);
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

  return { AHEAD: AHEAD, TRAIL_PX: TRAIL_PX, trail: trail, phase: phase, gap: gap, normal: normal, stale: stale, dash: dash,
    budget: budget, along: along, tails: tails, line: line, setPoints: setPoints, leg: leg, follow: follow, marker: marker,
    resize: resize, zoom: zoom };
});
