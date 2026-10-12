// Tests for tools/lib/lanes.mjs — run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLaneCount, speedLimitKmh, laneOffsetM, offsetPolyline } from '../tools/lib/lanes.mjs';

test('lanes tag is verified', () => {
  const r = parseLaneCount({ lanes: '2' }, 'primary');
  assert.equal(r.perDir, 1);
  assert.equal(r.confidence, 'verified');
});

test('lanes tag on oneway uses total', () => {
  const r = parseLaneCount({ lanes: '2', oneway: 'yes' }, 'motorway');
  assert.equal(r.perDir, 2);
});

test('missing lanes tag infers from class', () => {
  const r = parseLaneCount({}, 'residential');
  assert.equal(r.perDir, 1);
  assert.equal(r.confidence, 'inferred');
  const m = parseLaneCount({}, 'motorway');
  assert.equal(m.perDir, 2);
});

test('maxspeed tag is verified, mph converted', () => {
  const a = speedLimitKmh({ maxspeed: '50' }, 'residential');
  assert.equal(a.kmh, 50); assert.equal(a.confidence, 'verified');
  const b = speedLimitKmh({ maxspeed: '60 mph' }, 'trunk');
  assert.equal(b.kmh, 97); // 60mph = 96.56 -> 97
});

test('missing maxspeed infers Irish default', () => {
  const r = speedLimitKmh({}, 'motorway');
  assert.equal(r.kmh, 120); assert.equal(r.confidence, 'inferred');
});

test('left-hand traffic: forward lane offset is left of travel direction', () => {
  // heading north (0,1): left = west = -x
  const pts = [[0, 0], [0, 100]];
  const off = offsetPolyline(pts, laneOffsetM(1, 0, 3.5));
  assert.ok(off[0][0] < -1, `expected negative x, got ${off[0][0]}`);
  // backward lane: right of forward = east
  const offB = offsetPolyline(pts, laneOffsetM(-1, 0, 3.5));
  assert.ok(offB[0][0] > 1, `expected positive x, got ${offB[0][0]}`);
});
