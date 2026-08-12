/**
 * Responsive gate — measures the two things both portals check.
 *
 * Yandex: "the active area doesn't go beyond the screen area. No elements are
 * cut off." CrazyGames: text legible at devicePixelRatio 1 on 16x9 iframe sizes
 * and on phone screens.
 *
 * Both are measurable, so neither is left to a screenshot and an opinion: this
 * walks every element in the HUD and the menus at each viewport, and fails on
 * anything that sticks out of the frame or renders below the legibility floor.
 * Elements deliberately parked off-screen (sliding panels at rest, the compass
 * strip that scrolls under a mask) are excluded by being invisible at the time.
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5181/';

/** The sizes that actually decide certification. */
const VIEWPORTS = [
  { name: 'desktop 1080p', w: 1920, h: 1080 },
  { name: 'laptop 720p', w: 1280, h: 720 },
  { name: 'CG iframe 16:9', w: 900, h: 506 },
  { name: 'phone landscape', w: 844, h: 390 },
  { name: 'small phone landscape', w: 667, h: 375 },
  { name: 'tablet', w: 1024, h: 768 },
];

/**
 * The smallest type in the 1080p reference design (the minimap's N, the marker
 * names). The gate is not "is 9px readable" — that is the existing design's
 * call — it is "does any viewport render type SMALLER than the design ever
 * intended", which is the regression that actually produces unreadable HUDs.
 */
const MIN_PX = 9;

const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
let failures = 0;

/**
 * @param {import('playwright').Page} p
 * @param {string} root  selector whose subtree is measured
 */
const audit = (p, root) =>
  p.evaluate(
    ({ root, MIN_PX }) => {
      const host = document.querySelector(root);
      if (!host) return { missing: true };
      const vw = innerWidth;
      const vh = innerHeight;
      const overflow = [];
      const tiny = [];
      const seen = new Set();
      for (const e of host.querySelectorAll('*')) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
        const r = e.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        /**
         * Two kinds of ancestor make a child's own rect meaningless:
         *
         *   auto/scroll  the child is REACHABLE by scrolling, so it is not cut off
         *   hidden       the child is CLIPPED by design — the compass is a strip
         *                that scrolls under a mask and is mostly outside its own
         *                window at all times, which is the whole mechanism
         *
         * Only the container itself has to fit the viewport. Without this the
         * audit reported the compass ticks as off-screen at every size, which is
         * a false alarm about a widget that is working exactly as built.
         */
        let clipped = false;
        for (let n = e.parentElement; n && n !== host.parentElement; n = n.parentElement) {
          const cn = getComputedStyle(n);
          if (/auto|scroll|hidden/.test(cn.overflowY) || /auto|scroll|hidden/.test(cn.overflowX)) {
            clipped = true;
            break;
          }
        }
        const scrollable = clipped;
        const id = `${e.className || e.tagName}`;
        if (!scrollable && (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1)) {
          if (!seen.has(`o${id}`)) {
            seen.add(`o${id}`);
            overflow.push(`${id} [${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.right)}x${Math.round(r.bottom)}]`);
          }
        }
        const txt = e.textContent?.trim();
        const ownText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (txt && ownText && parseFloat(cs.fontSize) < MIN_PX) {
          if (!seen.has(`t${id}`)) {
            seen.add(`t${id}`);
            tiny.push(`${id} @${parseFloat(cs.fontSize).toFixed(1)}px`);
          }
        }
      }
      return {
        overflow,
        tiny,
        pageScrollsX: document.documentElement.scrollWidth > vw + 1,
      };
    },
    { root, MIN_PX }
  );

const report = (label, r) => {
  const bad = r.missing || r.pageScrollsX || r.overflow.length || r.tiny.length;
  if (bad) failures++;
  console.log(`${bad ? 'FAIL' : 'PASS'}  ${label}`);
  if (r.missing) console.log('        element never appeared');
  if (r.pageScrollsX) console.log('        page scrolls horizontally');
  for (const o of (r.overflow ?? []).slice(0, 4)) console.log(`        outside frame: ${o}`);
  for (const t of (r.tiny ?? []).slice(0, 4)) console.log(`        too small: ${t}`);
};

for (const v of VIEWPORTS) {
  const p = await b.newPage({ viewport: { width: v.w, height: v.h } });
  p.on('pageerror', (e) => console.log(`        [pageerror] ${e.message}`));

  // ---- main menu ----------------------------------------------------------
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.ow-career', { timeout: 30000 });
  report(`${v.name} ${v.w}x${v.h}  main menu`, await audit(p, '.ow-fe'));
  // Play must be reachable without the player knowing to scroll.
  const play = await p.evaluate(() => {
    const b = document.querySelector('.ow-play');
    const r = b.getBoundingClientRect();
    const host = document.querySelector('.ow-fe');
    return { visible: r.bottom <= innerHeight + 1, scrolls: host.scrollHeight > host.clientHeight + 1 };
  });
  const playOk = play.visible || play.scrolls;
  if (!playOk) failures++;
  console.log(`${playOk ? 'PASS' : 'FAIL'}  ${v.name}  play reachable${play.visible ? '' : ' (via scroll)'}`);

  // ---- in-game HUD, pause menu, gunsmith ----------------------------------
  await p.goto(`${BASE}?map=box&menu=0`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 180000 });
  await p.waitForTimeout(250);
  report(`${v.name}  HUD`, await audit(p, '.ow-hud'));

  await p.evaluate(() => window.__ENGINE__.ctx.peek('ui').menu.show());
  await p.waitForTimeout(200);
  report(`${v.name}  pause menu`, await audit(p, '.ow-menu'));

  await p.evaluate(() => {
    const ui = window.__ENGINE__.ctx.peek('ui');
    ui.menu.close();
    ui.gunsmith.show();
  });
  await p.waitForTimeout(200);
  report(`${v.name}  gunsmith`, await audit(p, '.ow-gun'));

  await p.close();
}

await b.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
