#!/usr/bin/env node
/**
 * Build and zip a portal submission.
 *
 *   node tools/package-portal.mjs yandex
 *   node tools/package-portal.mjs crazygames
 *
 * Both portals take the same thing: a ZIP whose ROOT contains index.html, under
 * a size cap. This build is one self-contained HTML file (see the inlineEntry
 * plugin in vite.config.js) plus its sourcemap, so the zip is index.html and the
 * third-party notices and nothing else — the sourcemap is deliberately dropped,
 * because it is larger than the game and neither portal wants it.
 *
 * VITE_PORTAL is what src/core/portal.js reads to decide which SDK to attach.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, copyFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const TARGETS = new Set(['yandex', 'crazygames']);
const target = process.argv[2];
if (!TARGETS.has(target)) {
  console.error(`usage: package-portal.mjs <${[...TARGETS].join('|')}>`);
  process.exit(1);
}

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'dist-portal', target);
/**
 * Vite's JS entry, run with this same node — NOT `npx`/`vite.cmd`.
 *
 * Node 20 refuses to spawnSync a `.cmd` without `shell: true` (EINVAL), and
 * turning the shell on to work around that means quoting paths by hand on a
 * machine whose project path may contain spaces. Calling the script directly
 * sidesteps both.
 */
const viteBin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

console.log(`[portal] building for ${target}`);
execFileSync(process.execPath, [viteBin, 'build', '--outDir', join('dist-portal', `${target}-raw`)], {
  cwd: ROOT,
  stdio: 'inherit',
  // No sourcemap: it is bigger than the game and no portal serves it.
  env: { ...process.env, VITE_PORTAL: target, VITE_SOURCEMAP: '0' },
});

const raw = join(ROOT, 'dist-portal', `${target}-raw`);
copyFileSync(join(raw, 'index.html'), join(OUT, 'index.html'));
// Both portals redistribute the build, so the MIT notices have to travel with
// it — this is a licence condition, not a nicety.
copyFileSync(join(ROOT, 'THIRD-PARTY-NOTICES.txt'), join(OUT, 'THIRD-PARTY-NOTICES.txt'));
rmSync(raw, { recursive: true, force: true });

const zip = join(ROOT, 'dist-portal', `${target}.zip`);
rmSync(zip, { force: true });
// PowerShell ships on every Windows box; `zip` does not.
if (process.platform === 'win32') {
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Compress-Archive -Path '${OUT}\\*' -DestinationPath '${zip}'`],
    { stdio: 'inherit' }
  );
} else {
  execFileSync('zip', ['-r', '-9', zip, '.'], { cwd: OUT, stdio: 'inherit' });
}

const mb = (p) => (statSync(p).size / 1024 / 1024).toFixed(2);
console.log(`\n[portal] ${target}`);
for (const f of readdirSync(OUT)) console.log(`  ${f.padEnd(28)} ${mb(join(OUT, f))} MB`);
console.log(`  ${'→ ' + zip}  ${mb(zip)} MB`);

/**
 * Yandex caps an uploaded archive at 100 MB and CrazyGames at 500 MB, so this
 * is a wide margin — but a build that suddenly jumps is worth knowing about,
 * since every byte here is generated code rather than art.
 */
if (existsSync(zip) && statSync(zip).size > 90 * 1024 * 1024) {
  console.warn('[portal] WARNING: archive is close to the 100 MB Yandex limit');
}
