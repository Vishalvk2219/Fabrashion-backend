import { defineConfig } from 'tsup';

export default defineConfig({
  // The worker entry (src/workers/index.ts) is added in a later phase.
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  // Keep node_modules external; only our src is bundled. esbuild resolves the
  // "@/*" tsconfig path aliases for us.
  skipNodeModulesBundle: true,
});
