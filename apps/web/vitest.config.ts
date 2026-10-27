import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Component/unit tests for client islands and pure helpers (pages are covered by e2e). */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
