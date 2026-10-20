// Ship radio: short spoken callouts for flight events and agent actions, in an AI voice (ElevenLabs), through a radio filter.
// Off until the player turns it on; the choice is remembered per browser. Every line is generated and simulated, and is
// also shown as text on the page, so the page reads the same muted. Clips are stored clean in /assets/audio/radio/ and the
// filter runs here (Web Audio), so it can be tuned without regenerating anything.
// Two sources of speech: the stock phrasebook (lines.json, number-free and place-free) and, later, live clips for the
// agent's own words (radio.url on an entry). Used by the flight page and by the comms panel through Radio.say(entry).
(function (root) {
  "use strict";
  var BASE = "/assets/audio/radio/", KEY = "sf-radio";

  // ---- pure part: which stock line fits an event (unit-tested in node) ----
  var INCIDENT = { dust_storm: "dust-storm", titan_haze: "titan-haze", flare: "flare", solar_flare: "flare", correction_burn: "correction", car_late: "late", pad_full: "pad-full" };
  var DECIDE = { hold: "hold", divert: "divert", replan: "replan", wait: "wait" };
  var n = 0;
  function pick(a, b) { n++; return n % 2 ? a : b; }
  /** A flight-page timeline event ({ kind, cp?, incident? }) or an agent-log entry ({ tool, decision?, error? }) -> a phrasebook key, or null. */
  function keyFor(e) {
    if (!e) return null;
    if (e.tool) {
      if (e.error || e.problems) return "refused";
      if (e.tool === "take_hail") return pick("take-1", "take-2");
      if (e.tool === "decide") return e.decision && DECIDE[e.decision.action] || null;
      return null;
    }
    if (e.kind === "depart") return e.pickup ? pick("depart-1", "depart-2") : "pickup";
    if (e.kind === "arrive") return e.pickup ? null : pick("arrive-1", "arrive-2");
    if (e.kind === "checkpoint") { var k = e.cp && e.cp.kind; return k === "launch_hold" ? "cp-launch-hold" : k === "pad_closed" ? "cp-pad-closed" : null; }
    if (e.kind === "incident") return INCIDENT[e.incident] || null;
    return null;
  }
  /** The radio object for a key: { key, text, level, src }, or null when the line is unknown. */
  function lineFor(key, lines) {
    var L = key && lines && lines[key];
    return L ? { key: key, text: L.text, level: L.level, src: L.src } : null;
  }

  // ---- audio part (browser only) ----
  var ctx = null, out = null, lines = null /* promise of the phrasebook */, queue = [], busy = false, seen = {}, buffers = {}, on = false;
  try { on = !!root.localStorage && root.localStorage.getItem(KEY) === "on"; } catch (e) { on = false; }
  function hasAudio() { return typeof root.AudioContext === "function" || typeof root.webkitAudioContext === "function"; }
  function load() { // once per page; the promise is shared so a burst of cues fetches the phrasebook a single time
    if (typeof fetch !== "function") return Promise.resolve(null);
    return lines = lines || fetch(BASE + "lines.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { return j && j.lines || {}; }).catch(function () { return {}; });
  }
  function noise(sec) {
    var b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * sec), ctx.sampleRate), d = b.getChannelData(0), x = 0;
    for (var i = 0; i < d.length; i++) { x = 0.97 * x + 0.03 * (Math.random() * 2 - 1); d[i] = x * 6 + (Math.random() * 2 - 1) * 0.15; }
    return b;
  }
  function band(node) { // radio band: two high-pass and two low-pass stages, a presence lift, soft clipping, then a compressor
    var t = node, mk = function (type, f, q, g) { var b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; if (g) b.gain.value = g; t.connect(b); t = b; };
    mk("highpass", 380); mk("highpass", 380); mk("lowpass", 3200); mk("lowpass", 3200); mk("peaking", 1800, 1.2, 5);
    var ws = ctx.createWaveShaper(), c = new Float32Array(1024);
    for (var i = 0; i < c.length; i++) { var v = i / 511.5 - 1; c[i] = Math.tanh(2.2 * v) / Math.tanh(2.2); }
    ws.curve = c; t.connect(ws);
    var comp = ctx.createDynamicsCompressor(); comp.threshold.value = -24; comp.ratio.value = 6; ws.connect(comp);
    return comp;
  }
  function burst(at, sec, gain) { // squelch: a short band-limited noise burst with a click edge
    var s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = noise(sec);
    g.gain.setValueAtTime(gain, at); g.gain.exponentialRampToValueAtTime(0.001, at + sec);
    band(s).connect(g); g.connect(out); s.start(at); s.stop(at + sec + 0.02);
  }
  function chirp(at) { // two-tone alert ahead of an emergency call
    [880, 660].forEach(function (f, i) {
      var o = ctx.createOscillator(), g = ctx.createGain(), t0 = at + i * 0.16; o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.18, t0 + 0.01); g.gain.linearRampToValueAtTime(0, t0 + 0.13);
      o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 0.15);
    });
    return at + 0.36;
  }
  function fetchClip(url) {
    if (buffers[url]) return buffers[url];
    return buffers[url] = fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(function (a) { return new Promise(function (ok, no) { ctx.decodeAudioData(a, ok, no); }); });
  }
  function next() {
    if (busy || !on || !ctx) return;
    var it = queue.shift(); if (!it) return;
    busy = true;
    fetchClip(it.url).then(function (buf) {
      if (!on) { busy = false; return; }
      var t = ctx.currentTime + 0.05;
      if (it.level === "emergency") t = chirp(t);
      burst(t, 0.12, 0.35);
      var s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = buf; g.gain.value = 1.4;
      band(s).connect(g); g.connect(out);
      var hiss = ctx.createBufferSource(), hg = ctx.createGain(); hiss.buffer = noise(buf.duration + 0.2); hg.gain.value = 0.025;
      band(hiss).connect(hg); hg.connect(out);
      s.start(t + 0.12); hiss.start(t + 0.1);
      var end = t + 0.12 + buf.duration; burst(end, 0.2, 0.3);
      s.onended = function () { setTimeout(function () { busy = false; next(); }, 450); };
    }).catch(function () { busy = false; next(); });
  }
  function enqueue(radio) {
    var url = radio.url || (radio.key ? BASE + radio.key + ".mp3" : null);
    if (!url) return;
    var it = { url: url, level: radio.level || "routine" };
    if (it.level === "emergency") { queue = queue.filter(function (q) { return q.level === "emergency"; }); queue.unshift(it); } // emergencies jump the line
    else if (queue.length < 2) queue.push(it); // at high replay speed, drop routine chatter rather than fall behind
    next();
  }

  var api = {
    keyFor: keyFor, lineFor: lineFor,
    available: hasAudio,
    /** True once the player has turned it on in this page (a click started the audio). */
    enabled: function () { return on && !!ctx; },
    /** The remembered choice from an earlier visit; turning it back on still needs a click. */
    wanted: function () { return on; },
    /** Turn the radio on or off. Call from a click: browsers only start audio after a user gesture. */
    setEnabled: function (v) {
      on = !!v;
      try { root.localStorage && root.localStorage.setItem(KEY, on ? "on" : "off"); } catch (e) { /* private mode: not remembered */ }
      if (on && !ctx && hasAudio()) {
        ctx = new (root.AudioContext || root.webkitAudioContext)();
        out = ctx.createGain(); out.gain.value = 0.8; out.connect(ctx.destination);
      }
      if (ctx) { if (on) ctx.resume(); else { queue = []; ctx.suspend(); } }
      if (on) load();
      return on;
    },
    /** Speak a comms entry { id, radio: { key? | url?, text, level, src } } once. Returns the radio object or null. */
    say: function (entry) {
      if (!entry || !entry.radio || !on || !ctx) return null;
      if (entry.id != null) { if (seen[entry.id]) return null; seen[entry.id] = 1; }
      enqueue(entry.radio); return entry.radio;
    },
    /** Speak the stock line for a flight event or agent-log entry, if one fits. */
    cue: function (e, id) {
      if (!on || !ctx) return null;
      return load().then(function (L) { var r = lineFor(keyFor(e), L); return r ? api.say({ id: id, radio: r }) : null; });
    },
    stop: function () { queue = []; },
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", function () { if (ctx && on) { if (document.hidden) { queue = []; ctx.suspend(); } else ctx.resume(); } });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Radio = api;
})(typeof self !== "undefined" ? self : this);
