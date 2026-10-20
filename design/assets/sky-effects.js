/* sky-effects.js: what the map draws for the simulated hazards, and the main asteroid belt (three.js r128).
   Hazards come only from the engine's seeded hazard layer (SOLE.R.hazards(season)): this file never invents one.
   Pure helpers (eruptions, frontRadius, frontStrength, ramp, beltOrbits) run in Node for the tests.
   Frame: engine vectors are heliocentric J2000 ecliptic; the pages map them to three.js as (x, z, -y). Units are AU. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StarfareSkyEffects = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var AU_KM = 149597870.7, CME_KMS = 1500, TAU = Math.PI * 2;
  // The engine's fast CME, held at constant speed: about 0.87 AU a day (sol-rides.js CME_KMS).
  var AU_PER_DAY = CME_KMS * 86400 / AU_KM;
  // A front is drawn until it passes 40 AU, beyond Neptune: about 46 days.
  var FRONT_DAYS = 40 / AU_PER_DAY;

  // Eruptions at the Sun that started in [from, to), oldest first, found through the engine's public flareAt alone.
  // A storm lasts at least 4 h, so probing every 10 min of each day finds it unless it starts in a day's last 10 min,
  // when the next day's first probes still see it. cache (optional) keeps one day's answer; days are fixed per seed.
  var STEP = 1 / 144;
  function eruptionsOn(H, day, cache) {
    if (cache && cache[day]) return cache[day];
    var out = [], seen = {};
    for (var k = 0; k < 144 + 24; k++) {
      var f = H.flareAt(day + k * STEP);
      if (f && f.start >= day && f.start < day + 1 && !seen[f.start]) { seen[f.start] = 1; out.push({ start: f.start, end: f.end }); }
    }
    if (cache) cache[day] = out;
    return out;
  }
  function eruptions(H, from, to, cache) {
    var out = [];
    for (var d = Math.floor(from); d < to; d++) eruptionsOn(H, d, cache).forEach(function (e) { if (e.start >= from && e.start < to) out.push(e); });
    return out.sort(function (a, b) { return a.start - b.start; });
  }
  function frontRadius(start, jd) { return jd < start ? 0 : (jd - start) * AU_PER_DAY; }
  // The engine's storm strength falls as 1/r^2 (every storm counts inside 1 AU). Drawn at that, a front is gone
  // before Mars, so the picture follows 1/r instead: brightness is illustrative, the radius is the engine's.
  function frontStrength(r) { return r <= 0 || r > 40 ? 0 : Math.min(1, 1 / r) * Math.min(1, r / 0.05) * Math.min(1, (40 - r) / 4); }
  // 0 to 1 over a window: up over the first hour (or first quarter, if shorter), down over the last.
  function ramp(w, jd) {
    if (!w || jd < w.start || jd >= w.end) return 0;
    var e = Math.min(1 / 24, (w.end - w.start) / 4);
    return Math.max(0, Math.min(1, (jd - w.start) / e, (w.end - jd) / e));
  }

  /* ---------- the main belt ---------- */
  // Kirkwood gaps: Jupiter's 3:1, 5:2, 7:3 and 2:1 resonances leave few asteroids at these semi-major axes (AU).
  var GAPS = [2.502, 2.825, 2.958, 3.279];
  // Seeded orbits, circular-ish and low-inclination, between 2.1 and 3.3 AU. a in AU, i and phases in radians.
  // Real belt eccentricities run to about 0.3 and inclinations to about 30 degrees; these are kept small so the band reads.
  function beltOrbits(n, seed) {
    var s = seed >>> 0 || 1, out = [];
    function rnd() { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }
    while (out.length < n) {
      var a = 2.1 + rnd() * 1.2, gap = GAPS.some(function (g) { return Math.abs(a - g) < 0.025; });
      if (gap && rnd() < 0.9) continue;
      out.push({ a: a, e: rnd() * 0.12, inc: (rnd() - 0.5) * 0.25, node: rnd() * TAU, peri: rnd() * TAU, m0: rnd() * TAU });
    }
    return out;
  }
  var J2000 = 2451545.0, GAUSS = 0.01720209895; // k, rad/day: mean motion n = k / a^1.5 (a in AU, mass of an asteroid ignored)

  var LOGV = '#include <common>\n#include <logdepthbuf_pars_vertex>\n', LOGF = '#include <common>\n#include <logdepthbuf_pars_fragment>\n';
  // Kepler's equation is solved in the shader with three Newton steps (e < 0.12). t is days from J2000, kept small for float32.
  var BELT_VS = LOGV + 'attribute vec4 orbit;attribute vec2 angles;uniform float t;uniform float size;varying float vA;\n' +
    'void main(){float a=orbit.x,e=orbit.y,inc=orbit.z,node=orbit.w,peri=angles.x;' +
    'float M=angles.y+' + GAUSS.toFixed(11) + '*pow(a,-1.5)*t;float E=M;' +
    'for(int k=0;k<3;k++)E=E-(E-e*sin(E)-M)/(1.-e*cos(E));' +
    'float x=a*(cos(E)-e),y=a*sqrt(1.-e*e)*sin(E);float cw=cos(peri),sw=sin(peri),cn=cos(node),sn=sin(node),ci=cos(inc),si=sin(inc);' +
    'float px=x*cw-y*sw,py=x*sw+y*cw;' +
    'vec3 ecl=vec3(cn*px-sn*ci*py,sn*px+cn*ci*py,si*py);' +
    'vec4 mv=modelViewMatrix*vec4(ecl.x,ecl.z,-ecl.y,1.);gl_Position=projectionMatrix*mv;gl_PointSize=size;vA=1.;\n#include <logdepthbuf_vertex>\n}';
  var BELT_FS = LOGF + 'uniform vec3 color;uniform float opacity;varying float vA;\nvoid main(){\n#include <logdepthbuf_fragment>\n' +
    'vec2 c=gl_PointCoord-.5;float d=1.-smoothstep(.2,.5,length(c));gl_FragColor=vec4(color,opacity*d*vA);}';
  function belt(T, count, pixelRatio) {
    var O = beltOrbits(count, 1801), orbit = new Float32Array(count * 4), ang = new Float32Array(count * 2), pos = new Float32Array(count * 3);
    O.forEach(function (o, i) { orbit.set([o.a, o.e, o.inc, o.node], i * 4); ang.set([o.peri, o.m0], i * 2); });
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('orbit', new T.BufferAttribute(orbit, 4)); g.setAttribute('angles', new T.BufferAttribute(ang, 2));
    g.boundingSphere = new T.Sphere(new T.Vector3(), 4);
    var m = new T.Points(g, new T.ShaderMaterial({ uniforms: { t: { value: 0 }, size: { value: 1.6 * (pixelRatio || 1) }, color: { value: new T.Color(0xb8a996) }, opacity: { value: 0.4 } },
      vertexShader: BELT_VS, fragmentShader: BELT_FS, transparent: true, depthWrite: false }));
    m.frustumCulled = false; m.renderOrder = -1;
    m.userData.setJd = function (jd) { m.material.uniforms.t.value = jd - J2000; };
    return m;
  }

  /* ---------- CME fronts ---------- */
  // A thin shell, brightest at its limb where the line of sight runs along it, broken into lumps so it reads as gas.
  var FRONT_VS = LOGV + 'varying vec3 vN;varying vec3 vW;varying vec3 vP;\nvoid main(){vP=position;vN=normalize(mat3(modelMatrix)*normal);vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;' +
    'gl_Position=projectionMatrix*viewMatrix*w;\n#include <logdepthbuf_vertex>\n}';
  var FRONT_FS = LOGF + 'uniform float strength;uniform float seed;uniform vec3 color;varying vec3 vN;varying vec3 vW;varying vec3 vP;\nvoid main(){\n#include <logdepthbuf_fragment>\n' +
    'vec3 V=normalize(cameraPosition-vW);float limb=pow(1.-abs(dot(normalize(vN),V)),2.5);' +
    'float lump=.6+.4*sin(vP.x*9.+seed)*sin(vP.y*11.-seed*.7)*sin(vP.z*7.+seed*1.3);' +
    'float a=strength*(limb*.85+.06)*lump;gl_FragColor=vec4(color*a,a);}';
  function fronts(T, max) {
    var geo = new T.SphereGeometry(1, 40, 20), group = new T.Group(), pool = [];
    for (var i = 0; i < (max || 6); i++) {
      var m = new T.Mesh(geo, new T.ShaderMaterial({ uniforms: { strength: { value: 0 }, seed: { value: i * 1.7 }, color: { value: new T.Color(1, 0.72, 0.42) } },
        vertexShader: FRONT_VS, fragmentShader: FRONT_FS, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide }));
      m.visible = false; m.renderOrder = 2; group.add(m); pool.push(m);
    }
    // list: eruptions from eruptions(); shows the newest fronts still inside 40 AU, up to the pool size.
    group.userData.update = function (list, jd) {
      var live = list.filter(function (e) { return e.start <= jd && frontRadius(e.start, jd) <= 40; }).slice(-pool.length);
      pool.forEach(function (m, i) {
        var e = live[i], r = e ? frontRadius(e.start, jd) : 0;
        m.visible = !!e && r > 0; if (!m.visible) return;
        m.scale.setScalar(r); m.material.uniforms.strength.value = 0.55 * frontStrength(r); m.material.uniforms.seed.value = (e.start * 97) % 17;
      });
      return live.length;
    };
    return group;
  }

  /* ---------- markers: a full pad, a storm seen from afar ---------- */
  function ringTex(T) {
    var c = document.createElement('canvas'); c.width = c.height = 128; var g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 7; g.setLineDash([16, 10]);
    g.beginPath(); g.arc(64, 64, 52, 0, TAU); g.stroke();
    return new T.CanvasTexture(c);
  }
  // An amber dashed ring, a fixed size on screen, at a place whose berths are all taken. It turns slowly unless
  // motion is reduced. Hazard colour: the pages' --warn amber.
  function padRing(T) {
    var tex = padRing.tex || (padRing.tex = ringTex(T));
    var s = new T.Sprite(new T.SpriteMaterial({ map: tex, color: 0xffb547, transparent: true, depthWrite: false, depthTest: false, opacity: 0.85 }));
    s.renderOrder = 6; return s;
  }
  function glowTex(T) {
    var c = document.createElement('canvas'); c.width = c.height = 128; var g = c.getContext('2d');
    var gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(0.35, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new T.CanvasTexture(c);
  }
  // A soft coloured haze round a body under a simulated dust storm or haze, so it reads while the body is a few
  // pixels across; close up, the planet shader's veil takes over.
  function stormGlow(T, color) {
    var tex = stormGlow.tex || (stormGlow.tex = glowTex(T));
    var s = new T.Sprite(new T.SpriteMaterial({ map: tex, color: color, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0 }));
    s.renderOrder = 4; return s;
  }

  return { AU_PER_DAY: AU_PER_DAY, FRONT_DAYS: FRONT_DAYS, GAPS: GAPS, eruptions: eruptions, frontRadius: frontRadius, frontStrength: frontStrength,
    ramp: ramp, beltOrbits: beltOrbits, belt: belt, fronts: fronts, padRing: padRing, stormGlow: stormGlow };
});
