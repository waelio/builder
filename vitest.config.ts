import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/coder.ts', 'src/agent-server.ts'], // CLI entry points
      reporter: ['text', 'lcov'],
    },
    // Generous timeout for real I/O
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
