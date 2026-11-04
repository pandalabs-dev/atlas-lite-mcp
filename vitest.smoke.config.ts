import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/smoke/**/*.test.ts'],
    setupFiles: ['test/setup/no-network.ts'],
    environment: 'node',
    testTimeout: 120000,
    // A timed-out test still owns its queued scenario. Hooks must not close its transport.
    // On deadline, fail the hook without closing; the session keeps draining in the background.
    hookTimeout: 120000,
  },
});
