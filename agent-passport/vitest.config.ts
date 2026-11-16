import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The in-memory tests finish in under a second. The devnet tests build a
    // real proof per call, so they get minutes.
    testTimeout: 10 * 60_000,
    hookTimeout: 15 * 60_000,
    sequence: { concurrent: false },
    disableConsoleIntercept: true,
  },
});
