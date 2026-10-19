/* Map lines drawn as screen-space quads: a width in CSS pixels with feathered edges, a gap around the body a line
   belongs to, and a trail fade that follows the body round its orbit every frame without rebuilding the geometry.
   The pure parts run in node for tests; line() and resize() need window.THREE (r128). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SolLines = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var TAU = Math.PI * 2;
  // An orbit is at full brightness just behind its body and at AHEAD of that just in front of it.
  var AHEAD = 0.4, GAP_IN = 2, GAP_OUT = 10, RESAMPLE_DAYS = 5;

  // u is the share of one revolution back from the body to a point on its orbit: 0 just behind, 1 just ahead.
  function trail(u, ahead) { return 1 + (ahead - 1) * u; }
  function phase(p, body, n) {
    var cx = p.y * body.z - p.z * body.y, cy = p.z * body.x - p.x * body.z, cz = p.x * body.y - p.y * body.x;
    var a = Math.atan2(cx * n.x + cy * n.y + cz * n.z, p.x * body.x + p.y * body.y + p.z * body.z) / TAU;
    return a - Math.floor(a);
  }
  function smooth(e0, e1, x) { var t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
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

  var SHARED = null;
  function shared() { return SHARED || (SHARED = { res: { value: new THREE.Vector2(1, 1) }, dpr: { value: 1 } }); }
  function resize(renderer) { var U = shared(); renderer.getDrawingBufferSize(U.res.value); U.dpr.value = renderer.getPixelRatio(); }

  var VERT = '#include <common>\n#include <logdepthbuf_pars_vertex>\n' +
    'attribute vec3 a;attribute vec3 b;uniform vec2 res;uniform float dpr;uniform float hw;uniform vec3 gapC;' +
    'varying vec3 vP;varying float vSide;varying vec2 vGap;\n' +
    'void main(){vec4 ca=projectionMatrix*modelViewMatrix*vec4(a,1.),cb=projectionMatrix*modelViewMatrix*vec4(b,1.);' +
    'vec2 d=(cb.xy/cb.w-ca.xy/ca.w)*res;float l=length(d);vec2 nr=l>1e-6?vec2(-d.y,d.x)/l:vec2(0.,1.);' +
    'vec4 c=position.y<.5?ca:cb;c.xy+=nr*position.x*hw*dpr*2./res*c.w;gl_Position=c;' +
    'vP=position.y<.5?a:b;vSide=position.x;vec4 g=projectionMatrix*viewMatrix*vec4(gapC,1.);vGap=(g.xy/g.w*.5+.5)*res;\n' +
    '#include <logdepthbuf_vertex>\n}';
  var FRAG = '#include <common>\n#include <logdepthbuf_pars_fragment>\n' +
    'uniform vec3 color;uniform float opacity;uniform float dpr;uniform float hw;uniform float feather;uniform float ahead;' +
    'uniform vec3 nrm;uniform vec3 body;uniform vec2 gapR;varying vec3 vP;varying float vSide;varying vec2 vGap;\n' +
    'void main(){\n#include <logdepthbuf_fragment>\n' +
    'float e=clamp((1.-abs(vSide))*hw/feather,0.,1.);float al=opacity*e*e*(3.-2.*e);' +
    'if(ahead<1.){float u=atan(dot(cross(vP,body),nrm),dot(vP,body))/6.2831853;al*=1.+(ahead-1.)*(u-floor(u));}' +
    'al*=smoothstep(gapR.x,gapR.y,length(gl_FragCoord.xy-vGap)/dpr);if(al<.002)discard;gl_FragColor=vec4(color,al);}';

  // o: color, opacity, width and feather in CSS px, ahead (trail fade; 1 for none).
  function line(points, o) {
    o = o || {};
    var U = shared(), feather = o.feather == null ? 1 : o.feather;
    var m = new THREE.ShaderMaterial({
      uniforms: {
        res: U.res, dpr: U.dpr, color: { value: new THREE.Color(o.color) }, opacity: { value: o.opacity == null ? 1 : o.opacity },
        hw: { value: (o.width || 1) / 2 + feather }, feather: { value: feather }, ahead: { value: o.ahead == null ? 1 : o.ahead },
        nrm: { value: new THREE.Vector3(0, 1, 0) }, body: { value: new THREE.Vector3(1, 0, 0) },
        gapC: { value: new THREE.Vector3() }, gapR: { value: new THREE.Vector2(-2, -1) }
      },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
    var g = new THREE.InstancedBufferGeometry();
    g.setIndex([0, 1, 2, 2, 1, 3]);
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    var mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false;
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
  // Each frame: where the line's body is drawn (world), the line's centre (world), and the body's drawn radius in CSS px.
  function follow(mesh, world, centre, disc) {
    var u = mesh.material.uniforms;
    u.gapC.value.copy(world);
    u.body.value.copy(world).sub(centre);
    u.gapR.value.set(disc + GAP_IN, disc + GAP_OUT);
  }

  return { AHEAD: AHEAD, trail: trail, phase: phase, gap: gap, normal: normal, stale: stale,
    line: line, setPoints: setPoints, follow: follow, resize: resize };
});
