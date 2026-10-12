// Tests for tools/lib/proj.mjs — run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFrame } from '../tools/lib/proj.mjs';

const frame = makeFrame(53.2925, -6.6880);

test('origin maps to (0,0)', () => {
  const [x, y] = frame.toLocal(53.2925, -6.6880);
  assert.ok(Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9);
});

test('1 degree of latitude = R*pi/180 metres', () => {
  const [, y] = frame.toLocal(54.2925, -6.6880);
  const expected = 6378137 * Math.PI / 180;
  assert.ok(Math.abs(y - expected) < 1, `got ${y}, expected ${expected}`);
});

test('round trip lat/lon is stable', () => {
  const [x, y] = frame.toLocal(53.295, -6.690);
  const [lat, lon] = frame.toLatLon(x, y);
  assert.ok(Math.abs(lat - 53.295) < 1e-9 && Math.abs(lon + 6.690) < 1e-9);
});

test('east is +x, north is +y', () => {
  const [x] = frame.toLocal(53.2925, -6.6870);
  const [, y] = frame.toLocal(53.2935, -6.6880);
  assert.ok(x > 0 && y > 0);
});

test('Clane bbox spans ~2.7km', () => {
  const [x0] = frame.toLocal(53.2925, -6.708);
  const [x1] = frame.toLocal(53.2925, -6.668);
  const w = x1 - x0;
  assert.ok(w > 2400 && w < 2900, `got ${w}`);
});
