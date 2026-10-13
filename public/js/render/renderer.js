import { makeFrame } from '../geo/proj.js';
import { PALETTE } from '../traffic/sim.js';
const MARK_WHITE = '#ecece2';
const PX_PER_M = 9; // sprite resolution
// Pixel-art map renderer. All world units are metres; camera handles scale.
export class Renderer {
    ctx;
    grassTile;
    sprites = new Map();
    debugMode = 0; // 0=off, 1=lanes+junctions, 2=+ids+bbox
    constructor(ctx) {
        this.ctx = ctx;
        this.grassTile = this.makeGrassTile();
    }
    spriteFor(cls, colour) {
        const key = cls + '_' + colour;
        let sp = this.sprites.get(key);
        if (!sp) {
            sp = cls === 'van' ? this.makeVanSprite(colour) : this.makeCarSprite(colour);
            this.sprites.set(key, sp);
        }
        return sp;
    }
    hex(c) { return '#' + c.toString(16).padStart(6, '0'); }
    shade(c, f) {
        const r = Math.min(255, ((c >> 16) & 255) * f) | 0;
        const g = Math.min(255, ((c >> 8) & 255) * f) | 0;
        const b = Math.min(255, (c & 255) * f) | 0;
        return `rgb(${r},${g},${b})`;
    }
    // Top-down car sprite, facing up (-y = front). Pixel-art: chunky rects.
    makeCarSprite(colour) {
        const w = Math.ceil(1.85 * PX_PER_M), h = Math.ceil(4.4 * PX_PER_M);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        g.fillStyle = this.shade(colour, 0.55);
        g.fillRect(0, 0, w, h); // outline
        g.fillStyle = this.hex(colour);
        g.fillRect(1, 1, w - 2, h - 2); // body
        g.fillStyle = this.shade(colour, 1.18);
        g.fillRect(2, Math.floor(h * 0.42), w - 4, Math.floor(h * 0.22)); // roof highlight
        g.fillStyle = '#232d3a'; // glass
        g.fillRect(2, 3, w - 4, Math.floor(h * 0.16)); // windshield
        g.fillRect(2, Math.floor(h * 0.72), w - 4, Math.floor(h * 0.10)); // rear window
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.fillRect(2, 3, w - 4, 2); // glass shine
        return c;
    }
    makeVanSprite(colour) {
        const w = Math.ceil(2.0 * PX_PER_M), h = Math.ceil(6.8 * PX_PER_M);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        g.fillStyle = this.shade(colour, 0.55);
        g.fillRect(0, 0, w, h);
        g.fillStyle = this.hex(colour);
        g.fillRect(1, 1, w - 2, h - 2);
        g.fillStyle = '#232d3a';
        g.fillRect(2, 3, w - 4, Math.floor(h * 0.12)); // cab windshield
        g.fillStyle = 'rgba(0,0,0,0.12)'; // cargo panel lines
        for (let y = Math.floor(h * 0.3); y < h - 3; y += 5)
            g.fillRect(2, y, w - 4, 1);
        g.fillStyle = this.shade(colour, 1.15);
        g.fillRect(2, Math.floor(h * 0.2), w - 4, 2); // cab roof edge
        return c;
    }
    makeGrassTile() {
        const c = document.createElement('canvas');
        c.width = c.height = 96;
        const g = c.getContext('2d');
        g.fillStyle = '#5da24a';
        g.fillRect(0, 0, 96, 96);
        // deterministic speckle (seeded so tiles look stable)
        let s = 1234567;
        const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        for (let i = 0; i < 260; i++) {
            const x = (rnd() * 96) | 0, y = (rnd() * 96) | 0;
            g.fillStyle = rnd() < 0.5 ? '#549641' : '#66ad52';
            g.fillRect(x, y, 2, 2);
        }
        return c;
    }
    render(net, cam, mouse, traffic) {
        const { ctx } = this;
        const W = cam.w, H = cam.h;
        ctx.imageSmoothingEnabled = false;
        // --- background grass (tiled in world space so it pans with the map)
        const tileM = 24; // 96px tile = 24m
        const [wx0, wy0] = cam.screenToWorld(0, 0);
        const [wx1, wy1] = cam.screenToWorld(W, H);
        const t0x = Math.floor(wx0 / tileM) * tileM, t1x = Math.ceil(wx1 / tileM) * tileM;
        const t0y = Math.floor(wy1 / tileM) * tileM, t1y = Math.ceil(wy0 / tileM) * tileM;
        const ts = tileM * cam.zoom;
        for (let ty = t0y; ty < t1y; ty += tileM) {
            for (let tx = t0x; tx < t1x; tx += tileM) {
                const [sx, sy] = cam.worldToScreen(tx, ty + tileM);
                if (ts >= 2)
                    ctx.drawImage(this.grassTile, sx, sy, ts + 0.5, ts + 0.5);
            }
        }
        if (ts < 2) {
            ctx.fillStyle = '#5da24a';
            ctx.fillRect(0, 0, W, H);
        }
        // --- water
        ctx.fillStyle = '#3f7fbf';
        ctx.strokeStyle = '#3f7fbf';
        for (const w of net.water) {
            if (w.pts.length < 2)
                continue;
            if (w.kind === 'water' || w.kind === 'riverbank')
                this.fillPoly(w.pts, cam);
            else
                this.strokePoly(w.pts, cam, 3 * cam.zoom + 2);
        }
        // --- buildings (flat block + drop shadow = slight 2.5D read)
        for (const b of net.buildings) {
            const sh = b.pts.map(([x, y]) => cam.worldToScreen(x - 1.2, y - 1.2));
            ctx.fillStyle = 'rgba(0,0,0,0.22)';
            ctx.beginPath();
            sh.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#c9bfae';
            const p = b.pts.map(([x, y]) => cam.worldToScreen(x, y));
            ctx.beginPath();
            p.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = '#8a7f6d';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        // --- roads: casing then asphalt
        for (const s of net.segments)
            this.drawRoad(s, cam);
        // --- Irish road markings, generated from lane topology (Phase 2)
        if (cam.zoom >= 0.3) {
            for (const s of net.segments)
                this.drawMarkings(s, cam);
        }
        // --- traffic (Phase 3)
        if (traffic && cam.zoom > 0.22)
            this.renderVehicles(traffic, cam);
        if (this.debugMode >= 1)
            this.drawDebug(net, cam, traffic);
    }
    drawMarkings(s, cam) {
        const { ctx } = this;
        const z = cam.zoom;
        const thin = Math.max(1, 0.12 * z);
        ctx.strokeStyle = MARK_WHITE;
        ctx.fillStyle = MARK_WHITE;
        ctx.lineCap = 'butt';
        for (const m of s.markings) {
            switch (m.type) {
                case 'centre-dashed':
                    ctx.lineWidth = thin;
                    ctx.setLineDash([Math.max(2, 3 * z), Math.max(2, 4.5 * z)]);
                    this.strokePoly(m.pts, cam, 0);
                    ctx.setLineDash([]);
                    break;
                case 'centre-double-solid':
                case 'edge-solid':
                    ctx.lineWidth = thin;
                    this.strokePoly(m.pts, cam, 0);
                    break;
                case 'lane-dash':
                    ctx.lineWidth = thin;
                    ctx.setLineDash([Math.max(2, 2 * z), Math.max(2, 3 * z)]);
                    this.strokePoly(m.pts, cam, 0);
                    ctx.setLineDash([]);
                    break;
                case 'stop-line':
                    this.strokePoly(m.pts, cam, Math.max(2, 0.45 * z));
                    break;
                case 'yield-line':
                    ctx.lineWidth = Math.max(1.5, 0.3 * z);
                    ctx.setLineDash([Math.max(2, 1 * z), Math.max(2, 1 * z)]);
                    this.strokePoly(m.pts, cam, 0);
                    ctx.setLineDash([]);
                    break;
                case 'yield-triangle':
                    ctx.lineWidth = thin;
                    this.strokeClosed(m.pts, cam);
                    break;
                case 'arrow':
                    this.drawArrow(m, cam);
                    break;
                case 'text':
                    this.drawRoadText(m, cam);
                    break;
            }
        }
    }
    drawArrow(m, cam) {
        const { ctx } = this;
        const [sx, sy] = cam.worldToScreen(m.pos[0], m.pos[1]);
        const L = Math.max(12, 4.5 * cam.zoom); // arrow length px (~4.5m)
        const w = Math.max(1.5, 0.35 * cam.zoom);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(-(m.headingDeg * Math.PI / 180)); // math angle -> canvas angle
        ctx.strokeStyle = MARK_WHITE;
        ctx.fillStyle = MARK_WHITE;
        ctx.lineWidth = w;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const head = (x, y, dx, dy) => {
            const s = L * 0.16;
            ctx.beginPath();
            ctx.moveTo(x + dx * s * 1.6, y + dy * s * 1.6);
            ctx.lineTo(x - dy * s, y + dx * s);
            ctx.lineTo(x + dy * s, y - dx * s);
            ctx.closePath();
            ctx.fill();
        };
        for (const move of m.moves) {
            ctx.beginPath();
            if (move === 'through') {
                ctx.moveTo(-L / 2, 0);
                ctx.lineTo(L * 0.32, 0);
                ctx.stroke();
                head(L * 0.32, 0, 1, 0);
            }
            else if (move === 'left') { // canvas -y (up after rotation)
                ctx.moveTo(-L / 2, 0);
                ctx.lineTo(-L * 0.02, 0);
                ctx.quadraticCurveTo(L * 0.08, 0, L * 0.02, -L * 0.32);
                ctx.stroke();
                head(L * 0.02, -L * 0.32, 0, -1);
            }
            else if (move === 'right') {
                ctx.moveTo(-L / 2, 0);
                ctx.lineTo(-L * 0.02, 0);
                ctx.quadraticCurveTo(L * 0.08, 0, L * 0.02, L * 0.32);
                ctx.stroke();
                head(L * 0.02, L * 0.32, 0, 1);
            }
        }
        ctx.restore();
    }
    drawRoadText(m, cam) {
        const { ctx } = this;
        const [sx, sy] = cam.worldToScreen(m.pos[0], m.pos[1]);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(-(m.headingDeg * Math.PI / 180));
        ctx.fillStyle = MARK_WHITE;
        ctx.font = `bold ${Math.max(9, 1.7 * cam.zoom)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(m.text, 0, 0);
        ctx.restore();
    }
    strokeClosed(pts, cam) {
        const { ctx } = this;
        ctx.beginPath();
        pts.forEach(([x, y], i) => {
            const [sx, sy] = cam.worldToScreen(x, y);
            i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
        });
        ctx.closePath();
        ctx.stroke();
    }
    // --- AI traffic: procedural pixel-art vehicles, smoothly rotated
    renderVehicles(traffic, cam) {
        const { ctx } = this;
        const blink = Math.floor(traffic.time * 2.5) % 2 === 0;
        for (const v of traffic.sim.vehicles) {
            const [sx, sy] = cam.worldToScreen(v.x, v.y);
            if (sx < -60 || sy < -60 || sx > cam.w + 60 || sy > cam.h + 60)
                continue;
            const sp = this.spriteFor(v.cls, PALETTE[v.colour % PALETTE.length]);
            const w = v.width * cam.zoom, h = v.length * cam.zoom;
            // drop shadow
            ctx.save();
            ctx.translate(sx + Math.max(1, 0.25 * cam.zoom), sy + Math.max(1, 0.35 * cam.zoom));
            ctx.rotate(Math.PI / 2 - v.heading);
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            ctx.fillRect(-w / 2, -h / 2, w, h);
            ctx.restore();
            // body
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(Math.PI / 2 - v.heading);
            ctx.drawImage(sp, -w / 2, -h / 2, w, h);
            // lights in vehicle-local space: +x = right, -y = front
            const lw = Math.max(1, w * 0.14), lh = Math.max(1, h * 0.05);
            // headlights (front)
            ctx.fillStyle = '#fff6c9';
            ctx.fillRect(-w / 2 + 1, -h / 2, lw, lh);
            ctx.fillRect(w / 2 - 1 - lw, -h / 2, lw, lh);
            // brake lights (rear)
            ctx.fillStyle = v.brake ? '#ff2a2a' : '#8f1414';
            ctx.fillRect(-w / 2 + 1, h / 2 - lh, lw, lh);
            ctx.fillRect(w / 2 - 1 - lw, h / 2 - lh, lw, lh);
            // indicators
            if (v.indicator !== 'off' && blink) {
                ctx.fillStyle = '#ffaa00';
                const ix = v.indicator === 'left' ? -w / 2 + 1 : w / 2 - 1 - lw;
                ctx.fillRect(ix, -h / 2, lw, lh);
                ctx.fillRect(ix, h / 2 - lh, lw, lh);
            }
            ctx.restore();
        }
    }
    roadWidthM(s) {
        const dirs = s.oneway || s.roundabout ? 1 : 2;
        return s.lanesPerDir * s.laneWidthM * dirs + 1.0; // +1m shoulders
    }
    drawRoad(s, cam) {
        const { ctx } = this;
        const wPx = this.roadWidthM(s) * cam.zoom;
        if (wPx < 1.5) { // far out: draw as simple line
            ctx.strokeStyle = '#4a4a4e';
            ctx.lineWidth = 1.5;
            this.strokePoly(s.centreline, cam, 1.5);
            return;
        }
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#3a3a3e'; // casing
        this.strokePoly(s.centreline, cam, wPx + Math.max(2, 1.2 * cam.zoom));
        ctx.strokeStyle = s.highway === 'motorway' ? '#55555c' : '#4c4c52'; // asphalt
        this.strokePoly(s.centreline, cam, wPx);
    }
    strokePoly(pts, cam, widthPx) {
        const { ctx } = this;
        if (widthPx > 0) {
            ctx.lineWidth = widthPx;
        }
        ctx.beginPath();
        pts.forEach(([x, y], i) => {
            const [sx, sy] = cam.worldToScreen(x, y);
            i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
        });
        ctx.stroke();
    }
    fillPoly(pts, cam) {
        const { ctx } = this;
        ctx.beginPath();
        pts.forEach(([x, y], i) => {
            const [sx, sy] = cam.worldToScreen(x, y);
            i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
        });
        ctx.closePath();
        ctx.fill();
    }
    drawDebug(net, cam, traffic) {
        const { ctx } = this;
        // lane centre-lines
        ctx.lineWidth = 1;
        for (const s of net.segments) {
            for (const lane of s.lanes) {
                ctx.strokeStyle = lane.dir > 0 ? '#22ff88' : '#ffaa22';
                ctx.beginPath();
                lane.centreline.forEach(([x, y], i) => {
                    const [sx, sy] = cam.worldToScreen(x, y);
                    i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
                });
                ctx.stroke();
                if (this.debugMode >= 2) {
                    const [mx, my] = lane.centreline[(lane.centreline.length / 2) | 0];
                    const [sx, sy] = cam.worldToScreen(mx, my);
                    ctx.fillStyle = '#fff';
                    ctx.font = '9px monospace';
                    ctx.fillText(lane.id, sx + 3, sy - 3);
                }
            }
        }
        // junctions
        for (const j of net.junctions) {
            const [sx, sy] = cam.worldToScreen(j.x, j.y);
            ctx.fillStyle = '#ff3355';
            ctx.beginPath();
            ctx.arc(sx, sy, 4, 0, 7);
            ctx.fill();
            if (this.debugMode >= 2) {
                ctx.fillStyle = '#fff';
                ctx.font = '9px monospace';
                ctx.fillText(`${j.id} deg${j.degree}`, sx + 6, sy + 3);
            }
        }
        // turn connections (allowed manoeuvres per junction)
        const connColor = {
            through: '#39d353', left: '#33ccff', right: '#ff66cc',
            'roundabout-entry': '#ffbb33', 'roundabout-exit': '#99ee66', circulate: '#ffee66',
        };
        for (const j of net.junctions) {
            const [jx, jy] = cam.worldToScreen(j.x, j.y);
            for (const c of j.connections) {
                // draw departure tick in the exit direction, coloured by manoeuvre
                const dx = c.toHx, dy = -c.toHy; // math -> screen
                const len = this.debugMode >= 2 ? 12 : 8;
                ctx.strokeStyle = connColor[c.kind] || '#fff';
                ctx.lineWidth = this.debugMode >= 2 ? 2 : 1;
                ctx.beginPath();
                ctx.moveTo(jx + dx * 3, jy + dy * 3);
                ctx.lineTo(jx + dx * len, jy + dy * len);
                ctx.stroke();
            }
        }
        // chunk bbox (lat/lon -> local metres)
        if (this.debugMode >= 2) {
            const bb = net.meta.bbox;
            const frame = makeFrame(net.meta.origin.lat, net.meta.origin.lon);
            const [x0, y1] = frame.toLocal(bb.north, bb.west);
            const [x1, y0] = frame.toLocal(bb.south, bb.east);
            const [sx0, sy0] = cam.worldToScreen(x0, y1);
            const [sx1, sy1] = cam.worldToScreen(x1, y0);
            ctx.strokeStyle = '#00ccff';
            ctx.setLineDash([6, 4]);
            ctx.lineWidth = 2;
            ctx.strokeRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
            ctx.setLineDash([]);
            ctx.fillStyle = '#00ccff';
            ctx.font = '11px monospace';
            ctx.fillText(`chunk: Clane ${bb.south.toFixed(3)}..${bb.north.toFixed(3)}, ${bb.west.toFixed(3)}..${bb.east.toFixed(3)}`, 14, 26);
        }
        if (traffic)
            this.drawTrafficDebug(traffic, cam);
    }
    drawTrafficDebug(traffic, cam) {
        const { ctx } = this;
        const sim = traffic.sim;
        // junction reservation boxes (occupied conflict zones)
        for (const [jid, set] of sim.occupancy) {
            if (!set.size)
                continue;
            const j = sim.idx.junctionById.get(jid);
            if (!j)
                continue;
            const [sx, sy] = cam.worldToScreen(j.x, j.y);
            const r = 9 * cam.zoom;
            ctx.strokeStyle = '#ff3333';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(sx - r, sy - r, r * 2, r * 2);
            ctx.setLineDash([]);
        }
        for (const v of sim.vehicles) {
            const [sx, sy] = cam.worldToScreen(v.x, v.y);
            if (sx < -40 || sy < -40 || sx > cam.w + 40 || sy > cam.h + 40)
                continue;
            // target/actual speed label
            if (cam.zoom > 0.7) {
                ctx.fillStyle = v.v < 0.3 ? '#ff5555' : '#ffffff';
                ctx.font = '9px monospace';
                ctx.fillText(`${v.id}:${v.v.toFixed(1)}`, sx + 6, sy - 6);
            }
            if (this.debugMode >= 2) {
                // collision circle
                ctx.strokeStyle = '#ffdd33';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(sx, sy, (v.length / 2) * cam.zoom, 0, 7);
                ctx.stroke();
                // remaining route polyline (next few lanes)
                ctx.strokeStyle = 'rgba(0,255,255,0.75)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                let started = false;
                const steps = v.route.slice(0, 5);
                for (let i = 0; i < steps.length; i++) {
                    const lane = sim.idx.lanes.get(steps[i].laneId);
                    if (!lane)
                        continue;
                    const pts = lane.pts;
                    pts.forEach(([x, y], k) => {
                        if (i === 0 && lane.cum[k] < v.s)
                            return;
                        const [px, py] = cam.worldToScreen(x, y);
                        if (!started) {
                            ctx.moveTo(px, py);
                            started = true;
                        }
                        else
                            ctx.lineTo(px, py);
                    });
                }
                ctx.stroke();
            }
        }
    }
}
