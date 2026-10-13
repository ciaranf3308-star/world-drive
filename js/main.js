import { Camera } from './render/camera.js';
import { Renderer } from './render/renderer.js';
import { makeFrame } from './geo/proj.js';
import { Sim, SIM_DT } from './traffic/sim.js';
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');
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
const keys = new Set();
let paused = false;
let simSeed = 20261013;
canvas.addEventListener('mousedown', e => { dragging = true; lx = e.clientX; ly = e.clientY; });
window.addEventListener('mouseup', () => dragging = false);
window.addEventListener('mousemove', e => {
    if (dragging) {
        cam.pan(e.clientX - lx, e.clientY - ly);
        lx = e.clientX;
        ly = e.clientY;
    }
    mouse = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('wheel', e => {
    e.preventDefault();
    cam.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
}, { passive: false });
window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === 'd') {
        renderer.debugMode = (renderer.debugMode + 1) % 3;
    }
    else if (k === ' ') {
        paused = !paused;
        e.preventDefault();
    }
    else if (k === 'r') {
        simSeed = (Math.random() * 0x7fffffff) | 0;
        if (net)
            sim = new Sim(net, simSeed);
    }
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
let mouse = null;
let net = null;
let sim = null;
fetch('data/clane-network.json')
    .then(r => { if (!r.ok)
    throw new Error('HTTP ' + r.status); return r.json(); })
    .then((n) => {
    net = n;
    sim = new Sim(net, simSeed);
    // centre on Clane main street area
    cam.cx = 0;
    cam.cy = 0;
    cam.zoom = 0.6;
})
    .catch(e => { hud.textContent = 'Failed to load network: ' + e.message; });
let last = performance.now();
let acc = 0;
function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const panSpeed = 500 / cam.zoom * dt;
    if (keys.has('arrowleft') || keys.has('a'))
        cam.cx -= panSpeed;
    if (keys.has('arrowright'))
        cam.cx += panSpeed;
    if (keys.has('arrowup') || keys.has('w'))
        cam.cy += panSpeed;
    if (keys.has('arrowdown') || keys.has('s'))
        cam.cy -= panSpeed;
    if (keys.has('+') || keys.has('='))
        cam.zoomAt(cam.w / 2, cam.h / 2, 1.03);
    if (keys.has('-') || keys.has('_'))
        cam.zoomAt(cam.w / 2, cam.h / 2, 1 / 1.03);
    // fixed-timestep traffic sim (deterministic)
    if (sim && !paused) {
        acc += dt;
        let n = 0;
        while (acc >= SIM_DT && n < 5) {
            sim.step(SIM_DT);
            acc -= SIM_DT;
            n++;
        }
        if (n === 5)
            acc = 0;
    }
    if (net) {
        renderer.render(net, cam, mouse, sim ? { sim, time: sim.time } : undefined);
        let info = `WORLD DRIVE · Clane, Co. Kildare · ${net.segments.length} segs · ${net.junctions.length} junctions · zoom ${cam.zoom.toFixed(2)} px/m`;
        if (sim) {
            info += ` · ${sim.vehicles.length} cars · t=${sim.time.toFixed(0)}s · avg ${sim.avgSpeed().toFixed(1)} m/s${paused ? ' · PAUSED' : ''}`;
        }
        if (mouse) {
            const [wx, wy] = cam.screenToWorld(mouse.x, mouse.y);
            const [lat, lon] = frame0.toLatLon(wx, wy);
            info += ` · ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
        }
        info += ` · [D] debug ${['off', 'lanes', 'lanes+ids'][renderer.debugMode]} · [Space] pause · [R] reseed`;
        hud.textContent = info;
    }
    requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
