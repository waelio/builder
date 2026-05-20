import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each test FILE gets its own isolated module registry.
    // Required for vi.resetModules() + dynamic import env-var isolation.
    isolate: true,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/coder.ts', 'src/agent-server.ts'],
      reporter: ['text', 'lcov'],
    },
    // Generous timeout: subprocess tests (coder) and real I/O
    testTimeout: 30_000,
    hookTimeout: 20_000,
  },
});
