// Convert OSM XML (from api.openstreetmap.org/api/0.6/map) into the
// Overpass-style JSON that build-network.mjs expects.
// Usage: node tools/osmxml-to-json.mjs /tmp/clane-osm.xml data/clane-raw.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [,, inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error('usage: osmxml-to-json.mjs <in.xml> <out.json>'); process.exit(1); }

const xml = readFileSync(inPath, 'utf8');
const elements = [];

const tagRe = /<tag k="([^"]*)" v="([^"]*)"\/>/g;
function tagsOf(block) {
  const t = {};
  let m; tagRe.lastIndex = 0;
  while ((m = tagRe.exec(block))) t[m[1]] = m[2];
  return t;
}

// nodes: <node id=".." lat=".." lon=".." .../> or <node ...>...</node>
const nodeRe = /<node id="(\d+)"([^>]*?)\/>|<node id="(\d+)"([^>]*?)>([\s\S]*?)<\/node>/g;
const latRe = /lat="([\d.\-]+)"/, lonRe = /lon="([\d.\-]+)"/;
let m;
while ((m = nodeRe.exec(xml))) {
  const id = parseInt(m[1] || m[3], 10);
  const attrs = m[2] || m[4];
  const la = latRe.exec(attrs), lo = lonRe.exec(attrs);
  if (!la || !lo) continue;
  const lat = parseFloat(la[1]), lon = parseFloat(lo[1]);
  const inner = m[5] || '';
  const tags = tagsOf(inner);
  const el = { type: 'node', id, lat, lon };
  if (Object.keys(tags).length) el.tags = tags;
  elements.push(el);
}

// ways: <way id=".."> <nd ref=".."/>... <tag .../> </way>
const wayRe = /<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g;
const ndRe = /<nd ref="(\d+)"\/>/g;
while ((m = wayRe.exec(xml))) {
  const id = parseInt(m[1], 10);
  const inner = m[2];
  const nodes = [];
  let n; ndRe.lastIndex = 0;
  while ((n = ndRe.exec(inner))) nodes.push(parseInt(n[1], 10));
  const tags = tagsOf(inner);
  elements.push({ type: 'way', id, nodes, tags });
}

// relations: <relation id=".."> <member type=".." ref=".." role=".."/>... <tag .../> </relation>
const relRe = /<relation id="(\d+)"[^>]*>([\s\S]*?)<\/relation>/g;
const memRe = /<member type="([a-z]+)" ref="(\d+)" role="([^"]*)"\/>/g;
while ((m = relRe.exec(xml))) {
  const id = parseInt(m[1], 10);
  const inner = m[2];
  const members = [];
  let n; memRe.lastIndex = 0;
  while ((n = memRe.exec(inner))) members.push({ type: n[1], ref: parseInt(n[2], 10), role: n[3] });
  const tags = tagsOf(inner);
  elements.push({ type: 'relation', id, members, tags });
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ elements }));
const ways = elements.filter(e => e.type === 'way').length;
const nodesN = elements.filter(e => e.type === 'node').length;
const rels = elements.filter(e => e.type === 'relation').length;
console.log(`nodes=${nodesN} ways=${ways} relations=${rels} -> ${outPath}`);
