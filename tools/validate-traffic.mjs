// Headless traffic validation: 5 simulated minutes, assert safety invariants.
import { readFileSync } from 'node:fs';
import { Sim } from '../public/js/traffic/sim.js';

const net = JSON.parse(readFileSync('./data/clane-network.json', 'utf8'));
const sim = new Sim(net, 20261013, 40);

let minPair = Infinity;
let maxLat = 0;
const stoppedTime = new Map(); // vehicle id -> continuous stopped seconds
let maxStopped = 0;
let totalDist = 0;

const STEPS = 18000; // 5 min at 1/60
for (let i = 0; i < STEPS; i++) {
  sim.step(1 / 60);
  const vs = sim.vehicles;
  if (i % 3 === 0) {
    for (let a = 0; a < vs.length; a++) {
      for (let b = a + 1; b < vs.length; b++) {
        const d = Math.hypot(vs[a].x - vs[b].x, vs[a].y - vs[b].y);
        if (d < minPair) minPair = d;
      }
    }
  }
  for (const v of vs) {
    // lateral deviation: distance from lane centreline (account for lane changes)
    let lat = Math.abs(v.lat);
    if (v.changeTarget) {
      lat = Math.min(Math.abs(v.lat), Math.abs(v.lat - v.changeShift));
    }
    if (lat > maxLat) maxLat = lat;
    // stationary tracking
    if (v.v < 0.3) {
      const t = (stoppedTime.get(v.id) ?? 0) + 1 / 60;
      stoppedTime.set(v.id, t);
      if (t > maxStopped) maxStopped = t;
    } else {
      stoppedTime.set(v.id, 0);
    }
  }
}
for (const v of sim.vehicles) totalDist += v.dist;
const avgSpeed = totalDist / (sim.vehicles.length * (STEPS / 60));

console.log('=== Traffic validation (5 sim-minutes, 40 vehicles, seed 20261013) ===');
console.log(`min pairwise distance: ${minPair.toFixed(2)} m (need > 2.2)`);
console.log(`max lateral deviation: ${maxLat.toFixed(2)} m (need < 1.2)`);
console.log(`max continuous stopped: ${maxStopped.toFixed(1)} s (need <= 20)`);
console.log(`avg speed: ${avgSpeed.toFixed(2)} m/s (need > 3)`);

let pass = true;
if (!(minPair > 2.2)) { console.log('FAIL: collision (min pairwise <= 2.2m)'); pass = false; }
if (!(maxLat < 1.2)) { console.log('FAIL: off-lane driving'); pass = false; }
if (!(maxStopped <= 20)) { console.log('FAIL: deadlock (stopped > 20s)'); pass = false; }
if (!(avgSpeed > 3)) { console.log('FAIL: no progress (avg speed <= 3 m/s)'); pass = false; }
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
