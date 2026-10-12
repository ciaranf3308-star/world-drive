// Tests for tools/lib/topology.mjs — run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  turnAngleDeg, classifyTurn, highwayRank, nearestOnPolyline, headingAtArc,
  parseRestrictions, buildJunctionTopology,
} from '../tools/lib/topology.mjs';
import { laneOffsetM, offsetPolyline } from '../tools/lib/lanes.mjs';

test('turnAngleDeg: positive = left turn', () => {
  assert.equal(turnAngleDeg(1, 0, 0, 1), 90);   // east -> north = left
  assert.equal(turnAngleDeg(1, 0, 0, -1), -90); // east -> south = right
  assert.equal(turnAngleDeg(0, 1, 0, 1), 0);    // straight
  assert.equal(Math.abs(turnAngleDeg(1, 0, -1, 0)), 180);
});

test('classifyTurn thresholds', () => {
  assert.equal(classifyTurn(0), 'through');
  assert.equal(classifyTurn(29), 'through');
  assert.equal(classifyTurn(45), 'left');
  assert.equal(classifyTurn(-45), 'right');
  assert.equal(classifyTurn(150), 'uturn');
  assert.equal(classifyTurn(-170), 'uturn');
});

test('highwayRank ordering', () => {
  assert.ok(highwayRank('motorway') > highwayRank('primary'));
  assert.ok(highwayRank('primary') > highwayRank('secondary'));
  assert.ok(highwayRank('secondary') > highwayRank('residential'));
  assert.ok(highwayRank('residential') > highwayRank('service'));
  assert.equal(highwayRank('motorway_link'), highwayRank('motorway'));
});

test('nearestOnPolyline finds closest point and arc length', () => {
  const r = nearestOnPolyline([[0, 0], [10, 0], [10, 10]], 10, 3);
  assert.ok(Math.abs(r.dist) < 1e-9);
  assert.ok(Math.abs(r.arcLen - 13) < 1e-9);
  assert.ok(Math.abs(r.totalLen - 20) < 1e-9);
});

test('headingAtArc respects lane direction', () => {
  const pts = [[0, 0], [10, 0]];
  const f = headingAtArc(pts, 1, 5);
  assert.ok(f.hx > 0.99 && Math.abs(f.hy) < 1e-9);
  const b = headingAtArc(pts, -1, 5); // same arc pos, opposite travel
  assert.ok(b.hx < -0.99);
});

// --- synthetic T-junction: WE road (two-way) crossed by S road (oneway north)
function lane(id, segId, dir, index, wayPts, width) {
  const off = laneOffsetM(dir, index, width);
  return { id, dir, index, offsetM: off, centreline: offsetPolyline(wayPts, off) };
}
function tSeg(id, wayId, wayPts, opts = {}) {
  const { highway = 'secondary', oneway = false, roundabout = false, lanesPerDir = 1, width = 3 } = opts;
  const dirs = oneway || roundabout ? [1] : [1, -1];
  const lanes = [];
  for (const d of dirs) for (let i = 0; i < lanesPerDir; i++)
    lanes.push(lane(`${id}_${d > 0 ? 'f' : 'b'}${i}`, id, d, i, wayPts, width));
  return { id, osmWayId: wayId, highway, oneway, roundabout, lanesPerDir, laneWidthM: width, centreline: wayPts, lanes };
}

test('T-junction: left/right/through classified for left-hand traffic', () => {
  const we = tSeg('S_WE', 101, [[-100, 0], [100, 0]]);
  const sn = tSeg('S_SN', 102, [[0, -100], [0, 0]], { oneway: true });
  const j = { id: 'J1', nodeId: 9001, x: 0, y: 0, wayIds: [101, 102], degree: 2 };
  const topo = buildJunctionTopology([we, sn], new Map(), [j],
    new Map([[101, 'S_WE'], [102, 'S_SN']]), new Map());
  const t = topo.get('J1');
  const kinds = new Map();
  for (const c of t.connections) kinds.set(c.from + '->' + c.to, c.kind);
  // heading east, turn to north = LEFT (left-hand traffic)
  assert.equal(kinds.get('S_WE_f0->S_SN_f0'), 'left');
  // heading east, continue east
  assert.equal(kinds.get('S_WE_f0->S_WE_f0'), 'through');
  // heading north, turn to east = RIGHT
  assert.equal(kinds.get('S_SN_f0->S_WE_f0'), 'right');
  // heading north, turn to west = LEFT
  assert.equal(kinds.get('S_SN_f0->S_WE_b0'), 'left');
  // no U-turns at ordinary junctions
  assert.ok(![...kinds.values()].includes('uturn'), 'uturn excluded');
  // oneway respected: no connections TO a backward lane of the oneway road
  assert.ok(![...kinds.keys()].some(k => k.endsWith('->S_SN_b0')));
});

test('minor road yields to major road (inferred control)', () => {
  const major = tSeg('S_MAJ', 201, [[-100, 0], [100, 0]], { highway: 'primary' });
  const minor = tSeg('S_MIN', 202, [[0, -100], [0, 100]], { highway: 'residential' });
  const j = { id: 'J2', nodeId: 9002, x: 0, y: 0, wayIds: [201, 202], degree: 2 };
  const topo = buildJunctionTopology([major, minor], new Map(), [j],
    new Map([[201, 'S_MAJ'], [202, 'S_MIN']]), new Map());
  const t = topo.get('J2');
  const minorCtls = t.controls.filter(c => c.segId === 'S_MIN');
  const majorCtls = t.controls.filter(c => c.segId === 'S_MAJ');
  assert.ok(minorCtls.length > 0, 'minor approaches controlled');
  assert.ok(minorCtls.every(c => c.kind === 'stop' || c.kind === 'yield'));
  assert.ok(minorCtls.every(c => c.confidence === 'inferred'));
  assert.equal(majorCtls.length, 0, 'major road keeps priority');
});

test('roundabout: entries yield, circulation connects', () => {
  const ring = tSeg('S_RING', 301, [[0, 20], [40, 20], [40, 60], [0, 60], [0, 20]],
    { roundabout: true, highway: 'secondary' });
  const entry = tSeg('S_ENT', 302, [[-60, 20], [0, 20]]);
  const j = { id: 'J3', nodeId: 9003, x: 0, y: 20, wayIds: [301, 302], degree: 2 };
  const topo = buildJunctionTopology([ring, entry], new Map(), [j],
    new Map([[301, 'S_RING'], [302, 'S_ENT']]), new Map());
  const t = topo.get('J3');
  const kinds = t.connections.map(c => c.kind);
  assert.ok(kinds.includes('roundabout-entry'), 'entry connects onto ring');
  assert.ok(kinds.includes('roundabout-exit'), 'ring connects to exit');
  assert.ok(kinds.includes('circulate'), 'ring continues through junction');
  const entryCtl = t.controls.find(c => c.segId === 'S_ENT');
  assert.ok(entryCtl && entryCtl.kind === 'yield', 'entry yields to circulating traffic');
  // ring itself is not asked to yield
  assert.ok(!t.controls.some(c => c.segId === 'S_RING'));
});

test('parseRestrictions: no_left_turn removes the matching connection', () => {
  const we = tSeg('S_WE', 101, [[-100, 0], [100, 0]]);
  const sn = tSeg('S_SN', 102, [[0, -100], [0, 0]], { oneway: true });
  const j = { id: 'J1', nodeId: 9001, x: 0, y: 0, wayIds: [101, 102], degree: 2 };
  const segByWay = new Map([[101, 'S_WE'], [102, 'S_SN']]);
  const elements = [{
    type: 'relation', id: 5001,
    tags: { type: 'restriction', restriction: 'no_left_turn' },
    members: [
      { type: 'way', ref: 101, role: 'from' },
      { type: 'node', ref: 9001, role: 'via' },
      { type: 'way', ref: 102, role: 'to' },
    ],
  }];
  const restr = parseRestrictions(elements);
  assert.ok(restr.has(9001), 'restriction indexed by via node');
  const topo = buildJunctionTopology([we, sn], new Map(), [j], segByWay, restr);
  const kinds = new Map(topo.get('J1').connections.map(c => [c.from + '->' + c.to, c.kind]));
  assert.ok(![...kinds.entries()].some(([k, v]) => v === 'left' && k.startsWith('S_WE_f0->S_SN')),
    'verified no_left_turn removes the left turn');
  assert.equal(kinds.get('S_WE_f0->S_WE_f0'), 'through', 'other moves survive');
});
