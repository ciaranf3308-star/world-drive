import { neighbourLanes, eventArcFor } from './index.js';
const TURN_COST = 1;
const LANE_CHANGE_COST = 2.5;
const MAX_VISITED = 12000;
export function planRoute(idx, fromLaneId, destLaneId, fromS) {
    if (fromLaneId === destLaneId)
        return [{ laneId: fromLaneId, via: null }];
    if (!idx.lanes.has(fromLaneId) || !idx.lanes.has(destLaneId))
        return null;
    const startS = fromS ?? 0;
    // Dijkstra state = (lane, entryArc). entryArc is the arc at which the
    // vehicle enters the lane; a turn via junction J is only legal if J's arc
    // on the current lane is ahead of entryArc. State keys round entryArc to
    // 2m to bound the state space (junction arcs are discrete anyway).
    const skey = (lane, entry) => lane + '#' + Math.round(entry / 2) * 2;
    const laneOf = (sk) => sk.slice(0, sk.lastIndexOf('#'));
    const dist = new Map();
    const entryOf = new Map();
    const prev = new Map();
    const visited = new Set();
    // simple binary heap
    const heap = [];
    const push = (c, k) => {
        heap.push([c, k]);
        let i = heap.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (heap[p][0] <= heap[i][0])
                break;
            [heap[p], heap[i]] = [heap[i], heap[p]];
            i = p;
        }
    };
    const pop = () => {
        const top = heap[0];
        const last = heap.pop();
        if (heap.length && last) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < heap.length && heap[l][0] < heap[m][0])
                    m = l;
                if (r < heap.length && heap[r][0] < heap[m][0])
                    m = r;
                if (m === i)
                    break;
                [heap[m], heap[i]] = [heap[i], heap[m]];
                i = m;
            }
        }
        return top;
    };
    const startKey = skey(fromLaneId, startS);
    dist.set(startKey, 0);
    entryOf.set(startKey, startS);
    push(0, startKey);
    let foundKey = null;
    while (heap.length && visited.size < MAX_VISITED) {
        const item = pop();
        if (!item)
            break;
        const [cost, sk] = item;
        if (visited.has(sk))
            continue;
        visited.add(sk);
        const id = laneOf(sk);
        const entryArc = entryOf.get(sk);
        if (id === destLaneId) {
            foundKey = sk;
            break;
        }
        const outs = idx.adj.get(id);
        if (outs) {
            for (const c of outs) {
                if (c.to === id)
                    continue; // self-continuation is a no-op for routing
                // junction must be ahead of where we entered this lane
                const arcJ = eventArcFor(idx, id, c.via);
                if (arcJ === null || arcJ < entryArc - 3)
                    continue;
                // entry arc on the new lane = projected arc of the junction there
                const entryB = eventArcFor(idx, c.to, c.via) ?? 0;
                const nk = skey(c.to, entryB);
                const nc = cost + TURN_COST;
                if (nc < (dist.get(nk) ?? Infinity)) {
                    dist.set(nk, nc);
                    entryOf.set(nk, entryB);
                    prev.set(nk, { fromKey: sk, via: c.via });
                    push(nc, nk);
                }
            }
        }
        // lane changes (mandatory-capable: planner may route through them).
        // Entry arc is kept (conservative): the change happens at/after entry.
        for (const nb of neighbourLanes(idx, id)) {
            const nk = skey(nb.id, entryArc);
            const nc = cost + LANE_CHANGE_COST;
            if (nc < (dist.get(nk) ?? Infinity)) {
                dist.set(nk, nc);
                entryOf.set(nk, entryArc);
                prev.set(nk, { fromKey: sk, via: null });
                push(nc, nk);
            }
        }
    }
    if (!foundKey)
        return null;
    const steps = [];
    let cur = foundKey;
    let guard = 0;
    while (cur !== startKey && guard++ < MAX_VISITED) {
        const p = prev.get(cur);
        if (!p)
            return null;
        steps.push({ laneId: laneOf(cur), via: p.via });
        cur = p.fromKey;
    }
    steps.push({ laneId: fromLaneId, via: null });
    steps.reverse();
    return steps;
}
