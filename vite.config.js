import { defineConfig } from 'vite';

/**
 * Inline the entry chunk into index.html so the build is one self-contained
 * file.
 *
 * Double-clicking the old dist/index.html gave a black screen: the tag was
 * `<script type="module" src="/assets/index-*.js">`, which from a file:// page
 * resolves to file:///C:/assets/... and is then blocked outright — Chrome only
 * loads module scripts over http/https/data. An INLINE module has no fetch to
 * block, so the same file now runs straight off the disk, and a portal can
 * host the one file at any path.
 */
function inlineEntry() {
  return {
    name: 'ow-inline-entry',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html'];
      const entry = Object.values(bundle).find((f) => f.type === 'chunk' && f.isEntry);
      if (!html || !entry) return;
      const tag = new RegExp(`<script[^>]*src="[^"]*${entry.fileName}"[^>]*></script>`);
      if (!tag.test(html.source)) return;
      // Function replacement: the bundle is full of `$&`-like sequences.
      // The map is still emitted next to the (now deleted) chunk, so the URL
      // has to be re-rooted or devtools looks for it beside index.html.
      const code = entry.code.replace(/(sourceMappingURL=)/, `$1assets/`);
      html.source = html.source.replace(tag, () => `<script type="module">${code}</script>`);
      delete bundle[entry.fileName];
    },
  };
}

export default defineConfig({
  plugins: [inlineEntry()],
  // Relative asset URLs so the build works from file:// and from any subpath a
  // games portal happens to host it under.
  base: './',
  // Bind IPv4 explicitly: the default `localhost` binds ::1 only on macOS,
  // which the capture harness (127.0.0.1) cannot reach.
  // `hmr: false` when the capture harness owns the server (OW_NO_HMR=1): a file
  // saved by a concurrently-working agent otherwise reloads the page mid-capture
  // and playwright fails with "Execution context was destroyed".
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: process.env.OW_NO_HMR ? false : undefined,
  },
  preview: { host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 4096 },
  // Large binary game assets served verbatim.
  assetsInclude: ['**/*.ktx2', '**/*.hdr', '**/*.exr', '**/*.bin', '**/*.glb'],
});
