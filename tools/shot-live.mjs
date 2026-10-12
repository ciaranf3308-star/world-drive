import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

await page.goto('https://ciaranf3308-star.github.io/world-drive/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/wd-overview.png' });
// zoom in on town centre
await page.mouse.move(640, 400);
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(150); }
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/wd-zoom.png' });
// debug mode: press d twice -> lanes+ids
await page.keyboard.press('d');
await page.keyboard.press('d');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/wd-debug.png' });

const hud = await page.$eval('#hud', el => el.textContent);
console.log('HUD:', hud);
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();
