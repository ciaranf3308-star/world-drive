// Traffic simulation tests — run with: node --test tests/ (pretest runs tsc)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { idmAccel, CAR_IDM, VAN_IDM } from '../public/js/traffic/idm.js';
import { mobilDecision, MOBIL_DEFAULT } from '../public/js/traffic/mobil.js';
import { planRoute } from '../public/js/traffic/router.js';
import { buildNetIndex } from '../public/js/traffic/index.js';
import { junctionDecision, controlRank } from '../public/js/traffic/driver.js';
import { Sim } from '../public/js/traffic/sim.js';

const net = JSON.parse(readFileSync('./data/clane-network.json', 'utf8'));
const idx = buildNetIndex(net);

// --- IDM ---
test('IDM: free road accelerates towards v0', () => {
  const a = idmAccel(5, 14, 1000, 0, CAR_IDM);
  assert.ok(a > 0.5 && a <= CAR_IDM.a, `accel ${a}`);
});

test('IDM: stops for stationary leader (does not pass through)', () => {
  // bumper gap 1m, stopped leader: must brake hard
  const a = idmAccel(10, 14, 1, 10, CAR_IDM);
  assert.ok(a < -3, `accel ${a} should be strong braking`);
});

test('IDM: follows at safe gap (small accel near equilibrium)', () => {
  const a = idmAccel(10, 14, 25, 0, CAR_IDM);
  assert.ok(Math.abs(a) < 1.5, `accel ${a}`);
});

test('IDM: van accelerates slower than car', () => {
  const ac = idmAccel(5, 14, 1000, 0, CAR_IDM);
  const av = idmAccel(5, 14, 1000, 0, VAN_IDM);
  assert.ok(av < ac, `van ${av} vs car ${ac}`);
});

// --- MOBIL ---
test('MOBIL: changes when beneficial and safe', () => {
  const r = mobilDecision({
    myAccel: 0.2, myNewAccel: 1.0,
    oldFollowerAccel: 0, oldFollowerNewAccel: 0,
    newFollowerAccel: -0.5, newFollowerNewAccel: -0.5,
  }, MOBIL_DEFAULT);
  assert.ok(r.change, 'should change');
});

test('MOBIL: refuses when unsafe for new follower', () => {
  const r = mobilDecision({
    myAccel: 0.2, myNewAccel: 1.0,
    oldFollowerAccel: 0, oldFollowerNewAccel: 0,
    newFollowerAccel: -0.5, newFollowerNewAccel: -5.0, // would force hard brake
  }, MOBIL_DEFAULT);
  assert.ok(!r.change, 'should not change when unsafe');
});

test('MOBIL: refuses when incentive below threshold', () => {
  const r = mobilDecision({
    myAccel: 0.9, myNewAccel: 1.0, // tiny gain
    oldFollowerAccel: 0, oldFollowerNewAccel: 0,
    newFollowerAccel: -0.5, newFollowerNewAccel: -0.5,
  }, MOBIL_DEFAULT);
  assert.ok(!r.change, 'should not change for negligible gain');
});

// --- Router (real Clane data) ---
test('router: route exists between two known Clane lanes', () => {
  // L9_b0 and L9_f0 are opposite directions of the same road; route via network
  const ids = [...idx.lanes.keys()];
  const a = ids[0], b = ids[100];
  const r = planRoute(idx, a, b, 0);
  assert.ok(r && r.length > 1, `route ${a} -> ${b}`);
  assert.equal(r[0].laneId, a);
  assert.equal(r[r.length - 1].laneId, b);
});

test('router: same lane returns single step', () => {
  const ids = [...idx.lanes.keys()];
  const r = planRoute(idx, ids[0], ids[0]);
  assert.ok(r && r.length === 1);
});

test('router: respects position (first turn ahead)', () => {
  // Find a lane with an event; plan from beyond it — first turn must be ahead
  for (const [lid, evs] of idx.events) {
    if (evs.length === 0) continue;
    const lane = idx.lanes.get(lid);
    const fromS = Math.min(lane.length - 1, evs[0].arc + 10);
    const dest = [...idx.lanes.keys()].find(id => id !== lid);
    const r = planRoute(idx, lid, dest, fromS);
    if (r && r.length > 1) {
      const firstVia = r[1].via;
      if (firstVia) {
        const arc = evs.find(e => e.junctionId === firstVia)?.arc;
        assert.ok(arc === undefined || arc >= fromS - 3, 'first turn must be ahead');
      }
      break;
    }
  }
});

// --- Driver priority ---
test('driver: stop rank outranks uncontrolled', () => {
  assert.ok(controlRank('stop') < controlRank(undefined), 'stop should go first (lower rank = higher priority)');
});

test('driver: committed vehicle blocks others', () => {
  const d = junctionDecision({
    time: 0, myId: 1, myKind: undefined, myRank: 3, myEta: 2, myWaitStart: null,
    myHeading: 0, myX: 0, myY: 0, occupied: false, circulatingNear: false,
    others: [{ id: 2, x: 5, y: 0, v: 5, heading: 0, eventJunction: 'J1', eta: 1, rank: 3, kind: undefined, waitStart: null, committed: true }],
  });
  assert.equal(d, 'wait', 'must wait for committed vehicle');
});

// --- Determinism ---
test('sim: same seed -> identical trajectories', () => {
  const s1 = new Sim(net, 777, 10);
  const s2 = new Sim(net, 777, 10);
  for (let i = 0; i < 600; i++) { s1.step(1 / 60); s2.step(1 / 60); }
  for (let i = 0; i < 10; i++) {
    const a = s1.vehicles[i], b = s2.vehicles[i];
    assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9, `vehicle ${i} diverged`);
    assert.ok(Math.abs(a.v - b.v) < 1e-9, `vehicle ${i} speed diverged`);
  }
});

// --- Headless scenario: priority at yield ---
test('sim: smoke — 40 vehicles run 60s without errors', () => {
  const sim = new Sim(net, 20261013, 40);
  for (let i = 0; i < 3600; i++) sim.step(1 / 60);
  assert.equal(sim.vehicles.length, 40);
  assert.ok(sim.avgSpeed() > 1, `avg speed ${sim.avgSpeed()}`);
});
