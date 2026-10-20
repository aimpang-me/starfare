/* What the map and the flight page draw: names, lines and the time readout. One state object, saved under one key so
   a choice made on the sky map still holds on the flight page. Pure, so it runs in node for tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SolLayers = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var KEY = 'sf-layers';
  // pln planet names, plc moon / station / place names, shp Starseeker names, orb orbit lines, moon moon orbit rings,
  // rte path lines, ring distance grid, hud time readout, rsel path lines for the selected flight only, trf background
  // traffic density (off, light or busy; see sol-traffic.js).
  var DEFAULTS = { pln: true, plc: true, shp: true, orb: true, moon: true, rte: true, ring: false, hud: true, rsel: false, size: 'm', trf: 'busy' };
  var TRAFFIC = { off: 1, light: 1, busy: 1 };
  var CLEAN = ['pln', 'plc', 'shp', 'orb', 'moon', 'rte', 'ring'];
  // Label font size as a multiple of the stylesheet's size.
  var SIZES = { s: 0.85, m: 1, l: 1.2 };

  function normalize(saved) {
    var s = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      var v = saved && typeof saved === 'object' ? saved[k] : undefined;
      s[k] = k === 'size' ? (SIZES[v] ? v : DEFAULTS.size) : k === 'trf' ? (TRAFFIC[v] ? v : DEFAULTS.trf) : typeof v === 'boolean' ? v : DEFAULTS[k];
    });
    return s;
  }
  function isClean(s) { return CLEAN.every(function (k) { return !s[k]; }); }
  // Clean view hides every name and line; a second press restores what was showing (or the defaults if nothing was).
  function toggleClean(s, before) {
    if (isClean(s)) return { state: normalize(Object.assign({}, before || DEFAULTS, { hud: s.hud, size: s.size, rsel: s.rsel, trf: s.trf })), before: null };
    var next = Object.assign({}, s); CLEAN.forEach(function (k) { next[k] = false; });
    return { state: next, before: Object.assign({}, s) };
  }
  // Does a flight or booking draw its path? With rsel on, only the selected one does.
  function showPath(s, selected) { return !!s.rte && (!s.rsel || !!selected); }
  function load(storage) { try { return normalize(JSON.parse(storage.getItem(KEY) || 'null')); } catch (e) { return normalize(null); } }
  function save(storage, s) { try { storage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private window or blocked site data */ } }

  return { KEY: KEY, DEFAULTS: DEFAULTS, CLEAN: CLEAN, SIZES: SIZES, normalize: normalize, isClean: isClean, toggleClean: toggleClean,
    showPath: showPath, load: load, save: save };
});
