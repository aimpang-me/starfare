/* Map ambience: open space, debris, planets and moons, stations. Every sound is synthesized here with the Web Audio
   API, so there are no audio files and nothing to license. Sound does not travel through vacuum, so all of it is
   stylized and simulated: a cabin bed, hits on the hull, radio-style sonifications near bodies and station comms.
   Off until the visitor turns it on. mix() is pure, so it runs in node for tests; the graph needs a browser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SolAudio = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var KEY = 'sf-sound', AU_KM = 149597870.7, VOLUME = 0.9;
  // Planet ambience is full within FULL radii of the body's centre and gone beyond NONE. The map's default jump stands
  // the camera 8 radii off (4 or 16 with the frame setting), so a jump to a body lands inside the full zone.
  var BODY_FULL = 12, BODY_NONE = 40;
  // Stations have no size on the map; the camera rides a station from about 45 km and lets go near 4,500 km.
  var STATION_FULL_KM = 800, STATION_NONE_KM = 6000;
  // Where debris is. Low Earth orbit (200 to 2,000 km) and the geostationary belt hold most tracked debris (ESA Space
  // Environment Report). Saturn's main rings, D ring inner edge to A ring outer edge, 1.11 to 2.27 Saturn radii,
  // measured as distance from Saturn's centre (the ring plane's tilt is ignored). Dust near small bodies; Bennu
  // was seen shedding particles. The main asteroid belt, about 2.2 to 3.2 AU and near the ecliptic, is real but
  // very sparse, so it only gets a faint level.
  var LEO_KM = [200, 2000], GEO_KM = [35286, 36286], SATURN_RINGS = [1.11, 2.27], DUSTY = { bennu: 1, ceres: 1, phobos: 1 };
  var BELT_AU = [2.2, 3.2], BELT_Z_AU = 0.25;

  function load(storage) { try { return JSON.parse(storage.getItem(KEY) || 'false') === true; } catch (e) { return false; } }
  function save(storage, on) { try { storage.setItem(KEY, JSON.stringify(!!on)); } catch (e) { /* private window or blocked site data */ } }

  function smooth(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }
  // 1 at or inside `full`, 0 at or beyond `none`, eased on a log scale because map distances span many decades.
  function near(d, full, none) { return d > 0 ? 1 - smooth((Math.log(d) - Math.log(full)) / (Math.log(none) - Math.log(full))) : 1; }
  // 1 between lo and hi, easing to 0 over `edge` either side.
  function band(x, lo, hi, edge) { return x < lo ? smooth((x - lo + edge) / edge) : x > hi ? smooth((hi + edge - x) / edge) : 1; }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
  function top(list, n) { return list.filter(function (v) { return v.level > 0.005; }).sort(function (a, b) { return b.level - a.level; }).slice(0, n); }

  // What should be heard where the camera is. scene: { eye: [x, y, z], bodies: [{ id, kind, p: [x, y, z], rKm }] },
  // heliocentric ecliptic AU with z north. Returns levels from 0 to 1: space, debris, up to two bodies, up to two stations.
  function mix(scene) {
    var eye = scene.eye, bodies = [], stations = [], debris = 0, bodyMax = 0, stationMax = 0;
    (scene.bodies || []).forEach(function (b) {
      var dKm = dist(eye, b.p) * AU_KM;
      if (b.kind === 'station') {
        if (STATIONS[b.id]) stations.push({ id: b.id, level: near(dKm, STATION_FULL_KM, STATION_NONE_KM) });
        return;
      }
      if (!(b.rKm > 0)) return;
      var radii = dKm / b.rKm;
      if (BODIES[b.id]) bodies.push({ id: b.id, level: near(radii, BODY_FULL, BODY_NONE), rKm: b.rKm });
      if (b.id === 'earth') {
        var alt = dKm - b.rKm;
        debris = Math.max(debris, band(alt, LEO_KM[0], LEO_KM[1], 1500), 0.6 * band(alt, GEO_KM[0], GEO_KM[1], 1500));
      }
      if (b.id === 'saturn') debris = Math.max(debris, 0.9 * band(radii, SATURN_RINGS[0], SATURN_RINGS[1], 0.2));
      if (DUSTY[b.id]) debris = Math.max(debris, 0.7 * near(radii, 20, 80));
    });
    var helio = Math.hypot(eye[0], eye[1], eye[2]);
    debris = Math.max(debris, 0.35 * band(helio, BELT_AU[0], BELT_AU[1], 0.2) * band(eye[2], -BELT_Z_AU, BELT_Z_AU, 0.15));
    // Smaller bodies first, so a moon's own voice wins over its planet's at equal level (Phobos over Mars).
    bodies = top(bodies.sort(function (a, b) { return a.rKm - b.rKm; }).map(function (b) { return { id: b.id, level: b.level }; }), 2);
    stations = top(stations, 2);
    bodies.forEach(function (b) { bodyMax = Math.max(bodyMax, b.level); });
    stations.forEach(function (s) { stationMax = Math.max(stationMax, s.level); });
    // A station's comms sit over its planet: duck the body under it, and the space bed under both.
    if (stationMax) bodies = bodies.map(function (b) { return { id: b.id, level: b.level * (1 - 0.4 * stationMax) }; });
    return { space: Math.max(0.35, 1 - 0.45 * bodyMax - 0.25 * stationMax), debris: debris, bodies: bodies, stations: stations };
  }

  /* Voices. drone: [[Hz, gain, wave?]], trem: drone tremolo [Hz, depth]. noise: colour (brown, pink, white) through a
     filter, with an amplitude lfo [Hz, depth] and an optional filter sweep [loHz, hiHz, Hz]. ev: events, each a Poisson
     stream of `rate` per second (scaled by the layer's level when `scale` is set):
       chirp  a sine sweeping f0 to f1 over d seconds (Earth's whistler-mode chorus and whistlers, Saturn's kilometric
              radiation, as heard in NASA's plasma-wave sonifications)
       ping   a struck metal or ice partial set at f decaying over d seconds (hull hits, ice creaks, clanks)
       crackle a few millisecond noise grain at f
       surf   crackle whose density swells and falls every `period` seconds (Jupiter's radio storms)
       hiss   a swelling band of noise at f over d seconds (Enceladus and Triton plumes)
       beep   a console tone sequence [[offset s, Hz, length s]]
       data   one short random tone at f (packet blips) */
  var SPACE = { vol: 0.5, drone: [[46, 0.1], [46.35, 0.08], [92.4, 0.025], [138.9, 0.01]],
    noise: [{ c: 'brown', t: 'lowpass', f: 170, q: 0.5, g: 0.55, lfo: [0.06, 0.35] }, { c: 'pink', t: 'bandpass', f: 1100, q: 0.9, g: 0.035, lfo: [0.11, 0.5] }],
    ev: [{ k: 'beep', rate: 1 / 28, seq: [[0, 1320, 0.05], [0.09, 1760, 0.05]], g: 0.02 }] };
  var DEBRIS = { vol: 0.6, noise: [{ c: 'white', t: 'highpass', f: 3500, q: 0.6, g: 0.05, lfo: [0.3, 0.6] }],
    ev: [{ k: 'ping', scale: 1, rate: 5, f: [900, 3200], d: [0.04, 0.22], g: 0.22 }, { k: 'crackle', scale: 1, rate: 9, f: [2500, 9000], g: 0.09 }] };
  var BODIES = {
    sun: { vol: 0.5, drone: [[31, 0.12], [46.5, 0.05]], noise: [{ c: 'brown', t: 'lowpass', f: 140, q: 0.7, g: 0.8, lfo: [0.03, 0.4] }, { c: 'pink', t: 'bandpass', f: 420, q: 0.6, g: 0.12, sweep: [250, 700, 0.02] }],
      ev: [{ k: 'surf', rate: 14, period: 9, f: [700, 2400], g: 0.05 }] },
    mercury: { vol: 0.5, noise: [{ c: 'white', t: 'bandpass', f: 5200, q: 0.8, g: 0.05, lfo: [0.2, 0.5] }, { c: 'brown', t: 'lowpass', f: 200, g: 0.2 }],
      ev: [{ k: 'crackle', rate: 3, f: [3000, 7000], g: 0.07 }] },
    venus: { vol: 0.55, drone: [[38, 0.08], [57, 0.03]], noise: [{ c: 'brown', t: 'lowpass', f: 260, q: 0.8, g: 0.9, sweep: [160, 380, 0.05], lfo: [0.08, 0.5] }] },
    earth: { vol: 0.45, noise: [{ c: 'pink', t: 'bandpass', f: 2400, q: 0.7, g: 0.025 }, { c: 'brown', t: 'lowpass', f: 180, g: 0.25 }],
      ev: [{ k: 'chirp', rate: 2.2, f0: [1100, 1700], f1: [2600, 4200], d: [0.12, 0.35], g: 0.06 }, { k: 'chirp', rate: 0.12, f0: [6000, 7500], f1: [400, 700], d: [0.8, 1.4], g: 0.035 }] },
    moon: { vol: 0.45, drone: [[72, 0.05], [108.3, 0.015]], noise: [{ c: 'brown', t: 'lowpass', f: 120, g: 0.15 }], ev: [{ k: 'ping', rate: 0.08, f: [300, 600], d: [0.6, 1.2], g: 0.04 }] },
    mars: { vol: 0.5, noise: [{ c: 'pink', t: 'bandpass', f: 420, q: 1.1, g: 0.45, sweep: [220, 700, 0.07], lfo: [0.13, 0.7] }, { c: 'brown', t: 'lowpass', f: 150, g: 0.2 }] },
    phobos: { vol: 0.4, drone: [[41, 0.07]], noise: [{ c: 'brown', t: 'lowpass', f: 300, q: 1, g: 0.5, lfo: [0.31, 0.5] }], ev: [{ k: 'crackle', rate: 2, f: [400, 1400], g: 0.08 }] },
    ceres: { vol: 0.5, drone: [[58, 0.05]], noise: [{ c: 'brown', t: 'lowpass', f: 150, g: 0.15 }], ev: [{ k: 'ping', rate: 0.2, f: [500, 1300], d: [0.3, 0.8], g: 0.04 }] },
    jupiter: { vol: 0.55, drone: [[36, 0.1], [54.2, 0.04], [71.8, 0.02]], noise: [{ c: 'brown', t: 'lowpass', f: 220, g: 0.4, lfo: [0.05, 0.4] }],
      ev: [{ k: 'surf', rate: 40, period: 7, f: [900, 3200], g: 0.06 }] },
    io: { vol: 0.6, noise: [{ c: 'white', t: 'bandpass', f: 3200, q: 0.6, g: 0.04, lfo: [0.4, 0.6] }],
      ev: [{ k: 'crackle', rate: 22, f: [1500, 7000], g: 0.07 }, { k: 'chirp', rate: 0.6, f0: [600, 900], f1: [300, 450], d: [0.2, 0.5], g: 0.03 }] },
    europa: { vol: 0.55, drone: [[64, 0.04]], noise: [{ c: 'pink', t: 'lowpass', f: 500, g: 0.08 }], ev: [{ k: 'ping', rate: 0.35, f: [140, 380], d: [1.2, 2.6], g: 0.08 }] },
    ganymede: { vol: 0.55, noise: [{ c: 'pink', t: 'bandpass', f: 1500, q: 0.8, g: 0.03 }], ev: [{ k: 'chirp', rate: 1.4, f0: [700, 1100], f1: [1600, 2600], d: [0.15, 0.4], g: 0.045 }] },
    callisto: { vol: 0.45, drone: [[55, 0.05], [82.6, 0.02]], noise: [{ c: 'brown', t: 'lowpass', f: 110, g: 0.12 }] },
    saturn: { vol: 0.55, drone: [[42, 0.07], [63.1, 0.03]], noise: [{ c: 'brown', t: 'lowpass', f: 180, g: 0.3 }],
      ev: [{ k: 'chirp', rate: 0.9, f0: [1400, 2400], f1: [300, 700], d: [0.5, 1.4], g: 0.05 }] },
    enceladus: { vol: 0.45, noise: [{ c: 'white', t: 'highpass', f: 2200, g: 0.02 }], ev: [{ k: 'hiss', rate: 0.25, f: [1800, 4200], d: [1.5, 3.5], g: 0.12 }] },
    titan: { vol: 0.55, drone: [[34, 0.06]], noise: [{ c: 'brown', t: 'lowpass', f: 300, q: 0.7, g: 0.7, sweep: [180, 520, 0.04], lfo: [0.05, 0.45] }, { c: 'pink', t: 'bandpass', f: 900, q: 0.5, g: 0.04 }] },
    uranus: { vol: 0.55, drone: [[330, 0.02], [495.4, 0.015], [660.8, 0.008]], trem: [0.07, 0.5], noise: [{ c: 'pink', t: 'highpass', f: 4000, g: 0.01 }] },
    neptune: { vol: 0.5, drone: [[49, 0.06], [73.6, 0.025]], trem: [0.09, 0.4], noise: [{ c: 'brown', t: 'bandpass', f: 260, q: 0.8, g: 0.5, sweep: [150, 600, 0.11], lfo: [0.17, 0.6] }] },
    triton: { vol: 0.5, noise: [{ c: 'white', t: 'highpass', f: 2600, g: 0.015 }], ev: [{ k: 'hiss', rate: 0.15, f: [1200, 3000], d: [1, 2.5], g: 0.08 }, { k: 'ping', rate: 0.15, f: [200, 450], d: [0.8, 1.6], g: 0.04 }] }
  };
  // Stations: mains hum and fans, console beeps. Real stations get stylized sounds, not recordings.
  function station(hum, fan, ev) {
    return { vol: 0.5, drone: [[hum, 0.03, 'sawtooth'], [hum * 2, 0.012, 'sawtooth']], lp: 600, noise: [fan], ev: ev };
  }
  var STATIONS = {
    iss: station(120, { c: 'pink', t: 'bandpass', f: 650, q: 0.7, g: 0.25, lfo: [0.5, 0.15] },
      [{ k: 'beep', rate: 1 / 6, seq: [[0, 1046, 0.08], [0.16, 1046, 0.08]], g: 0.05 }, { k: 'beep', rate: 1 / 17, seq: [[0, 784, 0.12], [0.18, 1175, 0.18]], g: 0.04 }]),
    tiangong: station(100, { c: 'pink', t: 'bandpass', f: 560, q: 0.8, g: 0.2, lfo: [0.4, 0.15] },
      [{ k: 'beep', rate: 1 / 9, seq: [[0, 880, 0.1], [0.14, 1320, 0.1], [0.28, 1760, 0.14]], g: 0.045 }]),
    'orbital-depot': station(60, { c: 'brown', t: 'lowpass', f: 420, g: 0.35, lfo: [0.2, 0.2] },
      [{ k: 'ping', rate: 0.2, f: [180, 420], d: [0.3, 0.8], g: 0.06 }, { k: 'beep', rate: 1 / 11, seq: [[0, 660, 0.15]], g: 0.04 }]),
    'lunar-data-center': station(90, { c: 'pink', t: 'bandpass', f: 900, q: 0.6, g: 0.18, lfo: [0.7, 0.1] },
      [{ k: 'data', rate: 3, f: [1800, 3600], g: 0.025 }, { k: 'beep', rate: 1 / 13, seq: [[0, 1568, 0.06]], g: 0.035 }]),
    'mars-base': station(50, { c: 'pink', t: 'bandpass', f: 380, q: 1, g: 0.25, sweep: [250, 520, 0.08] },
      [{ k: 'beep', rate: 1 / 12, seq: [[0, 587, 0.1], [0.13, 740, 0.1], [0.26, 880, 0.16]], g: 0.045 }]),
    'ceres-port': station(75, { c: 'brown', t: 'lowpass', f: 380, g: 0.3 },
      [{ k: 'ping', rate: 0.3, f: [220, 600], d: [0.2, 0.6], g: 0.05 }, { k: 'beep', rate: 1 / 10, seq: [[0, 988, 0.09], [0.12, 784, 0.12]], g: 0.04 }]),
    'titan-dock': station(55, { c: 'brown', t: 'lowpass', f: 260, g: 0.4, lfo: [0.06, 0.3] },
      [{ k: 'beep', rate: 1 / 14, seq: [[0, 523, 0.14], [0.2, 659, 0.2]], g: 0.045 }])
  };

  // Seeded so offline renders are repeatable.
  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* The graph on any BaseAudioContext, live or offline. set(m) takes a mix() result; schedule(until) queues events up
     to that context time. Voices are built when first needed and torn down after a few silent seconds. */
  function graph(ctx, dest, seed) {
    var R = rng(seed || 1), bufs = {}, voices = {}, levels = {}, live = 0, MAX_EVENTS = 48, TAU = Math.PI * 2;
    var out = ctx.createGain(); out.connect(dest);
    function rnd(r) { return r[0] + (r[1] - r[0]) * R(); }
    function noise(c) {
      if (bufs[c]) return bufs[c];
      var n = Math.floor(ctx.sampleRate * 4), b = ctx.createBuffer(2, n, ctx.sampleRate);
      for (var ch = 0; ch < 2; ch++) {
        var d = b.getChannelData(ch), b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0, peak = 0, i;
        for (i = 0; i < n; i++) {
          var w = R() * 2 - 1;
          if (c === 'white') d[i] = w;
          else if (c === 'pink') { // Paul Kellet's filter
            b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
            b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
            d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
          } else { last = (last + 0.02 * w) / 1.02; d[i] = last; }
        }
        // Tilt the ends together so the loop does not click, then normalise.
        var drift = d[n - 1] - d[0];
        for (i = 0; i < n; i++) { d[i] -= drift * i / (n - 1); peak = Math.max(peak, Math.abs(d[i])); }
        for (i = 0; i < n; i++) d[i] /= peak || 1;
      }
      return (bufs[c] = b);
    }
    function pan(node, v) {
      if (!ctx.createStereoPanner) return node;
      var p = ctx.createStereoPanner(); p.pan.value = v; node.connect(p); return p;
    }
    function lfo(rate, depth, param, nodes) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = rate; g.gain.value = depth; o.connect(g); g.connect(param); o.start(ctx.currentTime + R() / rate); nodes.push(o);
    }
    function build(spec) {
      var v = { spec: spec, gain: ctx.createGain(), nodes: [], ev: [], level: 0, quietSince: ctx.currentTime }, t0 = ctx.currentTime;
      v.gain.gain.value = 0; v.gain.connect(out);
      if (spec.drone) {
        var dg = ctx.createGain(), dl = dg;
        if (spec.lp) { var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = spec.lp; dg.connect(f); dl = f; }
        dl.connect(v.gain);
        dg.gain.value = spec.trem ? 1 - spec.trem[1] / 2 : 1;
        if (spec.trem) lfo(spec.trem[0], spec.trem[1] / 2, dg.gain, v.nodes);
        // A low sine alone is lost on laptop and phone speakers, so it carries quiet 2nd and 3rd harmonics.
        spec.drone.forEach(function (d) {
          var parts = !d[2] && d[0] < 100 ? [[1, 1], [2, 0.3], [3, 0.2]] : [[1, 1]];
          parts.forEach(function (h) {
            var o = ctx.createOscillator(), g = ctx.createGain();
            o.type = d[2] || 'sine'; o.frequency.value = d[0] * h[0]; o.detune.value = (R() - 0.5) * 4; g.gain.value = d[1] * h[1];
            o.connect(g); g.connect(dg); o.start(t0); v.nodes.push(o);
          });
        });
      }
      (spec.noise || []).forEach(function (n) {
        var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), a = ctx.createGain(), g = ctx.createGain();
        s.buffer = noise(n.c); s.loop = true; f.type = n.t; f.frequency.value = n.sweep ? (n.sweep[0] + n.sweep[1]) / 2 : n.f; f.Q.value = n.q || 0.7;
        a.gain.value = n.lfo ? 1 - n.lfo[1] / 2 : 1; g.gain.value = n.g;
        s.connect(f); f.connect(a); a.connect(g); g.connect(v.gain);
        if (n.lfo) lfo(n.lfo[0], n.lfo[1] / 2, a.gain, v.nodes);
        if (n.sweep) lfo(n.sweep[2], (n.sweep[1] - n.sweep[0]) / 2, f.frequency, v.nodes);
        s.start(t0, R() * 4); v.nodes.push(s);
      });
      (spec.ev || []).forEach(function (e) { v.ev.push({ e: e, next: t0 + R() / e.rate }); });
      return v;
    }
    function done(node) { live++; node.onended = function () { live--; try { node.disconnect(); } catch (e) { /* already gone */ } }; }
    function env(g, t, a, len, peak) {
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setTargetAtTime(0, t + a, Math.max(0.005, (len - a) / 4));
    }
    function tone(dest, t, f0, f1, len, peak, type) {
      if (Math.max(f0, f1) > ctx.sampleRate * 0.45) return; // a partial above what the context can play
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + len);
      env(g, t, Math.min(0.01, len / 4), len, peak); o.connect(g); g.connect(dest); o.start(t); o.stop(t + len * 1.6 + 0.05); done(o);
    }
    function grain(dest, t, f, len, peak, q) {
      var s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noise('white'); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q || 2;
      g.gain.setValueAtTime(peak, t); g.gain.setTargetAtTime(0, t, len / 3);
      s.connect(b); b.connect(g); g.connect(dest); s.start(t, R() * 3.5, len * 2); done(s);
    }
    function fire(v, e, t) {
      if (live > MAX_EVENTS) return;
      var g = ctx.createGain(); g.gain.value = e.g; pan(g, (R() - 0.5) * 1.2).connect(v.gain);
      if (e.k === 'chirp') tone(g, t, rnd(e.f0), rnd(e.f1), rnd(e.d), 1);
      else if (e.k === 'ping') { var f = rnd(e.f), d = rnd(e.d); tone(g, t, f, f, d, 1); tone(g, t, f * 2.76, f * 2.76, d * 0.5, 0.45); tone(g, t, f * 5.4, f * 5.4, d * 0.25, 0.2); grain(g, t, f * 3, 0.004, 0.8, 1); }
      else if (e.k === 'crackle' || e.k === 'surf') grain(g, t, rnd(e.f), 0.003 + R() * 0.009, 1, 3);
      else if (e.k === 'hiss') {
        var s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), h = ctx.createGain(), len = rnd(e.d);
        s.buffer = noise('white'); b.type = 'bandpass'; b.frequency.value = rnd(e.f); b.Q.value = 0.9;
        h.gain.setValueAtTime(0, t); h.gain.linearRampToValueAtTime(1, t + len * 0.4); h.gain.linearRampToValueAtTime(0, t + len);
        s.connect(b); b.connect(h); h.connect(g); s.start(t, R() * 0.4, len + 0.05); done(s);
      }
      else if (e.k === 'beep') e.seq.forEach(function (n) { tone(g, t + n[0], n[1], n[1], n[2], 1, 'triangle'); });
      else if (e.k === 'data') tone(g, t, rnd(e.f), rnd(e.f), 0.02 + R() * 0.03, 1, 'square');
    }
    // A Poisson stream; surf thins it so density swells and falls, scaled streams follow the layer's level.
    function step(v, s, until) {
      var e = s.e, scale = e.scale ? v.level : 1;
      if (scale < 0.02) { s.next = Math.max(s.next, until); return; }
      while (s.next < until) {
        var t = s.next, keep = e.k === 'surf' ? 0.15 + 0.85 * Math.pow(0.5 + 0.5 * Math.sin(TAU * t / e.period), 3) : 1;
        if (t >= ctx.currentTime - 0.05 && R() < keep) fire(v, e, t);
        s.next = t - Math.log(1 - R()) / (e.rate * scale);
      }
    }
    function target(key, spec, level, now, tc) {
      var v = voices[key];
      if (!v) { if (level < 0.005) return; v = voices[key] = build(spec); }
      v.level = level; v.gain.gain.setTargetAtTime(level * spec.vol, now, tc);
      if (level >= 0.005) v.quietSince = now;
    }
    return {
      // tc: seconds for a level change to settle about two thirds of the way.
      set: function (m, tc) {
        var now = ctx.currentTime, want = { space: m.space, debris: m.debris };
        tc = tc == null ? 0.8 : tc;
        (m.bodies || []).forEach(function (b) { want['b:' + b.id] = b.level; });
        (m.stations || []).forEach(function (s) { want['s:' + s.id] = s.level; });
        Object.keys(voices).forEach(function (k) { if (!(k in want)) want[k] = 0; });
        Object.keys(want).forEach(function (k) {
          var spec = k === 'space' ? SPACE : k === 'debris' ? DEBRIS : k[0] === 'b' ? BODIES[k.slice(2)] : STATIONS[k.slice(2)];
          if (spec) target(k, spec, want[k], now, tc);
        });
        levels = want;
      },
      schedule: function (until) {
        var now = ctx.currentTime;
        Object.keys(voices).forEach(function (k) {
          var v = voices[k];
          if (v.level < 0.005 && now - v.quietSince > 6) { v.nodes.forEach(function (n) { try { n.stop(); } catch (e) { /* not started */ } }); v.gain.disconnect(); delete voices[k]; return; }
          v.ev.forEach(function (s) { step(v, s, until); });
        });
      },
      voices: function () { return Object.keys(voices); },
      levels: function () { return levels; },
      output: out
    };
  }

  /* The page's player. setOn(true) must run inside a click or key press the first time (browser autoplay rules).
     update() takes a mix() result; pause() follows the tab being hidden. */
  function create(opts) {
    opts = opts || {};
    var AC = opts.AudioContext || (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext));
    var ctx = null, g = null, master = null, on = false, hidden = false, timer = 0, last = null, VOL = opts.volume || VOLUME;
    // Outside a gesture a browser may refuse to resume; the next click or key press (unlock) tries again.
    function resume() { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); }
    function tick() { if (ctx && g) g.schedule(ctx.currentTime + 0.35); }
    function ensure() {
      if (ctx || !AC) return !!ctx;
      ctx = new AC(); master = ctx.createGain(); master.gain.value = 0;
      var comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
      master.connect(comp); comp.connect(ctx.destination);
      g = graph(ctx, master, opts.seed || Date.now()); g.set(last || { space: 1, debris: 0, bodies: [], stations: [] }, 0.05);
      return true;
    }
    function apply() {
      if (!ctx) return;
      var play = on && !hidden, now = ctx.currentTime;
      master.gain.cancelScheduledValues(now); master.gain.setTargetAtTime(play ? VOL : 0, now, play ? 0.4 : 0.12);
      if (play) { if (ctx.state !== 'running') resume(); if (!timer) timer = setInterval(tick, 100); tick(); }
      else { clearInterval(timer); timer = 0; setTimeout(function () { if (ctx && !(on && !hidden)) ctx.suspend(); }, 600); }
    }
    return {
      supported: !!AC,
      get on() { return on; },
      setOn: function (v) { on = !!v; if (on && !ensure()) on = false; apply(); return on; },
      // The page calls this from its draw loop; it is cheap when sound is off.
      update: function (m) { last = m; if (g && on) g.set(m); },
      pause: function (h) { hidden = !!h; apply(); },
      // Browsers start a context suspended until a gesture; call this from one when sound was left on last visit.
      unlock: function () { if (ctx && on && !hidden && ctx.state !== 'running') resume(); },
      state: function () { return { on: on, ctx: ctx ? ctx.state : 'none', voices: g ? g.voices() : [], levels: g ? g.levels() : {} }; }
    };
  }

  return { KEY: KEY, AU_KM: AU_KM, VOLUME: VOLUME, BODY_FULL: BODY_FULL, BODY_NONE: BODY_NONE, STATION_FULL_KM: STATION_FULL_KM, STATION_NONE_KM: STATION_NONE_KM,
    SPACE: SPACE, DEBRIS: DEBRIS, BODIES: BODIES, STATIONS: STATIONS, load: load, save: save, near: near, band: band, mix: mix, graph: graph, create: create };
});
