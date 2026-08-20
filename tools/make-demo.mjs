/**
 * Repackage dist/index.html as a single artifact-hostable page.
 *
 * The Artifact host supplies its own doctype/html/head/body skeleton and wraps
 * whatever this emits, so a complete HTML document cannot be handed over as-is —
 * it would end up nested inside a body. This pulls out the parts that matter and
 * re-emits them in an order that still works when they are all body-level:
 * title, style, the canvas and UI mount, then the module script.
 *
 * Order is safe because the bundle is `type="module"`, which is deferred: it
 * runs after the document is parsed, so the canvas it reaches for exists no
 * matter where the tag sits.
 *
 * The `<meta viewport>` is dropped because the head belongs to the host — noted
 * here rather than silently, since it is the one thing lost in the transfer and
 * it is the tag that governs mobile scaling.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

const pick = (re, what) => {
  const m = src.match(re);
  if (!m) throw new Error(`demo build is missing its ${what} — did the build shape change?`);
  return m[0];
};

const style = pick(/<style>[\s\S]*?<\/style>/, '<style> block');
const scripts = src.match(/<script type="module">[\s\S]*?<\/script>/g) ?? [];
if (!scripts.length) throw new Error('demo build has no module script');

/**
 * A portal SDK URL surviving into the demo would be a request to a third-party
 * host, which the artifact CSP blocks outright. It should never be reached
 * (VITE_PORTAL is unset, so the adapter no-ops) but a string that is present is
 * a string that can be called, and the failure mode is a dead page.
 */
for (const host of ['yandex.ru/games/sdk', 'sdk.crazygames.com']) {
  if (!src.includes(host)) continue;
  console.warn(`  note: "${host}" is present as a string; portal.init() no-ops without VITE_PORTAL`);
}

const out = `<title>Hotline Strike</title>
${style}
<canvas id="game"></canvas>
<div id="ui"></div>
${scripts.join('\n')}
`;

const dest = new URL('../dist/demo.html', import.meta.url);
writeFileSync(dest, out);
console.log(`wrote ${dest.pathname}  ${(out.length / 1048576).toFixed(2)} MB`);
