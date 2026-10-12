// Fetch real OSM data for the Clane playable area via Overpass API.
// Usage: node tools/fetch-osm.mjs
// Writes: data/clane-raw.json (raw Overpass JSON, cached for reproducibility)
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const BBOX = { south: 53.280, west: -6.708, north: 53.305, east: -6.668 }; // ~2.8km x 2.7km around Clane
const OUT = new URL('../data/clane-raw.json', import.meta.url);

const QUERY = `
[out:json][timeout:90];
(
  way["highway"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["building"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["natural"="water"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  relation["natural"="water"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["waterway"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
);
out body;
>;
out skel qt;
`;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.nchc.org.tw/api/interpreter',
];

async function fetchOne(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(QUERY),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

let lastErr;
for (const ep of ENDPOINTS) {
  try {
    console.log('Trying', ep);
    const data = await fetchOne(ep);
    if (!data.elements || data.elements.length === 0) throw new Error('empty response');
    mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
    writeFileSync(OUT, JSON.stringify(data));
    const ways = data.elements.filter(e => e.type === 'way').length;
    const nodes = data.elements.filter(e => e.type === 'node').length;
    console.log(`OK: ${data.elements.length} elements (${ways} ways, ${nodes} nodes) -> data/clane-raw.json`);
    process.exit(0);
  } catch (e) { console.log('  failed:', e.message); lastErr = e; }
}
console.error('All Overpass endpoints failed:', lastErr?.message);
process.exit(1);
