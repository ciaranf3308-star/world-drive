import { makeFrame } from '../geo/proj.js';
// Pixel-art map renderer. All world units are metres; camera handles scale.
export class Renderer {
    ctx;
    grassTile;
    debugMode = 0; // 0=off, 1=lanes+junctions, 2=+ids+bbox
    constructor(ctx) {
        this.ctx = ctx;
        this.grassTile = this.makeGrassTile();
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
    render(net, cam, mouse) {
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
        // --- simple centre dashes for two-way roads (Phase 1 placeholder; Phase 2 = proper markings)
        ctx.strokeStyle = 'rgba(240,240,230,0.85)';
        for (const s of net.segments) {
            if (s.oneway || s.roundabout || s.lanesPerDir < 1)
                continue;
            ctx.lineWidth = Math.max(1, 0.15 * cam.zoom);
            ctx.setLineDash([Math.max(2, 2 * cam.zoom), Math.max(2, 2 * cam.zoom)]);
            this.strokePoly(s.centreline, cam, 0);
            ctx.setLineDash([]);
        }
        if (this.debugMode >= 1)
            this.drawDebug(net, cam);
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
    drawDebug(net, cam) {
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
    }
}
