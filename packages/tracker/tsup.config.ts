import { defineConfig } from 'tsup';

/** One self-contained, minified IIFE (`dist/t.js`), served by the storefront as `/t.js`. */
export default defineConfig({
  entry: { t: 'src/tracker.ts' },
  format: ['iife'],
  outExtension: () => ({ js: '.js' }),
  platform: 'browser',
  target: 'es2019',
  minify: true,
  treeshake: true,
  sourcemap: false,
  clean: true,
  dts: false,
  // Bundle the zod-free contracts helpers into the script.
  noExternal: [/^@forest\//],
});
