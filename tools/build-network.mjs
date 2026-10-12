// Compile raw OSM (data/clane-raw.json) into the WORLD DRIVE lane-level
// road network: data/clane-network.json
// Usage: node tools/build-network.mjs
//
// Output schema (all coordinates in local metres, x=east, y=north):
// {
//   meta: { origin:{lat,lon}, bbox, builtAt, source, licence },
//   segments: [{ id, name, highway, oneway, roundabout, speedKmh, speedConf,
//                laneWidthM, lanesPerDir, laneConf, laneConfSource,
//                centreline: [[x,y]...], lanes: [{id, dir, index, offsetM, centreline,
//                boundary: {left: [[x,y]..], right: [[x,y]..]}}],
//                markings: [{type, pts|pos, headingDeg?, moves?, text?, confidence, source}] }],
//   junctions: [{ id, nodeId, x, y, degree, wayIds,
//                connections: [{from, to, fromSeg, toSeg, via, kind, angleDeg, confidence, source}],
//                controls: [{laneId, segId, via, kind, confidence, source}] }],
//   junctions: [{ id, nodeId, x, y, degree, wayIds }],
//   buildings: [{ pts: [[x,y]...] }],
//   water: [{ pts: [[x,y]...], kind }]
// }
//
// Confidence: 'verified' = explicit OSM tag or validated; 'inferred' = derived
// from class/neighbour rules; 'generated' = plausible fallback. Geometry from
// OSM is always 'verified' (surveyed source); lane layout may be 'inferred'.
import { readFileSync, writeFileSync } from 'node:fs';
import { makeFrame } from './lib/proj.mjs';
import { parseLaneCount, speedLimitKmh, laneWidthM, laneOffsetM, offsetPolyline } from './lib/lanes.mjs';
import { buildJunctionTopology, parseRestrictions } from './lib/topology.mjs';
import { markingsForSegment } from './lib/markings.mjs';

const RAW = new URL('../data/clane-raw.json', import.meta.url);
const OUT = new URL('../data/clane-network.json', import.meta.url);

const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary',
  'unclassified', 'residential', 'living_street', 'service', 'motorway_link',
  'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);

const data = JSON.parse(readFileSync(RAW, 'utf8'));
const nodes = new Map();
for (const el of data.elements) if (el.type === 'node') nodes.set(el.id, el);

const lat0 = 53.2925, lon0 = -6.6880; // Clane town centre-ish
const frame = makeFrame(lat0, lon0);

const segments = [];
const nodeUse = new Map(); // nodeId -> Set(wayId)
const segOsm = new Map(); // segId -> osm node ids (for topology)
const segByWay = new Map(); // osmWayId -> segId
const buildings = [];
const water = [];

let segN = 0;
for (const el of data.elements) {
  if (el.type !== 'way' || !el.nodes) continue;
  const t = el.tags || {};
  if (t.building) {
    const pts = el.nodes.map(id => nodes.get(id)).filter(Boolean).map(n => frame.toLocal(n.lat, n.lon));
    if (pts.length >= 3) buildings.push({ pts });
    continue;
  }
  if (t.natural === 'water' || t.waterway) {
    const pts = el.nodes.map(id => nodes.get(id)).filter(Boolean).map(n => frame.toLocal(n.lat, n.lon));
    if (pts.length >= 2) water.push({ pts, kind: t.waterway || 'water' });
    continue;
  }
  const hw = t.highway;
  if (!hw || !DRIVABLE.has(hw)) continue;

  const centreline = el.nodes.map(id => nodes.get(id)).filter(Boolean).map(n => frame.toLocal(n.lat, n.lon));
  if (centreline.length < 2) continue;

  for (const id of el.nodes) {
    if (!nodeUse.has(id)) nodeUse.set(id, new Set());
    nodeUse.get(id).add(el.id);
  }

  const oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || t['oneway:vehicle'] === 'yes';
  const roundabout = t.junction === 'roundabout';
  const lanes = parseLaneCount(t, hw);
  const speed = speedLimitKmh(t, hw);
  const width = laneWidthM(hw);
  const dirs = oneway || roundabout ? [1] : [1, -1];

  const laneObjs = [];
  for (const dir of dirs) {
    for (let i = 0; i < lanes.perDir; i++) {
      const off = laneOffsetM(dir, i, width);
      const cl = offsetPolyline(centreline, off).map(p => [+p[0].toFixed(3), +p[1].toFixed(3)]);
      laneObjs.push({
        id: `L${segN}_${dir > 0 ? 'f' : 'b'}${i}`,
        dir, index: i, offsetM: +off.toFixed(3),
        centreline: cl,
        boundary: {
          left: offsetPolyline(centreline, off + dir * width / 2).map(p => [+p[0].toFixed(2), +p[1].toFixed(2)]),
          right: offsetPolyline(centreline, off - dir * width / 2).map(p => [+p[0].toFixed(2), +p[1].toFixed(2)]),
        },
      });
    }
  }

  const segId = `S${segN}`;
  segOsm.set(segId, el.nodes);
  segByWay.set(el.id, segId);

  segments.push({
    id: segId,
    osmWayId: el.id,
    name: t.name || null,
    highway: hw,
    oneway, roundabout,
    speedKmh: speed.kmh, speedConf: speed.confidence, speedConfSource: speed.source,
    laneWidthM: width,
    lanesPerDir: lanes.perDir, laneConf: lanes.confidence, laneConfSource: lanes.source,
    geometryConf: 'verified', // centre-line geometry comes straight from OSM
    centreline: centreline.map(p => [+p[0].toFixed(3), +p[1].toFixed(3)]),
    lanes: laneObjs,
  });
  segN++;
}

// Junctions: nodes shared by 2+ drivable ways
const junctions = [];
let jn = 0;
for (const [nodeId, wayIds] of nodeUse) {
  if (wayIds.size < 2) continue;
  const n = nodes.get(nodeId);
  if (!n) continue;
  const [x, y] = frame.toLocal(n.lat, n.lon);
  junctions.push({ id: `J${jn++}`, nodeId, x: +x.toFixed(3), y: +y.toFixed(3), degree: wayIds.size, wayIds: [...wayIds] });
}

const out = {
  meta: {
    origin: { lat: lat0, lon: lon0 },
    bbox: { south: 53.280, west: -6.708, north: 53.305, east: -6.668 },
    builtAt: new Date().toISOString(),
    source: 'OpenStreetMap via OSM main API',
    licence: '© OpenStreetMap contributors (ODbL)',
    phase: 2,
  },
  segments, junctions, buildings, water,
};

// Snap disconnected way endpoints to nearby junction nodes (OSM mapping gaps).
// A way end within SNAP_M of a junction node it doesn't share is treated as
// connected. Flagged as 'generated' — this CHANGES the surveyed geometry.
const SNAP_M = 6;
const snaps = [];
for (const s of segments) {
  const osmNodes = segOsm.get(s.id);
  const ends = [osmNodes[0], osmNodes[osmNodes.length - 1]];
  s.snappedEnds = [];
  for (const nid of ends) {
    if ((nodeUse.get(nid) || new Set()).size > 1) continue; // already a junction
    const n = nodes.get(nid);
    if (!n) continue;
    const [nx, ny] = frame.toLocal(n.lat, n.lon);
    let best = null;
    for (const j of junctions) {
      if (j.wayIds.includes(s.osmWayId)) continue;
      const d = Math.hypot(j.x - nx, j.y - ny);
      if (d < SNAP_M && (!best || d < best.d)) best = { j, d };
    }
    if (best) {
      best.j.wayIds.push(s.osmWayId);
      best.j.degree = best.j.wayIds.length;
      s.snappedEnds.push({ nodeId: nid, toJunction: best.j.id, gapM: +best.d.toFixed(2) });
      snaps.push(`${s.id}->${best.j.id} (${best.d.toFixed(1)}m)`);
    }
  }
  if (s.snappedEnds.length === 0) delete s.snappedEnds;
}

// ---- Phase 2: junction topology (turn connections + priority controls)
const restrictions = parseRestrictions(data.elements);
const topo = buildJunctionTopology(segments, segOsm, junctions, segByWay, restrictions);
const juncById = new Map(junctions.map(j => [j.id, j]));
const laneControl = new Map(); // laneId -> {kind, jx, jy, roundaboutEntry}
const laneMoves = new Map(); // laneId -> {jx, jy, moves:[...], roundaboutEntry}
const MOVE_ORDER = ['left', 'through', 'right'];

for (const j of junctions) {
  const t = topo.get(j.id);
  j.connections = t ? t.connections : [];
  j.controls = t ? t.controls : [];
  if (!t) continue;
  for (const c of t.controls) {
    laneControl.set(c.laneId, { kind: c.kind, jx: j.x, jy: j.y, roundaboutEntry: false });
  }
  // group outgoing connections per approach lane for arrow markings
  const movesByLane = new Map();
  for (const c of t.connections) {
    if (!movesByLane.has(c.from)) movesByLane.set(c.from, { kinds: new Set(), rbEntry: false, jx: j.x, jy: j.y });
    const e = movesByLane.get(c.from);
    if (c.kind === 'roundabout-entry') e.rbEntry = true;
    else if (['left', 'through', 'right'].includes(c.kind)) e.kinds.add(c.kind);
  }
  for (const [laneId, e] of movesByLane) {
    const moves = MOVE_ORDER.filter(k => e.kinds.has(k));
    if (e.rbEntry) {
      const cur = laneControl.get(laneId);
      if (cur) cur.roundaboutEntry = true;
      else laneControl.set(laneId, { kind: 'yield', jx: e.jx, jy: e.jy, roundaboutEntry: true });
    }
    if (moves.length >= 2 || e.rbEntry) {
      laneMoves.set(laneId, { jx: e.jx, jy: e.jy, moves, roundaboutEntry: e.rbEntry });
    }
  }
}

// ---- Phase 2: Irish road markings per segment
const junctionPoints = junctions.map(j => [j.x, j.y]);
const markCtx = { junctionPoints, laneControl, laneMoves };
let markingTotal = 0;
for (const s of segments) {
  s.markings = markingsForSegment(s, markCtx);
  markingTotal += s.markings.length;
}

writeFileSync(OUT, JSON.stringify(out));
const laneTotal = segments.reduce((a, s) => a + s.lanes.length, 0);
const connTotal = junctions.reduce((a, j) => a + j.connections.length, 0);
const ctlTotal = junctions.reduce((a, j) => a + j.controls.length, 0);
console.log(`segments=${segments.length} lanes=${laneTotal} junctions=${junctions.length} buildings=${buildings.length} water=${water.length}`);
console.log(`connections=${connTotal} controls=${ctlTotal} markings=${markingTotal}`);
const verified = segments.filter(s => s.laneConf === 'verified').length;
console.log(`lane layout: verified=${verified} inferred=${segments.length - verified}`);
const kinds = {};
for (const j of junctions) for (const c of j.connections) kinds[c.kind] = (kinds[c.kind] || 0) + 1;
console.log('connection kinds:', JSON.stringify(kinds));
if (snaps.length) console.log(`snapped ${snaps.length} way ends to junctions (generated):`, snaps.slice(0, 8).join('; ') + (snaps.length > 8 ? '…' : ''));
console.log('-> data/clane-network.json');
