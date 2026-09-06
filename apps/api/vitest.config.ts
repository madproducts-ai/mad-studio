import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@mad/schema': fileURLToPath(new URL('../../packages/schema/src/index.ts', import.meta.url)),
      '@mad/planner': fileURLToPath(new URL('../../packages/planner/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
