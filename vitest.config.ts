import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@agentix-e/microglia-core': here('./packages/core/src/index.ts'),
      '@agentix-e/microglia-memory': here('./packages/memory/src/index.ts'),
      '@agentix-e/microglia-nl2charts': here('./packages/nl2charts/src/index.ts'),
      '@agentix-e/microglia-distill': here('./packages/distill/src/index.ts'),
      '@agentix-e/microglia-apply': here('./packages/apply/src/index.ts'),
      '@agentix-e/microglia-capture': here('./packages/capture/src/index.ts'),
      '@agentix-e/microglia-cortex-adapter': here('./packages/cortex-adapter/src/index.ts'),
      '@agentix-e/microglia-eval': here('./packages/eval/src/index.ts'),
    },
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
