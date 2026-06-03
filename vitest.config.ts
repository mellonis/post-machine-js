import {defineConfig} from 'vitest/config';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    clearMocks: true,
    include: [
      'packages/*/src/**/*.spec.ts',
      'test/**/*.spec.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      all: true,
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        '**/*.spec.ts',
        '**/*.d.ts',
        '**/dist/**',
        'vitest.config.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
  resolve: {
    alias: {
      '@post-machine-js/machine': resolve(root, './packages/machine/src'),
    },
  },
});
