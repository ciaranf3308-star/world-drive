// Tests for tools/lib/markings.mjs — run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { markingsForSegment, nearJunctionRanges } from '../tools/lib/markings.mjs';
import { laneOffsetM, offsetPolyline } from '../tools/lib/lanes.mjs';

function lane(id, dir, index, wayPts, width) {
  const off = laneOffsetM(dir, index, width);
  return { id, dir, index, offsetM: off, centreline: offsetPolyline(wayPts, off) };
}
function seg(id, wayPts, opts = {}) {
  const { highway = 'secondary', oneway = false, roundabout = false, lanesPerDir = 1, width = 3 } = opts;
  const dirs = oneway || roundabout ? [1] : [1, -1];
  const lanes = [];
  for (const d of dirs) for (let i = 0; i < lanesPerDir; i++)
    lanes.push(lane(`${id}_${d > 0 ? 'f' : 'b'}${i}`, d, i, wayPts, width));
  return { id, highway, oneway, roundabout, lanesPerDir, laneWidthM: width, centreline: wayPts, lanes };
}
const emptyCtx = () => ({ junctionPoints: [], laneControl: new Map(), laneMoves: new Map() });
const types = ms => new Set(ms.map(m => m.type));

test('two-way single carriageway gets dashed centre, no double solid away from junctions', () => {
  const ms = markingsForSegment(seg('S1', [[0, 0], [200, 0]]), emptyCtx());
  const t = types(ms);
  assert.ok(t.has('centre-dashed'), 'dashed centre line');
  assert.ok(!t.has('centre-double-solid'), 'no double solid mid-block');
  assert.ok(t.has('edge-solid'), 'edge lines on classified road');
});

test('double solid centre appears near junctions (no-overtaking zone)', () => {
  const ctx = emptyCtx();
  ctx.junctionPoints = [[200, 0]];
  const ms = markingsForSegment(seg('S1', [[0, 0], [200, 0]]), ctx);
  assert.ok(types(ms).has('centre-double-solid'), 'double solid within 20m of junction');
});

test('dual carriageway gets full double-solid centre', () => {
  const ms = markingsForSegment(seg('S1', [[0, 0], [200, 0]], { lanesPerDir: 2 }), emptyCtx());
  const t = types(ms);
  assert.ok(t.has('centre-double-solid'));
  assert.ok(!t.has('centre-dashed'));
  assert.ok(t.has('lane-dash'), 'separators between same-direction lanes');
});

test('service roads get no edge lines (Irish minor roads often unmarked)', () => {
  const ms = markingsForSegment(seg('S1', [[0, 0], [100, 0]], { highway: 'service' }), emptyCtx());
  assert.ok(!types(ms).has('edge-solid'));
});

test('no American yellow centre lines — only white marking types exist', () => {
  const ms = markingsForSegment(seg('S1', [[0, 0], [200, 0]], { lanesPerDir: 2 }), emptyCtx());
  const allowed = new Set(['centre-dashed', 'centre-double-solid', 'lane-dash', 'edge-solid',
    'stop-line', 'yield-line', 'yield-triangle', 'arrow', 'text']);
  for (const m of ms) assert.ok(allowed.has(m.type), `unexpected marking type ${m.type}`);
});

test('stop control -> stop line + STOP text; all markings honest (inferred)', () => {
  const s = seg('S1', [[0, 0], [100, 0]], { highway: 'residential' });
  const ctx = emptyCtx();
  ctx.laneControl.set('S1_f0', { kind: 'stop', jx: 100, jy: 0, roundaboutEntry: false });
  const ms = markingsForSegment(s, ctx);
  const t = types(ms);
  assert.ok(t.has('stop-line'), 'stop line drawn');
  const txt = ms.find(m => m.type === 'text');
  assert.ok(txt && txt.text === 'STOP', 'STOP road text');
  for (const m of ms) assert.equal(m.confidence, 'inferred', `${m.type} must be honest`);
});

test('yield control -> dashed line + triangle (not a stop line)', () => {
  const s = seg('S1', [[0, 0], [100, 0]], { highway: 'residential' });
  const ctx = emptyCtx();
  ctx.laneControl.set('S1_f0', { kind: 'yield', jx: 100, jy: 0, roundaboutEntry: false });
  const ms = markingsForSegment(s, ctx);
  const t = types(ms);
  assert.ok(t.has('yield-line') && t.has('yield-triangle'));
  assert.ok(!t.has('stop-line'));
});

test('roundabout entry -> double give-way dashes, no triangle', () => {
  const s = seg('S1', [[0, 0], [60, 0]], { highway: 'secondary' });
  const ctx = emptyCtx();
  ctx.laneControl.set('S1_f0', { kind: 'yield', jx: 60, jy: 0, roundaboutEntry: true });
  const ms = markingsForSegment(s, ctx);
  const yl = ms.filter(m => m.type === 'yield-line');
  assert.equal(yl.length, 2, 'Irish double-row give-way dashes');
  assert.ok(!types(ms).has('yield-triangle'));
});

test('multi-move approach gets direction arrow', () => {
  const s = seg('S1', [[0, 0], [100, 0]]);
  const ctx = emptyCtx();
  ctx.laneMoves.set('S1_f0', { jx: 100, jy: 0, moves: ['left', 'through'], roundaboutEntry: false });
  const ms = markingsForSegment(s, ctx);
  const a = ms.find(m => m.type === 'arrow');
  assert.ok(a, 'arrow present');
  assert.deepEqual(a.moves, ['left', 'through']);
  assert.ok(typeof a.headingDeg === 'number');
});

test('nearJunctionRanges clips sub-polylines near junctions', () => {
  const pts = [[0, 0], [50, 0], [100, 0], [150, 0], [200, 0]];
  const r = nearJunctionRanges(pts, [[200, 0]], 20);
  assert.equal(r.length, 1);
  assert.ok(r[0].length >= 2);
  const r2 = nearJunctionRanges(pts, [[1000, 0]], 20);
  assert.equal(r2.length, 0);
});
