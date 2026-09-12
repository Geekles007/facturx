import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['site-src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
  },
});
