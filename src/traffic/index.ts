// NetIndex: precomputed lookup structures over the Phase 1/2 road network.
// Pure, DOM-free. Built once per network load.
import { RoadNetwork, TurnConnection } from '../road/types.js';
import { IndexedLane, LaneEvent, NetIndex } from './types.js';
import { cumulative, nearestArc, polyLen } from './geom.js';

// Travel-arc of world point (x,y) on a lane (arc measured from travel start).
// IndexedLane.pts are already in travel order (see indexLane).
export function travelArc(lane: IndexedLane, x: number, y: number): number {
  return nearestArc(lane.pts, lane.cum, x, y).arc;
}

function indexLane(segId: string, seg: import('../road/types.js').Segment, lane: import('../road/types.js').Lane): IndexedLane {
  // Store points in TRAVEL order: dir=+1 travels pts[0]->pts[-1] (way order);
  // dir=-1 travels the reverse, so we reverse the polyline at index time.
  // After this, arc positions, tangents and headings are all in travel space.
  const pts = lane.dir > 0 ? lane.centreline : [...lane.centreline].reverse();
  const cum = cumulative(pts);
  return {
    id: lane.id, segId, dir: lane.dir, index: lane.index, offsetM: lane.offsetM,
    pts, cum, length: polyLen(pts),
    speedMs: seg.speedKmh / 3.6,
    seg, lane,
  };
}

export function buildNetIndex(net: RoadNetwork): NetIndex {
  const lanes = new Map<string, IndexedLane>();
  const adj = new Map<string, TurnConnection[]>();
  const junctionById = new Map(net.junctions.map(j => [j.id, j]));
  const segById = new Map(net.segments.map(s => [s.id, s]));
  const roundaboutLanes = new Set<string>();

  for (const seg of net.segments) {
    for (const lane of seg.lanes) {
      const il = indexLane(seg.id, seg, lane);
      lanes.set(lane.id, il);
      if (seg.roundabout) roundaboutLanes.add(lane.id);
    }
  }

  // events keyed laneId -> (via -> LaneEvent)
  const eventMaps = new Map<string, Map<string, LaneEvent>>();

  const getEvent = (laneId: string, via: string, jx: number, jy: number, arc: number): LaneEvent => {
    let m = eventMaps.get(laneId);
    if (!m) { m = new Map(); eventMaps.set(laneId, m); }
    let ev = m.get(via);
    if (!ev) {
      ev = { arc, junctionId: via, jx, jy, outs: [], stopArc: arc - 2, entryKinds: new Set() };
      m.set(via, ev);
    } else if (Math.abs(arc - ev.arc) > 6) {
      // same (lane, via) seen at a very different arc — keep the nearer; data oddity
      if (arc < ev.arc) { ev.arc = arc; ev.stopArc = arc - 2; }
    }
    return ev;
  };

  for (const j of net.junctions) {
    for (const c of j.connections) {
      const lane = lanes.get(c.from);
      if (!lane) continue;
      const arc = travelArc(lane, j.x, j.y);
      const ev = getEvent(c.from, c.via, j.x, j.y, arc);
      ev.outs.push(c);
      ev.entryKinds.add(c.kind);
      let a = adj.get(c.from);
      if (!a) { a = []; adj.set(c.from, a); }
      a.push(c);
    }
    for (const ctrl of j.controls) {
      const lane = lanes.get(ctrl.laneId);
      if (!lane) continue;
      const arc = travelArc(lane, j.x, j.y);
      const ev = getEvent(ctrl.laneId, ctrl.via, j.x, j.y, arc);
      if (!ev.control) ev.control = ctrl;
    }
  }

  // stopArc refinement: use the nearest stop/yield marking on the lane's segment
  const events = new Map<string, LaneEvent[]>();
  for (const [laneId, m] of eventMaps) {
    const lane = lanes.get(laneId)!;
    const list = [...m.values()];
    for (const ev of list) {
      if (!ev.control && ![...ev.entryKinds].some(k => k === 'roundabout-entry')) continue;
      const wantStop = ev.control?.kind === 'stop';
      let best = Infinity;
      for (const mk of lane.seg.markings) {
        const isStop = mk.type === 'stop-line' || mk.type === 'text';
        const isYield = mk.type === 'yield-line' || mk.type === 'yield-triangle';
        if (wantStop ? !isStop : !isYield) continue;
        if (!mk.pts || mk.pts.length === 0) continue;
        const mx = mk.pts.reduce((a, p) => a + p[0], 0) / mk.pts.length;
        const my = mk.pts.reduce((a, p) => a + p[1], 0) / mk.pts.length;
        const marc = travelArc(lane, mx, my);
        const d = Math.abs(marc - ev.arc);
        if (d < 25 && d < best) { best = d; ev.stopArc = Math.min(marc, ev.arc - 0.5); }
      }
      if (best === Infinity) ev.stopArc = ev.arc - 2;
    }
    list.sort((a, b) => a.arc - b.arc);
    events.set(laneId, list);
  }

  // Junction clustering: OSM often models one physical intersection with
  // several close nodes. For conflict resolution they must share occupancy.
  const nearJunctions = new Map<string, string[]>();
  const js = net.junctions;
  for (let i = 0; i < js.length; i++) {
    const list: string[] = [];
    for (let k = 0; k < js.length; k++) {
      if (i === k) continue;
      const dx = js[i].x - js[k].x, dy = js[i].y - js[k].y;
      if (dx * dx + dy * dy < 15 * 15) list.push(js[k].id);
    }
    list.push(js[i].id);
    nearJunctions.set(js[i].id, list);
  }

  return { lanes, events, adj, junctionById, segById, roundaboutLanes, nearJunctions };
}

// Arc of the (laneId, via) event, or null if the lane has no such event.
export function eventArcFor(idx: NetIndex, laneId: string, via: string): number | null {
  const evs = idx.events.get(laneId);
  if (!evs) return null;
  const ev = evs.find(e => e.junctionId === via);
  return ev ? ev.arc : null;
}

// Neighbouring same-direction lanes on the same segment (for MOBIL / routing).
export function neighbourLanes(idx: NetIndex, laneId: string): IndexedLane[] {
  const lane = idx.lanes.get(laneId);
  if (!lane) return [];
  const out: IndexedLane[] = [];
  for (const l of lane.seg.lanes) {
    if (l.dir === lane.dir && Math.abs(l.index - lane.index) === 1) {
      const il = idx.lanes.get(l.id);
      if (il) out.push(il);
    }
  }
  return out;
}

// Does a lane change from->to cross a double-solid centre marking?
export function crossesDoubleSolid(idx: NetIndex, fromId: string, toId: string): boolean {
  const a = idx.lanes.get(fromId), b = idx.lanes.get(toId);
  if (!a || !b || a.segId !== b.segId) return false;
  const crossesCentre = Math.sign(a.offsetM) !== Math.sign(b.offsetM);
  if (!crossesCentre) return false;
  return a.seg.markings.some(m => m.type === 'centre-double-solid');
}
