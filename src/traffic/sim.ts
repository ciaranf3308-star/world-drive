// Fixed-timestep deterministic traffic simulation. DOM-free: runs in node.
// 40 vehicles follow real lane centrelines, obey Irish priority controls,
// change lanes (MOBIL), and yield at roundabouts.
import { RoadNetwork } from '../road/types.js';
import { NetIndex, Vehicle, LaneEvent, IndexedLane } from './types.js';
import { buildNetIndex, neighbourLanes, crossesDoubleSolid, travelArc, eventArcFor } from './index.js';
import { planRoute } from './router.js';
import { idmAccel, CAR_IDM, VAN_IDM, IdmParams } from './idm.js';
import { mobilDecision, MOBIL_DEFAULT } from './mobil.js';
import { mulberry32, pick } from './rng.js';
import { pointAtArc, tangentAtArc } from './geom.js';
import { junctionDecision, controlRank, indicatorFor, stopLineAccel, OtherVeh } from './driver.js';

export const SIM_DT = 1 / 60;
const JUNCTION_RADIUS = 9;      // conflict-zone radius (m)
const MAX_YAW_RATE = 2.5;       // rad/s — no instant rotation
const LANE_CHANGE_TIME = 2.4;   // seconds for a lane change blend
const VEHICLE_COUNT = 40;

const CLASS_SPEC = {
  car: { length: 4.4, width: 1.85, maxAccel: 1.4, maxSpeed: 38, idm: CAR_IDM as IdmParams },
  van: { length: 6.8, width: 2.0, maxAccel: 0.9, maxSpeed: 28, idm: VAN_IDM as IdmParams },
};
const PALETTE = [0xc0392b, 0x2980b9, 0x7f8c8d, 0x2c3e50, 0xecf0f1, 0x27ae60, 0xf39c12, 0x8e44ad];

export class Sim {
  idx: NetIndex;
  vehicles: Vehicle[] = [];
  time = 0;
  rng: () => number;
  laneVehicles = new Map<string, Vehicle[]>();
  occupancy = new Map<string, Set<number>>();
  spawnLanes: IndexedLane[];
  destLanes: IndexedLane[];
  stats = { replans: 0, laneChanges: 0, turns: 0, replanWhy: {} as Record<string, number> };

  constructor(net: RoadNetwork, seed: number, vehicleCount = VEHICLE_COUNT) {
    this.idx = buildNetIndex(net);
    this.rng = mulberry32(seed);
    const all = [...this.idx.lanes.values()];
    this.spawnLanes = all.filter(l => l.length > 40);
    this.destLanes = all.filter(l => l.length > 25);
    for (let i = 0; i < vehicleCount; i++) this.spawnOne();
  }

  // ---- spawning -----------------------------------------------------------
  private spawnOne(): void {
    const rng = this.rng;
    for (let t = 0; t < 40; t++) {
      const lane = pick(rng, this.spawnLanes);
      const s = 8 + rng() * (lane.length - 16);
      if (this.tooClose(lane.id, s, 18)) continue;
      const evs = this.idx.events.get(lane.id) ?? [];
      if (evs.some(e => Math.abs(e.arc - s) < 12)) continue; // not inside a junction
      const cls = rng() < 0.85 ? 'car' : 'van';
      const spec = CLASS_SPEC[cls];
      const v: Vehicle = {
        id: this.vehicles.length, cls,
        length: spec.length, width: spec.width,
        maxAccel: spec.maxAccel, maxSpeed: spec.maxSpeed,
        colour: Math.floor(rng() * PALETTE.length),
        laneId: lane.id, s, v: 0,
        heading: 0, lat: 0, x: 0, y: 0,
        route: [{ laneId: lane.id, via: null }], destLane: lane.id,
        indicator: 'off', brake: false, targetSpeed: 0,
        committed: false, waitStart: null,
        changeTarget: null, changeT: 0, changeFromLat: 0, changeShift: 0,
        nextMobilT: rng() * 1.0, stoppedTime: 0, dist: 0,
        evIdx: 0, activeEv: null,
      };
      this.placeOnLane(v, lane, s);
      v.v = Math.min(6, lane.speedMs * 0.5);
      this.vehicles.push(v);
      this.replan(v, 'spawn');
      if (v.route.length > 1 || this.idx.adj.get(lane.id)?.length) return;
      this.vehicles.pop(); // isolated lane, retry
    }
  }

  private tooClose(laneId: string, s: number, minDist: number): boolean {
    for (const o of this.vehicles) {
      if (o.laneId === laneId && Math.abs(o.s - s) < minDist) return true;
    }
    return false;
  }

  private placeOnLane(v: Vehicle, lane: IndexedLane, s: number): void {
    v.s = Math.max(0, Math.min(lane.length, s));
    const [px, py] = pointAtArc(lane.pts, lane.cum, v.s);
    const [hx, hy] = tangentAtArc(lane.pts, lane.cum, v.s);
    v.heading = Math.atan2(hy, hx);
    v.x = px; v.y = py;
  }

  replan(v: Vehicle, why = 'unknown'): void {
    this.stats.replans++;
    const w = this.stats.replanWhy; w[why] = (w[why] ?? 0) + 1;
    for (let t = 0; t < 8; t++) {
      const dest = pick(this.rng, this.destLanes);
      if (dest.id === v.laneId) continue;
      const route = planRoute(this.idx, v.laneId, dest.id, v.s);
      if (route && route.length > 1) {
        v.route = route;
        v.destLane = dest.id;
        return;
      }
    }
    // fallback: wander via a random legal turn at a junction ahead
    const outs = (this.idx.adj.get(v.laneId) ?? []).filter(c => {
      if (c.to === v.laneId) return false;
      const arc = eventArcFor(this.idx, v.laneId, c.via);
      return arc !== null && arc >= v.s - 3;
    });
    if (outs.length) {
      const c = outs[Math.floor(this.rng() * outs.length)];
      v.route = [{ laneId: v.laneId, via: null }, { laneId: c.to, via: c.via }];
      v.destLane = c.to;
      return;
    }
    // nowhere to turn ahead: drive to the lane end; deadEnd() will replan.
    // Clear destLane so the destination check doesn't refire every step.
    v.route = [{ laneId: v.laneId, via: null }];
    v.destLane = '';
  }

  // ---- per-step helpers ----------------------------------------------------
  upcomingEvent(v: Vehicle): LaneEvent | null {
    const evs = this.idx.events.get(v.laneId);
    if (!evs || !evs.length) return null;
    while (v.evIdx < evs.length && evs[v.evIdx].arc < v.s - 3) v.evIdx++;
    return v.evIdx < evs.length ? evs[v.evIdx] : null;
  }

  peekEvent(v: Vehicle): LaneEvent | null {
    const evs = this.idx.events.get(v.laneId);
    if (!evs || !evs.length) return null;
    let i = v.evIdx;
    while (i < evs.length && evs[i].arc < v.s - 3) i++;
    return i < evs.length ? evs[i] : null;
  }

  private leaderOn(laneId: string, v: Vehicle): { gap: number; dv: number; o: Vehicle | null } {
    let best = { gap: Infinity, dv: 0, o: null as Vehicle | null };
    const arr = this.laneVehicles.get(laneId);
    if (!arr) return best;
    for (const o of arr) {
      if (o.id === v.id || o.s <= v.s + 0.01) continue;
      const gap = (o.s - o.length / 2) - (v.s + v.length / 2);
      if (gap < best.gap) best = { gap, dv: v.v - o.v, o };
    }
    return best;
  }

  private followerOn(laneId: string, s: number, selfId: number): Vehicle | null {
    let best: Vehicle | null = null;
    const arr = this.laneVehicles.get(laneId);
    if (!arr) return null;
    for (const o of arr) {
      if (o.id === selfId || o.s >= s - 0.01) continue;
      if (!best || o.s > best.s) best = o;
    }
    return best;
  }

  private idmFor(v: Vehicle, v0: number, gap: number, dv: number): number {
    return idmAccel(v.v, v0, gap, dv, CLASS_SPEC[v.cls].idm);
  }

  // ---- main step ------------------------------------------------------------
  step(dt: number): void {
    this.time += dt;
    const { vehicles } = this;

    // per-lane lists, sorted by s
    const laneVehicles = new Map<string, Vehicle[]>();
    for (const v of vehicles) {
      let arr = laneVehicles.get(v.laneId);
      if (!arr) { arr = []; laneVehicles.set(v.laneId, arr); }
      arr.push(v);
    }
    for (const arr of laneVehicles.values()) arr.sort((a, b) => a.s - b.s);
    this.laneVehicles = laneVehicles;

    // junction occupancy (conflict zones): only vehicles actually inside the
    // conflict area reserve it. A vehicle waiting uncommitted at its stop
    // line must NOT block higher-priority cross traffic (deadlock otherwise).
    const occupancy = new Map<string, Set<number>>();
    for (const v of vehicles) {
      const evs = this.idx.events.get(v.laneId) ?? [];
      for (const ev of evs) {
        if (Math.abs(ev.arc - v.s) > JUNCTION_RADIUS + 12) continue;
        const d = Math.hypot(v.x - ev.jx, v.y - ev.jy);
        const reserves = (v.committed && d < JUNCTION_RADIUS) || d < 4;
        if (reserves) {
          let set = occupancy.get(ev.junctionId);
          if (!set) { set = new Set(); occupancy.set(ev.junctionId, set); }
          set.add(v.id);
        }
      }
    }
    this.occupancy = occupancy;

    for (const v of vehicles) this.stepVehicle(v, dt);
  }

  private stepVehicle(v: Vehicle, dt: number): void {
    const idx = this.idx;
    const lane = idx.lanes.get(v.laneId)!;
    const spec = CLASS_SPEC[v.cls];
    const v0 = Math.min(v.maxSpeed, lane.speedMs);
    v.targetSpeed = v0;

    // commit bookkeeping per handled junction
    const ev = this.upcomingEvent(v);
    const evKey = ev ? ev.junctionId : null;
    if (evKey !== v.activeEv) {
      v.committed = false;
      v.waitStart = null;
      v.activeEv = evKey;
    }

    // 1. car following (IDM) — during a lane change, respect both lanes
    let lead = this.leaderOn(v.laneId, v);
    if (v.changeTarget) {
      const alt = this.leaderOn(v.changeTarget, v);
      if (alt.gap < lead.gap) lead = alt;
    }
    let a = this.idmFor(v, v0, lead.gap, lead.dv);

    // 2. junction control
    const needsControl = ev && (ev.control !== undefined || ev.entryKinds.has('roundabout-entry'));
    if (needsControl && !v.committed && ev) {
      const dLine = ev.stopArc - (v.s + v.length / 2);
      if (dLine < 1.0) {
        // Across (or at) the stop line: we're in the junction — clear it,
        // never wait past the line (deadlock otherwise).
        v.committed = true;
        v.waitStart = null;
      } else if (dLine < 60) {
        const kind = ev.control?.kind;
        // Stop signs: must come to a halt at the line before junctionGo
        // is even consulted (no rolling through).
        const mustStopFirst = kind === 'stop' && v.v > 0.5;
        if (mustStopFirst) {
          a = Math.min(a, stopLineAccel(v.v, v0, dLine, v.maxAccel));
        } else if (dLine < 15) {
          // Only commit when close: reduces the window for conflicts.
          const dec = this.junctionGo(v, ev);
          if (dec === 'go') {
            v.committed = true;
            v.waitStart = null;
          } else {
            a = Math.min(a, stopLineAccel(v.v, v0, dLine, v.maxAccel));
            if (dLine < 1.2 && v.v < 0.35) {
              if (v.waitStart == null) v.waitStart = this.time;
              a = Math.min(a, -2); // hold at the line
            }
          }
        } else {
          // Far: just brake towards the line, don't decide yet.
          a = Math.min(a, stopLineAccel(v.v, v0, dLine, v.maxAccel));
        }
      }
    }

    // 3. lane changes (MOBIL, staggered; plus mandatory route changes)
    if (!v.changeTarget && this.time >= v.nextMobilT) {
      v.nextMobilT = this.time + 1.0;
      this.considerLaneChange(v, ev, a, v0);
    }

    // 4. integrate
    v.v = Math.max(0, v.v + a * dt);
    v.s += v.v * dt;
    v.dist += v.v * dt;
    v.brake = a < -0.8;
    if (v.v < 0.3) v.stoppedTime += dt; else v.stoppedTime = 0;

    // 5. lane-change blend
    if (v.changeTarget) {
      v.changeT += dt / LANE_CHANGE_TIME;
      const t = Math.min(1, v.changeT);
      const e = t * t * (3 - 2 * t);
      v.lat = v.changeFromLat + v.changeShift * e;
      if (t >= 1) this.finishLaneChange(v);
    }

    // 6. junction turn transition
    const ev2 = this.upcomingEvent(v);
    if (ev2 && v.s >= ev2.arc - 0.35 && !v.changeTarget) {
      this.tryTurn(v, ev2);
    }

    // 7. dead end
    const lane2 = idx.lanes.get(v.laneId)!;
    if (!this.upcomingEvent(v) && v.s >= lane2.length - 0.4) {
      this.deadEnd(v);
      return;
    }

    // 8. destination reached -> new destination
    if (v.route.length <= 1 && v.destLane !== '' && v.laneId === v.destLane) this.replan(v, 'dest');

    // 9. pose
    const l = idx.lanes.get(v.laneId)!;
    const [px, py] = pointAtArc(l.pts, l.cum, v.s);
    const [hx, hy] = tangentAtArc(l.pts, l.cum, v.s);
    const targetHeading = Math.atan2(hy, hx);
    let dh = targetHeading - v.heading;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    const maxD = MAX_YAW_RATE * dt;
    v.heading += Math.max(-maxD, Math.min(maxD, dh));
    const nx = -hy, ny = hx; // left normal of travel direction
    v.x = px + nx * v.lat;
    v.y = py + ny * v.lat;
    v.indicator = indicatorFor(v, this.peekEvent(v), idx);
  }

  private junctionGo(v: Vehicle, ev: LaneEvent): 'go' | 'wait' {
    const kind = ev.control?.kind ?? (ev.entryKinds.has('roundabout-entry') ? 'roundabout-entry' : undefined);
    const myRank = controlRank(kind);
    const dJ = Math.max(0.5, Math.hypot(v.x - ev.jx, v.y - ev.jy));
    // Strict exclusion (applies to ALL junctions, even uncontrolled): if
    // another vehicle (different lane) is within 8m of the junction centre,
    // wait. Prevents simultaneous entry.
    for (const o of this.vehicles) {
      if (o.id === v.id || o.laneId === v.laneId) continue;
      if (Math.hypot(o.x - ev.jx, o.y - ev.jy) < 8) return 'wait';
    }
    // Treat nearby OSM nodes as one physical intersection.
    const cluster = this.idx.nearJunctions.get(ev.junctionId) ?? [ev.junctionId];
    const clusterSet = new Set(cluster);
    const others: OtherVeh[] = [];
    for (const o of this.vehicles) {
      if (o.id === v.id) continue;
      const oEv = this.peekEvent(o);
      if (!oEv || !clusterSet.has(oEv.junctionId)) continue;
      const od = Math.hypot(o.x - ev.jx, o.y - ev.jy);
      if (od > 30) continue;
      const oKind = oEv.control?.kind ?? (oEv.entryKinds.has('roundabout-entry') ? 'roundabout-entry' : undefined);
      others.push({
        id: o.id, x: o.x, y: o.y, v: o.v, heading: o.heading,
        eventJunction: oEv.junctionId, eta: od / Math.max(o.v, 1),
        rank: controlRank(oKind), kind: oKind,
        waitStart: o.waitStart, committed: o.committed,
      });
    }
    let occupied = false;
    for (const jid of cluster) {
      const occ = this.occupancy.get(jid);
      if (occ && [...occ].some(id => id !== v.id)) { occupied = true; break; }
    }
    let circulatingNear = false;
    if (ev.entryKinds.has('roundabout-entry')) {
      for (const o of this.vehicles) {
        if (o.id === v.id) continue;
        if (this.idx.roundaboutLanes.has(o.laneId) && Math.hypot(o.x - ev.jx, o.y - ev.jy) < 28) {
          circulatingNear = true;
          break;
        }
      }
    }
    return junctionDecision({
      time: this.time, myId: v.id, myKind: kind, myRank,
      myEta: dJ / Math.max(v.v, 1), myWaitStart: v.waitStart,
      myHeading: v.heading, myX: v.x, myY: v.y,
      occupied, circulatingNear, others,
    });
  }

  private considerLaneChange(v: Vehicle, ev: LaneEvent | null, aSelf: number, v0: number): void {
    // don't fiddle right before a required turn
    if (ev && v.route.length > 1 && v.route[1].via === ev.junctionId && ev.arc - v.s < 25) return;
    const lane = this.idx.lanes.get(v.laneId)!;

    // mandatory: route demands a lane change (via === null step)
    if (v.route.length > 1 && v.route[1].via === null) {
      const target = this.idx.lanes.get(v.route[1].laneId);
      if (target && this.gapSafe(v, target.id)) {
        this.startLaneChange(v, target.id);
      }
      return;
    }

    // discretionary: MOBIL over neighbouring lanes
    let best: { id: string; incentive: number } | null = null;
    for (const nb of neighbourLanes(this.idx, v.laneId)) {
      if (crossesDoubleSolid(this.idx, v.laneId, nb.id)) continue;
      const nbV0 = Math.min(v.maxSpeed, nb.speedMs);
      const myNew = this.idmOnLane(v, nb.id, nbV0);
      const oldFol = this.followerOn(v.laneId, v.s, v.id);
      const newFol = this.followerOn(nb.id, v.s, v.id);
      const myLead = this.leaderOn(v.laneId, v);
      const aOldFol = oldFol ? this.idmFor(oldFol, Math.min(oldFol.maxSpeed, lane.speedMs),
        (v.s - v.length / 2) - (oldFol.s + oldFol.length / 2), oldFol.v - v.v) : 0;
      // old follower's accel once I leave: its leader becomes my old leader
      let aOldFolNew = 0;
      if (oldFol) {
        if (myLead.o) {
          const gap2 = (myLead.o.s - myLead.o.length / 2) - (oldFol.s + oldFol.length / 2);
          aOldFolNew = this.idmFor(oldFol, Math.min(oldFol.maxSpeed, lane.speedMs), gap2, oldFol.v - myLead.o.v);
        } else {
          aOldFolNew = this.idmFor(oldFol, Math.min(oldFol.maxSpeed, lane.speedMs), Infinity, 0);
        }
      }
      const aNewFol = newFol ? this.idmFor(newFol, Math.min(newFol.maxSpeed, nb.speedMs),
        (v.s - v.length / 2) - (newFol.s + newFol.length / 2), newFol.v - v.v) : 0;
      const myLeadNew = this.leaderOn(nb.id, v);
      const aNewFolNew = newFol ? this.idmFor(newFol, Math.min(newFol.maxSpeed, nb.speedMs),
        (v.s - v.length / 2) - (newFol.s + newFol.length / 2), newFol.v - v.v) : 0;
      void myLeadNew;
      const { change, incentive } = mobilDecision({
        myAccel: aSelf, myNewAccel: myNew,
        oldFollowerAccel: aOldFol, oldFollowerNewAccel: aOldFolNew,
        newFollowerAccel: aNewFol, newFollowerNewAccel: aNewFolNew,
      }, MOBIL_DEFAULT);
      if (change && (!best || incentive > best.incentive)) best = { id: nb.id, incentive };
    }
    if (best) this.startLaneChange(v, best.id);
  }

  // IDM accel of vehicle v as if it were on laneId at its current s/v.
  private idmOnLane(v: Vehicle, laneId: string, v0: number): number {
    const lead = this.leaderOn(laneId, v);
    return this.idmFor(v, v0, lead.gap, lead.dv);
  }

  private gapSafe(v: Vehicle, targetLaneId: string): boolean {
    // no vehicle within a safe envelope on the target lane
    const arr = this.laneVehicles.get(targetLaneId);
    if (!arr) return true;
    for (const o of arr) {
      if (o.id === v.id) continue;
      const ds = o.s - v.s;
      if (ds > 0 && ds < 10 + o.length) return false;  // ahead
      if (ds <= 0 && -ds < 8 + v.length) return false; // behind
    }
    return true;
  }

  private startLaneChange(v: Vehicle, targetId: string): void {
    const from = this.idx.lanes.get(v.laneId)!;
    const to = this.idx.lanes.get(targetId)!;
    v.changeTarget = targetId;
    v.changeT = 0;
    v.changeFromLat = v.lat;
    v.changeShift = to.offsetM - from.offsetM;
    this.stats.laneChanges++;
  }

  private finishLaneChange(v: Vehicle): void {
    const targetId = v.changeTarget!;
    const nl = this.idx.lanes.get(targetId)!;
    v.laneId = nl.id;
    v.s = Math.max(0, Math.min(nl.length, travelArc(nl, v.x, v.y)));
    v.lat = 0;
    v.changeTarget = null;
    v.changeT = 0;
    v.evIdx = 0;
    // route bookkeeping: mandatory step consumed, else replan (diverged)
    if (v.route.length > 1 && v.route[1].laneId === nl.id && v.route[1].via === null) {
      v.route.shift();
    } else {
      this.replan(v);
    }
  }

  private tryTurn(v: Vehicle, ev: LaneEvent): void {
    const step = v.route.length > 1 ? v.route[1] : null;
    if (!step) return;
    if (step.via && step.via !== ev.junctionId) {
      // intended turn is at a different junction — did we genuinely miss it?
      // (consistent with upcomingEvent's consumption threshold: arc < s-3)
      const remaining = (this.idx.events.get(v.laneId) ?? [])
        .some(e => e.junctionId === step.via && e.arc >= v.s - 3);
      if (!remaining) this.replan(v, 'missed');
      return;
    }
    if (step.via === ev.junctionId) {
      const out = ev.outs.find(o => o.to === step.laneId);
      if (out) {
        const nl = this.idx.lanes.get(out.to)!;
        const entryS = Math.max(0, Math.min(nl.length, travelArc(nl, ev.jx, ev.jy)));
        // Don't turn into an occupied slot: check target lane for vehicles
        // within a safe envelope of the entry point (use live vehicles list;
        // laneVehicles is stale mid-step after earlier turns).
        let blocked = false;
        for (const o of this.vehicles) {
          if (o.id === v.id || o.laneId !== nl.id) continue;
          const ds = o.s - entryS;
          if (ds > -(8 + v.length) && ds < 10 + o.length) { blocked = true; break; }
        }
        // Also: don't materialise inside a vehicle on a crossing lane.
        if (!blocked) {
          const [ex, ey] = pointAtArc(nl.pts, nl.cum, entryS);
          for (const o of this.vehicles) {
            if (o.id === v.id) continue;
            if (Math.hypot(o.x - ex, o.y - ey) < 3.0) { blocked = true; break; }
          }
        }
        if (blocked) return; // miss the turn; replan will fire downstream
        v.laneId = nl.id;
        v.s = entryS;
        v.lat = 0;
        v.evIdx = 0;
        v.route.shift();
        this.stats.turns++;
      } else {
        this.replan(v, 'no-out'); // data inconsistency guard
      }
    }
    // step.via === null (mandatory lane change pending): handled by considerLaneChange
  }

  private deadEnd(v: Vehicle): void {
    const lane = this.idx.lanes.get(v.laneId)!;
    const opp = lane.seg.lanes.find(l => l.dir !== lane.dir);
    // No opposite lane, or the U-turn slot is occupied: end this trip and
    // start a new one elsewhere. Waiting at a lane end for a U-turn slot
    // deadlocks (vehicles queue behind, and nearby waiters block each other
    // via proximity), so a blocked U-turn becomes a respawn, never a wait.
    if (!opp) { this.respawn(v); return; }
    const nl = this.idx.lanes.get(opp.id)!;
    const targetS = Math.max(0, Math.min(nl.length, travelArc(nl, v.x, v.y)));
    const [tx, ty] = pointAtArc(nl.pts, nl.cum, targetS);
    for (const o of this.vehicles) {
      if (o.id === v.id) continue;
      if (o.laneId === nl.id) {
        const ds = o.s - targetS;
        if (ds > -(8 + v.length) && ds < 10 + o.length) { this.respawn(v); return; }
      }
      if (Math.hypot(o.x - tx, o.y - ty) < 3.0) { this.respawn(v); return; }
    }
    v.laneId = nl.id;
    v.s = targetS;
    v.lat = 0;
    v.changeTarget = null;
    v.evIdx = 0;
    v.committed = false;
    v.waitStart = null;
    this.replan(v, 'deadend');
  }

  private respawn(v: Vehicle): void {
    const keep = { id: v.id, cls: v.cls, colour: v.colour };
    this.vehicles.splice(this.vehicles.indexOf(v), 1);
    // spawn a fresh vehicle reusing the id slot
    const before = this.vehicles.length;
    this.spawnOne();
    const nv = this.vehicles[this.vehicles.length - 1];
    if (this.vehicles.length > before && nv) {
      nv.id = keep.id; nv.cls = keep.cls; nv.colour = keep.colour;
      const spec = CLASS_SPEC[keep.cls];
      nv.length = spec.length; nv.width = spec.width;
      nv.maxAccel = spec.maxAccel; nv.maxSpeed = spec.maxSpeed;
      // re-sort ids: keep array order stable by reassigning all ids
      this.vehicles.forEach((x, i) => { x.id = i; });
    }
  }

  avgSpeed(): number {
    if (!this.vehicles.length) return 0;
    return this.vehicles.reduce((a, v) => a + v.v, 0) / this.vehicles.length;
  }
}

export { PALETTE };
