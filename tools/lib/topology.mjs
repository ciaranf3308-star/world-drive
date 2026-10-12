// Junction topology: lane -> lane turn connections across junctions.
// Pure functions (shared with tests). Left-hand traffic (Ireland).
// All coordinates: local metres, x=east, y=north (math convention).

export const HIGHWAY_RANK = {
  motorway: 10, trunk: 9, primary: 8, secondary: 7, tertiary: 6,
  unclassified: 5, residential: 4, living_street: 4, service: 3,
  motorway_link: 10, trunk_link: 9, primary_link: 8, secondary_link: 7, tertiary_link: 6,
};
export function highwayRank(hw) { return HIGHWAY_RANK[hw] ?? 2; }

// Signed turn angle in degrees from heading (ax,ay) to heading (bx,by).
// Positive = left turn (counter-clockwise in math coords).
export function turnAngleDeg(ax, ay, bx, by) {
  const cross = ax * by - ay * bx;
  const dot = ax * bx + ay * by;
  return Math.atan2(cross, dot) * 180 / Math.PI;
}

// Classify a manoeuvre by signed turn angle (left-hand traffic).
export function classifyTurn(angleDeg) {
  const a = Math.abs(angleDeg);
  if (a < 30) return 'through';
  if (a >= 150) return 'uturn';
  return angleDeg > 0 ? 'left' : 'right';
}

// Closest point on a polyline. Returns {dist, arcLen, px, py} or null.
export function nearestOnPolyline(pts, x, y) {
  let best = null;
  let arc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay;
    const segLen = Math.hypot(dx, dy);
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t, py = ay + dy * t;
    const d = Math.hypot(x - px, y - py);
    if (!best || d < best.dist) best = { dist: d, arcLen: arc + segLen * t, px, py };
    arc += segLen;
  }
  if (best) best.totalLen = arc;
  return best;
}

// Travel heading of a lane at an absolute arc position (measured from travel start).
export function headingAtArc(pts, dir, arcPos) {
  const fwd = dir > 0 ? pts : [...pts].reverse();
  const total = polyLen(fwd);
  const target = Math.max(0, Math.min(total, arcPos));
  let arc = 0;
  for (let i = 0; i < fwd.length - 1; i++) {
    const [ax, ay] = fwd[i], [bx, by] = fwd[i + 1];
    const segLen = Math.hypot(bx - ax, by - ay);
    if (arc + segLen >= target || i === fwd.length - 2) {
      const l = segLen || 1;
      return { hx: (bx - ax) / l, hy: (by - ay) / l };
    }
    arc += segLen;
  }
  const [ax, ay] = fwd[0], [bx, by] = fwd[1] || fwd[0];
  const l = Math.hypot(bx - ax, by - ay) || 1;
  return { hx: (bx - ax) / l, hy: (by - ay) / l };
}

// Travel heading of a lane at a given distance BEFORE its travel end
// (or AFTER its travel start). lane = {centreline, dir}. dir=+1 travels pts[0]->pts[-1].
export function travelHeading(pts, dir, distFromEnd, beforeEnd) {
  const fwd = dir > 0 ? pts : [...pts].reverse();
  const total = polyLen(fwd);
  const target = beforeEnd ? total - distFromEnd : distFromEnd;
  return headingAtArc(pts, dir, target);
}

function polyLen(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

// Parse OSM restriction relations into: Map<viaNodeId, [{fromWay, toWay, kind, only}]>
export function parseRestrictions(elements) {
  const map = new Map();
  for (const el of elements) {
    if (el.type !== 'relation') continue;
    const t = el.tags || {};
    if (t.type !== 'restriction' && !(t.type || '').startsWith('restriction:')) continue;
    const rtag = t.restriction || t['restriction:motorcar'] || t['restriction:vehicle'];
    if (!rtag) continue;
    const from = el.members.find(m => m.role === 'from' && m.type === 'way');
    const to = el.members.find(m => m.role === 'to' && m.type === 'way');
    const via = el.members.find(m => m.role === 'via' && m.type === 'node');
    if (!from || !to || !via) continue; // via-way restrictions need path analysis (Phase 3)
    const m = rtag.match(/^(no|only)_(left_turn|right_turn|u_turn|straight_on)$/);
    if (!m) continue;
    // map OSM restriction suffixes onto our manoeuvre kinds
    const kindMap = { left_turn: 'left', right_turn: 'right', u_turn: 'uturn', straight_on: 'through' };
    const entry = { fromWay: from.ref, toWay: to.ref, kind: kindMap[m[2]], only: m[1] === 'only' };
    if (!map.has(via.ref)) map.set(via.ref, []);
    map.get(via.ref).push(entry);
  }
  return map;
}

// Build turn connections. segments: array of segment objects (with lanes, centreline,
// highway, oneway, roundabout, lanesPerDir). segOsm: Map<segId, osmNodeId[]>.
// junctions: [{id, nodeId, x, y, wayIds}]. segByWay: Map<osmWayId, segId>.
// Returns Map<juncId, {connections: [...], controls: [...]}>.
export function buildJunctionTopology(segments, segOsm, junctions, segByWay, restrictions) {
  const segById = new Map(segments.map(s => [s.id, s]));
  const result = new Map();

  for (const j of junctions) {
    const incident = [];
    for (const wayId of j.wayIds) {
      const segId = segByWay.get(wayId);
      if (segId) incident.push(segById.get(segId));
    }
    if (incident.length === 0) continue;

    const isRoundaboutJ = incident.some(s => s.roundabout);
    // tolerance: widest lane offset + 2m
    const tol = Math.max(...incident.map(s => s.lanesPerDir * s.laneWidthM)) + 2;

    // Gather approach/departure events per lane at this junction.
    // A lane passing within tol of the junction node gets both an approach
    // event (heading 8m before the closest point) and a departure event
    // (heading 8m after) — this covers ways that terminate at the junction
    // AND ways that pass straight through it.
    const approaches = []; // {lane, seg, hx, hy}
    const departures = [];
    for (const seg of incident) {
      for (const lane of seg.lanes) {
        const near = nearestOnPolyline(lane.centreline, j.x, j.y);
        if (!near || near.dist > tol) continue;
        // arc position of closest point measured from travel start
        const arcTravel = lane.dir > 0 ? near.arcLen : near.totalLen - near.arcLen;
        const ha = headingAtArc(lane.centreline, lane.dir, arcTravel - 8);
        const hd = headingAtArc(lane.centreline, lane.dir, arcTravel + 8);
        approaches.push({ lane, seg, hx: ha.hx, hy: ha.hy });
        departures.push({ lane, seg, hx: hd.hx, hy: hd.hy });
      }
    }

    const connections = [];
    const pushConn = (a, d, kind, source) => {
      const ang = turnAngleDeg(a.hx, a.hy, d.hx, d.hy);
      connections.push({
        from: a.lane.id, to: d.lane.id,
        fromSeg: a.seg.id, toSeg: d.seg.id, via: j.id,
        kind, angleDeg: +ang.toFixed(1),
        fromHx: +a.hx.toFixed(3), fromHy: +a.hy.toFixed(3),
        toHx: +d.hx.toFixed(3), toHy: +d.hy.toFixed(3),
        confidence: 'inferred', source,
      });
    };

    if (isRoundaboutJ) {
      const ring = incident.filter(s => s.roundabout);
      const plain = incident.filter(s => !s.roundabout);
      const ringApp = approaches.filter(e => ring.includes(e.seg));
      const ringDep = departures.filter(e => ring.includes(e.seg));
      const plainApp = approaches.filter(e => plain.includes(e.seg));
      const plainDep = departures.filter(e => plain.includes(e.seg));
      // entries: plain approach -> ring departure (give way to circulating traffic)
      for (const a of plainApp) for (const d of ringDep) pushConn(a, d, 'roundabout-entry', 'IE roundabout rule: yield to circulating traffic');
      // exits: ring approach -> plain departure
      for (const a of ringApp) for (const d of plainDep) pushConn(a, d, 'roundabout-exit', 'ring circulation');
      // circulate: ring approach -> ring departure (incl. same lane continuing
      // through the junction — the ring does not end at entry/exit nodes)
      for (const a of ringApp) for (const d of ringDep) {
        pushConn(a, d, 'circulate', 'ring circulation');
      }
    } else {
      for (const a of approaches) {
        for (const d of departures) {
          if (a.lane.id === d.lane.id) { pushConn(a, d, 'through', 'lane continuation'); continue; }
          const ang = turnAngleDeg(a.hx, a.hy, d.hx, d.hy);
          const kind = classifyTurn(ang);
          if (kind === 'uturn') continue; // no U-turns at ordinary junctions (Phase 2 rule)
          // don't connect a lane back into its own segment's opposing lanes (covered by uturn rule)
          pushConn(a, d, kind, 'junction geometry');
        }
      }
    }

    // Apply verified OSM turn restrictions.
    const restr = restrictions.get(j.nodeId) || [];
    let removed = 0;
    for (const r of restr) {
      const fromSeg = segByWay.get(r.fromWay), toSeg = segByWay.get(r.toWay);
      for (let i = connections.length - 1; i >= 0; i--) {
        const c = connections[i];
        if (c.fromSeg !== fromSeg || c.toSeg !== toSeg) continue;
        const match = c.kind === r.kind;
        if ((r.only && !match) || (!r.only && match)) { connections.splice(i, 1); removed++; }
      }
    }

    // Priority controls for approach lanes (Irish Rules of the Road, inferred).
    const ranks = new Map(incident.map(s => [s.id, highwayRank(s.highway)]));
    const maxRank = Math.max(...incident.map(s => ranks.get(s.id)));
    const controls = [];
    for (const a of approaches) {
      const r = ranks.get(a.seg.id);
      let control = null;
      if (isRoundaboutJ && !a.seg.roundabout) {
        control = { kind: 'yield', source: 'IE roundabout: give way to the right/circulating' };
      } else if (!isRoundaboutJ && r < maxRank) {
        control = r <= 5 && maxRank >= 7
          ? { kind: 'stop', source: `minor (${a.seg.highway}) meets major (rank ${maxRank})` }
          : { kind: 'yield', source: `minor (${a.seg.highway}) yields to rank ${maxRank}` };
      } else if (!isRoundaboutJ && r === maxRank && incident.length >= 3) {
        control = { kind: 'yield-right', source: 'equal priority: give way to the right (RSA)' };
      }
      if (control) {
        controls.push({
          laneId: a.lane.id, segId: a.seg.id, via: j.id,
          kind: control.kind, confidence: 'inferred', source: control.source,
        });
      }
    }

    result.set(j.id, { connections, controls, restrictedRemoved: removed });
  }
  return result;
}
