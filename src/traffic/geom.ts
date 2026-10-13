// Polyline geometry helpers for the traffic sim. Local metres, x=east, y=north.
import { XY } from '../road/types.js';

export function polyLen(pts: XY[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

export function cumulative(pts: XY[]): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return cum;
}

// Closest point on polyline. Returns arc length along pts order.
export function nearestArc(pts: XY[], cum: number[], x: number, y: number): { arc: number; dist: number } {
  let best = { arc: 0, dist: Infinity };
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], ay = pts[i][1];
    const dx = pts[i + 1][0] - ax, dy = pts[i + 1][1] - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
    if (d < best.dist) best = { arc: cum[i] + Math.sqrt(len2) * t, dist: d };
  }
  return best;
}

// Position at arc s (clamped).
export function pointAtArc(pts: XY[], cum: number[], s: number): XY {
  const total = cum[cum.length - 1];
  const t = Math.max(0, Math.min(total, s));
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= t) lo = mid; else hi = mid;
  }
  const segLen = cum[hi] - cum[lo] || 1;
  const f = (t - cum[lo]) / segLen;
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f];
}

// Unit tangent at arc s (direction of pts order).
export function tangentAtArc(pts: XY[], cum: number[], s: number): [number, number] {
  const total = cum[cum.length - 1];
  const t = Math.max(0, Math.min(total, s));
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= t) lo = mid; else hi = mid;
  }
  const dx = pts[hi][0] - pts[lo][0], dy = pts[hi][1] - pts[lo][1];
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}
