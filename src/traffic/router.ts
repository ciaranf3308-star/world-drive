// Route planning over the lane graph: Dijkstra from current lane to a
// destination lane. Edges: turn connections (cost 1) + lane changes between
// neighbouring same-direction lanes (cost 2.5, so the planner prefers staying
// put but WILL move to the correct lane before a turn).
//
// Position awareness: the FIRST turn must be at a junction ahead of the
// vehicle (fromS). Deeper geometric chaining is validated at runtime by the
// sim (missed-turn detection replans). Pure, DOM-free.
import { NetIndex } from './types.js';
import { RouteStep } from './types.js';
import { neighbourLanes, eventArcFor } from './index.js';

const TURN_COST = 1;
const LANE_CHANGE_COST = 2.5;
const MAX_VISITED = 12000;

interface Prev { from: string; via: string | null }

export function planRoute(idx: NetIndex, fromLaneId: string, destLaneId: string, fromS?: number): RouteStep[] | null {
  if (fromLaneId === destLaneId) return [{ laneId: fromLaneId, via: null }];
  if (!idx.lanes.has(fromLaneId) || !idx.lanes.has(destLaneId)) return null;

  const dist = new Map<string, number>([[fromLaneId, 0]]);
  const prev = new Map<string, Prev>();
  const visited = new Set<string>();
  // simple binary heap
  const heap: Array<[number, string]> = [[0, fromLaneId]];
  const push = (c: number, id: string) => {
    heap.push([c, id]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, string] | undefined => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length && last) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  push(0, fromLaneId);
  let found = false;
  while (heap.length && visited.size < MAX_VISITED) {
    const item = pop();
    if (!item) break;
    const [cost, id] = item;
    if (visited.has(id)) continue;
    visited.add(id);
    if (id === destLaneId) { found = true; break; }
    const outs = idx.adj.get(id);
    if (outs) {
      for (const c of outs) {
        if (c.to === id) continue; // self-continuation is a no-op for routing
        // first turn must be ahead of the vehicle
        if (fromS !== undefined && id === fromLaneId) {
          const arcOut = eventArcFor(idx, id, c.via);
          if (arcOut === null || arcOut < fromS - 3) continue;
        }
        const nc = cost + TURN_COST;
        if (nc < (dist.get(c.to) ?? Infinity)) {
          dist.set(c.to, nc);
          prev.set(c.to, { from: id, via: c.via });
          push(nc, c.to);
        }
      }
    }
    // lane changes (mandatory-capable: planner may route through them)
    for (const nb of neighbourLanes(idx, id)) {
      const nc = cost + LANE_CHANGE_COST;
      if (nc < (dist.get(nb.id) ?? Infinity)) {
        dist.set(nb.id, nc);
        prev.set(nb.id, { from: id, via: null });
        push(nc, nb.id);
      }
    }
  }
  if (!found) return null;

  const steps: RouteStep[] = [];
  let cur = destLaneId;
  let guard = 0;
  while (cur !== fromLaneId && guard++ < MAX_VISITED) {
    const p = prev.get(cur);
    if (!p) return null;
    steps.push({ laneId: cur, via: p.via });
    cur = p.from;
  }
  steps.push({ laneId: fromLaneId, via: null });
  steps.reverse();
  return steps;
}
