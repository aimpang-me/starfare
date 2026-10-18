/* Strategic map presentation only. No ephemeris, replay or simulation state. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StarfareMap = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var TAN = Math.tan(Math.PI / 8);
  function frame(width, height, state) {
    state = state || {};
    var mobile = width <= 760, hidden = state.panelsHidden;
    var left = mobile ? 16 : hidden ? 24 : width <= 1100 ? 286 : 300;
    var right = mobile ? 16 : 24, top = mobile ? 126 : 100;
    var sheet = hidden ? 0 : state.collapsed ? 44 : Math.max(142, height * .31);
    var bottom = mobile ? sheet + (state.selection ? 166 : 140) : 116;
    return { x: left, y: top, width: Math.max(1, width - left - right), height: Math.max(1, height - top - bottom) };
  }
  function projection(distance, width, height, frame) {
    var halfY = distance * TAN, halfX = halfY * width / height;
    return { left: -halfX, right: halfX, top: halfY, bottom: -halfY,
      unitsPerPixel: halfY * 2 / height,
      offsetX: width / 2 - (frame.x + frame.width / 2),
      offsetY: height / 2 - (frame.y + frame.height / 2) };
  }
  function fitDistance(radius, elevation, width, height, frame) {
    var diameter = radius * 2, vertical = diameter * Math.abs(Math.sin(elevation)) + 10;
    var ppu = Math.min(frame.width / diameter, frame.height / vertical);
    return height / (2 * TAN * ppu);
  }
  return { frame: frame, projection: projection, fitDistance: fitDistance };
});
