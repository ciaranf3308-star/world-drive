// Compile raw OSM (data/clane-raw.json) into the WORLD DRIVE lane-level
// road network: data/clane-network.json
// Usage: node tools/build-network.mjs
//
// Output schema (all coordinates in local metres, x=east, y=north):
// {
//   meta: { origin:{lat,lon}, bbox, builtAt, source, licence },
//   segments: [{ id, name, highway, oneway, roundabout, speedKmh, speedConf,
//                laneWidthM, lanesPerDir, laneConf, laneConfSource,
//                centreline: [[x,y]...], lanes: [{id, dir, index, offsetM, centreline}] }],
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
      laneObjs.push({
        id: `L${segN}_${dir > 0 ? 'f' : 'b'}${i}`,
        dir, index: i, offsetM: +off.toFixed(3),
        centreline: offsetPolyline(centreline, off).map(p => [+p[0].toFixed(3), +p[1].toFixed(3)]),
      });
    }
  }

  segments.push({
    id: `S${segN}`,
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
    source: 'OpenStreetMap via Overpass API',
    licence: '© OpenStreetMap contributors (ODbL)',
  },
  segments, junctions, buildings, water,
};

writeFileSync(OUT, JSON.stringify(out));
const laneTotal = segments.reduce((a, s) => a + s.lanes.length, 0);
console.log(`segments=${segments.length} lanes=${laneTotal} junctions=${junctions.length} buildings=${buildings.length} water=${water.length}`);
const verified = segments.filter(s => s.laneConf === 'verified').length;
console.log(`lane layout: verified=${verified} inferred=${segments.length - verified}`);
console.log('-> data/clane-network.json');
