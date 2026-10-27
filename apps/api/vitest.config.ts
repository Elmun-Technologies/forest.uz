import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is required so Nest's decorator metadata (DI) works under Vitest.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/**/*.int.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 180_000,
          // Suites share one seeded DB (settings, integration rows). `fileParallelism` alone is
          // ignored inside `projects` in Vitest 3, so files also share a single fork → sequential.
          fileParallelism: false,
          poolOptions: { forks: { singleFork: true } },
          globalSetup: ['test/global-setup.ts'],
        },
      },
    ],
  },
});
