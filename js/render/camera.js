// Camera: world metres (x=east, y=north) <-> screen pixels (y down).
export class Camera {
    w;
    h;
    cx = 0;
    cy = 0; // world centre (metres)
    zoom = 0.5; // pixels per metre
    constructor(w, h) {
        this.w = w;
        this.h = h;
    }
    resize(w, h) { this.w = w; this.h = h; }
    worldToScreen(x, y) {
        return [(x - this.cx) * this.zoom + this.w / 2, this.h / 2 - (y - this.cy) * this.zoom];
    }
    screenToWorld(sx, sy) {
        return [(sx - this.w / 2) / this.zoom + this.cx, (this.h / 2 - sy) / this.zoom + this.cy];
    }
    zoomAt(sx, sy, factor) {
        const [wx, wy] = this.screenToWorld(sx, sy);
        this.zoom = Math.min(8, Math.max(0.08, this.zoom * factor));
        const [nx, ny] = this.screenToWorld(sx, sy);
        this.cx += wx - nx;
        this.cy += wy - ny;
    }
    pan(dxPx, dyPx) {
        this.cx -= dxPx / this.zoom;
        this.cy += dyPx / this.zoom;
    }
}
