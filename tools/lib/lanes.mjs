// Lane inference rules for Ireland (left-hand traffic).
// Shared by build-network.mjs and the test suite so the rules are tested,
// not just the pipeline output.

export const IE_DEFAULT_SPEED_KMH = {
  motorway: 120,
  trunk: 100,
  primary: 100,
  secondary: 80,
  tertiary: 80,
  unclassified: 80,
  residential: 50,
  living_street: 30,
  service: 30,
};

// Lanes per direction inferred from highway class (Irish norms).
// Values are FALLBACKS when the OSM `lanes` tag is absent.
export const IE_INFERRED_LANES_PER_DIR = {
  motorway: 2,
  trunk: 2,
  primary: 1,
  secondary: 1,
  tertiary: 1,
  unclassified: 1,
  residential: 1,
  living_street: 1,
  service: 1,
};

export const IE_LANE_WIDTH_M = {
  motorway: 3.75,
  trunk: 3.65,
  primary: 3.5,
  secondary: 3.5,
  tertiary: 3.25,
  unclassified: 3.0,
  residential: 3.0,
  living_street: 3.0,
  service: 3.0,
};

export function parseLaneCount(tags, highway) {
  const raw = tags.lanes && String(tags.lanes).trim();
  if (raw && /^\d+$/.test(raw)) {
    const total = parseInt(raw, 10);
    if (total >= 1 && total <= 12) {
      const oneway = tags.oneway === 'yes' || tags.oneway === '1' || tags.oneway === 'true';
      const perDir = oneway ? total : Math.max(1, Math.round(total / 2));
      return { perDir, confidence: 'verified', source: `lanes=${total}` };
    }
  }
  const perDir = IE_INFERRED_LANES_PER_DIR[highway] ?? 1;
  return { perDir, confidence: 'inferred', source: `class:${highway}` };
}

export function speedLimitKmh(tags, highway) {
  const raw = tags.maxspeed && String(tags.maxspeed).trim();
  if (raw) {
    const m = raw.match(/(\d+)/);
    if (m) {
      const v = parseInt(m[1], 10);
      if (raw.includes('mph')) return { kmh: Math.round(v * 1.60934), confidence: 'verified', source: `maxspeed=${raw}` };
      return { kmh: v, confidence: 'verified', source: `maxspeed=${raw}` };
    }
  }
  const kmh = IE_DEFAULT_SPEED_KMH[highway] ?? 50;
  return { kmh, confidence: 'inferred', source: `IE-default:${highway}` };
}

export function laneWidthM(highway) {
  return IE_LANE_WIDTH_M[highway] ?? 3.25;
}

// Offset of lane centre from the road centre-line, in metres.
// dir = +1 for the way's forward direction, -1 for backward (two-way roads).
// laneIdx = 0 is the leftmost lane of that direction of travel.
// Positive offset = left of the forward direction (math coords, x=east, y=north).
export function laneOffsetM(dir, laneIdx, laneWidth) {
  const side = dir > 0 ? 1 : -1;
  return side * (laneIdx + 0.5) * laneWidth;
}

// Build lane centre-line points from a projected centre-line (array of [x,y])
// and a perpendicular offset in metres. Left normal of segment (dx,dy) is (-dy,dx).
export function offsetPolyline(points, offsetM) {
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    // left normal
    const nx = -dy, ny = dx;
    return [p[0] + nx * offsetM, p[1] + ny * offsetM];
  });
}
