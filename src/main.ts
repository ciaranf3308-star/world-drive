import { Camera } from './render/camera.js';
import { Renderer } from './render/renderer.js';
import { RoadNetwork } from './road/types.js';
import { makeFrame } from './geo/proj.js';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hud = document.getElementById('hud')!;

const cam = new Camera(window.innerWidth, window.innerHeight);
const renderer = new Renderer(ctx);
const frame0 = makeFrame(53.2925, -6.6880);

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  cam.resize(canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

// --- input: drag pan, wheel zoom, keys
let dragging = false, lx = 0, ly = 0;
const keys = new Set<string>();
canvas.addEventListener('mousedown', e => { dragging = true; lx = e.clientX; ly = e.clientY; });
window.addEventListener('mouseup', () => dragging = false);
window.addEventListener('mousemove', e => {
  if (dragging) { cam.pan(e.clientX - lx, e.clientY - ly); lx = e.clientX; ly = e.clientY; }
  mouse = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  cam.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
}, { passive: false });
window.addEventListener('keydown', e => {
  keys.add(e.key.toLowerCase());
  if (e.key.toLowerCase() === 'd') {
    renderer.debugMode = (renderer.debugMode + 1) % 3;
  }
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
let mouse: { x: number; y: number } | null = null;

let net: RoadNetwork | null = null;
fetch('data/clane-network.json')
  .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
  .then((n: RoadNetwork) => {
    net = n;
    // centre on Clane main street area
    cam.cx = 0; cam.cy = 0; cam.zoom = 0.6;
  })
  .catch(e => { hud.textContent = 'Failed to load network: ' + e.message; });

let last = performance.now();
function tick(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const panSpeed = 500 / cam.zoom * dt;
  if (keys.has('arrowright')) cam.cx += panSpeed;
  if (keys.has('arrowup') || keys.has('w')) cam.cy += panSpeed;
  if (keys.has('arrowdown') || keys.has('s')) cam.cy -= panSpeed;
  if (keys.has('+') || keys.has('=')) cam.zoomAt(cam.w / 2, cam.h / 2, 1.03);
  if (keys.has('-') || keys.has('_')) cam.zoomAt(cam.w / 2, cam.h / 2, 1 / 1.03);

  if (net) {
    renderer.render(net, cam, mouse);
    let info = `WORLD DRIVE · Clane, Co. Kildare · ${net.segments.length} segs · ${net.junctions.length} junctions · zoom ${cam.zoom.toFixed(2)} px/m`;
    if (mouse) {
      const [wx, wy] = cam.screenToWorld(mouse.x, mouse.y);
      const [lat, lon] = frame0.toLatLon(wx, wy);
      info += ` · ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }
    info += ` · [D] debug ${['off', 'lanes', 'lanes+ids'][renderer.debugMode]}`;
    hud.textContent = info;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
