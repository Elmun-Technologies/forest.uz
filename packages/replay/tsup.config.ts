import { defineConfig } from 'tsup';

/**
 * One self-contained, minified IIFE (`dist/r.js`, rrweb recorder + upload), served by the
 * storefront as `/r.js` and loaded only for consented, sampled sessions (never on first load).
 */
export default defineConfig({
  entry: { r: 'src/recorder.ts' },
  format: ['iife'],
  outExtension: () => ({ js: '.js' }),
  platform: 'browser',
  target: 'es2019',
  minify: true,
  treeshake: true,
  sourcemap: false,
  clean: true,
  dts: false,
  noExternal: [/^@forest\//, /^rrweb/, /^@rrweb\//],
});
