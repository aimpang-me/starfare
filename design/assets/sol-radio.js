// Ship radio: short spoken callouts for flight events and agent actions, in an AI voice (ElevenLabs), through a clean comms filter.
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
    if (e.kind === "incident") return INCIDENT[e.incident || e.cause] || null;
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
  // Clean digital comms (Alvin, 2026-10-20: "this is the future", no white noise): a gentle band-limit, a presence lift and
  // light compression for the communications feel, with a soft open-channel blip before a call and a roger beep after it.
  function band(node) {
    var t = node, mk = function (type, f, q, g) { var b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; if (g) b.gain.value = g; t.connect(b); t = b; };
    mk("highpass", 180, 0.7); mk("lowpass", 6500, 0.7); mk("peaking", 2500, 1, 3); mk("lowshelf", 300, 0, -3);
    var comp = ctx.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.12; t.connect(comp);
    return comp;
  }
  function tone(at, f0, f1, sec, gain) { // a short sine blip, optionally sliding in pitch
    var o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sine";
    o.frequency.setValueAtTime(f0, at); o.frequency.linearRampToValueAtTime(f1, at + sec);
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + 0.008); g.gain.setValueAtTime(gain, at + sec - 0.015); g.gain.linearRampToValueAtTime(0, at + sec);
    o.connect(g); g.connect(out); o.start(at); o.stop(at + sec + 0.01);
  }
  function openCh(at) { tone(at, 1250, 1650, 0.06, 0.09); return at + 0.14; }
  function roger(at) { tone(at, 1450, 1450, 0.05, 0.08); tone(at + 0.07, 1050, 1050, 0.06, 0.08); }
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
      t = openCh(t);
      var s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = buf; g.gain.value = 1.2;
      band(s).connect(g); g.connect(out);
      s.start(t); roger(t + buf.duration + 0.08);
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
