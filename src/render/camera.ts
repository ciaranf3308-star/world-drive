// Camera: world metres (x=east, y=north) <-> screen pixels (y down).
export class Camera {
  cx = 0; cy = 0; // world centre (metres)
  zoom = 0.5; // pixels per metre
  constructor(public w: number, public h: number) {}

  resize(w: number, h: number) { this.w = w; this.h = h; }

  worldToScreen(x: number, y: number): [number, number] {
    return [(x - this.cx) * this.zoom + this.w / 2, this.h / 2 - (y - this.cy) * this.zoom];
  }
  screenToWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.w / 2) / this.zoom + this.cx, (this.h / 2 - sy) / this.zoom + this.cy];
  }
  zoomAt(sx: number, sy: number, factor: number) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.zoom = Math.min(8, Math.max(0.08, this.zoom * factor));
    const [nx, ny] = this.screenToWorld(sx, sy);
    this.cx += wx - nx; this.cy += wy - ny;
  }
  pan(dxPx: number, dyPx: number) {
    this.cx -= dxPx / this.zoom;
    this.cy += dyPx / this.zoom;
  }
}
