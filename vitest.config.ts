import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // The library is one package with module subpaths. Longest key first: Vite
    // rewrites by prefix, so `.../core/memory` has to win over `.../core`.
    alias: [
      { find: '@agentix-e/microglia-core/memory', replacement: here('./packages/core/src/memory/index.ts') },
      { find: '@agentix-e/microglia-core/distill', replacement: here('./packages/core/src/distill/index.ts') },
      { find: '@agentix-e/microglia-core/apply', replacement: here('./packages/core/src/apply/index.ts') },
      { find: '@agentix-e/microglia-core/capture', replacement: here('./packages/core/src/capture/index.ts') },
      { find: '@agentix-e/microglia-core/delivery', replacement: here('./packages/core/src/delivery/index.ts') },
      { find: '@agentix-e/microglia-core/providers', replacement: here('./packages/core/src/providers/index.ts') },
      { find: '@agentix-e/microglia-core/kernel', replacement: here('./packages/core/src/kernel/index.ts') },
      { find: '@agentix-e/microglia-core', replacement: here('./packages/core/src/index.ts') },
      { find: '@agentix-e/microglia-eval', replacement: here('./packages/eval/src/index.ts') },
      { find: '@agentix-e/microglia-node', replacement: here('./packages/node/src/index.ts') },
      { find: '@agentix-e/microglia-browser', replacement: here('./packages/browser/src/index.ts') },
    ],
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        '**/__tests__/**',
        '**/index.ts',
        '**/*.d.ts',
        // Declaration-only modules: they compile to an empty export and have no
        // branches to cover. Counting them would dilute the number, not measure it.
        '**/types.ts',
        '**/port.ts',
        '**/options.ts',
        '**/bench/**',
        // CLI entrypoints: top-level await that writes an artefact and exits. The
        // logic they call lives in the package and is covered there.
        '**/bin/**',
      ],
      thresholds: {
        // Every dimension is held to the same bar. A branch that cannot be
        // reached is removed or refactored, not exempted: the four that remain
        // are recorded by file and line in TECH-DESIGN §13.6 with the reason each
        // is unreachable, so the number is explained rather than tolerated.
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
