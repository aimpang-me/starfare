/* sol-art.js: shared art for the Starfare mockups (three.js r128).
   Textured planets with a fresnel atmosphere rim, the Yale Bright Star Catalog starfield, the bloom/vignette/grain
   composer, the procedural Starseeker, the ship, station and dock models and the HUD icon sprite. Sources and licences: CREDITS.md next to this file.
   Frame: engine vectors are heliocentric J2000 ecliptic; the pages map them to three.js as (x, z, -y). */
(function (root) {
  "use strict";
  var THREE = root.THREE;
  var me = document.currentScript && document.currentScript.src;
  var BASE = me ? me.replace(/[^\/]*$/, "") : "assets/";

  var R = null, ANISO = 1, TEX = {}, SUN = { value: null };
  function init(renderer) {
    R = renderer;
    try { ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy()); } catch (e) { ANISO = 1; }
  }
  var loader = THREE ? new THREE.TextureLoader() : null;
  function tex(file) {
    if (TEX[file]) return TEX[file];
    function ready() { root.dispatchEvent(new CustomEvent("solart-texture-ready")); }
    var t = loader.load(BASE + "tex/" + file, ready, undefined, function () { t.userData = t.userData || {}; t.userData.failed = true; ready(); });
    t.anisotropy = ANISO;
    return (TEX[file] = t);
  }
  // A failed map stays cached, so a missing file (a 4K release asset not installed) is requested once, not every zoom.
  function release(file) { var t = TEX[file]; if (t && !(t.userData && t.userData.failed)) { delete TEX[file]; t.dispose(); } }
  // Map tiers are chosen in device pixels; the pages measure bodies in CSS pixels.
  function devicePixels(context) { context.pixelRatio = R ? R.getPixelRatio() : 1; return context; }
  function setSun(v) { SUN.value.copy(v); }

  // Each custom shader carries the log-depth chunks: the pages render with logarithmicDepthBuffer on.
  var VS_HEAD = "#include <common>\n#include <logdepthbuf_pars_vertex>\n";
  var FS_HEAD = "#include <common>\n#include <logdepthbuf_pars_fragment>\n";
  var VS_WORLD = VS_HEAD +
    "varying vec3 vN; varying vec3 vW; varying vec2 vUv;\n" +
    "void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;\n" +
    " gl_Position = projectionMatrix * viewMatrix * w;\n#include <logdepthbuf_vertex>\n}";

  /* ---------- planets ---------- */
  var MAPS = {
    earth: "earth_day_2k.jpg", moon: "moon_1k.jpg", mars: "mars_1k.jpg", phobos: "phobos_1k.jpg",
    jupiter: "jupiter_2k.jpg", saturn: "saturn_1k.jpg", titan: "titan_1k.jpg",
    mercury: "mercury_1k.jpg", venus: "venus_1k.jpg", uranus: "uranus_1k.jpg", neptune: "neptune_1k.jpg",
    ceres: "ceres_1k.jpg", bennu: "bennu_1k.jpg", io: "io_1k.jpg", europa: "europa_1k.jpg", ganymede: "ganymede_1k.jpg",
    callisto: "callisto_1k.jpg", enceladus: "enceladus_1k.jpg", triton: "triton_1k.jpg"
  };
  // Atmosphere rims: colour, front-rim strength, halo shell size and strength.
  var RIMS = {
    earth: { c: [0.36, 0.62, 1.0], f: 0.9, h: 1.09, hs: 0.85 },
    mars: { c: [1.0, 0.58, 0.38], f: 0.45, h: 1.05, hs: 0.35 },
    titan: { c: [1.0, 0.66, 0.28], f: 1.0, h: 1.14, hs: 0.9 }
  };
  var GEO = {};
  function sphere() { return GEO.s || (GEO.s = new THREE.SphereGeometry(1, 64, 32)); }

  function earthMat() {
    return new THREE.ShaderMaterial({
      uniforms: { day: { value: tex("earth_day_2k.jpg") }, night: { value: tex("earth_lights_2k.jpg") }, uSun: SUN },
      vertexShader: VS_WORLD,
      fragmentShader: FS_HEAD +
        "uniform sampler2D day; uniform sampler2D night; uniform vec3 uSun; varying vec3 vN; varying vec3 vW; varying vec2 vUv;\n" +
        "void main(){\n#include <logdepthbuf_fragment>\n" +
        " vec3 N = normalize(vN), L = normalize(uSun - vW), V = normalize(cameraPosition - vW); float d = dot(N, L);\n" +
        " vec3 dc = texture2D(day, vUv).rgb, nc = texture2D(night, vUv).rgb;\n" +
        " vec3 col = dc * (0.035 + 0.9 * max(d, 0.0));\n" +
        " col += nc * vec3(1.0, 0.82, 0.55) * 2.4 * (1.0 - smoothstep(-0.18, 0.08, d));\n" +
        " vec3 H = normalize(L + V); col += vec3(0.55, 0.65, 0.75) * pow(max(dot(N, H), 0.0), 60.0) * 0.35 * step(dc.b, dc.r + 0.08) * step(0.0, d) * (1.0 - step(dc.g, dc.b));\n" +
        " gl_FragColor = vec4(col, 1.0); }"
    });
  }
  function rimFront(rc) {
    return new THREE.ShaderMaterial({
      uniforms: { uSun: SUN, c: { value: new THREE.Vector3(rc.c[0], rc.c[1], rc.c[2]) }, k: { value: rc.f } },
      vertexShader: VS_WORLD,
      fragmentShader: FS_HEAD +
        "uniform vec3 uSun; uniform vec3 c; uniform float k; varying vec3 vN; varying vec3 vW;\n" +
        "void main(){\n#include <logdepthbuf_fragment>\n" +
        " vec3 N = normalize(vN), V = normalize(cameraPosition - vW), L = normalize(uSun - vW);\n" +
        " float f = pow(1.0 - max(dot(N, V), 0.0), 3.0), lit = 0.12 + 0.88 * smoothstep(-0.35, 0.45, dot(N, L));\n" +
        " gl_FragColor = vec4(c * f * lit * k, 1.0); }",
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    });
  }
  function rimHalo(rc) {
    return new THREE.ShaderMaterial({
      uniforms: { uSun: SUN, c: { value: new THREE.Vector3(rc.c[0], rc.c[1], rc.c[2]) }, k: { value: rc.hs } },
      vertexShader: VS_WORLD,
      fragmentShader: FS_HEAD +
        "uniform vec3 uSun; uniform vec3 c; uniform float k; varying vec3 vN; varying vec3 vW;\n" +
        "void main(){\n#include <logdepthbuf_fragment>\n" +
        " vec3 N = normalize(vN), V = normalize(cameraPosition - vW), L = normalize(uSun - vW);\n" +
        " float f = pow(clamp(-dot(N, V) * 2.4, 0.0, 1.0), 2.2), lit = 0.08 + 0.92 * smoothstep(-0.4, 0.5, dot(N, L));\n" +
        " gl_FragColor = vec4(c * f * lit * k, 1.0); }",
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    });
  }
  function ringMesh() {
    // Saturn's rings, C ring to A ring (about 1.24 to 2.27 planet radii), mapped radially from the alpha strip.
    var IN = 1.24, OUT = 2.27, g = new THREE.RingGeometry(IN, OUT, 128, 1), p = g.attributes.position, uv = g.attributes.uv;
    for (var i = 0; i < p.count; i++) { var r = Math.hypot(p.getX(i), p.getY(i)); uv.setXY(i, (r - IN) / (OUT - IN), 0.5); }
    var m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex("saturn_ring_1k.webp"), color: 0xd8d0c0, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2 + 0.47;
    return m;
  }
  // A unit-radius textured body, or null when there is no map for it (the page then draws its own).
  function planet(id) {
    if (!MAPS[id]) return null;
    if (root.StarfarePlanetEffects) {
      var enhanced = root.StarfarePlanetEffects.createBody(THREE, id, { texture: tex, release: release, sun: SUN, maxTextures: R && R.capabilities.maxTextures });
      if (enhanced) return enhanced;
    }
    var mat = id === "earth" ? earthMat() : new THREE.MeshLambertMaterial({ map: tex(MAPS[id]) });
    var m = new THREE.Mesh(sphere(), mat);
    var rc = RIMS[id];
    if (rc) {
      var f = new THREE.Mesh(sphere(), rimFront(rc)); f.scale.setScalar(1.012); m.add(f);
      var h = new THREE.Mesh(sphere(), rimHalo(rc)); h.scale.setScalar(rc.h); m.add(h);
    }
    if (id === "saturn") m.add(ringMesh());
    m.rotation.z = 0.35;
    m.userData.textured = true;
    return m;
  }

  /* ---------- the Sun ---------- */
  var GLOW = {};
  function glow(inner, mid, k) {
    var key = inner + mid + (k || 0.25);
    if (GLOW[key]) return GLOW[key];
    var c = document.createElement("canvas"); c.width = c.height = 128; var g = c.getContext("2d");
    var gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, inner); gr.addColorStop(k || 0.25, mid); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return (GLOW[key] = new THREE.CanvasTexture(c));
  }
  // A small light seen through a lens: a hot centre with a 1/(1 + (r/r0)^2) falloff, not a flat disc. The stops
  // crowd toward the centre, where the falloff is steepest.
  function pointGlow() {
    if (GLOW.point) return GLOW.point;
    var c = document.createElement("canvas"); c.width = c.height = 128; var g = c.getContext("2d");
    var gr = g.createRadialGradient(64, 64, 0, 64, 64, 64), floor = 1 / 401;
    for (var i = 0; i <= 16; i++) { var r = i * i / 256; gr.addColorStop(r, "rgba(255,255,255," + ((1 / (1 + 400 * r * r) - floor) / (1 - floor)).toFixed(4) + ")"); }
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return (GLOW.point = new THREE.CanvasTexture(c));
  }
  function additiveSprite(map, color) {
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: map, color: color || 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  }
  function sun(r, wide) {
    var g = new THREE.Group();
    var ball = root.StarfarePlanetEffects ? root.StarfarePlanetEffects.createSun(THREE, { texture: tex, release: release }) : new THREE.Mesh(sphere(), new THREE.MeshBasicMaterial({ map: tex("sun_1k.jpg"), color: new THREE.Color(1.6, 1.35, 1.05) }));
    ball.scale.setScalar(r); g.add(ball);
    g.userData.solarSurface = ball;
    var s1 = additiveSprite(glow("rgba(255,240,210,1)", "rgba(255,180,92,.5)", 0.22)); s1.scale.setScalar(r * 4.4); g.add(s1);
    var s2 = additiveSprite(glow("rgba(255,190,110,.32)", "rgba(255,140,60,.07)")); s2.scale.setScalar(r * (wide || 14)); g.add(s2);
    return g;
  }

  /* ---------- the Yale Bright Star Catalog ---------- */
  var STARS = null, STARQ = [];
  function loadStars() {
    if (STARS || loadStars.busy) return;
    loadStars.busy = true;
    fetch(BASE + "stars-bsc5.json").then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (j) {
      STARS = j; STARQ.splice(0).forEach(function (f) { f(); });
    }).catch(function (e) { console.warn("sol-art: no star catalog", e); });
  }
  // B-V to temperature (Ballesteros 2012), then temperature to RGB (Tanner Helland's fit), softened toward white.
  function bvRGB(bv) {
    var T = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62)), t = T / 100, r, g, b;
    r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332);
    g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * Math.pow(t - 60, -0.0755);
    b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
    function c(x) { return 0.35 + 0.65 * Math.min(1, Math.max(0, x / 255)); }
    return [c(r), c(g), c(b)];
  }
  function fillStars(pts, radius) {
    var s = STARS.s, n = s.length / 4, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), mag = new Float32Array(n);
    var e = 23.4392911 * Math.PI / 180, ce = Math.cos(e), se = Math.sin(e), D = Math.PI / 180;
    for (var i = 0; i < n; i++) {
      var ra = s[i * 4] * D, de = s[i * 4 + 1] * D, cd = Math.cos(de);
      var x = cd * Math.cos(ra), y = cd * Math.sin(ra), z = Math.sin(de);
      var yE = ce * y + se * z, zE = -se * y + ce * z; // equatorial to ecliptic
      pos[i * 3] = x * radius; pos[i * 3 + 1] = zE * radius; pos[i * 3 + 2] = -yE * radius; // the pages' (x, z, -y)
      var rgb = bvRGB(s[i * 4 + 3]); col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2];
      mag[i] = s[i * 4 + 2];
    }
    var g = pts.geometry;
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("mag", new THREE.BufferAttribute(mag, 1));
    g.computeBoundingSphere();
  }
  function stars(radius, opt) {
    opt = opt || {};
    var mat = new THREE.ShaderMaterial({
      uniforms: { pr: { value: R ? R.getPixelRatio() : 1 }, skyBackdrop: { value: opt.backdrop ? 1 : 0 }, skyAspect: { value: 1 } },
      vertexShader: VS_HEAD +
        "attribute float mag; attribute vec3 color; uniform float pr; uniform float skyBackdrop; uniform float skyAspect; varying vec3 vC; varying float vA;\n" +
        "void main(){ vC = color; float m = 6.6 - mag;\n" +
        " gl_PointSize = clamp(0.9 + 0.62 * m, 0.9, 6.5) * pr; vA = clamp(0.22 + 0.13 * m, 0.22, 1.0);\n" +
        " gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n" +
        // A distant sky uses angular perspective even behind an orthographic map.
        // Ignore camera translation/strategic zoom; clip the rear hemisphere normally.
        " if(skyBackdrop > 0.5){ vec3 d = mat3(viewMatrix) * position; float w = -d.z; gl_Position = vec4(d.x / (0.41421356237 * skyAspect), d.y / 0.41421356237, w * 0.99999, w); }\n#include <logdepthbuf_vertex>\n}",
      fragmentShader: FS_HEAD +
        "varying vec3 vC; varying float vA;\n" +
        "void main(){\n#include <logdepthbuf_fragment>\n" +
        " float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); a *= a;\n" +
        " float core = smoothstep(0.35, 0.0, d);\n" +
        " gl_FragColor = vec4(mix(vC, vec3(1.0), core * 0.6) * vA * (a + core * 0.5), 1.0); }",
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    });
    var pts = new THREE.Points(new THREE.BufferGeometry(), mat);
    pts.frustumCulled = false;
    if (STARS) fillStars(pts, radius); else { STARQ.push(function () { fillStars(pts, radius); }); loadStars(); }
    return pts;
  }

  /* ---------- post: bloom, then vignette and grain ---------- */
  var VIG = {
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.045 }, uVig: { value: 0.55 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader:
      "uniform sampler2D tDiffuse; uniform float uTime; uniform float uGrain; uniform float uVig; varying vec2 vUv;\n" +
      "float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }\n" +
      "void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 q = vUv - 0.5;\n" +
      " float v = 1.0 - uVig * smoothstep(0.3, 0.85, length(q * vec2(1.15, 1.0)));\n" +
      " float n = h(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5;\n" +
      " gl_FragColor = vec4(c.rgb * v + n * uGrain, c.a); }"
  };
  // A composer for one renderer: bloom always (threshold-based, so only the Sun, nav lights and lit markers pass),
  // plus an optional vignette and grain pass. Without the example scripts it falls back to a plain render.
  function composer(renderer, opt) {
    opt = opt || {};
    var ok = THREE.EffectComposer && THREE.RenderPass && THREE.UnrealBloomPass && THREE.ShaderPass;
    var api = { bloom: !!ok, post: null, render: function (scene, cam) { pace(); renderer.render(scene, cam); }, setSize: function () {}, tick: function () {} };
    if (!ok) return api;
    var size = renderer.getSize(new THREE.Vector2()), pr = renderer.getPixelRatio(), rt;
    var w = Math.max(1, size.x * pr), h = Math.max(1, size.y * pr);
    if (renderer.capabilities.isWebGL2 && THREE.WebGLMultisampleRenderTarget) rt = new THREE.WebGLMultisampleRenderTarget(w, h, { format: THREE.RGBAFormat });
    var C = new THREE.EffectComposer(renderer, rt);
    var rp = new THREE.RenderPass(null, null); C.addPass(rp);
    var bp = new THREE.UnrealBloomPass(new THREE.Vector2(w, h), opt.strength || 0.9, opt.radius || 0.45, opt.threshold || 0.86);
    C.addPass(bp);
    var vp = null;
    if (opt.vignette || opt.grain) {
      vp = new THREE.ShaderPass(VIG);
      vp.uniforms.uGrain.value = opt.grain ? 0.045 : 0;
      vp.uniforms.uVig.value = opt.vignette ? 0.55 : 0;
      C.addPass(vp);
    }
    api.post = vp; api.pass = bp; api.composer = C;
    api.render = function (scene, cam) {
      pace();
      if (!quality().bloom) return renderer.render(scene, cam);
      rp.scene = scene; rp.camera = cam; C.render();
    };
    api.setSize = function (W, H) { C.setPixelRatio(renderer.getPixelRatio()); C.setSize(W, H); };
    // t in ms; a static grain when motion is reduced.
    api.tick = function (t, reduced) { if (vp) vp.uniforms.uTime.value = reduced ? 0.5 : (t / 1000) % 1000; };
    return api;
  }

  /* ---------- the Starseeker ---------- */
  /* An original short-hop passenger ship in the Starseeker look of the page SVGs: a flattened lifting-body hull,
     a blue lit window band, swept wings with a little dihedral, one dorsal fin and a single aft nozzle. Built here
     from lathe and extrude geometry, flat-shaded and low-poly. Nose along +z, up +y, length 1. Port (+x) carries the
     red nav light, starboard (-x) the green. Not modelled on any real or game vehicle.
     The nozzle stays dark and the lights stay steady: runs record no burn intervals or light states
     (art/2026-10-17/motion-spec.md), so the ship shows no thrust and has nothing to animate. */
  var SHIPK = null;
  // Faces get real normals. flatShading derives them in the fragment shader from screen-space derivatives of the view
  // position, which underflow on a ship drawn at map scale and leave the whole hull black.
  function facet(g) { if (g.index) g = g.toNonIndexed(); g.computeVertexNormals(); return g; }
  function shipKit() {
    if (SHIPK) return SHIPK;
    var prof = [[0.0, 0.07], [0.04, 0.095], [0.14, 0.122], [0.34, 0.132], [0.56, 0.122], [0.74, 0.096], [0.87, 0.062], [0.95, 0.03], [1.0, 0.001]];
    var pts = [new THREE.Vector2(0.001, -0.5)];
    prof.forEach(function (p) { pts.push(new THREE.Vector2(Math.max(0.001, p[1]), p[0] - 0.5)); });
    var hull = new THREE.LatheGeometry(pts, 12); hull.rotateX(Math.PI / 2); hull.scale(1.3, 0.62, 1);
    // Swept wing, drawn in (x, z) then laid flat; mirrored for starboard.
    var w = new THREE.Shape();
    w.moveTo(0.1, 0.12); w.lineTo(0.47, -0.2); w.lineTo(0.47, -0.31); w.lineTo(0.1, -0.34); w.lineTo(0.1, 0.12);
    var wing = new THREE.ExtrudeGeometry(w, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.006, bevelSegments: 1 });
    wing.rotateX(Math.PI / 2); wing.translate(0, 0.007, 0);
    var f = new THREE.Shape();
    f.moveTo(-0.44, 0); f.lineTo(-0.2, 0); f.lineTo(-0.38, 0.17); f.lineTo(-0.47, 0.17); f.lineTo(-0.44, 0);
    var fin = new THREE.ExtrudeGeometry(f, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.004, bevelSegments: 1 });
    fin.translate(0, 0, -0.006); fin.rotateY(-Math.PI / 2); // shape x becomes z: root aft, tip swept back
    var canopy = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    // hull half-width at height y and station z, from the lathe profile
    function rAt(z) {
      var t = z + 0.5;
      for (var i = 1; i < prof.length; i++) if (t <= prof[i][0]) { var a = prof[i - 1], b = prof[i]; return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]); }
      return 0.001;
    }
    function halfW(z, y) { var r = rAt(z), k = y / (0.62 * r); return k >= 1 ? 0 : 1.3 * r * Math.sqrt(1 - k * k); }
    SHIPK = {
      halfW: halfW, hull: facet(hull), wing: facet(wing), fin: facet(fin), canopy: facet(canopy),
      nacelle: facet(new THREE.CylinderGeometry(0.078, 0.092, 0.07, 12, 1, true).rotateX(Math.PI / 2)),
      disc: new THREE.CircleGeometry(0.072, 20),
      win: new THREE.BoxGeometry(0.006, 0.02, 0.042),
      decal: new THREE.PlaneGeometry(0.22, 0.055).rotateX(-Math.PI / 2).rotateY(Math.PI), // flat, reads from behind
      hullM: new THREE.MeshStandardMaterial({ color: 0x5d6a7e, metalness: 0.35, roughness: 0.42, flatShading: false, emissive: 0x0b0f16 }),
      wingM: new THREE.MeshStandardMaterial({ color: 0x2a3344, metalness: 0.4, roughness: 0.5, flatShading: false }),
      canM: new THREE.MeshStandardMaterial({ color: 0x1a2b44, emissive: 0x9cc3ff, emissiveIntensity: 0.28, metalness: 0.6, roughness: 0.12, flatShading: false }),
      winM: new THREE.MeshBasicMaterial({ color: 0xc4dbff }),
      nacM: new THREE.MeshStandardMaterial({ color: 0x1a202c, metalness: 0.6, roughness: 0.35, flatShading: false, side: THREE.DoubleSide }),
      throatM: new THREE.MeshBasicMaterial({ color: 0x07090d }),
      stripeM: new THREE.LineBasicMaterial({ color: 0x9cc3ff, transparent: true, opacity: 0.9 }),
      navG: pointGlow()
    };
    return SHIPK;
  }
  function decalTex(text) {
    var c = document.createElement("canvas"); c.width = 512; c.height = 128;
    var t = new THREE.CanvasTexture(c); t.anisotropy = ANISO;
    function draw() {
      var g = c.getContext("2d"); g.clearRect(0, 0, 512, 128);
      g.fillStyle = "rgba(255,182,92,.9)"; g.fillRect(14, 30, 10, 68);
      g.font = "700 88px Rajdhani, 'JetBrains Mono', sans-serif"; g.textBaseline = "middle";
      g.fillStyle = "rgba(226,234,246,.92)"; g.fillText(text, 40, 68, 456);
      t.needsUpdate = true;
    }
    draw();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
    return t;
  }
  // Nav lights: red port (+x), green starboard (-x), white beacon. At the procedural wingtips and fin, or at the
  // mounts tools/models/build-lods.mjs records for a generated hull.
  var NAV = [
    { mount: "port_light", at: [0.475, -0.002, -0.27], col: 0xff5a4a, size: 0.13, opacity: 1 },
    { mount: "starboard_light", at: [-0.475, -0.002, -0.27], col: 0x55f08a, size: 0.13, opacity: 1 },
    { mount: "beacon", at: [0, 0.235, -0.44], col: 0xffffff, size: 0.11, opacity: 0.9 }
  ], STERN = [0, 0, -0.55];
  // k from 0 (off) to 1. Runs record no thrust timing, so the flight page calls this glow illustrative.
  function setEngine(g, k) {
    var e = g.userData.engine;
    e.visible = k > 0.002;
    e.children.forEach(function (s) { s.material.opacity = s.userData.o * k; });
  }
  // opt.car (an engine car id) picks the generated hull for that car's ship class; the procedural ship shows until
  // it loads, and stays when it can't. The callsign decal belongs to the procedural wing, so it goes with it.
  function ship(opt) {
    opt = opt || {};
    var K = shipKit(), g = new THREE.Group(), p = new THREE.Group(); g.add(p);
    p.add(new THREE.Mesh(K.hull, K.hullM));
    var can = new THREE.Mesh(K.canopy, K.canM); can.scale.set(0.085, 0.06, 0.2); can.position.set(0, 0.06, 0.15); p.add(can);
    [1, -1].forEach(function (s) {
      var wm = new THREE.Mesh(K.wing, K.wingM); wm.scale.x = s; wm.position.y = -0.03; wm.rotation.z = s * 0.06; p.add(wm);
      for (var i = 0; i < 5; i++) { var z = 0.12 - i * 0.06, wn = new THREE.Mesh(K.win, K.winM); wn.position.set(s * (K.halfW(z, 0.03) - 0.001), 0.03, z); p.add(wn); }
      var st = [];
      for (var j = 0; j <= 16; j++) { var zz = -0.44 + j * 0.05; st.push(new THREE.Vector3(s * (K.halfW(zz, -0.012) + 0.002), -0.012, zz)); }
      p.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(st), K.stripeM));
    });
    var fin = new THREE.Mesh(K.fin, K.wingM); fin.position.set(0, 0.06, 0); p.add(fin);
    var nac = new THREE.Mesh(K.nacelle, K.nacM); nac.position.z = -0.52; p.add(nac);
    var throat = new THREE.Mesh(K.disc, K.throatM); throat.position.z = -0.53; throat.rotation.y = Math.PI; p.add(throat);
    var lights = NAV.map(function (n) {
      var l = new THREE.Group(), halo = additiveSprite(K.navG, n.col), core = additiveSprite(K.navG, 0xffffff);
      halo.scale.setScalar(n.size * 1.6); core.scale.setScalar(n.size * 0.35);
      halo.material.opacity = core.material.opacity = n.opacity; l.add(halo, core);
      l.position.fromArray(n.at); g.add(l);
      return l;
    });
    // Ion engine glow: a blue-white core at the grid in a faint xenon-blue halo. Off until the page sets it.
    var engine = new THREE.Group();
    [[0xc8d8ff, 0.1, 0.9], [0x4f74ff, 0.45, 0.55]].forEach(function (e) {
      var s = additiveSprite(K.navG, e[0]); s.scale.setScalar(e[1]); s.userData.o = e[2]; engine.add(s);
    });
    engine.position.fromArray(STERN); engine.visible = false; g.add(engine); g.userData.engine = engine;
    if (opt.callsign) {
      var dt = decalTex(String(opt.callsign).toUpperCase());
      var dm = new THREE.MeshStandardMaterial({ map: dt, transparent: true, metalness: 0.2, roughness: 0.6, depthWrite: false });
      [1, -1].forEach(function (s) {
        var d = new THREE.Mesh(K.decal, dm); d.position.set(s * 0.27, 0.0, -0.21); d.rotation.z = s * 0.06; p.add(d); // on the wing top, with its dihedral
      });
    }
    var car = opt.car && root.SOLE && root.SOLE.R && root.SOLE.R.CAR[String(opt.car).toLowerCase()];
    if (car && THREE.GLTFLoader) {
      g.userData.hull = { cls: car.ship_class, callsign: opt.callsign || opt.car, proc: p, lights: lights, model: null, mounts: null, asked: false };
      quality(); // settle the tier first: a change prunes ships not yet added to a scene
      SHIPS.push(g); showHull(g);
    }
    return g;
  }

  /* ---------- hulls, stations and docks (models/variety.json) ---------- */
  // models/variety/ holds the Blender-scripted models (tools/models/blender/variety.py): longest side 1, up +y, ships
  // with the bow on +z, the procedural ship's frame. Their faces name a shared trim material (models/trim/, built by
  // tools/models/trims.py), so every station, dock and ship shares one small set of tiling maps and one material per
  // name. variety.json maps each engine ship class to a hull, each fictional station to its own model, and every other
  // place to a dock type. One load per model, cloned per use. The "accent" band takes a livery colour per callsign.
  var VARIETY = null, MODELS = {}, TRIMS = {}, SHIPS = [];
  var LIVERY = [0xff9e38, 0x4fb8ff, 0xe8e8e2, 0x7fd18b, 0xff6b5b, 0xc79bff, 0xffd34f];
  function variety() {
    return VARIETY || (VARIETY = fetch(BASE + "models/variety.json").then(function (r) { if (!r.ok) throw new Error("variety.json " + r.status); return r.json(); }));
  }
  function trimTex(file, colour) {
    var t = loader.load(BASE + "models/trim/" + file);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ANISO;
    // As with the planets: the pages render with no output encoding, so maps are read as stored.
    t.encoding = THREE.LinearEncoding;
    return t;
  }
  function trimMat(name) {
    if (TRIMS[name]) return TRIMS[name];
    var maps = name, orm = trimTex(maps + "_orm.jpg");
    var m = new THREE.MeshStandardMaterial({ map: trimTex(maps + "_color.jpg"), normalMap: trimTex(maps + "_normal.jpg"),
      roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1, envMapIntensity: 1 });
    m.normalScale.set(0.8, 0.8);
    if (name === "window") { m.emissiveMap = trimTex("window_emissive.jpg"); m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = 2; }
    if (name === "accent") m.color.setHex(LIVERY[0]);
    if (name === "worn") m.side = THREE.DoubleSide; // debris has open shells (a fairing half)
    if (ENV.rt) m.envMap = ENV.rt.texture;
    ENV.mats.push(m);
    return TRIMS[name] = m;
  }
  function loadModel(file) {
    return MODELS[file] || (MODELS[file] = new Promise(function (ok, bad) {
      new THREE.GLTFLoader().load(BASE + "models/" + file, function (gl) {
        gl.scene.traverse(function (o) { if (o.isMesh) o.material = trimMat(String(o.material && o.material.name || "hull").split(".")[0]); });
        ok(gl.scene);
      }, undefined, bad);
    }));
  }
  function livery(model, callsign) {
    var h = 0, s = String(callsign || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    var m = null;
    model.traverse(function (o) {
      if (!o.isMesh || o.material !== TRIMS.accent) return;
      if (!m) { m = TRIMS.accent.clone(); m.color.setHex(LIVERY[h % LIVERY.length]); ENV.mats.push(m); }
      o.material = m;
    });
  }
  function loadHull(cls) {
    return variety().then(function (f) {
      var id = f.classes[cls], h = f.models[id];
      if (!h) throw new Error("no hull for ship class " + cls);
      var k = h.display_scale || 1;
      return loadModel(h.file).then(function (scene) {
        var box = new THREE.Box3().setFromObject(scene), mounts = {};
        Object.keys(h.mounts).forEach(function (n) { mounts[n] = h.mounts[n].map(function (x) { return x * k; }); });
        return { scene: scene, k: k, mounts: mounts, stern: [0, k * (box.min.y + box.max.y) / 2, k * box.min.z - 0.01] };
      });
    });
  }
  function showHull(g) {
    var h = g.userData.hull, want = quality().hulls;
    if (want && !h.asked) {
      h.asked = true;
      loadHull(h.cls).then(function (m) { h.model = m.scene.clone(); h.model.scale.setScalar(m.k); livery(h.model, h.callsign); h.mounts = m.mounts; h.stern = m.stern; g.add(h.model); showHull(g); },
        function (e) { console.warn("SolArt: keeping the procedural ship for class " + h.cls + ":", e && e.message || e); });
    }
    var on = want && !!h.model;
    h.proc.visible = !on;
    if (h.model) h.model.visible = on;
    NAV.forEach(function (n, i) { h.lights[i].position.fromArray(on ? h.mounts[n.mount] : n.at); });
    g.userData.engine.position.fromArray(on ? h.stern : STERN);
  }

  // dock(place, [berths,] fallback): the model for a place, as a group that shows fallback (a THREE.Object3D) until it loads,
  // and keeps it when it can't. A fictional station gets its own model; every other place gets a Starfare dock parked
  // beside it, by place type (variety.json "docks"); its accent bands take a colour from the place id. setPx(px), with the drawn size on screen, picks the full model
  // over about 90 px and the light one below. The low tier keeps the light one.
  var DOCKG = [];
  function dockId(f, P) {
    if (!P) return f.docks.default;
    if (f.stations[P.id]) return f.stations[P.id];
    var d = f.docks;
    if (d.byPlace[P.id]) return d.byPlace[P.id];
    if (P.kind === "small" || (P.kind === "moon" && P.radius_km < d.smallMoonKm)) return d.small;
    return d.byKind[P.kind] || d.default;
  }
  // berths (optional): the place's engine berth count; a model's berth_N collars show up to it, as on the #22 docks.
  function dock(P, berths, fallback) {
    if (fallback === undefined && berths && berths.isObject3D) { fallback = berths; berths = null; }
    var g = new THREE.Group(), cur = null, want = "lod", lastPx = 0;
    if (fallback) g.add(fallback);
    var got = {};
    function show() {
      var m = got[want] || got.lod || got.file; if (!m || m === cur) return;
      if (cur) cur.visible = false; else if (fallback) fallback.visible = false;
      m.visible = true; cur = m;
    }
    function fetchOne(which) {
      if (got[which] !== undefined) return; got[which] = null;
      variety().then(function (f) {
        var h = f.models[dockId(f, P)];
        if (!h) throw new Error("no dock model for " + (P && P.id));
        return loadModel(h[which]);
      }).then(function (scene) {
        var m = scene.clone(); livery(m, P && P.id); m.visible = false;
        if (berths != null) m.traverse(function (n) { var b = /^berth_(\d+)$/.exec(n.name); if (b) n.visible = +b[1] <= berths; });
        g.add(m); got[which] = m; show();
      },
        function (e) { console.warn("SolArt: keeping the placeholder dock for " + (P && P.id) + ":", e && e.message || e); });
    }
    if (THREE.GLTFLoader) fetchOne("lod");
    DOCKG.push(g);
    g.userData.setPx = function (px) {
      if (px != null) lastPx = px;
      want = lastPx > 90 && quality().hulls ? "file" : "lod";
      if (want === "file") fetchOne("file");
      show();
    };
    return g;
  }

  // debris(id, px): one piece of drifting debris (variety.json "debris": stage, husk, fairing, panels, rock), the
  // light model, or the full one when it will be drawn over about 90 px. Empty until it loads. Map art only: nothing
  // here places debris or makes it a hazard; the page decides where it drifts and how it tumbles.
  function debris(id, px) {
    var g = new THREE.Group();
    if (THREE.GLTFLoader) variety().then(function (f) {
      var h = f.models[id] || f.models["debris-" + id];
      if (!h) throw new Error("no debris model " + id);
      return loadModel(px > 90 && quality().hulls ? h.file : h.lod);
    }).then(function (scene) { g.add(scene.clone()); },
      function (e) { console.warn("SolArt: no debris model:", e && e.message || e); });
    return g;
  }

  /* ---------- hull reflections ---------- */
  // The hull maps are mostly metal, and metal shows what it reflects. setSky renders a tiny sky (dark space, the Sun
  // disc, the nearest planet lit by the Sun) into one PMREM cube shared by the hull materials, never the planets.
  // It rebuilds only when the Sun or planet direction turns more than 4 degrees or the planet changes, at most four
  // times a second. The disc is drawn 3 degrees across (the real Sun is 0.53 degrees across from 1 AU) so the cube's
  // texels catch it. lit (0 to 1) dims the reflection in a planet's shadow. The low tier drops it.
  var ENV = { gen: null, rt: null, sc: null, sun: null, planet: null, light: null, sd: null, pd: null, pid: null, col: false, t: -1e9, mats: [] };
  var COS4 = Math.cos(4 * Math.PI / 180), MEAN = {};
  function turned(a, b) { return !a !== !b || (!!a && a.dot(b) < COS4); }
  // A planet's colour in the reflection: the mean of its map, once the map has loaded.
  function meanColor(id) {
    if (MEAN[id]) return MEAN[id];
    var img = MAPS[id] && tex(MAPS[id]).image;
    if (!img || !img.width) return null;
    var c = document.createElement("canvas"); c.width = c.height = 16;
    var x = c.getContext("2d"); x.drawImage(img, 0, 0, 16, 16);
    var d = x.getImageData(0, 0, 16, 16).data, s = [0, 0, 0];
    for (var i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
    return (MEAN[id] = new THREE.Color(s[0] / 65280, s[1] / 65280, s[2] / 65280));
  }
  function skyScene() {
    var sc = new THREE.Scene();
    // Dark space, a shade lighter toward one pole (an illustrative starlit glow), so polished hulls show a gradient
    // rather than flat black away from the Sun and planet.
    var g = new THREE.SphereGeometry(50, 16, 8), p = g.attributes.position, c = [], lo = new THREE.Color(0x04060a), hi = new THREE.Color(0x26303e);
    for (var i = 0; i < p.count; i++) { var k = Math.pow(0.5 + 0.5 * p.getY(i) / 50, 1.6); c.push(lo.r + (hi.r - lo.r) * k, lo.g + (hi.g - lo.g) * k, lo.b + (hi.b - lo.b) * k); }
    g.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
    sc.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    ENV.sun = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff1dc).multiplyScalar(6) }));
    ENV.planet = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshLambertMaterial({ color: 0x808080 }));
    ENV.light = new THREE.DirectionalLight(0xfff1dc, 1.6);
    sc.add(ENV.sun); sc.add(ENV.planet); sc.add(ENV.light);
    return sc;
  }
  // o.sun: unit vector from the ship toward the Sun, or none. o.planet: { id, dir (unit, toward its centre), size
  // (angular radius, radians) }, or none. o.lit: 0 in full shadow to 1 in sunlight.
  function setSky(o) {
    o = o || {};
    if (!R || !quality().hulls) return;
    var lit = o.lit == null ? 1 : o.lit, pl = o.planet || null, col = pl && meanColor(pl.id);
    ENV.mats.forEach(function (m) { m.envMapIntensity = 0.15 + 0.85 * lit; });
    var stale = !ENV.rt || ENV.pid !== (pl && pl.id) || ENV.col !== !!col || turned(ENV.sd, o.sun) || turned(ENV.pd, pl && pl.dir);
    var now = performance.now();
    if (!stale || now - ENV.t < 250) return;
    var sc = ENV.sc || (ENV.sc = skyScene());
    ENV.sun.visible = ENV.light.visible = !!o.sun;
    if (o.sun) { ENV.sun.position.copy(o.sun).multiplyScalar(40); ENV.sun.scale.setScalar(40 * Math.tan(1.5 * Math.PI / 180)); ENV.light.position.copy(o.sun); }
    ENV.planet.visible = !!pl;
    if (pl) {
      var a = Math.min(pl.size, 1.3);
      ENV.planet.position.copy(pl.dir).multiplyScalar(30); ENV.planet.scale.setScalar(30 * Math.sin(a));
      ENV.planet.material.color.copy(col || new THREE.Color(0x808080));
    }
    var rt = (ENV.gen || (ENV.gen = new THREE.PMREMGenerator(R))).fromScene(sc, 0, 0.1, 100);
    if (ENV.rt) ENV.rt.dispose();
    ENV.rt = rt; ENV.t = now; ENV.sd = o.sun ? o.sun.clone() : null; ENV.pd = pl ? pl.dir.clone() : null; ENV.pid = pl && pl.id; ENV.col = !!col;
    ENV.mats.forEach(function (m) { if (!m.envMap) m.needsUpdate = true; m.envMap = rt.texture; });
  }
  function dropSky() {
    if (!ENV.rt) return;
    ENV.rt.dispose(); ENV.rt = null;
    ENV.mats.forEach(function (m) { m.envMap = null; m.needsUpdate = true; });
  }

  /* ---------- quality ---------- */
  // One setting per page. high: generated hulls with reflections, 2k planet maps, 30 frames a second. medium (narrow
  // screens): the same with 1k maps at 24 frames. low (Save-Data, or a page that keeps missing its frames): the
  // procedural ship, no reflections, no bloom. ?quality=high|medium|low pins it. Otherwise, when frames cost over
  // 1.5 times the tier's budget for about three seconds, the page drops one tier; it never climbs back.
  var TIERS = {
    high: { name: "high", maps: "desktop", fps: 30, hulls: true, bloom: true },
    medium: { name: "medium", maps: "mobile", fps: 24, hulls: true, bloom: true },
    low: { name: "low", maps: "mobile", fps: 24, hulls: false, bloom: false }
  };
  var ORDER = ["high", "medium", "low"];
  var qp = root.location && new URLSearchParams(root.location.search).get("quality");
  var Q = { pinned: TIERS[qp] ? qp : null, drop: 0, cur: null, t0: -1, vis: 0, vis0: 0, frames: 0, slow: 0 };
  document.addEventListener("visibilitychange", function () { Q.vis++; });
  var SAVE = !!(root.navigator && root.navigator.connection && root.navigator.connection.saveData);
  function quality() {
    var name = Q.pinned || (SAVE ? "low" : ORDER[Math.min(2, (root.innerWidth <= 760 ? 1 : 0) + Q.drop)]);
    if (name !== Q.cur) {
      Q.cur = name;
      SHIPS = SHIPS.filter(function (g) { return g.parent; }); // a ship the page removed is gone for good
      SHIPS.forEach(showHull);
      DOCKG = DOCKG.filter(function (g) { return g.parent; }); DOCKG.forEach(function (g) { g.userData.setPx(); });
      if (!TIERS[name].hulls) dropSky();
    }
    return TIERS[name];
  }
  // Called as a frame renders, from inside its animation frame (both pages render only there). The cost of a frame
  // that rendered is the time from its start to the next frame's start: it covers the page's work, the render and
  // whatever the GPU still owes, and unlike the gap between rendered frames it does not grow while a paused map sits
  // idle. A frame that spans the page being hidden is skipped, no one frame counts for more than half a second, and
  // the first 30 frames after a tier change carry shader compiles and texture uploads.
  function pace() {
    if (Q.pinned || Q.t0 >= 0) return;
    Q.t0 = document.timeline.currentTime; Q.vis0 = Q.vis;
    root.requestAnimationFrame(paced);
  }
  function paced(ts) {
    var dt = ts - Q.t0; Q.t0 = -1;
    if (Q.vis !== Q.vis0 || ++Q.frames < 30) return;
    Q.slow = dt > 1500 / quality().fps ? Q.slow + Math.min(dt, 500) : Math.max(0, Q.slow - dt);
    if (Q.slow > 3000 && Q.drop < 2) { Q.drop++; Q.slow = 0; Q.frames = 0; }
  }

  /* ---------- HUD icon sprite: 24-unit stroke icons drawn in currentColor ---------- */
  var ICONS = {
    booking: '<path d="M3 8V6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5V8a3 3 0 0 0 0 6v1.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5V14a3 3 0 0 0 0-6z"/><path d="M15 7v1.6M15 10.2v1.6M15 13.4v1.6"/>',
    passenger: '<circle cx="12" cy="7.8" r="3.3"/><path d="M5.2 19.5c.8-3.7 3.4-5.7 6.8-5.7s6 2 6.8 5.7"/>',
    pad: '<circle cx="12" cy="12" r="8.5"/><path d="M9 8.5v7M15 8.5v7M9 12h6"/>',
    launch_hold: '<circle cx="12" cy="12" r="8.5"/><path d="M10 8.8v6.4M14 8.8v6.4"/>',
    pad_closed: '<circle cx="12" cy="12" r="8.5"/><path d="M9 8.5v7M15 8.5v7M9 12h6"/><path d="M5.9 5.9l12.2 12.2"/>',
    dust_storm: '<path d="M3 8.5h10.5a2.5 2.5 0 1 0-2.4-3.2"/><path d="M3 12.5h15a2.5 2.5 0 1 1-2.4 3.2"/><path d="M3 16.5h6.5"/><circle cx="19.5" cy="9" r=".6"/><circle cx="12.5" cy="17.5" r=".6"/>',
    solar_flare: '<circle cx="11" cy="13" r="3.6"/><path d="M11 5.8v1.6M11 18.6v1.6M3.8 13h1.6M16.6 13h1.6M5.9 7.9l1.1 1.1M15 17l1.1 1.1M5.9 18.1L7 17"/><path d="M14.2 9.6c1.2-3.3 4.3-4.9 6.8-3.4-2.4.1-3.6 1.6-4 3.6"/>',
    ready: '<circle cx="12" cy="12" r="8.5"/><path d="M8.4 12.4l2.5 2.5 4.8-5.1"/>',
    busy: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.4V12l3.1 2"/>',
    flying: '<path d="M12 3.5l6 15.5-6-3.6-6 3.6z"/><path d="M12 15.4V20.5"/>'
  };
  function sprite() {
    if (document.getElementById("sol-icons")) return;
    var s = '<svg xmlns="http://www.w3.org/2000/svg" id="sol-icons" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">';
    Object.keys(ICONS).forEach(function (k) {
      s += '<symbol id="si-' + k + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + ICONS[k] + "</symbol>";
    });
    document.body.insertAdjacentHTML("afterbegin", s + "</svg>");
    var st = document.createElement("style");
    st.textContent = ".si{width:1.15em;height:1.15em;flex:none;vertical-align:-.2em;display:inline-block}";
    document.head.appendChild(st);
  }
  function icon(name, cls) {
    if (!ICONS[name]) return "";
    return '<svg class="si' + (cls ? " " + cls : "") + '" aria-hidden="true" focusable="false"><use href="#si-' + name + '"/></svg>';
  }

  if (THREE) SUN.value = new THREE.Vector3();
  if (document.body) sprite(); else document.addEventListener("DOMContentLoaded", sprite);
  if (THREE) loadStars();

  root.SolArt = {
    BASE: BASE, init: init, setSun: setSun, planet: planet, hasRim: function (id) { return !!RIMS[id] || !!(root.StarfarePlanetEffects && MAPS[id]); },
    updatePlanet: function (body, context) { if (root.StarfarePlanetEffects) root.StarfarePlanetEffects.update(body, devicePixels(context)); },
    disposePlanet: function (body) { if (root.StarfarePlanetEffects && body) root.StarfarePlanetEffects.dispose(body.userData.solarSurface || body); },
    updateSun: function (body, context) { if (root.StarfarePlanetEffects && body.userData.solarSurface) root.StarfarePlanetEffects.update(body.userData.solarSurface, devicePixels(context)); },
    sun: sun, stars: stars, composer: composer, ship: ship, dock: dock, debris: debris, setEngine: setEngine, setSky: setSky, quality: quality, icon: icon, ICONS: Object.keys(ICONS),
    CREDIT: "Maps: NASA, JPL, USGS (public domain); Earth effects, Saturn, rings, Sun: Solar System Scope (CC BY 4.0). Moon relief: NASA SVS / LRO LOLA. Stars: Yale Bright Star Catalog."
  };
})(window);
