import test from 'node:test';
import assert from 'node:assert/strict';
import Map from '../../design/assets/solar-map.js';

for (const [width, height] of [[1440, 790], [1191, 903], [900, 700], [390, 742], [360, 638]]) {
  test(`whole system fits the unobstructed canvas at ${width}x${height}`, () => {
    const frame = Map.frame(width, height, {});
    const distance = Map.fitDistance(65, .62, width, height, frame);
    const view = Map.projection(distance, width, height, frame);
    assert.ok(130 / view.unitsPerPixel <= frame.width + .001);
    assert.ok((130 * Math.sin(.62) + 10) / view.unitsPerPixel <= frame.height + .001);
    assert.ok(frame.x >= 0 && frame.y >= 0);
    assert.ok(frame.x + frame.width <= width && frame.y + frame.height <= height);
  });
}
test('strategic projection keeps pixel scale independent of object depth', () => {
  const frame = Map.frame(1440, 790, {});
  const view = Map.projection(150, 1440, 790, frame);
  assert.equal(view.unitsPerPixel, (view.top - view.bottom) / 790);
  assert.ok(Math.abs(view.right / view.top - 1440 / 790) < 1e-12);
  assert.equal(view.offsetX, 720 - (frame.x + frame.width / 2));
  assert.equal(view.offsetY, 395 - (frame.y + frame.height / 2));
});
test('collapsing mobile bookings gives the solar system more vertical room', () => {
  const open = Map.frame(390, 742, {}), collapsed = Map.frame(390, 742, { collapsed: true });
  assert.ok(collapsed.height > open.height + 150);
});
test('hiding panels removes their reserved space', () => {
  const open = Map.frame(1440, 790, {}), hidden = Map.frame(1440, 790, { panelsHidden: true });
  assert.ok(hidden.width > open.width);
  assert.equal(hidden.x, 24);
});
