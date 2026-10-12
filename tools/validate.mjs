// WORLD DRIVE network validation — automated integrity checks on
// data/clane-network.json. Usage: node tools/validate.mjs
// Exit 0 = all PASS, 1 = any FAIL.
import { readFileSync } from 'node:fs';

const NET = new URL('../data/clane-network.json', import.meta.url);
const net = JSON.parse(readFileSync(NET, 'utf8'));

const results = [];
function check(name, fn) {
  try {
    const r = fn();
    results.push({ name, pass: r.pass, warn: !!r.warn, detail: r.detail });
  } catch (e) {
    results.push({ name, pass: false, detail: 'exception: ' + e.message });
  }
}

const laneById = new Map();
const lanes = [];
for (const s of net.segments) for (const l of s.lanes) {
  laneById.set(l.id, { lane: l, seg: s });
  lanes.push({ lane: l, seg: s });
}
function travelEnds(l) {
  const p = l.centreline;
  return l.dir > 0
    ? { start: p[0], end: p[p.length - 1] }
    : { start: p[p.length - 1], end: p[0] };
}
// Per-junction event tolerance mirrors buildJunctionTopology:
// max lane offset among incident segments + 2m.
function junctionTol(j) {
  let m = 0;
  for (const w of j.wayIds) {
    const s = net.segments.find(s => s.osmWayId === w);
    if (s) m = Math.max(m, s.lanesPerDir * s.laneWidthM);
  }
  return m + 2;
}
function nearJunctions(x, y, tolFn) {
  const out = [];
  for (const j of net.junctions) {
    const tol = tolFn ? tolFn(j) : 8;
    if (Math.hypot(j.x - x, j.y - y) < tol) out.push(j);
  }
  return out;
}
// connections indexed by from-lane and to-lane
const connFrom = new Map(), connTo = new Map();
for (const j of net.junctions) for (const c of (j.connections || [])) {
  if (!connFrom.has(c.from)) connFrom.set(c.from, []);
  connFrom.get(c.from).push(c);
  if (!connTo.has(c.to)) connTo.set(c.to, []);
  connTo.get(c.to).push(c);
}

// 1. Disconnected lane endpoints: travel ends at a junction must have connections.
check('lane endpoints at junctions have connections', () => {
  const bad = [];
  for (const { lane } of lanes) {
    const { start, end } = travelEnds(lane);
    const jEnds = nearJunctions(end[0], end[1], junctionTol);
    if (jEnds.length && !(connFrom.get(lane.id) || []).some(c => jEnds.some(j => j.id === c.via))) {
      bad.push(`${lane.id}: travel end near ${jEnds.map(j => j.id).join('/')} but no exit connection`);
    }
    const jStarts = nearJunctions(start[0], start[1], junctionTol);
    if (jStarts.length && !(connTo.get(lane.id) || []).some(c => jStarts.some(j => j.id === c.via))) {
      bad.push(`${lane.id}: travel start near ${jStarts.map(j => j.id).join('/')} but no entry connection`);
    }
  }
  return { pass: bad.length === 0, detail: bad.length ? `${bad.length} problems, e.g. ${bad[0]}` : `${lanes.length} lanes checked` };
});

// 2. Invalid turn connections: true U-turns that slipped through (>150°);
// sharp hairpins (120-150°) are legal at acute junctions — WARN only.
check('no invalid turn angles', () => {
  const bad = [], warn = [];
  for (const j of net.junctions) for (const c of (j.connections || [])) {
    if (c.kind === 'circulate') continue;
    const a = Math.abs(c.angleDeg);
    if (a > 150) bad.push(`${c.from}->${c.to} ${c.angleDeg}° (${c.kind})`);
    else if (a > 120) warn.push(`${c.from}->${c.to} ${c.angleDeg}°`);
  }
  const detail = bad.length ? bad.slice(0, 3).join('; ')
    : warn.length ? `${warn.length} hairpins 120-150° (legal, e.g. ${warn[0]})` : 'all turn angles sane';
  return { pass: bad.length === 0, warn: bad.length === 0 && warn.length > 0, detail };
});

// 3. Driving direction vs oneway / roundabout.
check('oneway/roundabout segments have forward-only lanes', () => {
  const bad = [];
  for (const s of net.segments) {
    if ((s.oneway || s.roundabout) && s.lanes.some(l => l.dir === -1)) bad.push(s.id);
  }
  return { pass: bad.length === 0, detail: bad.length ? `backward lanes on: ${bad.join(',')}` : 'directions consistent' };
});

// 4. Roundabout integrity, accounting for ring segmentation:
// - a junction where non-ring roads meet the ring needs entry + exit
// - a junction where the ring passes through needs circulate
check('roundabout junctions have entry/exit/circulate', () => {
  const bad = [];
  for (const j of net.junctions) {
    const kinds = new Set((j.connections || []).map(c => c.kind));
    const isRb = kinds.has('roundabout-entry') || kinds.has('circulate') || kinds.has('roundabout-exit');
    if (!isRb) continue;
    const segs = j.wayIds.map(w => net.segments.find(s => s.osmWayId === w)).filter(Boolean);
    const hasPlain = segs.some(s => !s.roundabout);
    const ringSegs = segs.filter(s => s.roundabout).length;
    if (hasPlain) {
      if (!kinds.has('roundabout-entry')) bad.push(`${j.id}: entry road but no roundabout-entry`);
      if (!kinds.has('roundabout-exit')) bad.push(`${j.id}: entry road but no roundabout-exit`);
    }
    if (ringSegs >= 1 && !kinds.has('circulate')) bad.push(`${j.id}: ring present but no circulate`);
  }
  return { pass: bad.length === 0, detail: bad.length ? bad.slice(0, 5).join('; ') : 'all ring junctions complete' };
});

// 5. Duplicate segments (same OSM way compiled twice).
check('no duplicate OSM ways', () => {
  const seen = new Map();
  const dups = [];
  for (const s of net.segments) {
    if (seen.has(s.osmWayId)) dups.push(s.osmWayId);
    seen.set(s.osmWayId, s.id);
  }
  return { pass: dups.length === 0, detail: dups.length ? `dup ways: ${dups.join(',')}` : `${seen.size} unique ways` };
});

// 6. Junctions with no connections at all.
check('every junction has turn connections', () => {
  const bad = net.junctions.filter(j => (j.connections || []).length === 0).map(j => j.id);
  return { pass: bad.length === 0, detail: bad.length ? `${bad.length} dead junctions: ${bad.slice(0, 5).join(',')}` : `${net.junctions.length} junctions connected` };
});

// 7. Lane-graph reachability: BFS from 20 seeded lanes.
check('lane graph reachability (>=95% of lanes reachable)', () => {
  const adj = new Map();
  for (const [from, cs] of connFrom) adj.set(from, cs.map(c => c.to));
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const starts = [];
  for (let i = 0; i < 20 && i < lanes.length; i++) starts.push(lanes[(rnd() * lanes.length) | 0].lane.id);
  const seen = new Set();
  const q = [...starts];
  while (q.length) {
    const id = q.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const nx of (adj.get(id) || [])) if (!seen.has(nx)) q.push(nx);
  }
  const pct = (100 * seen.size / lanes.length).toFixed(1);
  return { pass: seen.size / lanes.length >= 0.95, detail: `${seen.size}/${lanes.length} lanes reachable (${pct}%)` };
});

// 8. Marking sanity: stop/yield controls have matching markings.
check('junction controls have matching markings', () => {
  const markedTypes = new Set();
  for (const s of net.segments) for (const m of (s.markings || [])) markedTypes.add(m.type);
  const needStop = net.junctions.some(j => (j.controls || []).some(c => c.kind === 'stop'));
  const needYield = net.junctions.some(j => (j.controls || []).some(c => c.kind === 'yield'));
  const bad = [];
  if (needStop && !markedTypes.has('stop-line')) bad.push('stop controls but no stop-line markings');
  if (needYield && !markedTypes.has('yield-line')) bad.push('yield controls but no yield-line markings');
  return { pass: bad.length === 0, detail: bad.join('; ') || 'controls and markings consistent' };
});

let fails = 0, warns = 0;
for (const r of results) {
  const tag = r.pass ? (r.warn ? 'WARN' : 'PASS') : 'FAIL';
  console.log(`${tag}  ${r.name} — ${r.detail}`);
  if (!r.pass) fails++;
  else if (r.warn) warns++;
}
console.log(`\n${results.length - fails}/${results.length} checks passed${warns ? `, ${warns} with warnings` : ''}`);
process.exit(fails ? 1 : 0);
