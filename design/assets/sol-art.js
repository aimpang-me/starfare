/* sol-art.js: shared art for the Starfare mockups (three.js r128).
   Textured planets with a fresnel atmosphere rim, the Yale Bright Star Catalog starfield, the bloom/vignette/grain
   composer, the procedural Starseeker and the HUD icon sprite. Sources and licences: CREDITS.md next to this file.
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
    var t = loader.load(BASE + "tex/" + file);
    t.anisotropy = ANISO;
    return (TEX[file] = t);
  }
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
  function additiveSprite(map, color) {
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: map, color: color || 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  }
  function sun(r, wide) {
    var g = new THREE.Group();
    var ball = new THREE.Mesh(sphere(), new THREE.MeshBasicMaterial({ map: tex("sun_1k.jpg"), color: new THREE.Color(1.6, 1.35, 1.05) }));
    ball.scale.setScalar(r); g.add(ball);
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
  // A composer for one renderer: bloom always (threshold-based, so only the Sun, engine plumes, lights and lit markers
  // pass), plus an optional vignette and grain pass. Without the example scripts it falls back to a plain render.
  function composer(renderer, opt) {
    opt = opt || {};
    var ok = THREE.EffectComposer && THREE.RenderPass && THREE.UnrealBloomPass && THREE.ShaderPass;
    var api = { bloom: !!ok, post: null, render: function (scene, cam) { renderer.render(scene, cam); }, setSize: function () {}, tick: function () {} };
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
    api.render = function (scene, cam) { rp.scene = scene; rp.camera = cam; C.render(); };
    api.setSize = function (W, H) { C.setPixelRatio(renderer.getPixelRatio()); C.setSize(W, H); };
    // t in ms; a static grain when motion is reduced.
    api.tick = function (t, reduced) { if (vp) vp.uniforms.uTime.value = reduced ? 0.5 : (t / 1000) % 1000; };
    return api;
  }

  /* ---------- the Starseeker ---------- */
  /* An original short-hop passenger ship in the Starseeker look of the page SVGs: a flattened lifting-body hull,
     a blue lit window band, swept wings with a little dihedral, one dorsal fin and a single aft thruster. Built here
     from lathe and extrude geometry, flat-shaded and low-poly. Nose along +z, up +y, length 1. Port (+x) carries the
     red nav light, starboard (-x) the green. Not modelled on any real or game vehicle. */
  var SHIPK = null;
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
    var plume = new THREE.ConeGeometry(1, 1, 20, 1, true); plume.rotateX(-Math.PI / 2); plume.translate(0, 0, -0.5);
    // hull half-width at height y and station z, from the lathe profile
    function rAt(z) {
      var t = z + 0.5;
      for (var i = 1; i < prof.length; i++) if (t <= prof[i][0]) { var a = prof[i - 1], b = prof[i]; return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]); }
      return 0.001;
    }
    function halfW(z, y) { var r = rAt(z), k = y / (0.62 * r); return k >= 1 ? 0 : 1.3 * r * Math.sqrt(1 - k * k); }
    SHIPK = {
      halfW: halfW, hull: hull, wing: wing, fin: fin, canopy: canopy, plume: plume,
      nacelle: new THREE.CylinderGeometry(0.078, 0.092, 0.07, 12, 1, true).rotateX(Math.PI / 2),
      disc: new THREE.CircleGeometry(0.072, 20),
      win: new THREE.BoxGeometry(0.006, 0.02, 0.042),
      dot: new THREE.SphereGeometry(0.011, 8, 6),
      decal: new THREE.PlaneGeometry(0.22, 0.055).rotateX(-Math.PI / 2).rotateY(Math.PI), // flat, reads from behind
      hullM: new THREE.MeshStandardMaterial({ color: 0x5d6a7e, metalness: 0.35, roughness: 0.42, flatShading: true, emissive: 0x0b0f16 }),
      wingM: new THREE.MeshStandardMaterial({ color: 0x2a3344, metalness: 0.4, roughness: 0.5, flatShading: true }),
      canM: new THREE.MeshStandardMaterial({ color: 0x1a2b44, emissive: 0x9cc3ff, emissiveIntensity: 0.28, metalness: 0.6, roughness: 0.12, flatShading: true }),
      winM: new THREE.MeshBasicMaterial({ color: 0xc4dbff }),
      nacM: new THREE.MeshStandardMaterial({ color: 0x1a202c, metalness: 0.6, roughness: 0.35, flatShading: true, side: THREE.DoubleSide }),
      hotM: new THREE.MeshBasicMaterial({ color: 0xfff0d6 }),
      stripeM: new THREE.LineBasicMaterial({ color: 0x9cc3ff, transparent: true, opacity: 0.9 }),
      glow: glow("rgba(255,236,200,1)", "rgba(255,182,92,.55)"),
      navG: glow("rgba(255,255,255,1)", "rgba(255,255,255,.35)", 0.18)
    };
    return SHIPK;
  }
  function plumeMat(k, inner) {
    return new THREE.ShaderMaterial({
      uniforms: { k: { value: k }, flick: { value: 1 }, inner: { value: inner ? 1 : 0 } },
      vertexShader: VS_HEAD +
        "varying float vA; varying vec3 vN; varying vec3 vV;\n" +
        "void main(){ vA = uv.y; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz);\n" +
        " gl_Position = projectionMatrix * mv;\n#include <logdepthbuf_vertex>\n}",
      fragmentShader: FS_HEAD +
        "uniform float k; uniform float flick; uniform float inner; varying float vA; varying vec3 vN; varying vec3 vV;\n" +
        "void main(){\n#include <logdepthbuf_fragment>\n" +
        " float along = 1.0 - vA; float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.3);\n" +
        " vec3 hot = vec3(1.0, 0.96, 0.88), warm = vec3(1.0, 0.62, 0.26), cool = vec3(0.62, 0.78, 1.0);\n" +
        " vec3 c = mix(warm, hot, smoothstep(0.35, 0.95, along)); c = mix(c, cool, inner * 0.35 * (1.0 - along));\n" +
        " float a = pow(along, 1.7) * edge * k * flick;\n" +
        " gl_FragColor = vec4(c * a, 1.0); }",
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    });
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
  function ship(opt) {
    opt = opt || {};
    var K = shipKit(), g = new THREE.Group();
    g.add(new THREE.Mesh(K.hull, K.hullM));
    var can = new THREE.Mesh(K.canopy, K.canM); can.scale.set(0.085, 0.06, 0.2); can.position.set(0, 0.06, 0.15); g.add(can);
    [1, -1].forEach(function (s) {
      var wm = new THREE.Mesh(K.wing, K.wingM); wm.scale.x = s; wm.position.y = -0.03; wm.rotation.z = s * 0.06; g.add(wm);
      for (var i = 0; i < 5; i++) { var z = 0.12 - i * 0.06, wn = new THREE.Mesh(K.win, K.winM); wn.position.set(s * (K.halfW(z, 0.03) - 0.001), 0.03, z); g.add(wn); }
      var st = [];
      for (var j = 0; j <= 16; j++) { var zz = -0.44 + j * 0.05; st.push(new THREE.Vector3(s * (K.halfW(zz, -0.012) + 0.002), -0.012, zz)); }
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(st), K.stripeM));
    });
    var fin = new THREE.Mesh(K.fin, K.wingM); fin.position.set(0, 0.06, 0); g.add(fin);
    var nac = new THREE.Mesh(K.nacelle, K.nacM); nac.position.z = -0.52; g.add(nac);
    var disc = new THREE.Mesh(K.disc, K.hotM); disc.position.z = -0.53; disc.rotation.y = Math.PI; g.add(disc);
    // plume: outer warm sheath and a hot core; length set per frame in update()
    var pl = new THREE.Mesh(K.plume, plumeMat(1.0, false)); pl.scale.set(0.085, 0.085, 0.55); pl.position.z = -0.54; g.add(pl);
    var core = new THREE.Mesh(K.plume, plumeMat(1.6, true)); core.scale.set(0.045, 0.045, 0.3); core.position.z = -0.54; g.add(core);
    var gl = additiveSprite(K.glow); gl.position.z = -0.6; gl.scale.setScalar(0.42); g.add(gl);
    // nav lights at the wingtips: red port (+x), green starboard (-x), white beacon on the fin
    function nav(x, y, z, col) {
      var d = new THREE.Mesh(K.dot, new THREE.MeshBasicMaterial({ color: col })); d.position.set(x, y, z); g.add(d);
      var s = additiveSprite(K.navG, col); s.position.copy(d.position); s.scale.setScalar(0.11); g.add(s);
      return { d: d, s: s };
    }
    var red = nav(0.475, -0.002, -0.27, 0xff5a4a), grn = nav(-0.475, -0.002, -0.27, 0x55f08a), bcn = nav(0, 0.235, -0.44, 0xffffff);
    if (opt.callsign) {
      var dt = decalTex(String(opt.callsign).toUpperCase());
      var dm = new THREE.MeshStandardMaterial({ map: dt, transparent: true, metalness: 0.2, roughness: 0.6, depthWrite: false });
      [1, -1].forEach(function (s) {
        var d = new THREE.Mesh(K.decal, dm); d.position.set(s * 0.27, 0.0, -0.21); d.rotation.z = s * 0.06; g.add(d); // on the wing top, with its dihedral
      });
    }
    g.userData.glow = gl;
    g.userData.plume = [pl, core];
    // t in ms. Flying: plume on and flickering; parked: plume off, glow low. Nav lights double-flash unless reduced.
    g.userData.update = function (t, flying, reduced) {
      var fl = reduced ? 1 : 0.9 + 0.1 * Math.sin(t / 37) * Math.sin(t / 91 + 1.3);
      pl.visible = core.visible = !!flying;
      pl.material.uniforms.flick.value = fl; core.material.uniforms.flick.value = fl;
      pl.scale.z = 0.55 * (reduced ? 1 : 0.95 + 0.08 * Math.sin(t / 53));
      gl.material.opacity = flying ? 1 : 0.2;
      gl.scale.setScalar(flying ? 0.42 + (reduced ? 0 : 0.05 * Math.sin(t / 45)) : 0.25);
      var ph = (t % 1400) / 1400, on = reduced || ph < 0.07 || (ph > 0.14 && ph < 0.21);
      red.s.material.opacity = grn.s.material.opacity = on ? 1 : 0.22;
      red.s.scale.setScalar(on ? 0.13 : 0.08); grn.s.scale.setScalar(on ? 0.13 : 0.08);
      var bon = reduced || ((t + 700) % 1400) / 1400 < 0.05;
      bcn.s.material.opacity = bon ? 0.9 : 0.0;
    };
    return g;
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
    BASE: BASE, init: init, setSun: setSun, planet: planet, hasRim: function (id) { return !!RIMS[id]; },
    sun: sun, stars: stars, composer: composer, ship: ship, icon: icon, ICONS: Object.keys(ICONS),
    CREDIT: "Maps: NASA, JPL, USGS (public domain); Saturn, rings, Sun: Solar System Scope (CC BY 4.0). Stars: Yale Bright Star Catalog."
  };
})(window);
