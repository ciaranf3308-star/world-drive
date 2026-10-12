// Irish road marking rules (Rules of the Road, RSA).
// Rule-based generation; every marking is tagged confidence:'inferred'
// unless derived from an explicit OSM tag (none currently used).
// White lines only — Ireland uses white centre/edge lines; yellow is for
// parking restrictions, never centre lines.
//
// Marking schema:
//   {type, pts:[[x,y]..], confidence, source}                       (linear)
//   {type:'arrow', pos:[x,y], headingDeg, moves:[...], ...}         (direction arrow)
//   {type:'text', pos:[x,y], headingDeg, text, ...}                 (painted word)
//   {type:'yield-triangle', pts:[[x,y]x3], headingDeg, ...}

import { nearestOnPolyline, travelHeading, highwayRank } from './topology.mjs';
import { offsetPolyline } from './lanes.mjs';

const R2 = p => [+p[0].toFixed(2), +p[1].toFixed(2)];

// Sub-polylines of pts whose vertices lie within `radius` of any point in `points`.
// Ranges are extended by one vertex on each side so short runs still render.
export function nearJunctionRanges(pts, points, radius) {
  const ranges = [];
  let start = -1;
  const push = (a, b) => {
    const s = Math.max(0, a - 1), e = Math.min(pts.length - 1, b + 1);
    const r = pts.slice(s, e + 1);
    if (r.length >= 2) ranges.push(r);
  };
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const near = points.some(([px, py]) => Math.hypot(x - px, y - py) < radius);
    if (near && start < 0) start = i;
    if (!near && start >= 0) { push(start, i - 1); start = -1; }
  }
  if (start >= 0) push(start, pts.length - 1);
  return ranges;
}

// Point on a lane `backM` metres before the travel point nearest (jx,jy),
// plus travel heading there.
export function approachPoint(lane, jx, jy, backM) {
  const near = nearestOnPolyline(lane.centreline, jx, jy);
  if (!near) return null;
  const distFromEnd = (near.totalLen - near.arcLen) + backM;
  const h = travelHeading(lane.centreline, lane.dir, distFromEnd, true);
  // locate the point: walk travel direction to (total - distFromEnd)
  const fwd = lane.dir > 0 ? lane.centreline : [...lane.centreline].reverse();
  let arc = 0;
  const target = Math.max(0, polyLen(fwd) - distFromEnd);
  for (let i = 0; i < fwd.length - 1; i++) {
    const [ax, ay] = fwd[i], [bx, by] = fwd[i + 1];
    const segLen = Math.hypot(bx - ax, by - ay);
    if (arc + segLen >= target) {
      const t = segLen ? Math.min(1, Math.max(0, (target - arc) / segLen)) : 0;
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, hx: h.hx, hy: h.hy };
    }
    arc += segLen;
  }
  const p = fwd[0];
  return { x: p[0], y: p[1], hx: h.hx, hy: h.hy };
}

function polyLen(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

// Transverse line across a lane at point p with travel heading (hx,hy).
function transverse(p, laneWidthM, inset = 0.25) {
  const px = -p.hy, py = p.hx; // perpendicular
  const half = Math.max(0.3, laneWidthM / 2 - inset);
  return [R2([p.x - px * half, p.y - py * half]), R2([p.x + px * half, p.y + py * half])];
}

const INF = (source) => ({ confidence: 'inferred', source });

// Main entry: markings for one segment.
// ctx = { junctionPoints: [[x,y]..], laneControl: Map<laneId,{kind,jx,jy}>,
//         laneMoves: Map<laneId,{jx,jy,moves:[...], roundaboutEntry:bool}> }
export function markingsForSegment(seg, ctx) {
  const out = [];
  const w = seg.laneWidthM;
  const twoWay = !seg.oneway && !seg.roundabout;
  const rank = highwayRank(seg.highway);

  // --- centre line
  if (twoWay) {
    if (seg.lanesPerDir >= 2) {
      // dual carriageway: double solid centre
      for (const off of [-0.15, 0.15]) {
        out.push({ type: 'centre-double-solid', pts: offsetPolyline(seg.centreline, off).map(R2), ...INF('dual carriageway: no overtaking across centre') });
      }
    } else {
      out.push({ type: 'centre-dashed', pts: seg.centreline.map(R2), ...INF('single carriageway two-way: dashed centre line') });
      // no-overtaking zone near junctions: double solid within 20m
      for (const range of nearJunctionRanges(seg.centreline, ctx.junctionPoints, 20)) {
        for (const off of [-0.15, 0.15]) {
          out.push({ type: 'centre-double-solid', pts: offsetPolyline(range, off).map(R2), ...INF('no overtaking within 20m of junction') });
        }
      }
    }
  }

  // --- lane separators (dashed) between same-direction lanes
  for (const dir of (seg.oneway || seg.roundabout) ? [1] : [1, -1]) {
    for (let i = 0; i < seg.lanesPerDir - 1; i++) {
      const off = dir * (i + 1) * w;
      out.push({ type: 'lane-dash', pts: offsetPolyline(seg.centreline, off).map(R2), ...INF('lane separator') });
    }
  }

  // --- edge lines (solid) on classified roads (rank>=5); minor roads often have none
  if (rank >= 5 && !seg.roundabout) {
    const half = seg.lanesPerDir * w * (twoWay ? 1 : 1);
    const edges = twoWay ? [-half, half] : [-seg.lanesPerDir * w, seg.lanesPerDir * w];
    for (const off of edges) {
      out.push({ type: 'edge-solid', pts: offsetPolyline(seg.centreline, off).map(R2), ...INF('edge line') });
    }
  }
  if (seg.roundabout) {
    // outer + inner edge of circulatory carriageway
    const half = seg.lanesPerDir * w;
    for (const off of [-half, half]) {
      out.push({ type: 'edge-solid', pts: offsetPolyline(seg.centreline, off).map(R2), ...INF('roundabout circulatory edge') });
    }
  }

  // --- junction controls -> stop / yield / give-way markings per lane
  for (const lane of seg.lanes) {
    const ctl = ctx.laneControl.get(lane.id);
    if (ctl) {
      const p2 = approachPoint(lane, ctl.jx, ctl.jy, 2);
      const p6 = approachPoint(lane, ctl.jx, ctl.jy, 6.5);
      if (p2) {
        if (ctl.kind === 'stop') {
          out.push({ type: 'stop-line', pts: transverse(p2, w), ...INF('stop control') });
          if (p6) out.push({ type: 'text', pos: R2([p6.x, p6.y]), headingDeg: +((Math.atan2(p6.hy, p6.hx) * 180 / Math.PI).toFixed(1)), text: 'STOP', ...INF('stop control') });
        } else if (ctl.roundaboutEntry) {
          // Irish roundabout give-way: broken transverse line (double row of dashes modelled as two dashed lines)
          const l1 = transverse(p2, w);
          const bx = p2.x - p2.hx * 0.6, by = p2.y - p2.hy * 0.6;
          const p2b = { ...p2, x: bx, y: by };
          out.push({ type: 'yield-line', pts: l1, ...INF('roundabout give-way') });
          out.push({ type: 'yield-line', pts: transverse(p2b, w), ...INF('roundabout give-way') });
        } else {
          out.push({ type: 'yield-line', pts: transverse(p2, w), ...INF('yield control') });
          if (p6) {
            // yield triangle outline, point facing travel direction
            const s = 1.6; // triangle size (m)
            const px = -p6.hy, py = p6.hx;
            const tip = [p6.x + p6.hx * s * 0.9, p6.y + p6.hy * s * 0.9];
            const b1 = [p6.x - p6.hx * s * 0.5 + px * s * 0.75, p6.y - p6.hy * s * 0.5 + py * s * 0.75];
            const b2 = [p6.x - p6.hx * s * 0.5 - px * s * 0.75, p6.y - p6.hy * s * 0.5 - py * s * 0.75];
            out.push({ type: 'yield-triangle', pts: [R2(tip), R2(b1), R2(b2)], headingDeg: +((Math.atan2(p6.hy, p6.hx) * 180 / Math.PI).toFixed(1)), ...INF('yield control') });
          }
        }
      }
    }
    // --- direction arrows on multi-move approaches
    const mv = ctx.laneMoves.get(lane.id);
    if (mv && !mv.roundaboutEntry && mv.moves.length >= 2) {
      const pa = approachPoint(lane, mv.jx, mv.jy, 12);
      if (pa) {
        out.push({
          type: 'arrow', pos: R2([pa.x, pa.y]),
          headingDeg: +((Math.atan2(pa.hy, pa.hx) * 180 / Math.PI).toFixed(1)),
          moves: mv.moves, ...INF('approach lane: ' + mv.moves.join('/')),
        });
      }
    }
  }
  return out;
}
