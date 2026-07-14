import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],

    /** Wipe + seed the database once before the run, so every run starts identical. */
    globalSetup: ['./tests/global-setup.ts'],

    /**
     * Run test files one at a time.
     *
     * These are integration tests against a **single shared Postgres**, so
     * running the files concurrently races them against each other: two suites
     * would reserve stock on the same variant while a third asserted an exact
     * before/after delta on it. Vitest parallelises files by default, which made
     * the suite flaky rather than wrong. Isolation would need a database per
     * worker; until then, serial is the honest setting.
     */
    fileParallelism: false,
  },
});
