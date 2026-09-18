import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@agentos/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@agentos/agents': fileURLToPath(new URL('./packages/agents/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
});
