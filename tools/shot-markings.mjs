import { chromium } from 'playwright';

// Close-up verification of Phase 2 markings.
// Usage: node tools/shot-markings.mjs  (screenshots a stop junction + a roundabout)
const browser = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// Pan so world (72,92) [stop junction J382] is centred: camera starts at (0,0),
// zoom 0.6. Screen centre = camera centre. Drag by -(target*zoom) px.
async function centreOn(wx, wy, zoomTarget) {
  // first set zoom via wheel at centre
  await page.mouse.move(640, 400);
  for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(60); }
  // read current zoom from HUD
  const hud = await page.$eval('#hud', el => el.textContent);
  const z = parseFloat(hud.match(/zoom ([\d.]+)/)[1]);
  // drag: moving mouse by (dx,dy) pans camera by -(dx,dy)/z in world... cam.pan(dxPx,dyPx): cx -= dx/z
  // to centre (wx,wy): need cx=wx -> drag dx = -(wx - cx)*z; cx starts 0
  const dx = -wx * z, dy = wy * z; // screen y down, world y up: to move view up (+wy), drag down
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(640 + dx, 400 + dy, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(600);
}

await centreOn(72, 92);
await page.screenshot({ path: '/tmp/wd-stop.png' });

// roundabout J33 @ (401,285)
await page.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await centreOn(401, 285);
await page.keyboard.press('d'); // debug lanes to see connections too
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/wd-roundabout.png' });

console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();
