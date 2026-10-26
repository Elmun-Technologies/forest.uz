import { defineConfig } from 'tsup';

// Keep dist during watch so running apps don't crash on rebuild.
export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: !options.watch,
  target: 'es2022',
}));
