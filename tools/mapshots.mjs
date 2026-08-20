/**
 * Overhead screenshots of a map, for looking at rather than measuring.
 *
 * Drives the real renderer, so it is slow here — headless Chromium has no GPU
 * and software-rasterises every frame. That is fine for stills; only the timings
 * would be fiction, and this measures nothing.
 *
 * Camera is set directly rather than by flying the player: PlayerSystem only
 * stamps the rig onto the camera while `controlEnabled` is true, so switching
 * that off hands the camera over without the character falling out of the sky.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const MAP = process.argv[2] ?? 'miami';
const OUT = process.argv[3] ?? 'shots';
mkdirSync(OUT, { recursive: true });

const VIEWS = [
  { name: 'overhead', pos: [0, 62, 0], look: [0, 0, 0] },
  { name: 'north-oblique', pos: [0, 34, -46], look: [0, 0, 4] },
  { name: 'east-oblique', pos: [46, 30, 10], look: [-2, 0, 2] },
  { name: 'west-corner', pos: [-40, 26, -34], look: [-4, 0, -6] },
];

const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(`http://127.0.0.1:5181/?map=${MAP}&menu=0&q=high`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 600000 });
await p.waitForTimeout(2000);

// Put some ghouls on the ground so the shots show what the map plays like.
await p.evaluate(() => {
  const e = window.__ENGINE__;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ai')?.populate?.({ squads: 3, perSquad: 5, variants: ['ghoul'] });
  e.ctx.peek('ui')?.debugState?.('clean');
  // The point of the shot is the level: drop the gun and every DOM overlay.
  e.ctx.viewScene.visible = false;
  for (const el of document.body.children) {
    if (el.tagName !== 'CANVAS') el.style.display = 'none';
  }
});

for (const v of VIEWS) {
  await p.evaluate((view) => {
    const e = window.__ENGINE__;
    const c = e.camera;
    c.position.set(...view.pos);
    /**
     * Straight down is degenerate for lookAt: the default up (0,1,0) is parallel
     * to the view direction, so the roll is arbitrary and the first overhead
     * shot came out rotated 45 degrees. Point up at north for the top-down view.
     */
    /**
     * Straight down is degenerate for lookAt — the default up is parallel to the
     * view direction, so the roll is arbitrary and the arena came out as a
     * diamond. Setting the Euler directly is unambiguous: pitch fully down, no
     * yaw, no roll. The camera's order is YXZ, so this reads as "face north,
     * then tip over".
     */
    const straightDown = view.pos[0] === view.look[0] && view.pos[2] === view.look[2];
    if (straightDown) {
      c.rotation.set(-Math.PI / 2, 0, 0);
      c.quaternion.setFromEuler(c.rotation);
    } else {
      c.up.set(0, 1, 0);
      c.lookAt(...view.look);
    }
    c.updateMatrixWorld(true);
  }, v);
  // A few frames so the sky, exposure and any temporal pass settle.
  for (let i = 0; i < 6; i++) {
    await p.evaluate(() => window.__ENGINE__.step(performance.now() + 16));
    await p.waitForTimeout(120);
  }
  const file = `${OUT}/${MAP}-${v.name}.png`;
  await p.screenshot({ path: file });
  console.log(file);
}
await b.close();
